import { NotFoundException } from '@nestjs/common';
import { bookingItemRoomId, bookingReception } from './booking-reception';
import { BookingService } from '../modules/booking/booking.service';

const at = (time: string) => new Date('2035-01-01T' + time + ':00Z');
const project = (row: any, select: any) => row ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : null;
function fixture() {
  const users: any[] = [
    { id: 1n, role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    { id: 2n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null },
    { id: 3n, role: 'STAFF', status: 'ACTIVE', deletedAt: null },
    { id: 4n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null },
    { id: 5n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, name: 'Guest', phone: '+1 555 0100', email: 'HIDDEN_EMAIL', passwordHash: 'HIDDEN_HASH', googleId: 'HIDDEN_PROVIDER_ID' },
  ];
  const shop: any = { id: 10n, deletedAt: null, status: 'APPROVED', name: 'Synthetic reception', timezone: 'UTC', shortName: 'synthetic-reception',
    address: '', city: '', state: '', phone: '', loginBinding: { userId: 2n, user: users[1] } };
  const item: any = { id: 1000n, bookingId: 100n, serviceId: 20n, variantId: null, participantIndex: 1, sequence: 1, offsetMin: 0,
    serviceNameSnapshot: 'Four hands', durationKindSnapshot: 'TIMED', durationMin: 60, priceCentsSnapshot: 13057, quotedUnitPriceCents: 13057,
    priceBasisSnapshot: 'PER_BOOKING', currency: 'usd', requiredStaffCountSnapshot: 2, staffBufferMin: 15, roomBufferMin: 10,
    assignedTherapistId: 30n, assignedRoomId: 40n, startAtUtc: at('09:00'), endAtUtc: at('10:00') };
  const lock = (id: bigint, type: string, resourceId: bigint, end: string) => ({ id, bookingId: 100n, shopId: 10n, bookingItemId: type === 'ROOM' ? null : 1000n,
    resourceType: type, resourceId, startAtUtc: at('09:00'), endAtUtc: at(end), status: 'ACTIVE', createdAt: at('08:00') });
  const booking: any = { id: 100n, bookingNo: 'SYNTHETIC-RECEPTION', userId: 5n, shopId: 10n, serviceId: 20n, therapistId: 30n, couponId: null,
    bookingDate: at('00:00'), bookingTimezone: 'UTC', startTime: at('09:00'), endTime: at('10:00'), createdAt: at('08:00'), updatedAt: at('08:00'), deletedAt: null,
    durationMin: 60, priceCents: 13057, totalCents: 13057, discountCents: 0, platformFeeCents: 0, tipCents: 0, paidCents: 0, refundedCents: 0,
    paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', status: 'CONFIRMED', participantCountSnapshot: 1, requiredStaffCountSnapshot: 2,
    reservationKind: 'SINGLE', shop, service: { id: 20n, name: 'Live service', durationKind: 'TIMED', durationMin: 90 }, therapist: null,
    items: [item], addOns: [], resourceLocks: [lock(201n, 'THERAPIST', 30n, '10:15'), lock(202n, 'THERAPIST', 31n, '10:15'), lock(203n, 'ROOM', 40n, '10:10')] };
  const therapists: any[] = [
    { id: 30n, shopId: 10n, name: 'Alice', isActive: false, bio: 'HIDDEN_BIO', timeOff: ['HIDDEN_LEAVE'] },
    { id: 31n, shopId: 10n, name: 'Bob', isActive: true }, { id: 70n, shopId: 10n, name: 'Legacy technician', isActive: false },
    { id: 99n, shopId: 11n, name: 'HIDDEN_FOREIGN_TECHNICIAN' },
  ];
  const rooms: any[] = [{ id: 40n, shopId: 10n, name: 'Historical room', isActive: false, maintenance: ['HIDDEN_MAINTENANCE'] },
    { id: 99n, shopId: 11n, name: 'HIDDEN_FOREIGN_ROOM' }];
  let staffPermissions = ['BOOKINGS_READ'];
  const db: any = {
    user: { findFirst: jest.fn(async ({ where, select }: any) => project(users.find(row => Object.entries(where).every(([key, value]) => row[key] === value)), select)) },
    shop: { findFirst: jest.fn(async ({ where }: any) => where.id === shop.id && shop.deletedAt === null ? shop : null) },
    shopAccountGrant: { findFirst: jest.fn(async () => null) },
    shopStaffGrant: { findUnique: jest.fn(async ({ where }: any) => where.shopId_userId.shopId === 10n && where.shopId_userId.userId === 3n ? { status: 'ACTIVE', permissions: staffPermissions } : null) },
    therapist: { findMany: jest.fn(async ({ where, select }: any) => therapists.filter(row => row.shopId === where.shopId && where.id.in.includes(row.id)).map(row => project(row, select))) },
    shopRoom: { findMany: jest.fn(async ({ where, select }: any) => rooms.filter(row => row.shopId === where.shopId && where.id.in.includes(row.id)).map(row => project(row, select))) },
    booking: { findUnique: jest.fn(async ({ where }: any) => where.id === booking.id ? booking : null),
      findMany: jest.fn(async ({ where }: any) => where.holdExpiresAt ? [] : [booking]), count: jest.fn(async () => 1) },
    bookingResourceLock: { updateMany: jest.fn(async () => ({ count: 0 })) },
    $queryRaw: jest.fn(async () => []),
  };
  db.$transaction = async (work: any) => Array.isArray(work) ? Promise.all(work) : work(db);
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  const contactCalls = () => db.user.findFirst.mock.calls.filter((call: any[]) => call[0].select.name === true);
  return { db, service, booking, item, users, therapists, rooms, lock, contactCalls, setStaffPermissions: (value: string[]) => { staffPermissions = value; } };
}

describe('manager-only booking reception detail projection', () => {
  const recordedContact = () => ({ contactName: 'Recorded booking guest', contactPhone: '+12025550100', contactEmail: 'recorded.guest@example.test',
    contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactEmailVerifiedAt: at('07:30') });
  const contactView = () => ({ recorded: true, version: 1, name: 'Recorded booking guest', phone: '+12025550100', email: 'recorded.guest@example.test',
    source: 'ONLINE_VERIFIED', emailVerifiedAt: at('07:30').toISOString() });

  test.each([['ADMIN', '1'], ['MERCHANT', '2'], ['STAFF', '3']])('authorized %s reception and detail use recorded contact after the live account changes', async (role, actor) => {
    const f = fixture(); Object.assign(f.booking, recordedContact());
    Object.assign(f.users[4], { name: 'Changed current name', phone: '+12025550999', email: 'changed.account@example.test' });
    const before = structuredClone(f.booking), result: any = await f.service.getBooking('100', actor, role);
    expect(result.contact).toEqual(contactView());
    expect(result.reception.customer).toEqual({ name: 'Recorded booking guest', phone: '+12025550100' });
    expect(f.contactCalls()).toEqual([]);
    expect(JSON.stringify(result.reception)).not.toMatch(/Changed current|12025550999|changed\.account/);
    for (const key of Object.keys(recordedContact())) expect(result).not.toHaveProperty(key);
    expect(f.booking).toEqual(before);
  });

  test('a customer reads its own recorded contact in detail/list without manager contact or resource queries', async () => {
    const f = fixture(); Object.assign(f.booking, recordedContact());
    Object.assign(f.users[4], { name: 'Changed current name', phone: '+12025550999' });
    const detail: any = await f.service.getBooking('100', '5'), list: any = await f.service.listUserBookings('5', { page: '1' });
    for (const row of [detail, list.items[0]]) {
      expect(row.contact).toEqual(contactView()); expect(row).not.toHaveProperty('reception'); expect(row).not.toHaveProperty('user');
      for (const key of Object.keys(recordedContact())) expect(row).not.toHaveProperty(key);
    }
    expect(f.db.user.findFirst).not.toHaveBeenCalled(); expect(f.db.therapist.findMany).not.toHaveBeenCalled(); expect(f.db.shopRoom.findMany).not.toHaveBeenCalled();
  });

  test('denied actors cannot reach recorded contact projection or contact/resource resolution', async () => {
    for (const [actor, role] of [['4', 'MERCHANT'], ['3', 'STAFF'], ['6', 'CUSTOMER']]) {
      const f = fixture(); Object.assign(f.booking, recordedContact()); f.setStaffPermissions([]);
      const snapshotRead = jest.fn(() => 'Recorded booking guest'); Object.defineProperty(f.booking, 'contactName', { enumerable: true, configurable: true, get: snapshotRead });
      await expect(f.service.getBooking('100', actor, role)).rejects.toThrow(NotFoundException);
      expect(snapshotRead).not.toHaveBeenCalled(); expect(f.contactCalls()).toEqual([]);
      expect(f.db.therapist.findMany).not.toHaveBeenCalled(); expect(f.db.shopRoom.findMany).not.toHaveBeenCalled();
    }
  });

  test('a corrupt versioned contact is marked unavailable and cannot be replaced with current account name or phone', async () => {
    for (const patch of [{ contactPhone: null }, { contactEmailVerifiedAt: null }, { contactVersion: 2 }, { contactVersion: null }, { contactVersion: undefined }, { contactSource: null }]) {
      const f = fixture(); Object.assign(f.booking, recordedContact(), patch);
      const result: any = await f.service.getBooking('100', '1', 'ADMIN');
      expect(result.contact).toEqual({ recorded: false, version: null, label: 'Historical booking has no recorded contact' });
      expect(result.reception.customer).toBeNull(); expect(f.contactCalls()).toEqual([]);
    }
  });

  test.each([['ADMIN', '1'], ['MERCHANT', '2'], ['STAFF', '3']])('authorized %s detail includes exactly the customer and actually assigned resource labels', async (role, actor) => {
    const f = fixture(), before = structuredClone(f.booking), result: any = await f.service.getBooking('100', actor, role);
    expect(result.reception).toEqual({ customer: { name: 'Guest', phone: '+1 555 0100' }, therapists: [{ id: '30', name: 'Alice' }, { id: '31', name: 'Bob' }], rooms: [{ id: '40', name: 'Historical room' }] });
    expect(result.items[0].assignedTherapistIds).toEqual(['30', '31']);
    expect(f.contactCalls()).toHaveLength(1);
    expect(f.contactCalls()[0][0]).toEqual({ where: { id: 5n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null }, select: { name: true, phone: true } });
    expect(f.db.therapist.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.therapist.findMany).toHaveBeenCalledWith({ where: { shopId: 10n, id: { in: [30n, 31n] } }, select: { id: true, name: true } });
    expect(f.db.shopRoom.findMany).toHaveBeenCalledWith({ where: { shopId: 10n, id: { in: [40n] } }, select: { id: true, name: true } });
    expect(f.db.booking.findUnique.mock.calls[0][0].include.user).toBeUndefined();
    expect(JSON.stringify(result.reception)).not.toContain('HIDDEN');
    expect(f.booking).toEqual(before);
  });

  test('denied roles, foreign merchants and missing BOOKINGS_READ never trigger contact or resource resolution', async () => {
    for (const [actor, role] of [['4', 'MERCHANT'], ['3', 'STAFF'], ['2', 'ADMIN'], ['6', 'CUSTOMER'], ['1', 'UNKNOWN']]) {
      const f = fixture(); f.setStaffPermissions([]);
      await expect(f.service.getBooking('100', actor, role)).rejects.toThrow(NotFoundException);
      expect(f.contactCalls()).toEqual([]); expect(f.db.therapist.findMany).not.toHaveBeenCalled(); expect(f.db.shopRoom.findMany).not.toHaveBeenCalled();
    }
    const f = fixture(); f.booking.deletedAt = at('11:00');
    await expect(f.service.getBooking('100', '1', 'ADMIN')).rejects.toThrow(NotFoundException);
    expect(f.db.user.findFirst).not.toHaveBeenCalled();
  });

  test('own customer detail and list retain their ordinary projection without any reception lookups', async () => {
    const f = fixture(), detail: any = await f.service.getBooking('100', '5'), list: any = await f.service.listUserBookings('5', { page: '1' });
    expect(detail).not.toHaveProperty('reception'); expect(list.items[0]).not.toHaveProperty('reception');
    expect(detail).not.toHaveProperty('user'); expect(list.items[0]).not.toHaveProperty('user');
    expect(f.db.user.findFirst).not.toHaveBeenCalled(); expect(f.db.therapist.findMany).not.toHaveBeenCalled(); expect(f.db.shopRoom.findMany).not.toHaveBeenCalled();
  });

  test('a customer create replay does not inherit manager detail enrichment', async () => {
    const f = fixture(); jest.spyOn(f.service as any, 'replay').mockResolvedValue(f.booking);
    const result: any = await f.service.createBooking({ userId: '5', shopId: '10', serviceId: '20', date: '2035-01-01', startTime: '09:00', requestKey: 'synthetic-reception-replay' });
    expect(result).not.toHaveProperty('reception'); expect(result).not.toHaveProperty('user');
    expect(f.db.user.findFirst).not.toHaveBeenCalled(); expect(f.db.therapist.findMany).not.toHaveBeenCalled(); expect(f.db.shopRoom.findMany).not.toHaveBeenCalled();
  });

  test('batch resolution retains exact large IDs, inactive history and foreign/dangling null labels', async () => {
    const f = fixture(), large = '9007199254740993';
    f.therapists.push({ id: BigInt(large), shopId: 10n, name: 'Exact large ID', isActive: false });
    const serialized = { items: Array.from({ length: 12 }, () => ({ assignedTherapistIds: ['30', '31', '99', '404', large], assignedRoomId: '40' })), therapistId: '70' };
    serialized.items.push({ assignedTherapistIds: [], assignedRoomId: '99' }, { assignedTherapistIds: [], assignedRoomId: '405' });
    const result = await bookingReception(f.db, f.booking, serialized);
    expect(result.therapists).toEqual([{ id: '30', name: 'Alice' }, { id: '31', name: 'Bob' }, { id: '99', name: null }, { id: '404', name: null }, { id: large, name: 'Exact large ID' }]);
    expect(result.rooms).toEqual([{ id: '40', name: 'Historical room' }, { id: '99', name: null }, { id: '405', name: null }]);
    expect(f.db.therapist.findMany).toHaveBeenCalledTimes(1); expect(f.db.shopRoom.findMany).toHaveBeenCalledTimes(1); expect(f.contactCalls()).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('HIDDEN');
  });

  test('item assignments exclude a stale top-level technician; only bookings without items retain the legacy fallback', async () => {
    const f = fixture(); f.booking.therapistId = 70n;
    const current: any = await f.service.getBooking('100', '1', 'ADMIN');
    expect(current.reception.therapists).toEqual([{ id: '30', name: 'Alice' }, { id: '31', name: 'Bob' }]);
    expect(f.db.therapist.findMany.mock.calls[0][0].where.id.in).toEqual([30n, 31n]);
    f.booking.items = [];
    const legacy: any = await f.service.getBooking('100', '1', 'ADMIN');
    expect(legacy.reception.therapists).toEqual([{ id: '70', name: 'Legacy technician' }]);
    expect(f.db.therapist.findMany.mock.calls[1][0].where.id.in).toEqual([70n]);
  });

  test('inactive, deleted, missing and non-customer contacts are null; absent active contact fields stay null', async () => {
    for (const change of [{ status: 'SUSPENDED' }, { status: 'DELETED' }, { deletedAt: at('11:00') }, { role: 'MERCHANT' }]) {
      const f = fixture(); Object.assign(f.users[4], change);
      const result: any = await f.service.getBooking('100', '1', 'ADMIN');
      expect(result.reception.customer).toBeNull(); expect(result.reception.therapists).toHaveLength(2);
    }
    const f = fixture(); f.users.splice(4, 1);
    expect((await bookingReception(f.db, f.booking, { items: [] })).customer).toBeNull();
    expect(f.db.therapist.findMany).not.toHaveBeenCalled(); expect(f.db.shopRoom.findMany).not.toHaveBeenCalled();
    const empty = fixture(); Object.assign(empty.users[4], { name: null, phone: '' });
    expect((await bookingReception(empty.db, empty.booking, { items: [] })).customer).toEqual({ name: null, phone: null });
  });
});

describe('historical room assignment projection without lock mutations', () => {
  test('stored room wins over active or later historical locks, including a foreign stored ID', () => {
    const f = fixture(); f.booking.resourceLocks.push({ ...f.lock(204n, 'ROOM', 99n, '10:10'), createdAt: at('08:30') });
    expect(bookingItemRoomId(f.booking, f.item)).toBe('40');
    f.item.assignedRoomId = 99n;
    expect(bookingItemRoomId(f.booking, f.item)).toBe('99');
  });

  test('cancelled same-time reschedule uses the latest released room and ignores foreign, other-item and wrong-window locks', async () => {
    const f = fixture(); f.item.assignedRoomId = null; f.booking.status = 'CANCELLED';
    f.booking.resourceLocks.forEach((row: any) => { row.status = 'RELEASED'; });
    f.rooms.push({ id: 41n, shopId: 10n, name: 'Latest room', isActive: false });
    const latest = { ...f.lock(204n, 'ROOM', 41n, '10:10'), status: 'RELEASED', createdAt: at('08:30') };
    f.booking.resourceLocks.push(latest,
      { ...latest, id: 205n, resourceId: 99n, shopId: 11n }, { ...latest, id: 206n, resourceId: 99n, bookingId: 101n },
      { ...latest, id: 207n, resourceId: 99n, bookingItemId: 1001n }, { ...latest, id: 208n, resourceId: 99n, startAtUtc: at('09:30') },
      { ...latest, id: 209n, resourceId: 99n, endAtUtc: at('10:00') });
    const before = structuredClone(f.booking), result: any = await f.service.getBooking('100', '1', 'ADMIN');
    expect(result.items[0].assignedRoomId).toBe('41'); expect(result.reception.rooms).toEqual([{ id: '41', name: 'Latest room' }]);
    expect(f.booking).toEqual(before);
  });

  test('current active assignment beats released history; equal creation times use the latest lock ID', () => {
    const f = fixture(); f.item.assignedRoomId = null;
    f.booking.resourceLocks.push({ ...f.lock(204n, 'ROOM', 41n, '10:10'), status: 'RELEASED', createdAt: at('08:30') });
    expect(bookingItemRoomId(f.booking, f.item)).toBe('40');
    f.booking.resourceLocks.forEach((row: any) => { row.status = 'RELEASED'; row.createdAt = at('08:00'); });
    expect(bookingItemRoomId(f.booking, f.item)).toBe('41');
    f.booking.resourceLocks = [];
    expect(bookingItemRoomId(f.booking, f.item)).toBeNull();
  });

  test('ambiguous simultaneous legacy PLAN rooms stay unknown unless a lock identifies this item', () => {
    const f = fixture(); f.booking.reservationKind = 'PLAN'; f.item.assignedRoomId = null;
    f.booking.items.push({ ...f.item, id: 1001n, participantIndex: 2 });
    expect(bookingItemRoomId(f.booking, f.item)).toBeNull();
    f.booking.resourceLocks.push({ ...f.lock(204n, 'ROOM', 41n, '10:10'), bookingItemId: 1000n });
    expect(bookingItemRoomId(f.booking, f.item)).toBe('41');
    expect(bookingItemRoomId(f.booking, f.booking.items[1])).toBeNull();
  });
});
