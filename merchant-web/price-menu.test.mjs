import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const serverOptions = { server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' };
const shopId = '9007199254740997', targetId = '9007199254740999';
const priceMenu = [{ category: 'Massage', items: [{ name: 'Deep tissue', priceText: 'From $80 / 60 min' }] }];
const revision = 'a'.repeat(64);
const response = (config, data) => ({ config, data, headers: {}, status: 200, statusText: 'OK' });

test('independent menu saves include the read revision, patch only the selected shop menu and use [] as an explicit clear', async () => {
  const calls = [];
  axios.defaults.adapter = async config => {
    const body = JSON.parse(config.data); calls.push({ method: config.method, url: config.url, body });
    return response(config, { id: shopId, name: 'Synthetic shop', priceMenu: body.priceMenu, priceMenuRevision: revision });
  };
  const server = await createServer(serverOptions);
  try {
    const { updateShopProfile } = await server.ssrLoadModule('/src/api/merchant.ts');
    await updateShopProfile(shopId, { priceMenu, expectedPriceMenuRevision: revision }); await updateShopProfile(shopId, { priceMenu: [], expectedPriceMenuRevision: revision });
    assert.deepEqual(calls, [{ method: 'patch', url: `/merchant/shops/${shopId}`, body: { priceMenu, expectedPriceMenuRevision: revision } }, { method: 'patch', url: `/merchant/shops/${shopId}`, body: { priceMenu: [], expectedPriceMenuRevision: revision } }]);
    for (const call of calls) for (const field of ['address', 'phone', 'status', 'features', 'ownerId']) assert.equal(Object.hasOwn(call.body, field), false);
  } finally { await server.close(); }
});

test('unappended paste cannot be saved and snapshots reject missing revision or a different shop', async () => {
  const server = await createServer(serverOptions);
  try {
    const { priceMenuSavePayload, priceMenuSnapshot } = await server.ssrLoadModule('/src/utils/priceMenuDraft.ts');
    const original = structuredClone(priceMenu);
    assert.throws(() => priceMenuSavePayload(priceMenu, revision, 'Massage\tImported\t$50'), /粘贴内容尚未追加/);
    assert.throws(() => priceMenuSavePayload(priceMenu, revision, ' \n\t'), /粘贴内容尚未追加/);
    for (const bad of ['', 'old', 'a'.repeat(63)]) assert.throws(() => priceMenuSavePayload(priceMenu, bad, ''), /编辑版本/);
    assert.deepEqual(priceMenuSavePayload(priceMenu, revision, ''), { priceMenu, expectedPriceMenuRevision: revision });
    assert.deepEqual(priceMenuSavePayload([], revision, ''), { priceMenu: [], expectedPriceMenuRevision: revision });
    assert.throws(() => priceMenuSnapshot({ id: targetId, priceMenu, priceMenuRevision: revision }, shopId), /无法核对本店/);
    assert.throws(() => priceMenuSnapshot({ id: shopId, priceMenu }, shopId), /无法核对本店/);
    const snapshot = priceMenuSnapshot({ id: shopId, priceMenu, priceMenuRevision: revision }, shopId);
    snapshot.priceMenu[0].items[0].name = 'Changed locally';
    assert.deepEqual(priceMenu, original, 'loading/saving helpers do not mutate the cached shop or source draft');
  } finally { await server.close(); }
});

test('menu placement becomes known only after an authorized complete same-shop menu and revision were read', async () => {
  const server = await createServer(serverOptions);
  try {
    const { priceMenuReadAvailability } = await server.ssrLoadModule('/src/utils/priceMenuDraft.ts');
    const complete = { id: shopId, priceMenu, priceMenuRevision: revision }, before = structuredClone(complete);
    assert.deepEqual(priceMenuReadAvailability(complete, shopId, false), { status: 'unavailable', reason: 'permission' });
    assert.deepEqual(priceMenuReadAvailability({ id: shopId }, shopId, false), { status: 'unavailable', reason: 'permission' });
    for (const incomplete of [{ id: shopId }, { id: shopId, priceMenu }, { id: shopId, priceMenuRevision: revision }, { ...complete, id: targetId }, { ...complete, priceMenu: null }]) {
      assert.deepEqual(priceMenuReadAvailability(incomplete, shopId, true), { status: 'unavailable', reason: 'error' });
    }
    assert.deepEqual(priceMenuReadAvailability(complete, shopId, true), { status: 'known' });
    assert.deepEqual(priceMenuReadAvailability({ ...complete, priceMenu: [] }, shopId, true), { status: 'known' }, 'explicitly empty is different from unread');
    assert.deepEqual(complete, before);
  } finally { await server.close(); }
});

test('menu conflict is surfaced once without automatic retry or touching the draft baseline; ordinary settings omit menu', async () => {
  const calls = [];
  axios.defaults.adapter = async config => {
    const body = JSON.parse(config.data); calls.push(body);
    if (Object.hasOwn(body, 'priceMenu')) throw { response: { status: 409, data: { code: 'PRICE_MENU_CHANGED', message: '展示价目已更新，请保留草稿。' } }, config };
    return response(config, { id: shopId, name: body.name, priceMenu, priceMenuRevision: 'b'.repeat(64) });
  };
  const server = await createServer(serverOptions);
  try {
    const { updateShopProfile } = await server.ssrLoadModule('/src/api/merchant.ts');
    const { priceMenuSavePayload, isPriceMenuConflict } = await server.ssrLoadModule('/src/utils/priceMenuDraft.ts');
    const draft = structuredClone(priceMenu), baseline = revision;
    await assert.rejects(updateShopProfile(shopId, priceMenuSavePayload(draft, baseline, '')), error => isPriceMenuConflict(error));
    assert.equal(calls.length, 1); assert.deepEqual(draft, priceMenu); assert.equal(baseline, revision);
    const updated = await updateShopProfile(shopId, { name: 'Updated contact profile' });
    assert.deepEqual(calls[1], { name: 'Updated contact profile' });
    assert.equal(updated.priceMenuRevision, 'b'.repeat(64));
    assert.equal(isPriceMenuConflict({ response: { status: 409, data: { code: 'OTHER_CONFLICT' } } }), false);
  } finally { await server.close(); }
});

test('PRICE_MENU copy retains its own signed operation and history kind without becoming CATALOG', async () => {
  const calls = [], input = { sourceShopId: shopId, targetShopId: targetId, kind: 'PRICE_MENU' };
  const result = { ...input, status: 'APPLIED', operationId: 'd12400be-cf14-49ee-909e-4284a456ea93', created: 1, skipped: 0, groups: 1, omittedManagedImages: 1 };
  axios.defaults.adapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined; calls.push({ url: config.url, body });
    if (config.url.endsWith('/preview')) return response(config, { previewHash: 'signed-menu-preview', expiresAt: '2031-01-01T00:05:00Z', summary: 'Replace display menu', changes: { priceMenu: { from: [], to: priceMenu, omittedManagedImages: 1 } } });
    if (config.url.endsWith('/history')) return response(config, { items: [{ ...result, createdAt: '2030-01-01T00:00:00Z', sourceShopName: 'Source', targetShopName: 'Target' }], page: 1, limit: 20, total: 1 });
    return response(config, result);
  };
  const server = await createServer(serverOptions);
  try {
    const { previewCopy, applyCopy, getCopyHistory } = await server.ssrLoadModule('/src/api/accountAccess.ts');
    const preview = await previewCopy(input);
    assert.deepEqual(preview.changes.priceMenu.to, priceMenu);
    assert.equal(preview.changes.priceMenu.omittedManagedImages, 1);
    await applyCopy(input, preview.previewHash, 'menu-copy-retry-key');
    await applyCopy(input, preview.previewHash, 'menu-copy-retry-key');
    assert.deepEqual(calls[1], calls[2]); assert.deepEqual(calls[1].body, { ...input, previewHash: 'signed-menu-preview', idempotencyKey: 'menu-copy-retry-key' });
    assert.equal((await getCopyHistory()).items[0].kind, 'PRICE_MENU');
  } finally { await server.close(); }
});

