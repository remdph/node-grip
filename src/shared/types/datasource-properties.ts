import type { DriverKind } from './datasource.js';

/** Metadata for one row in the Advanced tab's property grid. The
 * renderer renders the description panel from this; main reads
 * `type` to coerce values out of the JSON config when handing them
 * to the driver. */
export interface DriverPropertyMeta {
  key: string;
  type: 'string' | 'number' | 'boolean';
  /** Human-readable description shown when the row is selected. */
  description: string;
  /** Hint for placeholders / units (e.g. "ms", "bytes"). */
  unit?: string;
}

/** PostgreSQL connection options that map 1:1 onto `pg.Client`
 * constructor fields. Keep this list curated — listing every pg
 * parameter would be noise; the top ~10 cover real use cases. */
const POSTGRES_PROPERTIES: DriverPropertyMeta[] = [
  {
    key: 'application_name',
    type: 'string',
    description:
      'String identifier surfaced in pg_stat_activity and server logs. Defaults to "node".',
  },
  {
    key: 'statement_timeout',
    type: 'number',
    unit: 'ms',
    description:
      'Abort any statement taking longer than this many milliseconds. 0 disables.',
  },
  {
    key: 'query_timeout',
    type: 'number',
    unit: 'ms',
    description:
      'Client-side timeout for queries. Faster than statement_timeout when the connection is dead.',
  },
  {
    key: 'idle_in_transaction_session_timeout',
    type: 'number',
    unit: 'ms',
    description:
      'Close a session that holds an idle transaction for longer than this many ms.',
  },
  {
    key: 'lock_timeout',
    type: 'number',
    unit: 'ms',
    description: 'Abort any statement waiting on a lock for longer than this.',
  },
  {
    key: 'keepAlive',
    type: 'boolean',
    description: 'Enable TCP keep-alive on the underlying socket.',
  },
  {
    key: 'keepAliveInitialDelayMillis',
    type: 'number',
    unit: 'ms',
    description:
      'Delay before TCP keep-alive probes start (only meaningful with keepAlive on).',
  },
  {
    key: 'parseInputDatesAsUTC',
    type: 'boolean',
    description:
      'Treat date strings the client sends as UTC instead of the local zone.',
  },
];

/** MySQL / MariaDB connection options that map onto `mysql2`'s
 * `createConnection` config. */
const MYSQL_PROPERTIES: DriverPropertyMeta[] = [
  {
    key: 'charset',
    type: 'string',
    description:
      'Character set / collation used by the connection (e.g. "utf8mb4_unicode_ci").',
  },
  {
    key: 'connectTimeout',
    type: 'number',
    unit: 'ms',
    description: 'Initial connection timeout.',
  },
  {
    key: 'dateStrings',
    type: 'boolean',
    description:
      'Return DATE / DATETIME / TIMESTAMP values as strings rather than Date objects.',
  },
  {
    key: 'decimalNumbers',
    type: 'boolean',
    description:
      'Return DECIMAL / NEWDECIMAL as JS numbers instead of strings (loses precision).',
  },
  {
    key: 'multipleStatements',
    type: 'boolean',
    description:
      'Allow `;`-separated SQL in a single query. Risky — disable unless you need it.',
  },
  {
    key: 'rowsAsArray',
    type: 'boolean',
    description:
      'Return rows as arrays instead of objects. Slightly faster, drops column-name access.',
  },
  {
    key: 'enableKeepAlive',
    type: 'boolean',
    description: 'Enable TCP keep-alive on the underlying socket.',
  },
  {
    key: 'keepAliveInitialDelay',
    type: 'number',
    unit: 'ms',
    description: 'Delay before TCP keep-alive probes start.',
  },
];

const REGISTRY: Record<DriverKind, DriverPropertyMeta[]> = {
  postgres: POSTGRES_PROPERTIES,
  mysql: MYSQL_PROPERTIES,
  mariadb: MYSQL_PROPERTIES,
};

export function listDriverProperties(driver: DriverKind): DriverPropertyMeta[] {
  return REGISTRY[driver];
}

export function findDriverProperty(
  driver: DriverKind,
  key: string,
): DriverPropertyMeta | undefined {
  return REGISTRY[driver].find((p) => p.key === key);
}
