import type {
  DatasourceConfig,
  DatasourceOptions,
} from '~shared/types/datasource.js';

interface OptionsTabProps {
  draft: DatasourceConfig;
  onChange(patch: Partial<DatasourceConfig>): void;
}

/** Options tab — runtime knobs that affect either the live pool
 * (timezone, single-session, keep-alive, auto-disconnect, startup
 * script) or future query / introspection behaviour (read-only,
 * transaction control, switch-schema, auto-sync, level). Stored under
 * `config.options`; missing keys mean "use default". */
export function DataSourceOptionsTab({
  draft,
  onChange,
}: OptionsTabProps): JSX.Element {
  const opts: DatasourceOptions = draft.options ?? {};
  const set = (patch: Partial<DatasourceOptions>) => {
    onChange({ options: { ...opts, ...patch } });
  };

  return (
    <div className="ds-form ds-form-options">
      <Section title="Connection">
        <CheckboxRow
          label="Read-only"
          checked={opts.readOnly === true}
          onChange={(v) => set({ readOnly: v })}
        />

        <SelectRow
          label="Transaction control"
          value={opts.transactionControl ?? 'auto'}
          onChange={(v) =>
            set({ transactionControl: v as DatasourceOptions['transactionControl'] })
          }
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'manual', label: 'Manual' },
          ]}
        />

        <SelectRow
          label="Switch schema"
          value={opts.switchSchema ?? 'manual'}
          onChange={(v) =>
            set({ switchSchema: v as DatasourceOptions['switchSchema'] })
          }
          options={[
            { value: 'manual', label: 'Manual' },
            { value: 'automatic', label: 'Automatic' },
          ]}
        />

        <FormRow label="Time zone">
          <input
            type="text"
            className="ds-form-input"
            value={opts.timezone ?? ''}
            onChange={(e) => set({ timezone: e.target.value || undefined })}
            placeholder="e.g. UTC, America/Mexico_City"
            spellCheck={false}
            autoComplete="off"
          />
        </FormRow>

        <CheckboxRow
          label="Single session mode"
          hint="Pool is capped at 1 connection — useful for temp tables and session variables."
          checked={opts.singleSession === true}
          onChange={(v) => set({ singleSession: v })}
        />

        <CheckboxWithInputRow
          label="Run keep-alive query each"
          suffix="sec"
          checked={(opts.keepAliveSeconds ?? 0) > 0}
          value={opts.keepAliveSeconds ?? 60}
          onCheckedChange={(checked) =>
            set({ keepAliveSeconds: checked ? opts.keepAliveSeconds ?? 60 : 0 })
          }
          onValueChange={(n) => set({ keepAliveSeconds: n })}
        />

        <CheckboxWithInputRow
          label="Auto-disconnect after"
          suffix="sec"
          checked={(opts.autoDisconnectSeconds ?? 0) > 0}
          value={opts.autoDisconnectSeconds ?? 300}
          onCheckedChange={(checked) =>
            set({
              autoDisconnectSeconds: checked
                ? opts.autoDisconnectSeconds ?? 300
                : 0,
            })
          }
          onValueChange={(n) => set({ autoDisconnectSeconds: n })}
        />

        <CheckboxRow
          label="Single database mode"
          hint="Restrict the schema browser to the database in the General tab."
          checked={opts.singleDatabase === true}
          onChange={(v) => set({ singleDatabase: v })}
        />

        <FormRow label="Startup script">
          <textarea
            className="ds-form-input ds-form-textarea"
            value={opts.startupScript ?? ''}
            onChange={(e) => set({ startupScript: e.target.value || undefined })}
            placeholder="SQL run once after each connect. Use ; to separate statements."
            spellCheck={false}
            rows={3}
          />
        </FormRow>
      </Section>

      <Section title="Introspection">
        <CheckboxRow
          label="Auto sync"
          hint="Refresh cached metadata on connect."
          checked={opts.autoSync !== false}
          onChange={(v) => set({ autoSync: v })}
        />
        <SelectRow
          label="Default level"
          value={opts.introspectionLevel ?? 'auto'}
          onChange={(v) =>
            set({
              introspectionLevel: v as DatasourceOptions['introspectionLevel'],
            })
          }
          options={[
            { value: 'auto', label: 'Auto select' },
            { value: 'tables', label: 'Tables' },
            { value: 'columns', label: 'Tables + columns' },
            { value: 'all', label: 'All' },
          ]}
        />
      </Section>
    </div>
  );
}

/* --- atoms ------------------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="ds-form-section">
      <h3 className="ds-form-section-title">{title}</h3>
      <div className="ds-form-section-body">{children}</div>
    </section>
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

function CheckboxWithInputRow({
  label,
  suffix,
  checked,
  value,
  onCheckedChange,
  onValueChange,
}: {
  label: string;
  suffix: string;
  checked: boolean;
  value: number;
  onCheckedChange(checked: boolean): void;
  onValueChange(value: number): void;
}): JSX.Element {
  return (
    <label className="ds-form-checkbox-row">
      <span className="ds-form-label" aria-hidden />
      <span className="ds-form-checkbox-control ds-form-checkbox-control-inline">
        <input
          type="checkbox"
          className="ds-form-checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        <span className="ds-form-checkbox-label">{label}</span>
        <input
          type="number"
          className="ds-form-input ds-form-input-narrow"
          value={value}
          min={1}
          disabled={!checked}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n > 0) onValueChange(n);
          }}
        />
        <span className="ds-form-hint muted small">{suffix}</span>
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
