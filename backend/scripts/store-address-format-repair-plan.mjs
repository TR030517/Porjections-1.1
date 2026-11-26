import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

// Deliberately independent of the older main-database repair allowlist.
// This edition can write only the single named disposable QA clone.
export const QA_TARGET = Object.freeze({ host: '127.0.0.1', port: '33091', database: 'mj2_final_regression_qa_4c592b48ac' });
export const MAIN_TARGET = Object.freeze({ host: '127.0.0.1', port: '33090', database: 'mj2_store_migration_84cec1e6' });
export const POLICY_ID = 'source-exact-street-format-919-2026-11-10-v1';
export const SOURCE_SHA256 = '7f64ca7ac7954965393a7dbf4e471fa8b1ab2667f9af0061b73b01475df11780';
export const SHOP_ID = '919';
export const SOURCE_ID = '1229';
export const ORIGINAL_ADDRESS = '940 N Alma School Rd ste 100, Chandler, AZ 85224(We next to goodwill)';
export const FORMATTED_ADDRESS = '940 N Alma School Rd ste 100';
export const LANDMARK_NOTE = 'We next to goodwill';
export const SHOP_FIELDS = Object.freeze(['id', 'ownerId', 'name', 'shortName', 'timezone', 'studioProfile', 'nameEn', 'description', 'phone', 'address', 'city', 'state', 'zipCode', 'latitude', 'longitude', 'category', 'status', 'reviewComment', 'reviewedAt', 'reviewedBy', 'shopType', 'businessHours', 'avgRating', 'reviewCount', 'bookingCount', 'createdAt', 'updatedAt', 'deletedAt']);
const ALIAS_FIELDS = ['id', 'shopId', 'kind', 'source', 'value', 'isActive', 'createdAt', 'updatedAt'];
const ALIAS_IDENTITIES = [['1837', 'LEGACY_STORE_ID', 'Massajoy1.0', '1229'], ['1838', 'LEGACY_OWNER_REF', 'Massajoy1.0', '1229:376'], ['4508', 'SHORT_NAME', 'massajoy', 'aa-thai-massage-1229'], ['4509', 'LEGACY_ID', 'massajoy1', '1229']];
const JSON_FIELDS = new Set(['studioProfile', 'businessHours']);
const DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'reviewedAt', 'deletedAt']);
const BIGINT_FIELDS = new Set(['id', 'ownerId', 'reviewedBy']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw Error(code); };

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
function exactKeys(value, keys, error) {
  if (!object(value) || !equal(Object.keys(value).sort(), [...keys].sort())) fail(error);
}

