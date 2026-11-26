import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MerchantService } from './merchant.service';

const profile = () => ({ id: 50n, userId: 9n, shopId: 10n, balanceCents: 1200, pendingCents: 340, totalEarnedCents: 15000 });
function fixture() {
  const account = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null });
  const state: any = {
    users: [account(1n, 'ADMIN'), account(2n), account(3n), account(4n, 'STAFF'), account(5n, 'CUSTOMER'), account(9n)],
    shop: { id: 10n, ownerId: 9n, status: 'APPROVED', deletedAt: null, timezone: 'America/Los_Angeles' }, binding: { userId: 2n },
    associatedGrant: null, staffGrant: null, profile: null, transactions: [],
    bookingCount: 4, statuses: [{ status: 'CONFIRMED', _count: 3 }, { status: 'COMPLETED', _count: 1 }],
    reviews: { _avg: { rating: 4.5 }, _count: 2 },
  };
  const events: string[] = [];
  const write = jest.fn(() => { throw new Error('Dashboard reads must never create, upsert or update records'); });
  const db: any = {
    user: { findFirst: jest.fn(async ({ where }: any) => {
      events.push('authorize-actor');
      return state.users.find((row: any) => row.id === where.id && row.role === where.role && row.status === 'ACTIVE' && !row.deletedAt) ?? null;
    }) },
    shop: { findFirst: jest.fn(async ({ where }: any) => {
      events.push('authorize-shop');
      if (!state.shop || where.id !== state.shop.id || state.shop.deletedAt) return null;
      return { ...state.shop, owner: state.users.find((row: any) => row.id === state.shop.ownerId), loginBinding: state.binding ? { ...state.binding, user: state.users.find((row: any) => row.id === state.binding.userId) } : null };
    }) },
    shopAccountGrant: { findFirst: jest.fn(async () => state.associatedGrant) },
    shopStaffGrant: { findUnique: jest.fn(async () => state.staffGrant) },
    merchantProfile: {
      findUnique: jest.fn(async () => { events.push('read-profile'); return state.profile; }),
      create: write, update: write, upsert: write, updateMany: write,
    },
    merchantTransaction: {
      findMany: jest.fn(async ({ where }: any) => {
        events.push('read-transactions');
        return state.transactions.filter((row: any) => row.profileId === where.profileId && where.type?.in.includes(row.type) && row.status === where.status
          && (!where.createdAt?.gte || row.createdAt >= where.createdAt.gte) && (!where.createdAt?.lt || row.createdAt < where.createdAt.lt))
          .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
      }),
      create: write, update: write, upsert: write,
    },
    booking: {
      groupBy: jest.fn(async () => { events.push('read-booking-status'); return state.statuses; }),
      count: jest.fn(async () => { events.push('read-booking-count'); return state.bookingCount; }),
      create: write, update: write,
    },
    review: { aggregate: jest.fn(async () => { events.push('read-reviews'); return state.reviews; }) },
    auditLog: { create: write }, $transaction: write, $executeRaw: write,
  };
  return { state, db, events, write, service: new MerchantService(db, {} as any) };
}
const expectNoStats = (f: ReturnType<typeof fixture>) => {
  expect(f.db.merchantTransaction.findMany).not.toHaveBeenCalled();
  expect(f.db.booking.groupBy).not.toHaveBeenCalled();
  expect(f.db.booking.count).not.toHaveBeenCalled();
  expect(f.db.review.aggregate).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
};

