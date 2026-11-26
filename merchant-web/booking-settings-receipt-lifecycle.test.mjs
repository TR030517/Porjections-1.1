import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Modal } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find([tree.props.children, tree.props.action], predicate);
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function harness(run) {
  const previous = ['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal;
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const writes = [], confirmations = [];
  let patch, read, tree, auth, root, router;
  const config = { shopId: '5', timezone: 'America/Los_Angeles', orderOnly: true, bookingSettingsHash: 'a'.repeat(64), bookingSettings: { minimumNoticeMinutes: 720, closedPeriods: [] },
    businessHours: { monday: { open: '09:00', close: '22:00' } }, paymentPolicy: { payAtStoreEnabled: true }, services: [], therapists: [], rooms: [] };
  Modal.useModal = () => [{ confirm: async options => { confirmations.push(options); return true; }, info() {} }, null];
  axios.defaults.adapter = async request => {
    const response = data => ({ config: request, data, status: 200, statusText: 'OK', headers: {} });
    if (request.url === '/merchant/shops') return response([{ id: '5', name: 'Synthetic shop', timezone: config.timezone, permissions: ['RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true }]);
    if (request.url === '/reservation-admin/shops/5/config') { assert.equal(request.method, 'get'); return response(read ? await read() : structuredClone(config)); }
    assert.equal(request.url, '/reservation-admin/shops/5/booking-settings'); assert.equal(request.method, 'patch');
    const { expectedSettingsHash, ...values } = JSON.parse(request.data); writes.push(values);
    if (expectedSettingsHash !== config.bookingSettingsHash) throw Object.assign(new Error('Synthetic stale rules hash'), { response: { status: 409, data: { message: '预约规则已有变化，请重新读取' } }, config: request });
    if (patch) return response(await patch(values));
    config.bookingSettings = structuredClone(values); return response({ item: { shopId: '5', bookingSettings: values, bookingSettingsHash: 'a'.repeat(64) } });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const ReservationsPage = (await server.ssrLoadModule('/src/pages/reservations/index.tsx')).default;
    const { ShopBookingSettingsPanel } = await server.ssrLoadModule('/src/pages/reservations/ShopBookingSettingsPanel.tsx');
    function Probe() { tree = ReservationsPage(); return null; }
    auth.getState().setAuth('synthetic-rules', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(Probe)) }], { initialEntries: ['/reservations?shopId=5'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const panel = () => { const result = find(tree, node => node.type === ShopBookingSettingsPanel); assert.ok(result, 'real booking settings panel remains mounted with its draft'); return result.props; };
    await run({ writes, confirmations, config, panel, tree: () => tree,
      change: values => act(async () => { panel().onChange(values); }), save: () => act(async () => { panel().onSave(); }),
      recover: () => act(async () => { const result = find(tree, node => node.props.children === '结束草稿并核对' && node.props.onClick); assert.ok(result); result.props.onClick(); }),
      setPatch: next => { patch = next; }, setRead: next => { read = next; },
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

for (const mode of ['stale config', 'failed config', 'missing booking settings']) test(`a matching booking-settings receipt followed by ${mode} keeps the submitted draft and prevents repeat PATCH`, () => harness(async h => {
  const draft = { minimumNoticeMinutes: 1440, closedPeriods: [{ startDate: '2028-02-29', endDate: '2028-03-03' }] };
  await h.change(draft); const captured = h.panel().onSave, pending = deferred();
  h.setPatch(async values => { await pending.promise; return { item: { shopId: '5', bookingSettings: values, bookingSettingsHash: 'a'.repeat(64) } }; });
  if (mode === 'failed config') h.setRead(() => { throw Object.assign(new Error('Synthetic 404 readback'), { response: { status: 404, data: { message: 'Synthetic unavailable config' } } }); });
  if (mode === 'missing booking settings') h.setRead(() => { const copy = structuredClone(h.config); delete copy.bookingSettings; return copy; });
  await act(async () => { captured(); captured(); }); assert.equal(h.writes.length, 1);
  await act(async () => { pending.resolve(); });
  assert.deepEqual(h.panel().settings, draft, 'an old/failed read must not replace the exact submitted dates and notice');
  assert.equal(h.panel().dirty, true); assert.equal(h.panel().disabled, true);
  assert.equal(find(h.tree(), node => node.props.title === '预约提前时间与临时闭店已保存。'), undefined, 'unverified readback cannot announce success');
  await act(async () => { captured(); }); assert.equal(h.writes.length, 1);
  h.config.bookingSettings = structuredClone(draft); h.setRead(undefined); await h.recover();
  assert.equal(h.writes.length, 1); assert.equal(h.panel().dirty, false); assert.equal(h.panel().disabled, false);
  assert.deepEqual(h.panel().settings, draft);
}));

test('matching booking rule write and config complete with one PATCH and one clean draft', () => harness(async h => {
  const draft = { minimumNoticeMinutes: 60, closedPeriods: [{ startDate: '2028-06-01', endDate: '2028-06-03' }] };
  await h.change(draft); await h.save(); assert.equal(h.writes.length, 1);
  assert.equal(h.panel().dirty, false); assert.equal(h.panel().disabled, false); assert.deepEqual(h.panel().settings, draft);
}));

test('stale rule PATCH cannot erase a calendar closure; draft stays until explicit read and merge adopts the current CAS hash', () => harness(async h => {
  const draft = { minimumNoticeMinutes: 1440, closedPeriods: [{ startDate: '2028-06-01', endDate: '2028-06-03' }] };
  await h.change(draft);
  h.config.bookingSettings = { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2028-07-01', endDate: '2028-07-01' }] };
  h.config.bookingSettingsHash = 'b'.repeat(64);
  await h.save(); assert.equal(h.writes.length, 1); assert.equal(h.panel().dirty, true); assert.deepEqual(h.panel().settings, draft);
  assert.deepEqual(h.config.bookingSettings.closedPeriods, [{ startDate: '2028-07-01', endDate: '2028-07-01' }]);
  await h.save(); assert.equal(h.writes.length, 1, 'a stale retained handler cannot resubmit before explicit reconciliation');
  const button = label => { const node = find(h.tree(), value => value.props.children === label && value.props.onClick); assert.ok(node, label); return node; };
  await act(async () => { button('重读最新规则，保留草稿').props.onClick(); });
  assert.deepEqual(h.panel().settings, draft, 'read alone never discards or mutates the original draft');
  await act(async () => { button('合并最新闭店日期').props.onClick(); });
  assert.deepEqual(h.panel().settings, { minimumNoticeMinutes: 1440, closedPeriods: [...draft.closedPeriods, { startDate: '2028-07-01', endDate: '2028-07-01' }] });
  await h.save(); assert.equal(h.writes.length, 2); assert.equal(h.panel().dirty, false);
  assert.equal(h.config.bookingSettings.closedPeriods.length, 2); assert.equal('expectedSettingsHash' in h.config.bookingSettings, false);
}));
