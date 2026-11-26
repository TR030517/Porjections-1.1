import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOLD_TIMER_MAX_DELAY_MS, holdDeadlineInstant, orderHoldPresentation, watchOrderHoldDeadline, type OrderHoldClock } from './orderHold';

const deadline = '2035-11-07T15:00:00.000Z', at = Date.parse(deadline);
const pending = { status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, refundedCents: 0, paymentMode: 'PAY_AT_STORE' };

test('only an authoritative pending unpaid zero-paid order with an eligible mode and future deadline has current wording', () => {
  const before = structuredClone(pending);
  assert.equal(orderHoldPresentation(deadline, pending, at - 1).state, 'ACTIVE_ACCEPTANCE');
  assert.equal(orderHoldPresentation(deadline, pending, at - 1).label, '待接受截止');
  const online = orderHoldPresentation(deadline, { ...pending, paymentMode: 'ONLINE' }, at - 1);
  assert.equal(online.state, 'ACTIVE_PAYMENT'); assert.equal(online.label, '付款临时保留截止'); assert.equal(online.nextChangeAtMs, at);
  for (const patch of [{ paidCents: 1 }, { paidCents: '0' }, { paidCents: null }, { paidCents: undefined }, { refundedCents: 1 }, { paymentStatus: 'PAID' }, { paymentStatus: 'REFUNDED' }, { paymentStatus: undefined }, { status: undefined }, { paymentMode: 'ZERO' }, { paymentMode: null }, { paymentMode: 'UNKNOWN' }]) {
    assert.equal(orderHoldPresentation(deadline, { ...pending, ...patch }, at - 1).state, 'HISTORY');
  }
  assert.deepEqual(pending, before);
});

test('all confirmed, terminal and uncertain states keep the saved deadline historical even if a booking copy is still pending', () => {
  for (const status of ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED', 'UNKNOWN', null]) {
    for (const now of [at - 1000, at + 1000]) {
      const settlement = { ...pending, status, booking: { status: 'PENDING', paymentStatus: 'UNPAID' } };
      const view = orderHoldPresentation(deadline, settlement, now);
      assert.equal(view.state, 'HISTORY'); assert.equal(view.label, '原待接受截止（历史）'); assert.equal(view.deadline, deadline);
      assert.match(view.message, /历史记录，不表示当前资源占用/); assert.doesNotMatch(view.message, /已释放|没有占用|不再占用/); assert.equal(view.nextChangeAtMs, null);
    }
  }
  assert.equal(orderHoldPresentation(deadline, { ...pending, paymentMode: 'ONLINE', status: 'CONFIRMED' }, at - 1).label, '原付款保留截止（历史）');
  assert.equal(orderHoldPresentation(deadline, null, at - 1).state, 'HISTORY');
});

test('exactly at or beyond the deadline only the page expiry wording changes, never the server order or lock state', () => {
  for (const now of [at, at + 1, at + 60_000]) {
    const source = { ...pending }, view = orderHoldPresentation(deadline, source, now);
    assert.equal(view.state, 'EXPIRED'); assert.equal(view.label, '临时预留期限已到，请刷新核对预约结果'); assert.equal(view.nextChangeAtMs, null);
    assert.match(view.message, /实际预约与资源状态以服务器为准/); assert.doesNotMatch(view.message, /已取消|已释放/);
    assert.deepEqual(source, pending);
  }
  assert.equal(orderHoldPresentation(deadline, pending, NaN).state, 'HISTORY');
});

