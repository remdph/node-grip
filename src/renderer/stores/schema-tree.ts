import { create } from 'zustand';

import { ipc } from '../lib/ipc.js';
import type {
  SchemaNodePath,
  SchemaTree,
  SchemaTreeNode,
} from '~shared/types/schema-tree.js';

/** Map key for the expand-state Set: `<datasourceId>:<segment>/<segment>`.
 * The leading id keeps two datasources from accidentally sharing
 * expansion state when their database names collide. */
function expandKey(id: string, path: SchemaNodePath): string {
  return `${id}:${path.join('/')}`;
}

/** Map key for per-node in-flight tracking. Mirrors `expandKey`. */
function fetchKey(id: string, path: SchemaNodePath): string {
  return `${id}:${path.join('/')}`;
}

interface SchemaTreeState {
  /** Latest cached tree per datasource id. Hydrated lazily — null /
   * missing means "renderer hasn't asked yet". */
  trees: Record<string, SchemaTree>;
  /** Renderer-side expand state. Lives here so collapsing a node and
   * re-expanding it doesn't lose intermediate state. */
  expanded: Set<string>;
  /** Set of node-paths currently fetching children. Used by rows to
   * render a "Loading…" placeholder + suppress duplicate fetches. */
  fetching: Set<string>;
  /** Per-id last-error message — surfaces in the row as a "stale"
   * hint. Cleared on next successful fetch. */
  errors: Record<string, string>;

  /** One-shot subscription to main's tree-change broadcast. */
  bootstrap(): () => void;
  /** Ensure a tree is in-store for `id`. No-op when already
   * hydrated. Lazy by design — only the panel rows that subscribe
   * trigger fetches. */
  hydrate(folderPath: string, id: string): void;
  /** Toggle the expand state of a node. When expanding for the first
   * time AND no children are cached, kicks off a fetch. */
  toggleExpanded(folderPath: string, id: string, path: SchemaNodePath): void;
  /** Force-fetch the children at `path`. Used by Refresh actions and
   * by `toggleExpanded` for first-expand. */
  refreshNode(
    folderPath: string,
    id: string,
    path: SchemaNodePath,
  ): Promise<void>;
  /** Used by the IPC subscription handler — components shouldn't call. */
  set(tree: SchemaTree): void;

  /** Queries below are pure selectors — keep them on the store for
   * convenience so callers can `useSchemaTreeStore(s => s.isExpanded(...))`. */
  isExpanded(id: string, path: SchemaNodePath): boolean;
  isFetching(id: string, path: SchemaNodePath): boolean;
}

// Module-level flag so the IPC subscription is registered ONCE per
// renderer process — surviving component unmount / HMR. Subscribers
// returned from `bootstrap()` are no-ops so React's effect cleanup
// can't drop the long-lived listener.
let subscribed = false;

export const useSchemaTreeStore = create<SchemaTreeState>((set, get) => ({
  trees: {},
  expanded: new Set(),
  fetching: new Set(),
  errors: {},

  bootstrap: () => {
    if (!subscribed) {
      subscribed = true;
      ipc.datasource.onSchemaTreeChange(({ tree }) => {
        get().set(tree);
      });
    }
    return () => {};
  },

  hydrate: (folderPath, id) => {
    if (get().trees[id]) return;
    void ipc.datasource.getSchemaTree(folderPath, id).then((tree) => {
      if (tree) get().set(tree);
    });
  },

  toggleExpanded: (folderPath, id, path) => {
    const key = expandKey(id, path);
    const expanded = get().expanded;
    const next = new Set(expanded);
    const wasExpanded = next.has(key);
    if (wasExpanded) {
      next.delete(key);
    } else {
      next.add(key);
    }
    set({ expanded: next });

    if (wasExpanded) return;

    // First-time expand → fetch if children aren't cached yet.
    const tree = get().trees[id];
    const existing = findNode(tree, path);
    if (existing?.children === undefined) {
      void get().refreshNode(folderPath, id, path);
    }
  },

  refreshNode: async (folderPath, id, path) => {
    const key = fetchKey(id, path);
    if (get().fetching.has(key)) return;
    set((s) => {
      const next = new Set(s.fetching);
      next.add(key);
      return { fetching: next };
    });
    try {
      // The actual mutation lands via the onSchemaTreeChange
      // broadcast (main writes the cache + emits). We ignore the
      // returned children — the broadcast wins.
      await ipc.datasource.expandSchemaNode(folderPath, id, path);
      set((s) => {
        const errors = { ...s.errors };
        delete errors[`${id}:${path.join('/')}`];
        return { errors };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refresh failed';
      // Surface the failure to DevTools so the user can see what
      // went wrong — the UI-side hint is necessarily compact.
      console.error(
        `[schema-tree] expand failed (id=${id}, path=[${path.join('/')}]):`,
        err,
      );
      set((s) => ({
        errors: { ...s.errors, [`${id}:${path.join('/')}`]: message },
      }));
    } finally {
      set((s) => {
        const next = new Set(s.fetching);
        next.delete(key);
        return { fetching: next };
      });
    }
  },

  set: (tree) =>
    set((s) => ({
      trees: { ...s.trees, [tree.id]: tree },
    })),

  isExpanded: (id, path) => get().expanded.has(expandKey(id, path)),
  isFetching: (id, path) => get().fetching.has(fetchKey(id, path)),
}));

/** Walk a tree to find the node at `path`. Returns `null` when the
 * tree doesn't have that node materialised yet (children undefined
 * along the way). The renderer uses this to decide whether to show
 * "Loading…" or render the cached children. */
export function findNode(
  tree: SchemaTree | undefined,
  path: SchemaNodePath,
): SchemaTreeNode | null {
  if (!tree) return null;
  if (path.length === 0) {
    // Root — represented as a synthetic node so callers can read
    // `children` uniformly.
    return { name: '', kind: 'database', children: tree.databases };
  }
  let siblings: SchemaTreeNode[] | undefined = tree.databases;
  let current: SchemaTreeNode | null = null;
  for (const segment of path) {
    if (!siblings) return null;
    const found: SchemaTreeNode | undefined = siblings.find(
      (n) => n.name === segment,
    );
    if (!found) return null;
    current = found;
    siblings = found.children;
  }
  return current;
}
