jest.mock('../../common/notification-outbox', () => ({ enqueueNotification: jest.fn(async () => {}), enqueueBookingOrderEmail: jest.fn(async () => {}), syncBookingReminder: jest.fn(async () => {}) }));
jest.mock('../auth/security', () => ({ jwtSecret: () => 'Synthetic-order-only-quote-key-2035-0123456789abcdef' }));
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { expireShopHolds } from './lifecycle';
import { settlementActions } from './settlement.rules';
import { CouponsService } from '../coupons/coupons.service';
import { updateCouponInTransaction } from '../coupons/coupon-policy';
import { enqueueNotification, enqueueBookingOrderEmail, syncBookingReminder } from '../../common/notification-outbox';

const date = '2035-01-01', at = (time: string) => new Date(date + 'T' + time + ':00Z');
const onlineContact = () => ({ name: 'Synthetic customer', phone: '+12025550100', email: 'synthetic.customer@example.test' });
const syntheticPasswordHash = '$2b$10$' + 'a'.repeat(53);
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matches(row, part));
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (key === 'booking') return matches(row.booking, value);
    if (key === 'items') return row.items.length === 0;
    if (value === null || typeof value !== 'object' || value instanceof Date) return row[key] === value;
    return Object.entries(value).every(([operator, operand]: [string, any]) => operator === 'in' ? operand.includes(row[key]) : operator === 'not' ? row[key] !== operand
      : operator === 'gt' ? row[key] != null && row[key] > operand : operator === 'lt' ? row[key] < operand : operator === 'lte' ? row[key] != null && row[key] <= operand : false);
  });
}
/** Staged transactions exercise actual context/pricing/allocation/lifecycle.
 * They do not claim physical database concurrency or provider/email delivery. */
// Keep Prisma-like Date instances in Jest's realm while preserving staged rollback.
function cloneFixture<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => cloneFixture(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneFixture(item)])) as T;
  return value;
}

