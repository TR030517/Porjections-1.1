import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import { createServer } from 'vite';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const response = (config, data, headers = {}) => ({ config, data, headers, status: 200, statusText: 'OK' });
const summary = (shopId, year = 2026, timezone = 'America/Los_Angeles') => ({ shopId, timezone, year, total_gross: 10005, total_platform_fees: 100, total_refunds: 200, total_net: 9705, total_payouts: 0, net_earnings: 9705 });
const dashboard = shopId => ({ shopId, timezone: 'America/Los_Angeles', ledgerConfigured: true, financeUnavailableReason: null, overview: { totalRevenue: 9805, totalFees: 100, netRevenue: 9705, totalBookings: 2, avgRating: 4.5, totalReviews: 1 }, balanceCents: 9705, pendingCents: 0, totalEarnedCents: 9705, bookingStatusDistribution: [{ status: 'COMPLETED', count: 2 }], dailyRevenue: [], recentTransactions: [] });
const missingDashboard = shopId => ({ ...dashboard(shopId), ledgerConfigured: false, financeUnavailableReason: 'LEDGER_NOT_CONFIGURED', overview: { ...dashboard(shopId).overview, totalRevenue: null, totalFees: null, netRevenue: null }, balanceCents: null, pendingCents: null, totalEarnedCents: null, dailyRevenue: null, recentTransactions: null });
const page = (config, id = 'row') => ({ shopId: config.params.shopId, timezone: 'America/Los_Angeles', items: [{ id, type: 'REFUND', amount: -200, fee: -2, net: -198, status: 'COMPLETED', createdAt: '2026-10-01T00:00:00Z', bookingId: null, description: 'Refund' }], total: 31, page: config.params.page, pageSize: config.params.pageSize, totalPages: Math.ceil(31 / config.params.pageSize) });

test('earnings transport sends exact selected-shop pagination, dates and annual queries and preserves server CSV bytes', async () => {
  const shopId = '9007199254740997';
  const csv = '\ufeffDate,Booking#,Gross ($)\n2026-01-01,"B-1",100.05\n';
  const requests = [];
  axios.defaults.adapter = async config => {
    requests.push({ method: config.method, url: config.url, params: config.params, responseType: config.responseType, accept: config.headers.Accept });
    if (config.url === '/merchant/transactions') return response(config, page(config));
    if (config.url === '/merchant/tax-report') return response(config, summary(config.params.shopId, config.params.year));
    return response(config, new Blob([csv], { type: 'text/csv' }), { 'content-type': 'text/csv; charset=utf-8' });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const api = await server.ssrLoadModule('/src/api/merchant.ts');
    const query = { shopId, page: 3, pageSize: 10, startDate: '2026-01-01', endDate: '2026-10-27' };
    const result = await api.getTransactions(query);
    assert.deepEqual([result.shopId, result.page, result.total, result.totalPages, result.items[0].amount], [shopId, 3, 31, 4, -200]);
    assert.equal(result.timezone, 'America/Los_Angeles');
    assert.equal((await api.getAnnualLedger(shopId, 2026)).net_earnings, 9705);
    const file = await api.getAnnualLedgerCsv(shopId, 2026);
    assert.equal(file.filename, `ledger-${shopId}-2026.csv`);
    assert.deepEqual(await file.blob.arrayBuffer(), await new Blob([csv]).arrayBuffer(), 'download must use server bytes, not client-made rows');
    assert.deepEqual(requests.map(({ method, url, params }) => ({ method, url, params })), [
      { method: 'get', url: '/merchant/transactions', params: query },
      { method: 'get', url: '/merchant/tax-report', params: { shopId, year: 2026 } },
      { method: 'get', url: '/merchant/tax-report/export', params: { shopId, year: 2026 } },
    ]);
    assert.equal(requests[2].responseType, 'blob');
    assert.equal(requests[2].accept, 'text/csv');
  } finally { await server.close(); }
});

