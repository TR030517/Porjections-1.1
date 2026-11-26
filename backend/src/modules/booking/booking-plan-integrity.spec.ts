import { ConflictException } from '@nestjs/common';
import { BookingService } from './booking.service';

const minute = 60000;
const at = (hour: number) => new Date(Date.UTC(2035, 1, 1, hour));

/** The service and transaction methods are real. Only persistence is synthetic;
 * successful writes alter the fixture, so a rejected move must preserve it. */
function fixture({ gap = 0, participants = 1 }: { gap?: number; participants?: number } = {}) {
  const shop: any = { id: 10n, ownerId: 2n, status: 'APPROVED', deletedAt: null, name: 'Synthetic integrity shop', timezone: 'UTC',
    businessHours: Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '22:00' }])),
    studioProfile: { features: { onlineBooking: true } } };
  const catalog: any = { id: 20n, shopId: 10n, isActive: true, name: 'Synthetic integrity service', durationKind: 'TIMED', durationMin: 60,
    priceCents: 6000, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 60, variants: [] };
  const booking: any = { id: 100n, shopId: 10n, userId: 5n, serviceId: 20n, therapistId: 30n, status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE',
    paidCents: 0, refundedCents: 0, priceCents: (participants + 1) * 6000, totalCents: (participants + 1) * 6000,
    durationMin: 120 + gap, participantCountSnapshot: participants, requiredStaffCountSnapshot: participants,
    deletedAt: null, startTime: at(10), endTime: new Date(+at(10) + (120 + gap) * minute), currency: 'usd',
    reservationKind: 'PLAN', therapistSelectionMode: 'AUTO', requestedTherapistIds: [], shop, service: catalog, addOns: [], items: [], resourceLocks: [] };
  const item = (id: bigint, participantIndex: number, sequence: number, offsetMin: number) => ({ id, bookingId: booking.id, serviceId: 20n, variantId: null,
    participantIndex, sequence, offsetMin, durationKindSnapshot: 'TIMED', durationMin: 60, quotedUnitPriceCents: 6000, priceCentsSnapshot: 6000,
    staffBufferMin: gap === 15 ? 15 : 0, roomBufferMin: 60, roomTypeSnapshot: null, requiredStaffCountSnapshot: 1,
    startAtUtc: new Date(+booking.startTime + offsetMin * minute), endAtUtc: new Date(+booking.startTime + (offsetMin + 60) * minute),
    assignedTherapistId: BigInt(29 + participantIndex), assignedRoomId: null, therapistSelectionMode: 'AUTO', requestedTherapistIds: [], currency: 'usd', priceBasisSnapshot: 'PER_BOOKING' });
  booking.items = [item(1000n, 1, 1, 0), item(1001n, 1, 2, 60 + gap)];
  if (participants === 2) booking.items.push(item(1002n, 2, 1, 0));
  booking.resourceLocks = booking.items.map((row: any, index: number) => ({ id: BigInt(2000 + index), bookingId: booking.id, bookingItemId: row.id, shopId: shop.id,
    resourceType: 'THERAPIST', resourceId: row.assignedTherapistId, startAtUtc: row.startAtUtc, endAtUtc: new Date(+row.endAtUtc + row.staffBufferMin * minute), status: 'ACTIVE' }));
  const db: any = { $transaction: async (work: any) => work(db), $queryRaw: async () => [],
    shop: { findUnique: async () => shop }, shopService: { findUnique: async () => catalog },
    therapist: { findMany: async () => [30n, 31n].map(id => ({ id, isActive: true, scheduleMode: 'SHOP', shifts: [], timeOff: [] })) },
    shopRoom: { findMany: async () => [] }, refundRequest: { findFirst: async () => null },
    booking: { findMany: async () => [], findUnique: async () => booking,
      update: jest.fn(async ({ data }: any) => Object.assign(booking, data)) },
    bookingItem: { update: jest.fn(async ({ where, data }: any) => Object.assign(booking.items.find((row: any) => row.id === where.id), data)) },
    shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: { findMany: async () => [],
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.bookingId === booking.id) for (const row of booking.resourceLocks) if (row.status === where.status) Object.assign(row, data);
        return { count: booking.resourceLocks.length };
      }), createMany: jest.fn(async ({ data }: any) => { booking.resourceLocks.push(...data); return { count: data.length }; }) },
  };
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  jest.spyOn(service as any, 'notifyBooking').mockResolvedValue(undefined);
  const snapshot = () => JSON.parse(JSON.stringify({ start: booking.startTime, end: booking.endTime, duration: booking.durationMin,
    participants: booking.participantCountSnapshot, items: booking.items, locks: booking.resourceLocks }, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  return { booking, catalog, db, service, snapshot };
}

const mutations: Array<[string, (booking: any) => void]> = [
  ['missingLast', b => { b.items.pop(); }],
  ['missingParticipant', b => { b.items = b.items.filter((row: any) => row.participantIndex === 1); }],
  ['duplicateSequence', b => { b.items[1].sequence = 1; }],
  ['duplicateId', b => { b.items[1].id = b.items[0].id; }],
  ['wrongOwner', b => { b.items[1].bookingId = 101n; }],
  ['wrongStoredStart', b => { b.items[1].startAtUtc = new Date(+b.items[1].startAtUtc + 15 * minute); }],
  ['wrongWholeEnd', b => { b.endTime = new Date(+b.endTime + 30 * minute); }],
  ['nonconsecutiveParticipant', b => { b.items.forEach((row: any) => row.participantIndex = 2); }],
  ['missingFirstSequence', b => { b.items = [b.items[0]]; b.items[0].sequence = 2; b.durationMin = 60; b.endTime = b.items[0].endAtUtc; }],
];

describe('saved PLAN integrity before reschedule allocation or resource release', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T00:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  test.each(mutations)('reschedule availability refuses %s instead of deriving a different itinerary', async (name, change) => {
    const f = fixture({ participants: name === 'missingParticipant' ? 2 : 1 });
    change(f.booking);
    const before = f.snapshot();
    await expect(f.service.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-02-02')).rejects.toThrow(ConflictException);
    expect(f.snapshot()).toEqual(before);
    expect(f.db.booking.update).not.toHaveBeenCalled();
    expect(f.db.bookingResourceLock.createMany).not.toHaveBeenCalled();
  });

  test.each(mutations)('moving %s never rewrites the window or releases any saved resource', async (name, change) => {
    const f = fixture({ participants: name === 'missingParticipant' ? 2 : 1 });
    change(f.booking);
    const before = f.snapshot();
    const error = await f.service.rescheduleBooking('100', '5', { date: '2035-02-02', startTime: '10:00' }).then(() => null, failure => failure);
    expect(f.snapshot()).toEqual(before);
    expect(error).toBeInstanceOf(ConflictException);
    expect(f.db.booking.update).not.toHaveBeenCalled();
    expect(f.db.bookingItem.update).not.toHaveBeenCalled();
    expect(f.db.bookingResourceLock.createMany).not.toHaveBeenCalled();
    expect(f.db.bookingResourceLock.updateMany.mock.calls.some(([args]: any[]) => args.where.bookingId === f.booking.id)).toBe(false);
  });

  test.each([0, 15, 60])('a complete saved no-room PLAN keeps its explainable %i-minute gap and resource count', async gap => {
    const f = fixture({ gap, participants: 2 });
    const terms = f.booking.items.map((row: any) => [row.id, row.participantIndex, row.sequence, row.offsetMin, row.durationMin, row.staffBufferMin, row.roomBufferMin]);
    const slots: any = await f.service.getRescheduleSlots('100', '5', 'CUSTOMER', '2035-02-02');
    expect(slots.durationMin).toBe(120 + gap);
    expect(slots.participantCount).toBe(2);
    const moved = await f.service.rescheduleBooking('100', '5', { date: '2035-02-02', startTime: '10:00' });
    expect(moved.durationMin).toBe(120 + gap);
    expect(+moved.endTime - +moved.startTime).toBe((120 + gap) * minute);
    expect(f.booking.items.map((row: any) => [row.id, row.participantIndex, row.sequence, row.offsetMin, row.durationMin, row.staffBufferMin, row.roomBufferMin])).toEqual(terms);
    expect(f.booking.resourceLocks.filter((row: any) => row.status === 'ACTIVE')).toHaveLength(3);
    expect(f.booking.resourceLocks.filter((row: any) => row.status === 'RELEASED')).toHaveLength(3);
  });
});
