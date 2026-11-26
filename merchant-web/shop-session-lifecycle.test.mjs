import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

const actor = { id: '901', role: 'MERCHANT', name: 'Synthetic operator' };
const shop = (name = 'Current synthetic shop') => ({ id: '5', name, timezone: 'America/Los_Angeles', accessType: 'OWN', isOwner: true, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'] });
const reply = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} });

async function withShops(run) {
  const previous = Object.fromEntries(['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAdapter = axios.defaults.adapter;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const requests = [], probes = new Map();
  axios.defaults.adapter = config => {
    assert.equal(config.url, '/merchant/shops');
    return new Promise((resolve, reject) => {
      const request = { config, settled: false, succeed(rows = [shop()]) { request.settled = true; resolve(reply(config, rows)); }, fail(status = 503) { request.settled = true; reject(new AxiosError('Synthetic request failure', 'ERR_BAD_RESPONSE', config, null, { ...reply(config, { message: 'Synthetic shop load failed' }), status })); } };
      requests.push(request);
    });
  };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  let root, router, auth;
  try {
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const transport = await vite.ssrLoadModule('/src/api/client.ts');
    const hooks = await vite.ssrLoadModule('/src/hooks/useShopId.ts');
    let setView, epoch = 0;
    function Probe({ id }) { probes.set(id, hooks.useShopId()); return null; }
    function App() { const [view, set] = useState({ count: 1, epoch }); setView = set; return React.createElement(React.Fragment, null, ...Array.from({ length: view.count }, (_, id) => React.createElement(Probe, { key: `${view.epoch}:${id}`, id }))); }
    transport.beginSession(); auth.getState().setAuth('synthetic-session-1', actor);
    router = createMemoryRouter([{ path: '*', element: React.createElement(App) }], { initialEntries: ['/bookings?shopId=5'] });
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const render = async count => { await act(async () => { setView({ count, epoch }); }); };
    const signOut = async () => { await act(async () => { transport.beginSession(); auth.getState().logout(); setView({ count: 0, epoch }); }); };
    const signIn = async (count = 1) => { await act(async () => { epoch++; transport.beginSession(); auth.getState().setAuth(`synthetic-session-${epoch + 1}`, actor); setView({ count, epoch }); }); };
    const settle = async (index, outcome = 'success', rows) => { await act(async () => { outcome === 'success' ? requests[index].succeed(rows) : requests[index].fail(); }); };
    await run({ requests, probes, hooks, render, signOut, signIn, settle, transport, auth });
  } finally {
    await act(async () => { for (const request of requests) if (!request.settled) request.succeed(); root?.unmount(); });
    router?.dispose(); auth?.getState().logout(); await vite.close(); axios.defaults.adapter = oldAdapter;
    for (const key of Object.keys(previous)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
}

test('same-account relogin starts a new shop request while the retired session request is still unresolved', async () => withShops(async ({ requests, probes, signOut, signIn, settle }) => {
  assert.equal(requests.length, 1);
  await signOut(); await signIn();
  assert.equal(requests.length, 2, 'the current session must not await the retired same-account request');
  await settle(1);
  assert.equal(probes.get(0).shopId, '5'); assert.equal(probes.get(0).error, null);
  await settle(0, 'success', [shop('Retired synthetic shop')]);
  assert.equal(probes.get(0).shop.name, 'Current synthetic shop'); assert.equal(probes.get(0).error, null);
}));

test('retired failure and finally cannot change the new session error, loading state or shared request', async () => withShops(async ({ requests, probes, hooks, signOut, signIn, settle, render }) => {
  await signOut(); await signIn(2);
  assert.equal(requests.length, 2, 'both current consumers share one new-session request');
  await settle(0, 'failure');
  assert.equal(probes.get(0).error, null); assert.equal(probes.get(0).loading, true);
  assert.equal(hooks.currentShopAllows('5', 'BOOKINGS_MANAGE'), false);
  await act(async () => { void probes.get(0).retry(); }); await render(3);
  assert.equal(requests.length, 2, 'old finally must not evict the current in-flight request');
  await settle(1);
  for (const probe of probes.values()) { assert.equal(probe.shopId, '5'); assert.equal(probe.error, null); assert.equal(probe.loading, false); }
  assert.equal(hooks.currentShopAllows('5', 'BOOKINGS_MANAGE'), true);
}));

test('one session shares initial and refresh requests, retains a failed-refresh workspace and permits explicit retry', async () => withShops(async ({ requests, probes, hooks, render, settle, auth }) => {
  await render(2); assert.equal(requests.length, 1);
  await settle(0);
  await render(0); await render(2); assert.equal(requests.length, 1, 'same-session remount reuses the authorized cache');
  await act(async () => { auth.getState().setAuth('synthetic-refreshed-token', actor); });
  assert.equal(requests.length, 1, 'ordinary access-token refresh keeps its session cache');
  await act(async () => { void probes.get(0).retry(); void probes.get(1).retry(); });
  assert.equal(requests.length, 2); assert.equal(probes.get(0).shopId, '5'); assert.equal(probes.get(0).loading, false); assert.equal(probes.get(0).refreshing, true);
  assert.equal(hooks.currentShopAllows('5', 'BOOKINGS_MANAGE'), false, 'writes pause while current permissions refresh');
  await settle(1, 'failure');
  assert.equal(probes.get(0).shopId, '5', 'failed refresh does not replace the live shop or discard its form');
  assert.ok(probes.get(0).error); assert.equal(probes.get(0).loading, false); assert.equal(probes.get(0).refreshing, false);
  await act(async () => { void probes.get(0).retry(); });
  assert.equal(requests.length, 3);
  await settle(2, 'success', [shop('Revalidated synthetic shop')]);
  assert.equal(probes.get(0).shop.name, 'Revalidated synthetic shop'); assert.equal(probes.get(0).error, null);
  assert.equal(hooks.currentShopAllows('5', 'BOOKINGS_MANAGE'), true);
}));

test('a retired reload cannot return new-session data and captured callbacks cannot refresh or edit its cache', async () => withShops(async ({ requests, probes, signOut, signIn, settle }) => {
  await settle(0); const previous = probes.get(0);
  let reload;
  await act(async () => { reload = previous.reloadShop('5').then(value => ({ value }), error => ({ error })); });
  assert.equal(requests.length, 2);
  await signOut(); await signIn(); assert.equal(requests.length, 3);
  await settle(2, 'success', [shop('New session synthetic shop')]);
  await settle(1, 'success', [shop('Retired reload result')]);
  const result = await reload;
  assert.match(result.error?.message ?? '', /登录.*改变/); assert.equal(result.value, undefined);
  await act(async () => { await previous.retry(); previous.updateShop(shop('Retired saved response')); });
  assert.equal(requests.length, 3); assert.equal(probes.get(0).shop.name, 'New session synthetic shop'); assert.equal(probes.get(0).error, null);
  await assert.rejects(previous.reloadShop('5'), /登录.*改变/);
  assert.equal(requests.length, 3, 'a stale reload must fail before creating a request');
}));

test('explicit same-account login invalidates a populated cache even without an intermediate logout render', async () => withShops(async ({ requests, probes, settle, transport, auth }) => {
  await settle(0);
  await act(async () => { transport.beginSession(); auth.getState().setAuth('synthetic-replacement-session', actor); });
  assert.equal(requests.length, 2, 'same account id does not make the retired cache current');
  assert.equal(probes.get(0).shopId, null); assert.equal(probes.get(0).shops.length, 0);
  await settle(1, 'success', [shop('Replacement session shop')]);
  assert.equal(probes.get(0).shop.name, 'Replacement session shop'); assert.equal(probes.get(0).error, null);
}));
