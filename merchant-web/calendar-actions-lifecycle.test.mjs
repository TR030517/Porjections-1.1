import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Modal } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';
function all(tree, predicate, result = []) { if (Array.isArray(tree)) { tree.forEach(child => all(child, predicate, result)); return result; } if (!React.isValidElement(tree)) return result; if (predicate(tree)) result.push(tree); all(tree.props.children, predicate, result); return result; }
const find = (tree, predicate) => all(tree, predicate)[0];
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join('') : React.isValidElement(tree) ? textOf(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
async function withPanel(run, permissions = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'RESERVATION_CONFIG']) {
  const previous = Object.fromEntries(['window', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])), oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null }, stored = new Map(), requests = [], confirmations = [], assisted = [];
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } });
  Modal.useModal = () => [{ confirm: async options => { confirmations.push(options); return true; }, info() {} }, null];
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let props = { date: '2035-11-10' }, tree, root, router, auth, context, changed = 0, closed = 0, writeGate, locked = false, readVersion = 1, renderSurface, mountVersion = 0, reconciliation = 'NOT_EXECUTED', lastCommand, temporaryClosure = null;
  const onLockChange = value => { locked = value; };
  const options = () => ({ shopId: '7', timezone: 'America/Los_Angeles', date: props.date ?? '2035-11-10', settingsHash: String(readVersion).padEnd(64, 'a'), closed: temporaryClosure !== null, temporaryClosure, resources: [{ type: 'THERAPIST', id: '12', name: 'Synthetic therapist' }, { type: 'ROOM', id: '5', name: 'Synthetic room' }] });
  const detail = () => ({ id: '91', shopId: '7', timezone: 'America/Los_Angeles', purpose: 'TIME_BLOCK', scope: 'THERAPIST', resourceId: '12', reason: 'Private synthetic reason', startAt: '2035-11-10T22:00:00Z', endAt: '2035-11-10T23:00:00Z', status: 'ACTIVE', version: readVersion, operator: { id: '1', name: 'Synthetic operator' } });
  const committed = input => ({ shopId: '7', requestKey: input.requestKey, action: input.action, outcome: 'COMMITTED', result: ['CLOSE_DAY', 'REOPEN_DAY'].includes(input.action) ? { blockId: null, version: null, closedDate: input.date } : { blockId: input.blockId ?? '91', version: input.expectedVersion ? input.expectedVersion + 1 : 1, closedDate: null } });
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    const input = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    requests.push({ url: config.url, method: config.method, params: config.params, input });
    if (config.url === '/merchant/shops') return response([{ id: '7', name: 'Synthetic action shop', timezone: 'America/Los_Angeles', permissions, accessType: 'STAFF', isOwner: false }]);
    if (config.url.endsWith('/options')) return response(options());
    if (config.url.endsWith('/blocks/91')) return response(detail());
    if (config.url.endsWith('/reconcile')) return response(reconciliation === 'COMMITTED' ? committed(lastCommand) : { shopId: '7', requestKey: config.url.split('/').at(-2), outcome: 'NOT_EXECUTED' });
    if (config.method === 'post' && config.url.endsWith('/calendar-actions')) { lastCommand = input; return response(writeGate ? await writeGate.promise : committed(input)); }
    throw new Error('Unexpected request ' + config.url);
  };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await vite.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await vite.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const Panel = (await vite.ssrLoadModule('/src/pages/bookings/CalendarActionsPanel.tsx')).default;
    function Probe() { context = useShopId(); if (!context.shop) return null; return React.createElement(Surface); }
    function Surface() { const [, rerender] = React.useState(0); renderSurface = () => rerender(value => value + 1); tree = Panel({ shopId: '7', timezone: 'America/Los_Angeles', disabled: false, onAssisted: input => assisted.push(input), onChanged: () => { changed++; }, onClose: () => { closed++; props = {}; renderSurface(); }, onLockChange, ...props }); return null; }
    function GuardProbe() { const node = MerchantDraftGuard({ children: null }); return React.createElement(node.type, { value: node.props.value }, React.createElement(Probe)); }
    auth.getState().setAuth('synthetic-only', { id: '1', role: 'STAFF' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(GuardProbe) }], { initialEntries: ['/bookings?shopId=7'] }); root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const field = label => { const node = find(tree, node => node.props['aria-label'] === label); assert.ok(node, label); return node; };
    const button = label => { const node = find(tree, node => node.props.children === label && typeof node.props.onClick === 'function'); assert.ok(node, label); return node; };
    await run({ tree: () => tree, field, button, requests, confirmations, assisted, stored, changed: () => changed, closed: () => closed, locked: () => locked, gate(value) { writeGate = value; }, version(value) { readVersion = value; }, closure(value) { temporaryClosure = value; }, reconcileOutcome(value) { reconciliation = value; }, async remount() { await act(async () => { root.render(React.createElement(RouterProvider, { router, key: ++mountVersion })); }); }, async permissions(value) { permissions = value; await act(async () => { await context.reloadShop('7'); }); }, async props(value) { props = value; await act(async () => { renderSurface(); }); } });
  } finally { if (root) await act(async () => root.unmount()); router?.dispose(); auth?.getState().logout(); await vite.close(); axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal; for (const key of Object.keys(previous)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; } }
}
test('date selection reads context only; assistant receives explicit shop-local preference; config previews a resource-specific interval before creating it with no order fields', async () => withPanel(async ({ tree, field, button, requests, assisted, changed }) => {
  assert.equal(requests.some(request => request.method === 'post'), false);
  await act(async () => { field('日期操作起始时刻').props.onChange({ target: { value: '14:30' } }); });
  await act(async () => { button('新增预约').props.onClick(); }); assert.deepEqual(assisted, [{ date: '2035-11-10', startTime: '14:30' }]);
  await act(async () => { button('登记内部占用').props.onClick(); });
  assert.equal(field('区间开始时间').props.value, '2035-11-10T14:30');
  await act(async () => { field('区间作用范围').props.onChange('ROOM'); });
  await act(async () => { field('区间资源').props.onChange('5'); field('区间原因').props.onChange({ target: { value: 'Synthetic internal meeting' } }); });
  const preview = find(tree(), node => node.props['aria-label'] === '保存前影响预览');
  assert.ok(preview);
  assert.match(textOf(preview), /指定场地 · Synthetic room/);
  assert.match(textOf(preview), /2035-11-10 14:30 — 2035-11-10 15:30/);
  assert.match(textOf(preview), /指定时段/);
  assert.match(textOf(preview), /America\/Los_Angeles/);
  assert.match(textOf(preview), /不会自动取消或改期/);
  await act(async () => { field('区间开始时间').props.onChange({ target: { value: '2035-11-10T00:00' } }); field('区间结束时间').props.onChange({ target: { value: '2035-11-12T00:00' } }); });
  const allDayPreview = find(tree(), node => node.props['aria-label'] === '保存前影响预览');
  assert.match(textOf(allDayPreview), /2035-11-10 00:00 — 2035-11-12 00:00/);
  assert.match(textOf(allDayPreview), /全天区间 · 结束日期不包含在内/);
  assert.equal(requests.some(request => request.method === 'post'), false, 'editing and previewing must not write an interval or create a customer order');
  const save = button('保存日历区间').props.onClick; await act(async () => { save(); save(); });
  const writes = requests.filter(request => request.url.endsWith('/calendar-actions')); assert.equal(writes.length, 1);
  assert.equal(writes[0].input.scope, 'ROOM'); assert.equal(writes[0].input.resourceId, '5'); assert.equal(writes[0].input.purpose, 'INTERNAL_OCCUPANCY');
  for (const field of ['customerId', 'price', 'email', 'orderId']) assert.equal(field in writes[0].input, false);
  assert.equal(changed(), 1);
}));
test('view-only booking staff never read config/private details and cannot invoke retained config controls after revocation', async () => withPanel(async ({ tree, requests, button, permissions }) => {
  const open = button('屏蔽这个时段').props.onClick;
  await permissions(['BOOKINGS_READ']); const before = requests.length;
  await act(async () => { open(); }); assert.equal(requests.length, before);
  assert.equal(find(tree(), node => node.props['aria-label'] === '区间原因'), undefined);
}));
test('initial read-only date and managed-event selection request only allowed calendar summaries, not reason/operator', async () => withPanel(async ({ requests, props, tree }) => {
  assert.equal(requests.some(request => request.url.includes('calendar-actions')), false);
  await props({ event: { id: 'calendar-block:91', blockId: '91', startAt: '2035-11-10T22:00Z', eventType: 'TIME_BLOCK' } });
  assert.equal(requests.some(request => request.url.includes('calendar-actions')), false);
  assert.equal(find(tree(), node => node.props['aria-label'] === '区间原因'), undefined);
}, ['BOOKINGS_READ']));
test('uncertain create freezes draft and original request; locked reconcile permits explicit discard then current-version reload', async () => withPanel(async ({ field, button, requests, stored, gate, locked, closed }) => {
  await act(async () => { button('屏蔽这个时段').props.onClick(); });
  await act(async () => { field('区间原因').props.onChange({ target: { value: 'Synthetic stop' } }); });
  const pending = deferred(); gate(pending);
  await act(async () => { button('保存日历区间').props.onClick(); });
  await act(async () => { pending.reject(new Error('lost response')); }); gate(undefined);
  assert.equal(stored.size, 1); assert.equal(locked(), true);
  assert.equal(requests.filter(request => request.url.endsWith('/calendar-actions')).length, 1);
  await act(async () => { button('查询确定结果').props.onClick(); });
  assert.equal(locked(), true, 'a fenced original request stays locked until explicitly discarded or retried');
  await act(async () => { button('放弃未执行请求').props.onClick(); });
  assert.equal(stored.size, 0); assert.equal(field('区间原因').props.value, 'Synthetic stop');
  assert.equal(locked(), true, 'the preserved unsaved draft still protects the surrounding calendar');
  await act(async () => { button('放弃修改并关闭').props.onClick(); });
  assert.equal(closed(), 1); assert.equal(locked(), false);
}));

