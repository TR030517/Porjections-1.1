import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedShopReadiness, getShopReadiness, type ReadinessCheck, type ShopReadiness } from './shopReadiness';
import { ReadinessLoader, bookingConfigurationLinks, bookingSetupAction, readinessDestination, readinessSelection, type ReadinessLoadState } from '../components/store/readinessModel';
import { buildShopReadiness } from '../../backend/src/modules/admin/shop-readiness.rules';

const shopId = '9007199254740997', serviceId = '9007199254740999', therapistId = '9007199254741001';
const check = (key: string, state: ReadinessCheck['state'] = 'PASS', action?: ReadinessCheck['action']): ReadinessCheck => ({ key, state, label: '合成检查项', detail: '仅用于离线测试的配置说明。', ...(action ? { action } : {}) });
function snapshot(id = shopId): ShopReadiness {
  return { schemaVersion: 1, checkedAt: '2026-10-29T01:02:03.000Z', shop: { id, name: 'Synthetic Store', status: 'APPROVED' },
    publication: { ready: true, publicVisible: true, checks: [...['name', 'timezone', 'contact', 'address', 'hours'].map(key => check(key)), check('publicStatus', 'PASS', { kind: 'store-section', section: 'review' })] },
    access: { loginReady: false, checks: [check('loginReady', 'ATTENTION', { kind: 'accounts' })] },
    booking: { enabled: true, payAtStoreEnabled: false, checks: [check('onlineBooking', 'PASS', { kind: 'store-section', section: 'hours' }), check('payAtStore', 'INFO', { kind: 'reservation', tab: 'services' }), check('onlinePayment', 'INFO')] },
    presentation: { checks: [check('description', 'INFO', { kind: 'store-section', section: 'basic' })] },
    services: [
      { id: serviceId, name: 'Synthetic Active Service', isActive: true, mode: 'VARIANTS', checks: [check('price', 'PASS', { kind: 'reservation', tab: 'services', serviceId }), check('shifts', 'ATTENTION', { kind: 'reservation', tab: 'therapists', therapistId })] },
      { id: '9007199254741000', name: 'Synthetic Disabled Service', isActive: false, mode: 'LEGACY', checks: [check('price', 'INFO', { kind: 'reservation', tab: 'services', serviceId: '9007199254741000' })] },
    ], summary: { activeServices: 1, disabledServices: 1, activeServicesWithFindings: 1 }, limitations: ['仅检查已保存配置，不保证实时有空位。'] };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('current publication checks accept a complete store without a manual coordinates check', () => {
  const data = snapshot();
  assert.equal(data.publication.checks.some(item => item.key === 'coordinates'), false);
  assert.equal(checkedShopReadiness(data, shopId).publication.ready, true);
  data.publication.checks.find(item => item.key === 'address')!.state = 'ATTENTION';
  data.publication.ready = false;
  assert.equal(checkedShopReadiness(data, shopId).publication.ready, false);
});

test('the actual backend readiness projection validates when store accounts intentionally cannot log in', () => {
  const response = buildShopReadiness({
    shop: { id: 1335n, name: 'Synthetic Imported Store', shortName: 'synthetic-imported', status: 'APPROVED', deletedAt: null,
      timezone: 'America/Los_Angeles', phone: '+12025550149', address: 'Synthetic street', city: 'Seattle', state: 'WA',
      businessHours: { monday: { open: '10:00', close: '20:00' } }, studioProfile: { features: { onlineBooking: true } } },
    services: [], variants: [], therapists: [], shifts: [], rooms: [], images: [],
  }, false, '2026-11-06T12:00:00.000Z');
  assert.equal(response.publication.checks.some(row => row.key === 'loginAccount'), false);
  const result = checkedShopReadiness(response, '1335');
  assert.equal(result.publication.ready, true); assert.equal(result.publication.publicVisible, true);
  assert.equal(result.access.loginReady, false); assert.equal(result.booking.enabled, true);
  assert.deepEqual(result.publication.checks.find(row => row.key === 'timezone')?.action, { kind: 'store-section', section: 'basic' });
  const incomplete = structuredClone(response);
  incomplete.publication.checks = incomplete.publication.checks.filter(row => row.key !== 'hours');
  assert.throws(() => checkedShopReadiness(incomplete, '1335'), /格式无效/, 'removing the obsolete login prerequisite must retain the actual publishing contract checks');
});

test('readiness transport is a no-store authenticated GET for the exact int64 shop without body, slot calls or writes', async () => {
  const original = globalThis.fetch, calls: Array<{ url: string; method: string; body: unknown; cache?: RequestCache; credentials?: RequestCredentials }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body, cache: init?.cache, credentials: init?.credentials }); return Response.json(snapshot()); };
  try {
    const result = await getShopReadiness(shopId);
    assert.equal(result.shop.id, shopId); assert.equal(result.services[0].id, serviceId);
    assert.deepEqual(calls, [{ url: '/api/v1/admin/shop-readiness/' + shopId, method: 'GET', body: undefined, cache: 'no-store', credentials: 'include' }]);
  } finally { globalThis.fetch = original; }
});

