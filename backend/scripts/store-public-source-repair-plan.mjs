import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

// A one-batch policy, not an arbitrary shop-data editing interface.
export const POLICY_ID = 'public-source-address-verification-2026-11-11-v1';
export const SOURCE_SHA256 = '7f64ca7ac7954965393a7dbf4e471fa8b1ab2667f9af0061b73b01475df11780';
export const FOOT_LEGACY_ADDRESS = '11830 BELLAIRE BLVD,STE EHOUSTONTX 77072';
export const QA_TARGET = Object.freeze({ host: '127.0.0.1', port: '33091', database: 'mj2_store_sources_qa_7c8deb01aa' });
export const MAIN_TARGET = Object.freeze({ host: '127.0.0.1', port: '33090', database: 'mj2_store_migration_84cec1e6' });
export const SHOP_FIELDS = Object.freeze(['id', 'ownerId', 'name', 'shortName', 'timezone', 'studioProfile', 'nameEn', 'description', 'phone', 'address', 'city', 'state', 'zipCode', 'latitude', 'longitude', 'category', 'status', 'reviewComment', 'reviewedAt', 'reviewedBy', 'shopType', 'businessHours', 'avgRating', 'reviewCount', 'bookingCount', 'createdAt', 'updatedAt', 'deletedAt']);
export const ANCHOR_FIELDS = Object.freeze(['id', 'name', 'address', 'city', 'state', 'zipCode', 'timezone', 'phone', 'studioProfile', 'status', 'deletedAt', 'updatedAt', 'businessHours']);
const ALIAS_FIELDS = ['id', 'shopId', 'kind', 'source', 'value', 'isActive', 'createdAt', 'updatedAt'];
const POLICIES = Object.freeze({
  '1238': { sourceId: '3356', expectedOwnerRef: '3356:0', fields: { state: 'Pennsylvania' } },
  '1168': { sourceId: '2823', expectedOwnerRef: '2823:0', fields: { address: '11830 Bellaire Blvd, Ste E', city: 'Houston', state: 'Texas' } },
});
const SHA = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw Error('PUBLIC_SOURCE_' + code); };
export function canonical(value) {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) {
    if (typeof value.toJSON === 'function') return canonical(value.toJSON());
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
export const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const bytesDigest = value => crypto.createHash('sha256').update(value).digest('hex');
function exact(value, keys, code) { if (!object(value) || !equal(Object.keys(value).sort(), [...keys].sort())) fail(code); }
function hash(value, code) { if (typeof value !== 'string' || !SHA.test(value)) fail(code); }
export function verifyRuntimeScalarFields(fields) { if (!equal([...fields].sort(), [...SHOP_FIELDS].sort())) fail('SCHEMA_DRIFT'); }
function exactTarget(mode) { if (mode !== 'qa' && mode !== 'main') fail('EXPLICIT_TARGET_REQUIRED'); return mode === 'qa' ? QA_TARGET : MAIN_TARGET; }
export function publicSourceRepairUrl(value, { target, acknowledgeMainPublicSourceOnly = false, nodeEnv = process.env.NODE_ENV } = {}) {
  const expected = exactTarget(target);
  if (target === 'main' && acknowledgeMainPublicSourceOnly !== true) fail('MAIN_EXPLICIT_ACK_REQUIRED');
  if (nodeEnv === 'production') fail('LOCAL_ONLY');
  let url; try { url = new URL(value); } catch { fail('DATABASE_URL_REQUIRED'); }
  if (url.protocol !== 'mysql:' || url.hostname !== expected.host || url.port !== expected.port || decodeURIComponent(url.pathname.slice(1)) !== expected.database || !url.username || !url.password || url.search || url.hash) fail('EXACT_TARGET_REQUIRED');
  return url.toString();
}
function readEvidence(bytes, expectedEvidenceSha256, expectedInventorySha256) {
  hash(expectedEvidenceSha256, 'EVIDENCE_SHA_REQUIRED'); hash(expectedInventorySha256, 'INVENTORY_SHA_REQUIRED');
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024 || bytesDigest(bytes) !== expectedEvidenceSha256) fail('EVIDENCE_BYTES_MISMATCH');
  let manifest; try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_EVIDENCE_JSON'); }
  exact(manifest, ['schemaVersion', 'policyId', 'sourceSqlSha256', 'inventorySha256', 'records'], 'INVALID_EVIDENCE_MANIFEST');
  if (manifest.schemaVersion !== 1 || manifest.policyId !== POLICY_ID || manifest.sourceSqlSha256 !== SOURCE_SHA256 || manifest.inventorySha256 !== expectedInventorySha256 || !Array.isArray(manifest.records) || manifest.records.length !== 2) fail('EVIDENCE_SCOPE_MISMATCH');
  if (!equal(manifest.records.map(row => row?.shopId).sort(), Object.keys(POLICIES).sort())) fail('EVIDENCE_SHOP_ALLOWLIST');
  for (const record of manifest.records) {
    exact(record, ['shopId', 'sourceShopId', 'sourceRowDigest', 'sealedAnchorDigest', 'aliasesDigest', 'confirmedFields', 'observedEvidence'], 'INVALID_EVIDENCE_RECORD');
    const policy = POLICIES[record.shopId];
    if (record.sourceShopId !== policy.sourceId || !equal(record.confirmedFields, policy.fields)) fail('FIELD_ALLOWLIST');
    for (const name of ['sourceRowDigest', 'sealedAnchorDigest', 'aliasesDigest']) hash(record[name], 'INVALID_RECORD_SHA');
    if (!Array.isArray(record.observedEvidence) || record.observedEvidence.length < 1 || record.observedEvidence.length > 8) fail('OBSERVED_EVIDENCE_REQUIRED');
    const ids = new Set();
    for (const observation of record.observedEvidence) {
      exact(observation, ['id', 'url', 'snapshotSha256', 'observedAt', 'quote', 'observedFields'], 'INVALID_OBSERVATION');
      if (typeof observation.id !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(observation.id) || ids.has(observation.id)) fail('INVALID_OBSERVATION_ID');
      ids.add(observation.id); hash(observation.snapshotSha256, 'INVALID_OBSERVATION_SHA');
      let url; try { url = new URL(observation.url); } catch { fail('INVALID_OBSERVATION_URL'); }
      if (url.protocol !== 'https:' || url.username || url.password || typeof observation.quote !== 'string' || !observation.quote.trim() || observation.quote.length > 20000 || typeof observation.observedAt !== 'string' || !Number.isFinite(Date.parse(observation.observedAt))) fail('INVALID_OBSERVATION');
      if (!object(observation.observedFields) || !Object.keys(observation.observedFields).length) fail('INVALID_OBSERVED_FIELDS');
      for (const [field, value] of Object.entries(observation.observedFields)) {
        const expected = record.shopId === '1168' && field === 'address' ? '11830 Bellaire Blvd' : policy.fields[field];
        if (expected === undefined || value !== expected) fail('UNCONFIRMED_OBSERVED_FIELD');
      }
    }
    for (const field of Object.keys(policy.fields)) if (!record.observedEvidence.some(row => Object.hasOwn(row.observedFields, field))) fail('FIELD_WITHOUT_OBSERVED_EVIDENCE');
  }
  return manifest;
}
function validateImage(shop, aliases, policy) {
  exact(shop, SHOP_FIELDS, 'INCOMPLETE_SHOP_PREIMAGE');
  if (shop.status !== 'APPROVED' || shop.deletedAt !== null || !object(shop.studioProfile) || shop.studioProfile.legacyImport?.source !== 'Massajoy1.0' || String(shop.studioProfile.legacyImport.sourceShopId) !== policy.sourceId) fail('SHOP_IDENTITY_MISMATCH');
  if (!Array.isArray(aliases) || aliases.length !== 4) fail('ALIAS_SET_CHANGED');
  const identities = new Set(); const ids = new Set();
  for (const row of aliases) {
    exact(row, ALIAS_FIELDS, 'INCOMPLETE_ALIAS_PREIMAGE');
    const identity = row.kind + ':' + row.source; identities.add(identity);
    if (String(row.shopId) !== String(shop.id) || row.isActive !== true || ids.has(String(row.id))) fail('ALIAS_IDENTITY_MISMATCH'); ids.add(String(row.id));
    if (row.kind === 'LEGACY_STORE_ID' && row.source === 'Massajoy1.0' || row.kind === 'LEGACY_ID' && row.source === 'massajoy1') { if (row.value !== policy.sourceId) fail('ALIAS_SOURCE_MISMATCH'); }
    // Preserve the two sealed legacy :0 references; this does not infer or
    // change present ownership, and no other numeric or symbolic suffix is valid.
    if (row.kind === 'LEGACY_OWNER_REF' && row.source === 'Massajoy1.0' && row.value !== policy.expectedOwnerRef) fail('ALIAS_SOURCE_MISMATCH');
  }
  if (!equal([...identities].sort(), ['LEGACY_STORE_ID:Massajoy1.0', 'LEGACY_OWNER_REF:Massajoy1.0', 'SHORT_NAME:massajoy', 'LEGACY_ID:massajoy1'].sort())) fail('ALIAS_IDENTITY_MISMATCH');
}
function verification(record, manifest, evidenceSha256) {
  return { version: 1, policyId: POLICY_ID, source: 'Massajoy1.0-and-public-official', sourceShopId: record.sourceShopId,
    sourceSqlSha256: SOURCE_SHA256, sourceRowDigest: record.sourceRowDigest, inventorySha256: manifest.inventorySha256, sealedAnchorDigest: record.sealedAnchorDigest, evidenceManifestSha256: evidenceSha256,
    fields: Object.fromEntries(Object.entries(record.confirmedFields).map(([field, value]) => [field, { status: 'verified', value,
      basis: record.shopId === '1168' && field === 'address' ? 'official-street-and-legacy-suite' : 'public-official',
      evidenceIds: record.observedEvidence.filter(row => Object.hasOwn(row.observedFields, field)).map(row => row.id) }])), observedEvidence: record.observedEvidence };
}
export function publicSourceRepairPlan({ shop, aliases, sourceRow, sourceSha256, sealedAnchor, evidenceBytes, expectedEvidenceSha256, expectedInventorySha256, now = new Date() }, { target, acknowledgeMainPublicSourceOnly = false } = {}) {
  const destination = exactTarget(target);
  if (target === 'main' && acknowledgeMainPublicSourceOnly !== true) fail('MAIN_EXPLICIT_ACK_REQUIRED');
  const policy = POLICIES[String(shop?.id)]; if (!policy) fail('SHOP_ALLOWLIST');
  const manifest = readEvidence(evidenceBytes, expectedEvidenceSha256, expectedInventorySha256), record = manifest.records.find(row => row.shopId === String(shop.id));
  validateImage(shop, aliases, policy); exact(sealedAnchor, ANCHOR_FIELDS, 'INCOMPLETE_SEALED_ANCHOR');
  if (sourceSha256 !== SOURCE_SHA256 || String(sourceRow?.id) !== policy.sourceId || digest(sourceRow) !== record.sourceRowDigest || digest(sealedAnchor) !== record.sealedAnchorDigest || digest(aliases) !== record.aliasesDigest || String(sealedAnchor.id) !== String(shop.id)) fail('SOURCE_OR_ANCHOR_MISMATCH');
  // This exact legacy spelling concatenates E and HOUSTON. Do not infer a
  // suite from arbitrary words starting with E or silently normalize evidence.
  if (String(shop.id) === '1168' && sourceRow.addr !== FOOT_LEGACY_ADDRESS) fail('LEGACY_SUITE_EVIDENCE_REQUIRED');
  const marker = verification(record, manifest, expectedEvidenceSha256), existing = shop.studioProfile.publicSourceVerification;
  const applied = equal(existing, marker) && Object.entries(policy.fields).every(([field, value]) => shop[field] === value);
  if (existing !== undefined && !applied) fail('EXISTING_VERIFICATION_CONFLICT');
  for (const [field, value] of Object.entries(sealedAnchor)) {
    if (applied && (Object.hasOwn(policy.fields, field) || field === 'updatedAt')) continue;
    const actual = applied && field === 'studioProfile' ? Object.fromEntries(Object.entries(shop.studioProfile).filter(([key]) => key !== 'publicSourceVerification')) : shop[field];
    if (!equal(actual, value)) fail('CHANGED_SINCE_SEALED_INVENTORY');
  }
  const before = canonical({ shop, aliases }); let data = null;
  if (!applied) {
    const timestamp = Math.max(new Date(now).getTime(), new Date(shop.updatedAt).getTime() + 1);
    if (!Number.isFinite(timestamp)) fail('INVALID_TIMESTAMP');
    data = { ...Object.fromEntries(Object.entries(policy.fields).filter(([field, value]) => shop[field] !== value)), studioProfile: { ...shop.studioProfile, publicSourceVerification: marker }, updatedAt: new Date(timestamp).toISOString() };
  }
  const body = canonical({ policyId: POLICY_ID, target: destination, sourceSha256, sourceRow, sealedAnchor,
    evidenceBase64: evidenceBytes.toString('base64'), evidenceSha256: expectedEvidenceSha256, inventorySha256: expectedInventorySha256,
    status: applied ? 'already-applied' : 'pending', before, data, after: data ? { shop: { ...shop, ...data }, aliases } : before });
  return { ...body, digest: digest(body) };
}
function casWhere(shop) {
  const json = new Set(['studioProfile', 'businessHours']), dates = new Set(['createdAt', 'updatedAt', 'reviewedAt', 'deletedAt']), bigints = new Set(['id', 'ownerId', 'reviewedBy']);
  return Object.fromEntries(SHOP_FIELDS.map(field => [field, json.has(field) ? { equals: shop[field] === null ? Prisma.DbNull : shop[field] } : dates.has(field) && shop[field] !== null ? new Date(shop[field]) : bigints.has(field) && shop[field] !== null ? BigInt(shop[field]) : shop[field]]));
}
export async function executePublicSourceRepairPlan(client, plan, { target, databaseUrl, expectedPlanDigest, expectedEvidenceSha256, expectedInventorySha256, mode = 'dry-run', rollback = false, acknowledgeMainPublicSourceOnly = false } = {}) {
  const destination = exactTarget(target);
  publicSourceRepairUrl(databaseUrl, { target, acknowledgeMainPublicSourceOnly });
  if (!['dry-run', 'apply'].includes(mode) || typeof rollback !== 'boolean') fail('INVALID_EXECUTION_MODE');
  if (rollback && target !== 'qa') fail('MAIN_ROLLBACK_REFUSED');
  if (!plan || expectedPlanDigest !== plan.digest) fail('EXACT_PLAN_DIGEST_REQUIRED');
  const { digest: planDigest, ...body } = plan;
  if (digest(body) !== planDigest || !equal(plan.target, destination) || plan.evidenceSha256 !== expectedEvidenceSha256 || plan.inventorySha256 !== expectedInventorySha256) fail('PLAN_OR_EVIDENCE_MISMATCH');
  const rebuilt = publicSourceRepairPlan({ ...plan.before, sourceRow: plan.sourceRow, sourceSha256: plan.sourceSha256, sealedAnchor: plan.sealedAnchor, evidenceBytes: Buffer.from(plan.evidenceBase64, 'base64'), expectedEvidenceSha256, expectedInventorySha256, now: plan.data?.updatedAt }, { target, acknowledgeMainPublicSourceOnly });
  if (!equal(rebuilt, plan)) fail('FORBIDDEN_WRITE_OR_INVALID_PLAN');
  if (rollback && plan.status !== 'pending') fail('NOOP_NOT_ROLLBACKABLE');
  return client.$transaction(async tx => {
    const read = async () => {
      const identity = await tx.$queryRaw`SELECT DATABASE() AS name`;
      if (identity[0]?.name !== destination.database) fail('DATABASE_IDENTITY_MISMATCH');
      const id = BigInt(plan.before.shop.id);
      await tx.$queryRaw`SELECT id FROM shops WHERE id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM shop_aliases WHERE shop_id = ${id} ORDER BY id FOR UPDATE`;
      if (await tx.shop.count() !== 1335 || await tx.shop.count({ where: { status: 'APPROVED', deletedAt: null } }) !== 1335) fail('UNEXPECTED_STORE_POPULATION');
      const shop = await tx.shop.findUnique({ where: { id } }), aliases = await tx.shopAlias.findMany({ where: { shopId: id }, orderBy: { id: 'asc' } });
      validateImage(shop, aliases, POLICIES[String(id)]); return canonical({ shop, aliases });
    };
    const current = await read(), required = rollback ? plan.after : plan.before, desired = rollback ? plan.before : plan.after;
    if (equal(current, desired)) return { status: rollback ? 'already-rolled-back' : 'already-applied', updatedStores: 0, digest: plan.digest, before: current, after: current };
    if (!equal(current, required)) fail('CONCURRENT_CHANGE_REFUSED');
    if (mode === 'dry-run') return { status: rollback ? 'rollback-dry-run' : 'dry-run', updatedStores: 0, digest: plan.digest, before: current, after: desired };
    const data = rollback ? Object.fromEntries(Object.keys(plan.data).map(field => [field, plan.before.shop[field]])) : plan.data;
    const result = await tx.shop.updateMany({ where: casWhere(required.shop), data: { ...data, updatedAt: new Date(data.updatedAt) } });
    if (result.count !== 1) fail('COMPARE_AND_SET_FAILED');
    const after = await read(); if (!equal(after, desired)) fail('READBACK_MISMATCH_ROLLED_BACK');
    return { status: rollback ? 'rolled-back' : 'applied', updatedStores: 1, digest: plan.digest, before: current, after };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
}
