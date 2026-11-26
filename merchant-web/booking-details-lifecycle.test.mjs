import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Form, Input, Modal, Drawer, Descriptions } from 'antd';
import { createServer } from 'vite';

const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find([tree.props.children, tree.props.action, tree.props.items?.map(item => item.children)], predicate);
};
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

async function withOrder(run, options = {}) {
  const previous = Object.fromEntries(['window', 'IS_REACT_ACT_ENVIRONMENT', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAdapter = axios.defaults.adapter, oldForm = Form.useForm, oldWatch = Form.useWatch, oldModal = Modal.useModal;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const stored = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Form.useForm = () => [React.useMemo(() => { let values = {}; return { getFieldValue: name => values[name], setFieldsValue: patch => { values = { ...values, ...patch }; }, setFieldValue: (name, value) => { values[name] = value; }, resetFields: () => { values = {}; } }; }, [])];
  Form.useWatch = (name, form) => form.getFieldValue(name);
  const confirmations = [], writes = [], reconciliations = [];
  Modal.useModal = () => [React.useMemo(() => ({ confirm: options => {
    const gate = deferred();
    const confirmation = { ...gate, options };
    confirmations.push(confirmation);
    return Object.assign(gate.promise, { update: patch => Object.assign(confirmation.options, patch) });
  }, info() {} }), []), null];
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let root, router, auth, tree, context, updated = 0, closed = 0, writeGate, readFailure = false, wrongIdentity = false, shown = true, outcome = 'NOT_EXECUTED', receiptPatch = {}, reconcileGate, mismatchedSnapshot = options.mismatchedSnapshot ?? false, snapshotPatch = {}, bookingReadPatch = {}, readGate, selectedId = '42';
  const reads = [];
  const shops = [{ id: '5', name: 'Synthetic lifecycle shop', timezone: 'America/Los_Angeles', permissions: options.permissions ?? ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD'], accessType: options.role === 'ADMIN' ? 'ADMIN' : 'OWN', isOwner: true }];
  const booking = { id: '42', shopId: '5', bookingNo: 'SYNTHETIC-42', orderOnly: true, onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER', paymentMode: 'PAY_AT_STORE', status: 'PENDING', paymentStatus: 'UNPAID', currency: 'usd', durationMin: 60, durationKind: 'TIMED', reservedDurationMin: 60, startTime: '2035-11-07T18:00:00Z', endTime: '2035-11-07T19:00:00Z', timezone: 'America/Los_Angeles', localDate: '2035-11-07', localStartTime: '10:00', localEndTime: '11:00', holdExpiresAt: null, items: [], addOns: [], priceCents: 10025, totalCents: 10025, paidCents: 0, refundedCents: 0, ...options.booking };
  const summary = { bookingId: '42', shopId: '5', orderOnly: true, onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER', paymentMode: 'PAY_AT_STORE', currency: 'usd', status: 'PENDING', paymentStatus: 'UNPAID', totalCents: 10025, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 10025, entries: [], allowedActions: { confirm: true, complete: false, cancel: true, recordReceipt: true, recordRefund: false }, ...options.summary };
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(structuredClone(shops));
    if (config.url.includes('/operations/') && config.url.endsWith('/reconcile')) {
      reconciliations.push({ url: config.url });
      const key = config.url.split('/operations/')[1].split('/')[0];
      return response(reconcileGate ? await reconcileGate.promise : { bookingId: '42', shopId: '5', requestKey: key, outcome, action: outcome === 'COMMITTED' ? 'STATUS:CANCELLED' : null, ...receiptPatch });
    }
    if (config.method === 'post') {
      writes.push({ url: config.url, data: config.data, key: config.headers.get('Idempotency-Key') });
      if (writeGate) return response(await writeGate.promise);
      if (options.keepOldReadback || options.failReadback || options.deniedReadback) {
        const moved = config.url.endsWith('/reschedule') ? JSON.parse(config.data) : null;
        return response({ ...booking, ...(moved ? { localDate: moved.date, localStartTime: moved.startTime } : { status: 'CANCELLED' }) });
      }
      if (config.url.endsWith('/reschedule')) {
        const moved = JSON.parse(config.data);
        Object.assign(booking, { localDate: moved.date, localStartTime: moved.startTime, localEndTime: '11:00', startTime: moved.date + 'T18:00:00Z', endTime: moved.date + 'T19:00:00Z' });
        return response(structuredClone(booking));
      }
      booking.status = config.url.endsWith('/cancel') ? 'CANCELLED' : config.url.endsWith('/complete') ? 'COMPLETED' : 'CONFIRMED';
      if (booking.status === 'CANCELLED' && options.role === 'ADMIN') {
        const payload = JSON.parse(config.data);
        assert.equal(typeof payload.cancelReason, 'string');
        booking.cancelReason = payload.cancelReason;
      }
      summary.status = booking.status;
      summary.allowedActions = { ...summary.allowedActions, confirm: false, cancel: booking.status === 'CONFIRMED' };
      return response(structuredClone(booking));
    }
    if (readFailure || options.failReadback && writes.length) throw new Error('Synthetic read failed');
    if (options.deniedReadback && writes.length) throw Object.assign(new Error('Synthetic read forbidden'), { response: { status: 403 } });
    if (/^\/bookings\/\d+\/settlements$/.test(config.url)) {
      reads.push({ url: config.url, signal: config.signal });
      const value = { ...structuredClone(summary), bookingId: config.url.split('/')[2], ...(mismatchedSnapshot ? { paidCents: 1 } : {}), ...snapshotPatch };
      if (readGate) await readGate.promise;
      return response(value);
    }
    if (/^\/bookings\/\d+\/reschedule-slots$/.test(config.url)) return response({ date: config.params.date, timezone: booking.timezone, slots: (options.slotTimes ?? ['10:00']).map(time => ({ time, available: true })) });
    assert.match(config.url, /^\/bookings\/\d+$/);
    reads.push({ url: config.url, signal: config.signal });
    const value = { ...booking, id: config.url.split('/')[2], ...(wrongIdentity ? { id: '99' } : {}), ...bookingReadPatch };
    if (readGate) await readGate.promise;
    return response(value);
  };
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const { default: BookingDetails, BookingDetailsDrawer } = await server.ssrLoadModule('/src/components/BookingDetails.tsx');
    const { shopLocal } = await server.ssrLoadModule('/src/utils/reservationTime.ts');
    function OrderProbe() {
      const props = { id: selectedId, shopId: '5', onClose() { closed++; }, onUpdated() { updated++; } };
      const node = options.presentation === 'drawer' ? BookingDetailsDrawer(props) : React.createElement(BookingDetails, props);
      assert.equal(node.type, BookingDetails, 'both shells run the same authorized content and operation controller');
      tree = node.type(node.props); return null;
    }
    function Probe() { context = useShopId(); return shown ? React.createElement(OrderProbe) : null; }
    const actorRole = options.role ?? 'MERCHANT';
    auth.getState().setAuth('synthetic-only', { id: '1', role: actorRole });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(Probe)) }], { initialEntries: ['/bookings?shopId=5'] });
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const button = label => { const node = find(tree, node => node.props.children === label && typeof node.props.onClick === 'function'); assert.ok(node, 'expected ' + label); return node; };
    await run({ button, confirmations, writes, stored, reconciliations, reads, localNow: () => shopLocal(new Date().toISOString(), booking.timezone), tree: () => tree, updated: () => updated, closed: () => closed,
      gate(value) { writeGate = value; }, failReads(value) { readFailure = value; }, wrongIdentity(value) { wrongIdentity = value; },
      patchSnapshot(value) { snapshotPatch = value; }, patchBookingRead(value) { bookingReadPatch = value; }, gateReads(value) { readGate = value; },
      receipt(value, patch = {}) { outcome = value; receiptPatch = patch; if (value === 'COMMITTED' && !Object.keys(patch).length) { booking.status = summary.status = 'CANCELLED'; summary.allowedActions.cancel = false; } }, gateReconcile(value) { reconcileGate = value; }, mismatchSnapshot(value) { mismatchedSnapshot = value; },
      async reopen() { shown = false; await act(async () => { router.navigate('/bookings?shopId=5&closed=1'); }); shown = true; await act(async () => { router.navigate('/bookings?shopId=5'); }); },
      async revokeCollection() { shops[0].permissions = ['BOOKINGS_READ', 'BOOKINGS_MANAGE']; await act(async () => { await context.reloadShop('5'); }); },
      async revokeManagement() { shops[0].permissions = ['BOOKINGS_READ']; await act(async () => { await context.reloadShop('5'); }); },
      async switchActor(id = '2', role = actorRole) { await act(async () => { auth.getState().setAuth('other-synthetic', { id, role }); }); await act(async () => { await context.reloadShop('5'); }); },
      async selectOrder(id) { selectedId = id; await act(async () => { await router.navigate('/bookings?shopId=5&selected=' + id); }); },
      setReadbackFailure(value) { options.failReadback = value; options.deniedReadback = value; },
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Form.useForm = oldForm; Form.useWatch = oldWatch; Modal.useModal = oldModal;
    for (const key of Object.keys(previous)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
}

test('guest contact email keeps an intentionally omitted email distinct from legacy history', async () => withOrder(async ({ tree, writes, button, patchBookingRead }) => {
  const fields = () => find(tree(), node => node.type === Descriptions).props.items;
  assert.equal(fields().find(field => field.key === 'email').children, '未填写邮箱');
  assert.match(fields().find(field => field.key === 'contactBasis').children, /未关联顾客账号.*不发送顾客邮件/);
  patchBookingRead({ contact: { recorded: true, version: 1, source: 'GUEST_ASSISTED', emailVerifiedAt: null, name: 'First visitor', phone: '+12025550101', email: 'visitor@example.test' } });
  await act(async () => { button('刷新订单详情').props.onClick(); });
  assert.equal(fields().find(field => field.key === 'email').children, 'visitor@example.test');
  assert.match(fields().find(field => field.key === 'contactBasis').children, /不发送顾客邮件/, 'a supplied email alone never authorizes guest mail');
  assert.equal(writes.length, 0);
}, { booking: { contact: { recorded: true, version: 1, source: 'GUEST_ASSISTED', emailVerifiedAt: null, name: 'First visitor', phone: '+12025550101', email: null } } }));

test('legacy contact email preserves the historical missing-email copy', async () => withOrder(async ({ tree, writes }) => {
  const fields = find(tree(), node => node.type === Descriptions).props.items;
  assert.equal(fields.find(field => field.key === 'email').children, '历史订单未记录联系邮箱');
  assert.match(fields.find(field => field.key === 'contactBasis').children, /历史订单未记录当次联系人/);
  assert.equal(writes.length, 0);
}));

test('authorized store order details show the reason only for cancelled reservations', async () => withOrder(async ({ tree, button, patchBookingRead, patchSnapshot, writes }) => {
  const field = () => find(tree(), node => node.type === Descriptions).props.items.find(item => item.key === 'cancelReason');
  const refresh = () => act(async () => { button('刷新订单详情').props.onClick(); });
  const reason = '顾客要求取消\n请联系门店';
  patchBookingRead({ cancelReason: reason });
  await refresh();
  assert.equal(field(), undefined);
  patchBookingRead({ status: 'CANCELLED', cancelReason: reason });
  patchSnapshot({ status: 'CANCELLED' });
  await refresh();
  assert.equal(field().label, '取消原因');
  assert.equal(field().children.props.children, reason);
  for (const cancelReason of [null, undefined]) {
    patchBookingRead({ status: 'CANCELLED', cancelReason });
    await refresh();
    assert.equal(field().children, '未记录取消原因');
  }
  assert.equal(writes.length, 0);
}, { permissions: ['BOOKINGS_READ'] }));

test('platform administrator cancelling from the merchant drawer must submit a visible reason and verify the saved text', async () => withOrder(async ({ tree, button, confirmations, writes, stored, updated, patchBookingRead, receipt }) => {
  const clickCancel = () => act(async () => { button('取消预约').props.onClick(); });
  await clickCancel();
  const first = confirmations.at(-1);
  const label = find(first.options.content, node => node.type === 'label');
  assert.equal(label.props.children[0], '取消原因（顾客可见）');
  const field = find(first.options.content, node => node.type === Input.TextArea);
  assert.ok(field);
  assert.equal(field.props.required, true);
  assert.equal(field.props.maxLength, 500);
  assert.equal(first.options.okButtonProps.disabled, true);
  field.props.onChange({ target: { value: '   ' } });
  assert.equal(first.options.okButtonProps.disabled, true);
  await act(async () => { first.resolve(true); });
  assert.equal(writes.length, 0);

  await clickCancel();
  const second = confirmations.at(-1);
  const reason = '客人需要取消此次预约';
  find(second.options.content, node => node.type === Input.TextArea).props.onChange({ target: { value: '  ' + reason + '  ' } });
  assert.equal(second.options.okButtonProps.disabled, false);
  patchBookingRead({ cancelReason: 'Different server reason' });
  await act(async () => { second.resolve(true); });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, '/bookings/42/cancel');
  assert.deepEqual(JSON.parse(writes[0].data), { cancelReason: reason });
  assert.ok(writes[0].key);
  assert.equal(updated(), 0);
  const marker = [...stored.values()][0];
  assert.equal(JSON.parse(marker).requiresCancelReason, true);
  assert.ok(!marker.includes(reason));
  assert.ok(find(tree(), node => typeof node.props.title === 'string' && node.props.title.includes('尚未核对到一致')));

  receipt('COMMITTED');
  patchBookingRead({ cancelReason: null });
  await act(async () => { button('刷新订单详情').props.onClick(); });
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(updated(), 0);
  assert.equal([...stored.values()][0], marker);

  patchBookingRead({ cancelReason: reason });
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(updated(), 1);
  assert.equal(stored.size, 0);
  assert.equal(writes.length, 1);
  const saved = find(tree(), node => node.type === Descriptions).props.items.find(item => item.key === 'cancelReason');
  assert.equal(saved.children.props.children, reason);
}, { role: 'ADMIN', presentation: 'drawer', booking: { bookingSource: 'ASSISTED_CUSTOMER' } }));

test('administrator cancellation of a guest reservation explains staff visibility and offline contact', async () => withOrder(async ({ tree, button, confirmations, writes }) => {
  await act(async () => { button('取消预约').props.onClick(); });
  const confirmation = confirmations.at(-1);
  const label = find(confirmation.options.content, node => node.type === 'label');
  assert.equal(label.props.children[0], '取消原因');
  assert.equal(confirmation.options.okButtonProps.disabled, true);
  assert.match(confirmation.options.title, /此操作不会退款/);
  const field = find(confirmation.options.content, node => node.type === Input.TextArea);
  const guidance = find(confirmation.options.content, node => node.props.id === field.props['aria-describedby']);
  assert.equal(guidance.props.children, '取消原因将记录在订单中，供有权限的工作人员查看。如需通知顾客，请拨打订单中的联系电话。');

  const cancelReason = '访客来电取消';
  field.props.onChange({ target: { value: cancelReason } });
  await act(async () => { confirmation.resolve(true); });
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].data), { cancelReason });
  const saved = find(tree(), node => node.type === Descriptions).props.items.find(item => item.key === 'cancelReason');
  assert.equal(saved.children.props.children, cancelReason);
}, { role: 'ADMIN', booking: { bookingSource: 'ASSISTED_GUEST' } }));

