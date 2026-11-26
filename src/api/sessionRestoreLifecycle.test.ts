import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, clearSession, currentManagementSessionKey, loginWithPassword, restoreSession, subscribeSession, type SessionUser } from './session';

const admin: SessionUser = { id: '901', role: 'ADMIN', name: 'Synthetic current administrator' };
const restoreAdmin = () => restoreSession('ADMIN');
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const abort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

async function withTransport(run: (h: {
  refreshes: Array<ReturnType<typeof deferred<Response>> & { settled: boolean }>;
  paths: string[];
  observed: Array<SessionUser | null>;
  reply: (index: number, response?: Response) => void;
}) => Promise<void>) {
  const previous = globalThis.fetch, refreshes: Array<ReturnType<typeof deferred<Response>> & { settled: boolean }> = [], paths: string[] = [], observed: Array<SessionUser | null> = [];
  clearSession();
  const stop = subscribeSession(user => observed.push(user));
  globalThis.fetch = async input => {
    const path = String(input); paths.push(path);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) { const request = { ...deferred<Response>(), settled: false }; refreshes.push(request); return request.promise; }
    assert.equal(path, '/api/v1/auth/me'); return Response.json(admin);
  };
  const reply = (index: number, response = Response.json({ accessToken: 'synthetic-restored-token', user: admin })) => { refreshes[index].settled = true; refreshes[index].resolve(response); };
  try { await run({ refreshes, paths, observed, reply }); }
  finally { stop(); clearSession(); for (let index = 0; index < refreshes.length; index++) if (!refreshes[index].settled) reply(index, Response.json({}, { status: 401 })); await Promise.allSettled(refreshes.map(request => request.promise)); globalThis.fetch = previous; }
}

test('clearSession gives the new restore its own request and retired finally cannot evict the current shared promise', async () => withTransport(async h => {
  const old = restoreAdmin(), oldRejected = assert.rejects(old, abort);
  clearSession();
  const current = restoreAdmin();
  assert.equal(h.refreshes.length, 2, 'a new session must not share its retired restoration');
  h.reply(0, Response.json({ message: 'Unauthorized' }, { status: 401 })); await oldRejected;
  assert.equal(restoreAdmin(), current, 'the old finally cannot clear a later restorePromise');
  assert.equal(h.refreshes.length, 2);
  h.reply(1); assert.deepEqual(await current, admin); assert.ok(currentManagementSessionKey());
  assert.equal(h.observed.some(user => user?.id === admin.id), true);
}));

test('same-generation concurrent restore deduplicates and a populated session restores without another fetch', async () => withTransport(async h => {
  const first = restoreAdmin(), second = restoreAdmin();
  assert.equal(first, second); assert.equal(h.refreshes.length, 1);
  h.reply(0); assert.deepEqual(await first, admin); assert.deepEqual(await second, admin);
  const before = [...h.paths]; assert.deepEqual(await restoreAdmin(), admin); assert.deepEqual(h.paths, before);
  assert.equal(h.paths.filter(path => path.endsWith('/auth/me')).length, 1);
  assert.equal(h.paths.filter(path => path.endsWith('/auth/admin/refresh')).length, 1);
}));

test('retired success cannot read a profile using the current token or announce an obsolete identity', async () => withTransport(async h => {
  const body = deferred<unknown>(), response = new Response(null, { status: 200 }); response.json = () => body.promise;
  const old = restoreAdmin(), oldRejected = assert.rejects(old, abort); h.reply(0, response);
  await Promise.resolve();
  clearSession(); const current = restoreAdmin(); h.reply(1); await current;
  const owner = currentManagementSessionKey(), reads = h.paths.filter(path => path.endsWith('/auth/me')).length;
  body.resolve({ accessToken: 'retired-token', user: { ...admin, id: '902' } }); await oldRejected;
  assert.equal(currentManagementSessionKey(), owner); assert.equal(h.paths.filter(path => path.endsWith('/auth/me')).length, reads);
  assert.equal(h.observed.some(user => user?.id === '902'), false);
}));

test('current denial ends authentication, temporary failure keeps its error and both allow a fresh explicit restore', async () => withTransport(async h => {
  const denied = restoreAdmin(); h.reply(0, Response.json({ message: 'Unauthorized' }, { status: 401 })); assert.equal(await denied, null); assert.equal(currentManagementSessionKey(), null);
  const failed = restoreAdmin(), failure = assert.rejects(failed, error => error instanceof ApiError && error.status === 503);
  assert.equal(h.refreshes.length, 2); h.reply(1, Response.json({ message: 'Service Unavailable' }, { status: 503 })); await failure;
  assert.equal(currentManagementSessionKey(), null);
  const retry = restoreAdmin(); assert.equal(h.refreshes.length, 3); h.reply(2); assert.deepEqual(await retry, admin);
}));

test('role-specific restores do not share or let a retired refresh overwrite the current session', async () => withTransport(async h => {
  const general = restoreSession(), generalRejected = assert.rejects(general, abort);
  const adminRestore = restoreAdmin();
  assert.equal(h.refreshes.length, 2);
  assert.match(h.paths[0], /\/auth\/refresh$/);
  assert.match(h.paths[1], /\/auth\/admin\/refresh$/);
  h.reply(0);
  await generalRejected;
  h.reply(1);
  assert.deepEqual(await adminRestore, admin);
  assert.match(currentManagementSessionKey() ?? '', /:ADMIN:901$/);
}));

test('an already cached non-admin identity cannot pass an ADMIN restore request', async () => {
  const previous = globalThis.fetch;
  clearSession();
  const merchant = { id: '902', role: 'MERCHANT', name: 'Synthetic merchant' };
  const paths: string[] = [];
  globalThis.fetch = async input => {
    const path = String(input); paths.push(path);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-merchant-token', user: merchant });
    if (path.endsWith('/auth/me')) return Response.json(merchant);
    throw new Error('Unexpected request: ' + path);
  };
  try {
    assert.equal((await loginWithPassword('synthetic-merchant', 'synthetic-password')).role, 'MERCHANT');
    assert.equal(await restoreSession('ADMIN'), null);
    assert.equal(currentManagementSessionKey(), null);
    assert.equal(paths.some(path => path.endsWith('/auth/admin/refresh')), false);
  } finally { clearSession(); globalThis.fetch = previous; }
});
