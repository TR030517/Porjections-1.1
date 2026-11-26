import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import React, { act, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Mount the actual CalendarWorkspace and CalendarActionsPanel together. Only the
// design-system shell is replaced; hooks, stores, models, API parsers, request
// cancellation, draft guard and parent lock propagation are the product code.
const shell = `import React from 'react';
const element = (tag, props, children = props.children) => {
  const forwarded = Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('aria-') || key.startsWith('data-') || ['className','hidden','disabled','value','onChange','onClick','type','checked','name','min','max','placeholder'].includes(key)));
  return React.createElement(tag, { ...forwarded, ref: node => { if (node) node.__calendarShellProps = props; } }, children);
};
export const Button = props => element('button', props);
export const Input = props => element('input', props); Input.TextArea = props => element('textarea', props);
export const Select = props => element('select', props);
export const Card = props => element('section', props, React.createElement(React.Fragment, null, props.title, props.children));
export const Space = props => element('div', props);
export const Tag = props => element('span', props);
export const Spin = () => null;
export const Empty = props => element('div', props, props.description); Empty.PRESENTED_IMAGE_SIMPLE = null;
export const Alert = props => element('section', props, React.createElement(React.Fragment, null, props.title, props.description, props.action));
export const Drawer = props => element('aside', { ...props, 'data-calendar-drawer': true, hidden: !props.open }, React.createElement(React.Fragment, null, props.title, props.children));
const modal = { confirm: async options => { globalThis.__calendarConfirmations.push(options); return true; }, info() {} };
export const Modal = { useModal: () => [modal, null] };
`;
const icons = 'export const LeftOutlined = () => null; export const RightOutlined = () => null; export const ReloadOutlined = () => null;';
function fakeDocument() {
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  class Node {
    constructor(tag, type = 1, text = '') { this.nodeType = type; this.nodeName = tag.toUpperCase(); this.tagName = this.nodeName; this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value; } }; this._text = text; this.value = ''; this.checked = false; this.disabled = false; }
    appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
    insertBefore(child, next) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(next), 0, child); return child; }
    removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener() {} removeEventListener() {}
    get textContent() { return this._text + this.childNodes.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.childNodes = []; }
    get firstChild() { return this.childNodes[0] ?? null; }
    get options() { return this.childNodes; }
  }
  doc.createElement = tag => new Node(tag); doc.createElementNS = (_, tag) => new Node(tag); doc.createTextNode = text => new Node('#text', 3, text);
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  return { doc, win, container: new Node('div') };
}
function nodes(root, predicate, found = []) { if (predicate(root)) found.push(root); root.childNodes?.forEach(node => nodes(node, predicate, found)); return found; }
const propsOf = node => node?.__calendarShellProps ?? node?.[Object.keys(node).find(key => key.startsWith('__reactProps$'))] ?? {};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const date = '2035-11-10', zone = 'America/Los_Angeles';

