import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from './authStore';
import { clearSession, currentManagementSessionKey, type SessionUser } from '../api/session';
import { shopStore } from './shop';
import { userStore } from './user';
import { Role } from '../utils/roleEnum';

const admin: SessionUser = { id: '901', role: 'ADMIN', name: 'Synthetic administrator' };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type RefreshRequest = ReturnType<typeof deferred<Response>> & { options?: RequestInit; settled: boolean };

async function withAuth(run: (h: {
  auth: () => ReturnType<typeof useAuthStore>;
  refreshes: RefreshRequest[];
  login: (identity?: SessionUser) => Promise<void>;
  reply: (index: number, response: Response) => Promise<void>;
  unmount: () => Promise<void>;
  remount: () => Promise<void>;
  paths: string[];
  snapshots: Array<{ user: SessionUser | null; loading: boolean; error: string }>;
}) => Promise<void>, strict = false) {
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const), previousFetch = globalThis.fetch;
  const doc: any = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const storage = new Map<string, string>();
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } } }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win }); Object.defineProperty(globalThis, 'document', { configurable: true, value: doc }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const refreshes: RefreshRequest[] = [], snapshots: Array<{ user: SessionUser | null; loading: boolean; error: string }> = [], paths: string[] = [];
  let current = admin, value!: ReturnType<typeof useAuthStore>, mounted = true;
  globalThis.fetch = async (input, options) => {
    const path = String(input); paths.push(path);
    if (path.endsWith('/auth/admin/refresh')) { const request = { ...deferred<Response>(), options, settled: false }; refreshes.push(request); return request.promise; }
    if (path.endsWith('/auth/login') || path.endsWith('/auth/admin/password/login')) return Response.json({ accessToken: 'synthetic-session-only', user: current });
    if (path.endsWith('/auth/me')) return Response.json(current);
    if (path.endsWith('/auth/logout')) return Response.json({ ok: true });
    throw new Error('Unexpected synthetic request: ' + path);
  };
  clearSession(); userStore.setProfile(null); shopStore.currentStoreId = null;
  function Probe() { value = useAuthStore(); snapshots.push({ user: value.user, loading: value.loading, error: value.error }); return null; }
  let root = createRoot(container as unknown as HTMLElement);
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => { root.unmount(); }); } };
  const render = () => act(async () => { const node = <AuthProvider><Probe /></AuthProvider>; root.render(strict ? <StrictMode>{node}</StrictMode> : node); });
  const remount = async () => { await unmount(); root = createRoot(container as unknown as HTMLElement); mounted = true; await render(); };
  try {
    await render();
    await run({ auth: () => value, refreshes, snapshots, unmount, remount, paths,
      login: async (identity = admin) => { current = identity; await act(async () => { await value.login('synthetic-admin', 'synthetic-password'); }); },
      reply: async (index, response) => { await act(async () => { refreshes[index].settled = true; refreshes[index].resolve(response); }); },
    });
  } finally {
    await unmount();
    for (const request of refreshes) if (!request.settled) { request.settled = true; request.resolve(Response.json({ message: 'Unauthorized' }, { status: 401 })); }
    await Promise.allSettled(refreshes.map(request => request.promise)); clearSession(); userStore.setProfile(null); shopStore.currentStoreId = null; globalThis.fetch = previousFetch;
    for (const [key, previous] of globals) { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); }
  }
}

test('a retired restore 401 body cannot clear a newer successful login from the mounted provider', async () => withAuth(async h => {
  const body = deferred<unknown>();
  const oldResponse = new Response(null, { status: 401 }); oldResponse.json = () => body.promise;
  await h.reply(0, oldResponse);
  await h.login();
  const owner = currentManagementSessionKey(); shopStore.currentStoreId = '5';
  assert.equal(h.auth().user?.id, admin.id);
  await act(async () => { body.resolve({ message: 'Unauthorized' }); });
  assert.equal(h.auth().user?.id, admin.id, 'the retired null restore result must not clear the current provider identity');
  assert.equal(userStore.currentRole, Role.SUPER_ADMIN); assert.equal(shopStore.currentStoreId, '5');
  assert.equal(currentManagementSessionKey(), owner); assert.equal(h.auth().error, ''); assert.equal(h.auth().loading, false);
}));

