import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_ID, SOURCE_SHA256, MAIN_TARGET, QA_TARGET, SHOP_FIELDS, ANCHOR_FIELDS, canonical, equal, digest, bytesDigest, batch3RepairUrl, batch3PublicSourceRepairPlan, executeBatch3PublicSourceRepairPlan } from './store-public-source-batch3-plan.mjs';

const copy = value => structuredClone(canonical(value));
const inventorySha = 'a'.repeat(64);
const url = target => `mysql://fixture:fixture@127.0.0.1:${target.port}/${target.database}`;
const policies = {
  '151': { source: '216', owner: '127', state: 'Washington', phone: '', phones: [], url: 'https://nwblissspa.com/', confirmed: { phone: '+12064329592' } },
  '1087': { source: '1927', owner: '0', state: 'Minnesota', phone: '763-402-0197', phones: ['763-402-0197', '651-219-4743'], url: 'https://goldenspamassage.setmore.com/', confirmed: { state: 'Minnesota' } },
  '1243': { source: '3371', owner: '0', state: 'Iowa', phone: '515-421-3807', phones: ['515-421-3807'], url: 'https://relaxationmassageia.com/', confirmed: { state: 'Iowa' } },
};
function seal(input, manifest) { const evidenceBytes = Buffer.from(JSON.stringify(manifest)); return { ...input, evidenceBytes, expectedEvidenceSha256: bytesDigest(evidenceBytes) }; }
function image(shopId, adjust) {
  const policy = policies[shopId];
  const shop = { id: shopId, ownerId: '1000', name: 'Synthetic source fixture', shortName: 'fixture-' + policy.source, timezone: 'America/Los_Angeles', studioProfile: {
    legacyImport: { source: 'Massajoy1.0', sourceShopId: policy.source, sourceOwnerId: policy.owner, loginEnabled: false }, phones: [...policy.phones], mapShareUrl: '', features: { onlineBooking: false }, provisionalCompletion: { phone: { needsReview: true }, state: { needsReview: true }, preservedDeepData: { items: [1, 2, 3] } } },
    nameEn: null, description: 'Preserved description', phone: policy.phone, address: 'Preserved street', city: 'Preserved city', state: policy.state, zipCode: '98103', latitude: '0', longitude: '0', category: 'MASSAGE', status: 'APPROVED', reviewComment: null, reviewedAt: null, reviewedBy: null, shopType: 'APPRENTICE', businessHours: { monday: [{ open: '09:00', close: '22:00' }] }, avgRating: '0', reviewCount: 0, bookingCount: 0, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-07T02:33:46.061Z', deletedAt: null };
  adjust(shop);
  const aliases = [['LEGACY_STORE_ID', 'Massajoy1.0', policy.source], ['LEGACY_OWNER_REF', 'Massajoy1.0', policy.source + ':' + policy.owner], ['SHORT_NAME', 'massajoy', 'fixture-' + policy.source], ['LEGACY_ID', 'massajoy1', policy.source]].map(([kind, source, value], index) => ({ id: String(Number(shopId) * 10 + index), shopId, kind, source, value, isActive: true, createdAt: shop.createdAt, updatedAt: shop.createdAt }));
  const sourceRow = { id: policy.source, ownerId: policy.owner, phone: policy.phone, addr: 'Original legacy text remains fingerprinted' };
  const sealedAnchor = Object.fromEntries(ANCHOR_FIELDS.map(field => [field, copy(shop[field])]));
  return { shopId, shop, aliases, sourceRow, sealedAnchor };
}
function fixture(adjustPhoneShop = () => {}) {
  const images = ['151', '1087', '1243'].map(id => image(id, id === '151' ? adjustPhoneShop : () => {}));
  const records = images.map(row => { const policy = policies[row.shopId]; return { shopId: row.shopId, sourceShopId: policy.source, sourceRowDigest: digest(row.sourceRow), sealedAnchorDigest: digest(row.sealedAnchor), aliasesDigest: digest(row.aliases), confirmedFields: copy(policy.confirmed), observedEvidence: [{ id: 'official-' + row.shopId, url: policy.url, snapshotSha256: 'b'.repeat(64), observedAt: '2026-11-11T03:00:00.000Z', quote: 'Synthetic official evidence ' + JSON.stringify(policy.confirmed), observedFields: copy(policy.confirmed) }] }; });
  return seal({ images, sourceSha256: SOURCE_SHA256, expectedInventorySha256: inventorySha, now: '2026-11-11T04:00:00.000Z' }, { schemaVersion: 1, policyId: POLICY_ID, sourceSqlSha256: SOURCE_SHA256, inventorySha256: inventorySha, records });
}
const planFor = (input, target = 'qa') => batch3PublicSourceRepairPlan(input, { target, ...(target === 'main' ? { acknowledgeMainBatch3PublicSourceOnly: true } : {}) });
const options = (plan, extra = {}) => ({ target: 'qa', databaseUrl: url(QA_TARGET), expectedPlanDigest: plan.digest, expectedEvidenceSha256: plan.evidenceSha256, expectedInventorySha256: plan.inventorySha256, ...extra });
function fakeDatabase(input, { failCas = false, throwAfterWrite = false, readbackDrift = false } = {}) {
  let committed = Object.fromEntries(input.images.map(row => [row.shopId, copy({ shop: row.shop, aliases: row.aliases })])), active;
  const writes = [], locks = [], transactions = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { const sql = strings.join('?'); if (sql.includes('DATABASE()')) return [{ name: QA_TARGET.database }]; locks.push({ table: sql.includes('shop_aliases') ? 'shop_aliases' : 'shops', id: String(values[0]) }); return []; },
    shop: {
      count: async () => 1335,
      findUnique: async ({ where }) => { const shop = copy(active[String(where.id)].shop); if (readbackDrift && writes.length && String(where.id) === '1243') shop.description = 'unexpected readback'; return shop; },
      updateMany: async ({ where, data }) => {
        const id = String(where.id);
        writes.push(copy({ where, data })); assert.deepEqual(Object.keys(where).sort(), [...SHOP_FIELDS].sort());
        for (const field of SHOP_FIELDS) assert(equal(['studioProfile', 'businessHours'].includes(field) ? where[field].equals : where[field], active[id].shop[field]), 'CAS includes original ' + field);
        if (failCas && writes.length === 3) return { count: 0 };
        active[id].shop = { ...active[id].shop, ...copy(data) }; if (throwAfterWrite && writes.length === 3) throw Error('Synthetic failure after write'); return { count: 1 };
      },
    },
    shopAlias: { findMany: async ({ where }) => copy(active[String(where.shopId)].aliases) },
  };
  const db = { $transaction: async (callback, configuration) => { transactions.push(configuration); assert.equal(configuration.isolationLevel, 'Serializable'); active = copy(committed); try { const result = await callback(tx); committed = active; return result; } finally { active = null; } } };
  return { db, writes, locks, transactions, images: () => Object.values(copy(committed)), change: work => work(committed['1087']) };
}

