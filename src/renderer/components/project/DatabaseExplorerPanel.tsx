import { useCallback, useEffect, useMemo, useState } from 'react';

import { ipc } from '../../lib/ipc.js';
import { useConnectionsStore } from '../../stores/connections.js';
import { findNode, useSchemaTreeStore } from '../../stores/schema-tree.js';
import type {
  ConnectionState,
  ConnectionStatus,
  DatasourceConfig,
  DriverKind,
} from '~shared/types/datasource.js';
import { SchemaTreeRow } from './SchemaTreeRow.js';
import { AddDataSourceMenu } from '../datasource/AddDataSourceMenu.js';
import { ConnectPasswordPrompt } from '../datasource/ConnectPasswordPrompt.js';
import {
  ContextMenu,
  type ContextMenuItem,
} from '../datasource/ContextMenu.js';
import { DataSourceDialog } from '../datasource/DataSourceDialog.js';
import { DriverIcon } from '../datasource/DriverIcon.js';

interface DatabaseExplorerPanelProps {
  /** Absolute path of the project folder — needed to read/write
   * configs under `.nodegrip/datasources/`. */
  folderPath: string;
}

type DialogState =
  | { open: false }
  | { open: true; initialDriver?: DriverKind; initialSelectedId?: string };

interface ContextMenuState {
  x: number;
  y: number;
  datasourceId: string;
}

interface PromptState {
  config: DatasourceConfig;
  reason: 'missing' | 'wrong';
}

/** Phase-3 surface for the left sidebar. Renders the list of saved
 * data sources with live connection chips, hooks Connect / Disconnect
 * into the runtime pool managed by main, and orchestrates the
 * just-in-time password prompt when the vault can't supply a
 * credential. */
