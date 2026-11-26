import { createHash } from 'node:crypto';

export const TOOL = 'live1-public-sample-v1';
export const ACTION = 'LIVE1_SAMPLE_FILL';
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DATABASE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const FIXTURE_HOURS_PLACEHOLDER = Object.fromEntries(['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(day => [day, { open: false, start: '', end: '' }]));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };
export function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value?.toJSON === 'function') return canonical(value.toJSON());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  if (['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  return fail('UNSUPPORTED_CANONICAL_VALUE');
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export function id(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) fail('CANONICAL_BIGINT_ID_REQUIRED');
  return value;
}
function shape(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value, key))) fail('PACKAGE_SHAPE_INVALID');
}
function text(value, max, nonempty = true) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || nonempty && !value.trim() || value !== value.trim()) fail('PACKAGE_TEXT_INVALID');
  return value;
}
function evidenceUrl(value) {
  text(value, 2048);
  let url; try { url = new URL(value); } catch { return fail('SOURCE_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'app.asianmassagebook.com' || url.port || url.username || url.password || url.search || !['/admin', '/admin/', '/merchant', '/merchant/'].includes(url.pathname) || !/^#\/[a-zA-Z0-9/_-]+$/.test(url.hash)) fail('SOURCE_URL_INVALID');
}
export function validateHours(hours) {
  shape(hours, DAYS);
  let open = false;
  for (const day of DAYS) {
    const periods = hours[day];
    if (!Array.isArray(periods) || periods.length > 4) fail('HOURS_INVALID');
    let previous = -1;
    for (const period of periods) {
      shape(period, ['start', 'end']);
      const minute = value => {
        if (typeof value !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) fail('HOURS_INVALID');
        return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      };
      const start = minute(period.start), end = minute(period.end);
      if (start >= end || start < previous) fail('HOURS_INVALID');
      previous = end; open = true;
    }
  }
  if (!open) fail('SOURCE_ALL_CLOSED_NOT_IMPORTABLE');
}
function rawCatalog(value, depth = 0) {
  if (depth > 12) fail('RAW_CATALOG_INVALID');
  if (Array.isArray(value)) { for (const child of value) rawCatalog(child, depth + 1); return; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/(?:password|secret|token|cookie|credential|authorization|customer|userId|ownerId|email|phone)/i.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('RAW_CATALOG_FIELD_NOT_ALLOWED');
      rawCatalog(child, depth + 1);
    }
    return;
  }
  if (!(value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value))) fail('RAW_CATALOG_INVALID');
}
export function validatePackage(input) {
  shape(input, ['schemaVersion', 'sourceSystem', 'batchId', 'capturedAt', 'shops']);
  if (input.schemaVersion !== 1 || input.sourceSystem !== 'massajoy1' || typeof input.batchId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(input.batchId)) fail('SOURCE_CONTRACT_INVALID');
  if (typeof input.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.capturedAt) || !Number.isFinite(Date.parse(input.capturedAt))) fail('CAPTURED_AT_INVALID');
  const instant = new Date(input.capturedAt).toISOString();
  if (instant !== input.capturedAt && instant.replace('.000Z', 'Z') !== input.capturedAt) fail('CAPTURED_AT_INVALID');
  if (!Array.isArray(input.shops) || input.shops.length < 1 || input.shops.length > 20) fail('SHOP_MAPPING_REQUIRED');
  const sources = new Set(), targets = new Set();
  for (const shop of input.shops) {
    shape(shop, ['sourceEntity', 'sourceId', 'targetShopId', 'match', 'sourceUrls', 'description', 'businessHours', 'timezone', 'phone', 'rawCatalog'], ['sourceEntity', 'sourceId', 'targetShopId', 'match', 'sourceUrls']);
    if (shop.sourceEntity !== 'merchant') fail('SOURCE_ENTITY_INVALID');
    id(shop.sourceId); id(shop.targetShopId);
    if (sources.has(shop.sourceId) || targets.has(shop.targetShopId)) fail('DUPLICATE_MAPPING');
    sources.add(shop.sourceId); targets.add(shop.targetShopId);
    shape(shop.match, ['name', 'shortName']); text(shop.match.name, 200); text(shop.match.shortName, 100);
    if (!Array.isArray(shop.sourceUrls) || !shop.sourceUrls.length || shop.sourceUrls.length > 5) fail('SOURCE_URL_REQUIRED');
    shop.sourceUrls.forEach(evidenceUrl);
    if (own(shop, 'description')) text(shop.description, 20000);
    if (own(shop, 'businessHours')) validateHours(shop.businessHours);
    if (own(shop, 'timezone')) {
      shape(shop.timezone, ['value', 'kind', 'basis']); shape(shop.timezone.basis, ['country', 'state', 'note']);
      if (shop.timezone.value !== 'America/New_York' || shop.timezone.kind !== 'derived' || shop.timezone.basis.country !== 'US' || shop.timezone.basis.state !== 'CT') fail('EXPLICIT_CT_TIMEZONE_BASIS_REQUIRED');
      text(shop.timezone.basis.note, 1000);
    }
    if (own(shop, 'phone')) {
      shape(shop.phone, ['value', 'verifiedPublic', 'sourceUrl']);
      if (shop.phone.verifiedPublic !== true || typeof shop.phone.value !== 'string' || !/^\+?[0-9 ()-]{7,20}$/.test(shop.phone.value) || shop.phone.value !== shop.phone.value.trim()) fail('VERIFIED_PUBLIC_PHONE_REQUIRED');
      evidenceUrl(shop.phone.sourceUrl);
    }
    if (own(shop, 'rawCatalog')) { rawCatalog(shop.rawCatalog); if (Buffer.byteLength(canonical(shop.rawCatalog)) > 65536) fail('RAW_CATALOG_TOO_LARGE'); }
    if (!['description', 'businessHours', 'timezone', 'phone'].some(field => own(shop, field))) fail('NO_IMPORTABLE_FIELDS');
  }
  return input;
}
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
function desiredFields(shop) {
  return Object.fromEntries(['description', 'businessHours', 'timezone', 'phone'].filter(key => own(shop, key)).map(key => {
    if (key === 'businessHours') {
      const value = Object.fromEntries(DAYS.map((day, index) => {
        const periods = shop.businessHours[day].map(period => ({ open: period.start, close: period.end, closed: false }));
        return [DATABASE_DAYS[index], periods.length > 1 ? periods : periods[0] ?? { closed: true }];
      }));
      return [key, value];
    }
    return [key, ['timezone', 'phone'].includes(key) ? shop[key].value : shop[key]];
  }));
}
const empty = value => value === null || value === undefined || typeof value === 'string' && value.trim() === '';
const emptyHours = value => value == null || canonical(value) === '{}' || canonical(value) === canonical(FIXTURE_HOURS_PLACEHOLDER);
function priorFor(audits, input, source) {
  const sameBatch = audits.filter(a => a.detail?.tool === TOOL && a.detail?.batchId === input.batchId);
  if (sameBatch.some(a => a.detail.packageSHA !== input.packageSHA)) fail('BATCH_ID_REUSED_WITH_DIFFERENT_PACKAGE');
  const found = sameBatch.filter(a => a.detail.sourceId === source.sourceId && String(a.targetId) === source.targetShopId);
  if (found.length > 1) fail('DUPLICATE_IMPORT_AUDIT');
  return found[0] ?? null;
}
export function planShop(source, row, audits, input) {
  if (!row || row.deletedAt != null || String(row.id) !== source.targetShopId) fail('TARGET_SHOP_NOT_FOUND');
  if (row.name !== source.match.name || row.shortName !== source.match.shortName) fail('TARGET_NAME_OR_SHORT_NAME_MISMATCH');
  if (own(source, 'timezone') && !/^(?:CT|Connecticut)$/i.test(String(row.state ?? '').trim())) fail('TARGET_CT_STATE_EVIDENCE_MISMATCH');
  if (own(source, 'phone') && row.studioProfile && own(row.studioProfile, 'phones') && canonical(row.studioProfile.phones) !== canonical([source.phone.value])) fail('PHONE_PROFILE_OVERRIDE_NOT_SUPPORTED');
  const after = desiredFields(source), before = pick(row, Object.keys(after)), previous = priorFor(audits, input, source);
  if (previous) {
    if (previous.detail.afterFieldSHA !== digest(after) || digest(before) !== digest(after)) fail('PREVIOUSLY_IMPORTED_FIELDS_CHANGED');
    return { sourceId: source.sourceId, targetShopId: source.targetShopId, targetRowSHA: digest(row), before, write: {}, after, state: 'alreadyApplied' };
  }
  const write = {};
  for (const [field, value] of Object.entries(after)) {
    if (canonical(before[field]) === canonical(value)) continue;
    if (!(field === 'businessHours' ? emptyHours(before[field]) : empty(before[field]))) fail('NONEMPTY_TARGET_FIELD_CONFLICT');
    write[field] = value;
  }
  return { sourceId: source.sourceId, targetShopId: source.targetShopId, targetRowSHA: digest(row), before, write, after, state: Object.keys(write).length ? 'ready' : 'unchanged' };
}
export function validateLocalConfig(config, { environment = {}, allowCompose = false, inContainer = false } = {}) {
  shape(config, ['databaseUrl', 'databaseUrlEnv', 'actorId', 'connectionMode'], ['actorId']); id(config.actorId);
  if (own(config, 'databaseUrl') === own(config, 'databaseUrlEnv') || own(config, 'databaseUrlEnv') && config.databaseUrlEnv !== 'DATABASE_URL') fail('EXACT_DATABASE_URL_SOURCE_REQUIRED');
  const value = own(config, 'databaseUrl') ? config.databaseUrl : environment.DATABASE_URL;
  let url; try { url = new URL(value); } catch { return fail('LOCAL_DATABASE_URL_INVALID'); }
  const database = url.pathname.slice(1);
  const mode = config.connectionMode ?? 'loopback';
  const validHost = mode === 'loopback' ? ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && Number(url.port) >= 1 && Number(url.port) <= 65535
    : mode === 'compose-local' && allowCompose && inContainer && url.hostname === 'db' && url.port === '3306';
  if (url.protocol !== 'mysql:' || !validHost || !url.username || !url.password || url.search || url.hash || !/^(?:massajoy2_local|mj2_test_[a-zA-Z0-9_]+|mj2_live1_sample_[a-f0-9]{8})$/.test(database)) fail('EXPLICIT_LOCAL_TEST_DATABASE_REQUIRED');
  return { database, actorId: config.actorId, url: value, connectionMode: mode };
}
export async function guardDatabase(db, database) {
  const rows = await db.$queryRawUnsafe('SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid');
  if (rows.length !== 1 || rows[0].database_name !== database || typeof rows[0].server_uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(rows[0].server_uuid)) fail('CONNECTED_DATABASE_MISMATCH');
  return rows[0].server_uuid;
}
async function requireAdmin(db, actorId, lock = false) {
  if (lock) await db.$queryRawUnsafe('SELECT id FROM users WHERE id = ? FOR UPDATE', BigInt(actorId));
  const actor = await db.user.findUnique({ where: { id: BigInt(actorId) }, select: { id: true, role: true, status: true, deletedAt: true } });
  if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE' || actor.deletedAt != null) fail('EXISTING_ACTIVE_ADMIN_REQUIRED');
}
async function readAudits(db, ids, batchId) {
  const audits = await db.auditLog.findMany({ where: { action: ACTION, targetType: 'Shop', OR: [{ targetId: { in: ids.map(BigInt) } }, { detail: { path: '$.batchId', equals: batchId } }] }, orderBy: { id: 'desc' }, take: 1001, select: { targetId: true, detail: true } });
  if (audits.length > 1000) fail('IMPORT_AUDIT_HISTORY_LIMIT');
  return audits;
}
export function validatePlan(plan, input, packageSHA, actorId) {
  shape(plan, ['schemaVersion', 'tool', 'packageSHA', 'batchId', 'actorId', 'database', 'serverUUID', 'shops', 'planDigest']);
  if (plan.schemaVersion !== 1 || plan.tool !== TOOL || plan.packageSHA !== packageSHA || plan.batchId !== input.batchId || plan.actorId !== actorId || !Array.isArray(plan.shops) || plan.shops.length !== input.shops.length) fail('PLAN_PACKAGE_OR_ACTOR_MISMATCH');
  const { planDigest, ...body } = plan;
  if (planDigest !== digest(body)) fail('PLAN_DIGEST_INVALID');
  const ordered = [...input.shops].sort((a, b) => BigInt(a.targetShopId) < BigInt(b.targetShopId) ? -1 : 1);
  for (let i = 0; i < ordered.length; i++) {
    const item = plan.shops[i];
    shape(item, ['sourceId', 'targetShopId', 'targetRowSHA', 'before', 'write', 'after', 'state']);
    if (item.sourceId !== ordered[i].sourceId || item.targetShopId !== ordered[i].targetShopId || !/^[a-f0-9]{64}$/.test(item.targetRowSHA) || canonical(item.after) !== canonical(desiredFields(ordered[i])) || !['ready', 'unchanged', 'alreadyApplied'].includes(item.state)) fail('PLAN_CONTENT_INVALID');
    const fields = Object.keys(item.after);
    shape(item.before, fields); shape(item.write, fields, []);
    if (Object.entries(item.write).some(([key, value]) => canonical(value) !== canonical(item.after[key]))) fail('PLAN_CONTENT_INVALID');
  }
  return ordered;
}
export async function createPlan(db, input, { packageSHA, actorId, database }) {
  validatePackage(input); id(actorId); const serverUUID = await guardDatabase(db, database); await requireAdmin(db, actorId);
  const ordered = [...input.shops].sort((a, b) => BigInt(a.targetShopId) < BigInt(b.targetShopId) ? -1 : 1), audits = await readAudits(db, ordered.map(s => s.targetShopId), input.batchId), shops = [];
  for (const source of ordered) shops.push(planShop(source, await db.shop.findUnique({ where: { id: BigInt(source.targetShopId) } }), audits, { ...input, packageSHA }));
  const plan = { schemaVersion: 1, tool: TOOL, packageSHA, batchId: input.batchId, actorId, database, serverUUID, shops };
  return { ...plan, planDigest: digest(plan) };
}
/** Real DB writes are limited to Shop's four optional fields and one safe audit per changed shop.
 * Tests use a transaction-composition double; they do not establish MySQL concurrency behavior. */
