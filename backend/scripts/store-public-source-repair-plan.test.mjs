import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_ID, SOURCE_SHA256, FOOT_LEGACY_ADDRESS, QA_TARGET, MAIN_TARGET, SHOP_FIELDS, ANCHOR_FIELDS, canonical, equal, digest, bytesDigest, verifyRuntimeScalarFields, publicSourceRepairUrl, publicSourceRepairPlan, executePublicSourceRepairPlan } from './store-public-source-repair-plan.mjs';

const copy = value => structuredClone(canonical(value));
const inventorySha = 'a'.repeat(64);
const url = target => `mysql://fixture:fixture@127.0.0.1:${target.port}/${target.database}`;
function image(shopId) {
  const sourceId = shopId === '1238' ? '3356' : '2823';
  const shop = { id: shopId, ownerId: '1000', name: 'Synthetic fixture', shortName: 'fixture-' + sourceId, timezone: shopId === '1238' ? 'America/New_York' : 'America/Chicago',
    studioProfile: { legacyImport: { source: 'Massajoy1.0', sourceShopId: sourceId }, mapShareUrl: '', features: { onlineBooking: false }, provisionalCompletion: { state: { needsReview: true }, arbitraryNested: { values: [1, 2] } } },
    nameEn: null, description: 'Preserved description', phone: '555-555-0100', address: shopId === '1238' ? '5560 William Flinn Hwy Ste 100' : 'Address pending update', city: shopId === '1238' ? 'Gibsonia' : 'City pending update', state: shopId === '1238' ? 'Pennsylvania' : 'State pending update', zipCode: shopId === '1238' ? '15044' : '77072', latitude: '0', longitude: '0',
    category: 'MASSAGE', status: 'APPROVED', reviewComment: null, reviewedAt: null, reviewedBy: null, shopType: 'APPRENTICE', businessHours: { monday: [{ open: '09:00', close: '22:00' }] }, avgRating: '0', reviewCount: 0, bookingCount: 0, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-07T02:33:46.061Z', deletedAt: null };
  const aliases = [['1', 'LEGACY_STORE_ID', 'Massajoy1.0', sourceId], ['2', 'LEGACY_OWNER_REF', 'Massajoy1.0', sourceId + ':0'], ['3', 'SHORT_NAME', 'massajoy', 'fixture-' + sourceId], ['4', 'LEGACY_ID', 'massajoy1', sourceId]].map(([id, kind, source, value]) => ({ id, shopId, kind, source, value, isActive: true, createdAt: shop.createdAt, updatedAt: shop.createdAt }));
  const sealedAnchor = Object.fromEntries(ANCHOR_FIELDS.map(field => [field, copy(shop[field])]));
  const sourceRow = { id: sourceId, addr: shopId === '1168' ? '11830 BELLAIRE BLVD,STE EHOUSTONTX 77072' : '5560 William Flinn Hwy Ste 100, Gibsonia PA 15044', retainedOriginal: 'source fingerprint includes all parsed source fields' };
  return { shop, aliases, sealedAnchor, sourceRow, sourceSha256: SOURCE_SHA256, now: new Date('2026-11-11T01:00:00.000Z') };
}
function fixture(shopId = '1238') {
  const records = ['1238', '1168'].map(id => {
    const input = image(id), foot = id === '1168';
    return { shopId: id, sourceShopId: foot ? '2823' : '3356', sourceRowDigest: digest(input.sourceRow), sealedAnchorDigest: digest(input.sealedAnchor), aliasesDigest: digest(input.aliases),
      confirmedFields: foot ? { address: '11830 Bellaire Blvd, Ste E', city: 'Houston', state: 'Texas' } : { state: 'Pennsylvania' },
      observedEvidence: [{ id: foot ? 'foot-official' : 'amy-official', url: foot ? 'https://www.txafootmassage.com/' : 'https://www.amysmassagepa.com/', snapshotSha256: 'b'.repeat(64), observedAt: '2026-11-11T00:30:00.000Z', quote: foot ? '11830 Bellaire Blvd, Houston TX 77072' : '5560 William Flinn Hwy, Gibsonia PA 15044', observedFields: foot ? { address: '11830 Bellaire Blvd', city: 'Houston', state: 'Texas' } : { state: 'Pennsylvania' } }] };
  });
  const manifest = { schemaVersion: 1, policyId: POLICY_ID, sourceSqlSha256: SOURCE_SHA256, inventorySha256: inventorySha, records };
  return withManifest({ ...image(shopId), expectedInventorySha256: inventorySha }, manifest);
}
function withManifest(input, manifest) { const evidenceBytes = Buffer.from(JSON.stringify(manifest)); return { ...input, evidenceBytes, expectedEvidenceSha256: bytesDigest(evidenceBytes) }; }
const planFor = (input, target = 'qa') => publicSourceRepairPlan(input, { target, ...(target === 'main' ? { acknowledgeMainPublicSourceOnly: true } : {}) });
const options = (plan, extra = {}) => ({ target: 'qa', databaseUrl: url(QA_TARGET), expectedPlanDigest: plan.digest, expectedEvidenceSha256: plan.evidenceSha256, expectedInventorySha256: plan.inventorySha256, ...extra });
function fakeDatabase(input, { count = 1, failAfterWrite = false, readbackMutation = false, database = QA_TARGET.database, population = 1335 } = {}) {
  let committed = copy({ shop: input.shop, aliases: input.aliases }), active;
  const events = [], writes = [];
  const tx = {
    $queryRaw: async strings => { const sql = strings.join('?'); if (sql.includes('DATABASE()')) return [{ name: database }]; events.push(sql.includes('shop_aliases') ? 'alias-lock' : 'shop-lock'); return []; },
    shop: {
      count: async () => population,
      findUnique: async () => { const row = copy(active.shop); if (readbackMutation && writes.length) row.phone = 'unexpected'; return row; },
      updateMany: async ({ where, data }) => {
        events.push('cas-write'); writes.push(copy({ where, data }));
        assert.deepEqual(Object.keys(where).sort(), [...SHOP_FIELDS].sort());
        for (const field of SHOP_FIELDS) { const value = ['studioProfile', 'businessHours'].includes(field) ? where[field].equals : where[field]; if (!equal(value, active.shop[field])) return { count: 0 }; }
        if (count !== 1) return { count };
        active.shop = { ...active.shop, ...copy(data) }; if (failAfterWrite) throw Error('failure after UPDATE'); return { count: 1 };
      },
    },
    shopAlias: { findMany: async () => copy(active.aliases) },
  };
  const db = { $transaction: async (callback, configuration) => { assert.equal(configuration.isolationLevel, 'Serializable'); active = copy(committed); try { const result = await callback(tx); committed = active; return result; } catch (error) { events.push('rollback'); throw error; } finally { active = null; } } };
  return { db, events, writes, image: () => copy(committed), change: work => work(committed) };
}

test('only explicit exact main and disposable QA targets are accepted; production and substitutions fail', () => {
  assert.equal(publicSourceRepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'development' }), url(QA_TARGET));
  assert.throws(() => publicSourceRepairUrl(url(QA_TARGET)), /EXPLICIT_TARGET/);
  for (const candidate of [url(MAIN_TARGET), url(QA_TARGET).replace('127.0.0.1', 'localhost'), url(QA_TARGET) + '?x=1', url(QA_TARGET) + '#x', url(QA_TARGET).replace('fixture:fixture@', ''), url(QA_TARGET).replace(QA_TARGET.database, 'other')]) assert.throws(() => publicSourceRepairUrl(candidate, { target: 'qa', nodeEnv: 'development' }));
  assert.throws(() => publicSourceRepairUrl(url(QA_TARGET), { target: 'qa', nodeEnv: 'production' }), /LOCAL_ONLY/);
  assert.throws(() => publicSourceRepairUrl(url(MAIN_TARGET), { target: 'main' }), /MAIN_EXPLICIT_ACK/);
});
test('runtime additions and incomplete full shop, alias and old inventory preimages fail closed', () => {
  verifyRuntimeScalarFields(SHOP_FIELDS); assert.throws(() => verifyRuntimeScalarFields([...SHOP_FIELDS, 'future']), /SCHEMA_DRIFT/);
  for (const mutate of [i => delete i.shop.ownerId, i => delete i.aliases[0].updatedAt, i => delete i.sealedAnchor.businessHours]) { const input = fixture(); mutate(input); assert.throws(() => planFor(input), /INCOMPLETE/); }
});
test('zero scalar change still records only Pennsylvania verified while preserving historical provisional data', () => {
  const input = fixture(), original = copy(input.shop), plan = planFor(input);
  assert.deepEqual(Object.keys(plan.data).sort(), ['studioProfile', 'updatedAt']);
  assert.deepEqual(Object.keys(plan.data.studioProfile.publicSourceVerification.fields), ['state']);
  assert.equal(plan.data.studioProfile.publicSourceVerification.fields.state.value, 'Pennsylvania');
  assert.deepEqual(plan.data.studioProfile.provisionalCompletion, original.studioProfile.provisionalCompletion);
  assert.deepEqual(copy(input.shop), original); assert.deepEqual(plan.after.aliases, input.aliases);
});
test('Foot changes exactly street/city/state and attributes Suite E to original source separately', () => {
  const input = fixture('1168'), plan = planFor(input);
  assert.equal(input.sourceRow.addr, FOOT_LEGACY_ADDRESS, 'uses the actual concatenated legacy raw value');
  assert.deepEqual(Object.keys(plan.data).sort(), ['address', 'city', 'state', 'studioProfile', 'updatedAt']);
  assert.equal(plan.data.address, '11830 Bellaire Blvd, Ste E');
  assert.equal(plan.data.studioProfile.publicSourceVerification.fields.address.basis, 'official-street-and-legacy-suite');
  for (const field of SHOP_FIELDS.filter(key => !Object.hasOwn(plan.data, key))) assert.deepEqual(plan.after.shop[field], plan.before.shop[field]);
  assert.equal(plan.after.shop.timezone, input.shop.timezone); assert.equal(plan.after.shop.zipCode, input.shop.zipCode);
});
test('third shop, wrong legacy ID, source fingerprint, old anchor and alias drift are rejected', () => {
  for (const mutate of [i => i.shop.id = '1255', i => i.sourceRow.id = '3416', i => i.sourceRow.retainedOriginal += ' changed', i => i.sourceSha256 = '0'.repeat(64), i => i.sealedAnchor.phone = 'changed', i => i.aliases[0].isActive = false, i => i.aliases[0].value = '3416', i => i.shop.studioProfile.provisionalCompletion.arbitraryNested.values.push(3), i => i.shop.timezone = 'America/Phoenix']) { const input = fixture(); mutate(input); assert.throws(() => planFor(input)); }
});
test('both real zero-owner references are accepted exactly; even re-pinned aliases cannot substitute another suffix', () => {
  for (const shopId of ['1238', '1168']) {
    const input = fixture(shopId), sourceId = shopId === '1238' ? '3356' : '2823';
    assert.equal(input.aliases[1].value, sourceId + ':0'); assert.equal(planFor(input).status, 'pending');
    for (const suffix of ['1', '376', '00', '-1', '0x0', '*', '']) {
      const changed = fixture(shopId); changed.aliases[1].value = sourceId + ':' + suffix;
      const manifest = JSON.parse(changed.evidenceBytes); manifest.records.find(record => record.shopId === shopId).aliasesDigest = digest(changed.aliases);
      assert.throws(() => planFor(withManifest(changed, manifest)), /ALIAS_SOURCE_MISMATCH/);
    }
  }
});
test('evidence bytes and both fixed external SHA anchors must match, including one-byte drift', () => {
  for (const mutate of [i => i.evidenceBytes = Buffer.concat([i.evidenceBytes, Buffer.from(' ')]), i => i.expectedEvidenceSha256 = '0'.repeat(64), i => i.expectedInventorySha256 = '0'.repeat(64)]) { const input = fixture(); mutate(input); assert.throws(() => planFor(input)); }
});
test('even newly signed evidence cannot expand fields, shops, values or claim suite official verification', () => {
  for (const change of [m => m.records[0].confirmedFields.phone = '123', m => m.records[0].confirmedFields.timezone = 'America/Phoenix', m => m.records[0].confirmedFields.state = 'Texas', m => m.records[0].shopId = '1255', m => m.records[1].observedEvidence[0].observedFields.address = '11830 Bellaire Blvd, Ste E', m => m.records[0].observedEvidence[0].observedFields.state = 'Texas', m => m.records[0].observedEvidence = []]) {
    const input = fixture(), manifest = JSON.parse(input.evidenceBytes); change(manifest); assert.throws(() => planFor(withManifest(input, manifest)));
  }
});
test('Suite E cannot be added without matching original legacy street and suite evidence', () => {
  for (const addr of ['11830 Bellaire Blvd Houston TX 77072', 'Other street STE E', '11830 BELLAIRE BLVD,STE EASTHOUSTONTX 77072', '11830 BELLAIRE BLVD,STE EHOUSTONTX 77073', '11830 Bellaire Blvd STE E Houston TX 77072']) {
    const input = fixture('1168'); input.sourceRow.addr = addr; const manifest = JSON.parse(input.evidenceBytes); manifest.records[1].sourceRowDigest = digest(input.sourceRow);
    assert.throws(() => planFor(withManifest(input, manifest)), /LEGACY_SUITE_EVIDENCE/);
  }
});
test('no unrecognized existing verification marker is overwritten', () => { const input = fixture(); input.shop.studioProfile.publicSourceVerification = { other: true }; assert.throws(() => planFor(input), /EXISTING_VERIFICATION/); });
test('planning is deterministic, key-order independent and applied-marker planning is idempotent', () => {
  const input = fixture(), plan = planFor(input); assert.deepEqual(planFor(input), plan);
  const reordered = { ...input, shop: Object.fromEntries(Object.entries(input.shop).reverse()) }; assert.equal(planFor(reordered).digest, plan.digest);
  const repeated = planFor({ ...input, shop: copy(plan.after.shop) }); assert.equal(repeated.status, 'already-applied'); assert.equal(repeated.data, null);
});
test('execution defaults to locked read-only dry-run with no UPDATE', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input);
  const result = await executePublicSourceRepairPlan(fake.db, plan, options(plan)); assert.equal(result.status, 'dry-run'); assert.equal(fake.writes.length, 0); assert.deepEqual(fake.image(), plan.before);
  assert.deepEqual(fake.events, ['shop-lock', 'alias-lock']);
});
test('apply locks aliases and shop, CASes every scalar, exact-readbacks and replays without additional writes', async () => {
  for (const shopId of ['1238', '1168']) {
    const input = fixture(shopId), plan = planFor(input), fake = fakeDatabase(input);
    const result = await executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); assert.equal(result.status, 'applied'); assert.deepEqual(fake.image(), plan.after);
    assert.deepEqual(fake.events.slice(0, 3), ['shop-lock', 'alias-lock', 'cas-write']);
    const again = await executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); assert.equal(again.status, 'already-applied'); assert.equal(fake.writes.length, 1);
  }
});
test('QA rollback restores exact scalar/profile timestamp image and is itself idempotent', async () => {
  const input = fixture('1168'), plan = planFor(input), fake = fakeDatabase(input);
  await executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }));
  const preview = await executePublicSourceRepairPlan(fake.db, plan, options(plan, { rollback: true })); assert.equal(preview.status, 'rollback-dry-run'); assert.equal(fake.writes.length, 1);
  const result = await executePublicSourceRepairPlan(fake.db, plan, options(plan, { rollback: true, mode: 'apply' })); assert.equal(result.status, 'rolled-back'); assert.deepEqual(fake.image(), plan.before);
  const repeated = await executePublicSourceRepairPlan(fake.db, plan, options(plan, { rollback: true, mode: 'apply' })); assert.equal(repeated.status, 'already-rolled-back'); assert.equal(fake.writes.length, 2);
});
test('any intervening scalar, nested profile, timestamp or alias change prevents an UPDATE', async () => {
  for (const mutate of [row => row.shop.phone = 'manual edit', row => row.shop.businessHours.monday = [], row => row.shop.studioProfile.features.onlineBooking = true, row => row.shop.updatedAt = '2026-11-12T00:00:00.000Z', row => row.aliases[0].updatedAt = '2026-11-12T00:00:00.000Z']) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input); fake.change(mutate); await assert.rejects(executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })), /CONCURRENT_CHANGE/); assert.equal(fake.writes.length, 0);
  }
});
test('rollback never removes later manual data', async () => {
  const input = fixture(), plan = planFor(input), fake = fakeDatabase(input); await executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' })); fake.change(row => row.shop.phone = 'later edit');
  await assert.rejects(executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply', rollback: true })), /CONCURRENT_CHANGE/); assert.equal(fake.image().shop.phone, 'later edit');
});
test('CAS, post-write failure and readback drift all roll the entire transaction back', async () => {
  for (const configuration of [{ count: 0 }, { failAfterWrite: true }, { readbackMutation: true }]) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, configuration);
    await assert.rejects(executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))); assert.deepEqual(fake.image(), plan.before); assert.equal(fake.events.at(-1), 'rollback');
  }
});
test('wrong database or population fails before writes', async () => {
  for (const configuration of [{ database: 'other' }, { population: 1334 }]) {
    const input = fixture(), plan = planFor(input), fake = fakeDatabase(input, configuration); await assert.rejects(executePublicSourceRepairPlan(fake.db, plan, options(plan, { mode: 'apply' }))); assert.equal(fake.writes.length, 0);
  }
});
test('forged plan digest cannot authorize phone/status/hours/account/ZIP/timezone/profile changes', async () => {
  for (const mutate of [p => p.data.phone = 'changed', p => p.data.status = 'PENDING', p => p.data.businessHours = {}, p => p.data.ownerId = '99', p => p.data.zipCode = '00000', p => p.data.timezone = 'America/Phoenix', p => p.data.studioProfile.features.onlineBooking = true, p => p.after.shop.description = 'changed']) {
    const plan = copy(planFor(fixture())); mutate(plan); const { digest: old, ...body } = plan; plan.digest = digest(body); let entered = false;
    await assert.rejects(executePublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, { mode: 'apply' }))); assert.equal(entered, false);
  }
});
test('expected plan/evidence/inventory anchors cannot be substituted', async () => {
  const plan = planFor(fixture());
  for (const extra of [{ expectedPlanDigest: '0'.repeat(64) }, { expectedEvidenceSha256: '0'.repeat(64) }, { expectedInventorySha256: '0'.repeat(64) }]) {
    let entered = false; await assert.rejects(executePublicSourceRepairPlan({ $transaction: async () => { entered = true; } }, plan, options(plan, extra))); assert.equal(entered, false);
  }
});
test('main requires its separate acknowledgment, rejects QA plan and never permits rollback', async () => {
  const input = fixture(), main = planFor(input, 'main'), fake = fakeDatabase(input, { database: MAIN_TARGET.database });
  const opt = options(main, { target: 'main', databaseUrl: url(MAIN_TARGET), mode: 'apply' });
  await assert.rejects(executePublicSourceRepairPlan(fake.db, main, opt), /MAIN_EXPLICIT_ACK/);
  await assert.rejects(executePublicSourceRepairPlan(fake.db, main, { ...opt, acknowledgeMainPublicSourceOnly: true, rollback: true }), /MAIN_ROLLBACK/);
  const qa = planFor(input); await assert.rejects(executePublicSourceRepairPlan(fake.db, qa, { ...options(qa), ...opt, expectedPlanDigest: qa.digest, acknowledgeMainPublicSourceOnly: true }), /PLAN_OR_EVIDENCE/);
  const result = await executePublicSourceRepairPlan(fake.db, main, { ...opt, acknowledgeMainPublicSourceOnly: true }); assert.equal(result.status, 'applied');
});