function fixture(participantCount = 1, staffCount = participantCount, options: any = {}) {
  const actorId = BigInt(options.actorId ?? 2), actorRole = options.actorRole ?? 'MERCHANT';
  const boundUserId = BigInt(options.boundUserId ?? actorId);
  const customer = { id: 5n, role: options.customerRole ?? 'CUSTOMER', email: options.customerEmail ?? 'synthetic.customer@example.test',
    emailVerifiedAt: options.customerVerified === false ? null : new Date('2035-01-01T00:00:00Z'), status: options.customerStatus ?? 'ACTIVE', deletedAt: options.customerDeleted ? new Date('2034-01-01T00:00:00Z') : null };
  const sourceShop = { id: 11n, status: 'APPROVED', deletedAt: null,
    loginBinding: { userId: actorId, user: { role: actorRole, status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: syntheticPasswordHash } } };
  let permissions = options.permissions;
  const customerSearchQueries: any[] = [];
  const shop = { id: 10n, name: 'Synthetic order shop', timezone: 'UTC', status: 'APPROVED', deletedAt: null,
    loginBinding: { userId: boundUserId, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: syntheticPasswordHash } },
    businessHours: Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '18:00' }])),
    studioProfile: { features: { onlineBooking: true }, paymentPolicy: { payAtStoreEnabled: false } } };
  let state: any = { customerEmail: customer.email, customer, customerHasHistory: options.customerHasHistory !== false,
    couponWallet: { id: 7n, couponId: 8n, userId: 5n, status: 'UNUSED', bookingId: null }, couponUsedCount: 0,
    bookings: [], items: [], locks: [], audits: [], zeroEntries: [], outbox: [], services: [20n, 21n].map(id => ({ id, shopId: 10n, name: 'Synthetic service ' + id,
    isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: id === 20n ? 20001 : 3003, priceBasis: 'PER_PERSON', participantCount,
    requiredStaffCount: staffCount, requiredRoomType: participantCount === 2 ? 'COUPLE' : 'SINGLE', staffBufferMin: 15, roomBufferMin: 10, variants: [] })) };
  let refundFence = false, beforeCouponLock: (() => Promise<void>) | undefined, beforeShopLock: (() => Promise<void>) | undefined;
  const reservationEvents: string[] = [];
  const couponTerms: any = { id: 8n, shopId: null, title: 'Synthetic platform voucher', description: null, type: 'FIXED_AMOUNT', value: 99999999,
    minSpendCents: 0, totalQuantity: 0, claimedCount: 1, perUserLimit: 1, validFrom: new Date('2034-01-01T00:00:00Z'),
    validUntil: new Date('2036-01-01T00:00:00Z'), status: 'ACTIVE', deletedAt: null };
  const couponEvents: string[] = [], couponWrites: string[] = [];
  function client(data: any): any {
    const detail = (row: any) => row && ({ ...row, shop, service: data.services.find((service: any) => service.id === row.serviceId),
      items: data.items.filter((item: any) => item.bookingId === row.id), addOns: [], resourceLocks: data.locks.filter((lock: any) => lock.bookingId === row.id) });
    return {
      $queryRaw: async (sql: any) => {
        if (sql.sql.includes('FROM coupons')) {
          couponEvents.push('coupon-lock-request'); const run = beforeCouponLock; beforeCouponLock = undefined;
          if (run) await run(); couponEvents.push('coupon-lock-acquired');
        } else if (sql.sql.includes('FROM shops')) {
          couponEvents.push('shop-lock');
          if (sql.sql.includes('FOR UPDATE')) {
            reservationEvents.push('shop-lock-request'); const run = beforeShopLock; beforeShopLock = undefined;
            if (run) await run(); reservationEvents.push('shop-lock-acquired');
          }
        } else if (sql.sql.includes('FROM users') && sql.sql.includes('FOR SHARE')) reservationEvents.push('customer-share');
        return [];
      },
      shop: { findUnique: async () => shop, findFirst: async ({ where }: any) => where.id === 10n ? shop : null },
      user: {
        findFirst: async ({ where }: any) => where.id === actorId && where.role === actorRole ? { id: actorId } : null,
        findUnique: async ({ where }: any) => where.id === customer.id ? { ...customer, email: data.customerEmail } : null,
        findMany: async ({ where, ...query }: any) => {
          customerSearchQueries.push({ where, ...query });
          const qualified = customer.role === 'CUSTOMER' && customer.status === 'ACTIVE' && !customer.deletedAt && customer.emailVerifiedAt && data.customerHasHistory
            && (customer.email ?? '').toLowerCase().includes(String(where.OR?.[1]?.email?.contains ?? '').toLowerCase());
          return qualified ? [{ id: customer.id, name: 'Synthetic customer', email: data.customerEmail, phone: '+12025550100' }] : [];
        },
      },
      shopAccountGrant: { findFirst: async () => permissions ? ({ sourceShopId: sourceShop.id, permissions: [...permissions], sourceShop }) : null },
      shopStaffGrant: { findUnique: async () => permissions ? ({ status: 'ACTIVE', permissions: [...permissions] }) : null },
      shopService: { findUnique: async ({ where }: any) => data.services.find((row: any) => row.id === where.id) },
      therapist: { findMany: async () => [30n, 31n].map(id => ({ id, shopId: 10n, isActive: true, scheduleMode: 'SHOP', shifts: [], timeOff: [] })) },
      shopRoom: { findMany: async () => [{ id: 40n, shopId: 10n, isActive: true, roomType: participantCount === 2 ? 'COUPLE' : 'SINGLE', capacity: participantCount, maintenance: [] }] },
      booking: {
        findFirst: async ({ where }: any) => where.userId === customer.id && where.shopId === 10n && data.customerHasHistory ? { id: 90n } : null,
        findMany: async ({ where }: any) => data.bookings.map((row: any) => detail(row)).filter((row: any) => matches(row, where)),
        findUnique: async ({ where, select }: any) => { if (where.userId_requestKey) reservationEvents.push('replay-read');
          const row = where.userId_requestKey ? data.bookings.find((row: any) => row.userId === where.userId_requestKey.userId && row.requestKey === where.userId_requestKey.requestKey)
          : data.bookings.find((row: any) => row.id === where.id); return select && row ? { shopId: row.shopId } : detail(row); },
        findUniqueOrThrow: async ({ where }: any) => detail(data.bookings.find((row: any) => row.id === where.id)),
        create: async ({ data: input }: any) => { reservationEvents.push('booking-create'); const row = { id: BigInt(100 + data.bookings.length), paidCents: 0, refundedCents: 0, deletedAt: null, ...input }; data.bookings.push(row); return row; },
        update: async ({ where, data: patch }: any) => { const row = data.bookings.find((row: any) => row.id === where.id); Object.assign(row, patch); return detail(row); },
      },
      bookingItem: {
        create: async ({ data: input }: any) => { const row = { id: BigInt(1000 + data.items.length), sequence: 1, offsetMin: 0, ...input }; data.items.push(row); return row; },
        update: async ({ where, data: patch }: any) => { const row = data.items.find((row: any) => row.id === where.id); Object.assign(row, patch); return row; },
      },
      shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: {
        findMany: async ({ where }: any) => data.locks.map((row: any) => ({ ...row, booking: data.bookings.find((booking: any) => booking.id === row.bookingId) })).filter((row: any) => matches(row, where)),
        createMany: async ({ data: rows }: any) => { rows.forEach((row: any) => data.locks.push({ id: BigInt(1 + data.locks.length), createdAt: new Date(), ...row })); return { count: rows.length }; },
        updateMany: async ({ where, data: patch }: any) => { reservationEvents.push('resource-write'); const rows = data.locks.filter((row: any) => (!where.bookingId || row.bookingId === where.bookingId)
          && (!where.status || row.status === where.status) && (!where.endAtUtc || row.endAtUtc <= where.endAtUtc.lte)
          && (!where.booking || where.booking.status.in.includes(data.bookings.find((booking: any) => booking.id === row.bookingId).status)));
          rows.forEach((row: any) => Object.assign(row, patch)); return { count: rows.length }; },
      },
      userCoupon: {
        findFirst: async ({ where, select }: any) => {
          couponEvents.push(select ? 'wallet-parent-read' : 'wallet-terms-read:' + couponTerms.status);
          if (!Object.entries(where).every(([key, value]) => data.couponWallet[key] === value)) return null;
          return { ...data.couponWallet, coupon: { ...couponTerms } };
        },
        updateMany: async ({ where, data: patch }: any) => { couponWrites.push('wallet-cas');
          if (!Object.entries(where).every(([key, value]) => data.couponWallet[key] === value)) return { count: 0 };
          Object.assign(data.couponWallet, patch); return { count: 1 };
        },
        update: async ({ data: patch }: any) => { couponWrites.push('wallet-link'); Object.assign(data.couponWallet, patch); return data.couponWallet; },
      },
      coupon: { update: async () => { couponWrites.push('coupon-counter'); data.couponUsedCount++; return {}; },
        updateMany: async () => { data.couponUsedCount--; return { count: 1 }; } },
      bookingSettlementEntry: { create: async ({ data: input }: any) => { data.zeroEntries.push(input); return input; } },
      refundRequest: { findFirst: async () => refundFence ? { id: 'synthetic-refund' } : null },
      auditLog: { create: async ({ data: input }: any) => { data.audits.push(input); return input; } },
      notificationOutbox: { create: async ({ data: input }: any) => { data.outbox.push(input); return input; } },
    };
  }
  const db: any = new Proxy({}, { get: (_target, key) => key === '$transaction' ? async (work: any) => {
    const staged = cloneFixture(state), result = await work(client(staged)); state = staged; return result;
  } : client(state)[key] });
  const service = new BookingService(db, {} as any, {} as any, new CouponsService(db));
  jest.spyOn(service as any, 'notifyBooking').mockResolvedValue(undefined);
  const command = (extra: any = {}) => ({ userId: '5', shopId: '10', serviceId: '20', date, startTime: '09:00', requestKey: 'synthetic-order-request-001', contact: onlineContact(), ...extra });
  const assistedCommand = (extra: any = {}) => ({ customerId: '5', shopId: '10', serviceId: '20', date, startTime: '09:00', requestKey: 'synthetic-assisted-request-001', contact: onlineContact(), ...extra });
  const createQuoted = async (input: any) => { const quote = await service.quoteBooking(input); return service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }); };
  const createPlanQuoted = async (input: any) => { const quote = await service.quotePlan(input); return service.createPlan({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }); };
  return { db, service, command, assistedCommand, createQuoted, createPlanQuoted, state: () => state, customerSearchQueries,
    setCustomerAccount: (patch: any) => { Object.assign(customer, patch); if ('email' in patch) state.customerEmail = patch.email; },
    setPermissions: (value: any) => { permissions = value; }, setCustomerVerified: (value: boolean) => { customer.emailVerifiedAt = value ? new Date('2035-01-01T00:00:00Z') : null; },
    fence: () => { refundFence = true; }, couponTerms, couponEvents, couponWrites,
    beforeCouponLock: (work: () => Promise<void>) => { beforeCouponLock = work; }, reservationEvents,
    beforeShopLock: (work: () => Promise<void>) => { beforeShopLock = work; } };
}

