import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ACTION, DAYS, FIXTURE_HOURS_PLACEHOLDER, canonical, digest, bytesDigest, validatePackage,
  validateLocalConfig, createPlan, applyPlan, safeSummary,
} from './live1-public-sample-lib.mjs';

const DATABASE = 'massajoy2_local', SERVER = '01234567-89ab-cdef-0123-456789abcdef';
const packageInput = () => ({
  schemaVersion: 1, sourceSystem: 'massajoy1', batchId: 'live1-sample-synthetic', capturedAt: '2026-10-28T04:00:00Z',
  shops: [{ sourceEntity: 'merchant', sourceId: '3763', targetShopId: '1', match: { name: 'Synthetic Day Spa', shortName: 'SyntheticDaySpa' },
    sourceUrls: ['https://app.asianmassagebook.com/admin#/merchant/index', 'https://app.asianmassagebook.com/merchant#/merchant/setting'],
    description: 'Synthetic public description\nSecond verified line',
    businessHours: Object.fromEntries(DAYS.map(day => [day, [{ start: '09:00', end: '21:00' }]])),
    rawCatalog: [{ name: 'Synthetic menu', duration: '60 mins', price: '$80', currency: null, priceBasis: null }],
  }],
});
const shopRow = (id = '1') => ({ id: BigInt(id), ownerId: 77n, name: id === '1' ? 'Synthetic Day Spa' : 'Second Synthetic Spa', shortName: id === '1' ? 'SyntheticDaySpa' : 'SecondSyntheticSpa',
  description: '', businessHours: null, timezone: '', phone: '', state: 'CT', address: 'Synthetic public business address', status: 'PENDING',
  studioProfile: { phones: [], features: { onlineBooking: false, onlinePayment: false } }, latitude: '41.0000000', longitude: '-72.0000000',
  deletedAt: null, createdAt: new Date('2026-10-23T00:00:00Z'), updatedAt: new Date('2026-10-23T00:00:00Z'),
});
const sha = input => bytesDigest(Buffer.from(JSON.stringify(input)));
const planOptions = input => ({ packageSHA: sha(input), actorId: '1', database: DATABASE });
const applyOptions = (input, plan) => ({ ...planOptions(input), expectedPlanDigest: plan.planDigest });
const rejected = (work, code) => assert.rejects(work, error => error.safeCode === code);