async function withWorkspace(run, { legacyBooking = false, temporaryClosure = false } = {}) {
  const keys = ['window', 'sessionStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT', '__calendarConfirmations'];
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])), oldAdapter = axios.defaults.adapter;
  const { win, container } = fakeDocument(), stored = new Map(), requests = [], blocks = new Map(), blockIds = new Map(), opened = [], locks = [];
  const confirmations = []; Object.defineProperty(globalThis, '__calendarConfirmations', { configurable: true, value: confirmations });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } });
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let gate, auth, context, root, router, shopUtc, shopLocal, currentShop = '7', actor = '1', reconciliation = 'NOT_EXECUTED', lastCommand, setEpoch;
  const permissions = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'RESERVATION_CONFIG'];
  const shop = id => ({ id, name: `Synthetic shop ${id}`, timezone: zone, permissions, accessType: 'ADMIN', isOwner: true });
  const committed = (input, shopId) => {
    if (!input.blockId && !blockIds.has(input.requestKey)) blockIds.set(input.requestKey, String(91 + blockIds.size));
    return { shopId, requestKey: input.requestKey, action: input.action, outcome: 'COMMITTED', result: { blockId: input.blockId ?? blockIds.get(input.requestKey), version: input.expectedVersion ? input.expectedVersion + 1 : 1, closedDate: null } };
  };
  const apply = (input, shopId) => {
    const receipt = committed(input, shopId);
    const old = blocks.get(receipt.result.blockId);
    blocks.set(receipt.result.blockId, { id: receipt.result.blockId, shopId, timezone: zone, purpose: input.purpose ?? old?.purpose, scope: input.scope ?? old?.scope, resourceId: input.resourceId ?? old?.resourceId ?? null, startAt: input.startLocal ? shopUtc(input.startLocal, zone) : old?.startAt, endAt: input.endLocal ? shopUtc(input.endLocal, zone) : old?.endAt, reason: input.reason ?? old?.reason, status: input.action === 'RELEASE' ? 'RELEASED' : 'ACTIVE', version: receipt.result.version, operator: { id: actor, name: 'Synthetic operator' } });
    return receipt;
  };
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    const input = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    requests.push({ url: config.url, params: config.params, method: config.method, input });
    if (config.url === '/merchant/shops') return response([shop('7'), shop('8')]);
    const shopId = config.url.match(/\/shops\/([^/]+)/)?.[1];
    if (config.url.endsWith('/calendar-events')) {
      const { startDate, endDate } = config.params;
      const rows = [...blocks.values()].filter(block => block.shopId === shopId && block.status === 'ACTIVE' && shopLocal(block.startAt, zone).slice(0, 10) >= startDate && shopLocal(block.startAt, zone).slice(0, 10) < endDate).map(block => ({ id: `calendar-block:${block.id}`, blockId: block.id, eventType: block.purpose, bookingId: null, itemId: null, title: 'Synthetic interval', status: 'ACTIVE', startAt: block.startAt, endAt: block.endAt, serviceStartAt: null, serviceEndAt: null, resources: [], allDay: false }));
      if (legacyBooking && startDate <= date && date < endDate) rows.push({ id: 'booking:41', bookingId: '41', itemId: null, eventType: 'BOOKING', title: 'Synthetic legacy booking', status: 'CONFIRMED', startAt: shopUtc(date + 'T13:00', zone), endAt: shopUtc(date + 'T13:30', zone), serviceStartAt: null, serviceEndAt: null, resources: [], allDay: false, occupancySource: 'LEGACY_SERVICE' });
      if (temporaryClosure && startDate <= '2035-11-12' && endDate > '2035-11-09') rows.push({ id: 'closure:range', bookingId: null, itemId: null, eventType: 'SHOP_CLOSURE', title: 'Synthetic temporary closure', status: 'CLOSED', startAt: shopUtc('2035-11-09T00:00', zone), endAt: shopUtc('2035-11-13T00:00', zone), serviceStartAt: null, serviceEndAt: null, resources: [], allDay: true });
      return response({ shopId, timezone: zone, serverNow: new Date().toISOString(), range: { startDate, endDate, startAt: shopUtc(startDate + 'T00:00', zone), endAt: shopUtc(endDate + 'T00:00', zone) }, version: 'synthetic-range', complete: true, nextCursor: null, events: rows, resources: [] });
    }
    if (config.url.endsWith('/options')) {
      const closure = temporaryClosure && config.params.date >= '2035-11-09' && config.params.date <= '2035-11-12' ? { startDate: '2035-11-09', endDate: '2035-11-12' } : null;
      return response({ shopId, date: config.params.date, timezone: zone, settingsHash: 'a'.repeat(64), closed: closure !== null, temporaryClosure: closure, resources: [] });
    }
    if (config.url.includes('/blocks/')) return response(blocks.get(config.url.split('/').at(-1)));
    if (config.url.endsWith('/reconcile')) return response(reconciliation === 'COMMITTED' ? apply(lastCommand, shopId) : { shopId, requestKey: config.url.split('/').at(-2), outcome: reconciliation });
    if (config.method === 'post' && config.url.endsWith('/calendar-actions')) { lastCommand = input; if (gate) await gate.promise; return response(apply(input, shopId)); }
    throw new Error(`Unexpected request ${config.url}`);
  };
  const vite = await createServer({ configFile: false, resolve: { dedupe: ['react', 'react-dom'] }, ssr: { noExternal: ['antd', '@ant-design/icons'] }, plugins: [react(), { name: 'calendar-design-system-shell', enforce: 'pre', resolveId(id) { if (id === 'antd' || id === '@ant-design/icons') return '\0calendar-shell:' + id; }, load(id) { if (id === '\0calendar-shell:antd') return shell; if (id === '\0calendar-shell:@ant-design/icons') return icons; } }], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const transport = await vite.ssrLoadModule('/src/api/client.ts');
    const { useShopId } = await vite.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await vite.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const Calendar = (await vite.ssrLoadModule('/src/pages/bookings/BookingCalendar.tsx')).default;
    ({ shopUtc, shopLocal } = await vite.ssrLoadModule('/src/utils/reservationTime.ts'));
    function Workspace() {
      const [locked, setLocked] = useState(false);
      const lock = useCallback(value => { locks.push(value); setLocked(value); }, []);
      return React.createElement(React.Fragment, null,
        ...['刷新', '预约通知邮箱', '新增预约', '工作区视图'].map(label => React.createElement('button', { key: label, 'data-parent': label, disabled: locked }, label)),
        React.createElement(Calendar, { shopId: context.shopId, shopName: context.shop.name, timezone: zone, disabled: false, revision: 0, onOpenBooking: id => opened.push(id), onAssisted() {}, onActionLockChange: lock }));
    }
    function Probe() { const [epoch, set] = useState(0); setEpoch = set; context = useShopId(); return context.shop ? React.createElement(MerchantDraftGuard, null, React.createElement(Workspace, { key: `${actor}:${context.shopId}:${epoch}` })) : null; }
    transport.beginSession(); auth.getState().setAuth('synthetic-only', { id: actor, role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(Probe) }], { initialEntries: ['/bookings?shopId=7'] }); root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const find = predicate => nodes(container, node => node.nodeType === 1 && predicate(propsOf(node), node))[0];
    const field = label => { const node = find(props => props['aria-label'] === label); assert.ok(node, label); return propsOf(node); };
    const button = label => { const node = find((props, node) => node.tagName === 'BUTTON' && node.textContent === label); assert.ok(node, label); return propsOf(node); };
    const change = async (label, value) => { await act(async () => { const node = find(props => props['aria-label'] === label); assert.ok(node, label); propsOf(node).onChange(node.tagName === 'SELECT' ? value : { target: { value } }); }); };
    const click = async label => { await act(async () => { button(label).onClick(); }); };
    const choose = async next => { const node = find(props => props['aria-label']?.startsWith(`${Number(next.slice(5, 7))}月${Number(next.slice(8))}日 `)); assert.ok(node, next); await act(async () => { propsOf(node).onClick(); }); };
    const parentsDisabled = value => { for (const node of nodes(container, node => propsOf(node)['data-parent'])) assert.equal(propsOf(node).disabled, value, node.textContent); assert.equal(field('日历视图').disabled, value); assert.equal(field('日历日期').disabled, value); assert.equal(button('重载范围').disabled, value); };
    await change('日历日期', date);
    await run({ find, field, button, click, change, choose, parentsDisabled, container, requests, blocks, stored, opened, locks, confirmations, gate(value) { gate = value; }, reconcile(value) { reconciliation = value; }, async remount() { await act(async () => { setEpoch(value => value + 1); }); }, async boundary({ shopId = currentShop, actorId = actor } = {}) { await act(async () => { currentShop = shopId; actor = actorId; transport.beginSession(); auth.getState().logout(); auth.getState().setAuth('synthetic-next', { id: actor, role: 'ADMIN' }); await router.navigate(`/bookings?shopId=${currentShop}`); }); } });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await vite.close(); axios.defaults.adapter = oldAdapter;
    for (const key of keys) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
}

