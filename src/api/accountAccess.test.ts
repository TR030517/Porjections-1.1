import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountPermissions, bindShopAccount, createAndBindShopAccount, getAccessOverview, matchingCreatedBinding, prepareCreateAndBind, resetMerchantPassword, revokeAssociation, saveAssociation, type AccessOverview } from './accountAccess';
import { canAccessView } from '../permission';
import { Role } from '../utils/roleEnum';
import { operations } from '../config/operations';
import { buildOperationPayload, visibleOperationFields } from '../utils/operationForm';
import { ApiError } from './session';

test('merchant account creation requires a login email and hides its generated internal login identifier', () => {
  const fields = operations['merchant-list'].fields!;
  const form = { name: 'Synthetic shop account', password: '123456', email: 'shop@example.invalid', phone: '' };
  const payload = buildOperationPayload(fields, form, false);
  assert.equal(Object.hasOwn(payload, 'loginName'), false);
  assert.equal(payload.email, form.email); assert.equal(payload.phone, '');
  assert.equal(fields.some(field => field.key === 'loginName'), false);
  assert.equal(visibleOperationFields(fields, true).some(field => field.key === 'loginName'), false);
  assert.deepEqual(buildOperationPayload(fields, { ...form, status: 'ACTIVE', loginName: 'attempt-to-change' }, true), { name: form.name, status: 'ACTIVE' });
  for (const email of ['', 'invalid', 'missing@domain']) {
    assert.throws(() => buildOperationPayload(fields, { ...form, email }, false), /邮箱/);
  }
  assert.throws(() => buildOperationPayload(fields, { ...form, password: '12345' }, false), /密码/);
  for (const resource of ['admin-list', 'user-list']) {
    assert.equal(operations[resource].fields!.find(field => field.key === 'email')?.required, true);
    assert.equal(operations[resource].fields!.find(field => field.key === 'phone')?.required, true);
    assert.equal(operations[resource].fields!.some(field => field.key === 'loginName'), false);
  }
});

test('platform routes accept only the authoritative administrator role', () => {
  for (const view of ['dashboard', 'store-list', 'merchant-list', 'service-orders', 'reservation-settings'] as const) {
    assert.equal(canAccessView(Role.SUPER_ADMIN, view), true);
    assert.equal(canAccessView(Role.STORE_MANAGER, view), false);
    assert.equal(canAccessView(Role.USER, view), false);
  }
});
test('overview and mutations preserve exact shop/account/grant IDs and supported payloads', async () => {
  const original = globalThis.fetch, calls: Array<{ url: string; method: string; body: unknown }> = [];
  const shopId = '9007199254740997', userId = '9007199254740999';
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method ?? 'GET', body: options?.body ? JSON.parse(String(options.body)) : null });
    if (String(url).endsWith('/overview')) return Response.json({ shops: [], accounts: [], grants: [], permissions: accountPermissions });
    return Response.json({ binding: { shopId, userId }, grant: { id: 'grant-exact', sourceShopId: shopId, targetShopId: '33', status: options?.method === 'DELETE' ? 'REVOKED' : 'ACTIVE' }, userId, reset: true, revokedSessions: 2 });
  };
  try {
    await getAccessOverview(); await bindShopAccount(shopId, userId, 'Synthetic reason');
    await saveAssociation(shopId, '33', ['CATALOG_MANAGE'], 'Synthetic reason'); await revokeAssociation('grant-exact', 'Synthetic revoke');
    const result = await resetMerchantPassword(userId, 'Synthetic-new-password', 'Synthetic reset'); assert.equal(result.revokedSessions, 2);
    assert.deepEqual(calls.slice(1).map(call => [call.method, call.body]), [
      ['POST', { shopId, userId, reason: 'Synthetic reason' }], ['POST', { sourceShopId: shopId, targetShopId: '33', permissions: ['CATALOG_MANAGE'], reason: 'Synthetic reason' }],
      ['DELETE', { reason: 'Synthetic revoke' }], ['PATCH', { password: 'Synthetic-new-password', reason: 'Synthetic reset' }],
    ]);
    assert.equal(calls[4].url, `/api/v1/account-access/admin/accounts/${userId}/password`);
  } finally { globalThis.fetch = original; }
});
test('server denial stays a failure instead of an assumed binding or permission update', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: 'Binding conflict' }, { status: 409 });
  const denied = (error: unknown) => error instanceof ApiError && error.status === 409;
  try { await assert.rejects(bindShopAccount('2', '3', 'Synthetic reason'), denied); await assert.rejects(saveAssociation('2', '3', ['CATALOG_MANAGE'], 'Synthetic reason'), denied); }
  finally { globalThis.fetch = original; }
});
test('an invalid overview cannot silently render every shop as unbound', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ shops: [], accounts: [], grants: null });
  try { await assert.rejects(getAccessOverview(), /数据无效/); } finally { globalThis.fetch = original; }
});

