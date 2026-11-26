import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_ID, SOURCE_SHA256, MAIN_TARGET, QA_TARGET, SHOP_FIELDS, ANCHOR_FIELDS, canonical, equal, digest, bytesDigest, verifyRuntimeScalarFields, batch2RepairUrl, batch2PhoneRepairPlan, executeBatch2PhoneRepairPlan } from './store-public-source-batch2-plan.mjs';

const copy = value => structuredClone(canonical(value));
const inventorySha = 'a'.repeat(64);
const url = target => `mysql://fixture:fixture@127.0.0.1:${target.port}/${target.database}`;
const policies = {
  '571': { sourceId: '672', phone: '+16163294110', displayPhone: '(616) 329-4110', officialUrl: 'https://grasianmassage.weebly.com/contact.html' },
  '766': { sourceId: '869', phone: '+18138982210', displayPhone: '(813) 898-2210', officialUrl: 'https://qspamassagefl.wixsite.com/33618' },
};
function image(shopId) {
  const policy = policies[shopId];
  const shop = { id: shopId, ownerId: '1000', name: 'Synthetic phone fixture', shortName: 'fixture-' + policy.sourceId, timezone: shopId === '571' ? 'America/Detroit' : 'America/New_York',
    studioProfile: { legacyImport: { source: 'Massajoy1.0', sourceShopId: policy.sourceId, sourceOwnerId: '0' }, phones: [], mapShareUrl: '', features: { onlineBooking: false }, provisionalCompletion: { phone: { needsReview: true }, address: { needsReview: true }, arbitraryNested: { values: [1, 2] } } },
    nameEn: null, description: 'Preserved description', phone: '', address: 'Preserved disputed address', city: 'Preserved city', state: 'Preserved state', zipCode: '00000', latitude: '0', longitude: '0',
    category: 'MASSAGE', status: 'APPROVED', reviewComment: null, reviewedAt: null, reviewedBy: null, shopType: 'APPRENTICE', businessHours: { monday: [{ open: '09:00', close: '22:00' }] }, avgRating: '0', reviewCount: 0, bookingCount: 0, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: shopId === '571' ? '2026-11-07T02:33:46.061Z' : '2026-11-08T02:33:46.061Z', deletedAt: null };
  const aliases = [['1', 'LEGACY_STORE_ID', 'Massajoy1.0', policy.sourceId], ['2', 'LEGACY_OWNER_REF', 'Massajoy1.0', policy.sourceId + ':0'], ['3', 'SHORT_NAME', 'massajoy', 'fixture-' + policy.sourceId], ['4', 'LEGACY_ID', 'massajoy1', policy.sourceId]].map(([id, kind, source, value]) => ({ id, shopId, kind, source, value, isActive: true, createdAt: shop.createdAt, updatedAt: shop.createdAt }));
  const sourceRow = { id: policy.sourceId, addr: 'Retained original address', phone: '', retainedOriginal: 'all parsed source fields remain fingerprinted' };
  return { shopId, shop, aliases, sourceRow, sealedAnchor: Object.fromEntries(ANCHOR_FIELDS.map(field => [field, copy(shop[field])])) };
}
function withManifest(input, manifest) { const evidenceBytes = Buffer.from(JSON.stringify(manifest)); return { ...input, evidenceBytes, expectedEvidenceSha256: bytesDigest(evidenceBytes) }; }
function fixture(adjust = () => {}) {
  const images = ['571', '766'].map(image); adjust(images);
  for (const row of images) row.sealedAnchor = Object.fromEntries(ANCHOR_FIELDS.map(field => [field, copy(row.shop[field])]));
  const records = images.map(row => { const policy = policies[row.shopId]; return { shopId: row.shopId, sourceShopId: policy.sourceId, sourceRowDigest: digest(row.sourceRow), sealedAnchorDigest: digest(row.sealedAnchor), aliasesDigest: digest(row.aliases), confirmedFields: { phone: policy.phone },
    observedEvidence: [{ id: 'official-' + row.shopId, url: policy.officialUrl, snapshotSha256: 'b'.repeat(64), observedAt: '2026-11-11T00:30:00.000Z', quote: 'Call or text ' + policy.displayPhone, observedFields: { phone: policy.phone } }] }; });
  return withManifest({ images, sourceSha256: SOURCE_SHA256, expectedInventorySha256: inventorySha, now: '2026-11-11T01:00:00.000Z' }, { schemaVersion: 1, policyId: POLICY_ID, sourceSqlSha256: SOURCE_SHA256, inventorySha256: inventorySha, records });
}
const planFor = (input, target = 'qa') => batch2PhoneRepairPlan(input, { target, ...(target === 'main' ? { acknowledgeMainBatch2PhoneOnly: true } : {}) });
const options = (plan, extra = {}) => ({ target: 'qa', databaseUrl: url(QA_TARGET), expectedPlanDigest: plan.digest, expectedEvidenceSha256: plan.evidenceSha256, expectedInventorySha256: plan.inventorySha256, ...extra });
function fakeDatabase(input, { failAt = 0, throwAfterAt = 0, readbackMutation = false, database = QA_TARGET.database, population = 1335 } = {}) {
  let committed = Object.fromEntries(input.images.map(row => [row.shopId, copy({ shop: row.shop, aliases: row.aliases })])), active;
  const events = [], writes = [], transactions = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { const sql = strings.join('?'); if (sql.includes('DATABASE()')) return [{ name: database }]; events.push((sql.includes('shop_aliases') ? 'alias-lock:' : 'shop-lock:') + values[0]); return []; },
    shop: {
      count: async () => population,
      findUnique: async ({ where }) => { const row = copy(active[String(where.id)].shop); if (readbackMutation && writes.length && String(where.id) === '766') row.description = 'unexpected readback drift'; return row; },
      updateMany: async ({ where, data }) => {
        const id = String(where.id); events.push('cas-write:' + id); writes.push(copy({ where, data }));
        assert.deepEqual(Object.keys(where).sort(), [...SHOP_FIELDS].sort());
        for (const field of SHOP_FIELDS) { const value = ['studioProfile', 'businessHours'].includes(field) ? where[field].equals : where[field]; if (!equal(value, active[id].shop[field])) return { count: 0 }; }
        if (writes.length === failAt) return { count: 0 };
        active[id].shop = { ...active[id].shop, ...copy(data) };
        if (writes.length === throwAfterAt) throw Error('fixture failure after UPDATE'); return { count: 1 };
      },
    },
    shopAlias: { findMany: async ({ where }) => copy(active[String(where.shopId)].aliases) },
  };
  const db = { $transaction: async (callback, configuration) => { transactions.push(copy(configuration)); assert.equal(configuration.isolationLevel, 'Serializable'); active = copy(committed); try { const result = await callback(tx); committed = active; return result; } catch (error) { events.push('rollback'); throw error; } finally { active = null; } } };
  return { db, events, writes, transactions, images: () => Object.values(copy(committed)), change: work => work(committed) };
}

