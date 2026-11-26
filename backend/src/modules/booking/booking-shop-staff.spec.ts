jest.mock('../../common/notification-outbox', () => ({ enqueueNotification: jest.fn(async () => {}), syncBookingReminder: jest.fn(async () => {}) }));
jest.mock('../auth/security', () => ({ jwtSecret: () => 'Synthetic-staff-pool-quote-key-2035-0123456789abcdef' }));
import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { MerchantService } from '../merchant/merchant.service';
import { ReservationsService } from '../reservations/reservations.service';
import { StudioService } from '../studio/studio.service';

const date = '2035-01-01', at = (time: string, day = date) => new Date(day + 'T' + time + ':00Z');
const syntheticPasswordHash = '$2b$10$' + 'a'.repeat(53);
const serviceRow = (id: bigint, extra: any = {}) => ({ id, shopId: 10n, name: 'Synthetic service ' + id, isActive: true, durationKind: 'TIMED',
  durationMin: 60, priceCents: 13057, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null,
  staffBufferMin: 0, roomBufferMin: 0, variants: [], addOns: [], ...extra });
// Keep Prisma-like Date instances in Jest's realm while preserving staged rollback.
function cloneFixture<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => cloneFixture(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneFixture(item)])) as T;
  return value;
}

function fixture(periods?: Array<{ open: string; close: string }>) {
  const shop = { id: 10n, ownerId: 2n, deletedAt: null, status: 'APPROVED', name: 'Synthetic shop', timezone: 'UTC',
    businessHours: Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, periods ?? { open: '09:00', close: '18:00' }])),
    studioProfile: { features: { onlineBooking: true }, paymentPolicy: { payAtStoreEnabled: true } },
    loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: syntheticPasswordHash } } };
  let state: any = { services: [serviceRow(20n), serviceRow(21n)], staff: [30n, 31n].map(id => ({ id, shopId: 10n, name: 'Synthetic technician ' + id, isActive: true, scheduleMode: 'SHOP', shifts: [], timeOff: [], therapistServices: [] })),
    rooms: [{ id: 40n, shopId: 10n, name: 'Synthetic room', isActive: true, roomType: 'SINGLE', capacity: 1, maintenance: [] }], bookings: [], items: [], locks: [], mappings: [] };
  const staffQueries: any[] = [], mappingWrites: string[] = [];
  function client(data: any): any {
    const detail = (row: any) => row && ({ ...row, shop, service: data.services.find((service: any) => service.id === row.serviceId),
      items: data.items.filter((item: any) => item.bookingId === row.id), addOns: [], resourceLocks: data.locks.filter((lock: any) => lock.bookingId === row.id) });
    const staff = (where: any) => data.staff.filter((row: any) => (where.shopId === undefined || row.shopId === where.shopId) && (where.id === undefined || row.id === where.id)
      && (where.isActive === undefined || row.isActive === where.isActive) && (!where.therapistServices || data.mappings.some((link: any) => link.therapistId === row.id && link.serviceId === where.therapistServices.some.serviceId)));
    return {
      $queryRaw: async () => [], user: { findFirst: async () => ({ id: 2n }),
        findUnique: async () => ({ id: 5n, role: 'CUSTOMER', email: 'synthetic.staffpool@example.test', emailVerifiedAt: new Date('2035-01-01T00:00:00Z'), status: 'ACTIVE', deletedAt: null }) },
      shop: { findUnique: async () => shop, findFirst: async ({ where }: any) => where.id === shop.id ? shop : null },
      shopAccountGrant: { findFirst: async () => null },
      shopService: {
        findUnique: async ({ where }: any) => data.services.find((row: any) => row.id === where.id),
        findFirst: async ({ where }: any) => data.services.find((row: any) => row.id === where.id && (where.shopId === undefined || row.shopId === where.shopId)),
        findMany: async ({ where }: any) => data.services.filter((row: any) => row.shopId === where.shopId && (!where.id || where.id.in.includes(row.id))),
        create: async ({ data: input }: any) => { const row = serviceRow(BigInt(20 + data.services.length), input); data.services.push(row); return row; },
      },
      therapist: {
        findMany: async ({ where }: any) => { staffQueries.push(where); return staff(where); },
        findUnique: async ({ where }: any) => data.staff.find((row: any) => row.id === where.id),
        findUniqueOrThrow: async ({ where }: any) => data.staff.find((row: any) => row.id === where.id),
        findFirst: async ({ where }: any) => staff(where)[0] ?? null,
        create: async ({ data: input }: any) => { const row = { id: BigInt(30 + data.staff.length), shopId: 10n, name: 'Synthetic new technician', isActive: true, scheduleMode: 'SHOP', shifts: [], timeOff: [], therapistServices: [], ...input }; data.staff.push(row); return row; },
        update: async ({ where, data: patch }: any) => { const row = data.staff.find((row: any) => row.id === where.id); Object.assign(row, patch); return row; },
      },
      therapistService: {
        findMany: async () => { throw Error('Booking policy must not read legacy mappings'); },
        createMany: async ({ data: rows }: any) => { mappingWrites.push('create'); data.mappings.push(...rows); return { count: rows.length }; },
        deleteMany: async ({ where }: any) => { mappingWrites.push('delete'); data.mappings = data.mappings.filter((row: any) => row.therapistId !== where.therapistId); return { count: 0 }; },
      },
      shopRoom: { findMany: async ({ where }: any) => data.rooms.filter((row: any) => row.shopId === where.shopId && (where.isActive === undefined || row.isActive === where.isActive)
        && (!where.roomType || row.roomType === where.roomType) && (!where.capacity || row.capacity >= where.capacity.gte)) },
      booking: {
        findMany: async ({ where }: any) => where.holdExpiresAt ? [] : where.items?.none ? data.bookings.filter((row: any) => !data.items.some((item: any) => item.bookingId === row.id)) : data.bookings,
        findFirst: async () => null,
        findUnique: async ({ where, select }: any) => { const row = where.userId_requestKey ? data.bookings.find((row: any) => row.userId === where.userId_requestKey.userId && row.requestKey === where.userId_requestKey.requestKey) : data.bookings.find((row: any) => row.id === where.id); return select && row ? { shopId: row.shopId } : detail(row); },
        findUniqueOrThrow: async ({ where }: any) => detail(data.bookings.find((row: any) => row.id === where.id)),
        create: async ({ data: input }: any) => { const row = { id: BigInt(100 + data.bookings.length), status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, refundedCents: 0, reservationKind: 'SINGLE', deletedAt: null, ...input }; data.bookings.push(row); return row; },
        update: async ({ where, data: patch }: any) => { const row = data.bookings.find((row: any) => row.id === where.id); Object.assign(row, patch); return detail(row); },
      },
      bookingItem: {
        create: async ({ data: input }: any) => { const row = { id: BigInt(1000 + data.items.length), sequence: 1, offsetMin: 0, ...input }; data.items.push(row); return row; },
        update: async ({ where, data: patch }: any) => { const row = data.items.find((row: any) => row.id === where.id); Object.assign(row, patch); return row; },
      },
      shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: {
        findMany: async ({ where }: any) => data.locks.filter((row: any) => row.shopId === where.shopId && row.status === 'ACTIVE' && (!where.bookingId || row.bookingId !== where.bookingId.not)
          && (!where.resourceId || row.resourceId === where.resourceId) && (!where.resourceType || row.resourceType === where.resourceType)),
        updateMany: async ({ where, data: patch }: any) => { for (const row of data.locks) if (row.bookingId === where.bookingId && row.status === 'ACTIVE') Object.assign(row, patch); return { count: 0 }; },
        createMany: async ({ data: rows }: any) => { for (const row of rows) data.locks.push({ id: BigInt(1 + data.locks.length), createdAt: new Date(), ...row }); return { count: rows.length }; },
      },
      refundRequest: { findFirst: async () => null }, auditLog: { create: async () => ({}) },
    };
  }
  const db: any = new Proxy({}, { get: (_target, key) => key === '$transaction' ? async (work: any) => {
    const staged = cloneFixture(state); const result = await work(client(staged)); state = staged; return result;
  } : client(state)[key] });
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  jest.spyOn(service as any, 'notifyBooking').mockResolvedValue(undefined);
  const command = (serviceId = '20', key = 'synthetic-shop-pool-one') => ({ userId: '5', shopId: '10', serviceId, date, startTime: '09:00', paymentMode: 'PAY_AT_STORE' as const, requestKey: key, contact: { name: 'Synthetic customer', phone: '+12025550100', email: 'synthetic.staffpool@example.test' } });
  const createQuoted = async (input: any) => { const quote = await service.quoteBooking(input); return service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }); };
  const createPlanQuoted = async (input: any) => { const quote = await service.quotePlan(input); return service.createPlan({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }); };
  return { db, service, createQuoted, createPlanQuoted, merchant: new MerchantService(db, {} as any), state: () => state, staffQueries, mappingWrites, command };
}