describe('new order-only booking workflow and immutable paid history', () => {
  let previousFlag: string | undefined, previousFee: string | undefined;
  beforeEach(() => { previousFlag = process.env.BOOKING_ONLINE_PAYMENT_ENABLED; previousFee = process.env.PLATFORM_FEE_BPS;
    delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; process.env.PLATFORM_FEE_BPS = '700'; jest.useFakeTimers(); jest.setSystemTime(at('08:00')); });
  afterEach(() => { jest.useRealTimers(); if (previousFlag === undefined) delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; else process.env.BOOKING_ONLINE_PAYMENT_ENABLED = previousFlag;
    if (previousFee === undefined) delete process.env.PLATFORM_FEE_BPS; else process.env.PLATFORM_FEE_BPS = previousFee; });

  test.each([[1, 1], [2, 2], [1, 2]])('%i guests/%i calendars use one whole service amount, no fee, no checkout hold and no fake paid state', async (count, staffCount) => {
    const f = fixture(count, staffCount), input = f.command({ paymentMode: 'ONLINE' });
    const slots = await f.service.getAvailableSlots({ shopId: '10', serviceId: '20', date });
    expect(slots).toMatchObject({ priceCents: 20001, priceBasis: 'PER_BOOKING', orderOnly: true, onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER' });
    const quote = await f.service.quoteBooking(input);
    expect(quote).toMatchObject({ totalCents: 20001, platformFeeCents: 0, paymentMode: 'PAY_AT_STORE', orderOnly: true });
    const saved = await f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    expect(saved).toMatchObject({ totalCents: 20001, paidCents: 0, refundedCents: 0, platformFeeCents: 0, status: 'PENDING', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', holdExpiresAt: null });
    expect(saved.items).toHaveLength(count); expect(saved.items.reduce((sum: number, row: any) => sum + row.priceCentsSnapshot, 0)).toBe(20001);
    expect(saved.items.every((row: any) => row.priceBasisSnapshot === 'PER_BOOKING')).toBe(true);
    const locks = f.state().locks.filter((row: any) => row.resourceType === 'THERAPIST'); expect(locks).toHaveLength(staffCount);
    expect(new Set(locks.map((row: any) => row.resourceId)).size).toBe(staffCount); expect(f.state().services[0].priceBasis).toBe('PER_PERSON'); expect(f.state().zeroEntries).toEqual([]);
    jest.setSystemTime(at('08:20')); expect(await expireShopHolds(f.db, 10n)).toBe(0); expect(f.state().bookings[0].status).toBe('PENDING');
    expect(f.state().locks.every((row: any) => row.status === 'ACTIVE')).toBe(true);
  });
  test('PLAN sums selected service totals, keeps preparation offsets and also creates only an unpaid offline order', async () => {
    const f = fixture(), input = { userId: '5', shopId: '10', date, startTime: '09:00', requestKey: 'synthetic-order-plan-001', paymentMode: 'ONLINE' as const, contact: onlineContact(),
      items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '21' }] };
    const quote = await f.service.quotePlan(input), saved = await f.service.createPlan({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    expect(quote).toMatchObject({ totalCents: 23004, platformFeeCents: 0, durationMin: 135, orderOnly: true, paymentMode: 'PAY_AT_STORE' });
    expect(saved).toMatchObject({ reservationKind: 'PLAN', totalCents: 23004, paymentMode: 'PAY_AT_STORE', status: 'PENDING', paymentStatus: 'UNPAID', holdExpiresAt: null });
    expect(saved.items.map((row: any) => [row.offsetMin, row.priceCentsSnapshot, row.priceBasisSnapshot])).toEqual([[0, 20001, 'PER_BOOKING'], [75, 3003, 'PER_BOOKING']]);
  });
  test.each(['SINGLE', 'PLAN'])('all new timed %s orders need a stable key and signed current total; changed totals reject before persisting orders or locks', async kind => {
    const f = fixture(), input = f.command(), plan = { ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
    const create = (patch: any = {}) => kind === 'PLAN' ? f.service.createPlan({ ...plan, ...patch }) : f.service.createBooking({ ...input, ...patch });
    const before = cloneFixture(f.state());
    await expect(create()).rejects.toThrow(ConflictException);
    await expect(create({ requestKey: undefined })).rejects.toThrow(BadRequestException);
    expect(f.state()).toEqual(before); expect(f.couponWrites).toEqual([]);
    const original = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(input);
    f.state().services[0].priceCents = 24001; const changed = cloneFixture(f.state());
    await expect(create({ quoteHash: original.quoteHash, quoteExpiresAt: original.quoteExpiresAt })).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(changed); expect(f.state().bookings).toEqual([]); expect(f.state().locks).toEqual([]);
    const current = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(input);
    const saved = await create({ quoteHash: current.quoteHash, quoteExpiresAt: current.quoteExpiresAt });
    expect(saved.totalCents).toBe(24001); expect(saved.items.reduce((sum: number, row: any) => sum + row.priceCentsSnapshot, 0)).toBe(24001);
  });
  test.each(['SINGLE', 'PLAN'])('shop calendar refresh cannot invalidate an otherwise unchanged signed %s quote', async kind => {
    const f = fixture(), input = f.command(), plan = { ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
    const firstSlots = kind === 'PLAN' ? await f.service.getPlanSlots(plan) : await f.service.getAvailableSlots(input);
    const quote = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(input);
    expect(firstSlots.bookingCalendar).toEqual({ today: date, timezone: 'UTC', serverNow: at('08:00').toISOString(), validUntil: '2035-01-02T00:00:00.000Z' });
    expect(quote).not.toHaveProperty('bookingCalendar');
    jest.setSystemTime(at('08:01'));
    const nextSlots = kind === 'PLAN' ? await f.service.getPlanSlots(plan) : await f.service.getAvailableSlots(input);
    expect(nextSlots.bookingCalendar?.serverNow).toBe(at('08:01').toISOString());
    const saved = kind === 'PLAN' ? await f.service.createPlan({ ...plan, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })
      : await f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    expect(saved.totalCents).toBe(20001);
    const moving = await f.service.getRescheduleSlots(saved.id, '5', 'CUSTOMER', date);
    expect(moving.bookingCalendar).toEqual(nextSlots.bookingCalendar);
  });
  test('a fully discounted offline order remains pending and unpaid, without ZERO evidence or auto-confirmation', async () => {
    const f = fixture(), input = f.command({ couponId: '7' }), quote = await f.service.quoteBooking(input);
    const saved = await f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    expect(saved).toMatchObject({ totalCents: 0, status: 'PENDING', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', paidCents: 0, holdExpiresAt: null }); expect(f.state().zeroEntries).toEqual([]);
  });
  test.each([
    ['ordinary', 1, 1, false], ['couple', 2, 2, false], ['four hands', 1, 2, false], ['multi-service plan', 1, 1, true],
  ] as const)('%s discounts the order subtotal once and cancellation returns the same coupon and every reserved calendar for reuse', async (_kind, count, staff, plan) => {
    const f = fixture(count, staff);
    Object.assign(f.couponTerms, { type: 'PERCENT', value: 33, minSpendCents: plan ? 22000 : 15000 });
    const input: any = { ...f.command({ couponId: '7' }), ...(plan ? { items: [
      { participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '21' },
    ] } : {}) };
    const quote = () => plan ? f.service.quotePlan(input) : f.service.quoteBooking(input);
    const create = (priced: any, requestKey = input.requestKey) => plan
      ? f.service.createPlan({ ...input, requestKey, quoteHash: priced.quoteHash, quoteExpiresAt: priced.quoteExpiresAt })
      : f.service.createBooking({ ...input, requestKey, quoteHash: priced.quoteHash, quoteExpiresAt: priced.quoteExpiresAt });
    const subtotal = plan ? 23004 : 20001, discount = plan ? 7591 : 6600;
    const priced = await quote();
    expect(priced).toMatchObject({ mainSubtotalCents: subtotal, subtotalCents: subtotal, discountCents: discount,
      totalCents: subtotal - discount, platformFeeCents: 0, paymentMode: 'PAY_AT_STORE' });
    const saved = await create(priced), snapshots = cloneFixture(f.state().items);
    expect(saved).toMatchObject({ priceCents: subtotal, discountCents: discount, totalCents: subtotal - discount,
      paidCents: 0, refundedCents: 0, paymentStatus: 'UNPAID' });
    expect(saved.items.reduce((sum: number, row: any) => sum + row.priceCentsSnapshot, 0)).toBe(subtotal);
    expect(f.state().couponWallet).toMatchObject({ status: 'USED', bookingId: BigInt(saved.id) });
    expect(f.state().couponUsedCount).toBe(1);
    const activeBefore = f.state().locks.filter((row: any) => row.status === 'ACTIVE');
    expect(activeBefore.filter((row: any) => row.resourceType === 'THERAPIST')).toHaveLength(plan ? 2 : staff);
    expect(activeBefore.filter((row: any) => row.resourceType === 'ROOM')).toHaveLength(plan ? 2 : 1);
    const reserved = cloneFixture(f.state());
    await expect(create(priced, 'synthetic-conflicting-coupon-order')).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(reserved);
    const cancelled = await f.service.cancelBooking(saved.id, '5');
    expect(cancelled).toMatchObject({ status: 'CANCELLED', priceCents: subtotal, discountCents: discount, totalCents: subtotal - discount, amountDueCents: 0 });
    expect(f.state().items).toEqual(snapshots);
    expect(f.state().locks.every((row: any) => row.status === 'RELEASED')).toBe(true);
    expect(f.state().couponWallet).toMatchObject({ status: 'UNUSED', bookingId: null, usedAt: null });
    expect(f.state().couponUsedCount).toBe(0);
    const released = cloneFixture(f.state());
    await expect(f.service.cancelBooking(saved.id, '5')).rejects.toThrow(ForbiddenException);
    expect(f.state()).toEqual(released);
    // A new order, rather than replaying the cancelled request key, can now
    // reserve the exact same start and use the returned voucher exactly once.
    const replacement = await create(await quote(), 'synthetic-replacement-coupon-order');
    expect(replacement).toMatchObject({ status: 'PENDING', totalCents: subtotal - discount });
    expect(replacement.id).not.toBe(saved.id);
    expect(f.state().couponWallet).toMatchObject({ status: 'USED', bookingId: BigInt(replacement.id) });
    expect(f.state().couponUsedCount).toBe(1);
    expect(f.state().locks.filter((row: any) => row.status === 'ACTIVE').every((row: any) => row.bookingId === BigInt(replacement.id))).toBe(true);
    expect(f.state().zeroEntries).toEqual([]);
  });
  test('a cancellation persistence failure rolls coupon restoration and resource release back with the order', async () => {
    const f = fixture(1, 2), saved = await f.createQuoted(f.command({ couponId: '7' })), reserved = cloneFixture(f.state());
    jest.spyOn(f.service as any, 'notifyBooking').mockRejectedValueOnce(new Error('Synthetic cancellation persistence failure'));
    await expect(f.service.cancelBooking(saved.id, '5')).rejects.toThrow('Synthetic cancellation persistence failure');
    expect(f.state()).toEqual(reserved);
    expect(f.state().couponWallet).toMatchObject({ status: 'USED', bookingId: BigInt(saved.id) });
    expect(f.state().couponUsedCount).toBe(1);
    expect(f.state().locks.every((row: any) => row.status === 'ACTIVE')).toBe(true);
  });
  test.each(['SINGLE', 'PLAN'])('a timed %s using a coupon requires the real signed quote and stable key before any coupon or order write', async kind => {
    const f = fixture(), input = f.command({ couponId: '7' }), plan = { ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
    const create = (patch: any) => kind === 'PLAN' ? f.service.createPlan({ ...plan, ...patch }) : f.service.createBooking({ ...input, ...patch });
    const before = cloneFixture(f.state());
    await expect(create({})).rejects.toThrow(ConflictException);
    await expect(create({ requestKey: undefined })).rejects.toThrow(BadRequestException);
    expect(f.state()).toEqual(before); expect(f.couponWrites).toEqual([]);
    const quote = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(input);
    await expect(create({ quoteHash: quote.quoteHash, quoteExpiresAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(before); expect(f.couponWrites).toEqual([]);
    const saved = await create({ quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    expect(saved).toMatchObject({ totalCents: 0, discountCents: 20001, paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE' });
    expect(f.couponWrites).toEqual(['wallet-cas', 'coupon-counter', 'wallet-link']); expect(f.state().couponUsedCount).toBe(1);
  });
  test.each(['SINGLE', 'PLAN'])('a previously created zero-total offline %s can finish after online checkout is enabled without changing money', async kind => {
    const f = fixture(), input = f.command({ couponId: '7' }), plan = { ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
    const quote = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(input);
    const saved = kind === 'PLAN' ? await f.service.createPlan({ ...plan, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })
      : await f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    const money = { totalCents: saved.totalCents, paidCents: saved.paidCents, refundedCents: saved.refundedCents, paymentMode: saved.paymentMode, paymentStatus: saved.paymentStatus };
    expect(money).toEqual({ totalCents: 0, paidCents: 0, refundedCents: 0, paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID' });
    process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true';
    await f.service.updateBookingStatus(saved.id, '2', 'CONFIRMED', 'MERCHANT');
    expect(settlementActions(f.state().bookings[0], true, false).complete).toBe(false);
    await expect(f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT')).rejects.toThrow('before the service ends');
    jest.setSystemTime(at('10:01'));
    expect(settlementActions(f.state().bookings[0], true, true).complete).toBe(false);
    expect(settlementActions(f.state().bookings[0], true, false).complete).toBe(true);
    f.state().bookings[0].paymentMode = 'ONLINE';
    expect(settlementActions(f.state().bookings[0], true, false).complete).toBe(false);
    await expect(f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT')).rejects.toThrow('Collect the outstanding amount');
    f.state().bookings[0].paymentMode = 'PAY_AT_STORE';
    const finished = await f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT');
    expect(finished).toMatchObject({ status: 'COMPLETED', ...money }); expect(f.state().zeroEntries).toEqual([]);
    expect(f.state().locks.every((row: any) => row.status === 'ACTIVE')).toBe(true);
  });
  test.each(['SINGLE', 'PLAN'])('coupon reads in %s quote do not lock or consume; a paused parent committed before create acquires its lock rejects with zero partial writes', async kind => {
    const f = fixture(), input = f.command({ couponId: '7' }), plan = { ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
    const quote = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(input);
    expect(f.couponEvents).toEqual(['shop-lock', 'wallet-terms-read:ACTIVE']); expect(f.couponWrites).toEqual([]);
    const before = cloneFixture(f.state()); f.couponEvents.length = 0;
    // Deterministic interleaving: management owns the coupon mutex first and
    // commits PAUSED before the waiting booking acquires it. No timer/sleep.
    f.beforeCouponLock(async () => {
      const adminTx: any = { $queryRaw: async () => { f.couponEvents.push('admin-coupon-lock'); return []; },
        coupon: { findFirst: async () => ({ ...f.couponTerms, usedCount: 0 }), update: async ({ data }: any) => { Object.assign(f.couponTerms, data); return f.couponTerms; } },
        userCoupon: { count: async () => 1 } };
      await updateCouponInTransaction(adminTx, 8n, { status: 'PAUSED' }); f.couponEvents.push('admin-commit');
    });
    await expect(kind === 'PLAN' ? f.service.createPlan({ ...plan, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })
      : f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow(ConflictException);
    expect(f.couponEvents).toEqual(['shop-lock', 'wallet-parent-read', 'coupon-lock-request', 'admin-coupon-lock', 'admin-commit', 'coupon-lock-acquired', 'wallet-terms-read:PAUSED']);
    expect(f.couponTerms.status).toBe('PAUSED'); expect(f.couponWrites).toEqual([]); expect(f.state()).toEqual(before);
  });
  test.each(['SINGLE', 'PLAN'])('an existing %s request replays before rechecking paused/expired coupon terms and does not consume twice', async kind => {
    const f = fixture(), input = f.command({ couponId: '7' }), plan = { ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
    const quote = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(input);
    const saved = kind === 'PLAN' ? await f.service.createPlan({ ...plan, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })
      : await f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
    expect(f.couponWrites).toEqual(['wallet-cas', 'coupon-counter', 'wallet-link']);
    f.couponTerms.status = 'PAUSED'; f.couponTerms.validUntil = new Date('2034-12-01T00:00:00Z'); f.couponEvents.length = 0; f.couponWrites.length = 0;
    const replay = kind === 'PLAN' ? await f.service.createPlan({ ...plan, quoteHash: 'a'.repeat(64), quoteExpiresAt: '2000-01-01T00:00:00.000Z' })
      : await f.service.createBooking({ ...input, quoteHash: 'a'.repeat(64), quoteExpiresAt: '2000-01-01T00:00:00.000Z' });
    expect(replay).toEqual(saved); expect(f.couponEvents).toEqual(['shop-lock']); expect(f.couponWrites).toEqual([]); expect(f.state().couponUsedCount).toBe(1);
  });
  test('coupon expiry while a create waits for its row lock is evaluated at the current time and leaves no wallet/order/resource writes', async () => {
    const f = fixture(), input = f.command({ couponId: '7' }); f.couponTerms.validUntil = at('08:01');
    const quote = await f.service.quoteBooking(input), before = cloneFixture(f.state());
    f.beforeCouponLock(async () => { jest.setSystemTime(at('08:02')); });
    await expect(f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(before); expect(f.couponWrites).toEqual([]);
  });
  test('missing account email and nonzero online tip reject with their actionable 400 before order/resource writes', async () => {
    const f = fixture(), input = f.command(), quote = await f.service.quoteBooking(input); f.state().customerEmail = null;
    try { await f.service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }); throw Error('Expected email rejection'); }
    catch (error) { expect(error).toBeInstanceOf(BadRequestException); expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'ORDER_EMAIL_REQUIRED', fields: { email: expect.any(String) } }); }
    expect(f.state().bookings).toEqual([]); expect(f.state().locks).toEqual([]);
    const g = fixture();
    try { await g.service.createBooking(g.command({ tipCents: 100, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })); throw Error('Expected tip rejection'); }
    catch (error) { expect(error).toBeInstanceOf(BadRequestException); expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'ORDER_TIP_NOT_SUPPORTED' }); }
    expect(g.state().bookings).toEqual([]); expect(g.state().locks).toEqual([]);
  });
  describe.each(['SINGLE', 'PLAN'])('%s contact snapshot creation through the actual pricing/allocation transaction', kind => {
    function online() {
      const f = fixture(), input = { ...f.command(), ...(kind === 'PLAN' ? { items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] } : {}) };
      const quote = (value: any = input) => kind === 'PLAN' ? f.service.quotePlan(value) : f.service.quoteBooking(value);
      const create = (value: any) => kind === 'PLAN' ? f.service.createPlan(value) : f.service.createBooking(value);
      return { ...f, input, quote, create };
    }
    test('normalizes and stores an independent snapshot; account edits cannot change reads or an exact retry', async () => {
      const f = online(), input = { ...f.input, contact: { name: '  顾客 A  ', phone: '+1 (202) 555-0100', email: 'Synthetic.Customer@Example.Test' } };
      const quote = await f.quote(input), command = { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
      const first = await f.create(command), snapshot = { recorded: true, version: 1, name: '顾客 A', phone: '+12025550100', email: 'synthetic.customer@example.test', source: 'ONLINE_VERIFIED', emailVerifiedAt: '2035-01-01T00:00:00.000Z' };
      expect(first.contact).toEqual(snapshot);
      expect(f.state().bookings[0]).toMatchObject({ contactName: snapshot.name, contactPhone: snapshot.phone, contactEmail: snapshot.email, contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactEmailVerifiedAt: at('00:00') });
      for (const key of ['contactName', 'contactPhone', 'contactEmail', 'contactVersion', 'contactSource', 'contactEmailVerifiedAt']) expect(first).not.toHaveProperty(key);
      f.setCustomerAccount({ name: 'Changed account', phone: '+12025550999', email: 'changed.customer@example.test', emailVerifiedAt: null });
      const before = cloneFixture(f.state());
      expect((await f.service.getBooking(first.id, '5')).contact).toEqual(snapshot);
      const replay = await f.create({ ...command, contact: { name: '顾客 A', phone: '+12025550100', email: 'synthetic.customer@example.test' }, quoteHash: 'a'.repeat(64), quoteExpiresAt: '2000-01-01T00:00:00.000Z' });
      expect(replay).toEqual(first); expect(f.state()).toEqual(before); expect(f.state().bookings).toHaveLength(1);
    });
    test.each(['name', 'phone', 'email'])('the same request key with changed contact %s conflicts without changing any snapshot or resource', async field => {
      const f = online(), quote = await f.quote(), command = { ...f.input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
      await f.create(command); const before = cloneFixture(f.state());
      const changes = { name: 'Another guest', phone: '+12025550999', email: 'another@example.test' };
      await expect(f.create({ ...command, contact: { ...command.contact, [field]: changes[field as keyof typeof changes] } })).rejects.toThrow('reused with different parameters');
      expect(f.state()).toEqual(before);
    });
    test.each([
      ['missing', undefined], ['null', null], ['empty name', { ...onlineContact(), name: ' ' }],
      ['local phone', { ...onlineContact(), phone: '2025550100' }], ['invalid email', { ...onlineContact(), email: 'not-an-email' }],
    ])('rejects %s contact with its actionable 400 before creating a booking, resource or coupon mutation', async (_label, contact) => {
      const f = online(), quote = await f.quote(), before = cloneFixture(f.state());
      await expect(f.create({ ...f.input, contact, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toMatchObject({ response: { code: 'BOOKING_CONTACT_INVALID' }, status: 400 });
      expect(f.state()).toEqual(before); expect(f.couponWrites).toEqual([]);
    });
    test('rejects a changed verified account email with the dedicated conflict rather than treating it as a price change', async () => {
      const f = online(), quote = await f.quote(); f.setCustomerAccount({ email: 'new.verified@example.test' }); const before = cloneFixture(f.state());
      await expect(f.create({ ...f.input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toMatchObject({ response: { code: 'BOOKING_CONTACT_EMAIL_CHANGED' }, status: 409 });
      expect(f.state()).toEqual(before); expect(f.couponWrites).toEqual([]);
    });
    test('contact edits leave price signatures unchanged and a prior price quote accepts the newly chosen name/phone', async () => {
      const f = online(), { contact: _ignored, ...selection } = f.input;
      const original = await f.quote(selection), edited = { ...f.input, contact: { ...onlineContact(), name: 'New booking guest', phone: '+12025550999' } };
      expect(await f.quote(edited)).toEqual(original);
      expect(await f.quote({ ...selection, contact: { invalid: true } })).toEqual(original);
      const saved = await f.create({ ...edited, quoteHash: original.quoteHash, quoteExpiresAt: original.quoteExpiresAt });
      expect(saved.contact).toMatchObject({ recorded: true, name: 'New booking guest', phone: '+12025550999' });
    });
    test('an outbox failure rolls back the contact, booking, items, resource locks, coupon claim and earlier queued notification together', async () => {
      const f = online(), input = { ...f.input, couponId: '7' }, quote = await f.quote(input), before = cloneFixture(f.state());
      (f.service as any).notifyBooking.mockRestore();
      const enqueue = jest.mocked(enqueueNotification), orderEmail = jest.mocked(enqueueBookingOrderEmail), reminder = jest.mocked(syncBookingReminder);
      enqueue.mockClear(); orderEmail.mockClear(); reminder.mockClear();
      enqueue.mockImplementationOnce(async (tx: any, notification: any) => { await tx.notificationOutbox.create({ data: notification }); });
      orderEmail.mockRejectedValueOnce(new Error('SYNTHETIC_OUTBOX_WRITE_FAILURE'));
      await expect(f.create({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow('SYNTHETIC_OUTBOX_WRITE_FAILURE');
      expect(enqueue).toHaveBeenCalledTimes(1); expect(orderEmail).toHaveBeenCalledTimes(1); expect(reminder).not.toHaveBeenCalled();
      expect(f.state()).toEqual(before); expect(f.state().outbox).toEqual([]); expect(f.couponWrites).toEqual(['wallet-cas', 'coupon-counter', 'wallet-link']);
    });
  });
  test.each(['SINGLE', 'PLAN'])('the exact original %s request key replays old mode/money even after policy and email requirements change', async kind => {
    const f = fixture(), command = f.command({ paymentMode: 'ONLINE', tipCents: 0 }), plan = { ...command, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
    const saved = kind === 'PLAN' ? await f.createPlanQuoted(plan) : await f.createQuoted(command);
    const prior = f.state().bookings[0];
    // Original payload predated contact capture and had a tip; preserve that historical signature.
    const original = { ...command, contact: undefined, tipCents: 500 }, originalPlan = { ...plan, contact: undefined, tipCents: 500 };
    Object.assign(prior, { requestHash: kind === 'PLAN' ? (f.service as any).planRequest(originalPlan, originalPlan.items, true) : (f.service as any).request(original, true),
      contactName: null, contactPhone: null, contactEmail: null, contactVersion: null, contactSource: null, contactEmailVerifiedAt: null,
      paymentMode: 'ONLINE', paymentStatus: 'PAID', status: 'CONFIRMED', totalCents: 20501, paidCents: 20501, tipCents: 500 });
    f.state().customerEmail = null;
    const replay = kind === 'PLAN' ? await f.service.createPlan(originalPlan) : await f.service.createBooking(original);
    expect(replay).toMatchObject({ id: saved.id, totalCents: 20501, paidCents: 20501, tipCents: 500, paymentMode: 'ONLINE', paymentStatus: 'PAID' });
    expect(replay.contact).toEqual({ recorded: false, version: null, label: 'Historical booking has no recorded contact' });
    expect(f.state().bookings).toHaveLength(1);
    const changed = { ...original, startTime: '11:00' };
    await expect(kind === 'PLAN' ? f.service.createPlan({ ...originalPlan, startTime: '11:00' }) : f.service.createBooking(changed)).rejects.toThrow('reused with different parameters');
  });
  test('manager fulfilment can finish after its end without inventing receipts, while cleanup, customer authority and net-paid cancellation remain protected', async () => {
    const f = fixture(), saved = await f.createQuoted(f.command());
    await f.service.updateBookingStatus(saved.id, '2', 'CONFIRMED', 'MERCHANT');
    await expect(f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT')).rejects.toThrow('before the service ends');
    await expect(f.service.updateBookingStatus(saved.id, '5', 'COMPLETED', 'CUSTOMER')).rejects.toThrow();
    jest.setSystemTime(at('10:01')); const completed = await f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT');
    expect(completed).toMatchObject({ status: 'COMPLETED', paymentStatus: 'UNPAID', paidCents: 0, refundedCents: 0 }); expect(f.state().zeroEntries).toEqual([]);
    expect(f.state().locks.every((row: any) => row.status === 'ACTIVE')).toBe(true);
    const g = fixture(), other = await g.createQuoted(g.command({ startTime: '11:00' })); g.state().bookings[0].paidCents = 1;
    await expect(g.service.cancelBooking(other.id, '5')).rejects.toThrow('Refund'); expect(g.state().bookings[0].status).toBe('PENDING');
    g.state().bookings[0].paidCents = 0; g.fence(); await expect(g.service.cancelBooking(other.id, '5')).rejects.toThrow('pending refund');
  });
  test.each([[1, 1], [2, 2], [1, 2]])('%i guests/%i staff can complete exactly at service end while each cleanup buffer and customer history remain intact', async (count, staffCount) => {
    const f = fixture(count, staffCount), saved = await f.createQuoted(f.command());
    const original = cloneFixture(f.state().bookings[0]), items = cloneFixture(f.state().items);
    await f.service.updateBookingStatus(saved.id, '2', 'CONFIRMED', 'MERCHANT');
    jest.setSystemTime(new Date(+at('10:00') - 1));
    expect(settlementActions(f.state().bookings[0], true, false).complete).toBe(false);
    const beforeEnd = cloneFixture(f.state());
    await expect(f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT')).rejects.toThrow('before the service ends');
    expect(f.state()).toEqual(beforeEnd);

    jest.setSystemTime(at('10:00'));
    expect(settlementActions(f.state().bookings[0], true, false).complete).toBe(true);
    await f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT');
    expect(f.state().bookings[0]).toEqual({ ...original, status: 'COMPLETED' });
    expect(f.state().items).toEqual(items); expect(f.state().zeroEntries).toEqual([]);
    expect(f.state().locks.every((row: any) => row.status === 'ACTIVE')).toBe(true);
    expect(f.state().locks.filter((row: any) => row.resourceType === 'THERAPIST')).toHaveLength(staffCount);
    expect(f.state().locks.filter((row: any) => row.resourceType === 'ROOM')).toHaveLength(1);

    jest.setSystemTime(at('10:10')); await expireShopHolds(f.db, 10n);
    expect(f.state().locks.filter((row: any) => row.resourceType === 'ROOM').every((row: any) => row.status === 'RELEASED')).toBe(true);
    expect(f.state().locks.filter((row: any) => row.resourceType === 'THERAPIST').every((row: any) => row.status === 'ACTIVE')).toBe(true);
    jest.setSystemTime(at('10:15')); await expireShopHolds(f.db, 10n);
    expect(f.state().locks.every((row: any) => row.status === 'RELEASED')).toBe(true);
    expect(f.state().bookings[0]).toEqual({ ...original, status: 'COMPLETED' });
    expect(f.state().items).toEqual(items); expect(f.state().zeroEntries).toEqual([]);
    const customer = await f.service.getBooking(saved.id, '5', 'CUSTOMER');
    expect(customer).toMatchObject({ status: 'COMPLETED', paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID',
      totalCents: saved.totalCents, paidCents: 0, refundedCents: 0, startTime: saved.startTime, endTime: saved.endTime,
      participantCount: count, requiredStaffCount: staffCount });
    expect(customer.items.map((row: any) => row.assignedTherapistIds)).toEqual(saved.items.map((row: any) => row.assignedTherapistIds));
    expect(settlementActions(f.state().bookings[0], true, false).complete).toBe(false);
    expect(f.state().audits.map((row: any) => row.action)).toEqual(['BOOKING_CONFIRMED', 'BOOKING_COMPLETED']);
  });
  test('historical ONLINE/per-person snapshots and money stay immutable during reschedule and still require settlement before completion', async () => {
    const f = fixture(2), saved = await f.createQuoted(f.command());
    Object.assign(f.state().bookings[0], { status: 'CONFIRMED', paymentMode: 'ONLINE', paymentStatus: 'PAID', priceCents: 40002, totalCents: 40002, paidCents: 40002 });
    for (const item of f.state().items) Object.assign(item, { priceBasisSnapshot: 'PER_PERSON', priceCentsSnapshot: 20001, quotedUnitPriceCents: 20001 });
    f.state().services[0].priceCents = 70000;
    const moved = await f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '11:00' });
    expect(moved).toMatchObject({ totalCents: 40002, priceCents: 40002, paidCents: 40002, paymentMode: 'ONLINE', paymentStatus: 'PAID' });
    expect(moved.items.every((row: any) => row.priceBasisSnapshot === 'PER_PERSON' && row.priceCentsSnapshot === 20001)).toBe(true);
    f.state().bookings[0].paidCents = 0; f.state().bookings[0].paymentStatus = 'UNPAID'; jest.setSystemTime(new Date('2035-01-03T12:00:00Z'));
    await expect(f.service.updateBookingStatus(saved.id, '2', 'COMPLETED', 'MERCHANT')).rejects.toThrow(BadRequestException);
    expect(settlementActions(f.state().bookings[0], true, false).complete).toBe(false);
  });
  test('explicit online enablement preserves the prepayment hold flow, without changing the whole-order pricing rule', async () => {
    process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true';
    const f = fixture(2), saved = await f.createQuoted(f.command());
    expect(saved).toMatchObject({ totalCents: 21401, platformFeeCents: 1400, paymentMode: 'ONLINE', status: 'PENDING', paymentStatus: 'UNPAID' });
    expect(saved.holdExpiresAt).toEqual(at('08:15')); expect(saved.items.reduce((sum: number, row: any) => sum + row.priceCentsSnapshot, 0)).toBe(20001);
  });

  describe('merchant assisted booking', () => {
    const actor = { id: '2', role: 'MERCHANT' };

    describe('expired original command recovery', () => {
      const code = 'ASSISTED_QUOTE_EXPIRED_NOT_EXECUTED';
      const failed = (result: Promise<unknown>): Promise<any> => result.then(value => value, error => error);
      const readBeforeProof = ['shop-lock-request', 'shop-lock-acquired', 'customer-share', 'replay-read'];

      test('returns the committed receipt before checking expiry, without any new writes', async () => {
        const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
        const command = { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
        const first = await f.service.createAssistedBooking(actor, command);
        jest.setSystemTime(new Date(Date.parse(quote.quoteExpiresAt) + 60000)); f.setCustomerVerified(false);
        f.reservationEvents.length = 0;
        const replay = await f.service.createAssistedBooking(actor, command);
        expect(replay).toEqual(first); expect(f.state().bookings).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
        expect(f.reservationEvents).toEqual(readBeforeProof);
      });

      test('proves the exact canonical expired command was not executed and rejects every late retry', async () => {
        const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
        const command = { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
        for (const delay of [0, 60000, 120000]) {
          jest.setSystemTime(new Date(Date.parse(quote.quoteExpiresAt) + delay)); f.reservationEvents.length = 0;
          const error = await failed(f.service.createAssistedBooking(actor, command));
          expect(error).toBeInstanceOf(ConflictException);
          expect(error.getResponse()).toMatchObject({ code, shopId: '10', requestKey: command.requestKey, quoteExpiresAt: quote.quoteExpiresAt });
          expect(f.reservationEvents).toEqual(readBeforeProof);
          expect(f.state().bookings).toHaveLength(0); expect(f.state().items).toHaveLength(0); expect(f.state().locks).toHaveLength(0);
          expect(f.state().audits).toHaveLength(0); expect(f.state().outbox).toHaveLength(0);
        }
      });

      test('checks expiry after waiting for the common shop lock, before maintenance or reservation writes', async () => {
        const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
        f.reservationEvents.length = 0;
        f.beforeShopLock(async () => { jest.setSystemTime(new Date(quote.quoteExpiresAt)); });
        const error = await failed(f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }));
        expect(error).toBeInstanceOf(ConflictException); expect(error.getResponse()).toMatchObject({ code });
        expect(f.reservationEvents).toEqual(readBeforeProof); expect(f.state().bookings).toHaveLength(0);
      });

      test('does not issue expiry proof instead of authorization, publication, or existing-key conflicts', async () => {
        const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
        const command = { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
        await f.service.createAssistedBooking(actor, command); jest.setSystemTime(new Date(quote.quoteExpiresAt));
        const conflict = await failed(f.service.createAssistedBooking(actor, { ...command, startTime: '10:00' }));
        expect(conflict).toBeInstanceOf(ConflictException); expect(conflict.message).toContain('reused with different parameters');
        expect(conflict.getResponse()).not.toMatchObject({ code });
        const denied = fixture(1, 1, { actorId: 4, boundUserId: 2, permissions: ['BOOKINGS_READ'] });
        const forbidden = await failed(denied.service.createAssistedBooking({ id: '4', role: 'MERCHANT' }, command));
        expect(forbidden).toBeInstanceOf(ForbiddenException); expect(forbidden.getResponse()).not.toMatchObject({ code });
        const unpublished = fixture(); (await unpublished.db.shop.findUnique({})).status = 'PENDING';
        const inactive = await failed(unpublished.service.createAssistedBooking(actor, command));
        expect(inactive).toBeInstanceOf(BadRequestException); expect(inactive.getResponse()).not.toMatchObject({ code });
        expect(denied.state().bookings).toHaveLength(0); expect(unpublished.state().bookings).toHaveLength(0);
      });

      test.each([
        undefined, '', '2035-01-01T07:59:00Z', '2035-01-01T07:59:00.000+00:00',
        '2034-02-30T07:59:00.000Z', 'not-a-date',
      ])('does not issue proof for noncanonical or missing expiry %s', async quoteExpiresAt => {
        const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
        const error = await failed(f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt }));
        expect(error).toBeInstanceOf(ConflictException); expect(error.getResponse()).not.toMatchObject({ code });
        expect(f.state().bookings).toHaveLength(0);
      });

      test('does not issue proof for an unexpired changed signature or unavailable slot', async () => {
        const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
        const changed = await failed(f.service.createAssistedBooking(actor, { ...input, quoteHash: '0'.repeat(64), quoteExpiresAt: quote.quoteExpiresAt }));
        expect(changed).toBeInstanceOf(ConflictException); expect(changed.getResponse()).not.toMatchObject({ code });
        await f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
        const unavailable = await failed(f.service.createAssistedBooking(actor, { ...input, requestKey: 'synthetic-occupied-request', quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }));
        expect(unavailable).toBeInstanceOf(ConflictException); expect(unavailable.getResponse()).not.toMatchObject({ code });
        expect(f.state().bookings).toHaveLength(1);
      });
    });

    test('customer search is shop-scoped and projects only verified customer contact fields', async () => {
      const f = fixture();
      await expect(f.service.assistedBookingCustomers(actor, '10', 'synthetic')).resolves.toEqual([
        { id: '5', name: 'Synthetic customer', email: 'synthetic.customer@example.test', phone: '+12025550100' },
      ]);
      expect(f.customerSearchQueries[0].where).toMatchObject({ role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null,
        emailVerifiedAt: { not: null }, email: { not: null }, bookings: { some: { shopId: 10n, deletedAt: null } } });
      expect(f.customerSearchQueries[0].select).toEqual({ id: true, name: true, email: true, phone: true });
    });

    test('quotes and creates an existing verified same-shop customer as an unpaid PAY_AT_STORE order', async () => {
      const f = fixture(), input = f.assistedCommand({ paymentMode: 'ONLINE', tipCents: 900, couponId: '8' });
      const quote = await f.service.quoteAssistedBooking(actor, input);
      expect(quote).toMatchObject({ shopId: '10', totalCents: 20001, platformFeeCents: 0, tipCents: 0, paymentMode: 'PAY_AT_STORE', orderOnly: true });
      const saved = await f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
      expect(saved).toMatchObject({ shopId: '10', userId: '5', totalCents: 20001, priceCents: 20001, paidCents: 0, platformFeeCents: 0,
        tipCents: 0, paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', status: 'PENDING', holdExpiresAt: null });
      expect(f.state().audits).toEqual([expect.objectContaining({ operatorId: 2n, action: 'ASSISTED_BOOKING_CREATE', targetType: 'BOOKING', targetId: BigInt(saved.id) })]);
      expect(f.state().zeroEntries).toEqual([]);
    });

    test('rechecks customer verification inside the create transaction after the quote', async () => {
      const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
      f.setCustomerVerified(false);
      await expect(f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow(BadRequestException);
      expect(f.state().bookings).toHaveLength(0); expect(f.state().audits).toHaveLength(0);
    });

    test('rejects unverified, non-customer, and no-history identities at quote time', async () => {
      const unverified = fixture(1, 1, { customerVerified: false });
      await expect(unverified.service.quoteAssistedBooking(actor, unverified.assistedCommand())).rejects.toThrow(BadRequestException);
      const noHistory = fixture(1, 1, { customerHasHistory: false });
      await expect(noHistory.service.quoteAssistedBooking(actor, noHistory.assistedCommand())).rejects.toThrow(ForbiddenException);
      const wrongRole = fixture(1, 1, { customerRole: 'MERCHANT' });
      await expect(wrongRole.service.quoteAssistedBooking(actor, wrongRole.assistedCommand())).rejects.toThrow(BadRequestException);
    });

    test('requires BOOKINGS_MANAGE on associated shops and ignores caller-supplied email or amount', async () => {
      const readOnly = fixture(1, 1, { actorId: 4, boundUserId: 2, permissions: ['BOOKINGS_READ'] });
      await expect(readOnly.service.quoteAssistedBooking({ id: '4', role: 'MERCHANT' }, readOnly.assistedCommand())).rejects.toThrow(ForbiddenException);
      const manager = fixture(1, 1, { actorId: 4, boundUserId: 2, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'] });
      const input = manager.assistedCommand({ customerEmail: 'attacker@example.test', totalCents: 1 });
      const quote = await manager.service.quoteAssistedBooking({ id: '4', role: 'MERCHANT' }, input);
      expect(quote).toMatchObject({ totalCents: 20001, paymentMode: 'PAY_AT_STORE' });
      expect(quote).not.toHaveProperty('customerEmail'); expect(quote).not.toHaveProperty('userId');
      manager.setPermissions(['BOOKINGS_READ']);
      await expect(manager.service.createAssistedBooking({ id: '4', role: 'MERCHANT' }, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow(ForbiddenException);
    });

    test('same request key replays the same customer order, rejects a changed customer, and conflicts on an occupied slot', async () => {
      const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
      const first = await f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
      const replay = await f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
      expect(replay).toMatchObject({ id: first.id, userId: '5' }); expect(f.state().bookings).toHaveLength(1);
      const changed = { ...input, customerId: '6', quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
      await expect(f.service.createAssistedBooking(actor, changed)).rejects.toThrow(BadRequestException);
      const changedSlot = { ...input, startTime: '10:00', quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
      await expect(f.service.createAssistedBooking(actor, changedSlot)).rejects.toThrow('reused with different parameters');
      const second = fixture(), firstAttempt = second.assistedCommand({ requestKey: 'synthetic-assisted-request-002' });
      const secondAttempt = second.assistedCommand({ requestKey: 'synthetic-assisted-request-003' });
      const firstQuote = await second.service.quoteAssistedBooking(actor, firstAttempt);
      const secondQuote = await second.service.quoteAssistedBooking(actor, secondAttempt);
      await second.service.createAssistedBooking(actor, { ...firstAttempt, quoteHash: firstQuote.quoteHash, quoteExpiresAt: firstQuote.quoteExpiresAt });
      await expect(second.service.createAssistedBooking(actor, { ...secondAttempt, quoteHash: secondQuote.quoteHash, quoteExpiresAt: secondQuote.quoteExpiresAt })).rejects.toThrow(ConflictException);
    });

    test('an exact retry returns a committed order even if the customer later needs email reverification', async () => {
      const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
      const first = await f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
      f.setCustomerVerified(false);
      const replay = await f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
      expect(replay).toMatchObject({ id: first.id, userId: '5', status: 'PENDING' });
      expect(f.state().bookings).toHaveLength(1);
    });
    test('new assisted orders save a normalized contact that survives later account edits and exact recovery', async () => {
      const f = fixture(), input = f.assistedCommand({ contact: { name: '  Reception contact  ', phone: '+1 (202) 555-0199', email: 'SYNTHETIC.CUSTOMER@example.test' } });
      const quote = await f.service.quoteAssistedBooking(actor, input);
      const command = { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
      const first = await f.service.createAssistedBooking(actor, command);
      expect(first.contact).toMatchObject({ recorded: true, name: 'Reception contact', phone: '+12025550199', email: 'synthetic.customer@example.test', source: 'ONLINE_VERIFIED' });
      expect(f.state().bookings[0]).toMatchObject({ contactName: 'Reception contact', contactPhone: '+12025550199', contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactEmailVerifiedAt: expect.any(Date) });
      f.setCustomerAccount({ name: 'Changed profile', phone: '+12025550188', email: 'changed@example.test' });
      f.setCustomerVerified(false);
      const replay = await f.service.createAssistedBooking(actor, command);
      expect(replay.contact).toEqual(first.contact); expect(replay.id).toBe(first.id); expect(f.state().bookings).toHaveLength(1);
    });
    test('assisted quote and creation bind normalized contact and reject changes without new orders', async () => {
      const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
      await expect(f.service.createAssistedBooking(actor, { ...input, contact: { ...input.contact, name: 'Changed after review' }, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow(ConflictException);
      expect(f.state().bookings).toHaveLength(0);
      const first = await f.service.createAssistedBooking(actor, { ...input, contact: { ...input.contact, name: '  Synthetic customer  ', phone: '+1 (202) 555-0100' }, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
      await expect(f.service.createAssistedBooking(actor, { ...input, contact: { ...input.contact, phone: '+12025550199' }, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt })).rejects.toThrow('reused with different parameters');
      expect(f.state().bookings).toHaveLength(1); expect(first.status).toBe('PENDING'); expect(first.paidCents).toBe(0);
    });
    test('missing, invalid or another account email cannot create a new assisted order', async () => {
      for (const contact of [undefined, { ...onlineContact(), name: '' }, { ...onlineContact(), email: 'another@example.test' }]) {
        const f = fixture(), input = f.assistedCommand({ contact });
        await expect(f.service.quoteAssistedBooking(actor, input)).rejects.toThrow();
        await expect(f.service.createAssistedBooking(actor, { ...input, quoteHash: 'a'.repeat(64), quoteExpiresAt: '2035-01-01T09:00:00Z' })).rejects.toThrow();
        expect(f.state().bookings).toHaveLength(0); expect(f.state().locks).toHaveLength(0);
      }
    });
    test('a legacy no-contact pending command can only recover its exact already committed order', async () => {
      const f = fixture(), input = f.assistedCommand(), quote = await f.service.quoteAssistedBooking(actor, input);
      const first = await f.service.createAssistedBooking(actor, { ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt });
      const legacy = { ...input, contact: undefined };
      Object.assign(f.state().bookings[0], { requestHash: (f.service as any).request({ ...legacy, userId: '5', paymentMode: 'PAY_AT_STORE' }),
        contactName: null, contactPhone: null, contactEmail: null, contactVersion: null, contactSource: null, contactEmailVerifiedAt: null });
      f.setCustomerVerified(false);
      const replay = await f.service.createAssistedBooking(actor, legacy);
      expect(replay.id).toBe(first.id); expect(replay.contact).toMatchObject({ recorded: false }); expect(f.state().bookings).toHaveLength(1);
      await expect(f.service.createAssistedBooking(actor, { ...legacy, requestKey: 'legacy-never-committed' })).rejects.toThrow();
      expect(f.state().bookings).toHaveLength(1);
    });
  });
});