test('real calendar/operation parent chain opens a drawer, labels SHOP scope and stays unlocked across two committed actions', async () => withWorkspace(async ({ choose, find, click, change, parentsDisabled, requests, container, button, blocks }) => {
  await choose(date);
  const drawer = find(props => props['data-calendar-drawer']);
  assert.ok(drawer, 'date actions must open in a drawer rather than below the full month');
  assert.equal(propsOf(drawer).open, true);
  await click('登记内部占用'); parentsDisabled(true);
  await change('区间原因', 'Synthetic internal meeting');
  const save = button('保存日历区间').onClick; await act(async () => { save(); save(); }); parentsDisabled(false);
  assert.ok(container.textContent.includes('日历区间已保存。'));
  const summaries = nodes(container, node => propsOf(node).className === 'booking-calendar-event-resources');
  assert.ok(summaries.some(node => node.textContent === '全店'), 'SHOP occupancy must be labelled as a whole-store interval');
  assert.equal(summaries.some(node => node.textContent === '未分配资源'), false);
  assert.equal(propsOf(drawer).open, true, 'save keeps the selected date in the drawer');
  await click('关闭操作面板'); parentsDisabled(false);
  assert.equal(propsOf(find(props => props['data-calendar-drawer'])).open, false);
  await choose('2035-11-11'); await click('屏蔽这个时段'); await change('区间原因', 'Synthetic second action'); await click('保存日历区间'); parentsDisabled(false);
  assert.equal(requests.filter(request => request.input?.action === 'CREATE').length, 2);
  assert.equal(blocks.size, 2, 'the first committed event remains after creating on a second date');
  assert.equal(button('关闭操作面板').disabled, false);
}));

