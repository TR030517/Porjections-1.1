import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession, loginWithPassword } from '../api/session';
import type { ResourceQuery } from '../api/resources';
import { restoreAdminLocation, writeAdminLocation } from '../utils/adminLocation';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; const result = await nextLoad(url, context); if(url.endsWith('/merchantWorkspaceUrl.ts'))return {...result,source:String(result.source).replace('import.meta.env.DEV','false')}; if(url.endsWith('/customerSiteUrl.ts'))return {...result,source:String(result.source).replaceAll('import.meta.env','({})')}; return result; }"), import.meta.url);
const { default: StoreManagement } = await import('./StoreManagement');
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

async function directory(initial: ResourceQuery) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const previousFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const location = { origin: 'http://synthetic.invalid', pathname: '/admin/', search: '' };
  const history = {
    state: null as unknown,
    replaceState(state: unknown, _title: string, url: string) { this.state = state; location.search = new URL(url, location.origin).search; },
    pushState(state: unknown, title: string, url: string) { this.replaceState(state, title, url); },
  };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, location, history,
    sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const browser = win as unknown as Pick<Window, 'location' | 'history' | 'sessionStorage'>;
  let identity = { id: '7', role: 'ADMIN', name: 'Synthetic directory admin' };
  const identityKey = () => 'SUPER_ADMIN:' + identity.id;
  writeAdminLocation({ view: 'store-list', query: initial }, identityKey(), browser, true);
  let entry = restoreAdminLocation(identityKey(), browser, () => true).query;
  let tree: unknown, revision = 0, writes = 0;
  const queries: URLSearchParams[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname.endsWith('/auth/refresh') || url.pathname.endsWith('/auth/admin/refresh') || url.pathname.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-token', user: identity });
    if (url.pathname.endsWith('/auth/me')) return Response.json(identity);
    if (options?.method && options.method !== 'GET') writes++;
    assert.equal(url.pathname, '/api/v1/studio/stores'); queries.push(url.searchParams);
    return Response.json({ items: [{ id: '5', ownerId: '9', name: 'Synthetic store', shortName: 'synthetic-store', status: 'APPROVED' }], total: 320,
      page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) });
  };
  const publish = (query: ResourceQuery) => writeAdminLocation({ view: 'store-list', query }, identityKey(), browser, true);
  clearSession();
  function Probe() { tree = StoreManagement({ initialQuery: entry, onQueryChange: publish }); return null; }
  function SignedIn() { const { user } = useAuthStore(); return user ? <Probe key={String(user.id) + ':' + revision} /> : null; }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const mount = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const control = (predicate: (node: Node) => boolean) => { const value = find(tree, predicate); assert.ok(value, 'expected directory control exists'); return value; };
  await mount();
  return {
    control, queries, browser, writes: () => writes, tree: () => tree,
    query: () => restoreAdminLocation(identityKey(), browser, () => true).query,
    async refresh() { entry = restoreAdminLocation(identityKey(), browser, () => true).query; revision++; await mount(); },
    async changeIdentity() {
      identity = { ...identity, id: '8' };
      entry = restoreAdminLocation(identityKey(), browser, () => true).query;
      await act(async () => { await loginWithPassword('synthetic@example.invalid', 'synthetic-only'); });
    },
    async cleanup() {
      await act(async () => root.unmount()); clearSession(); globalThis.fetch = previousFetch;
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    },
  };
}

test('store directory restores committed filters and page after refresh, while drafts stay out of its URL and query', async () => {
  const h = await directory({ search: 'private-store-query', status: 'APPROVED', page: 3, pageSize: 50 });
  const search = () => h.control(node => node.type === 'input' && node.props.type === 'search');
  const status = () => h.control(node => node.type === 'select' && node.props['aria-label'] !== '每页门店数');
  try {
    assert.equal(h.queries[0].get('page'), '3'); assert.equal(h.queries[0].get('pageSize'), '50');
    assert.equal(h.queries.at(-1)?.get('search'), 'private-store-query');
    assert.equal(h.queries.at(-1)?.get('status'), 'APPROVED');
    const beforeDraft = h.browser.location.search;
    await act(async () => { search().props.onChange({ target: { value: 'unsubmitted store' } }); status().props.onChange({ target: { value: 'SUSPENDED' } }); });
    assert.equal(h.browser.location.search, beforeDraft);
    assert.equal(h.query().search, 'private-store-query'); assert.equal(h.query().status, 'APPROVED');
    await h.refresh();
    assert.equal(search().props.value, 'private-store-query'); assert.equal(status().props.value, 'APPROVED');
    assert.equal(h.query().page, 3); assert.equal(h.query().pageSize, 50);
    await act(async () => { search().props.onChange({ target: { value: ' next-store ' } }); status().props.onChange({ target: { value: 'PENDING' } }); });
    await act(async () => { h.control(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); });
    assert.equal(h.query().page, 1); assert.equal(h.query().pageSize, 50);
    assert.equal(h.query().search, 'next-store'); assert.equal(h.query().status, 'PENDING');
    await act(async () => h.control(node => node.props['aria-label'] === '下一页门店').props.onClick());
    assert.equal(h.query().page, 2);
    await act(async () => h.control(node => node.type === 'select' && node.props['aria-label'] === '每页门店数').props.onChange({ target: { value: '100' } }));
    assert.equal(h.query().page, 1); assert.equal(h.query().pageSize, 100);
    await act(async () => h.control(node => node.props['aria-label'] === '下一页门店').props.onClick());
    await act(async () => h.control(node => node.type === 'button' && text(node).trim() === '编辑门店').props.onClick());
    await act(async () => h.control(node => typeof node.type === 'function' && node.type.name === 'StoreWorkspace').props.onClose());
    assert.equal(h.query().page, 2); assert.equal(h.query().pageSize, 100);
    await h.refresh();
    assert.equal(h.queries.at(-1)?.get('page'), '2'); assert.equal(h.queries.at(-1)?.get('pageSize'), '100');
    assert.equal(h.queries.at(-1)?.get('search'), 'next-store'); assert.equal(h.queries.at(-1)?.get('status'), 'PENDING');
    assert.equal(h.browser.location.search.includes('next-store'), false);
    assert.equal(h.browser.location.search.includes('unsubmitted'), false);
    assert.equal(h.writes(), 0);
  } finally { await h.cleanup(); }
});

test('store directory identity replacement discards previous private filters and pagination', async () => {
  const h = await directory({ search: 'previous-admin-private', status: 'SUSPENDED', page: 4, pageSize: 50 });
  try {
    await h.changeIdentity();
    assert.equal(h.control(node => node.type === 'input' && node.props.type === 'search').props.value, '');
    assert.equal(h.queries.at(-1)?.get('search'), null); assert.equal(h.queries.at(-1)?.get('status'), null);
    assert.equal(h.queries.at(-1)?.get('page'), '1'); assert.equal(h.queries.at(-1)?.get('pageSize'), '25');
    assert.equal(h.query().search, undefined); assert.equal(h.query().status, undefined);
    assert.equal(h.writes(), 0);
  } finally { await h.cleanup(); }
});
