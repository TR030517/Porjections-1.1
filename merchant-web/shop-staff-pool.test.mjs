import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, api, configApi, client, TechnicianCoverage, bookingSetupIssues, bookingSetupEntry;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('./', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  api = await server.ssrLoadModule('/src/api/merchant.ts');
  configApi = await server.ssrLoadModule('/src/api/reservations.ts');
  client = (await server.ssrLoadModule('/src/api/client.ts')).default;
  ({ TechnicianCoverage } = await server.ssrLoadModule('/src/pages/technicians/index.tsx'));
  ({ bookingSetupEntry } = await server.ssrLoadModule('/src/utils/bookingSetupEntry.ts'));
  const shared = '/@fs/' + fileURLToPath(new URL('../src/utils/bookingSetup.ts', import.meta.url)).replaceAll('\\', '/');
  ({ bookingSetupIssues } = await server.ssrLoadModule(shared));
});
after(async () => { await server?.close(); });

const shopId = '9007199254740997', techId = '9007199254740999';
const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} });

test('technician create and edit write only staff fields even when an old caller carries service links', async () => {
  const previousAdapter = client.defaults.adapter, calls = [];
  const draft = { name: 'Shop team member', title: 'Therapist', bio: 'Saved bio', avatarUrl: '', yearsExp: 8, gender: null, serviceIds: ['9007199254741001', '99'] };
  const before = structuredClone(draft);
  client.defaults.adapter = async config => {
    const body = JSON.parse(config.data);
    calls.push({ method: config.method, url: config.url, body });
    return response(config, { id: techId, shopId, ...body, serviceIds: [], isActive: body.isActive ?? true });
  };
  try {
    const created = await api.createTechnician(shopId, draft);
    const edited = await api.updateTechnician(techId, { name: 'Edited member', isActive: false, serviceIds: [] });
    assert.equal(created.id, techId); assert.equal(edited.id, techId); assert.equal(edited.isActive, false);
    assert.deepEqual(calls, [
      { method: 'post', url: `/merchant/shops/${shopId}/therapists`, body: { name: 'Shop team member', title: 'Therapist', bio: 'Saved bio', avatarUrl: '', yearsExp: 8, gender: null } },
      { method: 'patch', url: `/merchant/therapists/${techId}`, body: { name: 'Edited member', isActive: false } },
    ]);
    assert.deepEqual(draft, before, 'response-only cleanup cannot alter the unsaved staff draft');
  } finally { client.defaults.adapter = previousAdapter; }
});

test('legacy sparse links remain readable without losing exact shop scope or abort signals', async () => {
  const previousAdapter = client.defaults.adapter, calls = [], controller = new AbortController();
  let foreign = false;
  client.defaults.adapter = async config => {
    calls.push(config);
    return response(config, [{ id: techId, shopId: foreign ? '99' : shopId, name: 'Whole-shop member', serviceIds: [], isActive: true }]);
  };
  try {
    const [technician] = await api.getShopTherapists(shopId, controller.signal);
    assert.equal(technician.id, techId); assert.equal(technician.isActive, true); assert.deepEqual(technician.serviceIds, []);
    assert.equal(calls[0].url, `/merchant/shops/${shopId}/therapists`); assert.equal(calls[0].signal, controller.signal);
    foreign = true;
    await assert.rejects(api.getShopTherapists(shopId), /无法核对保存结果/);
    assert.equal(calls.length, 2, 'a mismatched shop response cannot trigger another shop or service lookup');
  } finally { client.defaults.adapter = previousAdapter; }
});

test('mismatched create and edit receipts remain errors instead of an apparent staff save success', async () => {
  const previousAdapter = client.defaults.adapter, calls = [];
  let wrongId = false;
  client.defaults.adapter = async config => {
    calls.push(config);
    return response(config, wrongId ? { id: '81', shopId } : { id: techId, shopId: '99' });
  };
  try {
    await assert.rejects(api.createTechnician(shopId, { name: 'Unsaved member' }), /保留草稿/);
    wrongId = true;
    await assert.rejects(api.updateTechnician(techId, { name: 'Edited member' }), /保留草稿/);
    assert.equal(calls.length, 2, 'an unknown receipt does not retry or create a compensating staff write');
  } finally { client.defaults.adapter = previousAdapter; }
});

test('merchant coverage display describes the whole shop and never presents inactive staff as available', () => {
  const active = renderToStaticMarkup(createElement(TechnicianCoverage, { isActive: true }));
  assert.match(active, /本店全部项目/); assert.match(active, /新增项目/); assert.doesNotMatch(active, /尚未分配|资格|关联/);
  const inactive = renderToStaticMarkup(createElement(TechnicianCoverage, { isActive: false }));
  assert.match(inactive, /已停用/); assert.match(inactive, /暂不接待预约/);
});

test('a newly added four-hands service uses the existing active shop team despite sparse legacy links', async () => {
  const previousAdapter = client.defaults.adapter, calls = [];
  const service = { id: '8', shopId, name: 'Existing service', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 10000,
    priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 2, requiredRoomType: null, staffBufferMin: 15, roomBufferMin: 0, variants: [] };
  const raw = { shopId, timezone: 'America/New_York', businessHours: { monday: { open: '09:00', close: '18:00' } }, paymentPolicy: { payAtStoreEnabled: false },
    services: [service, { ...service, id: '9', name: 'New four-hands service' }], therapists: [
      { id: techId, shopId, name: 'First member', isActive: true, serviceIds: [], scheduleMode: 'SHOP', shifts: [], timeOff: [] },
      { id: '9007199254741000', shopId, name: 'Second member', isActive: true, serviceIds: ['8'], scheduleMode: 'SHOP', shifts: [], timeOff: [] },
    ], rooms: [] };
  client.defaults.adapter = async config => { calls.push({ method: config.method, url: config.url, body: config.data }); return response(config, raw); };
  try {
    const config = await configApi.getReservationConfig(shopId);
    assert.deepEqual(bookingSetupIssues(config, ['9']), [], 'new services do not require writing qualification links to each existing technician');
    const oneMember = { ...config, therapists: config.therapists.map((row, index) => index ? { ...row, isActive: false } : row) };
    assert.ok(bookingSetupIssues(oneMember, ['9']).some(row => row.kind === 'staff'), 'four-hands still needs two distinct active shop members');
    assert.deepEqual(config.therapists.map(row => row.serviceIds), [[], ['8']], 'readiness must not fill or save legacy associations');
    assert.deepEqual(calls, [{ method: 'get', url: `/reservation-admin/shops/${shopId}/config`, body: undefined }]);
  } finally { client.defaults.adapter = previousAdapter; }
});

test('staff shortage repair keeps its catalog permission and exact shop while an unknown schedule target does not select another person', () => {
  const issue = { key: 'staff-shortage', serviceId: '9', serviceName: 'New service', kind: 'staff', message: 'Shop team is short', action: '编辑技师' };
  const entry = bookingSetupEntry(shopId, issue), url = new URL(entry.href, 'http://local.invalid');
  assert.equal(entry.permission, 'CATALOG_MANAGE'); assert.equal(url.pathname, '/technicians'); assert.equal(url.searchParams.get('shopId'), shopId);
  assert.equal(url.searchParams.has('serviceId'), false, 'team editing is not a per-service qualification form');
  const missing = bookingSetupEntry(shopId, { ...issue, kind: 'schedule' });
  assert.equal(missing.permission, 'RESERVATION_CONFIG'); assert.equal(missing.href, undefined); assert.match(missing.message, /不会自动打开其他技师/);
});
