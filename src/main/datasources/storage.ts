import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { NodeGripError } from '~shared/types/errors.js';
import type { DatasourceConfig } from '~shared/types/datasource.js';
import { clearPassword } from './vault.js';

const DATASOURCES_SUBDIR = path.join('.nodegrip', 'datasources');

/** Per-project directory holding one `<id>.json` per data source. We
 * keep one file per source so `git diff` reads cleanly when configs
 * are version-controlled. The directory is created lazily on first
 * save. */
function datasourcesDir(folderPath: string): string {
  return path.join(folderPath, DATASOURCES_SUBDIR);
}

function configPath(folderPath: string, id: string): string {
  // Defence in depth: reject ids with anything that could escape the
  // directory. UUIDs are alphanumeric + dashes, and the renderer never
  // builds these — but main-process IPC must not trust input.
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    throw new NodeGripError('VALIDATION_ERROR', `Invalid datasource id: ${id}`);
  }
  return path.join(datasourcesDir(folderPath), `${id}.json`);
}

function isValidConfig(value: unknown): value is DatasourceConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<DatasourceConfig>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.driver === 'string' &&
    (c.driver === 'postgres' || c.driver === 'mysql' || c.driver === 'mariadb') &&
    typeof c.host === 'string' &&
    typeof c.port === 'number' &&
    typeof c.user === 'string' &&
    typeof c.database === 'string' &&
    typeof c.passwordMode === 'string' &&
    typeof c.createdAt === 'string' &&
    typeof c.updatedAt === 'string'
  );
}

/** Atomic write: serialise to a temp file in the same directory, then
 * rename over the target. `rename(2)` is atomic on the same filesystem
 * so an interrupted save can never leave a half-written JSON behind. */
async function atomicWriteJson(target: string, payload: unknown): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${randomUUID().slice(0, 8)}`);
  const json = JSON.stringify(payload, null, 2) + '\n';
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, target);
}

export function newDatasourceId(): string {
  return randomUUID();
}

export async function listDatasources(
  folderPath: string,
): Promise<DatasourceConfig[]> {
  const dir = datasourcesDir(folderPath);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // First-run / project never had a datasource — that's fine.
    if (code === 'ENOENT') return [];
    throw new NodeGripError(
      'READ_FAILED',
      `Failed to read datasources directory in ${folderPath}`,
      err,
    );
  }

  const configs: DatasourceConfig[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isValidConfig(parsed)) {
        // Skip malformed entries rather than failing the entire list —
        // a single corrupted file shouldn't lock the user out of every
        // other connection.
        console.warn(`[datasources] skipping malformed config: ${filePath}`);
        continue;
      }
      configs.push(parsed);
    } catch (err) {
      console.warn(`[datasources] failed to parse ${filePath}:`, err);
    }
  }

  configs.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return configs;
}

export async function getDatasource(
  folderPath: string,
  id: string,
): Promise<DatasourceConfig | null> {
  let raw;
  try {
    raw = await fs.readFile(configPath(folderPath, id), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new NodeGripError(
      'READ_FAILED',
      `Failed to read datasource ${id}`,
      err,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      `Datasource ${id} is not valid JSON`,
      err,
    );
  }
  if (!isValidConfig(parsed)) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      `Datasource ${id} has a malformed shape`,
    );
  }
  return parsed;
}

/** Persist `config`. Assigns an id when missing, and refreshes
 * `createdAt`/`updatedAt`. Enforces unique `name` per project. */
export async function saveDatasource(
  folderPath: string,
  config: DatasourceConfig,
): Promise<DatasourceConfig> {
  if (typeof config.name !== 'string' || config.name.trim().length === 0) {
    throw new NodeGripError('VALIDATION_ERROR', 'Name is required');
  }
  if (typeof config.host !== 'string' || config.host.trim().length === 0) {
    throw new NodeGripError('VALIDATION_ERROR', 'Host is required');
  }
  if (
    typeof config.port !== 'number' ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  ) {
    throw new NodeGripError('VALIDATION_ERROR', 'Port must be between 1 and 65535');
  }
  if (
    config.passwordMode !== 'forever' &&
    config.passwordMode !== 'session' &&
    config.passwordMode !== 'never'
  ) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      `Unknown password mode: ${String(config.passwordMode)}`,
    );
  }

  const id = config.id?.trim() || newDatasourceId();
  const existing = await getDatasource(folderPath, id).catch(() => null);

  // Unique-name check: scan siblings and reject collisions with a
  // different id. Case-insensitive to match DataGrip behaviour.
  const siblings = await listDatasources(folderPath);
  const collision = siblings.find(
    (s) =>
      s.id !== id &&
      s.name.localeCompare(config.name, undefined, { sensitivity: 'base' }) === 0,
  );
  if (collision) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      `A datasource named "${config.name}" already exists in this project`,
    );
  }

  const now = new Date().toISOString();
  const next: DatasourceConfig = {
    ...config,
    id,
    name: config.name.trim(),
    host: config.host.trim(),
    user: config.user.trim(),
    database: config.database.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await atomicWriteJson(configPath(folderPath, id), next);
  return next;
}

export async function removeDatasource(
  folderPath: string,
  id: string,
): Promise<void> {
  try {
    await fs.unlink(configPath(folderPath, id));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Already gone is fine — idempotent remove.
    if (code === 'ENOENT') return;
    throw new NodeGripError(
      'READ_FAILED',
      `Failed to remove datasource ${id}`,
      err,
    );
  }
}
