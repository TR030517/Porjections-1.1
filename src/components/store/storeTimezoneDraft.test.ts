import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initiallyAutoMatchTimezone, matchDraftTimezone } from './storeTimezoneDraft';

test('an empty timezone follows the entered location while a saved timezone starts confirmed', () => {
  assert.equal(initiallyAutoMatchTimezone(''), true);
  const empty = { city: 'Seattle', state: 'Washington', zipCode: '98144', timezone: '' };
  const matched = matchDraftTimezone(empty, initiallyAutoMatchTimezone(empty.timezone));
  assert.equal(matched.timezone, 'America/Los_Angeles');
  assert.equal(empty.timezone, '', 'matching never mutates the original draft');
  assert.equal(initiallyAutoMatchTimezone(matched.timezone), false, 'a reopened saved zone is retained because its historical auto/manual origin is unknown');
});

test('manual timezone exceptions survive later city/state/ZIP edits until explicitly rematched', () => {
  const manual = { city: 'Tacoma', state: 'Washington', zipCode: '98402', timezone: 'America/Chicago' };
  assert.equal(matchDraftTimezone(manual, false), manual);
  const reopened = matchDraftTimezone(manual, initiallyAutoMatchTimezone(manual.timezone));
  assert.equal(reopened.timezone, 'America/Chicago');
  const rematched = matchDraftTimezone(manual, true);
  assert.equal(rematched.timezone, 'America/Los_Angeles');
  assert.equal(matchDraftTimezone({ ...rematched, city: 'New York', state: 'NY', zipCode: '10001' }, true).timezone, 'America/New_York');
});

test('an address that cannot be inferred has no invented timezone', () => {
  const unknown = { city: '', state: '', zipCode: '', timezone: '' };
  assert.equal(matchDraftTimezone(unknown, true), unknown);
});
