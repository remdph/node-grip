import fs from 'node:fs/promises';

import { NodeGripError } from '~shared/types/errors.js';
import type {
  ConnectionState,
  ConnectResult,
  DatasourceConfig,
  DatasourceSsl,
} from '~shared/types/datasource.js';
import { classifyError } from './error-classify.js';
import { getDatasource } from './storage.js';
import { openTunnel, type ActiveTunnel } from './tunnel-manager.js';
import { getPassword } from './vault.js';

/** Connection pool size. v0.1 only uses one connection per pool —
 * UI is single-threaded queries — but a pool gives us auto-reconnect
 * semantics and cheap parallelism when we add the schema introspector. */
const POOL_MAX = 4;
/** How long to wait for the initial handshake before declaring a
 * connect attempt dead. Mirrors test-connect for symmetry. */
const CONNECT_TIMEOUT_MS = 7_000;

/** Anything we know how to `.end()` cleanly. pg and mysql2 both
 * expose a Promise-returning end(); the union narrows so callers
 * don't need driver-specific branches at cleanup time. */
interface PoolHandle {
  end(): Promise<void>;
}

interface ConnectionRecord {
  /** Last broadcast state — kept in sync with whatever has been
   * shipped to listeners so `getState` returns the latest snapshot. */
  state: ConnectionState;
  /** Live driver pool. `undefined` while we're connecting or after
   * disconnect; we keep the record around briefly to retain the
   * last-known status/error for the UI. */
  pool?: PoolHandle;
  /** setInterval handle for the optional keep-alive pinger. Cleared
   * on disconnect / forget. */
  keepAliveTimer?: NodeJS.Timeout;
  /** Runner that issues `SELECT 1` against the pool. Captured in the
   * record so the same closure is reused per tick. */
  ping?: () => Promise<void>;
  /** SSH tunnel paired with this connection — torn down in disconnect
   * after the pool. Undefined when the datasource doesn't tunnel. */
  tunnel?: ActiveTunnel;
  /** Snapshot of the config + password used to open this pool.
   * Required by introspection so it can open transient PG clients to
   * sibling databases without re-reading disk + re-prompting. */
  config?: DatasourceConfig;
  password?: string;
  sslOptions?: Record<string, unknown>;
  target?: ConnectionTarget;
  /** Postgres-only: cache of per-database pools opened on demand by
   * the schema browser. PG connections are bound to one database, so
   * exploring sibling databases needs additional pools. We keep them
   * around between queries (idle timeout 60s) so repeated expansions
   * don't pay the handshake cost every time. */
  pgDatabasePools?: Map<string, unknown>;
}

/** Read-only view of an active connection. Surfaced to other main-
 * process modules (notably `introspection.ts`) so they can run
 * driver-aware queries without learning about pools themselves. */
export interface ActiveConnectionContext {
  config: DatasourceConfig;
  password: string;
  driver: DatasourceConfig['driver'];
  pool: PoolHandle;
  sslOptions?: Record<string, unknown>;
  target: ConnectionTarget;
}

export function getActiveConnection(id: string): ActiveConnectionContext | null {
  const record = connections.get(id);
  if (
    !record?.pool ||
    record.state.status !== 'connected' ||
    !record.config ||
    record.password === undefined ||
    !record.target
  ) {
    return null;
  }
  return {
    config: record.config,
    password: record.password,
    driver: record.config.driver,
    pool: record.pool,
    sslOptions: record.sslOptions,
    target: record.target,
  };
}

/** Cold-connect headroom for transient introspection clients. We
 * give the handshake a generous budget because the cost is one-time
 * per (datasource, database) pair — subsequent expansions reuse the
 * pool below. Same dial covers SSL handshake + auth + initial idle. */
const PG_INTROSPECT_CONNECT_TIMEOUT_MS = 30_000;
const PG_INTROSPECT_IDLE_TIMEOUT_MS = 60_000;

/** Acquire a PG client bound to `databaseName` from a per-database
 * pool kept on the connection record. Reuses the main pool when the
 * target IS `config.database` so we don't open a duplicate
 * connection for the most common case. Caller must use the client
 * only inside the `fn` body — releasing happens automatically. */