test('only real ISO instants with an explicit timezone may be current; missing dates render nothing and malformed data cannot become active', () => {
  assert.equal(holdDeadlineInstant('2035-11-07T10:00:00-05:00'), at);
  assert.equal(holdDeadlineInstant('2035-11-07T23:00:00.0+08:00'), at);
  assert.equal(holdDeadlineInstant('2036-02-29T10:00:00Z'), Date.parse('2036-02-29T10:00:00Z'));
  for (const value of ['', '2035-11-07T15:00:00', '2035-02-29T15:00:00Z', '2035-02-30T15:00:00Z', '2035-13-01T15:00:00Z', '2035-11-07T24:00:00Z', '2035-11-07T15:00:00+24:00', '2035-11-07T15:00:00+01:99', ' 2035-11-07T15:00:00Z', at, new Date(at), {}, '<b>deadline</b>']) {
    const view = orderHoldPresentation(value, pending, at - 1);
    assert.equal(view.state, 'INVALID'); assert.equal(view.deadline, null); assert.equal(view.nextChangeAtMs, null);
  }
  for (const value of [undefined, null]) assert.deepEqual(orderHoldPresentation(value, pending, at), { state: 'NONE', label: '', message: '', deadline: null, nextChangeAtMs: null });
});

function fakeClock(start: number) {
  let now = start, serial = 0;
  const tasks = new Map<number, { run: () => void; delay: number; due: number }>(), cancelled: unknown[] = [];
  const clock: OrderHoldClock = { now: () => now, schedule: (run, delay) => { const id = ++serial; tasks.set(id, { run, delay, due: now + delay }); return id; }, cancel: id => { cancelled.push(id); tasks.delete(id as number); } };
  return { clock, tasks, cancelled, setNow: (value: number) => { now = value; }, fire: (id: number) => { const task = tasks.get(id)!; tasks.delete(id); task.run(); } };
}

test('the local timer crosses the real deadline once and can refresh display without changing authoritative data', () => {
  const time = fakeClock(at - 1000), original = structuredClone(pending), views: string[] = [];
  const active = orderHoldPresentation(deadline, pending, time.clock.now());
  const stop = watchOrderHoldDeadline(active.nextChangeAtMs, () => views.push(orderHoldPresentation(deadline, pending, time.clock.now()).state), time.clock);
  assert.equal(time.tasks.size, 1); assert.equal(time.tasks.get(1)!.delay, 1000); assert.deepEqual(views, []);
  time.setNow(at); time.fire(1); assert.deepEqual(views, ['EXPIRED']); assert.equal(time.tasks.size, 0); assert.deepEqual(pending, original);
  stop();
});

test('switching orders or unmounting cancels and fences stale callbacks, and history needs no timer', () => {
  const time = fakeClock(at - 1000); let changes = 0;
  const stop = watchOrderHoldDeadline(at, () => changes++, time.clock), queued = time.tasks.get(1)!.run;
  stop(); assert.deepEqual(time.cancelled, [1]); time.setNow(at); queued(); assert.equal(changes, 0); assert.equal(time.tasks.size, 0);
  const history = orderHoldPresentation(deadline, { ...pending, status: 'CANCELLED' }, at - 1);
  watchOrderHoldDeadline(history.nextChangeAtMs, () => changes++, time.clock); assert.equal(time.tasks.size, 0); assert.equal(changes, 0);
});

test('long waits stay within native timeout bounds and a backward clock shift cannot announce expiry early', () => {
  const time = fakeClock(0); let changes = 0;
  const stop = watchOrderHoldDeadline(HOLD_TIMER_MAX_DELAY_MS + 100, () => changes++, time.clock);
  assert.equal(time.tasks.get(1)!.delay, HOLD_TIMER_MAX_DELAY_MS);
  time.setNow(-500); time.fire(1); assert.equal(changes, 0); assert.equal(time.tasks.size, 1); assert.equal(time.tasks.get(2)!.delay, HOLD_TIMER_MAX_DELAY_MS);
  time.setNow(HOLD_TIMER_MAX_DELAY_MS); time.fire(2); assert.equal(time.tasks.get(3)!.delay, 100);
  time.setNow(HOLD_TIMER_MAX_DELAY_MS + 100); time.fire(3); assert.equal(changes, 1); assert.equal(time.tasks.size, 0); stop();
});
