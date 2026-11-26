import 'reflect-metadata';
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { MerchantController } from './merchant.controller';

function fixture(timezone = 'America/Los_Angeles') {
  const state: any = {
    shop: { id: 10n, ownerId: 9n, status: 'APPROVED', deletedAt: null, timezone },
    profile: { id: 50n, userId: 9n, shopId: 10n, balanceCents: 1200, pendingCents: 340, totalEarnedCents: 15000 },
    transactions: [], shops: null,
    bookings: [{ id: 102n, bookingNo: '=FORMULA', user: { name: '=Synthetic guest' }, service: { name: 'Synthetic,"service"' }, bookingTimezone: 'America/New_York' }],
    settlements: [{ id: 900n, amountCents: 12345, occurredAt: new Date('2026-01-01T06:00:00Z'), type: 'OFFLINE_PAYMENT' }],
  };
  const writes = jest.fn(() => { throw new Error('Finance reads must not write'); });
  const filtered = (where: any) => state.transactions.filter((row: any) => row.profileId === where.profileId
    && (!where.type?.in || where.type.in.includes(row.type)) && (!where.status || row.status === where.status)
    && (!where.createdAt?.gte || row.createdAt >= where.createdAt.gte)
    && (!where.createdAt?.lt || row.createdAt < where.createdAt.lt));
  const db: any = {
    user: { findFirst: jest.fn(async ({ where }: any) => where.id === 2n && where.role === 'MERCHANT' ? { id: 2n } : null) },
    shop: {
      findFirst: jest.fn(async ({ where }: any) => where.id === state.shop.id ? {
        ...state.shop, loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } },
      } : null),
      findMany: jest.fn(async () => state.shops ?? [state.shop]),
      findUnique: jest.fn(async () => state.shop),
    },
    merchantProfile: { findUnique: jest.fn(async () => state.profile), create: writes, update: writes, upsert: writes },
    merchantTransaction: {
      findMany: jest.fn(async ({ where, orderBy, skip = 0, take }: any) => {
        const direction = Array.isArray(orderBy) ? orderBy[0].createdAt : orderBy.createdAt;
        const rows = [...filtered(where)].sort((a: any, b: any) => (a.createdAt.getTime() - b.createdAt.getTime()) * (direction === 'asc' ? 1 : -1));
        return take === undefined ? rows.slice(skip) : rows.slice(skip, skip + take);
      }),
      count: jest.fn(async ({ where }: any) => filtered(where).length), create: writes, update: writes,
    },
    booking: {
      count: jest.fn(async () => 4), groupBy: jest.fn(async () => [{ status: 'COMPLETED', _count: 4 }]),
      findMany: jest.fn(async () => state.bookings), create: writes, update: writes,
    },
    bookingSettlementEntry: { findMany: jest.fn(() => { throw new Error('Settlement entries are not merchant transactions'); }), create: writes },
    review: { aggregate: jest.fn(async () => ({ _avg: { rating: 4 }, _count: 1 })) },
    auditLog: { create: writes }, $transaction: writes, $executeRaw: writes,
  };
  return { state, db, writes, service: new MerchantService(db, {} as any) };
}

function row(id: number, instant: string | number, type = 'PAYMENT', amount = 1000, fee = 50, extra = {}) {
  return { id: BigInt(id), profileId: 50n, bookingId: BigInt(id + 100), type, amount, fee, net: amount - fee,
    status: 'COMPLETED', createdAt: new Date(instant), description: `Synthetic ${type}`, ...extra };
}