export function DatabaseExplorerPanel({
  folderPath,
}: DatabaseExplorerPanelProps): JSX.Element {
  const [datasources, setDatasources] = useState<DatasourceConfig[] | null>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [problemsExpanded, setProblemsExpanded] = useState(false);

  const bootstrap = useConnectionsStore((s) => s.bootstrap);
  const hydrateConnection = useConnectionsStore((s) => s.hydrate);
  const connectionStates = useConnectionsStore((s) => s.states);
  const bootstrapSchemaTree = useSchemaTreeStore((s) => s.bootstrap);
  const hydrateSchemaTree = useSchemaTreeStore((s) => s.hydrate);

  // Subscribe once per renderer to main's state-change broadcast.
  // The store guards against double-subscribe internally.
  useEffect(() => {
    const unsub = bootstrap();
    return () => {
      unsub();
    };
  }, [bootstrap]);

  // Same one-shot subscribe for schema-tree broadcasts.
  useEffect(() => {
    const unsub = bootstrapSchemaTree();
    return () => {
      unsub();
    };
  }, [bootstrapSchemaTree]);

  const refresh = useCallback(async () => {
    try {
      const list = await ipc.datasource.list(folderPath);
      setDatasources(list);
      // Prime BOTH stores with each datasource's snapshot so the
      // first paint reflects accurate chip + cached tree without
      // waiting for any broadcast.
      for (const d of list) {
        hydrateConnection(d.id);
        hydrateSchemaTree(folderPath, d.id);
      }
    } catch (err) {
      console.error('[DatabaseExplorerPanel] failed to load datasources', err);
      setDatasources([]);
    }
  }, [folderPath, hydrateConnection, hydrateSchemaTree]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeDialog = useCallback(() => {
    setDialog({ open: false });
    void refresh();
  }, [refresh]);

  const openEdit = useCallback((id: string) => {
    setDialog({ open: true, initialSelectedId: id });
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const ds = datasources?.find((d) => d.id === id);
      if (!ds) return;
      const proceed = window.confirm(`Remove data source "${ds.name}"?`);
      if (!proceed) return;
      try {
        await ipc.datasource.remove(folderPath, id);
        await refresh();
      } catch (err) {
        console.error('[DatabaseExplorerPanel] remove failed', err);
      }
    },
    [datasources, folderPath, refresh],
  );

  /** Clone the selected datasource: same config + advanced + options +
   * ssh + ssl, fresh id, name suffix " [N]" so the unique-name check
   * passes. The password vault entry is NOT copied — the user re-types
   * on the first Connect from the new entry. */
  const duplicate = useCallback(
    async (id: string) => {
      const ds = datasources?.find((d) => d.id === id);
      if (!ds || datasources === null) return;
      const newName = pickDuplicateName(
        ds.name,
        datasources.map((d) => d.name),
      );
      try {
        await ipc.datasource.save(folderPath, {
          ...ds,
          id: '', // empty id triggers a fresh UUID in storage
          name: newName,
          createdAt: '',
          updatedAt: '',
        });
        await refresh();
      } catch (err) {
        console.error('[DatabaseExplorerPanel] duplicate failed', err);
      }
    },
    [datasources, folderPath, refresh],
  );

  /** Decide whether to prompt for a password before calling connect.
   * - `never` mode → always prompt; we never have a stored value.
   * - other modes → ask the vault first; prompt only when empty. */
  const connect = useCallback(
    async (id: string) => {
      const ds = datasources?.find((d) => d.id === id);
      if (!ds) return;

      const needsPrompt =
        ds.passwordMode === 'never' ||
        !(await ipc.datasource.hasPassword(folderPath, id).catch(() => false));

      if (needsPrompt) {
        setPrompt({ config: ds, reason: 'missing' });
        return;
      }

      // Vault has a password — let main pull it.
      try {
        const result = await ipc.datasource.connect(folderPath, id);
        if (!result.ok && result.errorKind === 'auth') {
          // Stored password rejected. Surface a new prompt with the
          // "wrong" reason; the vault entry stays put so the user
          // can update it via Edit if needed.
          setPrompt({ config: ds, reason: 'wrong' });
        }
      } catch (err) {
        console.error('[DatabaseExplorerPanel] connect failed', err);
      }
    },
    [datasources, folderPath],
  );

  const disconnect = useCallback(async (id: string) => {
    try {
      await ipc.datasource.disconnect(id);
    } catch (err) {
      console.error('[DatabaseExplorerPanel] disconnect failed', err);
    }
  }, []);

  /** Re-fetch the root list of databases for `id`. The store walks
   * back to `expandSchemaNode([])`, which is the same path the
   * auto-refresh on connect uses. */
  const refreshRoot = useCallback(
    (id: string) => {
      void useSchemaTreeStore.getState().refreshNode(folderPath, id, []);
    },
    [folderPath],
  );

  /** Submit handler for the password prompt — does the actual
   * `connect` call with the user-typed credential, then either
   * dismisses or transitions to the 'wrong' reason for another go. */
  const handlePromptSubmit = useCallback(
    async (password: string) => {
      if (!prompt) return;
      try {
        const result = await ipc.datasource.connect(
          folderPath,
          prompt.config.id,
          password,
        );
        if (result.ok) {
          setPrompt(null);
          return;
        }
        if (result.errorKind === 'auth') {
          // Same prompt, retry with the "wrong" reason copy.
          setPrompt({ config: prompt.config, reason: 'wrong' });
          return;
        }
        // Non-auth failure (network etc.) — drop the prompt; the
        // chip will turn red and the user can hover for details.
        setPrompt(null);
      } catch (err) {
        console.error('[DatabaseExplorerPanel] connect failed', err);
        setPrompt(null);
      }
    },
    [folderPath, prompt],
  );

  const list = datasources ?? [];
  const hasItems = list.length > 0;

  // Case-insensitive substring filter — keep simple, no fuzzy match.
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((d) => d.name.toLowerCase().includes(q));
  }, [list, searchQuery]);

  // Errored datasources surfaced in the Problems drawer at the foot of
  // the panel. We pair each state with its config so the drawer can
  // show the name even when its row is filtered out of the tree.
  const problems = useMemo<Array<{ ds: DatasourceConfig; state: ConnectionState }>>(() => {
    const out: Array<{ ds: DatasourceConfig; state: ConnectionState }> = [];
    for (const ds of list) {
      const state = connectionStates[ds.id];
      if (state?.status === 'error') {
        out.push({ ds, state });
      }
    }
    return out;
  }, [list, connectionStates]);

  return (
    <aside className="proj-pane proj-pane-left" aria-label="Database Explorer">
      <header className="proj-pane-header">
        <span className="proj-pane-title">Database Explorer</span>
        <div className="proj-pane-header-actions">
          <button
            type="button"
            className="proj-pane-action"
            aria-label="Add data source"
            title="Add data source"
            onClick={(e) => setAddMenuAnchor(e.currentTarget)}
          >
            <IconPlus />
          </button>
        </div>
      </header>

      {hasItems && (
        <div className="ds-search">
          <span className="ds-search-icon" aria-hidden>
            <IconSearch />
          </span>
          <input
            type="text"
            className="ds-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by name…"
            spellCheck={false}
            autoComplete="off"
          />
          {searchQuery && (
            <button
              type="button"
              className="ds-search-clear"
              aria-label="Clear search"
              onClick={() => setSearchQuery('')}
            >
              <IconClose />
            </button>
          )}
        </div>
      )}

      {datasources === null ? (
        <div className="proj-pane-body proj-pane-body-empty">
          <div className="proj-pane-empty muted small">Loading…</div>
        </div>
      ) : !hasItems ? (
        <div className="proj-pane-body proj-pane-body-empty">
          <div className="proj-pane-empty">
            <span className="proj-pane-empty-icon" aria-hidden>
              <IconDatabase />
            </span>
            <div className="proj-pane-empty-title">No data sources yet</div>
            <div className="proj-pane-empty-hint">
              Click <strong>+</strong> to add a PostgreSQL, MySQL or MariaDB
              connection.
            </div>
          </div>
        </div>
      ) : filteredList.length === 0 ? (
        <div className="proj-pane-body proj-pane-body-empty">
          <div className="proj-pane-empty muted small">
            No data sources match <strong>{searchQuery}</strong>.
          </div>
        </div>
      ) : (
        <ul className="proj-pane-body ds-tree" role="tree">
          {filteredList.map((ds) => (
            <DatasourceRow
              key={ds.id}
              ds={ds}
              folderPath={folderPath}
              onActivate={() => openEdit(ds.id)}
              onContext={(e) =>
                setContextMenu({ x: e.clientX, y: e.clientY, datasourceId: ds.id })
              }
            />
          ))}
        </ul>
      )}

      {problems.length > 0 && (
        <ProblemsDrawer
          problems={problems}
          expanded={problemsExpanded}
          onToggle={() => setProblemsExpanded((v) => !v)}
          onReconnect={connect}
          onEdit={openEdit}
        />
      )}

      {addMenuAnchor && (
        <AddDataSourceMenu
          anchor={addMenuAnchor}
          onPick={(kind) => {
            setAddMenuAnchor(null);
            setDialog({ open: true, initialDriver: kind });
          }}
          onClose={() => setAddMenuAnchor(null)}
        />
      )}

      {dialog.open && (
        <DataSourceDialog
          folderPath={folderPath}
          initialDriver={dialog.initialDriver}
          initialSelectedId={dialog.initialSelectedId}
          onClose={closeDialog}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextItems({
            datasourceId: contextMenu.datasourceId,
            status:
              useConnectionsStore.getState().states[contextMenu.datasourceId]
                ?.status ?? 'disconnected',
            onConnect: connect,
            onDisconnect: disconnect,
            onRefresh: refreshRoot,
            onEdit: openEdit,
            onDuplicate: duplicate,
            onRemove: remove,
          })}
          onClose={() => setContextMenu(null)}
        />
      )}

      {prompt && (
        <ConnectPasswordPrompt
          config={prompt.config}
          reason={prompt.reason}
          onSubmit={handlePromptSubmit}
          onCancel={() => setPrompt(null)}
        />
      )}
    </aside>
  );
}

