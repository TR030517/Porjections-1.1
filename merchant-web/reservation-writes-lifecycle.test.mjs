import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Form, Modal } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  if (predicate(tree)) return tree;
  return find([tree.props.children, tree.props.extra, tree.props.action, tree.props.items?.map(item => item.children)], predicate);
};

test('reservation settings serialize validation, confirmation and uncertain writes across real hook lifecycles', async t => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal, oldUseForm = Form.useForm, oldUseWatch = Form.useWatch;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let confirmation, confirms = 0, tree, context, root, router, auth, writeGate, failRead = false;
  const writes = [];
  Modal.useModal = () => [{ confirm: async () => { confirms++; return confirmation ? confirmation.promise : true; } }, null];
  Form.useForm = () => [React.useMemo(() => {
    let values = {};
    return { resetFields() { values = {}; }, setFieldsValue(next) { values = { ...values, ...next }; }, getFieldsValue() { return values; }, getFieldValue(name) { return values[name]; }, setFieldValue(name, value) { values[name] = value; }, validateFields: async () => values };
  }, [])];
  Form.useWatch = () => undefined;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const configs = Object.fromEntries(['5', '6'].map(shopId => [shopId, {
    shopId, timezone: 'America/Los_Angeles', orderOnly: true, businessHours: Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '22:00' }])), bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [] },
    paymentPolicy: { payAtStoreEnabled: true }, bookingSettingsHash: 'a'.repeat(64), services: [], rooms: [],
    therapists: [{ id: shopId + '1', shopId, name: 'Synthetic therapist', isActive: true, scheduleMode: 'SHOP', serviceIds: [],
      shifts: [{ id: shopId + '2', therapistId: shopId + '1', weekday: 1, startMin: 540, endMin: 1320, isActive: true }], timeOff: [] }],
  }]));
  let shops = ['5', '6'].map(id => ({ id, name: 'Synthetic shop ' + id, timezone: 'America/Los_Angeles', permissions: ['RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true }));
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(structuredClone(shops));
    const match = config.url.match(/^\/reservation-admin\/shops\/(5|6)\/(.+)$/); assert.ok(match, config.url);
    const [, shopId, resource] = match;
    if (config.method === 'get' && resource === 'config') { if (failRead) throw Error('Synthetic failed read'); return response(structuredClone(configs[shopId])); }
    writes.push({ shopId, resource, method: config.method, value: config.data ? JSON.parse(config.data) : null });
    if (writeGate) return response(await writeGate.promise);
    if (resource === 'booking-settings') { const { expectedSettingsHash, ...value } = JSON.parse(config.data); assert.equal(expectedSettingsHash, configs[shopId].bookingSettingsHash); configs[shopId].bookingSettings = value; return response({ item: { shopId, bookingSettings: value, bookingSettingsHash: 'a'.repeat(64) } }); }
    return response(config.method === 'delete' ? { success: true } : { item: { id: '99' } });
  };
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const ReservationsPage = (await server.ssrLoadModule('/src/pages/reservations/index.tsx')).default;
    function Probe() { context = useShopId(); tree = ReservationsPage(); return null; }
    auth.getState().setAuth('synthetic-only', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(Probe)) }], { initialEntries: ['/reservations?shopId=5&tab=therapists'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const control = predicate => { const node = find(tree, predicate); assert.ok(node, 'expected settings control'); return node; };
    const button = label => control(node => node.props.children === label && typeof node.props.onClick === 'function');
    const modal = () => control(node => node.props.okText === '保存当前设置').props;
    const form = () => control(node => node.props.form && node.props.onValuesChange).props;
    const panel = () => control(node => node.props.onSave && node.props.settings).props;
    const open = () => act(async () => { button('新增排班').props.onClick(); });
    let identity = 1;
    const switchShop = id => act(async () => { auth.getState().setAuth('synthetic-' + (++identity), { id: String(identity), role: 'ADMIN' }); await router.navigate('/reservations?shopId=' + id + '&tab=therapists'); });
    const values = { weekday: 2, startTime: '09:00', endTime: '22:00', isActive: true };

    await t.test('double click during async form validation produces one resource request', async () => {
      await open(); const validation = deferred(); form().form.validateFields = () => validation.promise;
      const save = modal().onOk, before = writes.length;
      await act(async () => { save(); save(); });
      assert.equal(writes.length, before);
      await act(async () => { validation.resolve(values); });
      assert.equal(writes.length, before + 1); assert.equal(writes.at(-1).resource, 'shifts');
    });
    await t.test('same rules callback cannot issue two PATCHes before React rerenders', async () => {
      await act(async () => { panel().onChange({ minimumNoticeMinutes: 60, closedPeriods: [] }); });
      writeGate = deferred(); const save = panel().onSave, before = writes.length;
      await act(async () => { save(); save(); });
      assert.equal(writes.length, before + 1);
      await act(async () => { writeGate.resolve({ item: { shopId: '5', bookingSettings: { minimumNoticeMinutes: 60, closedPeriods: [] }, bookingSettingsHash: 'a'.repeat(64) } }); }); writeGate = undefined;
    });
    await t.test('old validation never submits after changing shop and returning', async () => {
      await open(); const validation = deferred(); form().form.validateFields = () => validation.promise;
      const before = writes.length; await act(async () => { modal().onOk(); });
      await switchShop('6'); await switchShop('5'); await open();
      await act(async () => { validation.resolve(values); });
      assert.equal(writes.length, before); assert.equal(modal().open, true);
      await act(async () => { modal().onCancel(); });
    });
    await t.test('unknown resource result also rejects an old captured save callback', async () => {
      await open(); form().form.validateFields = async () => values; writeGate = deferred();
      const save = modal().onOk; await act(async () => { save(); });
      await act(async () => { writeGate.reject(new Error('Synthetic lost response')); }); writeGate = undefined;
      const before = writes.length; await act(async () => { save(); });
      assert.equal(writes.length, before); assert.equal(modal().open, true); assert.equal(panel().disabled, true);
      failRead = true;
      await act(async () => { button('结束草稿并核对').props.onClick(); });
      assert.equal(modal().open, true, 'failed reconciliation preserves the original editor');
      assert.equal(panel().disabled, true, 'failed reconciliation does not permit a new write');
      assert.equal(writes.length, before);
      failRead = false;
      await act(async () => { button('结束草稿并核对').props.onClick(); });
      assert.equal(modal().open, false); assert.equal(panel().disabled, false);
    });
    await t.test('duplicate delete clicks share one confirmation and permission is rechecked after it', async () => {
      const tabs = control(node => node.props.activeKey === 'therapists' && node.props.items).props.items;
      const therapistTab = tabs.find(item => item.key === 'therapists').children;
      const remove = find(therapistTab, node => node.props.children === '停用').props.onClick;
      const before = writes.length, priorConfirms = confirms; confirmation = deferred();
      await act(async () => { remove(); remove(); }); assert.equal(confirms, priorConfirms + 1);
      shops = shops.map(shop => shop.id === '5' ? { ...shop, permissions: [] } : shop);
      await act(async () => { await context.reloadShop('5'); confirmation.resolve(true); }); confirmation = undefined;
      assert.equal(writes.length, before);
      shops = shops.map(shop => ({ ...shop, permissions: ['RESERVATION_CONFIG'] }));
      await act(async () => { await context.reloadShop('5'); });
    });
    await t.test('discard confirmation from an earlier shop cannot close the current editor', async () => {
      await open(); await act(async () => { form().onValuesChange({ startTime: '10:00' }); });
      confirmation = deferred(); await act(async () => { modal().onCancel(); });
      await switchShop('6'); await open();
      await act(async () => { confirmation.resolve(true); }); confirmation = undefined;
      assert.equal(modal().open, true); assert.equal(modal().confirmLoading, false);
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout();
    await server.close(); axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal; Form.useForm = oldUseForm; Form.useWatch = oldUseWatch;
    for (const [name, prior] of [['window', oldWindow], ['IS_REACT_ACT_ENVIRONMENT', oldAct]]) { if (prior) Object.defineProperty(globalThis, name, prior); else delete globalThis[name]; }
  }
});
