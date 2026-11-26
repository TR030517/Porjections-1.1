jest.mock('../../common/notification-outbox', () => ({ enqueueNotification: jest.fn(async () => {}), enqueueBookingOrderEmail: jest.fn(async () => {}), syncBookingReminder: jest.fn(async () => {}) }));
jest.mock('../auth/security', () => ({ jwtSecret: () => 'Synthetic-guest-quote-key-2035-0123456789abcdef' }));
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { enqueueNotification, enqueueBookingOrderEmail } from '../../common/notification-outbox';

const date = '2035-01-01', key = '69ebd4c7-8059-45ab-848e-1a00bca369a9';
const actor = { id: '2', role: 'MERCHANT' };
const at = (time: string) => new Date(`${date}T${time}:00Z`);
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(+value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}
/** Staged rollback exercises the real shared context, price signature and
 * allocation. Physical row locks/concurrency are covered by the SQL harness. */
function fixture() {
  const shop: any = { id: 10n, status: 'APPROVED', deletedAt: null, timezone: 'UTC',
    loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } },
    businessHours: Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(d => [d, { open: '09:00', close: '22:00' }])),
    studioProfile: { paymentPolicy: { payAtStoreEnabled: false }, features: { onlineBooking: false } } };
  const product: any = { id: 20n, shopId: 10n, name: 'Four hands', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 10001,
    priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 2, requiredRoomType: 'SINGLE', staffBufferMin: 15, roomBufferMin: 10, variants: [] };
  let state: any = { bookings: [], items: [], locks: [], operations: [], audits: [], blocks: [] }, activeOperator = true;
  let staffPermissions = ['BOOKINGS_READ'];
  const staff = [30n, 31n].map(id => ({ id, name: `Therapist ${id}`, shopId: 10n, isActive: true, scheduleMode: 'SHOP', shifts: [], timeOff: [] as any[] }));
  const queries: string[] = [];
  const accountLookup = jest.fn(async () => { throw new Error('Guest must not find or link a customer account'); });
  const userCreate = jest.fn(async () => { throw new Error('Guest must not create an account'); });
  const client = (s: any): any => ({
    $queryRaw: async (sql: any) => { queries.push(sql.sql.includes('FROM shops') ? 'shop-lock' : 'user-lock'); return []; },
    user: { findFirst: async ({ where }: any) => activeOperator && (where.role === 'MERCHANT' && where.id === 2n || where.role === 'STAFF' && where.id === 3n) ? { id: where.id } : null, findUnique: accountLookup, create: userCreate },
    shop: { findFirst: async ({ where }: any) => where.id === shop.id ? shop : null, findUnique: async () => shop },
    shopAccountGrant: { findFirst: async () => null },
    shopStaffGrant: { findUnique: async () => ({ status: 'ACTIVE', permissions: staffPermissions }) },
    shopService: { findUnique: async ({ where }: any) => where.id === 20n ? product : null },
    therapist: { findMany: async () => staff },
    shopRoom: { findMany: async () => [{ id: 40n, maintenance: [] }] },
    shopCalendarBlock: { findMany: async () => s.blocks },
    booking: {
      findMany: async ({ where }: any) => where.holdExpiresAt || where.items ? [] : s.bookings,
      findUnique: async ({ where }: any) => s.bookings.find((b: any) => b.id === where.id),
      create: async ({ data }: any) => { const b = { id: BigInt(s.bookings.length + 100), paidCents: 0, refundedCents: 0, deletedAt: null, ...data }; s.bookings.push(b); return b; },
    },
    bookingItem: { create: async ({ data }: any) => { const item = { id: BigInt(s.items.length + 1000), sequence: 1, offsetMin: 0, ...data }; s.items.push(item); return item; } },
    bookingResourceLock: {
      findMany: async () => s.locks.filter((l: any) => l.status === 'ACTIVE'),
      createMany: async ({ data }: any) => { s.locks.push(...data); return { count: data.length }; },
      updateMany: async () => ({ count: 0 }),
    },
    guestBookingOperation: {
      findUnique: async ({ where }: any) => { const w = where.shopId_operatorId_requestKey; return s.operations.find((o: any) => o.shopId === w.shopId && o.operatorId === w.operatorId && o.requestKey === w.requestKey) ?? null; },
      create: async ({ data }: any) => { const o = { id: BigInt(s.operations.length + 1), ...data }; s.operations.push(o); return o; },
    },
    auditLog: { create: async ({ data }: any) => { s.audits.push(data); return data; } },
  });
  const db: any = new Proxy({}, { get: (_target, prop) => prop === '$transaction' ? async (work: any) => {
    const staged = clone(state), result = await work(client(staged)); state = staged; return result;
  } : client(state)[prop] });
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  const command = (patch: any = {}) => ({ shopId: '10', serviceId: '20', date, startTime: '10:00', guestSource: 'PHONE' as const,
    contact: { name: ' Synthetic guest ', phone: '+1 (202) 555-0100', email: 'SAME.AS.ACCOUNT@example.test' }, preferredTherapistIds: ['30', '31'], ...patch });
  const quoted = async (patch: any = {}) => { const c = command(patch), q = await service.quoteGuestAssistedBooking(actor, c); return { ...c, requestKey: key, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt }; };
  return { service, db, shop, product, staff, queries, accountLookup, userCreate, command, quoted, state: () => state,
    setStaffPermissions: (permissions: string[]) => { staffPermissions = permissions; },
    disableOperator: () => { activeOperator = false; } };
}