export async function withPgDatabaseClient<T>(
  id: string,
  databaseName: string,
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const ctx = getActiveConnection(id);
  if (!ctx) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      'Data source not connected',
    );
  }
  if (ctx.driver !== 'postgres') {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      `withPgDatabaseClient called for non-postgres driver: ${ctx.driver}`,
    );
  }

  // Fast path: querying the database the main pool is already
  // bound to. Saves an extra pool + handshake.
  if (databaseName === ctx.config.database) {
    const mainPool = ctx.pool as unknown as import('pg').Pool;
    const client = await mainPool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  // Slow path: dedicated pool for `databaseName`. Cached on the
  // record so siblings benefit + parent disconnect tears it down.
  const record = connections.get(id);
  if (!record) {
    throw new NodeGripError('VALIDATION_ERROR', 'Data source vanished mid-query');
  }
  if (!record.pgDatabasePools) {
    record.pgDatabasePools = new Map();
  }

  let pool = record.pgDatabasePools.get(databaseName) as
    | import('pg').Pool
    | undefined;
  if (!pool) {
    const { Pool } = await import('pg');
    pool = new Pool({
      host: ctx.target.host,
      port: ctx.target.port,
      user: ctx.config.user,
      password: ctx.password,
      database: databaseName,
      ssl: ctx.sslOptions,
      max: 2,
      connectionTimeoutMillis: PG_INTROSPECT_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: PG_INTROSPECT_IDLE_TIMEOUT_MS,
    });
    record.pgDatabasePools.set(databaseName, pool);
  }

  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Resolve an SSL config (paths → buffers + driver-native options
 * object) ONCE per connect. Returns `undefined` when SSL is disabled
 * so the caller can just spread it into the driver options. */
async function resolveSslOptions(
  ssl: DatasourceSsl | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!ssl || ssl.mode === 'disable') return undefined;
  const out: Record<string, unknown> = {
    // verify-* requires the chain to validate against `ca`. 'require'
    // (no verification) maps to rejectUnauthorized: false — useful
    // for self-signed dev servers but DANGEROUS in production.
    rejectUnauthorized: ssl.mode === 'verify-ca' || ssl.mode === 'verify-full',
  };
  // verify-full additionally checks the hostname matches the cert's
  // CN/SAN. mysql2 + pg both honour this when present.
  if (ssl.mode === 'verify-full') {
    // pg passes `checkServerIdentity` to tls; mysql2 picks it up via
    // tls's defaults when rejectUnauthorized=true. We rely on the
    // default which already verifies hostname → no extra knob.
  }
  if (ssl.caPath) {
    try {
      out.ca = await fs.readFile(ssl.caPath);
    } catch (err) {
      throw new NodeGripError(
        'READ_FAILED',
        `Failed to read SSL CA at ${ssl.caPath}`,
        err,
      );
    }
  }
  if (ssl.certPath) {
    try {
      out.cert = await fs.readFile(ssl.certPath);
    } catch (err) {
      throw new NodeGripError(
        'READ_FAILED',
        `Failed to read SSL cert at ${ssl.certPath}`,
        err,
      );
    }
  }
  if (ssl.keyPath) {
    try {
      out.key = await fs.readFile(ssl.keyPath);
    } catch (err) {
      throw new NodeGripError(
        'READ_FAILED',
        `Failed to read SSL key at ${ssl.keyPath}`,
        err,
      );
    }
  }
  return out;
}

/** Build a "connection target" used by the driver. When an SSH tunnel
 * is active, we shadow the original host:port with the local forward;
 * otherwise we pass the user's host:port through. */
export interface ConnectionTarget {
  host: string;
  port: number;
}

function tunnelOrDirect(
  config: DatasourceConfig,
  tunnel: ActiveTunnel | undefined,
): ConnectionTarget {
  if (tunnel) {
    return { host: '127.0.0.1', port: tunnel.localPort };
  }
  return { host: config.host, port: config.port };
}

const connections = new Map<string, ConnectionRecord>();
const listeners = new Set<(state: ConnectionState) => void>();

/** Subscribe to state-change broadcasts. The IPC layer pipes these
 * to every open BrowserWindow via webContents.send. */
