'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, applyPlan, targetUrl, sqlValues, sourceRows } = require('../scripts/migrate-legacy-store-accounts.cjs');
const { randomStorePassword } = require('../scripts/import-legacy-stores.cjs');
const HASH = '$2b$12$' + 'A'.repeat(53);
function fixture() {
  const state = {
    shops: [
      { id: 1n, ownerId: 100n, status: 'APPROVED', shortName: 'old-one', studioProfile: { features: { onlineBooking: false }, legacyImport: {} } },
      { id: 2n, ownerId: 101n, status: 'APPROVED', shortName: 'old-two', studioProfile: { legacyImport: {} } },
    ], users: [
      { id: 100n, role: 'MERCHANT', status: 'ACTIVE', loginName: null, email: null, passwordHash: null },
      { id: 101n, role: 'MERCHANT', status: 'ACTIVE', loginName: null, email: null, passwordHash: null },
      { id: 200n, role: 'MERCHANT', status: 'ACTIVE', loginName: 'independent-two', email: 'two@example.invalid', name: 'Existing', passwordHash: HASH },
      { id: 999n, role: 'ADMIN', status: 'ACTIVE', loginName: 'admin', email: 'admin@example.invalid', passwordHash: HASH },
    ], bindings: [{ shopId: 1n, userId: 100n }, { shopId: 2n, userId: 200n }], aliases: [
      { shopId: 1n, kind: 'LEGACY_STORE_ID', source: 'Massajoy1.0', value: '71', isActive: true },
      { shopId: 2n, kind: 'LEGACY_STORE_ID', source: 'Massajoy1.0', value: '72', isActive: true },
    ], writes: [], events: [],
  };
  const rows = [{ id: '71', account: 'oldone', name: 'One', email: 'one@example.invalid' }, { id: '72', account: 'oldtwo', name: 'Two', email: 'two@example.invalid' }];
  const write = (table, args) => { state.writes.push({ table, ...args }); state.events.push('write'); };
  const db = {
    shop: {
      findMany: async () => state.shops.map(shop => { const binding = state.bindings.find(b => b.shopId === shop.id); return { ...shop, loginBinding: binding ? { ...binding, user: state.users.find(u => u.id === binding.userId) } : null }; }),
      update: async args => { write('shop', args); const s = state.shops.find(s => s.id === args.where.id); Object.assign(s, args.data); return s; },
    },
    user: {
      findMany: async () => state.users,
      create: async args => { write('user', args); const row = { id: 1000n + BigInt(state.users.length), ...args.data }; state.users.push(row); return row; },
      update: async args => { write('user', args); const row = state.users.find(u => u.id === args.where.id && u.role === args.where.role); assert.ok(row); Object.assign(row, args.data); return row; },
    },
    shopAlias: {
      findMany: async () => state.aliases,
      upsert: async args => { write('alias', args); const k = args.where.kind_source_value; const row = state.aliases.find(a => a.kind === k.kind && a.source === k.source && a.value === k.value); if (row) Object.assign(row, args.update); else state.aliases.push({ ...args.create, isActive: true }); },
    },
    shopLoginBinding: { upsert: async args => { write('binding', args); const row = state.bindings.find(b => b.shopId === args.where.shopId); if (row) Object.assign(row, args.update); else state.bindings.push(args.create); } },
    authSession: { updateMany: async args => { write('session', args); return { count: 1 }; } },
    $queryRawUnsafe: async () => [],
    $transaction: async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(db); },
  };
  return { db, rows, state };
}
test('target guard rejects remote servers, production schemas, and alternate ports', () => {
  assert.ok(targetUrl('mysql://synthetic:password@127.0.0.1:33090/mj2_store_migration_84cec1e6'));
  for (const url of ['mysql://synthetic:password@remote.example:33090/mj2_store_migration_84cec1e6', 'mysql://synthetic:password@127.0.0.1:3306/mj2_store_migration_84cec1e6', 'mysql://synthetic:password@127.0.0.1:33090/production']) assert.throws(() => targetUrl(url));
});
test('SQL parsing preserves quoted commas, apostrophes and null while extracting identity only', () => {
  assert.deepEqual(sqlValues("(1,'a,b','O\\'Brien',NULL,'NULL'),(2,'line\\nnext','it''s','',NULL)"), [['1','a,b',"O'Brien",null,'NULL'], ['2','line\nnext',"it's",'',null]]);
  const sql = 'CREATE TABLE `merchant` (\n`id` int,\n`name` text,\n`account` text,\n`contact_name` text,\n`email` text,\n`phone` text,\n`password` text\n) ENGINE=InnoDB;\nINSERT INTO `merchant` VALUES (71,\'One\',\'one\',\'Owner\',\'one@example.invalid\',NULL,\'synthetic-not-imported\');\n';
  const rows = sourceRows(sql);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, '71'); assert.ok(!JSON.stringify(rows).includes('synthetic-not-imported'));
});
test('all generated initial passwords contain both letters and digits and exactly eight characters', () => {
  for (let i = 0; i < 300; i++) assert.match(randomStorePassword(), /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8}$/);
});
test('read-only plan retains historical ownership and reports explicit canonical aliases', async () => {
  const { db, rows, state } = fixture(); const plan = await buildPlan(db, rows);
  assert.equal(state.writes.length, 0); assert.equal(plan.blockers.length, 0);
  assert.equal(plan.summary.accountsToCreate, 1); assert.equal(plan.summary.accountsToUpdate, 1);
  assert.equal(plan.summary.passwordsToGenerate, 2); assert.equal(plan.summary.aliasesToCreate, 4);
  assert.equal(plan.entries[0].existingId, null); assert.equal(plan.entries[1].existingId, '200');
  assert.equal(plan.entries[0].email, 'one@example.invalid');
  assert.deepEqual(plan.entries[0].aliases.map(a => [a.kind, a.source, a.value]), [['SHORT_NAME','massajoy','old-one'], ['LEGACY_ID','massajoy1','71']]);
});
test('historical owners of any store are never repurposed or suspended, and administrators block apply', async () => {
  const { db, rows, state } = fixture(); state.bindings[1].userId = 100n;
  let plan = await buildPlan(db, rows); assert.equal(plan.summary.accountsToCreate, 2);
  state.bindings[1].userId = 999n; plan = await buildPlan(db, rows);
  assert.ok(plan.blockers.some(b => b.code === 'BOUND_ACCOUNT_NOT_SAFE_MERCHANT'));
  await assert.rejects(applyPlan(db, rows, plan.digest, { append() { throw new Error('must not write credentials'); } }));
  assert.equal(state.writes.length, 0);
});
test('shared and occupied email addresses never take over another account', async () => {
  const { db, rows, state } = fixture(); state.users.find(u => u.id === 200n).email = null;
  rows[0].email = 'shared@example.invalid'; rows[1].email = 'shared@example.invalid';
  let plan = await buildPlan(db, rows); assert.equal(plan.summary.emailReady, 1); assert.equal(plan.summary.emailMissingOrShared, 1);
  rows[0].email = 'admin@example.invalid'; rows[1].email = null; plan = await buildPlan(db, rows);
  assert.equal(plan.summary.emailReady, 0); assert.equal(state.writes.length, 0);
});
test('a legacy email login is retained even when the separate contact email is absent', async () => {
  const { db, rows } = fixture(); rows[0].account = 'Legacy.Login@example.invalid'; rows[0].email = null;
  const plan = await buildPlan(db, rows); assert.equal(plan.entries[0].email, 'legacy.login@example.invalid');
});
test('apply flushes credentials first, disables only independent accounts, preserves publication, and is idempotent', async () => {
  const { db, rows, state } = fixture(); const plan = await buildPlan(db, rows), credentials = [];
  const writer = { append(value) { credentials.push(value); state.events.push('credential'); } };
  const deps = { makePassword: () => 'A2345678', makeHash: async () => HASH };
  let result = await applyPlan(db, rows, plan.digest, writer, deps);
  assert.equal(result.generatedCredentialCount, 2); assert.deepEqual(state.events.slice(0, 2), ['credential','credential']);
  assert.equal(credentials.length, 2); assert.ok(credentials.every(c => c.loginEnabled === false));
  assert.ok(state.shops.every(s => s.status === 'APPROVED'));
  assert.ok(state.writes.filter(w => w.table === 'shop').every(w => !('ownerId' in w.data) && !('status' in w.data)));
  assert.equal(state.users.find(u => u.id === 100n).status, 'ACTIVE'); assert.equal(state.users.find(u => u.id === 999n).status, 'ACTIVE');
  assert.ok(state.bindings.every(b => state.users.find(u => u.id === b.userId).status === 'SUSPENDED'));
  const ids = state.bindings.map(b => b.userId), userCount = state.users.length, aliases = state.aliases.length;
  const again = await buildPlan(db, rows); assert.equal(again.summary.passwordsToGenerate, 0); assert.equal(again.summary.accountsToCreate, 0); assert.equal(again.summary.aliasesToCreate, 0);
  result = await applyPlan(db, rows, again.digest, writer, { makePassword() { throw new Error('must not reset migrated credentials'); } });
  assert.equal(result.generatedCredentialCount, 0); assert.equal(credentials.length, 2); assert.equal(state.users.length, userCount); assert.equal(state.aliases.length, aliases); assert.deepEqual(state.bindings.map(b => b.userId), ids);
});
test('stale digest and alias theft stop before credentials or data writes', async () => {
  const { db, rows, state } = fixture(); const plan = await buildPlan(db, rows);
  state.shops[0].shortName = 'edited-one';
  await assert.rejects(applyPlan(db, rows, plan.digest, { append() { throw new Error('must not write credentials'); } }));
  assert.equal(state.writes.length, 0);
  state.aliases.push({ kind: 'SHORT_NAME', source: 'massajoy', value: 'edited-one', shopId: 2n, isActive: false });
  const blocked = await buildPlan(db, rows); assert.ok(blocked.blockers.some(b => b.code === 'RESERVED_ALIAS_CONFLICT'));
  await assert.rejects(applyPlan(db, rows, blocked.digest, { append() { throw new Error('must not write credentials'); } }));
  assert.equal(state.writes.length, 0);
});
