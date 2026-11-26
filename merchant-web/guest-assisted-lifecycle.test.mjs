import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Modal } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';
function find(tree, predicate) { if (Array.isArray(tree)) return tree.map(item => find(item, predicate)).find(Boolean); if (!React.isValidElement(tree)) return; return predicate(tree) ? tree : find(tree.props.children, predicate); }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };

test('first caller form uses actual contact, service, preference, quote, receipt and fenced recovery lifecycle without account discovery', async t => {
  const previous = Object.fromEntries(['window', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])), oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null }, stored = new Map(), calls = [], created = [];
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } });
  Modal.useModal = () => [{ confirm: async () => true, info() {} }, null];
  let permissions = ['BOOKINGS_READ', 'BOOKINGS_MANAGE'], tree, root, router, auth, context, createGate, shown = true, closed = 0;
  const slotResponses = new Map();
  const initialSelection = { date: '2035-11-10', startTime: '10:00' }, writes = () => calls.filter(row => row.url.endsWith('/guest-assisted-bookings') && row.method === 'post'), quotes = () => calls.filter(row => row.url.endsWith('/guest-assisted-quote'));
  const quote = input => ({ quoteHash: 'a'.repeat(64), quoteExpiresAt: new Date(Date.now() + 300000).toISOString(), totalCents: 7500, currency: 'usd', durationMin: 60, timezone: 'America/Los_Angeles', localDate: input.date, localStartTime: input.startTime, requestedTherapistIds: input.preferredTherapistIds ?? [], assignedTherapistIds: input.preferredTherapistIds?.length ? input.preferredTherapistIds : ['12'] });
  const receipt = input => ({ shopId: '7', requestKey: input.requestKey, outcome: 'COMMITTED', result: { bookingId: '42', bookingNo: 'MJ-SYNTHETIC-42' } });
  axios.defaults.adapter = async config => {
    const input = typeof config.data === 'string' ? JSON.parse(config.data) : config.data, response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    calls.push({ url: config.url, method: config.method, params: config.params, input });
    if (config.url === '/merchant/shops') return response([{ id: '7', name: 'Synthetic shop', timezone: 'America/Los_Angeles', permissions, accessType: 'STAFF', isOwner: false }]);
    if (config.url.endsWith('/booking-services')) return response([{ id: '8', name: 'Real synthetic massage', durationMin: 60, hasVariants: true, isActive: true, variants: [{ id: '9', name: '60 min', durationMin: 60, priceCents: 7500, isActive: true }], participantCount: 1, requiredStaffCount: 1 }]);
    if (config.url.endsWith('/booking-therapists')) return response([{ id: '12', name: 'Synthetic therapist' }]);
    if (config.url === '/merchant/shops/7/assisted-slots') {
      const { date } = config.params;
      const slots = slotResponses.has(date) ? await slotResponses.get(date) : [{ time: '10:00', available: true }];
      return response({ date, timezone: 'America/Los_Angeles', durationMin: 60, slots });
    }
    if (config.url.endsWith('/guest-assisted-quote')) return response(quote(input));
    if (config.url.endsWith('/guest-assisted-bookings')) return response(createGate ? await createGate.promise : receipt(input));
    if (config.url.endsWith('/reconcile')) return response({ shopId: '7', requestKey: config.url.split('/').at(-2), outcome: 'NOT_EXECUTED' });
    if (config.url.includes('/operations/')) return response({ shopId: '7', requestKey: config.url.split('/').at(-1), outcome: 'NOT_FOUND' });
    throw new Error('Unexpected request ' + config.url);
  };
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await vite.ssrLoadModule('/src/hooks/useShopId.ts'), { MerchantDraftGuard } = await vite.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const GuestForm = (await vite.ssrLoadModule('/src/pages/bookings/GuestAssistedBookingModal.tsx')).default;
    function Surface() { tree = GuestForm({ shopId: '7', shopName: 'Synthetic shop', initialSelection, initialTimezone: 'America/Los_Angeles', onClose: () => { closed++; }, onExisting() {}, onCreated: (...args) => created.push(args) }); return null; }
    function Probe() { context = useShopId(); if (!context.shop || !shown) return null; return React.createElement(Surface); }
    function GuardProbe() { const node = MerchantDraftGuard({ children: null }); return React.createElement(node.type, { value: node.props.value }, React.createElement(Probe)); }
    auth.getState().setAuth('synthetic-only', { id: '1', role: 'STAFF' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(GuardProbe) }], { initialEntries: ['/bookings?shopId=7'] }); root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const field = label => { const node = find(tree, node => node.props['aria-label'] === label); assert.ok(node, label); return node; };
    const button = label => { const node = find(tree, node => node.props.children === label && typeof node.props.onClick === 'function'); assert.ok(node, label); return node; };
    const change = async (label, value, direct = false) => act(async () => { field(label).props.onChange(direct ? value : { target: { value } }); });
    const remount = async () => { shown = false; await act(async () => { router.navigate('/bookings?shopId=7&reload=1'); }); shown = true; await act(async () => { router.navigate('/bookings?shopId=7'); }); };
    await t.test('time selector explains prerequisites, loading, no availability and a retryable failure', async () => {
      const time = () => field('首次客可用时间').props;
      assert.equal(time().placeholder, '先选择预约服务');
      await change('首次客预约服务', '8', true);
      assert.equal(time().placeholder, '先选择服务规格');
      await change('首次客预约日期', '');
      await change('首次客服务规格', '9', true);
      assert.equal(time().placeholder, '先选择预约日期');

      const outdated = deferred();
      slotResponses.set('2035-11-11', outdated.promise);
      await change('首次客预约日期', '2035-11-11');
      assert.equal(time().placeholder, '正在查询可预约时段…');
      assert.equal(time().loading, true);
      assert.equal(time().disabled, true);

      slotResponses.set('2035-11-12', [{ time: '10:00', available: false }]);
      await change('首次客预约日期', '2035-11-12');
      assert.equal(time().placeholder, '所选条件下无可预约时段');
      assert.equal(time().loading, false);
      assert.equal(time().disabled, true);
      await act(async () => { outdated.resolve([{ time: '18:00', available: true }]); });
      assert.deepEqual(time().options, [], 'late results do not repopulate the picker');

      const failure = deferred();
      slotResponses.set('2035-11-13', failure.promise);
      await change('首次客预约日期', '2035-11-13');
      await act(async () => { failure.reject(new Error('Synthetic slot failure')); });
      assert.equal(time().placeholder, '时段查询失败');
      assert.equal(time().loading, false);
      assert.equal(time().disabled, true);
      const retry = find(tree, node => node.props.title === '无法查询可预约时段')?.props.action;
      assert.equal(retry?.props.children, '重试查询时段');

      slotResponses.delete('2035-11-13');
      await act(async () => { retry.props.onClick(); });
      assert.equal(time().placeholder, '选择可预约时段');
      assert.equal(time().disabled, false);
      assert.deepEqual(time().options, [{ value: '10:00', label: '10:00' }]);
      assert.equal(calls.filter(call => call.url.endsWith('/assisted-slots') && call.params.date === '2035-11-13').length, 2);
      assert.equal(find(tree, node => node.props.title === '无法查询可预约时段'), undefined);
      assert.equal(quotes().length, 0);
      await remount();
    });
    await t.test('calendar preference waits for real service slots and no account search occurs when first guest contacts are entered', async () => {
      assert.equal(field('首次客预约日期').props.value, initialSelection.date); assert.equal(writes().length, 0); assert.equal(quotes().length, 0);
      await change('首次客预约服务', '8', true); assert.equal(field('首次客可用时间').props.value, undefined, 'real variant must be chosen before selecting a time');
      await change('首次客服务规格', '9', true); assert.equal(field('首次客可用时间').props.value, '10:00');
      await change('首次客姓名', ' Synthetic caller '); await change('首次客国际电话', '2025550101');
      await act(async () => { button('核对首次客预约').props.onClick(); }); assert.equal(quotes().length, 0); assert.match(find(tree, node => typeof node.props.title === 'string' && node.props.title.includes('国际电话号码')).props.title, /国际/);
      await change('首次客国际电话', '+1 (202) 555-0101'); await change('首次客邮箱', 'EXISTING@Example.Test'); await change('首次客来源', 'WALK_IN', true); await change('首次客指定技师', ['12'], true);
      await change('首次客可用时间', '10:00', true); await act(async () => { button('核对首次客预约').props.onClick(); });
      assert.deepEqual(quotes().at(-1).input.contact, { name: 'Synthetic caller', phone: '+12025550101', email: 'existing@example.test' }); assert.deepEqual(quotes().at(-1).input.preferredTherapistIds, ['12']); assert.equal(quotes().at(-1).input.variantId, '9');
      assert.equal(calls.some(call => call.url.includes('/customers') || call.url.includes('/auth') || call.url === '/bookings/slots'), false); assert.equal(calls.filter(call => call.url.endsWith('/assisted-slots')).at(-1).params.preferredTherapistIds, '12');
      await change('首次客邮箱', ''); assert.equal(find(tree, node => node.props.children === '创建预约申请'), undefined, 'changing optional contact invalidates the bound quote');
      await act(async () => { button('核对首次客预约').props.onClick(); }); assert.equal(quotes().at(-1).input.contact.email, null);
    });
    await t.test('captured create obeys current authority and duplicate clicks freeze the exact guest request before network', async () => {
      const submit = button('创建预约申请').props.onClick;
      permissions = ['BOOKINGS_READ']; await act(async () => { await context.reloadShop('7'); }); await act(async () => { submit(); }); assert.equal(writes().length, 0);
      permissions = ['BOOKINGS_READ', 'BOOKINGS_MANAGE']; await act(async () => { await context.reloadShop('7'); });
      await change('首次客可用时间', '10:00', true); await act(async () => { button('核对首次客预约').props.onClick(); }); createGate = deferred();
      const recheckedSubmit = button('创建预约申请').props.onClick;
      await act(async () => { recheckedSubmit(); recheckedSubmit(); }); assert.equal(writes().length, 1); assert.equal(stored.size, 1); assert.equal(tree.props.closable, false); await act(async () => { tree.props.onCancel(); }); assert.equal(closed, 0);
      const request = writes()[0].input; assert.equal(request.guestSource, 'WALK_IN'); assert.equal(request.contact.email, null); assert.deepEqual(request.preferredTherapistIds, ['12']);
      for (const field of ['customerId', 'paymentMode', 'tipCents', 'emailVerified']) assert.equal(field in request, false);
      await act(async () => { createGate.reject(new Error('response lost')); }); createGate = undefined; assert.equal(created.length, 0);
    });
    await t.test('refresh restores original contact/key; query not-found never releases it, locked reconciliation fences before editable re-quote', async () => {
      const first = writes()[0].input; await remount(); assert.ok(find(tree, node => node.props['aria-label'] === '首次客预约原请求恢复'));
      await act(async () => { button('查询原请求结果').props.onClick(); }); assert.equal(writes().length, 1); assert.equal(stored.size, 1); assert.equal(find(tree, node => node.props.children === '恢复原草稿并重新核价'), undefined);
      await act(async () => { button('锁定核对原请求').props.onClick(); }); await act(async () => { button('恢复原草稿并重新核价').props.onClick(); });
      assert.equal(field('首次客姓名').props.value, first.contact.name); assert.equal(field('首次客国际电话').props.value, first.contact.phone); assert.deepEqual(field('首次客指定技师').props.value, ['12']); assert.equal(field('首次客可用时间').props.value, first.startTime); assert.equal(stored.size, 0);
      await act(async () => { button('核对首次客预约').props.onClick(); }); await act(async () => { button('创建预约申请').props.onClick(); }); assert.equal(writes().length, 2); assert.notEqual(writes()[1].input.requestKey, first.requestKey); assert.deepEqual(writes()[1].input.contact, first.contact);
    });
    await t.test('success does not confirm or charge; stable receipt is reopened after refresh and explicit details action alone hands it to the shared drawer', async () => {
      assert.equal(created.length, 0); assert.equal(calls.some(call => /confirm|receipt|payment/.test(call.url)), false); assert.ok(button('查看详情／确认接单')); assert.equal(stored.size, 1);
      await remount(); assert.ok(button('查看详情／确认接单')); assert.equal(writes().length, 2);
      await act(async () => { button('查看详情／确认接单').props.onClick(); }); assert.equal(created.length, 1); assert.equal(created[0][0].result.bookingId, '42'); assert.equal(created[0][1], true); assert.equal(stored.size, 0);
    });
  } finally {
    if (root) await act(async () => root.unmount()); router?.dispose(); auth?.getState().logout(); await vite.close(); axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal;
    for (const key of Object.keys(previous)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
});
