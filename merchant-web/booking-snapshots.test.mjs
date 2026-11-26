import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';
const server = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });

test('detail preserves every server segment, allocated cents and independent tip; reschedule only sends the anchor', async () => {
  const requests = [];
  // Full legacy snapshot fixtures now include their existing saved occupancy, not live catalog duration.
  const items = [{ id: '1', participantIndex: 1, sequence: 1, durationMin: 60, priceCentsSnapshot: 5013, quotedUnitPriceCents: 10025, priceBasisSnapshot: 'PER_BOOKING', assignedTherapistId: '71' }, { id: '2', participantIndex: 2, sequence: 1, durationMin: 60, priceCentsSnapshot: 5012, quotedUnitPriceCents: 10025, priceBasisSnapshot: 'PER_BOOKING', assignedTherapistId: '72' }, { id: '3', participantIndex: 1, sequence: 2, durationMin: 30, priceCentsSnapshot: 999, priceBasisSnapshot: 'PER_PERSON', assignedTherapistId: '73' }];
  axios.defaults.adapter = async config => {
    requests.push({ url: config.url, params: config.params, body: config.data ? JSON.parse(config.data) : undefined });
    const data = config.url.endsWith('/reschedule-slots') ? { date: config.params.date, timezone: 'America/New_York', slots: [{ time: '10:00', available: true }] } : { id: '42', shopId: '2', reservationKind: 'PLAN', durationMin: 90, items, priceCents: 11024, tipCents: 105, platformFeeCents: 100, totalCents: 11229 };
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  const vite = await server();
  try {
    const api = await vite.ssrLoadModule('/src/api/bookings.ts');
    const detail = await api.getBooking('42', '2');
    assert.equal(detail.items.length, 3); assert.deepEqual(detail.items, items.map(item => ({ ...item, therapistSelectionMode: 'LEGACY_UNKNOWN', requestedTherapistIds: [], durationKind: 'TIMED', reservedDurationMin: item.durationMin }))); assert.equal(detail.tipCents, 105); assert.equal(detail.reservationKind, 'PLAN');
    await api.getBookingRescheduleSlots('42', '2026-10-30');
    await api.rescheduleBooking('42', { date: '2026-10-30', startTime: '10:00', therapistId: 'other', preferredTherapistIds: ['other'] });
    assert.deepEqual(requests[1], { url: '/bookings/42/reschedule-slots', params: { date: '2026-10-30' }, body: undefined });
    assert.deepEqual(requests[2].body, { date: '2026-10-30', startTime: '10:00' });
  } finally { await vite.close(); }
});
test('segment display sorts all participants/sequences without repricing and uses saved UTC endpoints through DST', async () => {
  const vite = await server();
  try {
    const { sortedBookingSegments, bookingSegmentTime } = await vite.ssrLoadModule('/src/utils/bookingSegments.ts');
    const rows = [{ participantIndex: 2, sequence: 1, durationMin: 60, priceCentsSnapshot: 5012 }, { participantIndex: 1, sequence: 2, durationMin: 30, priceCentsSnapshot: 999 }, { participantIndex: 1, sequence: 1, durationMin: 60, priceCentsSnapshot: 5013 }];
    assert.deepEqual(sortedBookingSegments(rows).map(row => row.priceCentsSnapshot), [5013, 999, 5012]); assert.equal(rows[0].participantIndex, 2);
    const label = bookingSegmentTime({ startAtUtc: '2026-11-01T05:30:00Z', endAtUtc: '2026-11-01T06:30:00Z', timezone: 'America/New_York' }, 'Asia/Shanghai');
    assert.match(label, /GMT-4/); assert.match(label, /GMT-5/); assert.match(label, /America\/New_York/);
    assert.match(bookingSegmentTime({ startAtUtc: '2026-11-01T05:30:00Z', endAtUtc: '2026-11-01T06:30:00Z' }, null), /UTC/);
  } finally { await vite.close(); }
});
