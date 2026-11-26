import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiRequest, clearSession, loginWithPassword, restoreSession, subscribeSession, type SessionUser } from './session';

const first: SessionUser = { id: '901', role: 'ADMIN', name: 'First local administrator' };
const second: SessionUser = { id: '902', role: 'ADMIN', name: 'Second local administrator' };

test('a different management-tab refresh identity never receives an automatic replay of the current command', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const observed: Array<SessionUser | null> = [];
  const unsubscribe = subscribeSession(user => observed.push(user));
  clearSession();
  globalThis.fetch = async (url) => {
    const path = String(url); calls.push(path);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'first-token', user: first });
    if (path.endsWith('/auth/me')) return Response.json(first);
    if (path.endsWith('/auth/refresh')) return Response.json({ accessToken: 'different-token', user: second });
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  };
  try {
    await loginWithPassword('first-local', 'synthetic-password');
    await assert.rejects(apiRequest('/studio/services/11', { method: 'PATCH', body: JSON.stringify({ isActive: false }) }), /重新登录/);
    assert.equal(calls.filter(path => path === '/api/v1/studio/services/11').length, 1);
    assert.equal(calls.filter(path => path === '/api/v1/auth/refresh').length, 1);
    assert.equal(observed.at(-1), null);
    assert.equal(observed.some(user => user?.id === second.id), false);
  } finally { unsubscribe(); clearSession(); globalThis.fetch = original; }
});

test('same-account refresh retries once while preserving exact large identity IDs', async () => {
  const original = globalThis.fetch;
  const identity = { ...first, id: '9007199254740997' };
  let requests = 0, refreshes = 0;
  clearSession();
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'expired-token', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    if (path.endsWith('/auth/refresh')) { refreshes++; return Response.json({ accessToken: 'renewed-token', user: identity }); }
    requests++;
    return new Headers(options?.headers).get('Authorization') === 'Bearer renewed-token'
      ? Response.json({ authorized: true }) : Response.json({ message: 'Unauthorized' }, { status: 401 });
  };
  try {
    await loginWithPassword('first-local', 'synthetic-password');
    assert.deepEqual(await apiRequest('/studio/stores'), { authorized: true });
    assert.equal(refreshes, 1); assert.equal(requests, 2);
    assert.equal((await restoreSession())?.id, identity.id);
  } finally { clearSession(); globalThis.fetch = original; }
});

test('an initially empty local session can still explicitly restore the current management identity', async () => {
  const original = globalThis.fetch;
  clearSession();
  globalThis.fetch = async (url) => String(url).endsWith('/auth/refresh')
    ? Response.json({ accessToken: 'current-cookie-token', user: second }) : Response.json(second);
  try { assert.deepEqual(await restoreSession(), second); }
  finally { clearSession(); globalThis.fetch = original; }
});
