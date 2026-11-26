import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Form, Modal, Descriptions, Input } from 'antd';
import { createServer } from 'vite';

const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find([tree.props.children, tree.props.action], predicate);
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('merchant order actions bind moves to current date and permission, and cancellation rechecks after confirmation', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const previousAdapter = axios.defaults.adapter;
  const previousUseForm = Form.useForm, previousUseWatch = Form.useWatch, previousUseModal = Modal.useModal;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} };
  doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  // Exercise the actual order component's hooks and handlers. Only AntD's
  // unmounted form stores and human confirmation windows are synthetic here.
  Form.useForm = () => [React.useMemo(() => {
    let values = {};
    return { getFieldValue: name => values[name], setFieldsValue: patch => { values = { ...values, ...patch }; }, setFieldValue: (name, value) => { values[name] = value; }, resetFields: () => { values = {}; } };
  }, [])];
  Form.useWatch = (name, form) => form.getFieldValue(name);
  const confirmations = [];
  Modal.useModal = () => [React.useMemo(() => ({
    confirm: options => {
      const pending = deferred();
      const confirmation = { ...pending, options };
      confirmations.push(confirmation);
      return Object.assign(pending.promise, {
        update: patch => { confirmation.options = { ...confirmation.options, ...patch }; },
      });
    },
  }), []), null];
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let root, router, auth;
  let shops = [{ id: '5', name: 'Synthetic order shop', timezone: 'America/Los_Angeles', permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'], accessType: 'ADMIN', isOwner: true }];
  let booking = {
    id: '42', shopId: '5', bookingNo: 'SYNTHETIC-42', orderOnly: true, onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER', paymentMode: 'PAY_AT_STORE',
    status: 'PENDING', paymentStatus: 'UNPAID', currency: 'usd', durationMin: 60, durationKind: 'TIMED', reservedDurationMin: 60,
    startTime: '2035-11-07T18:00:00Z', endTime: '2035-11-07T19:00:00Z', timezone: 'America/Los_Angeles', localDate: '2035-11-07', localStartTime: '10:00', localEndTime: '11:00',
    holdExpiresAt: null, items: [], addOns: [], priceCents: 10025, totalCents: 10025, paidCents: 0, refundedCents: 0,
  };
  const settlements = () => ({ bookingId: '42', shopId: '5', orderOnly: true, onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER', paymentMode: 'PAY_AT_STORE', currency: 'usd', status: booking.status, paymentStatus: 'UNPAID', totalCents: 10025, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 10025, entries: [], allowedActions: { confirm: booking.status === 'PENDING', complete: false, cancel: booking.status === 'PENDING', recordReceipt: false, recordRefund: false } });
  const writes = [];
  let slotsTimezone;
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(structuredClone(shops));
    if (config.url === '/bookings/42/settlements') return response(settlements());
    if (config.url === '/bookings/42/reschedule-slots') return response({ date: config.params.date, timezone: slotsTimezone ?? booking.timezone, slots: [{ time: '10:00', available: true }, { time: '11:00', available: true }, { time: '12:00', available: false }] });
    if (config.url === '/bookings/42/reschedule') {
      const value = JSON.parse(config.data); writes.push({ action: 'move', value });
      booking = { ...booking, localDate: value.date, localStartTime: value.startTime, localEndTime: '12:00', startTime: value.date + 'T19:00:00Z', endTime: value.date + 'T20:00:00Z' };
      return response(booking);
    }
    if (config.url === '/bookings/42/cancel') {
      const value = JSON.parse(config.data);
      writes.push({ action: 'cancel', value, requestKey: config.headers.get('Idempotency-Key') });
      booking = { ...booking, status: 'CANCELLED', cancelReason: value.cancelReason };
      return response(booking);
    }
    assert.equal(config.url, '/bookings/42', 'unexpected HTTP request');
    return response(structuredClone(booking));
  };
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const BookingDetails = (await server.ssrLoadModule('/src/components/BookingDetails.tsx')).default;
    let tree, shopContext, updated = 0;
    function Probe() { shopContext = useShopId(); tree = BookingDetails({ id: '42', shopId: '5', onClose() {}, onUpdated() { updated++; } }); return null; }
    auth.getState().setAuth('synthetic-only', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(Probe)) }], { initialEntries: ['/bookings?shopId=5'] });
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const control = predicate => { const node = find(tree, predicate); assert.ok(node, 'expected order control'); return node; };
    const button = label => control(node => node.props.children === label && typeof node.props.onClick === 'function');
    const moveForm = () => control(node => node.type === Form);
    const detail = () => control(node => node.type === Descriptions).props.items;
    assert.equal(detail().find(item => item.key === 'total').children, 'USD 100.25');
    assert.equal(writes.length, 0);
    await act(async () => { button('改期').props.onClick(); });
    slotsTimezone = 'America/New_York';
    await act(async () => { moveForm().props.form.setFieldsValue({ date: '2035-11-08' }); moveForm().props.onValuesChange({ date: '2035-11-08' }); });
    const capturedSubmit = moveForm().props.onFinish;
    assert.equal(control(node => node.props.placeholder === '请选择可用开始时间').props.disabled, true, 'slots in another zone cannot populate a form labelled with the saved booking zone');
    assert.equal(control(node => node.props.children === '核对资源并保存').props.disabled, true);
    assert.ok(find(tree, node => typeof node.props.title === 'string' && node.props.title.includes('时区不匹配')));
    await act(async () => { capturedSubmit({ date: '2035-11-08', startTime: '11:00' }); });
    assert.equal(writes.length, 0, 'a captured submit cannot bypass a mismatched slot zone');
    slotsTimezone = undefined;
    await act(async () => { button('重新查询时段').props.onClick(); });
    assert.equal(control(node => node.props.placeholder === '请选择可用开始时间').props.disabled, false, 'a fresh matching-zone response restores selection');
    await act(async () => { capturedSubmit({ date: '2035-11-09', startTime: '11:00' }); });
    assert.equal(writes.length, 0, 'slots for one day cannot authorize submission of a different day');
    await act(async () => { capturedSubmit({ date: '2035-11-08', startTime: '12:00' }); });
    assert.equal(writes.length, 0, 'unavailable slots cannot be submitted');
    shops = shops.map(shop => ({ ...shop, permissions: ['BOOKINGS_READ'] }));
    await act(async () => { await shopContext.reloadShop('5'); });
    assert.equal(moveForm().props.disabled, true);
    await act(async () => { capturedSubmit({ date: '2035-11-08', startTime: '11:00' }); });
    assert.equal(writes.length, 0, 'revocation also stops a handler captured before asynchronous form validation');
    shops = shops.map(shop => ({ ...shop, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'] }));
    await act(async () => { await shopContext.reloadShop('5'); });
    await act(async () => { moveForm().props.form.setFieldValue('startTime', '11:00'); moveForm().props.onValuesChange({ startTime: '11:00' }); });
    await act(async () => { moveForm().props.onFinish({ date: '2035-11-08', startTime: '11:00' }); });
    assert.deepEqual(writes, [{ action: 'move', value: { date: '2035-11-08', startTime: '11:00' } }]);
    assert.equal(updated, 1); assert.equal(booking.totalCents, 10025);
    assert.equal(detail().find(item => item.key === 'total').children, 'USD 100.25', 'moving does not reprice an order');
    assert.equal(find(tree, node => node.type === Form), undefined, 'saved move exits its draft');

    const cancelReason = '顾客来电要求取消';
    const openCancellation = async () => {
      const previousCount = confirmations.length;
      await act(async () => { button('取消预约').props.onClick(); });
      assert.equal(confirmations.length, previousCount + 1);
      const confirmation = confirmations.at(-1);
      assert.equal(confirmation.options.okButtonProps.disabled, true);
      const field = find(confirmation.options.content, node => node.type === Input.TextArea);
      assert.ok(field, 'admin cancellation requests a reason');
      await act(async () => { field.props.onChange({ target: { value: '  ' + cancelReason + '  ' } }); });
      assert.equal(confirmation.options.okButtonProps.disabled, false);
      return confirmation;
    };
    const declinedCancel = await openCancellation();
    await act(async () => { declinedCancel.resolve(false); });
    assert.equal(writes.length, 1, 'declining cancellation does not write');
    const pendingCancel = await openCancellation();
    shops = shops.map(shop => ({ ...shop, permissions: ['BOOKINGS_READ'] }));
    await act(async () => { await shopContext.reloadShop('5'); pendingCancel.resolve(true); });
    assert.equal(writes.length, 1, 'confirmation cannot outlive the permission that opened it');
    shops = shops.map(shop => ({ ...shop, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'] }));
    await act(async () => { await shopContext.reloadShop('5'); });
    const acceptedCancel = await openCancellation();
    await act(async () => { acceptedCancel.resolve(true); });
    assert.equal(writes.length, 2, 'the confirmed cancellation submits exactly once');
    const { action, value, requestKey } = writes.at(-1);
    assert.equal(action, 'cancel');
    assert.deepEqual(value, { cancelReason });
    assert.match(requestKey, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/);
    assert.equal(booking.status, 'CANCELLED'); assert.equal(updated, 2); assert.equal(booking.totalCents, 10025);
    assert.equal(detail().find(item => item.key === 'cancelReason').children.props.children, cancelReason);
    assert.equal(find(tree, node => node.props.children === '取消预约' && typeof node.props.onClick === 'function'), undefined);
  } finally {
    if (root) await act(async () => { root.unmount(); });
    router?.dispose(); auth?.getState().logout(); await server.close(); axios.defaults.adapter = previousAdapter;
    Form.useForm = previousUseForm; Form.useWatch = previousUseWatch; Modal.useModal = previousUseModal;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else delete globalThis.window;
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