describe('merchant financial calendar uses the authorized shop timezone', () => {
  afterEach(() => jest.useRealTimers());

  test.each([
    ['America/Los_Angeles', '2026-03-08', '2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z', 23],
    ['America/New_York', '2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 23],
    ['America/Los_Angeles', '2026-11-01', '2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z', 25],
    ['America/New_York', '2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 25],
  ])('%s %s shares DST-safe [start,end) boundaries across dashboard and transaction pages', async (timezone, date, fromIso, toIso, hours) => {
    const f = fixture(String(timezone)), from = Date.parse(String(fromIso)), to = Date.parse(String(toIso));
    f.state.transactions = [row(1, from - 1), row(2, from), row(3, to - 1, 'REFUND', -200, -10), row(4, to),
      row(5, from + 1, 'PAYMENT', 99999, 0, { profileId: 999n }), row(6, from + 1, 'PAYMENT', 500, 0, { status: 'PENDING' })];
    if (hours === 25) f.state.transactions.push(row(7, from + 90 * 60_000, 'PAYMENT', 100, 5), row(8, from + 150 * 60_000, 'PAYMENT', 100, 5));
    const before = structuredClone(f.state);
    const dashboard = await f.service.getDashboard('2', '10', String(date), String(date));
    const page = await f.service.getTransactions('2', { shopId: '10', page: 1, pageSize: 100, startDate: String(date), endDate: String(date) });
    const expectedRange = { gte: new Date(from), lt: new Date(to) };
    expect(to - from).toBe(Number(hours) * 3_600_000);
    expect(dashboard.timezone).toBe(timezone); expect(page.timezone).toBe(timezone);
    expect(f.db.merchantTransaction.findMany.mock.calls.map(([args]: any) => args.where.createdAt)).toEqual([expectedRange, expectedRange]);
    expect(f.db.merchantTransaction.count).toHaveBeenCalledWith({ where: { profileId: 50n, createdAt: expectedRange } });
    expect(f.db.booking.count).toHaveBeenCalledWith({ where: { shopId: 10n, createdAt: expectedRange } });
    expect(dashboard.overview.totalRevenue).toBe(hours === 25 ? 1000 : 800);
    expect(dashboard.dailyRevenue).toEqual([{ date, revenue: hours === 25 ? 1000 : 800, bookings: hours === 25 ? 3 : 1 }]);
    expect(page.total).toBe(hours === 25 ? 5 : 3); // The list still includes PENDING ledger entries.
    expect(page.items.map(item => item.id).sort()).toEqual(hours === 25 ? ['2', '3', '6', '7', '8'] : ['2', '3', '6']);
    expect(page.items.find(item => item.id === '2')?.createdAt).toBe(new Date(from).toISOString());
    expect(f.db.bookingSettlementEntry.findMany).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled(); expect(f.state).toEqual(before);
  });

  test('month-end local buckets do not leak UTC-adjacent dates into the chosen day', async () => {
    const f = fixture();
    f.state.transactions = [row(1, '2026-02-01T07:59:59.999Z'), row(2, '2026-02-01T08:00:00Z')];
    const result = await f.service.getDashboard('2', '10', '2026-01-31', '2026-01-31');
    expect(result.dailyRevenue).toEqual([{ date: '2026-01-31', revenue: 1000, bookings: 1 }]);
    expect(result.recentTransactions?.map(item => item.id)).toEqual(['1']);
  });

  test('start-only and end-only filters retain one-sided local midnight bounds', async () => {
    const f = fixture();
    await f.service.getTransactions('2', { shopId: '10', page: 1, pageSize: 10, startDate: '2026-03-08' });
    await f.service.getTransactions('2', { shopId: '10', page: 1, pageSize: 10, endDate: '2026-11-01' });
    expect(f.db.merchantTransaction.findMany.mock.calls.map(([args]: any) => args.where.createdAt)).toEqual([
      { gte: new Date('2026-03-08T08:00:00Z') }, { lt: new Date('2026-11-02T08:00:00Z') },
    ]);
  });

  test.each([
    ['America/Los_Angeles', '2026-01-01T08:00:00Z', '2027-01-01T08:00:00Z'],
    ['America/New_York', '2026-01-01T05:00:00Z', '2027-01-01T05:00:00Z'],
  ])('%s annual totals and CSV use local year boundaries without rewriting signed amounts or booking snapshots', async (timezone, fromIso, toIso) => {
    const f = fixture(timezone), from = Date.parse(fromIso), to = Date.parse(toIso);
    f.state.transactions = [row(1, from - 1), row(2, from, 'PAYMENT', 10000, 500), row(3, to - 1, 'REFUND', -3000, -150),
      row(4, to), row(5, '2026-06-01T12:00:00Z', 'PAYOUT', -4000, 0), row(6, from + 1, 'PAYMENT', 99999, 0, { status: 'PENDING' })];
    const before = structuredClone(f.state);
    const result = await f.service.getTaxReport('2', 2026, '10');
    const csv = await f.service.exportTaxReportCsv('2', 2026, '10');
    expect(result).toEqual({ shopId: '10', timezone, year: 2026, total_gross: 10000, total_platform_fees: 350,
      total_refunds: 3000, total_net: 6650, total_payouts: 4000, net_earnings: 2650 });
    expect(f.db.merchantTransaction.findMany.mock.calls.map(([args]: any) => args.where.createdAt)).toEqual([
      { gte: new Date(from), lt: new Date(to) }, { gte: new Date(from), lt: new Date(to) },
    ]);
    expect(csv.split('\n')).toHaveLength(4);
    expect(csv).toContain('2026-01-01,"\'=FORMULA","\'=Synthetic guest","Synthetic,""service""",100.00,5.00,95.00,"PAYMENT"');
    expect(csv).toContain('2026-12-31,"","","",-30.00,-1.50,-28.50,"REFUND"');
    expect(f.db.booking.findMany.mock.calls[0][0].where.shopId).toBe(10n);
    expect(f.db.bookingSettlementEntry.findMany).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled(); expect(f.state).toEqual(before);
  });

  test.each([['America/Los_Angeles', 2026], ['America/New_York', 2027]])('%s resolves the default report year locally at a UTC year transition', async (timezone, year) => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-01T06:00:00Z'));
    const f = fixture(String(timezone));
    f.state.transactions = [row(2, '2027-01-01T06:00:00Z')];
    const report = await f.service.getTaxReport('2', undefined, '10');
    const csv = await f.service.exportTaxReportCsv('2', undefined, '10');
    expect(report.year).toBe(year); expect(report.timezone).toBe(timezone); expect(report.total_gross).toBe(1000);
    expect(csv.split('\n')[1].split(',')[0]).toBe(year === 2026 ? '2026-12-31' : '2027-01-01');
  });

  test('CSV controller pins its query and filename to the service-resolved year', async () => {
    const service: any = { getTaxReport: jest.fn(async () => ({ shopId: '10', timezone: 'America/Los_Angeles', year: 2026 })), exportTaxReportCsv: jest.fn(async () => 'synthetic,csv') };
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    await new MerchantController(service).exportTaxReportCsv('MERCHANT', '2', { shopId: '10' }, res);
    expect(service.exportTaxReportCsv).toHaveBeenCalledWith('2', 2026, '10', 'MERCHANT');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="ledger-10-2026.csv"');
    expect(res.send).toHaveBeenCalledWith('synthetic,csv');
  });

  test('missing or invalid timezone fails closed before financial row queries, but does not break application status', async () => {
    for (const timezone of ['', 'not/a-zone']) {
      const f = fixture(timezone);
      for (const read of [() => f.service.getDashboard('2', '10'),
        () => f.service.getTransactions('2', { shopId: '10', page: 1, pageSize: 10 }),
        () => f.service.getTaxReport('2', 2026, '10'), () => f.service.exportTaxReportCsv('2', 2026, '10')]) {
        await expect(read()).rejects.toThrow(ServiceUnavailableException);
      }
      expect(f.db.merchantTransaction.findMany).not.toHaveBeenCalled();
      expect((await f.service.getApplicationStatus('2', '10')).shopName).toBeNull();
      expect(f.writes).not.toHaveBeenCalled();
    }
  });

  test('explicit shop scope, valid dates and ledger ownership remain required', async () => {
    const multiple = fixture(); multiple.state.shops = [multiple.state.shop, { ...multiple.state.shop, id: 20n }];
    await expect(multiple.service.getTaxReport('2', 2026)).rejects.toThrow(BadRequestException);
    expect(multiple.db.merchantProfile.findUnique).not.toHaveBeenCalled();
    const other = fixture(); other.state.profile.userId = 8n;
    await expect(other.service.getTransactions('2', { shopId: '10', page: 1, pageSize: 10 })).rejects.toThrow(ServiceUnavailableException);
    expect(other.db.merchantTransaction.findMany).not.toHaveBeenCalled();
    const unauthorized = fixture();
    await expect(unauthorized.service.getTaxReport('3', 2026, '10')).rejects.toThrow(ForbiddenException);
    expect(unauthorized.db.merchantProfile.findUnique).not.toHaveBeenCalled();
    for (const [startDate, endDate] of [['2026-02-30', undefined], ['2026-03-10', '2026-03-08'], [undefined, 'invalid']]) {
      const f = fixture();
      await expect(f.service.getTransactions('2', { shopId: '10', page: 1, pageSize: 10, startDate, endDate })).rejects.toThrow(BadRequestException);
      expect(f.db.merchantTransaction.findMany).not.toHaveBeenCalled();
    }
  });

  test('current report timezone changes local buckets while existing UTC instants and booking timezone snapshots remain untouched', async () => {
    const f = fixture(); f.state.transactions = [row(2, '2026-11-10T06:00:00Z')];
    const beforeRows = structuredClone(f.state.transactions), beforeBookings = structuredClone(f.state.bookings);
    const la = await f.service.getDashboard('2', '10');
    f.state.shop.timezone = 'America/New_York';
    const ny = await f.service.getDashboard('2', '10');
    expect(la.dailyRevenue?.[0].date).toBe('2026-11-09'); expect(ny.dailyRevenue?.[0].date).toBe('2026-11-10');
    expect(la.overview.totalRevenue).toBe(ny.overview.totalRevenue);
    expect(la.recentTransactions).toEqual(ny.recentTransactions);
    expect(f.state.transactions).toEqual(beforeRows); expect(f.state.bookings).toEqual(beforeBookings); expect(f.writes).not.toHaveBeenCalled();
  });
});
