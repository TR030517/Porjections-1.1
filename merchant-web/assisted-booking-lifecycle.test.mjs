import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find(tree.props.children, predicate);
};
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

test('assisted booking guards stale quotes, permissions, duplicate writes and uncertain recovery', async t => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const oldAdapter = axios.defaults.adapter;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} };
  doc.defaultView = win;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const stored = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } });
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let root, router, auth, tree, context, shown = true, created = 0, createdReceipt, quoteGate, createGate, expiredQuote = false, initialSelection, slotsGate;
  let shops = [{ id: '5', name: 'Synthetic shop', timezone: 'America/Los_Angeles', permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'], accessType: 'ADMIN', isOwner: true }];
  const writes = [], quotes = [];
  const quote = () => ({ quoteHash: 'a'.repeat(64), quoteExpiresAt: new Date(Date.now() + (expiredQuote ? -1000 : 300000)).toISOString(), totalCents: 18000, currency: 'usd' });
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(structuredClone(shops));
    if (config.url.endsWith('/booking-services')) return response([{ id: '8', name: 'Four hands', durationMin: 60, hasVariants: false, isActive: true, variants: [] }]);
    if (config.url.endsWith('/booking-therapists')) return response([{ id: '12', name: 'Synthetic therapist' }]);
    if (config.url.endsWith('/customers')) return response([{ id: '9', name: 'Synthetic guest', email: 'guest@example.test', phone: '+12025550123' }]);
    if (config.url === '/merchant/shops/5/assisted-slots') return response(slotsGate ? await slotsGate.promise : { date: config.params.date, timezone: 'America/Los_Angeles', durationMin: 60, slots: [{ time: '10:00', available: true }] });
    if (config.url.endsWith('/assisted-quote')) { quotes.push(JSON.parse(config.data)); return response(quoteGate ? await quoteGate.promise : quote()); }
    if (config.url.endsWith('/assisted-bookings')) { const request = JSON.parse(config.data); writes.push(request); return response(createGate ? await createGate.promise : { id: '42', shopId: '5', bookingNo: 'MJSYNTHETIC42' }); }
    throw new Error('Unexpected request ' + config.url);
  };
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const { AssistedBookingModal } = await server.ssrLoadModule('/src/pages/bookings/index.tsx');
    function ModalProbe() { tree = AssistedBookingModal({ shopId: '5', initialSelection, initialTimezone: 'America/Los_Angeles', onClose() {}, onCreated(receipt) { created++; createdReceipt = receipt; } }); return null; }
    function Probe() { context = useShopId(); return shown ? React.createElement(ModalProbe) : null; }
    auth.getState().setAuth('synthetic-only', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(Probe) }], { initialEntries: ['/bookings?shopId=5'] });
    root = createRoot(container);
    const render = () => act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    await render();
    const control = predicate => { const node = find(tree, predicate); assert.ok(node, 'expected assisted booking control'); return node; };
    const button = label => control(node => node.props.children === label && typeof node.props.onClick === 'function');
    const change = (placeholder, value) => act(async () => { control(node => node.props.placeholder === placeholder).props.onChange(value); });
    const prepare = async () => {
      await change('搜索本店历史客户姓名/邮箱/电话', { target: { value: 'Synthetic' } });
      await act(async () => { button('搜索客户').props.onClick(); });
      await change('选择已验证邮箱客户', '9');
      await change('选择可预约服务', '8');
      await act(async () => { control(node => node.props.type === 'date').props.onChange({ target: { value: '2035-11-10' } }); });
      await act(async () => { control(node => node.props['aria-label'] === '可预约时段').props.onChange('10:00'); });
    };
    await prepare();
    await t.test('selecting an authorized customer prefills a reviewed immutable-email contact', async () => {
      assert.equal(control(node => node.props['aria-label'] === '本次预约联系人姓名').props.value, 'Synthetic guest');
      assert.equal(control(node => node.props['aria-label'] === '本次预约联系人电话').props.value, '+12025550123');
      const email = control(node => node.props['aria-label'] === '已验证账号邮箱');
      assert.equal(email.props.value, 'guest@example.test'); assert.equal(email.props.readOnly, true);
    });
    await act(async () => { button('核对预约').props.onClick(); });
    await t.test('the reviewed contact travels in the server quote and remains bound to final creation', async () => {
      assert.deepEqual(quotes.at(-1).contact, { name: 'Synthetic guest', phone: '+12025550123', email: 'guest@example.test' });
    });

    await t.test('same confirmed click cannot send two distinct order requests', async () => {
      createGate = deferred();
      const confirm = button('创建预约申请').props.onClick;
      await act(async () => { confirm(); confirm(); });
      assert.equal(writes.length, 1, 'duplicate callbacks must share the synchronous operation lock');
      await act(async () => { createGate.resolve({ id: '42', shopId: '5', bookingNo: 'MJSYNTHETIC42' }); });
      createGate = undefined;
      assert.equal(created, 1);
      assert.deepEqual(createdReceipt?.result, { bookingId: '42', bookingNo: 'MJSYNTHETIC42' });
      assert.equal(createdReceipt?.requestKey, writes[0].requestKey);
      assert.deepEqual(writes[0].contact, quotes.at(-1).contact);
    });

    const remount = async () => {
      shown = false; await act(async () => { router.navigate('/bookings?shopId=5&remount=' + Math.random()); });
      shown = true; await act(async () => { router.navigate('/bookings?shopId=5'); });
    };
    await remount(); await prepare();
    await t.test('editing the reviewed contact invalidates the quote and invalid contact is not sent', async () => {
      await act(async () => { button('核对预约').props.onClick(); });
      await act(async () => { control(node => node.props['aria-label'] === '本次预约联系人电话').props.onChange({ target: { value: 'bad phone' } }); });
      assert.equal(find(tree, node => node.props.children === '创建预约申请'), undefined);
      const before = quotes.length;
      await act(async () => { button('核对预约').props.onClick(); });
      assert.equal(quotes.length, before);
      await act(async () => { control(node => node.props['aria-label'] === '本次预约联系人电话').props.onChange({ target: { value: '+12025550123' } }); });
    });
    await act(async () => { button('核对预约').props.onClick(); });
    await t.test('revocation blocks a previously captured confirm handler', async () => {
      const confirm = button('创建预约申请').props.onClick;
      shops = shops.map(shop => ({ ...shop, permissions: ['BOOKINGS_READ'] }));
      await act(async () => { await context.reloadShop('5'); });
      const before = writes.length;
      await act(async () => { confirm(); });
      assert.equal(writes.length, before);
      shops = shops.map(shop => ({ ...shop, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'] }));
      await act(async () => { await context.reloadShop('5'); });
    });

    await remount(); await prepare();
    await t.test('an older quote response cannot approve an edited draft', async () => {
      quoteGate = deferred();
      await act(async () => { button('核对预约').props.onClick(); });
      await change('备注（可选）', { target: { value: 'Changed while quote was in flight' } });
      await act(async () => { quoteGate.resolve(quote()); }); quoteGate = undefined;
      assert.equal(find(tree, node => node.props.children === '创建预约申请'), undefined);
    });

    await remount(); await prepare();
    await act(async () => { button('核对预约').props.onClick(); });
    await t.test('late success after unmount keeps the recovery marker and does not close another modal', async () => {
      createGate = deferred();
      const before = created;
      await act(async () => { button('创建预约申请').props.onClick(); });
      shown = false; await act(async () => { router.navigate('/bookings?shopId=5&closed=1'); });
      await act(async () => { createGate.resolve({ id: '42', shopId: '5', bookingNo: 'MJSYNTHETIC42' }); }); createGate = undefined;
      assert.equal(created, before);
      assert.equal(stored.size, 1, 'unmounted response must not silently remove the original recovery marker');
    });

    shown = true; await act(async () => { router.navigate('/bookings?shopId=5'); });
    await t.test('unknown request retries the identical request key without requoting', async () => {
      const beforeQuotes = quotes.length, previous = writes.at(-1);
      await act(async () => { button('使用同一请求重试').props.onClick(); });
      assert.deepEqual(writes.at(-1), previous);
      assert.equal(quotes.length, beforeQuotes);
      assert.equal(stored.size, 0);
    });

    await remount(); await prepare();
    expiredQuote = true;
    await act(async () => { button('核对预约').props.onClick(); });
    await t.test('expired quote returns to review without sending an order', async () => {
      const before = writes.length;
      await act(async () => { button('创建预约申请').props.onClick(); });
      assert.equal(writes.length, before);
      assert.ok(button('核对预约'));
      assert.equal(stored.size, 0);
    });
    expiredQuote = false;

    await act(async () => { button('核对预约').props.onClick(); });
    await t.test('an initial conflict without an exact non-execution proof retains recovery', async () => {
      createGate = deferred();
      await act(async () => { button('创建预约申请').props.onClick(); });
      const original = structuredClone(writes.at(-1));
      await act(async () => { createGate.reject(Object.assign(new Error('quote changed before lookup'), { response: { status: 409 } })); }); createGate = undefined;
      assert.equal(stored.size, 1);
      assert.deepEqual(JSON.parse([...stored.values()][0]).request, original);
      assert.ok(button('使用同一请求重试'));
      await act(async () => { button('使用同一请求重试').props.onClick(); });
      assert.deepEqual(writes.at(-1), original);
      assert.equal(stored.size, 0);
    });
    await remount(); await prepare();
    await act(async () => { button('核对预约').props.onClick(); });
    await t.test('uncertain order and rejected recovery retain the same marker', async () => {
      createGate = deferred();
      await act(async () => { button('创建预约申请').props.onClick(); });
      const first = writes.at(-1);
      await act(async () => { createGate.reject(new Error('network unavailable')); }); createGate = undefined;
      assert.equal(stored.size, 1);
      const marker = [...stored.values()][0];
      createGate = deferred();
      await act(async () => { button('使用同一请求重试').props.onClick(); });
      assert.deepEqual(writes.at(-1), first);
      await act(async () => { createGate.reject(Object.assign(new Error('permission denied before lookup'), { response: { status: 403 } })); }); createGate = undefined;
      assert.equal([...stored.values()][0], marker);
      assert.ok(button('使用同一请求重试'));
    });
    await t.test('only an exact server proof restores an expired unknown attempt to a fresh review', async () => {
      const original = structuredClone(writes.at(-1)), marker = [...stored.values()][0];
      const proof = { code: 'ASSISTED_QUOTE_EXPIRED_NOT_EXECUTED', shopId: '5', requestKey: original.requestKey, quoteExpiresAt: original.quoteExpiresAt };
      const rejectRetry = async data => {
        createGate = deferred();
        await act(async () => { button('使用同一请求重试').props.onClick(); });
        await act(async () => { createGate.reject(Object.assign(new Error('expired quote'), { response: { status: 409, data } })); });
        createGate = undefined;
      };
      for (const data of [{ message: 'quote expired' }, { ...proof, shopId: '6' }, { ...proof, requestKey: 'assisted:another_original_request' }, { ...proof, quoteExpiresAt: '2030-01-01T00:00:00.000Z' }]) {
        await rejectRetry(data);
        assert.equal([...stored.values()][0], marker, 'unmatched or generic conflicts cannot settle the original request');
        assert.ok(button('使用同一请求重试'));
      }
      // Reopening starts with empty form state; recovery must restore the saved
      // original command rather than rely on the former modal's live draft.
      await remount();
      const markerKey = [...stored.keys()][0];
      const changedMarker = JSON.parse(marker);
      changedMarker.request.requestKey = 'assisted:a_newer_saved_original_request';
      stored.set(markerKey, JSON.stringify(changedMarker));
      await rejectRetry(proof);
      assert.equal(JSON.parse(stored.get(markerKey)).request.requestKey, changedMarker.request.requestKey, 'a reply must not remove a changed persisted marker');
      stored.set(markerKey, marker);
      const removeMarker = sessionStorage.removeItem;
      sessionStorage.removeItem = () => { throw new Error('storage unavailable'); };
      await rejectRetry(proof);
      assert.equal([...stored.values()][0], marker, 'storage failure cannot partially unlock recovery');
      sessionStorage.removeItem = removeMarker;
      await rejectRetry(proof);
      assert.equal(stored.size, 0);
      assert.equal(find(tree, node => node.props.children === '使用同一请求重试'), undefined);
      assert.equal(control(node => node.props.placeholder === '选择已验证邮箱客户').props.value, original.customerId);
      assert.equal(control(node => node.props['aria-label'] === '本次预约联系人电话').props.value, original.contact.phone);
      assert.equal(control(node => node.props.placeholder === '选择可预约服务').props.value, original.serviceId);
      assert.equal(control(node => node.props['aria-label'] === '可预约时段').props.value, undefined, 'an old time must be selected from fresh availability');
      assert.equal(find(tree, node => node.props.children === '创建预约申请'), undefined);
      const before = quotes.length;
      await act(async () => { control(node => node.props['aria-label'] === '可预约时段').props.onChange(original.startTime); });
      await act(async () => { button('核对预约').props.onClick(); });
      assert.equal(quotes.length, before + 1);
      assert.deepEqual(quotes.at(-1).contact, original.contact);
      assert.ok(button('创建预约申请'));
      const beforeCreated = created;
      await act(async () => { button('创建预约申请').props.onClick(); });
      assert.notEqual(writes.at(-1).requestKey, original.requestKey, 'a newly reviewed order requires a new key');
      assert.equal(created, beforeCreated + 1);
    });
    await t.test('a legacy request without a contact replays its unchanged original command and opens the returned order', async () => {
      const original = { ...writes.at(-1), requestKey: 'assisted:legacy_original_request_123456' };
      delete original.contact;
      stored.clear(); stored.set('massajoy2:assisted-booking:1:5', JSON.stringify({ actorId: '1', shopId: '5', request: original }));
      await remount();
      const beforeQuotes = quotes.length, beforeCreated = created;
      await act(async () => { button('使用同一请求重试').props.onClick(); });
      assert.deepEqual(writes.at(-1), original, 'upgrading the UI must never add current account contact to an unknown original request');
      assert.equal(quotes.length, beforeQuotes);
      assert.equal(created, beforeCreated + 1);
      assert.deepEqual(createdReceipt, { shopId: '5', requestKey: original.requestKey, outcome: 'COMMITTED', result: { bookingId: '42', bookingNo: 'MJSYNTHETIC42' } });
      assert.equal(stored.size, 0);
    });
    await t.test('a successful HTTP response without a stable booking reference remains unknown and retries the same request', async () => {
      await remount(); await prepare();
      await act(async () => { button('核对预约').props.onClick(); });
      const beforeCreated = created;
      createGate = deferred();
      await act(async () => { button('创建预约申请').props.onClick(); });
      const original = structuredClone(writes.at(-1));
      await act(async () => { createGate.resolve({ id: '42', shopId: '5' }); }); createGate = undefined;
      assert.equal(created, beforeCreated, 'an incomplete response must not claim completion or clear recovery');
      assert.equal(stored.size, 1);
      assert.deepEqual(JSON.parse([...stored.values()][0]).request, original);
      await act(async () => { button('使用同一请求重试').props.onClick(); });
      assert.deepEqual(writes.at(-1), original);
      assert.equal(created, beforeCreated + 1);
      assert.equal(createdReceipt.result.bookingNo, 'MJSYNTHETIC42');
      assert.equal(stored.size, 0);
    });
    await t.test('calendar date/time preference waits for latest service slots and does not create or quote automatically', async () => {
      stored.clear(); initialSelection = { date: '2035-11-10', startTime: '10:00' }; await remount();
      assert.equal(control(node => node.props.type === 'date').props.value, '2035-11-10');
      const beforeWrites = writes.length, beforeQuotes = quotes.length;
      slotsGate = deferred(); await change('选择可预约服务', '8');
      assert.equal(control(node => node.props['aria-label'] === '可预约时段').props.value, undefined);
      await act(async () => { slotsGate.resolve({ date: '2035-11-10', timezone: 'America/Los_Angeles', durationMin: 60, slots: [{ time: '10:00', available: true }] }); }); slotsGate = undefined;
      assert.equal(control(node => node.props['aria-label'] === '可预约时段').props.value, '10:00');
      assert.equal(writes.length, beforeWrites); assert.equal(quotes.length, beforeQuotes);
    });
    await t.test('calendar preference unavailable in latest slots remains unselected', async () => {
      initialSelection = { date: '2035-11-10', startTime: '14:00' }; await remount(); await change('选择可预约服务', '8');
      assert.equal(control(node => node.props['aria-label'] === '可预约时段').props.value, undefined);
      assert.ok(find(tree, node => typeof node.props.title === 'string' && node.props.title.includes('日历所选时间目前不可用')));
    });
    await t.test('late slots for an abandoned date cannot reapply the calendar preferred start time', async () => {
      initialSelection = { date: '2035-11-10', startTime: '10:00' }; await remount(); slotsGate = deferred();
      await change('选择可预约服务', '8'); const old = slotsGate; slotsGate = undefined;
      await act(async () => { control(node => node.props.type === 'date').props.onChange({ target: { value: '2035-11-11' } }); });
      await act(async () => { old.resolve({ date: '2035-11-10', timezone: 'America/Los_Angeles', durationMin: 60, slots: [{ time: '10:00', available: true }] }); });
      assert.equal(control(node => node.props.type === 'date').props.value, '2035-11-11');
      assert.equal(control(node => node.props['aria-label'] === '可预约时段').props.value, undefined);
    });
  } finally {
    if (root) await act(async () => { root.unmount(); });
    router?.dispose(); auth?.getState().logout(); await server.close(); axios.defaults.adapter = oldAdapter;
    for (const [name, prior] of [['window', oldWindow], ['IS_REACT_ACT_ENVIRONMENT', oldAct], ['sessionStorage', oldStorage]]) {
      if (prior) Object.defineProperty(globalThis, name, prior); else delete globalThis[name];
    }
  }
});
