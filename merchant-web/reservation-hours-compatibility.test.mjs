import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Modal } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const week = () => Object.fromEntries(days.map(day => [day, { open: '09:00', close: '22:00' }]));
const closedWeek = () => Object.fromEntries(days.map(day => [day, { closed: true }]));
const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find([tree.props.children, tree.props.extra, tree.props.action, tree.props.items?.map(item => item.children)], predicate);
};
const invalidHours = [
  '{broken', JSON.stringify(JSON.stringify(week())), 'null', 'false', '[]', null, undefined, [], false,
  { mon: { open: '09:00', close: '22:00' } }, { monday: null },
  { monday: false }, { monday: [] , tuesday: undefined },
  { monday: { open: '09:00', close: '24:00' } },
  { monday: Array.from({ length: 5 }, () => ({ open: '09:00', close: '22:00' })) },
  { monday: [{ open: '09:00', close: '13:00' }, { open: '12:00', close: '22:00' }] },
  { monday: { closed: 'false', open: '09:00', close: '22:00' } },
  { monday: { open: '22:00', close: '09:00' } },
];
const viteServer = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });

test('a valid serialized hours week produces the same editable draft and untouched six days as its object', async () => {
  const server = await viteServer();
  try {
    const { hoursDraft, hoursPayload } = await server.ssrLoadModule('/src/utils/reservationHours.ts');
    const original = week(), serialized = JSON.stringify(original);
    const draft = hoursDraft(serialized);
    assert.deepEqual(draft, hoursDraft(original));
    draft.monday[0].open = '10:00';
    const saved = hoursPayload(draft);
    assert.deepEqual(saved.monday, [{ open: '10:00', close: '22:00' }]);
    for (const day of days.filter(day => day !== 'monday')) assert.deepEqual(saved[day], [{ open: '09:00', close: '22:00' }]);
    assert.equal(JSON.stringify(original), serialized, 'normalization never changes the source');
  } finally { await server.close(); }
});

test('serialized split periods and explicit closure stay equivalent while invalid values fail directly', async () => {
  const server = await viteServer();
  try {
    const { checkedBusinessHours, hoursDraft, hoursPayload } = await server.ssrLoadModule('/src/utils/reservationHours.ts');
    const split = { monday: [{ open: '09:00', close: '12:00' }, { open: '13:00', close: '22:00', closed: false }], tuesday: { closed: true }, wednesday: [] };
    assert.deepEqual(checkedBusinessHours(JSON.stringify(split)), split);
    assert.deepEqual(hoursPayload(hoursDraft(JSON.stringify(split))), hoursPayload(hoursDraft(split)));
    assert.deepEqual(hoursPayload(hoursDraft(JSON.stringify(closedWeek()))), closedWeek());
    assert.deepEqual(hoursPayload(hoursDraft({})), closedWeek(), 'an empty canonical object explicitly has no open days');
    for (const value of invalidHours) assert.throws(() => hoursDraft(value), /营业时间/);
  } finally { await server.close(); }
});

test('config and hours transport reject malformed or unsupported stored values before allowing a write', async () => {
  const server = await viteServer(), previous = axios.defaults.adapter;
  const writes = []; let stored;
  axios.defaults.adapter = async config => {
    if (config.method === 'patch') writes.push(config);
    return { config, data: { shopId: '5', businessHours: stored, services: [], therapists: [], rooms: [], paymentPolicy: { payAtStoreEnabled: true } }, status: 200, statusText: 'OK', headers: {} };
  };
  try {
    const { getReservationConfig, saveHours } = await server.ssrLoadModule('/src/api/reservations.ts');
    for (stored of invalidHours) {
      await assert.rejects(getReservationConfig('5'), /营业时间/);
      await assert.rejects(saveHours('5', stored), /营业时间/);
    }
    assert.equal(writes.length, 0);
  } finally { axios.defaults.adapter = previous; await server.close(); }
});

