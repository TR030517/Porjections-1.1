import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getReservationConfig, removeReservationResource, saveReservationResource, updateReservationPolicy, updateTherapistScheduleMode } from './reservations';
import { canAccessView } from '../permission';
import { Role } from '../utils/roleEnum';
import { hasShopPermission } from '../../merchant-web/src/utils/shopPermissions';
import { getShopBookingSettings, updateShopBookingSettings } from './reservations';

test('reservation config uses exact shop IDs, session transport and cancellation', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/reservation-admin/shops/9007199254740993/config');
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.signal?.aborted, false);
    return Response.json({ shopId: '9007199254740993', timezone: null, paymentPolicy: { payAtStoreEnabled: false }, services: [], therapists: [], rooms: [] });
  };
  try { assert.equal((await getReservationConfig('9007199254740993', controller.signal)).shopId, '9007199254740993'); }
  finally { globalThis.fetch = original; }
});
test('reservation configuration retains canonical opening periods for weekly readiness without deriving them from the device timezone', async () => {
  const original = globalThis.fetch;
  const hours = { monday: [{ open: '09:10', close: '12:00' }, { open: '13:00', close: '20:00' }], tuesday: { closed: true } };
  globalThis.fetch = async () => Response.json({ shopId: '5', timezone: 'America/Phoenix', businessHours: hours, paymentPolicy: { payAtStoreEnabled: true }, services: [], therapists: [], rooms: [] });
  try {
    const config = await getReservationConfig('5');
    assert.deepEqual(config.businessHours, hours); assert.equal(config.timezone, 'America/Phoenix');
  } finally { globalThis.fetch = original; }
});
test('CRUD and policy use dedicated endpoints and require acknowledged results', async () => {
  const original = globalThis.fetch;
  const requests: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options?.method ?? 'GET', body: options?.body ? JSON.parse(String(options.body)) : null });
    return Response.json(options?.method === 'DELETE' ? { success: true } : { item: { id: '8' } });
  };
  try {
    await saveReservationResource('2', 'variants', { name: 'actual' });
    await saveReservationResource('2', 'shifts', { isActive: false }, '8');
    await updateReservationPolicy('2', '8', { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE', priceBasis: 'PER_BOOKING', staffBufferMin: 10, roomBufferMin: 20 });
    await removeReservationResource('2', 'time-off', '8');
    assert.deepEqual(requests.map(item => [item.url, item.method]), [
      ['/api/v1/reservation-admin/shops/2/variants', 'POST'], ['/api/v1/reservation-admin/shops/2/shifts/8', 'PATCH'],
      ['/api/v1/reservation-admin/shops/2/services/8/policy', 'PATCH'], ['/api/v1/reservation-admin/shops/2/time-off/8', 'DELETE'],
    ]);
    assert.equal((requests[2].body as { priceBasis: string }).priceBasis, 'PER_BOOKING');
    globalThis.fetch = async () => Response.json({ success: false });
    await assert.rejects(removeReservationResource('2', 'rooms', '8'), /无法确认/);
    globalThis.fetch = async () => Response.json({ item: { id: 'other' } });
    await assert.rejects(saveReservationResource('2', 'rooms', {}, '8'), /无法确认/);
    globalThis.fetch = async () => Response.json({ message: '配置与已有占用冲突' }, { status: 409 });
    await assert.rejects(saveReservationResource('2', 'rooms', {}, '8'), /已有占用冲突/);
  } finally { globalThis.fetch = original; }
});
test('a mismatched config is rejected; platform is ADMIN-only and merchant access follows shop permission', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ shopId: 'other', services: [], therapists: [], rooms: [] });
  try { await assert.rejects(getReservationConfig('2'), /格式无效/); }
  finally { globalThis.fetch = original; }
  assert.equal(canAccessView(Role.SUPER_ADMIN, 'reservation-settings'), true);
  assert.equal(canAccessView(Role.STORE_MANAGER, 'reservation-settings'), false);
  assert.equal(canAccessView(Role.USER, 'reservation-settings'), false);
  assert.equal(hasShopPermission({ accessType: 'ASSOCIATED', isOwner: false, permissions: ['RESERVATION_CONFIG'] }, 'RESERVATION_CONFIG'), true);
  assert.equal(hasShopPermission({ accessType: 'STAFF', isOwner: false, permissions: ['BOOKINGS_READ'] }, 'RESERVATION_CONFIG'), false);
  assert.equal(hasShopPermission({ accessType: 'ASSOCIATED', isOwner: false, permissions: ['RESERVATION_CONFIG'] }, 'OWNER_ONLY'), false);
});


