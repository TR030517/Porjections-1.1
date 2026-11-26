import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_ID, SOURCE_SHA256, MAIN_TARGET, QA_TARGET, SHOP_FIELDS, ANCHOR_FIELDS, canonical, equal, digest, bytesDigest, batch4RepairUrl, batch4PublicSourceRepairPlan, executeBatch4PublicSourceRepairPlan } from './store-public-source-batch4-plan.mjs';

const copy = value => structuredClone(canonical(value));
const inventorySha = 'a'.repeat(64);
const street = '208 English Village, Suite 208';
const officialUrl = 'https://londonbridgewellnesscenter.com/contact';
const url = target => `mysql://fixture:fixture@127.0.0.1:${target.port}/${target.database}`;
function seal(input, manifest) { const evidenceBytes = Buffer.from(JSON.stringify(manifest)); return { ...input, evidenceBytes, expectedEvidenceSha256: bytesDigest(evidenceBytes) }; }
function fixture(adjust = () => {}) {
  const shopId = '671', shop = {
    id: shopId, ownerId: '1000', name: 'Synthetic London Bridge fixture', shortName: 'fixture-772', timezone: 'America/Phoenix', studioProfile: {
      legacyImport: { source: 'Massajoy1.0', sourceShopId: '772', sourceOwnerId: '0', loginEnabled: false },
      phones: ['928-846-1119', ' (800) 555-0100 '], mapShareUrl: 'https://www.google.com/maps/search/?api=1&query=34.47884%2C-114.346028',
      features: { onlineBooking: false }, provisionalCompletion: { address: { needsReview: true }, state: { needsReview: true }, preservedDeepData: { items: [1, 2, 3] } },
    },
    nameEn: null, description: 'Preserved description', phone: '928-846-1119', address: 'Address pending update', city: 'Lake Havasu City', state: 'Arizona', zipCode: '86403', latitude: '34.47884', longitude: '-114.346028', category: 'MASSAGE', status: 'APPROVED', reviewComment: null, reviewedAt: null, reviewedBy: null, shopType: 'APPRENTICE',
    businessHours: { monday: [{ open: '09:00', close: '22:00' }] }, avgRating: '0', reviewCount: 0, bookingCount: 0, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-07T09:42:16.709Z', deletedAt: null,
  };
  adjust(shop);
  const aliases = [['LEGACY_STORE_ID', 'Massajoy1.0', '772'], ['LEGACY_OWNER_REF', 'Massajoy1.0', '772:0'], ['SHORT_NAME', 'massajoy', 'fixture-772'], ['LEGACY_ID', 'massajoy1', '772']].map(([kind, source, value], index) => ({ id: String(6710 + index), shopId, kind, source, value, isActive: true, createdAt: shop.createdAt, updatedAt: shop.createdAt }));
  const sourceRow = { id: '772', ownerId: '0', addr: 'Lake Havasu City, AZ 86403, USA', customer_tel: '928-846-1119' };
  const sealedAnchor = Object.fromEntries(ANCHOR_FIELDS.map(field => [field, copy(shop[field])]));
  const images = [{ shopId, shop, aliases, sourceRow, sealedAnchor }], confirmedFields = { address: street };
  const record = { shopId, sourceShopId: '772', sourceRowDigest: digest(sourceRow), sealedAnchorDigest: digest(sealedAnchor), aliasesDigest: digest(aliases), confirmedFields, observedEvidence: [{ id: 'official-contact-671', url: officialUrl, snapshotSha256: 'b'.repeat(64), observedAt: '2026-11-11T04:00:00.000Z', quote: 'Synthetic contact fixture: 208 English Village, Suite 208, Lake Havasu City, AZ 86403', observedFields: copy(confirmedFields) }] };
  return seal({ images, sourceSha256: SOURCE_SHA256, expectedInventorySha256: inventorySha, now: '2026-11-11T05:00:00.000Z' }, { schemaVersion: 1, policyId: POLICY_ID, sourceSqlSha256: SOURCE_SHA256, inventorySha256: inventorySha, records: [record] });
}
const planFor = (input, target = 'qa') => batch4PublicSourceRepairPlan(input, { target, ...(target === 'main' ? { acknowledgeMainBatch4AddressOnly: true } : {}) });
const options = (plan, extra = {}) => ({ target: 'qa', databaseUrl: url(QA_TARGET), expectedPlanDigest: plan.digest, expectedEvidenceSha256: plan.evidenceSha256, expectedInventorySha256: plan.inventorySha256, ...extra });
function fakeDatabase(input, { failCas = false, throwAfterWrite = false, readbackDrift = false, population = 1335 } = {}) {
  let committed = copy({ shop: input.images[0].shop, aliases: input.images[0].aliases }), active;
  const writes = [], locks = [], transactions = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { const sql = strings.join('?'); if (sql.includes('DATABASE()')) return [{ name: QA_TARGET.database }]; locks.push({ table: sql.includes('shop_aliases') ? 'shop_aliases' : 'shops', id: String(values[0]) }); return []; },
    shop: {
      count: async () => population,
      findUnique: async ({ where }) => { assert.equal(String(where.id), '671'); const shop = copy(active.shop); if (readbackDrift && writes.length) shop.description = 'unexpected readback'; return shop; },
      updateMany: async ({ where, data }) => {
        writes.push(copy({ where, data })); assert.deepEqual(Object.keys(where).sort(), [...SHOP_FIELDS].sort());
        for (const field of SHOP_FIELDS) assert(equal(['studioProfile', 'businessHours'].includes(field) ? where[field].equals : where[field], active.shop[field]), 'CAS includes original ' + field);
        if (failCas) return { count: 0 };
        active.shop = { ...active.shop, ...copy(data) }; if (throwAfterWrite) throw Error('Synthetic failure after address write'); return { count: 1 };
      },
    },
    shopAlias: { findMany: async ({ where }) => { assert.equal(String(where.shopId), '671'); return copy(active.aliases); } },
  };
  const db = { $transaction: async (callback, configuration) => { transactions.push(configuration); assert.equal(configuration.isolationLevel, 'Serializable'); active = copy(committed); try { const result = await callback(tx); committed = active; return result; } finally { active = null; } } };
  return { db, writes, locks, transactions, image: () => copy(committed), change: work => work(committed) };
}

