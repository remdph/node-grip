import { useEffect, useRef, useState } from 'react';

import type { DatasourceConfig } from '~shared/types/datasource.js';

interface ConnectPasswordPromptProps {
  config: DatasourceConfig;
  /** Pre-filled rationale shown above the input. The `'wrong'` case
   * is used after a successful auth-error → reprompt path. */
  reason: 'missing' | 'wrong';
  /** Renderer holds the password in a local string; we never bounce
   * it back through the parent. Submit hands the value to the
   * connect-orchestrator. */
  onSubmit(password: string): void;
  onCancel(): void;
}

/** Modal prompt asked just-in-time when Connect needs a credential the
 * vault can't supply (password mode = 'never', or a stored password
 * was wiped). Single password field + Connect / Cancel. The dialog
 * stays open until the parent dismisses — useful so a slow connect
 * attempt can keep the dialog visible with a "Connecting…" label. */
export function ConnectPasswordPrompt({
  config,
  reason,
  onSubmit,
  onCancel,
}: ConnectPasswordPromptProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const subtitle =
    reason === 'wrong'
      ? `Password rejected by ${config.host}:${config.port}. Try again.`
      : `${config.user}@${config.host}:${config.port}` +
        (config.database ? `/${config.database}` : '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onSubmit(password);
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
        className="password-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Connect to ${config.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="password-dialog-header">
          <div>
            <h2 className="password-dialog-title">Connect — {config.name}</h2>
            <p
              className={
                'password-dialog-subtitle small ' +
                (reason === 'wrong' ? 'password-dialog-subtitle-error' : 'muted')
              }
              title={subtitle}
            >
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            className="password-dialog-close"
            onClick={onCancel}
            aria-label="Close"
            disabled={busy}
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
            <span className="password-dialog-label">Password</span>
            <input
              ref={inputRef}
              type="password"
              className="password-dialog-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>
        </div>

        <footer className="password-dialog-footer">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </footer>
      </form>
    </div>
  );
}