export function cloneRepairUrl(value, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === 'production') fail('ADDRESS_FORMAT_LOCAL_QA_ONLY');
  let url;
  try { url = new URL(value); } catch { fail('ADDRESS_FORMAT_DATABASE_URL_REQUIRED'); }
  if (url.protocol !== 'mysql:' || url.hostname !== QA_TARGET.host || url.port !== QA_TARGET.port
    || decodeURIComponent(url.pathname.slice(1)) !== QA_TARGET.database || !url.username || !url.password || url.search || url.hash) fail('ADDRESS_FORMAT_EXACT_QA_TARGET_REQUIRED');
  return url.toString();
}
export function mainRepairUrl(value, { acknowledgeMain919FormatOnly = false, nodeEnv = process.env.NODE_ENV } = {}) {
  if (acknowledgeMain919FormatOnly !== true) fail('ADDRESS_FORMAT_MAIN_919_EXPLICIT_ACK_REQUIRED');
  if (nodeEnv === 'production') fail('ADDRESS_FORMAT_LOCAL_MAIN_ONLY');
  let url;
  try { url = new URL(value); } catch { fail('ADDRESS_FORMAT_DATABASE_URL_REQUIRED'); }
  if (url.protocol !== 'mysql:' || url.hostname !== MAIN_TARGET.host || url.port !== MAIN_TARGET.port
    || decodeURIComponent(url.pathname.slice(1)) !== MAIN_TARGET.database || !url.username || !url.password || url.search || url.hash) fail('ADDRESS_FORMAT_EXACT_MAIN_TARGET_REQUIRED');
  return url.toString();
}
export function verifyRuntimeScalarFields(runtimeFields) {
  if (!equal([...runtimeFields].sort(), [...SHOP_FIELDS].sort())) fail('ADDRESS_FORMAT_SCHEMA_DRIFT');
}
export function provenance() {
  return { version: 1, policyId: POLICY_ID, source: 'Massajoy1.0', sourceShopId: SOURCE_ID, sourceSqlSha256: SOURCE_SHA256,
    originalAddress: ORIGINAL_ADDRESS, originalLandmarkNote: LANDMARK_NOTE, formattedAddress: FORMATTED_ADDRESS,
    localityBefore: { city: 'Chandler', state: 'Arizona', zipCode: '85224' },
    rule: 'literal-source-and-current-locality-agree-street-prefix-only', needsReview: false };
}
function validateSource(row, sha) {
  if (sha !== SOURCE_SHA256 || String(row?.id) !== SOURCE_ID || row.addr !== ORIGINAL_ADDRESS
    || row.address != null || row.house_number != null || row.address_extra != null) fail('ADDRESS_FORMAT_SOURCE_EVIDENCE_MISMATCH');
}
function validateAliases(aliases) {
  if (!Array.isArray(aliases) || aliases.length !== ALIAS_IDENTITIES.length) fail('ADDRESS_FORMAT_ALIAS_SET_CHANGED');
  for (const [index, alias] of aliases.entries()) {
    exactKeys(alias, ALIAS_FIELDS, 'ADDRESS_FORMAT_INCOMPLETE_ALIAS_PREIMAGE');
    const [id, kind, source, value] = ALIAS_IDENTITIES[index];
    if (String(alias.id) !== id || String(alias.shopId) !== SHOP_ID || alias.kind !== kind || alias.source !== source || alias.value !== value || alias.isActive !== true) fail('ADDRESS_FORMAT_ALIAS_IDENTITY_MISMATCH');
  }
}
function validateShop(shop) {
  exactKeys(shop, SHOP_FIELDS, 'ADDRESS_FORMAT_INCOMPLETE_SHOP_PREIMAGE');
  if (String(shop.id) !== SHOP_ID || shop.city !== 'Chandler' || shop.state !== 'Arizona' || shop.zipCode !== '85224'
    || shop.timezone !== 'America/Phoenix' || shop.status !== 'APPROVED' || shop.deletedAt !== null
    || shop.studioProfile?.legacyImport?.source !== 'Massajoy1.0' || String(shop.studioProfile?.legacyImport?.sourceShopId) !== SOURCE_ID) fail('ADDRESS_FORMAT_SHOP_IDENTITY_OR_LOCALITY_MISMATCH');
}
function validateAnchor(shop, anchor, formatted = false) {
  if (!object(anchor) || String(anchor.id) !== SHOP_ID || anchor.address !== ORIGINAL_ADDRESS) fail('ADDRESS_FORMAT_SEALED_ANCHOR_MISSING');
  for (const [key, before] of Object.entries(anchor)) {
    if (!Object.hasOwn(shop, key)) fail('ADDRESS_FORMAT_SEALED_ANCHOR_UNKNOWN_FIELD');
    if (formatted && ['address', 'updatedAt'].includes(key)) continue;
    const current = formatted && key === 'studioProfile' ? Object.fromEntries(Object.entries(shop.studioProfile).filter(([name]) => name !== 'addressFormatRecovery')) : shop[key];
    if (!equal(current, before)) fail('ADDRESS_FORMAT_CHANGED_SINCE_SEALED_INVENTORY');
  }
}
function sealPlan(plan) { return { ...canonical(plan), digest: digest(plan) }; }
function buildAddressFormatPlan({ shop, aliases, sourceRow, sourceSha256, sealedAnchor, now = new Date() }, exactTarget) {
  validateSource(sourceRow, sourceSha256);
  validateShop(shop); validateAliases(aliases);
  const marker = shop.studioProfile?.addressFormatRecovery;
  const alreadyApplied = shop.address === FORMATTED_ADDRESS && equal(marker, provenance());
  validateAnchor(shop, sealedAnchor, alreadyApplied);
  if (alreadyApplied) return sealPlan({ policyId: POLICY_ID, target: exactTarget, sourceSha256, sourceShopId: SOURCE_ID,
    status: 'already-applied', before: canonical({ shop, aliases }), data: null, after: canonical({ shop, aliases }) });
  if (shop.address !== ORIGINAL_ADDRESS || marker !== undefined) fail('ADDRESS_FORMAT_CURRENT_ADDRESS_OR_PROVENANCE_CHANGED');
  const nextUpdatedAt = new Date(Math.max(new Date(now).getTime(), new Date(shop.updatedAt).getTime() + 1));
  if (!Number.isFinite(nextUpdatedAt.getTime())) fail('ADDRESS_FORMAT_INVALID_TIMESTAMP');
  const data = { address: FORMATTED_ADDRESS, studioProfile: { ...shop.studioProfile, addressFormatRecovery: provenance() }, updatedAt: nextUpdatedAt.toISOString() };
  return sealPlan({ policyId: POLICY_ID, target: exactTarget, sourceSha256, sourceShopId: SOURCE_ID,
    status: 'pending', before: canonical({ shop, aliases }), data, after: canonical({ shop: { ...shop, ...data }, aliases }) });
}
export const addressFormatPlan = input => buildAddressFormatPlan(input, QA_TARGET);
export function mainAddressFormatPlan(input, { acknowledgeMain919FormatOnly = false } = {}) {
  if (acknowledgeMain919FormatOnly !== true) fail('ADDRESS_FORMAT_MAIN_919_EXPLICIT_ACK_REQUIRED');
  return buildAddressFormatPlan(input, MAIN_TARGET);
}
function validatePlan(plan, exactTarget) {
  const { digest: expected, ...body } = plan ?? {};
  exactKeys(plan, ['policyId', 'target', 'sourceSha256', 'sourceShopId', 'status', 'before', 'data', 'after', 'digest'], 'ADDRESS_FORMAT_INVALID_PLAN');
  if (digest(body) !== expected || plan.policyId !== POLICY_ID || !equal(plan.target, exactTarget) || plan.sourceSha256 !== SOURCE_SHA256 || plan.sourceShopId !== SOURCE_ID) fail('ADDRESS_FORMAT_INVALID_PLAN');
  validateShop(plan.before.shop); validateAliases(plan.before.aliases);
  if (plan.status === 'already-applied') {
    if (plan.data !== null || !equal(plan.before, plan.after) || plan.before.shop.address !== FORMATTED_ADDRESS || !equal(plan.before.shop.studioProfile.addressFormatRecovery, provenance())) fail('ADDRESS_FORMAT_INVALID_NOOP_PLAN');
    return;
  }
  if (plan.status !== 'pending' || plan.before.shop.address !== ORIGINAL_ADDRESS || Object.hasOwn(plan.before.shop.studioProfile, 'addressFormatRecovery')) fail('ADDRESS_FORMAT_INVALID_PENDING_PLAN');
  exactKeys(plan.data, ['address', 'studioProfile', 'updatedAt'], 'ADDRESS_FORMAT_FORBIDDEN_WRITE');
  if (plan.data.address !== FORMATTED_ADDRESS || !equal(plan.data.studioProfile, { ...plan.before.shop.studioProfile, addressFormatRecovery: provenance() })
    || !Number.isFinite(Date.parse(plan.data.updatedAt)) || Date.parse(plan.data.updatedAt) <= Date.parse(plan.before.shop.updatedAt)
    || !equal(plan.after, { shop: { ...plan.before.shop, ...plan.data }, aliases: plan.before.aliases })) fail('ADDRESS_FORMAT_FORBIDDEN_WRITE');
}
function casWhere(shop) {
  return Object.fromEntries(SHOP_FIELDS.map(field => [field, JSON_FIELDS.has(field) ? { equals: shop[field] === null ? Prisma.DbNull : shop[field] }
    : DATE_FIELDS.has(field) && shop[field] !== null ? new Date(shop[field]) : BIGINT_FIELDS.has(field) && shop[field] !== null ? BigInt(shop[field]) : shop[field]]));
}
async function lockedImage(tx, exactTarget) {
  const identity = await tx.$queryRaw`SELECT DATABASE() AS name`;
  if (identity[0]?.name !== exactTarget.database) fail('ADDRESS_FORMAT_DATABASE_IDENTITY_MISMATCH');
  await tx.$queryRaw`SELECT id FROM shops WHERE id = ${BigInt(SHOP_ID)} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM shop_aliases WHERE shop_id = ${BigInt(SHOP_ID)} ORDER BY id FOR UPDATE`;
  if (await tx.shop.count() !== 1335 || await tx.shop.count({ where: { status: 'APPROVED', deletedAt: null } }) !== 1335) fail('ADDRESS_FORMAT_UNEXPECTED_STORE_POPULATION');
  const shop = await tx.shop.findUnique({ where: { id: BigInt(SHOP_ID) } });
  const aliases = await tx.shopAlias.findMany({ where: { shopId: BigInt(SHOP_ID) }, orderBy: { id: 'asc' } });
  validateShop(shop); validateAliases(aliases);
  return canonical({ shop, aliases });
}
export async function executeAddressFormatPlan(target, plan, { databaseUrl, expectedDigest, rollback = false } = {}) {
  cloneRepairUrl(databaseUrl);
  return executeExactPlan(target, plan, { expectedDigest, rollback }, QA_TARGET);
}
export async function executeMainAddressFormatPlan(target, plan, { databaseUrl, expectedDigest, acknowledgeMain919FormatOnly = false, rollback = false } = {}) {
  mainRepairUrl(databaseUrl, { acknowledgeMain919FormatOnly });
  if (rollback) fail('ADDRESS_FORMAT_MAIN_ROLLBACK_NOT_AUTHORIZED_BY_THIS_ENTRY');
  return executeExactPlan(target, plan, { expectedDigest, rollback: false }, MAIN_TARGET);
}
async function executeExactPlan(target, plan, { expectedDigest, rollback }, exactTarget) {
  validatePlan(plan, exactTarget);
  if (expectedDigest !== plan.digest) fail('ADDRESS_FORMAT_EXACT_PLAN_DIGEST_REQUIRED');
  if (rollback && plan.status !== 'pending') fail('ADDRESS_FORMAT_NOOP_NOT_ROLLBACKABLE');
  return target.$transaction(async tx => {
    const current = await lockedImage(tx, exactTarget);
    const desired = rollback ? plan.before : plan.after;
    const required = rollback ? plan.after : plan.before;
    if (equal(current, desired)) return { status: rollback ? 'already-rolled-back' : 'already-applied', updatedStores: 0, before: current, after: current, digest: plan.digest };
    if (!equal(current, required)) fail('ADDRESS_FORMAT_CONCURRENT_CHANGE_REFUSED');
    const data = rollback ? { address: plan.before.shop.address, studioProfile: plan.before.shop.studioProfile, updatedAt: new Date(plan.before.shop.updatedAt) }
      : { ...plan.data, updatedAt: new Date(plan.data.updatedAt) };
    const result = await tx.shop.updateMany({ where: casWhere(required.shop), data });
    if (result.count !== 1) fail('ADDRESS_FORMAT_COMPARE_AND_SET_FAILED');
    const after = await lockedImage(tx, exactTarget);
    if (!equal(after, desired)) fail('ADDRESS_FORMAT_READBACK_MISMATCH_ROLLED_BACK');
    return { status: rollback ? 'rolled-back' : 'applied', updatedStores: 1, before: current, after, digest: plan.digest };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
}

export async function rollbackOnlyDrill(target, plan, options = {}) {
  // The real MySQL regression can prove rollback after a successful UPDATE
  // without a fault-injection switch in the production CLI.
  const abort = Error('ADDRESS_FORMAT_EXPECTED_DRILL_ROLLBACK');
  try {
    await executeAddressFormatPlan({ $transaction: (callback, transactionOptions) => target.$transaction(async tx => {
      await callback(tx); throw abort;
    }, transactionOptions) }, plan, options);
  } catch (error) { if (error === abort) return { status: 'deliberately-rolled-back', digest: plan.digest }; throw error; }
  fail('ADDRESS_FORMAT_ROLLBACK_DRILL_DID_NOT_ABORT');
}
