import type {
  Certificate,
  GenerateCertInput,
  ImportCertInput,
} from './certs.js';
import type {
  ConnectionState,
  ConnectResult,
  DatasourceConfig,
  PasswordSaveMode,
  TestConnectionResult,
} from './datasource.js';
import type {
  SchemaNodePath,
  SchemaTree,
  SchemaTreeNode,
} from './schema-tree.js';
import type { FillFormInput, FillFormResult, FormInfo } from './forms.js';
import type { AppSettings } from './settings.js';
import type {
  ApplySignatureInput,
  ApplySignatureResult,
  CreateSignatureFromBytesInput,
  InspectSignaturesResult,
  Signature,
  SignDigitalInput,
  SignDigitalResult,
} from './signatures.js';
import type { ApplyStampInput, ApplyStampResult, Stamp } from './stamps.js';

export interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

export interface PrintOptions {
  /** Native printer name returned by `printer.list`. If omitted, the OS uses
   * the default printer (or fails if there isn't one). */
  deviceName?: string;
  copies?: number;
}

export interface PdfPermissions {
  /** Allow printing. */
  printing: boolean;
  /** Allow copying text + images. */
  copying: boolean;
  /** Allow modifying the document (page reorder, edit content, etc.). */
  modifying: boolean;
  /** Allow adding annotations and form fields. */
  annotating: boolean;
}

export interface ProtectInput {
  filePath: string;
  /** Required when the PDF is currently encrypted (used to decrypt). */
  currentPassword?: string;
  /** Empty / undefined removes the password (decrypts the file). */
  newPassword?: string;
  /** Only applied when newPassword is non-empty. */
  permissions?: PdfPermissions;
}

export interface HomeFolder {
  /** Display label (e.g. "Downloads"). */
  name: string;
  /** Absolute path to the folder on disk. */
  path: string;
}

/**
 * Metadata persisted under `<projectFolder>/.nodegrip/project.json`.
 * Kept intentionally tiny for v0.1 — the connection / query payload will
 * be appended as the DB client lands.
 */
export interface ProjectMetadata {
  /** Display name shown in tab titles and the recents list. Defaults to
   * the folder basename when the project is first auto-initialised. */
  name: string;
  /** ISO timestamp of the first time NodeGrip wrote metadata to this
   * folder. Used to render "Created on …" in future. */
  createdAt: string;
  /** Base64-encoded AES-256 key used to encrypt datasource passwords in
   * this project's vault. If undefined the project uses the built-in
   * default key (not for new projects — always set on creation). */
  encryptionKey?: string;
}

export interface ProjectInfo {
  /** Absolute path to the project folder on disk. */
  folderPath: string;
  metadata: ProjectMetadata;
}

/** Immediate-children listing for the Files panel tree. Lazy-loaded
 * per folder when the user expands a node. */
export interface FileEntry {
  /** Basename (e.g. "queries.sql"). */
  name: string;
  /** Absolute path on disk. */
  path: string;
  type: 'file' | 'dir';
}

/** Payload returned by `project.readFile`. Includes a flag so the
 * renderer can render a "binary, cannot display" empty state instead of
 * garbled characters when the file isn't text. */
export interface FileReadResult {
  /** Decoded UTF-8 text, or empty string when `binary` or `tooLarge`. */
  content: string;
  /** File size in bytes (always populated). */
  size: number;
  /** True when the file looked binary (NUL byte in the sniffed prefix). */
  binary: boolean;
  /** True when the file exceeded the read cap. */
  tooLarge: boolean;
}

