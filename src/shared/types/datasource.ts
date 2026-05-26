/**
 * Shape of a persisted database connection ("data source" in JetBrains
 * terminology). v0.1 only supports the three drivers in `DriverKind`;
 * the registry below knows the defaults and builds the DSN.
 */

/** Database engines we ship with. MariaDB shares wire protocol with
 * MySQL so both are handled by the same `mysql2`-backed client; the
 * distinct kind is kept so the UI can render the right icon + driver
 * label, and so we can surface version-specific quirks later without a
 * schema migration. */
export type DriverKind = 'postgres' | 'mysql' | 'mariadb';

/** How a password is persisted between sessions.
 *  - `forever` → encrypted with Electron `safeStorage` (OS keychain).
 *  - `session` → kept in main-process memory only; cleared on app quit.
 *  - `never`   → never stored; user is prompted on every connect. */
export type PasswordSaveMode = 'forever' | 'session' | 'never';

/** Free-form properties surfaced through the future "Advanced" tab.
 * Per-driver allowed keys are validated in main; the shape is loose
 * here so the persisted JSON survives schema bumps without migrations.
 * Value can be string/number/boolean; we serialise as-is. */
export type DatasourceAdvanced = Record<string, string | number | boolean>;

/** Per-connection runtime options (Options tab in the JetBrains UI).
 * Fields are all optional + omitted-means-default — older configs
 * stored before a field existed load fine and the form treats them as
 * "use default" rather than "explicitly false". */
export interface DatasourceOptions {
  /* --- Connection (Phase 4) ----------------------------------------- */
  /** Wrap session in `SET default_transaction_read_only = on` (PG) or
   * `SET SESSION TRANSACTION READ ONLY` (MySQL). Stored in v0.1; only
   * enforced once the query executor lands. */
  readOnly?: boolean;
  /** 'auto' = each statement is its own implicit transaction; 'manual'
   * = leave BEGIN/COMMIT to the user. Stored for future use. */
  transactionControl?: 'auto' | 'manual';
  /** 'manual' = user explicitly switches; 'automatic' = we issue
   * SET search_path / USE when the UI active schema changes. Stored. */
  switchSchema?: 'manual' | 'automatic';
  /** IANA name applied via SET TIME ZONE / SET time_zone on connect. */
  timezone?: string;
  /** Cap the connection pool to 1 so the user always sees the same
   * session — useful for temp tables / session variables. */
  singleSession?: boolean;
  /** Periodic `SELECT 1` over the pool to keep idle connections alive.
   * 0 / omitted disables. */
  keepAliveSeconds?: number;
  /** Idle timeout for the inner pool connections (maps to
   * `idleTimeoutMillis` / `idleTimeout`). 0 / omitted disables. */
  autoDisconnectSeconds?: number;
  /** Restrict the schema browser to the database in the General tab.
   * Stored for the schema browser phase. */
  singleDatabase?: boolean;
  /** SQL run once after connect (parameter-free, raw). */
  startupScript?: string;

  /* --- Introspection (Phase 4 sub-section) -------------------------- */
  /** Refresh cached metadata on connect. */
  autoSync?: boolean;
  /** Detail level for the schema browser. Defaults to 'auto'. */
  introspectionLevel?: 'auto' | 'tables' | 'columns' | 'all';

  /* --- Schemas tab (Phase 5) ---------------------------------------- */
  /** Declarative scope tree: which databases + schemas to scan. */
  scope?: DatasourceScope;
  /** Regex applied to schema names during introspection. */
  schemaPattern?: string;
  /** Regex applied to table/view/object names. */
  objectFilter?: string;
  /** Include `pg_catalog` / `information_schema` / `mysql` / `sys` etc. */
  showSystemSchemas?: boolean;
  /** PostgreSQL only — show databases marked as templates. */
  showTemplateDatabases?: boolean;
}

