import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('booking list and detail keep midnight endpoints on their actual shop dates', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { bookingTime } = await server.ssrLoadModule('/src/components/BookingDetails.tsx');
    const row = { timezone: 'America/Los_Angeles', localDate: '2026-11-06', localStartTime: '23:00', localEndTime: '00:00', startTime: '2026-11-07T07:00:00Z', endTime: '2026-11-07T08:00:00Z' };
    assert.equal(bookingTime(row), '2026-11-06 23:00–2026-11-07 00:00 · America/Los_Angeles');
    assert.equal(bookingTime({ ...row, startTime: '2026-11-07T06:00:00Z', endTime: '2026-11-07T07:00:00Z' }), '2026-11-06 22:00–23:00 · America/Los_Angeles');
    assert.equal(bookingTime({ ...row, timezone: 'Pacific/Honolulu' }), '2026-11-06 21:00–22:00 · Pacific/Honolulu');
    assert.equal(bookingTime({ ...row, localDate: null, localStartTime: null, localEndTime: null }), '2026-11-06 23:00–2026-11-07 00:00 · America/Los_Angeles');
    assert.equal(bookingTime({ ...row, timezone: null }), '2026-11-07 07:00–08:00 UTC');
    assert.equal(bookingTime({ ...row, timezone: 'Invalid/Zone' }), '2026-11-07 07:00–08:00 UTC');
    assert.equal(bookingTime({ ...row, timezone: null, startTime: '2026-11-06T23:00:00Z', endTime: '2026-11-07T00:00:00Z' }), '2026-11-06 23:00–2026-11-07 00:00 UTC');
    assert.equal(bookingTime({ ...row, startTime: 'invalid' }), '时间不可用');
  } finally { await server.close(); }
});
