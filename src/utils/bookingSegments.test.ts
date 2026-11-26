import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingSegmentTime, sortedBookingSegments } from './bookingSegments';
import type { BookingSegment } from '../types/bookingDetails';

test('all participant/sequence segments keep exact snapshot amounts and are sorted without mutating the server result', () => {
  const rows = [{ participantIndex: 2, sequence: 1, priceCentsSnapshot: 5012 }, { participantIndex: 1, sequence: 2, priceCentsSnapshot: 999 }, { participantIndex: 1, sequence: 1, priceCentsSnapshot: 5013 }];
  assert.deepEqual(sortedBookingSegments(rows).map(row => [row.participantIndex, row.sequence, row.priceCentsSnapshot]), [[1, 1, 5013], [1, 2, 999], [2, 1, 5012]]);
  assert.equal(rows[0].participantIndex, 2);
});
test('saved UTC segment endpoints are shown in the saved IANA zone with DST offsets, never by adding wall-clock minutes', () => {
  const item = { startAtUtc: '2026-11-01T05:30:00Z', endAtUtc: '2026-11-01T06:30:00Z', timezone: 'America/New_York' } as BookingSegment;
  const label = bookingSegmentTime(item, 'Asia/Shanghai');
  assert.match(label, /01:30/); assert.match(label, /GMT-4/); assert.match(label, /GMT-5/); assert.match(label, /America\/New_York/);
  assert.equal(bookingSegmentTime({} as BookingSegment, null), '服务段起止时间未提供');
  const fallback = bookingSegmentTime({ ...item, timezone: null }, null);
  assert.match(fallback, /2026-11-01T05:30:00.000Z/); assert.match(fallback, /UTC/);
});