function buildContextItems({
  datasourceId,
  status,
  onConnect,
  onDisconnect,
  onRefresh,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  datasourceId: string;
  status: ConnectionStatus;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onRefresh: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}): ContextMenuItem[] {
  const connected = status === 'connected' || status === 'connecting';
  const isLive = status === 'connected';
  return [
    {
      kind: 'item',
      label: status === 'connecting' ? 'Connecting…' : 'Connect',
      disabled: connected,
      onClick: () => onConnect(datasourceId),
    },
    {
      kind: 'item',
      label: 'Disconnect',
      disabled: !connected,
      onClick: () => onDisconnect(datasourceId),
    },
    {
      kind: 'item',
      label: 'Refresh structure',
      disabled: !isLive,
      title: isLive ? undefined : 'Connect first to refresh the database list',
      onClick: () => onRefresh(datasourceId),
    },
    { kind: 'separator' },
    { kind: 'item', label: 'Edit…', onClick: () => onEdit(datasourceId) },
    {
      kind: 'item',
      label: 'Duplicate',
      onClick: () => onDuplicate(datasourceId),
    },
    {
      kind: 'item',
      label: 'Remove',
      destructive: true,
      onClick: () => onRemove(datasourceId),
    },
  ];
}

/** Pick the next available " [N]" suffix for a duplicated datasource.
 * Strips an existing " [N]" from the source so duplicates don't pile
 * up as "Foo [2] [2]". Case-insensitive uniqueness against existing
 * names so storage's validation accepts the result. */
