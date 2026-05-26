import { NodeGripError } from '~shared/types/errors.js';
import type { DriverKind } from '~shared/types/datasource.js';
import type {
  SchemaNodeKind,
  SchemaNodePath,
  SchemaTreeNode,
} from '~shared/types/schema-tree.js';
import {
  getActiveConnection,
  withPgDatabaseClient,
  type ActiveConnectionContext,
} from './connections.js';

/** Bounded timeout for an introspection QUERY. The CONNECT cost is
 * absorbed by the per-database pool (see `withPgDatabaseClient`)
 * which has its own generous handshake budget; once the pool is
 * warm, the queries against information_schema are sub-second. */
const INTROSPECT_TIMEOUT_MS = 8_000;

/** Filter sets for the "show system schemas" toggle. Anything in here
 * is hidden by default; flip `options.showSystemSchemas` to include. */
const PG_SYSTEM_SCHEMAS = new Set([
  'pg_catalog',
  'information_schema',
  'pg_toast',
]);
const MYSQL_SYSTEM_DATABASES = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
]);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Introspection query timed out after ${ms}ms`);
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

function classifyTableKind(rawType: string | null | undefined): SchemaNodeKind {
  if (!rawType) return 'table';
  const upper = rawType.toUpperCase();
  if (upper.includes('VIEW')) return 'view';
  return 'table';
}

/* --- Postgres ---------------------------------------------------------- */

interface PgRow {
  [k: string]: unknown;
}

async function listPgDatabases(
  ctx: ActiveConnectionContext,
  showTemplates: boolean,
): Promise<SchemaTreeNode[]> {
  // `has_database_privilege(datname, 'CONNECT')` filters down to dbs
  // the user can actually open — otherwise the tree would taunt them
  // with names they can't expand.
  const sql = `
    SELECT datname AS name
    FROM pg_database
    WHERE has_database_privilege(datname, 'CONNECT')
      ${showTemplates ? '' : 'AND datistemplate = false'}
    ORDER BY datname`;
  const pool = ctx.pool as unknown as import('pg').Pool;
  const res = await withTimeout(
    pool.query<{ name: string }>(sql),
    INTROSPECT_TIMEOUT_MS,
  );
  return res.rows.map((r) => ({
    name: r.name,
    kind: 'database' as const,
  }));
}

async function listPgSchemas(
  id: string,
  databaseName: string,
  showSystem: boolean,
): Promise<SchemaTreeNode[]> {
  return withPgDatabaseClient(id, databaseName, async (client) => {
    // `information_schema.schemata` predates PG 8 and is stable
    // across every version we care about. We fall back to
    // `pg_namespace` if (for whatever reason) the user's role can't
    // see information_schema — surfaces "real" perm errors instead
    // of an empty list.
    let rows: Array<{ name: string }>;
    try {
      const res = await withTimeout(
        client.query<{ name: string }>(
          `SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name`,
        ),
        INTROSPECT_TIMEOUT_MS,
      );
      rows = res.rows;
    } catch (err) {
      console.warn(
        `[introspection] information_schema.schemata failed for ${databaseName}, falling back to pg_namespace:`,
        err,
      );
      const res = await withTimeout(
        client.query<{ name: string }>(
          `SELECT nspname AS name FROM pg_namespace ORDER BY nspname`,
        ),
        INTROSPECT_TIMEOUT_MS,
      );
      rows = res.rows;
    }
    return rows
      .filter((r) => {
        if (showSystem) return true;
        // pg_temp_* / pg_toast_temp_* are session-scoped — always hide.
        if (r.name.startsWith('pg_temp_') || r.name.startsWith('pg_toast_temp_')) {
          return false;
        }
        return !PG_SYSTEM_SCHEMAS.has(r.name);
      })
      .map((r) => ({ name: r.name, kind: 'schema' as const }));
  });
}

async function listPgTables(
  id: string,
  databaseName: string,
  schemaName: string,
): Promise<SchemaTreeNode[]> {
  return withPgDatabaseClient(id, databaseName, async (client) => {
    const res = await withTimeout(
      client.query<PgRow>(
        `SELECT table_name AS name, table_type AS type
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schemaName],
      ),
      INTROSPECT_TIMEOUT_MS,
    );
    return res.rows.map((r) => ({
      name: String(r.name),
      kind: classifyTableKind(r.type as string | null | undefined),
    }));
  });
}

/* --- MySQL / MariaDB --------------------------------------------------- */

interface MysqlRow {
  [k: string]: unknown;
}

async function listMysqlDatabases(
  ctx: ActiveConnectionContext,
  showSystem: boolean,
): Promise<SchemaTreeNode[]> {
  const pool = ctx.pool as unknown as import('mysql2/promise').Pool;
  const [rows] = (await withTimeout(
    pool.query('SHOW DATABASES'),
    INTROSPECT_TIMEOUT_MS,
  )) as [Array<{ Database?: string }>, unknown];
  return rows
    .map((r) => r.Database ?? '')
    .filter((name) => name.length > 0)
    .filter((name) => showSystem || !MYSQL_SYSTEM_DATABASES.has(name.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, kind: 'database' as const }));
}

async function listMysqlTables(
  ctx: ActiveConnectionContext,
  databaseName: string,
): Promise<SchemaTreeNode[]> {
  const pool = ctx.pool as unknown as import('mysql2/promise').Pool;
  const result = (await withTimeout(
    pool.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [databaseName],
    ),
    INTROSPECT_TIMEOUT_MS,
  )) as [MysqlRow[], unknown];
  return result[0].map((r) => ({
    name: String(r.name),
    kind: classifyTableKind(r.type as string | null | undefined),
  }));
}

/* --- Dispatch ---------------------------------------------------------- */

/** Fetch the children of the node addressed by `path` from the LIVE
 * connection for `id`. The caller (the IPC layer) then merges the
 * result into the cache and broadcasts. Returns `null` when the
 * datasource is not currently connected — the cache stays intact. */
export async function fetchChildren(
  id: string,
  path: SchemaNodePath,
): Promise<SchemaTreeNode[] | null> {
  const ctx = getActiveConnection(id);
  if (!ctx) return null;
  const driver: DriverKind = ctx.driver;
  const opts = ctx.config.options ?? {};
  const showSystem = opts.showSystemSchemas === true;
  const showTemplates = opts.showTemplateDatabases === true;

  if (driver === 'postgres') {
    if (path.length === 0) return listPgDatabases(ctx, showTemplates);
    if (path.length === 1) return listPgSchemas(id, path[0]!, showSystem);
    if (path.length === 2) return listPgTables(id, path[0]!, path[1]!);
    throw new NodeGripError(
      'VALIDATION_ERROR',
      `Path too deep for postgres tree: [${path.join(', ')}]`,
    );
  }

  // mysql / mariadb share the same flat structure.
  if (path.length === 0) return listMysqlDatabases(ctx, showSystem);
  if (path.length === 1) return listMysqlTables(ctx, path[0]!);
  throw new NodeGripError(
    'VALIDATION_ERROR',
    `Path too deep for ${driver} tree: [${path.join(', ')}]`,
  );
}