test('invalid shop IDs fail before transport, and cross-shop snapshots never appear as valid results', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json(snapshot('8')); };
  try {
    for (const id of ['0', '01', '9223372036854775808', '../1', '1e3']) await assert.rejects(getShopReadiness(id), /有效.*门店/);
    assert.equal(calls, 0);
    await assert.rejects(getShopReadiness(shopId), /格式无效/);
  } finally { globalThis.fetch = original; }
});

test('malformed actions, enums, dates, missing required checks and unsafe identities fail the entire snapshot', () => {
  const mutations: Array<(data: ShopReadiness) => void> = [
    data => { data.checkedAt = '2026-02-30T01:00:00.000Z'; }, data => { data.checkedAt = '10/29/2026'; },
    data => { data.shop.id = Number(shopId) as unknown as string; }, data => { data.shop.status = 'UNKNOWN'; },
    data => { data.publication.checks[1].key = 'name'; }, data => { data.publication.checks = data.publication.checks.filter(item => item.key !== 'timezone'); },
    data => { data.publication.ready = false; }, data => { data.access.checks[0].state = 'READY' as 'PASS'; },
    data => { data.booking.checks[0].action = { kind: 'url', url: 'https://example.invalid/' } as unknown as ReadinessCheck['action']; },
    data => { data.publication.checks[0].action = { kind: 'store-section', section: 'unsupported' } as unknown as ReadinessCheck['action']; },
    data => { data.services[0].checks[0].action = { kind: 'reservation', tab: 'services', serviceId: '8' }; },
    data => { data.services[0].checks[1].action = { kind: 'reservation', tab: 'therapists', therapistId: '01' }; },
    data => { data.services[0].mode = 'UNKNOWN' as 'LEGACY'; }, data => { data.limitations = []; },
  ];
  for (const mutate of mutations) { const data = snapshot(); mutate(data); assert.throws(() => checkedShopReadiness(data, shopId), /格式无效/); }
});

test('summary is checked against active services only; disabled preparation stays separate and over-limit output is rejected', () => {
  const data = snapshot(); data.services[1].checks[0].state = 'ATTENTION';
  assert.equal(checkedShopReadiness(data, shopId).summary.activeServicesWithFindings, 1);
  data.summary.activeServicesWithFindings = 2; assert.throws(() => checkedShopReadiness(data, shopId), /格式无效/);
  const duplicate = snapshot(); duplicate.services[1].id = serviceId; assert.throws(() => checkedShopReadiness(duplicate, shopId), /格式无效/);
  const overflow = snapshot(); overflow.services = Array.from({ length: 501 }, (_, index) => ({ ...overflow.services[1], id: String(index + 1) })); assert.throws(() => checkedShopReadiness(overflow, shopId), /格式无效/);
});

test('closed response projection discards unexpected credential fields and URL properties while preserving allowed actions', () => {
  const data = snapshot() as ShopReadiness & { unexpected: unknown };
  data.unexpected = { passwordHash: 'synthetic-not-a-hash' };
  Object.assign(data.access, { password: 'synthetic-not-a-password' });
  Object.assign(data.access.checks[0].action!, { href: '/merchant/?shopId=wrong' });
  const clean = checkedShopReadiness(data, shopId);
  assert.deepEqual(clean.access.checks[0].action, { kind: 'accounts' });
  assert.equal(JSON.stringify(clean).includes('synthetic-not'), false);
  assert.equal(JSON.stringify(clean).includes('href'), false);
});

test('repair navigation preserves exact shop and selected service/therapist/tab without URL construction or role changes', () => {
  assert.deepEqual(readinessDestination(shopId, { kind: 'store-section', section: 'hours' }), { kind: 'section', section: 'hours' });
  assert.deepEqual(readinessDestination(shopId, { kind: 'accounts' }), { kind: 'page', view: 'merchant-list', query: { shopId, returnToReview: true } });
  for (const kind of ['services', 'technicians'] as const) assert.deepEqual(readinessDestination(shopId, { kind }), { kind: 'page', view: kind, query: { shopId, returnToReview: true } });
  assert.deepEqual(readinessDestination(shopId, { kind: 'reservation', tab: 'therapists', serviceId, therapistId }), { kind: 'page', view: 'reservation-settings', query: { shopId, returnToReview: true, tab: 'therapists', serviceId, therapistId } });
  assert.deepEqual(readinessDestination(shopId, { kind: 'reservation', tab: 'rooms' }), { kind: 'page', view: 'reservation-settings', query: { shopId, returnToReview: true, tab: 'rooms' } });
  assert.throws(() => readinessDestination('../8', { kind: 'accounts' }), /目标门店无效/);
});

