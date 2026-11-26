import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Alert, Form, Input } from 'antd';
import axios from 'axios';
import { createServer } from 'vite';

const viteServer = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const all = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(node => all(node, predicate)) : React.isValidElement(tree)
  ? [...(predicate(tree) ? [tree] : []), ...all(tree.props.children, predicate)] : [];
const words = tree => Array.isArray(tree) ? tree.map(words).join('') : React.isValidElement(tree) ? words(tree.props.children) : typeof tree === 'string' ? tree : '';

test('merchant sign-in resumes an exact whitelisted function and preserves shop, pane and service selection', async () => {
  const vite = await viteServer();
  try {
    const nav = await vite.ssrLoadModule('/src/utils/loginNavigation.ts');
    for (const [path, query] of [['/price-menu', '?shopId=1335&pane=booking&serviceId=51'], ['/staff', '?shopId=1335'], ['/bookings', '?shopId=1335&bookingId=42']]) {
      const login = new URL(nav.merchantLoginHref(path, query), 'https://merchant.invalid');
      assert.equal(login.pathname, '/login');
      assert.equal(login.searchParams.get('shopId'), '1335');
      assert.equal(nav.merchantPostLoginTarget(login.search), path + query);
    }
    assert.equal(nav.merchantPostLoginTarget('?shopId=1335'), '/?shopId=1335');
    assert.equal(nav.merchantPostLoginTarget('?shopId=0'), '/');
  } finally { await vite.close(); }
});

test('return navigation rejects external, encoded-path, normalized traversal, duplicate and login-loop targets', async () => {
  const vite = await viteServer();
  try {
    const nav = await vite.ssrLoadModule('/src/utils/loginNavigation.ts');
    for (const value of ['https://evil.invalid', '//evil.invalid/path', '/\\evil.invalid/path', '/login', '/admin', '/merchant/staff', '/%73taff', '/unknown/../staff', '/staff\n', '/staff ']) {
      assert.equal(nav.safeMerchantReturnTo(value), null, value);
      assert.equal(nav.merchantPostLoginTarget('?shopId=1335&returnTo=' + encodeURIComponent(value)), '/?shopId=1335');
    }
    assert.equal(nav.merchantPostLoginTarget('?shopId=1335&returnTo=%2Fstaff&returnTo=%2Fbookings'), '/?shopId=1335');
    assert.equal(nav.merchantPostLoginTarget('?shopId=1335&shopId=1334'), '/');
  } finally { await vite.close(); }
});

async function loginHarness(run) {
  const previous = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'MessageChannel'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAdapter = axios.defaults.adapter;
  const NativeMessageChannel = globalThis.MessageChannel, channels = [];
  // rc-component/form schedules watch notifications with MessageChannel. Node
  // ports need explicit teardown; close only the channels created in this harness.
  class FormMessageChannel extends NativeMessageChannel {
    constructor() { super(); channels.push(this); }
  }
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const window = { document, HTMLIFrameElement: class {}, event: undefined }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true, MessageChannel: FormMessageChannel })) Object.defineProperty(globalThis, key, { configurable: true, value });
  let reject = true, tree, auth, root, router;
  const calls = [];
  axios.defaults.adapter = async config => {
    assert.equal(config.url, '/auth/login'); calls.push(JSON.parse(config.data));
    if (reject) throw Object.assign(Error('Synthetic rejected sign-in'), { config, response: { status: 401, data: { message: '账号或密码不正确' } } });
    return { config, data: { accessToken: 'synthetic-session', user: { id: '17', role: 'STAFF' } }, headers: {}, status: 200, statusText: 'OK' };
  };
  const vite = await viteServer();
  try {
    const LoginPage = (await vite.ssrLoadModule('/src/pages/login/index.tsx')).default;
    auth = (await vite.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    auth.getState().logout();
    function Probe() { tree = LoginPage(); return null; }
    router = createMemoryRouter([{ path: '*', element: React.createElement(Probe) }], {
      initialEntries: ['/login?shopId=1335&returnTo=' + encodeURIComponent('/price-menu?shopId=1335&pane=booking&serviceId=51')],
    });
    root = createRoot(container);
    await act(async () => root.render(React.createElement(RouterProvider, { router })));
    const form = () => all(tree, node => node.type === Form)[0].props;
    await run({ tree: () => tree, form, calls, router, auth, allow: () => { reject = false; },
      submit: values => act(async () => { await form().onFinish(values); }),
    });
  } finally {
    if (root) await act(async () => root.unmount());
    router?.dispose(); auth?.getState().logout(); await vite.close(); axios.defaults.adapter = oldAdapter;
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
}

test('real login form explains activation and recovery, clears rejected password and resumes the protected page after success', async () => {
  await loginHarness(async h => {
    assert.match(words(h.tree()), /商家后台登录/);
    assert.match(words(h.tree()), /平台已启用的门店邮箱账号/);
    assert.match(words(h.tree()), /账号如何获取／忘记密码/);
    assert.match(words(h.tree()), /核验身份/);
    assert.equal(all(h.tree(), node => node.type === Input)[0].props.autoComplete, 'username');
    assert.equal(all(h.tree(), node => node.type === Input.Password)[0].props.autoComplete, 'current-password');
    h.form().form.setFieldsValue({ identifier: 'owner@example.invalid', password: 'Synthetic-rejected-1' });
    await h.submit(h.form().form.getFieldsValue(true));
    assert.equal(h.form().form.getFieldValue('identifier'), 'owner@example.invalid');
    assert.equal(h.form().form.getFieldValue('password'), '');
    assert.equal(h.calls.length, 1);
    assert.equal(h.auth.getState().token, null);
    assert.equal(all(h.tree(), node => node.type === Alert)[0].props.title, '账号或密码不正确');
    h.allow();
    await h.submit({ identifier: 'owner@example.invalid', password: 'Synthetic-accepted-2' });
    assert.equal(h.calls.length, 2);
    assert.equal(h.auth.getState().merchant.role, 'STAFF');
    assert.equal(h.router.state.location.pathname + h.router.state.location.search, '/price-menu?shopId=1335&pane=booking&serviceId=51');
  });
});

