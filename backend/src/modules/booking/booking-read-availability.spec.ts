jest.mock('../auth/security', () => ({ jwtSecret: () => 'Synthetic-booking-read-quote-key-only-2035-0123456789' }));
import { ConflictException } from '@nestjs/common';
import { BookingService } from './booking.service';

const at = (time: string) => new Date('2035-01-01T' + time + ':00Z');
const syntheticPasswordHash = '$2b$10$' + 'a'.repeat(53);
const selection = { userId: '5', shopId: '10', date: '2035-01-01', startTime: '09:00', paymentMode: 'PAY_AT_STORE' as const,
  items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] };
function match(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => match(row, part));
    if (key === 'AND') return value.every((part: any) => match(row, part));
    if (key === 'items') return row.items.length === 0;
    if (key === 'booking') return match(row.booking, value);
    if (value === null || typeof value !== 'object' || value instanceof Date) return row[key] === value;
    return Object.entries(value).every(([operator, operand]: [string, any]) => operator === 'in' ? operand.includes(row[key])
      : operator === 'not' ? row[key] !== operand : operator === 'gt' ? row[key] != null && row[key] > operand : operator === 'lt' ? row[key] < operand : false);
  });
}
function fixture() {
  const shop = { id: 10n, deletedAt: null, status: 'APPROVED', timezone: 'UTC', businessHours: { monday: { open: '09:00', close: '18:00' } },
    loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: syntheticPasswordHash } }, studioProfile: { features: { onlineBooking: true }, paymentPolicy: { payAtStoreEnabled: true } } };
  const service = { id: 20n, shopId: 10n, isActive: true, name: 'Synthetic quote service', durationKind: 'TIMED', durationMin: 60, priceCents: 6000,
    priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: 'SINGLE', staffBufferMin: 15, roomBufferMin: 10, variants: [] };
  const booking: any = { id: 100n, shopId: 10n, status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, deletedAt: null,
    holdExpiresAt: at('07:59'), therapistId: null, items: [], startTime: at('09:00'), endTime: at('10:00') };
  const locks: any[] = [
    { shopId: 10n, resourceType: 'THERAPIST', resourceId: 8n, status: 'ACTIVE', startAtUtc: at('09:00'), endAtUtc: at('10:15'), booking },
    { shopId: 10n, resourceType: 'ROOM', resourceId: 40n, status: 'ACTIVE', startAtUtc: at('09:00'), endAtUtc: at('10:10'), booking },
  ];
  const write = jest.fn(() => { throw Error('Quote must never mutate holds, resources or outbox'); });
  const db: any = { $transaction: jest.fn(async (work: any) => work(db)), $queryRaw: jest.fn(async () => []),
    shop: { findUnique: jest.fn(async () => shop) }, shopService: { findUnique: jest.fn(async () => service) },
    therapist: { findMany: jest.fn(async () => [{ id: 8n, scheduleMode: 'SHOP', shifts: [], timeOff: [] }]) },
    shopRoom: { findMany: jest.fn(async () => [{ id: 40n, maintenance: [] }]) },
    booking: { findMany: jest.fn(async ({ where }: any) => match(booking, where) ? [booking] : []), update: write, create: write },
    shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: { findMany: jest.fn(async ({ where }: any) => locks.filter(lock => match(lock, where))), updateMany: write, createMany: write },
    notificationOutbox: { create: write }, userCoupon: { updateMany: write },
  };
  return { db, booking, locks, write, service: new BookingService(db, {} as any, {} as any, {} as any) };
}

describe('read-only PLAN quote excludes only clearly expired unpaid reservations', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(at('08:00')); });
  afterEach(() => { jest.useRealTimers(); });
  test('expired lock and unassigned legacy hold no longer block a quote before lazy cleanup', async () => {
    const f = fixture(), before = structuredClone({ booking: f.booking, locks: f.locks });
    const quote = await f.service.quotePlan(selection);
    expect(quote).toMatchObject({ mainSubtotalCents: 6000, totalCents: 6000, durationMin: 60 });
    expect(quote.quoteHash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.write).not.toHaveBeenCalled(); expect({ booking: f.booking, locks: f.locks }).toEqual(before);
    expect(f.db.bookingResourceLock.findMany.mock.calls[0][0].where.booking).toBeDefined();
    expect(f.db.booking.findMany.mock.calls[0][0].where.OR).toBeDefined();
  });
  test.each([
    { holdExpiresAt: at('08:00') },
    { holdExpiresAt: at('07:59'), status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0 },
  ])('exactly expired wholly unpaid holds remain nonblocking (%p)', async patch => {
    const f = fixture(); Object.assign(f.booking, patch); await expect(f.service.quotePlan(selection)).resolves.toMatchObject({ totalCents: 6000 }); expect(f.write).not.toHaveBeenCalled();
  });
  test.each([
    { holdExpiresAt: at('08:01') }, { holdExpiresAt: null }, { paidCents: 1 }, { paymentStatus: 'PAID' }, { status: 'CONFIRMED' },
  ])('live, paid, confirmed and legacy null-expiry reservations still block (%p)', async patch => {
    const f = fixture(); Object.assign(f.booking, patch); await expect(f.service.quotePlan(selection)).rejects.toThrow(ConflictException); expect(f.write).not.toHaveBeenCalled();
  });
  test.each(['COMPLETED', 'CANCELLED', 'REFUNDED'])('terminal %s ACTIVE cleanup still blocks even if the service body already ended', async status => {
    const f = fixture(); Object.assign(f.booking, { status, startTime: at('07:00'), endTime: at('08:00') });
    f.locks.forEach(lock => { lock.startAtUtc = at('07:00'); lock.endAtUtc = at('09:15'); });
    await expect(f.service.quotePlan(selection)).rejects.toThrow(ConflictException); expect(f.write).not.toHaveBeenCalled();
  });
  test('read-only ordinary quote retains its pricing-only contract and does not expire a live hold', async () => {
    const f = fixture(); f.booking.holdExpiresAt = at('08:01');
    await expect(f.service.quoteBooking({ userId: '5', shopId: '10', serviceId: '20', date: '2035-01-01', startTime: '09:00', paymentMode: 'PAY_AT_STORE' })).resolves.toMatchObject({ totalCents: 6000 });
    expect(f.write).not.toHaveBeenCalled(); expect(f.booking.status).toBe('PENDING');
  });
  test.each([false,true])('ordinary and PLAN quotes both reject SHOP block preparation overlap (PLAN=%s)',async plan=>{
    const f=fixture();
    f.db.shopCalendarBlock.findMany=jest.fn(async()=>[{startAtUtc:at('10:10'),endAtUtc:at('10:30')}]);
    const promise=plan?f.service.quotePlan(selection):f.service.quoteBooking({userId:'5',shopId:'10',serviceId:'20',date:'2035-01-01',startTime:'09:00',paymentMode:'PAY_AT_STORE'});
    await expect(promise).rejects.toThrow(ConflictException);
    expect(f.write).not.toHaveBeenCalled();
  });
});