async function pageHarness(businessHours, run) {
  const previous = ['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal;
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let tree, hoursTree, root, router, auth, badRead;
  const writes = [], reads = [];
  const config = { shopId: '5', timezone: 'America/Los_Angeles', orderOnly: true, businessHours,
    bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [] }, bookingSettingsHash: 'a'.repeat(64), paymentPolicy: { payAtStoreEnabled: true }, services: [], therapists: [], rooms: [] };
  Modal.useModal = () => [{ confirm: async () => true, info() {} }, null];
  axios.defaults.adapter = async request => {
    const response = data => ({ config: request, data, status: 200, statusText: 'OK', headers: {} });
    if (request.url === '/merchant/shops') return response([{ id: '5', name: 'Synthetic shop', timezone: config.timezone, permissions: ['RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true }]);
    if (request.url === '/reservation-admin/shops/5/config') { assert.equal(request.method, 'get'); reads.push(request.url); return response({ ...structuredClone(config), ...(badRead === undefined ? {} : { businessHours: badRead }) }); }
    assert.equal(request.url, '/reservation-admin/shops/5/hours'); assert.equal(request.method, 'patch');
    const payload = JSON.parse(request.data); writes.push(payload); config.businessHours = JSON.stringify(payload.businessHours);
    return response({ item: { shopId: '5', businessHours: config.businessHours } });
  };
  const server = await viteServer();
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const ReservationsPage = (await server.ssrLoadModule('/src/pages/reservations/index.tsx')).default;
    function HoursProbe({ component: Component, props }) { hoursTree = Component(props); return null; }
    function PageProbe() {
      tree = ReservationsPage();
      const hours = find(tree, node => node.props.onReconcile && node.props.onLifecycleChange && node.props.canWrite);
      if (!hours) { hoursTree = undefined; return null; }
      return React.createElement(HoursProbe, { key: hours.key, component: hours.type, props: hours.props });
    }
    auth.getState().setAuth('synthetic-hours', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(PageProbe)) }], { initialEntries: ['/reservations?shopId=5&tab=hours'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const input = label => { const node = find(hoursTree, node => node.props['aria-label'] === label); assert.ok(node, label); return node.props; };
    const button = label => { const node = find(hoursTree, node => node.props.children === label && node.props.onClick); assert.ok(node, label); return node.props; };
    await run({ writes, reads, tree: () => tree, hoursTree: () => hoursTree, input, button,
      setBadRead: value => { badRead = value; },
      change: (label, value) => act(async () => { input(label).onChange({ target: { value } }); }),
      save: () => act(async () => { button('保存营业时间').onClick(); }),
      reconcile: () => act(async () => { button('重新核对服务器设置').onClick(); }),
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('real hours component edits one serialized day and saves all seven exact local-day values', () => pageHarness(JSON.stringify(week()), async h => {
  assert.equal(h.input('周一开始时间1').value, '09:00'); assert.equal(h.writes.length, 0);
  await h.change('周一开始时间1', '10:00'); await h.save();
  assert.equal(h.writes.length, 1); assert.deepEqual(h.writes[0].businessHours.monday, [{ open: '10:00', close: '22:00' }]);
  for (const day of days.filter(day => day !== 'monday')) assert.deepEqual(h.writes[0].businessHours[day], [{ open: '09:00', close: '22:00' }]);
  assert.equal(h.button('保存营业时间').disabled, true, 'matching normalized readback is clean');
}));

test('an explicitly all-closed object remains legitimate and reading it never creates a write', () => pageHarness(closedWeek(), async h => {
  assert.ok(h.hoursTree()); assert.equal(find(h.hoursTree(), node => node.props['aria-label'] === '周一开始时间1'), undefined);
  assert.equal(h.button('保存营业时间').disabled, true); assert.equal(h.writes.length, 0);
}));

test('malformed stored hours retain a load error and expose no editable hours or write action', () => pageHarness('{broken', async h => {
  assert.equal(h.hoursTree(), undefined);
  assert.ok(find(h.tree(), node => typeof node.props.title === 'string' && /营业时间/.test(node.props.title)), 'malformed hours remain a visible load error');
  assert.equal(h.writes.length, 0);
}));

test('malformed hours readback preserves the submitted seven-day draft and prevents another save', () => pageHarness(JSON.stringify(week()), async h => {
  await h.change('周一开始时间1', '10:00'); h.setBadRead('{broken'); await h.save();
  assert.equal(h.writes.length, 1); assert.equal(h.input('周一开始时间1').value, '10:00');
  assert.equal(h.button('保存营业时间').disabled, true);
  await h.save(); await h.reconcile();
  assert.equal(h.writes.length, 1); assert.equal(h.button('保存营业时间').disabled, true);
  assert.equal(h.input('周二开始时间1').value, '09:00');
  h.setBadRead(undefined); await h.reconcile();
  assert.equal(h.writes.length, 1); assert.equal(h.input('周一开始时间1').value, '10:00');
  assert.equal(h.button('保存营业时间').disabled, true, 'matched final readback is clean');
}));