test('new policy permits only exact local main and this disposable QA target, with a separate main acknowledgment', () => {
  assert.equal(batch2RepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'development' }), url(QA_TARGET));
  assert.throws(() => batch2RepairUrl(url(QA_TARGET)), /EXPLICIT_TARGET/);
  for (const candidate of [url(MAIN_TARGET), url(QA_TARGET).replace('127.0.0.1', 'localhost'), url(QA_TARGET) + '?x=1', url(QA_TARGET) + '#x', url(QA_TARGET).replace('fixture:fixture@', ''), url(QA_TARGET).replace(QA_TARGET.database, 'mj2_store_sources_qa_7c8deb01aa')]) assert.throws(() => batch2RepairUrl(candidate, { target: 'qa', nodeEnv: 'development' }));
  assert.throws(() => batch2RepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'production' }), /LOCAL_ONLY/);
  assert.throws(() => batch2RepairUrl(url(MAIN_TARGET), { target: 'main' }), /MAIN_EXPLICIT_ACK/);
});

test('both missing scalar and explicit empty displayed arrays are filled without changing any non-phone business data', () => {
  const input = fixture(), plan = planFor(input);
  assert.deepEqual(plan.changes.map(change => change.shopId), ['571', '766']);
  for (const change of plan.changes) {
    const policy = policies[change.shopId]; assert.equal(change.before.shop.phone, ''); assert.deepEqual(change.before.shop.studioProfile.phones, []);
    assert.deepEqual(Object.keys(change.data).sort(), ['phone', 'studioProfile', 'updatedAt']); assert.equal(change.data.phone, policy.phone); assert.deepEqual(change.data.studioProfile.phones, [policy.displayPhone]);
    const profile = copy(change.data.studioProfile); delete profile.publicSourceVerification; profile.phones = [];
    assert.deepEqual(profile, change.before.shop.studioProfile); assert.deepEqual(change.after.aliases, change.before.aliases);
    for (const field of SHOP_FIELDS.filter(field => !Object.hasOwn(change.data, field))) assert.deepEqual(change.after.shop[field], change.before.shop[field]);
    assert.deepEqual(Object.keys(change.data.studioProfile.publicSourceVerification.fields), ['phone']);
  }
});

