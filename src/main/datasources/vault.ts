import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { NodeGripError } from '~shared/types/errors.js';
import type { PasswordSaveMode } from '~shared/types/datasource.js';

const VAULT_FILE = path.join('.nodegrip', 'passwords.json');

/** In-memory per-process session vault. Cleared on app quit. Keyed by
 * `<folderPath>:<datasourceId>` so the same id in two different projects
 * doesn't collide if the user opens both at once. */
const sessionVault = new Map<string, string>();

function sessionKey(folderPath: string, id: string): string {
  return `${folderPath}::${id}`;
}

function vaultPath(folderPath: string): string {
  return path.join(folderPath, VAULT_FILE);
}

/** Persisted shape: `{ <datasourceId>: <base64-encrypted-blob> }`. The
 * file lives next to the datasource configs so moving the project
 * folder keeps the passwords with it (decryption still requires the
 * same OS user / keychain, which is the desired property). */
type PersistedVault = Record<string, string>;

async function readPersisted(folderPath: string): Promise<PersistedVault> {
  try {
    const raw = await fs.readFile(vaultPath(folderPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PersistedVault;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    // A corrupted vault is recoverable by re-entering the password,
    // so we don't fail-loud — log + treat as empty.
    console.warn(`[vault] failed to read ${vaultPath(folderPath)}:`, err);
    return {};
  }
}

async function writePersisted(
  folderPath: string,
  vault: PersistedVault,
): Promise<void> {
  const target = vaultPath(folderPath);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.passwords.json.tmp-${randomUUID().slice(0, 8)}`);
  await fs.writeFile(tmp, JSON.stringify(vault, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, target);
}

function ensureSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new NodeGripError(
      'VALIDATION_ERROR',
      'OS keychain unavailable — cannot save passwords with mode "forever". ' +
        'Pick "Until restart" or "Never" instead.',
    );
  }
}

/** Persist a password according to `mode`. */
export async function setPassword(
  folderPath: string,
  id: string,
  password: string,
  mode: PasswordSaveMode,
): Promise<void> {
  if (typeof password !== 'string') {
    throw new NodeGripError('VALIDATION_ERROR', 'Password must be a string');
  }
  // Always start clean: a previous mode may have left state in the
  // other tier. e.g. switching from forever → session must wipe the
  // encrypted blob from disk.
  await clearPassword(folderPath, id);

  if (mode === 'never') return;
  if (mode === 'session') {
    sessionVault.set(sessionKey(folderPath, id), password);
    return;
  }
  if (mode === 'forever') {
    ensureSafeStorage();
    const cipher = safeStorage.encryptString(password);
    const vault = await readPersisted(folderPath);
    vault[id] = cipher.toString('base64');
    await writePersisted(folderPath, vault);
    return;
  }
  throw new NodeGripError('VALIDATION_ERROR', `Unknown password mode: ${String(mode)}`);
}

/** Return the password if the vault has one, else null. Checks the
 * in-memory session vault first (fast path), then the encrypted blob. */
export async function getPassword(
  folderPath: string,
  id: string,
): Promise<string | null> {
  const sessionHit = sessionVault.get(sessionKey(folderPath, id));
  if (sessionHit !== undefined) return sessionHit;

  const vault = await readPersisted(folderPath);
  const cipher = vault[id];
  if (!cipher) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    // We have an encrypted blob but no decryption capability — most
    // likely the user moved the .nodegrip folder to another machine
    // or another user account. Treat as "missing" so the renderer
    // prompts again.
    return null;
  }
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
  } catch (err) {
    console.warn(`[vault] failed to decrypt password for ${id}:`, err);
    return null;
  }
}

export async function hasPassword(
  folderPath: string,
  id: string,
): Promise<boolean> {
  if (sessionVault.has(sessionKey(folderPath, id))) return true;
  const vault = await readPersisted(folderPath);
  return Object.prototype.hasOwnProperty.call(vault, id);
}

export async function clearPassword(
  folderPath: string,
  id: string,
): Promise<void> {
  sessionVault.delete(sessionKey(folderPath, id));
  const vault = await readPersisted(folderPath);
  if (Object.prototype.hasOwnProperty.call(vault, id)) {
    delete vault[id];
    await writePersisted(folderPath, vault);
  }
}
