import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_ID, SOURCE_SHA256, MAIN_TARGET, QA_TARGET, SHOP_FIELDS, ANCHOR_FIELDS, TIMEZONE_RULE, canonical, equal, digest, bytesDigest, batch5RepairUrl, batch5PublicSourceRepairPlan, executeBatch5PublicSourceRepairPlan } from './store-public-source-batch5-plan.mjs';

const copy = value => structuredClone(canonical(value));
const inventorySha = 'a'.repeat(64);
const location = { address: '10 Southdale Cir, #2060', city: 'Edina', state: 'Minnesota', zipCode: '55435-2402', timezone: 'America/Chicago' };
const observedFields = Object.fromEntries(Object.entries(location).filter(([field]) => field !== 'timezone'));
const officialUrl = 'https://dragoncityacupressuremn.com/contact';
const url = target => `mysql://fixture:fixture@127.0.0.1:${target.port}/${target.database}`;
function seal(input, manifest) { const evidenceBytes = Buffer.from(JSON.stringify(manifest)); return { ...input, evidenceBytes, expectedEvidenceSha256: bytesDigest(evidenceBytes) }; }
function fixture(adjust = () => {}) {
  const shopId = '791', shop = {
    id: shopId, ownerId: '791', name: 'Synthetic Dragon City fixture', shortName: 'fixture-894', timezone: 'America/Chicago', studioProfile: {
      legacyImport: { source: 'Massajoy1.0', sourceShopId: '894', sourceOwnerId: '0', loginEnabled: false, timezoneNeedsReview: true },
      phones: ['9529208550', ' (800) 555-0100 '], links: {},
      features: { onlineBooking: false, onlinePayment: false },
      provisionalCompletion: { fields: { address: { value: 'Address pending update', needsReview: true }, city: { value: 'Pending update', needsReview: true }, state: { value: 'Pending update', needsReview: true }, zipCode: { value: '00000', needsReview: true }, timezone: { value: 'America/Chicago', needsReview: true } }, preservedDeepData: { items: [1, 2, 3] } },
    },
    nameEn: null, description: 'Preserved description', phone: '9529208550', address: 'Address pending update', city: 'Pending update', state: 'Pending update', zipCode: '00000', latitude: '0', longitude: '0', category: 'MIXED', status: 'APPROVED', reviewComment: null, reviewedAt: null, reviewedBy: null, shopType: 'APPRENTICE',
    businessHours: { monday: [{ open: '09:00', close: '22:00' }] }, avgRating: '0', reviewCount: 0, bookingCount: 0, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-07T09:42:16.709Z', deletedAt: null,
  };
  adjust(shop);
  const aliases = [['LEGACY_STORE_ID', 'Massajoy1.0', '894'], ['LEGACY_OWNER_REF', 'Massajoy1.0', '894:0'], ['SHORT_NAME', 'massajoy', 'fixture-894'], ['LEGACY_ID', 'massajoy1', '894']].map(([kind, source, value], index) => ({ id: String(7910 + index), shopId, kind, source, value, isActive: true, createdAt: shop.createdAt, updatedAt: shop.createdAt }));
  const sourceRow = { id: '894', uid: '0', addr: '', phone: '', customer_tel: '9529208550' };
  const sealedAnchor = Object.fromEntries(ANCHOR_FIELDS.map(field => [field, copy(shop[field])]));
  const images = [{ shopId, shop, aliases, sourceRow, sealedAnchor }];
  const record = { shopId, sourceShopId: '894', sourceRowDigest: digest(sourceRow), sealedAnchorDigest: digest(sealedAnchor), aliasesDigest: digest(aliases), confirmedFields: copy(location),
    observedEvidence: [{ id: '791-official-contact-location-20261111', url: officialUrl, snapshotSha256: 'b'.repeat(64), observedAt: '2026-11-11T13:00:00.000Z', quote: 'Synthetic contact fixture: 10 Southdale Cir, #2060, Edina, MN 55435-2402; 952-920-8550', observedFields: copy(observedFields) }],
    derivedEvidence: [{ ...copy(TIMEZONE_RULE), evidenceIds: ['791-official-contact-location-20261111'] }],
  };
  return seal({ images, sourceSha256: SOURCE_SHA256, expectedInventorySha256: inventorySha, now: '2026-11-11T14:00:00.000Z' }, { schemaVersion: 1, policyId: POLICY_ID, sourceSqlSha256: SOURCE_SHA256, inventorySha256: inventorySha, records: [record] });
}
const planFor = (input, target = 'qa') => batch5PublicSourceRepairPlan(input, { target, ...(target === 'main' ? { acknowledgeMainBatch5LocationOnly: true } : {}) });
const options = (plan, extra = {}) => ({ target: 'qa', databaseUrl: url(QA_TARGET), expectedPlanDigest: plan.digest, expectedEvidenceSha256: plan.evidenceSha256, expectedInventorySha256: plan.inventorySha256, ...extra });
function fakeDatabase(input, { failCas = false, throwAfterWrite = false, readbackDrift = false, population = 1335 } = {}) {
  let committed = copy({ shop: input.images[0].shop, aliases: input.images[0].aliases }), active;
  const writes = [], locks = [], transactions = [];
  const tx = {
    $queryRaw: async (strings, ...values) => { const sql = strings.join('?'); if (sql.includes('DATABASE()')) return [{ name: QA_TARGET.database }]; locks.push({ table: sql.includes('shop_aliases') ? 'shop_aliases' : 'shops', id: String(values[0]) }); return []; },
    shop: {
      count: async () => population,
      findUnique: async ({ where }) => { assert.equal(String(where.id), '791'); const shop = copy(active.shop); if (readbackDrift && writes.length) shop.description = 'unexpected readback'; return shop; },
      updateMany: async ({ where, data }) => {
        writes.push(copy({ where, data })); assert.deepEqual(Object.keys(where).sort(), [...SHOP_FIELDS].sort());
        for (const field of SHOP_FIELDS) assert(equal(['studioProfile', 'businessHours'].includes(field) ? where[field].equals : where[field], active.shop[field]), 'CAS includes original ' + field);
        if (failCas) return { count: 0 };
        active.shop = { ...active.shop, ...copy(data) }; if (throwAfterWrite) throw Error('Synthetic failure after location write'); return { count: 1 };
      },
    },
    shopAlias: { findMany: async ({ where }) => { assert.equal(String(where.shopId), '791'); return copy(active.aliases); } },
  };
  const db = { $transaction: async (callback, configuration) => { transactions.push(configuration); assert.equal(configuration.isolationLevel, 'Serializable'); active = copy(committed); try { const result = await callback(tx); committed = active; return result; } finally { active = null; } } };
  return { db, writes, locks, transactions, image: () => copy(committed), change: work => work(committed) };
}

