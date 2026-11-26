import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Table } from 'antd';
import { createServer } from 'vite';

const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find([tree.props.children, tree.props.actions], predicate);
};

async function withBookings(run, recovery = false, readOnly = false) {
  const previous = Object.fromEntries(['window', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAdapter = axios.defaults.adapter;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => recovery && key === 'massajoy2:guest-assisted-booking:1:5' ? '{synthetic marker remains opaque to the parent}' : null } });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const requests = [];
  axios.defaults.adapter = async config => {
    requests.push(config.url);
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response([{ id: '5', name: 'Synthetic booking list shop', timezone: 'America/Los_Angeles', permissions: readOnly ? ['BOOKINGS_READ'] : ['BOOKINGS_READ', 'BOOKINGS_MANAGE'], accessType: readOnly ? 'STAFF' : 'ADMIN', isOwner: !readOnly }]);
    assert.equal(config.url, '/merchant/shops/5/bookings');
    return response({ shopId: '5', items: ['42', '43'].map(id => ({ id, shopId: '5', durationMin: 60, totalCents: 10025, paidCents: 0, refundedCents: 0, currency: 'usd', bookingNo: 'SYNTHETIC-' + id })), total: 2, page: config.params.page, pageSize: config.params.pageSize, totalPages: 1 });
  };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let root, router, auth, tree;
  try {
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const BookingsPage = (await vite.ssrLoadModule('/src/pages/bookings/index.tsx')).default;
    function ShopProbe({ node }) { tree = node.type(node.props); return null; }
    function Probe() { const node = BookingsPage(); return typeof node.type === 'function' ? React.createElement(ShopProbe, { key: node.key, node }) : null; }
    auth.getState().setAuth('synthetic-only', { id: '1', role: readOnly ? 'STAFF' : 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(Probe) }], { initialEntries: ['/bookings?shopId=5'] });
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    assert.equal(requests.filter(url => url.includes('/bookings')).length, 0, 'calendar-only entry must not read hidden historical contact projections');
    const assistant = () => find(tree, node => typeof node.props.onCreated === 'function' && typeof node.props.onClose === 'function');
    const newBookingButton = () => find(tree, node => node.props.children === '新增预约');
    if (recovery) { await run({ assistant, requests, tree: () => tree, newBookingButton }); return; }
    const history = find(tree, node => node.props.children === '历史订单与财务列表');
    assert.ok(history, 'history stays available as an explicit workspace');
    await act(async () => { history.props.onClick(); });
    const table = () => find(tree, node => node.type === Table);
    const rowButton = (id, title = '预约') => { const value = table(); const row = value.props.dataSource.find(row => row.id === id); assert.ok(row); return value.props.columns.find(column => column.title === title).render(row.bookingNo, row); };
    const detail = () => find(tree, node => node.props.id && typeof node.props.onClose === 'function');
    await run({ table, rowButton, detail, requests, assistant, newBookingButton, tree: () => tree });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await vite.close();
    axios.defaults.adapter = oldAdapter;
    for (const key of Object.keys(previous)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
}

test('booking-read staff see viewing guidance and can open order details', async () => withBookings(async ({ rowButton, detail, newBookingButton, tree }) => {
  const header = find(tree(), node => node.props.title === '预约订单');
  assert.match(header.props.description, /查看本店订单.*核对历史账务/);
  assert.doesNotMatch(header.props.description, /确认预约|改期|标记服务完成/);
  assert.equal(newBookingButton(), undefined);
  const viewOrder = rowButton('42', '操作');
  assert.equal(viewOrder.props.children, '查看详情');
  await act(async () => { viewOrder.props.onClick(); });
  assert.equal(detail().props.id, '42');
}, false, true));

test('same-turn row clicks cannot replace an already selected order and bypass its draft guard', async () => withBookings(async ({ rowButton, detail }) => {
  const first = rowButton('42').props.onClick, second = rowButton('43', '操作').props.onClick;
  await act(async () => { first(); second(); });
  assert.equal(detail().props.id, '42', 'the first detail owns the active dialog until it explicitly closes');
  assert.equal(rowButton('43').props.disabled, true);
  assert.equal(rowButton('43', '操作').props.disabled, true);
  await act(async () => { second(); });
  assert.equal(detail().props.id, '42');
}));

test('an old detail onClose cannot dismiss a newer order or a reopened copy of the original order', async () => withBookings(async ({ rowButton, detail }) => {
  await act(async () => { rowButton('42').props.onClick(); });
  const oldClose = detail().props.onClose;
  await act(async () => { oldClose(); });
  await act(async () => { rowButton('43').props.onClick(); });
  const nextClose = detail().props.onClose;
  await act(async () => { oldClose(); });
  assert.equal(detail()?.props.id, '43');
  await act(async () => { nextClose(); });
  await act(async () => { rowButton('42').props.onClick(); });
  await act(async () => { oldClose(); });
  assert.equal(detail()?.props.id, '42', 'dialog generation is checked even when the order id is reused');
}));

test('an old assistant callback cannot close a reopened assistant, and a captured order row cannot bypass its active modal', async () => withBookings(async ({ rowButton, detail, assistant, newBookingButton }) => {
  const oldRow = rowButton('42').props.onClick;
  await act(async () => { newBookingButton().props.onClick(); });
  const firstClose = assistant().props.onClose, firstCreated = assistant().props.onCreated;
  await act(async () => { oldRow(); }); assert.equal(detail(), undefined);
  await act(async () => { firstClose(); }); assert.equal(assistant(), undefined);
  await act(async () => { newBookingButton().props.onClick(); }); const current = assistant();
  await act(async () => { firstClose(); firstCreated(); }); assert.equal(assistant().key, current.key);
}));

test('refreshing with an unresolved first-guest marker opens recovery before another assisted booking can start', async () => withBookings(async ({ assistant, newBookingButton, requests }) => {
  assert.ok(assistant()); assert.equal(newBookingButton().props.disabled, true); assert.equal(requests.some(url => url.includes('/customers')), false);
}, true));

test('a committed assisted receipt opens exactly that order and keeps a visible pending unpaid reference', async () => withBookings(async ({ assistant, newBookingButton, detail, tree }) => {
  await act(async () => { newBookingButton().props.onClick(); });
  const receipt = { shopId: '5', requestKey: 'assisted:synthetic-only', outcome: 'COMMITTED', result: { bookingId: '43', bookingNo: 'SYNTHETIC-43' } };
  await act(async () => { assistant().props.onCreated(receipt); });
  assert.equal(detail().props.id, '43'); assert.equal(assistant(), undefined);
  assert.ok(find(tree(), node => typeof node.props.title === 'string' && node.props.title.includes('SYNTHETIC-43')));
  assert.ok(find(tree(), node => typeof node.props.description === 'string' && node.props.description.includes('尚未收款')));
}));