const provisionInput = { shopId: '9007199254740997', loginName: 'synthetic-shop', name: 'Synthetic account', email: 'shop@example.invalid', password: 'Synthetic-password-123', reason: 'Synthetic account setup', idempotencyKey: 'synthetic-create-key-0001' };
test('atomic provisioning requires a login email and respects password byte boundaries before any request', () => {
  assert.equal(prepareCreateAndBind({ ...provisionInput, loginName: ' Synthetic-Shop ', email: ' TEST@EXAMPLE.INVALID ' }).loginName, 'synthetic-shop');
  assert.equal(prepareCreateAndBind({ ...provisionInput, password: '界'.repeat(24) }).password, '界'.repeat(24));
  for (const input of [
    { password: '界'.repeat(25) }, { password: '12345' }, { password: ' Synthetic-password-123' }, { password: 'Synthetic\npassword-123' },
    { loginName: 'ab' }, { loginName: 'has space' }, { email: '' }, { email: 'invalid' }, { phone: '12345' }, { reason: ' ' }, { shopId: '9223372036854775808' }, { idempotencyKey: 'short' },
  ]) assert.throws(() => prepareCreateAndBind({ ...provisionInput, ...input }));
  const body = prepareCreateAndBind({ ...provisionInput, role: 'ADMIN' } as typeof provisionInput);
  assert.equal(Object.hasOwn(body, 'role'), false);
  assert.equal(body.email, provisionInput.email); assert.equal(body.phone, undefined);
  assert.equal(prepareCreateAndBind({ ...provisionInput, password: '123456' }).password, '123456');
});

test('atomic create-and-bind sends one authoritative request; outcome checks only GET overview and never resend a password', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const binding = { id: 'binding-1', shopId: provisionInput.shopId, userId: '9007199254740999', loginName: null, email: provisionInput.email, accountStatus: 'SUSPENDED', loginReady: false };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith('/create-and-bind')) throw new Error('Synthetic lost response');
    return Response.json({ shops: [{ id: provisionInput.shopId, binding }], accounts: [], grants: [], permissions: accountPermissions });
  };
  try {
    await assert.rejects(createAndBindShopAccount(provisionInput));
    const overview = await getAccessOverview();
    assert.equal(matchingCreatedBinding(overview, provisionInput.shopId, provisionInput.email)?.userId, binding.userId);
    assert.equal(matchingCreatedBinding(overview, provisionInput.shopId, ' SHOP@EXAMPLE.INVALID ')?.userId, binding.userId);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { url: '/api/v1/account-access/admin/create-and-bind', method: 'POST', body: provisionInput });
    assert.deepEqual(calls[1], { url: '/api/v1/account-access/admin/overview', method: 'GET', body: null });
    assert.equal(matchingCreatedBinding(overview, '7', provisionInput.email), null);
    assert.equal(matchingCreatedBinding(overview, provisionInput.shopId, 'other@example.invalid'), null);
    for (const mismatch of [{ accountStatus: 'SUSPENDED', loginReady: true }, { accountStatus: 'ACTIVE', loginReady: false }]) {
      assert.equal(matchingCreatedBinding({ ...overview, shops: [{ ...overview.shops[0], binding: { ...overview.shops[0].binding!, ...mismatch } }] }, provisionInput.shopId, provisionInput.email), null);
    }
  } finally { globalThis.fetch = original; }
});

test('fresh provisioning acknowledges email-only suspended accounts and rejects wrong identities or inconsistent login access', async () => {
  const original = globalThis.fetch;
  const base = { operationId: 'synthetic-operation', status: 'APPLIED', replayed: false, binding: { shopId: provisionInput.shopId, userId: '8', loginName: null, email: provisionInput.email, accountStatus: 'SUSPENDED', loginReady: false } };
  try {
    for (const binding of [{ ...base.binding, shopId: '4' }, { ...base.binding, email: 'wrong@example.invalid' }, { ...base.binding, loginName: 'wrong-name' }, { ...base.binding, loginReady: true }, { ...base.binding, accountStatus: 'ACTIVE', loginReady: true }, { ...base.binding, userId: undefined }]) {
      globalThis.fetch = async () => Response.json({ ...base, binding });
      await assert.rejects(createAndBindShopAccount(provisionInput), /结果无法确认/);
    }
    globalThis.fetch = async () => Response.json(base);
    const created = await createAndBindShopAccount(provisionInput);
    assert.equal(created.operationId, base.operationId);
    assert.equal(created.binding.loginName, null); assert.equal(created.binding.email, provisionInput.email);
    assert.equal(created.binding.accountStatus, 'SUSPENDED'); assert.equal(created.binding.loginReady, false);
    globalThis.fetch = async () => Response.json({ ...base, replayed: true, binding: { ...base.binding, loginName: provisionInput.loginName, accountStatus: 'ACTIVE', loginReady: true } });
    assert.equal((await createAndBindShopAccount(provisionInput)).replayed, true, 'only a replay may acknowledge a previously activated legacy binding');
    globalThis.fetch = async () => Response.json({ shops: [], accounts: [{ id: '8', status: 'ACTIVE' }], grants: [], permissions: accountPermissions });
    await assert.rejects(getAccessOverview(), /数据无效/);
    assert.equal(matchingCreatedBinding({ shops: [], accounts: [], grants: [], permissions: [] } as AccessOverview, provisionInput.shopId, provisionInput.email), null);
  } finally { globalThis.fetch = original; }
});
