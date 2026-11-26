import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_ALL_STORES_SCOPE, adminLocationSearch, clearAdminLocation, readAdminLocation, restoreAdminLocation, safeAdminLocation, writeAdminLocation } from './adminLocation';

function browser(search: string) {
  const values = new Map<string, string>();
  const location = { pathname: '/admin/', search };
  const history = {
    state: null as unknown,
    replaceState(state: unknown, _title: string, url: string) { this.state = state; location.search = new URL(url, 'http://synthetic.test').search; },
    pushState(state: unknown, title: string, url: string) { this.replaceState(state, title, url); },
  };
  return { location, history, sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } } as unknown as Pick<Window, 'location' | 'history' | 'sessionStorage'>;
}
test('audit URLs restore all six committed filters and pagination, without serializing secrets or drafts', () => {
  const route = safeAdminLocation('audit-logs', { targetType: 'settings', action: 'STUDIO_UPDATE', targetId: '9', operatorId: '7', startDate: '2026-11-01', endDate: '2026-11-12', page: 3, limit: 50, password: 'sensitive', search: 'customer@example.invalid', detail: 'draft' });
  const search = adminLocationSearch(route);
  assert.deepEqual(readAdminLocation(search), route);
  assert.equal(search.includes('sensitive'), false);
  assert.equal(search.includes('example'), false);
  assert.equal(search.includes('draft'), false);
  assert.equal(new URLSearchParams(search).get('targetId'), '9');
});
test('invalid and unauthorized routes, IDs, dates and pagination are bounded', () => {
  assert.equal(readAdminLocation('?module=unknown').view, 'dashboard');
  assert.equal(readAdminLocation('?module=audit-logs', () => false).view, 'dashboard');
  assert.deepEqual(safeAdminLocation('audit-logs', { targetId: '-1', page: 4 }).query, { page: 1, limit: 20 });
  assert.deepEqual(safeAdminLocation('service-orders', { page: 99999999, pageSize: 999, shopId: '9223372036854775808', startDate: '2026-02-30', status: '<script>' }).query, { page: 1, pageSize: 25 });
  assert.deepEqual(safeAdminLocation('service-orders', { startDate: '2026-12-01', endDate: '2026-11-01' }).query, {});
});
test('explicit all-store scope is shareable and survives refresh while a concrete shop ID takes precedence', () => {
  const route = safeAdminLocation('service-orders', { status: 'CONFIRMED', shopScope: ADMIN_ALL_STORES_SCOPE });
  assert.deepEqual(route.query, { shopScope: ADMIN_ALL_STORES_SCOPE, status: 'CONFIRMED' });
  const win = browser(adminLocationSearch(route));
  writeAdminLocation(route, 'ADMIN:7', win, true);
  assert.deepEqual(readAdminLocation(win.location.search), route);
  assert.deepEqual(restoreAdminLocation('ADMIN:7', win, () => true), route);
  assert.deepEqual(safeAdminLocation('service-orders', { status: 'CONFIRMED', shopId: '29', shopScope: ADMIN_ALL_STORES_SCOPE }).query, { shopId: '29', status: 'CONFIRMED' });
  assert.deepEqual(safeAdminLocation('audit-logs', { shopScope: ADMIN_ALL_STORES_SCOPE }).query, { page: '1', limit: '20', shopScope: ADMIN_ALL_STORES_SCOPE });
  assert.deepEqual(safeAdminLocation('service-orders', { shopScope: 'OTHER' }).query, {});
});
test('an exact booking filter only survives on a permitted after-sales route with a concrete shop', () => {
  const route = { view: 'post-sales' as const, query: { shopId: '5', bookingId: '42' } };
  const search = adminLocationSearch(route);
  assert.deepEqual(readAdminLocation(search), route);
  assert.deepEqual(restoreAdminLocation('ADMIN:7', browser(search), () => true), route);
  assert.deepEqual(readAdminLocation(search, view => view !== 'post-sales'), { view: 'dashboard', query: {} });
  assert.deepEqual(readAdminLocation('?module=post-sales&bookingId=42&shopScope=ALL').query, { shopScope: 'ALL' });
  assert.deepEqual(readAdminLocation('?module=post-sales&bookingId=9223372036854775808&shopId=5').query, { shopId: '5' });
  assert.deepEqual(readAdminLocation('?module=service-orders&bookingId=42&shopId=5').query, { shopId: '5' });
});
test('same-identity refresh restores local committed free text, while copied URLs contain only structural state', () => {
  const win = browser('?module=user-list');
  restoreAdminLocation('ADMIN:7', win, () => true);
  writeAdminLocation({ view: 'user-list', query: { search: 'private@example.invalid', status: 'SUSPENDED', page: 3, pageSize: 50 } }, 'ADMIN:7', win, true);
  assert.equal(win.location.search.includes('private'), false);
  assert.equal(restoreAdminLocation('ADMIN:7', win, () => true).query.search, 'private@example.invalid');
  assert.equal(readAdminLocation(win.location.search).query.search, undefined);
});
test('identity replacement, foreign history and logout discard another account’s list context', () => {
  const win = browser('?module=audit-logs&operatorId=7&page=3&limit=50');
  restoreAdminLocation('ADMIN:7', win, () => true);
  assert.deepEqual(restoreAdminLocation('ADMIN:8', win, () => true), { view: 'dashboard', query: {} });
  win.history.replaceState({ adminIdentity: 'ADMIN:7' }, '', '/admin/?module=audit-logs&targetId=1');
  assert.equal(restoreAdminLocation('ADMIN:8', win, () => true).view, 'dashboard');
  clearAdminLocation(win);
  assert.equal(win.location.search, '');
  assert.equal(win.history.state, null);
});
