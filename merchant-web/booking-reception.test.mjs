import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server, reception, merchantApi, bookingApi, client;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('./', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const shared = '/@fs/' + fileURLToPath(new URL('../src/utils/bookingReception.ts', import.meta.url)).replaceAll('\\', '/');
  reception = await server.ssrLoadModule(shared);
  merchantApi = await server.ssrLoadModule('/src/api/merchant.ts');
  bookingApi = await server.ssrLoadModule('/src/api/bookings.ts');
  client = (await server.ssrLoadModule('/src/api/client.ts')).default;
});
after(async () => { await server?.close(); });

const occurrenceCount = (text, needle) => text.split(needle).length - 1;
const segment = (patch = {}) => ({ id: '31', participantIndex: 1, sequence: 1, durationMin: 60, serviceNameSnapshot: 'Original Body', variantNameSnapshot: 'Saved 60', priceCentsSnapshot: 8000, ...patch });
const allocationNames = {
  customer: { name: 'Booked customer', phone: '+1 (212) 555-0199' },
  therapists: [{ id: '71', name: 'First therapist' }, { id: '72', name: 'Second therapist' }, { id: '99', name: 'Unassigned therapist' }],
  rooms: [{ id: '81', name: 'Quiet room' }, { id: '89', name: 'Unassigned room' }],
};

test('service summaries follow saved participant and sequence order, retaining every repeated service', () => {
  const items = [
    segment({ id: '34', participantIndex: 2, sequence: 1, serviceNameSnapshot: 'Repeated Body', variantNameSnapshot: 'Second guest 60' }),
    segment({ id: '33', participantIndex: 1, sequence: 2, serviceNameSnapshot: 'Repeated Body', variantNameSnapshot: 'Next segment 30', durationMin: 30 }),
    segment({ id: '32', participantIndex: 1, sequence: 1, serviceNameSnapshot: 'Repeated Body', variantNameSnapshot: 'First segment 60' }),
  ];
  const original = structuredClone(items);
  const summary = reception.bookingServiceSummary({ items, service: { name: 'Renamed live catalog' } });
  assert.equal(occurrenceCount(summary, 'Repeated Body'), 3, 'same names cannot collapse distinct participants or itinerary segments');
  assert.ok(summary.indexOf('First segment 60') < summary.indexOf('Next segment 30'));
  assert.ok(summary.indexOf('Next segment 30') < summary.indexOf('Second guest 60'));
  assert.doesNotMatch(summary, /Renamed live catalog/);
  assert.deepEqual(items, original, 'displaying a sorted summary must not reorder saved items');
});

test('missing historical names stay visibly missing instead of borrowing current catalog names', () => {
  const item = segment({ serviceNameSnapshot: '', variantNameSnapshot: null, service: { name: 'Current item name' } });
  assert.equal(reception.bookingItemServiceLabel(item), '历史项目名称未记录');
  const summary = reception.bookingServiceSummary({ items: [item], service: { name: 'Current booking name' } });
  assert.match(summary, /历史项目名称未记录/);
  assert.doesNotMatch(summary, /Current/);
  const label = reception.bookingItemServiceLabel(segment());
  assert.match(label, /Original Body/); assert.match(label, /Saved 60/);
});

test('only legacy bookings without saved items fall back to the current service label', () => {
  for (const booking of [{ service: { name: 'Legacy service' } }, { items: [], service: { name: 'Legacy service' } }]) {
    assert.match(reception.bookingServiceSummary(booking), /Legacy service/);
  }
  const mapped = merchantApi.mapBooking({ id: '42', shopId: '2', durationMin: 60, service: { name: 'Legacy service' } });
  assert.match(mapped.service, /Legacy service/);
});

test('merchant mapping uses the saved service and variant even after live catalog rename or reprice', () => {
  const raw = { id: '42', shopId: '2', durationMin: 60, priceCents: 8000, totalCents: 8100, tipCents: 100, service: { name: 'New catalog name', priceCents: 999999 }, items: [segment()] };
  const mapped = merchantApi.mapBooking(raw);
  assert.match(mapped.service, /Original Body/); assert.match(mapped.service, /Saved 60/);
  assert.doesNotMatch(mapped.service, /New catalog name/);
  assert.equal(mapped.priceCents, 8000); assert.equal(mapped.totalCents, 8100); assert.equal(mapped.tipCents, 100);
});

test('merchant rows use the stored booking contact while preserving account identity separately', () => {
  const contact = { recorded: true, version: 1, source: 'ONLINE_VERIFIED', name: 'Original guest', phone: '+442079460100', email: 'original@example.test' };
  const raw = { id: '42', shopId: '2', durationMin: 60, contact, user: { id: '9', name: 'Changed account', phone: '+12025550199' }, reception: { customer: { name: 'Changed again', phone: '+12025550101' } } };
  const before = structuredClone(raw), mapped = merchantApi.mapBooking(raw);
  assert.equal(mapped.customerName, 'Original guest'); assert.equal(mapped.customerPhone, '+442079460100');
  assert.deepEqual(mapped.contact, contact); assert.deepEqual(raw, before);
});

test('four-hands resources retain allocation order and match names only to their actual IDs', () => {
  const result = reception.bookingItemResources({ assignedTherapistIds: ['72', '71', '72'], assignedTherapistId: '99', assignedRoomId: '81' }, allocationNames);
  assert.deepEqual(result, {
    therapists: [{ id: '72', name: 'Second therapist', label: 'Second therapist (#72)' }, { id: '71', name: 'First therapist', label: 'First therapist (#71)' }],
    room: { id: '81', name: 'Quiet room', label: 'Quiet room (#81)' },
  });
  assert.doesNotMatch(JSON.stringify(result), /Unassigned/);
});

