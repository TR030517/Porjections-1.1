import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { clearSession } from '../api/session';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { ConfirmationProvider } from './Confirmation';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: AdminManagement } = await import('../views/system/AdminManagement');

type Element = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Element;
  return predicate(node) ? node : find(node.props.children, predicate);
}

test('the administrator editor sends only the changed name or status', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const originalFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const actor = { id: '7', name: 'Platform administrator', role: 'ADMIN' };
  let account = { id: '8', name: 'Store operations administrator', role: 'ADMIN', status: 'ACTIVE' };
  const patches: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, options) => {
    const { pathname } = new URL(String(input), 'http://synthetic.invalid');
    if (pathname.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'synthetic-only', user: actor });
    if (pathname.endsWith('/auth/me')) return Response.json(actor);
    if (options?.method === 'PATCH') {
      assert.equal(pathname, '/api/v1/studio/admins/8');
      const payload = JSON.parse(String(options.body));
      patches.push(payload);
      account = { ...account, ...payload };
      return Response.json({ item: account });
    }
    assert.equal(pathname, '/api/v1/studio/admins');
    return Response.json({ items: [account], total: 1, page: 1, pageSize: 25 });
  };
  clearSession();
  let tree: unknown, confirmation: unknown;
  function Probe() {
    const page = AdminManagement() as React.ReactElement<any>;
    tree = (page.type as (props: any) => unknown)(page.props);
    return null;
  }
  function SignedIn() {
    const { user } = useAuthStore();
    const provider = ConfirmationProvider({ children: user ? <Probe /> : null });
    confirmation = provider;
    return React.cloneElement(provider, {}, user ? <Probe /> : null);
  }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Element) => boolean, source = tree) => {
    const result = find(source, predicate);
    assert.ok(result, 'expected administrator editor control');
    return result;
  };
  const edit = () => act(async () => { control(node => node.type === 'button' && node.props.children === '编辑').props.onClick(); });
  const change = (field: string, value: string) => act(async () => { control(node => node.props.id === 'operation-' + field).props.onChange({ target: { value } }); });
  const submit = () => control(node => node.type === 'form', control(node => node.props.role === 'dialog')).props.onSubmit({ preventDefault() {}, stopPropagation() {} });

  try {
    await act(async () => { root.render(<AuthProvider><SignedIn /></AuthProvider>); });
    await edit();
    await act(async () => { await submit(); });
    assert.deepEqual(patches, []);

    await edit();
    account.status = 'SUSPENDED';
    await change('name', 'Renamed administrator');
    await act(async () => { await submit(); });
    assert.deepEqual(patches, [{ name: 'Renamed administrator' }]);
    assert.equal(account.status, 'SUSPENDED');

    await edit();
    account.name = 'Name from another session';
    await change('status', 'ACTIVE');
    await act(async () => { await submit(); });
    assert.deepEqual(patches.at(-1), { status: 'ACTIVE' });
    assert.equal(account.name, 'Name from another session');

    await edit();
    await change('status', 'SUSPENDED');
    let saving!: Promise<void>;
    await act(async () => { saving = submit(); });
    assert.equal(patches.length, 2);
    await act(async () => { control(node => node.type === 'button' && node.props.children === '禁用', confirmation).props.onClick(); await saving; });
    assert.deepEqual(patches.at(-1), { status: 'SUSPENDED' });
  } finally {
    await act(async () => { root.unmount(); });
    clearSession();
    globalThis.fetch = originalFetch;
    for (const [i, key] of keys.entries()) {
      if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
