import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import test from 'node:test';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Actual component handlers, rendered input attributes, transport and App gate.
// This Node contract harness is not browser/native-validation acceptance.
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const loginCode = compile('../src/components/LoginPage.tsx');
const sessionCode = compile('../src/api/session.ts');
const appCode = compile('../src/App.tsx');
function load(code, modules = {}, globals = {}) {
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports,
    require: name => { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; }, ...globals });
  return module.exports;
}
const fakeRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const sessionModules = {
  '../utils/platformSettings': { settingErrorFields: () => null },
  '../utils/accountSecurity': { validOwnPasswordResult: () => true },
  './logoutIntent': { logoutIntent: () => null, markExplicitLogout() {}, acceptExplicitLogin: () => true },
};
function* nodes(value) {
  if (Array.isArray(value)) { for (const child of value) yield* nodes(child); }
  else if (value && typeof value === 'object' && value.props) { yield value; yield* nodes(value.props.children); }
}
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);
const auth = login => ({ useAuthStore: () => ({ login, error: '', restore: async () => {} }) });
// Navigation is outside this form/role contract; keep the production path shape.
const merchantLinks = { merchantWorkspaceUrl: path => '/merchant' + (path.startsWith('/') ? path : '/' + path) };

test('rendered account input accepts usernames and email with password-manager semantics', () => {
  const Component = load(loginCode, { react: React, 'react/jsx-runtime': jsxRuntime,
    'lucide-react': { LockKeyhole: 'svg', Store: 'svg' }, '../stores/authStore': auth(async () => {}), '../utils/merchantWorkspaceUrl': merchantLinks }).default;
  const markup = renderToStaticMarkup(React.createElement(Component));
  assert.match(markup, /账号或邮箱/);
  assert.match(markup, /<input(?=[^>]*type="text")(?=[^>]*name="identifier")(?=[^>]*autoComplete="username")(?=[^>]*required="")[^>]*>/);
  assert.doesNotMatch(markup, /type="email"/);
  assert.match(markup, /autoComplete="current-password"/);
});

test('username submission preserves password bytes, prevents a duplicate submit and retains account after failure', async () => {
  const hooks = []; let cursor = 0, tree, rejectLogin;
  const calls = [];
  const react = { useState(initial) { const index = cursor++; hooks[index] ??= { value: initial };
    return [hooks[index].value, value => { hooks[index].value = value; }]; } };
  const Component = load(loginCode, { react, 'react/jsx-runtime': fakeRuntime, 'lucide-react': { LockKeyhole: 'svg', Store: 'svg' },
    '../stores/authStore': auth((identifier, password) => { calls.push({ identifier, password }); return new Promise((_, reject) => { rejectLogin = reject; }); }), '../utils/merchantWorkspaceUrl': merchantLinks }, { Error }).default;
  const render = () => { cursor = 0; tree = Component(); };
  const field = name => [...nodes(tree)].find(node => node.type === 'input' && node.props.name === name);
  const submit = () => { const pending = [...nodes(tree)].find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); return pending; };
  render(); field('identifier').props.onChange({ target: { value: '  independent_admin  ' } }); render();
  field('password').props.onChange({ target: { value: ' Synthetic password bytes ' } }); render();
  const pending = submit(); await submit();
  assert.deepEqual(calls, [{ identifier: 'independent_admin', password: ' Synthetic password bytes ' }]);
  assert.equal(field('identifier').props.disabled, true);
  rejectLogin(new Error('Synthetic rejected login')); await pending; render();
  assert.equal(field('identifier').props.value, '  independent_admin  ');
  assert.equal(field('password').props.value, '');
  assert.match(text(tree), /Synthetic rejected login/);
  assert.equal(field('identifier').props.disabled, false);
});

