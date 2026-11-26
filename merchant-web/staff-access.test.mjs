import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const response = (config, data) => ({ config, data, headers: {}, status: 200, statusText: 'OK' });
const shopId = '9007199254740997', userId = '9007199254740999';
const grant = (overrides = {}) => ({ shopId, userId, name: 'Synthetic staff', email: 'staff@example.invalid', phone: '+12025550123', accountStatus: 'ACTIVE', status: 'ACTIVE', permissions: ['BOOKINGS_READ'], createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z', revokedAt: null, ...overrides });

test('staff transport preserves exact shop/user IDs and sends only the supported create, grant, permissions and revoke contracts', async () => {
  const requests = [];
  axios.defaults.adapter = async config => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ method: config.method, url: config.url, params: config.params, body });
    if (config.method === 'get') return response(config, { shopId, items: [grant()], total: 1, page: 2, pageSize: 20, totalPages: 1 });
    return response(config, config.method === 'delete' ? { shopId, userId, status: 'REVOKED' } : grant({ permissions: body.permissions }));
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const api = await server.ssrLoadModule('/src/api/staff.ts');
    const input = { name: 'Synthetic staff', email: 'staff@example.invalid', phone: '+12025550123', password: 'Synthetic-initial-password', permissions: ['BOOKINGS_READ'] };
    assert.equal((await api.getStaff(shopId, 2)).items[0].userId, userId);
    const created = await api.createStaff(shopId, input);
    assert.equal(Object.hasOwn(created, 'password'), false);
    await api.grantStaff(shopId, userId, ['FINANCE_READ']);
    await api.updateStaff(shopId, userId, ['BOOKINGS_READ','SETTLEMENT_RECORD']);
    await api.revokeStaff(shopId, userId);
    const base = `/merchant/shops/${shopId}/staff`;
    assert.deepEqual(requests, [
      { method:'get',url:base,params:{page:2,pageSize:20},body:undefined },
      { method:'post',url:base,params:undefined,body:input },
      { method:'post',url:base+'/grants',params:undefined,body:{userId,permissions:['FINANCE_READ']} },
      { method:'patch',url:base+'/'+userId,params:undefined,body:{permissions:['BOOKINGS_READ','SETTLEMENT_RECORD']} },
      { method:'delete',url:base+'/'+userId,params:undefined,body:undefined },
    ]);
  } finally { await server.close(); }
});

test('a mismatched-shop list or mutation response is rejected rather than displayed as success', async () => {
  axios.defaults.adapter = async config => response(config, config.method === 'get' ? { shopId:'other',items:[grant()],total:1 } : grant({shopId:'other'}));
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const api = await server.ssrLoadModule('/src/api/staff.ts');
    await assert.rejects(api.getStaff(shopId,1),/无法核对员工列表/);
    await assert.rejects(api.updateStaff(shopId,userId,['FINANCE_READ']),/员工响应与当前门店不符/);
    await assert.rejects(api.revokeStaff(shopId,userId),/撤销结果尚未确认/);
  } finally { await server.close(); }
});

test('STAFF sign-in and per-shop routes never grant owner powers or loop when no grant remains', async () => {
  const writes = [];
  globalThis.localStorage = { removeItem() {}, setItem(...args) { writes.push(args); } };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { useAuthStore, isMerchant } = await server.ssrLoadModule('/src/stores/authStore.ts');
    const { hasShopPermission, initialShopRoute, withBookingRead } = await server.ssrLoadModule('/src/utils/shopPermissions.ts');
    assert.equal(isMerchant({ role:'STAFF' }),true);
    assert.equal(isMerchant({ role:'CUSTOMER',roles:['MERCHANT'] }),false,'a legacy role array does not override the authoritative role');
    useAuthStore.getState().setAuth('synthetic-access',{id:userId,role:'STAFF'});
    const readOnly={isOwner:false,permissions:['BOOKINGS_READ']}, configOnly={isOwner:false,permissions:['RESERVATION_CONFIG']};
    assert.equal(initialShopRoute(readOnly),'/bookings');
    assert.equal(initialShopRoute(configOnly),'/reservations');
    assert.equal(initialShopRoute({isOwner:false,permissions:['FINANCE_READ']}),'/dashboard');
    assert.equal(initialShopRoute(null),null,'empty grants have no redirect target');
    assert.equal(hasShopPermission(readOnly,'OWNER_ONLY'),false);
    assert.equal(hasShopPermission(readOnly,'SETTLEMENT_RECORD'),false);
    assert.equal(hasShopPermission(configOnly,'BOOKINGS_READ'),false,'changing the selected shop does not reuse other shop permissions');
    assert.deepEqual(withBookingRead(['REFUNDS_MANAGE']),['BOOKINGS_READ','REFUNDS_MANAGE']);
    assert.deepEqual(withBookingRead(['FINANCE_READ']),['FINANCE_READ']);
    assert.deepEqual(writes,[],'staff access and credentials are not persisted in browser storage');
  } finally { await server.close(); delete globalThis.localStorage; }
});
