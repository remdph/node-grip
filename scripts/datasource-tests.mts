/**
 * DataSource API Integration Tests
 *
 * Run with: npx tsx --module esnext scripts/datasource-tests.mts
 * or simply: npx tsx scripts/datasource-tests.mts
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- Import main-process modules directly ---
const {
  listDatasources,
  getDatasource,
  saveDatasource,
  removeDatasource,
  newDatasourceId,
} = await import('../src/main/datasources/storage.js');

const {
  setPassword,
  getPassword,
  hasPassword,
  clearPassword,
} = await import('../src/main/datasources/vault.js');

const { testConnect: runTestConnect } = await import('../src/main/datasources/test-connect.js');

const {
  connect: connectPool,
  disconnect: disconnectPool,
  getState: getConnectionStateNow,
} = await import('../src/main/datasources/connections.js');

const { loadSchemaTree, saveSchemaTree, emptyTree, replaceNodeChildren } = await import('../src/main/datasources/schema-cache.js');
const { fetchChildren } = await import('../src/main/datasources/introspection.js');
const { getActiveConnection } = await import('../src/main/datasources/connections.js');

// ---------------------------------------------------------------------------
// Test project path
// ---------------------------------------------------------------------------

const TEST_PROJECT = '/tmp/nodegrip-ds-test';

// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`    ✓ ${message}`);
    passed++;
  } else {
    console.log(`    ✗ ${message}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual === expected) {
    console.log(`    ✓ ${message}`);
    passed++;
  } else {
    console.log(`    ✗ ${message} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failed++;
  }
}

function assertOk(obj: unknown, message: string) {
  const o = obj as { ok: boolean; latencyMs?: number; serverVersion?: string };
  if (o && o.ok) {
    console.log(`    ✓ ${message}`);
    passed++;
  } else {
    console.log(`    ✗ ${message} — result: ${JSON.stringify(obj)}`);
    failed++;
  }
}

async function setupProject() {
  await fs.rm(TEST_PROJECT, { recursive: true, force: true });
  await fs.mkdir(path.join(TEST_PROJECT, '.nodegrip', 'datasources'), { recursive: true });
  await fs.writeFile(
    path.join(TEST_PROJECT, '.nodegrip', 'project.json'),
    JSON.stringify({ name: 'ds-test', createdAt: new Date().toISOString() }, null, 2),
  );
  console.log(`  ✓ Project set up at ${TEST_PROJECT}`);
}

async function testListEmpty() {
  console.log('\n[Test 1] datasource.list — empty project');
  await setupProject();
  const list = await listDatasources(TEST_PROJECT);
  assertEq(list.length, 0, 'Returns empty array for new project');
}

async function testSaveCreate() {
  console.log('\n[Test 2] datasource.save — create');
  const id = newDatasourceId();
  const config = {
    id,
    name: 'Test PostgreSQL',
    driver: 'postgres' as const,
    host: 'localhost',
    port: 5432,
    user: 'pguser',
    database: 'testdb',
    passwordMode: 'forever' as const,
    createdAt: '',
    updatedAt: '',
  };
  const saved = await saveDatasource(TEST_PROJECT, config);
  assert(saved.id === id, 'ID is preserved on create');
  assert(saved.createdAt.length > 0, 'createdAt is set');
  assert(saved.updatedAt.length > 0, 'updatedAt is set');
  assertEq(saved.name, 'Test PostgreSQL', 'Name is saved correctly');
  assertEq(saved.host, 'localhost', 'Host is saved correctly');
  assertEq(saved.port, 5432, 'Port is saved correctly');
}

async function testSaveUpdate() {
  console.log('\n[Test 3] datasource.save — update');
  const list = await listDatasources(TEST_PROJECT);
  const existing = list[0]!;
  const originalCreatedAt = existing.createdAt;

  const updated = await saveDatasource(TEST_PROJECT, {
    ...existing,
    name: 'Test PostgreSQL Updated',
    host: '127.0.0.1',
  });

  assertEq(updated.name, 'Test PostgreSQL Updated', 'Name is updated');
  assertEq(updated.host, '127.0.0.1', 'Host is updated');
  assertEq(updated.createdAt, originalCreatedAt, 'createdAt unchanged on update');
  assert(updated.updatedAt !== originalCreatedAt, 'updatedAt is refreshed');
}

async function testGet() {
  console.log('\n[Test 4] datasource.get');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list[0]!;
  const fetched = await getDatasource(TEST_PROJECT, ds.id);
  assert(fetched !== null, 'Returns datasource');
  assertEq(fetched!.id, ds.id, 'ID matches');
  assertEq(fetched!.name, 'Test PostgreSQL Updated', 'Fetched name is correct');
}

async function testSetPasswordForever() {
  console.log('\n[Test 5] datasource.setPassword — forever');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list[0]!;

  await setPassword(TEST_PROJECT, ds.id, 'pgpass', 'forever');
  const has = await hasPassword(TEST_PROJECT, ds.id);
  assert(has, 'hasPassword returns true after saving');

  const retrieved = await getPassword(TEST_PROJECT, ds.id);
  assertEq(retrieved, 'pgpass', 'Password is retrieved correctly');
}

async function testSetPasswordSession() {
  console.log('\n[Test 6] datasource.setPassword — session');
  const id = newDatasourceId();
  await saveDatasource(TEST_PROJECT, {
    id,
    name: 'Session Test DS',
    driver: 'postgres',
    host: 'localhost',
    port: 5432,
    user: 'pguser',
    database: 'testdb',
    passwordMode: 'session',
    createdAt: '',
    updatedAt: '',
  });

  await setPassword(TEST_PROJECT, id, 'sessionpass', 'session');
  const has = await hasPassword(TEST_PROJECT, id);
  assert(has, 'hasPassword returns true for session mode');

  const retrieved = await getPassword(TEST_PROJECT, id);
  assertEq(retrieved, 'sessionpass', 'Session password is retrieved');
}

async function testSetPasswordNever() {
  console.log('\n[Test 7] datasource.setPassword — never (clear)');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list[0]!;

  await setPassword(TEST_PROJECT, ds.id, 'temppass', 'forever');
  assert(await hasPassword(TEST_PROJECT, ds.id), 'Password is set');

  await setPassword(TEST_PROJECT, ds.id, '', 'never');
  const has = await hasPassword(TEST_PROJECT, ds.id);
  assert(!has, 'hasPassword returns false after "never"');
}

async function testTestConnectValid() {
  console.log('\n[Test 8] datasource.testConnect — valid credentials');
  const result = await runTestConnect(
    {
      id: 'test',
      name: 'Test',
      driver: 'postgres',
      host: 'localhost',
      port: 5432,
      user: 'pguser',
      database: 'testdb',
      passwordMode: 'forever',
      createdAt: '',
      updatedAt: '',
    },
    'pgpass',
  );

  assertOk(result, 'testConnect returns ok=true');
  const r = result as { ok: boolean; latencyMs?: number; serverVersion?: string };
  if (r.latencyMs !== undefined) assert(typeof r.latencyMs === 'number', 'latencyMs is a number');
  if (r.serverVersion) assert(r.serverVersion.includes('PostgreSQL'), 'serverVersion contains PostgreSQL');
}

async function testTestConnectWrongPassword() {
  console.log('\n[Test 9] datasource.testConnect — wrong password');
  const result = await runTestConnect(
    {
      id: 'test',
      name: 'Test',
      driver: 'postgres',
      host: 'localhost',
      port: 5432,
      user: 'pguser',
      database: 'testdb',
      passwordMode: 'forever',
      createdAt: '',
      updatedAt: '',
    },
    'wrongpassword',
  );

  const r = result as { ok: boolean; errorKind?: string; error?: string };
  assert(r.ok === false, 'testConnect returns ok=false');
  assertEq(r.errorKind, 'auth', `errorKind is 'auth', got '${r.errorKind}'`);
  assert((r.error?.length ?? 0) > 0, 'Error message is present');
}

async function testTestConnectBadHost() {
  console.log('\n[Test 10] datasource.testConnect — invalid host');
  const result = await runTestConnect(
    {
      id: 'test',
      name: 'Test',
      driver: 'postgres',
      host: '192.0.2.1',
      port: 5432,
      user: 'pguser',
      database: 'testdb',
      passwordMode: 'forever',
      createdAt: '',
      updatedAt: '',
    },
    'pgpass',
  );

  const r = result as { ok: boolean; errorKind?: string };
  assert(r.ok === false, 'testConnect returns ok=false');
  assert(['network', 'timeout', 'unknown'].includes(r.errorKind ?? ''), `errorKind is network/timeout/unknown, got '${r.errorKind}'`);
}

async function testPoolConnect() {
  console.log('\n[Test 11] datasource.connect — long-lived connection');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list.find(d => d.name === 'Test PostgreSQL Updated')!;

  const result = await connectPool(TEST_PROJECT, ds.id, 'pgpass');
  assertOk(result, 'connect returns ok=true');

  await new Promise(r => setTimeout(r, 500));

  const state = getConnectionStateNow(ds.id);
  assertEq(state.status, 'connected', 'getConnectionState shows status=connected');
  assert((state.connectedAt?.length ?? 0) > 0, 'connectedAt timestamp is set');
}

async function testGetSchemaTree() {
  console.log('\n[Test 12] datasource.getSchemaTree — build tree from introspection');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list.find(d => d.name === 'Test PostgreSQL Updated')!;

  const children = await fetchChildren(ds.id, []);
  console.log('    Databases:', children?.map(c => c.name));
  assert(children !== null, 'fetchChildren returns root children');
  assert(children!.length > 0, 'Root has databases/schemas');

  const dbNames = children!.map(c => c.name);
  assert(dbNames.includes('testdb'), 'testdb is in root children');
  assert(dbNames.includes('postgres'), 'postgres is in root children');
}

async function testExpandSchemaNode() {
  console.log('\n[Test 13] datasource.expandSchemaNode — expand tables');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list.find(d => d.name === 'Test PostgreSQL Updated')!;

  const schemaChildren = await fetchChildren(ds.id, ['testdb']);
  console.log('    Schemas found:', schemaChildren?.map(c => c.name));

  const tableChildren = await fetchChildren(ds.id, ['testdb', 'test_schema']);
  console.log('    Tables found:', tableChildren?.map(c => c.name));
  assert(tableChildren !== null, 'Schema children returned');
  assert(tableChildren!.length > 0, 'Schema has children (tables/views)');

  const tableNames = tableChildren!.map(c => c.name).sort();
  const expectedTables = ['categories', 'order_items', 'orders', 'products', 'users'];
  for (const table of expectedTables) {
    assert(tableNames.includes(table), `Table '${table}' is present in schema`);
  }
}

async function testRefreshSchemaTree() {
  console.log('\n[Test 14] datasource.refreshSchemaTree');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list.find(d => d.name === 'Test PostgreSQL Updated')!;

  const ctx = getActiveConnection(ds.id);
  const existing = await loadSchemaTree(TEST_PROJECT, ds.id);
  const base = existing ?? emptyTree(ds.id, ctx!.driver);
  const children = await fetchChildren(ds.id, []);
  const next = replaceNodeChildren(base, [], children ?? []);
  await saveSchemaTree(TEST_PROJECT, next);

  assert(next.databases.length > 0, 'Schema tree was refreshed with databases');
  // Verify it was actually saved
  const reloaded = await loadSchemaTree(TEST_PROJECT, ds.id);
  assert(reloaded !== null, 'Tree is persisted to disk');
  assert(reloaded!.databases.length > 0, 'Reloaded tree has databases');
}

async function testDisconnect() {
  console.log('\n[Test 15] datasource.disconnect');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list.find(d => d.name === 'Test PostgreSQL Updated')!;

  await disconnectPool(ds.id);
  await new Promise(r => setTimeout(r, 300));

  const state = getConnectionStateNow(ds.id);
  assertEq(state.status, 'disconnected', 'getConnectionState shows status=disconnected');
}

async function testRemove() {
  console.log('\n[Test 16] datasource.remove');
  const list = await listDatasources(TEST_PROJECT);
  const ds = list.find(d => d.name === 'Test PostgreSQL Updated')!;

  // Note: removeDatasource (storage) doesn't clear vault — that's done by
  // the IPC handler (datasource:remove) which calls clearPassword first.
  // We test the storage layer directly here, so manually clear the vault.
  await clearPassword(TEST_PROJECT, ds.id);

  await removeDatasource(TEST_PROJECT, ds.id);

  const listAfter = await listDatasources(TEST_PROJECT);
  const stillExists = listAfter.some(d => d.id === ds.id);
  assert(!stillExists, 'Datasource is removed from list');

  const hasPass = await hasPassword(TEST_PROJECT, ds.id);
  console.log('    hasPassword after remove:', hasPass);
  assert(!hasPass, 'Password is also cleared from vault');
}

async function testGetNonExistent() {
  console.log('\n[Test 17] datasource.get — non-existent ID');
  const result = await getDatasource(TEST_PROJECT, 'does-not-exist');
  assertEq(result, null, 'Returns null for non-existent ID');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        DataSource API Integration Test Suite                ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  DB: localhost:5432, db=testdb, user=pguser, pass=pgpass   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await testListEmpty();
    await testSaveCreate();
    await testSaveUpdate();
    await testGet();
    await testSetPasswordForever();
    await testSetPasswordSession();
    await testSetPasswordNever();
    await testTestConnectValid();
    await testTestConnectWrongPassword();
    await testTestConnectBadHost();
    await testPoolConnect();
    await testGetSchemaTree();
    await testExpandSchemaNode();
    await testRefreshSchemaTree();
    await testDisconnect();
    await testRemove();
    await testGetNonExistent();
  } finally {
    await fs.rm(TEST_PROJECT, { recursive: true, force: true }).catch(() => {});
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main();