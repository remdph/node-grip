import { useEffect, useRef, useState } from 'react';

import { ipc } from '../lib/ipc.js';
import type { ProjectInfo } from '~shared/types/ipc.js';

interface CreateProjectDialogProps {
  onCancel(): void;
  onCreated(info: ProjectInfo): void;
}

/**
 * In-app "New project" dialog. Convention-matched to JetBrains DataGrip /
 * VS Code's new-project flow because the system folder picker on Linux
 * (xdg-desktop-portal) and Windows (IFileDialog) does not reliably expose
 * a "create folder" button, and Electron's `createDirectory` property
 * for `showOpenDialog` is macOS-only.
 *
 * The user types a project name and picks (or types) a parent folder.
 * Submit calls `project.create(parent, name)` which mkdirs the target,
 * writes `.nodegrip/project.json`, and returns the freshly minted
 * ProjectInfo so the caller can open it as a tab.
 */
export function CreateProjectDialog({
  onCancel,
  onCreated,
}: CreateProjectDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Default the parent to the user's Documents folder on first mount so
  // the dialog isn't completely empty. Falls back to whichever home
  // subfolder exists if Documents doesn't.
  useEffect(() => {
    let cancelled = false;
    void ipc.shell.homeFolders().then((folders) => {
      if (cancelled) return;
      const docs = folders.find((f) => f.name === 'Documents') ?? folders[0];
      if (docs) setParent(docs.path);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const sep = ipc.platform === 'win32' ? '\\' : '/';
  const trimmedName = name.trim();
  const trimmedParent = parent.trim();
  // Preview the resolved path so the user can sanity-check what folder
  // will be created. Strip a trailing separator from the parent to avoid
  // doubling it in the join.
  const cleanParent = trimmedParent.replace(/[\\/]+$/, '');
  const fullPath = trimmedName && cleanParent ? `${cleanParent}${sep}${trimmedName}` : '';

  const canSubmit = trimmedName.length > 0 && cleanParent.length > 0 && !busy;

  const browse = async () => {
    const picked = await ipc.project.pickFolder(cleanParent || undefined);
    if (picked) setParent(picked);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const info = await ipc.project.create(cleanParent, trimmedName);
      onCreated(info);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create project';
      setError(message);
      setBusy(false);
    }
  };

  return (
    <div
      className="password-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        className="password-dialog create-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New project"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="password-dialog-header">
          <div>
            <h2 className="password-dialog-title">New project</h2>
            <p className="password-dialog-subtitle muted small">
              Create a folder for a brand-new project.
            </p>
          </div>
          <button
            type="button"
            className="password-dialog-close"
            onClick={onCancel}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path
                d="M2,2 L12,12 M12,2 L2,12"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="password-dialog-body">
          <label className="password-dialog-field">
            <span className="password-dialog-label">Project name</span>
            <input
              ref={nameRef}
              type="text"
              className="password-dialog-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-database"
              spellCheck={false}
              autoComplete="off"
            />
          </label>

          <label className="password-dialog-field">
            <span className="password-dialog-label">Location</span>
            <div className="create-project-location">
              <input
                type="text"
                className="password-dialog-input create-project-location-input"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="create-project-browse"
                onClick={browse}
                disabled={busy}
              >
                Browse…
              </button>
            </div>
          </label>

          {fullPath && (
            <p className="muted small create-project-preview" title={fullPath}>
              Will create: <code>{fullPath}</code>
            </p>
          )}

          {error && (
            <div className="password-dialog-error small">{error}</div>
          )}
        </div>

        <footer className="password-dialog-footer">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </form>
    </div>
  );
}
