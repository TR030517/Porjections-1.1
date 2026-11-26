import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession, loginWithPassword } from '../../api/session';
import type { ProjectCatalogItem } from '../../utils/projectCatalog';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreProjectMetadata } = await import('./StoreProjectMetadata');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string { return Array.isArray(tree) ? tree.map(text).join(' ') : React.isValidElement(tree) ? text((tree as Node).props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''; }
const initial = (): ProjectCatalogItem => ({ id: '9', shopId: '5', name: 'Body Massage', nameEn: null, category: 'MASSAGE', description: 'Saved project details', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 8000, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, hasVariants: false, variantCount: 0, addOnCount: 0, selectionRevision: 'a'.repeat(64), preview: null, variants: [], addOns: [] });
type Mode = 'normal' | 'mismatch' | 'lost' | 'reject' | 'deferred' | 'old-read' | 'read-failure' | 'wrong-shop-read' | 'deferred-read';
async function harness(run: (h: { input: (value: string) => Promise<void>; discard: () => Promise<void>; save: () => Promise<void>; submit: () => (event: any) => Promise<void>; status: () => string; value: () => string; lifecycle: () => any; mode: (value: Mode) => void; patches: Record<string, unknown>[]; reads: string[]; saved: () => number; actor: () => Promise<void>; shop: () => Promise<void>; resolve: () => void; }) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const, descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: any = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} }; const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let tree: unknown, actor = '7', project = initial(), server = initial(), mode: Mode = 'normal', state: any, saved = 0, resolve!: () => void;
  const patches: Record<string, unknown>[] = [], reads: string[] = [];
  globalThis.fetch = async (input, options) => {
    const path = String(input), user = { id: actor, role: 'ADMIN', name: 'Synthetic metadata admin' };
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh') || path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-only', user });
    if (path.endsWith('/auth/me')) return Response.json(user);
    if (path.endsWith('/studio/services/9') && options?.method === 'PATCH') {
      const patch = JSON.parse(String(options.body)); patches.push(patch);
      if (mode === 'reject') return Response.json({ message: 'Conflict' }, { status: 409 });
      server = { ...server, ...patch };
      if (mode === 'lost') throw Error('Synthetic lost response');
      if (mode === 'deferred') await new Promise<void>(done => { resolve = done; });
      return Response.json({ item: mode === 'mismatch' ? { ...server, shopId: '6' } : server });
    }
    if (path.includes('/reservation-admin/shops/') && path.includes('/project-catalog?')) {
      reads.push(path); const url = new URL(path, 'http://synthetic.invalid'), query = url.searchParams;
      if (mode === 'read-failure') return Response.json({ message: 'Service Unavailable' }, { status: 503 });
      if (mode === 'deferred-read') await new Promise<void>(done => { resolve = done; });
      return Response.json({ shopId: mode === 'wrong-shop-read' ? '6' : '5', search: '', status: 'all', page: 1, pageSize: 1, serviceId: query.get('serviceId'), total: 1, hasMore: false, canManageCatalog: true, canConfigurePolicy: true, items: [mode === 'old-read' ? initial() : server] });
    }
    throw Error('Unexpected synthetic request: ' + path);
  };
  const lifecycle = (value: any) => { state = value; };
  function Probe() { tree = StoreProjectMetadata({ project, disabled: false, beforeWrite: () => true, onLifecycleChange: lifecycle, onSaved: async () => { saved++; } }); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  clearSession(); const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const node = (predicate: (node: Node) => boolean) => { const result = find(tree, predicate); assert.ok(result, 'expected metadata control'); return result; };
  const submit = () => node(node => node.type === 'form').props.onSubmit;
  try {
    await render();
    await run({ input: value => act(async () => { node(node => node.type === 'textarea').props.onChange({ target: { value } }); }), discard: () => act(async () => { node(node => node.type === 'button' && text(node) === '放弃未保存修改').props.onClick(); }), save: () => act(async () => { await submit()({ preventDefault() {}, stopPropagation() {} }); }), submit, status: () => text(tree), value: () => node(node => node.type === 'textarea').props.value, lifecycle: () => state, mode: value => { mode = value; }, patches, reads, saved: () => saved, actor: () => act(async () => { actor = '8'; await loginWithPassword('synthetic', 'synthetic'); }), shop: async () => { project = { ...initial(), id: '10', shopId: '6', name: 'Second project' }; await render(); }, resolve: () => resolve() });
  } finally { await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch; keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
}
const event = () => ({ preventDefault() {}, stopPropagation() {} });

test('discarded metadata cannot be submitted by an earlier retained form callback', () => harness(async h => {
  await h.input('Draft to discard'); const old = h.submit(); await h.discard(); await act(async () => { await old(event()); });
  assert.deepEqual(h.patches, []); assert.equal(h.value(), 'Saved project details'); assert.equal(h.saved(), 0);
}));
test('a retained form callback cannot replace newer metadata input', () => harness(async h => {
  await h.input('Earlier draft'); const old = h.submit(); await h.input('Current draft'); await act(async () => { await old(event()); });
  assert.deepEqual(h.patches, []); assert.equal(h.value(), 'Current draft');
}));
test('a retained form callback cannot borrow a replacement administrator identity', () => harness(async h => {
  await h.input('Previous administrator draft'); const old = h.submit(); await h.actor(); await act(async () => { await old(event()); });
  assert.deepEqual(h.patches, []); assert.equal(h.saved(), 0);
}));
test('matching metadata PATCH reads the exact project before reporting synchronization success', () => harness(async h => {
  await h.input('Confirmed current details'); await h.save();
  assert.deepEqual(h.patches, [{ description: 'Confirmed current details' }]); assert.equal(h.reads.length, 1); assert.match(h.reads[0], /shops\/5\/project-catalog\?.*serviceId=9/); assert.equal(h.saved(), 1); assert.equal(h.lifecycle().unknown, false); assert.match(h.status(), /已保存/);
}));
test('a retained callback cannot submit the same successful edit again', () => harness(async h => {
  await h.input('One confirmed write'); const old = h.submit(); await h.save(); await act(async () => { await old(event()); });
  assert.equal(h.patches.length, 1); assert.equal(h.reads.length, 1); assert.equal(h.saved(), 1);
}));
test('matching write followed by old project readback does not claim verified success or resend', () => harness(async h => {
  h.mode('old-read'); await h.input('Persisted revised details'); const old = h.submit(); await h.save();
  assert.equal(h.lifecycle().unknown, true); assert.equal(h.saved(), 0); assert.equal(h.value(), 'Persisted revised details'); assert.doesNotMatch(h.status(), /且已重新读取本店目录与关联展示行/);
  await act(async () => { await old(event()); }); assert.equal(h.patches.length, 1);
}));
test('lost or wrong-shop metadata receipts lock old callbacks and preserve draft', async () => {
  for (const mode of ['lost', 'mismatch'] as const) await harness(async h => {
    h.mode(mode); await h.input('Retained uncertain details'); const old = h.submit(); await h.save(); await act(async () => { await old(event()); });
    assert.equal(h.patches.length, 1); assert.equal(h.lifecycle().unknown, true); assert.equal(h.value(), 'Retained uncertain details'); assert.equal(h.saved(), 0);
  });
});
test('unavailable or wrong-shop project readback keeps the acknowledged write locked without resending', async () => {
  for (const mode of ['read-failure', 'wrong-shop-read'] as const) await harness(async h => {
    h.mode(mode); await h.input('Saved but not read back'); const old = h.submit(); await h.save(); await act(async () => { await old(event()); });
    assert.equal(h.patches.length, 1); assert.equal(h.reads.length, 1); assert.equal(h.saved(), 0); assert.equal(h.lifecycle().unknown, true); assert.equal(h.value(), 'Saved but not read back');
  });
});
test('a definite rejected edit permits a fresh corrected submit without unknown lock', () => harness(async h => {
  h.mode('reject'); await h.input('Rejected details'); await h.save(); assert.equal(h.lifecycle().unknown, false); assert.equal(h.value(), 'Rejected details');
  h.mode('normal'); await h.input('Corrected details'); await h.save(); assert.equal(h.patches.length, 2); assert.equal(h.saved(), 1);
}));
test('a late receipt after switching project and shop never acknowledges the new context', () => harness(async h => {
  h.mode('deferred'); await h.input('Old shop details'); let pending!: Promise<void>;
  await act(async () => { pending = h.submit()(event()); }); await h.shop(); await act(async () => { h.resolve(); await pending; });
  assert.equal(h.patches.length, 1); assert.equal(h.saved(), 0); assert.doesNotMatch(h.status(), /共同资料已保存/);
}));
test('a late project readback after switching administrator never acknowledges the replacement identity', () => harness(async h => {
  h.mode('deferred-read'); await h.input('First administrator details'); let pending!: Promise<void>;
  await act(async () => { pending = h.submit()(event()); }); assert.equal(h.reads.length, 1); await h.actor(); await act(async () => { h.resolve(); await pending; });
  assert.equal(h.patches.length, 1); assert.equal(h.saved(), 0); assert.doesNotMatch(h.status(), /且已重新读取本店目录与关联展示行/);
}));
