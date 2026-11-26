import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const server = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const values = { name: 'Fixed service option', durationMin: 30, priceUsd: 100.25, sortOrder: 0, isActive: true };
test('new options default to a whole-booking price; per-booking edits never linearly scale fixed prices', async () => {
  const vite = await server();
  try {
    const { variantPayload, serviceTotal } = await vite.ssrLoadModule('/src/utils/reservationPricing.ts');
    assert.deepEqual(variantPayload(values, '9007199254740993'), { serviceId: '9007199254740993', name: values.name, durationMin: 30, priceCents: 10025, sortOrder: 0, isActive: true, priceBasis: 'PER_BOOKING', currency: 'usd' });
    const longer = variantPayload({ ...values, durationMin: 240, priceBasis: 'PER_BOOKING' });
    assert.equal(longer.priceBasis, 'PER_BOOKING'); assert.equal(longer.priceCents, 10025); assert.equal(longer.durationMin, 240);
    assert.equal(Object.hasOwn(longer, 'serviceId'), false);
    assert.equal(serviceTotal(10025, 2, 'PER_BOOKING'), 10025); assert.equal(serviceTotal(10025, 2, 'PER_PERSON'), 10025);
    assert.equal(variantPayload({ ...values, priceBasis: 'PER_PERSON' }).priceBasis, 'PER_BOOKING');
    for (const durationMin of [5,15,29,240]) assert.equal(variantPayload({ ...values, durationMin }).durationMin, durationMin);
    for (const durationMin of [0,4,241,15.5]) assert.throws(() => variantPayload({ ...values, durationMin }), /整数/);
  } finally { await vite.close(); }
});
test('service policy sends explicit basis and resource rules; unsupported bases and fractional amounts fail', async () => {
  const vite = await server();
  try {
    const { policyPayload, variantPayload } = await vite.ssrLoadModule('/src/utils/reservationPricing.ts');
    assert.deepEqual(policyPayload({ participantCount: 2, requiredRoomType: 'COUPLE', staffBufferMin: 10, roomBufferMin: 20, priceBasis: 'PER_BOOKING' }), { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE', staffBufferMin: 10, roomBufferMin: 20 });
    for (const priceBasis of ['HOURLY', 'per_booking', '', null, true]) assert.throws(() => variantPayload({ ...values, priceBasis }), /按人或按单计价/);
    for (const priceUsd of [0, -1, 100.251, '100.25', 100000.01]) assert.throws(() => variantPayload({ ...values, priceUsd }), /美元|小数/);
  } finally { await vite.close(); }
});
test('merchant transport persists the selected independent option and service price basis through real dedicated paths', async () => {
  const requests = [];
  axios.defaults.adapter = async config => {
    requests.push({ url: config.url, method: config.method, body: JSON.parse(config.data) });
    return { config, data: { item: { id: '8' } }, status: 200, statusText: 'OK', headers: {} };
  };
  const vite = await server();
  try {
    const api = await vite.ssrLoadModule('/src/api/reservations.ts');
    const { policyPayload, variantPayload } = await vite.ssrLoadModule('/src/utils/reservationPricing.ts');
    await api.saveResource('2', 'variants', variantPayload({ ...values, priceBasis: 'PER_BOOKING' }), '8');
    await api.savePolicy('2', '8', policyPayload({ participantCount: 1, staffBufferMin: 0, roomBufferMin: 0, priceBasis: 'PER_PERSON' }));
    assert.deepEqual(requests.map(request => [request.url, request.method, request.body.priceBasis]), [['/reservation-admin/shops/2/variants/8', 'patch', 'PER_BOOKING'], ['/reservation-admin/shops/2/services/8/policy', 'patch', undefined]]);
    assert.equal(requests[0].body.priceCents, 10025); assert.equal(Object.hasOwn(requests[0].body, 'serviceId'), false);
  } finally { await vite.close(); }
});


test('four-hands keeps one customer and two technicians with a whole-booking default', async () => {
  const vite = await server();
  try {
    const { policyPayload } = await vite.ssrLoadModule('/src/utils/reservationPricing.ts');
    assert.deepEqual(policyPayload({ participantCount: 1, requiredStaffCount: 2, requiredRoomType: 'SINGLE', staffBufferMin: 0, roomBufferMin: 0 }), { participantCount: 1, requiredStaffCount: 2, requiredRoomType: 'SINGLE', staffBufferMin: 0, roomBufferMin: 0 });
    assert.throws(() => policyPayload({ participantCount: 2, requiredStaffCount: 1, staffBufferMin: 0, roomBufferMin: 0 }), /两位/);
  } finally { await vite.close(); }
});

test('couples default to two technicians without a room and preserve explicit compatible room binding', async () => {
  const vite = await server();
  try {
    const { policyPayload } = await vite.ssrLoadModule('/src/utils/reservationPricing.ts');
    const values = { participantCount: 2, requiredStaffCount: 2, staffBufferMin: 0, roomBufferMin: 0 };
    for (const requiredRoomType of ['', null, undefined]) assert.deepEqual(policyPayload({ ...values, requiredRoomType }), { ...values, requiredRoomType: null });
    assert.equal(policyPayload({ ...values, requiredRoomType: 'COUPLE' }).requiredRoomType, 'COUPLE');
    for (const requiredRoomType of ['SINGLE', 'FOOT_SEAT']) assert.throws(() => policyPayload({ ...values, requiredRoomType }), /双人房间/);
    assert.throws(() => policyPayload({ ...values, requiredStaffCount: 1 }), /两位/);
  } finally { await vite.close(); }
});

test('schedule mode writes only the requested therapist in the requested shop and validates the returned mode', async () => {
  const requests = [];
  axios.defaults.adapter = async config => {
    requests.push({ url: config.url, method: config.method, body: JSON.parse(config.data) });
    return { config, data: { item: { id: '8', scheduleMode: 'SHOP' } }, status: 200, statusText: 'OK', headers: {} };
  };
  const vite = await server();
  try {
    const api = await vite.ssrLoadModule('/src/api/reservations.ts');
    await api.saveTherapistScheduleMode('2', '8', 'SHOP');
    assert.deepEqual(requests, [{ url: '/reservation-admin/shops/2/therapists/8/schedule', method: 'patch', body: { scheduleMode: 'SHOP' } }]);
    await assert.rejects(api.saveTherapistScheduleMode('2', '8', 'CUSTOM'), /尚未确认/);
  } finally { await vite.close(); }
});

test('variant dollar amounts survive create/edit transport and reopen without scaling or rounding', async () => {
  const vite = await server();
  try {
    const { variantPayload, variantPriceDraft, serviceTotal } = await vite.ssrLoadModule('/src/utils/reservationPricing.ts');
    const api = await vite.ssrLoadModule('/src/api/reservations.ts');
    const { default: client } = await vite.ssrLoadModule('/src/api/client.ts');
    const previous = client.defaults.adapter, writes = [];
    client.defaults.adapter = async config => {
      const body = JSON.parse(config.data); writes.push(body);
      return { config, data: { item: { id: '8', ...body } }, status: 200, statusText: 'OK', headers: {} };
    };
    try {
      for (const [priceUsd, cents] of [[0.01, 1], [0.29, 29], [40, 4000], [100.25, 10025], [100000, 10000000]]) {
        await api.saveResource('2', 'variants', variantPayload({ ...values, priceUsd }, '5'));
        const readback = writes.at(-1); assert.equal(readback.priceCents, cents); assert.equal(Object.hasOwn(readback, 'priceUsd'), false);
        const edited = variantPayload({ ...values, priceUsd: variantPriceDraft(readback.priceCents), durationMin: 240 });
        await api.saveResource('2', 'variants', edited, '8');
        assert.equal(writes.at(-1).priceCents, cents); assert.equal(Object.hasOwn(writes.at(-1), 'serviceId'), false);
        assert.equal(serviceTotal(writes.at(-1).priceCents, 2, 'PER_BOOKING'), cents);
      }
      for (const priceUsd of [-0.01, 0, 0.001, 40.001, 100000.01, NaN, Infinity, null]) assert.throws(() => variantPayload({ ...values, priceUsd }));
      assert.throws(() => variantPayload({ ...values, priceUsd: undefined, priceCents: 10025 }));
    } finally { client.defaults.adapter = previous; }
  } finally { await vite.close(); }
});
