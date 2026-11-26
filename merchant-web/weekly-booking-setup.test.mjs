import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const serverOptions = { server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' };
const shopId = '9007199254740993', therapistId = '9007199254740995';
const issue = patch => ({ key: 'sample', serviceId: '7', serviceName: 'Body', kind: 'schedule', message: '', action: '', ...patch });

test('weekly readiness actions open the named therapist and actual hours editor under their own reservation permission', async () => {
  const server = await createServer(serverOptions);
  try {
    const { bookingSetupEntry } = await server.ssrLoadModule('/src/utils/bookingSetupEntry.ts');
    const entry = bookingSetupEntry(shopId, issue({ therapistId }));
    assert.equal(entry.permission, 'RESERVATION_CONFIG');
    const url = new URL(entry.href, 'http://local.invalid');
    assert.equal(url.pathname, '/reservations'); assert.equal(url.searchParams.get('shopId'), shopId);
    assert.equal(url.searchParams.get('therapistId'), therapistId); assert.equal(url.searchParams.get('tab'), 'therapists');
    const hours = bookingSetupEntry(shopId, issue({ key: 'weekly-hours', kind: 'hours' }));
    assert.equal(hours.permission, 'RESERVATION_CONFIG');
    assert.equal(new URL(hours.href, 'http://local.invalid').searchParams.get('tab'), 'hours');
    assert.equal(bookingSetupEntry(shopId, issue({ kind: 'staff' })).permission, 'CATALOG_MANAGE');
    for (const missing of [issue({}), issue({ therapistId: '9223372036854775808' }), issue({ key: 'timezone', kind: 'hours' })]) {
      const blocked = bookingSetupEntry(shopId, missing); assert.equal(blocked.href, undefined); assert.ok(blocked.message);
    }
    for (const kind of ['timezone', 'hours']) {
      const timezone = bookingSetupEntry(shopId, issue({ key: 'timezone', kind }));
      assert.match(timezone.message, /门店基本资料/); assert.doesNotMatch(timezone.message, /营业设置|关联主项目/);
      assert.equal(timezone.href, undefined);
    }
  } finally { await server.close(); }
});

test('merchant weekly guidance receives canonical hours and buffers through its existing shop-scoped GET', async () => {
  const server = await createServer(serverOptions);
  const raw = { shopId, timezone: 'America/New_York', businessHours: { monday: { open: '09:00', close: '10:00' } }, paymentPolicy: { payAtStoreEnabled: true },
    services: [{ id: '7', name: 'Body', durationKind: 'TIMED', durationMin: 60, priceCents: 8000, isActive: true, participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 15, roomBufferMin: 0, variants: [] }],
    therapists: [{ id: therapistId, name: 'Scoped therapist', isActive: true, serviceIds: ['7'], scheduleMode: 'SHOP', shifts: [] }], rooms: [] };
  const calls = [];
  axios.defaults.adapter = async config => { calls.push({ method: config.method, url: config.url, body: config.data }); return { config, data: raw, headers: {}, status: 200, statusText: 'OK' }; };
  try {
    const { getReservationConfig } = await server.ssrLoadModule('/src/api/reservations.ts');
    const shared = '/@fs/' + fileURLToPath(new URL('../src/utils/bookingSetup.ts', import.meta.url)).replaceAll('\\', '/');
    const { bookingSetupIssues } = await server.ssrLoadModule(shared);
    const loaded = await getReservationConfig(shopId);
    assert.deepEqual(loaded.businessHours, raw.businessHours);
    const findings = bookingSetupIssues(loaded, ['7']);
    assert.ok(findings.some(row => row.kind === 'schedule'), '60 minutes plus 15-minute SHOP cleanup cannot fit a one-hour opening');
    assert.deepEqual(calls, [{ method: 'get', url: `/reservation-admin/shops/${shopId}/config`, body: undefined }]);
  } finally { await server.close(); }
});
