import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import { createServer } from 'vite';

test('merchant sessions refresh once, retry once, and never persist tokens', async () => {
  const writes = [];
  const removed = [];
  globalThis.localStorage = { removeItem: (key) => removed.push(key), setItem: (...args) => writes.push(args) };
  let refreshes = 0;
  let authenticatedRequests = 0;
  const merchant = { id: '9007199254740997', role: 'MERCHANT', name: 'Test merchant' };
  axios.defaults.adapter = async (config) => {
    const response = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
    if (config.url === '/auth/refresh') {
      refreshes++;
      assert.equal(config.withCredentials, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response({ accessToken: 'renewed-access-token', user: merchant });
    }
    if (config.url === '/auth/logout') return response({});
    authenticatedRequests++;
    if (config.headers.Authorization !== 'Bearer renewed-access-token' || config.url === '/always-unauthorized') {
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, { ...response({}), status: 401 });
    }
    return response({ authorized: true });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { useAuthStore, isMerchant } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const { default: client, endSession, restoreSession } = await server.ssrLoadModule('/src/api/client.ts');
    assert.equal(isMerchant({ role: 'CUSTOMER' }), false);
    assert.equal(isMerchant({ role: 'ADMIN' }), true, 'company administrators can use the shop workspace without impersonation');
    assert.throws(() => useAuthStore.getState().setAuth('bad', { id: '1', role: 'CUSTOMER' }));
    useAuthStore.getState().setAuth('expired', merchant);
    await Promise.all([client.get('/one'), client.get('/two')]);
    assert.equal(refreshes, 1, 'concurrent failures must share refresh');
    assert.equal(authenticatedRequests, 4, 'each request retries once');
    assert.equal(useAuthStore.getState().merchant.id, merchant.id, 'string IDs retain precision');
    await assert.rejects(client.get('/always-unauthorized'));
    assert.equal(useAuthStore.getState().token, null, 'a rejected retry ends the local session');
    await endSession();
    const pendingRefresh = restoreSession();
    await endSession();
    assert.equal(await pendingRefresh, false, 'logout must invalidate an outstanding refresh');
    assert.equal(useAuthStore.getState().token, null);
    assert.deepEqual(writes, []);
    assert.deepEqual(removed.sort(), ['merchant_info', 'merchant_token']);
  } finally {
    await server.close();
    delete globalThis.localStorage;
  }
});

test('shop staff writes retain exact IDs and scope while legacy service links remain response-only', async () => {
  const shopId = '9007199254740997';
  const technicianId = '9007199254740999';
  const serviceId = '9007199254741001';
  const requests = [];
  axios.defaults.adapter = async (config) => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ method: config.method, url: config.url, body });
    const data = config.method === 'get'
      ? [{ id: technicianId, name: 'Assigned technician', serviceIds: [serviceId], isActive: true }]
      : { id: technicianId, ...body };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const api = await server.ssrLoadModule('/src/api/merchant.ts');
    const [technician] = await api.getShopTherapists(shopId);
    assert.equal(technician.id, technicianId);
    assert.deepEqual(technician.serviceIds, [serviceId]);
    await api.createTechnician(shopId, { name: 'New technician', serviceIds: [serviceId] });
    await api.updateTechnician(technicianId, { name: 'Renamed technician', serviceIds: [] });
    await api.updateTechnician(technicianId, { isActive: false });
    assert.deepEqual(requests, [
      { method: 'get', url: `/merchant/shops/${shopId}/therapists`, body: undefined },
      { method: 'post', url: `/merchant/shops/${shopId}/therapists`, body: { name: 'New technician' } },
      { method: 'patch', url: `/merchant/therapists/${technicianId}`, body: { name: 'Renamed technician' } },
      { method: 'patch', url: `/merchant/therapists/${technicianId}`, body: { isActive: false } },
    ]);
  } finally { await server.close(); }
});
