import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import BookingReceptionDetails, { BookingResourceNames } from './BookingReceptionDetails';
import type { BookingDetail } from '../types/bookingDetails';
const booking = { id: '9', service: { name: 'Renamed live service' }, items: [{ id: '10', participantIndex: 1, sequence: 1, serviceNameSnapshot: 'Saved Four Hands', variantNameSnapshot: 'Saved 60 minutes', durationMin: 60, priceCentsSnapshot: 12000, assignedTherapistIds: ['12', '11'], assignedRoomId: '20', preparationMin: 15 }],
  reception: { customer: { name: 'Synthetic guest', phone: '+1 (212) 555-0199' }, therapists: [{ id: '11', name: 'Alice' }, { id: '12', name: 'Bob' }, { id: '99', name: 'Unassigned' }], rooms: [{ id: '20', name: 'Quiet room' }] } } as unknown as BookingDetail;

test('accountless guest detail retains the recorded phone and clear unverified-email notice', () => {
  const html = renderToStaticMarkup(<BookingReceptionDetails booking={{ ...booking,
    contact: { recorded: true, version: 1, source: 'GUEST_ASSISTED', emailVerifiedAt: null, name: 'First visitor', phone: '+12025550101', email: null } }} />);
  assert.match(html, /First visitor/); assert.match(html, /href="tel:\+12025550101"/); assert.match(html, /未关联顾客账号/);
  assert.match(html, /联系邮箱：未填写邮箱/); assert.doesNotMatch(html, /Synthetic guest|历史订单未记录联系邮箱/);
  const legacy = renderToStaticMarkup(<BookingReceptionDetails booking={booking} />);
  assert.match(legacy, /历史订单未记录当次联系人/);
  assert.doesNotMatch(legacy, /联系邮箱：未填写邮箱/);
});

test('platform reception displays only the authorized contact and saved project summary', () => {
  const before = structuredClone(booking), html = renderToStaticMarkup(<BookingReceptionDetails booking={booking} />);
  assert.match(html, /Synthetic guest/); assert.match(html, /href="tel:\+12125550199"/);
  assert.match(html, /Saved Four Hands · Saved 60 minutes/); assert.doesNotMatch(html, /Renamed live service|Unassigned/);
  assert.deepEqual(booking, before);
});

test('platform recorded contact overrides current account and escapes the stored name', () => {
  const snapshot = { ...booking, contact: { recorded: true, version: 1, source: 'ONLINE_VERIFIED', name: 'Original <Guest>', phone: '+442079460100', email: 'original@example.test' } };
  const html = renderToStaticMarkup(<BookingReceptionDetails booking={snapshot} />);
  assert.match(html, /Original &lt;Guest&gt;/); assert.match(html, /original@example.test/);
  assert.match(html, /href="tel:\+442079460100"/); assert.match(html, /下单时记录/);
  assert.doesNotMatch(html, /Synthetic guest|12125550199/);
});
test('four hands renders both actual resource names in assignment order and retains cleanup information', () => {
  const html = renderToStaticMarkup(<BookingResourceNames item={booking.items[0]} booking={booking} />);
  assert.match(html, /Bob \(#12\)、Alice \(#11\)/); assert.match(html, /Quiet room \(#20\)/); assert.match(html, /后续衔接准备 15 分钟/);
  assert.doesNotMatch(html, /Unassigned/);
});
test('unknown contact and deleted or missing resources stay explicit without clickable unsafe telephone data', () => {
  const missing = { ...booking, reception: { customer: null, therapists: [], rooms: [] } };
  const html = renderToStaticMarkup(<><BookingReceptionDetails booking={missing} /><BookingResourceNames item={booking.items[0]} booking={missing} /></>);
  assert.match(html, /顾客姓名未提供|联系电话未提供/); assert.match(html, /#12、#11/); assert.match(html, /场地：#20/);
  assert.doesNotMatch(html, /href="tel:/);
  const unsafe = { ...booking, reception: { ...booking.reception!, customer: { name: '<script>unsafe</script>', phone: 'javascript:alert(1)' } } };
  const escaped = renderToStaticMarkup(<BookingReceptionDetails booking={unsafe} />);
  assert.doesNotMatch(escaped, /<script>|href="javascript:|href="tel:/); assert.match(escaped, /&lt;script&gt;/);
});