test('selected directory snapshots travel outside menu JSON and are removed when their source is detached', async () => {
  const calls = [];
  axios.defaults.adapter = async config => { calls.push(JSON.parse(config.data)); return response(config, { id: shopId }); };
  const server = await createServer(serverOptions);
  try {
    const { priceMenuSavePayload } = await server.ssrLoadModule('/src/utils/priceMenuDraft.ts');
    const { updateShopProfile } = await server.ssrLoadModule('/src/api/merchant.ts');
    const menu = [{ category: 'Body', items: [{ id: 'new-row', name: 'My revised title', priceText: '', pricing: { kind: 'TIMED', baseName: 'Body', durationMin: 60, priceCents: 8000, titleMode: 'CUSTOM' }, booking: { serviceId: targetId }, bookingMode: 'SINGLE', bookingEnabled: true }] }];
    const selections = [{ itemId: 'new-row', serviceId: targetId, expectedSelectionRevision: 'b'.repeat(64) }];
    const payload = priceMenuSavePayload(menu, revision, '', selections);
    await updateShopProfile(shopId, payload);
    assert.deepEqual(calls[0].catalogSelectionPreconditions, selections);
    assert.equal(JSON.stringify(calls[0].priceMenu).includes('expectedSelectionRevision'), false);
    assert.equal(calls[0].priceMenu[0].items[0].name, 'My revised title');
    assert.equal(Object.hasOwn(priceMenuSavePayload([], revision, '', selections), 'catalogSelectionPreconditions'), false);
    const detached = structuredClone(menu); delete detached[0].items[0].booking;
    assert.equal(Object.hasOwn(priceMenuSavePayload(detached, revision, '', selections), 'catalogSelectionPreconditions'), false);
    assert.equal(Object.hasOwn(priceMenuSavePayload(menu, revision, ''), 'catalogSelectionPreconditions'), false, 'no snapshot is invented for an already saved binding');
  } finally { await server.close(); }
});

test('merchant name lookup uses only the explicit shop and forwards cancellation without a write', async () => {
  const calls = [];
  axios.defaults.adapter = async config => { calls.push(config); return response(config, { items: [] }); };
  const server = await createServer(serverOptions);
  try {
    const { getMenuCatalog } = await server.ssrLoadModule('/src/api/menuCatalog.ts');
    const controller = new AbortController();
    await getMenuCatalog(shopId, { kind: 'variant', serviceId: targetId, q: 'Couple & Body', page: 2, pageSize: 10 }, controller.signal);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'get'); assert.equal(calls[0].signal, controller.signal);
    const parsed = new URL(calls[0].url, 'http://local.invalid');
    assert.equal(parsed.pathname, `/reservation-admin/shops/${shopId}/menu-catalog`);
    assert.equal(parsed.searchParams.get('serviceId'), targetId); assert.equal(parsed.searchParams.get('q'), 'Couple & Body');
    assert.equal(calls[0].data, undefined);
    await assert.rejects(getMenuCatalog(shopId, { kind: 'variant', q: '', page: 1, pageSize: 10 }), /主项目/);
    assert.equal(calls.length, 1);
  } finally { await server.close(); }
});