/** Schema-tab scope tree. Two top-level toggles ("All databases" /
 * "Default database") each with their own sub-toggles for "All
 * schemas" / "Default schema". Mirrors the JetBrains UI; per-database
 * granularity is left for a future iteration. */
export interface DatasourceScope {
  allDatabases?: DatasourceScopeNode;
  defaultDatabase?: DatasourceScopeNode;
}

export interface DatasourceScopeNode {
  enabled?: boolean;
  allSchemas?: boolean;
  defaultSchema?: boolean;
}

/** SSH tunnel config — when `enabled`, the runtime opens an SSH
 * connection first and forwards a local port to `<config.host>:<port>`,
 * then points the DB driver at that local forward. v0.1 supports
 * private-key auth only; password auth and key passphrases land
 * later (track of the prompt+vault plumbing). */
export interface DatasourceSsh {
  enabled?: boolean;
  host: string;
  port: number;
  user: string;
  /** Absolute path to a private key file on disk. Read at connect
   * time — never persisted in the config. */
  privateKeyPath?: string;
}

/** SSL / TLS config. `mode` mirrors libpq semantics so the values map
 * 1:1 onto a PG / MySQL session. Cert / key paths are read at connect
 * time; their CONTENTS never persist in the .json config. */
export type SslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

export interface DatasourceSsl {
  mode: SslMode;
  /** Path to a CA bundle (PEM). Required for verify-* modes. */
  caPath?: string;
  /** Path to a client certificate (PEM). Optional. */
  certPath?: string;
  /** Path to the client key (PEM). Optional. */
  keyPath?: string;
}

export interface DatasourceConfig {
  /** Stable UUID-like id used as the on-disk filename + in IPC. */
  id: string;
  /** User-visible label (e.g. `postgres@localhost`). Unique per project. */
  name: string;
  /** Free-form note shown under the name in the editor. */
  comment?: string;
  /** Which driver to load. */
  driver: DriverKind;
  /** Host name or IP. */
  host: string;
  /** TCP port. Defaults come from the driver registry (5432 / 3306). */
  port: number;
  /** Username; never persisted to disk unencrypted? — usernames are
   * not secrets, we store them in cleartext. The password is the
   * sensitive bit and lives in the vault. */
  user: string;
  /** Database / schema to USE on connect. */
  database: string;
  /** How the password should be persisted between sessions. */
  passwordMode: PasswordSaveMode;
  /** Runtime knobs (Options tab). Optional + lazily filled. */
  options?: DatasourceOptions;
  /** Driver-specific properties (Advanced tab). Optional. */
  advanced?: DatasourceAdvanced;
  /** SSH tunnel config (Phase 7). Omitted = no tunnel. */
  ssh?: DatasourceSsh;
  /** SSL / TLS config (Phase 7). Omitted = `mode: 'disable'`. */
  ssl?: DatasourceSsl;
  /** ISO timestamp of the first save. */
  createdAt: string;
  /** ISO timestamp of the most recent save. */
  updatedAt: string;
}

/** State of a live runtime connection to a datasource (managed by
 * main's `connections.ts` pool registry). The renderer mirrors this
 * shape in a per-id store and re-renders status dots on push updates. */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface ConnectionState {
  /** Datasource id this state belongs to. */
  id: string;
  status: ConnectionStatus;
  /** Friendly error string when `status === 'error'`. */
  error?: string;
  /** Same error category as TestConnectionResult — useful for
   * remediation hints in the renderer. */
  errorKind?: TestConnectionResult['errorKind'];
  /** ISO timestamp of the most recent transition into 'connected'. */
  connectedAt?: string;
  /** Server version reported by the driver on connect. Surfaced in
   * tooltips on the explorer tree. */
  serverVersion?: string;
}

/** Outcome of a `datasource.connect` call. The renderer also receives
 * a follow-up state push via the subscription, but the synchronous
 * return value lets a caller (e.g. the password prompt) know whether
 * to dismiss itself or display the error inline. */
