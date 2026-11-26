import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BookingService } from './booking.service';
import type { BookingAddOnView } from '../../common/booking-addons-view';
import { readDurationKind, type ServiceDurationKind } from '../../common/service-duration';

const selected = (participantIndex = 1, sequence = 1, addOnIds = ['2']) => [{ participantIndex, sequence, addOnIds }];
const onlineContact = (userId = '5') => ({ name: 'Synthetic customer', phone: '+12025550100', email: `synthetic.addon${userId}@example.test` });
const command = () => ({ userId: '5', shopId: '10', serviceId: '20', date: '2035-01-01', startTime: '09:00', requestKey: 'synthetic-addon-request-001', addOnSelections: selected(), contact: onlineContact() });
const syntheticPasswordHash = '$2b$10$' + 'a'.repeat(53);
// Keep Prisma-like Date instances in Jest's realm while preserving staged rollback.
function cloneFixture<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => cloneFixture(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneFixture(item)])) as T;
  return value;
}

function fixture(count = 1, basis = 'PER_PERSON', mainPrice = 5000, kind: ServiceDurationKind = 'TIMED', requiredStaffCount = count) {
  let state: any = { staffCounts: { '20': requiredStaffCount, '21': 1 }, availableStaff: ['30', '31'], bookings: [], items: [], snapshots: [], locks: [], kinds: { '20': kind, '21': 'TIMED' }, durations: { '20': 60, '21': 30 },
    configs: [{ id: 2n, serviceId: 20n, name: 'Essential Oil', priceCents: 1000, currency: 'usd', isActive: true, service: { id: 20n, shopId: 10n, isActive: true } },
      { id: 3n, serviceId: 21n, name: 'Warm Towel', priceCents: 500, currency: 'usd', isActive: true, service: { id: 21n, shopId: 10n, isActive: true } }],
    coupon: { id: 7n, couponId: 8n, userId: 5n, status: 'UNUSED', bookingId: null, coupon: { id: 8n } }, usedCount: 0 };
  let failSnapshot = false;
  const writes: string[] = [], events: string[] = [];
  const shop = { id: 10n, ownerId: 9n, timezone: 'UTC', status: 'APPROVED', deletedAt: null, shortName: 'synthetic-addon', name: 'Synthetic Add-on Studio',
    loginBinding: { userId: 9n, user: { id: 9n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: syntheticPasswordHash } },
    studioProfile: { features: { onlineBooking: true }, paymentPolicy: { payAtStoreEnabled: true }, bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [] } } };
  const serviceRow = (id: string) => ({ id: BigInt(id), shopId: 10n, name: id === '20' ? 'Main Massage' : 'Foot Care', isActive: true, durationKind: state.kinds[id], durationMin: state.durations[id], priceCents: id === '20' ? mainPrice : 3000 });
  function dbClient(data: any): any {
    const detail = (row: any) => row && ({ ...row, shop, service: serviceRow(row.serviceId.toString()),
      items: data.items.filter((item: any) => item.bookingId === row.id), addOns: data.snapshots.filter((item: any) => item.bookingId === row.id), resourceLocks: data.locks.filter((item: any) => item.bookingId === row.id) });
    return {
      $queryRaw: async () => { events.push('read-shop-lock'); return []; },
      user: { findUnique: async ({ where }: any) => [5n, 6n].includes(where.id)
        ? { id: where.id, role: 'CUSTOMER', email: `synthetic.addon${where.id}@example.test`, emailVerifiedAt: new Date('2035-01-01T00:00:00Z'), status: 'ACTIVE', deletedAt: null } : null },
      shopServiceAddOn: { findMany: jest.fn(async ({ where }: any) => { events.push('read-addon-config'); return data.configs.filter((row: any) => where.id.in.includes(row.id)); }) },
      booking: {
        findMany: async () => [],
        findUnique: async ({ where, select }: any) => { const row = where.userId_requestKey ? data.bookings.find((b: any) => b.userId === where.userId_requestKey.userId && b.requestKey === where.userId_requestKey.requestKey) : data.bookings.find((b: any) => b.id === where.id); return select && row ? { shopId: row.shopId } : detail(row); },
        findUniqueOrThrow: async ({ where }: any) => { const value = detail(data.bookings.find((b: any) => b.id === where.id)); if (!value) throw Error('Missing synthetic booking'); return value; },
        create: async ({ data: input }: any) => { writes.push('booking'); const row = { id: BigInt(data.bookings.length + 100), paidCents: 0, refundedCents: 0, paymentStatus: 'UNPAID', status: 'PENDING', reservationKind: 'SINGLE', createdAt: new Date(), deletedAt: null, ...input }; data.bookings.push(row); return row; },
        update: async ({ where, data: patch }: any) => { writes.push('booking-update'); const row = data.bookings.find((b: any) => b.id === where.id); Object.assign(row, patch); return detail(row); },
      },
      bookingItem: {
        create: async ({ data: input }: any) => { writes.push('main-item'); const row = { id: BigInt(data.items.length + 1000), sequence: 1, offsetMin: 0, ...input }; data.items.push(row); return row; },
        update: async ({ where, data: patch }: any) => { writes.push('main-item-update'); const row = data.items.find((item: any) => item.id === where.id); Object.assign(row, patch); return row; },
      },
      bookingAddOn: { createMany: async ({ data: rows }: any) => { writes.push('addon-snapshot'); if (failSnapshot) throw Error('Synthetic snapshot failure'); for (const row of rows) data.snapshots.push({ id: BigInt(data.snapshots.length + 5000), ...row }); return { count: rows.length }; } },
      shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: {
        updateMany: async ({ where, data: patch }: any) => { if (where.bookingId) for (const row of data.locks.filter((r: any) => r.bookingId === where.bookingId)) Object.assign(row, patch); return { count: 0 }; },
        createMany: async ({ data: rows }: any) => { writes.push('resource-locks'); for (const row of rows) data.locks.push({ id: BigInt(data.locks.length + 1), createdAt: new Date(), ...row }); return { count: rows.length }; },
      },
      userCoupon: {
        findFirst: async () => data.coupon.status === 'UNUSED' ? data.coupon : null,
        updateMany: async () => { writes.push('coupon-claim'); if (data.coupon.status !== 'UNUSED') return { count: 0 }; data.coupon.status = 'USED'; return { count: 1 }; },
        update: async ({ data: patch }: any) => { Object.assign(data.coupon, patch); return data.coupon; },
      },
      coupon: { update: async () => { data.usedCount++; } },
      refundRequest: { findFirst: async () => null },
      bookingSettlementEntry: { create: async () => { writes.push('zero-entry'); } },
      auditLog: { create: async () => { writes.push('audit'); } },
    };
  }
  const db: any = new Proxy({}, { get: (_target, key) => key === '$transaction' ? async (work: any) => { const staged = cloneFixture(state); const result = await work(dbClient(staged)); state = staged; return result; } : dbClient(state)[key] });
  const coupons = { evaluateCoupon: jest.fn(async (_coupon: any, _shop: bigint, price: number) => ({ valid: true, discountCents: price })) };
  const service = new BookingService(db, {} as any, {} as any, coupons as any);
  const context = jest.spyOn(service as any, 'context').mockImplementation(async (...args: any[]) => {
    const p = args[1], snapshot = args[3], main = serviceRow(p.serviceId), participants = snapshot?.count ?? count, staffCount = snapshot?.staffCount ?? state.staffCounts[p.serviceId];
    const start = new Date(`${p.date}T00:00:00Z`), end = new Date(+start + 86400000);
    return { shop, service: main, variant: null, durationKind: snapshot ? readDurationKind(snapshot.durationKind) : readDurationKind(main.durationKind), duration: snapshot?.duration ?? main.durationMin, unitPrice: snapshot?.unitPrice ?? main.priceCents,
      count: participants, staffCount, priceBasis: snapshot?.priceBasis ?? 'PER_BOOKING', currency: 'usd', staffBuffer: 0, roomBuffer: 0, roomType: participants === 2 ? 'COUPLE' : null, preferred: [], windows: [{ open: 0, close: 1440 }], bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [] },
      allocation: { count: participants, staffCount, duration: snapshot?.duration ?? main.durationMin, staffBuffer: 0, roomBuffer: 0, needsRoom: participants === 2,
        therapists: state.availableStaff.map((id: string) => ({ id, shifts: [{ start, end }], timeOff: [] })), rooms: [{ id: '40', maintenance: [] }], locks: [], legacy: [] } };
  });
  jest.spyOn(service as any, 'notifyBooking').mockResolvedValue(undefined);
  const createQuoted = async (input: any) => { const quote = await service.quoteBooking(input); return service.createBooking({ ...input, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt }); };
  return { service, createQuoted, state: () => state, writes, events, context, coupons, failSnapshot: () => { failSnapshot = true; } };
}