test('a role change under the same account discards an open administrator cancellation confirmation', async () => withOrder(async ({ button, confirmations, writes, switchActor }) => {
  await act(async () => { button('取消预约').props.onClick(); });
  const previous = confirmations.at(-1);
  find(previous.options.content, node => node.type === Input.TextArea).props.onChange({ target: { value: 'Changed plans' } });
  await switchActor('1', 'MERCHANT');
  await act(async () => { previous.resolve(true); });
  assert.equal(writes.length, 0);
  assert.equal(button('取消预约').props.disabled, false);
  await act(async () => { button('取消预约').props.onClick(); });
  assert.equal(confirmations.at(-1).options.content, undefined);
  await act(async () => { confirmations.at(-1).resolve(false); });
}, { role: 'ADMIN' }));

test('store merchant cancellation retains its simple confirmation and request body', async () => withOrder(async ({ button, confirmations, writes, updated }) => {
  await act(async () => { button('取消预约').props.onClick(); });
  const confirmation = confirmations.at(-1);
  assert.equal(confirmation.options.content, undefined);
  assert.equal(confirmation.options.okButtonProps.disabled, false);
  await act(async () => { confirmation.resolve(true); });
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].data), {});
  assert.equal(updated(), 1);
}));

test('calendar drawer reuses the authorized order content and confirmation lock through human confirmation and readback', async () => withOrder(async ({ tree, button, confirmations, writes, updated, closed }) => {
  assert.equal(tree().type, Drawer);
  assert.equal(tree().props.styles.wrapper.width, 'min(800px, 100vw)');
  assert.ok(find(tree(), node => node.type === Descriptions));
  await act(async () => { button('确认订单预约').props.onClick(); });
  assert.equal(confirmations.length, 1); assert.equal(writes.length, 0);
  assert.equal(tree().props.closable, false, 'drawer cannot dismiss an in-flight confirmation');
  await act(async () => { confirmations[0].resolve(true); });
  assert.equal(writes.length, 1); assert.equal(updated(), 1);
  assert.equal(tree().type, Drawer); assert.equal(tree().props.closable, true);
  await act(async () => { await tree().props.onClose(); }); assert.equal(closed(), 1);
}, { presentation: 'drawer' }));