test('successful interval save unlocks calendar selection before closing and a later release', async () => withPanel(async ({ field, button, gate, locked, requests, closed, tree, props }) => {
  await act(async () => { button('登记内部占用').props.onClick(); });
  await act(async () => { field('区间原因').props.onChange({ target: { value: 'Synthetic internal use' } }); });
  const pending = deferred(); gate(pending);
  await act(async () => { button('保存日历区间').props.onClick(); });
  assert.equal(locked(), true);
  assert.equal(button('关闭操作面板').props.disabled, true);
  const input = requests.find(request => request.input?.action === 'CREATE').input;
  await act(async () => { pending.resolve({ shopId: '7', requestKey: input.requestKey, action: 'CREATE', outcome: 'COMMITTED', result: { blockId: '91', version: 1, closedDate: null } }); });
  assert.equal(locked(), false, 'receipt cleanup must win over the pre-save dirty closure');
  assert.equal(button('关闭操作面板').props.disabled, false);
  await act(async () => { button('关闭操作面板').props.onClick(); });
  assert.equal(closed(), 1); assert.equal(locked(), false); assert.equal(tree(), null);
  gate(undefined);
  await props({ event: { id: 'calendar-block:91', blockId: '91', startAt: '2035-11-10T22:00Z', eventType: 'TIME_BLOCK' } });
  assert.equal(locked(), false);
  await act(async () => { button('解除区间').props.onClick(); });
  assert.equal(requests.filter(request => request.input?.action === 'RELEASE').length, 1);
  assert.equal(locked(), false, 'successful release must also leave the surrounding calendar usable');
}));

