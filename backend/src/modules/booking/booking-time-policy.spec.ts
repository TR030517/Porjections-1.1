jest.mock('../auth/security', () => ({ jwtSecret: () => 'Synthetic-booking-time-policy-quote-key-2035-0123456789' }));
import { BookingService } from './booking.service';
import { localInstant } from './time';
import { ConflictException, NotFoundException } from '@nestjs/common';

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function alignStoredTimes(booking: any) {
  booking.endTime = new Date(+booking.startTime + booking.durationMin * 60000);
  for (const item of booking.items) {
    item.startAtUtc = new Date(+booking.startTime + item.offsetMin * 60000);
    item.endAtUtc = new Date(+item.startAtUtc + item.durationMin * 60000);
  }
}
function fixture({ minimumNoticeMinutes = 0, closedPeriods = [], timezone = 'America/New_York', open = '10:00', close = '20:00' }: any = {}) {
  const shop: any = { id: 10n, ownerId: 2n, status: 'APPROVED', deletedAt: null, name: 'Synthetic time shop', timezone,
    businessHours: Object.fromEntries(weekdays.map(day => [day, { open, close }])),
    studioProfile: { features: { onlineBooking: true }, bookingSettings: { minimumNoticeMinutes, closedPeriods } } };
  const service = { id: 20n, shopId: 10n, isActive: true, name: 'Synthetic time service', durationKind: 'TIMED', durationMin: 60,
    priceCents: 6000, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, variants: [] };
  const item = { id: 1000n, bookingId: 100n, serviceId: 20n, variantId: null, participantIndex: 1, sequence: 1, offsetMin: 0,
    durationKindSnapshot: 'TIMED', durationMin: 60, quotedUnitPriceCents: 6000, priceCentsSnapshot: 6000,
    staffBufferMin: 0, roomBufferMin: 0, roomTypeSnapshot: null, requiredStaffCountSnapshot: 1, currency: 'usd', priceBasisSnapshot: 'PER_BOOKING' };
  const booking: any = { id: 100n, shopId: 10n, userId: 5n, serviceId: 20n, status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE',
    paidCents: 0, refundedCents: 0, priceCents: 6000, durationMin: 60, participantCountSnapshot: 1, requiredStaffCountSnapshot: 1,
    deletedAt: null, startTime: new Date('2035-02-01T15:00:00Z'), currency: 'usd', items: [item], shop, service, reservationKind: 'SINGLE' };
  alignStoredTimes(booking);
  const writes = jest.fn(async () => { throw Error('Unexpected booking write'); });
  const therapists = [30n, 31n].map(id => ({ id, isActive: true, scheduleMode: 'SHOP', shifts: [], timeOff: [] }));
  const rooms = [{ id: 40n, isActive: true, roomType: 'SINGLE', capacity: 1, maintenance: [] }, { id: 41n, isActive: true, roomType: 'COUPLE', capacity: 2, maintenance: [] }];
  const db: any = { $transaction: async (callback: any) => callback(db), $queryRaw: async () => [],
    shop: { findUnique: async () => shop }, shopService: { findUnique: async () => service },
    therapist: { findMany: async ({ where }: any) => therapists.filter(row => row.isActive === where.isActive) },
    shopRoom: { findMany: async ({ where }: any) => rooms.filter(row => row.isActive === where.isActive && row.roomType === where.roomType && row.capacity >= where.capacity.gte) },
    shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: { findMany: async () => [], updateMany: jest.fn(async () => ({ count: 0 })), createMany: writes },
    booking: { findMany: async () => [], findUnique: async ({ where }: any) => where.id ? booking : null, create: writes, update: writes },
    refundRequest: { findFirst: async () => null },
    user: { findUnique: async () => ({ id: 5n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, email: 'synthetic-time@example.test', emailVerifiedAt: new Date() }) },
  };
  const bookings = new BookingService(db, {} as any, {} as any, {} as any);
  const input = (date = '2035-01-01', startTime = '10:00') => ({ shopId: '10', serviceId: '20', userId: '5', date, startTime, paymentMode: 'PAY_AT_STORE' as const, requestKey: 'synthetic-time-policy', contact: { name: 'Synthetic customer', phone: '+12025550100', email: 'synthetic-time@example.test' } });
  const plan = (date = '2035-01-01', startTime = '10:00') => ({ ...input(date, startTime), items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] });
  return { shop, service, therapists, rooms, booking, db, writes, bookings, input, plan };
}

