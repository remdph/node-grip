import type { DriverKind } from './datasource.js';

/** Kind discriminator for a tree node. Drives the icon picked by the
 * renderer; `database` / `schema` / `table` / `view` cover what we
 * surface in v0.1. Future iterations may add materialised_view,
 * function, procedure, sequence, etc. */
export type SchemaNodeKind = 'database' | 'schema' | 'table' | 'view';

/** One node in the cached structure. `children` is `undefined` when
 * the level has never been fetched (so the renderer knows to lazy-
 * load on expand), and `[]` when fetched-and-empty. */
export interface SchemaTreeNode {
  name: string;
  kind: SchemaNodeKind;
  children?: SchemaTreeNode[];
  /** ISO timestamp the children of this node were last refreshed.
   * Surfaced as a "stale" hint when older than the parent connection
   * was last connected. */
  refreshedAt?: string;
}

/** Per-datasource cache. The top-level `databases` are themselves
 * `SchemaTreeNode`s with kind `'database'` — keeping them homogeneous
 * with deeper levels keeps the recursive tree code one branch. */
export interface SchemaTree {
  /** Datasource id this cache belongs to. */
  id: string;
  /** Mirrored from the datasource config so the renderer can pick the
   * right icon style without an extra IPC. */
  driver: DriverKind;
  /** Root databases. For MySQL/MariaDB these are the only level above
   * tables; for PostgreSQL they nest one more level deep (schemas). */
  databases: SchemaTreeNode[];
  /** When `databases` was last refreshed. */
  refreshedAt?: string;
}

/** Path used to address a node inside a tree — sequence of names from
 * the root down. `[]` is the root itself (returns the list of
 * databases on expand); `['inverio']` is a database; `['inverio',
 * 'public']` is a schema under that database; etc. */
export type SchemaNodePath = string[];
