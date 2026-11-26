import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingTimestamp } from './bookingTimestamp';

test('order metadata shows the saved shop date and seconds instead of the device calendar', () => {
  const instant = '2026-11-07T07:04:05.000Z';
  assert.equal(bookingTimestamp(instant, 'America/Los_Angeles'), '2026-11-06 23:04:05 · America/Los_Angeles');
  assert.equal(bookingTimestamp(instant, 'Pacific/Honolulu'), '2026-11-06 21:04:05 · Pacific/Honolulu');
  assert.equal(bookingTimestamp(instant, 'America/New_York'), '2026-11-07 02:04:05 · America/New_York');
  assert.equal(bookingTimestamp('2026-07-07T07:04:05Z', 'America/Los_Angeles'), '2026-07-07 00:04:05 · America/Los_Angeles');
});

test('missing or invalid saved zones explicitly show UTC without using the device zone', () => {
  for (const timezone of [null, undefined, '', 'Invalid/Zone']) {
    assert.equal(bookingTimestamp('2026-11-07T07:04:05Z', timezone), '2026-11-07T07:04:05.000Z UTC（预约时区未提供或无效）');
  }
  for (const value of [null, undefined, '', 'invalid']) assert.equal(bookingTimestamp(value, 'America/Los_Angeles'), '—');
});