test('fifth batch accepts only 791/source894 five-field location and rejects older, broader or falsely official timezone evidence', () => {
  const input = fixture(); assert.deepEqual(planFor(input).changes.map(change => change.shopId), ['791']);
  for (const mutate of [m => m.policyId = 'public-source-address-verification-2026-11-11-r4-v1', m => m.records[0].shopId = '671', m => m.records[0].sourceShopId = '772', m => m.records.push(copy(m.records[0])), m => m.records[0].confirmedFields.phone = '+19529208550', m => m.records[0].confirmedFields.city = 'Minneapolis', m => m.records[0].observedEvidence[0].observedFields.timezone = 'America/Chicago', m => m.records[0].observedEvidence[0].observedFields.zipCode = '55435', m => m.records[0].observedEvidence[0].url = 'https://dragoncityacupressuremn.com/', m => delete m.records[0].derivedEvidence, m => m.records[0].derivedEvidence[0].inputs.state = 'Wisconsin', m => m.records[0].derivedEvidence[0].resolver.sha256 = '0'.repeat(64), m => m.records[0].derivedEvidence[0].evidenceIds = ['unknown-source']]) {
    const manifest = JSON.parse(input.evidenceBytes); mutate(manifest); assert.throws(() => planFor(seal(input, manifest)));
  }
  const extra = fixture(); extra.images.push(copy(extra.images[0])); assert.throws(() => planFor(extra), /BATCH_SHOP_ALLOWLIST/);
});