describe('all-shop staff admission across actual booking lifecycle methods', () => {
  test.each([[1, 1], [2, 2], [1, 2]])('continuous adjoining opening periods allow a complete service, creation and snapshot move (%i guests / %i staff)', async (participantCount, requiredStaffCount) => {
    const f = fixture([{ open: '09:00', close: '12:15' }, { open: '12:15', close: '18:00' }]);
    Object.assign(f.state().services[0], { participantCount, requiredStaffCount });
    const input = { ...f.command(), startTime: '11:30' };
    const slots = (await f.service.getAvailableSlots(input)).slots;
    expect(slots.find(row => row.time === '11:30')?.available).toBe(true);
    // Preserve each saved period's original grid as well as starts crossing
    // their continuous boundary; merging periods must not discard 12:15.
    expect(slots.find(row => row.time === '12:15')?.available).toBe(true);
    const saved = await f.createQuoted(input);
    expect(saved.localEndTime).toBe('12:30');
    expect(new Set(saved.items.flatMap((row: any) => row.assignedTherapistIds)).size).toBe(requiredStaffCount);
    expect(saved.totalCents).toBe(13057);
    expect((await f.service.getRescheduleSlots(saved.id, '5', 'CUSTOMER', '2035-01-02')).slots.find(row => row.time === '11:30')?.available).toBe(true);
    const moved = await f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '11:30' });
    expect(moved).toMatchObject({ localDate: '2035-01-02', localStartTime: '11:30', localEndTime: '12:30', participantCount, requiredStaffCount });
    expect(f.state().locks.filter((row: any) => row.status === 'ACTIVE' && row.resourceType === 'THERAPIST')).toHaveLength(requiredStaffCount);
  });

  test('multi-service creation and move use the same continuous-opening coverage for each segment', async () => {
    const f = fixture([{ open: '09:00', close: '12:15' }, { open: '12:15', close: '18:00' }]);
    const input = { ...f.command(), userId: '5', shopId: '10', date, startTime: '11:30', requestKey: 'synthetic-adjoining-plan', paymentMode: 'PAY_AT_STORE',
      items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '21' }] };
    expect((await f.service.getPlanSlots(input)).slots.find(row => row.time === '11:30')?.available).toBe(true);
    const saved = await f.createPlanQuoted(input);
    expect(saved).toMatchObject({ localStartTime: '11:30', localEndTime: '13:30', totalCents: 26114 });
    const moved = await f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '11:30' });
    expect(moved).toMatchObject({ localDate: '2035-01-02', localStartTime: '11:30', localEndTime: '13:30' });
    expect(moved.items.map((row: any) => row.localStartTime)).toEqual(['2035-01-02T11:30', '2035-01-02T12:30']);
  });

  test('a real lunch closure and the final closing time still reject quotes, submissions and moves without releasing the existing booking', async () => {
    const f = fixture([{ open: '09:00', close: '12:00' }, { open: '12:15', close: '18:00' }]);
    const saved = await f.createQuoted({ ...f.command(), startTime: '10:00' }), before = cloneFixture(f.state());
    const slots = (await f.service.getAvailableSlots(f.command())).slots;
    expect(slots.find(row => row.time === '11:30')?.available ?? false).toBe(false);
    expect(slots.find(row => row.time === '17:45')?.available ?? false).toBe(false);
    for (const startTime of ['11:30', '17:45']) {
      const input = { ...f.command('20', 'synthetic-closed-' + startTime.replace(':', '')), startTime };
      await expect(f.service.quoteBooking(input)).rejects.toThrow('outside available business hours');
      await expect(f.service.createBooking(input)).rejects.toThrow('outside available business hours');
      await expect(f.service.rescheduleBooking(saved.id, '5', { date, startTime })).rejects.toThrow('outside available business hours');
    }
    expect(f.state()).toEqual(before);
  });

  test('ordinary services reserve any same-shop active calendar without mappings and new services/staff apply immediately', async () => {
    const f = fixture(); f.state().staff = f.state().staff.slice(0, 1);
    expect((await f.service.getAvailableSlots({ shopId: '10', serviceId: '20', date })).slots.find(row => row.time === '09:00')?.available).toBe(true);
    const created = await f.merchant.createShopService('2', '10', { name: 'Synthetic newly saved service', category: 'MASSAGE', durationMin: 60, priceCents: 5500 });
    const first = await f.createQuoted(f.command(String(created.id)));
    expect(first.items[0].assignedTherapistIds).toEqual(['30']);
    const next = await f.merchant.createTherapist('2', '10', { name: 'Synthetic new staff with no mapping' });
    expect(next).toMatchObject({ serviceAccessMode: 'SHOP_ALL', serviceIds: [] });
    const second = await f.createQuoted(f.command('21', 'synthetic-shop-pool-two'));
    expect(second.items[0].assignedTherapistIds).toEqual([String(next.id)]);
    expect(f.state().mappings).toEqual([]); expect(f.mappingWrites).toEqual([]);
    expect(f.staffQueries.every(where => where.shopId === 10n && where.isActive === true && where.therapistServices === undefined)).toBe(true);
  });

  test.each([{ participantCount: 1, requiredStaffCount: 2, requiredRoomType: 'SINGLE' }, { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' }, { participantCount: 1, requiredStaffCount: 2, requiredRoomType: null }, { participantCount: 2, requiredStaffCount: 2, requiredRoomType: null }])('special package occupies two distinct calendars simultaneously and conflicts across the whole shop pool (%p)', async policy => {
    const f = fixture(); Object.assign(f.state().services[0], policy); Object.assign(f.state().rooms[0], { roomType: policy.requiredRoomType, capacity: policy.participantCount });
    if (!policy.requiredRoomType) f.state().rooms = [];
    const first = await f.createQuoted(f.command());
    expect(first.items).toHaveLength(policy.participantCount); expect(first.totalCents).toBe(13057);
    const locks = f.state().locks.filter((row: any) => row.resourceType === 'THERAPIST' && row.status === 'ACTIVE');
    expect(new Set(locks.map((row: any) => row.resourceId))).toEqual(new Set([30n, 31n]));
    expect(locks.every((row: any) => +row.startAtUtc === +at('09:00') && +row.endAtUtc === +at('10:00'))).toBe(true);
    expect(f.state().locks.filter((row: any) => row.resourceType === 'ROOM' && row.status === 'ACTIVE')).toHaveLength(policy.requiredRoomType ? 1 : 0);
    if (policy.participantCount === 1) expect(new Set(locks.map((row: any) => row.bookingItemId)).size).toBe(1);
    await expect(f.service.createBooking(f.command('21', 'synthetic-other-service-conflict'))).rejects.toThrow(ConflictException);
    expect(f.state().bookings).toHaveLength(1);
    const moved = await f.service.rescheduleBooking(first.id, '5', { date, startTime: '11:00' });
    expect(new Set(moved.items.flatMap((row: any) => row.assignedTherapistIds))).toEqual(new Set(['30', '31']));
    expect(f.state().locks.filter((row: any) => row.resourceType === 'THERAPIST' && row.status === 'RELEASED')).toHaveLength(2);
    if (!policy.requiredRoomType) {
      expect(f.state().rooms).toEqual([]);
      expect(f.state().locks.some((row: any) => row.resourceType === 'ROOM')).toBe(false);
      expect(moved.items.every((row: any) => row.assignedRoomId === null)).toBe(true);
    }
  });

  test.each([{ participantCount: 1, requiredRoomType: 'SINGLE' }, { participantCount: 2, requiredRoomType: 'COUPLE' }, { participantCount: 1, requiredRoomType: null }, { participantCount: 2, requiredRoomType: null }])('one active same-shop technician cannot satisfy a two-staff package (%p)', async policy => {
    const f = fixture(); Object.assign(f.state().services[0], policy, { requiredStaffCount: 2 }); Object.assign(f.state().rooms[0], { roomType: policy.requiredRoomType, capacity: policy.participantCount });
    f.state().staff[1].isActive = false; f.state().staff.push({ ...f.state().staff[0], id: 99n, shopId: 11n });
    expect((await f.service.getAvailableSlots({ shopId: '10', serviceId: '20', date })).slots.every(row => !row.available)).toBe(true);
    await expect(f.service.createBooking(f.command())).rejects.toThrow(ConflictException);
    for (const therapistId of ['31', '99']) await expect(f.service.getAvailableSlots({ shopId: '10', serviceId: '20', therapistId, date })).rejects.toThrow(BadRequestException);
    expect(f.state().bookings).toEqual([]); expect(f.state().locks).toEqual([]);
  });

  test('two calendars still need common coverage including leave and buffer, not merely two active staff rows', async () => {
    const f = fixture(); Object.assign(f.state().services[0], { requiredStaffCount: 2 });
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    f.state().staff.forEach((row: any, index: number) => Object.assign(row, { scheduleMode: 'CUSTOM', shifts: [{ weekday, startMin: index ? 600 : 540, endMin: index ? 660 : 600, isActive: true }] }));
    expect((await f.service.getAvailableSlots({ shopId: '10', serviceId: '20', date })).slots.every(row => !row.available)).toBe(true);
    f.state().staff[1].shifts = [{ weekday, startMin: 540, endMin: 600, isActive: true }]; f.state().services[0].staffBufferMin = 15;
    expect((await f.service.getAvailableSlots({ shopId: '10', serviceId: '20', date })).slots.every(row => !row.available)).toBe(true);
    f.state().staff.forEach((row: any) => { row.scheduleMode = 'SHOP'; row.timeOff = [{ startAtUtc: at('09:00'), endAtUtc: at('18:00') }]; });
    await expect(f.service.createBooking(f.command())).rejects.toThrow(ConflictException);
  });

  test('PLAN creation and reschedule share the shop pool and cannot allocate one calendar to simultaneous participants', async () => {
    const f = fixture(), items = [{ participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 2, sequence: 1, serviceId: '21' }];
    const plan = { shopId: '10', date, items };
    expect((await f.service.getPlanSlots(plan)).slots.find(row => row.time === '09:00')?.available).toBe(true);
    const saved = await f.createPlanQuoted({ ...f.command(), ...plan, userId: '5', startTime: '09:00', requestKey: 'synthetic-shop-pool-plan', paymentMode: 'PAY_AT_STORE' });
    expect(new Set(saved.items.flatMap((row: any) => row.assignedTherapistIds))).toEqual(new Set(['30', '31']));
    const moved = await f.service.rescheduleBooking(saved.id, '5', { date, startTime: '12:00' });
    expect(new Set(moved.items.flatMap((row: any) => row.assignedTherapistIds))).toEqual(new Set(['30', '31']));
    const one = fixture(); one.state().staff.splice(1, 1);
    expect((await one.service.getPlanSlots(plan)).slots.every(row => !row.available)).toBe(true);
  });

  test('legacy mappings remain same-shop validated but clearing them cannot invalidate an occupied technician', async () => {
    const f = fixture(); await f.createQuoted(f.command());
    const cleared = await f.merchant.updateTherapist('2', '30', { serviceIds: [] });
    expect(cleared.serviceIds).toEqual([]); expect(cleared.serviceAccessMode).toBe('SHOP_ALL');
    await expect(f.merchant.updateTherapist('2', '30', { serviceIds: ['999'] })).rejects.toThrow('belong to this shop');
    await expect(f.merchant.updateTherapist('2', '30', { isActive: false })).rejects.toThrow(ConflictException);
    expect(f.state().staff[0].isActive).toBe(true);
  });

  test('reservation and company technician projections explicitly mark shop-wide access without manufacturing links', async () => {
    const f = fixture(), config: any = await new ReservationsService(f.db).config('10', { id: '2', role: 'MERCHANT' });
    expect(config.serviceAccessMode).toBe('SHOP_ALL');
    expect(config.therapists.every((row: any) => row.serviceAccessMode === 'SHOP_ALL' && row.serviceIds.length === 0)).toBe(true);
    const studio = new StudioService(f.db) as any;
    expect(studio.map('technicians', f.state().staff[0])).toMatchObject({ serviceAccessMode: 'SHOP_ALL', serviceIds: [] });
    expect(f.state().mappings).toEqual([]); expect(f.mappingWrites).toEqual([]);
  });
});
