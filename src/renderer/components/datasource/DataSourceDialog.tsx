import { useCallback, useEffect, useRef, useState } from 'react';

import { ipc } from '../../lib/ipc.js';
import {
  DRIVER_REGISTRY,
  driverLabel,
  type DatasourceConfig,
  type DriverKind,
  type TestConnectionResult,
} from '~shared/types/datasource.js';
import { AddDataSourceMenu } from './AddDataSourceMenu.js';
import { DataSourceAdvancedTab } from './DataSourceAdvancedTab.js';
import { DataSourceGeneralTab } from './DataSourceGeneralTab.js';
import { DataSourceList } from './DataSourceList.js';
import { DataSourceOptionsTab } from './DataSourceOptionsTab.js';
import { DataSourceSchemasTab } from './DataSourceSchemasTab.js';
import { DataSourceSshSslTab } from './DataSourceSshSslTab.js';

interface DataSourceDialogProps {
  folderPath: string;
  /** Optional initial driver to open a fresh draft for. Set when the
   * user invoked the dialog via the "+" menu in the sidebar (a driver
   * was already picked); leave undefined to open the dialog with no
   * selection (user-driven flow). Ignored when `initialSelectedId` is
   * also passed — editing wins over creating. */
  initialDriver?: DriverKind;
  /** Open the dialog with a specific saved datasource selected for
   * editing. Set when the user picked "Edit…" from the sidebar
   * context menu. */
  initialSelectedId?: string;
  onClose(): void;
}

/** Mutable state for the entry being edited. Encapsulated so we can
 * reset it as a single unit when switching selection. */
interface Selection {
  draft: DatasourceConfig;
  /** True until the draft has been persisted at least once. */
  isNew: boolean;
  /** Renderer-side cleartext entry, only sent over IPC on Apply. */
  password: string;
  /** Whether the main-side vault already has a password for `draft.id`. */
  hasStoredPassword: boolean;
  /** Any unsaved changes vs. the persisted version. */
  dirty: boolean;
  /** Most recent save error surfaced inline. */
  validationError: string | null;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'done'; result: TestConnectionResult };

/** Which side-tab the editor is showing. Lives at the dialog level
 * (not per-selection) so switching between data sources preserves
 * the current section — matches JetBrains behaviour. */
type EditorTab = 'general' | 'options' | 'sshssl' | 'schemas' | 'advanced';

/** The full "Data Sources and Drivers" dialog. v0.1 only ships the
 * Data Sources section with the General tab — other top-level tabs
 * (Drivers / DDL Mappings) and side tabs (Options / SSH / Schemas /
 * Advanced) appear as visible-but-disabled placeholders so the layout
 * matches the eventual full UI without surprising users. */
