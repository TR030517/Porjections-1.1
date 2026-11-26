import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const shopId = '9007199254740997', targetId = '9007199254740999';
const serverOptions = { server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' };
const response = (config, data) => ({ config, data, headers: {}, status: 200, statusText: 'OK' });
let defaultSessionStorage;
beforeEach(() => { defaultSessionStorage = temporarySessionStorage(); });
afterEach(() => { defaultSessionStorage.restore(); });

test('independent login names use the identifier endpoint and do not require an email alias', async () => {
  const calls = [];
  axios.defaults.adapter = async config => {
    calls.push({ url: config.url, body: JSON.parse(config.data) });
    return response(config, { accessToken: 'synthetic-access-token', user: { id: shopId, role: 'MERCHANT', loginName: 'angel-foot', name: 'Synthetic account', email: null } });
  };
  const server = await createServer(serverOptions);
  try {
    const { merchantLogin } = await server.ssrLoadModule('/src/api/auth.ts');
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    await merchantLogin('angel-foot', 'Synthetic-password-123');
    assert.deepEqual(calls, [{ url: '/auth/login', body: { identifier: 'angel-foot', password: 'Synthetic-password-123' } }]);
    assert.equal(useAuthStore.getState().merchant.loginName, 'angel-foot');
    assert.equal(useAuthStore.getState().merchant.email, null);
    useAuthStore.getState().logout();
  } finally { await server.close(); }
});

test('associated shop permissions never become ownership and staff choices remain the original six', async () => {
  const server = await createServer(serverOptions);
  try {
    const { hasShopPermission, initialShopRoute, staffPermissions, withBookingRead } = await server.ssrLoadModule('/src/utils/shopPermissions.ts');
    const associated = { accessType: 'ASSOCIATED', isOwner: true, permissions: ['CATALOG_MANAGE'] };
    assert.equal(hasShopPermission(associated, 'OWNER_ONLY'), false);
    assert.equal(hasShopPermission(associated, 'CATALOG_MANAGE'), true);
    assert.equal(hasShopPermission(associated, 'SETTLEMENT_RECORD'), false);
    assert.equal(hasShopPermission({ accessType: 'OWN', isOwner: true, permissions: [] }, 'FINANCE_READ'), false, 'ordinary actions use the actual returned permissions');
    assert.equal(hasShopPermission({ accessType: 'ADMIN', isOwner: true, permissions: [] }, 'OWNER_ONLY'), true);
    assert.equal(initialShopRoute(associated), '/price-menu');
    assert.equal(initialShopRoute({ accessType: 'ASSOCIATED', permissions: ['SHOP_SETTINGS_MANAGE'] }), '/settings');
    assert.equal(staffPermissions.length, 6);
    assert.deepEqual(withBookingRead(['COPY_CONFIG', 'CATALOG_MANAGE', 'SETTLEMENT_RECORD']), ['BOOKINGS_READ', 'SETTLEMENT_RECORD']);
  } finally { await server.close(); }
});

test('requested shop IDs are relative context only and an unauthorized target never falls back to the first shop', async () => {
  const server = await createServer(serverOptions);
  try {
    const { requestedShopId, resolveShopSelection } = await server.ssrLoadModule('/src/utils/shopSelection.ts');
    const shops = [{ id: shopId, accessType: 'OWN', homeShopId: shopId }, { id: targetId, accessType: 'ASSOCIATED', homeShopId: shopId }];
    assert.equal(requestedShopId('?shopId=' + targetId), targetId);
    for (const value of ['https://example.invalid/merchant', '//example.invalid', '0', '-1', '1.5', '1/other']) assert.equal(requestedShopId('?shopId=' + encodeURIComponent(value)), '');
    assert.equal(resolveShopSelection(shops, targetId, null).selectedId, targetId);
    assert.equal(resolveShopSelection(shops, '123', shopId).selectedId, null);
    assert.match(resolveShopSelection(shops, '123', shopId).error, /未获授权/);
    assert.equal(resolveShopSelection(shops, null, targetId).selectedId, targetId);
    assert.equal(resolveShopSelection(shops, null, null).selectedId, shopId);
    assert.equal(resolveShopSelection([], null, null).selectedId, null);
  } finally { await server.close(); }
});

test('shop access responses preserve exact IDs and never treat an associated account as the owner', async () => {
  let invalid = false;
  axios.defaults.adapter = async config => response(config, [{ id: shopId, ownerId: '2', name: 'Synthetic shop', accessType: invalid ? 'UNKNOWN' : 'ASSOCIATED', isOwner: true, homeShopId: targetId, permissions: ['CATALOG_MANAGE'], loginAccount: null }]);
  const server = await createServer(serverOptions);
  try {
    const { getMyShops } = await server.ssrLoadModule('/src/api/merchant.ts');
    const [shop] = await getMyShops();
    assert.equal(shop.id, shopId); assert.equal(shop.homeShopId, targetId); assert.equal(shop.isOwner, false); assert.equal(shop.loginAccount, null);
    invalid = true; await assert.rejects(getMyShops(), /无法核对/);
  } finally { await server.close(); }
});

test('copy preview and retry send the exact signed shop pair and the same operation key', async () => {
  const calls = []; let wrongTarget = false;
  const input = { sourceShopId: shopId, targetShopId: targetId, kind: 'CATALOG' };
  axios.defaults.adapter = async config => {
    const body = JSON.parse(config.data); calls.push({ url: config.url, body });
    return response(config, config.url.endsWith('/preview') ? { previewHash: 'signed-preview', expiresAt: '2031-01-01T00:05:00Z', summary: 'Create inactive drafts', changes: { services: [{ sourceId: '23', name: 'Synthetic service', action: 'CREATE' }] } } : { operationId: 'a12400be-cf14-49ee-909e-4284a456ea93', status: 'APPLIED', ...input, targetShopId: wrongTarget ? 'wrong' : targetId, created: 1, skipped: 0 });
  };
  const server = await createServer(serverOptions);
  try {
    const { previewCopy, applyCopy } = await server.ssrLoadModule('/src/api/accountAccess.ts');
    const preview = await previewCopy(input);
    await applyCopy(input, preview.previewHash, 'same-retry-key');
    await applyCopy(input, preview.previewHash, 'same-retry-key');
    assert.deepEqual(calls[0], { url: '/account-access/copy/preview', body: input });
    assert.deepEqual(calls[1], calls[2]);
    assert.deepEqual(calls[1].body, { ...input, previewHash: 'signed-preview', idempotencyKey: 'same-retry-key' });
    wrongTarget = true; await assert.rejects(applyCopy(input, preview.previewHash, 'same-retry-key'), /无法核对/);
  } finally { await server.close(); }
});

test('malformed copy previews and non-applied results cannot appear as successful copies', async () => {
  const server = await createServer(serverOptions);
  axios.defaults.adapter = async config => response(config, config.url.endsWith('/preview') ? { previewHash: '', expiresAt: 'invalid', changes: {} } : { status: 'PENDING' });
  try {
    const { previewCopy, applyCopy } = await server.ssrLoadModule('/src/api/accountAccess.ts');
    const input = { sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' };
    await assert.rejects(previewCopy(input), /无法核对/);
    await assert.rejects(applyCopy(input, 'signed-preview', 'same-retry-key'), /无法核对/);
  } finally { await server.close(); }
});

const recoveryPreview = { previewHash: 'synthetic-signed-preview', expiresAt: '2031-01-01T00:05:00Z', summary: 'Copy inactive drafts', changes: { services: [] } };
// Fixtures mirror the selected copy kind; HOURS has no created catalog rows.
const hoursRecoveryPreview = { ...recoveryPreview, summary: 'Copy opening hours', changes: { hours: { from: null, to: { monday: { closed: true } } } } };
const appliedCopy = (input, operationId = 'a12400be-cf14-49ee-909e-4284a456ea93') => ({ operationId, status: 'APPLIED', ...input, created: input.kind === 'HOURS' ? 0 : 1, skipped: 0 });

test('copy recovery survives detached and reattached views and records a late authoritative reply', async () => {
  const calls = []; let resolveRequest;
  axios.defaults.adapter = config => new Promise(resolve => { calls.push(JSON.parse(config.data)); resolveRequest = () => resolve(response(config, appliedCopy(calls[0]))); });
  const server = await createServer(serverOptions);
  try {
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    useAuthStore.getState().setAuth('synthetic-token', { id: '41', role: 'MERCHANT' });
    const input = { sourceShopId: shopId, targetShopId: targetId, kind: 'CATALOG' };
    const attempt = recovery.beginRecoverableCopy(input, recoveryPreview);
    const saved = recovery.useCopyRecoveryStore.getState().operation;
    assert.equal(saved.state, 'IN_FLIGHT');
    input.targetShopId = '999';
    const detach = recovery.useCopyRecoveryStore.subscribe(() => {}); detach();
    const restored = recovery.useCopyRecoveryStore.getState().operation;
    assert.equal(restored.input.targetShopId, targetId, 'workspace changes cannot mutate the saved target');
    assert.equal(restored.preview.previewHash, recoveryPreview.previewHash);
    assert.throws(() => recovery.finishRecoverableCopy(), /结果仍未知/);
    await assert.rejects(recovery.beginRecoverableCopy(input, recoveryPreview), /完成或核对现有操作/);
    await Promise.resolve();
    assert.equal(calls.length, 1, 'reattaching a view never retries automatically');
    resolveRequest(); await attempt;
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'APPLIED');
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.idempotencyKey, saved.idempotencyKey);
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.result.targetShopId, targetId);
    recovery.finishRecoverableCopy();
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    useAuthStore.getState().logout();
  } finally { await server.close(); }
});

