import assert from 'node:assert/strict';
import { test } from 'node:test';
import { giftTimestamp } from './giftTimestamp';

test('gift timestamps keep each store date and DST offset across device zones', () => {
  const previous = process.env.TZ;
  try {
    for (const device of ['UTC', 'Asia/Shanghai', 'Pacific/Honolulu']) {
      process.env.TZ = device;
      assert.equal(giftTimestamp('2026-11-01T05:30:00Z', 'America/New_York'), '2026-11-01 01:30:00 GMT-4 · America/New_York');
      assert.equal(giftTimestamp('2026-11-01T06:30:00Z', 'America/New_York'), '2026-11-01 01:30:00 GMT-5 · America/New_York');
      assert.equal(giftTimestamp('2027-01-01T02:30:00Z', 'America/New_York'), '2026-12-31 21:30:00 GMT-5 · America/New_York');
      assert.equal(giftTimestamp('2026-03-08T10:00:00Z', 'America/Los_Angeles'), '2026-03-08 03:00:00 GMT-7 · America/Los_Angeles');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('missing or invalid gift store zones are explicit and never use device or booking fallbacks', () => {
  for (const zone of [null, undefined, '', 'Invalid/Zone', ' America/New_York ', 9]) {
    assert.equal(giftTimestamp('2026-11-01T05:30:00Z', zone), '门店时区未配置');
  }
});

test('gift timestamps reject ambiguous device-local wall clocks and malformed instants', () => {
  for (const value of [null, undefined, '', 'invalid', '2026-11-01', '2026-11-01T01:30:00']) {
    assert.equal(giftTimestamp(value, 'America/New_York'), '—');
  }
  assert.equal(giftTimestamp('2026-11-01T01:30:00-05:00', 'America/New_York'), '2026-11-01 01:30:00 GMT-5 · America/New_York');
});
