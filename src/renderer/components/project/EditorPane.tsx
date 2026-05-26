import { useEffect, useMemo, useRef } from 'react';

import type { FileReadResult } from '~shared/types/ipc.js';

export interface OpenFile {
  /** Absolute path on disk — also the tab key. */
  path: string;
  /** Display name in the tab (basename). */
  name: string;
  /** Lifecycle:
   *  - 'loading' → file being read; show spinner-ish placeholder
   *  - 'ready'   → `result` is populated
   *  - 'error'   → `error` is populated
   */
  status: 'loading' | 'ready' | 'error';
  result?: FileReadResult;
  error?: string;
}

interface EditorPaneProps {
  files: OpenFile[];
  activePath: string | null;
  onActivate(path: string): void;
  onClose(path: string): void;
}

/** Center pane: row of file tabs on top, content of the active tab below.
 * Read-only viewer for v0.1.0 — editing comes when we settle on a code
 * editor surface (CodeMirror or Monaco; not pulled in yet to keep the
 * bundle lean for the shell milestone). */
export function EditorPane({
  files,
  activePath,
  onActivate,
  onClose,
}: EditorPaneProps): JSX.Element {
  const active = useMemo(
    () => files.find((f) => f.path === activePath) ?? null,
    [files, activePath],
  );

  return (
    <section className="proj-editor" aria-label="Editor">
      {files.length > 0 && (
        <div className="proj-editor-tabs" role="tablist">
          {files.map((file) => (
            <FileTab
              key={file.path}
              file={file}
              active={file.path === activePath}
              onActivate={() => onActivate(file.path)}
              onClose={() => onClose(file.path)}
            />
          ))}
        </div>
      )}
      <div className="proj-editor-body">
        {active ? (
          <FileContent file={active} />
        ) : (
          <EmptyState />
        )}
      </div>
    </section>
  );
}

function FileTab({
  file,
  active,
  onActivate,
  onClose,
}: {
  file: OpenFile;
  active: boolean;
  onActivate(): void;
  onClose(): void;
}): JSX.Element {
  return (
    <div
      className={`proj-file-tab${active ? ' proj-file-tab-active' : ''}`}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={file.path}
      onClick={onActivate}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      <span className="proj-file-tab-name">{file.name}</span>
      <button
        type="button"
        className="proj-file-tab-close"
        aria-label={`Close ${file.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1,1 L9,9 M9,1 L1,9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

function FileContent({ file }: { file: OpenFile }): JSX.Element {
  // Re-anchor the scroll position to the top whenever the active file
  // changes; otherwise switching tabs leaves the new file at the same
  // scroll position as the previous one (single shared viewer element).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [file.path]);

  if (file.status === 'loading') {
    return (
      <div className="proj-editor-state muted small" ref={scrollRef}>
        Loading {file.name}…
      </div>
    );
  }
  if (file.status === 'error') {
    return (
      <div className="proj-editor-state proj-editor-state-error small" ref={scrollRef}>
        {file.error || 'Failed to read file'}
      </div>
    );
  }
  const result = file.result;
  if (!result) {
    return (
      <div className="proj-editor-state muted small" ref={scrollRef}>
        File content not available.
      </div>
    );
  }
  if (result.tooLarge) {
    return (
      <div className="proj-editor-state muted small" ref={scrollRef}>
        This file is too large to display ({formatBytes(result.size)}). Open it
        in an external editor.
      </div>
    );
  }
  if (result.binary) {
    return (
      <div className="proj-editor-state muted small" ref={scrollRef}>
        Binary file ({formatBytes(result.size)}). The viewer only renders text
        files.
      </div>
    );
  }
  return (
    <div className="proj-editor-content" ref={scrollRef}>
      <pre className="proj-editor-pre">{result.content}</pre>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="proj-editor-empty">
      <div className="proj-editor-empty-glyph" aria-hidden>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M14 4v5h5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="proj-editor-empty-title">No file open</div>
      <div className="proj-editor-empty-hint">
        Pick a file from the <strong>Files</strong> panel on the right to view it
        here.
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