/**
 * Lifecycle of the auto-updater, surfaced to the renderer so the
 * sidebar can show a persistent status row and the toast banner can
 * react to transitions. See src/main/updater.ts for how each platform
 * walks the machine.
 *
 *   idle      → before any check has finished (initial app load)
 *   checking  → request to GitHub / update.electronjs.org is in flight
 *   current   → confirmed: no newer release than `app.getVersion()`
 *   available → newer release exists.
 *               Win/macOS: download is already in progress in the
 *                 background; we'll transition to `ready` when done.
 *               Linux:   final state — there is nothing to download
 *                 in-app; user must update through their package manager
 *                 or the release page.
 *   ready     → Win/macOS only: bits downloaded, click → quitAndInstall.
 *   error     → most recent check failed; surfaces as a muted status.
 *   disabled  → user opted out via Settings → "Check for updates on
 *               startup". No network has been touched; the renderer
 *               shows just the current version with no "up to date"
 *               claim (which would be misleading without a check).
 */
export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'ready'
  | 'error'
  | 'disabled';

export interface UpdaterState {
  status: UpdaterStatus;
  /** Version we're running right now, included on every push so the
   * renderer can render the "Up to date · v0.3.0" label without an
   * extra IPC round-trip. */
  currentVersion: string;
  /** Latest version found on GitHub. Set when status is `available`,
   * `ready`, or `current` (in which case it equals `currentVersion`). */
  latestVersion?: string;
  /** Release page URL — used by the Linux "View release" link. */
  htmlUrl?: string;
  /** Human-readable error from the last failed check. */
  error?: string;
}