test('local validation failure leaves a correctable draft and releases protection only on explicit discard', async () => withWorkspace(async ({ choose, click, change, parentsDisabled, requests, container }) => {
  await choose(date); await click('登记内部占用'); await change('区间原因', 'Synthetic invalid interval');
  await change('区间结束时间', date + 'T08:00'); await click('保存日历区间');
  parentsDisabled(true); assert.equal(requests.some(request => request.method === 'post'), false);
  assert.ok(container.textContent.includes('结束'), 'validation must explain the interval error');
  await change('区间结束时间', date + 'T10:00'); await click('保存日历区间'); parentsDisabled(false);
  assert.equal(requests.filter(request => request.input?.action === 'CREATE').length, 1);
}));

test('409 is retained until fenced reconciliation and explicit discard, without changing the original command', async () => withWorkspace(async ({ choose, click, change, parentsDisabled, gate, stored, field, requests }) => {
  await choose(date); await click('屏蔽这个时段'); await change('区间原因', 'Synthetic conflict draft');
  const pending = deferred(); gate(pending); await click('保存日历区间');
  await act(async () => { pending.reject(new AxiosError('Synthetic version conflict', 'ERR_BAD_RESPONSE', {}, null, { status: 409, data: {} })); });
  const marker = [...stored.values()][0]; assert.ok(marker); parentsDisabled(true);
  await click('查询确定结果'); parentsDisabled(true);
  assert.equal(JSON.parse([...stored.values()][0]).command.requestKey, JSON.parse(marker).command.requestKey);
  await click('放弃未执行请求'); parentsDisabled(true);
  assert.equal(field('区间原因').value, 'Synthetic conflict draft'); assert.equal(stored.size, 0);
  await click('放弃修改并关闭'); parentsDisabled(false);
  assert.equal(requests.filter(request => request.input?.action === 'CREATE').length, 1);
}));

test('drawer chrome cannot bypass dirty protection; explicit discard clears only the unsaved draft', async () => withWorkspace(async ({ choose, find, click, change, parentsDisabled, requests, confirmations }) => {
  await choose(date); await click('登记内部占用'); await change('区间原因', 'Synthetic draft'); parentsDisabled(true);
  const drawer = propsOf(find(props => props['data-calendar-drawer']));
  assert.ok(drawer, 'drawer must exist'); assert.equal(drawer.closable, false); assert.equal(drawer.keyboard, false); assert.equal(drawer.mask?.closable ?? drawer.maskClosable, false);
  await click('放弃修改并关闭'); parentsDisabled(false);
  assert.match(confirmations.at(-1).title, /放弃/);
  assert.equal(requests.some(request => request.method === 'post'), false);
  await choose('2035-11-11'); assert.equal(propsOf(find(props => props['data-calendar-drawer'])).open, true);
}));

test('whole-store internal occupancy is distinct from a booking with unrecorded resources', async () => withWorkspace(async ({ choose, click, change, container }) => {
  await choose(date); await click('登记内部占用'); await change('区间原因', 'Synthetic whole-store event'); await click('保存日历区间');
  const summaries = nodes(container, node => propsOf(node).className === 'booking-calendar-event-resources');
  assert.ok(summaries.some(node => node.textContent === '全店'), 'the complete date range must label a SHOP interval 全店');
  assert.ok(summaries.some(node => node.textContent === '未分配资源'), 'a legacy booking without recorded allocation must not be relabelled as a SHOP block');
}, { legacyBooking: true }));