// Transaction-composition double only. These tests never connect to MySQL or establish engine lock behavior.
function fixture({ rows = [shopRow()], actor = { id: 1n, role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, auditFailure = false } = {}) {
  let state = { shops: structuredClone(rows), audits: [], actor: structuredClone(actor) }, events = [], server = SERVER, database = DATABASE;
  const models = current => ({
    $queryRawUnsafe: async (sql, ...values) => {
      if (sql.startsWith('SELECT DATABASE()')) return [{ database_name: database, server_uuid: server }];
      if (sql.startsWith('SELECT id FROM shops')) { events.push(['shop-lock', String(values[0])]); return current.shops.filter(row => row.id === values[0]).map(row => ({ id: row.id })); }
      if (sql.startsWith('SELECT id FROM users')) { events.push(['actor-lock', String(values[0])]); return [{ id: current.actor.id }]; }
      throw new Error('Unexpected SQL in synthetic test');
    },
    user: { findUnique: async () => structuredClone(current.actor) },
    shop: {
      findUnique: async ({ where }) => structuredClone(current.shops.find(row => row.id === where.id) ?? null),
      update: async ({ where, data }) => {
        events.push(['shop-write', String(where.id), Object.keys(data).sort()]);
        const row = current.shops.find(item => item.id === where.id); Object.assign(row, structuredClone(data)); row.updatedAt = new Date('2026-10-28T04:01:00Z');
        return structuredClone(row);
      },
    },
    auditLog: {
      findMany: async ({ where }) => structuredClone(current.audits.filter(audit => audit.action === where.action && audit.targetType === where.targetType && (where.OR[0].targetId.in.includes(audit.targetId) || audit.detail.batchId === where.OR[1].detail.equals))),
      create: async ({ data }) => { events.push(['audit-write', String(data.targetId)]); if (auditFailure === true || typeof auditFailure === 'number' && current.audits.length + 1 === auditFailure) throw new Error('Synthetic audit failure'); current.audits.push(structuredClone(data)); return data; },
    },
  });
  const db = {
    ...Object.fromEntries(['$queryRawUnsafe', 'user', 'shop', 'auditLog'].map(key => [key, typeof models(state)[key] === 'function' ? (...args) => models(state)[key](...args) : Object.fromEntries(Object.keys(models(state)[key]).map(method => [method, (...args) => models(state)[key][method](...args)]))])),
    $transaction: async (work, options) => { assert.equal(options.isolationLevel, 'ReadCommitted'); const next = structuredClone(state), result = await work(models(next)); state = next; return result; },
  };
  return { db, state: () => structuredClone(state), events: () => events, change: change => change(state), server: value => { server = value; }, database: value => { database = value; } };
}

test('plan is deterministic, preserves BigInt/Decimal/Date fidelity and exposes values only in the private plan', async () => {
  const input = packageInput(), f = fixture(), original = canonical(input);
  const first = await createPlan(f.db, input, planOptions(input)), second = await createPlan(f.db, input, planOptions(input));
  assert.equal(canonical(input), original); assert.equal(first.planDigest, second.planDigest); assert.equal(first.packageSHA, sha(input));
  assert.deepEqual(Object.keys(first.shops[0].write).sort(), ['businessHours', 'description']); assert.equal(first.shops[0].before.businessHours, null);
  class Decimal { toJSON() { return '41.1234567'; } }
  assert.equal(canonical({ value: new Decimal(), id: 9007199254740993n, at: new Date('2026-01-01T00:00:00Z') }), '{"at":"2026-01-01T00:00:00.000Z","id":"9007199254740993","value":"41.1234567"}');
  assert.equal(f.events().length, 0); assert.equal(f.state().audits.length, 0);
  const safe = JSON.stringify(safeSummary(first, 'read-only-local-plan'));
  for (const raw of [input.shops[0].description, input.shops[0].match.name, input.shops[0].sourceId, '21:00', 'Synthetic menu']) assert.equal(safe.includes(raw), false);
});

test('valid package is converted to the actual backend hours contract; raw menu remains outside writes', async () => {
  const input = packageInput(); input.shops[0].businessHours.mon = [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '21:00' }]; input.shops[0].businessHours.sun = [];
  const f = fixture(), plan = await createPlan(f.db, input, planOptions(input)), result = await applyPlan(f.db, input, plan, applyOptions(input, plan));
  assert.equal(result.applied, 1); assert.equal(result.auditsCreated, 1);
  assert.deepEqual(f.state().shops[0].businessHours.monday, [{ open: '09:00', close: '12:00', closed: false }, { open: '13:00', close: '21:00', closed: false }]);
  assert.deepEqual(f.state().shops[0].businessHours.sunday, { closed: true });
  const saved = f.state().shops[0], before = shopRow();
  for (const key of Object.keys(before).filter(key => !['description', 'businessHours', 'updatedAt'].includes(key))) assert.deepEqual(saved[key], before[key], key);
  assert.equal(f.state().audits[0].action, ACTION); assert.deepEqual(f.state().audits[0].detail.changedFields, ['businessHours', 'description']);
  assert.deepEqual(f.state().audits[0].detail.fields, ['businessHours', 'description']); assert.deepEqual(f.state().audits[0].detail.sourceIds, ['3763']);
  assert.equal(f.state().audits[0].detail.rawCatalogImported, false); assert.equal(JSON.stringify(f.state().audits[0].detail).includes('Synthetic public description'), false);
  assert.deepEqual(f.events().slice(0, 2), [['shop-lock', '1'], ['actor-lock', '1']]);
});

