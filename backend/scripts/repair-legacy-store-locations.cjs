'use strict';

const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { IMPORT_SOURCE, TARGET_DB_PATTERN, legacyLocation, legacyMapShareUrl, normalizeUsState, parseUrl, plainText } = require('./import-legacy-stores.cjs');
const args = new Set(process.argv.slice(2));

async function currentDatabase(client) {
  const result = await client.$queryRawUnsafe('SELECT DATABASE() AS name');
  return String(result[0]?.name || '');
}

async function buildChanges(target) {
  const aliases = await target.shopAlias.findMany({
    where: { kind: 'LEGACY_STORE_ID', source: IMPORT_SOURCE, isActive: true },
    select: { shopId: true, value: true },
  });
  const shopIds = aliases.map(alias => alias.shopId);
  const shops = await target.shop.findMany({
    where: { id: { in: shopIds } },
    select: { id: true, address: true, city: true, state: true, zipCode: true, latitude: true, longitude: true, studioProfile: true },
  });
  const shopById = new Map(shops.map(shop => [String(shop.id), shop]));
  const changes = [];
  for (const alias of aliases) {
    const shop = shopById.get(String(alias.shopId));
    if (!shop || !/^\d+$/.test(alias.value)) continue;
    const location = legacyLocation({ address: shop.address, city: shop.city, province: shop.state, zipcode: shop.zipCode });
    const data = {};
    const existingAddress = plainText(shop.address, 500);
    const profile = shop.studioProfile && typeof shop.studioProfile === 'object' && !Array.isArray(shop.studioProfile) ? shop.studioProfile : {};
    const parsedLocation = location.address !== location.rawAddress;
    const currentCity = plainText(shop.city, 100);
    const currentState = plainText(shop.state, 50);
    const currentZip = plainText(shop.zipCode, 10);
    const normalizedCurrentState = normalizeUsState(currentState);
    const parsedValuesMatch = (!currentCity || currentCity.toLowerCase() === location.city.toLowerCase())
      && (!currentState || normalizedCurrentState.toLowerCase() === location.state.toLowerCase())
      && (!currentZip || currentZip === location.zipCode);
    if (parsedLocation && parsedValuesMatch && location.city && location.state && location.zipCode) data.address = location.address;
    if (!currentCity && location.city) data.city = location.city;
    if (location.state && (!currentState || (currentState.length === 2 && normalizedCurrentState.toLowerCase() === location.state.toLowerCase()))) data.state = location.state.slice(0, 50);
    if (!currentZip && location.zipCode) data.zipCode = location.zipCode.slice(0, 10);

    const sourceLat = Number(shop.latitude);
    const sourceLng = Number(shop.longitude);
    const lat = Number.isFinite(sourceLat) && sourceLat >= -90 && sourceLat <= 90 ? sourceLat : 0;
    const lng = Number.isFinite(sourceLng) && sourceLng >= -180 && sourceLng <= 180 ? sourceLng : 0;
    if (!plainText(profile.mapShareUrl, 500)) {
      const oldReferences = Array.isArray(profile.legacyImport?.legacyMapReferences) ? profile.legacyImport.legacyMapReferences : [];
      const mapShareUrl = legacyMapShareUrl({ google_map_share_url: oldReferences[0], google_map: oldReferences[1] }, lat, lng);
      if (mapShareUrl) data.studioProfile = { ...profile, mapShareUrl };
    }
    if (Object.keys(data).length) changes.push({ shopId: shop.id, sourceShopId: alias.value, data });
  }
  return changes.sort((left, right) => String(left.shopId).localeCompare(String(right.shopId)));
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Legacy location repair is local-only');
  const targetUrl = parseUrl(process.env.DATABASE_URL, '2.0 target', TARGET_DB_PATTERN);
  const targetDb = decodeURIComponent(new URL(targetUrl).pathname.slice(1));
  if (args.has('--apply') && !args.has('--acknowledge-local-only')) throw new Error('Apply requires --apply --acknowledge-local-only');
  if (!args.has('--apply') && args.has('--acknowledge-local-only')) throw new Error('Acknowledgement is accepted only with --apply');

  const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    await target.$connect();
    if (await currentDatabase(target) !== targetDb) throw new Error('Database identity check failed; no target writes were made');
    const changes = await buildChanges(target);
    const digest = crypto.createHash('sha256').update(JSON.stringify(changes, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).digest('hex');
    const summary = {
      mode: args.has('--apply') ? 'apply' : 'dry-run',
      matchedStores: changes.length,
      addresses: changes.filter(change => Object.hasOwn(change.data, 'address')).length,
      cities: changes.filter(change => Object.hasOwn(change.data, 'city')).length,
      states: changes.filter(change => Object.hasOwn(change.data, 'state')).length,
      zipCodes: changes.filter(change => Object.hasOwn(change.data, 'zipCode')).length,
      mapLinks: changes.filter(change => change.data.studioProfile?.mapShareUrl).length,
      digest,
    };
    if (!args.has('--apply')) { process.stdout.write(JSON.stringify(summary) + '\n'); return; }
    const expected = process.argv.find(value => value.startsWith('--expected-digest='));
    if (!expected || expected.slice('--expected-digest='.length) !== digest) throw new Error('Change digest does not match the approved dry-run; no target writes were made');
    await target.$transaction(async tx => {
      for (const change of changes) await tx.shop.update({ where: { id: change.shopId }, data: change.data });
    }, { maxWait: 30000, timeout: 600000, isolationLevel: 'ReadCommitted' });
    process.stdout.write(JSON.stringify({ ...summary, updated: changes.length }) + '\n');
  } finally {
    await target.$disconnect();
  }
}

main().catch(error => {
  process.stderr.write('Legacy location repair failed: ' + String(error && error.message || 'unknown error').replace(/[\r\n]/g, ' ') + '\n');
  process.exitCode = 1;
});