export function subscribe(
  handler: (state: ConnectionState) => void,
): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

function broadcast(state: ConnectionState): void {
  for (const l of listeners) {
    try {
      l(state);
    } catch (err) {
      console.warn('[connections] listener failed', err);
    }
  }
}

function updateState(id: string, partial: Partial<ConnectionState>): ConnectionState {
  const existing =
    connections.get(id)?.state ?? ({ id, status: 'disconnected' } as ConnectionState);
  const next: ConnectionState = { ...existing, ...partial, id };
  const record = connections.get(id);
  if (record) {
    record.state = next;
  } else {
    connections.set(id, { state: next });
  }
  broadcast(next);
  return next;
}

/** Synchronous read-out used by the IPC `getConnectionState`. Returns
 * a fresh "disconnected" snapshot when nothing has been registered
 * for that id yet, so the renderer's first paint always has a value. */
export function getState(id: string): ConnectionState {
  return connections.get(id)?.state ?? { id, status: 'disconnected' };
}

/** Wrap a promise in a timeout to bound connect attempts. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Connect timed out after ${ms}ms`);
      (err as { code?: string }).code = 'ETIMEDOUT';
      reject(err);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function openPostgresPool(
  config: DatasourceConfig,
  password: string,
  target: ConnectionTarget,
  sslOptions: Record<string, unknown> | undefined,
): Promise<{ pool: PoolHandle; serverVersion: string; ping: () => Promise<void> }> {
  const { Pool } = await import('pg');
  const opts = config.options ?? {};
  // Advanced-tab properties (Phase 6) pass through to pg.Pool verbatim;
  // we ALWAYS overwrite NodeGrip-managed fields below to avoid the
  // user shooting themselves in the foot with mismatched host/port.
  const advanced = (config.advanced ?? {}) as Record<string, unknown>;
  const pool = new Pool({
    ...advanced,
    host: target.host,
    port: target.port,
    user: config.user,
    password,
    database: config.database,
    ssl: sslOptions,
    max: opts.singleSession ? 1 : POOL_MAX,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // `idleTimeoutMillis` makes inner clients close after N idle ms.
    // Pool stays open + reconnects lazily on next query.
    idleTimeoutMillis:
      opts.autoDisconnectSeconds && opts.autoDisconnectSeconds > 0
        ? opts.autoDisconnectSeconds * 1000
        : 10_000,
  });
  // Validate + run per-connect setup in a single acquired client so
  // the timezone / startup script land on the very first connection.
  const client = await withTimeout(pool.connect(), CONNECT_TIMEOUT_MS);
  let serverVersion = 'PostgreSQL (version unknown)';
  try {
    if (opts.timezone) {
      // `SET TIME ZONE 'name'` — parameters can't be used for SET; we
      // inline-quote and rely on pg's identifier-safe escape via
      // `client.escapeLiteral` to avoid injection from a hand-edited
      // config file.
      await client.query(`SET TIME ZONE ${client.escapeLiteral(opts.timezone)}`);
    }
    if (opts.readOnly) {
      await client.query('SET default_transaction_read_only = on');
    }
    if (opts.startupScript && opts.startupScript.trim().length > 0) {
      await client.query(opts.startupScript);
    }
    const res = await withTimeout(
      client.query<{ version: string }>('SELECT version() AS version'),
      CONNECT_TIMEOUT_MS,
    );
    serverVersion = res.rows[0]?.version ?? serverVersion;
  } finally {
    client.release();
  }
  // Pingable lambda kept alongside the pool so the per-id keep-alive
  // timer doesn't have to know about driver kinds.
  const ping = async () => {
    const c = await pool.connect();
    try {
      await c.query('SELECT 1');
    } finally {
      c.release();
    }
  };
  return { pool: pool as unknown as PoolHandle, serverVersion, ping };
}

interface MysqlVersionRow {
  version: string;
}

async function openMysqlPool(
  config: DatasourceConfig,
  password: string,
  target: ConnectionTarget,
  sslOptions: Record<string, unknown> | undefined,
): Promise<{ pool: PoolHandle; serverVersion: string; ping: () => Promise<void> }> {
  const mysql = await import('mysql2/promise');
  const opts = config.options ?? {};
  // Advanced-tab properties (Phase 6) — passthrough to mysql2's
  // createPool, but our managed fields below win to prevent the user
  // overriding host / credentials accidentally. The startup-script
  // multi-statement requirement also wins because executing the
  // script depends on it.
  const advanced = (config.advanced ?? {}) as Record<string, unknown>;
  const needsMulti =
    opts.startupScript != null && opts.startupScript.trim().length > 0;
  const pool = mysql.createPool({
    ...(advanced as Record<string, never>),
    host: target.host,
    port: target.port,
    user: config.user,
    password,
    database: config.database || undefined,
    ssl: sslOptions,
    connectionLimit: opts.singleSession ? 1 : POOL_MAX,
    connectTimeout: CONNECT_TIMEOUT_MS,
    idleTimeout:
      opts.autoDisconnectSeconds && opts.autoDisconnectSeconds > 0
        ? opts.autoDisconnectSeconds * 1000
        : undefined,
    multipleStatements: needsMulti || advanced.multipleStatements === true,
  });
  const conn = await withTimeout(pool.getConnection(), CONNECT_TIMEOUT_MS);
  let serverVersion = 'MySQL/MariaDB (version unknown)';
  try {
    if (opts.timezone) {
      // Use a parameterised query — mysql2 lets us bind on SET names.
      await conn.query('SET time_zone = ?', [opts.timezone]);
    }
    if (opts.readOnly) {
      await conn.query('SET SESSION TRANSACTION READ ONLY');
    }
    if (opts.startupScript && opts.startupScript.trim().length > 0) {
      await conn.query(opts.startupScript);
    }
    const result = (await withTimeout(
      conn.query('SELECT VERSION() AS version'),
      CONNECT_TIMEOUT_MS,
    )) as [MysqlVersionRow[], unknown];
    const first = Array.isArray(result[0]) ? result[0][0] : undefined;
    if (first?.version) serverVersion = first.version;
  } finally {
    conn.release();
  }
  const ping = async () => {
    const c = await pool.getConnection();
    try {
      await c.query('SELECT 1');
    } finally {
      c.release();
    }
  };
  return { pool: pool as unknown as PoolHandle, serverVersion, ping };
}

/** Open a pool for `id` using the on-disk config + an effective
 * password (from `password` argument, vault, or empty). Replaces any
 * existing pool atomically. */
