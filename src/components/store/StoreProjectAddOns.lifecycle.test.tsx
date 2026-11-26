import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession, loginWithPassword } from '../../api/session';
import { ConfirmationProvider } from '../Confirmation';
import type { ProjectCatalogAddOn } from '../../utils/projectCatalog';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreProjectAddOns } = await import('./StoreProjectAddOns');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string { return Array.isArray(tree) ? tree.map(text).join(' ') : React.isValidElement(tree) ? text((tree as Node).props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''; }
const initial: ProjectCatalogAddOn[] = [{ id: '8', serviceId: '9', name: 'Saved oil', description: 'Saved description', priceCents: 1000, currency: 'usd', sortOrder: 0, isActive: true, preview: null }];
type Mode = 'normal' | 'lost' | 'reject' | 'deferred';
type Handler = (...args: any[]) => any;
async function harness(run: (h: { open: () => Promise<void>; close: () => Promise<void>; confirm: () => Promise<void>; input: (value: string) => Promise<void>; field: () => Handler; submit: () => Handler; closeEvent: () => Handler; openEvent: () => Handler; save: () => Promise<void>; status: () => string; value: () => string | undefined; dialog: () => boolean; mode: (value: Mode) => void; writes: Record<string, unknown>[]; saved: () => number; actor: () => Promise<void>; resolve: () => void; }) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const, descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: any = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let tree: unknown, confirmation: unknown, actor = '7', mode: Mode = 'normal', saved = 0, resolve!: () => void;
  const writes: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, options) => {
    const path = String(input), user = { id: actor, role: 'ADMIN', name: 'Synthetic add-on admin' };
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh') || path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-only', user });
    if (path.endsWith('/auth/me')) return Response.json(user);
    if (path.endsWith('/shops/5/add-ons/8') && options?.method === 'PATCH') {
      const patch = JSON.parse(String(options.body)); writes.push(patch);
      if (mode === 'reject') return Response.json({ message: 'Conflict' }, { status: 409 });
      if (mode === 'lost') throw Error('Synthetic lost response');
      if (mode === 'deferred') await new Promise<void>(done => { resolve = done; });
      return Response.json({ item: { ...initial[0], ...patch } });
    }
    throw Error('Unexpected synthetic request: ' + path);
  };
  function Confirm({ children }: { children: React.ReactNode }) {
    const provider = ConfirmationProvider({ children }); confirmation = provider.props.children;
    return React.cloneElement(provider, { children });
  }
  function Probe() { tree = StoreProjectAddOns({ shopId: '5', serviceId: '9', items: initial, disabled: false, beforeWrite: () => true, onLifecycleChange: () => {}, onSaved: () => { saved++; } }); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const node = (predicate: (node: Node) => boolean) => { const result = find(tree, predicate); assert.ok(result, 'expected add-on control'); return result; };
  const field = () => node(node => node.type === 'input' && node.props.maxLength === 100).props.onChange;
  const submit = () => node(node => node.type === 'form').props.onSubmit;
  const closeEvent = () => node(node => node.type === 'button' && text(node) === '放弃本次编辑').props.onClick;
  const openEvent = () => node(node => node.type === 'button' && text(node) === '编辑附加项').props.onClick;
  clearSession(); const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => { root.render(<StrictMode><AuthProvider><Confirm><SignedIn /></Confirm></AuthProvider></StrictMode>); });
    await run({ open: () => act(async () => { openEvent()(); }), close: () => act(async () => { closeEvent()(); }), confirm: () => act(async () => { const button = find(confirmation, n => n.type === 'button' && text(n) === '放弃草稿'); assert.ok(button, 'expected discard confirmation'); button.props.onClick(); }), input: value => act(async () => { field()({ target: { value } }); }), field, submit, closeEvent, openEvent, save: () => act(async () => { await submit()({ preventDefault() {}, stopPropagation() {} }); }), status: () => text(tree), value: () => find(tree, n => n.type === 'input' && n.props.maxLength === 100)?.props.value, dialog: () => !!find(confirmation, n => n.props.role === 'alertdialog'), mode: value => { mode = value; }, writes, saved: () => saved, actor: () => act(async () => { actor = '8'; await loginWithPassword('synthetic', 'synthetic'); }), resolve: () => resolve() });
  } finally { await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch; keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
}
const event = () => ({ preventDefault() {}, stopPropagation() {} });

