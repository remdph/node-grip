import { BrowserWindow } from 'electron';
import path from 'node:path';

import {
  connect as connectPool,
  disconnect as disconnectPool,
  forget as forgetConnection,
  getActiveConnection,
  getState as getConnectionStateNow,
  subscribe as subscribeConnectionState,
} from '../datasources/connections.js';
import { fetchChildren } from '../datasources/introspection.js';
import {
  clearSchemaTree,
  emptyTree,
  loadSchemaTree,
  replaceNodeChildren,
  saveSchemaTree,
} from '../datasources/schema-cache.js';
import {
  getDatasource,
  listDatasources,
  removeDatasource,
  saveDatasource,
} from '../datasources/storage.js';
import { testConnect } from '../datasources/test-connect.js';
import {
  clearPassword,
  getPassword,
  hasPassword,
  setPassword,
} from '../datasources/vault.js';
import { NodeGripError } from '~shared/types/errors.js';
import { IPC_CHANNELS } from '~shared/types/ipc.js';
import type {
  ConnectionState,
  ConnectResult,
  DatasourceConfig,
  PasswordSaveMode,
  TestConnectionResult,
} from '~shared/types/datasource.js';
import type {
  SchemaNodePath,
  SchemaTree,
  SchemaTreeNode,
} from '~shared/types/schema-tree.js';
import { handle } from './register.js';

/** Forward every connection-state transition to every open
 * BrowserWindow. Registered once at startup; the renderer subscribes
 * via `preload` and dispatches updates into its zustand store. */
let stateForwarderInstalled = false;
function ensureConnectionStateForwarder(): void {
  if (stateForwarderInstalled) return;
  stateForwarderInstalled = true;
  subscribeConnectionState((state: ConnectionState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      // `webContents.send` is a no-op for destroyed windows, so a
      // closed renderer doesn't need special handling here.
      win.webContents.send(IPC_CHANNELS.datasource.connectionStateChange, state);
    }
    // Auto-refresh the schema cache on every transition into
    // 'connected'. We can't await here — the broadcast handler
    // signature is sync — so fire-and-forget; failures land in the
    // broadcast as a cache that's still old but the chip is green.
    if (state.status === 'connected') {
      void autoRefreshOnConnect(state.id);
    }
  });
}

/** Tracks each id's project folder so the auto-refresh handler can
 * find the on-disk cache without re-reading every datasource's
 * config. Populated lazily — the IPC handlers all receive
 * `folderPath`, so they update this map as a side-effect. */
const folderByDatasource = new Map<string, string>();

function broadcastSchemaTree(tree: SchemaTree): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.datasource.schemaTreeChange, {
      id: tree.id,
      tree,
    });
  }
}

async function autoRefreshOnConnect(id: string): Promise<void> {
  const folderPath = folderByDatasource.get(id);
  if (!folderPath) return;
  const ctx = getActiveConnection(id);
  if (!ctx) return; // racy disconnect — skip silently.
  try {
    const existing = await loadSchemaTree(folderPath, id);
    const children = await fetchChildren(id, []);
    if (children === null) return;
    const base = existing ?? emptyTree(id, ctx.driver);
    const next = replaceNodeChildren(base, [], children);
    await saveSchemaTree(folderPath, next);
    broadcastSchemaTree(next);
  } catch (err) {
    console.warn(`[datasource] auto-refresh schema failed for ${id}:`, err);
  }
}

function assertProject(folderPath: unknown): asserts folderPath is string {
  if (typeof folderPath !== 'string' || folderPath.length === 0) {
    throw new NodeGripError('INVALID_PATH', 'A project folder is required');
  }
  if (!path.isAbsolute(folderPath)) {
    throw new NodeGripError('INVALID_PATH', 'Project folder must be absolute');
  }
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new NodeGripError('VALIDATION_ERROR', 'A datasource id is required');
  }
}

