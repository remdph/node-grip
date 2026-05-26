import {
  buildDsn,
  type DatasourceConfig,
  type PasswordSaveMode,
} from '~shared/types/datasource.js';

interface GeneralTabProps {
  draft: DatasourceConfig;
  password: string;
  /** True when the vault already holds a password — surfaces a "saved"
   * hint next to the field so the user knows leaving it blank is OK. */
  hasStoredPassword: boolean;
  onChange(patch: Partial<DatasourceConfig>): void;
  onPasswordChange(password: string): void;
}

const PASSWORD_MODES: Array<{ value: PasswordSaveMode; label: string }> = [
  { value: 'forever', label: 'Forever' },
  { value: 'session', label: 'Until restart' },
  { value: 'never', label: 'Never' },
];

/** General-tab form. Mirrors the JetBrains layout: header line with
 * connection-type + driver labels, then a stacked field grid. The
 * "URL" preview is computed from the structured fields via
 * `buildDsn`; manually editing it is intentionally left for a later
 * iteration (the "Overrides settings above" toggle in the original). */
export function DataSourceGeneralTab({
  draft,
  password,
  hasStoredPassword,
  onChange,
  onPasswordChange,
}: GeneralTabProps): JSX.Element {
  const url = buildDsn(draft);

  return (
    <div className="ds-form">
      <FormRow label="Host">
        <input
          type="text"
          className="ds-form-input"
          value={draft.host}
          onChange={(e) => onChange({ host: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
        <FormSidebar label="Port">
          <input
            type="number"
            className="ds-form-input ds-form-input-port"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange({ port: n });
            }}
          />
        </FormSidebar>
      </FormRow>

      <FormRow label="Authentication">
        <select className="ds-form-input ds-form-select" disabled value="user_password">
          <option value="user_password">User &amp; Password</option>
        </select>
      </FormRow>

      <FormRow label="User">
        <input
          type="text"
          className="ds-form-input"
          value={draft.user}
          onChange={(e) => onChange({ user: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </FormRow>

      <FormRow label="Password">
        <input
          type="password"
          className="ds-form-input"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={hasStoredPassword ? '••••••• (saved — leave empty to keep)' : ''}
          autoComplete="new-password"
        />
        <FormSidebar label="Save">
          <select
            className="ds-form-input ds-form-select"
            value={draft.passwordMode}
            onChange={(e) =>
              onChange({ passwordMode: e.target.value as PasswordSaveMode })
            }
          >
            {PASSWORD_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </FormSidebar>
      </FormRow>

      <FormRow label="Database">
        <input
          type="text"
          className="ds-form-input"
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </FormRow>

      <FormRow label="URL">
        <input
          type="text"
          className="ds-form-input ds-form-input-readonly"
          value={url}
          readOnly
          spellCheck={false}
        />
      </FormRow>
      <div className="ds-form-url-hint muted small">
        Derived from the fields above.
      </div>
    </div>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="ds-form-row">
      <span className="ds-form-label">{label}:</span>
      <span className="ds-form-control">{children}</span>
    </label>
  );
}

function FormSidebar({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span className="ds-form-sidebar">
      <span className="ds-form-sidebar-label">{label}:</span>
      {children}
    </span>
  );
}