describe('first-time telephone/walk-in guest assisted bookings', () => {
  beforeEach(() => jest.clearAllMocks());
  test('quotes actual four-hand resources and records a pending offline guest without an account or verification', async () => {
    const f = fixture(), c = f.command();
    const q = await f.service.quoteGuestAssistedBooking(actor, c);
    expect(q).toMatchObject({ paymentMode: 'PAY_AT_STORE', totalCents: 10001, platformFeeCents: 0, discountCents: 0, tipCents: 0,
      durationMin: 60, timezone: 'UTC', localDate: date, localStartTime: '10:00', requestedTherapistIds: ['30', '31'], assignedTherapistIds: ['30', '31'] });
    const receipt = await f.service.createGuestAssistedBooking(actor, { ...c, requestKey: key, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    expect(receipt).toEqual({ shopId: '10', requestKey: key, outcome: 'COMMITTED', result: { bookingId: '100', bookingNo: expect.stringMatching(/^MJ/) } });
    const [b] = f.state().bookings;
    expect(b).toMatchObject({ userId: null, assistedById: 2n, bookingSource: 'ASSISTED_GUEST', guestSource: 'PHONE', contactVersion: 1,
      contactName: 'Synthetic guest', contactPhone: '+12025550100', contactEmail: 'same.as.account@example.test', contactSource: 'GUEST_ASSISTED', contactEmailVerifiedAt: null,
      paymentMode: 'PAY_AT_STORE', status: 'PENDING', paymentStatus: 'UNPAID', holdExpiresAt: null, totalCents: 10001, bookingTimezone: 'UTC' });
    expect(f.state().items).toHaveLength(1);
    expect(f.state().locks).toHaveLength(3);
    expect(f.state().locks.filter((l: any) => l.resourceType === 'THERAPIST')).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: 30n, endAtUtc: at('11:15') }), expect.objectContaining({ resourceId: 31n, endAtUtc: at('11:15') }),
    ]));
    expect(f.accountLookup).not.toHaveBeenCalled(); expect(f.userCreate).not.toHaveBeenCalled();
    expect(enqueueNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: null, topic: 'BOOKING_CREATED' }));
    expect(enqueueBookingOrderEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: null, bookingId: 100n }));
    expect(f.queries[0]).toBe('shop-lock');
    expect(JSON.stringify(f.state().operations, (_k, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('example.test');
    expect(f.state().audits[0].detail).not.toHaveProperty('contact');
  });
  test.each([undefined, null, ''])('email %p is optional and remains unverified', async email => {
    const f = fixture(), c = await f.quoted({ contact: { name: 'Walk-in', phone: '+12025550101', email }, guestSource: 'WALK_IN' });
    await f.service.createGuestAssistedBooking(actor, c);
    expect(f.state().bookings[0]).toMatchObject({ contactEmail: null, contactEmailVerifiedAt: null, guestSource: 'WALK_IN' });
  });
  test.each([
    { guestSource: 'WALK_IN' }, { contact: { name: 'Different guest', phone: '+12025550100', email: 'same.as.account@example.test' } },
    { contact: { name: 'Synthetic guest', phone: '+12025550101', email: 'same.as.account@example.test' } },
    { contact: { name: 'Synthetic guest', phone: '+12025550100', email: 'other@example.test' } },
    { preferredTherapistIds: ['30'] }, { startTime: '11:00' },
  ])('signed quote binds contact, source, selected therapist and actual time %p', async patch => {
    const f = fixture(), c = await f.quoted();
    await expect(f.service.createGuestAssistedBooking(actor, { ...c, ...patch })).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().bookings).toHaveLength(0); expect(f.state().locks).toHaveLength(0); expect(f.state().operations).toHaveLength(0);
  });
  test('requires a fresh signed quote and rolls back before any order when a specified therapist became unavailable', async () => {
    const f = fixture(), c = await f.quoted();
    f.staff[1].timeOff.push({ startAtUtc: at('09:00'), endAtUtc: at('12:00') });
    await expect(f.service.createGuestAssistedBooking(actor, c)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().bookings).toHaveLength(0);
    f.staff[1].timeOff.length = 0;
    await expect(f.service.createGuestAssistedBooking(actor, { ...c, quoteHash: undefined })).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().bookings).toHaveLength(0);
  });
  test('an automatic assignment shown in the quote cannot silently change when another booking takes that therapist', async () => {
    const f = fixture();
    f.staff.push({ ...f.staff[1], id: 32n, name: 'Therapist 32' });
    const c = await f.quoted({ preferredTherapistIds: [] });
    f.state().locks.push({ shopId: 10n, status: 'ACTIVE', resourceType: 'THERAPIST', resourceId: 30n, startAtUtc: at('09:00'), endAtUtc: at('11:15') });
    await expect(f.service.createGuestAssistedBooking(actor, c)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().bookings).toHaveLength(0);
    const fresh = await f.quoted({ preferredTherapistIds: [] });
    await f.service.createGuestAssistedBooking(actor, fresh);
    expect(f.state().bookings[0].therapistId).toBe(31n);
  });
  test('committed replay returns immutable IDs before expiry/resource checks but still rejects another payload', async () => {
    const f = fixture(), c = await f.quoted(), result = await f.service.createGuestAssistedBooking(actor, c);
    f.state().bookings[0].status = 'CANCELLED';
    f.staff.length = 0;
    expect(await f.service.createGuestAssistedBooking(actor, { ...c, quoteHash: '0'.repeat(64), quoteExpiresAt: '2000-01-01T00:00:00.000Z' })).toEqual(result);
    expect(await f.service.guestAssistedBookingOperation(actor, '10', key)).toEqual(result);
    expect(await f.service.reconcileGuestAssistedBookingOperation(actor, '10', key)).toEqual(result);
    await expect(f.service.createGuestAssistedBooking(actor, { ...c, notes: 'different command' })).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().bookings).toHaveLength(1);
  });
  test('NOT_FOUND is only a read; reconcile persists a shop-locked NOT_EXECUTED fence rejecting a late original POST', async () => {
    const f = fixture(), c = await f.quoted();
    expect(await f.service.guestAssistedBookingOperation(actor, '10', key)).toEqual({ shopId: '10', requestKey: key, outcome: 'NOT_FOUND' });
    expect(f.state().operations).toHaveLength(0);
    expect(await f.service.reconcileGuestAssistedBookingOperation(actor, '10', key)).toEqual({ shopId: '10', requestKey: key, outcome: 'NOT_EXECUTED' });
    expect(await f.service.guestAssistedBookingOperation(actor, '10', key)).toEqual({ shopId: '10', requestKey: key, outcome: 'NOT_EXECUTED' });
    await expect(f.service.createGuestAssistedBooking(actor, c)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().bookings).toHaveLength(0);
  });
  test('receipt/fence and create revalidate current operator and binding before revealing or writing anything', async () => {
    const f = fixture(), c = await f.quoted(); await f.service.createGuestAssistedBooking(actor, c);
    f.shop.loginBinding.userId = 9n;
    await expect(f.service.createGuestAssistedBooking(actor, c)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.guestAssistedBookingOperation(actor, '10', key)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.reconcileGuestAssistedBookingOperation(actor, '10', key)).rejects.toBeInstanceOf(ForbiddenException);
    f.shop.loginBinding.userId = 2n; f.disableOperator();
    await expect(f.service.createGuestAssistedBooking(actor, c)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.state().bookings).toHaveLength(1);
  });
  test('customer cannot own, read or delete an unlinked guest even if the contact email belongs to their account', async () => {
    const f = fixture(), c = await f.quoted(); await f.service.createGuestAssistedBooking(actor, c);
    expect(await (f.service as any).allowed(f.db, f.state().bookings[0], '5', 'CUSTOMER')).toBe(false);
    await expect(f.service.getBooking('100', '5', 'CUSTOMER')).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.deleteBooking('100', '5')).rejects.toBeInstanceOf(NotFoundException);
    const serialized = (f.service as any).serialize({ ...f.state().bookings[0], items: f.state().items, addOns: [], shop: f.shop, service: f.product, resourceLocks: f.state().locks });
    expect(serialized.userId).toBeNull(); expect(serialized.assistedById).toBe('2');
    expect(serialized.contact).toMatchObject({ recorded: true, source: 'GUEST_ASSISTED', emailVerifiedAt: null });
  });
  test.each(['customerId', 'userId', 'bookingSource', 'assistedById', 'couponId', 'tipCents', 'paymentMode', 'priceCents'])('direct guest command also forbids account/payment/source authority %s', async field => {
    const f = fixture();
    await expect(f.service.quoteGuestAssistedBooking(actor, f.command({ [field]: '1' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(f.queries).toHaveLength(0);
  });
  test('internal assisted slots work for an offline-only shop without opening public online booking', async () => {
    const f = fixture(), selection = { shopId: '10', serviceId: '20', date, preferredTherapistIds: ['30', '31'] };
    await expect(f.service.getAvailableSlots(selection)).rejects.toThrow('Online booking is unavailable');
    const result = await f.service.getAssistedBookingSlots(actor, selection);
    expect(result).toMatchObject({ date, timezone: 'UTC', durationMin: 60, participantCount: 1, requiredStaffCount: 2 });
    expect(result.slots.find(s => s.time === '10:00')).toEqual({ time: '10:00', available: true });
    expect(f.state().bookings).toHaveLength(0); expect(f.state().operations).toHaveLength(0);
  });
  test('internal slots require current management permission, an approved shop and actual shop/service ownership', async () => {
    const f = fixture(), selection = { shopId: '10', serviceId: '20', date };
    await expect(f.service.getAssistedBookingSlots({ id: '3', role: 'STAFF' }, selection)).rejects.toBeInstanceOf(ForbiddenException);
    f.setStaffPermissions(['BOOKINGS_READ', 'BOOKINGS_MANAGE']);
    await expect(f.service.getAssistedBookingSlots({ id: '3', role: 'STAFF' }, selection)).resolves.toMatchObject({ date });
    await expect(f.service.getAssistedBookingSlots({ id: '5', role: 'CUSTOMER' }, selection)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.getAssistedBookingSlots(actor, { ...selection, shopId: '11' })).rejects.toBeInstanceOf(NotFoundException);
    f.product.shopId = 11n;
    await expect(f.service.getAssistedBookingSlots(actor, selection)).rejects.toBeInstanceOf(BadRequestException);
    f.product.shopId = 10n; f.shop.status = 'PENDING';
    await expect(f.service.getAssistedBookingSlots(actor, selection)).rejects.toBeInstanceOf(BadRequestException);
  });
  test('internal slots use the same SHOP preparation and strictly requested therapist availability as quote/create', async () => {
    const f = fixture(), selection = { shopId: '10', serviceId: '20', date };
    f.state().blocks.push({ startAtUtc: at('11:10'), endAtUtc: at('11:30') });
    const blocked = await f.service.getAssistedBookingSlots(actor, selection);
    expect(blocked.slots.find(s => s.time === '10:00')?.available).toBe(false);
    expect(blocked.slots.find(s => s.time === '11:30')?.available).toBe(true);
    f.state().blocks.length = 0; f.product.requiredStaffCount = 1;
    f.staff[0].timeOff.push({ startAtUtc: at('09:00'), endAtUtc: at('12:00') });
    const automatic = await f.service.getAssistedBookingSlots(actor, selection);
    expect(automatic.slots.find(s => s.time === '10:00')?.available).toBe(true);
    const requested = await f.service.getAssistedBookingSlots(actor, { ...selection, preferredTherapistIds: ['30'] });
    expect(requested.slots.find(s => s.time === '10:00')?.available).toBe(false);
    await expect(f.service.getAssistedBookingSlots(actor, { ...selection, preferredTherapistIds: ['999'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.getAssistedBookingSlots(actor, { ...selection, contact: { name: 'forged' } } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
