import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEWED_LOCATIONS, generatedAddressMapLink, remainingLocationPlan, applyRemainingLocationPlan } from './remaining-store-location-plan.mjs';
import { planDigest } from './store-location-repair-plan.mjs';

function fixture(sourceShopId = '2223', extra = {}) {
  const reviewed = REVIEWED_LOCATIONS.find(row => row.sourceShopId === sourceShopId);
  return { id: 1n, name: 'Location fixture', address: reviewed.rawAddress, city: '', state: '', zipCode: '', timezone: null,
    updatedAt: new Date('2026-11-06T00:00:00Z'), studioProfile: { title: 'Manual title', legacyImport: { source: 'Massajoy1.0', sourceShopId } }, ...extra };
}
function source(sourceShopId = '2223', extra = {}) {
  const reviewed = REVIEWED_LOCATIONS.find(row => row.sourceShopId === sourceShopId);
  return { id: sourceShopId, addr: reviewed.rawAddress, ...extra };
}

test('each reviewed raw source address recovers its literal locality and no street text changes', () => {
  const shops = REVIEWED_LOCATIONS.map((row, index) => fixture(row.sourceShopId, { id: BigInt(index + 1) }));
  const result = remainingLocationPlan(shops, REVIEWED_LOCATIONS.map(row => source(row.sourceShopId)));
  assert.equal(result.changes.length, 15);
  assert.equal(result.after.city, 0);
  for (const { before, data, evidence } of result.changes) {
    const expected = REVIEWED_LOCATIONS.find(row => row.sourceShopId === before.studioProfile.legacyImport.sourceShopId);
    assert.equal(data.city, expected.city);
    assert.equal(data.state, expected.state);
    assert.equal(data.zipCode, expected.zipCode);
    assert.ok(data.timezone);
    assert.equal(Object.hasOwn(data, 'address'), false);
    assert.equal(evidence[0].rawAddress, expected.rawAddress);
    assert.equal(evidence[0].sourceTable, 'merchant');
  }
});

test('city-only source strings recover locality but cannot fabricate street-level map links', () => {
  const result = remainingLocationPlan([fixture('371')], [source('371')], { generateAddressMapLinks: true });
  assert.deepEqual(result.changes[0].data, { city: 'Trenton', state: 'New Jersey', zipCode: '08610', timezone: 'America/New_York' });
  assert.equal(result.provenance.generatedMapLinks, 0);
});

test('a manual timezone and equivalent state spelling remain unchanged', () => {
  const result = remainingLocationPlan([fixture('2548', { state: 'New Jeresy', zipCode: '07036', timezone: 'Pacific/Honolulu' })], [source('2548')]);
  assert.deepEqual(result.changes[0].data, { city: 'Linden' });
});

test('a changed source row, current address, city, state, ZIP or migration identity cannot trigger the reviewed repair', () => {
  const cases = [
    { shop: fixture(), row: source('2223', { addr: 'Changed source address' }) },
    { shop: fixture('2223', { address: 'Manually edited address' }), row: source() },
    { shop: fixture('2223', { city: 'Another city' }), row: source() },
    { shop: fixture('2223', { state: 'Washington' }), row: source() },
    { shop: fixture('2223', { zipCode: '98144' }), row: source() },
    { shop: fixture('2223', { studioProfile: {} }), row: source() },
  ];
  for (const item of cases) assert.deepEqual(remainingLocationPlan([item.shop], [item.row]).changes, []);
});

test('an ambiguous concatenated Houston address and multi-city text remain unresolved', () => {
  for (const [id, address] of [['2823', '11830 BELLAIRE BLVD,STE EHOUSTONTX 77072'], ['3416', 'Phoenix,Flagstaff, Sedona,Tocson, Lake hawasu city']]) {
    const shop = fixture('2223', { address, studioProfile: { legacyImport: { source: 'Massajoy1.0', sourceShopId: id } } });
    assert.equal(remainingLocationPlan([shop], [{ id, addr: address }]).changes.length, 0);
  }
});

