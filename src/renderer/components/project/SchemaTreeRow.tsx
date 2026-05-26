import { useState } from 'react';

import type {
  SchemaNodeKind,
  SchemaNodePath,
  SchemaTreeNode,
} from '~shared/types/schema-tree.js';
import { useSchemaTreeStore } from '../../stores/schema-tree.js';
import {
  ContextMenu,
  type ContextMenuItem,
} from '../datasource/ContextMenu.js';

interface SchemaTreeRowProps {
  /** Datasource the node belongs to (used to scope expansion state +
   * fire IPC refreshes). */
  datasourceId: string;
  /** Project folder so the IPC call can locate the cache. */
  folderPath: string;
  /** Path from the cache root to THIS node — used as the lookup key
   * for refresh / expand. */
  path: SchemaNodePath;
  node: SchemaTreeNode;
  /** Indent in pixels — added to the row's paddingLeft so nested
   * levels visually offset. Computed by the parent (the datasource
   * row uses ~24px; each schema level adds ~14px). */
  indentPx: number;
  /** When the datasource is currently connected, expansion + refresh
   * is enabled. When disconnected, the user can still browse cached
   * children but new fetches are gated. */
  isConnected: boolean;
}

/** Recursive renderer for one node in the schema tree. Leaf nodes
 * (kind === 'table' / 'view') render as a single non-expandable row;
 * containers render their children indented when expanded. */
export function SchemaTreeRow({
  datasourceId,
  folderPath,
  path,
  node,
  indentPx,
  isConnected,
}: SchemaTreeRowProps): JSX.Element {
  const expanded = useSchemaTreeStore((s) => s.isExpanded(datasourceId, path));
  const fetching = useSchemaTreeStore((s) => s.isFetching(datasourceId, path));
  const toggle = useSchemaTreeStore((s) => s.toggleExpanded);
  const refresh = useSchemaTreeStore((s) => s.refreshNode);
  // Surface the last failure for THIS path so the user sees a hint
  // when the fetch silently bailed. Hovering reveals the full
  // message; the icon stays small to not crowd the row.
  const error = useSchemaTreeStore(
    (s) => s.errors[`${datasourceId}:${path.join('/')}`],
  );

  const isLeaf = node.kind === 'table' || node.kind === 'view';
  const children = node.children;
  const childrenKnown = children !== undefined;

  // Per-row context menu state. One row at a time can have a menu
  // open — opening another row's menu fires `mousedown` which
  // closes the previous one via its outside-click handler.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const handleContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleToggle = () => {
    if (isLeaf) return;
    toggle(folderPath, datasourceId, path);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isLeaf) return;
    if (!isConnected) return;
    // Shift + double-click is the implicit "force refresh" shortcut —
    // matches the JetBrains gesture. Plain double-click just toggles
    // expansion (the dblclick handler beats the row's own onclick
    // so we don't get duplicate toggle calls).
    if (e.shiftKey) {
      void refresh(folderPath, datasourceId, path);
    }
  };

  return (
    <div className="schema-tree-node">
      <div
        className={`ds-tree-row schema-tree-row${expanded ? ' schema-tree-row-expanded' : ''}`}
        style={{ paddingLeft: indentPx }}
        role="treeitem"
        aria-expanded={isLeaf ? undefined : expanded}
        tabIndex={0}
        title={`${node.kind}: ${node.name}`}
        onClick={handleToggle}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContext}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          } else if (e.key === 'ArrowRight' && !isLeaf && !expanded) {
            e.preventDefault();
            handleToggle();
          } else if (e.key === 'ArrowLeft' && !isLeaf && expanded) {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        {isLeaf ? (
          <span className="schema-tree-chevron-spacer" aria-hidden />
        ) : (
          <span
            className={`schema-tree-chevron${expanded ? ' schema-tree-chevron-open' : ''}`}
            aria-hidden
          >
            <ChevronRight />
          </span>
        )}
        <span className="schema-tree-icon" aria-hidden>
          <NodeIcon kind={node.kind} />
        </span>
        <span className="schema-tree-name">{node.name}</span>
        {fetching && <span className="schema-tree-loading muted small">…</span>}
        {error && !fetching && (
          <span
            className="schema-tree-error-chip"
            title={error}
            aria-label={`Refresh failed: ${error}`}
          >
            !
          </span>
        )}
      </div>

      {expanded && !isLeaf && (
        <div className="schema-tree-children" role="group">
          {fetching && !childrenKnown && (
            <div
              className="schema-tree-status muted small"
              style={{ paddingLeft: indentPx + 18 }}
            >
              Loading…
            </div>
          )}
          {!fetching && !childrenKnown && error && (
            <div
              className="schema-tree-status schema-tree-status-error small"
              style={{ paddingLeft: indentPx + 18 }}
              title={error}
            >
              {error}
            </div>
          )}
          {!fetching && !childrenKnown && !error && !isConnected && (
            <div
              className="schema-tree-status muted small"
              style={{ paddingLeft: indentPx + 18 }}
            >
              Connect to load.
            </div>
          )}
          {childrenKnown && children.length === 0 && (
            <div
              className="schema-tree-status muted small"
              style={{ paddingLeft: indentPx + 18 }}
            >
              Empty
            </div>
          )}
          {childrenKnown &&
            children.map((child) => (
              <SchemaTreeRow
                key={`${child.kind}:${child.name}`}
                datasourceId={datasourceId}
                folderPath={folderPath}
                path={[...path, child.name]}
                node={child}
                indentPx={indentPx + 14}
                isConnected={isConnected}
              />
            ))}
        </div>
      )}

      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={buildSchemaContextItems({
            isLeaf,
            isConnected,
            onRefresh: () => {
              void refresh(folderPath, datasourceId, path);
            },
          })}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
}

