import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const page = (config, { id = '701', total = 750, items } = {}) => ({ shopId: config.url.split('/')[3], items: items ?? [{ id, shopId: config.url.split('/')[3], bookingNo: `B-${id}`, durationMin: 60, user: { name: 'Synthetic guest' }, service: { name: 'Synthetic service' }, totalCents: 10025, paidCents: 0, refundedCents: 0, currency: 'usd' }], total, page: config.params.page, pageSize: config.params.pageSize, totalPages: Math.ceil(total / config.params.pageSize) });
const server = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('explicit server page sends full filters and displays server totals beyond the old 500-item bound', async () => {
  const calls = [];
  axios.defaults.adapter = async config => { calls.push(config); return response(config, page(config)); };
  const vite = await server();
  try {
    const api = await vite.ssrLoadModule('/src/api/merchant.ts');
    const query = { page: 21, pageSize: 25, search: 'Synthetic', status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', startDate: '2026-10-28', endDate: '2026-10-28' };
    const result = await api.getShopBookingPage('9007199254740997', query);
    assert.equal(result.items[0].id, '701'); assert.equal(result.total, 750); assert.equal(result.totalPages, 30);
    assert.deepEqual(calls.map(config => ({ url: config.url, params: config.params })), [{ url: '/merchant/shops/9007199254740997/bookings', params: query }]);
  } finally { await vite.close(); }
});

test('a legacy array, foreign-shop row or mismatched pagination fails closed without fake totals', async () => {
  let mode = 'array';
  axios.defaults.adapter = async config => {
    const data = page(config);
    if (mode === 'array') return response(config, data.items);
    if (mode === 'shop') data.items[0].shopId = 'another-shop';
    if (mode === 'page') data.page++;
    if (mode === 'total') data.totalPages = 1;
    return response(config, data);
  };
  const vite = await server();
  try {
    const { getShopBookingPage } = await vite.ssrLoadModule('/src/api/merchant.ts');
    for (mode of ['array', 'shop', 'page', 'total']) await assert.rejects(getShopBookingPage('7', { page: 2, pageSize: 25 }), /无法核对当前门店的预约列表/);
  } finally { await vite.close(); }
});

test('later page wins request races; search/status and page-size changes request page one', async () => {
  const requests = [];
  axios.defaults.adapter = config => { const result = deferred(); requests.push({ config, ...result }); return result.promise; };
  const vite = await server(); let model;
  try {
    const { createBookingPageModel } = await vite.ssrLoadModule('/src/pages/bookings/model.ts');
    model = createBookingPageModel('7');
    const initial = model.load(); await tick();
    const later = model.setPage(3, 25); await tick();
    assert.equal(requests[0].config.signal.aborted, true);
    requests[1].resolve(response(requests[1].config, page(requests[1].config, { id: '703' }))); await later;
    requests[0].resolve(response(requests[0].config, page(requests[0].config, { id: 'stale' }))); await initial;
    assert.equal(model.getSnapshot().data.items[0].id, '703');
    const filtered = model.setFilters({ search: 'match', status: 'CANCELLED' }); await tick();
    assert.equal(model.getSnapshot().data, null);
    assert.deepEqual(requests[2].config.params, { search: 'match', status: 'CANCELLED', page: 1, pageSize: 25 });
    requests[2].resolve(response(requests[2].config, page(requests[2].config))); await filtered;
    const resized = model.setPage(4, 50); await tick();
    assert.deepEqual(requests[3].config.params, { search: 'match', status: 'CANCELLED', page: 1, pageSize: 50 });
    requests[3].resolve(response(requests[3].config, page(requests[3].config))); await resized;
  } finally { model?.dispose(); await vite.close(); }
});

test('refresh retains a valid page and re-queries the last valid page after filtered results shrink', async () => {
  const calls = []; let shrunk = false;
  axios.defaults.adapter = async config => {
    calls.push({ ...config.params });
    return response(config, page(config, shrunk ? { total: 26, items: config.params.page === 3 ? [] : [{ id: '26', shopId: '7', durationMin: 60 }] } : { total: 56 }));
  };
  const vite = await server(); let model;
  try {
    const { createBookingPageModel } = await vite.ssrLoadModule('/src/pages/bookings/model.ts');
    model = createBookingPageModel('7');
    await model.load(); await model.setPage(3, 25); await model.refresh();
    assert.equal(model.getSnapshot().query.page, 3);
    assert.equal(calls.at(-1).page, 3);
    shrunk = true; await model.refresh();
    assert.deepEqual(calls.slice(-2).map(query => query.page), [3, 2]);
    assert.equal(model.getSnapshot().data.total, 26); assert.equal(model.getSnapshot().query.page, 2);
    assert.equal(model.getSnapshot().data.items[0].id, '26');
  } finally { model?.dispose(); await vite.close(); }
});

test('changing shops before React cleanup prevents an old response from being used', async () => {
  let selectedShop = '7'; const requests = [];
  axios.defaults.adapter = config => { const result = deferred(); requests.push({ config, ...result }); return result.promise; };
  const vite = await server(); let oldModel, newModel;
  try {
    const { createBookingPageModel } = await vite.ssrLoadModule('/src/pages/bookings/model.ts');
    oldModel = createBookingPageModel('7', () => selectedShop === '7');
    const oldLoad = oldModel.load(); await tick(); selectedShop = '9';
    requests[0].resolve(response(requests[0].config, page(requests[0].config))); await oldLoad;
    assert.equal(oldModel.getSnapshot().data, null);
    oldModel.dispose(); newModel = createBookingPageModel('9', () => selectedShop === '9');
    const fresh = newModel.load(); await tick();
    requests[1].resolve(response(requests[1].config, page(requests[1].config, { id: '901' }))); await fresh;
    assert.equal(newModel.getSnapshot().data.shopId, '9'); assert.equal(newModel.getSnapshot().data.items[0].id, '901');
  } finally { oldModel?.dispose(); newModel?.dispose(); await vite.close(); }
});

test('StrictMode replay cancels its first request and keeps subscribers for the new result', async () => {
  const requests = [];
  axios.defaults.adapter = config => { const result = deferred(); requests.push({ config, ...result }); return result.promise; };
  const vite = await server(); let model;
  try {
    const { createBookingPageModel } = await vite.ssrLoadModule('/src/pages/bookings/model.ts');
    model = createBookingPageModel('7'); let changes = 0;
    const unsubscribe = model.subscribe(() => { changes++; });
    const first = model.load(); await tick(); model.dispose();
    const second = model.load(); await tick();
    requests[1].resolve(response(requests[1].config, page(requests[1].config))); await second;
    requests[0].resolve(response(requests[0].config, page(requests[0].config))); await first;
    assert.equal(model.getSnapshot().data.total, 750); assert.ok(changes > 1); unsubscribe();
  } finally { model?.dispose(); await vite.close(); }
});
