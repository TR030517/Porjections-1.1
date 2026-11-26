import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const input = { currentPassword: 'Synthetic-current-2026', newPassword: 'Synthetic-new-2026' };
const success = { changed: true, reauthenticationRequired: true, revokedSessions: 2 };
const first = { id: '17', role: 'MERCHANT', email: 'synthetic-first@example.invalid' };
const second = { id: '18', role: 'STAFF', email: 'synthetic-second@example.invalid' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function harness(work) {
  const adapter = axios.defaults.adapter; let handle = async () => success; const calls = [];
  axios.defaults.adapter = async config => { calls.push(config); return { config, data: await handle(config), headers: {}, status: 200, statusText: 'OK' }; };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let auth;
  try {
    const security = await vite.ssrLoadModule('/src/api/accountSecurity.ts');
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const client = await vite.ssrLoadModule('/src/api/client.ts');
    const session = (user = first) => { client.beginSession(); auth.getState().setAuth('synthetic-' + user.id, user); };
    session(); await work({ security, auth, calls, session, handle: next => { handle = next; } });
  } finally { auth?.getState().logout(); axios.defaults.adapter = adapter; await vite.close(); }
}

test('merchant password change clears the validated owning session exactly once without logout or refresh replay', async () => {
  await harness(async h => {
    await h.security.changeOwnPassword(input); assert.equal(h.auth.getState().token, null);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, '/auth/password/change');
    assert.deepEqual(JSON.parse(h.calls[0].data), input); assert.equal(h.calls[0].headers.Authorization, 'Bearer synthetic-17');
  });
});

test('wrong current password preserves merchant session and does not trigger automatic refresh or a second POST', async () => {
  await harness(async h => {
    const owner = h.security.currentManagementSessionKey();
    h.handle(async config => { throw Object.assign(Error('Synthetic old password mismatch'), { config, response: { status: 401, data: { code: 'CURRENT_PASSWORD_INVALID', message: '当前密码不正确' } } }); });
    await assert.rejects(h.security.changeOwnPassword(input));
    assert.equal(h.calls.length, 1); assert.equal(h.security.currentManagementSessionKey(), owner);
    assert.equal(h.auth.getState().merchant.id, first.id);
  });
});

for (const sameAccount of [false, true]) test(`late change success cannot sign out a later ${sameAccount ? 'same-account' : 'different-account'} merchant login`, async () => {
  await harness(async h => {
    const pending = deferred(); h.handle(async () => pending.promise);
    const request = h.security.changeOwnPassword(input), checked = assert.rejects(request, error => axios.isCancel(error));
    await new Promise(resolve => setImmediate(resolve)); h.session(sameAccount ? first : second);
    const owner = h.security.currentManagementSessionKey(); pending.resolve(success); await checked;
    assert.equal(h.security.currentManagementSessionKey(), owner);
    assert.equal(h.auth.getState().merchant.id, sameAccount ? first.id : second.id);
  });
});

test('invalid password receipt keeps current merchant auth and is never counted as success', async () => {
  await harness(async h => {
    const owner = h.security.currentManagementSessionKey(); h.handle(async () => ({ changed: true }));
    await assert.rejects(h.security.changeOwnPassword(input), /尚未确认/);
    assert.equal(h.security.currentManagementSessionKey(), owner); assert.equal(h.calls.length, 1);
  });
});