test('actual rejected login displays credential guidance, keeps the account and allows an explicit successful retry', async () => {
  const hooks = []; let cursor = 0, tree, attempts = 0;
  const calls = [];
  const api = load(sessionCode, sessionModules, { Headers, FormData, AbortController, AbortSignal, DOMException, Error,
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/v1/auth/admin/password/login') {
        attempts++;
        return attempts === 1
          ? Response.json({ error: { message: 'Invalid credentials' } }, { status: 401 })
          : Response.json({ accessToken: 'synthetic-retry-token', user: { id: '17', role: 'ADMIN' } });
      }
      if (path === '/api/v1/auth/admin/refresh') return Response.json({ accessToken: 'synthetic-restored-token', user: { id: '17', role: 'ADMIN' } });
      assert.equal(path, '/api/v1/auth/me');
      return Response.json({ id: '17', role: 'ADMIN' });
    } });
  const react = { useState(initial) { const index = cursor++; hooks[index] ??= { value: initial };
    return [hooks[index].value, value => { hooks[index].value = value; }]; } };
  const Component = load(loginCode, { react, 'react/jsx-runtime': fakeRuntime, 'lucide-react': { LockKeyhole: 'svg', Store: 'svg' },
    '../stores/authStore': auth(api.loginWithAdminPassword), '../utils/merchantWorkspaceUrl': merchantLinks }, { Error }).default;
  const render = () => { cursor = 0; tree = Component(); };
  const field = name => [...nodes(tree)].find(node => node.type === 'input' && node.props.name === name);
  const submit = async () => {
    const request = [...nodes(tree)].find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    render(); await request; render();
  };
  render(); field('identifier').props.onChange({ target: { value: '  admin@example.invalid  ' } }); render();
  field('password').props.onChange({ target: { value: 'synthetic-wrong-password' } }); render();
  await submit();
  assert.equal(text([...nodes(tree)].find(node => node.props.role === 'alert')), '账号或密码错误。');
  assert.equal(field('identifier').props.value, '  admin@example.invalid  ');
  assert.equal(field('password').props.value, '');
  assert.equal(field('identifier').props.disabled, false);
  assert.deepEqual(calls.map(call => call.path), ['/api/v1/auth/admin/password/login']);
  field('password').props.onChange({ target: { value: 'synthetic-correct-password' } }); render();
  await submit();
  assert.equal([...nodes(tree)].some(node => node.props.role === 'alert'), false);
  assert.equal((await api.restoreSession('ADMIN')).id, '17');
  assert.equal(attempts, 2);
  assert.equal(field('password').props.value, '');
  assert.equal(JSON.parse(calls[1].options.body).identifier, 'admin@example.invalid');
});

function transport() {
  const calls = [];
  const api = load(sessionCode, sessionModules, { Headers, FormData, AbortController, AbortSignal, DOMException, Error,
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/v1/auth/admin/password/login') return Response.json({ accessToken: 'synthetic-memory-token', user: { id: '17', role: 'ADMIN' } });
      if (path === '/api/v1/auth/admin/refresh') return Response.json({ accessToken: 'synthetic-restored-token', user: { id: '17', role: 'ADMIN' } });
      if (path === '/api/v1/auth/me') return Response.json({ id: '17', role: 'ADMIN', name: 'Synthetic admin' });
      throw new Error('Unexpected request');
    } });
  return { api, calls };
}
for (const identifier of ['independent_admin', 'admin@example.invalid']) {
  test(`actual session transport uses identifier login for ${identifier.includes('@') ? 'legacy email' : 'independent username'}`, async () => {
    const { api, calls } = transport();
    const user = await api.loginWithAdminPassword('  ' + identifier + '  ', 'Synthetic password');
    assert.equal(user.role, 'ADMIN'); assert.equal(calls.length, 2);
    assert.equal(calls[0].path, '/api/v1/auth/admin/password/login');
    assert.deepEqual(JSON.parse(calls[0].options.body), { identifier, password: 'Synthetic password' });
    assert.equal(calls[0].options.credentials, 'include');
    assert.equal(calls[0].options.headers.has('Authorization'), false);
    assert.equal(calls[1].path, '/api/v1/auth/me');
    assert.equal(calls[1].options.headers.get('Authorization'), 'Bearer synthetic-memory-token');
    api.clearSession();
    assert.equal((await api.restoreSession('ADMIN')).role, 'ADMIN');
    assert.equal(calls[2].path, '/api/v1/auth/admin/refresh');
    assert.equal(calls[3].path, '/api/v1/auth/me');
  });
}

test('actual App gate still allows only the company ADMIN workspace', () => {
  const { Role } = load(compile('../src/utils/roleEnum.ts'));
  for (const role of ['ADMIN', 'MERCHANT', 'STAFF', 'CUSTOMER']) {
    const modules = new Proxy({ react: { lazy: loader => loader, Suspense: 'suspense', useEffect() {}, useRef: () => ({ current: null }) }, 'react/jsx-runtime': fakeRuntime,
      './utils/merchantWorkspaceUrl': merchantLinks,
      './stores/authStore': { Role, useAuthStore: () => ({ user: { id: '17', role }, loading: false,
        currentRole: role === 'ADMIN' ? Role.SUPER_ADMIN : role === 'MERCHANT' ? Role.STORE_MANAGER : Role.USER, logout: async () => {} }) },
    }, { has: () => true, get: (target, name) => target[name] ?? { __esModule: true, default: 'unused-component' } });
    const App = load(appCode, modules).default, tree = App();
    if (role === 'ADMIN') assert.equal(tree.type.name, 'Workspace');
    else {
      assert.match(text(tree), /公司管理后台仅供平台管理员使用/);
      assert.ok([...nodes(tree)].some(node => node.type === 'a' && node.props.href === '/merchant/'));
      assert.notEqual(tree.type?.name, 'Workspace');
    }
  }
});
