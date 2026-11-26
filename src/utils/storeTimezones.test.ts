import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timezoneChoices, timezoneClock } from './storeTimezones';

test('one instant uses each actual US zone and changes eastern DST without changing Phoenix', () => {
  const summer = Date.parse('2026-06-01T16:07:59Z'), winter = Date.parse('2026-12-01T16:07:59Z');
  assert.deepEqual(timezoneClock('America/New_York', summer), { time: '12:07 PM', abbreviation: 'EDT' });
  assert.deepEqual(timezoneClock('America/New_York', winter), { time: '11:07 AM', abbreviation: 'EST' });
  assert.deepEqual(timezoneClock('America/Phoenix', summer), { time: '9:07 AM', abbreviation: 'MST' });
  assert.deepEqual(timezoneClock('America/Phoenix', winter), { time: '9:07 AM', abbreviation: 'MST' });
  assert.equal(timezoneClock('Pacific/Honolulu', summer)?.time, '6:07 AM');
  assert.equal(timezoneClock('Pacific/Midway', summer)?.time, '5:07 AM');
});
test('existing non-preset IANA aliases retain their exact value, searches never fall back to another zone', () => {
  const now = Date.parse('2026-06-01T16:07:00Z');
  assert.equal(timezoneChoices('US/Eastern', 'US/Eastern', now)[0].value, 'US/Eastern');
  assert.equal(timezoneChoices('', 'America/Detroit', now)[0].value, 'America/Detroit');
  assert.deepEqual(timezoneChoices('', 'invalid/nope', now), []);
  assert.equal(timezoneClock('invalid/nope', now), null);
  assert.ok(timezoneChoices('', '', now).every(item => /^\d{1,2}:\d{2} [AP]M$/.test(item.time)));
});