test('initial and refreshed order reads reject mixed financial snapshots until a coherent retry', async () => withOrder(async ({ button, tree, writes, mismatchSnapshot, patchSnapshot, patchBookingRead }) => {
  const assertRejected = () => {
    assert.equal(Boolean(find(tree(), node => node.type === Descriptions)), false, 'mixed snapshots cannot expose the order totals or action area');
    assert.equal(Boolean(find(tree(), node => node.props.children === '确认订单预约')), false);
    assert.ok(find(tree(), node => typeof node.props.title === 'string' && node.props.title.includes('快照不一致')));
    assert.equal(writes.length, 0);
  };
  assertRejected();
  mismatchSnapshot(false);
  for (const patch of [{ status: 'CONFIRMED' }, { paymentStatus: 'PAID' }, { currency: 'eur' }, { totalCents: 10026 }, { paidCents: 1 }, { refundedCents: 1 }]) {
    patchSnapshot(patch);
    await act(async () => { button('刷新订单详情').props.onClick(); });
    assertRejected();
  }
  patchSnapshot({ currency: 'USD' });
  patchBookingRead({ notes: undefined, timezone: undefined, localDate: undefined, localStartTime: undefined, localEndTime: undefined, orderOnly: undefined, onlinePaymentEnabled: undefined, pricingPolicy: undefined, paymentMode: undefined });
  await act(async () => { button('刷新订单详情').props.onClick(); });
  assert.ok(find(tree(), node => node.type === Descriptions), 'absent optional metadata and currency letter case do not reject a coherent order');
  assert.equal(button('确认订单预约').props.disabled, false);
}, { mismatchedSnapshot: true }));