test('missing, duplicate or unsafe source mappings and unverified evidence fail before any DB call', () => {
  for (const mutate of [
    input => { input.shops[0].targetShopId = 1; }, input => { input.shops[0].sourceId = '03763'; },
    input => { input.shops.push(structuredClone(input.shops[0])); }, input => { input.shops[0].ownerId = '7'; },
    input => { input.shops[0].sourceUrls = ['https://app.asianmassagebook.com/admin?token=secret#/merchant/index']; },
    input => { input.shops[0].rawCatalog = { accessToken: 'synthetic-never-print' }; },
    input => { input.capturedAt = '2026-02-30T04:00:00Z'; }, input => { input.shops[0].sourceEntity = 'unverified_sql_table'; },
  ]) { const input = packageInput(); mutate(input); assert.throws(() => validatePackage(input)); }
});

test('hours reject missing days, overlap, overnight, all-closed and values unsupported by live hours parser', () => {
  for (const mutate of [
    hours => { delete hours.mon; }, hours => { hours.mon = [{ start: '13:00', end: '12:00' }]; },
    hours => { hours.mon = [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }]; },
    hours => { hours.mon = [{ start: '09:00', end: '24:00' }]; }, hours => { for (const day of DAYS) hours[day] = []; },
    hours => { hours.mon = Array.from({ length: 5 }, (_, index) => ({ start: `0${index}:00`, end: `0${index}:30` })); },
  ]) { const input = packageInput(); mutate(input.shops[0].businessHours); assert.throws(() => validatePackage(input)); }
});

test('only empty fields or exact original fixture placeholder may be filled; prior real data is never overwritten', async () => {
  const input = packageInput(), f = fixture(); f.change(state => { state.shops[0].businessHours = structuredClone(FIXTURE_HOURS_PLACEHOLDER); });
  assert.equal((await createPlan(f.db, input, planOptions(input))).shops[0].state, 'ready');
  for (const mutate of [
    state => { state.shops[0].description = 'Local operator edit'; },
    state => { state.shops[0].businessHours = { monday: { open: '10:00', close: '20:00', closed: false } }; },
    state => { state.shops[0].businessHours = structuredClone(FIXTURE_HOURS_PLACEHOLDER); state.shops[0].businessHours['周一'].start = '09:00'; },
  ]) { const changed = fixture(); changed.change(mutate); await rejected(() => createPlan(changed.db, input, planOptions(input)), 'NONEMPTY_TARGET_FIELD_CONFLICT'); }
});

test('both name and shortName are required to match and an inactive/non-admin actor cannot plan or apply', async () => {
  for (const field of ['name', 'shortName']) { const f = fixture(); f.change(state => { state.shops[0][field] += ' changed'; }); await rejected(() => createPlan(f.db, packageInput(), planOptions(packageInput())), 'TARGET_NAME_OR_SHORT_NAME_MISMATCH'); }
  for (const actor of [{ role: 'MERCHANT', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }, { role: 'ADMIN', status: 'ACTIVE', deletedAt: new Date() }]) {
    const f = fixture({ actor: { id: 1n, deletedAt: null, ...actor } }); await rejected(() => createPlan(f.db, packageInput(), planOptions(packageInput())), 'EXISTING_ACTIVE_ADMIN_REQUIRED');
  }
  const input = packageInput(), f = fixture(), plan = await createPlan(f.db, input, planOptions(input)); f.change(state => { state.actor.status = 'SUSPENDED'; });
  await rejected(() => applyPlan(f.db, input, plan, applyOptions(input, plan)), 'EXISTING_ACTIVE_ADMIN_REQUIRED'); assert.equal(f.state().audits.length, 0);
});

test('any full-row edit after planning fails CAS even when desired public fields remain empty', async () => {
  for (const field of ['address', 'ownerId', 'updatedAt', 'studioProfile']) {
    const input = packageInput(), f = fixture(), plan = await createPlan(f.db, input, planOptions(input));
    f.change(state => { state.shops[0][field] = field === 'ownerId' ? 88n : field === 'updatedAt' ? new Date('2026-10-28T05:00:00Z') : field === 'studioProfile' ? { phones: [], localEdit: true } : 'Changed local address'; });
    await rejected(() => applyPlan(f.db, input, plan, applyOptions(input, plan)), 'TARGET_CHANGED_SINCE_PLAN'); assert.equal(f.state().shops[0].description, ''); assert.equal(f.state().audits.length, 0);
  }
});

