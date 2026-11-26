import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let vite, draft, api, configApi, duration, copy, client;
const sharedModule = relative => '/@fs/' + fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/');
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  draft = await vite.ssrLoadModule('/src/utils/serviceMenuDraft.ts');
  api = await vite.ssrLoadModule('/src/api/merchant.ts');
  configApi = await vite.ssrLoadModule('/src/api/reservations.ts');
  duration = await vite.ssrLoadModule(sharedModule('../src/utils/serviceDuration.ts'));
  copy = await vite.ssrLoadModule('/src/api/accountAccess.ts');
  client = (await vite.ssrLoadModule('/src/api/client.ts')).default;
});
after(async () => { await vite?.close(); });
const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} });

test('session and variable display items reuse explicit cents while reservation block and category stay manual', () => {
  for (const kind of ['PER_SESSION', 'VARIABLE']) {
    const item = { name: 'Complete manually checked title', priceText: '', description: 'Original note', pricing: { kind, baseName: 'Original base', durationMin: null, priceCents: 8100, titleMode: 'CUSTOM' } };
    const original = structuredClone(item), result = draft.serviceDraftFromMenu([{ category: 'MASSAGE', items: [item] }], 0, 0);
    assert.deepEqual(result, { name: item.name, description: item.description, durationKind: kind, category: undefined, durationMin: null, price: 81, isActive: false });
    assert.throws(() => draft.serviceSavePayload(result, 'MENU'), /分类/);
    assert.throws(() => draft.serviceSavePayload({ ...result, category: 'OTHER' }, 'MENU'), /预留时间/);
    assert.throws(() => draft.serviceSavePayload({ ...result, category: 'OTHER', durationMin: 120, price: null }, 'MENU'), /价格/);
    const payload = draft.serviceSavePayload({ ...result, category: 'OTHER', durationMin: 240, price: 90.25, reservedDurationMin: 1 }, 'MENU');
    assert.equal(payload.durationKind, kind); assert.equal(payload.priceCents, 9025); assert.equal(payload.durationMin, 240); assert.equal(payload.isActive, false);
    assert.equal(Object.hasOwn(payload, 'reservedDurationMin'), false); assert.deepEqual(item, original);
  }
});

test('manual booking drafts reject explicit invalid types and never treat ADD_ON as an independent service', () => {
  const values = { name: 'Checked service', description: '', category: 'OTHER', durationMin: 60, price: 80 };
  for (const durationKind of [null, 'ADD_ON', 'MIXED', '', true]) assert.throws(() => draft.serviceSavePayload({ ...values, durationKind }, 'NEW'), /类型/);
  const item = { name: 'Dependent extra', priceText: '', pricing: { kind: 'ADD_ON', baseName: 'Oil', durationMin: null, priceCents: 1000, titleMode: 'CUSTOM' } };
  assert.throws(() => draft.serviceDraftFromMenu([{ category: 'Extras', items: [item] }], 0, 0), /不能独立/);
});

test('one disabled create sends manual session terms and rejects a mismatched or contradictory receipt without issuing a patch', async () => {
  const old = client.defaults.adapter, calls = [], payload = { name: 'Synthetic session', category: 'OTHER', durationKind: 'PER_SESSION', durationMin: 90, priceCents: 8000, isActive: false };
  let mismatch = false, alias = 90;
  client.defaults.adapter = async config => {
    calls.push({ method: config.method, url: config.url, body: JSON.parse(config.data) });
    return response(config, { ...payload, id: '51', shopId: '5', durationKind: mismatch ? 'TIMED' : 'PER_SESSION', reservedDurationMin: alias });
  };
  try {
    const saved = await api.createService('5', payload); draft.assertMenuServiceReceipt(saved, '5', 'PER_SESSION');
    assert.deepEqual(calls[0], { method: 'post', url: '/merchant/shops/5/services', body: payload });
    mismatch = true; await assert.rejects(api.createService('5', payload), /无法核对/);
    mismatch = false; alias = 60; await assert.rejects(api.createService('5', payload), /不一致/);
    assert.equal(calls.length, 3); assert.ok(calls.every(call => call.method === 'post'));
  } finally { client.defaults.adapter = old; }
});

test('reservation config inherits parent kind per variant and rejects invalid aliases or an independent variant type', async () => {
  const old = client.defaults.adapter;
  let service = { id: '8', durationKind: 'VARIABLE', durationMin: 90, reservedDurationMin: 90, variants: [{ id: '9', durationMin: 120 }] };
  client.defaults.adapter = async config => response(config, { shopId: '5', businessHours: { monday: { open: '09:00', close: '22:00' } }, paymentPolicy: { payAtStoreEnabled: false }, services: [service], therapists: [], rooms: [] });
  try {
    const value = await configApi.getReservationConfig('5');
    assert.equal(value.services[0].variants[0].durationKind, 'VARIABLE'); assert.equal(value.services[0].variants[0].reservedDurationMin, 120);
    for (const patch of [{ durationKind: null }, { reservedDurationMin: 30 }, { variants: [{ durationMin: 120, durationKind: 'TIMED' }] }]) {
      const original = service; service = { ...service, ...patch }; await assert.rejects(configApi.getReservationConfig('5')); service = original;
    }
  } finally { client.defaults.adapter = old; }
});