export function DataSourceDialog({
  folderPath,
  initialDriver,
  initialSelectedId,
  onClose,
}: DataSourceDialogProps): JSX.Element {
  const [datasources, setDatasources] = useState<DatasourceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('general');

  // Snapshot the auto-start intent once so re-renders / refresh calls
  // can't re-fire it. Editing wins over creating when both are passed.
  const initialDriverRef = useRef(initialDriver);
  const initialSelectedIdRef = useRef(initialSelectedId);

  // Initial load AND auto-arrange in the same `.then()` so suggestName
  // sees the freshly-loaded list — without this guarantee a fresh
  // draft could collide with a saved entry that the UI hasn't
  // rendered yet.
  useEffect(() => {
    let cancelled = false;
    void ipc.datasource.list(folderPath).then((ds) => {
      if (cancelled) return;
      setDatasources(ds);
      setLoading(false);

      const selectId = initialSelectedIdRef.current;
      const driver = initialDriverRef.current;
      initialSelectedIdRef.current = undefined;
      initialDriverRef.current = undefined;

      if (selectId) {
        const cfg = ds.find((d) => d.id === selectId);
        if (cfg) {
          setSelection({
            draft: { ...cfg },
            isNew: false,
            password: '',
            hasStoredPassword: false,
            dirty: false,
            validationError: null,
          });
          setTestState({ status: 'idle' });
        }
        return;
      }
      if (driver) {
        const existingNames = ds.map((d) => d.name);
        setSelection({
          draft: buildDraft(driver, existingNames),
          isNew: true,
          password: '',
          hasStoredPassword: false,
          dirty: true,
          validationError: null,
        });
        setTestState({ status: 'idle' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  // Subsequent "+" presses from inside the dialog — uses the latest
  // committed datasources state for the suggested name.
  const startNew = useCallback(
    (driver: DriverKind) => {
      setAddMenuAnchor(null);
      setDatasources((ds) => {
        const existingNames = ds.map((d) => d.name);
        setSelection({
          draft: buildDraft(driver, existingNames),
          isNew: true,
          password: '',
          hasStoredPassword: false,
          dirty: true,
          validationError: null,
        });
        setTestState({ status: 'idle' });
        return ds;
      });
    },
    [],
  );

  // Esc closes; bind once and read latest selection via the dirty
  // guard so the listener stays stable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't swallow Esc when a select/input handles its own
        // dropdown; bail if focus is inside one and the dropdown is
        // open. Cheap heuristic: only close when the active element
        // isn't an editable field with text in it.
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // When selection changes to an existing entry, ask the vault whether
  // a password is already stored so the field can show a "saved" hint.
  useEffect(() => {
    if (!selection || selection.isNew) return;
    const targetId = selection.draft.id;
    let cancelled = false;
    void ipc.datasource.hasPassword(folderPath, targetId).then((has) => {
      if (cancelled) return;
      setSelection((s) =>
        s && s.draft.id === targetId ? { ...s, hasStoredPassword: has } : s,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [folderPath, selection?.draft.id, selection?.isNew]);

  /** Switch to a previously saved datasource. */
  const selectExisting = (id: string) => {
    if (selection?.dirty) {
      const proceed = window.confirm(
        'Discard unsaved changes to the current data source?',
      );
      if (!proceed) return;
    }
    const cfg = datasources.find((d) => d.id === id);
    if (!cfg) return;
    setSelection({
      draft: { ...cfg },
      isNew: false,
      password: '',
      hasStoredPassword: false,
      dirty: false,
      validationError: null,
    });
    setTestState({ status: 'idle' });
  };

  const updateDraft = (patch: Partial<DatasourceConfig>) => {
    setSelection((s) =>
      s
        ? {
            ...s,
            draft: { ...s.draft, ...patch },
            dirty: true,
            validationError: null,
          }
        : s,
    );
    setTestState({ status: 'idle' });
  };

  const updatePassword = (password: string) => {
    setSelection((s) => (s ? { ...s, password, dirty: true } : s));
    setTestState({ status: 'idle' });
  };

  const removeSelected = async () => {
    if (!selection) return;
    if (selection.isNew) {
      // Drafts are removed by simply dropping the selection.
      setSelection(null);
      setTestState({ status: 'idle' });
      return;
    }
    const proceed = window.confirm(`Remove data source "${selection.draft.name}"?`);
    if (!proceed) return;
    try {
      await ipc.datasource.remove(folderPath, selection.draft.id);
      setDatasources((ds) => ds.filter((d) => d.id !== selection.draft.id));
      setSelection(null);
      setTestState({ status: 'idle' });
    } catch (err) {
      setSelection((s) =>
        s
          ? {
              ...s,
              validationError:
                err instanceof Error ? err.message : 'Failed to remove',
            }
          : s,
      );
    }
  };

  const test = async () => {
    if (!selection) return;
    setTestState({ status: 'testing' });
    try {
      const result = await ipc.datasource.testConnect(
        folderPath,
        selection.draft,
        selection.password || undefined,
      );
      setTestState({ status: 'done', result });
    } catch (err) {
      setTestState({
        status: 'done',
        result: {
          ok: false,
          error: err instanceof Error ? err.message : 'Test failed',
        },
      });
    }
  };

  /** Persist the current draft. Returns the saved config (or null on
   * failure so the OK path can decide whether to close). */
  const apply = async (): Promise<DatasourceConfig | null> => {
    if (!selection) return null;
    setSaving(true);
    try {
      const saved = await ipc.datasource.save(folderPath, selection.draft);
      // Persist (or clear) the password according to the chosen mode.
      // We only touch the vault when the user typed something OR when
      // they explicitly chose "Never" with a previous saved password.
      if (selection.password) {
        await ipc.datasource.setPassword(
          folderPath,
          saved.id,
          selection.password,
          saved.passwordMode,
        );
      } else if (
        saved.passwordMode === 'never' &&
        selection.hasStoredPassword
      ) {
        await ipc.datasource.clearPassword(folderPath, saved.id);
      }

      setDatasources((ds) => {
        const exists = ds.some((d) => d.id === saved.id);
        return exists
          ? ds.map((d) => (d.id === saved.id ? saved : d))
          : [...ds, saved];
      });
      setSelection({
        draft: saved,
        isNew: false,
        password: '',
        hasStoredPassword:
          selection.password.length > 0
            ? saved.passwordMode !== 'never'
            : selection.hasStoredPassword && saved.passwordMode !== 'never',
        dirty: false,
        validationError: null,
      });
      setTestState({ status: 'idle' });
      return saved;
    } catch (err) {
      setSelection((s) =>
        s
          ? {
              ...s,
              validationError: err instanceof Error ? err.message : 'Save failed',
            }
          : s,
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Real-time validation of the draft against the loaded list. Runs
  // client-side so the user gets feedback as they type instead of
  // only after a save round-trip.
  const nameError = selection ? computeNameError(selection, datasources) : null;
  const canSave = !!selection && selection.dirty && !nameError && !saving;

  return (
    <div
      className="ds-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ds-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Data Sources"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ds-dialog-body">
          <DataSourceList
            datasources={datasources}
            selectedId={selection && !selection.isNew ? selection.draft.id : null}
            draftPlaceholder={
              selection && selection.isNew
                ? { name: selection.draft.name, driver: selection.draft.driver }
                : null
            }
            canRemove={!!selection}
            onSelect={selectExisting}
            onAdd={(el) => setAddMenuAnchor(el)}
            onRemove={removeSelected}
          />

          <div className="ds-dialog-right">
            {!selection ? (
              loading ? (
                <div className="ds-empty muted">Loading…</div>
              ) : (
                <div className="ds-empty">
                  <p className="ds-empty-title">No data source selected</p>
                  <p className="ds-empty-hint muted small">
                    Pick one from the list or click <strong>+</strong> to add a new
                    PostgreSQL, MySQL or MariaDB connection.
                  </p>
                </div>
              )
            ) : (
              <Editor
                selection={selection}
                nameError={nameError}
                activeTab={activeTab}
                onChange={updateDraft}
                onPasswordChange={updatePassword}
                onTabChange={setActiveTab}
              />
            )}
          </div>
        </div>

        <div className="ds-dialog-footer">
          <div className="ds-dialog-footer-left">
            <button
              type="button"
              className="ds-dialog-link"
              onClick={test}
              disabled={!selection || testState.status === 'testing'}
            >
              {testState.status === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
            {selection && (
              <span className="ds-dialog-footer-driver muted small">
                {driverLabel(selection.draft.driver)}
              </span>
            )}
            {testState.status === 'done' && (
              <TestBanner result={testState.result} />
            )}
          </div>
          <div className="ds-dialog-footer-right">
            <button
              type="button"
              className="ds-dialog-btn"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ds-dialog-btn ds-dialog-btn-primary"
              onClick={apply}
              disabled={!canSave}
            >
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>

        {addMenuAnchor && (
          <AddDataSourceMenu
            anchor={addMenuAnchor}
            onPick={(kind) => startNew(kind)}
            onClose={() => setAddMenuAnchor(null)}
          />
        )}
      </div>
    </div>
  );
}

/* --- editor surface ----------------------------------------------------- */

function Editor({
  selection,
  nameError,
  activeTab,
  onChange,
  onPasswordChange,
  onTabChange,
}: {
  selection: Selection;
  nameError: string | null;
  activeTab: EditorTab;
  onChange(patch: Partial<DatasourceConfig>): void;
  onPasswordChange(value: string): void;
  onTabChange(tab: EditorTab): void;
}): JSX.Element {
  return (
    <div className="ds-editor">
      <div className="ds-editor-head">
        <label className="ds-editor-row">
          <span className="ds-editor-label">Name:</span>
          <input
            type="text"
            className={`ds-editor-input${nameError ? ' ds-editor-input-invalid' : ''}`}
            value={selection.draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!nameError}
          />
        </label>
        {nameError && (
          <div className="ds-editor-row ds-editor-row-error">
            <span className="ds-editor-label" aria-hidden />
            <span className="ds-editor-field-error small">{nameError}</span>
          </div>
        )}
        <label className="ds-editor-row">
          <span className="ds-editor-label">Comment:</span>
          <input
            type="text"
            className="ds-editor-input"
            value={selection.draft.comment ?? ''}
            onChange={(e) => onChange({ comment: e.target.value })}
            spellCheck
          />
        </label>
        <nav className="ds-editor-side-tabs" aria-label="Editor sections">
          <TabButton
            label="General"
            active={activeTab === 'general'}
            onClick={() => onTabChange('general')}
          />
          <TabButton
            label="Options"
            active={activeTab === 'options'}
            onClick={() => onTabChange('options')}
          />
          <TabButton
            label="SSH/SSL"
            active={activeTab === 'sshssl'}
            onClick={() => onTabChange('sshssl')}
          />
          <TabButton
            label="Schemas"
            active={activeTab === 'schemas'}
            onClick={() => onTabChange('schemas')}
          />
          <TabButton
            label="Advanced"
            active={activeTab === 'advanced'}
            onClick={() => onTabChange('advanced')}
          />
        </nav>
      </div>

      <div className="ds-editor-body">
        {activeTab === 'general' && (
          <DataSourceGeneralTab
            draft={selection.draft}
            password={selection.password}
            hasStoredPassword={selection.hasStoredPassword}
            onChange={onChange}
            onPasswordChange={onPasswordChange}
          />
        )}
        {activeTab === 'options' && (
          <DataSourceOptionsTab draft={selection.draft} onChange={onChange} />
        )}
        {activeTab === 'sshssl' && (
          <DataSourceSshSslTab draft={selection.draft} onChange={onChange} />
        )}
        {activeTab === 'schemas' && (
          <DataSourceSchemasTab draft={selection.draft} onChange={onChange} />
        )}
        {activeTab === 'advanced' && (
          <DataSourceAdvancedTab draft={selection.draft} onChange={onChange} />
        )}
        {selection.validationError && (
          <div className="ds-editor-error">{selection.validationError}</div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?(): void;
}): JSX.Element {
  if (disabled) {
    return (
      <span
        className="ds-editor-side-tab ds-editor-side-tab-disabled"
        title={title}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`ds-editor-side-tab${active ? ' ds-editor-side-tab-active' : ''}`}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      {label}
    </button>
  );
}

function TestBanner({ result }: { result: TestConnectionResult }): JSX.Element {
  if (result.ok) {
    return (
      <span className="ds-test-banner ds-test-banner-ok small">
        ✓ Connected{result.latencyMs != null ? ` · ${result.latencyMs}ms` : ''}
        {result.serverVersion ? ` · ${truncate(result.serverVersion, 60)}` : ''}
      </span>
    );
  }
  return (
    <span className="ds-test-banner ds-test-banner-err small" title={result.error}>
      ✗ {truncate(result.error ?? 'Connection failed', 90)}
    </span>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* --- helpers ----------------------------------------------------------- */

function buildDraft(
  driver: DriverKind,
  existingNames: string[],
): DatasourceConfig {
  const desc = DRIVER_REGISTRY[driver];
  return {
    // `save` assigns the real id on first persist; an empty string
    // here is the "new" marker.
    id: '',
    name: suggestName(driver, existingNames),
    driver,
    host: 'localhost',
    port: desc.defaultPort,
    user: desc.defaultUser,
    database: driver === 'postgres' ? 'postgres' : '',
    passwordMode: 'forever',
    createdAt: '',
    updatedAt: '',
  };
}

function suggestName(driver: DriverKind, existing: string[]): string {
  const desc = DRIVER_REGISTRY[driver];
  const base = `${desc.defaultUser}@localhost`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} [${n}]`)) n++;
  return `${base} [${n}]`;
}

/** Mirror of the unique-name check in `main/datasources/storage.ts`,
 * run client-side so the user sees the conflict before clicking save.
 * Returns `null` when the name is valid, or a human message when it
 * isn't. The comparison is case-insensitive to match storage. */
function computeNameError(
  selection: Selection,
  datasources: DatasourceConfig[],
): string | null {
  const name = selection.draft.name.trim();
  if (name.length === 0) {
    return 'Name is required.';
  }
  const collision = datasources.find(
    (d) =>
      d.id !== selection.draft.id &&
      d.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
  );
  if (collision) {
    return 'This name is already used by another data source.';
  }
  return null;
}
