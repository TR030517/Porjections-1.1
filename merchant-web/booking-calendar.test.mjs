import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';

let vite, api, calendar, client;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  api = await vite.ssrLoadModule('/src/api/bookingCalendar.ts');
  calendar = await vite.ssrLoadModule('/src/pages/bookings/calendarModel.ts');
  client = (await vite.ssrLoadModule('/src/api/client.ts')).default;
});
after(async () => { await vite?.close(); });
const query = { startDate: '2026-11-01', endDate: '2026-11-02' };
const page = (extra = {}) => ({ shopId: '7', timezone: 'America/Los_Angeles', serverNow: '2026-11-01T12:00:00.000Z', range: { ...query, startAt: '2026-11-01T07:00:00.000Z', endAt: '2026-11-02T08:00:00.000Z' }, version: 'synthetic-version-1', complete: true, nextCursor: null, events: [], resources: [{ type: 'THERAPIST', id: '12', name: 'Synthetic therapist' }], ...extra });
const event = (id = '1', extra = {}) => ({ id: `booking:${id}:item:1`, eventType: 'BOOKING', bookingId: id, itemId: '1', title: 'Synthetic service', status: 'CONFIRMED', startAt: '2026-11-01T08:30:00.000Z', endAt: '2026-11-01T09:45:00.000Z', serviceStartAt: '2026-11-01T08:30:00.000Z', serviceEndAt: '2026-11-01T09:30:00.000Z', resources: [{ type: 'THERAPIST', id: '12', name: 'Synthetic therapist', startAt: '2026-11-01T08:30:00.000Z', endAt: '2026-11-01T09:45:00.000Z' }], allDay: false, occupiesResources: true, occupancySource: 'ACTIVE_LOCKS', ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('month always covers six local calendar weeks and navigation keeps calendar dates across DST/leap years', () => {
  assert.deepEqual(calendar.calendarRange('2026-11-19', 'month'), { startDate: '2026-11-01', endDate: '2026-12-13' });
  assert.deepEqual(calendar.calendarRange('2026-11-01', 'day'), query);
  assert.deepEqual(calendar.calendarRange('2026-11-04', 'week'), { startDate: '2026-11-01', endDate: '2026-11-08' });
  assert.equal(calendar.datesInRange(calendar.calendarRange('2024-02-29', 'month')).length, 42);
  assert.equal(calendar.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(calendar.moveAnchor('2026-01-31', 'month', 1), '2026-02-01');
  assert.equal(calendar.moveAnchor('2026-11-01', 'day', 1), '2026-11-02');
  assert.equal(calendar.validDate('2026-02-30'), false);
});
test('range parser accepts 25/23-hour shop days, rejects UTC/browser midnight and foreign ranges', () => {
  assert.equal(api.requireCalendarPage(page(), '7', query).range.endAt, '2026-11-02T08:00:00.000Z');
  const spring = { startDate: '2026-03-08', endDate: '2026-03-09' };
  assert.equal(api.requireCalendarPage(page({ range: { ...spring, startAt: '2026-03-08T08:00:00.000Z', endAt: '2026-03-09T07:00:00.000Z' } }), '7', spring).range.startDate, spring.startDate);
  assert.throws(() => api.requireCalendarPage(page({ range: { ...query, startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-02T00:00:00Z' } }), '7', query), /无法核对/);
  assert.throws(() => api.requireCalendarPage(page({ shopId: '8' }), '7', query), /无法核对/);
  assert.throws(() => api.requireCalendarPage(page({ timezone: 'Invalid/Zone' }), '7', query), /无法核对/);
});
test('summary projection allowlists fields and preserves occupation/buffer/expired flags without contact/account data', () => {
  const projected = api.requireCalendarPage(page({ events: [event('1', { contactName: 'not public', contactPhone: '+15550000000', contactEmail: 'private@example.test', user: { email: 'hidden@example.test' }, notes: 'hidden' })], contactName: 'hidden' }), '7', query);
  for (const forbidden of ['contactName', 'contactPhone', 'contactEmail', 'private@example.test', 'hidden@example.test', 'notes']) assert.equal(JSON.stringify(projected).includes(forbidden), false);
  assert.equal(projected.events[0].resources[0].endAt, '2026-11-01T09:45:00.000Z');
  const expired = api.requireCalendarPage(page({ events: [event('2', { expiredHold: true, occupiesResources: false, occupancySource: 'NONE', resources: [] })] }), '7', query);
  assert.equal(expired.events[0].expiredHold, true); assert.equal(expired.events[0].occupiesResources, false);
});
test('a valid local date boundary survives a DST midnight jump without accepting a later in-day timestamp', () => {
  const skippedMidnight = { startDate: '2018-11-04', endDate: '2018-11-05' };
  const value = page({ timezone: 'America/Sao_Paulo', range: { ...skippedMidnight, startAt: '2018-11-04T03:00:00Z', endAt: '2018-11-05T02:00:00Z' } });
  assert.equal(api.requireCalendarPage(value, '7', skippedMidnight).range.startAt, '2018-11-04T03:00:00Z');
  assert.throws(() => api.requireCalendarPage({ ...value, range: { ...value.range, startAt: '2018-11-04T04:00:00Z' } }, '7', skippedMidnight), /无法核对/);
});
test('calendar API sends store scope, range filters, page size and abort signal explicitly', async () => {
  let requested;
  client.defaults.adapter = async config => { requested = config; return { data: page(), status: 200, statusText: 'OK', headers: {}, config }; };
  const signal = new AbortController().signal;
  await api.getCalendarPage('7', { ...query, status: 'CONFIRMED', resourceType: 'THERAPIST', resourceId: '12' }, 'opaque-next', signal);
  assert.equal(requested.url, '/reservation-admin/shops/7/calendar-events');
  assert.deepEqual(requested.params, { ...query, status: 'CONFIRMED', resourceType: 'THERAPIST', resourceId: '12', pageSize: 100, cursor: 'opaque-next' });
  assert.equal(requested.signal, signal);
});
test('more than 100 events load to completion and repeated stable event IDs are deduplicated without losing orders', async () => {
  const calls = [];
  const result = await calendar.loadCompleteCalendar('7', query, new AbortController().signal, async (_shop, _query, cursor) => {
    calls.push(cursor);
    if (!cursor) return page({ complete: false, nextCursor: 'page-2', events: Array.from({ length: 100 }, (_, i) => event(String(i + 1))) });
    return page({ events: [event('100'), ...Array.from({ length: 60 }, (_, i) => event(String(i + 101)))] });
  });
  assert.deepEqual(calls, [undefined, 'page-2']); assert.equal(result.events.length, 160); assert.equal(calendar.bookingCount(result.events), 160); assert.equal(result.complete, true);
});
test('four-hands/couple item and lock events retain event identity but count booking once', () => {
  const events = [event('9', { id: 'lock:1' }), event('9', { id: 'lock:2', itemId: '2' }), event('10', { id: 'lock:3' }), event('11', { id: 'closed:1', eventType: 'SHOP_CLOSURE', bookingId: null, itemId: null })];
  assert.equal(calendar.bookingCount(events), 2);
});
test('cross-midnight and buffer-only next-day events use half-open shop dates including repeated DST hour', () => {
  const crossing = event('1', { startAt: '2026-11-01T06:30:00Z', endAt: '2026-11-01T07:15:00Z', serviceStartAt: '2026-11-01T06:30:00Z', serviceEndAt: '2026-11-01T07:00:00Z' });
  assert.equal(calendar.eventsOnDate([crossing], '2026-10-31', 'America/Los_Angeles').length, 1);
  assert.equal(calendar.eventsOnDate([crossing], '2026-11-01', 'America/Los_Angeles').length, 1);
  assert.equal(calendar.eventsOnDate([{ ...crossing, endAt: '2026-11-01T07:00:00Z' }], '2026-11-01', 'America/Los_Angeles').length, 0);
  assert.equal(calendar.eventsOnDate([event('1'), event('2', { startAt: '2026-11-01T09:30:00Z', endAt: '2026-11-01T10:00:00Z' })], '2026-11-01', 'America/Los_Angeles').length, 2);
});
test('resource columns retain unknown active locks and use each known resource actual interval for day grouping', () => {
  const known = { type: 'THERAPIST', id: '12', name: 'Synthetic therapist' }, orphan = { type: 'THERAPIST', id: '999', name: 'Unknown historical therapist' };
  const mixed = event('1', { startAt: '2026-11-01T06:30:00Z', endAt: '2026-11-01T07:30:00Z', resources: [{ ...known, startAt: '2026-11-01T06:30:00Z', endAt: '2026-11-01T07:00:00Z' }, { ...orphan, startAt: '2026-11-01T06:30:00Z', endAt: '2026-11-01T07:30:00Z' }] });
  const events = [mixed, event('2', { resources: [] }), event('3')];
  const unknown = calendar.eventsForResourceColumn(events, [known], 'THERAPIST');
  assert.deepEqual(unknown.map(row => row.bookingId), ['1', '2'], 'orphan resources stay visible beside unassigned orders');
  const knownColumn = calendar.eventsForResourceColumn(events, [known], 'THERAPIST', known);
  assert.equal(knownColumn[0].endAt, '2026-11-01T07:00:00Z');
  assert.equal(calendar.eventsOnDate([knownColumn[0]], '2026-11-01', 'America/Los_Angeles').length, 0, 'therapist ends at midnight even though another resource buffer extends');
  assert.equal(calendar.eventsOnDate([unknown[0]], '2026-11-01', 'America/Los_Angeles').length, 1);
});
test('partial transport failure never publishes first-page data or a false empty calendar', async () => {
  let call = 0;
  const model = calendar.createCalendarModel('7', query, () => true, async () => { if (++call === 1) return page({ complete: false, nextCursor: 'p2', events: [event()] }); throw new Error('第二页暂不可用'); });
  try { await model.load(); assert.equal(model.getSnapshot().data, null); assert.equal(model.getSnapshot().loading, false); assert.match(model.getSnapshot().error, /数据未完整.*第二页暂不可用/); } finally { model.dispose(); }
});
test('changed version/resources/range and conflicting duplicate events reject mixed snapshots', async () => {
  for (const second of [page({ version: 'changed' }), page({ resources: [] }), page({ range: { ...page().range, endAt: '2026-11-02T09:00:00Z' } }), page({ events: [event('1', { status: 'CANCELLED' })] })]) {
    let call = 0;
    await assert.rejects(calendar.loadCompleteCalendar('7', query, new AbortController().signal, async () => ++call === 1 ? page({ complete: false, nextCursor: 'p2', events: [event()] }) : second), /变化|不一致/);
  }
});
test('repeating or missing cursors fail closed instead of publishing truncated data', async () => {
  for (const nextCursor of [null, 'same']) {
    await assert.rejects(calendar.loadCompleteCalendar('7', query, new AbortController().signal, async () => page({ complete: false, nextCursor })), /分页未完整/);
  }
});
test('changing date/resource aborts old request and a late ignored-abort response cannot overwrite current scope', async () => {
  const requests = [];
  const model = calendar.createCalendarModel('7', query, () => true, (_shop, range, _cursor, signal) => { const pending = deferred(); requests.push({ range, signal, ...pending }); return pending.promise; });
  try {
    const old = model.load(); await tick();
    const nextQuery = { ...query, resourceType: 'THERAPIST', resourceId: '12' }, latest = model.setQuery(nextQuery); await tick();
    assert.equal(requests[0].signal.aborted, true); assert.equal(model.getSnapshot().data, null);
    requests[1].resolve(page({ events: [event('2')] })); await latest;
    requests[0].resolve(page({ events: [event('1')] })); await old;
    assert.equal(model.getSnapshot().data.events[0].bookingId, '2'); assert.deepEqual(model.getSnapshot().query, nextQuery);
  } finally { model.dispose(); }
});
test('shop/account scope loss and unmount discard pending pages without publishing contact events', async () => {
  for (const dispose of [false, true]) {
    let current = true; const pending = deferred(); const model = calendar.createCalendarModel('7', query, () => current, () => pending.promise);
    const loading = model.load(); await tick(); if (dispose) model.dispose(); else current = false;
    pending.resolve(page({ events: [event()] })); await loading; assert.equal(model.getSnapshot().data, null); model.dispose();
  }
});