test('third batch accepts only its three exact phone/state policies and rejects old manifests or wider verified fields', () => {
  const input = fixture(); assert.deepEqual(planFor(input).changes.map(change => change.shopId), ['151', '1087', '1243']);
  for (const change of [m => m.policyId = 'public-source-phone-verification-2026-11-11-r2-v1', m => m.records[0].shopId = '571', m => m.records[0].sourceShopId = '672', m => m.records.push(copy(m.records[0])), m => m.records[0].confirmedFields.timezone = 'America/New_York', m => m.records[0].observedEvidence[0].url = 'https://another.example/']) {
    const manifest = JSON.parse(input.evidenceBytes); change(manifest); assert.throws(() => planFor(seal(input, manifest)));
  }
  const changedState = fixture(); changedState.images[1].shop.state = 'Iowa'; assert.throws(() => planFor(changedState), /STATE_VALUE_MUST_ALREADY_MATCH/);
});

test('full shop, four aliases, original source and sealed inventory remain required; nonzero owner reference is exact', () => {
  assert.equal(fixture().images[0].aliases[1].value, '216:127');
  for (const mutate of [i => delete i.images[0].shop.ownerId, i => delete i.images[0].aliases[0].updatedAt, i => i.images[0].aliases.pop(), i => i.images[0].sourceRow.addr += ' altered', i => i.images[0].sealedAnchor.phone = 'altered', i => i.expectedInventorySha256 = '0'.repeat(64), i => i.evidenceBytes = Buffer.concat([i.evidenceBytes, Buffer.from(' ')]), i => i.sourceSha256 = '0'.repeat(64)]) { const input = fixture(); mutate(input); assert.throws(() => planFor(input)); }
  for (const value of ['216:0', '216:128', '216:0127', '216:*']) {
    const input = fixture(); input.images[0].aliases[1].value = value; const manifest = JSON.parse(input.evidenceBytes); manifest.records[0].aliasesDigest = digest(input.images[0].aliases);
    assert.throws(() => planFor(seal(input, manifest)), /ALIAS_OWNER_REFERENCE/);
  }
});

test('151 changes phone; the two already-correct states add only provenance and timestamp while all phone strings survive', () => {
  const plan = planFor(fixture());
  for (const change of plan.changes) {
    const phoneShop = change.shopId === '151';
    assert.deepEqual(Object.keys(change.data).sort(), phoneShop ? ['phone', 'studioProfile', 'updatedAt'] : ['studioProfile', 'updatedAt']);
    assert.deepEqual(Object.keys(change.data.studioProfile.publicSourceVerification.fields), phoneShop ? ['phone'] : ['state']);
    if (phoneShop) { assert.equal(change.data.phone, '+12064329592'); assert.deepEqual(change.data.studioProfile.phones, ['(206) 432-9592']); }
    else { assert.equal(change.after.shop.state, policies[change.shopId].state); assert.equal(change.after.shop.phone, change.before.shop.phone); assert.deepEqual(change.after.shop.studioProfile.phones, change.before.shop.studioProfile.phones); }
    const profile = copy(change.data.studioProfile); delete profile.publicSourceVerification; if (phoneShop) profile.phones = [];
    assert.deepEqual(profile, change.before.shop.studioProfile); assert.deepEqual(change.before.aliases, change.after.aliases);
    for (const field of SHOP_FIELDS.filter(field => !Object.hasOwn(change.data, field))) assert.deepEqual(change.before.shop[field], change.after.shop[field]);
  }
});