test('full scalar and sealed preimages, evidence bytes, four aliases and exact owner894:0 are required; sealed manual locations are protected', () => {
  assert.equal(fixture().images[0].aliases[1].value, '894:0');
  for (const mutate of [i => delete i.images[0].shop.ownerId, i => delete i.images[0].aliases[0].updatedAt, i => i.images[0].aliases.pop(), i => i.images[0].sourceRow.addr = 'altered', i => i.images[0].sealedAnchor.address = 'altered', i => i.expectedInventorySha256 = '0'.repeat(64), i => i.evidenceBytes = Buffer.concat([i.evidenceBytes, Buffer.from(' ')]), i => i.sourceSha256 = '0'.repeat(64)]) { const input = fixture(); mutate(input); assert.throws(() => planFor(input)); }
  for (const value of ['894:1', '894:00', '894:*', '772:0']) {
    const input = fixture(); input.images[0].aliases[1].value = value; const manifest = JSON.parse(input.evidenceBytes); manifest.records[0].aliasesDigest = digest(input.images[0].aliases);
    assert.throws(() => planFor(seal(input, manifest)), /ALIAS_OWNER_REFERENCE/);
  }
  for (const [field, value] of Object.entries({ address: 'Manual location', city: 'Manual city', state: 'Wisconsin', zipCode: '55555', timezone: 'America/Denver' })) assert.throws(() => planFor(fixture(shop => { shop[field] = value; })), /NONPROVISIONAL_LOCATION/);
});

test('four actual location scalars change; the existing Chicago timezone receives separate derived provenance and all other data stays intact', () => {
  const change = planFor(fixture()).changes[0]; assert.deepEqual(Object.keys(change.data).sort(), ['address', 'city', 'state', 'studioProfile', 'updatedAt', 'zipCode']);
  for (const [field, value] of Object.entries(location)) assert.equal(change.after.shop[field], value);
  const marker = change.data.studioProfile.publicSourceVerification;
  assert.deepEqual(Object.keys(marker.fields).sort(), Object.keys(location).sort());
  for (const field of Object.keys(observedFields)) assert.equal(marker.fields[field].basis, 'public-official');
  assert.equal(marker.fields.timezone.basis, 'derived-from-verified-location'); assert.deepEqual(marker.fields.timezone.evidenceIds, ['verified-minnesota-timezone']);
  assert.equal(Object.hasOwn(marker.observedEvidence[0].observedFields, 'timezone'), false); assert.deepEqual(marker.derivedEvidence[0].inputs, TIMEZONE_RULE.inputs);
  const profile = copy(change.after.shop.studioProfile); delete profile.publicSourceVerification; assert.deepEqual(profile, change.before.shop.studioProfile); assert.deepEqual(change.before.aliases, change.after.aliases);
  for (const field of SHOP_FIELDS.filter(field => !Object.hasOwn(change.data, field))) assert.deepEqual(change.before.shop[field], change.after.shop[field]);
  assert.deepEqual(change.after.shop.studioProfile.phones, ['9529208550', ' (800) 555-0100 ']); assert.equal(change.after.shop.studioProfile.legacyImport.loginEnabled, false); assert.equal(change.after.shop.studioProfile.features.onlineBooking, false);
});

test('already correct subsets are not rewritten; all correct values need only verification and an applied row rebuilds to no-op', async () => {
  const partial = planFor(fixture(shop => { shop.city = location.city; shop.zipCode = location.zipCode; })).changes[0];
  assert.deepEqual(Object.keys(partial.data).sort(), ['address', 'state', 'studioProfile', 'updatedAt']);
  const input = fixture(shop => Object.assign(shop, location)), plan = planFor(input), fake = fakeDatabase(input);
  assert.deepEqual(Object.keys(plan.changes[0].data).sort(), ['studioProfile', 'updatedAt']);
  await executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }));
  const fresh = planFor({ ...input, images: [{ ...input.images[0], shop: fake.image().shop }] }); assert.equal(fresh.status, 'already-applied'); assert.equal(fresh.changes[0].data, null);
  assert.equal((await executeBatch5PublicSourceRepairPlan(fake.db, fresh, options(fresh, { mode: 'apply' }))).updatedStores, 0); assert.equal(fake.writes.length, 1);
  const conflict = fixture(); conflict.images[0].shop.studioProfile.publicSourceVerification = { fields: { state: { status: 'verified' } } }; assert.throws(() => planFor(conflict), /EXISTING_VERIFICATION_CONFLICT/);
});

