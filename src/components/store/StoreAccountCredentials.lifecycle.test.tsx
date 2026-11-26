import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import { ConfirmationProvider } from '../Confirmation';
import StoreAccountCredentials from './StoreAccountCredentials';
import type { StoreAccountCredentials as Credentials } from '../../api/accountAccess';
import type { BusinessLifecycle } from './businessScope';

type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node;
  return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const credential = (shopId: string): Credentials => ({ shopId, userId: shopId === '5' ? '8' : null, email: shopId === '5' ? 'shop5@example.invalid' : null, accountStatus: shopId === '5' ? 'SUSPENDED' : null, loginReady: false, password: shopId === '5' ? 'Aa123456' : null, credentialUpdatedAt: shopId === '5' ? '2026-11-07T01:00:00Z' : null, version: 'a'.repeat(64) });

test('account editor keeps six-digit and random password drafts, retries the exact request, and fences previous shops', async () => {
  const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  doc.defaultView = win;
  let copied = '';
  for (const [key, value] of Object.entries({ window: win, document: doc, navigator: { clipboard: { async writeText(value: string) { copied = value; } } }, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic credential admin' };
  const records: Record<string, Credentials> = { '5': credential('5'), '6': credential('6') };
  const writes: Record<string, unknown>[] = [], saved: Credentials[] = [];
  let shopId = '5', tree: unknown, confirmation: unknown, lifecycle: BusinessLifecycle = { dirty: false, busy: false, unknown: false };
  let write: (body: Record<string, unknown>) => Promise<Response> = async () => Response.json({ message: '邮箱已被使用' }, { status: 409 });
  let read: ((shop: string) => Promise<Response>) | undefined;
  const acceptWrite = async (body: Record<string, unknown>, replayed = false) => {
    records[shopId] = { ...records[shopId], ...(body.email === undefined ? {} : { email: String(body.email) }), ...(body.password === undefined ? {} : { password: String(body.password) }), version: 'b'.repeat(64) };
    return Response.json({ ...records[shopId], replayed });
  };
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    const shop = path.match(/\/account-access\/admin\/shops\/(5|6)\/credentials$/)?.[1];
    assert.ok(shop, `unexpected synthetic request ${path}`);
    if (options?.method === 'PATCH') { const body = JSON.parse(String(options.body)); writes.push(body); return write(body); }
    return read ? read(shop) : Response.json(records[shop]);
  };
  clearSession();
  function Probe() { tree = StoreAccountCredentials({ shopId, suggestedEmail: 'suggested@example.invalid', onLifecycleChange: value => { lifecycle = value; }, onSaved: value => { saved.push(value); } }); return null; }
  function SilentConfirmation({ children }: { children: React.ReactNode }) {
    // Use the real confirmation state and callbacks, leaving its host dialog
    // unmounted so these remain isolated component tests.
    const provider = ConfirmationProvider({ children }); confirmation = provider;
    return React.cloneElement(provider, {}, children);
  }
  function SignedIn() { return useAuthStore().user ? <SilentConfirmation><Probe /></SilentConfirmation> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const control = (predicate: (node: Node) => boolean) => { const value = find(tree, predicate); assert.ok(value, 'expected account control exists'); return value; };
  const input = (kind: 'email' | 'password') => control(node => node.type === 'input' && node.props.id === `store-account-${kind}-${shopId}`);
  const button = (label: string) => control(node => node.type === 'button' && text(node).trim() === label);
  const change = (kind: 'email' | 'password', value: string) => act(async () => { input(kind).props.onChange({ target: { value } }); });
  const save = () => act(async () => { button('保存账号设置').props.onClick(); });
  try {
    await render(); assert.equal(writes.length, 0); assert.equal(input('password').props.type, 'password'); assert.equal(input('password').props.minLength, 6);
    await act(async () => { control(node => node.type === 'button' && node.props['aria-label'] === '复制登录密码').props.onClick(); });
    assert.equal(copied, 'Aa123456', 'explicit copy remains available while the password is masked');
    assert.equal(input('password').props.type, 'password');
    await act(async () => { control(node => node.type === 'button' && node.props['aria-label'] === '显示商家登录密码').props.onClick(); });
    assert.equal(input('password').props.type, 'text');
    await act(async () => { control(node => node.type === 'button' && node.props['aria-label'] === '隐藏商家登录密码').props.onClick(); });
    assert.equal(input('password').props.type, 'password');
    await act(async () => { button('随机生成8位密码').props.onClick(); });
    const random = input('password').props.value;
    assert.match(random, /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8}$/); assert.equal(lifecycle.dirty, true);
    await change('email', '  Changed@Example.invalid  '); await save();
    assert.equal(writes.length, 1); assert.equal(writes[0].email, 'changed@example.invalid'); assert.equal(writes[0].password, random);
    assert.equal(input('password').props.value, random); assert.equal(input('email').props.value, '  Changed@Example.invalid  '); assert.equal(lifecycle.unknown, false);
    await change('password', '12345'); await save(); assert.equal(writes.length, 1, 'five digits are rejected before PATCH');
    await change('password', '123456'); write = body => acceptWrite(body); await save();
    assert.equal(writes.length, 2); assert.equal(saved.length, 1); assert.equal(saved[0].password, '123456'); assert.equal(saved[0].accountStatus, 'SUSPENDED');
    assert.equal(input('password').props.type, 'password', 'saving resets explicit password reveal');
    assert.equal(lifecycle.dirty, false); assert.match(text(tree), /账号仍禁用/);
    await change('email', 'next@example.invalid'); await change('password', ''); await save();
    assert.equal(writes.length, 3); assert.equal(Object.hasOwn(writes[2], 'password'), false, 'a blank input retains the saved password');
    assert.equal(saved.at(-1)?.password, '123456');

    await act(async () => { button('随机生成8位密码').props.onClick(); });
    const uncertainPassword = input('password').props.value;
    write = async () => { throw new TypeError('Synthetic lost response'); }; await save();
    const uncertain = structuredClone(writes.at(-1)!);
    assert.equal(lifecycle.unknown, true); assert.equal(input('password').props.disabled, true);
    write = body => acceptWrite(body, true);
    await act(async () => { button('核对原保存结果').props.onClick(); });
    assert.deepEqual(writes.at(-1), uncertain, 'reconciliation resends the exact password and request key');
    assert.equal(saved.at(-1)?.password, uncertainPassword); assert.equal(lifecycle.unknown, false); assert.equal(lifecycle.dirty, false);

    await change('password', '654321'); write = async () => { throw new TypeError('Synthetic second lost response'); }; await save();
    write = async () => Response.json({ error: { code: 'SHOP_CREDENTIALS_REPLAY_CHANGED', message: '账号已被后来修改' } }, { status: 409 });
    await act(async () => { button('核对原保存结果').props.onClick(); });
    const beforeRecovery = writes.length;
    records['5'] = { ...records['5'], password: 'Current123', version: 'c'.repeat(64) };
    await act(async () => { button('重新读取当前账号并核对').props.onClick(); });
    const confirm = find(confirmation, node => node.type === 'button' && text(node) === '放弃账号草稿并载入'); assert.ok(confirm);
    await act(async () => { confirm.props.onClick(); });
    assert.equal(writes.length, beforeRecovery, 'explicit conflict recovery reads without replaying an obsolete password');
    assert.equal(input('password').props.value, 'Current123'); assert.equal(lifecycle.unknown, false);
    await act(async () => { control(node => node.type === 'button' && node.props['aria-label'] === '显示商家登录密码').props.onClick(); });
    assert.equal(input('password').props.type, 'text');

    const pending = deferred<Response>(); read = async () => pending.promise;
    await act(async () => { button('重新读取账号').props.onClick(); });
    assert.equal(input('password').props.type, 'password', 'reload masks a previously revealed credential immediately');
    read = undefined; shopId = '6'; await render();
    assert.equal(input('email').props.value, 'suggested@example.invalid'); assert.equal(input('password').props.value, '');
    assert.equal(input('password').props.type, 'password');
    await act(async () => { pending.resolve(Response.json(records['5'])); });
    assert.equal(input('email').props.value, 'suggested@example.invalid', 'a previous shop read cannot expose its account or secret in this shop');
    assert.equal(input('password').props.value, ''); assert.equal(saved.at(-1)?.shopId, '5');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});
