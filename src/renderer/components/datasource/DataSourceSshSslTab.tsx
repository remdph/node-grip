import type {
  DatasourceConfig,
  DatasourceSsh,
  DatasourceSsl,
  SslMode,
} from '~shared/types/datasource.js';

interface SshSslTabProps {
  draft: DatasourceConfig;
  onChange(patch: Partial<DatasourceConfig>): void;
}

/** Phase-7 SSH/SSL tab. Two independent sections so the user can
 * enable either without the other. v0.1 limits SSH auth to private
 * keys (no password / passphrase) — the prompt+vault plumbing for
 * extra credentials lands when we generalise the vault. */
export function DataSourceSshSslTab({
  draft,
  onChange,
}: SshSslTabProps): JSX.Element {
  const ssh = draft.ssh;
  const ssl = draft.ssl ?? { mode: 'disable' as SslMode };

  const setSsh = (patch: Partial<DatasourceSsh>) => {
    onChange({
      ssh: {
        // Defaults so the first toggle yields a usable shape.
        host: ssh?.host ?? '',
        port: ssh?.port ?? 22,
        user: ssh?.user ?? '',
        ...ssh,
        ...patch,
      },
    });
  };
  const setSsl = (patch: Partial<DatasourceSsl>) => {
    onChange({ ssl: { ...ssl, ...patch } });
  };

  return (
    <div className="ds-form ds-form-sshssl">
      <section className="ds-form-section">
        <h3 className="ds-form-section-title">SSH tunnel</h3>
        <div className="ds-form-section-body">
          <CheckboxRow
            label="Use SSH tunnel"
            hint="Connect through a jump host. The database driver targets a local port forwarded over the tunnel."
            checked={ssh?.enabled === true}
            onChange={(v) => setSsh({ enabled: v })}
          />

          <FormRow label="Host">
            <input
              type="text"
              className="ds-form-input"
              value={ssh?.host ?? ''}
              onChange={(e) => setSsh({ host: e.target.value })}
              disabled={ssh?.enabled !== true}
              spellCheck={false}
              autoComplete="off"
            />
            <FormSidebar label="Port">
              <input
                type="number"
                className="ds-form-input ds-form-input-port"
                value={ssh?.port ?? 22}
                min={1}
                max={65535}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setSsh({ port: n });
                }}
                disabled={ssh?.enabled !== true}
              />
            </FormSidebar>
          </FormRow>

          <FormRow label="User">
            <input
              type="text"
              className="ds-form-input"
              value={ssh?.user ?? ''}
              onChange={(e) => setSsh({ user: e.target.value })}
              disabled={ssh?.enabled !== true}
              spellCheck={false}
              autoComplete="off"
            />
          </FormRow>

          <FormRow label="Private key">
            <input
              type="text"
              className="ds-form-input"
              value={ssh?.privateKeyPath ?? ''}
              onChange={(e) => setSsh({ privateKeyPath: e.target.value || undefined })}
              placeholder="~/.ssh/id_ed25519"
              disabled={ssh?.enabled !== true}
              spellCheck={false}
              autoComplete="off"
            />
          </FormRow>

          <p className="ds-form-hint muted small ds-form-hint-block">
            v0.1 supports private-key auth only. For keys with a passphrase, use
            an <code>ssh-agent</code> session before launching NodeGrip; password
            auth is planned for a later release.
          </p>
        </div>
      </section>

      <section className="ds-form-section">
        <h3 className="ds-form-section-title">SSL / TLS</h3>
        <div className="ds-form-section-body">
          <SelectRow
            label="Mode"
            value={ssl.mode}
            onChange={(v) => setSsl({ mode: v as SslMode })}
            options={[
              { value: 'disable', label: 'Disable' },
              { value: 'require', label: 'Require (no verification)' },
              { value: 'verify-ca', label: 'Verify CA' },
              { value: 'verify-full', label: 'Verify CA + hostname' },
            ]}
          />

          <FormRow label="CA bundle">
            <input
              type="text"
              className="ds-form-input"
              value={ssl.caPath ?? ''}
              onChange={(e) => setSsl({ caPath: e.target.value || undefined })}
              placeholder="/etc/ssl/certs/ca.pem"
              disabled={ssl.mode === 'disable'}
              spellCheck={false}
              autoComplete="off"
            />
          </FormRow>

          <FormRow label="Client cert">
            <input
              type="text"
              className="ds-form-input"
              value={ssl.certPath ?? ''}
              onChange={(e) => setSsl({ certPath: e.target.value || undefined })}
              placeholder="(optional)"
              disabled={ssl.mode === 'disable'}
              spellCheck={false}
              autoComplete="off"
            />
          </FormRow>

          <FormRow label="Client key">
            <input
              type="text"
              className="ds-form-input"
              value={ssl.keyPath ?? ''}
              onChange={(e) => setSsl({ keyPath: e.target.value || undefined })}
              placeholder="(optional)"
              disabled={ssl.mode === 'disable'}
              spellCheck={false}
              autoComplete="off"
            />
          </FormRow>

          <p className="ds-form-hint muted small ds-form-hint-block">
            Cert / key paths are read at connect time; their contents never
            land in the project's <code>.nodegrip/</code> folder.
          </p>
        </div>
      </section>
    </div>
  );
}

/* --- atoms ------------------------------------------------------------- */

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

function CheckboxRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(value: boolean): void;
}): JSX.Element {
  return (
    <label className="ds-form-checkbox-row">
      <span className="ds-form-label" aria-hidden />
      <span className="ds-form-checkbox-control">
        <input
          type="checkbox"
          className="ds-form-checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ds-form-checkbox-label">{label}</span>
        {hint && <span className="ds-form-hint muted small">{hint}</span>}
      </span>
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <FormRow label={label}>
      <select
        className="ds-form-input ds-form-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FormRow>
  );
}
