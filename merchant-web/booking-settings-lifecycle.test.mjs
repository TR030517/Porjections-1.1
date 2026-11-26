import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find(tree.props.children, predicate);
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('merchant booking rules keep unsaved dates and permission guards across real component effects and shop changes', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const previousAdapter = axios.defaults.adapter;
  const documentSurface = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const windowSurface = { document: documentSurface, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} };
  documentSurface.defaultView = windowSurface;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: documentSurface, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowSurface });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let root, router, auth;
  const initial = { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2026-12-31', endDate: '2027-01-02' }] };
  const configs = Object.fromEntries(['5', '6'].map(shopId => [shopId, {
    shopId, timezone: shopId === '5' ? 'America/Los_Angeles' : 'Pacific/Honolulu', orderOnly: true,
    bookingSettings: shopId === '5' ? structuredClone(initial) : { minimumNoticeMinutes: 60, closedPeriods: [] }, bookingSettingsHash: 'a'.repeat(64),
    businessHours: { monday: { open: '09:00', close: '22:00' } }, paymentPolicy: { payAtStoreEnabled: true }, services: [], therapists: [], rooms: [],
  }]));
  let shops = ['5', '6'].map(id => ({ id, name: 'Synthetic shop ' + id, timezone: configs[id].timezone, permissions: ['RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true }));
  let patch, read;
  const writes = [];
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(shops);
    const [, shopId, action] = config.url.match(/^\/reservation-admin\/shops\/(5|6)\/(config|booking-settings)$/) ?? [];
    assert.ok(shopId, 'unexpected HTTP request: ' + config.url);
    if (config.method === 'patch') {
      const { expectedSettingsHash, ...value } = JSON.parse(config.data); assert.equal(expectedSettingsHash, configs[shopId].bookingSettingsHash); writes.push({ shopId, value });
      if (patch) return response(await patch(shopId, value));
      configs[shopId].bookingSettings = structuredClone(value);
      return response({ item: { shopId, bookingSettings: value, bookingSettingsHash: 'a'.repeat(64) } });
    }
    assert.equal(action, 'config');
    return response(read ? await read(shopId) : structuredClone(configs[shopId]));
  };
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const ReservationsPage = (await server.ssrLoadModule('/src/pages/reservations/index.tsx')).default;
    const { ShopBookingSettingsPanel } = await server.ssrLoadModule('/src/pages/reservations/ShopBookingSettingsPanel.tsx');
    let tree, shopContext;
    function Probe() { shopContext = useShopId(); tree = ReservationsPage(); return null; }
    auth.getState().setAuth('synthetic-only', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(Probe)) }], { initialEntries: ['/reservations?shopId=5'] });
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const panel = () => { const found = find(tree, node => node.type === ShopBookingSettingsPanel); assert.ok(found, 'settings panel is loaded'); return found.props; };
    const change = value => act(async () => { panel().onChange(value); });
    const save = () => act(async () => { panel().onSave(); });
    assert.equal(panel().settings.minimumNoticeMinutes, 720); assert.equal(panel().dirty, false); assert.equal(panel().disabled, false);
    assert.equal(writes.length, 0, 'opening the page never writes defaults');

    const draft = { minimumNoticeMinutes: 30, closedPeriods: [{ startDate: '2028-02-29', endDate: '2028-03-01' }] };
    await change(draft); assert.equal(panel().dirty, true);
    await save();
    assert.deepEqual(writes, [{ shopId: '5', value: draft }]);
    assert.deepEqual(panel().settings, draft); assert.equal(panel().dirty, false);

    const conflict = { ...draft, minimumNoticeMinutes: 1440 };
    await change(conflict);
    patch = async () => { throw Object.assign(new Error('Synthetic live booking conflict'), { response: { status: 409, data: { message: '闭店日期范围内已有有效预约' } } }); };
    await save(); assert.equal(panel().dirty, true); assert.equal(panel().disabled, false); assert.deepEqual(panel().settings, conflict);
    const conflictAlert = find(tree, node => node.props.title === '预约规则已有变化，当前草稿已保留');
    assert.ok(conflictAlert);
    const locate = (node, label) => { if (Array.isArray(node)) return node.map(value => locate(value, label)).find(Boolean); if (!React.isValidElement(node)) return; if (node.props.children === label) return node; return locate(node.props.children, label); };
    await act(async () => { locate(conflictAlert.props.action, '重读最新规则，保留草稿').props.onClick(); });
    const reread = find(tree, node => node.props.title === '预约规则已有变化，当前草稿已保留');
    await act(async () => { locate(reread.props.action, '合并最新闭店日期').props.onClick(); });

    // Refreshing the same authorized list must not erase a draft, and the live
    // permission store must stop a previously captured save callback.
    const capturedSave = panel().onSave;
    shops = shops.map(shop => shop.id === '5' ? { ...shop, permissions: [] } : shop);
    await act(async () => { await shopContext.reloadShop('5'); });
    assert.equal(panel().disabled, true); assert.deepEqual(panel().settings, conflict);
    const beforeRevokedWrite = writes.length;
    await act(async () => { capturedSave(); });
    assert.equal(writes.length, beforeRevokedWrite, 'revocation blocks a stale save handler before PATCH');
    shops = shops.map(shop => shop.id === '5' ? { ...shop, permissions: ['RESERVATION_CONFIG'] } : shop);
    await act(async () => { await shopContext.reloadShop('5'); });

    patch = async () => { throw new Error('Synthetic interrupted receipt'); };
    await save(); assert.equal(panel().disabled, true); assert.equal(panel().dirty, true);
    const beforeUnknownWrite = writes.length; await save();
    assert.equal(writes.length, beforeUnknownWrite, 'unknown save never sends another PATCH');

    // A forced account change is distinct from voluntarily discarding a draft.
    // It must release the previous actor's locks and fetch this actor's store.
    await act(async () => { auth.getState().setAuth('synthetic-second', { id: '2', role: 'ADMIN' }); });
    assert.equal(panel().dirty, false); assert.equal(panel().disabled, false);
    const late = deferred(); patch = async () => late.promise;
    await change({ ...draft, minimumNoticeMinutes: 2160 }); await save();
    assert.equal(panel().disabled, true);
    await act(async () => { auth.getState().setAuth('synthetic-third', { id: '3', role: 'ADMIN' }); await router.navigate('/reservations?shopId=6'); });
    assert.equal(panel().settings.minimumNoticeMinutes, 60); assert.equal(panel().dirty, false);
    await act(async () => { late.resolve({ item: { shopId: '5', bookingSettings: { ...draft, minimumNoticeMinutes: 2160 }, bookingSettingsHash: 'a'.repeat(64) } }); });
    assert.equal(panel().settings.minimumNoticeMinutes, 60, 'old account/store receipt never overwrites the new store');
    assert.equal(panel().dirty, false);
  } finally {
    if (root) await act(async () => { root.unmount(); });
    router?.dispose(); auth?.getState().logout();
    await server.close(); axios.defaults.adapter = previousAdapter;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