describe('add-ons across single, couple and plan booking lifecycles', () => {
  let previousFee: string | undefined, previousOnline: string | undefined;
  beforeAll(() => { previousFee = process.env.PLATFORM_FEE_BPS; process.env.PLATFORM_FEE_BPS = '0'; previousOnline = process.env.BOOKING_ONLINE_PAYMENT_ENABLED; delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; });
  afterAll(() => { if (previousFee === undefined) delete process.env.PLATFORM_FEE_BPS; else process.env.PLATFORM_FEE_BPS = previousFee;
    if (previousOnline === undefined) delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; else process.env.BOOKING_ONLINE_PAYMENT_ENABLED = previousOnline; });

  test('quote is read-only, coupon discounts only the main item, and persisted snapshot adds price without extending resources', async () => {
    const f = fixture(), input = { ...command(), couponId: '7' };
    const before = cloneFixture(f.state()), q = await f.service.quoteBooking(input);
    expect(q).toMatchObject({ mainSubtotalCents: 5000, addOnSubtotalCents: 1000, subtotalCents: 6000, discountEligibleCents: 5000, discountCents: 5000, tipCents: 0, totalCents: 1000, durationMin: 60 });
    expect(f.coupons.evaluateCoupon).toHaveBeenCalledWith(expect.anything(), 10n, 5000);
    expect(f.state()).toEqual(before); expect(f.writes).toEqual([]);
    const saved = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    expect(saved).toMatchObject({ priceCents: 6000, discountCents: 5000, totalCents: 1000, mainSubtotalCents: 5000, addOnSubtotalCents: 1000, durationMin: 60 });
    expect(saved.items).toHaveLength(1); expect(saved.items[0].priceCentsSnapshot).toBe(5000);
    expect(saved.addOns).toEqual([{ id: '5000', bookingItemId: '1000', sourceAddOnId: '2', participantIndex: 1, sequence: 1, name: 'Essential Oil', unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, currency: 'usd' }]);
    expect(f.state().locks).toHaveLength(1); expect(+saved.endTime - +saved.startTime).toBe(60 * 60000);
    expect(f.state().coupon.status).toBe('USED'); expect(f.state().usedCount).toBe(1);
  });
  test('four hands charge one package, assign two distinct staff to one guest item, and reschedule from saved staff counts', async () => {
    const f = fixture(1, 'PER_BOOKING', 10001, 'TIMED', 2), input = { ...command(), addOnSelections: [] };
    const saved = await f.createQuoted(input);
    expect(saved).toMatchObject({ participantCount: 1, requiredStaffCount: 2, mainSubtotalCents: 10001, totalCents: 10001 });
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toMatchObject({ participantIndex: 1, requiredStaffCountSnapshot: 2, assignedTherapistIds: ['30', '31'], priceCentsSnapshot: 10001 });
    expect(f.state().bookings[0]).toMatchObject({ participantCountSnapshot: 1, requiredStaffCountSnapshot: 2 });
    const original = f.state().locks.filter((row: any) => row.resourceType === 'THERAPIST');
    expect(original).toHaveLength(2); expect(new Set(original.map((row: any) => row.resourceId)).size).toBe(2);
    expect(original.every((row: any) => row.bookingItemId === f.state().items[0].id)).toBe(true);
    f.state().staffCounts['20'] = 1;
    const slots = await f.service.getRescheduleSlots(saved.id, '5', 'CUSTOMER', '2035-01-02');
    expect(slots).toMatchObject({ participantCount: 1, requiredStaffCount: 2, priceCents: 10001 });
    const moved = await f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '10:00' });
    expect(moved).toMatchObject({ participantCount: 1, requiredStaffCount: 2, totalCents: 10001 });
    expect(moved.items[0].assignedTherapistIds).toEqual(['30', '31']);
    expect(f.state().locks.filter((row: any) => row.status === 'ACTIVE')).toHaveLength(2);
    expect(f.state().locks.filter((row: any) => row.status === 'RELEASED')).toHaveLength(2);
  });
  test('four-hand reschedule with only one available staff preserves the original two active locks', async () => {
    const f = fixture(1, 'PER_BOOKING', 10001, 'TIMED', 2), saved = await f.createQuoted({ ...command(), addOnSelections: [] });
    const before = cloneFixture(f.state()); f.state().availableStaff = ['30'];
    await expect(f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '10:00' })).rejects.toThrow(ConflictException);
    expect(f.state().locks).toEqual(before.locks); expect(f.state().items).toEqual(before.items);
  });
  test('released four-hand assignments retain the latest two employees after a same-time staff replacement', async () => {
    const f=fixture(1,'PER_BOOKING',10001,'TIMED',2),saved=await f.createQuoted({...command(),addOnSelections:[]});
    f.state().availableStaff=['30','32'];
    const moved=await f.service.rescheduleBooking(saved.id,'5',{date:'2035-01-01',startTime:'09:00'});
    expect(moved.items[0].assignedTherapistIds).toEqual(['30','32']);
    f.state().bookings[0].status='CANCELLED'; for(const lock of f.state().locks)lock.status='RELEASED';
    const history=await f.service.getBooking(saved.id,'5');
    expect(history.items[0].assignedTherapistIds).toEqual(['30','32']);
  });
  test('a quote signed for four hands cannot silently become a one-therapist service at the same price', async () => {
    const f=fixture(1,'PER_BOOKING',10001,'TIMED',2),input={...command(),addOnSelections:[]},q=await f.service.quoteBooking(input);
    f.state().staffCounts['20']=1;
    await expect(f.service.createBooking({...input,quoteHash:q.quoteHash,quoteExpiresAt:q.quoteExpiresAt})).rejects.toThrow(ConflictException);
    expect(f.state().bookings).toEqual([]);expect(f.state().locks).toEqual([]);
  });
  test('a four-hand package cannot be inserted into the one-staff-per-segment plan flow', async () => {
    const f = fixture(1, 'PER_BOOKING', 5000, 'TIMED', 2);
    await expect(f.service.createPlan({ userId: '5', shopId: '10', date: '2035-01-01', startTime: '09:00', requestKey: 'four-hands-plan-rejected', contact: onlineContact(), items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] })).rejects.toThrow(BadRequestException);
    expect(f.state().bookings).toEqual([]); expect(f.state().locks).toEqual([]);
  });
  test('couple add-on attaches once only to the explicitly selected participant and leaves both main shares/duration intact', async () => {
    const f = fixture(2), input = { ...command(), addOnSelections: selected(2) }, q = await f.service.quoteBooking(input);
    const saved = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    expect(saved.priceCents).toBe(6000); expect(saved.mainSubtotalCents).toBe(5000); expect(saved.addOnSubtotalCents).toBe(1000);
    expect(saved.items.map((item: any) => item.priceCentsSnapshot)).toEqual([2500, 2500]);
    expect(saved.addOns.map((row: BookingAddOnView) => row.participantIndex)).toEqual([2]); expect(saved.durationMin).toBe(60);
    expect(f.state().locks.filter((row: any) => row.resourceType === 'THERAPIST')).toHaveLength(2);
  });
  test('couple PER_BOOKING odd-cent package keeps one base total and only the chosen extra charge', async () => {
    const f = fixture(2, 'PER_BOOKING', 5011), input = { ...command(), addOnSelections: selected(2) }, q = await f.service.quoteBooking(input);
    const saved = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    expect(saved.mainSubtotalCents).toBe(5011); expect(saved.priceCents).toBe(6011);
    expect(saved.items.map((item: any) => item.priceCentsSnapshot)).toEqual([2506, 2505]);
    expect(saved.addOns).toHaveLength(1); expect(saved.addOns[0].participantIndex).toBe(2);
  });
  test('plan quote/create attaches extras to their exact service sequence without adding an itinerary segment or time', async () => {
    const f = fixture(), input = { userId: '5', shopId: '10', date: '2035-01-01', startTime: '09:00', requestKey: 'synthetic-addon-plan-001', contact: onlineContact(),
      items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '21' }], addOnSelections: [...selected(), ...selected(1, 2, ['3'])] };
    const before = cloneFixture(f.state()), q = await f.service.quotePlan(input); expect(f.state()).toEqual(before); expect(f.writes).toEqual([]);
    expect(q).toMatchObject({ mainSubtotalCents: 8000, addOnSubtotalCents: 1500, subtotalCents: 9500, durationMin: 90 });
    const saved = await f.service.createPlan({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    expect(saved.priceCents).toBe(9500); expect(saved.items).toHaveLength(2); expect(saved.durationMin).toBe(90);
    expect(saved.addOns.map((row: BookingAddOnView) => [row.sequence, row.name])).toEqual([[1, 'Essential Oil'], [2, 'Warm Towel']]);
    expect(saved.items.map((item: any) => item.priceCentsSnapshot)).toEqual([5000, 3000]);
  });
  test('changed configuration, names or coupon/time/identity material rejects stale quotes before any coupon/order/snapshot write', async () => {
    for (const change of ['price', 'name', 'inactive', 'time', 'coupon', 'user']) {
      const f = fixture(), input = command(), q = await f.service.quoteBooking(input);
      if (change === 'price') f.state().configs[0].priceCents = 2000;
      if (change === 'name') f.state().configs[0].name = 'Different Oil';
      if (change === 'inactive') f.state().configs[0].isActive = false;
      const submit = { ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt,
        ...(change === 'time' ? { startTime: '10:00' } : {}), ...(change === 'coupon' ? { couponId: '7' } : {}), ...(change === 'user' ? { userId: '6', contact: onlineContact('6') } : {}) };
      await expect(f.service.createBooking(submit)).rejects.toThrow(ConflictException);
      expect(f.writes).toEqual([]); expect(f.state().bookings).toEqual([]); expect(f.state().coupon.status).toBe('UNUSED');
    }
  });
  test('same request key replays original immutable rows before configuration lookup despite expired quote or deactivated config', async () => {
    const f = fixture(), input = command(), q = await f.service.quoteBooking(input);
    const first = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    f.state().configs[0].isActive = false; f.state().configs[0].priceCents = 9000; f.state().configs[0].name = 'Renamed';
    f.context.mockClear(); const configReads = f.events.filter(x => x === 'read-addon-config').length;
    const again = await f.service.createBooking({ ...input, quoteHash: 'a'.repeat(64), quoteExpiresAt: '2000-01-01T00:00:00.000Z' });
    expect(again).toEqual(first); expect(f.context).not.toHaveBeenCalled(); expect(f.events.filter(x => x === 'read-addon-config')).toHaveLength(configReads);
    expect(f.state().bookings).toHaveLength(1); expect(f.state().snapshots).toHaveLength(1);
    await expect(f.service.createBooking({ ...input, addOnSelections: selected(2) })).rejects.toThrow(ConflictException);
  });
  test('timed requests bind normalized contact in the create hash and require a signed quote and stable key even without add-ons', async () => {
    const f = fixture(), { addOnSelections: _unused, ...input } = command();
    const result = await f.createQuoted(input);
    const hash = createHash('sha256').update(JSON.stringify({ shopId: '10', serviceId: '20', variantId: null, preferredTherapistIds: [], date: input.date, startTime: input.startTime, durationMin: null, notes: null, couponId: null, paymentMode: 'PAY_AT_STORE', contactVersion: 1, contact: onlineContact() })).digest('hex');
    expect(f.state().bookings[0].requestHash).toBe(hash); expect(result.addOns).toEqual([]); expect(result.mainSubtotalCents).toBe(5000); expect(result.addOnSubtotalCents).toBe(0);
    expect(f.events).not.toContain('read-addon-config'); expect(f.writes).not.toContain('addon-snapshot');
    await expect(f.service.createBooking({ ...input, requestKey: undefined })).rejects.toThrow(BadRequestException);
  });
  test('extra-only, wrong-parent and cross-main selections fail entirely, and nonempty extras require stable key plus signed quote', async () => {
    for (const input of [{ ...command(), requestKey: undefined }, { ...command(), quoteHash: undefined }, { ...command(), serviceId: '' }, { ...command(), addOnSelections: selected(2) }, { ...command(), addOnSelections: selected(1, 1, ['3']) }]) {
      const f = fixture(); await expect(f.service.createBooking(input)).rejects.toThrow(); expect(f.state().bookings).toEqual([]); expect(f.writes).toEqual([]);
    }
  });
  test('snapshot persistence failure rolls back main order, coupon and allocation writes in the same staged transaction', async () => {
    const f = fixture(), input = { ...command(), couponId: '7' }, q = await f.service.quoteBooking(input), before = cloneFixture(f.state());
    f.failSnapshot(); await expect(f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt })).rejects.toThrow('Synthetic snapshot failure');
    expect(f.state()).toEqual(before);
  });
  test('single and plan reschedules retain original extras and amounts after configuration changes without extra resource locks', async () => {
    for (const kind of ['SINGLE', 'PLAN']) {
      const f = fixture(), single = command(), plan = { ...single, items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '21' }] };
      const q = kind === 'PLAN' ? await f.service.quotePlan(plan) : await f.service.quoteBooking(single);
      const saved = kind === 'PLAN' ? await f.service.createPlan({ ...plan, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt }) : await f.service.createBooking({ ...single, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
      const before = cloneFixture(saved.addOns), count = f.events.filter(x => x === 'read-addon-config').length;
      f.state().configs[0].isActive = false; f.state().configs[0].priceCents = 9000;
      const moved = await f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '10:00' });
      expect(moved.addOns).toEqual(before); expect(moved.priceCents).toBe(saved.priceCents); expect(moved.totalCents).toBe(saved.totalCents); expect(moved.durationMin).toBe(saved.durationMin);
      expect(f.events.filter(x => x === 'read-addon-config')).toHaveLength(count);
    }
  });
});

