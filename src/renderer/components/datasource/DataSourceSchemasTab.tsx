import type {
  DatasourceConfig,
  DatasourceOptions,
  DatasourceScope,
  DatasourceScopeNode,
} from '~shared/types/datasource.js';

interface SchemasTabProps {
  draft: DatasourceConfig;
  onChange(patch: Partial<DatasourceConfig>): void;
}

/** Phase-5 Schemas tab. Declarative scope tree (no live database
 * fetch yet) + regex filters + system/template toggles. The
 * per-database granularity in the JetBrains UI is collapsed to two
 * roots ("All databases" / "Default database") with sub-checkboxes
 * for the schema subset — enough surface area to be useful once the
 * schema browser lands without committing to a deep tree shape now. */
export function DataSourceSchemasTab({
  draft,
  onChange,
}: SchemasTabProps): JSX.Element {
  const opts: DatasourceOptions = draft.options ?? {};
  const isPostgres = draft.driver === 'postgres';

  const setOpts = (patch: Partial<DatasourceOptions>) => {
    onChange({ options: { ...opts, ...patch } });
  };

  const scope: DatasourceScope = opts.scope ?? {};
  const setScope = (patch: Partial<DatasourceScope>) => {
    setOpts({ scope: { ...scope, ...patch } });
  };

  const setNode = (key: keyof DatasourceScope, patch: Partial<DatasourceScopeNode>) => {
    setScope({ [key]: { ...(scope[key] ?? {}), ...patch } });
  };

  return (
    <div className="ds-form ds-form-schemas">
      <div className="ds-schemas-tree" role="tree">
        <ScopeBranch
          label="All databases"
          node={scope.allDatabases}
          onToggle={(enabled) => setNode('allDatabases', { enabled })}
          onSubToggle={(field, value) => setNode('allDatabases', { [field]: value })}
        />
        <ScopeBranch
          label="Default database"
          subLabel={draft.database || '(none)'}
          node={scope.defaultDatabase}
          onToggle={(enabled) => setNode('defaultDatabase', { enabled })}
          onSubToggle={(field, value) =>
            setNode('defaultDatabase', { [field]: value })
          }
        />
      </div>

      <FormRow label="Schema pattern">
        <input
          type="text"
          className="ds-form-input"
          value={opts.schemaPattern ?? ''}
          onChange={(e) => setOpts({ schemaPattern: e.target.value || undefined })}
          placeholder="Regex applied to schema names"
          spellCheck={false}
          autoComplete="off"
        />
      </FormRow>

      <FormRow label="Object filter">
        <input
          type="text"
          className="ds-form-input"
          value={opts.objectFilter ?? ''}
          onChange={(e) => setOpts({ objectFilter: e.target.value || undefined })}
          placeholder="Regex applied to table / view / object names"
          spellCheck={false}
          autoComplete="off"
        />
      </FormRow>

      <div className="ds-form-section-body ds-form-schemas-toggles">
        <CheckboxRow
          label="Show internal system schemas"
          checked={opts.showSystemSchemas === true}
          onChange={(v) => setOpts({ showSystemSchemas: v })}
        />
        {isPostgres && (
          <CheckboxRow
            label="Show template databases"
            checked={opts.showTemplateDatabases === true}
            onChange={(v) => setOpts({ showTemplateDatabases: v })}
          />
        )}
      </div>
    </div>
  );
}

/* --- atoms ------------------------------------------------------------- */

function ScopeBranch({
  label,
  subLabel,
  node,
  onToggle,
  onSubToggle,
}: {
  label: string;
  subLabel?: string;
  node: DatasourceScopeNode | undefined;
  onToggle(enabled: boolean): void;
  onSubToggle(field: 'allSchemas' | 'defaultSchema', value: boolean): void;
}): JSX.Element {
  const enabled = node?.enabled === true;
  return (
    <div
      className={`ds-schemas-branch${enabled ? ' ds-schemas-branch-on' : ''}`}
      role="treeitem"
    >
      <label className="ds-schemas-branch-row">
        <input
          type="checkbox"
          className="ds-form-checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="ds-schemas-branch-label">{label}</span>
        {subLabel && (
          <span className="ds-schemas-branch-sublabel muted small">
            {subLabel}
          </span>
        )}
      </label>
      <div className="ds-schemas-branch-children" aria-hidden={!enabled}>
        <label className="ds-schemas-leaf">
          <input
            type="checkbox"
            className="ds-form-checkbox"
            checked={node?.allSchemas === true}
            disabled={!enabled}
            onChange={(e) => onSubToggle('allSchemas', e.target.checked)}
          />
          <span>All schemas</span>
        </label>
        <label className="ds-schemas-leaf">
          <input
            type="checkbox"
            className="ds-form-checkbox"
            checked={node?.defaultSchema === true}
            disabled={!enabled}
            onChange={(e) => onSubToggle('defaultSchema', e.target.checked)}
          />
          <span>Default schema</span>
        </label>
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

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
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
      </span>
    </label>
  );
}