const slot = (result: any, time: string) => result.slots.find((row: any) => row.time === time)?.available;
describe('PLAN preparation uses only resources actually reserved', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T13:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  const twoStages = (f: ReturnType<typeof fixture>, startTime = '20:00') => ({ ...f.plan('2035-01-02', startTime), items: [
    { participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '20' },
  ] });

  test('an unused room buffer never adds an hour to two-stage slots, quotes or the closing-time boundary', async () => {
    const f = fixture({ open: '09:00', close: '22:00' });
    f.service.roomBufferMin = 60;
    const input = twoStages(f), result = await f.bookings.getPlanSlots(input);
    expect(result.durationMin).toBe(120);
    expect(result.items.map((row: any) => [row.offsetMin, row.preparationMin])).toEqual([[0, 0], [60, 0]]);
    expect(slot(result, '20:00')).toBe(true);
    await expect(f.bookings.quotePlan(input)).resolves.toMatchObject({ durationMin: 120, totalCents: 12000 });
    expect(f.writes).not.toHaveBeenCalled();
  });

  test.each([
    ['room', 'SINGLE', 0, 60, 120, 180],
    ['staff', null, 15, 60, 75, 135],
  ])('real %s cleanup still separates stages even when another unused buffer is larger', async (_label, roomType, staffBuffer, roomBuffer, offset, duration) => {
    const f = fixture({ open: '09:00', close: '22:00' });
    Object.assign(f.service, { requiredRoomType: roomType, staffBufferMin: staffBuffer, roomBufferMin: roomBuffer });
    const result = await f.bookings.getPlanSlots(twoStages(f, '18:00'));
    expect(result.durationMin).toBe(duration);
    expect(result.items[1].offsetMin).toBe(offset);
    expect(slot(result, '18:00')).toBe(true);
    await expect(f.bookings.quotePlan(twoStages(f, '18:00'))).resolves.toMatchObject({ durationMin: duration, totalCents: 12000 });
  });

  test('new PLAN creation stores contiguous service times and reports no nonexistent room preparation', async () => {
    const f = fixture({ open: '09:00', close: '22:00' });
    f.service.roomBufferMin = 60;
    const items: any[] = [], locks: any[] = [];
    let saved: any;
    f.db.booking.create = jest.fn(async ({ data }: any) => saved = { id: 200n, paidCents: 0, refundedCents: 0, deletedAt: null, ...data });
    f.db.bookingItem = { create: jest.fn(async ({ data }: any) => { const item = { id: BigInt(2000 + items.length), ...data }; items.push(item); return item; }) };
    f.db.bookingResourceLock.createMany = jest.fn(async ({ data }: any) => { locks.push(...data); return { count: data.length }; });
    f.db.booking.findUniqueOrThrow = async () => ({ ...saved, items, resourceLocks: locks, addOns: [], shop: f.shop, service: f.service });
    jest.spyOn(f.bookings as any, 'notifyBooking').mockResolvedValue(undefined);
    const input = twoStages(f, '20:00'), quote = await f.bookings.quotePlan(input);
    const result = await f.bookings.createPlan({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    expect(result.durationMin).toBe(120);
    expect(result.items.map((row: any) => [row.offsetMin, row.preparationMin])).toEqual([[0, 0], [60, 0]]);
    expect(items.map(row => [row.startAtUtc.toISOString(), row.endAtUtc.toISOString()])).toEqual([
      ['2035-01-03T01:00:00.000Z', '2035-01-03T02:00:00.000Z'], ['2035-01-03T02:00:00.000Z', '2035-01-03T03:00:00.000Z'],
    ]);
    expect(locks).toHaveLength(2);
    expect(locks.every(row => row.resourceType === 'THERAPIST')).toBe(true);
  });

  test.each([60, 75, 120])('moving a saved PLAN retains its recorded offset %i and reports its real gap without extending the final stage', async offset => {
    const f = fixture({ open: '09:00', close: '22:00' });
    f.booking.reservationKind = 'PLAN'; f.booking.durationMin = offset + 60;
    f.booking.endTime = new Date(+f.booking.startTime + f.booking.durationMin * 60000);
    Object.assign(f.booking.items[0], { staffBufferMin: offset === 75 ? 15 : 0, roomBufferMin: 60, roomTypeSnapshot: null });
    f.booking.items.push({ ...f.booking.items[0], id: 1001n, sequence: 2, offsetMin: offset });
    alignStoredTimes(f.booking);
    const before = structuredClone(f.booking.items);
    const slots: any = await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-02');
    expect(slots.durationMin).toBe(offset + 60);
    expect(slots.items.map((row: any) => [row.offsetMin, row.preparationMin])).toEqual([[0, offset - 60], [offset, 0]]);
    expect(f.booking.items).toEqual(before);
    f.db.bookingItem = { update: jest.fn(async ({ where, data }: any) => Object.assign(f.booking.items.find((row: any) => row.id === where.id), data)) };
    f.db.bookingResourceLock.createMany = jest.fn(async ({ data }: any) => ({ count: data.length }));
    f.db.booking.update = jest.fn(async ({ data }: any) => Object.assign(f.booking, data));
    jest.spyOn(f.bookings as any, 'notifyBooking').mockResolvedValue(undefined);
    const moved = await f.bookings.rescheduleBooking('100', '5', { date: '2035-01-02', startTime: '18:00' });
    expect(moved.durationMin).toBe(offset + 60);
    expect(moved.items.map((row: any) => [row.offsetMin, row.preparationMin])).toEqual([[0, offset - 60], [offset, 0]]);
    expect(moved.endTime).toEqual(new Date(+new Date('2035-01-02T23:00:00Z') + (offset + 60) * 60000));
    expect(f.booking.items.map((row: any) => [row.offsetMin, row.durationMin, row.roomBufferMin])).toEqual(before.map((row: any) => [row.offsetMin, row.durationMin, row.roomBufferMin]));
  });

  test.each(['overlap', 'unexplainedGap', 'shiftedStart', 'missingSequence'])('a saved PLAN with %s fails review before any reschedule write', async change => {
    const f = fixture({ open: '09:00', close: '22:00' });
    f.booking.reservationKind = 'PLAN';
    Object.assign(f.booking.items[0], { roomBufferMin: 60, roomTypeSnapshot: null, offsetMin: change === 'shiftedStart' ? 15 : 0 });
    f.booking.items.push({ ...f.booking.items[0], id: 1001n, sequence: change === 'missingSequence' ? 3 : 2,
      offsetMin: change === 'overlap' ? 30 : change === 'unexplainedGap' ? 90 : 120 });
    await expect(f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-02')).rejects.toThrow(ConflictException);
    await expect(f.bookings.rescheduleBooking('100', '5', { date: '2035-01-02', startTime: '18:00' })).rejects.toThrow(ConflictException);
    expect(f.writes).not.toHaveBeenCalled();
  });
});

describe('one shop-local advance-notice and closure rule for every booking entry point', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T15:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  test.each(['ordinary', 'plan', 'ordinary-reschedule', 'plan-reschedule'])('zero notice never offers a slot at the already reached current instant (%s)', async kind => {
    const f = fixture();
    const result = kind === 'ordinary' ? await f.bookings.getAvailableSlots(f.input()) : kind === 'plan' ? await f.bookings.getPlanSlots(f.plan())
      : (f.booking.reservationKind = kind === 'plan-reschedule' ? 'PLAN' : 'SINGLE', await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-01'));
    expect(slot(result, '10:00')).toBe(false);
    expect(slot(result, '10:30')).toBe(true);
  });

  test.each(['ordinary-quote', 'plan-quote', 'ordinary-create', 'plan-create', 'ordinary-reschedule', 'plan-reschedule'])('zero notice rejects a new appointment at exactly now before writing (%s)', async kind => {
    const f = fixture();
    if (kind === 'plan-reschedule') f.booking.reservationKind = 'PLAN';
    const request = kind === 'ordinary-quote' ? f.bookings.quoteBooking(f.input()) : kind === 'plan-quote' ? f.bookings.quotePlan(f.plan())
      : kind === 'ordinary-create' ? f.bookings.createBooking(f.input()) : kind === 'plan-create' ? f.bookings.createPlan(f.plan())
      : f.bookings.rescheduleBooking('100', '5', f.input());
    await expect(request).rejects.toThrow(/advance notice|cannot be accommodated|cannot be moved/);
    expect(f.writes).not.toHaveBeenCalled();
  });

  test('twelve elapsed hours rolls past the current local closing time to tomorrow opening', async () => {
    jest.setSystemTime(new Date('2035-01-01T16:00:00Z')); // 11:00 in the shop; device/server locale must not matter.
    const f = fixture({ minimumNoticeMinutes: 720 });
    expect((await f.bookings.getAvailableSlots(f.input())).slots.every(row => !row.available)).toBe(true);
    expect(slot(await f.bookings.getAvailableSlots(f.input('2035-01-02')), '10:00')).toBe(true);
    expect((await f.bookings.getPlanSlots(f.plan())).slots.every(row => !row.available)).toBe(true);
    await expect(f.bookings.quoteBooking(f.input('2035-01-02'))).resolves.toMatchObject({ totalCents: 6000 });
    await expect(f.bookings.quotePlan(f.plan('2035-01-02'))).resolves.toMatchObject({ totalCents: 6000 });
  });

  test('twelve-hour notice remains a rolling threshold and permits the same evening when twelve hours remain', async () => {
    jest.setSystemTime(new Date('2035-01-01T10:00:00Z')); // 05:00 shop time; threshold is 17:00 today.
    const f = fixture({ minimumNoticeMinutes: 720 });
    for (const result of [await f.bookings.getAvailableSlots(f.input()), await f.bookings.getPlanSlots(f.plan())]) {
      expect(slot(result, '16:30')).toBe(false);
      expect(slot(result, '17:00')).toBe(true);
    }
    await expect(f.bookings.quoteBooking(f.input('2035-01-01', '17:00'))).resolves.toMatchObject({ totalCents: 6000 });
    await expect(f.bookings.quotePlan(f.plan('2035-01-01', '17:00'))).resolves.toMatchObject({ totalCents: 6000 });
  });

  test('a future slot exactly at a positive lead-time threshold is accepted, one millisecond too soon is rejected', async () => {
    jest.setSystemTime(new Date('2035-01-01T03:00:00Z')); // exactly twelve hours before shop 10:00.
    const f = fixture({ minimumNoticeMinutes: 720 });
    expect(slot(await f.bookings.getAvailableSlots(f.input()), '10:00')).toBe(true);
    expect(slot(await f.bookings.getPlanSlots(f.plan()), '10:00')).toBe(true);
    await expect(f.bookings.quoteBooking(f.input())).resolves.toMatchObject({ totalCents: 6000 });
    await expect(f.bookings.quotePlan(f.plan())).resolves.toMatchObject({ totalCents: 6000 });
    jest.advanceTimersByTime(1);
    expect(slot(await f.bookings.getAvailableSlots(f.input()), '10:00')).toBe(false);
    expect(slot(await f.bookings.getPlanSlots(f.plan()), '10:00')).toBe(false);
    await expect(f.bookings.quoteBooking(f.input())).rejects.toThrow('advance notice');
    await expect(f.bookings.quotePlan(f.plan())).rejects.toThrow('cannot be accommodated');
  });

  test.each(['2035-01-11', '2035-01-15', '2035-01-20'])('closed date range is inclusive in the shop calendar for slots, quotes, creation and moves (%s)', async date => {
    const f = fixture({ closedPeriods: [{ startDate: '2035-01-11', endDate: '2035-01-20' }] });
    expect((await f.bookings.getAvailableSlots(f.input(date))).slots).toEqual([]);
    expect((await f.bookings.getPlanSlots(f.plan(date))).slots).toEqual([]);
    expect((await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', date)).slots).toEqual([]);
    await expect(f.bookings.quoteBooking(f.input(date))).rejects.toThrow('outside available');
    await expect(f.bookings.createBooking(f.input(date))).rejects.toThrow('outside available');
    await expect(f.bookings.rescheduleBooking('100', '5', f.input(date))).rejects.toThrow('outside available');
    await expect(f.bookings.quotePlan(f.plan(date))).rejects.toThrow('cannot be accommodated');
    await expect(f.bookings.createPlan(f.plan(date))).rejects.toThrow('cannot be accommodated');
    f.booking.reservationKind = 'PLAN';
    expect((await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', date)).slots).toEqual([]);
    await expect(f.bookings.rescheduleBooking('100', '5', f.input(date))).rejects.toThrow('cannot be moved');
    expect(f.writes).not.toHaveBeenCalled();
  });

  test.each(['2035-01-10', '2035-01-21'])('adjacent dates remain bookable and UTC calendar day never shifts the local closure (%s)', async date => {
    const f = fixture({ timezone: 'America/Los_Angeles', open: '17:00', close: '20:00', closedPeriods: [{ startDate: '2035-01-11', endDate: '2035-01-20' }] });
    // 17:00 on Jan 10 is already Jan 11 UTC, but Jan 10 is open in the shop.
    expect(slot(await f.bookings.getAvailableSlots(f.input(date, '17:00')), '17:00')).toBe(true);
    await expect(f.bookings.quoteBooking(f.input(date, '17:00'))).resolves.toMatchObject({ totalCents: 6000 });
    await expect(f.bookings.quotePlan(f.plan(date, '17:00'))).resolves.toMatchObject({ totalCents: 6000 });
  });

  test.each([
    ['2035-03-11', '2035-03-11T02:00:00Z'], // spring forward: prior 21:00 + 12 elapsed hours = shop 10:00 EDT.
    ['2035-11-04', '2035-11-04T03:00:00Z'], // fall back: prior 23:00 + 12 elapsed hours = shop 10:00 EST.
  ])('lead time remains elapsed hours across DST (%s)', async (date, now) => {
    jest.setSystemTime(new Date(now));
    const f = fixture({ minimumNoticeMinutes: 720 });
    expect(+localInstant(date, '10:00', f.shop.timezone) - Date.now()).toBe(12 * 3600000);
    expect(slot(await f.bookings.getAvailableSlots(f.input(date)), '10:00')).toBe(true);
    await expect(f.bookings.quotePlan(f.plan(date))).resolves.toMatchObject({ totalCents: 6000 });
  });
});

const bookingKinds = ['ordinary', 'couple', 'four-hands', 'plan'] as const;
function acceptanceFixture(kind: typeof bookingKinds[number], options: any = {}) {
  const f = fixture(options);
  f.service.participantCount = kind === 'couple' ? 2 : 1;
  f.service.requiredStaffCount = kind === 'couple' || kind === 'four-hands' ? 2 : 1;
  const input = (date = '2035-01-01', time = '10:00') => kind === 'plan' ? f.plan(date, time) : f.input(date, time);
  const quote = (data: any) => kind === 'plan' ? f.bookings.quotePlan(data) : f.bookings.quoteBooking(data);
  const create = (data: any) => kind === 'plan' ? f.bookings.createPlan(data) : f.bookings.createBooking(data);
  return { ...f, input, quote, create };
}

function bufferedFixture(kind: typeof bookingKinds[number], resource: 'room' | 'custom-staff', buffer = 60) {
  const f = acceptanceFixture(kind, { open: '10:00', close: '23:59' });
  f.service.durationMin = 30;
  f.service.staffBufferMin = resource === 'custom-staff' ? buffer : 0;
  f.service.roomBufferMin = resource === 'room' ? buffer : 0;
  (f.service as any).requiredRoomType = resource === 'room' ? kind === 'couple' ? 'COUPLE' : 'SINGLE' : null;
  if (resource === 'custom-staff') for (const therapist of f.therapists) {
    therapist.scheduleMode = 'CUSTOM';
    (therapist as any).shifts = weekdays.map((_day, weekday) => ({ weekday, startMin: 0, endMin: 1440, isActive: true }));
  }
  f.booking.durationMin = 30;
  f.booking.participantCountSnapshot = f.service.participantCount;
  f.booking.requiredStaffCountSnapshot = f.service.requiredStaffCount;
  f.booking.items[0] = { ...f.booking.items[0], durationMin: 30, staffBufferMin: f.service.staffBufferMin,
    roomBufferMin: f.service.roomBufferMin, roomTypeSnapshot: f.service.requiredRoomType, requiredStaffCountSnapshot: f.service.requiredStaffCount };
  if (kind === 'plan') f.booking.reservationKind = 'PLAN';
  alignStoredTimes(f.booking);
  return f;
}

describe.each(bookingKinds)('temporary closure protects the complete reserved occupation (%s)', kind => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T13:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  test.each(['room', 'custom-staff'] as const)('%s cleanup after daily closing is permitted, but cannot enter a temporarily closed date', async resource => {
    const f = bufferedFixture(kind, resource), input = f.input('2035-01-10', '23:00');
    const slots = () => kind === 'plan' ? f.bookings.getPlanSlots(input as any) : f.bookings.getAvailableSlots(input);
    expect(slot(await slots(), '23:00')).toBe(true);
    await expect(f.quote(input)).resolves.toMatchObject({ totalCents: 6000 });
    f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2035-01-11', endDate: '2035-01-11' }];
    expect(slot(await slots(), '23:00')).toBe(false);
    await expect(f.quote(input)).rejects.toThrow(/temporary shop closure|cannot be accommodated/);
    await expect(f.create(input)).rejects.toThrow(/temporary shop closure|cannot be accommodated/);
    expect(f.writes).not.toHaveBeenCalled();
  });

  test.each(['room', 'custom-staff'] as const)('%s occupation ending exactly at the next local midnight remains allowed', async resource => {
    const f = bufferedFixture(kind, resource, 30), input = f.input('2035-01-10', '23:00');
    f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2035-01-11', endDate: '2035-01-11' }];
    const slots = kind === 'plan' ? await f.bookings.getPlanSlots(input as any) : await f.bookings.getAvailableSlots(input);
    expect(slot(slots, '23:00')).toBe(true);
    await expect(f.quote(input)).resolves.toMatchObject({ totalCents: 6000 });
    // Extending only the occupied buffer by one minute reaches the closed date.
    if (resource === 'room') f.service.roomBufferMin = 31; else f.service.staffBufferMin = 31;
    await expect(f.quote(input)).rejects.toThrow(/temporary shop closure|cannot be accommodated/);
    expect(f.writes).not.toHaveBeenCalled();
  });
});

describe.each(['ordinary', 'plan'] as const)('rescheduling respects temporary closures during cleanup (%s)', kind => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T13:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  test.each(['room', 'custom-staff'] as const)('a %s buffer crossing a new closure is never offered or moved before releasing the original reservation', async resource => {
    const f = bufferedFixture(kind, resource), replacement = f.input('2035-01-10', '23:00');
    expect(slot(await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-10'), '23:00')).toBe(true);
    f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2035-01-11', endDate: '2035-01-11' }];
    expect(slot(await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-10'), '23:00')).toBe(false);
    await expect(f.bookings.rescheduleBooking('100', '5', replacement)).rejects.toThrow(/temporary shop closure|cannot be moved/);
    expect(f.db.bookingResourceLock.updateMany.mock.calls.some(([query]: any[]) => query.where.bookingId === 100n)).toBe(false);
    expect(f.writes).not.toHaveBeenCalled();
  });

  test('the manager replacement-calendar path enforces the same closure without requiring public-booking access', async () => {
    const f = bufferedFixture(kind, 'room'), replacement = f.input('2035-01-10', '23:00');
    // Isolate the manager time-rule path; authorization has separate tests.
    jest.spyOn(f.bookings as any, 'allowed').mockResolvedValue(true);
    jest.spyOn(f.bookings as any, 'lockOwned').mockResolvedValue(f.booking);
    f.shop.studioProfile.features.onlineBooking = false;
    expect(slot(await f.bookings.getRescheduleSlots('100', '2', 'MERCHANT', '2035-01-10'), '23:00')).toBe(true);
    f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2035-01-11', endDate: '2035-01-11' }];
    expect(slot(await f.bookings.getRescheduleSlots('100', '2', 'MERCHANT', '2035-01-10'), '23:00')).toBe(false);
    await expect(f.bookings.rescheduleBooking('100', '2', replacement, 'MERCHANT')).rejects.toThrow(/temporary shop closure|cannot be moved/);
    expect(f.db.bookingResourceLock.updateMany.mock.calls.some(([query]: any[]) => query.where.bookingId === 100n)).toBe(false);
    expect(f.writes).not.toHaveBeenCalled();
  });

  test('a room buffer does not occupy anything when the service reserves no room', async () => {
    const f = bufferedFixture(kind, 'room'), input = f.input('2035-01-10', '23:00');
    f.service.requiredRoomType = null;
    f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2035-01-11', endDate: '2035-01-11' }];
    const slots = kind === 'plan' ? await f.bookings.getPlanSlots(input as any) : await f.bookings.getAvailableSlots(input);
    expect(slot(slots, '23:00')).toBe(true);
    await expect(f.quote(input)).resolves.toMatchObject({ totalCents: 6000 });
  });
});

describe('multi-segment itinerary closure checks include each real offset and final cleanup', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T13:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  test.each(['room', 'custom-staff'] as const)('the later segment %s buffer cannot enter a closed date even when the anchor is safely earlier', async resource => {
    const f = bufferedFixture('plan', resource), input = { ...f.plan('2035-01-10', '21:30'), items: [
      { participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '20' },
    ] };
    f.booking.durationMin = 120;
    f.booking.items.push({ ...f.booking.items[0], id: 1001n, sequence: 2, offsetMin: 90 });
    alignStoredTimes(f.booking);
    expect(slot(await f.bookings.getPlanSlots(input), '21:30')).toBe(true);
    await expect(f.bookings.quotePlan(input)).resolves.toMatchObject({ totalCents: 12000 });
    expect(slot(await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-10'), '21:30')).toBe(true);
    f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2035-01-11', endDate: '2035-01-11' }];
    expect(slot(await f.bookings.getPlanSlots(input), '21:30')).toBe(false);
    await expect(f.bookings.quotePlan(input)).rejects.toThrow('cannot be accommodated');
    await expect(f.bookings.createPlan(input)).rejects.toThrow('cannot be accommodated');
    expect(slot(await f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-10'), '21:30')).toBe(false);
    await expect(f.bookings.rescheduleBooking('100', '5', input)).rejects.toThrow('cannot be moved');
    expect(f.db.bookingResourceLock.updateMany.mock.calls.some(([query]: any[]) => query.where.bookingId === 100n)).toBe(false);
    expect(f.writes).not.toHaveBeenCalled();
  });
});

describe.each(bookingKinds)('current-time acceptance boundary (%s)', kind => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test.each([0, 60])('time spent resolving the signed selection cannot bypass %i minutes of notice', async minimumNoticeMinutes => {
    // The selected instant starts one millisecond outside the forbidden range.
    // A real selection read may cross that boundary without expiring its five-minute quote.
    const start = new Date('2035-01-01T15:00:00Z');
    jest.setSystemTime(new Date(+start - minimumNoticeMinutes * 60000 - 1));
    const f = acceptanceFixture(kind, { minimumNoticeMinutes });
    const addon = { id: 50n, serviceId: 20n, service: f.service, isActive: true, name: 'Synthetic warm towel', priceCents: 500, currency: 'usd' };
    f.db.shopServiceAddOn = { findMany: jest.fn(async () => [addon]) };
    const input = { ...f.input(), addOnSelections: [{ participantIndex: 1, sequence: 1, addOnIds: ['50'] }] };
    const quote = await f.quote(input);
    expect(quote.totalCents).toBe(6500);
    f.db.shopServiceAddOn.findMany.mockImplementationOnce(async () => {
      jest.setSystemTime(new Date(Date.now() + 2));
      return [addon];
    });
    await expect(f.create({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }))
      .rejects.toThrow(/advance notice|reservation quote changed/);
    expect(new Date(quote.quoteExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(f.writes).not.toHaveBeenCalled();
  });

  test.each([0, 60])('a quote whose selection read crosses %i minutes of notice is not returned as fresh', async minimumNoticeMinutes => {
    jest.setSystemTime(new Date(Date.parse('2035-01-01T15:00:00Z') - minimumNoticeMinutes * 60000 - 1));
    const f = acceptanceFixture(kind, { minimumNoticeMinutes });
    const addon = { id: 50n, serviceId: 20n, service: f.service, isActive: true, name: 'Synthetic warm towel', priceCents: 500, currency: 'usd' };
    f.db.shopServiceAddOn = { findMany: jest.fn(async () => {
      jest.setSystemTime(new Date(Date.now() + 2));
      return [addon];
    }) };
    await expect(f.quote({ ...f.input(), addOnSelections: [{ participantIndex: 1, sequence: 1, addOnIds: ['50'] }] }))
      .rejects.toThrow('advance notice');
    expect(f.writes).not.toHaveBeenCalled();
  });

  test.each([0, 60])('an unexpired quote cannot revive a slot after %i minutes of notice has elapsed', async minimumNoticeMinutes => {
    jest.setSystemTime(new Date(Date.parse('2035-01-01T15:00:00Z') - minimumNoticeMinutes * 60000 - 1));
    const f = acceptanceFixture(kind, { minimumNoticeMinutes }), input = f.input(), quote = await f.quote(input);
    jest.setSystemTime(new Date(Date.now() + 2));
    expect(new Date(quote.quoteExpiresAt).getTime()).toBeGreaterThan(Date.now());
    await expect(f.create({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow(ConflictException);
    expect(f.writes).not.toHaveBeenCalled();
  });

  test.each(['closure', 'online-booking-off', 'shop-unpublished', 'service-disabled', 'staff-disabled', 'room-disabled'])('a saved quote never bypasses a subsequent %s change', async change => {
    jest.setSystemTime(new Date('2035-01-01T13:00:00Z'));
    const f = acceptanceFixture(kind);
    if (change === 'room-disabled') (f.service as any).requiredRoomType = kind === 'couple' ? 'COUPLE' : 'SINGLE';
    const input = f.input(), quote = await f.quote(input);
    if (change === 'closure') f.shop.studioProfile.bookingSettings.closedPeriods = [{ startDate: '2035-01-01', endDate: '2035-01-01' }];
    if (change === 'online-booking-off') f.shop.studioProfile.features.onlineBooking = false;
    if (change === 'shop-unpublished') f.shop.status = 'PENDING';
    if (change === 'service-disabled') f.service.isActive = false;
    if (change === 'staff-disabled') f.therapists.forEach(row => { row.isActive = false; });
    if (change === 'room-disabled') f.rooms.forEach(row => { row.isActive = false; });
    await expect(f.create({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }))
      .rejects.toThrow(change === 'shop-unpublished' ? NotFoundException : ConflictException);
    expect(f.writes).not.toHaveBeenCalled();
  });

  test('a still-signed midnight selection expires on the shop day boundary, independently of the UTC date', async () => {
    jest.setSystemTime(new Date('2035-01-02T04:59:59.999Z')); // Jan 1, 23:59:59.999 in New York.
    const f = acceptanceFixture(kind, { open: '00:00', close: '23:59' });
    const input = f.input('2035-01-02', '00:00'), quote = await f.quote(input);
    jest.setSystemTime(new Date('2035-01-02T05:00:00Z'));
    const slots = kind === 'plan' ? await f.bookings.getPlanSlots(input as any) : await f.bookings.getAvailableSlots(input);
    expect(slots.bookingCalendar).toMatchObject({ today: '2035-01-02', timezone: 'America/New_York', validUntil: '2035-01-03T05:00:00.000Z' });
    expect(slot(slots, '00:00')).toBe(false);
    await expect(f.create({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow(ConflictException);
    expect(f.writes).not.toHaveBeenCalled();
  });

  test.each([
    ['2035-03-11', '02:00', 'missing or ambiguous'],
    ['2035-11-04', '01:30', 'missing or ambiguous'],
  ])('a DST gap or repeated wall time is never offered or accepted (%s %s)', async (date, time) => {
    jest.setSystemTime(new Date('2035-01-01T13:00:00Z'));
    const f = acceptanceFixture(kind, { open: '00:00', close: '06:00' }), input = f.input(date, time);
    const slots = kind === 'plan' ? await f.bookings.getPlanSlots(input as any) : await f.bookings.getAvailableSlots(input);
    expect(slot(slots, time)).toBe(false);
    await expect(f.quote(input)).rejects.toThrow(kind === 'plan' ? 'cannot be accommodated' : 'missing or ambiguous');
    await expect(f.create(input)).rejects.toThrow(kind === 'plan' ? 'cannot be accommodated' : 'missing or ambiguous');
    expect(f.writes).not.toHaveBeenCalled();
  });
});

describe.each(bookingKinds)('original appointment deadline during rescheduling (%s)', kind => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T14:59:59.999Z')); });
  afterEach(() => jest.useRealTimers());

  function existingOrder() {
    const f = fixture();
    f.db.bookingItem = { create: f.writes, update: f.writes };
    f.booking.startTime = new Date('2035-01-01T15:00:00Z');
    f.booking.endTime = new Date('2035-01-01T16:00:00Z');
    if (kind === 'couple') {
      f.booking.participantCountSnapshot = 2; f.booking.requiredStaffCountSnapshot = 2;
      f.booking.items.push({ ...f.booking.items[0], id: 1001n, participantIndex: 2 });
    }
    if (kind === 'four-hands') {
      f.booking.requiredStaffCountSnapshot = 2; f.booking.items[0].requiredStaffCountSnapshot = 2;
    }
    if (kind === 'plan') {
      f.booking.reservationKind = 'PLAN'; f.booking.durationMin = 120;
      f.booking.endTime = new Date('2035-01-01T17:00:00Z');
      f.booking.items.push({ ...f.booking.items[0], id: 1001n, sequence: 2, offsetMin: 60 });
    }
    alignStoredTimes(f.booking);
    const readTherapists = f.db.therapist.findMany;
    f.db.therapist.findMany = async (query: any) => {
      // The original order is still future at entry, but its start is reached
      // while resolving replacement calendars. The replacement is tomorrow.
      jest.setSystemTime(new Date('2035-01-01T15:00:00Z'));
      return readTherapists(query);
    };
    return f;
  }

  test('a calendar read cannot return replacement slots after the original appointment starts', async () => {
    const f = existingOrder();
    await expect(f.bookings.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-01-02'))
      .rejects.toThrow('This booking cannot be rescheduled');
    expect(f.writes).not.toHaveBeenCalled();
  });

  test('reaching the original start during replacement reads rejects before releasing or rewriting its reservation', async () => {
    const f = existingOrder();
    await expect(f.bookings.rescheduleBooking('100', '5', f.input('2035-01-02')))
      .rejects.toThrow('This booking can no longer be rescheduled');
    expect(f.db.bookingResourceLock.updateMany.mock.calls.some(([query]: any[]) => query.where.bookingId === 100n)).toBe(false);
    expect(f.writes).not.toHaveBeenCalled();
  });
});