test('superseded order reload aborts both reads and cannot replace a newer coherent snapshot', async () => withOrder(async ({ button, tree, reads, gateReads, patchSnapshot }) => {
  const delayed = deferred(); gateReads(delayed); patchSnapshot({ paidCents: 1 });
  await act(async () => { button('刷新订单详情').props.onClick(); });
  const staleReads = reads.slice(-2);
  assert.ok(staleReads.every(read => read.signal instanceof AbortSignal), 'both parallel reads receive the reload signal');
  gateReads(null); patchSnapshot({});
  await act(async () => { button('刷新订单详情').props.onClick(); });
  assert.ok(staleReads.every(read => read.signal.aborted), 'a newer reload cancels both requests from the previous one');
  assert.equal(button('确认订单预约').props.disabled, false);
  await act(async () => { delayed.resolve(); });
  assert.equal(button('确认订单预约').props.disabled, false);
  assert.equal(Boolean(find(tree(), node => typeof node.props.title === 'string' && node.props.title.includes('快照不一致'))), false, 'late aborted mismatch cannot overwrite the current coherent result');
}));

test('order confirmation owns a synchronous lock before the human answers', async () => withOrder(async ({ button, confirmations, writes }) => {
  const click = button('取消预约').props.onClick;
  await act(async () => { click(); click(); });
  assert.equal(confirmations.length, 1, 'double click opens only one confirmation');
  assert.equal(button('确认订单预约').props.disabled, true);
  await act(async () => { confirmations[0].resolve(false); });
  assert.equal(writes.length, 0);
  assert.equal(button('确认订单预约').props.disabled, false);
}));