test('verified display phone is first and all other valid displayed numbers retain their original strings and order', () => {
  const input = fixture(images => { images[0].shop.studioProfile.phones = ['616-329-4110', ' (212) 555-0100 ', '+1 303 555 0101', 'not a phone']; }), plan = planFor(input);
  assert.deepEqual(plan.changes[0].data.studioProfile.phones, ['(616) 329-4110', ' (212) 555-0100 ', '+1 303 555 0101']);
});

test('an explicit empty phone array does not resurrect an old hidden scalar; an absent array retains that scalar', () => {
  const explicit = fixture(images => { images[0].shop.phone = '(212) 555-0100'; }), absent = fixture(images => { images[0].shop.phone = '(212) 555-0100'; delete images[0].shop.studioProfile.phones; });
  assert.deepEqual(planFor(explicit).changes[0].data.studioProfile.phones, ['(616) 329-4110']);
  assert.deepEqual(planFor(absent).changes[0].data.studioProfile.phones, ['(616) 329-4110', '(212) 555-0100']);
});

test('the planner refuses truncation of existing valid contacts or malformed phone array images', () => {
  const input = fixture(images => { images[0].shop.studioProfile.phones = ['2125550100', '2125550101', '2125550102', '2125550103', '2125550104']; });
  assert.throws(() => planFor(input), /PHONE_LIMIT_WOULD_DROP/);
  for (const phones of [null, '2125550100', ['2125550100', 42]]) assert.throws(() => planFor(fixture(images => { images[0].shop.studioProfile.phones = phones; })), /INVALID_PHONE_ARRAY/);
  assert.throws(() => planFor(fixture(images => { images[0].shop.studioProfile.phones = [' ( 212 ) 555 - 0100   ']; })), /EXISTING_PHONE_UNDISPLAYABLE/);
});

test('old two-shop policy, missing or extra candidate, duplicate candidate and substituted source identity are rejected', () => {
  for (const mutate of [i => i.images.pop(), i => i.images.push(copy(i.images[0])), i => i.images[0].shop.id = '1238', i => i.images[0].shopId = '766', i => i.images[0].sourceRow.id = '869']) { const input = fixture(); mutate(input); assert.throws(() => planFor(input)); }
  const input = fixture(), manifest = JSON.parse(input.evidenceBytes); manifest.policyId = 'public-source-verification-2026-11-11-v1'; assert.throws(() => planFor(withManifest(input, manifest)), /MANIFEST_SCOPE/);
});

test('runtime scalar drift and incomplete full shop, full four-alias or original anchor images fail closed', () => {
  verifyRuntimeScalarFields(SHOP_FIELDS); assert.throws(() => verifyRuntimeScalarFields([...SHOP_FIELDS, 'future']), /SCHEMA_DRIFT/);
  for (const mutate of [i => delete i.images[0].shop.ownerId, i => delete i.images[0].aliases[0].updatedAt, i => delete i.images[0].sealedAnchor.businessHours]) { const input = fixture(); mutate(input); assert.throws(() => planFor(input), /INCOMPLETE/); }
});

test('raw manifest bytes, SQL fingerprint, external inventory SHA, source row, anchor and aliases must all match', () => {
  for (const mutate of [i => i.evidenceBytes = Buffer.concat([i.evidenceBytes, Buffer.from(' ')]), i => i.expectedEvidenceSha256 = '0'.repeat(64), i => i.sourceSha256 = '0'.repeat(64), i => i.expectedInventorySha256 = '0'.repeat(64), i => i.images[0].sourceRow.retainedOriginal += ' drift', i => i.images[0].sealedAnchor.phone = 'drift', i => i.images[0].aliases[0].updatedAt = '2026-11-12T00:00:00.000Z']) { const input = fixture(); mutate(input); assert.throws(() => planFor(input)); }
});

test('each known zero-owner reference is exact, even if modified aliases are re-pinned in the manifest', () => {
  for (const index of [0, 1]) for (const suffix of ['1', '00', '-1', '*', '']) {
    const input = fixture(), row = input.images[index]; row.aliases[1].value = policies[row.shopId].sourceId + ':' + suffix;
    const manifest = JSON.parse(input.evidenceBytes); manifest.records[index].aliasesDigest = digest(row.aliases);
    assert.throws(() => planFor(withManifest(input, manifest)), /ALIAS_OWNER_REFERENCE/);
  }
});

