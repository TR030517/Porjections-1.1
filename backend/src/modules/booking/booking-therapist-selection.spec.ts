import { ConflictException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { preferredIds, type AllocationContext } from './availability';
import { newTherapistSelection } from './therapist-selection';

const start = new Date('2035-01-02T10:00:00Z');
const at = (hour: number) => new Date(`2035-01-02T${String(hour).padStart(2, '0')}:00:00Z`);
const input = { shopId: '2', serviceId: '3', date: '2035-01-02', startTime: '10:00', userId: '4', paymentMode: 'PAY_AT_STORE' as const, contact: { name: 'Synthetic customer', phone: '+12025550100', email: 'synthetic@example.test' } };

function fixture(mode: string | undefined = 'SPECIFIC', requested: string[] = ['11'], count = 1, staffCount = count) {
  const booking: any = { id: 1n, userId: 4n, shopId: 2n, serviceId: 3n, therapistId: 11n,
    status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', refundedCents: 0, paidCents: 0,
    priceCents: 6000, totalCents: 6000, durationMin: 60, currency: 'usd', holdExpiresAt: null,
    reservationKind: 'SINGLE', therapistSelectionMode: mode, requestedTherapistIds: requested,
    participantCountSnapshot: count, requiredStaffCountSnapshot: staffCount,
    startTime: new Date('2035-01-01T10:00:00Z'), endTime: new Date('2035-01-01T11:00:00Z'),
    items: Array.from({ length: count }, (_, index) => ({ id: BigInt(100 + index), bookingId: 1n, serviceId: 3n,
      participantIndex: index + 1, sequence: 1, assignedTherapistId: BigInt(11 + index),
      durationKindSnapshot: 'TIMED', durationMin: 60, requiredStaffCountSnapshot: count === 1 ? staffCount : 1,
      staffBufferMin: 0, roomBufferMin: 0, priceCentsSnapshot: 6000 / count, currency: 'usd',
      startAtUtc: new Date('2035-01-01T10:00:00Z'), endAtUtc: new Date('2035-01-01T11:00:00Z') })),
    service: { id: 3n, name: 'Synthetic service' }, shop: { id: 2n, timezone: 'UTC' }, resourceLocks: [] };
  const allocation: AllocationContext = { count, staffCount, duration: 60, staffBuffer: 0, roomBuffer: 0, needsRoom: false,
    therapists: ['11', '12', '13'].map(id => ({ id, shifts: [{ start: at(8), end: at(22) }], timeOff: [] })),
    rooms: [], locks: [], legacy: [] };
  const writes: any = { releases: 0, locks: [], itemUpdates: [], bookingUpdates: [], created: [] };
  const tx: any = {
    $queryRaw: async () => [],
    booking: { findUnique: async ({ select }: any) => select ? { shopId: 2n } : booking, findMany: async () => [],
      findUniqueOrThrow: async () => booking,
      create: async ({ data }: any) => { writes.created.push(data); Object.assign(booking, data); booking.items = []; return booking; },
      update: async ({ data }: any) => { writes.bookingUpdates.push(data); Object.assign(booking, data); return booking; } },
    user: { findUnique: async () => ({ id: 4n, email: 'synthetic@example.test', emailVerifiedAt: at(8), status: 'ACTIVE', role: 'CUSTOMER' }) },
    refundRequest: { findFirst: async () => null },
    shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: { updateMany: async ({ where }: any) => { if (where.bookingId) writes.releases++; return { count: 0 }; },
      createMany: async ({ data }: any) => { writes.locks.push(...data); return { count: data.length }; } },
    bookingItem: { create: async ({ data }: any) => { const row = { ...data, id: BigInt(100 + booking.items.length) }; booking.items.push(row); return row; },
      update: async ({ where, data }: any) => { writes.itemUpdates.push(data); const row = booking.items.find((r: any) => r.id === where.id); Object.assign(row, data); return row; } },
  };
  const db: any = { $transaction: async (work: any) => work(tx) };
  const service: any = new BookingService(db, {} as any, {} as any, {} as any);
  jest.spyOn(service, 'lockOwned').mockResolvedValue(booking);
  jest.spyOn(service, 'allowed').mockResolvedValue(true);
  jest.spyOn(service, 'serialize').mockImplementation(value => value);
  jest.spyOn(service, 'notifyBooking').mockResolvedValue(undefined);
  jest.spyOn(service, 'context').mockImplementation(async (_tx: any, params: any) => ({
    shop: booking.shop, service: booking.service, variant: null, durationKind: 'TIMED',
    duration: 60, unitPrice: 6000, priceBasis: 'PER_BOOKING', count, staffCount, staffBuffer: 0, roomBuffer: 0,
    currency: 'usd', roomType: null, preferred: preferredIds(params, staffCount), allocation,
    windows: [{ open: 8 * 60, close: 22 * 60 }], bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [] },
  }));
  jest.spyOn(service, 'pricedCreation').mockResolvedValue({ userCoupon: null, resolved: [], view: { subtotalCents: 6000, mainSubtotalCents: 6000, totalCents: 6000, discountCents: 0, platformFeeCents: 0, currency: 'usd' } });
  return { service, booking, writes, allocation, tx };
}