test('closing an unsaved draft unlocks the calendar without sending a command', async () => withPanel(async ({ field, button, locked, requests, closed, tree }) => {
  await act(async () => { button('屏蔽这个时段').props.onClick(); });
  await act(async () => { field('区间原因').props.onChange({ target: { value: 'Unsaved synthetic stop' } }); });
  assert.equal(locked(), true);
  await act(async () => { button('放弃修改并关闭').props.onClick(); });
  assert.equal(closed(), 1); assert.equal(locked(), false); assert.equal(tree(), null);
  assert.equal(requests.some(request => request.method === 'post'), false);
}));

test('unknown interval create stays locked across close attempts and remount until committed recovery', async () => withPanel(async ({ field, button, gate, locked, stored, closed, remount, reconcileOutcome, requests }) => {
  const oldClose = button('关闭操作面板').props.onClick;
  await act(async () => { button('登记内部占用').props.onClick(); });
  await act(async () => { field('区间原因').props.onChange({ target: { value: 'Synthetic recovery' } }); });
  const pending = deferred(); gate(pending);
  await act(async () => { button('保存日历区间').props.onClick(); });
  await act(async () => { pending.reject(new Error('lost response')); });
  const marker = [...stored.values()][0];
  await act(async () => { oldClose(); });
  assert.equal(closed(), 0); assert.equal(locked(), true); assert.equal([...stored.values()][0], marker);
  await remount();
  assert.equal(locked(), true); assert.equal(button('关闭操作面板').props.disabled, true);
  reconcileOutcome('COMMITTED');
  await act(async () => { button('查询确定结果').props.onClick(); });
  assert.equal(stored.size, 0); assert.equal(locked(), false);
  await act(async () => { button('关闭操作面板').props.onClick(); });
  assert.equal(closed(), 1); assert.equal(locked(), false);
  assert.equal(requests.filter(request => request.input?.action === 'CREATE').length, 1, 'recovery must never dispatch another interval');
}));
test('managed detail updates and releases exact current version; close-day uses settings hash and explicit no-auto-cancel confirmation', async () => withPanel(async ({ props, field, button, requests, confirmations, version, locked }) => {
  await props({ event: { id: 'calendar-block:91', blockId: '91', startAt: '2035-11-10T22:00Z', eventType: 'TIME_BLOCK' } });
  assert.equal(field('区间作用范围').props.disabled, true); assert.equal(field('区间资源').props.disabled, true);
  assert.equal(field('区间原因').props.value, 'Private synthetic reason');
  await act(async () => { field('区间原因').props.onChange({ target: { value: 'Private synthetic reason' } }); });
  assert.equal(locked(), false, 'an unchanged field must not introduce a phantom calendar lock');
  await act(async () => { button('解除区间').props.onClick(); });
  const release = requests.find(request => request.input?.action === 'RELEASE'); assert.equal(release.input.blockId, '91'); assert.equal(release.input.expectedVersion, 1);
  version(4); await props({ date: '2035-11-11' });
  await act(async () => { button('关闭当天').props.onClick(); });
  const close = requests.find(request => request.input?.action === 'CLOSE_DAY'); assert.equal(close.input.date, '2035-11-11'); assert.equal(close.input.expectedSettingsHash, '4'.padEnd(64, 'a')); assert.match(confirmations.at(-1).content, /停止接收新预约；已有预约不会自动取消/);
  assert.match(confirmations.at(-1).content, /全店.*所有技师与场地/);
  assert.match(confirmations.at(-1).content, /2035-11-11 全天，00:00 至次日 00:00/);
  assert.match(confirmations.at(-1).content, /America\/Los_Angeles/);
}));

