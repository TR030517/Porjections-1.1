import * as timezoneModule from '../src/common/store-timezone.ts';
const { inferStoreTimezone, storeZipStateConflict, usStateCode } = timezoneModule.default ?? timezoneModule;

const text = value => String(value ?? '').trim();
const plain = value => text(value).replace(/<\/?[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const same = (left, right) => text(left).toLowerCase() === text(right).toLowerCase();

// Reviewed against the literal merchant.addr in the local 1.0 SQL dump. These
// malformed strings lack separators, so a general street/city guess is unsafe.
// Source ID AND exact source/current address must match; only empty fields fill.
export const REVIEWED_LOCATIONS = [
  ['371', 'Trenton, NJ 08610, USA', 'Trenton', 'New Jersey', '08610'],
  ['451', 'Camp Verde, AZ 86322, USA', 'Camp Verde', 'Arizona', '86322'],
  ['588', 'Detroit, MI 48219, USA', 'Detroit', 'Michigan', '48219'],
  ['772', 'Lake Havasu City, AZ 86403, USA', 'Lake Havasu City', 'Arizona', '86403'],
  ['1229', '940 N Alma School Rd ste 100, Chandler, AZ 85224(We next to goodwill)', 'Chandler', 'Arizona', '85224'],
  ['2223', '166 Main St #2 Old Saybrook CT 06475', 'Old Saybrook', 'Connecticut', '06475'],
  ['2548', '557 Ziegler Ave linden,NJ 07036', 'Linden', 'New Jersey', '07036'],
  ['3098', '8852 N Milwaukee Ave. Niles, IL 60714', 'Niles', 'Illinois', '60714'],
  ['3261', '201 S Division St STE D Auburn WA 98001', 'Auburn', 'Washington', '98001'],
  ['3325', '3440 US-9. Freehold, NJ 07728', 'Freehold', 'New Jersey', '07728'],
  ['3400', 'United States, Utah, Murray, S State St, 1920邮政编码: 84107', 'Murray', 'Utah', '84107'],
  ['3476', 'N Clark St. Chicago IL 60614', 'Chicago', 'Illinois', '60614'],
  ['3554', '124 N Glendora Ave #2 Glendora, CA 91741', 'Glendora', 'California', '91741'],
  ['3649', '1745 Swan Lake Rd Bossier City,LA71111', 'Bossier City', 'Louisiana', '71111'],
  ['3813', '3108 Old Denton Rd Suite 105 Carrollton. TX 75007', 'Carrollton', 'Texas', '75007'],
].map(([sourceShopId, rawAddress, city, state, zipCode]) => ({ sourceShopId, rawAddress, city, state, zipCode }));

function rawAddress(row) {
  return plain(row.address) || [row.addr, row.house_number, row.address_extra].map(plain).filter(Boolean).join(' ');
}

function https(value) {
  const candidate = text(value);
  if (!candidate || /[\s\\\u0000-\u001f\u007f]/u.test(candidate)) return '';
  try { const url = new URL(candidate); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

export function missingLocationCounts(shops) {
  return { city: shops.filter(row => !text(row.city)).length,
    state: shops.filter(row => !text(row.state)).length,
    zipCode: shops.filter(row => !text(row.zipCode)).length,
    timezone: shops.filter(row => !text(row.timezone)).length,
    mapShareUrl: shops.filter(row => !text(row.studioProfile?.mapShareUrl)).length };
}

export function generatedAddressMapLink(shop) {
  const { address, city, state, zipCode } = shop;
  // A city alone is not a street address. Require a house number, street text,
  // complete US locality, and a ZIP consistent with the explicit state.
  if (!/^\d+(?:-\d+)?[A-Za-z-]*\s+.*[A-Za-z]/.test(text(address)) || !/[A-Za-z]/.test(text(city))
    || !usStateCode(text(state)) || !/^\d{5}(?:-\d{4})?$/.test(text(zipCode))
    || storeZipStateConflict(text(state), text(zipCode))) return '';
  const query = [text(address), text(city), text(state), text(zipCode)].join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}

export function remainingLocationPlan(shops, sourceRows, { generateAddressMapLinks = false } = {}) {
  const sourceById = new Map(sourceRows.map(row => [String(row.id), row]));
  const changes = [], skipped = [], missingSourceMapIds = [];
  const provenance = { recoveredLocations: 0, copiedMapLinks: 0, generatedMapLinks: 0 };
  for (const before of shops) {
    const source = before.studioProfile?.legacyImport;
    if (source?.source !== 'Massajoy1.0') continue;
    const row = sourceById.get(String(source.sourceShopId));
    if (!row) { skipped.push({ id: String(before.id), reason: 'source-row-missing' }); continue; }
    const data = {}, evidence = [];
    const reviewed = REVIEWED_LOCATIONS.find(item => item.sourceShopId === String(source.sourceShopId));
    if (reviewed) {
      const fieldsAgree = (!text(before.city) || same(before.city, reviewed.city))
        && (!text(before.state) || usStateCode(text(before.state)) === usStateCode(reviewed.state))
        && (!text(before.zipCode) || text(before.zipCode) === reviewed.zipCode);
      if (rawAddress(row) !== reviewed.rawAddress || plain(before.address) !== reviewed.rawAddress || !fieldsAgree) {
        skipped.push({ id: String(before.id), reason: 'reviewed-source-or-current-address-changed' });
      } else {
        for (const field of ['city', 'state', 'zipCode']) if (!text(before[field])) data[field] = reviewed[field];
        if (!text(before.timezone)) {
          const timezone = inferStoreTimezone(reviewed.city, reviewed.state, reviewed.zipCode);
          if (timezone) data.timezone = timezone;
        }
        if (Object.keys(data).length) {
          provenance.recoveredLocations++;
          evidence.push({ kind: 'exact-source-address', sourceTable: 'merchant', sourceShopId: reviewed.sourceShopId, rawAddress: reviewed.rawAddress });
        }
      }
    }
    if (!text(before.studioProfile?.mapShareUrl)) {
      const copied = https(row.google_map_share_url) || https(row.google_map);
      const generated = !copied && generateAddressMapLinks ? generatedAddressMapLink({ ...before, ...data }) : '';
      if (!copied) missingSourceMapIds.push(String(before.id));
      if (copied || generated) {
        const origin = copied ? 'legacy-source-link' : 'generated-address-search';
        data.studioProfile = { ...before.studioProfile, mapShareUrl: copied || generated,
          mapShareUrlSource: { kind: origin, source: 'Massajoy1.0', sourceShopId: String(source.sourceShopId) } };
        provenance[copied ? 'copiedMapLinks' : 'generatedMapLinks']++;
        evidence.push({ kind: origin, sourceTable: copied ? 'merchant' : 'shops', sourceShopId: String(source.sourceShopId) });
      }
    }
    if (Object.keys(data).length) changes.push({ before, data, evidence });
  }
  const afterById = new Map(changes.map(({ before, data }) => [String(before.id), { ...before, ...data }]));
  return { changes, skipped, missingSourceMapIds, provenance, before: missingLocationCounts(shops),
    after: missingLocationCounts(shops.map(shop => afterById.get(String(shop.id)) || shop)) };
}

export async function applyRemainingLocationPlan(target, changes) {
  // The executor independently enforces fill-only writes. Publication, login,
  // street text, coordinates and historical/future booking snapshots never write.
  for (const { before, data } of changes) {
    if (!Object.keys(data).length || Object.keys(data).some(field => !['city', 'state', 'zipCode', 'timezone', 'studioProfile'].includes(field))) throw new Error('Invalid location repair fields');
    for (const field of ['city', 'state', 'zipCode', 'timezone']) if (field in data && text(before[field])) throw new Error('Location repair refuses to overwrite existing ' + field);
    if (data.studioProfile) {
      const oldProfile = before.studioProfile ?? {};
      const { mapShareUrl, mapShareUrlSource, ...retained } = data.studioProfile;
      const { mapShareUrl: oldUrl, mapShareUrlSource: oldSource, ...oldRetained } = oldProfile;
      if (text(oldUrl) || !https(mapShareUrl) || JSON.stringify(retained) !== JSON.stringify(oldRetained)
        || !['legacy-source-link', 'generated-address-search'].includes(mapShareUrlSource?.kind)) throw new Error('Map repair refuses to overwrite existing profile data');
    }
  }
  await target.$transaction(async tx => {
    for (const { before, data } of changes) {
      await tx.$queryRaw`SELECT id FROM shops WHERE id = ${before.id} FOR UPDATE`;
      if (data.timezone && data.timezone !== before.timezone) {
        const future = await tx.booking.count({ where: { shopId: before.id, deletedAt: null, status: { in: ['PENDING', 'CONFIRMED'] }, endTime: { gt: new Date() } } });
        const locks = await tx.bookingResourceLock.count({ where: { shopId: before.id, status: 'ACTIVE', endAtUtc: { gt: new Date() } } });
        if (future || locks) throw new Error('Store ' + before.id + ' has future reservations; repair stopped');
      }
      const result = await tx.shop.updateMany({ where: { id: before.id, address: before.address, city: before.city, state: before.state,
        zipCode: before.zipCode, timezone: before.timezone, updatedAt: before.updatedAt, studioProfile: { equals: before.studioProfile } }, data });
      if (result.count !== 1) throw new Error('Store ' + before.id + ' changed after planning; entire repair rolled back');
    }
  }, { maxWait: 30000, timeout: 600000, isolationLevel: 'ReadCommitted' });
}