test('apply requires the exact reviewed digest, unchanged package, actor and database identity', async () => {
  const input = packageInput(), f = fixture(), plan = await createPlan(f.db, input, planOptions(input));
  await rejected(() => applyPlan(f.db, input, plan, { ...applyOptions(input, plan), expectedPlanDigest: '0'.repeat(64) }), 'EXPECTED_PLAN_DIGEST_REQUIRED');
  const modified = structuredClone(input); modified.shops[0].description += ' modified';
  await rejected(() => applyPlan(f.db, modified, plan, applyOptions(modified, plan)), 'PLAN_PACKAGE_OR_ACTOR_MISMATCH');
  await rejected(() => applyPlan(f.db, input, plan, { ...applyOptions(input, plan), actorId: '2' }), 'PLAN_PACKAGE_OR_ACTOR_MISMATCH');
  f.server('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'); await rejected(() => applyPlan(f.db, input, plan, applyOptions(input, plan)), 'PLAN_DATABASE_IDENTITY_MISMATCH');
  assert.equal(f.state().audits.length, 0);
});

test('even a rehashed malicious plan cannot add owner/status/catalog or substitute target values', async () => {
  const input = packageInput(), f = fixture(), plan = await createPlan(f.db, input, planOptions(input));
  for (const mutate of [p => { p.shops[0].write.ownerId = '4'; }, p => { p.shops[0].write.description = 'Tampered'; }, p => { p.shops[0].write = {}; }]) {
    const changed = structuredClone(plan); mutate(changed); const { planDigest, ...body } = changed; changed.planDigest = digest(body);
    await assert.rejects(() => applyPlan(f.db, input, changed, applyOptions(input, changed)));
  }
  assert.equal(f.state().audits.length, 0); assert.equal(f.state().shops[0].ownerId, 77n);
});

test('same package replay is alreadyApplied with no additional audit; later edits including clearing cause conflict', async () => {
  const input = packageInput(), f = fixture(), plan = await createPlan(f.db, input, planOptions(input));
  await applyPlan(f.db, input, plan, applyOptions(input, plan));
  const replay = await applyPlan(f.db, input, plan, applyOptions(input, plan)); assert.equal(replay.alreadyApplied, 1); assert.equal(replay.applied, 0); assert.equal(f.state().audits.length, 1);
  assert.equal((await createPlan(f.db, input, planOptions(input))).shops[0].state, 'alreadyApplied');
  f.change(state => { state.shops[0].description = ''; });
  await rejected(() => applyPlan(f.db, input, plan, applyOptions(input, plan)), 'PREVIOUSLY_IMPORTED_FIELDS_CHANGED'); assert.equal(f.state().audits.length, 1);
});

test('initial equal fields are unchanged, not replay; omitted timezone/phone stay untouched', async () => {
  const input = packageInput(), f = fixture();
  const temporary = await createPlan(f.db, input, planOptions(input)); f.change(state => { Object.assign(state.shops[0], temporary.shops[0].after); state.shops[0].timezone = 'America/Chicago'; state.shops[0].phone = '555-555-0100'; });
  const plan = await createPlan(f.db, input, planOptions(input)), result = await applyPlan(f.db, input, plan, applyOptions(input, plan));
  assert.equal(plan.shops[0].state, 'unchanged'); assert.equal(result.unchanged, 1); assert.equal(result.alreadyApplied, 0); assert.equal(f.state().audits.length, 0);
  assert.equal(f.state().shops[0].timezone, 'America/Chicago'); assert.equal(f.state().shops[0].phone, '555-555-0100');
});

test('same batch cannot be reused with a different package even when switching the mapped target', async () => {
  const input = packageInput(), f = fixture({ rows: [shopRow(), shopRow('2')] }), plan = await createPlan(f.db, input, planOptions(input));
  await applyPlan(f.db, input, plan, applyOptions(input, plan));
  const other = packageInput(); Object.assign(other.shops[0], { sourceId: '3764', targetShopId: '2', match: { name: 'Second Synthetic Spa', shortName: 'SecondSyntheticSpa' } });
  await rejected(() => createPlan(f.db, other, planOptions(other)), 'BATCH_ID_REUSED_WITH_DIFFERENT_PACKAGE');
});