for (const outcome of ['COMMITTED', 'NOT_EXECUTED']) test('matching ' + outcome + ' receipt and coherent snapshot safely restore an uncertain order', async () => withOrder(async ({ button, confirmations, writes, stored, gate, reopen, receipt, reconciliations, updated, tree }) => {
  const request = deferred(); gate(request);
  await act(async () => { button('取消预约').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.match(writes[0].key, /^[a-f0-9-]{36}$/);
  const marker = JSON.parse([...stored.values()][0]);
  assert.equal(marker.requestKey, writes[0].key, 'stored key is the actual dispatched key');
  assert.equal(marker.action, 'STATUS:CANCELLED');
  await act(async () => { request.reject(new Error('Synthetic response lost')); });
  await reopen(); receipt(outcome);
  const click = button('核对原操作结果').props.onClick;
  await act(async () => { click(); click(); });
  assert.equal(confirmations.length, 2, 'reconciliation owns a lock before confirmation');
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(reconciliations.length, 1);
  assert.ok(reconciliations[0].url.includes(writes[0].key));
  assert.equal(writes.length, 1, 'reconciliation does not retry the business write');
  assert.equal(stored.size, 0);
  assert.equal(updated(), 1);
  if (outcome === 'NOT_EXECUTED') assert.equal(button('取消预约').props.disabled, false);
  else assert.equal(find(tree(), node => node.props.children === '取消预约'), undefined, 'committed terminal order remains terminal');
  assert.equal(find(tree(), node => node.props.children === '核对原操作结果'), undefined);
}));

test('wrong receipt or inconsistent readback never releases the original operation marker', async () => withOrder(async ({ button, confirmations, gate, stored, receipt, mismatchSnapshot, failReads }) => {
  const request = deferred(); gate(request);
  await act(async () => { button('取消预约').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  await act(async () => { request.reject(new Error('Synthetic response lost')); });
  const original = [...stored.values()][0];
  for (const [patch, mode] of [[{ bookingId: '99' }, 'identity'], [{ action: 'STATUS:COMPLETED' }, 'action'], [{ requestKey: 'different-request-001' }, 'key'], [{ outcome: 'PENDING' }, 'pending'], [{ action: 'STATUS:CANCELLED' }, 'notexecutedAction'], [{}, 'snapshot'], [{}, 'readFailure']]) {
    receipt(mode === 'action' ? 'COMMITTED' : 'NOT_EXECUTED', patch);
    mismatchSnapshot(mode === 'snapshot'); failReads(mode === 'readFailure');
    await act(async () => { button('核对原操作结果').props.onClick(); });
    await act(async () => { confirmations.at(-1).resolve(true); });
    assert.equal([...stored.values()][0], original, mode + ' retains the exact attempt');
    assert.equal(button('取消预约').props.disabled, true);
  }
  mismatchSnapshot(false); failReads(false); receipt('NOT_EXECUTED');
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(stored.size, 0, 'matching receipt plus successful reload can finally clear it');
}));

test('account switch while reconciliation is pending cannot clear the original account marker', async () => withOrder(async ({ button, confirmations, gate, gateReconcile, stored, switchActor, updated, writes }) => {
  const request = deferred(); gate(request);
  await act(async () => { button('取消预约').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  await act(async () => { request.reject(new Error('Synthetic response lost')); });
  const reconcile = deferred(); gateReconcile(reconcile);
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  await switchActor();
  await act(async () => { reconcile.resolve({ bookingId: '42', shopId: '5', requestKey: writes[0].key, outcome: 'NOT_EXECUTED', action: null }); });
  assert.equal(stored.size, 1);
  assert.equal(updated(), 0);
}));

test('legacy unknown marker without a dispatched operation key stays read-only', async () => withOrder(async ({ stored, reopen, button, tree }) => {
  stored.set('massajoy2:booking-outcome:1:5:42', 'legacy-unkeyed-marker');
  await reopen();
  assert.equal(button('取消预约').props.disabled, true);
  assert.equal(find(tree(), node => node.props.children === '核对原操作结果'), undefined);
}));

test('late order success cannot update the same shop under a new merchant identity', async () => withOrder(async ({ button, confirmations, gate, switchActor, updated }) => {
  const request = deferred(); gate(request);
  await act(async () => { button('取消预约').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  await switchActor();
  await act(async () => { request.resolve({}); });
  assert.equal(updated(), 0, 'old identity callback cannot update the new identity view');
}));

test('unknown order write freezes repeated actions through failed and stale read-only reconciliation', async () => withOrder(async ({ button, confirmations, writes, gate, failReads, tree, reopen, stored, closed }) => {
  const request = deferred(); gate(request);
  const cancel = button('取消预约').props.onClick;
  await act(async () => { cancel(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  await act(async () => { request.reject(new Error('Synthetic response lost')); });
  const before = confirmations.length;
  await act(async () => { cancel(); });
  assert.equal(confirmations.length, before, 'unknown write cannot reopen its captured action');
  assert.equal(button('取消预约').props.disabled, true);
  failReads(true);
  await act(async () => { button('刷新订单详情').props.onClick(); });
  assert.equal(button('结束本次核对').props.disabled, true);
  failReads(false);
  await act(async () => { button('刷新订单详情').props.onClick(); });
  assert.equal(button('取消预约').props.disabled, true, 'an old server snapshot does not prove the write ended');
  assert.equal(button('结束本次核对').props.disabled, false);
  assert.equal(writes.length, 1);
  assert.ok(find(tree(), node => typeof node.props.description === 'string' && node.props.description.includes('不会撤销')));
  await act(async () => { button('结束本次核对').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(false); });
  assert.equal(button('取消预约').props.disabled, true);
  assert.equal(stored.size, 1, 'unknown original attempt remains in this browser session');
  await reopen();
  assert.equal(button('取消预约').props.disabled, true, 'reopening the same order does not silently retry or unlock it');
  await act(async () => { button('结束本次核对').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(closed(), 1, 'explicit reconciliation completion closes only the detail view');
  await reopen();
  assert.equal(button('取消预约').props.disabled, true, 'closing does not erase the unresolved original request');
  assert.equal(writes.length, 1);
}));

test('mismatched refreshed order retains its marker and cannot report verified success', async () => withOrder(async ({ button, confirmations, wrongIdentity, tree, updated, stored }) => {
  await act(async () => { button('取消预约').props.onClick(); });
  wrongIdentity(true);
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(updated(), 0);
  assert.equal(stored.size, 1);
  assert.equal(button('取消预约').props.disabled, true);
  assert.ok(find(tree(), node => typeof node.props.title === 'string' && node.props.title.includes('尚未核对')));
}));

test('uncertain reschedule reconciles without another write and retains the specific request beside both final assignments', async () => {
  const item = { id: '1', participantIndex: 1, sequence: 1, serviceNameSnapshot: 'Synthetic four-hands massage', durationMin: 60, priceCentsSnapshot: 10025,
    therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['11'], assignedTherapistIds: ['11', '12'], assignedTherapistId: '11',
    startAtUtc: '2035-11-07T18:00:00Z', endAtUtc: '2035-11-07T19:00:00Z', staffBufferMin: 0, roomBufferMin: 0 };
  await withOrder(async ({ button, tree, confirmations, writes, gate, stored, receipt, failReads, patchBookingRead, updated }) => {
    const request = deferred(); gate(request);
    await act(async () => { button('改期').props.onClick(); });
    const moveForm = () => find(tree(), node => node.type === Form);
    await act(async () => {
      moveForm().props.form.setFieldsValue({ date: '2035-11-08' });
      moveForm().props.onValuesChange({ date: '2035-11-08' });
    });
    await act(async () => {
      moveForm().props.form.setFieldValue('startTime', '10:00');
      moveForm().props.onValuesChange({ startTime: '10:00' });
    });
    const submit = moveForm().props.onFinish, values = { date: '2035-11-08', startTime: '10:00' };
    await act(async () => { submit(values); submit(values); });
    assert.equal(writes.length, 1, 'the reschedule locks synchronously before another submit');
    assert.equal(writes[0].url, '/bookings/42/reschedule');
    assert.deepEqual(JSON.parse(writes[0].data), values, 'rescheduling never sends a replacement therapist selection');
    const marker = [...stored.values()][0];
    assert.equal(JSON.parse(marker).requestKey, writes[0].key);
    assert.equal(JSON.parse(marker).action, 'RESCHEDULE');
    await act(async () => { request.reject(new Error('Synthetic reschedule response lost')); });
    await act(async () => { submit(values); });
    assert.equal(writes.length, 1, 'unknown reschedule cannot be retried by its captured submit');
    assert.equal(moveForm().props.disabled, true);

    receipt('COMMITTED', { action: 'RESCHEDULE' }); failReads(true);
    await act(async () => { button('核对原操作结果').props.onClick(); });
    await act(async () => { confirmations.at(-1).resolve(true); });
    assert.equal([...stored.values()][0], marker, 'matching operation proof cannot release a failed order readback');
    assert.equal(moveForm().props.disabled, true);
    failReads(false);
    patchBookingRead({ localDate: values.date, localStartTime: values.startTime, localEndTime: '11:00',
      startTime: '2035-11-08T18:00:00Z', endTime: '2035-11-08T19:00:00Z',
      items: [{ ...item, assignedTherapistIds: ['11', '13'], startAtUtc: '2035-11-08T18:00:00Z', endAtUtc: '2035-11-08T19:00:00Z' }] });
    await act(async () => { button('核对原操作结果').props.onClick(); });
    await act(async () => { confirmations.at(-1).resolve(true); });
    assert.equal(writes.length, 1, 'recovery only reconciles and reads, never resubmits');
    assert.equal(stored.size, 0); assert.equal(updated(), 1);
    assert.equal(moveForm(), undefined);
    const details = find(tree(), node => node.type === Descriptions).props.items;
    assert.equal(details.find(row => row.key === 'therapistRequest').children, '明确指定：#11');
    assert.equal(details.find(row => row.key === 'total').children, 'USD 100.25');
    const assigned = find(tree(), node => node.type === 'p' && Array.isArray(node.props.children) && String(node.props.children[0]).startsWith('实际安排技师 '));
    assert.ok(assigned);
    assert.match(assigned.props.children[0], /Requested therapist \(#11\).*Replacement therapist \(#13\)/);
    assert.doesNotMatch(assigned.props.children[0], /#12/);
    const segmentTime = find(tree(), node => node.type === 'p' && typeof node.props.children === 'string' && node.props.children.includes('2035-11-08') && node.props.children.includes('America/Los_Angeles'));
    assert.ok(segmentTime, 'both final assignments belong to the same saved service segment and time window');
  }, { booking: { therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['11'], items: [item],
    reception: { customer: null, therapists: [{ id: '11', name: 'Requested therapist' }, { id: '12', name: 'Old automatic therapist' }, { id: '13', name: 'Replacement therapist' }], rooms: [] } } });
});

test('optional offline ledger locks before confirmation and rechecks permission before posting', async () => withOrder(async ({ button, confirmations, tree, localNow, revokeCollection, writes }) => {
  await act(async () => { button('登记已实际收到的款项').props.onClick(); });
  const form = find(tree(), node => node.type === Form);
  assert.ok(form);
  const submit = form.props.onFinish;
  const values = { amount: '100.25', method: 'CASH', occurred: localNow(), reason: 'Synthetic receipt actually received' };
  await act(async () => { submit(values); submit(values); });
  assert.equal(confirmations.length, 1);
  await revokeCollection();
  await act(async () => { confirmations[0].resolve(true); });
  assert.equal(writes.length, 0, 'permission revoked during confirmation cannot write a receipt');
}));

test('a valid cancel receipt followed by the old coherent order stays unresolved and cannot cancel twice', async () => withOrder(async ({ button, confirmations, writes, stored, updated }) => {
  const cancel = button('取消预约').props.onClick;
  await act(async () => { cancel(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(writes.length, 1);
  assert.equal(stored.size, 1, 'the operation marker must survive an old but internally coherent readback');
  assert.equal(updated(), 0, 'an old order cannot report confirmed success');
  assert.equal(button('取消预约').props.disabled, true);
  await act(async () => { cancel(); cancel(); });
  assert.equal(confirmations.length, 1); assert.equal(writes.length, 1);
}, { keepOldReadback: true }));

for (const option of ['keepOldReadback', 'failReadback', 'deniedReadback']) test('reschedule retains its exact draft and marker after ' + option, async () => withOrder(async ({ button, tree, writes, stored, updated, setReadbackFailure }) => {
  await act(async () => { button('改期').props.onClick(); });
  let editor = find(tree(), node => node.type === Form);
  const values = { date: '2035-11-08', startTime: '10:00' };
  await act(async () => { editor.props.form.setFieldsValue(values); editor.props.onValuesChange({ date: values.date }); });
  editor = find(tree(), node => node.type === Form); editor.props.form.setFieldValue('startTime', values.startTime);
  const submit = editor.props.onFinish, discard = button('保留原时间').props.onClick;
  await act(async () => { submit(values); submit(values); });
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].data), values);
  assert.equal(stored.size, 1);
  assert.equal(updated(), 0);
  editor = find(tree(), node => node.type === Form);
  assert.ok(editor, 'the submitted reschedule draft remains visible');
  assert.equal(editor.props.disabled, true, 'unknown completion cannot be re-submitted');
  assert.equal(editor.props.form.getFieldValue('date'), values.date);
  assert.equal(editor.props.form.getFieldValue('startTime'), values.startTime);
  assert.deepEqual(JSON.parse([...stored.values()][0]).move, values, 'read-only reconciliation retains the submitted local time');
  await act(async () => { submit(values); discard(); });
  assert.equal(writes.length, 1); assert.ok(find(tree(), node => node.type === Form), 'captured discard cannot erase an uncertain draft');
  await act(async () => { button('刷新订单详情').props.onClick(); });
  if (option !== 'keepOldReadback') {
    await act(async () => { button('刷新订单详情').props.onClick(); });
    setReadbackFailure(false);
    await act(async () => { button('刷新订单详情').props.onClick(); });
  }
  editor = find(tree(), node => node.type === Form);
  assert.ok(editor, 'read-only refresh preserves the uncertain draft, including after repeated read failures');
  assert.equal(editor.props.form.getFieldValue('date'), values.date);
  assert.equal(stored.size, 1);
}, { [option]: true }));

test('COMMITTED reschedule proof cannot clear the marker while readback still has the previous time', async () => withOrder(async ({ button, tree, stored, receipt, patchBookingRead, confirmations, updated, writes }) => {
  await act(async () => { button('改期').props.onClick(); });
  let editor = find(tree(), node => node.type === Form);
  const values = { date: '2035-11-08', startTime: '10:00' };
  await act(async () => { editor.props.form.setFieldsValue(values); editor.props.onValuesChange({ date: values.date }); });
  editor = find(tree(), node => node.type === Form); editor.props.form.setFieldValue('startTime', values.startTime);
  await act(async () => { editor.props.onFinish(values); });
  const marker = [...stored.values()][0];
  receipt('COMMITTED', { action: 'RESCHEDULE' });
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal([...stored.values()][0], marker); assert.equal(updated(), 0);
  patchBookingRead({ localDate: values.date, localStartTime: values.startTime, startTime: values.date + 'T18:00:00Z', endTime: values.date + 'T19:00:00Z' });
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(stored.size, 0); assert.equal(updated(), 1); assert.equal(writes.length, 1, 'reconciliation never retries the move');
}, { keepOldReadback: true }));

for (const plan of [false, true]) test('actual order editor preserves ' + (plan ? 'per-segment' : 'explicit') + ' therapist intent while moving only time', async () => withOrder(async ({ button, tree, writes, updated }) => {
  const requested = () => plan
    ? find(tree(), node => Array.isArray(node.props.children) && node.props.children[0] === '原技师请求：' && node.props.children[1] === '明确指定：#11')
    : find(tree(), node => node.type === Descriptions).props.items.find(item => item.key === 'therapistRequest').children;
  if (plan) assert.ok(requested()); else assert.equal(requested(), '明确指定：#11');
  await act(async () => { button('改期').props.onClick(); });
  assert.ok(find(tree(), node => typeof node.props.title === 'string' && node.props.title.includes(plan ? '逐段保留' : '保留已指定技师')));
  let editor = find(tree(), node => node.type === Form);
  const values = { date: '2035-11-08', startTime: '10:00' };
  await act(async () => { editor.props.form.setFieldsValue(values); editor.props.onValuesChange({ date: values.date }); });
  editor = find(tree(), node => node.type === Form); editor.props.form.setFieldValue('startTime', values.startTime);
  await act(async () => { editor.props.onFinish(values); });
  assert.equal(updated(), 1); assert.deepEqual(JSON.parse(writes[0].data), values, 'the editor never sends an assigned employee as a requested employee');
  if (plan) assert.ok(requested()); else assert.equal(requested(), '明确指定：#11');
}, { booking: { reservationKind: plan ? 'PLAN' : 'SINGLE', therapistSelectionMode: plan ? 'AUTO' : 'SPECIFIC', requestedTherapistIds: plan ? [] : ['11'], therapistId: '12', items: plan ? [
  { id: '101', participantIndex: 1, sequence: 1, durationMin: 30, priceCentsSnapshot: 5000, staffBufferMin: 0, roomBufferMin: 0, therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['11'], assignedTherapistId: '12' },
  { id: '102', participantIndex: 1, sequence: 2, durationMin: 30, priceCentsSnapshot: 5025, staffBufferMin: 0, roomBufferMin: 0, therapistSelectionMode: 'AUTO', requestedTherapistIds: [], assignedTherapistId: '13' },
] : [] } }));

test('a known reschedule rejection retains editable input and permits a deliberate retry', async () => withOrder(async ({ button, tree, writes, stored, gate }) => {
  const first = deferred(); gate(first);
  await act(async () => { button('改期').props.onClick(); });
  let editor = find(tree(), node => node.type === Form);
  const values = { date: '2035-11-08', startTime: '10:00' };
  await act(async () => { editor.props.form.setFieldsValue(values); editor.props.onValuesChange({ date: values.date }); });
  editor = find(tree(), node => node.type === Form); editor.props.form.setFieldValue('startTime', values.startTime);
  await act(async () => { editor.props.onFinish(values); });
  await act(async () => { first.reject(Object.assign(new Error('Synthetic availability conflict'), { response: { status: 409 } })); });
  editor = find(tree(), node => node.type === Form);
  assert.equal(stored.size, 0); assert.equal(editor.props.disabled, false); assert.equal(editor.props.form.getFieldValue('date'), values.date);
  gate(deferred()); await act(async () => { editor.props.onFinish(values); });
  assert.equal(writes.length, 2); assert.notEqual(writes[0].key, writes[1].key);
}));

test('captured reschedule discard from the old order cannot erase the new order draft', async () => withOrder(async ({ button, tree, selectOrder, writes }) => {
  await act(async () => { button('改期').props.onClick(); });
  const oldDiscard = button('保留原时间').props.onClick;
  await selectOrder('43');
  await act(async () => { button('改期').props.onClick(); });
  await act(async () => { oldDiscard(); });
  assert.ok(find(tree(), node => node.type === Form), 'the active order keeps its own reschedule editor');
  assert.equal(writes.length, 0);
}));

test('old same-order discard and refresh callbacks cannot erase a later edited reschedule', async () => withOrder(async ({ button, tree }) => {
  const oldRefresh = button('刷新订单详情').props.onClick;
  await act(async () => { button('改期').props.onClick(); });
  const oldDiscard = button('保留原时间').props.onClick;
  await act(async () => { oldDiscard(); });
  await act(async () => { button('改期').props.onClick(); });
  let editor = find(tree(), node => node.type === Form);
  await act(async () => { editor.props.form.setFieldsValue({ date: '2035-11-08' }); editor.props.onValuesChange({ date: '2035-11-08' }); });
  await act(async () => { oldDiscard(); oldRefresh(); });
  editor = find(tree(), node => node.type === Form);
  assert.ok(editor); assert.equal(editor.props.form.getFieldValue('date'), '2035-11-08');
}));

test('reschedule draft revision rejects an older valid submission after selecting another time', async () => withOrder(async ({ button, tree, writes, stored }) => {
  await act(async () => { button('改期').props.onClick(); });
  let editor = find(tree(), node => node.type === Form);
  await act(async () => { editor.props.form.setFieldValue('date', '2035-11-08'); editor.props.onValuesChange({ date: '2035-11-08' }); });
  editor = find(tree(), node => node.type === Form);
  await act(async () => { editor.props.form.setFieldValue('startTime', '10:00'); editor.props.onValuesChange({ startTime: '10:00' }); });
  editor = find(tree(), node => node.type === Form);
  const staleSubmit = editor.props.onFinish;
  await act(async () => { editor.props.form.setFieldValue('startTime', '11:00'); editor.props.onValuesChange({ startTime: '11:00' }); });
  await act(async () => { staleSubmit({ date: '2035-11-08', startTime: '10:00' }); });
  assert.equal(writes.length, 0, 'validation from an older selection cannot dispatch a superseded valid time');
  assert.equal(stored.size, 0, 'no unresolved operation is created for stale form validation');
  editor = find(tree(), node => node.type === Form);
  assert.equal(editor.props.form.getFieldValue('startTime'), '11:00');
  await act(async () => { editor.props.onFinish({ date: '2035-11-08', startTime: '10:00' }); });
  assert.equal(writes.length, 0, 'a current callback also rejects validation values that differ from the live form');
  await act(async () => { editor.props.form.setFieldValue('startTime', '10:00'); editor.props.onValuesChange({ startTime: '10:00' }); });
  await act(async () => { staleSubmit({ date: '2035-11-08', startTime: '10:00' }); });
  assert.equal(writes.length, 0, 'returning to the original time does not revive an old validation callback');
  editor = find(tree(), node => node.type === Form);
  await act(async () => { editor.props.onFinish({ date: '2035-11-08', startTime: '10:00' }); });
  assert.equal(writes.length, 1, 'the current deliberate submission remains available');
}, { slotTimes: ['10:00', '11:00'] }));

test('reschedule draft revision rejects an older date callback after selecting a new time', async () => withOrder(async ({ button, tree, writes }) => {
  await act(async () => { button('改期').props.onClick(); });
  let editor = find(tree(), node => node.type === Form);
  await act(async () => { editor.props.form.setFieldValue('date', '2035-11-08'); editor.props.onValuesChange({ date: '2035-11-08' }); });
  editor = find(tree(), node => node.type === Form);
  const staleDateChange = editor.props.onValuesChange;
  await act(async () => { editor.props.form.setFieldValue('startTime', '11:00'); editor.props.onValuesChange({ startTime: '11:00' }); });
  await act(async () => { staleDateChange({ date: '2035-11-08' }); });
  editor = find(tree(), node => node.type === Form);
  assert.equal(editor.props.form.getFieldValue('startTime'), '11:00', 'an older date event must not clear the newer selected time');
  assert.equal(writes.length, 0);
}, { slotTimes: ['10:00', '11:00'] }));

test('reschedule draft input ignores a captured date event after management permission is revoked', async () => withOrder(async ({ button, tree, revokeManagement, writes }) => {
  await act(async () => { button('改期').props.onClick(); });
  let editor = find(tree(), node => node.type === Form);
  await act(async () => { editor.props.form.setFieldValue('date', '2035-11-08'); editor.props.onValuesChange({ date: '2035-11-08' }); });
  editor = find(tree(), node => node.type === Form);
  editor.props.form.setFieldValue('startTime', '10:00');
  const staleDateChange = editor.props.onValuesChange;
  await revokeManagement();
  await act(async () => { staleDateChange({ date: '2035-11-08' }); });
  editor = find(tree(), node => node.type === Form);
  assert.equal(editor.props.form.getFieldValue('startTime'), '10:00', 'permission loss must preserve the existing draft against old input side effects');
  assert.equal(writes.length, 0);
}));

const syntheticReceipt = { id: 'ca3eddc0-4f20-4ae6-9c56-24eb89e02e66', kind: 'RECEIPT', amountCents: 100, method: 'CASH', occurredAt: '2026-11-08T18:00:00Z', createdAt: '2026-11-08T18:00:00Z', reason: 'Synthetic receipt for lifecycle coverage', referenceEntryId: null, canReverse: true };
const paidOrder = {
  permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE'],
  booking: { status: 'CONFIRMED', paidCents: 100 },
  summary: { status: 'CONFIRMED', paidCents: 100, netPaidCents: 100, amountDueCents: 9925, entries: [syntheticReceipt], allowedActions: { confirm: false, complete: true, cancel: true, recordReceipt: true, recordRefund: true } },
};

for (const [label, patch] of [
  ['登记已实际收到的款项', { allowedActions: { ...paidOrder.summary.allowedActions, recordReceipt: false } }],
  ['登记已实际退还的款项', { allowedActions: { ...paidOrder.summary.allowedActions, recordRefund: false } }],
  ['冲正错误收款记录', { entries: [{ ...syntheticReceipt, canReverse: false }] }],
]) test('captured ledger callbacks cannot reopen an action revoked by a refreshed snapshot: ' + label, async () => withOrder(async ({ button, tree, patchSnapshot, writes }) => {
  const open = button(label).props.onClick;
  patchSnapshot(patch);
  await act(async () => { button('刷新订单详情').props.onClick(); });
  assert.equal(find(tree(), node => node.props.children === label && typeof node.props.onClick === 'function'), undefined);
  await act(async () => { open(); });
  assert.equal(Boolean(find(tree(), node => node.type === Form)), false, 'the current server snapshot must authorize opening a ledger draft');
  assert.equal(writes.length, 0);
}, paidOrder));

const reversedOrder = {
  ...paidOrder.summary, bookingId: '42', shopId: '5', paymentMode: 'PAY_AT_STORE', currency: 'usd', totalCents: 10025, refundedCents: 0, paymentStatus: 'UNPAID', paidCents: 0, netPaidCents: 0, amountDueCents: 10025,
  entries: [
    { ...syntheticReceipt, id: 'da12c766-83ab-4ddf-8f10-f884ae0703e8', kind: 'REVERSAL', referenceEntryId: syntheticReceipt.id, canReverse: false },
    { ...syntheticReceipt, canReverse: false },
  ],
};

test('USD 1 receipt correction posts one reversal and reads back its linked ledger without a refund', async () => withOrder(async ({ button, tree, confirmations, writes, gate, patchBookingRead, patchSnapshot, updated, stored }) => {
  const request = deferred(); gate(request);
  await act(async () => { button('冲正错误收款记录').props.onClick(); });
  const submit = find(tree(), node => node.type === Form).props.onFinish;
  const values = { reason: 'Synthetic USD 1 receipt entered in error' };
  await act(async () => { submit(values); submit(values); });
  assert.equal(confirmations.length, 1, 'repeated submit shares the confirmation lock');
  assert.match(confirmations[0].options.content, /USD 1\.00/);
  assert.match(confirmations[0].options.content, /不会向顾客退款/);
  await act(async () => { confirmations[0].resolve(true); });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, '/bookings/42/offline-receipts/' + syntheticReceipt.id + '/reverse');
  assert.deepEqual(Object.keys(JSON.parse(writes[0].data)).sort(), ['reason', 'requestKey'], 'reversal references the original receipt instead of submitting a new amount or refund');
  assert.equal(JSON.parse([...stored.values()][0]).action, 'OFFLINE:REVERSAL');
  patchBookingRead({ paidCents: 0 }); patchSnapshot(reversedOrder);
  await act(async () => { request.resolve(reversedOrder); });
  assert.equal(updated(), 1); assert.equal(stored.size, 0);
  assert.equal(Boolean(find(tree(), node => node.type === Form)), false);
  assert.equal(find(tree(), node => node.props.items?.[0]?.key === 'ledger').props.items[0].label, '线下／零金额账本（2）');
  assert.equal(Boolean(find(tree(), node => node.props.children === '冲正错误收款记录')), false, 'the refreshed original receipt cannot be reversed twice');
  assert.equal(writes.filter(write => write.url.includes('offline-refunds')).length, 0);
}, paidOrder));

for (const outcome of ['COMMITTED', 'NOT_EXECUTED']) test('uncertain USD 1 reversal stays frozen until matching ' + outcome + ' proof and coherent readback', async () => withOrder(async ({ button, tree, confirmations, writes, gate, stored, reopen, receipt, mismatchSnapshot, patchBookingRead, patchSnapshot, updated }) => {
  const request = deferred(); gate(request);
  const open = button('冲正错误收款记录').props.onClick;
  await act(async () => { open(); });
  const submit = find(tree(), node => node.type === Form).props.onFinish;
  const values = { reason: 'Synthetic uncertain receipt correction' };
  await act(async () => { submit(values); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  const marker = [...stored.values()][0];
  assert.equal(JSON.parse(marker).action, 'OFFLINE:REVERSAL');
  assert.equal(JSON.parse(marker).requestKey, writes[0].key);
  await act(async () => { request.reject(new Error('Synthetic reversal response lost')); });
  const count = confirmations.length;
  await act(async () => { submit(values); open(); });
  assert.equal(confirmations.length, count); assert.equal(writes.length, 1);
  assert.equal(find(tree(), node => node.type === Form).props.disabled, true);
  await reopen();
  assert.equal(button('冲正错误收款记录').props.disabled, true);
  receipt('COMMITTED', { action: 'OFFLINE:REFUND' });
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal([...stored.values()][0], marker, 'refund proof cannot resolve a reversal attempt');
  const matching = () => receipt(outcome, outcome === 'COMMITTED' ? { action: 'OFFLINE:REVERSAL' } : {});
  matching(); mismatchSnapshot(true);
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal([...stored.values()][0], marker, 'matching operation proof still requires a coherent order read');
  mismatchSnapshot(false);
  if (outcome === 'COMMITTED') { patchBookingRead({ paidCents: 0 }); patchSnapshot(reversedOrder); }
  await act(async () => { button('核对原操作结果').props.onClick(); });
  await act(async () => { confirmations.at(-1).resolve(true); });
  assert.equal(stored.size, 0); assert.equal(updated(), 1); assert.equal(writes.length, 1, 'reconciliation never retries the reversal or writes a refund');
  if (outcome === 'NOT_EXECUTED') assert.equal(button('冲正错误收款记录').props.disabled, false);
  else assert.equal(Boolean(find(tree(), node => node.props.children === '冲正错误收款记录')), false);
}, paidOrder));
