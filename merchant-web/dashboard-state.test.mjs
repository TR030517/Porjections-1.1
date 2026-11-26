import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const oldAdapter = axios.defaults.adapter;
afterEach(() => { axios.defaults.adapter = oldAdapter; });
const response = (config, data) => ({ config, data, headers: {}, status: 200, statusText: 'OK' });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const configured = shopId => ({ shopId, timezone: 'America/Los_Angeles', ledgerConfigured: true, financeUnavailableReason: null,
  overview: { totalRevenue: 0, totalFees: 0, netRevenue: 0, totalBookings: 3, avgRating: 4.5, totalReviews: 2 },
  balanceCents: 0, pendingCents: 0, totalEarnedCents: 0,
  bookingStatusDistribution: [{ status: 'CONFIRMED', count: 3 }], dailyRevenue: [], recentTransactions: [] });
const missing = shopId => ({ ...configured(shopId), ledgerConfigured: false, financeUnavailableReason: 'LEDGER_NOT_CONFIGURED',
  overview: { ...configured(shopId).overview, totalRevenue: null, totalFees: null, netRevenue: null },
  balanceCents: null, pendingCents: null, totalEarnedCents: null, dailyRevenue: null, recentTransactions: null });
const server = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });

test('dashboard transport binds the selected shop and preserves missing finance separately from actual zero', async () => {
  const shopId = '9007199254740997', requests = [];
  let receipt = missing(shopId);
  axios.defaults.adapter = async config => { requests.push(config); return response(config, receipt); };
  const vite = await server();
  try {
    const { getShopDashboard } = await vite.ssrLoadModule('/src/api/merchant.ts');
    const controller = new AbortController();
    const data = await getShopDashboard(shopId, '2026-01-01', '2026-10-30', controller.signal);
    assert.equal(data.ledgerConfigured, false);
    assert.equal(data.overview.totalRevenue, null);
    assert.equal(data.overview.totalBookings, 3);
    assert.equal(data.overview.avgRating, 4.5);
    assert.equal(data.recentTransactions, null);
    assert.equal(data.timezone, 'America/Los_Angeles');
    assert.equal(requests[0].url, `/merchant/shops/${shopId}/dashboard`);
    assert.deepEqual(requests[0].params, { startDate: '2026-01-01', endDate: '2026-10-30' });
    assert.equal(requests[0].signal, controller.signal);
    receipt = configured(shopId);
    assert.equal((await getShopDashboard(shopId)).overview.totalRevenue, 0);
    assert.deepEqual((await getShopDashboard(shopId)).recentTransactions, []);
    receipt = { ...configured(shopId), overview: { ...configured(shopId).overview, totalRevenue: -200, totalFees: -2, netRevenue: -198 }, recentTransactions: [{ id: '9', bookingId: null, type: 'REFUND', amount: -200, fee: -2, net: -198, status: 'COMPLETED', createdAt: '2026-10-30T00:00:00Z', description: 'Refund' }] };
    assert.equal((await getShopDashboard(shopId)).recentTransactions[0].amount, -200);
  } finally { await vite.close(); }
});

test('dashboard rejects another shop, missing flags, mixed null/zero finance and malformed operating or transaction values', async () => {
  let receipt;
  axios.defaults.adapter = async config => response(config, receipt);
  const vite = await server();
  try {
    const { getShopDashboard } = await vite.ssrLoadModule('/src/api/merchant.ts');
    const bad = [
      missing('9'), { ...missing('7'), shopId: 7 },
      ...[undefined, null, '', 'Not/A_Zone', '+08:00', ' America/Los_Angeles'].map(timezone => ({ ...missing('7'), timezone })),
      { ...missing('7'), ledgerConfigured: undefined },
      { ...missing('7'), financeUnavailableReason: null },
      { ...missing('7'), balanceCents: 0 },
      { ...missing('7'), recentTransactions: [] },
      { ...missing('7'), overview: { ...missing('7').overview, totalRevenue: 0 } },
      { ...missing('7'), overview: { ...missing('7').overview, totalBookings: '3' } },
      { ...missing('7'), overview: { ...missing('7').overview, avgRating: 6 } },
      { ...configured('7'), recentTransactions: null },
      { ...configured('7'), totalEarnedCents: '0' },
      { ...configured('7'), overview: { ...configured('7').overview, netRevenue: Number.NaN } },
      { ...configured('7'), dailyRevenue: [{ date: '2026-02-30', revenue: 100, bookings: 1 }] },
      { ...configured('7'), bookingStatusDistribution: [{ status: 'COMPLETED', count: -1 }] },
      { ...configured('7'), recentTransactions: [{ id: '1', amount: '100' }] },
    ];
    for (receipt of bad) await assert.rejects(getShopDashboard('7'), /无法核对|与当前门店不符/);
  } finally { await vite.close(); }
});

