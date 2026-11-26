import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterSalesApi, type AfterSalesCase, type CaseEvent } from '../api/afterSales';
import { shopStore } from '../stores/shop';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true }; return nextLoad(url, context); }"), import.meta.url);
const { default: AfterSalesManagement, CaseEventEntry } = await import('./AfterSalesManagement');

test('admin case list explains how customers submit a case and when operators record feedback offline', () => {
  const html = renderToStaticMarkup(<AfterSalesManagement />);
  assert.match(html, /请顾客登录后在对应预约中提交售后申请。/);
  assert.match(html, /电话或到店反馈若无法通过顾客账号提交，请先线下留档。/);
});

test('the admin timeline labels emitted events and preserves their visibility and content', () => {
  const event: CaseEvent = {
    id: '1',
    kind: 'CLAIMED',
    visibility: 'INTERNAL',
    content: null,
    fromStatus: 'OPEN',
    toStatus: 'IN_PROGRESS',
    createdAt: '2026-11-24T18:00:00Z',
    actorRole: 'ADMIN',
    actorId: '5',
  };
  const claimed = renderToStaticMarkup(<CaseEventEntry event={event} />);
  assert.ok(claimed.includes('工单已接手'));
  assert.ok(claimed.includes('平台 #5'));
  assert.ok(claimed.includes('内部备注'));
  assert.ok(claimed.includes('处理中'));
  assert.ok(!claimed.includes('工单记录已更新'));

  for (const [kind, label] of [
    ['CREATED', '工单已创建'],
    ['NOTE', '已添加备注'],
    ['ACCEPT', '已受理申请'],
    ['WAIT_FOR_CUSTOMER', '已请求顾客补充'],
    ['RESUME', '已继续处理'],
    ['REJECT', '已驳回申请'],
    ['RESOLVE', '工单已解决'],
    ['WITHDRAW', '申请已撤回'],
    ['REFUND_REQUESTED', '已提交退款请求'],
    ['REFUND_PENDING', '退款处理中'],
    ['REFUND_RETRYABLE', '退款待同步或重试'],
    ['REFUND_SUCCEEDED', '退款成功'],
    ['REFUND_FAILED', '退款失败'],
    ['REFUND_RECONCILIATION_REQUIRED', '退款结果待核实'],
    ['REFUND_CHECKED', '已核对退款记录'],
    ['REFUND_FUTURE', '退款状态已更新'],
    ['FUTURE_KIND', '工单记录已更新'],
  ]) {
    const output = renderToStaticMarkup(<CaseEventEntry event={{ ...event, kind, visibility: 'PUBLIC', content: '请补充资料 <原文>' }} />);
    assert.ok(output.includes(label), kind);
    assert.ok(output.includes('顾客可见'), kind);
    assert.ok(output.includes('请补充资料 &lt;原文&gt;'), kind);
  }
});

type Element = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const element = tree as Element;
  return predicate(element) ? element : find(element.props.children, predicate);
}