test('an unknown copy retries the exact body and key; a later denial never erases the original uncertainty', async () => {
  const calls = [];
  axios.defaults.adapter = async config => {
    const body = JSON.parse(config.data); calls.push(body);
    if (calls.length === 1) throw new Error('Synthetic lost response');
    if (calls.length === 2) throw Object.assign(new Error('Synthetic access revoked'), { response: { status: 403, data: { message: 'Access no longer available' } } });
    return response(config, appliedCopy(body));
  };
  const server = await createServer(serverOptions);
  try {
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    useAuthStore.getState().setAuth('synthetic-token', { id: '41', role: 'MERCHANT' });
    await recovery.beginRecoverableCopy({ sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, hoursRecoveryPreview);
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'UNKNOWN');
    assert.throws(() => recovery.finishRecoverableCopy(), /结果仍未知/);
    await assert.rejects(recovery.beginRecoverableCopy({ sourceShopId: targetId, targetShopId: shopId, kind: 'HOURS' }, hoursRecoveryPreview), /完成或核对现有操作/);
    await recovery.retryRecoverableCopy();
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'UNKNOWN');
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.attempts, 2);
    await recovery.retryRecoverableCopy();
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'APPLIED');
    assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[1], calls[2]);
    assert.equal(calls[0].previewHash, recoveryPreview.previewHash);
    useAuthStore.getState().logout();
  } finally { await server.close(); }
});

