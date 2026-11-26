import { restoreBookingCoupon } from './lifecycle';

describe('coupon restore lock order', () => {
  test('cancellation and hold expiry lock the coupon before wallet CAS and decrement its usage only once', async () => {
    const events: string[] = [];
    const wallet: any = { bookingId: 100n, status: 'USED', usedAt: new Date('2035-01-01T08:00:00Z') };
    let usedCount = 1;
    const tx: any = {
      $queryRaw: jest.fn(async (sql: any) => { expect(sql.sql).toContain('SELECT id FROM coupons WHERE id = ? FOR UPDATE'); expect(sql.values).toEqual([8n]); events.push('lock-coupon'); return []; }),
      userCoupon: { updateMany: jest.fn(async ({ where, data }: any) => {
        events.push('wallet-cas'); if (wallet.bookingId !== where.bookingId || wallet.status !== where.status) return { count: 0 };
        Object.assign(wallet, data); return { count: 1 };
      }) },
      coupon: { updateMany: jest.fn(async ({ where, data }: any) => {
        events.push('coupon-counter'); expect(where).toEqual({ id: 8n, usedCount: { gte: 1 } }); usedCount -= data.usedCount.decrement; return { count: 1 };
      }) },
    };
    const booking = { id: 100n, couponId: 8n, paidCents: 0 };
    await restoreBookingCoupon(tx, booking);
    expect(events).toEqual(['lock-coupon', 'wallet-cas', 'coupon-counter']);
    expect(wallet).toEqual({ bookingId: null, status: 'UNUSED', usedAt: null }); expect(usedCount).toBe(0);
    events.length = 0; await restoreBookingCoupon(tx, booking);
    expect(events).toEqual(['lock-coupon', 'wallet-cas']); expect(usedCount).toBe(0);
  });
  test('a paid booking or one without a coupon does not unlock a wallet or acquire a new coupon lock', async () => {
    const read = jest.fn(() => { throw Error('No coupon work is permitted'); });
    const tx = new Proxy({}, { get: read });
    await restoreBookingCoupon(tx, { id: 100n, couponId: null, paidCents: 0 });
    await restoreBookingCoupon(tx, { id: 100n, couponId: 8n, paidCents: 1 });
    expect(read).not.toHaveBeenCalled();
  });
});