test('other valid displayed phone strings are retained in order; hidden scalar and capacity rules are respected', () => {
  const multiple = fixture(shop => { shop.studioProfile.phones = ['206-432-9592', ' (212) 555-0100 ', '+1 303 555 0101']; });
  assert.deepEqual(planFor(multiple).changes[0].data.studioProfile.phones, ['(206) 432-9592', ' (212) 555-0100 ', '+1 303 555 0101']);
  const hidden = fixture(shop => { shop.phone = '(212) 555-0100'; }); assert.deepEqual(planFor(hidden).changes[0].data.studioProfile.phones, ['(206) 432-9592']);
  const absent = fixture(shop => { shop.phone = '(212) 555-0100'; delete shop.studioProfile.phones; }); assert.deepEqual(planFor(absent).changes[0].data.studioProfile.phones, ['(206) 432-9592', '(212) 555-0100']);
  assert.throws(() => planFor(fixture(shop => { shop.studioProfile.phones = ['2125550100', '2125550101', '2125550102', '2125550103', '2125550104']; })), /PHONE_LIMIT_WOULD_DROP/);
});

test('default dry-run writes nothing; one three-row CAS transaction preserves state phones, replays and QA-rolls back exactly', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input), before = fake.images();
  assert.equal((await executeBatch3PublicSourceRepairPlan(fake.db, plan, options(plan))).status, 'dry-run'); assert.equal(fake.writes.length, 0); assert.deepEqual(fake.images(), before);
  assert.deepEqual(fake.locks, ['151', '1087', '1243'].flatMap(id => [{ table: 'shops', id }, { table: 'shop_aliases', id }]));
  const applied = await executeBatch3PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); assert.equal(applied.updatedStores, 3); assert.deepEqual(fake.images(), plan.changes.map(change => change.after));
  for (const write of fake.writes.slice(1)) assert.deepEqual(Object.keys(write.data).sort(), ['studioProfile', 'updatedAt']);
  assert.equal((await executeBatch3PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))).status, 'already-applied'); assert.equal(fake.writes.length, 3);
  const fresh = planFor({ ...input, images: input.images.map((row, index) => ({ ...row, shop: fake.images()[index].shop })) }); assert.equal(fresh.status, 'already-applied'); assert.ok(fresh.changes.every(change => change.data === null));
  assert.equal((await executeBatch3PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply', rollback: true }))).status, 'rolled-back'); assert.deepEqual(fake.images(), before);
  for (const write of fake.writes.slice(4)) assert.deepEqual(Object.keys(write.data).sort(), ['studioProfile', 'updatedAt']);
});

test('concurrent scalar, deep profile or alias edits and a re-signed broader plan are refused before UPDATE', async () => {
  for (const mutate of [row => row.shop.description = 'manual edit', row => row.shop.studioProfile.features.onlineBooking = true, row => row.aliases[0].updatedAt = '2026-11-12T00:00:00.000Z']) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input); fake.change(mutate); await assert.rejects(executeBatch3PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /CONCURRENT_CHANGE/); assert.equal(fake.writes.length, 0);
  }
  const plan = copy(planFor(fixture())); plan.changes[0].data.timezone = 'America/Phoenix'; const { digest: prior, ...body } = plan; plan.digest = digest(body); let entered = false;
  await assert.rejects(executeBatch3PublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { mode: 'apply' }))); assert.equal(entered, false);
});

test('third-row CAS failure, exception after third write and final readback mismatch roll back every row', async () => {
  for (const configuration of [{ failCas: true }, { throwAfterWrite: true }, { readbackDrift: true }]) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, configuration), before = fake.images();
    await assert.rejects(executeBatch3PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))); assert.deepEqual(fake.images(), before); assert.equal(fake.transactions.length, 1); assert.equal(fake.writes.length, 3);
  }
});

test('QA target is exact and main requires its own acknowledgment while main rollback can never enter a transaction', async () => {
  assert.equal(batch3RepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'development' }), url(QA_TARGET));
  assert.throws(() => batch3RepairUrl(url(QA_TARGET).replace(QA_TARGET.database, 'mj2_store_sources_r2_qa_1774f25143'), { target: 'qa' }), /EXACT_TARGET/);
  assert.throws(() => batch3RepairUrl(url(MAIN_TARGET), { target: 'main' }), /MAIN_EXPLICIT_ACK/);
  const plan = planFor(fixture(), 'main'); let entered = false;
  await assert.rejects(executeBatch3PublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { target: 'main', databaseUrl: url(MAIN_TARGET), acknowledgeMainBatch3PublicSourceOnly: true, rollback: true })), /MAIN_ROLLBACK/); assert.equal(entered, false);
});