test('shop or actor permission changes hide loaded data synchronously and delayed old-shop receipts cannot publish', async () => {
  const calls = [];
  axios.defaults.adapter = async config => { const task = deferred(); calls.push({ config, ...task }); return task.promise; };
  const vite = await server();
  let first, second;
  try {
    const { createDashboardModel } = await vite.ssrLoadModule('/src/pages/dashboard/model.ts');
    let actor = 'owner-a', selected = '7', accessReady = true;
    first = createDashboardModel('7', () => actor === 'owner-a' && selected === '7' && accessReady);
    const oldLoad = first.load(); await tick();
    selected = '9';
    assert.equal(first.getSnapshot().data, null);
    second = createDashboardModel('9', () => actor === 'owner-a' && selected === '9' && accessReady);
    assert.equal(second.getSnapshot().data, null);
    const nextLoad = second.load(); await tick();
    calls[1].resolve(response(calls[1].config, configured('9'))); await nextLoad;
    assert.equal(second.getSnapshot().data.shopId, '9');
    calls[0].resolve(response(calls[0].config, configured('7'))); await oldLoad;
    assert.equal(first.getSnapshot().data, null);
    assert.equal(second.getSnapshot().data.shopId, '9');
    accessReady = false;
    assert.equal(second.getSnapshot().data, null, 'fresh-permission check hides loaded figures before React cleanup');
    accessReady = true; actor = 'owner-b';
    assert.equal(second.getSnapshot().data, null, 'same shop under another actor must not reveal old figures');
  } finally { first?.dispose(); second?.dispose(); await vite.close(); }
});

test('retry clears an old error while pending and accepts a later successful exact-shop response', async () => {
  const pending = deferred(); let attempt = 0, config;
  axios.defaults.adapter = async value => { config = value; if (++attempt === 1) throw new Error('Network Error'); return pending.promise; };
  const vite = await server(); let model;
  try {
    const { createDashboardModel } = await vite.ssrLoadModule('/src/pages/dashboard/model.ts');
    model = createDashboardModel('7'); await model.load();
    assert.match(model.getSnapshot().error, /网络/);
    const retry = model.load();
    assert.deepEqual(model.getSnapshot(), { data: null, loading: true, error: null });
    await tick(); pending.resolve(response(config, missing('7'))); await retry;
    assert.equal(model.getSnapshot().error, null);
    assert.equal(model.getSnapshot().loading, false);
    assert.equal(model.getSnapshot().data.ledgerConfigured, false);
  } finally { model?.dispose(); await vite.close(); }
});

test('dashboard renders missing finance as unconfigured while keeping operating figures and authorized links only', async () => {
  const vite = await server();
  try {
    const { DashboardContent } = await vite.ssrLoadModule('/src/pages/dashboard/index.tsx');
    const render = (data, permissions) => renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(DashboardContent, { data, shopId: '7', can: permission => permissions.includes(permission) })));
    const html = render(missing('7'), ['FINANCE_READ']);
    const textContent = html.replace(/<[^>]*>/g, '');
    assert.ok(html.includes('账本尚未配置')); assert.ok(html.includes('请联系平台'));
    assert.equal((html.match(/>未配置</g) ?? []).length, 2);
    for (const text of ['累计预约', '平均评分', '预约状态', '2 条评价']) assert.ok(textContent.includes(text));
    assert.doesNotMatch(html, /暂无交易|USD|\$0|href="\/bookings|href="\/reservations|href="\/after-sales|href="\/gifts/);
    const available = render(configured('7'), ['FINANCE_READ', 'BOOKINGS_READ']);
    assert.ok(available.includes('暂无交易')); assert.ok(available.includes('USD'));
    assert.ok(available.includes('/bookings?shopId=7'));
    assert.doesNotMatch(available, /账本尚未配置|href="\/reservations|href="\/after-sales|href="\/gifts/);
  } finally { await vite.close(); }
});
