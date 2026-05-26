import { useEffect, useMemo, useRef, useState } from 'react';

import { ipc } from '../../lib/ipc.js';
import type { FileEntry } from '~shared/types/ipc.js';

interface FilesPanelProps {
  /** Project root folder. The tree starts here as the root node. */
  folderPath: string;
  /** Display label for the root node (the project's metadata name). */
  rootLabel: string;
  /** Absolute path of the file currently open in the editor. Highlighted
   * in the tree; the user clicks a file node to swap the active file. */
  activeFilePath: string | null;
  /** Fired when the user clicks a file leaf. The parent decides whether
   * to open it as a new tab or switch to an existing one. */
  onFileSelect(entry: FileEntry): void;
}

/** Per-folder cache + load state lives in this panel because expansion
 * is a UI concern. The renderer-side cache is intentionally simple — a
 * full reload happens on refresh, no fs.watch wiring yet. */
interface ChildrenState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  entries: FileEntry[];
  error?: string;
}

const EMPTY_CHILDREN: ChildrenState = { status: 'idle', entries: [] };

export function FilesPanel({
  folderPath,
  rootLabel,
  activeFilePath,
  onFileSelect,
}: FilesPanelProps): JSX.Element {
  // Per-directory children cache + expanded set.
  const [children, setChildren] = useState<Record<string, ChildrenState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([folderPath]));

  // Bumped on Refresh — invalidates cached listings via the effect below.
  const [refreshKey, setRefreshKey] = useState(0);

  // Load any expanded folder whose cache entry is missing. Runs on mount
  // (because the root is in `expanded` by default), on expand, and on
  // refresh. We snapshot inside the effect to avoid setState in a loop.
  useEffect(() => {
    const dirsToLoad = Array.from(expanded).filter((dir) => {
      const c = children[dir];
      return !c || c.status === 'idle';
    });
    if (dirsToLoad.length === 0) return;

    let cancelled = false;
    setChildren((prev) => {
      const next = { ...prev };
      for (const dir of dirsToLoad) {
        next[dir] = { status: 'loading', entries: [] };
      }
      return next;
    });

    for (const dir of dirsToLoad) {
      void ipc.project
        .listFolder(dir)
        .then((entries) => {
          if (cancelled) return;
          setChildren((prev) => ({
            ...prev,
            [dir]: { status: 'ready', entries },
          }));
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : 'Read failed';
          setChildren((prev) => ({
            ...prev,
            [dir]: { status: 'error', entries: [], error: message },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [expanded, children, refreshKey]);

  // When the active file changes (e.g. user switched tab in the editor),
  // expand its ancestor folders so the highlighted leaf is actually
  // visible in the tree.
  useEffect(() => {
    if (!activeFilePath) return;
    if (!activeFilePath.startsWith(folderPath)) return;
    const rel = activeFilePath.slice(folderPath.length).replace(/^[\\/]/, '');
    const parts = rel.split(/[\\/]/).slice(0, -1);
    if (parts.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let acc = folderPath;
      for (const part of parts) {
        acc = `${acc}${acc.endsWith('/') || acc.endsWith('\\') ? '' : '/'}${part}`;
        next.add(acc);
      }
      return next;
    });
  }, [activeFilePath, folderPath]);

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const refresh = () => {
    // Drop all cached listings — the effect repopulates only what's
    // currently expanded.
    setChildren({});
    setRefreshKey((k) => k + 1);
  };

  const collapseAll = () => {
    setExpanded(new Set([folderPath]));
  };

  return (
    <aside className="proj-pane proj-pane-right" aria-label="Files">
      <header className="proj-pane-header">
        <span className="proj-pane-title">Files</span>
        <div className="proj-pane-header-actions">
          <PaneActionButton title="Collapse all" onClick={collapseAll}>
            <IconCollapseAll />
          </PaneActionButton>
          <PaneActionButton title="Refresh" onClick={refresh}>
            <IconRefresh />
          </PaneActionButton>
        </div>
      </header>
      <div className="proj-pane-body proj-pane-body-tree">
        <TreeNode
          name={rootLabel}
          path={folderPath}
          type="dir"
          depth={0}
          expanded={expanded.has(folderPath)}
          isActive={false}
          children={children}
          expandedSet={expanded}
          activeFilePath={activeFilePath}
          onToggle={toggle}
          onFileSelect={onFileSelect}
          isRoot
        />
      </div>
    </aside>
  );
}

interface TreeNodeProps {
  name: string;
  path: string;
  type: 'file' | 'dir';
  depth: number;
  expanded: boolean;
  isActive: boolean;
  children: Record<string, ChildrenState>;
  expandedSet: Set<string>;
  activeFilePath: string | null;
  onToggle(path: string): void;
  onFileSelect(entry: FileEntry): void;
  isRoot?: boolean;
}

function TreeNode({
  name,
  path,
  type,
  depth,
  expanded,
  isActive,
  children,
  expandedSet,
  activeFilePath,
  onToggle,
  onFileSelect,
  isRoot,
}: TreeNodeProps): JSX.Element {
  const state = children[path] ?? EMPTY_CHILDREN;
  const indentPx = depth * 14;

  const handleClick = () => {
    if (type === 'dir') {
      onToggle(path);
    } else {
      onFileSelect({ name, path, type: 'file' });
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    } else if (e.key === 'ArrowRight' && type === 'dir' && !expanded) {
      e.preventDefault();
      onToggle(path);
    } else if (e.key === 'ArrowLeft' && type === 'dir' && expanded) {
      e.preventDefault();
      onToggle(path);
    }
  };

  return (
    <div className="proj-tree-node" role="treeitem" aria-expanded={type === 'dir' ? expanded : undefined}>
      <div
        className={
          `proj-tree-row${isActive ? ' proj-tree-row-active' : ''}` +
          `${isRoot ? ' proj-tree-row-root' : ''}`
        }
        style={{ paddingLeft: indentPx + 6 }}
        role="button"
        tabIndex={0}
        title={path}
        onClick={handleClick}
        onKeyDown={handleKey}
      >
        {type === 'dir' ? (
          <span
            className={`proj-tree-chevron${expanded ? ' proj-tree-chevron-open' : ''}`}
            aria-hidden
          >
            <ChevronRight />
          </span>
        ) : (
          <span className="proj-tree-chevron-spacer" aria-hidden />
        )}
        <span className="proj-tree-icon" aria-hidden>
          {type === 'dir' ? (expanded ? <FolderOpen /> : <FolderClosed />) : <FileGlyph name={name} />}
        </span>
        <span className="proj-tree-name">{name}</span>
      </div>
      {type === 'dir' && expanded && (
        <div className="proj-tree-children" role="group">
          {state.status === 'loading' && (
            <div
              className="proj-tree-status muted small"
              style={{ paddingLeft: indentPx + 28 }}
            >
              Loading…
            </div>
          )}
          {state.status === 'error' && (
            <div
              className="proj-tree-status proj-tree-status-error small"
              style={{ paddingLeft: indentPx + 28 }}
              title={state.error}
            >
              Failed to read folder
            </div>
          )}
          {state.status === 'ready' && state.entries.length === 0 && (
            <div
              className="proj-tree-status muted small"
              style={{ paddingLeft: indentPx + 28 }}
            >
              Empty
            </div>
          )}
          {state.status === 'ready' &&
            state.entries.map((entry) => (
              <TreeNode
                key={entry.path}
                name={entry.name}
                path={entry.path}
                type={entry.type}
                depth={depth + 1}
                expanded={expandedSet.has(entry.path)}
                isActive={entry.type === 'file' && entry.path === activeFilePath}
                children={children}
                expandedSet={expandedSet}
                activeFilePath={activeFilePath}
                onToggle={onToggle}
                onFileSelect={onFileSelect}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function PaneActionButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="proj-pane-action"
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      {children}
    </button>
  );
}

function ChevronRight(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path
        d="M3 2 L7 5 L3 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderClosed(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.6a1 1 0 0 1 1-1h2.6l1.2 1.3h6.2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderOpen(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.6a1 1 0 0 1 1-1h2.6l1.2 1.3h6.2a1 1 0 0 1 1 1v1.5H2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M2 6.5 L3 12.3 a0.9 0.9 0 0 0 0.9 0.7 H12.3 a0.9 0.9 0 0 0 0.9 -0.75 L14.2 7.5 a0.6 0.6 0 0 0 -0.6 -0.7 H2.6 a0.6 0.6 0 0 0 -0.6 0.7 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileGlyph({ name }: { name: string }): JSX.Element {
  // Tiny per-extension dot of colour — keeps the visual rhythm of
  // file-type icons without committing to a full icon set per language.
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const accent = useMemo(() => {
    switch (ext) {
      case 'sql':
        return 'var(--accent)';
      case 'json':
      case 'yaml':
      case 'yml':
        return '#eab308';
      case 'md':
      case 'txt':
        return '#94a3b8';
      default:
        return 'var(--fg-muted)';
    }
  }, [ext]);
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 1.5h6.2L13 4.6V13.5a0.8 0.8 0 0 1 -0.8 0.8 H3.8 A0.8 0.8 0 0 1 3 13.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M9.7 1.5V4.6H13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="10.5" r="1.1" fill={accent} />
    </svg>
  );
}

function IconRefresh(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8 a5 5 0 0 1 8.8 -3.2 M13 8 a5 5 0 0 1 -8.8 3.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M11.8 2.5 V5 H9.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.2 13.5 V11 H6.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconCollapseAll(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 5 L8 1.5 L13 5 M3 11 L8 14.5 L13 11"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

