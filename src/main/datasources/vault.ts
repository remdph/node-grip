import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

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

/** Derive a 32-byte AES-256 key from a passphrase using PBKDF2. */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return require('node:crypto').pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
}

/** Encrypt plaintext using AES-256-GCM with a passphrase.
 * Returns base64-encoded string containing salt + iv + ciphertext + tag. */
function encryptAes(plaintext: string, passphrase: string): string {
  const salt = randomBytes(32);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: salt(32) + iv(16) + tag(16) + ciphertext
  const result = Buffer.concat([salt, iv, tag, encrypted]);
  return result.toString('base64');
}

/** Decrypt a string produced by encryptAes. Throws on integrity failure. */
function decryptAes(ciphertext: string, passphrase: string): string {
  const data = Buffer.from(ciphertext, 'base64');
  if (data.length < 64) throw new NodeGripError('VALIDATION_ERROR', 'Invalid vault blob');
  const salt = data.subarray(0, 32);
  const iv = data.subarray(32, 48);
  const tag = data.subarray(48, 64);
  const encrypted = data.subarray(64);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Persisted shape: `{ <datasourceId>: <base64-encrypted-blob> }`. The
 * file lives next to the datasource configs so moving the project
 * folder keeps the passwords with it. */
type PersistedVault = Record<string, string>;

/** Project-level passphrase — set once per project on first creation.
 * Stored in memory; defaults to the built-in default if not set. */
const projectPassphrases = new Map<string, string>();

/** Default passphrase for new projects or projects without a custom passphrase.
 * Passwords are still encrypted (not stored in plaintext) but the key is
 * known - this protects against casual file access but not determined attackers. */
const DEFAULT_PASSPHRASE = 'NodeGrip-v1-Built-in-Default-Key-2024';

/** Set the passphrase for a project. Call this before any vault operations
 * when opening a project. Pass undefined to reset to the default passphrase. */
export function setProjectPassphrase(folderPath: string, passphrase: string | undefined): void {
  if (passphrase) {
    projectPassphrases.set(folderPath, passphrase);
  } else {
    projectPassphrases.delete(folderPath);
  }
}

/** Get the effective passphrase for a project. */
function getProjectPassphrase(folderPath: string): string {
  return projectPassphrases.get(folderPath) ?? DEFAULT_PASSPHRASE;
}

async function readPersisted(folderPath: string): Promise<PersistedVault> {
  try {
    const raw = await fs.readFile(vaultPath(folderPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PersistedVault;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
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

function encryptWithPassphrase(plaintext: string, folderPath: string): string {
  const passphrase = getProjectPassphrase(folderPath);
  return encryptAes(plaintext, passphrase);
}

function decryptWithPassphrase(ciphertext: string, folderPath: string): string {
  const passphrase = getProjectPassphrase(folderPath);
  return decryptAes(ciphertext, passphrase);
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
  await clearPassword(folderPath, id);

  if (mode === 'never') return;
  if (mode === 'session') {
    sessionVault.set(sessionKey(folderPath, id), password);
    return;
  }
  if (mode === 'forever') {
    // Always use project-specific AES-256-GCM encryption with the
    // project's passphrase (custom or built-in default)
    const cipher = encryptWithPassphrase(password, folderPath);
    const vault = await readPersisted(folderPath);
    vault[id] = cipher;
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
  try {
    return decryptWithPassphrase(cipher, folderPath);
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