test('copy recovery is cleared on actor changes and logout, and prior session replies cannot overwrite a new operation', async () => {
  let finishOld;
  axios.defaults.adapter = config => {
    const body = JSON.parse(config.data);
    if (config.headers.Authorization === 'Bearer actor-a-token') return new Promise(resolve => { finishOld = () => resolve(response(config, appliedCopy(body, 'b12400be-cf14-49ee-909e-4284a456ea93'))); });
    return Promise.resolve(response(config, appliedCopy(body, 'c12400be-cf14-49ee-909e-4284a456ea93')));
  };
  const server = await createServer(serverOptions);
  try {
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    useAuthStore.getState().setAuth('actor-a-token', { id: '41', role: 'MERCHANT' });
    const oldAttempt = recovery.beginRecoverableCopy({ sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, hoursRecoveryPreview);
    await Promise.resolve();
    useAuthStore.getState().setAuth('actor-b-token', { id: '42', role: 'ADMIN' });
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    await assert.rejects(recovery.retryRecoverableCopy(), /暂无可重试的未核实复制/);
    await recovery.beginRecoverableCopy({ sourceShopId: targetId, targetShopId: shopId, kind: 'CATALOG' }, recoveryPreview);
    finishOld(); await oldAttempt;
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.actorId, '42');
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.result.operationId, 'c12400be-cf14-49ee-909e-4284a456ea93');
    useAuthStore.getState().logout();
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    useAuthStore.getState().setAuth('actor-b-new-session', { id: '42', role: 'ADMIN' });
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    useAuthStore.getState().logout();
  } finally { await server.close(); }
});

