import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

function all(tree, predicate, found = []) {
  if (Array.isArray(tree)) { tree.forEach(child => all(child, predicate, found)); return found; }
  if (!React.isValidElement(tree)) return found;
  if (predicate(tree)) found.push(tree);
  all([tree.props.children, tree.props.actions, tree.props.action, tree.props.title], predicate, found); return found;
}
const find = (tree, predicate) => all(tree, predicate)[0];
async function withCalendar(run, options = {}) {
  const globals = ['window', 'IS_REACT_ACT_ENVIRONMENT', 'matchMedia'];
  const previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAdapter = axios.defaults.adapter;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: options.mobile ?? true }) });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const requests = [], opened = [];
  let mode = 'complete', apiTimezone = 'America/Los_Angeles', shopUtc, eventPatch = options.event ?? {}, omitEvent = false;
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    requests.push({ url: config.url, params: config.params });
    if (config.url === '/merchant/shops') return response([{ id: '7', name: 'Synthetic calendar store', timezone: 'America/Los_Angeles', permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'], accessType: 'ADMIN', isOwner: true }]);
    assert.equal(config.url, '/reservation-admin/shops/7/calendar-events', 'calendar-only entry must never request historical contact rows');
    if (mode === 'partial-failure' && config.params.cursor) throw Object.assign(new Error('模拟第二页读取失败'), { response: { status: 503, data: { message: '模拟第二页读取失败' } }, config });
    const { startDate, endDate } = config.params;
    const startAt = shopUtc(startDate + 'T10:00', apiTimezone), endAt = shopUtc(startDate + 'T10:30', apiTimezone);
    const resources = [{ type: 'THERAPIST', id: '12', name: 'Synthetic therapist' }];
    const event = { id: 'booking:41:item:1', eventType: 'BOOKING', bookingId: '41', itemId: '1', title: 'Synthetic calendar service', status: 'CONFIRMED', startAt, endAt, serviceStartAt: startAt, serviceEndAt: endAt, resources, allDay: false, occupiesResources: true, occupancySource: 'ACTIVE_LOCKS', ...eventPatch };
    return response({ shopId: '7', timezone: apiTimezone, serverNow: new Date().toISOString(), range: { startDate, endDate, startAt: shopUtc(startDate + 'T00:00', apiTimezone), endAt: shopUtc(endDate + 'T00:00', apiTimezone) }, version: 'synthetic-version', complete: mode !== 'partial-failure', nextCursor: mode === 'partial-failure' ? 'next-page' : null, events: omitEvent ? [] : [event], resources });
  };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let root, router, auth, tree;
  try {
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await vite.ssrLoadModule('/src/hooks/useShopId.ts');
    const BookingCalendar = (await vite.ssrLoadModule('/src/pages/bookings/BookingCalendar.tsx')).default;
    shopUtc = (await vite.ssrLoadModule('/src/utils/reservationTime.ts')).shopUtc;
    function Surface({ shop }) { const node = BookingCalendar({ shopId: '7', shopName: shop.name, timezone: shop.timezone, disabled: false, revision: 0, onOpenBooking: id => opened.push(id) }); tree = node.type(node.props); return null; }
    function Probe() { const { shop } = useShopId(); return shop ? React.createElement(Surface, { shop }) : null; }
    auth.getState().setAuth('synthetic-only', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(Probe) }], { initialEntries: ['/bookings?shopId=7'] });
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const field = label => { const node = find(tree, node => node.props['aria-label'] === label); assert.ok(node, `field ${label}`); return node; };
    const button = label => { const node = find(tree, node => node.props.children === label && typeof node.props.onClick === 'function'); assert.ok(node, `button ${label}`); return node; };
    await run({ tree: () => tree, field, button, requests, opened, mode(value) { mode = value; }, timezone(value) { apiTimezone = value; }, event(value) { omitEvent = value === null; if (value) eventPatch = { ...eventPatch, ...value }; } });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await vite.close(); axios.defaults.adapter = oldAdapter;
    for (const key of globals) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
}

test('mobile calendar defaults to a local day, month keeps all42dates, and an empty date opens read-only context', async () => withCalendar(async ({ tree, field, requests }) => {
  assert.equal(field('日历视图').props.value, 'day');
  assert.equal(requests.filter(request => request.url.includes('calendar-events')).length, 1, 'initial calendar issues one range read');
  const initial = requests.find(request => request.url.includes('calendar-events')).params;
  assert.equal(Date.parse(initial.endDate) - Date.parse(initial.startDate), 86400000);
  await act(async () => { field('日历视图').props.onChange('month'); });
  const dates = all(tree(), node => node.props.className === 'booking-calendar-month-date');
  assert.equal(dates.length, 42, 'even a mobile user can select dates that have no events');
  await act(async () => { dates[1].props.onClick(); });
  assert.ok(find(tree(), node => node.props['aria-label'] === '所选日期详情'));
  assert.ok(find(tree(), node => node.props.description === '当前完整范围内未记录此日事件'));
  assert.equal(requests.some(request => /create|quote|reschedule/.test(request.url)), false);
}));