export function registerDatasourceIpc(): void {
  ensureConnectionStateForwarder();

  handle<[string], DatasourceConfig[]>(
    IPC_CHANNELS.datasource.list,
    async (_event, folderPath) => {
      assertProject(folderPath);
      return listDatasources(folderPath);
    },
  );

  handle<[string, string], DatasourceConfig | null>(
    IPC_CHANNELS.datasource.get,
    async (_event, folderPath, id) => {
      assertProject(folderPath);
      assertId(id);
      return getDatasource(folderPath, id);
    },
  );

  handle<[string, DatasourceConfig], DatasourceConfig>(
    IPC_CHANNELS.datasource.save,
    async (_event, folderPath, config) => {
      assertProject(folderPath);
      if (!config || typeof config !== 'object') {
        throw new NodeGripError('VALIDATION_ERROR', 'A datasource config is required');
      }
      return saveDatasource(folderPath, config);
    },
  );

  handle<[string, string], void>(
    IPC_CHANNELS.datasource.remove,
    async (_event, folderPath, id) => {
      assertProject(folderPath);
      assertId(id);
      // Tear down any live pool first so a closed connection's chip
      // doesn't keep showing 'connected' after the entry disappears.
      await forgetConnection(id);
      // Remove the vault entry; an orphaned password is a worse
      // outcome than an orphaned config — credentials shouldn't linger
      // when their datasource is gone.
      await clearPassword(folderPath, id).catch((err) => {
        console.warn(`[datasource] failed to clear vault for ${id}:`, err);
      });
      // Drop the schema cache too — keeping it would haunt the UI
      // after the datasource itself is gone.
      await clearSchemaTree(folderPath, id).catch((err) => {
        console.warn(`[datasource] failed to clear schema cache for ${id}:`, err);
      });
      folderByDatasource.delete(id);
      await removeDatasource(folderPath, id);
    },
  );

  // Test-connect resolves the password if the renderer didn't supply
  // one (e.g. user is reconnecting a "Forever"-saved datasource without
  // re-typing). When `password` is explicitly provided as `''`, we
  // honour that empty string — useful for trust-auth servers.
  handle<
    [string, DatasourceConfig, string | undefined],
    TestConnectionResult
  >(
    IPC_CHANNELS.datasource.testConnect,
    async (_event, folderPath, config, password) => {
      assertProject(folderPath);
      if (!config || typeof config !== 'object') {
        throw new NodeGripError('VALIDATION_ERROR', 'A datasource config is required');
      }
      const effectivePassword =
        password !== undefined
          ? password
          : config.id
          ? (await getPassword(folderPath, config.id)) ?? undefined
          : undefined;
      return testConnect(config, effectivePassword);
    },
  );

  handle<[string, string, string, PasswordSaveMode], void>(
    IPC_CHANNELS.datasource.setPassword,
    async (_event, folderPath, id, password, mode) => {
      assertProject(folderPath);
      assertId(id);
      await setPassword(folderPath, id, password, mode);
    },
  );

  handle<[string, string], boolean>(
    IPC_CHANNELS.datasource.hasPassword,
    async (_event, folderPath, id) => {
      assertProject(folderPath);
      assertId(id);
      return hasPassword(folderPath, id);
    },
  );

  handle<[string, string], void>(
    IPC_CHANNELS.datasource.clearPassword,
    async (_event, folderPath, id) => {
      assertProject(folderPath);
      assertId(id);
      await clearPassword(folderPath, id);
    },
  );

  handle<[string, string, string | undefined], ConnectResult>(
    IPC_CHANNELS.datasource.connect,
    async (_event, folderPath, id, password) => {
      assertProject(folderPath);
      assertId(id);
      return connectPool(folderPath, id, password);
    },
  );

  handle<[string], void>(
    IPC_CHANNELS.datasource.disconnect,
    async (_event, id) => {
      assertId(id);
      await disconnectPool(id);
    },
  );

  handle<[string], ConnectionState>(
    IPC_CHANNELS.datasource.getConnectionState,
    async (_event, id) => {
      assertId(id);
      return getConnectionStateNow(id);
    },
  );

  /** Renderer call to read the persisted tree. Side effect: remembers
   * (id → folderPath) for the auto-refresh-on-connect handler so it
   * knows where to find the cache file the next time this id
   * transitions to 'connected'. */
  handle<[string, string], SchemaTree | null>(
    IPC_CHANNELS.datasource.getSchemaTree,
    async (_event, folderPath, id) => {
      assertProject(folderPath);
      assertId(id);
      folderByDatasource.set(id, folderPath);
      return loadSchemaTree(folderPath, id);
    },
  );

  /** Renderer-triggered expand. Throws if the datasource isn't
   * connected — the caller (UI) gates the expand action behind a
   * live connection. */
  handle<[string, string, SchemaNodePath], SchemaTreeNode[]>(
    IPC_CHANNELS.datasource.expandSchemaNode,
    async (_event, folderPath, id, treePath) => {
      assertProject(folderPath);
      assertId(id);
      folderByDatasource.set(id, folderPath);
      const ctx = getActiveConnection(id);
      if (!ctx) {
        throw new NodeGripError(
          'VALIDATION_ERROR',
          'Connect to the data source before refreshing its schema tree.',
        );
      }
      let children: SchemaTreeNode[] | null;
      try {
        children = await fetchChildren(id, treePath);
      } catch (err) {
        // Surface the underlying driver / network error to the
        // renderer instead of swallowing it. Without this log the
        // user sees a row that expanded but stays empty — no clue
        // why.
        console.error(
          `[datasource] expandSchemaNode failed (id=${id}, path=[${treePath.join('/')}]):`,
          err,
        );
        throw err;
      }
      if (children === null) {
        // getActiveConnection guarded above; if we're here the
        // connection raced shut between the guard and the query.
        throw new NodeGripError(
          'VALIDATION_ERROR',
          'Data source disconnected mid-refresh.',
        );
      }
      const existing = (await loadSchemaTree(folderPath, id)) ?? emptyTree(id, ctx.driver);
      const next = replaceNodeChildren(existing, treePath, children);
      await saveSchemaTree(folderPath, next);
      broadcastSchemaTree(next);
      return children;
    },
  );

  /** Shorthand for "refresh the root list of databases". Most useful
   * after the user toggles a Schemas-tab pattern and wants the tree
   * to redraw. */
  handle<[string, string], void>(
    IPC_CHANNELS.datasource.refreshSchemaTree,
    async (_event, folderPath, id) => {
      assertProject(folderPath);
      assertId(id);
      folderByDatasource.set(id, folderPath);
      const ctx = getActiveConnection(id);
      if (!ctx) {
        throw new NodeGripError(
          'VALIDATION_ERROR',
          'Connect to the data source before refreshing its schema tree.',
        );
      }
      const children = await fetchChildren(id, []);
      if (children === null) return;
      const existing = (await loadSchemaTree(folderPath, id)) ?? emptyTree(id, ctx.driver);
      const next = replaceNodeChildren(existing, [], children);
      await saveSchemaTree(folderPath, next);
      broadcastSchemaTree(next);
    },
  );
}