function buildSchemaContextItems({
  isLeaf,
  isConnected,
  onRefresh,
}: {
  isLeaf: boolean;
  isConnected: boolean;
  onRefresh: () => void;
}): ContextMenuItem[] {
  // Refresh re-fetches the children at THIS path. Disabled cases:
  //   - leaf nodes (tables/views): nothing to fetch under them yet.
  //   - disconnected datasource: introspection needs a live pool.
  return [
    {
      kind: 'item',
      label: 'Refresh',
      disabled: isLeaf || !isConnected,
      title: isLeaf
        ? 'Tables and views do not have children to refresh yet'
        : !isConnected
        ? 'Connect to the data source first'
        : undefined,
      onClick: onRefresh,
    },
  ];
}

/* --- atoms ----------------------------------------------------------- */

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

function NodeIcon({ kind }: { kind: SchemaNodeKind }): JSX.Element {
  switch (kind) {
    case 'database':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <ellipse cx="8" cy="3.5" rx="5" ry="1.6" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M3 3.5 V8 a5 1.6 0 0 0 10 0 V3.5"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <path
            d="M3 8 V12 a5 1.6 0 0 0 10 0 V8"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      );
    case 'schema':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect
            x="2.5"
            y="2.5"
            width="11"
            height="11"
            rx="1.3"
            stroke="currentColor"
            strokeWidth="1.15"
          />
          <circle cx="5.5" cy="5.5" r="1.1" stroke="currentColor" strokeWidth="1.05" />
          <circle cx="10.5" cy="5.5" r="1.1" stroke="currentColor" strokeWidth="1.05" />
          <circle cx="8" cy="10.5" r="1.1" stroke="currentColor" strokeWidth="1.05" />
          <path d="M5.5 6.6 L7.7 9.5 M10.5 6.6 L8.3 9.5" stroke="currentColor" strokeWidth="1.05" />
        </svg>
      );
    case 'view':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="3" width="11" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M2.5 6.5 H13.5 M5.5 3 V13 M9.5 3 V13"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.6"
          />
          <path d="M9.5 3 L13.5 6.5 V3 z" fill="currentColor" opacity="0.18" />
        </svg>
      );
    case 'table':
    default:
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="3" width="11" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M2.5 6.5 H13.5 M2.5 9.5 H13.5 M5.5 3 V13 M9.5 3 V13"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.6"
          />
        </svg>
      );
  }
}
