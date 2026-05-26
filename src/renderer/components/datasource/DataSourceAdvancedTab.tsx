import { useMemo, useState } from 'react';

import type {
  DatasourceAdvanced,
  DatasourceConfig,
} from '~shared/types/datasource.js';
import {
  listDriverProperties,
  type DriverPropertyMeta,
} from '~shared/types/datasource-properties.js';

interface AdvancedTabProps {
  draft: DatasourceConfig;
  onChange(patch: Partial<DatasourceConfig>): void;
}

/** Phase-6 Advanced tab. Driver-specific properties shown in a
 * Name/Value grid plus a description panel for the focused row.
 * The set is curated per driver (see `datasource-properties.ts`);
 * properties the user hasn't set are rendered with a muted "default"
 * value placeholder. */
export function DataSourceAdvancedTab({
  draft,
  onChange,
}: AdvancedTabProps): JSX.Element {
  const props = useMemo(() => listDriverProperties(draft.driver), [draft.driver]);
  const advanced: DatasourceAdvanced = draft.advanced ?? {};
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => props[0]?.key ?? null,
  );
  const focused = props.find((p) => p.key === selectedKey) ?? null;

  const setProperty = (key: string, rawValue: string) => {
    const meta = props.find((p) => p.key === key);
    if (!meta) return;
    const next = { ...advanced };
    // Empty input wipes the property so the driver picks its own
    // default instead of receiving the empty string / NaN.
    if (rawValue.length === 0) {
      delete next[key];
    } else if (meta.type === 'number') {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) return;
      next[key] = n;
    } else if (meta.type === 'boolean') {
      next[key] = rawValue === 'true';
    } else {
      next[key] = rawValue;
    }
    onChange({ advanced: next });
  };

  const clearProperty = (key: string) => {
    if (!(key in advanced)) return;
    const next = { ...advanced };
    delete next[key];
    onChange({ advanced: next });
  };

  return (
    <div className="ds-form ds-form-advanced">
      <div className="ds-advanced-grid" role="grid">
        <div className="ds-advanced-grid-header" role="row">
          <div role="columnheader" className="ds-advanced-cell-name">
            Name
          </div>
          <div role="columnheader" className="ds-advanced-cell-value">
            Value
          </div>
        </div>
        <div className="ds-advanced-grid-body">
          {props.map((meta) => (
            <PropertyRow
              key={meta.key}
              meta={meta}
              currentValue={advanced[meta.key]}
              selected={meta.key === selectedKey}
              onSelect={() => setSelectedKey(meta.key)}
              onChange={(v) => setProperty(meta.key, v)}
              onClear={() => clearProperty(meta.key)}
            />
          ))}
        </div>
      </div>

      <div className="ds-advanced-description">
        <div className="ds-advanced-description-title small muted">
          Property description
        </div>
        {focused ? (
          <p className="ds-advanced-description-body small">
            {focused.description}
            {focused.unit && (
              <>
                {' '}
                <span className="muted">Unit: {focused.unit}.</span>
              </>
            )}
          </p>
        ) : (
          <p className="ds-advanced-description-body small muted">
            Select a property above to read its description.
          </p>
        )}
      </div>
    </div>
  );
}

/* --- atoms ------------------------------------------------------------- */

function PropertyRow({
  meta,
  currentValue,
  selected,
  onSelect,
  onChange,
  onClear,
}: {
  meta: DriverPropertyMeta;
  currentValue: string | number | boolean | undefined;
  selected: boolean;
  onSelect(): void;
  onChange(value: string): void;
  onClear(): void;
}): JSX.Element {
  const hasValue = currentValue !== undefined;

  let valueCell: React.ReactNode;
  if (meta.type === 'boolean') {
    valueCell = (
      <select
        className="ds-advanced-input"
        value={
          currentValue === undefined ? '' : currentValue === true ? 'true' : 'false'
        }
        onChange={(e) => {
          if (e.target.value === '') onClear();
          else onChange(e.target.value);
        }}
        onFocus={onSelect}
      >
        <option value="">— (default)</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  } else if (meta.type === 'number') {
    valueCell = (
      <input
        type="number"
        className="ds-advanced-input"
        value={currentValue !== undefined ? String(currentValue) : ''}
        placeholder="(default)"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onSelect}
      />
    );
  } else {
    valueCell = (
      <input
        type="text"
        className="ds-advanced-input"
        value={currentValue !== undefined ? String(currentValue) : ''}
        placeholder="(default)"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onSelect}
        spellCheck={false}
      />
    );
  }

  return (
    <div
      className={
        'ds-advanced-row' + (selected ? ' ds-advanced-row-selected' : '')
      }
      role="row"
      onClick={onSelect}
    >
      <div
        className={`ds-advanced-cell-name${hasValue ? ' ds-advanced-cell-name-set' : ''}`}
        role="gridcell"
      >
        {meta.key}
        {meta.unit && hasValue && (
          <span className="ds-advanced-cell-unit muted small"> ({meta.unit})</span>
        )}
      </div>
      <div className="ds-advanced-cell-value" role="gridcell">
        {valueCell}
      </div>
    </div>
  );
}
