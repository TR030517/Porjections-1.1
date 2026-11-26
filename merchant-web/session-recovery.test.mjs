import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import { createServer } from 'vite';

const merchant = { id: '901', role: 'MERCHANT', name: 'Synthetic merchant' };
const reply = (config, data = {}) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
async function context(adapter, work) {
  const previous = axios.defaults.adapter;
  axios.defaults.adapter = adapter;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const auth = await server.ssrLoadModule('/src/stores/authStore.ts');
    const client = await server.ssrLoadModule('/src/api/client.ts');
    await work({ ...auth, ...client });
  } finally { await server.close(); axios.defaults.adapter = previous; }
}
const failed = (config, status) => status === undefined ? new AxiosError('Network Error', 'ERR_NETWORK', config) : new AxiosError('Refresh failed', 'ERR_BAD_RESPONSE', config, null, { ...reply(config), status });

test('an unidentified initial transport or temporary server failure preserves recovery intent without authenticating', async () => {
  for (const status of [undefined, 408, 500, 503]) {
    const calls = [];
    await context(async config => { calls.push(config.url); throw failed(config, status); }, async ({ restoreSession, useAuthStore }) => {
      assert.equal(useAuthStore.getState().explicitLogout, false);
      assert.equal(await restoreSession(), false);
      const state = useAuthStore.getState();
      assert.equal(state.initialized, true);
      assert.equal(state.token, null);
      assert.equal(state.merchant, null);
      assert.equal(state.explicitLogout, false);
      assert.deepEqual(calls, ['/auth/refresh'], 'no business command is replayed');
      state.logout();
      assert.equal(useAuthStore.getState().explicitLogout, true, 'manual logout is still explicit after the temporary failure');
    });
  }
});

test('explicit refresh denials and malformed successful identities still end recovery and clear authentication', async () => {
  for (const status of [400, 401, 403, 404, 429, 'bad-success']) {
    await context(async config => {
      if (status === 'bad-success') return reply(config, { accessToken: 'wrong-role-token', user: { ...merchant, role: 'CUSTOMER' } });
      throw failed(config, status);
    }, async ({ restoreSession, useAuthStore }) => {
      assert.equal(await restoreSession(), false);
      assert.equal(useAuthStore.getState().token, null);
      assert.equal(useAuthStore.getState().merchant, null);
      assert.equal(useAuthStore.getState().explicitLogout, true);
    });
  }
});

test('known-actor refresh failures clear authentication while only temporary failures preserve opaque recovery intent', async () => {
  for (const status of [undefined, 408, 503, 401, 403]) {
    await context(async config => { throw failed(config, status); }, async ({ restoreSession, useAuthStore }) => {
      useAuthStore.getState().setAuth('known-expired-token', merchant);
      assert.equal(await restoreSession(), false);
      assert.equal(useAuthStore.getState().token, null);
      assert.equal(useAuthStore.getState().merchant, null);
      assert.equal(useAuthStore.getState().explicitLogout, status === 401 || status === 403);
    });
  }
});

test('successful authentication clears the recovery logout flag, while explicit endSession never preserves it', async () => {
  const calls = [];
  await context(async config => { calls.push(config.url); return reply(config, { accessToken: 'fresh-token', user: merchant }); }, async ({ restoreSession, endSession, useAuthStore }) => {
    useAuthStore.getState().logout();
    assert.equal(useAuthStore.getState().explicitLogout, true);
    assert.equal(await restoreSession(), true);
    assert.equal(useAuthStore.getState().explicitLogout, false);
    assert.equal(useAuthStore.getState().merchant.id, merchant.id);
    await endSession();
    assert.equal(useAuthStore.getState().explicitLogout, true);
    assert.equal(useAuthStore.getState().token, null);
    assert.equal(useAuthStore.getState().merchant, null);
    assert.deepEqual(calls, ['/auth/refresh', '/auth/logout']);
  });
});

test('a late initial temporary failure cannot clear or relabel a newer explicit login', async () => {
  let failOld, signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  await context(config => new Promise((_, reject) => { failOld = () => reject(failed(config)); signalStarted(); }), async ({ restoreSession, beginSession, useAuthStore }) => {
    const old = restoreSession();
    await started;
    beginSession();
    useAuthStore.getState().setAuth('current-token', merchant);
    failOld();
    assert.equal(await old, false);
    assert.equal(useAuthStore.getState().token, 'current-token');
    assert.equal(useAuthStore.getState().merchant.id, merchant.id);
    assert.equal(useAuthStore.getState().explicitLogout, false);
  });
});