test('fourth batch accepts only shop671/source772 complete official-contact street and refuses older or broader manifests', () => {
  const input = fixture(); assert.deepEqual(planFor(input).changes.map(change => change.shopId), ['671']);
  for (const mutate of [m => m.policyId = 'public-source-field-verification-2026-11-11-r3-v1', m => m.records[0].shopId = '151', m => m.records[0].sourceShopId = '216', m => m.records.push(copy(m.records[0])), m => m.records[0].confirmedFields.phone = '+19288461119', m => m.records[0].confirmedFields.timezone = 'America/Phoenix', m => m.records[0].observedEvidence[0].observedFields.address = '208 English Village', m => m.records[0].observedEvidence[0].url = 'https://londonbridgewellnesscenter.com/']) {
    const manifest = JSON.parse(input.evidenceBytes); mutate(manifest); assert.throws(() => planFor(seal(input, manifest)));
  }
  const extra = fixture(); extra.images.push(copy(extra.images[0])); assert.throws(() => planFor(extra), /BATCH_SHOP_ALLOWLIST/);
});

test('complete source and sealed preimages, evidence bytes, four aliases and exact real zero owner reference are required', () => {
  assert.equal(fixture().images[0].aliases[1].value, '772:0');
  for (const mutate of [i => delete i.images[0].shop.ownerId, i => delete i.images[0].aliases[0].updatedAt, i => i.images[0].aliases.pop(), i => i.images[0].sourceRow.addr += ' altered', i => i.images[0].sealedAnchor.address = 'altered', i => i.expectedInventorySha256 = '0'.repeat(64), i => i.evidenceBytes = Buffer.concat([i.evidenceBytes, Buffer.from(' ')]), i => i.sourceSha256 = '0'.repeat(64)]) { const input = fixture(); mutate(input); assert.throws(() => planFor(input)); }
  for (const value of ['772:1', '772:00', '772:*', '216:127']) {
    const input = fixture(); input.images[0].aliases[1].value = value; const manifest = JSON.parse(input.evidenceBytes); manifest.records[0].aliasesDigest = digest(input.images[0].aliases);
    assert.throws(() => planFor(seal(input, manifest)), /ALIAS_OWNER_REFERENCE/);
  }
});

test('only address, provenance and timestamp change; every other scalar, contact, permission, hour and historical marker is preserved', () => {
  const change = planFor(fixture()).changes[0]; assert.deepEqual(Object.keys(change.data).sort(), ['address', 'studioProfile', 'updatedAt']); assert.equal(change.data.address, street);
  assert.deepEqual(Object.keys(change.data.studioProfile.publicSourceVerification.fields), ['address']); assert.equal(change.data.studioProfile.publicSourceVerification.fields.address.value, street);
  const profile = copy(change.after.shop.studioProfile); delete profile.publicSourceVerification; assert.deepEqual(profile, change.before.shop.studioProfile); assert.deepEqual(change.before.aliases, change.after.aliases);
  for (const field of SHOP_FIELDS.filter(field => !Object.hasOwn(change.data, field))) assert.deepEqual(change.before.shop[field], change.after.shop[field]);
  assert.deepEqual(change.after.shop.studioProfile.phones, ['928-846-1119', ' (800) 555-0100 ']); assert.equal(change.after.shop.studioProfile.legacyImport.loginEnabled, false); assert.equal(change.after.shop.studioProfile.features.onlineBooking, false);
});