describe('merchant dashboard operating statistics before ledger configuration', () => {
  test('missing ledger returns explicit unavailable finance and real operating statistics without transaction reads or record provisioning', async () => {
    const f = fixture(), before = structuredClone(f.state);
    const result = await f.service.getDashboard('2', '10');
    expect(result).toEqual({
      shopId: '10', timezone: 'America/Los_Angeles', ledgerConfigured: false, financeUnavailableReason: 'LEDGER_NOT_CONFIGURED',
      overview: { totalRevenue: null, totalFees: null, netRevenue: null, totalBookings: 4, avgRating: 4.5, totalReviews: 2 },
      balanceCents: null, pendingCents: null, totalEarnedCents: null,
      bookingStatusDistribution: [{ status: 'CONFIRMED', count: 3 }, { status: 'COMPLETED', count: 1 }],
      dailyRevenue: null, recentTransactions: null,
    });
    expect(f.db.merchantProfile.findUnique).toHaveBeenCalledTimes(1);
    expect(f.db.merchantProfile.findUnique).toHaveBeenCalledWith({ where: { shopId: 10n } });
    expect(f.db.merchantTransaction.findMany).not.toHaveBeenCalled();
    expect(f.db.booking.groupBy).toHaveBeenCalledWith({ by: ['status'], where: { shopId: 10n }, _count: true });
    expect(f.db.booking.count).toHaveBeenCalledWith({ where: { shopId: 10n } });
    expect(f.db.review.aggregate).toHaveBeenCalledWith({ where: { shopId: 10n }, _avg: { rating: true }, _count: true });
    expect(f.events.slice(0, 3)).toEqual(['authorize-actor', 'authorize-shop', 'read-profile']);
    expect(f.write).not.toHaveBeenCalled(); expect(f.state).toEqual(before);
  });

  test('missing ledger with no reviews/bookings keeps empty operating statistics, distinct from unknown financial totals', async () => {
    const f = fixture(); f.state.reviews = { _avg: { rating: null }, _count: 0 }; f.state.bookingCount = 0; f.state.statuses = [];
    const result = await f.service.getDashboard('2', '10', '2026-01-01', '2026-01-03');
    expect(result.overview).toEqual({ totalRevenue: null, totalFees: null, netRevenue: null, totalBookings: 0, avgRating: 0, totalReviews: 0 });
    expect(result.bookingStatusDistribution).toEqual([]);
    expect(result.dailyRevenue).toBeNull(); expect(result.recentTransactions).toBeNull();
    expect(f.db.booking.count).toHaveBeenCalledWith({ where: { shopId: 10n, createdAt: { gte: new Date('2026-01-01T08:00:00Z'), lt: new Date('2026-01-04T08:00:00Z') } } });
    expect(f.db.merchantTransaction.findMany).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });

  test('configured ledger retains signed payments/refunds, fees, net totals, scoped balances, daily ordering and transaction views', async () => {
    const f = fixture(); f.state.profile = profile();
    const row = (id: bigint, day: number, type: string, amount: number, fee: number, net: number, extra = {}) => ({ id, profileId: 50n, bookingId: id + 100n, type, amount, fee, net, status: 'COMPLETED', createdAt: new Date(`2026-01-0${day}T12:00:00Z`), description: `Synthetic ${type}`, ...extra });
    f.state.transactions = [row(1n, 1, 'PAYMENT', 10000, 500, 9500), row(2n, 2, 'REFUND', -3000, -150, -2850), row(3n, 3, 'PAYMENT', 5000, 250, 4750),
      row(4n, 2, 'PAYOUT', -4000, 0, -4000), row(5n, 2, 'PAYMENT', 99999, 0, 99999, { status: 'PENDING' }), row(6n, 2, 'PAYMENT', 99999, 0, 99999, { profileId: 999n })];
    const before = structuredClone(f.state), result = await f.service.getDashboard('2', '10', '2026-01-01', '2026-01-03');
    expect(result.ledgerConfigured).toBe(true); expect(result.financeUnavailableReason).toBeNull();
    expect(result.overview).toEqual({ totalRevenue: 12000, totalFees: 600, netRevenue: 11400, totalBookings: 4, avgRating: 4.5, totalReviews: 2 });
    expect([result.balanceCents, result.pendingCents, result.totalEarnedCents]).toEqual([1200, 340, 15000]);
    expect(result.dailyRevenue).toEqual([{ date: '2026-01-01', revenue: 10000, bookings: 1 }, { date: '2026-01-02', revenue: -3000, bookings: 0 }, { date: '2026-01-03', revenue: 5000, bookings: 1 }]);
    expect(result.recentTransactions?.map(row => [row.id, row.type, row.amount, row.fee, row.net])).toEqual([['3', 'PAYMENT', 5000, 250, 4750], ['2', 'REFUND', -3000, -150, -2850], ['1', 'PAYMENT', 10000, 500, 9500]]);
    expect(f.db.merchantTransaction.findMany).toHaveBeenCalledWith({ where: { profileId: 50n, type: { in: ['PAYMENT', 'REFUND'] }, status: 'COMPLETED', createdAt: { gte: new Date('2026-01-01T08:00:00Z'), lt: new Date('2026-01-04T08:00:00Z') } }, orderBy: { createdAt: 'desc' } });
    expect(f.write).not.toHaveBeenCalled(); expect(f.state).toEqual(before);
  });

  test('configured but empty ledger retains verified zero money and empty arrays rather than missing-ledger nulls', async () => {
    const f = fixture(); f.state.profile = profile();
    const result = await f.service.getDashboard('2', '10');
    expect(result.ledgerConfigured).toBe(true); expect(result.financeUnavailableReason).toBeNull();
    expect(result.overview.totalRevenue).toBe(0); expect(result.overview.totalFees).toBe(0); expect(result.overview.netRevenue).toBe(0);
    expect(result.dailyRevenue).toEqual([]); expect(result.recentTransactions).toEqual([]);
    expect(f.db.merchantTransaction.findMany).toHaveBeenCalledTimes(1); expect(f.write).not.toHaveBeenCalled();
  });

  test('a mismatched ledger owner still fails closed before any transaction or operating-statistics query', async () => {
    const f = fixture(); f.state.profile = { ...profile(), userId: 3n };
    await expect(f.service.getDashboard('2', '10')).rejects.toThrow(ServiceUnavailableException);
    expect(f.db.merchantProfile.findUnique).toHaveBeenCalledTimes(1); expectNoStats(f);
  });

  test('unrelated merchants, historical owners, customers and employees without FINANCE_READ cannot query a profile or statistics', async () => {
    for (const [id, role] of [['3', 'MERCHANT'], ['9', 'MERCHANT'], ['4', 'STAFF'], ['5', 'CUSTOMER']]) {
      const f = fixture(); f.state.staffGrant = { status: 'ACTIVE', permissions: ['BOOKINGS_READ'] };
      await expect(f.service.getDashboard(id, '10', undefined, undefined, role)).rejects.toThrow(ForbiddenException);
      expect(f.db.merchantProfile.findUnique).not.toHaveBeenCalled(); expectNoStats(f);
    }
    const suspended = fixture(); suspended.state.users.find((row: any) => row.id === 2n).status = 'SUSPENDED';
    await expect(suspended.service.getDashboard('2', '10')).rejects.toThrow(ForbiddenException);
    expect(suspended.db.merchantProfile.findUnique).not.toHaveBeenCalled(); expectNoStats(suspended);
    const absent = fixture(); absent.state.shop = null;
    await expect(absent.service.getDashboard('2', '10')).rejects.toThrow(NotFoundException);
    expect(absent.db.merchantProfile.findUnique).not.toHaveBeenCalled(); expectNoStats(absent);
  });

  test('company, authorized FINANCE_READ staff and directed associated access may read missing-ledger operating statistics', async () => {
    for (const [id, role] of [['1', 'ADMIN'], ['3', 'MERCHANT'], ['4', 'STAFF']]) {
      const f = fixture();
      f.state.associatedGrant = { sourceShopId: 20n, status: 'ACTIVE', permissions: ['FINANCE_READ'] };
      f.state.staffGrant = { status: 'ACTIVE', permissions: ['FINANCE_READ'] };
      const result = await f.service.getDashboard(id, '10', undefined, undefined, role);
      expect(result.ledgerConfigured).toBe(false); expect(result.overview.totalBookings).toBe(4);
      expect(f.db.merchantTransaction.findMany).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    }
  });

  test('bad dates fail after authorization but before any profile or statistics read', async () => {
    for (const [start, end] of [['not-a-date', undefined], ['2026-02-30', undefined], ['2026-01-04', '2026-01-01'], [undefined, 'invalid']]) {
      const f = fixture();
      await expect(f.service.getDashboard('2', '10', start, end)).rejects.toThrow(BadRequestException);
      expect(f.events).toEqual(['authorize-actor', 'authorize-shop']);
      expect(f.db.merchantProfile.findUnique).not.toHaveBeenCalled(); expectNoStats(f);
    }
  });

  test('transaction and tax-report routes keep the existing strict missing-ledger refusal', async () => {
    const f = fixture();
    await expect(f.service.getTransactions('2', { shopId: '10', page: 1, pageSize: 20 })).rejects.toThrow(ServiceUnavailableException);
    await expect(f.service.getTaxReport('2', 2026, '10')).rejects.toThrow(ServiceUnavailableException);
    expectNoStats(f);
  });
});