test('schedule mode changes are fixed to the requested shop and therapist and verify the receipt', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/reservation-admin/shops/9007199254740993/therapists/8/schedule');
    assert.equal(options?.method, 'PATCH'); assert.deepEqual(JSON.parse(String(options?.body)), { scheduleMode: 'SHOP' });
    return Response.json({ item: { id: '8', scheduleMode: 'SHOP' } });
  };
  try {
    await updateTherapistScheduleMode('9007199254740993', '8', 'SHOP');
    globalThis.fetch = async () => Response.json({ item: { id: '9', scheduleMode: 'SHOP' } });
    await assert.rejects(updateTherapistScheduleMode('9007199254740993', '8', 'SHOP'), /无法确认/);
    globalThis.fetch = async () => Response.json({ item: { id: '8', scheduleMode: 'CUSTOM' } });
    await assert.rejects(updateTherapistScheduleMode('9007199254740993', '8', 'SHOP'), /无法确认/);
  } finally { globalThis.fetch = original; }
});

test('booking rules round-trip server ordering without changing notice minutes, and reject invalid/overlapping dates before PATCH', async () => {
  const revision='a'.repeat(64);
  const original = globalThis.fetch;
  const requests: unknown[] = [];
  const settings = { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2026-12-31', endDate: '2027-01-02' }, { startDate: '2026-11-11', endDate: '2026-11-20' }] };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/reservation-admin/shops/5/booking-settings');
    const normalized = { ...settings, closedPeriods: [...settings.closedPeriods].reverse() };
    if (options?.method === 'PATCH') { const body = JSON.parse(String(options.body)); requests.push(body); assert.deepEqual(body, { ...normalized, expectedSettingsHash: revision }); return Response.json({ item: { shopId: '5', bookingSettings: normalized, bookingSettingsHash: revision } }); }
    return Response.json({ shopId: '5', bookingSettings: normalized, bookingSettingsHash: revision });
  };
  try {
    const { bookingSettings: saved } = await updateShopBookingSettings('5', settings, revision);
    assert.deepEqual(await getShopBookingSettings('5'), saved);
    for (const bad of [
      { ...settings, minimumNoticeMinutes: -1 },
      { ...settings, closedPeriods: [{ startDate: '2026-02-30', endDate: '2026-03-01' }] },
      { ...settings, closedPeriods: [settings.closedPeriods[0], settings.closedPeriods[0]] },
    ]) await assert.rejects(updateShopBookingSettings('5', bad, revision));
    await assert.rejects(updateShopBookingSettings('5', settings, ''), /版本/);
    assert.equal(requests.length, 1, 'invalid local edits must not submit or overwrite stored rules');
    globalThis.fetch = async () => Response.json({ shopId: '5', bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [{ startDate: 'invalid', endDate: '2026-11-11' }] } });
    await assert.rejects(getShopBookingSettings('5'), /闭店/);
    globalThis.fetch = async () => Response.json({ item: { shopId: '5', bookingSettings: { ...saved, minimumNoticeMinutes: 12 } } });
    await assert.rejects(updateShopBookingSettings('5', settings, revision), /无法确认/);
  } finally { globalThis.fetch = original; }
});