test('earnings rejects mismatched shop results and exposes real CSV JSON errors without a fake download', async () => {
  let mode = 'wrong-shop';
  axios.defaults.adapter = async config => {
    if (mode === 'wrong-shop') return response(config, { ...page(config), shopId: 'other-shop' });
    if (mode === 'not-csv') return response(config, new Blob(['{}']), { 'content-type': 'application/json' });
    throw new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', config, null, {
      ...response(config, new Blob([JSON.stringify({ message: 'The selected shop has no matching owner ledger.' })], { type: 'application/json' })), status: 503,
    });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const api = await server.ssrLoadModule('/src/api/merchant.ts');
    await assert.rejects(api.getTransactions({ shopId: '7', page: 1, pageSize: 10 }), /与当前门店不符/);
    await assert.rejects(api.getAnnualLedger('7', 2026), /与当前门店不符/);
    mode = 'not-csv';
    await assert.rejects(api.getAnnualLedgerCsv('7', 2026), /未返回账本CSV/);
    mode = 'error';
    await assert.rejects(api.getAnnualLedgerCsv('7', 2026), /当前门店没有匹配的店主账本/);
  } finally { await server.close(); }
});

test('financial receipts reject unknown zones and mismatched resolved years instead of defaulting to UTC', async () => {
  let timezone, resolvedYear = 2026;
  axios.defaults.adapter = async config => response(config, config.url === '/merchant/transactions'
    ? { ...page(config), timezone }
    : { ...summary('7'), timezone, year: resolvedYear });
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const api = await server.ssrLoadModule('/src/api/merchant.ts');
    for (timezone of [undefined, null, '', 'Mars/Olympus', '+08:00']) {
      await assert.rejects(api.getTransactions({ shopId: '7' }), /无法核对门店财务时区/);
      await assert.rejects(api.getAnnualLedger('7', 2026), /无法核对门店财务时区/);
    }
    timezone = 'America/New_York';
    for (resolvedYear of [undefined, '2026', 2025]) await assert.rejects(api.getAnnualLedger('7', 2026), /所选门店年份不符/);
    resolvedYear = 2026;
    assert.equal((await api.getAnnualLedger('7', 2026)).timezone, timezone);
  } finally { await server.close(); }
});

test('default finance year waits for the verified shop zone, follows local year boundary and preserves manual year and CSV scope', async context => {
  const requests = [], models = [];
  const originalTimezone = process.env.TZ;
  let timezone = 'America/Los_Angeles';
  axios.defaults.adapter = async config => {
    requests.push({ url: config.url, params: config.params });
    if (config.url === '/merchant/tax-report/export') return response(config, new Blob(['server bytes']), { 'content-type': 'text/csv' });
    if (config.url === '/merchant/tax-report') return response(config, summary('7', config.params.year, timezone));
    if (config.url === '/merchant/transactions') return response(config, { ...page(config), timezone });
    return response(config, { ...dashboard('7'), timezone });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    process.env.TZ = 'Asia/Shanghai';
    context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-01T06:00:00Z') });
    const { createEarningsModel } = await server.ssrLoadModule('/src/pages/earnings/model.ts');
    const west = createEarningsModel('7'); models.push(west);
    assert.equal(west.getSnapshot().year, null, 'a device or UTC year must not be presented as a verified shop year');
    assert.deepEqual(requests, []);
    await west.retryAnnual();
    assert.deepEqual(requests, [], 'annual query must wait for shop timezone');
    await west.load();
    assert.equal(west.getSnapshot().year, 2026);
    assert.equal(west.getSnapshot().annual.data.year, 2026);
    timezone = 'America/New_York';
    const east = createEarningsModel('7'); models.push(east);
    await east.load();
    assert.equal(east.getSnapshot().year, 2027);
    assert.equal(east.getSnapshot().annual.data.timezone, timezone);
    await east.setYear(2025); await east.retryDashboard();
    assert.equal(east.getSnapshot().year, 2025, 'refresh may not reset an explicitly selected year');
    const downloads = [];
    await east.exportCsv(file => downloads.push(file));
    assert.equal(downloads[0].filename, 'ledger-7-2025.csv');
    assert.equal(await downloads[0].blob.text(), 'server bytes');
    assert.deepEqual(requests.at(-1), { url: '/merchant/tax-report/export', params: { shopId: '7', year: 2025 } });
  } finally {
    models.forEach(model => model.dispose()); context.mock.timers.reset();
    if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone;
    await server.close();
  }
});

