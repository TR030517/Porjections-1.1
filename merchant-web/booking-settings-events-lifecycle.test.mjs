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
  return predicate(tree) ? tree : find([tree.props.children, tree.props.extra, tree.props.action, tree.props.items?.map(item => item.children)], predicate);
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function harness(run) {
  const previous = ['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal;
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let tree, hoursTree, settingsTree, root, router, auth, confirmation, patchGate, context;
  const writes = [], confirmations = [];
  const configs = Object.fromEntries(['5', '6'].map(shopId => [shopId, {
    shopId, timezone: 'America/Los_Angeles', orderOnly: true,
    businessHours: Object.fromEntries(days.map(day => [day, { open: '09:00', close: '22:00' }])),
    bookingSettings: { minimumNoticeMinutes: shopId === '5' ? 720 : 60, closedPeriods: [{ startDate: '2028-02-01', endDate: '2028-02-03' }] }, bookingSettingsHash: 'a'.repeat(64),
    paymentPolicy: { payAtStoreEnabled: true }, services: [], therapists: [], rooms: [],
  }]));
  let shops = ['5', '6'].map(id => ({ id, name: 'Synthetic shop ' + id, timezone: 'America/Los_Angeles', permissions: ['RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true }));
  Modal.useModal = () => [{ confirm: async options => { confirmations.push(options); return confirmation ? confirmation.promise : true; }, info() {} }, null];
  axios.defaults.adapter = async request => {
    const response = data => ({ config: request, data, status: 200, statusText: 'OK', headers: {} });
    if (request.url === '/merchant/shops') return response(structuredClone(shops));
    const match = request.url.match(/^\/reservation-admin\/shops\/(5|6)\/(config|hours|booking-settings)$/); assert.ok(match, request.url);
    const [, shopId, resource] = match;
    if (request.method === 'get') return response(structuredClone(configs[shopId]));
    assert.equal(request.method, 'patch'); const { expectedSettingsHash, ...values } = JSON.parse(request.data); if (resource === 'booking-settings') assert.equal(expectedSettingsHash, configs[shopId].bookingSettingsHash); writes.push({ shopId, resource, values });
    if (patchGate) await patchGate.promise;
    if (resource === 'hours') configs[shopId].businessHours = values.businessHours;
    else configs[shopId].bookingSettings = values;
    return response({ item: { shopId, businessHours: configs[shopId].businessHours, bookingSettings: configs[shopId].bookingSettings, bookingSettingsHash: 'a'.repeat(64) } });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const ReservationsPage = (await server.ssrLoadModule('/src/pages/reservations/index.tsx')).default;
    const { ShopBookingSettingsPanel } = await server.ssrLoadModule('/src/pages/reservations/ShopBookingSettingsPanel.tsx');
    function SettingsProbe({ props }) { settingsTree = ShopBookingSettingsPanel(props); return null; }
    function HoursProbe({ component: Component, props }) { hoursTree = Component(props); return null; }
    function PageProbe() {
      context = useShopId(); tree = ReservationsPage();
      const settings = find(tree, node => node.type === ShopBookingSettingsPanel);
      const hours = find(tree, node => node.props.onReconcile && node.props.onLifecycleChange && node.props.canWrite);
      if (!settings) settingsTree = undefined;
      if (!hours) hoursTree = undefined;
      return [settings && React.createElement(SettingsProbe, { key: 'settings:' + settings.key, props: settings.props }), hours && React.createElement(HoursProbe, { key: 'hours:' + hours.key, component: hours.type, props: hours.props })];
    }
    auth.getState().setAuth('synthetic-settings-events', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(PageProbe)) }], { initialEntries: ['/reservations?shopId=5&tab=hours'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const control = (value, predicate) => { const node = find(value, predicate); assert.ok(node, 'expected control'); return node.props; };
    const input = label => control(hoursTree, node => node.props['aria-label'] === label);
    const settingsInput = label => control(settingsTree, node => node.props['aria-label'] === label);
    const button = label => control([hoursTree, settingsTree], node => node.props.children === label && node.props.onClick);
    const panel = () => control(tree, node => node.type === ShopBookingSettingsPanel);
    await run({ writes, confirmations, configs, input, settingsInput, button, panel,
      change: (label, value) => act(async () => { input(label).onChange({ target: { value } }); }),
      changeSetting: (label, value) => act(async () => { settingsInput(label).onChange({ target: { value } }); }),
      click: label => act(async () => { button(label).onClick(); }),
      switchShop: shopId => act(async () => { await router.navigate('/reservations?shopId=' + shopId + '&tab=hours'); }),
      switchActorShop: shopId => act(async () => { auth.getState().setAuth('synthetic-new-actor', { id: '2', role: 'ADMIN' }); await router.navigate('/reservations?shopId=' + shopId + '&tab=hours'); }),
      setConfirmation: value => { confirmation = value; }, setPatchGate: value => { patchGate = value; },
      revoke: () => act(async () => { shops = shops.map(shop => ({ ...shop, permissions: [] })); await context.reloadShop(context.shopId); }),
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('old rule input callbacks cannot move old-shop closure dates into a newly selected shop', () => harness(async h => {
  const oldChange = h.panel().onChange, oldStart = h.settingsInput('闭店第 1 段开始日期').onChange;
  await h.switchShop('6'); const expected = structuredClone(h.panel().settings);
  await act(async () => { oldChange({ minimumNoticeMinutes: 1440, closedPeriods: [] }); oldStart({ target: { value: '2028-03-01' } }); });
  assert.deepEqual(h.panel().settings, expected); assert.equal(h.panel().dirty, false); assert.equal(h.writes.length, 0);
  await h.switchShop('5'); await act(async () => { oldChange({ minimumNoticeMinutes: 1440, closedPeriods: [] }); });
  assert.deepEqual(h.panel().settings, h.configs['5'].bookingSettings, 'an A → B → A round trip does not revive old events');
}));

test('an old closure input and stale save cannot undo a newer rule draft or PATCH stale values', () => harness(async h => {
  const oldEnd = h.settingsInput('闭店第 1 段结束日期').onChange;
  await h.changeSetting('闭店第 1 段开始日期', '2028-02-02');
  await act(async () => { oldEnd({ target: { value: '2028-02-04' } }); });
  assert.equal(h.panel().settings.closedPeriods[0].startDate, '2028-02-02', 'late previous-render input never rolls back another field');
  const staleSave = h.panel().onSave;
  await h.click('24 小时'); const expected = structuredClone(h.panel().settings);
  await act(async () => { staleSave(); }); assert.equal(h.writes.length, 0);
  await h.click('保存预约规则'); assert.equal(h.writes.length, 1); assert.deepEqual(h.writes[0].values, expected);
}));

test('old hours inputs cannot reset a newer boundary or let a stale save submit an older draft', () => harness(async h => {
  const oldEnd = h.input('周一结束时间1').onChange;
  await h.change('周一开始时间1', '10:00');
  await act(async () => { oldEnd({ target: { value: '21:00' } }); });
  assert.equal(h.input('周一开始时间1').value, '10:00');
  const staleSave = h.button('保存营业时间').onClick;
  await h.change('周一结束时间1', '20:00');
  await act(async () => { staleSave(); }); assert.equal(h.writes.length, 0);
  await h.click('保存营业时间'); assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0].values.businessHours.monday, [{ open: '10:00', close: '20:00' }]);
}));

test('an old copy click cannot apply an obsolete day selection and pending confirmation blocks further changes', () => harness(async h => {
  await act(async () => { h.input('营业时间来源日期').onChange('monday'); });
  await act(async () => { h.input('营业时间目标日期').onChange(['tuesday']); });
  const oldCopy = h.button('复制到所选日期').onClick;
  await act(async () => { h.input('营业时间目标日期').onChange(['wednesday']); });
  await act(async () => { oldCopy(); }); assert.equal(h.confirmations.length, 0);
  const pending = deferred(); h.setConfirmation(pending);
  const oldSource = h.input('营业时间来源日期').onChange;
  await h.click('复制到所选日期');
  await act(async () => { oldSource('friday'); }); assert.equal(h.input('营业时间来源日期').value, 'monday');
  await act(async () => { pending.resolve(true); }); h.setConfirmation(undefined);
  assert.equal(h.writes.length, 0, 'copy confirmation changes only the current local draft');
  assert.match(h.confirmations[0].content, /周一.*周三/);
}));

test('old rule edits cannot mutate the submitted draft while saving or after permission revocation', () => harness(async h => {
  await h.click('24 小时'); const capturedChange = h.panel().onChange, expected = structuredClone(h.panel().settings);
  const pending = deferred(); h.setPatchGate(pending); await h.click('保存预约规则');
  await act(async () => { capturedChange({ minimumNoticeMinutes: 0, closedPeriods: [] }); });
  assert.deepEqual(h.panel().settings, expected); assert.equal(h.writes.length, 1);
  await act(async () => { pending.resolve(); }); h.setPatchGate(undefined);
  const revokedChange = h.panel().onChange; await h.revoke();
  await act(async () => { revokedChange({ minimumNoticeMinutes: 0, closedPeriods: [] }); });
  assert.deepEqual(h.panel().settings, expected); assert.equal(h.panel().dirty, false); assert.equal(h.writes.length, 1);
}));

test('a previous hours-unit input cannot apply an hours value after switching the current unit to days', () => harness(async h => {
  const oldAmount = h.settingsInput('最短提前预约时间').onChange;
  await act(async () => { h.settingsInput('预约提前量单位').onChange(1440); });
  await act(async () => { oldAmount(2); });
  assert.equal(h.panel().settings.minimumNoticeMinutes, 720); assert.equal(h.panel().dirty, false);
  await act(async () => { h.settingsInput('最短提前预约时间').onChange(2); });
  assert.equal(h.panel().settings.minimumNoticeMinutes, 2880, 'the current input uses two days');
}));

test('an old hours-copy confirmation resolves without changing the new actor and shop draft', () => harness(async h => {
  await act(async () => { h.input('营业时间来源日期').onChange('monday'); });
  await act(async () => { h.input('营业时间目标日期').onChange(['tuesday']); });
  const pending = deferred(); h.setConfirmation(pending); await h.click('复制到所选日期');
  await h.switchActorShop('6'); await h.change('周一开始时间1', '11:00');
  await act(async () => { pending.resolve(true); }); h.setConfirmation(undefined);
  assert.equal(h.input('周一开始时间1').value, '11:00'); assert.equal(h.input('周二开始时间1').value, '09:00');
  assert.equal(h.writes.length, 0);
}));