test('large allocation IDs stay exact and an absent name falls back to its own ID', () => {
  const assigned = '9007199254740993', neighbor = '9007199254740992';
  const result = reception.bookingItemResources({ assignedTherapistIds: [assigned, '73'], assignedRoomId: '82' }, {
    therapists: [{ id: neighbor, name: 'Wrong adjacent ID' }, { id: assigned, name: 'Exact therapist' }], rooms: [{ id: '83', name: 'Wrong room' }],
  });
  assert.deepEqual(result.therapists, [{ id: assigned, name: 'Exact therapist', label: `Exact therapist (#${assigned})` }, { id: '73', name: null, label: '#73' }]);
  assert.deepEqual(result.room, { id: '82', name: null, label: '#82' });
});

test('an explicit empty allocation stays empty, while absent arrays use the saved single assignment', () => {
  const empty = reception.bookingItemResources({ assignedTherapistIds: [], assignedTherapistId: '71', therapistId: '72' }, allocationNames);
  assert.deepEqual(empty.therapists, []);
  assert.equal(empty.room, null);
  assert.deepEqual(reception.bookingItemResources({ assignedTherapistId: '71', therapistId: '72' }, allocationNames).therapists.map(row => row.id), ['71']);
  assert.deepEqual(reception.bookingItemResources({ therapistId: '72' }, allocationNames).therapists.map(row => row.id), ['72']);
});

test('legacy resource labels never substitute the live therapist object for the actual saved assignment', () => {
  const booking = { therapistId: '71', therapist: { id: '99', name: 'Misleading live therapist' }, reception: allocationNames };
  const result = reception.bookingLegacyResources(booking);
  assert.deepEqual(result.therapists, [{ id: '71', name: 'First therapist', label: 'First therapist (#71)' }]);
  assert.deepEqual(reception.bookingLegacyResources({ therapistId: '71', therapist: { id: '71', name: 'Unverified live label' } }).therapists, [{ id: '71', name: null, label: '#71' }]);
  assert.deepEqual(reception.bookingLegacyResources({ therapist: { id: '71', name: 'No saved assignment' }, reception: allocationNames }).therapists, []);
});

test('customer contact retains the original display text and generates only a normalized telephone link', () => {
  const contact = reception.bookingReceptionCustomer(allocationNames);
  assert.deepEqual(contact, { name: 'Booked customer', phone: '+1 (212) 555-0199', phoneHref: 'tel:+12125550199' });
  assert.equal(reception.bookingReceptionCustomer({ customer: { name: 'Other customer', phone: '020 7946 0958' } }).phoneHref, 'tel:02079460958');
});

test('malformed or unavailable phone values cannot become actionable links', () => {
  for (const phone of ['javascript:alert(1)', '+1 212 555 0199 ext 42', '123456', '1234567890123456', '+1\n2125550199', '<2125550199>', null, undefined, 12125550199]) {
    const contact = reception.bookingReceptionCustomer({ customer: { name: 'Known customer', phone } });
    assert.equal(contact.phoneHref, null, `unsafe or ambiguous phone: ${String(phone)}`);
  }
  const missing = reception.bookingReceptionCustomer({ customer: null, therapists: [], rooms: [] });
  assert.equal(typeof missing.name, 'string'); assert.ok(missing.name.length > 0);
  assert.equal(missing.phone, null); assert.equal(missing.phoneHref, null);
});

test('shop-checked detail GET preserves reception metadata and frozen values without extra catalog or customer requests', async () => {
  const previousAdapter = client.defaults.adapter;
  const calls = [];
  const item = segment({ assignedTherapistIds: ['71', '72'], assignedRoomId: '81' });
  let raw = { id: '42', shopId: '2', durationMin: 60, currency: 'usd', priceCents: 8000, totalCents: 8100, tipCents: 100,
    service: { name: 'Changed live name', priceCents: 999999 }, items: [item], reception: allocationNames };
  client.defaults.adapter = async config => {
    calls.push({ method: config.method, url: config.url, body: config.data });
    return { config, data: raw, headers: {}, status: 200, statusText: 'OK' };
  };
  try {
    const detail = await bookingApi.getBooking('42', '2');
    assert.deepEqual(detail.reception, allocationNames);
    assert.match(detail.service, /Original Body/); assert.match(detail.service, /Saved 60/); assert.doesNotMatch(detail.service, /Changed live name/);
    assert.equal(detail.items[0].priceCentsSnapshot, 8000); assert.equal(detail.items[0].durationMin, 60); assert.equal(detail.tipCents, 100);
    assert.deepEqual(reception.bookingItemResources(detail.items[0], detail.reception).therapists.map(row => row.name), ['First therapist', 'Second therapist']);
    assert.deepEqual(calls, [{ method: 'get', url: '/bookings/42', body: undefined }]);
    raw = { ...raw, shopId: '3' };
    await assert.rejects(bookingApi.getBooking('42', '2'), /不属于当前门店/);
    assert.equal(calls.length, 2, 'a foreign-shop response must fail rather than trigger a fallback lookup');
  } finally { client.defaults.adapter = previousAdapter; }
});