export async function connect(
  folderPath: string,
  id: string,
  passwordOverride?: string,
): Promise<ConnectResult> {
  if (typeof folderPath !== 'string' || folderPath.length === 0) {
    throw new NodeGripError('INVALID_PATH', 'A project folder is required');
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new NodeGripError('VALIDATION_ERROR', 'A datasource id is required');
  }

  const config = await getDatasource(folderPath, id);
  if (!config) {
    throw new NodeGripError('VALIDATION_ERROR', `Unknown datasource: ${id}`);
  }

  // Replace any existing pool so reconnects are safe to invoke at any time.
  await disconnect(id);

  updateState(id, {
    status: 'connecting',
    error: undefined,
    errorKind: undefined,
  });

  // Resolve the password to use. If the caller supplied one (e.g. the
  // prompt UI), respect it verbatim — even an empty string, for
  // trust-auth servers. Otherwise fall back to whatever the vault
  // holds.
  const password =
    passwordOverride !== undefined
      ? passwordOverride
      : (await getPassword(folderPath, id)) ?? '';

  // Open the SSH tunnel BEFORE the pool so the driver targets the
  // local forward from the very first packet. Failures here surface
  // as 'error' state below; the tunnel handle is also tied into the
  // record so disconnect tears down both layers.
  let tunnel: ActiveTunnel | undefined;
  try {
    if (config.ssh?.enabled) {
      tunnel = await openTunnel(config);
    }

    const sslOptions = await resolveSslOptions(config.ssl);
    const target = tunnelOrDirect(config, tunnel);

    const opened =
      config.driver === 'postgres'
        ? await openPostgresPool(config, password, target, sslOptions)
        : await openMysqlPool(config, password, target, sslOptions);

    // Optional keep-alive timer. Failures are swallowed because a
    // ping is best-effort; if the pool is truly dead the next user
    // query will surface the real error.
    const keepAlive = config.options?.keepAliveSeconds;
    let keepAliveTimer: NodeJS.Timeout | undefined;
    if (keepAlive && keepAlive > 0) {
      keepAliveTimer = setInterval(() => {
        opened.ping().catch((err: unknown) => {
          console.warn(`[connections] keep-alive ping failed for ${id}:`, err);
        });
      }, keepAlive * 1000);
      // `unref` lets the Node process exit even if the timer is
      // pending — Electron's main process doesn't care, but it's a
      // safer default for cleanup.
      keepAliveTimer.unref?.();
    }

    connections.set(id, {
      state: {
        id,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        serverVersion: opened.serverVersion,
      },
      pool: opened.pool,
      keepAliveTimer,
      ping: opened.ping,
      tunnel,
      config,
      password,
      sslOptions,
      target,
    });
    broadcast(connections.get(id)!.state);
    return { ok: true };
  } catch (err) {
    // If we opened a tunnel but the pool failed to come up, the
    // tunnel must be torn down or we leak an SSH connection. Failures
    // in close() get logged but don't mask the original error.
    if (tunnel) {
      try {
        await tunnel.close();
      } catch (cleanupErr) {
        console.warn(
          `[connections] failed to close tunnel after pool error for ${id}:`,
          cleanupErr,
        );
      }
    }
    const { kind, message } = classifyError(err);
    updateState(id, {
      status: 'error',
      error: message,
      errorKind: kind,
      connectedAt: undefined,
      serverVersion: undefined,
    });
    return { ok: false, error: message, errorKind: kind };
  }
}

