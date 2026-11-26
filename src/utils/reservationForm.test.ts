import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReservationPayload, reservationVariantPriceDraft, localReservationTime, reservationServiceTotal, reservationUtc, timeMinute } from './reservationForm';

test('shop-local interval conversion is independent of the administrator browser timezone', () => {
  assert.equal(reservationUtc('2026-10-29T09:00', 'America/New_York'), '2026-10-29T13:00:00.000Z');
  assert.equal(reservationUtc('2026-12-29T09:00', 'America/New_York'), '2026-12-29T14:00:00.000Z');
  assert.equal(localReservationTime('2026-10-29T13:00:00.000Z', 'America/New_York'), '2026-10-29T09:00');
  assert.equal(reservationUtc('2026-10-29T09:00', 'Asia/Kolkata'), '2026-10-29T03:30:00.000Z');
});
test('missing, invalid, impossible and repeated DST local times are rejected', () => {
  assert.throws(() => reservationUtc('2026-03-08T02:30', 'America/New_York'), /夏令时/);
  assert.throws(() => reservationUtc('2026-11-01T01:30', 'America/New_York'), /夏令时/);
  assert.throws(() => reservationUtc('2026-02-30T09:00', 'America/New_York'), /无效/);
  assert.throws(() => reservationUtc('2026-10-29T09:00', null), /时区/);
  assert.throws(() => reservationUtc('2026-10-29T09:00', 'Invalid/Zone'), /时区/);
});
test('couple policy always needs two staff while room binding is optional and explicit', () => {
  const policy = { participantCount: '2', requiredRoomType: 'COUPLE', staffBufferMin: '10', roomBufferMin: '20' };
  assert.deepEqual(buildReservationPayload('policy', policy, null, false), { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE', priceBasis: 'PER_BOOKING', staffBufferMin: 10, roomBufferMin: 20 });
  assert.throws(() => buildReservationPayload('policy', { ...policy, requiredRoomType: 'SINGLE' }, null, false), /双人房/);
  assert.throws(() => buildReservationPayload('policy', { ...policy, requiredRoomType: 'FOOT_SEAT' }, null, false), /双人房/);
  assert.equal(buildReservationPayload('policy', { ...policy, requiredRoomType: '' }, null, false).requiredRoomType, null);
  assert.equal(buildReservationPayload('policy', { ...policy, requiredRoomType: null }, null, false).requiredRoomType, null);
  assert.throws(() => buildReservationPayload('policy', { ...policy, staffBufferMin: '121' }, null, false));
});
test('variant price stays integer cents per order and cannot exceed the server ceiling', () => {
  const form = { serviceId: '9007199254740993', name: '90 分钟', durationMin: '90', priceUsd: '100.25', sortOrder: '0', isActive: true };
  assert.deepEqual(buildReservationPayload('variants', form, null, true), { serviceId: '9007199254740993', name: '90 分钟', durationMin: 90, priceCents: 10025, priceBasis: 'PER_BOOKING', currency: 'usd', sortOrder: 0, isActive: true });
  const patch = buildReservationPayload('variants', form, null, false);
  assert.equal(Object.hasOwn(patch, 'serviceId'), false);
  for (const priceUsd of ['0', '100.251', '100000.01', '-1', '1e4']) assert.throws(() => buildReservationPayload('variants', { ...form, priceUsd }, null, true));
  for (const durationMin of ['5', '15', '29', '240']) assert.equal(buildReservationPayload('variants', { ...form, durationMin }, null, true).durationMin, Number(durationMin));
  for (const durationMin of ['0', '4', '241', '15.5']) assert.throws(() => buildReservationPayload('variants', { ...form, durationMin }, null, true));
});
test('per-booking prices stay fixed when the duration or two-person count changes', () => {
  const form = { serviceId: '5', name: '实际固定价', durationMin: '30', priceUsd: '100.25', priceBasis: 'PER_BOOKING', sortOrder: '0', isActive: true };
  const original = buildReservationPayload('variants', form, null, true);
  const longer = buildReservationPayload('variants', { ...form, durationMin: '240' }, null, false);
  assert.equal(original.priceBasis, 'PER_BOOKING'); assert.equal(original.priceCents, 10025);
  assert.equal(longer.priceCents, original.priceCents); assert.equal(longer.durationMin, 240);
  assert.equal(reservationServiceTotal(10025, 2, 'PER_BOOKING'), 10025);
  assert.equal(reservationServiceTotal(10025, 2, 'PER_PERSON'), 10025);
  assert.equal(buildReservationPayload('variants', { ...form, priceBasis: 'PER_PERSON' }, null, false).priceBasis, 'PER_BOOKING');
  assert.equal(Object.hasOwn(longer, 'serviceId'), false);
});
test('service policy explicitly preserves its own basis and rejects unknown or coerced bases', () => {
  const policy = { participantCount: '2', requiredRoomType: 'COUPLE', staffBufferMin: '0', roomBufferMin: '0', priceBasis: 'PER_BOOKING' };
  assert.equal(buildReservationPayload('policy', policy, null, false).priceBasis, 'PER_BOOKING');
  for (const priceBasis of ['', 'HOURLY', 'per_booking', false]) assert.throws(() => buildReservationPayload('policy', { ...policy, priceBasis }, null, false), /每人价或整单价/);
});
test('weekly shifts allow explicit midnight and forbid implicit cross-day periods', () => {
  assert.equal(timeMinute('24:00', true), 1440);
  assert.throws(() => timeMinute('24:00'));
  const form = { therapistId: '7', weekday: '6', startTime: '22:00', endTime: '24:00', isActive: true };
  assert.deepEqual(buildReservationPayload('shifts', form, null, true), { therapistId: '7', weekday: 6, startMin: 1320, endMin: 1440, isActive: true });
  assert.throws(() => buildReservationPayload('shifts', { ...form, endTime: '01:00' }, null, true), /拆为两天/);
  assert.equal(Object.hasOwn(buildReservationPayload('shifts', form, null, false), 'therapistId'), false);
});
test('room capacity follows the exclusive resource type without a shared-hall inference', () => {
  for (const [roomType, capacity] of [['SINGLE', 1], ['COUPLE', 2], ['FOOT_SEAT', 1]] as const) {
    assert.deepEqual(buildReservationPayload('rooms', { name: '实际空间', roomType, isActive: true }, null, true), { name: '实际空间', roomType, capacity, isActive: true });
  }
  assert.throws(() => buildReservationPayload('rooms', { name: '实际空间', roomType: 'FOOT_ZONE', isActive: true }, null, true));
});
test('time-off and maintenance emit exact UTC intervals, preserve parent on edit and can clear a reason', () => {
  const form = { roomId: '9', startLocal: '2026-10-29T09:00', endLocal: '2026-10-29T10:00', reason: '  ' };
  assert.deepEqual(buildReservationPayload('maintenance', form, 'America/New_York', true), { roomId: '9', startAtUtc: '2026-10-29T13:00:00.000Z', endAtUtc: '2026-10-29T14:00:00.000Z', reason: null });
  assert.equal(Object.hasOwn(buildReservationPayload('maintenance', form, 'America/New_York', false), 'roomId'), false);
  assert.throws(() => buildReservationPayload('maintenance', { ...form, endLocal: form.startLocal }, 'America/New_York', true), /晚于/);
  assert.throws(() => buildReservationPayload('time-off', { ...form, therapistId: '4', reason: 'a'.repeat(501) }, 'America/New_York', true), /500/);
});


test('four-hands uses one customer, two staff and a fixed whole-booking price', () => {
  const form = { participantCount: '1', requiredStaffCount: '2', requiredRoomType: 'SINGLE', staffBufferMin: '0', roomBufferMin: '10' };
  const payload = buildReservationPayload('policy', form, null, false);
  assert.equal(payload.participantCount, 1); assert.equal(payload.requiredStaffCount, 2); assert.equal(payload.priceBasis, 'PER_BOOKING');
  assert.throws(() => buildReservationPayload('policy', { ...form, participantCount: '2', requiredStaffCount: '1', requiredRoomType: 'COUPLE' }, null, false), /两位/);
  assert.equal(buildReservationPayload('policy', { ...form, requiredStaffCount: '1', priceBasis: 'PER_PERSON' }, null, false).priceBasis, 'PER_BOOKING');
});

test('therapists explicitly choose shop hours or custom shifts', () => {
  assert.deepEqual(buildReservationPayload('schedule', { scheduleMode: 'SHOP' }, null, false), { scheduleMode: 'SHOP' });
  assert.deepEqual(buildReservationPayload('schedule', { scheduleMode: 'CUSTOM' }, null, false), { scheduleMode: 'CUSTOM' });
  assert.throws(() => buildReservationPayload('schedule', { scheduleMode: 'ALL_DAY' }, null, false), /排班/);
});

test('variant USD create/edit/reopen preserves exact cents, fixed totals and the existing API ceiling', () => {
  const base = { serviceId: '5', name: 'Synthetic fixed price', durationMin: '30', sortOrder: '0', isActive: true };
  for (const [priceUsd, cents] of [['0.01', 1], ['.29', 29], ['0.29', 29], ['40', 4000], ['100.25', 10025], ['100000.00', 10000000]] as const) {
    const created = buildReservationPayload('variants', { ...base, priceUsd }, null, true);
    assert.equal(created.priceCents, cents);
    assert.equal(Object.hasOwn(created, 'priceUsd'), false);
    const reopened = reservationVariantPriceDraft(created.priceCents as number);
    assert.equal(reopened, (cents / 100).toFixed(2));
    const edited = buildReservationPayload('variants', { ...base, priceUsd: reopened, durationMin: '240' }, null, false);
    assert.equal(edited.priceCents, cents); assert.equal(Object.hasOwn(edited, 'serviceId'), false);
    assert.equal(reservationServiceTotal(edited.priceCents as number, 2, 'PER_BOOKING'), cents);
  }
  for (const priceUsd of ['-0.01', '0', '0.001', '40.001', '100000.01', '1e2', '', 'NaN']) {
    assert.throws(() => buildReservationPayload('variants', { ...base, priceUsd }, null, true));
  }
  // An old cents-shaped draft cannot accidentally be reinterpreted as dollars.
  assert.throws(() => buildReservationPayload('variants', { ...base, priceCents: '10025' }, null, false));
});
