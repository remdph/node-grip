import type { DatasourceConfig } from '~shared/types/datasource.js';
import { DriverIcon } from './DriverIcon.js';

interface DataSourceListProps {
  datasources: DatasourceConfig[];
  selectedId: string | null;
  /** Set when the currently displayed entry hasn't been persisted yet
   * (the user clicked `+` and is editing a fresh draft). Surfaces in
   * the list as an italicised pending row at the bottom. */
  draftPlaceholder?: { name: string; driver: DatasourceConfig['driver'] } | null;
  /** True iff a `−` press is allowed for the current selection. */
  canRemove: boolean;
  onSelect(id: string): void;
  onAdd(triggerEl: HTMLButtonElement): void;
  onRemove(): void;
}

/** Left panel of the dialog. Toolbar with `+ −` actions + a scrollable
 * list. Future actions (duplicate, settings, export) get a slot here
 * in the toolbar but are inert until Phase 8. */
export function DataSourceList({
  datasources,
  selectedId,
  draftPlaceholder,
  canRemove,
  onSelect,
  onAdd,
  onRemove,
}: DataSourceListProps): JSX.Element {
  return (
    <div className="ds-list" aria-label="Project Data Sources">
      <div className="ds-list-toolbar">
        <button
          type="button"
          className="ds-list-toolbar-btn"
          aria-label="Add data source"
          title="Add data source"
          onClick={(e) => onAdd(e.currentTarget)}
        >
          <IconPlus />
        </button>
        <button
          type="button"
          className="ds-list-toolbar-btn"
          aria-label="Remove selected"
          title="Remove selected"
          disabled={!canRemove}
          onClick={onRemove}
        >
          <IconMinus />
        </button>
        <span className="ds-list-toolbar-spacer" />
        <button
          type="button"
          className="ds-list-toolbar-btn"
          aria-label="Duplicate (coming soon)"
          title="Duplicate (coming soon)"
          disabled
        >
          <IconDuplicate />
        </button>
        <button
          type="button"
          className="ds-list-toolbar-btn"
          aria-label="Driver properties (coming soon)"
          title="Driver properties (coming soon)"
          disabled
        >
          <IconGear />
        </button>
      </div>
      <h3 className="ds-list-heading">Project Data Sources</h3>
      <ul className="ds-list-items">
        {datasources.map((ds) => (
          <li key={ds.id}>
            <button
              type="button"
              className={`ds-list-item${ds.id === selectedId ? ' ds-list-item-active' : ''}`}
              onClick={() => onSelect(ds.id)}
            >
              <span className="ds-list-item-icon" aria-hidden>
                <DriverIcon kind={ds.driver} />
              </span>
              <span className="ds-list-item-name" title={ds.name}>
                {ds.name}
              </span>
            </button>
          </li>
        ))}
        {draftPlaceholder && (
          <li>
            <button
              type="button"
              className="ds-list-item ds-list-item-active ds-list-item-draft"
              aria-current="true"
            >
              <span className="ds-list-item-icon" aria-hidden>
                <DriverIcon kind={draftPlaceholder.driver} />
              </span>
              <span className="ds-list-item-name">
                {draftPlaceholder.name || '(unnamed)'}
              </span>
              <span className="ds-list-item-badge" aria-hidden>
                new
              </span>
            </button>
          </li>
        )}
        {datasources.length === 0 && !draftPlaceholder && (
          <li className="ds-list-empty muted small">
            No data sources yet. Click + to add one.
          </li>
        )}
      </ul>
    </div>
  );
}

function IconPlus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMinus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconDuplicate(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="3.5"
        width="7"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect
        x="6"
        y="6"
        width="7"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function IconGear(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.1.3.32.55.61.7l.05.03c.18.07.36.13.55.16H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