test('managed event update and release synchronize the selected summary and parent lock without refreshing the page', async () => withWorkspace(async ({ choose, click, change, find, parentsDisabled, blocks, requests }) => {
  await choose(date); await click('登记内部占用'); await change('区间原因', 'Synthetic first revision'); await click('保存日历区间'); await click('关闭操作面板');
  const openInterval = async () => { const node = find(props => props.className?.includes('booking-calendar-event--internal_occupancy')); assert.ok(node); await act(async () => { propsOf(node).onClick(); }); };
  await openInterval(); await change('区间原因', 'Synthetic revised interval'); parentsDisabled(true); await click('保存区间修改'); parentsDisabled(false);
  assert.equal(blocks.get('91').version, 2); await click('关闭操作面板');
  await openInterval(); await click('解除区间'); parentsDisabled(false);
  assert.equal(blocks.get('91').version, 3); assert.equal(blocks.get('91').status, 'RELEASED');
  assert.equal(find(props => props['aria-label'] === '非订单事件详情'), undefined, 'released event must leave the selected snapshot after a complete reload');
  await choose('2035-11-11'); parentsDisabled(false);
  assert.deepEqual(requests.filter(request => request.url.endsWith('/calendar-actions')).map(request => request.input.action), ['CREATE', 'UPDATE', 'RELEASE']);
}));

for (const view of ['month', 'week', 'day', 'list']) test(`a multi-day closure card preserves its displayed middle day in ${view} view`, async () => withWorkspace(async ({ change, find, requests, confirmations, click }) => {
  await change('日历视图', view);
  const day = find((props, node) => {
    if (view === 'month') return props.className?.includes('booking-calendar-month-day') && nodes(node, child => propsOf(child)['aria-label']?.startsWith('11月10日 ')).length > 0;
    return props.className?.includes('booking-calendar-day-section') && node.textContent.startsWith('11月10日 ');
  });
  assert.ok(day, 'the selected middle-day calendar section is rendered');
  const card = nodes(day, node => propsOf(node).className?.includes('booking-calendar-event--shop_closure'))[0];
  assert.ok(card, 'the original multi-day closure is displayed on this date');
  await act(async () => { propsOf(card).onClick(); });
  assert.equal(requests.filter(request => request.url.endsWith('/options')).at(-1).params.date, date, 'options must use the clicked day, not the original closure start');
  await click('恢复当天营业');
  assert.match(confirmations.at(-1).title, /2035-11-10/);
  assert.equal(requests.find(request => request.input?.action === 'REOPEN_DAY')?.input.date, date);
}, { temporaryClosure: true }));

test('503 keeps the original operation and both parent/child locks through close attempts and recovery remount', async () => withWorkspace(async ({ choose, click, change, button, parentsDisabled, gate, stored, requests, find, remount, reconcile }) => {
  await choose(date); const staleClose = button('关闭操作面板').onClick;
  await click('登记内部占用'); await change('区间原因', 'Synthetic uncertain write');
  const pending = deferred(); gate(pending); await click('保存日历区间'); parentsDisabled(true);
  await act(async () => { pending.reject(new AxiosError('Synthetic 503', 'ERR_BAD_RESPONSE', {}, null, { status: 503, data: {} })); });
  const marker = [...stored.values()][0]; assert.ok(marker); parentsDisabled(true);
  await act(async () => { staleClose(); }); assert.equal([...stored.values()][0], marker); parentsDisabled(true);
  await remount(); parentsDisabled(true); assert.equal(propsOf(find(props => props['data-calendar-drawer'])).open, true);
  reconcile('COMMITTED'); gate(undefined); await click('查询确定结果'); parentsDisabled(false);
  assert.equal(stored.size, 0); assert.equal(requests.filter(request => request.input?.action === 'CREATE').length, 1);
}));

for (const boundary of [{ shopId: '8' }, { actorId: '2' }]) test(`retired operation callbacks cannot relock or submit in a new ${boundary.shopId ? 'shop' : 'actor'} workspace`, async () => withWorkspace(async ({ choose, click, change, button, parentsDisabled, gate, boundary: switchBoundary, stored, requests }) => {
  await choose(date); await click('登记内部占用'); await change('区间原因', 'Synthetic retired operation');
  const staleSave = button('保存日历区间').onClick, pending = deferred(); gate(pending); await click('保存日历区间');
  await switchBoundary(boundary); parentsDisabled(false);
  await act(async () => { pending.resolve(); }); parentsDisabled(false);
  await act(async () => { staleSave(); });
  assert.equal(requests.filter(request => request.input?.action === 'CREATE').length, 1);
  assert.equal(stored.size, 1, 'retired command remains available only to its original actor/shop');
}));