test('admin decisions can proceed without an optional reason and never publish a note draft', async t => {
  const previousShop = shopStore.currentStoreId;
  const before = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null, defaultView: {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const stamp = '2026-11-25T12:00:00Z';
  const booking = { id: '18', bookingNo: 'CASE-FIXTURE', status: 'CONFIRMED', paymentStatus: 'UNPAID', paidCents: 0, refundedCents: 0, currency: 'USD', shopName: 'Synthetic shop', serviceName: 'Synthetic service', timezone: 'America/Los_Angeles', localDate: '2026-11-26', localStartTime: '10:00' };
  let item: AfterSalesCase = {
    id: '7', shopId: '5', bookingId: booking.id, booking, type: 'COMPLAINT', status: 'OPEN', reason: 'Synthetic reason',
    requestedAmountCents: null, currency: 'USD', version: 1, refundState: 'NONE', createdAt: stamp, updatedAt: stamp,
    closedAt: null, allowedActions: ['NOTE', 'ACCEPT', 'REJECT'],
  };
  const listQueries: Record<string, unknown>[] = [];
  t.mock.method(afterSalesApi, 'list', async (query: Record<string, unknown>) => {
    listQueries.push(query);
    return { items: [item], total: 1, page: 1, pageSize: 20 };
  });
  t.mock.method(afterSalesApi, 'detail', async () => item);
  t.mock.method(afterSalesApi, 'events', async () => ({ items: [], total: 0, page: 1, pageSize: 30 }));
  const writes: unknown[] = [];
  t.mock.method(afterSalesApi, 'write', async (_item: AfterSalesCase, operation: string, payload: Record<string, unknown>) => {
    writes.push({ operation, payload });
    const waiting = payload.action === 'WAIT_FOR_CUSTOMER';
    item = { ...item, version: item.version + 1, status: waiting ? 'WAITING_CUSTOMER' : 'IN_PROGRESS', allowedActions: ['NOTE', 'REJECT', ...(waiting ? ['RESUME'] : ['WAIT_FOR_CUSTOMER', 'RESOLVE'])] };
    return item;
  });
  let tree: unknown;
  let clearedOrderFilter = 0;
  function DetailProbe({ detail }: { detail: Element }) {
    tree = (detail.type as React.FunctionComponent<Record<string, any>>)(detail.props);
    return null;
  }
  function Probe() {
    const page = AfterSalesManagement({ initialQuery: { shopId: '5', bookingId: '18' }, onClearOrderFilter: () => { clearedOrderFilter++; } });
    if (typeof page.type === 'function') return <DetailProbe detail={page} />;
    tree = page;
    return null;
  }
  function control(predicate: (element: Element) => boolean) {
    const element = find(tree, predicate);
    assert.ok(element);
    return element;
  }
  const button = (label: string) => control(element => element.type === 'button' && element.props.children === label);
  const change = (element: Element, value: string) => act(async () => { element.props.onChange({ target: { value } }); });
  const select = (value: string) => change(control(element => element.props['aria-label'] === '处理决定'), value);
  const submit = () => button('提交处理决定');
  const reason = () => control(element => element.type === 'textarea' && element.props['aria-label'] !== '备注内容');
  const notes = () => control(element => element.props['aria-label'] === '备注内容');
  try {
    shopStore.currentStoreId = '5';
    await act(async () => { root.render(<Probe />); });
    assert.equal(listQueries.at(-1)?.shopId, '5');
    assert.equal(listQueries.at(-1)?.bookingId, '18');
    assert.ok(find(tree, node => typeof node.props.children === 'string' && node.props.children.startsWith('当前仅显示来源订单')));
    await act(async () => { shopStore.currentStoreId = '6'; });
    assert.equal(listQueries.at(-1)?.shopId, '6');
    assert.equal(listQueries.at(-1)?.bookingId, undefined, 'the source booking ID does not cross store boundaries');
    await act(async () => { shopStore.currentStoreId = '5'; });
    await act(async () => { button('重置').props.onClick(); });
    assert.equal(clearedOrderFilter, 1);
    assert.equal(listQueries.at(-1)?.shopId, '5');
    assert.equal(listQueries.at(-1)?.bookingId, undefined, 'clearing the exact booking retains the selected shop');
    await act(async () => { button('查看与处理').props.onClick(); });
    await change(notes(), 'Internal draft only');
    await select('ACCEPT');
    assert.equal(reason().props.required, false);
    assert.equal(submit().props.disabled, false);
    await act(async () => { await submit().props.onClick(); });
    assert.deepEqual(writes, [{ operation: 'transition', payload: { action: 'ACCEPT' } }]);
    assert.equal(notes().props.value, 'Internal draft only');

    for (const action of ['REJECT', 'RESOLVE', 'WAIT_FOR_CUSTOMER']) {
      await select(action);
      assert.equal(reason().props.required, true);
      assert.equal(submit().props.disabled, true);
    }
    await change(reason(), '   ');
    assert.equal(submit().props.disabled, true);
    await change(reason(), '  Please confirm the appointment details.  ');
    await act(async () => { await submit().props.onClick(); });
    assert.deepEqual(writes.at(-1), { operation: 'transition', payload: { action: 'WAIT_FOR_CUSTOMER', reason: 'Please confirm the appointment details.' } });
    assert.equal(notes().props.value, 'Internal draft only');

    await select('RESUME');
    assert.equal(reason().props.required, false);
    assert.equal(submit().props.disabled, false);
    await act(async () => { await submit().props.onClick(); });
    assert.deepEqual(writes.at(-1), { operation: 'transition', payload: { action: 'RESUME' } });
    assert.equal(writes.length, 3);
  } finally {
    await act(async () => { root.unmount(); });
    shopStore.currentStoreId = previousShop;
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