test('reopen confirms the selected day, timezone and temporary source, submits once and refreshes in place', async () => withPanel(async ({ props, closure, button, requests, confirmations, gate, changed, locked }) => {
  closure({ startDate: '2035-11-09', endDate: '2035-11-12' });
  await props({ date: '2035-11-11' });
  const pending = deferred(); gate(pending);
  const reopen = button('恢复当天营业').props.onClick;
  await act(async () => { reopen(); reopen(); });
  const writes = requests.filter(request => request.input?.action === 'REOPEN_DAY');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].input.date, '2035-11-11');
  assert.equal(writes[0].input.expectedSettingsHash, '1'.padEnd(64, 'a'));
  assert.match(confirmations.at(-1).title, /2035-11-11/);
  assert.match(confirmations.at(-1).content, /America\/Los_Angeles/);
  assert.match(confirmations.at(-1).content, /2035-11-09.*2035-11-12/);
  assert.match(confirmations.at(-1).content, /其他/);
  assert.equal(locked(), true);
  closure(null);
  await act(async () => { pending.resolve({ shopId: '7', requestKey: writes[0].input.requestKey, action: 'REOPEN_DAY', outcome: 'COMMITTED', result: { blockId: null, version: null, closedDate: '2035-11-11' } }); });
  assert.equal(changed(), 1); assert.equal(locked(), false);
  assert.equal(button('关闭当天').props.disabled, false);
}));

test('closed event supports reopening without navigating to settings and revocation blocks a captured action', async () => withPanel(async ({ props, closure, button, permissions, requests }) => {
  closure({ startDate: '2035-11-10', endDate: '2035-11-12' });
  await props({ event: { id: 'closure:2035-11-10:2035-11-12', eventType: 'SHOP_CLOSURE', startAt: '2035-11-10T08:00:00Z', endAt: '2035-11-13T08:00:00Z' } });
  const reopen = button('恢复当天营业').props.onClick;
  await permissions(['BOOKINGS_READ']);
  await act(async () => { reopen(); });
  assert.equal(requests.some(request => request.input?.action === 'REOPEN_DAY'), false);
}));

test('unknown reopen stays locked across remount and committed reconciliation refreshes exactly once', async () => withPanel(async ({ props, closure, button, gate, remount, reconcileOutcome, requests, stored, locked, changed }) => {
  closure({ startDate: '2035-11-10', endDate: '2035-11-10' }); await props({ date: '2035-11-10', startTime: '10:00' });
  const pending = deferred(); gate(pending);
  await act(async () => { button('恢复当天营业').props.onClick(); });
  await act(async () => { pending.reject(new Error('timeout')); });
  const original = [...stored.values()][0]; assert.equal(locked(), true);
  await remount(); assert.equal([...stored.values()][0], original);
  reconcileOutcome('COMMITTED'); closure(null);
  await act(async () => { button('查询确定结果').props.onClick(); });
  assert.equal(stored.size, 0); assert.equal(locked(), false); assert.equal(changed(), 1);
  assert.equal(requests.filter(request => request.input?.action === 'REOPEN_DAY').length, 1);
}));
