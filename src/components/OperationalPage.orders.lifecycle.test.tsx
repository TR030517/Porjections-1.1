import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import { operations } from '../config/operations';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: OperationalPage } = await import('./OperationalPage');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node;
  return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}

test('admin orders retain shop calendar filters, currency, and cross-midnight timestamp details', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic order admin' };
  let order: Record<string, unknown> = {
    id: '42', shopId: '5', orderNo: 'SYNTHETIC-42', storeName: 'Synthetic store', customerName: 'Synthetic customer',
    status: 'PENDING', paymentStatus: 'UNPAID', currency: 'usd', durationKind: 'TIMED', durationMin: 60,
    bookingDate: '2026-11-06', localStartTime: '23:00', localEndTime: '00:00', shopTimezone: 'America/Los_Angeles',
    startTime: '2026-11-07T07:00:00Z', endTime: '2026-11-07T08:00:00Z',
    priceCents: 10025, totalCents: 10025, paidCents: 0, refundedCents: 0,
    createdAt: '2026-11-07T07:04:05Z', updatedAt: '2026-11-07T08:04:06Z',
  };
  const queries: URLSearchParams[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://synthetic.test');
    if (url.pathname.endsWith('/auth/refresh') || url.pathname.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (url.pathname.endsWith('/auth/me')) return Response.json(identity);
    assert.equal(url.pathname, '/api/v1/studio/service-orders');
    assert.equal(options?.method ?? 'GET', 'GET', 'this order list regression cannot issue a mutation');
    queries.push(url.searchParams);
    return Response.json({ items: [structuredClone(order)], total: 51, page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) });
  };
  clearSession();
  let tree: unknown;
  const openedAfterSales: Array<{ shopId: string; bookingId: string }> = [];
  function Probe() {
    tree = OperationalPage({ config: operations['service-orders'], explicitShopId: '5', onOpenOrderAfterSales: target => openedAfterSales.push(target) });
    return null;
  }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Node) => boolean) => { const found = find(tree, predicate); assert.ok(found, 'expected order control exists'); return found; };
  const button = (label: string) => control(node => node.type === 'button' && text(node).trim() === label);
  const field = (label: string) => {
    const wrapper = control(node => node.type === 'label' && find(node.props.children, child => child.type === 'span' && text(child) === label) !== undefined);
    const input = find(wrapper.props.children, node => node.type === 'input' || node.type === 'select');
    assert.ok(input); return input;
  };
  const change = (label: string, value: string) => act(async () => { field(label).props.onChange({ target: { value } }); });
  const submit = () => act(async () => { control(node => node.type === 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} }); });
  try {
    // Only the actual component hooks and returned controls are rendered;
    // descendants are left unmounted and all API responses are synthetic.
    await act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
    assert.equal(queries.at(-1)?.get('shopId'), '5');
    assert.match(text(tree), /23:00\s*–\s*2026-11-07 00:00/);
    assert.match(text(tree), /100\.25 USD/);
    await act(async () => { button('查看详情').props.onClick(); });
    const dialog = control(node => node.props.role === 'dialog');
    assert.match(text(dialog), /创建时间（门店当地）\s+2026-11-06 23:04:05 · America\/Los_Angeles/);
    assert.match(text(dialog), /更新时间（门店当地）\s+2026-11-07 00:04:06 · America\/Los_Angeles/);
    assert.doesNotMatch(text(dialog), /本机时间/);

    await change('关键词', '  SYNTHETIC-42  ');
    await change('预约日期从', '2026-11-06'); await change('预约日期至', '2026-11-06');
    await change('预约状态', 'PENDING'); await change('支付状态', 'UNPAID');
    await submit();
    assert.deepEqual(Object.fromEntries(queries.at(-1)!), { page: '1', pageSize: '25', search: 'SYNTHETIC-42', status: 'PENDING', paymentStatus: 'UNPAID', startDate: '2026-11-06', endDate: '2026-11-06', shopId: '5' });
    assert.equal(find(tree, node => node.props.role === 'dialog'), undefined, 'applying filters retires the previous detail snapshot');
    await act(async () => { control(node => node.props['aria-label'] === '下一页').props.onClick(); });
    assert.equal(queries.at(-1)?.get('page'), '2');
    assert.equal(queries.at(-1)?.get('startDate'), '2026-11-06', 'paging preserves the submitted shop calendar day');
    const count = queries.length;
    await change('预约日期至', '2026-11-05'); await submit();
    assert.equal(queries.length, count, 'an inverted range cannot issue a request');
    assert.match(text(control(node => node.props.role === 'alert')), /结束日期不能早于开始日期/);
    await act(async () => { button('重置').props.onClick(); });
    assert.deepEqual(Object.fromEntries(queries.at(-1)!), { page: '1', pageSize: '25', shopId: '5' });
    for (const label of ['关键词', '预约日期从', '预约日期至', '预约状态', '支付状态']) assert.equal(field(label).props.value, '');

    order = { ...order, shopTimezone: null, currency: null };
    await act(async () => { button('刷新').props.onClick(); });
    await act(async () => { button('查看详情').props.onClick(); });
    const historical = control(node => node.props.role === 'dialog');
    assert.match(text(historical), /2026-11-07T07:04:05\.000Z UTC（预约时区未提供或无效）/);
    assert.match(text(historical), /100\.25（币种未提供）/);
    const oldActions = control(node => typeof node.type === 'function' && node.type.name === 'BookingReservationActions');
    await act(async () => { control(node => node.props['aria-label'] === '关闭订单详情').props.onClick(); });
    await act(async () => { button('查看详情').props.onClick(); });
    const requestsBefore = queries.length;
    await act(async () => {
      oldActions.props.onUpdated({ ...order, id: '42', status: 'CANCELLED', timezone: 'America/Los_Angeles', items: [] });
      oldActions.props.onBusyChange(true); oldActions.props.onDirtyChange(true); oldActions.props.onUnknownChange(true);
    });
    assert.equal(queries.length, requestsBefore, 'the retired detail cannot trigger a list reload');
    assert.equal(control(node => node.props['aria-label'] === '关闭订单详情').props.disabled, false, 'retired busy/dirty/unknown notifications cannot lock a reopened detail');
    assert.match(text(control(node => node.props.role === 'dialog')), /待确认/);
    const currentActions = control(node => typeof node.type === 'function' && node.type.name === 'BookingReservationActions');
    const relatedAfterSales = () => button('查看关联售后工单');
    assert.equal(relatedAfterSales().props.disabled, true, 'the order list snapshot must not activate the after-sales link');
    await act(async () => { currentActions.props.onSnapshot({ ...order, shopId: '6', timezone: 'America/Los_Angeles', items: [] }); });
    assert.equal(relatedAfterSales().props.disabled, true, 'a different shop must not activate the link');
    await act(async () => { currentActions.props.onUpdated({ ...order, id: 'other-order', status: 'CANCELLED', timezone: 'America/Los_Angeles', items: [] }); });
    assert.equal(queries.length, requestsBefore, 'a mismatched result cannot update the current detail');
    await act(async () => { currentActions.props.onSnapshot({ ...order, id: '42', status: 'CONFIRMED', timezone: 'America/Los_Angeles', items: [] }); });
    assert.equal(queries.length, requestsBefore, 'a validated initial snapshot updates the header without needless list reads');
    assert.match(text(control(node => node.props.role === 'dialog')), /已确认/);
    assert.equal(relatedAfterSales().props.disabled, false);
    const oldLink = relatedAfterSales().props.onClick;
    for (const state of ['onBusyChange', 'onDirtyChange', 'onUnknownChange']) {
      await act(async () => { currentActions.props[state](true); oldLink(); });
      assert.equal(relatedAfterSales().props.disabled, true);
      await act(async () => { currentActions.props[state](false); });
    }
    assert.deepEqual(openedAfterSales, [], 'pending writes, drafts and uncertain outcomes all block the callback synchronously');
    await act(async () => { oldLink(); });
    assert.deepEqual(openedAfterSales, [{ shopId: '5', bookingId: '42' }]);
    await act(async () => { currentActions.props.onSnapshot({ ...order, id: '42', status: 'CANCELLED', cancelReason: null, timezone: 'America/Los_Angeles', items: [] }); });
    assert.match(text(control(node => node.props.role === 'dialog')), /取消原因\s+未记录取消原因/);
    await act(async () => { currentActions.props.onUpdated({ ...order, id: '42', status: 'CANCELLED', cancelReason: '顾客来电改约', timezone: 'America/Los_Angeles', items: [] }); });
    assert.match(text(control(node => node.props.role === 'dialog')), /取消原因\s+顾客来电改约/);
    await act(async () => { control(node => node.props['aria-label'] === '关闭订单详情').props.onClick(); });
    await act(async () => { button('查看详情').props.onClick(); oldLink(); });
    assert.equal(openedAfterSales.length, 1, 'events captured by an old drawer cannot launch after-sales after reopening');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    for (const [key, previous] of [['window', previousWindow], ['document', previousDocument], ['IS_REACT_ACT_ENVIRONMENT', previousAct]] as const) {
      if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