test('newly signed manifests still cannot authorize address, hours, timezone, accounts, status or a different phone', () => {
  for (const [field, value] of [['address', 'new address'], ['businessHours', {}], ['timezone', 'America/Phoenix'], ['ownerId', '10'], ['status', 'PENDING'], ['phone', '+12125550100']]) {
    const input = fixture(), manifest = JSON.parse(input.evidenceBytes); manifest.records[0].confirmedFields[field] = value; assert.throws(() => planFor(withManifest(input, manifest)), /PHONE_FIELD_ALLOWLIST/);
  }
});

test('official phone observations cannot be omitted, substituted or expanded to address verification', () => {
  for (const mutate of [record => record.observedEvidence = [], record => record.observedEvidence[0].url = 'https://unreviewed.example/', record => record.observedEvidence[0].observedFields.address = '3839', record => record.observedEvidence[0].observedFields.phone = '+12125550100', record => record.observedEvidence[0].snapshotSha256 = 'bad', record => record.observedEvidence.push(copy(record.observedEvidence[0]))]) {
    const input = fixture(), manifest = JSON.parse(input.evidenceBytes); mutate(manifest.records[0]); assert.throws(() => planFor(withManifest(input, manifest)));
  }
});

test('unknown provenance is never overwritten and historical provisional data remains intact', () => {
  const input = fixture(); input.images[0].shop.studioProfile.publicSourceVerification = { other: true }; assert.throws(() => planFor(input), /EXISTING_VERIFICATION/);
  const plan = planFor(fixture()); for (const change of plan.changes) assert.deepEqual(change.after.shop.studioProfile.provisionalCompletion, change.before.shop.studioProfile.provisionalCompletion);
});

test('clock skew and different prior timestamps produce one deterministic reconstructable batch timestamp', async () => {
  const input = fixture(); input.now = '2026-11-06T00:00:00.000Z'; const plan = planFor(input), fake = fakeDatabase(input);
  assert.equal(plan.changes[0].data.updatedAt, '2026-11-08T02:33:46.062Z'); assert.equal(plan.changes[1].data.updatedAt, plan.changes[0].data.updatedAt);
  assert.equal((await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan))).status, 'dry-run');
});

test('planning is deterministic, order independent and idempotent only when the entire batch is already applied', () => {
  const input = fixture(), plan = planFor(input); assert.deepEqual(planFor(input), plan);
  assert.equal(planFor({ ...input, images: [...input.images].reverse() }).digest, plan.digest);
  const applied = { ...input, images: input.images.map((row, index) => ({ ...row, shop: copy(plan.changes[index].after.shop) })) };
  const repeated = planFor(applied); assert.equal(repeated.status, 'already-applied'); assert.ok(repeated.changes.every(change => change.data === null));
  assert.throws(() => planFor({ ...input, images: [applied.images[0], input.images[1]] }), /MIXED_BATCH_STATE/);
});

test('dry-run is the default and locks both shops and their four aliases in one Serializable transaction without writes', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input), before = fake.images();
  const result = await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan)); assert.equal(result.status, 'dry-run'); assert.equal(result.updatedStores, 0); assert.equal(fake.writes.length, 0); assert.deepEqual(fake.images(), before);
  assert.equal(fake.transactions.length, 1); assert.deepEqual(fake.events, ['shop-lock:571', 'alias-lock:571', 'shop-lock:766', 'alias-lock:766']);
});

test('one atomic apply CASes every scalar and readbacks both rows; replay adds no further writes', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input);
  const result = await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); assert.equal(result.status, 'applied'); assert.equal(result.updatedStores, 2); assert.equal(fake.transactions.length, 1); assert.deepEqual(fake.images(), plan.changes.map(change => change.after));
  assert.deepEqual(fake.events.slice(0, 6), ['shop-lock:571', 'alias-lock:571', 'shop-lock:766', 'alias-lock:766', 'cas-write:571', 'cas-write:766']);
  const repeated = await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); assert.equal(repeated.status, 'already-applied'); assert.equal(fake.writes.length, 2);
});

test('QA whole-batch rollback restores exact profiles, scalar phones and timestamps and is itself idempotent', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input), before = fake.images();
  await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }));
  assert.equal((await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { rollback: true }))).status, 'rollback-dry-run'); assert.equal(fake.writes.length, 2);
  const result = await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply', rollback: true })); assert.equal(result.status, 'rolled-back'); assert.equal(result.updatedStores, 2); assert.deepEqual(fake.images(), before);
  assert.equal((await executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply', rollback: true }))).status, 'already-rolled-back'); assert.equal(fake.writes.length, 4);
});