describe('non-fixed primary duration snapshots and reserved blocks', () => {
  let previousFee: string | undefined, previousOnline: string | undefined;
  beforeAll(() => { previousFee = process.env.PLATFORM_FEE_BPS; process.env.PLATFORM_FEE_BPS = '0'; previousOnline = process.env.BOOKING_ONLINE_PAYMENT_ENABLED; delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; });
  afterAll(() => { if (previousFee === undefined) delete process.env.PLATFORM_FEE_BPS; else process.env.PLATFORM_FEE_BPS = previousFee;
    if (previousOnline === undefined) delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; else process.env.BOOKING_ONLINE_PAYMENT_ENABLED = previousOnline; });
  const noExtras = () => { const { addOnSelections: _unused, ...input } = command(); return input; };
  test('PER_SESSION and VARIABLE without extras require signed quote and stable key, leaving incomplete attempts unwritten', async () => {
    for (const kind of ['PER_SESSION', 'VARIABLE'] as const) {
      const f = fixture(1, 'PER_PERSON', 5000, kind), input = noExtras();
      await expect(f.service.createBooking({ ...input, requestKey: undefined })).rejects.toThrow(BadRequestException);
      await expect(f.service.createBooking({ ...input, requestKey: 'short' })).rejects.toThrow(BadRequestException);
      await expect(f.service.createBooking(input)).rejects.toThrow(ConflictException);
      expect(f.state().bookings).toEqual([]); expect(f.writes).toEqual([]);
      const q = await f.service.quoteBooking(input);
      expect(q).toMatchObject({ durationKind: kind, durationMin: 60, reservedDurationMin: 60, mainSubtotalCents: 5000, addOnSubtotalCents: 0, totalCents: 5000 });
      const row = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
      expect(row).toMatchObject({ durationKind: kind, durationMin: 60, reservedDurationMin: 60, totalCents: 5000 });
      expect(row.items[0]).toMatchObject({ durationKindSnapshot: kind, durationKind: kind, durationMin: 60, reservedDurationMin: 60, priceCentsSnapshot: 5000 });
      expect(f.state().snapshots).toEqual([]); expect(f.state().locks).toHaveLength(1);
    }
  });
  test('single and couple quote vectors have all six authoritative fields and no implicit per-session price multiplication change', async () => {
    for (const count of [1, 2]) {
      const f = fixture(count, 'PER_BOOKING', 5011, 'PER_SESSION'), input = noExtras(), before = cloneFixture(f.state()), q = await f.service.quoteBooking(input);
      expect(f.state()).toEqual(before); expect(f.writes).toEqual([]);
      expect(q.mainDurations).toEqual(Array.from({ length: count }, (_, i) => ({ participantIndex: i + 1, sequence: 1, serviceId: '20', variantId: null, durationKind: 'PER_SESSION', reservedDurationMin: 60 })));
      expect(Object.keys(q.mainDurations[0]).sort()).toEqual(['participantIndex','sequence','serviceId','variantId','durationKind','reservedDurationMin'].sort());
      const saved = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
      expect(saved.totalCents).toBe(5011); expect(saved.durationMin).toBe(60); expect(saved.items).toHaveLength(count);
      expect(saved.items.reduce((sum: number, item: any) => sum + item.priceCentsSnapshot, 0)).toBe(5011);
    }
  });
  test('kind-only drift in either direction requires409 even when price and block are unchanged', async () => {
    for (const [from, to] of [['TIMED', 'VARIABLE'], ['VARIABLE', 'TIMED'], ['PER_SESSION', 'VARIABLE']] as const) {
      const f = fixture(1, 'PER_PERSON', 5000, from), input = noExtras(), q = await f.service.quoteBooking(input);
      f.state().kinds['20'] = to;
      await expect(f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt })).rejects.toThrow(ConflictException);
      expect(f.state().bookings).toEqual([]); expect(f.writes).toEqual([]);
    }
  });
  test('a new quote with changed reserved block still charges the same explicit session price and reserves the new block', async () => {
    const f = fixture(1, 'PER_PERSON', 5000, 'VARIABLE'), input = noExtras(), old = await f.service.quoteBooking(input);
    f.state().durations['20'] = 180;
    await expect(f.service.createBooking({ ...input, quoteHash: old.quoteHash, quoteExpiresAt: old.quoteExpiresAt })).rejects.toThrow(ConflictException);
    const q = await f.service.quoteBooking(input), saved = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    expect(q.mainDurations[0].reservedDurationMin).toBe(180); expect(saved.totalCents).toBe(5000);
    expect(+saved.endTime - +saved.startTime).toBe(180 * 60000);
  });
  test('mixed PLAN signs every main coordinate and stores independent kinds while top duration remains the itinerary span', async () => {
    const f = fixture(1, 'PER_PERSON', 5000, 'PER_SESSION'); f.state().kinds['21'] = 'VARIABLE';
    const input = { userId: '5', shopId: '10', date: '2035-01-01', startTime: '09:00', requestKey: 'synthetic-duration-plan-01', contact: onlineContact(), items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }, { participantIndex: 1, sequence: 2, serviceId: '21' }] };
    await expect(f.service.createPlan(input)).rejects.toThrow(ConflictException);
    const q = await f.service.quotePlan(input);
    expect(q).toMatchObject({ durationKind: 'MIXED', durationMin: 90, reservedDurationMin: 90, totalCents: 8000 });
    expect(q.mainDurations.map(row => [row.sequence, row.durationKind, row.reservedDurationMin])).toEqual([[1, 'PER_SESSION', 60], [2, 'VARIABLE', 30]]);
    const saved = await f.service.createPlan({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
    expect(saved.durationKind).toBe('MIXED'); expect(saved.items.map((item: any) => item.durationKindSnapshot)).toEqual(['PER_SESSION', 'VARIABLE']);
    f.state().kinds['20'] = 'TIMED'; f.state().kinds['21'] = 'TIMED'; f.state().durations['20'] = 180;
    const moved = await f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '10:00' });
    expect(moved.durationKind).toBe('MIXED'); expect(moved.reservedDurationMin).toBe(90); expect(moved.totalCents).toBe(8000);
    expect(moved.items.map((item: any) => [item.durationKind, item.reservedDurationMin])).toEqual([['PER_SESSION', 60], ['VARIABLE', 30]]);
  });
  test('new single/couple reschedule never rereads live kind/block to change historical meaning or amounts', async () => {
    for (const count of [1, 2]) {
      const f = fixture(count, 'PER_PERSON', 5000, 'VARIABLE'), input = noExtras(), q = await f.service.quoteBooking(input);
      const saved = await f.service.createBooking({ ...input, quoteHash: q.quoteHash, quoteExpiresAt: q.quoteExpiresAt });
      f.state().kinds['20'] = 'TIMED'; f.state().durations['20'] = 180;
      const slots = await f.service.getRescheduleSlots(saved.id, '5', 'CUSTOMER', '2035-01-02');
      expect(slots).toMatchObject({ durationKind: 'VARIABLE', durationMin: 60, reservedDurationMin: 60, priceCents: saved.priceCents });
      const moved = await f.service.rescheduleBooking(saved.id, '5', { date: '2035-01-02', startTime: '10:00' });
      expect(moved.durationKind).toBe('VARIABLE'); expect(moved.durationMin).toBe(60); expect(moved.totalCents).toBe(saved.totalCents);
      expect(moved.service).toMatchObject({ durationKind: 'VARIABLE', reservedDurationMin: 60, durationMin: 60 });
      expect(moved.items.every((item: any) => item.durationKindSnapshot === 'VARIABLE' && item.durationMin === 60)).toBe(true);
    }
  });
  test('old TIMED command hash and replay do not read changed live kind or expired quote', async () => {
    const f = fixture(), input = noExtras(), first = await f.createQuoted(input), hash = f.state().bookings[0].requestHash;
    f.state().kinds['20'] = 'VARIABLE'; f.context.mockClear();
    const again = await f.service.createBooking({ ...input, quoteHash: 'a'.repeat(64), quoteExpiresAt: '2000-01-01T00:00:00.000Z' });
    expect(again).toEqual(first); expect(again.durationKind).toBe('TIMED'); expect(f.context).not.toHaveBeenCalled();
    expect(f.state().bookings[0].requestHash).toBe(hash); expect(f.state().bookings).toHaveLength(1);
  });
  test('rescheduling an old itemless booking freezes TIMED when creating its first item despite a live VARIABLE service', async () => {
    const f = fixture(), input = noExtras(), old = await f.createQuoted(input); f.state().items = [];
    f.state().kinds['20'] = 'VARIABLE'; f.state().durations['20'] = 180;
    const moved = await f.service.rescheduleBooking(old.id, '5', { date: '2035-01-02', startTime: '10:00' });
    expect(moved).toMatchObject({ durationKind: 'TIMED', durationMin: 60, reservedDurationMin: 60, totalCents: 5000 });
    expect(moved.items).toHaveLength(1); expect(moved.items[0].durationKindSnapshot).toBe('TIMED');
  });
});
