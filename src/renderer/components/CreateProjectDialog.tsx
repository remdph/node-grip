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
 *
 * After creation, if the project has no custom passphrase set, the user
 * is given the option to set one. If they skip it, the default built-in
 * passphrase is used (passwords are still encrypted, just with a known key).
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

  // Phase: '' | 'creating' | 'passphrase'
  const [phase, setPhase] = useState('');
  const [createdInfo, setCreatedInfo] = useState<ProjectInfo | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);

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
      setCreatedInfo(info);
      setPhase('passphrase');
      setBusy(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create project';
      setError(message);
      setBusy(false);
    }
  };

  const handlePassphraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassphraseError(null);
    if (passphrase !== passphraseConfirm) {
      setPassphraseError('Passphrases do not match');
      return;
    }
    if (passphrase.length > 0 && passphrase.length < 4) {
      setPassphraseError('Passphrase must be at least 4 characters');
      return;
    }
    setBusy(true);
    try {
      // Set the passphrase (undefined means use default built-in)
      const updatedMeta = await ipc.project.setPassphrase(
        createdInfo!.folderPath,
        passphrase.length > 0 ? passphrase : undefined,
      );
      onCreated({
        ...createdInfo!,
        metadata: updatedMeta,
      });
    } catch (err) {
      setPassphraseError(err instanceof Error ? err.message : 'Failed to save passphrase');
      setBusy(false);
    }
  };

  const handleSkipPassphrase = async () => {
    setBusy(true);
    try {
      const updatedMeta = await ipc.project.setPassphrase(
        createdInfo!.folderPath,
        undefined, // use default built-in passphrase
      );
      onCreated({
        ...createdInfo!,
        metadata: updatedMeta,
      });
    } catch (err) {
      setPassphraseError(err instanceof Error ? err.message : 'Failed to continue');
      setBusy(false);
    }
  };

  if (phase === 'passphrase') {
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
          aria-label="Set project passphrase"
          onMouseDown={(e) => e.stopPropagation()}
          onSubmit={handlePassphraseSubmit}
        >
          <header className="password-dialog-header">
            <div>
              <h2 className="password-dialog-title">Project passphrase</h2>
              <p className="password-dialog-subtitle muted small">
                Encrypt database passwords for this project.
                Leave empty to use a built-in default key.
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
            <p className="muted small" style={{ marginBottom: 16 }}>
              If you set a custom passphrase, you&apos;ll be asked to enter it each time
              you open this project. If you leave it empty, a built-in default key
              will be used — passwords are still encrypted but can be read if someone
              gains access to your project files.
            </p>

            <label className="password-dialog-field">
              <span className="password-dialog-label">Passphrase</span>
              <input
                type="password"
                className="password-dialog-input"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Optional — leave empty for default key"
                autoComplete="new-password"
              />
            </label>

            <label className="password-dialog-field" style={{ marginTop: 12 }}>
              <span className="password-dialog-label">Confirm passphrase</span>
              <input
                type="password"
                className="password-dialog-input"
                value={passphraseConfirm}
                onChange={(e) => setPassphraseConfirm(e.target.value)}
                placeholder="Repeat passphrase"
                autoComplete="new-password"
              />
            </label>

            {passphraseError && (
              <div className="password-dialog-error small" style={{ marginTop: 8 }}>
                {passphraseError}
              </div>
            )}
          </div>

          <footer className="password-dialog-footer">
            <button
              type="button"
              onClick={handleSkipPassphrase}
              disabled={busy}
              style={{ marginRight: 'auto' }}
            >
              Skip (use default key)
            </button>
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || (passphrase.length > 0 && passphrase !== passphraseConfirm)}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </form>
      </div>
    );
  }

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