test('an already correct street needs only verification; rebuilding from the applied row yields an exact no-op', async () => {
  const input = fixture(shop => { shop.address = street; }), plan = planFor(input), fake = fakeDatabase(input);
  assert.deepEqual(Object.keys(plan.changes[0].data).sort(), ['studioProfile', 'updatedAt']);
  await executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }));
  const fresh = planFor({ ...input, images: [{ ...input.images[0], shop: fake.image().shop }] }); assert.equal(fresh.status, 'already-applied'); assert.equal(fresh.changes[0].data, null);
  assert.equal((await executeBatch4PublicSourceRepairPlan(fake.db, fresh, options(fresh, { mode: 'apply' }))).updatedStores, 0); assert.equal(fake.writes.length, 1);
  const conflict = fixture(); conflict.images[0].shop.studioProfile.publicSourceVerification = { fields: { state: { status: 'verified' } } }; assert.throws(() => planFor(conflict), /EXISTING_VERIFICATION_CONFLICT/);
});

test('default dry-run writes nothing; exact one-row locked CAS applies once, replays and QA-rolls back the full image', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input), before = fake.image();
  assert.equal((await executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan))).status, 'dry-run'); assert.equal(fake.writes.length, 0); assert.deepEqual(fake.image(), before);
  assert.deepEqual(fake.locks, [{ table: 'shops', id: '671' }, { table: 'shop_aliases', id: '671' }]);
  const applied = await executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); assert.equal(applied.updatedStores, 1); assert.deepEqual(fake.image(), plan.changes[0].after);
  assert.equal((await executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))).status, 'already-applied'); assert.equal(fake.writes.length, 1);
  assert.equal((await executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply', rollback: true }))).status, 'rolled-back'); assert.deepEqual(fake.image(), before);
  assert.deepEqual(Object.keys(fake.writes[1].data).sort(), ['address', 'studioProfile', 'updatedAt']);
});

test('concurrent changes to any protected scalar, deep profile or alias and re-signed wider plans are refused before UPDATE', async () => {
  for (const mutate of [row => row.shop.city = 'manual city', row => row.shop.state = 'Nevada', row => row.shop.zipCode = '89001', row => row.shop.timezone = 'America/Denver', row => row.shop.phone = '928-555-0100', row => row.shop.description = 'manual description', row => row.shop.studioProfile.features.onlineBooking = true, row => row.aliases[0].updatedAt = '2026-11-12T00:00:00.000Z']) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input); fake.change(mutate); await assert.rejects(executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /CONCURRENT_CHANGE/); assert.equal(fake.writes.length, 0);
  }
  for (const field of ['city', 'state', 'zipCode', 'timezone', 'phone', 'ownerId', 'status', 'businessHours']) {
    const plan = copy(planFor(fixture())); plan.changes[0].data[field] = 'forbidden'; const { digest: previous, ...body } = plan; plan.digest = digest(body); let entered = false;
    await assert.rejects(executeBatch4PublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { mode: 'apply' }))); assert.equal(entered, false);
  }
});

test('CAS failure, exception after address write or readback drift rolls back; unexpected store population prevents writing', async () => {
  for (const configuration of [{ failCas: true }, { throwAfterWrite: true }, { readbackDrift: true }]) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, configuration), before = fake.image();
    await assert.rejects(executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))); assert.deepEqual(fake.image(), before); assert.equal(fake.transactions.length, 1); assert.equal(fake.writes.length, 1);
  }
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, { population: 1334 }); await assert.rejects(executeBatch4PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /UNEXPECTED_STORE_POPULATION/); assert.equal(fake.writes.length, 0);
});

test('QA identity and local-only URL are exact; main needs its distinct acknowledgment and cannot use rollback', async () => {
  assert.equal(batch4RepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'development' }), url(QA_TARGET));
  for (const foreign of [url(QA_TARGET).replace(QA_TARGET.database, 'mj2_store_sources_r3_qa_7afc5e3c49'), url(QA_TARGET).replace(':33091/', ':33090/'), url(QA_TARGET).replace('127.0.0.1', 'localhost'), url(QA_TARGET) + '?x=1']) assert.throws(() => batch4RepairUrl(foreign, { target: 'qa' }), /EXACT_TARGET/);
  assert.throws(() => batch4RepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'production' }), /LOCAL_ONLY/); assert.throws(() => batch4RepairUrl(url(MAIN_TARGET), { target: 'main' }), /MAIN_EXPLICIT_ACK/);
  const plan = planFor(fixture(), 'main'); let entered = false;
  await assert.rejects(executeBatch4PublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { target: 'main', databaseUrl: url(MAIN_TARGET), acknowledgeMainBatch4AddressOnly: true, rollback: true })), /MAIN_ROLLBACK/); assert.equal(entered, false);
});