export interface IpcApi {
  /** Host OS identifier — same shape as Node's `process.platform`. */
  platform: NodeJS.Platform;
  window: {
    minimize(): Promise<void>;
    maximizeToggle(): Promise<boolean>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizeChange(handler: (maximized: boolean) => void): () => void;
  };
  app: {
    version(): Promise<string>;
    /** Push fired by the macOS app menu's "About NodeGrip" item so the
     * renderer can open the in-app About dialog (clickable links etc.)
     * instead of the plain-text native panel. */
    onShowAbout(handler: () => void): () => void;
    /** Push fired by the app menu's "File → Open Project…" item so the
     * renderer drives the same picker the home view uses (single-sourced UX). */
    onOpenProject(handler: () => void): () => void;
    /** Snapshot the current updater state. Called once on mount so the
     * UI can render the right status without waiting for the next
     * state-change push (which may not happen for a long time once
     * `current` is reached). */
    updaterState(): Promise<UpdaterState>;
    /** Push fired every time the updater transitions between statuses
     * (see UpdaterStatus). Replaces the previous one-shot
     * `update-available` event. */
    onUpdaterStateChange(handler: (state: UpdaterState) => void): () => void;
    /** Win/macOS only: triggers `autoUpdater.quitAndInstall()`, which
     * closes the app and relaunches it from the just-downloaded
     * Squirrel update. No-op when status !== 'ready' or when running
     * on Linux. */
    installUpdate(): Promise<void>;
    /** Manual / forced check. Works regardless of the
     * `checkUpdatesOnStartup` setting — that flag only gates the
     * automatic polling, not on-demand checks. */
    checkForUpdates(): Promise<void>;
  };
  project: {
    /** Show the system "Choose project folder" dialog. Pass `defaultPath`
     * to root the dialog at a specific folder (e.g. the user's
     * Documents). Returns the absolute folder path or null when the user
     * cancels. Does NOT read or create the metadata — call `read` or
     * `open` afterwards. */
    pickFolder(defaultPath?: string): Promise<string | null>;
    /** Create a new project folder at `<parent>/<name>` and initialise its
     * metadata in a single call. Drives the in-app "New project" dialog:
     * `parent` is the absolute path the user picked via the Browse
     * button, `name` is the folder name they typed. The folder is created
     * (recursive mkdir) and `.nodegrip/project.json` is written with
     * `name` as the project name. If the folder already exists and is a
     * project, the existing metadata is returned unchanged. */
    create(parent: string, name: string): Promise<ProjectInfo>;
    /** Read `<folderPath>/.nodegrip/project.json`. Returns null when the
     * folder has no metadata yet (i.e. it's not yet a project). */
    read(folderPath: string): Promise<ProjectMetadata | null>;
    /** Open the folder as a project: read existing metadata, or auto-init
     * with the folder basename as the project name. Always returns the
     * resolved {folderPath, metadata}; the renderer can use it directly. */
    open(folderPath: string): Promise<ProjectInfo>;
    /** Store or update the project passphrase. Pass undefined to reset
     * to the default built-in passphrase. Returns the updated metadata. */
    setPassphrase(folderPath: string, passphrase: string | undefined): Promise<ProjectMetadata>;
    /** List the immediate children of `folderPath`. Used by the right
     * Files panel for lazy tree expansion — the renderer expands one
     * level at a time so we never scan a deep tree up-front. Returns
     * directories first, then files; both sorted case-insensitively. */
    listFolder(folderPath: string): Promise<FileEntry[]>;
    /** Read a project file as UTF-8 text. The handler caps file size at
     * a few MB and detects binary content so the renderer can render an
     * empty/placeholder state instead of garbled bytes. */
    readFile(filePath: string): Promise<FileReadResult>;
  };
  datasource: {
    /** List every saved data source for the given project folder.
     * Reads `<folderPath>/.nodegrip/datasources/*.json` and returns
     * them sorted by name. */
    list(folderPath: string): Promise<DatasourceConfig[]>;
    /** Fetch a single data source by id, or null when absent. */
    get(folderPath: string, id: string): Promise<DatasourceConfig | null>;
    /** Persist `config`. Returns the saved entry with refreshed
     * `updatedAt` (and `createdAt` for first writes). Validation
     * (unique name, non-empty host, valid port range) lives in main
     * and surfaces as a thrown error. */
    save(folderPath: string, config: DatasourceConfig): Promise<DatasourceConfig>;
    /** Delete the data source's JSON file and any vaulted password. */
    remove(folderPath: string, id: string): Promise<void>;
    /** Open a one-shot connection using `config` (and `password` when
     * present), run a tiny `SELECT version()`-style query, and tear it
     * down. Does NOT mutate disk or the vault — the renderer uses this
     * to validate before persisting. */
    testConnect(
      folderPath: string,
      config: DatasourceConfig,
      password?: string,
    ): Promise<TestConnectionResult>;
    /** Persist a password according to `mode`. `forever` writes an
     * encrypted blob (Electron `safeStorage` → OS keychain), `session`
     * keeps it in main-process memory only, `never` clears any stored
     * value. */
    setPassword(
      folderPath: string,
      id: string,
      password: string,
      mode: PasswordSaveMode,
    ): Promise<void>;
    /** True when the vault already holds a usable password for `id`
     * (either an encrypted blob on disk OR a session value in memory).
     * Lets the renderer decide whether to prompt before connecting. */
    hasPassword(folderPath: string, id: string): Promise<boolean>;
    /** Wipe both the encrypted blob and any session value for `id`. */
    clearPassword(folderPath: string, id: string): Promise<void>;
    /** Open a long-lived connection pool for the saved datasource
     * `id`. When `password` is provided, it overrides whatever the
     * vault holds (used by the prompt flow); omit to fall back to the
     * stored credential. Resolves with `{ok, error?}` and ALSO emits
     * state-change pushes via `onConnectionStateChange`. */
    connect(
      folderPath: string,
      id: string,
      password?: string,
    ): Promise<ConnectResult>;
    /** Close the live pool for `id` (no-op when not connected). */
    disconnect(id: string): Promise<void>;
    /** Synchronous snapshot of the current connection state.
     * Returns `{status: 'disconnected'}` for unknown ids. The
     * renderer hydrates its store with this on mount. */
    getConnectionState(id: string): Promise<ConnectionState>;
    /** Broadcast subscription: fires every time a connection state
     * transitions (connecting / connected / error / disconnected). */
    onConnectionStateChange(
      handler: (state: ConnectionState) => void,
    ): () => void;
    /** Read the cached schema tree for `id`. Returns `null` when no
     * cache exists yet (datasource has never been connected, or the
     * project was just opened). Available even when the datasource
     * is currently disconnected — the renderer renders the last-
     * known structure with a "stale" hint. */
    getSchemaTree(
      folderPath: string,
      id: string,
    ): Promise<SchemaTree | null>;
    /** Re-fetch the children at `path` from the live connection,
     * update the cache, and broadcast. Returns the new children for
     * convenience (the renderer can also wait on the broadcast).
     * Throws when the datasource isn't connected. */
    expandSchemaNode(
      folderPath: string,
      id: string,
      path: SchemaNodePath,
    ): Promise<SchemaTreeNode[]>;
    /** Convenience wrapper for `expandSchemaNode(folderPath, id, [])`
     * — refreshes the root list of databases. */
    refreshSchemaTree(folderPath: string, id: string): Promise<void>;
    /** Push fired every time the cache mutates (refresh, expand,
     * remove). Renderer's zustand store dispatches into its in-
     * memory mirror. */
    onSchemaTreeChange(
      handler: (payload: { id: string; tree: SchemaTree }) => void,
    ): () => void;
  };
  pdf: {
    /** Show the system "Open PDF" dialog. Pass `defaultPath` to root the
     * dialog at a specific folder (e.g. the user's Downloads). */
    open(defaultPath?: string): Promise<string | null>;
    read(filePath: string): Promise<Uint8Array>;
    /** Drain any PDF paths the OS shell handed us before the renderer was
     * ready (cold start launched via "Open with NodeGrip"). */
    flushPending(): Promise<string[]>;
    /** Live push from main: file path received via 'open-file' (macOS) or
     * a second-instance launch (Windows/Linux) while the app is running. */
    onOpenExternal(handler: (filePath: string) => void): () => void;
    applyStamp(input: ApplyStampInput): Promise<ApplyStampResult>;
    print(filePath: string, options?: PrintOptions): Promise<void>;
    /** Manage PDF password protection. Behaviour depends on inputs:
     *  - `currentPassword` is required if the PDF is currently encrypted.
     *  - If `newPassword` is a non-empty string, the PDF is (re)encrypted
     *    with it using the supplied permissions.
     *  - If `newPassword` is null/empty AND the PDF was encrypted, the
     *    encryption is removed.
     */
    protect(input: ProtectInput): Promise<void>;
    /** Inspect AcroForm fields. Returns hasForm=false with empty
     * fields for non-form PDFs (cheap — only parses the catalog). */
    getFormInfo(filePath: string, password?: string): Promise<FormInfo>;
    /** Write the supplied field values back to the file. Incremental
     * by default (keeps fields editable + preserves any existing
     * signatures); `mode: 'flatten'` bakes the values into page
     * graphics and strips the form. */
    fillForm(input: FillFormInput): Promise<FillFormResult>;
  };
  printer: {
    list(): Promise<PrinterInfo[]>;
  };
  stamps: {
    list(): Promise<Stamp[]>;
    add(): Promise<Stamp | null>;
    remove(id: string): Promise<void>;
  };
  signatures: {
    list(): Promise<Signature[]>;
    /** Persist a drawn or typed signature produced by a renderer canvas. */
    createFromBytes(input: CreateSignatureFromBytesInput): Promise<Signature>;
    /** Open the OS file picker and import a PNG/JPG as a signature image. */
    createFromFile(): Promise<Signature | null>;
    remove(id: string): Promise<void>;
    /** Apply a visual signature to a page (does NOT add a cryptographic
     * /Sig field — that's Fase 3). */
    apply(input: ApplySignatureInput): Promise<ApplySignatureResult>;
    /** Inspect existing /Sig fields in a PDF and report their integrity. */
    inspect(filePath: string, password?: string): Promise<InspectSignaturesResult>;
    /** Apply a cryptographic PKCS#7 signature to a PDF using a stored cert.
     * `visualSignatureId` + `rect` + `pageIndex` are optional: omitting them
     * produces an invisible signature with no on-page mark. */
    signDigital(input: SignDigitalInput): Promise<SignDigitalResult>;
  };
  certs: {
    list(): Promise<Certificate[]>;
    generate(input: GenerateCertInput): Promise<Certificate>;
    /** Open the OS file picker for a .p12/.pfx and return the chosen path.
     * Used by the renderer's two-step import flow (pick file, then prompt
     * for the cert password in a UI dialog). */
    pickFile(): Promise<string | null>;
    import(input: ImportCertInput): Promise<Certificate>;
    remove(id: string): Promise<void>;
  };
  recents: {
    readThumb(filePath: string): Promise<Uint8Array | null>;
    saveThumb(input: { filePath: string; bytes: Uint8Array }): Promise<void>;
  };
  shell: {
    /** List of common home subdirectories that exist on this machine. */
    homeFolders(): Promise<HomeFolder[]>;
  };
  settings: {
    get(): Promise<AppSettings>;
    /** Partial patch — unspecified keys keep their current value. Returns
     * the merged settings so the renderer can reconcile its own store. */
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
}

export const IPC_CHANNELS = {
  window: {
    minimize: 'window:minimize',
    maximizeToggle: 'window:maximize-toggle',
    close: 'window:close',
    isMaximized: 'window:is-maximized',
    maximizeChange: 'window:maximize-change',
  },
  app: {
    version: 'app:version',
    showAbout: 'app:show-about',
    openProject: 'app:open-project',
    updaterStateGet: 'app:updater-state-get',
    updaterStateChange: 'app:updater-state-change',
    updaterInstall: 'app:updater-install',
    updaterCheckNow: 'app:updater-check-now',
  },
  project: {
    pickFolder: 'project:pick-folder',
    create: 'project:create',
    read: 'project:read',
    open: 'project:open',
    setPassphrase: 'project:set-passphrase',
    listFolder: 'project:list-folder',
    readFile: 'project:read-file',
  },
  datasource: {
    list: 'datasource:list',
    get: 'datasource:get',
    save: 'datasource:save',
    remove: 'datasource:remove',
    testConnect: 'datasource:test-connect',
    setPassword: 'datasource:set-password',
    hasPassword: 'datasource:has-password',
    clearPassword: 'datasource:clear-password',
    connect: 'datasource:connect',
    disconnect: 'datasource:disconnect',
    getConnectionState: 'datasource:get-connection-state',
    connectionStateChange: 'datasource:connection-state-change',
    getSchemaTree: 'datasource:get-schema-tree',
    expandSchemaNode: 'datasource:expand-schema-node',
    refreshSchemaTree: 'datasource:refresh-schema-tree',
    schemaTreeChange: 'datasource:schema-tree-change',
  },
  pdf: {
    open: 'pdf:open',
    read: 'pdf:read',
    flushPending: 'pdf:flush-pending',
    openExternal: 'pdf:open-external',
    applyStamp: 'pdf:apply-stamp',
    getFormInfo: 'pdf:get-form-info',
    fillForm: 'pdf:fill-form',
    print: 'pdf:print',
    protect: 'pdf:protect',
  },
  stamps: {
    list: 'stamps:list',
    add: 'stamps:add',
    remove: 'stamps:remove',
  },
  signatures: {
    list: 'signatures:list',
    createFromBytes: 'signatures:create-from-bytes',
    createFromFile: 'signatures:create-from-file',
    remove: 'signatures:remove',
    apply: 'signatures:apply',
    inspect: 'signatures:inspect',
    signDigital: 'signatures:sign-digital',
  },
  certs: {
    list: 'certs:list',
    generate: 'certs:generate',
    pickFile: 'certs:pick-file',
    import: 'certs:import',
    remove: 'certs:remove',
  },
  recents: {
    readThumb: 'recents:read-thumb',
    saveThumb: 'recents:save-thumb',
  },
  printer: {
    list: 'printer:list',
  },
  shell: {
    homeFolders: 'shell:home-folders',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
  },
} as const;
