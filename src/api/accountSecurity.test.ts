import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, changeOwnPassword, clearSession, currentManagementSessionKey, loginWithPassword, restoreSession, subscribeSession } from './session';
import { ownPasswordError, ownPasswordFailure } from '../utils/accountSecurity';

const first = { id: '901', role: 'ADMIN', email: 'synthetic-first@example.invalid' };
const second = { id: '902', role: 'ADMIN', email: 'synthetic-second@example.invalid' };
const input = { currentPassword: 'Synthetic-current-2026', newPassword: 'Synthetic-new-2026' };
const success = { changed: true, reauthenticationRequired: true, revokedSessions: 2 };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('wrong current password is one request and never refreshes, replays or logs out the current admin', async () => {
  const before = globalThis.fetch, paths: string[] = []; clearSession();
  globalThis.fetch = async url => { const path = String(url); paths.push(path);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic', user: first });
    if (path.endsWith('/auth/me')) return Response.json(first);
    assert.equal(path, '/api/v1/auth/password/change');
    return Response.json({ code: 'CURRENT_PASSWORD_INVALID', message: 'Current password mismatch' }, { status: 401 }); };
  try {
    await loginWithPassword('synthetic-first', input.currentPassword); const owner = currentManagementSessionKey();
    await assert.rejects(changeOwnPassword(input), { status: 401, code: 'CURRENT_PASSWORD_INVALID', message: '当前密码不正确，请重新输入。' });
    assert.equal(currentManagementSessionKey(), owner); assert.deepEqual(await restoreSession(), first);
    assert.equal(paths.filter(path => path.endsWith('/password/change')).length, 1);
    assert.equal(paths.some(path => path.endsWith('/refresh') || path.endsWith('/logout')), false);
  } finally { clearSession(); globalThis.fetch = before; }
});

test('a validated change receipt clears only the current local session and does not send another logout', async () => {
  const before = globalThis.fetch, paths: string[] = [], observed: unknown[] = []; clearSession();
  const stop = subscribeSession((user, reason) => observed.push({ user, reason }));
  globalThis.fetch = async (url, options) => { const path = String(url); paths.push(path);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic', user: first });
    if (path.endsWith('/auth/me')) return Response.json(first);
    assert.equal(path, '/api/v1/auth/password/change'); assert.deepEqual(JSON.parse(String(options?.body)), input);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer synthetic');
    return Response.json(success); };
  try {
    await loginWithPassword('synthetic-first', input.currentPassword); await changeOwnPassword(input);
    assert.equal(currentManagementSessionKey(), null);
    assert.deepEqual(observed.at(-1), { user: null, reason: '密码已修改，请使用新密码重新登录。' });
    assert.equal(paths.some(path => path.endsWith('/logout')), false);
  } finally { stop(); clearSession(); globalThis.fetch = before; }
});

for (const sameUser of [false, true]) test(`a late password response cannot clear a later ${sameUser ? 'same-account' : 'different-account'} login`, async () => {
  const before = globalThis.fetch, pending = deferred<Response>(); clearSession(); let identity = first;
  globalThis.fetch = async url => { const path = String(url);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-' + identity.id, user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    assert.equal(path, '/api/v1/auth/password/change'); return pending.promise; };
  try {
    await loginWithPassword('first', input.currentPassword);
    const request = changeOwnPassword(input), checked = assert.rejects(request, { name: 'AbortError' });
    identity = sameUser ? first : second; await loginWithPassword('later', input.currentPassword);
    const owner = currentManagementSessionKey(); pending.resolve(Response.json(success)); await checked;
    assert.equal(currentManagementSessionKey(), owner); assert.deepEqual(await restoreSession(), identity);
  } finally { clearSession(); globalThis.fetch = before; }
});

test('transport loss and malformed success never report a confirmed change or silently retry', async () => {
  const before = globalThis.fetch; clearSession(); let changes = 0, malformed = false;
  globalThis.fetch = async url => { const path = String(url);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic', user: first });
    if (path.endsWith('/auth/me')) return Response.json(first);
    assert.equal(path, '/api/v1/auth/password/change'); changes++;
    if (!malformed) throw new TypeError('Synthetic connection loss');
    return Response.json({ changed: true }); };
  try {
    await loginWithPassword('first', input.currentPassword); const owner = currentManagementSessionKey();
    for (const value of [false, true]) { malformed = value;
      await assert.rejects(changeOwnPassword(input), error => error instanceof ApiError && ownPasswordFailure(error).uncertain);
      assert.equal(currentManagementSessionKey(), owner); }
    assert.equal(changes, 2, 'one request per explicit invocation and no retries');
  } finally { clearSession(); globalThis.fetch = before; }
});

test('frontend byte policy matches merchant 6/admin staff 12 through 72 UTF-8 bytes', () => {
  assert.equal(ownPasswordError('MERCHANT', 'current', '123456', '123456'), '');
  for (const role of ['ADMIN', 'STAFF']) {
    assert.match(ownPasswordError(role, 'current', '123456', '123456'), /12–72/);
    assert.equal(ownPasswordError(role, 'current', '密'.repeat(4), '密'.repeat(4)), '');
  }
  for (const role of ['ADMIN', 'STAFF', 'MERCHANT']) {
    assert.equal(ownPasswordError(role, 'current', '密'.repeat(24), '密'.repeat(24)), '');
    assert.match(ownPasswordError(role, 'current', '密'.repeat(25), '密'.repeat(25)), /UTF-8/);
    assert.match(ownPasswordError(role, 'current', 'Valid-password', 'different'), /不一致/);
  }
});