describe('saved therapist requests through booking operations', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2034-01-01T00:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  test.each([{ ids: [] }, { ids: ['12'] }])('new order saves request $ids independently of allocation', async ({ ids }) => {
    const f = fixture();
    await f.service.createBooking({ ...input, preferredTherapistIds: ids });
    expect(f.writes.created[0]).toMatchObject(newTherapistSelection(ids));
    expect(f.booking.therapistId).toBe(ids.length ? 12n : 11n);
  });

  test('a busy requested therapist makes both preview and save unavailable before releasing old locks', async () => {
    const f = fixture(); f.allocation.locks.push({ type: 'THERAPIST', id: '11', start, end: at(11) });
    const result = await f.service.getRescheduleSlots('1', '4', 'CUSTOMER', input.date);
    expect(result.slots.find((row: any) => row.time === '10:00')).toEqual({ time: '10:00', available: false });
    await expect(f.service.rescheduleBooking('1', '4', input)).rejects.toMatchObject({ response: { code: 'REQUESTED_THERAPIST_UNAVAILABLE' }, status: 409 });
    expect(f.booking.therapistId).toBe(11n); expect(f.writes.releases).toBe(0); expect(f.writes.bookingUpdates).toEqual([]);
  });

  test.each(['AUTO', undefined])('automatic/legacy mode %s may reassign without fabricating a request', async mode => {
    const f = fixture(mode, []); f.booking.therapistSelectionMode = mode;
    f.allocation.locks.push({ type: 'THERAPIST', id: '11', start, end: at(11) });
    const result = await f.service.rescheduleBooking('1', '4', input);
    expect(result.therapistId).toBe(12n); expect(result.therapistSelectionMode).toBe(mode);
    expect(f.writes.bookingUpdates[0]).not.toHaveProperty('requestedTherapistIds');
  });

  test.each([[2, 2], [1, 2]])('package guests=%i staff=%i still reserves two distinct simultaneous employees', async (guests, staff) => {
    const f = fixture('SPECIFIC', ['12'], guests, staff);
    await f.service.rescheduleBooking('1', '4', input);
    expect(f.writes.locks.map((row: any) => String(row.resourceId))).toEqual(['12', '11']);
    expect(f.writes.locks.every((row: any) => +row.startAtUtc === +start && +row.endAtUtc === +at(11))).toBe(true);
    expect(f.booking.requestedTherapistIds).toEqual(['12']);
  });

  test('reschedule cannot clear an explicit request through a legacy preference parameter', async () => {
    const f = fixture();
    await expect(f.service.rescheduleBooking('1', '4', { ...input, preferredTherapistIds: [] })).rejects.toThrow('cannot replace or clear');
    expect(f.writes.releases).toBe(0);
  });

  test('PLAN reconstructs each original segment preference instead of assigned IDs', async () => {
    const f = fixture(); f.booking.reservationKind = 'PLAN';
    Object.assign(f.booking.items[0], { therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['12'], assignedTherapistId: 13n, offsetMin: 0 });
    f.booking.items.push({ ...f.booking.items[0], id: 101n, sequence: 2, offsetMin: 60, therapistSelectionMode: 'AUTO', requestedTherapistIds: [], assignedTherapistId: 11n });
    f.booking.durationMin = 120;
    f.booking.endTime = new Date(+f.booking.startTime + 120 * 60000);
    f.booking.items[1].startAtUtc = new Date(+f.booking.startTime + 60 * 60000);
    f.booking.items[1].endAtUtc = f.booking.endTime;
    const plan = await f.service.planContext(f.tx, { shopId: '2', date: input.date, items: [] }, f.booking);
    expect(plan.segments.map((segment: any) => segment.c.preferred)).toEqual([['12'], []]);
    expect(f.service.allocateItinerary(plan, input.date, input.startTime).allocation[0].therapistIds).toEqual(['12']);
    f.allocation.locks.push({ type: 'THERAPIST', id: '12', start, end: at(11) });
    await expect(f.service.movePlan(f.tx, f.booking, input, false, '4', 'CUSTOMER')).rejects.toThrow(ConflictException);
    expect(f.writes.releases).toBe(0);
  });
});