function pickDuplicateName(original: string, existing: string[]): string {
  const baseName = original.replace(/ \[\d+\]$/, '');
  const usedLower = new Set(existing.map((n) => n.toLowerCase()));
  let n = 2;
  while (usedLower.has(`${baseName} [${n}]`.toLowerCase())) n++;
  return `${baseName} [${n}]`;
}

function DatasourceRow({
  ds,
  folderPath,
  onActivate,
  onContext,
}: {
  ds: DatasourceConfig;
  folderPath: string;
  onActivate(): void;
  onContext(e: React.MouseEvent): void;
}): JSX.Element {
  // Subscribe to PRIMITIVE fields rather than the aggregate
  // ConnectionState object — the agg selector would return a fresh
  // `{ id, status: 'disconnected' }` literal whenever the id isn't in
  // the store yet, breaking zustand's Object.is equality and looping
  // the component into "Maximum update depth exceeded".
  const status = useConnectionsStore(
    (s) => s.states[ds.id]?.status ?? 'disconnected',
  );
  const serverVersion = useConnectionsStore(
    (s) => s.states[ds.id]?.serverVersion,
  );
  const error = useConnectionsStore((s) => s.states[ds.id]?.error);
  const statusTitle = describeStatus(status, serverVersion, error);

  // Datasource-row expand state lives in the schema-tree store under
  // the empty-path key so the rest of the tree can address it the
  // same way as deeper levels.
  const expanded = useSchemaTreeStore((s) => s.isExpanded(ds.id, []));
  const toggleExpanded = useSchemaTreeStore((s) => s.toggleExpanded);
  const tree = useSchemaTreeStore((s) => s.trees[ds.id]);
  const rootNode = findNode(tree, []);
  const databases = rootNode?.children;
  const databasesKnown = databases !== undefined;
  const isConnected = status === 'connected';
  const refreshedAt = tree?.refreshedAt;
  // "Stale" hint: cached tree exists but we're disconnected. The chip
  // lights up muted-yellow to remind the user the data may have
  // drifted since last connect.
  const showStale =
    databasesKnown && !isConnected && status !== 'connecting';

  return (
    <li>
      <div
        className="ds-tree-row"
        role="treeitem"
        aria-expanded={expanded}
        tabIndex={0}
        title={`${ds.user}@${ds.host}:${ds.port}/${ds.database || ''}\n${statusTitle}`}
        onClick={() => toggleExpanded(folderPath, ds.id, [])}
        onDoubleClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onActivate();
          } else if (e.key === 'ArrowRight' && !expanded) {
            e.preventDefault();
            toggleExpanded(folderPath, ds.id, []);
          } else if (e.key === 'ArrowLeft' && expanded) {
            e.preventDefault();
            toggleExpanded(folderPath, ds.id, []);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContext(e);
        }}
      >
        <span
          className={`schema-tree-chevron${expanded ? ' schema-tree-chevron-open' : ''}`}
          aria-hidden
        >
          <ChevronRight />
        </span>
        <span className="ds-tree-row-icon" aria-hidden>
          <DriverIcon kind={ds.driver} size={16} />
        </span>
        <span className="ds-tree-row-name">{ds.name}</span>
        {showStale && (
          <span
            className="ds-tree-row-stale small"
            title={
              refreshedAt
                ? `Cached structure (last refreshed ${formatTimestamp(refreshedAt)})`
                : 'Cached structure'
            }
          >
            stale
          </span>
        )}
        <ConnectionStatusDot status={status} title={statusTitle} />
      </div>

      {expanded && (
        <div className="schema-tree-children" role="group">
          {!databasesKnown ? (
            <div
              className="schema-tree-status muted small"
              style={{ paddingLeft: 36 }}
            >
              {isConnected
                ? 'Loading databases…'
                : 'Connect to load the database list.'}
            </div>
          ) : databases.length === 0 ? (
            <div
              className="schema-tree-status muted small"
              style={{ paddingLeft: 36 }}
            >
              No databases visible to this user.
            </div>
          ) : (
            databases.map((db) => (
              <SchemaTreeRow
                key={`database:${db.name}`}
                datasourceId={ds.id}
                folderPath={folderPath}
                path={[db.name]}
                node={db}
                indentPx={22}
                isConnected={isConnected}
              />
            ))
          )}
        </div>
      )}
    </li>
  );
}