test('retired restore failure cannot add an error or reset loading after a newer same-account login', async () => withAuth(async h => {
  const body = deferred<unknown>(), response = new Response(null, { status: 503 }); response.json = () => body.promise;
  await h.reply(0, response); await h.login();
  const owner = currentManagementSessionKey();
  assert.equal(h.auth().loading, false, 'successful login owns completion without awaiting the retired restore');
  await act(async () => { body.resolve({ message: 'Service Unavailable' }); });
  assert.equal(h.auth().user?.id, admin.id); assert.equal(h.auth().error, ''); assert.equal(h.auth().loading, false); assert.equal(currentManagementSessionKey(), owner);
}));

test('old restore finally cannot finish the loading state of a later explicit restore', async () => withAuth(async h => {
  let current!: Promise<void>;
  await act(async () => { clearSession(); current = h.auth().restore(); });
  assert.equal(h.refreshes.length, 2); assert.equal(h.auth().loading, true);
  await h.reply(0, Response.json({ message: 'Unauthorized' }, { status: 401 }));
  assert.equal(h.auth().loading, true); assert.equal(h.auth().error, '');
  await h.reply(1, Response.json({ accessToken: 'current-synthetic-token', user: admin }));
  await current; assert.equal(h.auth().user?.id, admin.id); assert.equal(h.auth().loading, false);
}));

test('StrictMode restores once, cached restore is immediate and an expired session can explicitly retry', async () => withAuth(async h => {
  assert.equal(h.refreshes.length, 1, 'StrictMode effect restart shares the same-generation restore');
  await h.reply(0, Response.json({ accessToken: 'synthetic-restored', user: admin }));
  assert.equal(h.auth().user?.id, admin.id); assert.equal(h.auth().loading, false);
  await act(async () => { await h.auth().restore(); });
  assert.equal(h.refreshes.length, 1); assert.equal(h.auth().user?.id, admin.id); assert.equal(h.auth().loading, false);
  await act(async () => { clearSession('登录已失效，请重新登录。'); });
  assert.equal(h.auth().user, null); assert.match(h.auth().error, /失效/);
  let failed!: Promise<void>;
  await act(async () => { failed = h.auth().restore(); });
  await h.reply(1, Response.json({ message: 'Service Unavailable' }, { status: 503 })); await failed;
  assert.match(h.auth().error, /不可用/); assert.equal(h.auth().loading, false);
  let retry!: Promise<void>;
  await act(async () => { retry = h.auth().restore(); });
  await h.reply(2, Response.json({ accessToken: 'synthetic-retry', user: admin })); await retry;
  assert.equal(h.auth().user?.id, admin.id); assert.equal(h.auth().error, ''); assert.equal(h.auth().loading, false);
}, true));

test('unmounted restore completion cannot update shared view stores and stale provider methods send no commands', async () => withAuth(async h => {
  const stale = h.auth(); await h.unmount(); const snapshots = h.snapshots.length;
  await h.reply(0, Response.json({ accessToken: 'synthetic-valid-after-unmount', user: admin }));
  assert.equal(userStore.currentRole, Role.USER, 'the retired provider cannot apply the returned profile to shared view stores');
  assert.equal(h.snapshots.length, snapshots);
  const count = h.paths.length;
  await stale.restore(); await stale.login('synthetic-admin', 'synthetic-password'); await stale.logout();
  assert.equal(h.paths.length, count);
  await h.remount();
  assert.equal(h.auth().user?.id, admin.id); assert.equal(h.auth().loading, false);
  assert.equal(h.paths.length, count, 'new provider can read the valid cache without repeating restoration');
}));