test('booking prerequisites link to actual settings and never treat intentionally disabled merchant login as a booking blocker', () => {
  const data = snapshot(), before = structuredClone(data);
  assert.deepEqual(bookingConfigurationLinks(data), [], 'a disabled login and a custom schedule finding are not missing store basics');
  for (const key of ['timezone', 'hours']) data.publication.checks.find(row => row.key === key)!.state = 'ATTENTION';
  data.publication.checks.find(row => row.key === 'timezone')!.action = { kind: 'store-section', section: 'hours' };
  data.booking.checks[0].state = 'ATTENTION';
  data.services[0].checks.push(check('staff', 'ATTENTION', { kind: 'technicians' }));
  data.services.push({ id: '9007199254741002', name: 'Second active service', isActive: true, mode: 'LEGACY', checks: [check('staff', 'ATTENTION', { kind: 'technicians' })] });
  data.services[1].checks.push(check('staff', 'ATTENTION', { kind: 'technicians' }));
  const links = bookingConfigurationLinks(data);
  assert.deepEqual(links.map(row => [row.key, row.action]), [
    ['timezone', { kind: 'store-section', section: 'basic' }], ['hours', { kind: 'store-section', section: 'hours' }],
    ['onlineBooking', { kind: 'store-section', section: 'hours' }], ['staff-count', { kind: 'technicians' }],
  ]);
  assert.match(links.at(-1)!.detail, /2 个启用项目/);
  assert.equal(links.some(row => row.action.kind === 'accounts'), false);
  assert.deepEqual(before.access, data.access, 'collecting links never changes account permissions');
  assert.deepEqual(bookingSetupAction({ key: 'timezone', kind: 'timezone', serviceName: 'Basic', message: '', action: '' }), { kind: 'store-section', section: 'basic' });
  assert.deepEqual(bookingSetupAction({ key: 'hours', kind: 'hours', serviceName: 'Hours', message: '', action: '' }), { kind: 'store-section', section: 'hours' });
  assert.deepEqual(bookingSetupAction({ key: 'staff', kind: 'staff', serviceName: 'Staff', message: '', action: '' }), { kind: 'technicians' });
});

test('explicit missing service or therapist never falls back to another record; int64 selection stays exact', () => {
  const items = [{ id: '1', name: 'First' }, { id: therapistId, name: 'Requested' }];
  assert.equal(readinessSelection(items, therapistId)?.name, 'Requested');
  assert.equal(readinessSelection(items, '9007199254741002'), undefined);
  assert.equal(readinessSelection(items, '')?.name, 'First');
  assert.equal(readinessSelection(undefined, therapistId), undefined);
});

test('switching shops discards a late old response even when the transport ignores its aborted signal', async () => {
  const first = deferred<ShopReadiness>(), second = deferred<ShopReadiness>(), states: ReadinessLoadState[] = [], signals: AbortSignal[] = [];
  const loader = new ReadinessLoader((id, signal) => { signals.push(signal); return id === shopId ? first.promise : second.promise; });
  const old = loader.read(shopId, state => states.push(state));
  const current = loader.read('8', state => states.push(state));
  assert.equal(signals[0].aborted, true);
  second.resolve(snapshot('8')); await current; first.resolve(snapshot()); await old;
  assert.deepEqual(states.map(state => [state.shopId, state.loading]), [[shopId, true], ['8', true], ['8', false]]);
  assert.equal(states.at(-1)?.data?.shop.id, '8');
});

test('a newer same-shop refresh failure cannot be replaced by a stale successful snapshot', async () => {
  const first = deferred<ShopReadiness>(), second = deferred<ShopReadiness>(), states: ReadinessLoadState[] = []; let calls = 0;
  const loader = new ReadinessLoader(() => (++calls === 1 ? first : second).promise);
  const old = loader.read(shopId, state => states.push(state)), current = loader.read(shopId, state => states.push(state));
  second.reject(new Error('合成检查失败')); await current; first.resolve(snapshot()); await old;
  assert.equal(states.at(-1)?.data, null); assert.equal(states.at(-1)?.error, '合成检查失败');
  assert.equal(states.filter(state => state.data).length, 0);
});

test('closing the diagnostics invalidates its in-flight result and never publishes after cancellation', async () => {
  const response = deferred<ShopReadiness>(), states: ReadinessLoadState[] = [];
  const loader = new ReadinessLoader(() => response.promise), running = loader.read(shopId, state => states.push(state));
  loader.cancel(); response.resolve(snapshot()); await running;
  assert.equal(states.length, 1); assert.equal(states[0].loading, true);
});

test('refresh clears the prior green snapshot immediately and keeps unexpected transport errors in Chinese', async () => {
  const response = deferred<ShopReadiness>(), states: ReadinessLoadState[] = []; let calls = 0;
  const loader = new ReadinessLoader(() => ++calls === 1 ? Promise.resolve(snapshot()) : response.promise);
  await loader.read(shopId, state => states.push(state));
  const running = loader.read(shopId, state => states.push(state));
  assert.equal(states.at(-1)?.loading, true); assert.equal(states.at(-1)?.data, null);
  response.reject(new Error('Synthetic network failure')); await running;
  assert.equal(states.at(-1)?.data, null); assert.match(states.at(-1)!.error, /门店检查暂未完成/);
});
