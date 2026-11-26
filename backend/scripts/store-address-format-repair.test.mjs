import test from 'node:test';
import assert from 'node:assert/strict';
import { QA_TARGET, MAIN_TARGET, POLICY_ID, SOURCE_SHA256, SHOP_FIELDS, ORIGINAL_ADDRESS, FORMATTED_ADDRESS, LANDMARK_NOTE,
  canonical, equal, digest, cloneRepairUrl, mainRepairUrl, verifyRuntimeScalarFields, provenance, addressFormatPlan, mainAddressFormatPlan, executeAddressFormatPlan, executeMainAddressFormatPlan, rollbackOnlyDrill } from './store-address-format-repair-plan.mjs';

const url = `mysql://fixture:fixture@${QA_TARGET.host}:${QA_TARGET.port}/${QA_TARGET.database}`;
const copy = value => structuredClone(canonical(value));
function fixture() {
  const shop = { id: '919', ownerId: '1000', name: 'Synthetic fixture', shortName: 'fixture-1229', timezone: 'America/Phoenix',
    studioProfile: { legacyImport: { source: 'Massajoy1.0', sourceShopId: '1229' }, mapShareUrl: 'https://example.test/retained-map', features: { onlineBooking: false }, arbitraryManualValue: { retained: true } },
    nameEn: null, description: 'Retained description', phone: '555-555-0100', address: ORIGINAL_ADDRESS, city: 'Chandler', state: 'Arizona', zipCode: '85224', latitude: '33.0000000', longitude: '-111.0000000',
    category: 'MASSAGE', status: 'APPROVED', reviewComment: null, reviewedAt: null, reviewedBy: null, shopType: 'APPRENTICE', businessHours: { monday: [{ open: '09:00', close: '22:00' }] }, avgRating: '0', reviewCount: 0, bookingCount: 0,
    createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-07T02:33:46.061Z', deletedAt: null };
  const aliases = [['1837', 'LEGACY_STORE_ID', 'Massajoy1.0', '1229'], ['1838', 'LEGACY_OWNER_REF', 'Massajoy1.0', '1229:376'], ['4508', 'SHORT_NAME', 'massajoy', 'aa-thai-massage-1229'], ['4509', 'LEGACY_ID', 'massajoy1', '1229']]
    .map(([id, kind, source, value]) => ({ id, shopId: '919', kind, source, value, isActive: true, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' }));
  return { shop, aliases, sourceRow: { id: '1229', addr: ORIGINAL_ADDRESS, address: null, house_number: null, address_extra: null }, sourceSha256: SOURCE_SHA256,
    sealedAnchor: copy(shop), now: new Date('2026-11-10T07:00:00.000Z') };
}
function fakeDatabase(input = fixture(), { updateCount = 1, failAfterWrite = false, readbackMutation = false, database = QA_TARGET.database } = {}) {
  let committed = { shop: copy(input.shop), aliases: copy(input.aliases) }, active;
  const events = [], writes = [];
  const tx = {
    $queryRaw: async strings => { const sql = strings.join('?'); if (sql.includes('DATABASE()')) return [{ name: database }]; events.push(sql.includes('shop_aliases') ? 'alias-lock' : 'shop-lock'); return []; },
    shop: {
      count: async () => 1335,
      findUnique: async () => { const row = copy(active.shop); if (readbackMutation && writes.length) row.phone = 'unexpected'; return row; },
      updateMany: async ({ where, data }) => {
        events.push('cas-write'); writes.push(copy({ where, data }));
        assert.deepEqual(Object.keys(where).sort(), [...SHOP_FIELDS].sort(), 'CAS covers every scalar shop column');
        for (const key of SHOP_FIELDS) {
          const value = ['studioProfile', 'businessHours'].includes(key) ? where[key].equals : where[key];
          if (!equal(value, active.shop[key])) return { count: 0 };
        }
        if (updateCount !== 1) return { count: updateCount };
        active.shop = { ...active.shop, ...copy(data) };
        if (failAfterWrite) throw Error('injected failure after UPDATE');
        return { count: 1 };
      },
    },
    shopAlias: { findMany: async () => copy(active.aliases) },
  };
  const db = { $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    active = copy(committed);
    try { const result = await callback(tx); committed = active; return result; } catch (error) { events.push('rollback'); throw error; } finally { active = null; }
  } };
  return { db, events, writes, image: () => copy(committed), change: callback => { callback(committed); } };
}
const options = plan => ({ databaseUrl: url, expectedDigest: plan.digest });

test('only exact disposable QA target is allowed; main, aliases, query strings and production fail closed', () => {
  assert.equal(cloneRepairUrl(url, 'development'), url);
  for (const candidate of [url.replace('33091', '33090'), url.replace(QA_TARGET.database, 'mj2_store_migration_84cec1e6'), url.replace('127.0.0.1', 'localhost'), url + '?connection_limit=1', url + '#x', url.replace('mysql:', 'postgres:'), url.replace('fixture:fixture@', ''), 'bad']) assert.throws(() => cloneRepairUrl(candidate, 'development'));
  assert.throws(() => cloneRepairUrl(url, 'production'), /LOCAL_QA_ONLY/);
});
test('schema additions or missing before-image columns cannot silently bypass complete CAS', () => {
  verifyRuntimeScalarFields([...SHOP_FIELDS].reverse());
  assert.throws(() => verifyRuntimeScalarFields([...SHOP_FIELDS, 'newColumn']), /SCHEMA_DRIFT/);
  const input = fixture(); delete input.shop.ownerId;
  assert.throws(() => addressFormatPlan(input), /INCOMPLETE_SHOP_PREIMAGE/);
});
test('format plan preserves the exact original address and landmark while retaining all other profile values', () => {
  const input = fixture(), untouched = copy(input), plan = addressFormatPlan(input);
  assert.equal(plan.status, 'pending'); assert.equal(plan.policyId, POLICY_ID);
  assert.equal(plan.data.address, FORMATTED_ADDRESS);
  assert.equal(plan.data.studioProfile.addressFormatRecovery.originalAddress, ORIGINAL_ADDRESS);
  assert.equal(plan.data.studioProfile.addressFormatRecovery.originalLandmarkNote, LANDMARK_NOTE);
  assert.deepEqual(plan.data.studioProfile.addressFormatRecovery, provenance());
  assert.deepEqual(Object.keys(plan.data).sort(), ['address', 'studioProfile', 'updatedAt']);
  assert.deepEqual(plan.data.studioProfile.features, input.shop.studioProfile.features);
  for (const field of SHOP_FIELDS.filter(field => !['address', 'studioProfile', 'updatedAt'].includes(field))) assert.deepEqual(plan.after.shop[field], plan.before.shop[field]);
  assert.deepEqual(plan.after.aliases, plan.before.aliases); assert.deepEqual(copy(input), untouched);
});
test('source ID, source file digest or any literal source evidence change is rejected', () => {
  for (const mutate of [input => { input.sourceSha256 = '0'.repeat(64); }, input => { input.sourceRow.id = '1230'; }, input => { input.sourceRow.addr += ' '; }, input => { input.sourceRow.address = ORIGINAL_ADDRESS; }, input => { input.sourceRow.address_extra = 'extra'; }]) {
    const input = fixture(); mutate(input); assert.throws(() => addressFormatPlan(input), /SOURCE_EVIDENCE/);
  }
});
test('shop identity, active aliases, locality and sealed manual edits are protected', () => {
  for (const mutate of [input => { input.shop.id = '920'; }, input => { input.shop.city = 'Other'; }, input => { input.shop.timezone = 'America/Chicago'; }, input => { input.shop.status = 'PENDING'; }, input => { input.aliases[0].isActive = false; }, input => { input.aliases[3].value = '1230'; }, input => { input.aliases.push(copy(input.aliases[0])); }, input => { input.shop.phone = 'manual change'; }, input => { input.shop.updatedAt = '2026-11-09T00:00:00.000Z'; }, input => { input.shop.studioProfile.arbitraryManualValue.retained = false; }]) {
    const input = fixture(); mutate(input); assert.throws(() => addressFormatPlan(input));
  }
});
test('unknown provenance cannot be replaced and source-only formatting never exposes an addressNote UI setting', () => {
  const input = fixture(); input.shop.studioProfile.addressFormatRecovery = { another: 'manual value' }; input.sealedAnchor = copy(input.shop);
  assert.throws(() => addressFormatPlan(input), /PROVENANCE_CHANGED/);
  const plan = addressFormatPlan(fixture()); assert.equal(Object.hasOwn(plan.data.studioProfile, 'addressNote'), false);
});
test('dry run is deterministic and idempotent with intact applied provenance', () => {
  const input = fixture(), first = addressFormatPlan(input);
  assert.deepEqual(addressFormatPlan(input), first);
  const second = addressFormatPlan({ ...input, shop: copy(first.after.shop) });
  assert.equal(second.status, 'already-applied'); assert.equal(second.data, null); assert.deepEqual(second.before, second.after);
  const altered = { ...input, shop: copy(first.after.shop) }; altered.shop.studioProfile.addressFormatRecovery.originalLandmarkNote = 'lost';
  assert.throws(() => addressFormatPlan(altered));
});
test('digest includes full before image, aliases and unmodified profile values regardless of object key order', () => {
  const first = addressFormatPlan(fixture()), reordered = fixture(); reordered.shop = Object.fromEntries(Object.entries(reordered.shop).reverse());
  assert.equal(addressFormatPlan(reordered).digest, first.digest);
  const changed = fixture(); changed.shop.description += ' changed'; changed.sealedAnchor = copy(changed.shop);
  assert.notEqual(addressFormatPlan(changed).digest, first.digest);
});
test('apply locks shop and aliases, checks full preimage and CAS, then verifies exact readback', async () => {
  const input = fixture(), plan = addressFormatPlan(input), fake = fakeDatabase(input);
  const result = await executeAddressFormatPlan(fake.db, plan, options(plan));
  assert.equal(result.status, 'applied'); assert.equal(result.updatedStores, 1);
  assert.deepEqual(fake.image(), plan.after);
  assert.deepEqual(fake.events.slice(0, 3), ['shop-lock', 'alias-lock', 'cas-write']);
  assert.equal(fake.writes.length, 1);
});
test('same apply receipt is idempotent and precise rollback restores original updatedAt/profile/address only', async () => {
  const input = fixture(), plan = addressFormatPlan(input), fake = fakeDatabase(input);
  await executeAddressFormatPlan(fake.db, plan, options(plan));
  const again = await executeAddressFormatPlan(fake.db, plan, options(plan));
  assert.equal(again.status, 'already-applied'); assert.equal(fake.writes.length, 1);
  const restored = await executeAddressFormatPlan(fake.db, plan, { ...options(plan), rollback: true });
  assert.equal(restored.status, 'rolled-back'); assert.deepEqual(fake.image(), plan.before);
  const repeat = await executeAddressFormatPlan(fake.db, plan, { ...options(plan), rollback: true });
  assert.equal(repeat.status, 'already-rolled-back'); assert.equal(fake.writes.length, 2);
});
test('concurrent scalar, nested profile or alias edits after planning refuse any write', async () => {
  for (const change of [image => { image.shop.description = 'manual edit'; }, image => { image.shop.businessHours.monday = []; }, image => { image.aliases[0].updatedAt = '2026-11-09T00:00:00.000Z'; }]) {
    const input = fixture(), plan = addressFormatPlan(input), fake = fakeDatabase(input); fake.change(change);
    await assert.rejects(executeAddressFormatPlan(fake.db, plan, options(plan)), /CONCURRENT_CHANGE/); assert.equal(fake.writes.length, 0);
  }
});
test('rollback refuses to erase later manual edits', async () => {
  const input = fixture(), plan = addressFormatPlan(input), fake = fakeDatabase(input);
  await executeAddressFormatPlan(fake.db, plan, options(plan));
  fake.change(image => { image.shop.phone = 'manual after repair'; });
  await assert.rejects(executeAddressFormatPlan(fake.db, plan, { ...options(plan), rollback: true }), /CONCURRENT_CHANGE/);
  assert.equal(fake.image().shop.phone, 'manual after repair'); assert.equal(fake.writes.length, 1);
});
test('CAS failure and failure after UPDATE leave the transaction preimage intact', async () => {
  for (const config of [{ updateCount: 0 }, { failAfterWrite: true }, { readbackMutation: true }]) {
    const input = fixture(), plan = addressFormatPlan(input), fake = fakeDatabase(input, config);
    await assert.rejects(executeAddressFormatPlan(fake.db, plan, options(plan)));
    assert.deepEqual(fake.image(), plan.before); assert.equal(fake.events.at(-1), 'rollback');
  }
});
test('wrong database identity or expected digest refuses before UPDATE', async () => {
  const input = fixture(), plan = addressFormatPlan(input), fake = fakeDatabase(input, { database: 'other' });
  await assert.rejects(executeAddressFormatPlan(fake.db, plan, options(plan)), /DATABASE_IDENTITY/); assert.equal(fake.writes.length, 0);
  let entered = false;
  await assert.rejects(executeAddressFormatPlan({ $transaction: async () => { entered = true; } }, plan, { ...options(plan), expectedDigest: 'wrong' }), /EXACT_PLAN_DIGEST/);
  assert.equal(entered, false);
});
test('forged locality/status/profile writes fail even when the plan digest is recomputed', async () => {
  for (const modify of [plan => { plan.data.city = 'Other'; }, plan => { plan.data.studioProfile.features.onlineBooking = true; }, plan => { plan.data.address = 'Other street'; }, plan => { plan.after.shop.phone = 'changed'; }]) {
    const plan = copy(addressFormatPlan(fixture())); modify(plan); const { digest: _old, ...body } = plan; plan.digest = digest(body);
    let entered = false; await assert.rejects(executeAddressFormatPlan({ $transaction: async () => { entered = true; } }, plan, options(plan))); assert.equal(entered, false);
  }
});
test('real transaction wrapper drill deliberately aborts after successful update/readback', async () => {
  const input = fixture(), plan = addressFormatPlan(input), fake = fakeDatabase(input);
  const result = await rollbackOnlyDrill(fake.db, plan, options(plan));
  assert.equal(result.status, 'deliberately-rolled-back'); assert.equal(fake.writes.length, 1); assert.deepEqual(fake.image(), plan.before);
});
test('independent main entry requires explicit single-store acknowledgment and exact main target', async () => {
  const mainUrl = `mysql://fixture:fixture@${MAIN_TARGET.host}:${MAIN_TARGET.port}/${MAIN_TARGET.database}`;
  assert.throws(() => mainRepairUrl(mainUrl), /EXPLICIT_ACK_REQUIRED/);
  assert.equal(mainRepairUrl(mainUrl, { acknowledgeMain919FormatOnly: true, nodeEnv: 'development' }), mainUrl);
  for (const candidate of [url, mainUrl.replace('127.0.0.1', 'localhost'), mainUrl + '?x=1', mainUrl.replace('33090', '33092')]) assert.throws(() => mainRepairUrl(candidate, { acknowledgeMain919FormatOnly: true, nodeEnv: 'development' }), /EXACT_MAIN_TARGET/);
  assert.throws(() => mainRepairUrl(mainUrl, { acknowledgeMain919FormatOnly: true, nodeEnv: 'production' }), /LOCAL_MAIN_ONLY/);
  assert.throws(() => mainAddressFormatPlan(fixture()), /EXPLICIT_ACK_REQUIRED/);
  const input = fixture(), plan = mainAddressFormatPlan(input, { acknowledgeMain919FormatOnly: true });
  const fake = fakeDatabase(input, { database: MAIN_TARGET.database });
  await assert.rejects(executeMainAddressFormatPlan(fake.db, plan, { databaseUrl: mainUrl, expectedDigest: plan.digest }), /EXPLICIT_ACK_REQUIRED/);
  assert.equal(fake.writes.length, 0);
  const result = await executeMainAddressFormatPlan(fake.db, plan, { databaseUrl: mainUrl, expectedDigest: plan.digest, acknowledgeMain919FormatOnly: true });
  assert.equal(result.status, 'applied'); assert.deepEqual(fake.image(), plan.after);
  await assert.rejects(executeMainAddressFormatPlan(fake.db, plan, { databaseUrl: mainUrl, expectedDigest: plan.digest, acknowledgeMain919FormatOnly: true, rollback: true }), /MAIN_ROLLBACK_NOT_AUTHORIZED/);
});
test('QA and main sealed plans cannot be interchanged even with the correct URL and acknowledgment', async () => {
  const qa = addressFormatPlan(fixture()), main = mainAddressFormatPlan(fixture(), { acknowledgeMain919FormatOnly: true });
  assert.notEqual(qa.digest, main.digest);
  let entered = false; const db = { $transaction: async () => { entered = true; } };
  await assert.rejects(executeAddressFormatPlan(db, main, { databaseUrl: url, expectedDigest: main.digest }), /INVALID_PLAN/);
  await assert.rejects(executeMainAddressFormatPlan(db, qa, { databaseUrl: `mysql://fixture:fixture@127.0.0.1:33090/${MAIN_TARGET.database}`, expectedDigest: qa.digest, acknowledgeMain919FormatOnly: true }), /INVALID_PLAN/);
  assert.equal(entered, false);
});
