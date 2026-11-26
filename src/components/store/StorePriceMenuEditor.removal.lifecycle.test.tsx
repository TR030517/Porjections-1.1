import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PriceMenuGroup } from '../../utils/priceMenu';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StorePriceMenuEditor } = await import('./StorePriceMenuEditor');
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
const initial = (): PriceMenuGroup[] => [{ category: 'Body', items: [
  { id: 'v1', name: 'Body 60', priceText: '$70', booking: { serviceId: '21', variantId: '31' } },
  { id: 'v2', name: 'Body 90', priceText: '$90', booking: { serviceId: '21', variantId: '32' } },
  { id: 'draft', name: 'Draft only', priceText: '$10' },
] }, { category: 'Featured', items: [
  { id: 'copy', name: 'Body 60 featured', priceText: '$70', booking: { serviceId: '21', variantId: '31' } },
] }];

async function harness(exercise: (h: {
  menu: () => PriceMenuGroup[]; calls: () => number; connections: () => number;
  status: () => string; node: (predicate: (node: Node) => boolean) => Node;
  confirmation: () => Node | undefined; remove: (row: number) => Node;
  invoke: (...callbacks: (() => void)[]) => Promise<void>;
  replace: (menu: PriceMenuGroup[]) => Promise<void>; reject: (value: boolean) => void;
  disabled: (value: boolean) => Promise<void>; scope: (value: string) => Promise<void>; unmount: () => Promise<void>;
}) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('No network is permitted in removal lifecycle tests'); };
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let tree: unknown, current = initial(), rejected = false, disabled = false, scope = '7:5', calls = 0, connections = 0;
  let replace!: (next: PriceMenuGroup[]) => void;
  function Probe(props: Parameters<typeof StorePriceMenuEditor>[0]) { tree = StorePriceMenuEditor(props); useEffect(() => { connections++; }, []); return null; }
  function Parent() {
    const [value, setValue] = useState(initial); current = value; replace = setValue;
    return <Probe value={value} disabled={disabled} catalogScopeKey={scope} catalogShopId={scope.split(':')[1]}
      onChange={next => { calls++; if (rejected) return false; setValue(next); return true; }} />;
  }
  const root = createRoot(container as unknown as HTMLElement); let mounted = true;
  const render = () => act(async () => { root.render(<StrictMode><Parent /></StrictMode>); });
  const node = (predicate: (node: Node) => boolean) => { const result = find(tree, predicate); assert.ok(result, 'expected actual editor control'); return result; };
  try {
    await render();
    await exercise({ menu: () => current, calls: () => calls, connections: () => connections, status: () => text(tree), node,
      confirmation: () => find(tree, n => typeof n.type === 'function' && n.type.name === 'PriceMenuRemovalConfirmation'),
      remove: row => { const item = node(n => n.props['aria-label'] === `本组第 ${row} 项`); const control = find(item, n => n.type === 'button' && text(n) === '移除展示行'); assert.ok(control); return control; },
      invoke: (...callbacks) => act(async () => { callbacks.forEach(callback => callback()); }),
      replace: menu => act(async () => { replace(menu); }), reject: value => { rejected = value; },
      disabled: async value => { disabled = value; await render(); }, scope: async value => { scope = value; await render(); },
      unmount: async () => { await act(async () => root.unmount()); mounted = false; },
    });
  } finally {
    if (mounted) await act(async () => root.unmount());
    globalThis.fetch = oldFetch;
    keys.forEach((key, at) => { const descriptor = descriptors[at]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('canceled removal cannot be revived by its retained confirm callback', () => harness(async h => {
  assert.equal(h.connections(), 2, 'real StrictMode cleanup and reconnect completed');
  await h.invoke(h.remove(1).props.onClick); const old = h.confirmation()!;
  await h.invoke(old.props.onCancel, old.props.onConfirm);
  assert.deepEqual(h.menu(), initial()); assert.equal(h.calls(), 0); assert.equal(h.confirmation(), undefined);
}));

test('old confirm and cancel cannot apply or close a later removal review', () => harness(async h => {
  await h.invoke(h.remove(1).props.onClick); const old = h.confirmation()!;
  await h.invoke(old.props.onCancel); await h.invoke(h.remove(2).props.onClick);
  const latest = h.confirmation()!;
  await h.invoke(old.props.onConfirm, old.props.onCancel);
  assert.deepEqual(h.menu(), initial()); assert.equal(h.calls(), 0);
  assert.equal(h.confirmation()?.props.request, latest.props.request);
  await h.invoke(h.confirmation()!.props.onConfirm);
  assert.deepEqual(h.menu()[0].items.map(row => row.id), ['v1', 'draft']);
}));

test('retained confirm cannot overwrite a newer complete controlled draft', () => harness(async h => {
  await h.invoke(h.remove(1).props.onClick); const old = h.confirmation()!;
  const latest = initial(); latest[1].items.push({ id: 'new-copy', name: 'New retained placement', priceText: '', booking: { serviceId: '21', variantId: '32' } });
  await h.replace(latest); await h.invoke(old.props.onConfirm);
  assert.deepEqual(h.menu(), latest); assert.equal(h.calls(), 0);
  await h.invoke(h.remove(2).props.onClick);
  assert.equal(h.confirmation()!.props.request.impacts[0].remainingBindings, 1, 'new review counts the whole current draft');
  assert.equal(h.confirmation()!.props.request.impacts[0].effect, 'RETAINED');
}));

test('replacing the parent draft with an equal fresh snapshot retires the old review', () => harness(async h => {
  await h.invoke(h.remove(1).props.onClick); const old = h.confirmation()!;
  const replacement = structuredClone(h.menu()); await h.replace(replacement);
  await h.invoke(old.props.onConfirm); assert.equal(h.menu(), replacement); assert.equal(h.calls(), 0);
}));

test('a retained unlinked remove button cannot overwrite replacement draft edits', () => harness(async h => {
  const old = h.remove(3).props.onClick; const latest = initial(); latest[0].items[0].description = 'New parent input';
  await h.replace(latest); await h.invoke(old);
  assert.deepEqual(h.menu(), latest); assert.equal(h.calls(), 0);
}));

test('leaving and returning to the same shop never revives an old remove button', () => harness(async h => {
  const old = h.remove(1).props.onClick;
  await h.scope('7:6'); await h.scope('7:5'); await h.invoke(old);
  assert.equal(h.confirmation(), undefined); assert.equal(h.calls(), 0); assert.deepEqual(h.menu(), initial());
}));

test('latest disabled state blocks old confirm and old unlinked remove callbacks', () => harness(async h => {
  const removeDraft = h.remove(3).props.onClick;
  await h.invoke(h.remove(2).props.onClick); const old = h.confirmation()!;
  await h.disabled(true); await h.invoke(old.props.onConfirm, removeDraft);
  assert.deepEqual(h.menu(), initial()); assert.equal(h.calls(), 0);
  await h.disabled(false); await h.invoke(old.props.onConfirm, removeDraft);
  assert.deepEqual(h.menu(), initial()); assert.equal(h.calls(), 0);
}));

test('parent refusal preserves draft and allows a fresh explicit removal review', () => harness(async h => {
  await h.invoke(h.remove(2).props.onClick); h.reject(true);
  await h.invoke(h.confirmation()!.props.onConfirm);
  assert.deepEqual(h.menu(), initial()); assert.equal(h.calls(), 1);
  assert.match(h.status(), /父层未接收|上下文已变化/); assert.doesNotMatch(h.status(), /已从当前草稿移除/);
  h.reject(false); await h.invoke(h.remove(2).props.onClick); await h.invoke(h.confirmation()!.props.onConfirm);
  assert.deepEqual(h.menu()[0].items.map(row => row.id), ['v1', 'draft']); assert.equal(h.calls(), 2);
}));

test('current group review counts bindings across all groups and removes only local draft once', () => harness(async h => {
  const source = h.menu(), snapshot = structuredClone(source);
  await h.invoke(h.node(n => n.type === 'button' && text(n) === '移除分组').props.onClick);
  const current = h.confirmation()!;
  assert.equal(current.props.request.itemCount, 3);
  assert.deepEqual(current.props.request.impacts.map((impact: any) => [impact.kind, impact.remainingBindings, impact.effect]), [
    ['variant', 1, 'RETAINED'], ['variant', 0, 'DISABLE_VARIANT'], ['display', 0, 'DRAFT_ONLY'],
  ]);
  await h.invoke(current.props.onConfirm, current.props.onConfirm);
  assert.equal(h.calls(), 1); assert.deepEqual(h.menu(), [snapshot[1]]); assert.deepEqual(source, snapshot, 'source is never mutated');
}));

test('retained confirmation cannot call the parent after the editor is unmounted', () => harness(async h => {
  await h.invoke(h.remove(2).props.onClick); const old = h.confirmation()!;
  await h.unmount(); await h.invoke(old.props.onConfirm);
  assert.equal(h.calls(), 0); assert.deepEqual(h.menu(), initial());
}));

test('removal feedback follows its accepted draft and clears when the parent restores saved rows', () => harness(async h => {
  const saved = [initial()[0]]; await h.replace(saved);
  await h.invoke(h.node(n => n.type === 'button' && text(n) === '移除分组').props.onClick);
  await h.invoke(h.confirmation()!.props.onConfirm);
  assert.deepEqual(h.menu(), []); assert.equal(h.calls(), 1);
  assert.match(h.status(), /已从当前草稿移除分组/, 'own accepted onChange echo keeps its useful success feedback');
  await h.replace(saved);
  assert.deepEqual(h.menu(), saved); assert.equal(h.calls(), 1, 'external restore never sends another edit');
  assert.ok(h.node(n => n.props['aria-label'] === '本组第 3 项'));
  assert.doesNotMatch(h.status(), /已从当前草稿移除分组/, 'restored rows must not retain a removed-draft success claim');
}));
