import { StudioService } from './studio.service';

/** Local query-aware doubles: the work queue is a fulfilment count, while the
 * retained historical paid count keeps its original status/payment predicate. */
function fixture() {
  const rows = [
    { id: 1n, deletedAt: null, status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', shop: { ownerId: 2n } },
    { id: 2n, deletedAt: null, status: 'CONFIRMED', paymentStatus: 'PAID', paymentMode: 'ONLINE', shop: { ownerId: 2n } },
    { id: 3n, deletedAt: null, status: 'PENDING', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', shop: { ownerId: 2n } },
    { id: 4n, deletedAt: null, status: 'COMPLETED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', shop: { ownerId: 2n } },
    { id: 5n, deletedAt: new Date('2035-01-01T00:00:00Z'), status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', shop: { ownerId: 2n } },
    { id: 6n, deletedAt: null, status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', shop: { ownerId: 3n } },
  ];
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (value && typeof value === 'object') return matches(row[key], value);
    return row[key] === value;
  });
  const count = jest.fn(async ({ where }: any) => rows.filter(row => matches(row, where)).length);
  const financialRead = jest.fn(() => { throw Error('The operating work queue must not read or rewrite financial ledgers'); });
  const prisma: any = { booking: { count }, shop: { count: jest.fn(async () => 0) }, region: { count: jest.fn(async () => 0) },
    coupon: { count: jest.fn(async () => 0) }, user: { count: jest.fn(async () => 0) }, giftCardProduct: { count: jest.fn(async () => 0) },
    merchantTransaction: { findMany: financialRead }, merchantProfile: { findUnique: financialRead } };
  return { service: new StudioService(prisma), rows, count, financialRead };
}

describe('studio confirmed fulfilment queue', () => {
  test('all authorized confirmed orders include unpaid offline orders, without changing the historical paid count or reading income ledgers', async () => {
    const previous = process.env.BOOKING_ONLINE_PAYMENT_ENABLED;
    try {
      process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'false';
      const f = fixture(), before = structuredClone(f.rows), summary = await f.service.summary({ id: '1', role: 'ADMIN' });
      expect(summary.workQueues).toMatchObject({ pendingBookings: 1, confirmedBookings: 3, confirmedPaidBookings: 1, refundingBookings: 0 });
      expect(f.count).toHaveBeenCalledWith({ where: { AND: [{ deletedAt: null }, { status: 'CONFIRMED' }] } });
      expect(f.count).toHaveBeenCalledWith({ where: { AND: [{ deletedAt: null }, { status: 'CONFIRMED', paymentStatus: 'PAID' }] } });
      expect(f.rows).toEqual(before); expect(f.financialRead).not.toHaveBeenCalled();
    } finally { if (previous === undefined) delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; else process.env.BOOKING_ONLINE_PAYMENT_ENABLED = previous; }
  });
  test('confirmed and historical paid counts retain the same existing store scope and ignore pending, completed and hidden bookings', async () => {
    const f = fixture(), summary = await f.service.summary({ id: '2', role: 'MERCHANT' });
    expect(summary.workQueues).toMatchObject({ pendingBookings: 1, confirmedBookings: 2, confirmedPaidBookings: 1 });
    const scope = { deletedAt: null, shop: { ownerId: 2n } };
    expect(f.count).toHaveBeenCalledWith({ where: { AND: [scope, { status: 'CONFIRMED' }] } });
    expect(f.count).toHaveBeenCalledWith({ where: { AND: [scope, { status: 'CONFIRMED', paymentStatus: 'PAID' }] } });
    expect(f.financialRead).not.toHaveBeenCalled();
  });
});