/** Close the pool (if any) and emit a 'disconnected' state. Safe to
 * call on an id that was never connected. */
export async function disconnect(id: string): Promise<void> {
  const record = connections.get(id);
  if (!record?.pool) {
    // Even without a pool, surface 'disconnected' so the UI clears
    // any "connecting…" placeholder when the user cancels.
    if (record) {
      updateState(id, {
        status: 'disconnected',
        connectedAt: undefined,
        serverVersion: undefined,
        error: undefined,
        errorKind: undefined,
      });
    }
    return;
  }
  const pool = record.pool;
  const tunnel = record.tunnel;
  const dbPools = record.pgDatabasePools;
  // Clear the pool / tunnel references BEFORE awaiting cleanup so a
  // concurrent re-connect can install new ones without racing with
  // shutdown.
  record.pool = undefined;
  record.tunnel = undefined;
  record.pgDatabasePools = undefined;
  if (record.keepAliveTimer) {
    clearInterval(record.keepAliveTimer);
    record.keepAliveTimer = undefined;
  }
  record.ping = undefined;
  try {
    await pool.end();
  } catch (err) {
    console.warn(`[connections] error closing pool for ${id}:`, err);
  }
  if (dbPools && dbPools.size > 0) {
    // Close all per-database introspection pools in parallel — none
    // depend on each other, and a hung one shouldn't block the rest.
    const closes = Array.from(dbPools.values()).map((p) =>
      (p as { end(): Promise<void> }).end().catch((err: unknown) => {
        console.warn(`[connections] error closing per-db pool for ${id}:`, err);
      }),
    );
    await Promise.allSettled(closes);
  }
  if (tunnel) {
    try {
      await tunnel.close();
    } catch (err) {
      console.warn(`[connections] error closing tunnel for ${id}:`, err);
    }
  }
  updateState(id, {
    status: 'disconnected',
    connectedAt: undefined,
    serverVersion: undefined,
    error: undefined,
    errorKind: undefined,
  });
}

/** Close every open pool. Called from the app-quit hook so a hung
 * disconnect can't block shutdown — we await in parallel and swallow
 * individual failures. */
export async function disconnectAll(): Promise<void> {
  const ids = Array.from(connections.keys());
  await Promise.allSettled(ids.map((id) => disconnect(id)));
}

/** Forget every state record for a datasource — used when the
 * datasource itself is removed so its 'error' / 'disconnected' chip
 * doesn't keep haunting the UI after the entry is gone. */
export async function forget(id: string): Promise<void> {
  await disconnect(id);
  connections.delete(id);
}