test('audit failure rolls back every shop and writes are locked in numeric shop order', async () => {
  const input = packageInput(); input.shops.push({ ...structuredClone(input.shops[0]), sourceId: '3764', targetShopId: '2', match: { name: 'Second Synthetic Spa', shortName: 'SecondSyntheticSpa' } }); input.shops.reverse();
  const f = fixture({ rows: [shopRow(), shopRow('2')], auditFailure: 2 }), before = f.state(), plan = await createPlan(f.db, input, planOptions(input));
  await assert.rejects(() => applyPlan(f.db, input, plan, applyOptions(input, plan)), /Synthetic audit failure/);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.events().slice(0, 3), [['shop-lock', '1'], ['shop-lock', '2'], ['actor-lock', '1']]); assert.equal(f.events().filter(event => event[0] === 'shop-write').length, 2);
});

test('timezone requires explicit Connecticut derivation and matching local state; public phone cannot override Studio clearing', async () => {
  const input = packageInput(); input.shops[0].timezone = { value: 'America/New_York', kind: 'derived', basis: { country: 'US', state: 'CT', note: 'Verified public address in Connecticut' } };
  assert.equal((await createPlan(fixture().db, input, planOptions(input))).shops[0].write.timezone, 'America/New_York');
  const f = fixture(); f.change(state => { state.shops[0].state = 'NY'; }); await rejected(() => createPlan(f.db, input, planOptions(input)), 'TARGET_CT_STATE_EVIDENCE_MISMATCH');
  const wrong = structuredClone(input); wrong.shops[0].timezone.basis.state = 'Central Time'; assert.throws(() => validatePackage(wrong));
  const phone = packageInput(); phone.shops[0].phone = { value: '555-555-0100', verifiedPublic: true, sourceUrl: phone.shops[0].sourceUrls[0] };
  await rejected(() => createPlan(fixture().db, phone, planOptions(phone)), 'PHONE_PROFILE_OVERRIDE_NOT_SUPPORTED');
});

test('local URL and env indirection guards reject remote, production schema, guessed env names and unacknowledged Compose', () => {
  const config = { databaseUrl: 'mysql://synthetic:unused@127.0.0.1:3310/massajoy2_local', actorId: '1' };
  assert.equal(validateLocalConfig(config).database, DATABASE);
  for (const url of ['mysql://synthetic:unused@remote.example:3310/massajoy2_local', 'mysql://synthetic:unused@127.0.0.1:3310/production', config.databaseUrl + '?secret=value', 'mysql://synthetic:unused@127.0.0.1/massajoy2_local', 'mysql://synthetic:unused@127.0.0.1:0/massajoy2_local']) assert.throws(() => validateLocalConfig({ ...config, databaseUrl: url }));
  const compose = { databaseUrlEnv: 'DATABASE_URL', actorId: '1', connectionMode: 'compose-local' }, environment = { DATABASE_URL: 'mysql://synthetic:unused@db:3306/massajoy2_local' };
  assert.throws(() => validateLocalConfig(compose, { environment })); assert.throws(() => validateLocalConfig(compose, { environment, allowCompose: true }));
  assert.equal(validateLocalConfig(compose, { environment, allowCompose: true, inContainer: true }).connectionMode, 'compose-local');
  assert.throws(() => validateLocalConfig({ ...compose, databaseUrlEnv: 'OTHER_SECRET' }, { environment, allowCompose: true, inContainer: true }));
  assert.throws(() => validateLocalConfig({ ...compose, databaseUrl: config.databaseUrl }, { environment, allowCompose: true, inContainer: true }));
});

test('CLI failures expose only safe codes, with no source/error/credential details and no production connection', () => {
  const script = fileURLToPath(new URL('./live1-public-sample.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'mysql://private-account:private-password@remote/private'], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } });
  assert.equal(result.status, 1); assert.equal(result.stderr, ''); const output = JSON.parse(result.stdout); assert.equal(output.passed, false); assert.equal(output.error.code, 'LOCAL_INVOCATION_REQUIRED');
  assert.equal(result.stdout.includes('private'), false); assert.equal(result.stdout.includes('mysql:'), false);
});