test('a discarded add-on draft cannot be submitted by its retained form callback', () => harness(async h => {
  await h.open(); await h.input('Discarded oil'); const old = h.submit(); await h.close(); await h.confirm(); await act(async () => { await old(event()); });
  assert.equal(h.writes.length, 0); assert.equal(h.value(), undefined); assert.equal(h.saved(), 0);
}));
test('an earlier add-on submit cannot replace more recent input', () => harness(async h => {
  await h.open(); await h.input('Earlier oil'); const old = h.submit(); await h.input('Current oil'); await act(async () => { await old(event()); });
  assert.equal(h.writes.length, 0); assert.equal(h.value(), 'Current oil');
}));
test('a retained add-on close cannot close a replacement editor', () => harness(async h => {
  await h.open(); const old = h.closeEvent(); await h.close(); await h.open(); await h.input('Replacement oil'); await act(async () => { old(); });
  assert.equal(h.value(), 'Replacement oil'); assert.equal(h.dialog(), false);
}));
test('an earlier field event cannot mutate the replacement add-on editor', () => harness(async h => {
  await h.open(); const old = h.field(); await h.close(); await h.open(); await h.input('Replacement oil'); await act(async () => { old({ target: { value: 'Retired field' } }); });
  assert.equal(h.value(), 'Replacement oil'); assert.equal(h.writes.length, 0);
}));
test('an old add-on open event cannot borrow a new administrator', () => harness(async h => {
  const old = h.openEvent(); await h.actor(); await act(async () => { old(); }); assert.equal(h.value(), undefined);
}));
test('an old add-on save event cannot borrow a new administrator', () => harness(async h => {
  await h.open(); await h.input('Old admin oil'); const old = h.submit(); await h.actor(); await act(async () => { await old(event()); });
  assert.equal(h.writes.length, 0); assert.equal(h.saved(), 0);
}));
test('a successful add-on edit retires its old submit event', () => harness(async h => {
  await h.open(); await h.input('Confirmed oil'); const old = h.submit(); await h.save(); await act(async () => { await old(event()); });
  assert.equal(h.writes.length, 1); assert.equal(h.saved(), 1); assert.equal(h.value(), undefined);
}));
test('unknown add-on results preserve the draft against a retained close event', () => harness(async h => {
  await h.open(); await h.input('Uncertain oil'); const old = h.closeEvent(); h.mode('lost'); await h.save(); await act(async () => { old(); });
  assert.equal(h.dialog(), false); assert.equal(h.value(), 'Uncertain oil'); assert.equal(h.writes.length, 1); assert.match(h.status(), /上次写入结果待核对/);
}));
test('unknown add-on results preserve the draft against a retained field event', () => harness(async h => {
  await h.open(); await h.input('Uncertain oil'); const old = h.field(); h.mode('lost'); await h.save(); await act(async () => { old({ target: { value: 'Unsent correction' } }); });
  assert.equal(h.value(), 'Uncertain oil'); assert.equal(h.writes.length, 1); assert.equal(h.saved(), 0);
}));
test('a definitive add-on rejection permits a corrected fresh save', () => harness(async h => {
  await h.open(); await h.input('Rejected oil'); h.mode('reject'); await h.save(); h.mode('normal'); await h.input('Corrected oil'); await h.save();
  assert.equal(h.writes.length, 2); assert.equal(h.saved(), 1); assert.equal(h.value(), undefined);
}));
test('a late add-on receipt after administrator change cannot announce success', () => harness(async h => {
  await h.open(); await h.input('Old admin oil'); h.mode('deferred'); let pending!: Promise<void>;
  await act(async () => { pending = h.submit()(event()); }); await h.actor(); await act(async () => { h.resolve(); await pending; });
  assert.equal(h.writes.length, 1); assert.equal(h.saved(), 0); assert.equal(h.value(), 'Old admin oil'); assert.doesNotMatch(h.status(), /已确认保存/);
}));
