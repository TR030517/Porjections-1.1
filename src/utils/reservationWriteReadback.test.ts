import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReservationConfig } from '../types/reservations';
import { reservationRemovalMatches, reservationSaveMatches } from './reservationWriteReadback';

function fixture(): ReservationConfig {
  return {
    shopId: '5', timezone: 'America/Los_Angeles', paymentPolicy: { payAtStoreEnabled: true },
    services: [{ id: '7', shopId: '5', name: 'Synthetic massage', isActive: true, durationMin: 60, priceCents: 9500, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0,
      variants: [{ id: '71', serviceId: '7', name: '60 minutes', durationMin: 60, priceCents: 9500, priceBasis: 'PER_BOOKING', currency: 'usd', sortOrder: 0, isActive: true }] }],
    therapists: ['8', '9'].map(id => ({ id, shopId: '5', name: 'Synthetic therapist ' + id, isActive: true, scheduleMode: 'SHOP', serviceIds: [], shifts: id === '8' ? [{ id: '81', therapistId: '8', weekday: 1, startMin: 540, endMin: 1320, isActive: true }] : [], timeOff: id === '8' ? [{ id: '82', therapistId: '8', startAtUtc: '2027-01-01T04:00:00.000Z', endAtUtc: '2027-01-01T18:00:00.000Z', reason: null }] : [] })),
    rooms: [{ id: '10', shopId: '5', name: 'Synthetic room', roomType: 'SINGLE', capacity: 1, isActive: true, maintenance: [{ id: '101', roomId: '10', startAtUtc: '2027-01-01T04:00:00.000Z', endAtUtc: '2027-01-01T18:00:00.000Z', reason: null }] }],
  };
}

test('two-therapist policy and variant prices require all submitted terms in the saved shop', () => {
  const before = fixture(), after = fixture();
  const policy = { priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 2, requiredRoomType: null, staffBufferMin: 15, roomBufferMin: 0 };
  Object.assign(after.services[0], policy, { staffBufferMin: 0 });
  assert.equal(reservationSaveMatches(before, after, 'policy', '7', policy, false), false, 'a changed staff count cannot hide an unchanged buffer');
  after.services[0].staffBufferMin = 15;
  assert.equal(reservationSaveMatches(before, after, 'policy', 7, policy, false), true);
  const variant = { name: '90 minutes', durationMin: 90, priceCents: 12500, priceBasis: 'PER_BOOKING', currency: 'usd', sortOrder: 0, isActive: true };
  Object.assign(after.services[0].variants[0], variant, { priceCents: 9500 });
  assert.equal(reservationSaveMatches(before, after, 'variants', '71', variant, false), false, 'a changed duration must not acknowledge an old price');
  after.services[0].variants[0].priceCents = 12500;
  assert.equal(reservationSaveMatches(before, after, 'variants', '71', variant, false), true);
  assert.equal(reservationSaveMatches(before, after, 'variants', '71', { ...variant, serviceId: '7' }, true), false, 'a create receipt cannot refer to an existing variant');
  after.shopId = '6'; assert.equal(reservationSaveMatches(before, after, 'policy', '7', policy, false), false);
});

test('personal exceptions remain attached to the submitted therapist and compare UTC instants', () => {
  const before = fixture(), after = fixture();
  const shift = { weekday: 1, startMin: 600, endMin: 1320, isActive: true };
  assert.equal(reservationSaveMatches(before, after, 'shifts', '81', shift, false), false);
  after.therapists[0].shifts[0].startMin = 600;
  assert.equal(reservationSaveMatches(before, after, 'shifts', '81', shift, false), true);
  const absence = { therapistId: '8', startAtUtc: '2027-01-02T04:00:00.000Z', endAtUtc: '2027-01-02T18:00:00.000Z', reason: 'Synthetic absence' };
  after.therapists[0].timeOff.push({ id: '83', ...absence, startAtUtc: '2027-01-01T20:00:00-08:00' });
  assert.equal(reservationSaveMatches(before, after, 'time-off', '83', absence, true), true, 'equivalent UTC serializations are accepted');
  after.therapists[1].timeOff.push({ ...after.therapists[0].timeOff.pop()!, therapistId: '9' });
  assert.equal(reservationSaveMatches(before, after, 'time-off', '83', absence, true), false, 'another therapist cannot acknowledge this absence');
  after.therapists[1].shifts = [{ ...after.therapists[0].shifts.pop()!, therapistId: '9' }];
  assert.equal(reservationSaveMatches(before, after, 'shifts', '81', shift, false), false, 'an edit cannot silently move to another therapist');
});

test('space edits, maintenance and disable/delete readbacks preserve the exact resource identity', () => {
  const before = fixture(), after = fixture();
  const room = { name: 'Synthetic couple room', roomType: 'COUPLE', capacity: 2, isActive: true };
  Object.assign(after.rooms[0], room, { capacity: 1 });
  assert.equal(reservationSaveMatches(before, after, 'rooms', '10', room, false), false);
  after.rooms[0].capacity = 2;
  assert.equal(reservationSaveMatches(before, after, 'rooms', '10', room, false), true);
  const maintenance = { startAtUtc: '2027-01-02T04:00:00.000Z', endAtUtc: '2027-01-02T18:00:00.000Z', reason: null };
  assert.equal(reservationSaveMatches(before, after, 'maintenance', '101', maintenance, false), false);
  Object.assign(after.rooms[0].maintenance[0], maintenance);
  assert.equal(reservationSaveMatches(before, after, 'maintenance', '101', maintenance, false), true);
  for (const [kind, id] of [['variants', '71'], ['shifts', '81'], ['rooms', '10']] as const) assert.equal(reservationRemovalMatches(before, after, kind, id), false);
  after.services[0].variants[0].isActive = false; after.therapists[0].shifts[0].isActive = false; after.rooms[0].isActive = false;
  for (const [kind, id] of [['variants', '71'], ['shifts', '81'], ['rooms', '10']] as const) assert.equal(reservationRemovalMatches(before, after, kind, id), true);
  assert.equal(reservationRemovalMatches(before, after, 'time-off', '82'), false);
  assert.equal(reservationRemovalMatches(before, after, 'maintenance', '101'), false);
  after.therapists[1].timeOff.push({ ...after.therapists[0].timeOff.pop()!, therapistId: '9' });
  assert.equal(reservationRemovalMatches(before, after, 'time-off', '82'), false, 'a row moved to another therapist is still present');
  after.therapists[1].timeOff = []; after.rooms[0].maintenance = [];
  assert.equal(reservationRemovalMatches(before, after, 'time-off', '82'), true);
  assert.equal(reservationRemovalMatches(before, after, 'maintenance', '101'), true);
  assert.equal(reservationRemovalMatches(before, after, 'time-off', '999'), false, 'a stale callback cannot confirm removal of an unknown resource');
});
