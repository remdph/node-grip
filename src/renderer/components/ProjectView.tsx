import { useCallback, useState } from 'react';

import { ipc } from '../lib/ipc.js';
import { useTabsStore } from '../stores/tabs.js';
import type { FileEntry } from '~shared/types/ipc.js';
import { DatabaseExplorerPanel } from './project/DatabaseExplorerPanel.js';
import { EditorPane, type OpenFile } from './project/EditorPane.js';
import { FilesPanel } from './project/FilesPanel.js';

interface ProjectViewProps {
  folderPath: string;
  name: string;
}

/**
 * Open-project surface. Three-column layout inspired by DataGrip / IntelliJ:
 *
 *   Database Explorer | Editor (tabs + content) | Files
 *
 * Per the design contract: the file selected (highlighted) in the right
 * Files panel is *always* the file currently displayed in the editor. The
 * binding is two-way — clicking a leaf in the tree activates that file in
 * the editor, and switching tabs in the editor moves the highlight in the
 * tree.
 *
 * Tab state is local to this component instance. Each open project gets
 * its own ProjectView (kept mounted via `display:none` from App.tsx),
 * which means open files survive tab switches between projects but reset
 * when the project tab itself is closed. Cross-session persistence can
 * come later.
 */
export function ProjectView({ folderPath, name }: ProjectViewProps): JSX.Element {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const leftSidebarOpen = useTabsStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useTabsStore((s) => s.rightSidebarOpen);

  const openFile = useCallback(
    (entry: FileEntry) => {
      if (entry.type !== 'file') return;
      // Already open → just activate.
      setFiles((prev) => {
        if (prev.some((f) => f.path === entry.path)) return prev;
        const loading: OpenFile = {
          path: entry.path,
          name: entry.name,
          status: 'loading',
        };
        return [...prev, loading];
      });
      setActivePath(entry.path);

      // Lazy fetch — main bounces back the text content, then we
      // reconcile the matching open-file entry.
      void ipc.project
        .readFile(entry.path)
        .then((result) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.path === entry.path
                ? { ...f, status: 'ready', result }
                : f,
            ),
          );
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Read failed';
          setFiles((prev) =>
            prev.map((f) =>
              f.path === entry.path
                ? { ...f, status: 'error', error: message }
                : f,
            ),
          );
        });
    },
    [],
  );

  const closeFile = useCallback(
    (path: string) => {
      setFiles((prev) => {
        const idx = prev.findIndex((f) => f.path === path);
        if (idx === -1) return prev;
        const next = prev.filter((f) => f.path !== path);
        // Move the active selection to the neighbour that takes this
        // slot (chrome/vscode convention) — or null when nothing's left.
        setActivePath((current) => {
          if (current !== path) return current;
          if (next.length === 0) return null;
          const fallback = next[idx] ?? next[idx - 1] ?? next[0];
          return fallback ? fallback.path : null;
        });
        return next;
      });
    },
    [],
  );

  // Class modifier drives the CSS grid template. Re-rendering the panels
  // out of the tree (instead of `display: none`) keeps the grid columns
  // honest — collapsed sidebars take zero space, not a hidden 280/300px.
  const layoutClass = [
    'proj-layout',
    leftSidebarOpen ? 'proj-layout-left' : '',
    rightSidebarOpen ? 'proj-layout-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={layoutClass}>
      {leftSidebarOpen && <DatabaseExplorerPanel folderPath={folderPath} />}
      <main className="proj-main" aria-label={`Project: ${name}`}>
        <EditorPane
          files={files}
          activePath={activePath}
          onActivate={setActivePath}
          onClose={closeFile}
        />
      </main>
      {rightSidebarOpen && (
        <FilesPanel
          folderPath={folderPath}
          rootLabel={name}
          activeFilePath={activePath}
          onFileSelect={openFile}
        />
      )}
    </div>
  );
}