test('concurrent changes on either row, deep profile or alias prevent every write', async () => {
  for (const mutate of [rows => rows['571'].shop.description = 'manual edit', rows => rows['766'].shop.studioProfile.features.onlineBooking = true, rows => rows['766'].shop.businessHours.monday = [], rows => rows['571'].shop.updatedAt = '2026-11-12T00:00:00.000Z', rows => rows['766'].aliases[0].updatedAt = '2026-11-12T00:00:00.000Z']) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input); fake.change(mutate);
    await assert.rejects(executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /CONCURRENT_CHANGE/); assert.equal(fake.writes.length, 0);
  }
});

test('partially applied or manually modified batch is not silently completed or rolled back', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input); fake.change(rows => { rows['571'] = copy(plan.changes[0].after); });
  await assert.rejects(executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /CONCURRENT_CHANGE/); assert.equal(fake.writes.length, 0);
  const other = fakeDatabase(input); await executeBatch2PhoneRepairPlan(other.db, plan, options(plan, { mode: 'apply' })); other.change(rows => { rows['766'].shop.phone = 'later manual edit'; });
  await assert.rejects(executeBatch2PhoneRepairPlan(other.db, plan, options(plan, { mode: 'apply', rollback: true })), /CONCURRENT_CHANGE/); assert.equal(other.images()[1].shop.phone, 'later manual edit');
});

test('second-row CAS failure, error after its write, and final readback drift roll both rows back', async () => {
  for (const configuration of [{ failAt: 2 }, { throwAfterAt: 2 }, { readbackMutation: true }]) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, configuration), before = fake.images();
    await assert.rejects(executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))); assert.deepEqual(fake.images(), before); assert.equal(fake.writes.length, 2); assert.equal(fake.events.at(-1), 'rollback'); assert.equal(fake.transactions.length, 1);
  }
});

test('database identity or store population mismatch is rejected before updates', async () => {
  for (const configuration of [{ database: 'other' }, { population: 1334 }]) { const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, configuration); await assert.rejects(executeBatch2PhoneRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))); assert.equal(fake.writes.length, 0); }
});

test('re-signed plans cannot authorize arbitrary phone array, location, status, hours or account modifications', async () => {
  for (const mutate of [p => p.changes[0].data.phone = 'changed', p => p.changes[0].data.status = 'PENDING', p => p.changes[0].data.businessHours = {}, p => p.changes[0].data.ownerId = '99', p => p.changes[0].data.timezone = 'America/Phoenix', p => p.changes[0].data.studioProfile.phones.push('(212) 555-0100'), p => p.changes[0].data.studioProfile.features.onlineBooking = true, p => p.changes[1].after.shop.address = 'new address']) {
    const plan = copy(planFor(fixture())); mutate(plan); const { digest: old, ...body } = plan; plan.digest = digest(body); let entered = false;
    await assert.rejects(executeBatch2PhoneRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { mode: 'apply' }))); assert.equal(entered, false);
  }
});

test('execution requires separate exact plan, manifest and inventory SHA expectations', async () => {
  const plan = planFor(fixture());
  for (const extra of [{ expectedPlanDigest: '0'.repeat(64) }, { expectedEvidenceSha256: '0'.repeat(64) }, { expectedInventorySha256: '0'.repeat(64) }]) { let entered = false; await assert.rejects(executeBatch2PhoneRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, extra))); assert.equal(entered, false); }
});

test('main acknowledgment is independent, a QA plan is not usable on main, and main rollback is always refused', async () => {
  const input = fixture(), main = planFor(input, 'main'), fake = fakeDatabase(input, { database: MAIN_TARGET.database });
  const opt = options(main, { target: 'main', databaseUrl: url(MAIN_TARGET), mode: 'apply' });
  await assert.rejects(executeBatch2PhoneRepairPlan(fake.db, main, opt), /MAIN_EXPLICIT_ACK/);
  await assert.rejects(executeBatch2PhoneRepairPlan(fake.db, main, { ...opt, acknowledgeMainBatch2PhoneOnly: true, rollback: true }), /MAIN_ROLLBACK/);
  const qa = planFor(input); await assert.rejects(executeBatch2PhoneRepairPlan(fake.db, qa, { ...options(qa), ...opt, expectedPlanDigest: qa.digest, acknowledgeMainBatch2PhoneOnly: true }), /PLAN_OR_EVIDENCE/);
  assert.equal((await executeBatch2PhoneRepairPlan(fake.db, main, { ...opt, acknowledgeMainBatch2PhoneOnly: true })).status, 'applied');
});