test('valid but changed report timezone cannot mix with the loaded dashboard or permit an export', async () => {
  let changed = true, exportCalls = 0;
  axios.defaults.adapter = async config => {
    if (config.url.endsWith('/export')) { ++exportCalls; throw new Error('unexpected export'); }
    if (config.url.endsWith('/dashboard')) return response(config, dashboard('7'));
    const timezone = changed ? 'America/New_York' : 'America/Los_Angeles';
    return response(config, config.url === '/merchant/transactions'
      ? { ...page(config), timezone } : summary('7', config.params.year, timezone));
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let model;
  try {
    const { createEarningsModel } = await server.ssrLoadModule('/src/pages/earnings/model.ts');
    model = createEarningsModel('7', 2026); await model.load();
    for (const result of [model.getSnapshot().transactions, model.getSnapshot().annual]) {
      assert.equal(result.data, null); assert.match(result.error, /财务时区已变更/);
    }
    await model.exportCsv(() => assert.fail('mixed zone export must not download'));
    assert.equal(exportCalls, 0);
    changed = false; await model.retryDashboard();
    assert.equal(model.getSnapshot().transactions.error, null);
    assert.equal(model.getSnapshot().transactions.data.items[0].amount, -200);
    assert.equal(model.getSnapshot().annual.data.total_refunds, 200);
  } finally { model?.dispose(); await server.close(); }
});

test('earnings ignores stale pages and exports, resets pagination and keeps downloads bound to current shop and year', async () => {
  const transactions = [];
  const exports = [];
  let currentShop = '7';
  axios.defaults.adapter = async config => {
    if (config.url === '/merchant/transactions') {
      const result = deferred(); transactions.push({ config, ...result }); return result.promise;
    }
    if (config.url === '/merchant/tax-report/export') {
      const result = deferred(); exports.push({ config, ...result }); return result.promise;
    }
    return response(config, config.url === '/merchant/tax-report' ? summary(config.params.shopId, config.params.year) : dashboard(config.url.split('/')[3]));
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let first;
  let second;
  try {
    const { createEarningsModel } = await server.ssrLoadModule('/src/pages/earnings/model.ts');
    first = createEarningsModel('7', 2026, () => currentShop === '7');
    const initial = first.load();
    await new Promise(resolve => setImmediate(resolve));
    const laterPage = first.setPage(3, 10);
    await new Promise(resolve => setImmediate(resolve));
    transactions[1].resolve(response(transactions[1].config, page(transactions[1].config, 'new-page')));
    await laterPage;
    transactions[0].resolve(response(transactions[0].config, page(transactions[0].config, 'stale-page')));
    await initial;
    assert.equal(first.getSnapshot().transactions.data.items[0].id, 'new-page');
    const dated = first.setDates('2026-01-01', '2026-02-28');
    assert.equal(first.getSnapshot().query.page, 1);
    assert.equal(first.getSnapshot().transactions.data, null, 'old rows clear while new filters load');
    await new Promise(resolve => setImmediate(resolve));
    transactions[2].resolve(response(transactions[2].config, page(transactions[2].config)));
    await dated;
    const resized = first.setPage(2, 25);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(transactions[3].config.params, { shopId: '7', page: 1, pageSize: 25, startDate: '2026-01-01', endDate: '2026-02-28' });
    transactions[3].resolve(response(transactions[3].config, page(transactions[3].config)));
    await resized;

    const downloads = [];
    const oldYearExport = first.exportCsv(file => downloads.push(file));
    await new Promise(resolve => setImmediate(resolve));
    await first.setYear(2025);
    exports[0].resolve(response(exports[0].config, new Blob(['old year']), { 'content-type': 'text/csv' }));
    await oldYearExport;
    assert.deepEqual(downloads, []);
    const oldShopExport = first.exportCsv(file => downloads.push(file));
    await new Promise(resolve => setImmediate(resolve));
    currentShop = '9'; // Selection changes before React's unmount effect cleanup.
    exports[1].resolve(response(exports[1].config, new Blob(['old shop']), { 'content-type': 'text/csv' }));
    await oldShopExport;
    assert.deepEqual(downloads, []);
    first.dispose();
    second = createEarningsModel('9', 2025, () => currentShop === '9');
    assert.equal(second.getSnapshot().transactions.data, null);
    assert.equal(second.getSnapshot().query.page, 1);
    const secondLoad = second.load();
    await new Promise(resolve => setImmediate(resolve));
    transactions[4].resolve(response(transactions[4].config, page(transactions[4].config)));
    await secondLoad;
    const validExport = second.exportCsv(file => downloads.push(file));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(exports[2].config.params, { shopId: '9', year: 2025 });
    exports[2].resolve(response(exports[2].config, new Blob(['server CSV']), { 'content-type': 'text/csv' }));
    await validExport;
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'ledger-9-2025.csv');
    assert.equal(await downloads[0].blob.text(), 'server CSV');
  } finally { first?.dispose(); second?.dispose(); await server.close(); }
});

test('earnings supports a StrictMode mount replay and displays empty server pages without invented entries', async () => {
  axios.defaults.adapter = async config => response(config,
    config.url === '/merchant/transactions'
      ? { shopId: config.params.shopId, timezone: 'America/Los_Angeles', items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 }
      : config.url === '/merchant/tax-report' ? summary(config.params.shopId, config.params.year) : dashboard(config.url.split('/')[3]));
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let model;
  try {
    const { createEarningsModel } = await server.ssrLoadModule('/src/pages/earnings/model.ts');
    model = createEarningsModel('7', 2026);
    const firstMount = model.load();
    model.dispose();
    await Promise.all([firstMount, model.load()]);
    assert.equal(model.getSnapshot().dashboard.loading, false);
    assert.equal(model.getSnapshot().annual.data.shopId, '7');
    assert.deepEqual(model.getSnapshot().transactions.data.items, []);
    assert.equal(model.getSnapshot().transactions.data.total, 0);
    assert.equal(model.getSnapshot().transactions.error, null);
  } finally { model?.dispose(); await server.close(); }
});

test('an unconfigured ledger prevents transaction annual and CSV requests until a successful recheck', async () => {
  let configured = false;
  const requests = [], downloads = [];
  axios.defaults.adapter = async config => {
    requests.push(config.url);
    if (config.url.endsWith('/dashboard')) return response(config, configured ? dashboard('7') : missingDashboard('7'));
    if (config.url === '/merchant/transactions') return response(config, { shopId: '7', timezone: 'America/Los_Angeles', items: [], total: 0, page: config.params.page, pageSize: config.params.pageSize, totalPages: 0 });
    if (config.url === '/merchant/tax-report') return response(config, summary('7', config.params.year));
    return response(config, new Blob(['actual server CSV']), { 'content-type': 'text/csv' });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let model;
  try {
    const { createEarningsModel } = await server.ssrLoadModule('/src/pages/earnings/model.ts');
    model = createEarningsModel('7', 2026);
    await model.load();
    assert.equal(model.getSnapshot().dashboard.data.ledgerConfigured, false);
    assert.equal(model.getSnapshot().dashboard.data.overview.totalRevenue, null);
    assert.equal(model.getSnapshot().transactions.loading, false);
    assert.equal(model.getSnapshot().annual.loading, false);
    await model.setDates('2026-01-01', '2026-02-28');
    await model.setPage(2, 10); await model.setYear(2025);
    await model.retryTransactions(); await model.retryAnnual();
    await model.exportCsv(file => downloads.push(file));
    assert.deepEqual(requests, ['/merchant/shops/7/dashboard']);
    assert.deepEqual(downloads, []);
    configured = true;
    await model.retryDashboard();
    assert.equal(model.getSnapshot().dashboard.error, null);
    assert.equal(model.getSnapshot().dashboard.data.ledgerConfigured, true);
    assert.equal(model.getSnapshot().annual.data.shopId, '7');
    assert.equal(requests.filter(url => url === '/merchant/transactions').length, 1);
    assert.equal(requests.filter(url => url === '/merchant/tax-report').length, 1);
    await model.exportCsv(file => downloads.push(file));
    assert.equal(downloads.length, 1);
    assert.equal(await downloads[0].blob.text(), 'actual server CSV');
  } finally { model?.dispose(); await server.close(); }
});
