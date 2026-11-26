import { Prisma } from '@prisma/client';
import { SOURCE_SHA256, MAIN_TARGET, SHOP_FIELDS, ANCHOR_FIELDS, canonical, equal, digest, bytesDigest, verifyRuntimeScalarFields } from './store-public-source-repair-plan.mjs';
export { SOURCE_SHA256, MAIN_TARGET, SHOP_FIELDS, ANCHOR_FIELDS, canonical, equal, digest, bytesDigest, verifyRuntimeScalarFields };

// This new policy never accepts the previous batch's manifest, IDs or QA target.
export const POLICY_ID = 'public-source-address-verification-2026-11-11-r4-v1';
export const QA_TARGET = Object.freeze({ host: '127.0.0.1', port: '33091', database: 'mj2_store_sources_r4_qa_9a9d8853bf' });
const POLICIES = Object.freeze({
  '671': Object.freeze({ sourceId: '772', expectedOwnerRef: '772:0', address: '208 English Village, Suite 208', officialUrl: 'https://londonbridgewellnesscenter.com/contact' }),
});
const ALIAS_FIELDS = ['id', 'shopId', 'kind', 'source', 'value', 'isActive', 'createdAt', 'updatedAt'];
const SHA = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw Error('PUBLIC_SOURCE_R4_' + code); };
function exact(value, keys, code) { if (!object(value) || !equal(Object.keys(value).sort(), [...keys].sort())) fail(code); }
function hash(value, code) { if (typeof value !== 'string' || !SHA.test(value)) fail(code); }
function exactTarget(target) { if (!['qa', 'main'].includes(target)) fail('EXPLICIT_TARGET_REQUIRED'); return target === 'qa' ? QA_TARGET : MAIN_TARGET; }
export function batch4RepairUrl(value, { target, acknowledgeMainBatch4AddressOnly = false, nodeEnv = process.env.NODE_ENV } = {}) {
  const expected = exactTarget(target);
  if (target === 'main' && acknowledgeMainBatch4AddressOnly !== true) fail('MAIN_EXPLICIT_ACK_REQUIRED');
  if (nodeEnv === 'production') fail('LOCAL_ONLY');
  let url; try { url = new URL(value); } catch { fail('DATABASE_URL_REQUIRED'); }
  if (url.protocol !== 'mysql:' || url.hostname !== expected.host || url.port !== expected.port || decodeURIComponent(url.pathname.slice(1)) !== expected.database || !url.username || !url.password || url.search || url.hash) fail('EXACT_TARGET_REQUIRED');
  return url.toString();
}
const confirmedFieldsFor = policy => ({ address: policy.address });
function readManifest(bytes, evidenceSha, inventorySha) {
  hash(evidenceSha, 'EVIDENCE_SHA_REQUIRED'); hash(inventorySha, 'INVENTORY_SHA_REQUIRED');
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024 || bytesDigest(bytes) !== evidenceSha) fail('EVIDENCE_BYTES_MISMATCH');
  let manifest; try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_EVIDENCE_JSON'); }
  exact(manifest, ['schemaVersion', 'policyId', 'sourceSqlSha256', 'inventorySha256', 'records'], 'INVALID_MANIFEST');
  if (manifest.schemaVersion !== 1 || manifest.policyId !== POLICY_ID || manifest.sourceSqlSha256 !== SOURCE_SHA256 || manifest.inventorySha256 !== inventorySha || !Array.isArray(manifest.records)
    || !equal(manifest.records.map(row => row?.shopId).sort(), Object.keys(POLICIES).sort())) fail('MANIFEST_SCOPE_MISMATCH');
  for (const record of manifest.records) {
    exact(record, ['shopId', 'sourceShopId', 'sourceRowDigest', 'sealedAnchorDigest', 'aliasesDigest', 'confirmedFields', 'observedEvidence'], 'INVALID_RECORD');
    const policy = POLICIES[record.shopId];
    if (record.sourceShopId !== policy.sourceId || !equal(record.confirmedFields, confirmedFieldsFor(policy))) fail('EXACT_FIELD_ALLOWLIST');
    for (const name of ['sourceRowDigest', 'sealedAnchorDigest', 'aliasesDigest']) hash(record[name], 'INVALID_RECORD_SHA');
    if (!Array.isArray(record.observedEvidence) || record.observedEvidence.length < 1 || record.observedEvidence.length > 8) fail('OBSERVED_EVIDENCE_REQUIRED');
    const ids = new Set();
    for (const evidence of record.observedEvidence) {
      exact(evidence, ['id', 'url', 'snapshotSha256', 'observedAt', 'quote', 'observedFields'], 'INVALID_OBSERVATION');
      if (typeof evidence.id !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(evidence.id) || ids.has(evidence.id)) fail('INVALID_OBSERVATION_ID');
      ids.add(evidence.id); hash(evidence.snapshotSha256, 'INVALID_OBSERVATION_SHA');
      if (evidence.url !== policy.officialUrl || typeof evidence.observedAt !== 'string' || !Number.isFinite(Date.parse(evidence.observedAt)) || typeof evidence.quote !== 'string' || !evidence.quote.trim() || evidence.quote.length > 20000
        || !equal(evidence.observedFields, confirmedFieldsFor(policy))) fail('UNCONFIRMED_FIELD_OBSERVATION');
    }
  }
  return manifest;
}
function validateImage(shop, aliases, policy) {
  exact(shop, SHOP_FIELDS, 'INCOMPLETE_SHOP_PREIMAGE');
  if (shop.status !== 'APPROVED' || shop.deletedAt !== null || !object(shop.studioProfile) || shop.studioProfile.legacyImport?.source !== 'Massajoy1.0' || String(shop.studioProfile.legacyImport.sourceShopId) !== policy.sourceId) fail('SHOP_IDENTITY_MISMATCH');
  if (!Array.isArray(aliases) || aliases.length !== 4) fail('ALIAS_SET_CHANGED');
  const identities = new Set(), ids = new Set();
  for (const alias of aliases) {
    exact(alias, ALIAS_FIELDS, 'INCOMPLETE_ALIAS_PREIMAGE');
    if (String(alias.shopId) !== String(shop.id) || alias.isActive !== true || ids.has(String(alias.id))) fail('ALIAS_IDENTITY_MISMATCH'); ids.add(String(alias.id));
    identities.add(alias.kind + ':' + alias.source);
    if ((alias.kind === 'LEGACY_STORE_ID' && alias.source === 'Massajoy1.0' || alias.kind === 'LEGACY_ID' && alias.source === 'massajoy1') && alias.value !== policy.sourceId) fail('ALIAS_SOURCE_MISMATCH');
    if (alias.kind === 'LEGACY_OWNER_REF' && alias.source === 'Massajoy1.0' && alias.value !== policy.expectedOwnerRef) fail('ALIAS_OWNER_REFERENCE_MISMATCH');
  }
  if (!equal([...identities].sort(), ['LEGACY_STORE_ID:Massajoy1.0', 'LEGACY_OWNER_REF:Massajoy1.0', 'SHORT_NAME:massajoy', 'LEGACY_ID:massajoy1'].sort())) fail('ALIAS_IDENTITY_MISMATCH');
}
function markerFor(record, manifest, evidenceSha) {
  const policy = POLICIES[record.shopId], evidenceIds = record.observedEvidence.map(row => row.id);
  const fields = { address: { status: 'verified', value: policy.address, basis: 'public-official', evidenceIds } };
  return { version: 1, policyId: POLICY_ID, source: 'Massajoy1.0-and-public-official', sourceShopId: record.sourceShopId, sourceSqlSha256: SOURCE_SHA256,
    sourceRowDigest: record.sourceRowDigest, inventorySha256: manifest.inventorySha256, sealedAnchorDigest: record.sealedAnchorDigest, evidenceManifestSha256: evidenceSha,
    fields, observedEvidence: record.observedEvidence };
}
function buildChange(image, record, manifest, evidenceSha, now) {
  const imageFields = ['shop', 'aliases', 'sourceRow', 'sealedAnchor'];
  exact(image, Object.hasOwn(image, 'shopId') ? [...imageFields, 'shopId'] : imageFields, 'INVALID_IMAGE_INPUT');
  if (Object.hasOwn(image, 'shopId') && image.shopId !== record.shopId) fail('IMAGE_SHOP_ID_MISMATCH');
  const { shop, aliases, sourceRow, sealedAnchor } = image, policy = POLICIES[record.shopId];
  validateImage(shop, aliases, policy); exact(sealedAnchor, ANCHOR_FIELDS, 'INCOMPLETE_SEALED_ANCHOR');
  if (String(shop.id) !== record.shopId || String(sourceRow?.id) !== policy.sourceId || String(sealedAnchor.id) !== record.shopId || digest(sourceRow) !== record.sourceRowDigest || digest(sealedAnchor) !== record.sealedAnchorDigest || digest(aliases) !== record.aliasesDigest) fail('SOURCE_OR_ANCHOR_MISMATCH');
  const marker = markerFor(record, manifest, evidenceSha), existing = shop.studioProfile.publicSourceVerification;
  const applied = equal(existing, marker) && shop.address === policy.address;
  if (existing !== undefined && !applied) fail('EXISTING_VERIFICATION_CONFLICT');
  for (const [field, value] of Object.entries(sealedAnchor)) {
    if (applied && (field === 'updatedAt' || field === 'address')) continue;
    let actual = shop[field];
    if (applied && field === 'studioProfile') {
      actual = { ...shop.studioProfile }; delete actual.publicSourceVerification;
    }
    if (!equal(actual, value)) fail('CHANGED_SINCE_SEALED_INVENTORY');
  }
  let data = null;
  if (!applied) {
    const time = Math.max(new Date(now).getTime(), new Date(shop.updatedAt).getTime() + 1); if (!Number.isFinite(time)) fail('INVALID_TIMESTAMP');
    data = { ...(shop.address !== policy.address ? { address: policy.address } : {}), studioProfile: { ...shop.studioProfile, publicSourceVerification: marker }, updatedAt: new Date(time).toISOString() };
  }
  const before = canonical({ shop, aliases });
  return canonical({ shopId: record.shopId, sourceRow, sealedAnchor, status: applied ? 'already-applied' : 'pending', before, data, after: data ? { shop: { ...shop, ...data }, aliases } : before });
}
export function batch4PublicSourceRepairPlan({ images, sourceSha256, evidenceBytes, expectedEvidenceSha256, expectedInventorySha256, now = new Date() }, { target, acknowledgeMainBatch4AddressOnly = false } = {}) {
  const destination = exactTarget(target); if (target === 'main' && acknowledgeMainBatch4AddressOnly !== true) fail('MAIN_EXPLICIT_ACK_REQUIRED');
  if (sourceSha256 !== SOURCE_SHA256) fail('SOURCE_SQL_SHA_MISMATCH');
  const manifest = readManifest(evidenceBytes, expectedEvidenceSha256, expectedInventorySha256);
  if (!Array.isArray(images) || !equal(images.map(row => String(row?.shop?.id)).sort(), Object.keys(POLICIES).sort())) fail('BATCH_SHOP_ALLOWLIST');
  // Keep plan reconstruction stable even when the supplied clock predates the row.
  const batchTime = Math.max(new Date(now).getTime(), ...images.map(image => new Date(image.shop.updatedAt).getTime() + 1));
  if (!Number.isFinite(batchTime)) fail('INVALID_TIMESTAMP');
  const changes = [...manifest.records].sort((a, b) => BigInt(a.shopId) < BigInt(b.shopId) ? -1 : 1).map(record => buildChange(images.find(image => String(image.shop.id) === record.shopId), record, manifest, expectedEvidenceSha256, new Date(batchTime)));
  if (new Set(changes.map(change => change.status)).size !== 1) fail('MIXED_BATCH_STATE_REFUSED');
  const body = canonical({ policyId: POLICY_ID, target: destination, sourceSha256, evidenceBase64: evidenceBytes.toString('base64'), evidenceSha256: expectedEvidenceSha256, inventorySha256: expectedInventorySha256, status: changes[0].status, changes });
  return { ...body, digest: digest(body) };
}
function casWhere(shop) {
  const json = new Set(['studioProfile', 'businessHours']), dates = new Set(['createdAt', 'updatedAt', 'reviewedAt', 'deletedAt']), bigints = new Set(['id', 'ownerId', 'reviewedBy']);
  return Object.fromEntries(SHOP_FIELDS.map(field => [field, json.has(field) ? { equals: shop[field] === null ? Prisma.DbNull : shop[field] } : dates.has(field) && shop[field] !== null ? new Date(shop[field]) : bigints.has(field) && shop[field] !== null ? BigInt(shop[field]) : shop[field]]));
}
export async function executeBatch4PublicSourceRepairPlan(client, plan, { target, databaseUrl, expectedPlanDigest, expectedEvidenceSha256, expectedInventorySha256, mode = 'dry-run', rollback = false, acknowledgeMainBatch4AddressOnly = false } = {}) {
  const destination = exactTarget(target); batch4RepairUrl(databaseUrl, { target, acknowledgeMainBatch4AddressOnly });
  if (!['dry-run', 'apply'].includes(mode) || typeof rollback !== 'boolean') fail('INVALID_EXECUTION_MODE');
  if (rollback && target !== 'qa') fail('MAIN_ROLLBACK_REFUSED');
  if (!plan || expectedPlanDigest !== plan.digest) fail('EXACT_PLAN_DIGEST_REQUIRED');
  const { digest: planDigest, ...body } = plan;
  if (digest(body) !== planDigest || !equal(plan.target, destination) || plan.evidenceSha256 !== expectedEvidenceSha256 || plan.inventorySha256 !== expectedInventorySha256) fail('PLAN_OR_EVIDENCE_MISMATCH');
  const rebuilt = batch4PublicSourceRepairPlan({ images: plan.changes.map(change => ({ ...change.before, sourceRow: change.sourceRow, sealedAnchor: change.sealedAnchor })), sourceSha256: plan.sourceSha256,
    evidenceBytes: Buffer.from(plan.evidenceBase64, 'base64'), expectedEvidenceSha256, expectedInventorySha256, now: plan.changes[0]?.data?.updatedAt }, { target, acknowledgeMainBatch4AddressOnly });
  if (!equal(rebuilt, plan)) fail('FORBIDDEN_WRITE_OR_INVALID_PLAN');
  if (rollback && plan.status !== 'pending') fail('NOOP_NOT_ROLLBACKABLE');
  return client.$transaction(async tx => {
    const read = async () => {
      const identity = await tx.$queryRaw`SELECT DATABASE() AS name`; if (identity[0]?.name !== destination.database) fail('DATABASE_IDENTITY_MISMATCH');
      const images = [];
      for (const change of plan.changes) {
        const id = BigInt(change.shopId);
        await tx.$queryRaw`SELECT id FROM shops WHERE id = ${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM shop_aliases WHERE shop_id = ${id} ORDER BY id FOR UPDATE`;
        const shop = await tx.shop.findUnique({ where: { id } }), aliases = await tx.shopAlias.findMany({ where: { shopId: id }, orderBy: { id: 'asc' } });
        validateImage(shop, aliases, POLICIES[change.shopId]); images.push(canonical({ shop, aliases }));
      }
      if (await tx.shop.count() !== 1335 || await tx.shop.count({ where: { status: 'APPROVED', deletedAt: null } }) !== 1335) fail('UNEXPECTED_STORE_POPULATION');
      return images;
    };
    const current = await read(), desired = plan.changes.map(change => rollback ? change.before : change.after), required = plan.changes.map(change => rollback ? change.after : change.before);
    if (equal(current, desired)) return { status: rollback ? 'already-rolled-back' : 'already-applied', updatedStores: 0, digest: plan.digest, before: current, after: current };
    if (!equal(current, required)) fail('CONCURRENT_CHANGE_REFUSED');
    if (mode === 'dry-run') return { status: rollback ? 'rollback-dry-run' : 'dry-run', updatedStores: 0, digest: plan.digest, before: current, after: desired };
    for (const [index, change] of plan.changes.entries()) {
      const data = rollback ? { ...(Object.hasOwn(change.data, 'address') ? { address: change.before.shop.address } : {}), studioProfile: change.before.shop.studioProfile, updatedAt: change.before.shop.updatedAt } : change.data;
      const result = await tx.shop.updateMany({ where: casWhere(required[index].shop), data: { ...data, updatedAt: new Date(data.updatedAt) } });
      if (result.count !== 1) fail('COMPARE_AND_SET_FAILED');
    }
    const after = await read(); if (!equal(after, desired)) fail('READBACK_MISMATCH_ROLLED_BACK');
    return { status: rollback ? 'rolled-back' : 'applied', updatedStores: plan.changes.length, digest: plan.digest, before: current, after };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
}
