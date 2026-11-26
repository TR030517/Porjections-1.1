import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession, loginWithPassword } from '../../api/session';
import type { CatalogMutationReceipt } from '../../types/catalogMutation';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreUnifiedProjects } = await import('./StoreUnifiedProjects');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
}
const clean = { dirty: false, busy: false, unknown: false };
const receipt: CatalogMutationReceipt = { operationId: '1', action: 'CREATE_VARIANT', shopId: '5', serviceId: '9', variantId: '91', created: { service: false, variant: true, display: true }, displayStatus: 'ADDED', displayItemId: 'new-row', priceMenuRevision: 'b'.repeat(64), selectionRevision: 'c'.repeat(64) };
const row = (id: string, shopId: string) => ({ id, shopId, name: 'Synthetic service ' + id, nameEn: null, description: 'Saved common metadata', category: 'MASSAGE', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 8000, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, hasVariants: false, variantCount: 0, addOnCount: 0, selectionRevision: 'a'.repeat(64), preview: null, variants: [], addOns: [] });

async function harness(run: (h: { component: (name: string) => Node; selected: string[]; refreshes: () => number; defer: () => void; resolve: () => void; shop: () => Promise<void>; actor: () => Promise<void>; }) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const, descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: any = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} }; const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let tree: unknown, shopId = '5', actorId = '7', refreshes = 0, deferred = false, resolve!: () => void; const selected: string[] = [];
  globalThis.fetch = async (input, options) => {
    const path = String(input), user = { id: actorId, role: 'ADMIN', name: 'Synthetic unified admin' };
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh') || path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-only', user });
    if (path.endsWith('/auth/me')) return Response.json(user);
    assert.ok(!options?.method || options.method === 'GET', 'parent navigation never sends a business write');
    const url = new URL(path, 'http://synthetic.invalid'), targetShop = url.pathname.match(/shops\/(\d+)\/project-catalog$/)?.[1]; assert.ok(targetShop);
    const serviceId = url.searchParams.get('serviceId')!;
    return Response.json({ shopId: targetShop, search: '', status: 'all', page: 1, pageSize: 1, serviceId, total: 1, hasMore: false, canManageCatalog: true, canConfigurePolicy: true, items: [row(serviceId, targetShop)] });
  };
  const onChanged = async () => { refreshes++; if (deferred) await new Promise<void>(done => { resolve = done; }); };
  const onSelectService = (id: string) => { selected.push(id); };
  function Probe() { tree = StoreUnifiedProjects({ shopId, onlineBookingEnabled: true, menu: [], priceMenuRevision: 'a'.repeat(64), menuAvailability: { status: 'known' }, revision: 0, selectedServiceId: shopId === '5' ? '7' : '17', disabled: false, beforeWrite: () => true, onSelectService, onLocateMenu() {}, onLifecycleChange() {}, onChanged }); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  clearSession(); const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const component = (name: string) => { const result = find(tree, node => typeof node.type === 'function' && node.type.name === name); assert.ok(result, 'expected ' + name); return result; };
  try { await render(); await run({ component, selected, refreshes: () => refreshes, defer: () => { deferred = true; }, resolve: () => { deferred = false; resolve(); }, shop: async () => { shopId = '6'; await render(); }, actor: () => act(async () => { actorId = '8'; await loginWithPassword('synthetic', 'synthetic'); }) }); }
  finally { await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch; keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
}

test('creation acknowledgement cannot select its old service after parent refresh crosses shops', () => harness(async h => {
  const callback = h.component('StoreCatalogCreate').props.onSaved; h.defer(); let completion!: Promise<unknown>;
  await act(async () => { completion = callback(receipt).catch(() => undefined); }); await h.shop(); await act(async () => { h.resolve(); await completion; });
  assert.deepEqual(h.selected, []); assert.equal(h.component('StoreProjectMetadata').props.project.id, '17'); assert.equal(h.component('StoreProjectMetadata').props.project.shopId, '6');
}));
test('retired creation acknowledgement cannot begin refreshing after an administrator replacement', () => harness(async h => {
  const callback = h.component('StoreCatalogCreate').props.onSaved; await h.actor(); await act(async () => { await callback(receipt).catch(() => undefined); });
  assert.equal(h.refreshes(), 0); assert.deepEqual(h.selected, []);
}));
test('retained service selection respects a newly dirty sibling instead of discarding its draft', () => harness(async h => {
  const callback = h.component('StoreProjectInventory').props.onSelect; await act(async () => { h.component('StoreCatalogCreate').props.onLifecycleChange({ ...clean, dirty: true }); });
  await act(async () => { callback('8'); }); assert.deepEqual(h.selected, []); assert.equal(h.component('StoreProjectMetadata').props.project.id, '7');
}));
test('retained inventory selection cannot navigate a replacement shop', () => harness(async h => {
  const callback = h.component('StoreProjectInventory').props.onSelect; await h.shop(); await act(async () => { callback('8'); });
  assert.deepEqual(h.selected, []); assert.equal(h.component('StoreProjectMetadata').props.project.id, '17');
}));
test('current successful creation selects the exact created service after refreshing', () => harness(async h => {
  await act(async () => { await h.component('StoreCatalogCreate').props.onSaved(receipt); });
  assert.equal(h.refreshes(), 1); assert.deepEqual(h.selected, ['9']); assert.equal(h.component('StoreProjectMetadata').props.project.id, '9');
}));
