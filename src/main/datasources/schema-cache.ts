import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { NodeGripError } from '~shared/types/errors.js';
import type { DriverKind } from '~shared/types/datasource.js';
import type {
  SchemaNodePath,
  SchemaTree,
  SchemaTreeNode,
} from '~shared/types/schema-tree.js';

const CACHE_SUBDIR = path.join('.nodegrip', 'schema-cache');

function cacheDir(folderPath: string): string {
  return path.join(folderPath, CACHE_SUBDIR);
}

function cachePath(folderPath: string, id: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    throw new NodeGripError('VALIDATION_ERROR', `Invalid datasource id: ${id}`);
  }
  return path.join(cacheDir(folderPath), `${id}.json`);
}

async function atomicWriteJson(target: string, payload: unknown): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${randomUUID().slice(0, 8)}`);
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, target);
}

function isValidTree(value: unknown): value is SchemaTree {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<SchemaTree>;
  return (
    typeof t.id === 'string' &&
    typeof t.driver === 'string' &&
    Array.isArray(t.databases)
  );
}

export async function loadSchemaTree(
  folderPath: string,
  id: string,
): Promise<SchemaTree | null> {
  try {
    const raw = await fs.readFile(cachePath(folderPath, id), 'utf8');
    const parsed = JSON.parse(raw);
    if (!isValidTree(parsed)) return null;
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    // A corrupted cache shouldn't break the UI — treat as missing.
    console.warn(`[schema-cache] failed to read cache for ${id}:`, err);
    return null;
  }
}

export async function saveSchemaTree(
  folderPath: string,
  tree: SchemaTree,
): Promise<void> {
  await atomicWriteJson(cachePath(folderPath, tree.id), tree);
}

export async function clearSchemaTree(
  folderPath: string,
  id: string,
): Promise<void> {
  try {
    await fs.unlink(cachePath(folderPath, id));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    console.warn(`[schema-cache] failed to clear cache for ${id}:`, err);
  }
}

/** Build a fresh, empty tree for a brand-new cache. The renderer
 * receives this on first connect before any introspection runs. */
export function emptyTree(id: string, driver: DriverKind): SchemaTree {
  return { id, driver, databases: [] };
}

/** Pure helper: produce a new tree with the children at `path`
 * replaced by `children`. Used by both the IPC layer (after
 * `fetchChildren`) and tests. */
export function replaceNodeChildren(
  tree: SchemaTree,
  treePath: SchemaNodePath,
  children: SchemaTreeNode[],
): SchemaTree {
  const now = new Date().toISOString();
  // Empty path = replace the root list of databases.
  if (treePath.length === 0) {
    return { ...tree, databases: children, refreshedAt: now };
  }
  // Walk down `treePath`, cloning each node we pass through so React's
  // reference checks notice the change. Missing intermediate nodes
  // get materialised as opaque placeholders so the cache still
  // captures the user's expansion.
  const cloneChildren = (
    siblings: SchemaTreeNode[],
    depth: number,
  ): SchemaTreeNode[] => {
    const targetName = treePath[depth];
    if (targetName === undefined) return siblings;
    const idx = siblings.findIndex((n) => n.name === targetName);
    const isLeaf = depth === treePath.length - 1;
    if (idx === -1) {
      // Missing — synthesize. Kind is unknown so we infer from depth
      // (database at 0, schema at 1, etc.) using the driver hints
      // baked into the tree's children pattern. For lazy expansion
      // this is rare; in practice the parent path was returned by a
      // previous fetch.
      const inferredKind: SchemaTreeNode['kind'] =
        depth === 0 ? 'database' : depth === 1 ? 'schema' : 'table';
      const synthetic: SchemaTreeNode = {
        name: targetName,
        kind: inferredKind,
        children: isLeaf ? children : undefined,
        refreshedAt: isLeaf ? now : undefined,
      };
      return [...siblings, synthetic];
    }
    const existing = siblings[idx]!;
    const updated: SchemaTreeNode = isLeaf
      ? { ...existing, children, refreshedAt: now }
      : {
          ...existing,
          children: cloneChildren(existing.children ?? [], depth + 1),
        };
    const next = siblings.slice();
    next[idx] = updated;
    return next;
  };

  return {
    ...tree,
    databases: cloneChildren(tree.databases, 0),
    // Only bump the root timestamp when refreshing the root list.
    refreshedAt: tree.refreshedAt,
  };
}
