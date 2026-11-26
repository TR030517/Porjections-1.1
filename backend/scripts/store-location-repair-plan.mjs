import crypto from 'node:crypto';
import * as timezoneModule from '../src/common/store-timezone.ts';
const { inferStoreTimezone, storeZipStateConflict } = timezoneModule.default ?? timezoneModule;

export const EXPECTED_DATABASE = 'mj2_store_migration_84cec1e6';
export const locationSelect = { id: true, address: true, city: true, state: true, zipCode: true, timezone: true, updatedAt: true, studioProfile: true };
const text = value => String(value ?? '').trim();

export function localRepairUrl(value, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === 'production') throw new Error('Location repair is local-only');
  let url;
  try { url = new URL(value || ''); } catch { throw new Error('DATABASE_URL is required'); }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '33090' || decodeURIComponent(url.pathname.slice(1)) !== EXPECTED_DATABASE || url.search || url.hash) {
    throw new Error('This job is restricted to the isolated local migration database');
  }
  return url.toString();
}

export function planDigest(changes) {
  return crypto.createHash('sha256').update(JSON.stringify(changes, (_key, value) => typeof value === 'bigint' ? String(value) : value)).digest('hex');
}

export function timezoneBackfillPlan(shops, { overwriteExisting = false } = {}) {
  const changes = [], unresolved = [], conflicts = [];
  let preserved = 0, unchanged = 0;
  for (const shop of shops) {
    const conflict = storeZipStateConflict(text(shop.state), text(shop.zipCode));
    if (conflict) { conflicts.push(String(shop.id)); continue; }
    const timezone = inferStoreTimezone(text(shop.city), text(shop.state), text(shop.zipCode));
    if (!timezone) { unresolved.push(String(shop.id)); continue; }
    if (shop.timezone === timezone) { unchanged++; continue; }
    // Existing values may be deliberate manual exceptions. Never infer permission
    // to replace them from the fact that the new resolver gives a different zone.
    if (text(shop.timezone) && !overwriteExisting) { preserved++; continue; }
    changes.push({ before: shop, data: { timezone } });
  }
  return { changes, unresolved, conflicts, preserved, unchanged };
}

// A city plus its complete ZIP confirms each of these four migrated state errors.
// Match the original source ID and full preimage too, so a later human correction
// or unrelated store with the same city can never be selected accidentally.
const CONFIRMED_STATE_CORRECTIONS = [
  { sourceShopId: '1310', city: 'Fort Wayne', state: 'Illinois', zipCode: '46815', nextState: 'Indiana', oldTimezone: 'America/Chicago' },
  { sourceShopId: '1687', city: 'Indianapolis', state: 'Illinois', zipCode: '46221', nextState: 'Indiana', oldTimezone: 'America/Chicago' },
  { sourceShopId: '3201', city: 'Branson', state: 'Montana', zipCode: '65616', nextState: 'Missouri', oldTimezone: 'America/Denver' },
  { sourceShopId: '3364', city: 'St Peters', state: 'Montana', zipCode: '63376', nextState: 'Missouri', oldTimezone: 'America/Denver' },
];

export function confirmedLocationRepairPlan(shops, { repairKnownTimezones = false } = {}) {
  const changes = [], conflicts = [], preservedTimezones = [];
  for (const shop of shops) {
    const source = shop.studioProfile?.legacyImport;
    const correction = source?.source === 'Massajoy1.0' && CONFIRMED_STATE_CORRECTIONS.find(row => row.sourceShopId === String(source.sourceShopId)
      && row.city === shop.city && row.state === shop.state && row.zipCode === shop.zipCode);
    if (!correction) {
      if (storeZipStateConflict(text(shop.state), text(shop.zipCode))) conflicts.push(String(shop.id));
      continue;
    }
    const data = { state: correction.nextState };
    const timezone = inferStoreTimezone(shop.city, correction.nextState, shop.zipCode);
    if (!text(shop.timezone) || repairKnownTimezones && shop.timezone === correction.oldTimezone) data.timezone = timezone;
    else if (shop.timezone !== timezone) preservedTimezones.push({ id: String(shop.id), current: shop.timezone, suggested: timezone });
    changes.push({ before: shop, data });
  }
  return { changes, conflicts, preservedTimezones };
}

export async function applyLocationPlan(target, changes) {
  if (changes.some(change => !Object.keys(change.data).length || Object.keys(change.data).some(field => !['state', 'timezone'].includes(field)))) {
    throw new Error('Location repair may write only state and timezone');
  }
  await target.$transaction(async tx => {
    for (const { before, data } of changes) {
      await tx.$queryRaw`SELECT id FROM shops WHERE id = ${before.id} FOR UPDATE`;
      if (data.timezone && data.timezone !== before.timezone) {
        const future = await tx.booking.count({ where: { shopId: before.id, deletedAt: null, status: { in: ['PENDING', 'CONFIRMED'] }, endTime: { gt: new Date() } } });
        const locks = await tx.bookingResourceLock.count({ where: { shopId: before.id, status: 'ACTIVE', endAtUtc: { gt: new Date() } } });
        if (future || locks) throw new Error('Store ' + before.id + ' has future reservations; timezone repair stopped');
      }
      const result = await tx.shop.updateMany({ where: { id: before.id, address: before.address, city: before.city, state: before.state,
        zipCode: before.zipCode, timezone: before.timezone, updatedAt: before.updatedAt }, data });
      if (result.count !== 1) throw new Error('Store ' + before.id + ' changed after planning; entire repair rolled back');
    }
  }, { maxWait: 30000, timeout: 600000, isolationLevel: 'ReadCommitted' });
}