test('default dry-run writes nothing; exact locked one-row CAS applies once, replays and QA-rolls back all four changed scalars plus provenance', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input), before = fake.image();
  assert.equal((await executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan))).status, 'dry-run'); assert.equal(fake.writes.length, 0); assert.deepEqual(fake.image(), before);
  assert.deepEqual(fake.locks, [{ table: 'shops', id: '791' }, { table: 'shop_aliases', id: '791' }]);
  const applied = await executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); assert.equal(applied.updatedStores, 1); assert.deepEqual(fake.image(), plan.changes[0].after);
  assert.equal((await executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))).status, 'already-applied'); assert.equal(fake.writes.length, 1);
  assert.equal((await executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply', rollback: true }))).status, 'rolled-back'); assert.deepEqual(fake.image(), before);
  assert.deepEqual(Object.keys(fake.writes[1].data).sort(), ['address', 'city', 'state', 'studioProfile', 'updatedAt', 'zipCode']); assert.equal(Object.hasOwn(fake.writes[1].data, 'timezone'), false);
});

test('concurrent scalar, profile or alias changes and re-signed wider plans are refused before UPDATE', async () => {
  for (const mutate of [row => row.shop.city = 'manual city', row => row.shop.state = 'Wisconsin', row => row.shop.zipCode = '55555', row => row.shop.timezone = 'America/Denver', row => row.shop.phone = '952-555-0100', row => row.shop.description = 'manual description', row => row.shop.studioProfile.features.onlineBooking = true, row => row.aliases[0].updatedAt = '2026-11-12T00:00:00.000Z']) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input); fake.change(mutate); await assert.rejects(executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /CONCURRENT_CHANGE/); assert.equal(fake.writes.length, 0);
  }
  for (const field of ['phone', 'ownerId', 'status', 'businessHours', 'city', 'timezone']) {
    const plan = copy(planFor(fixture())); plan.changes[0].data[field] = 'forbidden'; const { digest: previous, ...body } = plan; plan.digest = digest(body); let entered = false;
    await assert.rejects(executeBatch5PublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { mode: 'apply' }))); assert.equal(entered, false);
  }
});

test('CAS failure, exception after location write or readback drift rolls back; an unexpected population prevents writing', async () => {
  for (const configuration of [{ failCas: true }, { throwAfterWrite: true }, { readbackDrift: true }]) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, configuration), before = fake.image();
    await assert.rejects(executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))); assert.deepEqual(fake.image(), before); assert.equal(fake.transactions.length, 1); assert.equal(fake.writes.length, 1);
  }
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, { population: 1334 }); await assert.rejects(executeBatch5PublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /UNEXPECTED_STORE_POPULATION/); assert.equal(fake.writes.length, 0);
});

test('QA identity and local URL are exact; main requires its distinct acknowledgment and rejects rollback', async () => {
  assert.equal(batch5RepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'development' }), url(QA_TARGET));
  for (const foreign of [url(QA_TARGET).replace(QA_TARGET.database, 'mj2_store_sources_r4_qa_9a9d8853bf'), url(QA_TARGET).replace(':33091/', ':33090/'), url(QA_TARGET).replace('127.0.0.1', 'localhost'), url(QA_TARGET) + '?x=1']) assert.throws(() => batch5RepairUrl(foreign, { target: 'qa' }), /EXACT_TARGET/);
  assert.throws(() => batch5RepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'production' }), /LOCAL_ONLY/); assert.throws(() => batch5RepairUrl(url(MAIN_TARGET), { target: 'main' }), /MAIN_EXPLICIT_ACK/);
  const plan = planFor(fixture(), 'main'); let entered = false;
  await assert.rejects(executeBatch5PublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { target: 'main', databaseUrl: url(MAIN_TARGET), acknowledgeMainBatch5LocationOnly: true, rollback: true })), /MAIN_ROLLBACK/); assert.equal(entered, false);
});