export interface ConnectResult {
  ok: boolean;
  error?: string;
  errorKind?: TestConnectionResult['errorKind'];
}

/** Reason the main process is asking the renderer for a password.
 * Drives the prompt copy: `missing` (no entry in vault), `wrong`
 * (auth error on a stored password — likely the user rotated it). */
export type PasswordPromptReason = 'missing' | 'wrong';

/** Payload returned by `datasource.testConnect`. The renderer renders
 * a green / red banner in the dialog based on `ok` and shows the
 * server version + roundtrip latency on success. */
export interface TestConnectionResult {
  ok: boolean;
  /** Roundtrip latency in milliseconds, only populated when `ok`. */
  latencyMs?: number;
  /** Server-reported version string (e.g. "PostgreSQL 16.0 …"). */
  serverVersion?: string;
  /** Friendly, single-line error message when `!ok`. */
  error?: string;
  /** Lowercase error class extracted from the driver (e.g. `auth`,
   * `network`, `unknown`). Lets the renderer hint at remediation. */
  errorKind?: 'auth' | 'network' | 'database' | 'tls' | 'timeout' | 'unknown';
}

/* ----------------------------------------------------------------- */
/* Driver registry — shared so the renderer can compute the URL      */
/* preview + default port/user without bouncing through IPC.         */
/* ----------------------------------------------------------------- */

export interface DriverDescriptor {
  /** Human-readable label rendered next to the connection icon. */
  label: string;
  /** Default TCP port pre-filled when the user picks this driver. */
  defaultPort: number;
  /** Default user pre-filled in the General tab. */
  defaultUser: string;
  /** Scheme used by the DSN string builder. mysql and mariadb share
   * the wire protocol but the scheme stays distinct so logs reveal
   * what the user actually picked. */
  scheme: 'postgresql' | 'mysql' | 'mariadb';
}

export const DRIVER_REGISTRY: Record<DriverKind, DriverDescriptor> = {
  postgres: {
    label: 'PostgreSQL',
    defaultPort: 5432,
    defaultUser: 'postgres',
    scheme: 'postgresql',
  },
  mysql: {
    label: 'MySQL',
    defaultPort: 3306,
    defaultUser: 'root',
    scheme: 'mysql',
  },
  mariadb: {
    label: 'MariaDB',
    defaultPort: 3306,
    defaultUser: 'root',
    scheme: 'mariadb',
  },
};

export function driverLabel(kind: DriverKind): string {
  return DRIVER_REGISTRY[kind].label;
}

export function driverDefaultPort(kind: DriverKind): number {
  return DRIVER_REGISTRY[kind].defaultPort;
}

export function driverDefaultUser(kind: DriverKind): string {
  return DRIVER_REGISTRY[kind].defaultUser;
}

/** List of every driver registered, sorted by label. Used by the
 * "Add data source" picker. */
export function listDrivers(): ReadonlyArray<{ kind: DriverKind; label: string }> {
  return (Object.keys(DRIVER_REGISTRY) as DriverKind[])
    .map((kind) => ({ kind, label: DRIVER_REGISTRY[kind].label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Build a canonical DSN string from a config + optional password.
 * Used for the "URL" preview in the General tab and for logging — the
 * real connection uses the structured options object passed to pg /
 * mysql2 directly (avoids parser edge cases with passwords containing
 * `@`). */
export function buildDsn(config: DatasourceConfig, password?: string): string {
  const { scheme } = DRIVER_REGISTRY[config.driver];
  const user = encodeURIComponent(config.user);
  const pass = password ? `:${encodeURIComponent(password)}` : '';
  const host = config.host || 'localhost';
  const port = config.port || DRIVER_REGISTRY[config.driver].defaultPort;
  const db = config.database ? `/${encodeURIComponent(config.database)}` : '';
  return `${scheme}://${user}${pass}@${host}:${port}${db}`;
}
