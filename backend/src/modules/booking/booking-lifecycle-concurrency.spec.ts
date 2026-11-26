jest.mock('../auth/security', () => ({ jwtSecret: () => 'Synthetic-lifecycle-concurrency-quote-key-2035-0123456789' }));
import { ConflictException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { localInstant } from './time';

const timezone = 'America/Los_Angeles';
const target = { date: '2035-01-20', startTime: '17:00' };
const instant = (day: string, time: string) => localInstant(day, time, timezone);
const addMinutes = (start: Date, minutes: number) => new Date(+start + minutes * 60000);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(participants = 1, staffCount = 1, withRoom = false) {
  const roomType = withRoom ? participants === 2 ? 'COUPLE' : 'SINGLE' : null;
  const shop: any = { id: 10n, timezone, status: 'APPROVED', deletedAt: null, name: 'Synthetic lifecycle shop',
    businessHours: Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '20:00' }])),
    studioProfile: { features: { onlineBooking: true } } };
  // The current menu has changed; the old orders must retain their original blocks/policy/price.
  const catalog: any = { id: 20n, shopId: 10n, name: 'Changed menu service', isActive: true, durationKind: 'VARIABLE', durationMin: 180, priceCents: 50000,
    participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, priceBasis: 'PER_PERSON', variants: [] };
  let state: any = { bookings: [], items: [], locks: [], audits: [], receipts: [] };
  for (const [index, time] of ['10:00', '13:00'].entries()) {
    const id = BigInt(100 + index), start = instant('2035-01-10', time), end = addMinutes(start, 60);
    state.bookings.push({ id, bookingNo: 'SYNTHETIC-LIFECYCLE-' + id, userId: 5n, shopId: 10n, serviceId: 20n, therapistId: 30n,
      status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', deletedAt: null, paidCents: 0, refundedCents: 0,
      couponId: null, holdExpiresAt: null, reservationKind: 'SINGLE', participantCountSnapshot: participants, requiredStaffCountSnapshot: staffCount,
      bookingDate: new Date('2035-01-10T00:00:00Z'), bookingTimezone: timezone, startTime: start, endTime: end, durationMin: 60,
      priceCents: 13057, discountCents: 0, platformFeeCents: 0, tipCents: 0, totalCents: 13057, currency: 'usd' });
    for (let participantIndex = 1; participantIndex <= participants; participantIndex++) {
      const item = { id: BigInt(1000 + state.items.length), bookingId: id, serviceId: 20n, variantId: null, participantIndex, sequence: 1, offsetMin: 0,
        serviceNameSnapshot: 'Original massage package', durationKindSnapshot: 'TIMED', durationMin: 60, staffBufferMin: 10, roomBufferMin: 5,
        priceCentsSnapshot: Math.floor(13057 / participants) + (participantIndex <= 13057 % participants ? 1 : 0), quotedUnitPriceCents: 13057,
        priceBasisSnapshot: 'PER_BOOKING', requiredStaffCountSnapshot: participants === 1 ? staffCount : 1, roomTypeSnapshot: roomType,
        assignedTherapistId: BigInt(29 + participantIndex), assignedRoomId: withRoom ? 40n : null, startAtUtc: start, endAtUtc: end, currency: 'usd' };
      state.items.push(item);
    }
    for (let staff = 0; staff < staffCount; staff++) state.locks.push({ id: BigInt(state.locks.length + 1), bookingId: id,
      bookingItemId: state.items.find((item: any) => item.bookingId === id && item.participantIndex === (participants === 1 ? 1 : staff + 1)).id,
      shopId: 10n, resourceType: 'THERAPIST', resourceId: BigInt(30 + staff), status: 'ACTIVE', startAtUtc: start, endAtUtc: addMinutes(end, 10), createdAt: new Date() });
    if (withRoom) state.locks.push({ id: BigInt(state.locks.length + 1), bookingId: id, bookingItemId: null, shopId: 10n,
      resourceType: 'ROOM', resourceId: 40n, status: 'ACTIVE', startAtUtc: start, endAtUtc: addMinutes(end, 5), createdAt: new Date() });
  }
  let tail = Promise.resolve(), failLocks = false, failReceipt = false;
  const events: string[] = [];
  const detail = (row: any) => row && ({ ...row, shop, service: catalog, items: state.items.filter((item: any) => item.bookingId === row.id), addOns: [], resourceLocks: state.locks.filter((lock: any) => lock.bookingId === row.id) });
  const client = (guard = () => {}) => ({
    shop: { findUnique: async () => shop }, shopService: { findUnique: async () => catalog },
    therapist: { findMany: async () => [30n, 31n].map(id => ({ id, scheduleMode: 'SHOP', shifts: [], timeOff: [] })) },
    shopRoom: { findMany: async () => withRoom ? [{ id: 40n, maintenance: [] }] : [] },
    booking: {
      findUnique: async ({ where, select }: any) => { const row = state.bookings.find((booking: any) => booking.id === where.id); return select && row ? { shopId: row.shopId } : detail(row); },
      findMany: async ({ where }: any) => where.holdExpiresAt ? [] : where.items?.none ? [] : state.bookings,
      update: async ({ where, data }: any) => { guard(); const row = state.bookings.find((booking: any) => booking.id === where.id); Object.assign(row, data); return detail(row); },
    },
    bookingItem: { update: async ({ where, data }: any) => { guard(); const item = state.items.find((item: any) => item.id === where.id); Object.assign(item, data); return item; } },
    shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: {
      findMany: async ({ where }: any) => state.locks.filter((lock: any) => lock.status === 'ACTIVE' && (!where.bookingId || lock.bookingId !== where.bookingId.not)
        && (!where.startAtUtc || lock.startAtUtc < where.startAtUtc.lt) && (!where.endAtUtc || lock.endAtUtc > where.endAtUtc.gt)),
      updateMany: async ({ where, data }: any) => { guard(); const rows = state.locks.filter((lock: any) => lock.status === 'ACTIVE' && lock.bookingId === where.bookingId);
        for (const row of rows) Object.assign(row, data); return { count: rows.length }; },
      createMany: async ({ data }: any) => { guard(); if (failLocks) throw Error('Synthetic replacement lock failure');
        for (const row of data) state.locks.push({ id: BigInt(state.locks.length + 1), createdAt: new Date(), ...row }); return { count: data.length }; },
    },
    bookingOperationReceipt: {
      findUnique: async ({ where }: any) => { guard(); const key = where.actorId_bookingId_requestKey;
        return state.receipts.find((row: any) => row.actorId === key.actorId && row.bookingId === key.bookingId && row.requestKey === key.requestKey) ?? null; },
      create: async ({ data }: any) => { guard(); if (failReceipt) throw Error('Synthetic operation receipt failure'); state.receipts.push(data); return data; },
    },
    refundRequest: { findFirst: async () => null }, auditLog: { create: async ({ data }: any) => { guard(); state.audits.push(data); return data; } },
  });
  const db: any = { ...client(), $transaction: async (work: any) => {
    let unlock: (() => void) | undefined, before: any;
    const guard = () => { if (!unlock) throw Error('Mutation occurred before acquiring the shared shop lock'); };
    const tx = { ...client(guard), $queryRaw: async (sql: any) => {
      if (String(sql.sql).includes('FROM shops') && !unlock) {
        const waiting = tail; tail = new Promise<void>(resolve => { unlock = resolve; });
        await waiting; before = structuredClone(state); events.push('shop-lock');
      } else if (String(sql.sql).includes('FROM bookings')) { guard(); events.push('booking-lock'); }
      return [];
    } };
    try { return await work(tx); } catch (error) { if (before) state = before; throw error; } finally { unlock?.(); }
  } };
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  const notify = jest.spyOn(service as any, 'notifyBooking').mockResolvedValue(undefined);
  return { service, state: () => state, events, notify, failReplacement: () => { failLocks = true; }, failReceipt: () => { failReceipt = true; } };
}
const active = (f: ReturnType<typeof fixture>, bookingId?: bigint) => f.state().locks.filter((lock: any) => lock.status === 'ACTIVE' && (!bookingId || lock.bookingId === bookingId));
describe('existing order cancellation/rescheduling and shared calendar concurrency', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T00:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  test.each([[1, 1, false], [2, 2, false], [1, 2, false], [2, 2, true], [1, 2, true]])('cross-UTC-day move retains snapshots and cancellation releases all current resources (%i guests / %i staff / room %s)', async (participants, staff, room) => {
    const f = fixture(participants as number, staff as number, room as boolean), untouched = structuredClone(active(f, 101n));
    const moved = await f.service.rescheduleBooking('100', '5', target);
    expect(moved).toMatchObject({ localDate: '2035-01-20', localStartTime: '17:00', localEndTime: '18:00', timezone, totalCents: 13057,
      durationMin: 60, participantCount: participants, requiredStaffCount: staff, service: { name: 'Original massage package', priceCents: 13057 } });
    expect(moved.startTime.toISOString()).toBe('2035-01-21T01:00:00.000Z');
    expect(moved.items.reduce((sum: number, item: any) => sum + item.priceCentsSnapshot, 0)).toBe(13057);
    expect(active(f, 100n).filter((lock: any) => lock.resourceType === 'THERAPIST')).toHaveLength(staff as number);
    expect(new Set(active(f, 100n).filter((lock: any) => lock.resourceType === 'THERAPIST').map((lock: any) => lock.resourceId)).size).toBe(staff);
    expect(active(f, 100n).every((lock: any) => +lock.startAtUtc === +moved.startTime)).toBe(true);
    const cancelled = await f.service.cancelBooking('100', '5');
    expect(cancelled.status).toBe('CANCELLED'); expect(active(f, 100n)).toEqual([]); expect(active(f, 101n)).toEqual(untouched);
    expect(cancelled.items.map((item: any) => item.assignedTherapistIds.length)).toEqual(Array(participants).fill(participants === 1 ? staff : 1));
  });
  test.each([[1, 1, false, 2], [2, 2, false, 1], [1, 2, false, 1], [1, 1, true, 1]])('simultaneous moves never overlap a calendar or configured room (%i guests / %i staff / room %s)', async (participants, staff, room, successes) => {
    const f = fixture(participants as number, staff as number, room as boolean);
    const results = await Promise.allSettled(['100', '101'].map(id => f.service.rescheduleBooking(id, '5', target)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(successes as number);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
    const locks = active(f);
    for (let index = 0; index < locks.length; index++) for (const other of locks.slice(index + 1)) {
      const lock = locks[index];
      expect(lock.resourceType === other.resourceType && lock.resourceId === other.resourceId && lock.startAtUtc < other.endAtUtc && lock.endAtUtc > other.startAtUtc).toBe(false);
    }
    expect(f.events).toEqual(['shop-lock', 'booking-lock', 'shop-lock', 'booking-lock']);
  });
  test.each([false, true])('cancel racing with move cannot resurrect a cancelled two-staff order (move first: %s)', async moveFirst => {
    const f = fixture(1, 2, true);
    const move = () => f.service.rescheduleBooking('100', '5', target), cancel = () => f.service.cancelBooking('100', '5');
    const results = await Promise.allSettled(moveFirst ? [move(), cancel()] : [cancel(), move()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(moveFirst ? 2 : 1);
    expect(f.state().bookings[0].status).toBe('CANCELLED'); expect(active(f, 100n)).toEqual([]);
    expect(active(f, 101n)).toHaveLength(3);
  });
  test.each([1, 2])('a stale slot selection and different operation keys cannot displace the original %i-guest/two-staff order', async participants => {
    const f = fixture(participants, 2, true), before = structuredClone(f.state());
    const slots = await f.service.getRescheduleSlots('100', '5', 'CUSTOMER', target.date);
    expect(slots.slots.find(row => row.time === target.startTime)?.available).toBe(true);
    const entered = deferred(), resume = deferred();
    f.notify.mockImplementationOnce(async () => { entered.resolve(); await resume.promise; });
    const winningKey = 'different-key-winner-001', losingKey = 'different-key-loser-002';
    const winner = f.service.rescheduleBooking('101', '5', target, 'CUSTOMER', winningKey);
    await entered.promise;
    // The winning transaction has allocated the selected slot but still owns the shop lock.
    let settled = false;
    const loser = f.service.rescheduleBooking('100', '5', target, 'CUSTOMER', losingKey)
      .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    resume.resolve();
    const moved = await winner, rejected = await loser;
    expect(rejected).toEqual({ error: expect.any(ConflictException) });
    expect(f.state().bookings.find((row: any) => row.id === 100n)).toEqual(before.bookings[0]);
    expect(f.state().items.filter((row: any) => row.bookingId === 100n)).toEqual(before.items.filter((row: any) => row.bookingId === 100n));
    expect(active(f, 100n)).toEqual(before.locks.filter((row: any) => row.bookingId === 100n));
    const movedStaff = active(f, 101n).filter((row: any) => row.resourceType === 'THERAPIST');
    expect(new Set(movedStaff.map((row: any) => row.resourceId)).size).toBe(2);
    expect(movedStaff.every((row: any) => +row.startAtUtc === +moved.startTime && +row.endAtUtc === +moved.endTime + 10 * 60000)).toBe(true);
    expect(moved).toMatchObject({ participantCount: participants, requiredStaffCount: 2, priceCents: 13057, totalCents: 13057 });
    expect(moved.items.reduce((sum: number, row: any) => sum + row.priceCentsSnapshot, 0)).toBe(13057);
    expect(f.state().receipts).toEqual([expect.objectContaining({ bookingId: 101n, requestKey: winningKey, action: 'RESCHEDULE', outcome: 'COMMITTED' })]);
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.events).toEqual(['shop-lock', 'shop-lock', 'booking-lock', 'shop-lock', 'booking-lock']);
  });
  test('failed replacement lock persistence rolls back released locks, moved item times and order times together', async () => {
    const f = fixture(2, 2, true), before = structuredClone(f.state()); f.failReplacement();
    await expect(f.service.rescheduleBooking('100', '5', target)).rejects.toThrow('Synthetic replacement lock failure');
    expect(f.state()).toEqual(before); expect(f.notify).not.toHaveBeenCalled();
  });
  test.each([1, 2])('receipt persistence failure rolls back the complete %i-guest/two-staff resource swap', async participants => {
    const f = fixture(participants, 2, true), before = structuredClone(f.state()); f.failReceipt();
    await expect(f.service.rescheduleBooking('100', '5', target, 'CUSTOMER', 'failed-receipt-key-001')).rejects.toThrow('Synthetic operation receipt failure');
    expect(f.state()).toEqual(before);
  });
  test('duplicate cancellation does not repeat resource/audit/notification side effects', async () => {
    const f = fixture(1, 2, true);
    const results = await Promise.allSettled([f.service.cancelBooking('100', '5'), f.service.cancelBooking('100', '5')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1); expect(f.notify).toHaveBeenCalledTimes(1); expect(active(f, 100n)).toEqual([]);
  });
});
