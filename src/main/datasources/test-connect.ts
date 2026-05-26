import type {
  DatasourceConfig,
  TestConnectionResult,
} from '~shared/types/datasource.js';
import { classifyError } from './error-classify.js';

/** How long we wait before declaring a test connection dead. Driver-
 * level timeouts vary — pg defaults to no timeout, mysql2 to 10s — so
 * we wrap each test in our own race to keep the UX predictable. */
const TEST_TIMEOUT_MS = 7_000;

/** Wrap a promise in a timeout that rejects when the test takes too
 * long. The driver's own `end()` is still called from the caller's
 * `finally`, so a stalled connection is force-closed. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Test connection timed out after ${ms}ms`);
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

async function testPostgres(
  config: DatasourceConfig,
  password: string | undefined,
): Promise<{ serverVersion: string }> {
  // Lazy-required to keep the cold-start cheap when the user hasn't
  // touched a datasource yet. pg's CJS export plays nicely with this.
  const { Client } = await import('pg');
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: password ?? '',
    database: config.database,
    connectionTimeoutMillis: TEST_TIMEOUT_MS,
    // Statement timeout guards a hung server during the version query.
    statement_timeout: TEST_TIMEOUT_MS,
  });
  try {
    await withTimeout(client.connect(), TEST_TIMEOUT_MS);
    const res = await withTimeout(
      client.query<{ version: string }>('SELECT version() AS version'),
      TEST_TIMEOUT_MS,
    );
    const serverVersion = res.rows[0]?.version ?? 'PostgreSQL (version unknown)';
    return { serverVersion };
  } finally {
    // `end()` rejects in some edge cases; swallow because we've
    // already captured the test result.
    await client.end().catch(() => {});
  }
}

interface MysqlVersionRow {
  version: string;
}

async function testMysql(
  config: DatasourceConfig,
  password: string | undefined,
): Promise<{ serverVersion: string }> {
  // mysql2 covers both MySQL and MariaDB servers — protocol-compatible.
  const mysql = await import('mysql2/promise');
  const connection = await withTimeout(
    mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: password ?? '',
      database: config.database || undefined,
      connectTimeout: TEST_TIMEOUT_MS,
    }),
    TEST_TIMEOUT_MS,
  );
  try {
    // mysql2's `query<T>()` generic constrains T to its own packet
    // unions, which makes typing a plain row shape awkward — drop the
    // generic and treat the tuple's first element as a row array.
    const result = (await withTimeout(
      connection.query('SELECT VERSION() AS version'),
      TEST_TIMEOUT_MS,
    )) as [MysqlVersionRow[], unknown];
    const first = Array.isArray(result[0]) ? result[0][0] : undefined;
    const serverVersion = first?.version ?? 'MySQL/MariaDB (version unknown)';
    return { serverVersion };
  } finally {
    await connection.end().catch(() => {});
  }
}

/** Open a one-shot connection, run a version query, tear it down. The
 * caller (`datasource.testConnect` IPC) merely surfaces the structured
 * result; this module owns all driver-specific knobs. */
export async function testConnect(
  config: DatasourceConfig,
  password: string | undefined,
): Promise<TestConnectionResult> {
  const startedAt = performance.now();
  try {
    let result: { serverVersion: string };
    if (config.driver === 'postgres') {
      result = await testPostgres(config, password);
    } else if (config.driver === 'mysql' || config.driver === 'mariadb') {
      result = await testMysql(config, password);
    } else {
      return {
        ok: false,
        errorKind: 'unknown',
        error: `Unsupported driver: ${String((config as DatasourceConfig).driver)}`,
      };
    }
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
      serverVersion: result.serverVersion,
    };
  } catch (err) {
    const { kind, message } = classifyError(err);
    return {
      ok: false,
      errorKind: kind,
      error: message,
    };
  }
}
