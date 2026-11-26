import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBookingRescheduleSlots, rescheduleBooking } from './bookingDetails';

test('reschedule availability reads the owned order snapshot with only the selected date', async () => {
  const original = globalThis.fetch, controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/bookings/9007199254740993/reschedule-slots?date=2026-10-30');
    assert.equal(options?.credentials, 'include'); assert.equal(options?.signal?.aborted, false);
    return Response.json({ date: '2026-10-30', timezone: 'America/New_York', slots: [{ time: '10:00', available: true }, { time: '10:30', available: false }] });
  };
  try { assert.equal((await getBookingRescheduleSlots('9007199254740993', '2026-10-30', controller.signal)).slots[1].available, false); }
  finally { globalThis.fetch = original; }
});
test('moving a composite itinerary strips top-level technician overrides instead of replacing per-segment resources', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/bookings/42/reschedule'); assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), { date: '2026-10-30', startTime: '10:00' });
    return Response.json({ id: '42', reservationKind: 'PLAN', durationMin: 90, items: [] });
  };
  try { await rescheduleBooking('42', { date: '2026-10-30', startTime: '10:00', therapistId: '99', preferredTherapistIds: ['99'] } as any); }
  finally { globalThis.fetch = original; }
});
test('mismatched dates and malformed availability cannot be used as current selectable starts', async () => {
  const original = globalThis.fetch;
  try {
    for (const data of [{ date: '2026-10-31', timezone: 'UTC', slots: [] }, { date: '2026-10-30', timezone: 'UTC', slots: [{ time: '25:00', available: true }] }, { date: '2026-10-30', timezone: 'UTC', slots: [{ time: '10:00', available: 'true' }] }]) {
      globalThis.fetch = async () => Response.json(data);
      await assert.rejects(getBookingRescheduleSlots('42', '2026-10-30'), /返回格式无效/);
    }
  } finally { globalThis.fetch = original; }
});