test('a definitive first-attempt rejection can be closed explicitly instead of being reported as a copied configuration', async () => {
  axios.defaults.adapter = async () => { throw Object.assign(new Error('Synthetic stale preview'), { response: { status: 409, data: { message: 'Preview expired' } } }); };
  const server = await createServer(serverOptions);
  try {
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    useAuthStore.getState().setAuth('synthetic-token', { id: '41', role: 'MERCHANT' });
    await recovery.beginRecoverableCopy({ sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, hoursRecoveryPreview);
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'REJECTED');
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.result, null);
    recovery.finishRecoverableCopy();
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    useAuthStore.getState().logout();
  } finally { await server.close(); }
});

test('copy resolution is read-only and accepts only the original signed pair, key and authoritative reason', async () => {
  const calls = [], input = { sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' };
  let answer = { ...input, idempotencyKey: 'synthetic-original-key', status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED' };
  axios.defaults.adapter = async config => { calls.push({ url: config.url, body: JSON.parse(config.data) }); return response(config, answer); };
  const server = await createServer(serverOptions);
  try {
    const { resolveCopy } = await server.ssrLoadModule('/src/api/accountAccess.ts');
    assert.equal((await resolveCopy(input, 'signed-preview', 'synthetic-original-key')).status, 'UNKNOWN');
    answer = { ...answer, status: 'NOT_APPLIED', reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' };
    assert.equal((await resolveCopy(input, 'signed-preview', 'synthetic-original-key')).status, 'NOT_APPLIED');
    assert.deepEqual(calls[0], { url: '/account-access/copy/resolve', body: { ...input, previewHash: 'signed-preview', idempotencyKey: 'synthetic-original-key' } });
    assert.deepEqual(calls[1], calls[0]);
    for (const invalid of [{ ...answer, targetShopId: '4' }, { ...answer, idempotencyKey: 'different-key' }, { ...answer, reason: 'COPY_REQUEST_STILL_UNCONFIRMED' }]) {
      answer = invalid; await assert.rejects(resolveCopy(input, 'signed-preview', 'synthetic-original-key'), /无法核对/);
    }
    answer = appliedCopy(input);
    assert.equal((await resolveCopy(input, 'signed-preview', 'synthetic-original-key')).status, 'APPLIED');
  } finally { await server.close(); }
});

test('copy history is explicitly paginated, preserves exact IDs and rejects malformed rows', async () => {
  const calls = [], input = { sourceShopId: shopId, targetShopId: targetId, kind: 'CATALOG' };
  let bad = false;
  axios.defaults.adapter = async config => {
    calls.push({ url: config.url, params: config.params });
    return response(config, { items: [{ ...appliedCopy(input), createdAt: bad ? 'not-a-date' : '2031-01-01T00:00:00Z', sourceShopName: 'Synthetic source', targetShopName: 'Synthetic target' }], total: 41, page: 2, limit: 20 });
  };
  const server = await createServer(serverOptions);
  try {
    const { getCopyHistory } = await server.ssrLoadModule('/src/api/accountAccess.ts');
    const result = await getCopyHistory(2, 20);
    assert.equal(result.items[0].targetShopId, targetId);
    assert.deepEqual(calls[0], { url: '/account-access/copy/history', params: { page: 2, limit: 20 } });
    bad = true; await assert.rejects(getCopyHistory(2, 20), /无法核对/);
    await assert.rejects(getCopyHistory(0, 20), /分页无效/);
  } finally { await server.close(); }
});

function temporarySessionStorage(initial = new Map(), failWrites = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = { getItem: key => initial.get(key) ?? null, setItem: (key, value) => { if (failWrites) throw new Error('Synthetic quota exceeded'); initial.set(key, value); }, removeItem: key => { initial.delete(key); } };
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  return { values: initial, setFailWrites: value => { failWrites = value; }, restore: () => { if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete globalThis.sessionStorage; } };
}

test('refresh restores only a minimal same-actor marker as UNKNOWN and never applies or retries automatically', async () => {
  const storage = temporarySessionStorage(), calls = [];
  let server = await createServer(serverOptions), recoveredAuth;
  let checking = false, resolution = 'UNKNOWN';
  // Axios snapshots its adapter when the API client is created. Keep one
  // adapter and vary its response through the simulated refresh lifecycle.
  axios.defaults.adapter = async config => {
    calls.push(config.url);
    if (!checking) throw new Error('Synthetic lost response');
    const body = JSON.parse(config.data);
    return response(config, { ...body, status: resolution, reason: resolution === 'UNKNOWN' ? 'COPY_REQUEST_STILL_UNCONFIRMED' : 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' });
  };
  try {
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    useAuthStore.getState().setAuth('never-store-auth-token', { id: '41', role: 'MERCHANT' });
    await recovery.beginRecoverableCopy({ sourceShopId: shopId, targetShopId: targetId, kind: 'CATALOG' }, { ...recoveryPreview, changes: { services: [{ sourceId: '4', name: 'Never store catalog details', action: 'CREATE' }] } });
    const raw = storage.values.get(recovery.COPY_RECOVERY_STORAGE_KEY), marker = JSON.parse(raw);
    assert.deepEqual(Object.keys(marker).sort(), ['actorId', 'expiresAt', 'input', 'key', 'previewHash', 'v']);
    assert.ok(!raw.includes('never-store-auth-token')); assert.ok(!raw.includes('Never store catalog details')); assert.ok(!raw.includes('summary')); assert.ok(!raw.includes('changes'));
    const originalKey = marker.key;
    await server.close(); server = await createServer(serverOptions);
    const fresh = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    recoveredAuth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    assert.equal(fresh.useCopyRecoveryStore.getState().operation, null, 'auth initialization has not completed');
    assert.equal(storage.values.size, 1, 'boot does not erase a pending marker before the actor is known');
    recoveredAuth.getState().setAuth('fresh-auth-token', { id: '41', role: 'MERCHANT' });
    const restored = fresh.useCopyRecoveryStore.getState().operation;
    assert.equal(restored.state, 'UNKNOWN'); assert.equal(restored.restored, true); assert.equal(restored.idempotencyKey, originalKey);
    assert.deepEqual(restored.preview.changes, {}); assert.equal(calls.length, 1);
    checking = true;
    await fresh.checkRecoverableCopy();
    assert.equal(fresh.useCopyRecoveryStore.getState().operation.state, 'UNKNOWN');
    assert.throws(() => fresh.finishRecoverableCopy(), /结果仍未知/);
    resolution = 'NOT_APPLIED'; await fresh.checkRecoverableCopy();
    assert.equal(fresh.useCopyRecoveryStore.getState().operation.state, 'NOT_APPLIED');
    assert.equal(storage.values.size, 0); fresh.finishRecoverableCopy();
    assert.equal(fresh.useCopyRecoveryStore.getState().operation, null);
    assert.deepEqual(calls, ['/account-access/copy/apply', '/account-access/copy/resolve', '/account-access/copy/resolve']);
    recoveredAuth.getState().logout();
  } finally { await server.close(); storage.restore(); }
});

test('damaged markers and another actor never restore a copy or issue a request', async () => {
  const marker = { v: 1, actorId: '41', input: { sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, key: 'synthetic-original-key', previewHash: 'signed-preview', expiresAt: '2031-01-01T00:05:00Z' };
  for (const raw of ['{broken-json', JSON.stringify({ ...marker, actorId: '42' }), JSON.stringify({ ...marker, input: { ...marker.input, targetShopId: 'https://evil.invalid' } })]) {
    const values = new Map([['massajoy.copy.pending.v1', raw]]), storage = temporarySessionStorage(values);
    const server = await createServer(serverOptions);
    let calls = 0; axios.defaults.adapter = async () => { calls++; throw new Error('Must not send'); };
    try {
      const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
      const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
      useAuthStore.getState().setAuth('synthetic-token', { id: '41', role: 'MERCHANT' });
      assert.equal(recovery.useCopyRecoveryStore.getState().operation, null); assert.equal(calls, 0); assert.equal(values.size, 0);
      useAuthStore.getState().logout();
    } finally { await server.close(); storage.restore(); }
  }
});

test('quota failure refuses initial apply; after storage recovers late status replies cannot cross actor changes', async () => {
  const storage = temporarySessionStorage(new Map(), true), server = await createServer(serverOptions);
  let completeCheck, markCheckStarted, applyCalls = 0;
  const checkStarted = new Promise(resolve => { markCheckStarted = resolve; });
  axios.defaults.adapter = async config => {
    const body = JSON.parse(config.data);
    if (config.url.endsWith('/resolve')) return new Promise(resolve => { completeCheck = () => resolve(response(config, appliedCopy(body, 'b12400be-cf14-49ee-909e-4284a456ea93'))); markCheckStarted(); });
    applyCalls++;
    throw new Error('Synthetic lost response');
  };
  try {
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    useAuthStore.getState().setAuth('actor-one', { id: '41', role: 'MERCHANT' });
    await assert.rejects(recovery.beginRecoverableCopy({ sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, hoursRecoveryPreview), /会话存储/);
    assert.equal(applyCalls, 0); assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    assert.match(recovery.useCopyRecoveryStore.getState().storageWarning, /未保存标识时不会提交复制/);
    storage.setFailWrites(false);
    await recovery.beginRecoverableCopy({ sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, hoursRecoveryPreview);
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'UNKNOWN');
    assert.equal(applyCalls, 1);
    const check = recovery.checkRecoverableCopy(); await checkStarted;
    useAuthStore.getState().setAuth('actor-two', { id: '42', role: 'ADMIN' });
    completeCheck(); await check;
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null); assert.equal(storage.values.size, 0);
    useAuthStore.getState().logout();
  } finally { await server.close(); storage.restore(); }
});

test('explicit logout removes a restored unknown marker and the same actor cannot reuse it in a new session', async () => {
  const marker = { v: 1, actorId: '41', input: { sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, key: 'synthetic-original-key', previewHash: 'signed-preview', expiresAt: '2031-01-01T00:05:00Z' };
  const storage = temporarySessionStorage(new Map([['massajoy.copy.pending.v1', JSON.stringify(marker)]])), server = await createServer(serverOptions);
  try {
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    useAuthStore.getState().setAuth('synthetic-session-one', { id: '41', role: 'MERCHANT' });
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'UNKNOWN');
    useAuthStore.getState().logout();
    assert.equal(storage.values.size, 0); assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    useAuthStore.getState().setAuth('synthetic-session-two', { id: '41', role: 'MERCHANT' });
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    useAuthStore.getState().logout();
  } finally { await server.close(); storage.restore(); }
});

test('UNKNOWN retry followed by 401 and temporary refresh 503 keeps only opaque recovery until the same actor is verified again', async () => {
  const calls = []; let applies = 0;
  axios.defaults.adapter = async config => {
    calls.push(config.url);
    if (config.url === '/auth/refresh') throw new axios.AxiosError('Synthetic refresh unavailable', 'ERR_BAD_RESPONSE', config, null, { ...response(config, {}), status: 503 });
    const body = JSON.parse(config.data);
    if (config.url.endsWith('/resolve')) return response(config, { ...body, status: 'NOT_APPLIED', reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' });
    if (++applies === 1) throw new Error('Synthetic original lost response');
    throw new axios.AxiosError('Synthetic access expired', 'ERR_BAD_REQUEST', config, null, { ...response(config, {}), status: 401 });
  };
  const server = await createServer(serverOptions);
  try {
    const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const recovery = await server.ssrLoadModule('/src/stores/copyRecoveryStore.ts');
    useAuthStore.getState().setAuth('synthetic-initial-session', { id: '41', role: 'MERCHANT' });
    await recovery.beginRecoverableCopy({ sourceShopId: shopId, targetShopId: targetId, kind: 'HOURS' }, hoursRecoveryPreview);
    const marker = sessionStorage.getItem(recovery.COPY_RECOVERY_STORAGE_KEY);
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'UNKNOWN');
    await recovery.retryRecoverableCopy();
    assert.equal(useAuthStore.getState().merchant, null); assert.equal(useAuthStore.getState().token, null);
    assert.equal(useAuthStore.getState().explicitLogout, false);
    assert.equal(recovery.useCopyRecoveryStore.getState().operation, null);
    assert.equal(sessionStorage.getItem(recovery.COPY_RECOVERY_STORAGE_KEY), marker);
    useAuthStore.getState().setAuth('synthetic-reverified-session', { id: '41', role: 'MERCHANT' });
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'UNKNOWN');
    assert.deepEqual(recovery.useCopyRecoveryStore.getState().operation.preview.changes, {});
    assert.deepEqual(calls, ['/account-access/copy/apply', '/account-access/copy/apply', '/auth/refresh']);
    await recovery.checkRecoverableCopy();
    assert.equal(recovery.useCopyRecoveryStore.getState().operation.state, 'NOT_APPLIED');
    assert.equal(sessionStorage.getItem(recovery.COPY_RECOVERY_STORAGE_KEY), null);
    assert.equal(applies, 2); recovery.finishRecoverableCopy(); useAuthStore.getState().logout();
  } finally { await server.close(); }
});
