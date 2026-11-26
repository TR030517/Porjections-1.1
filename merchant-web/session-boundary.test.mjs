import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import { createServer } from 'vite';

const first = { id: '901', role: 'MERCHANT', name: 'First local shop' };
const second = { id: '902', role: 'MERCHANT', name: 'Second local shop' };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function reply(config, data = {}) { return { data, status: 200, statusText: 'OK', headers: {}, config }; }
function unauthorized(config) { return new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, { ...reply(config), status: 401 }); }
async function context(adapter, work) {
  const previous = axios.defaults.adapter;
  axios.defaults.adapter = adapter;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const store = await server.ssrLoadModule('/src/stores/authStore.ts');
    const transport = await server.ssrLoadModule('/src/api/client.ts');
    const auth = await server.ssrLoadModule('/src/api/auth.ts');
    await work({ ...transport, ...auth, ...store });
  } finally { await server.close(); axios.defaults.adapter = previous; }
}

test('a late old-account success cannot populate a newly signed-in workspace', async () => {
  const started = deferred(), finish = deferred();
  await context(async config => { started.resolve(); await finish.promise; return reply(config, { privateRows: ['old account'] }); }, async ({ default: client, beginSession, useAuthStore }) => {
    useAuthStore.getState().setAuth('first-token', first);
    const request = client.get('/merchant/shops/11/bookings');
    const rejected = assert.rejects(request, error => axios.isCancel(error));
    await started.promise;
    beginSession(); useAuthStore.getState().setAuth('second-token', second);
    finish.resolve(); await rejected;
    assert.equal(useAuthStore.getState().merchant.id, second.id);
  });
});

test('an old-account 401 never refreshes or replays a mutation as the new account', async () => {
  const started = deferred(), finish = deferred(); const requests = [];
  await context(async config => { requests.push(config.url); started.resolve(); await finish.promise; throw unauthorized(config); }, async ({ default: client, beginSession, useAuthStore }) => {
    useAuthStore.getState().setAuth('first-token', first);
    const request = client.patch('/merchant/services/11', { isActive: false });
    const rejected = assert.rejects(request, error => axios.isCancel(error));
    await started.promise;
    beginSession(); useAuthStore.getState().setAuth('second-token', second);
    finish.resolve(); await rejected;
    assert.deepEqual(requests, ['/merchant/services/11']);
    assert.equal(useAuthStore.getState().token, 'second-token');
  });
});

test('a shared refresh cookie belonging to another identity cannot replay this workspace command', async () => {
  const requests = [];
  await context(async config => {
    requests.push(config.url);
    if (config.url === '/auth/refresh') return reply(config, { accessToken: 'different-token', user: second });
    throw unauthorized(config);
  }, async ({ default: client, useAuthStore }) => {
    useAuthStore.getState().setAuth('expired-first-token', first);
    await assert.rejects(client.post('/bookings/11/offline-receipts', { requestKey: 'same-request-key' }));
    assert.deepEqual(requests, ['/bookings/11/offline-receipts', '/auth/refresh']);
    assert.equal(useAuthStore.getState().merchant, null);
    assert.equal(useAuthStore.getState().token, null);
  });
});

test('after a mismatched refresh, another pending old-account 401 cannot restore that other identity', async () => {
  const secondStarted = deferred(), secondFinish = deferred(); const requests = [];
  await context(async config => {
    requests.push(config.url);
    if (config.url === '/auth/refresh') return reply(config, { accessToken: 'different-token', user: second });
    if (config.url === '/old-second-command') { secondStarted.resolve(); await secondFinish.promise; }
    throw unauthorized(config);
  }, async ({ default: client, useAuthStore }) => {
    useAuthStore.getState().setAuth('expired-first-token', first);
    const pending = client.patch('/old-second-command', { value: 'first identity' });
    const rejected = assert.rejects(pending, error => axios.isCancel(error));
    await secondStarted.promise;
    await assert.rejects(client.patch('/old-first-command', { value: 'first identity' }));
    secondFinish.resolve(); await rejected;
    assert.equal(requests.filter(url => url === '/auth/refresh').length, 1);
    assert.equal(requests.filter(url => url === '/old-second-command').length, 1);
    assert.equal(useAuthStore.getState().merchant, null);
  });
});

test('a new generation starts its own refresh and a stale completion cannot erase it', async () => {
  const starts = [deferred(), deferred()], finishes = [deferred(), deferred()]; let count = 0;
  await context(async config => {
    const index = count++; starts[index].resolve(); await finishes[index].promise;
    return reply(config, { accessToken: index ? 'current-token' : 'stale-token', user: index ? second : first });
  }, async ({ beginSession, restoreSession, useAuthStore }) => {
    useAuthStore.getState().setAuth('first-token', first);
    const old = restoreSession(); await starts[0].promise;
    beginSession(); useAuthStore.getState().setAuth('second-token', second);
    const current = restoreSession(); await starts[1].promise;
    finishes[0].resolve(); assert.equal(await old, false);
    finishes[1].resolve(); assert.equal(await current, true);
    assert.equal(count, 2); assert.equal(useAuthStore.getState().token, 'current-token');
  });
});

test('a late logout response does not clear a later explicit login', async () => {
  const started = deferred(), finish = deferred();
  await context(async config => { started.resolve(); await finish.promise; return reply(config); }, async ({ beginSession, endSession, useAuthStore }) => {
    useAuthStore.getState().setAuth('first-token', first);
    const logout = endSession(); await started.promise;
    beginSession(); useAuthStore.getState().setAuth('second-token', second);
    finish.resolve(); await logout;
    assert.equal(useAuthStore.getState().token, 'second-token');
  });
});

test('out-of-order explicit login responses keep only the most recent identity', async () => {
  const starts = [deferred(), deferred()], finishes = [deferred(), deferred()]; let count = 0;
  await context(async config => {
    const index = count++; starts[index].resolve(); await finishes[index].promise;
    return reply(config, { accessToken: index ? 'second-token' : 'first-token', user: index ? second : first });
  }, async ({ merchantLogin, useAuthStore }) => {
    const old = merchantLogin('first-local', 'local-test-only');
    const rejected = assert.rejects(old, error => axios.isCancel(error));
    await starts[0].promise;
    const current = merchantLogin('second-local', 'local-test-only'); await starts[1].promise;
    finishes[1].resolve(); await current;
    finishes[0].resolve(); await rejected;
    assert.equal(useAuthStore.getState().merchant.id, second.id);
  });
});