test('merchant writes cannot send the read-only alias or a null/unknown kind', async () => {
  const old = client.defaults.adapter; let calls = 0;
  client.defaults.adapter = async () => { calls++; throw new Error('Unexpected transport'); };
  try {
    for (const patch of [{ reservedDurationMin: 60 }, { durationMinutes: 60 }, { durationKind: null }, { durationKind: 'MIXED' }, { durationMin: 241 }]) {
      await assert.rejects(api.createService('5', { name: 'Synthetic service', durationMin: 60, priceCents: 8000, ...patch }));
    }
    assert.equal(calls, 0);
  } finally { client.defaults.adapter = old; }
});

test('real booking adapter and shared SSR labels use frozen mixed/session snapshots instead of changed live service terms', async () => {
  const old = client.defaults.adapter;
  const raw = { id: '10', shopId: '5', durationKind: 'MIXED', durationMin: 120, reservedDurationMin: 120, priceCents: 9000, items: [
    { id: '21', participantIndex: 1, sequence: 1, durationMin: 60, durationKindSnapshot: 'PER_SESSION', service: { durationKind: 'TIMED' } },
    { id: '22', participantIndex: 1, sequence: 2, durationMin: 60, durationKindSnapshot: 'VARIABLE' },
  ], service: { name: 'Changed catalog', durationKind: 'TIMED' } };
  client.defaults.adapter = async config => response(config, raw);
  try {
    const bookings = await vite.ssrLoadModule('/src/api/bookings.ts');
    const { default: Label } = await vite.ssrLoadModule(sharedModule('../src/components/ServiceDurationLabel.tsx'));
    const saved = await bookings.getBooking('10', '5');
    assert.equal(saved.durationKind, 'MIXED'); assert.deepEqual(saved.items.map(item => item.durationKind), ['PER_SESSION', 'VARIABLE']);
    const html = renderToStaticMarkup(createElement(Label, { kind: saved.items[0].durationKind, minutes: saved.items[0].reservedDurationMin }));
    assert.match(html, /按次 · 预约预留 60 分钟/); assert.doesNotMatch(html, /固定服务/);
    raw.items[0].durationKind = 'TIMED'; await assert.rejects(bookings.getBooking('10', '5'), /快照不一致/);
  } finally { client.defaults.adapter = old; }
});

test('copy previews retain exact source and matched target kinds without accepting mixed parent metadata or extras', () => {
  const input = { sourceShopId: '5', targetShopId: '6', kind: 'ADD_ONS' }, row = { sourceId: '101', sourceServiceId: '8', sourceServiceName: 'Checked primary', sourceDurationKind: 'PER_SESSION', targetServiceId: '9', targetServiceName: 'Checked primary', targetDurationKind: 'PER_SESSION', name: 'Oil', description: null, priceCents: 1000, currency: 'usd', sortOrder: 0, sourceActive: true, action: 'CREATE', reasonCode: 'NEW', reason: 'New inactive row', private: 'never-project' };
  const preview = patch => ({ previewHash: 'safe-signed-preview', expiresAt: '2099-10-30T00:00:00Z', summary: 'Synthetic plan', changes: { addOns: [{ ...row, ...patch }] } });
  const value = copy.checkedCopyPreview(preview({}), input).changes.addOns[0];
  assert.equal(value.sourceDurationKind, 'PER_SESSION'); assert.equal(value.targetDurationKind, 'PER_SESSION'); assert.equal(Object.hasOwn(value, 'private'), false);
  for (const patch of [{ sourceDurationKind: null }, { sourceDurationKind: 'ADD_ON' }, { targetDurationKind: 'TIMED' }, { targetDurationKind: null }]) assert.throws(() => copy.checkedCopyPreview(preview(patch), input));
  const skipped = copy.checkedCopyPreview(preview({ action: 'SKIP', reasonCode: 'MAIN_NOT_FOUND', targetServiceId: null, targetServiceName: null, targetDurationKind: null }), input).changes.addOns[0];
  assert.equal(skipped.targetDurationKind, null);
  assert.throws(() => copy.checkedCopyPreview(preview({ ...skipped, targetDurationKind: 'PER_SESSION' }), input));
  const catalog = copy.checkedCopyPreview({ ...preview({}), changes: { services: [{ sourceId: '8', name: 'Synthetic session', durationKind: 'PER_SESSION', action: 'CREATE' }] } }, { ...input, kind: 'CATALOG' });
  assert.equal(catalog.changes.services[0].durationKind, 'PER_SESSION');
  assert.equal(duration.readServiceDurationKind(undefined), 'TIMED');
});