/** Compact ISO timestamp → "today 14:32" / "2 days ago" formatter for
 * the stale hint tooltip. Kept inline — adding a date library for
 * one usage isn't worth the bundle size. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function ChevronRight(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path
        d="M3 2 L7 5 L3 8"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function describeStatus(
  status: ConnectionStatus,
  serverVersion: string | undefined,
  error: string | undefined,
): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return serverVersion ? `Connected · ${serverVersion}` : 'Connected';
    case 'error':
      return error ? `Error: ${error}` : 'Error';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
}

function ConnectionStatusDot({
  status,
  title,
}: {
  status: ConnectionStatus;
  title: string;
}): JSX.Element {
  return (
    <span
      className={`ds-tree-row-status ds-tree-row-status-${status}`}
      title={title}
      aria-label={title}
    />
  );
}

function IconPlus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSearch(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.4 10.4 L13.5 13.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconClose(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path
        d="M1,1 L9,9 M9,1 L1,9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.12s ease' }}
    >
      <path
        d="M2 3.5 L5 7 L8 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconWarning(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2 L14.5 13 H1.5 z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 6 V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.65" fill="currentColor" />
    </svg>
  );
}

/* --- Problems drawer ------------------------------------------------- */

function ProblemsDrawer({
  problems,
  expanded,
  onToggle,
  onReconnect,
  onEdit,
}: {
  problems: Array<{ ds: DatasourceConfig; state: ConnectionState }>;
  expanded: boolean;
  onToggle(): void;
  onReconnect(id: string): void;
  onEdit(id: string): void;
}): JSX.Element {
  return (
    <div className={`ds-problems${expanded ? ' ds-problems-expanded' : ''}`}>
      <button
        type="button"
        className="ds-problems-footer"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="ds-problems-footer-icon" aria-hidden>
          <IconWarning />
        </span>
        <span className="ds-problems-footer-label">
          Problems
          <span className="ds-problems-footer-count">{problems.length}</span>
        </span>
        <span className="ds-problems-footer-chevron" aria-hidden>
          <IconChevron open={expanded} />
        </span>
      </button>
      {expanded && (
        <ul className="ds-problems-list" role="list">
          {problems.map(({ ds, state }) => (
            <li key={ds.id} className="ds-problems-item">
              <div className="ds-problems-item-header">
                <span className="ds-problems-item-name" title={ds.name}>
                  {ds.name}
                </span>
                <span className="ds-problems-item-kind muted small">
                  {state.errorKind ?? 'error'}
                </span>
              </div>
              <div
                className="ds-problems-item-error small"
                title={state.error ?? 'Unknown error'}
              >
                {state.error ?? 'Unknown error'}
              </div>
              <div className="ds-problems-item-actions">
                <button
                  type="button"
                  className="ds-problems-action"
                  onClick={() => onReconnect(ds.id)}
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  className="ds-problems-action"
                  onClick={() => onEdit(ds.id)}
                >
                  Edit…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconDatabase(): JSX.Element {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5 5.5 V12 a7 2.5 0 0 0 14 0 V5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
      <path
        d="M5 12 V18 a7 2.5 0 0 0 14 0 V12"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
    </svg>
  );
}
