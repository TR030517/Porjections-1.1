import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import type { StoreItem } from './store/types';
import { blankDraft } from './store/storeModel';

// Reproduce Vite's production DEV constant without stubbing directory behavior.
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
const store = (id: string): StoreItem => ({
  id, ownerId: '9', name: `Synthetic store ${id}`, shortName: `synthetic-store-${id}`, canonicalShortName: `synthetic-store-${id}`, canonicalPath: `/s/synthetic-store-${id}`, status: 'APPROVED',
} as StoreItem);

test('actual directory edit defaults saved stores to readiness, while new and explicitly targeted entries retain their destinations', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, location: { origin: 'http://local.invalid' }, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic directory admin' };
  const saved: StoreItem = { ...store('5'), subtitle: '', timezone: 'America/Chicago', phones: [], emails: [], businessHours: blankDraft().businessHours,
    address: '', city: '', state: '', zipCode: '', latitude: null, longitude: null, gallery: [], about: '', tags: [], priceMenu: [], priceMenuRevision: 'a'.repeat(64),
    features: { onlineBooking: false, reviews: false, onlinePayment: false, membershipCard: false } };
  let tree: unknown, entry: Parameters<typeof StoreManagement>[0] = {}, writes = 0;
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    if (options?.method && options.method !== 'GET') writes++;
    assert.match(path, /\/studio\/stores\?/);
    return Response.json({ items: [saved], total: 1, page: 1, pageSize: 25 });
  };
  clearSession();
  function Probe() { tree = StoreManagement(entry); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const control = (predicate: (node: Node) => boolean) => { const value = find(tree, predicate); assert.ok(value, 'expected directory control exists'); return value; };
  const workspace = () => control(node => typeof node.type === 'function' && node.type.name === 'StoreWorkspace');
  const button = (label: string) => control(node => node.type === 'button' && text(node).trim() === label);
  const assertTab = (id: string) => {
    const html = renderToStaticMarkup(<AuthProvider>{workspace()}</AuthProvider>);
    assert.match(html, new RegExp(`id="store-tab-${id}"[^>]*aria-selected="true"`));
  };
  const close = () => act(async () => { workspace().props.onClose(); });
  try {
    await render(); await act(async () => { button('编辑门店').props.onClick(); });
    assert.equal(workspace().props.item.id, '5'); assert.equal(workspace().props.initialSection, undefined); assertTab('review');
    await close(); await act(async () => { button('新增门店').props.onClick(); });
    assert.equal(workspace().props.item, null); assertTab('basic'); await close();
    entry = { openStoreId: '5', initialWorkspaceSection: 'hours' }; await render();
    assert.equal(workspace().props.initialSection, 'hours'); assertTab('hours'); await close();
    entry = {}; await render(); entry = { openStoreId: '5' }; await render(); assertTab('review'); await close();
    entry = { openStoreId: '5', initialBusinessTarget: { tab: 'technicians' } }; await render();
    assert.deepEqual(workspace().props.initialBusinessTarget, { tab: 'technicians' }); assertTab('business'); await close();
    await act(async () => { button('编辑门店').props.onClick(); });
    assert.equal(workspace().props.initialBusinessTarget, undefined); assertTab('review'); await close();
    const readiness = control(node => typeof node.type === 'function' && node.type.name === 'Readiness');
    await act(async () => { readiness.props.onOpen(); }); assert.equal(workspace().props.initialSection, 'review'); assertTab('review');
    assert.equal(writes, 0, 'entry selection and readiness rendering never save or publish a store');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});

test('directory short-link saves preserve other drafts, retain rejected edits, and require reconciliation after an uncertain reply', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic directory admin' };
  let tree: unknown, rows = [store('5'), store('6')];
  const writes: { shopId: string; body: Record<string, unknown> }[] = [];
  let write: (shopId: string, body: Record<string, unknown>) => Promise<Response> = async () => Response.json({ error: { code: 'CONFLICT', message: '门店短链已被使用' } }, { status: 409 });
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    if (options?.method === 'PATCH') {
      const shopId = path.match(/\/studio\/stores\/(5|6)$/)?.[1]; assert.ok(shopId);
      const body = JSON.parse(String(options.body)); writes.push({ shopId, body }); return write(shopId, body);
    }
    assert.match(path, /\/studio\/stores\?/);
    return Response.json({ items: rows, total: rows.length, page: 1, pageSize: 25 });
  };
  clearSession();
  function Probe() { tree = StoreManagement({}); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Node) => boolean) => { const value = find(tree, predicate); assert.ok(value, 'expected directory control exists'); return value; };
  const link = (id: string) => control(node => typeof node.type === 'function' && node.type.name === 'StoreShortLink' && node.props.item.id === id);
  const change = (id: string, value: string) => act(async () => { link(id).props.onChange(value); });
  const save = (id: string) => act(async () => { link(id).props.onSave(); });
  const refresh = () => act(async () => { control(node => node.type === 'button' && node.props['aria-label'] === '刷新门店列表').props.onClick(); });
  try {
    await act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
    await change('5', ' New-Link '); await change('6', 'keep-this-draft'); await save('5');
    assert.deepEqual(writes[0], { shopId: '5', body: { shortName: 'new-link' } });
    assert.equal(link('5').props.value, ' New-Link '); assert.equal(link('5').props.unverified, false);
    assert.match(text(tree), /门店短链已被使用/);
    write = async (shopId, body) => {
      const shortName = String(body.shortName);
      rows = rows.map(row => row.id === shopId ? { ...row, shortName, canonicalShortName: shortName, canonicalPath: '/s/' + shortName } : row);
      return Response.json({ item: rows.find(row => row.id === shopId) });
    };
    await save('5');
    assert.equal(link('5').props.value, 'new-link'); assert.equal(link('5').props.item.canonicalPath, '/s/new-link');
    assert.equal(link('6').props.value, 'keep-this-draft', 'saving a different row must preserve an unsaved suffix');

    await change('5', 'uncertain-link'); write = async () => { throw new TypeError('Synthetic lost response'); }; await save('5');
    assert.equal(link('5').props.unverified, true); assert.equal(link('5').props.saveBlocked, true);
    const beforeRetry = writes.length; await save('5'); assert.equal(writes.length, beforeRetry, 'unknown completion cannot be submitted again until the list is reconciled');
    await refresh(); assert.equal(link('5').props.unverified, false); assert.equal(link('5').props.value, 'uncertain-link');
    assert.equal(link('6').props.value, 'keep-this-draft');

    write = async () => Response.json({ item: { ...store('6'), shortName: 'uncertain-link', canonicalShortName: 'uncertain-link', canonicalPath: '/s/uncertain-link' } });
    await save('5');
    assert.equal(link('5').props.unverified, true, 'a different shop receipt is never accepted as success');
    assert.equal(link('5').props.item.canonicalPath, '/s/new-link'); assert.equal(link('6').props.value, 'keep-this-draft');
    assert.match(text(tree), /回执与本店或提交内容不一致/);
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});