export async function applyPlan(db, input, plan, options) {
  validatePackage(input);
  const { packageSHA, actorId, database, expectedPlanDigest } = options;
  const ordered = validatePlan(plan, input, packageSHA, actorId);
  if (!expectedPlanDigest || expectedPlanDigest !== plan.planDigest) fail('EXPECTED_PLAN_DIGEST_REQUIRED');
  if (plan.database !== database || plan.serverUUID !== await guardDatabase(db, database)) fail('PLAN_DATABASE_IDENTITY_MISMATCH');
  return db.$transaction(async tx => {
    if (plan.serverUUID !== await guardDatabase(tx, database)) fail('PLAN_DATABASE_IDENTITY_MISMATCH');
    for (const source of ordered) await tx.$queryRawUnsafe('SELECT id FROM shops WHERE id = ? FOR UPDATE', BigInt(source.targetShopId));
    await requireAdmin(tx, actorId, true);
    const audits = await readAudits(tx, ordered.map(s => s.targetShopId), input.batchId);
    const result = { applied: 0, alreadyApplied: 0, unchanged: 0, changedFieldCount: 0, auditsCreated: 0 };
    for (let index = 0; index < ordered.length; index++) {
      const source = ordered[index], row = await tx.shop.findUnique({ where: { id: BigInt(source.targetShopId) } });
      const current = planShop(source, row, audits, { ...input, packageSHA });
      if (current.state === 'alreadyApplied') { result.alreadyApplied++; continue; }
      const expected = plan.shops[index];
      if (current.targetRowSHA !== expected.targetRowSHA || canonical(current.before) !== canonical(expected.before) || canonical(current.write) !== canonical(expected.write) || current.state !== expected.state) fail('TARGET_CHANGED_SINCE_PLAN');
      if (current.state === 'unchanged') { result.unchanged++; continue; }
      const saved = await tx.shop.update({ where: { id: BigInt(source.targetShopId) }, data: current.write });
      if (digest(pick(saved, Object.keys(current.after))) !== digest(current.after)) fail('SAVED_FIELD_VERIFICATION_FAILED');
      await tx.auditLog.create({ data: { action: ACTION, targetType: 'Shop', targetId: BigInt(source.targetShopId), operatorId: BigInt(actorId), detail: {
        tool: TOOL, batchId: input.batchId, packageSHA, planDigest: plan.planDigest, sourceSystem: input.sourceSystem, sourceEntity: source.sourceEntity, sourceId: source.sourceId, sourceIds: [source.sourceId],
        capturedAt: input.capturedAt, evidenceKind: 'authenticated-ui-public-business-fields', sourceEvidenceSHA: digest(source.sourceUrls),
        fields: Object.keys(current.write).sort(), changedFields: Object.keys(current.write).sort(), afterFieldSHA: digest(current.after), targetAfterSHA: digest(saved), rawCatalogImported: false,
      } } });
      result.applied++; result.changedFieldCount += Object.keys(current.write).length; result.auditsCreated++;
    }
    return result;
  }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 60000 });
}
export function safeSummary(plan, mode, result = {}) {
  return { schemaVersion: 1, tool: TOOL, mode, packageSHA: plan.packageSHA, planDigest: plan.planDigest, mappedShopCount: plan.shops.length,
    plannedChangedShopCount: plan.shops.filter(s => s.state === 'ready').length, plannedChangedFieldCount: plan.shops.reduce((n, s) => n + Object.keys(s.write).length, 0),
    ...result, catalogImported: false, accountsOrFinanceChanged: false, deploymentReady: false };
}