test('calendar event selection opens the original booking identity and resource column mode remains separate from filtering', async () => withCalendar(async ({ tree, field, opened, requests }) => {
  const event = find(tree(), node => node.props.className?.startsWith?.('booking-calendar-event '));
  assert.ok(event); await act(async () => { event.props.onClick(); }); assert.deepEqual(opened, ['41']);
  const calls = requests.length;
  await act(async () => { field('日历分列方式').props.onChange('THERAPIST'); });
  assert.equal(requests.length, calls, 'grouping reuses the complete range instead of accidentally changing filters');
  assert.ok(find(tree(), node => node.type === 'h3' && node.props.children === 'Synthetic therapist'));
  await act(async () => { field('日历资源筛选').props.onChange('THERAPIST:12'); });
  assert.equal(requests.at(-1).params.resourceType, 'THERAPIST'); assert.equal(requests.at(-1).params.resourceId, '12');
}));

test('failed later calendar page removes all event and empty-day controls until an explicit successful reload', async () => withCalendar(async ({ tree, button, mode }) => {
  mode('partial-failure');
  await act(async () => { button('重载范围').props.onClick(); });
  assert.ok(find(tree(), node => node.props.title === '日历数据未完整'));
  assert.equal(all(tree(), node => node.props.className?.startsWith?.('booking-calendar-event ')).length, 0);
  assert.equal(all(tree(), node => node.props.className === 'booking-calendar-empty-date').length, 0, 'partial data cannot imply an empty/available date');
  mode('complete'); await act(async () => { button('重新加载').props.onClick(); });
  assert.equal(all(tree(), node => node.props.title === '日历数据未完整').length, 0);
  assert.equal(all(tree(), node => node.props.className?.startsWith?.('booking-calendar-event ')).length, 1);
}));

test('a changed server store timezone shows an explicit conflict instead of a blank or stale calendar', async () => withCalendar(async ({ tree, button, timezone }) => {
  timezone('America/New_York'); await act(async () => { button('重载范围').props.onClick(); });
  assert.ok(find(tree(), node => node.props.title === '门店时区已变化，日历暂未显示。'));
  assert.equal(all(tree(), node => node.props.className?.startsWith?.('booking-calendar-event ')).length, 0);
}));

test('committed calendar changes replace the selected event snapshot and remove a released interval absent from the complete range', async () => withCalendar(async ({ tree, event, mode, button }) => {
  const summary = () => find(tree(), node => node.props['aria-label'] === '非订单事件详情');
  const panel = () => find(tree(), node => node.props.onLockChange && node.props.onChanged && node.props.shopId === '7');
  await act(async () => { find(tree(), node => node.props.className?.startsWith?.('booking-calendar-event ')).props.onClick(); });
  assert.ok(summary()); assert.equal(panel().props.event.title, 'Original internal use');
  event({ title: 'Updated internal use', resources: [] });
  await act(async () => { panel().props.onChanged(); });
  assert.equal(panel().props.event.title, 'Updated internal use', 'the selected identity must use the complete refreshed snapshot');
  assert.deepEqual(panel().props.event.resources, []);
  assert.ok(find(summary(), node => node.type === 'p' && node.props.children === '全店'));
  event(null); mode('partial-failure');
  await act(async () => { panel().props.onChanged(); });
  assert.equal(summary(), undefined, 'an incomplete range cannot present the selected stale interval as current');
  assert.ok(panel().props.event, 'a failed range read must preserve the selection for explicit retry');
  mode('complete');
  await act(async () => { button('重新加载').props.onClick(); });
  assert.equal(summary(), undefined);
  assert.equal(panel().props.event, undefined, 'a released interval absent from the new complete range must clear the old selected snapshot');
  assert.equal(all(tree(), node => node.props.className?.startsWith?.('booking-calendar-event ')).length, 0);
}, { event: { id: 'calendar-block:91', blockId: '91', eventType: 'INTERNAL_OCCUPANCY', bookingId: null, itemId: null, serviceStartAt: null, serviceEndAt: null, title: 'Original internal use', status: 'ACTIVE' } }));

test('hour cells prefill an explicit local time without writing, and a dirty/pending action locks captured date/filter/reload callbacks', async () => withCalendar(async ({ tree, field, button, requests }) => {
  const initialDate = field('日历日期').props.value;
  const hour = find(tree(), node => node.props['aria-label'] === `${initialDate} 14:00 门店当地时间`);
  assert.ok(hour, 'week/day expose explicitly selectable local-hour cells');
  await act(async () => { hour.props.onClick(); });
  const panel = () => find(tree(), node => node.props.onLockChange && node.props.onChanged && node.props.shopId === '7');
  assert.equal(panel().props.date, initialDate); assert.equal(panel().props.startTime, '14:00');
  const oldDate = field('日历日期').props.onChange, oldFilter = field('日历预约状态').props.onChange, oldReload = button('重载范围').props.onClick;
  const count = requests.length;
  await act(async () => { panel().props.onLockChange(true); });
  await act(async () => { oldDate({ target: { value: '2035-11-11' } }); oldFilter('CANCELLED'); oldReload(); hour.props.onClick(); });
  assert.equal(requests.length, count); assert.equal(panel().props.date, initialDate); assert.equal(panel().props.startTime, '14:00');
  await act(async () => { panel().props.onLockChange(false); });
  await act(async () => { oldDate({ target: { value: '2035-11-11' } }); });
  assert.equal(field('日历日期').props.value, '2035-11-11');
}));
