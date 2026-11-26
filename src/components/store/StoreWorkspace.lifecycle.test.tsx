import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import { blankDraft, WEEKDAYS } from './storeModel';
import type { StoreItem } from './types';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreWorkspace } = await import('./StoreWorkspace');
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
const store = (id: string, timezone = 'America/Chicago'): StoreItem => ({
  id, ownerId: '9', name: `Synthetic store ${id}`, shortName: `synthetic-store-${id}`, subtitle: '', status: 'PENDING', timezone,
  phones: [], emails: [], businessHours: blankDraft().businessHours, address: '1207 S Jackson St', city: 'Seattle', state: 'WA', zipCode: '98144',
  latitude: null, longitude: null, gallery: [], about: '', tags: [], priceMenu: [], priceMenuRevision: 'a'.repeat(64),
  features: { onlineBooking: false, reviews: false, onlinePayment: false, membershipCard: false },
});

test('workspace saves retain failed drafts and manual zones, and cannot reopen a previous shop from a late receipt', async () => {
  const keys = ['window', 'document', 'requestAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; }, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic store admin' };
  let current: StoreItem | null = store('5'), tree: unknown;
  const saved: StoreItem[] = [], writes: { path: string; body: Record<string, unknown> }[] = [];
  let response: (body: Record<string, unknown>) => Promise<Response> = async () => Response.json({ message: 'A record with that unique value already exists' }, { status: 409 });
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    assert.match(path, /\/studio\/stores(?:\/5)?$/);
    assert.ok(options?.method === 'PATCH' || options?.method === 'POST');
    const body = JSON.parse(String(options.body)); writes.push({ path, body }); return response(body);
  };
  clearSession();
  function Probe() { tree = StoreWorkspace({ item: current, initialSection: 'basic', isStoreManager: false, onClose() {}, onSaved: value => { saved.push(value); } }); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe key={current?.id ?? 'new'} /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const control = (predicate: (node: Node) => boolean) => { const value = find(tree, predicate); assert.ok(value, 'expected workspace control exists'); return value; };
  const input = (id: string) => control(node => node.type === 'input' && node.props.id === id);
  const component = (name: string) => control(node => typeof node.type === 'function' && node.type.name === name);
  const change = (id: string, value: string) => act(async () => { input(id).props.onChange({ target: { value } }); });
  const submit = () => act(async () => { const form = control(node => node.props.id === 'store-workspace-form'); const target = {}; void form.props.onSubmit({ target, currentTarget: target, preventDefault() {} }); });
  try {
    await render();
    await change('store-name', 'Previous unsaved profile');
    const previousDraftSubmit = control(node => node.props.id === 'store-workspace-form').props.onSubmit;
    await change('store-name', 'Latest unsaved profile');
    await act(async () => { const target = {}; void previousDraftSubmit({ target, currentTarget: target, preventDefault() {} }); });
    assert.equal(writes.length, 0, 'a callback retained before a newer profile edit cannot save the superseded draft');
    assert.equal(input('store-name').props.value, 'Latest unsaved profile');
    const openService = async (serviceId?: string) => {
      await act(async () => { control(node => node.props.id === 'store-tab-review').props.onClick(); });
      await act(async () => { component('StoreReadiness').props.onAction(serviceId ? { kind: 'reservation', tab: 'services', serviceId } : { kind: 'services' }); });
    };
    await openService('7');
    assert.equal(control(node => node.props.id === 'store-tab-price-menu').props['aria-selected'], true);
    assert.deepEqual(component('StoreServiceWorkspace').props.focus, { serviceId: '7', pane: 'booking', revision: 1 });
    assert.equal(find(tree, node => typeof node.type === 'function' && ['StoreUnifiedProjects', 'StoreMenuCatalogEditor'].includes(node.type.name)), undefined, 'the service editor is the single current entry, not either retired editor');
    await openService('7');
    assert.equal(component('StoreServiceWorkspace').props.focus.revision, 2, 'reopening the same service is a new focus request');
    await openService('8');
    assert.deepEqual(component('StoreServiceWorkspace').props.focus, { serviceId: '8', pane: 'booking', revision: 3 }, 'another service replaces the former source target');
    await openService();
    assert.equal(component('StoreServiceWorkspace').props.focus, undefined, 'opening the full service list clears the previous service target');
    await act(async () => { control(node => node.props.id === 'store-tab-basic').props.onClick(); });
    await change('store-name', 'Edited synthetic store');
    await submit();
    assert.equal(saved.length, 0); assert.equal(input('store-name').props.value, 'Edited synthetic store');
    assert.match(text(tree), /门店短链已被使用/);
    await act(async () => { component('StoreAddressAutocomplete').props.onChange({ address: '500 Synthetic St', city: 'New York', state: 'NY', zipCode: '10001' }); });
    assert.equal(component('StoreTimezonePicker').props.value, 'America/Chicago', 'a saved manual exception survives location changes');
    const pending = deferred<Response>(); response = async () => pending.promise;
    await submit();
    assert.equal(writes.at(-1)?.body.timezone, 'America/Chicago', 'location patches explicitly retain the saved manual zone');
    const previousSubmit = control(node => node.props.id === 'store-workspace-form').props.onSubmit;
    current = store('6', 'Pacific/Honolulu'); await render();
    assert.equal(input('store-name').props.value, 'Synthetic store 6');
    await act(async () => { pending.resolve(Response.json({ item: { ...store('5'), name: 'Edited synthetic store', city: 'New York', state: 'NY', zipCode: '10001' } })); });
    assert.equal(saved.length, 0, 'a previous shop receipt cannot call the parent and reopen that workspace');
    assert.equal(input('store-name').props.value, 'Synthetic store 6');
    const requests = writes.length;
    await act(async () => { const target = {}; void previousSubmit({ target, currentTarget: target, preventDefault() {} }); });
    assert.equal(writes.length, requests, 'retired form callbacks cannot write to the old shop');

    await act(async () => { component('StoreTimezonePicker').props.onChange('America/Denver'); component('StoreAddressAutocomplete').props.onChange({ address: '500 Synthetic St', city: 'New York', state: 'NY', zipCode: '10001' }); });
    assert.equal(component('StoreTimezonePicker').props.value, 'America/Denver', 'a manual selection stays fixed while editing the address');
    await act(async () => { control(node => node.type === 'button' && text(node).trim() === '按地址重新匹配').props.onClick(); });
    assert.equal(component('StoreTimezonePicker').props.value, 'America/New_York');
    await act(async () => { component('StoreAddressAutocomplete').props.onChange({ address: '1207 S Jackson St', city: 'Seattle', state: 'WA', zipCode: '98144' }); });
    assert.equal(component('StoreTimezonePicker').props.value, 'America/Los_Angeles', 'explicit rematch restores automatic matching for the current draft');

    current = null; await render();
    await change('store-name', 'New synthetic store'); await change('store-shortName', 'new-synthetic-store');
    await act(async () => { component('ResourcePicker').props.onChange('9'); component('StoreAddressAutocomplete').props.onChange({ address: '1207 S Jackson St', city: 'Seattle', state: 'WA', zipCode: '98144' }); });
    assert.equal(component('StoreTimezonePicker').props.value, 'America/Los_Angeles');
    response = async body => Response.json({ item: { ...store('8', String(body.timezone)), ...body, priceMenu: [], priceMenuRevision: 'b'.repeat(64) } });
    await submit();
    assert.equal(saved.length, 1); assert.equal(saved[0].timezone, 'America/Los_Angeles');
    assert.match(writes.at(-1)!.path, /\/stores$/);
    const hours = writes.at(-1)!.body.businessHours as StoreItem['businessHours'];
    assert.deepEqual(Object.keys(hours), WEEKDAYS);
    for (const day of WEEKDAYS) assert.deepEqual(hours[day], { open: true, start: '09:00', end: '22:00' });
    assert.equal(saved[0].status, 'PENDING', 'new stores keep the existing publication workflow');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});
