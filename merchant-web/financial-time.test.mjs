import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const createVite = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });

test('financial instants keep shop date, year and DST offset independent of the device timezone', async () => {
  const vite = await createVite(), oldTimezone = process.env.TZ;
  try {
    const { financialTimestamp, financialYear, requireFinancialTimezone } = await vite.ssrLoadModule('/src/utils/financialTime.ts');
    for (const device of ['UTC', 'Asia/Shanghai']) {
      process.env.TZ = device;
      assert.equal(financialYear('America/Los_Angeles', new Date('2027-01-01T06:00:00Z')), 2026);
      assert.equal(financialYear('America/New_York', new Date('2027-01-01T06:00:00Z')), 2027);
      assert.equal(financialTimestamp('2027-01-01T06:00:00Z', 'America/Los_Angeles'), '2026-12-31 22:00:00 GMT-8');
      assert.equal(financialTimestamp('2026-11-01T05:30:00Z', 'America/New_York'), '2026-11-01 01:30:00 GMT-4');
      assert.equal(financialTimestamp('2026-11-01T06:30:00Z', 'America/New_York'), '2026-11-01 01:30:00 GMT-5');
      assert.equal(financialTimestamp('2026-03-08T09:59:59Z', 'America/Los_Angeles'), '2026-03-08 01:59:59 GMT-8');
      assert.equal(financialTimestamp('2026-03-08T10:00:00Z', 'America/Los_Angeles'), '2026-03-08 03:00:00 GMT-7');
      assert.equal(financialTimestamp('2026-01-01', 'America/Los_Angeles'), '—', 'a pure date must not be parsed as a financial instant');
      assert.equal(financialTimestamp('2026-01-01T12:00:00', 'America/Los_Angeles'), '—', 'wall time without an offset must not use device timezone');
    }
    for (const zone of [undefined, null, '', 'bad/zone', '+08:00', ' UTC ']) assert.throws(() => requireFinancialTimezone(zone), /财务时区/);
    assert.equal(requireFinancialTimezone('Pacific/Honolulu'), 'Pacific/Honolulu');
  } finally {
    if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone;
    await vite.close();
  }
});

test('actual dashboard and earnings content show shop-local financial timestamps and date controls without changing signed amounts', async () => {
  const vite = await createVite(), oldTimezone = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Shanghai';
    const { DashboardContent } = await vite.ssrLoadModule('/src/pages/dashboard/index.tsx');
    const { EarningsContent } = await vite.ssrLoadModule('/src/pages/earnings/index.tsx');
    const transaction = { id: '9', bookingId: null, type: 'REFUND', amount: -200, fee: -2, net: -198, status: 'COMPLETED', createdAt: '2027-01-01T06:00:00Z', description: 'Refund' };
    const dashboard = { shopId: '7', timezone: 'America/Los_Angeles', ledgerConfigured: true, financeUnavailableReason: null,
      overview: { totalRevenue: -200, totalFees: -2, netRevenue: -198, totalBookings: 1, totalReviews: 0, avgRating: 0 }, balanceCents: -198, pendingCents: 0, totalEarnedCents: -198,
      bookingStatusDistribution: [], dailyRevenue: [{ date: '2026-12-31', revenue: -200, bookings: 1 }], recentTransactions: [transaction] };
    const state = { dashboard: { data: dashboard, error: null, loading: false },
      transactions: { data: { shopId: '7', timezone: dashboard.timezone, items: [transaction], total: 1, page: 1, pageSize: 10, totalPages: 1 }, error: null, loading: false },
      annual: { data: { shopId: '7', timezone: dashboard.timezone, year: 2026, total_gross: 0, total_refunds: 200, total_platform_fees: -2, net_earnings: -198 }, error: null, loading: false },
      query: { page: 1, pageSize: 10 }, year: 2026, exporting: false, exportError: null };
    const dashboardHtml = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DashboardContent, { data: dashboard, shopId: '7', can: () => false })));
    const earningsHtml = renderToStaticMarkup(createElement(EarningsContent, { state, model: {}, shopName: 'Test Shop' }));
    for (const html of [dashboardHtml, earningsHtml]) {
      assert.ok(html.includes('America/Los_Angeles')); assert.ok(html.includes('2026-12-31 22:00:00 GMT-8'));
      assert.doesNotMatch(html, /2027-01-01 06:00|2027-01-01 14:00|（UTC）/);
      assert.ok(html.includes('$-2.00'));
    }
    assert.ok(earningsHtml.includes('按门店当地日期筛选交易登记日期'));
    assert.ok(earningsHtml.includes('年份（门店当地）'));
    assert.ok(earningsHtml.includes('2026年已完成账本记录'));
    assert.deepEqual(dashboard.dailyRevenue, [{ date: '2026-12-31', revenue: -200, bookings: 1 }], 'server local bucket dates and amounts remain unchanged');
    assert.equal(transaction.createdAt, '2027-01-01T06:00:00Z', 'display cannot rewrite UTC storage or historical booking snapshots');
  } finally {
    if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone;
    await vite.close();
  }
});
