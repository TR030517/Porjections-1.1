import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import { blankDraft } from './storeModel';
import type { StoreItem } from './types';
import type { BusinessLifecycle } from '../../utils/businessLifecycle';
import type { ServiceWorkspaceApi, StoreServiceWorkspaceProps, WorkspaceCommand, WorkspaceSnapshot } from '../../types/serviceWorkspace';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreWorkspace } = await import('./StoreWorkspace');
const { default: StoreServiceWorkspace } = await import('./StoreServiceWorkspace');
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
const item: StoreItem = {
  id: '5', ownerId: '9', name: 'Synthetic store', shortName: 'synthetic-store', subtitle: '', status: 'PENDING', timezone: 'America/Chicago',
  phones: [], emails: [], businessHours: blankDraft().businessHours, address: 'Synthetic street', city: 'Synthetic', state: 'NY', zipCode: '',
  latitude: null, longitude: null, gallery: [], about: '', tags: [], priceMenu: [{ category: 'Synthetic', items: [{ id: 'one', name: 'Synthetic service', priceText: '$40' }] }], priceMenuRevision: 'a'.repeat(64),
  features: { onlineBooking: false, reviews: false, onlinePayment: false, membershipCard: false },
};

for (const blocked of ['dirty', 'busy', 'unknown'] as const) test(`unified ${blocked} service draft blocks retained removal, parent saves and section changes without replacing the menu`, async () => {
  const keys = ['window', 'document', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const previousFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, sessionStorage, requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; }, cancelAnimationFrame() {}, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic admin' };
  const writes: Record<string, unknown>[] = [], commands: WorkspaceCommand[] = [], saved: StoreItem[] = [];
  let rejectSave!: (reason: unknown) => void;
  const pendingSave = new Promise<never>((_resolve, reject) => { rejectSave = reject; });
  const baseline: WorkspaceSnapshot = { shopId: String(item.id), service: null, priceMenu: structuredClone(item.priceMenu), priceMenuRevision: item.priceMenuRevision!, selectionRevision: null, canManageCatalog: true, canConfigurePolicy: true };
  const api: ServiceWorkspaceApi = {
    loadCatalog: async query => ({ ...query, shopId: item.id, items: [], total: 0, hasMore: false, canManageCatalog: true, canConfigurePolicy: true }),
    loadSnapshot: async () => structuredClone(baseline),
    save: async command => {
      assert.ok(storage.size > 0, 'the command is journaled before it can leave the child');
      commands.push(structuredClone(command));
      if (command.action === 'REMOVE_MENU_DISPLAY') throw Object.assign(Error('Synthetic removal rejected'), { status: 409 });
      if (blocked === 'busy') return pendingSave;
      throw Object.assign(Error('Synthetic reply lost'), { status: 503 });
    },
    readReceipt: async () => { throw Object.assign(Error('Synthetic receipt missing'), { status: 404 }); },
    reconcile: async key => ({ operationId: 'synthetic-reconciliation', action: null, shopId: item.id, idempotencyKey: key, outcome: 'NOT_EXECUTED', serviceId: null, idMap: { variants: {}, addOns: {}, displays: {} }, priceMenuRevision: baseline.priceMenuRevision, selectionRevision: null, requiredPermissions: [], changes: { serviceFields: [], policyFields: [], variantIds: [], addOnIds: [], displayIds: [], layout: false }, warnings: [] }),
  };
  globalThis.fetch = async (input, options) => {
    if (String(input).endsWith('/auth/refresh') || String(input).endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (String(input).endsWith('/auth/me')) return Response.json(identity);
    assert.match(String(input), /\/studio\/stores\/5$/); assert.equal(options?.method, 'PATCH');
    const body = JSON.parse(String(options?.body)); writes.push(body);
    return Response.json({ item: { ...item, ...body } });
  };
  clearSession();
  let tree: unknown, serviceTree: unknown, lifecycle: BusinessLifecycle = { dirty: false, busy: false, unknown: false }, childLifecycle = lifecycle;
  let forwardLifecycle: StoreServiceWorkspaceProps['onLifecycleChange'];
  const childChanged = (value: BusinessLifecycle) => { childLifecycle = value; forwardLifecycle(value); };
  function ServiceProbe(props: StoreServiceWorkspaceProps) { forwardLifecycle = props.onLifecycleChange; serviceTree = StoreServiceWorkspace({ ...props, api, onLifecycleChange: childChanged }); return null; }
  function Probe() {
    tree = StoreWorkspace({ item, initialSection: 'basic', isStoreManager: false, onClose() {}, onSaved: value => saved.push(value), onLifecycleChange: value => { lifecycle = value; } });
    const service = find(tree, node => node.type === StoreServiceWorkspace);
    return service ? <ServiceProbe {...service.props as StoreServiceWorkspaceProps} /> : null;
  }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Node) => boolean, source = tree) => { const result = find(source, predicate); assert.ok(result, 'expected current workspace control exists'); return result; };
  const serviceButton = (label: string) => control(node => node.type === 'button' && text(node).trim() === label, serviceTree);
  const field = (label: string) => control(node => node.type === 'input', control(node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === label, serviceTree).props.children);
  const remove = () => control(node => typeof node.type === 'function' && node.type.name === 'StoreLegacyProjectRepair', serviceTree).props.onRemove;
  const click = (label: string) => act(async () => { serviceButton(label).props.onClick(); });
  const formSubmit = () => control(node => node.props.id === 'store-workspace-form').props.onSubmit;
  const submit = (handler = formSubmit()) => act(async () => { const target = {}; void handler({ target, currentTarget: target, preventDefault() {} }); });
  try {
    await act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
    await act(async () => { control(node => node.props.id === 'store-name').props.onChange({ target: { value: 'Retained profile draft' } }); });
    const retainedSubmit = formSubmit();
    await act(async () => { control(node => node.props.role === 'tab' && text(node).trim() === '服务与价格').props.onClick(); });
    assert.equal(find(tree, node => typeof node.type === 'function' && ['StoreMenuCatalogEditor', 'StoreUnifiedProjects'].includes(node.type.name)), undefined, 'retired whole-menu paste/replacement surfaces are not mounted');
    const staleRemove = remove();
    await click('编辑展示文字');
    await act(async () => { field('标题').props.onChange({ target: { value: 'Retained service draft' } }); });
    if (blocked !== 'dirty') await click('保存展示文字');
    assert.equal(childLifecycle[blocked], true, 'the actual child enters the protected state');
    assert.equal(lifecycle[blocked], true, 'the actual child lifecycle reaches the parent');
    const beforeCommands = commands.length;
    await act(async () => { staleRemove('one'); remove()('one'); });
    assert.equal(find(serviceTree, node => node.props.label === '确认永久移除展示位置'), undefined, 'a stale or current removal cannot silently discard the protected draft');
    if (blocked === 'dirty') { assert.match(text(serviceTree), /有未保存修改/); await click('继续编辑'); }
    await submit(retainedSubmit); await submit();
    await act(async () => { control(node => node.props.id === 'store-tab-basic').props.onClick(); control(node => node.props.id === 'store-tab-business').props.onClick(); });
    assert.equal(control(node => node.props.id === 'store-tab-price-menu').props['aria-selected'], true, 'parent section changes cannot unmount a protected editor');
    assert.equal(field('标题').props.value, 'Retained service draft');
    assert.equal(commands.length, beforeCommands, 'protected removal and parent submit send no extra command');
    assert.deepEqual(writes, [], 'parent profile save cannot replace or persist a child menu draft');
    assert.deepEqual(baseline.priceMenu, item.priceMenu);

    if (blocked === 'busy') await act(async () => { rejectSave(Object.assign(Error('Synthetic definitive rejection'), { status: 409 })); });
    if (blocked === 'unknown') await click('核对并封存未执行操作');
    assert.equal(lifecycle.unknown, false); assert.equal(lifecycle.busy, false);
    await click('放弃本次修改'); await click('放弃修改并继续');
    await act(async () => { remove()('one'); });
    await click('确认永久移除');
    const removal = commands.at(-1);
    assert.ok(removal?.action === 'REMOVE_MENU_DISPLAY', 'after explicit draft resolution, current removal uses its own command');
    assert.equal(removal.itemId, 'one');
    assert.equal(storage.size, 0, 'definitive rejection or reconciliation clears the operation journal');
    await act(async () => { control(node => node.props.id === 'store-tab-basic').props.onClick(); });
    assert.equal(control(node => node.props.id === 'store-name').props.value, 'Retained profile draft');
    await submit();
    assert.equal(writes.length, 1); assert.equal(saved.length, 1);
    assert.equal(Object.hasOwn(writes[0], 'priceMenu'), false, 'profile save never falls back to a whole-menu replacement');
    assert.equal(Object.hasOwn(writes[0], 'expectedPriceMenuRevision'), false);
    assert.deepEqual(saved[0].priceMenu, item.priceMenu, 'rejected child removal leaves the saved menu intact');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});