test('generated links require complete consistent street locality and are opt-in', () => {
  const shop = fixture('2223', { address: '166 Main St #2', city: 'Old Saybrook', state: 'Connecticut', zipCode: '06475', timezone: 'America/New_York' });
  assert.equal(remainingLocationPlan([shop], [source()]).changes.length, 0);
  const result = remainingLocationPlan([shop], [source()], { generateAddressMapLinks: true });
  assert.equal(result.changes[0].data.studioProfile.mapShareUrlSource.kind, 'generated-address-search');
  assert.equal(result.changes[0].data.studioProfile.title, 'Manual title');
  assert.match(decodeURIComponent(result.changes[0].data.studioProfile.mapShareUrl), /166 Main St #2, Old Saybrook, Connecticut, 06475/);
  assert.equal(result.provenance.copiedMapLinks, 0);
  assert.match(decodeURIComponent(generatedAddressMapLink({ address: '220-38 Northern Blvd', city: 'Bayside', state: 'New York', zipCode: '11361' })), /220-38 Northern Blvd, Bayside, New York, 11361/);
  for (const extra of [{ city: '' }, { state: '' }, { zipCode: '' }, { state: 'Washington' }, { address: 'N Clark St' }, { address: '' }]) {
    assert.equal(generatedAddressMapLink({ ...shop, ...extra }), '');
  }
});

test('original safe source links take priority and existing maps are preserved', () => {
  const shop = fixture('2223', { city: 'Old Saybrook', state: 'Connecticut', zipCode: '06475', timezone: 'America/New_York' });
  const result = remainingLocationPlan([shop], [source('2223', { google_map_share_url: 'https://maps.app.goo.gl/example' })], { generateAddressMapLinks: true });
  assert.equal(result.provenance.copiedMapLinks, 1);
  assert.equal(result.changes[0].data.studioProfile.mapShareUrlSource.kind, 'legacy-source-link');
  const configured = { ...shop, studioProfile: { ...shop.studioProfile, mapShareUrl: 'https://example.com/manual-map' } };
  assert.equal(remainingLocationPlan([configured], [source('2223', { google_map_share_url: 'https://maps.app.goo.gl/example' })], { generateAddressMapLinks: true }).changes.length, 0);
  assert.equal(remainingLocationPlan([shop], [source('2223', { google_map_share_url: 'javascript:alert(1)' })]).changes.length, 0);
});

test('the plan is idempotent and binds exact current/source evidence to its digest', () => {
  const shop = fixture();
  const plan = remainingLocationPlan([shop], [source()], { generateAddressMapLinks: true });
  assert.equal(remainingLocationPlan([{ ...shop, ...plan.changes[0].data }], [source()], { generateAddressMapLinks: true }).changes.length, 0);
  assert.notEqual(planDigest(plan.changes), planDigest([{ ...plan.changes[0], before: { ...shop, updatedAt: new Date() } }]));
});

function dbFixture({ bookings = 0, locks = 0, count = 1 } = {}) {
  const writes = [], events = [];
  const tx = { $queryRaw: async () => { events.push('lock'); return []; }, booking: { count: async () => bookings },
    bookingResourceLock: { count: async () => locks }, shop: { updateMany: async input => { events.push('write'); writes.push(input); return { count }; } } };
  return { writes, events, db: { $transaction: async callback => callback(tx) } };
}

test('apply locks then compares all location fields, profile and updatedAt before filling', async () => {
  const shop = fixture(), f = dbFixture();
  const plan = remainingLocationPlan([shop], [source()], { generateAddressMapLinks: true });
  await applyRemainingLocationPlan(f.db, plan.changes);
  assert.deepEqual(f.events, ['lock', 'write']);
  assert.equal(f.writes[0].where.updatedAt, shop.updatedAt);
  assert.equal(f.writes[0].where.address, shop.address);
  assert.deepEqual(f.writes[0].where.studioProfile, { equals: shop.studioProfile });
  assert.equal(Object.hasOwn(f.writes[0].data, 'status'), false);
});

test('future bookings and resource locks prevent timezone changes', async () => {
  const plan = remainingLocationPlan([fixture()], [source()]);
  for (const options of [{ bookings: 1 }, { locks: 1 }]) {
    const f = dbFixture(options);
    await assert.rejects(applyRemainingLocationPlan(f.db, plan.changes), /future reservations/);
    assert.equal(f.writes.length, 0);
  }
});

test('concurrent edits abort and disallowed or nonblank fields fail before any transaction', async () => {
  const plan = remainingLocationPlan([fixture()], [source()]);
  await assert.rejects(applyRemainingLocationPlan(dbFixture({ count: 0 }).db, plan.changes), /changed after planning/);
  for (const data of [{ status: 'APPROVED' }, { address: 'new street' }, { timezone: 'America/Chicago' }, { studioProfile: { title: 'lost metadata', mapShareUrl: 'https://maps.google.com', mapShareUrlSource: { kind: 'generated-address-search' } } }]) {
    let opened = false;
    await assert.rejects(applyRemainingLocationPlan({ $transaction: async () => { opened = true; } }, [{ before: fixture('2223', { timezone: 'Pacific/Honolulu' }), data }]));
    assert.equal(opened, false);
  }
});
