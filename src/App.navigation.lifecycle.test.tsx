import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './stores/authStore';
import { apiRequest, clearSession } from './api/session';
import { acceptExplicitLogin, logoutIntent } from './api/logoutIntent';
import { ConfirmationProvider } from './components/Confirmation';
import type { ResourceQuery } from './api/resources';
import { shopStore } from './stores/shop';
import type { BusinessLifecycle } from './utils/businessLifecycle';
import type { ViewId } from './types';
import { blankDraft } from './components/store/storeModel';
import type { StoreItem } from './components/store/types';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; const result = await nextLoad(url, context); if(url.endsWith('/merchantWorkspaceUrl.ts'))return {...result,source:String(result.source).replace('import.meta.env.DEV','false')}; if(url.endsWith('/customerSiteUrl.ts'))return {...result,source:String(result.source).replaceAll('import.meta.env','({})')}; return result; }"), import.meta.url);
const { default: App } = await import('./App');
const { default: StoreManagement } = await import('./components/StoreManagement');

type Node = React.ReactElement<Record<string, any>>;
const clean: BusinessLifecycle = { dirty: false, busy: false, unknown: false };
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

async function harness(initialView: ViewId = 'platform-settings', realHeader = false, realStore = false, initialQuery: ResourceQuery = {}) {
  const keys = ['window', 'document', 'requestAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), oldFetch = globalThis.fetch;
  const listeners = new Map<string, Set<() => unknown>>(), storage = new Map<string, string>();
  const initialParams = new URLSearchParams({ module: initialView, page: '2', pageSize: '50' });
  for (const [key, value] of Object.entries(initialQuery)) if (value !== undefined) initialParams.set(key, String(value));
  const entries = [
    new URL('http://navigation.invalid/admin/?module=help-list&page=3&pageSize=25'),
    new URL('http://navigation.invalid/admin/?module=user-list&page=3&pageSize=25'),
    new URL('http://navigation.invalid/admin/?' + initialParams.toString()),
  ].map((url, index) => ({ url, state: { adminIdentity: 'SUPER_ADMIN:7', adminPosition: index } as unknown }));
  let historyIndex = 2, tree: unknown, confirmation: unknown, appTree: unknown, headerTree: unknown, headerProps: Record<string, any> = {}, logoutRequests = 0, sessionExpired = false;
  let directoryTree: unknown, editorTree: unknown, accountTree: unknown;
  let accountWrite: () => Promise<Response> = async () => Response.json({ message: 'Synthetic uncertain save' }, { status: 503 });
  let finishAccountWrite: (() => void) | undefined;
  let profileWrite: () => Promise<Response> = async () => Response.json({ message: 'Synthetic uncertain profile' }, { status: 503 });
  let finishProfileWrite: (() => void) | undefined;
  const historyWrites: Array<{ kind: 'push' | 'replace'; url: string }> = [];
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  const dispatchPop = () => { for (const handler of [...(listeners.get('popstate') ?? [])]) void handler(); };
  const moveHistory = (kind: 'push' | 'replace', state: unknown, next?: string | URL | null) => {
    const url = next == null ? entries[historyIndex].url : new URL(String(next), entries[historyIndex].url);
    const entry = { url, state };
    if (kind === 'push') { entries.splice(historyIndex + 1); entries.push(entry); historyIndex++; }
    else entries[historyIndex] = entry;
    historyWrites.push({ kind, url: url.href });
  };
  const go = (delta = 0) => {
    const target = historyIndex + delta;
    if (!Number.isInteger(delta) || !delta || target < 0 || target >= entries.length) return;
    // Browsers deliver popstate asynchronously after changing the active entry.
    // Keeping the stack intact makes a destructive replace-based rollback fail.
    queueMicrotask(() => { historyIndex = target; dispatchPop(); });
  };
  const win = {
    document: doc, HTMLIFrameElement: class {}, event: undefined,
    get location() { return entries[historyIndex].url; },
    history: { get state() { return entries[historyIndex].state; }, get length() { return entries.length; }, go, back: () => go(-1), forward: () => go(1), pushState: (state: unknown, _unused: string, next?: string | URL | null) => moveHistory('push', state, next), replaceState: (state: unknown, _unused: string, next?: string | URL | null) => moveHistory('replace', state, next) },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    addEventListener(name: string, listener: () => unknown) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener); },
    removeEventListener(name: string, listener: () => unknown) { listeners.get(name)?.delete(listener); }, scrollTo() {},
  }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; }, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const actor = { id: '7', role: 'ADMIN', name: 'Synthetic navigation administrator' };
  const store: StoreItem = { id: '101', ownerId: '9', name: 'Synthetic shop A', shortName: 'synthetic-shop-a', status: 'APPROVED', timezone: 'America/Chicago', phones: ['+15550123456'], emails: [], businessHours: blankDraft().businessHours, address: '10 Synthetic St', city: 'Chicago', state: 'IL', zipCode: '60601', latitude: null, longitude: null, subtitle: '', gallery: [], about: '', tags: [], priceMenu: [], priceMenuRevision: 'a'.repeat(64), features: { onlineBooking: false, reviews: false, onlinePayment: false, membershipCard: false } };
  globalThis.fetch = async (input, options) => {
    const request = new URL(String(input), 'http://navigation.invalid');
    if (request.pathname.endsWith('/auth/logout')) { logoutRequests++; return Response.json({ ok: true }); }
    if (sessionExpired) return Response.json({ message: 'Unauthorized' }, { status: 401 });
    if (request.pathname.endsWith('/auth/refresh') || request.pathname.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'synthetic-only', user: actor });
    if (request.pathname.endsWith('/auth/me')) return Response.json(actor);
    if (realStore && request.pathname.endsWith('/account-access/admin/shops/101/credentials')) return options?.method === 'PATCH' ? accountWrite() : Response.json({ shopId: '101', userId: '8', email: 'shop@example.invalid', accountStatus: 'SUSPENDED', loginReady: false, password: 'Aa123456', credentialUpdatedAt: null, version: 'a'.repeat(64) });
    if (realStore && request.pathname.endsWith('/studio/stores/101') && options?.method === 'PATCH') return profileWrite();
    if ((realHeader || realStore) && request.pathname.endsWith('/studio/stores')) return Response.json({ items: realStore ? [store] : [{ id: '101', name: 'Synthetic shop A' }, { id: '102', name: 'Synthetic shop B' }], total: realStore ? 100 : 2, page: 2, pageSize: 50 });
    throw new Error('Unexpected navigation harness request: ' + request.pathname);
  };
  // Each harness is a new browser identity, including after a prior real logout.
  // clearSession intentionally preserves an explicit logout in production.
  assert.equal(acceptExplicitLogin(logoutIntent()), true);
  clearSession();
  // Execute the actual App -> Workspace hooks. Capture the JSX at the child
  // boundary so Sidebar/OperationalPage events are real emitted callbacks,
  // without mounting their unrelated tables and DOM widgets.
  function HeaderProbe({ node }: { node: Node }) { headerProps = node.props; headerTree = (node.type as (props: Record<string, any>) => unknown)(node.props); return null; }
  function AccountProbe({ node }: { node: Node }) { accountTree = (node.type as (props: Record<string, any>) => unknown)(node.props); return null; }
  function EditorProbe({ node }: { node: Node }) {
    editorTree = (node.type as (props: Record<string, any>) => unknown)(node.props);
    const account = find(editorTree, candidate => typeof candidate.type === 'function' && candidate.type.name === 'StoreAccountCredentials');
    return account ? <AccountProbe key={account.key} node={account} /> : null;
  }
  function DirectoryProbe({ node }: { node: Node }) {
    // The route is now React.lazy; keep executing the real directory at this boundary.
    directoryTree = StoreManagement(node.props as React.ComponentProps<typeof StoreManagement>);
    const editor = find(directoryTree, candidate => typeof candidate.type === 'function' && candidate.type.name === 'StoreWorkspace');
    return editor ? <EditorProbe key={editor.key} node={editor} /> : null;
  }
  function WorkspaceProbe({ node }: { node: Node }) {
    tree = (node.type as (props: Record<string, any>) => unknown)(node.props);
    const header = realHeader ? find(tree, candidate => typeof candidate.type === 'function' && candidate.type.name === 'Header') : undefined;
    const directory = realStore ? find(tree, candidate => (candidate.type as { displayName?: string }).displayName === 'StoreManagement') : undefined;
    return <>{header && <HeaderProbe node={header} />}{directory && <DirectoryProbe node={directory} />}</>;
  }
  function AppProbe() {
    appTree = App();
    return React.isValidElement(appTree) && typeof appTree.type === 'function' && appTree.type.name === 'Workspace' ? <WorkspaceProbe key={appTree.key} node={appTree as Node} /> : null;
  }
  function SilentConfirmation({ children }: { children: React.ReactNode }) {
    const provider = ConfirmationProvider({ children }); confirmation = provider;
    return React.cloneElement(provider, {}, children);
  }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Node) => boolean, source = tree) => { const node = find(source, predicate); assert.ok(node, 'expected actual App navigation control'); return node; };
  const sidebar = () => control(node => typeof node.type === 'function' && node.type.name === 'Sidebar');
  const operation = () => control(node => (node.type as { displayName?: string }).displayName === 'OperationalPage');
  const dashboard = () => control(node => (node.type as { displayName?: string }).displayName === 'Dashboard');
  await act(async () => { root.render(<AuthProvider><SilentConfirmation><AppProbe /></SilentConfirmation></AuthProvider>); });
  assert.equal(sidebar().props.currentView, initialView, 'the actual signed-in App restores its Workspace from the URL');
  return {
    tree: () => tree, currentView: () => sidebar().props.currentView, href: () => entries[historyIndex].url.href, writes: historyWrites,
    loggedOut: () => React.isValidElement(appTree) && typeof appTree.type === 'function' && appTree.type.name === 'LoginPage', logoutRequests: () => logoutRequests,
    historyEntries: () => entries.map(entry => entry.url.href), historyIndex: () => historyIndex,
    operation, sidebar, dashboard, confirmation: () => find(confirmation, node => node.props.role === 'alertdialog'),
    storeManagement: () => { const node = find(tree, candidate => (candidate.type as { displayName?: string }).displayName === 'StoreManagement'); assert.ok(node, 'expected the real store workspace route'); return node; },
    async lifecycle(value: BusinessLifecycle) { await act(async () => { const callback = operation().props.onLifecycleChange; assert.equal(typeof callback, 'function', 'platform settings must wire its actual lifecycle into Workspace'); callback(value); }); },
    async navigate(view: ViewId) { await act(async () => { sidebar().props.onViewChange(view); }); },
    async navigateFromDashboard(view: ViewId, query: ResourceQuery) { await act(async () => { dashboard().props.onNavigate(view, query); }); },
    async openServiceWorkspace() { await act(async () => { operation().props.onManagePriceMenu(); }); },
    async openOrderAfterSales(canContinue: () => boolean = () => true) {
      await act(async () => { operation().props.onOpenOrderAfterSales({ shopId: '101', bookingId: '42' }, canContinue); });
    },
    afterSales: () => control(node => (node.type as { displayName?: string }).displayName === 'AfterSalesManagement'),
    async configureService(shopId: string, serviceId: string) { await act(async () => { operation().props.onConfigureImportedService(shopId, serviceId); }); },
    async changeStoreScope(shopId: string | null) { assert.equal(realHeader, true); await act(async () => { headerProps.onStoreScopeChange(shopId); }); },
    async settleHeader() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); },
    headerText: () => text(headerTree),
    async openStore() {
      await act(async () => { control(node => node.type === 'button' && text(node).trim() === '编辑门店', directoryTree).props.onClick(); });
      await act(async () => { control(node => node.props.id === 'store-tab-basic', editorTree).props.onClick(); });
    },
    editor: () => editorTree,
    async editStore() { await act(async () => { control(node => node.props.id === 'store-name', editorTree).props.onChange({ target: { value: 'Unsaved synthetic name' } }); }); },
    async accountUnknown() {
      await act(async () => { control(node => node.props.id === 'store-account-password-101', accountTree).props.onChange({ target: { value: 'Changed123' } }); });
      await act(async () => { control(node => node.type === 'button' && text(node).trim() === '保存账号设置', accountTree).props.onClick(); });
      assert.match(text(accountTree), /保存结果尚未确认/);
    },
    async accountBusy() {
      accountWrite = () => new Promise(resolve => { finishAccountWrite = () => resolve(Response.json({ message: 'Synthetic uncertain save' }, { status: 503 })); });
      await act(async () => { control(node => node.props.id === 'store-account-password-101', accountTree).props.onChange({ target: { value: 'Changed123' } }); });
      await act(async () => { control(node => node.type === 'button' && text(node).trim() === '保存账号设置', accountTree).props.onClick(); });
    },
    async finishAccountUnknown() { await act(async () => { finishAccountWrite?.(); }); },
    async saveProfileUnknown() { await act(async () => { const target = {}; void control(node => node.props.id === 'store-workspace-form', editorTree).props.onSubmit({ target, currentTarget: target, preventDefault() {} }); }); assert.match(text(editorTree), /门店资料保存结果未知/); },
    async startProfileAndAcceptLeave() {
      profileWrite = () => new Promise(resolve => { finishProfileWrite = () => resolve(Response.json({ message: 'Synthetic uncertain profile' }, { status: 503 })); });
      await act(async () => {
        const target = {}; void control(node => node.props.id === 'store-workspace-form', editorTree).props.onSubmit({ target, currentTarget: target, preventDefault() {} });
        control(node => node.type === 'button' && text(node).trim() === '丢弃修改并离开', confirmation).props.onClick();
      });
    },
    async finishProfileUnknown() { await act(async () => { finishProfileWrite?.(); }); },
    async pop(view: ViewId) {
      await act(async () => {
        const target = entries.findIndex(entry => entry.url.searchParams.get('module') === view && entry.url.searchParams.get('page') === '3');
        assert.notEqual(target, -1, 'requested test route must be an existing history entry');
        assert.equal(listeners.get('popstate')?.size, 1); go(target - historyIndex);
      });
    },
    async back() { await act(async () => { win.history.back(); }); },
    async forward() { await act(async () => { win.history.forward(); }); },
    async answer(accept: boolean) { await act(async () => { control(node => node.type === 'button' && text(node).trim() === (accept ? '丢弃修改并离开' : '取消'), confirmation).props.onClick(); }); },
    async logout() {
      assert.equal(realHeader, true, 'logout scenarios must execute the actual Header component');
      await act(async () => { control(node => node.props['aria-label'] === '账户菜单', headerTree).props.onClick(); });
      await act(async () => { control(node => node.type === 'button' && text(node).trim() === '退出登录', headerTree).props.onClick(); });
    },
    async expireSession() {
      sessionExpired = true;
      await act(async () => { await assert.rejects(apiRequest('/studio/settings')); });
    },
    async cleanup() {
      await act(async () => root.unmount()); clearSession();
      assert.equal(acceptExplicitLogin(logoutIntent()), true);
      globalThis.fetch = oldFetch;
      keys.forEach((key, index) => { if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!); else Reflect.deleteProperty(globalThis, key); });
    },
  };
}

test('clean platform settings navigate through the real sidebar while other operational pages retain their original navigation', async () => {
  const h = await harness();
  try {
    await h.lifecycle(clean); await h.navigate('user-list');
    assert.equal(h.currentView(), 'user-list'); assert.equal(new URL(h.href()).searchParams.get('module'), 'user-list');
    assert.equal(h.operation().props.onLifecycleChange, undefined, 'the platform-only guard is not attached to another operational page');
    assert.equal(h.confirmation(), undefined);
    await h.navigate('help-list'); assert.equal(h.currentView(), 'help-list'); assert.equal(h.confirmation(), undefined);
    await h.pop('user-list'); assert.equal(h.currentView(), 'user-list'); assert.equal(new URL(h.href()).searchParams.get('page'), '3');
  } finally { await h.cleanup(); }
});

test('dashboard order queues explicitly replace a selected shop with all stores and Back/Forward restore each scope', async () => {
  const h = await harness('dashboard', false, false, { shopId: '29' });
  try {
    assert.equal(shopStore.currentStoreId, '29');
    await h.navigateFromDashboard('service-orders', { status: 'CONFIRMED', shopId: '29' });
    await h.navigate('dashboard');
    assert.equal(new URL(h.href()).searchParams.get('shopId'), '29', 'ordinary navigation carries a concrete shop scope');
    await h.navigateFromDashboard('service-orders', { status: 'CONFIRMED', shopScope: 'ALL' });
    assert.equal(new URL(h.href()).searchParams.get('shopScope'), 'ALL');
    assert.equal(new URL(h.href()).searchParams.has('shopId'), false);
    assert.equal(shopStore.currentStoreId, null, 'the explicit all-stores queue clears the old single-shop filter after approval');
    await h.back();
    assert.equal(h.currentView(), 'dashboard');
    assert.equal(new URL(h.href()).searchParams.get('shopId'), '29');
    assert.equal(shopStore.currentStoreId, '29');
    await h.forward();
    assert.equal(h.currentView(), 'service-orders');
    assert.equal(new URL(h.href()).searchParams.get('shopScope'), 'ALL');
    assert.equal(shopStore.currentStoreId, null);
  } finally { await h.cleanup(); }
});

test('service list actions open the single service and price workspace with the selected service focused', async () => {
  const h = await harness('services', false, true, { shopId: '101' });
  try {
    await h.configureService('101', '303');
    assert.equal(h.currentView(), 'store-list');
    assert.equal(new URL(h.href()).searchParams.get('shopId'), '101');
    assert.deepEqual(h.storeManagement().props.initialBusinessTarget, { tab: 'services', serviceId: '303' });
  } finally { await h.cleanup(); }
});
test('order after-sales navigation rechecks the drawer guard and carries its exact scope until explicitly cleared', async () => {
  const h = await harness('service-orders', true, false, { shopScope: 'ALL', status: 'CONFIRMED' });
  try {
    await h.openOrderAfterSales(() => false);
    assert.equal(h.currentView(), 'service-orders');
    const originalOrders = h.href();
    await h.openOrderAfterSales();
    assert.equal(h.currentView(), 'post-sales');
    assert.deepEqual(h.afterSales().props.initialQuery, { shopId: '101', bookingId: '42' });
    assert.equal(shopStore.currentStoreId, '101');
    const filteredAfterSales = h.href();
    await h.back();
    assert.equal(h.href(), originalOrders);
    assert.equal(shopStore.currentStoreId, null);
    await h.forward();
    assert.equal(h.href(), filteredAfterSales);
    assert.deepEqual(h.afterSales().props.initialQuery, { shopId: '101', bookingId: '42' });
    await act(async () => { h.afterSales().props.onClearOrderFilter(); });
    assert.equal(new URL(h.href()).searchParams.has('bookingId'), false);
    await h.back();
    await h.openOrderAfterSales();
    await h.changeStoreScope('102');
    assert.equal(new URL(h.href()).searchParams.get('shopId'), '102');
    assert.equal(new URL(h.href()).searchParams.has('bookingId'), false);
  } finally { await h.cleanup(); }
});

test('service page management button opens the selected shop workspace', async () => {
  const h = await harness('services', false, true, { shopId: '101' });
  try {
    await h.openServiceWorkspace();
    assert.equal(h.currentView(), 'store-list');
    assert.deepEqual(h.storeManagement().props.initialBusinessTarget, { tab: 'services', serviceId: undefined });
  } finally { await h.cleanup(); }
});

test('Header preserves an explicit all-stores URL on refresh and carries manual scope changes through navigation', async () => {
  const h = await harness('service-orders', true, false, { status: 'CONFIRMED', shopScope: 'ALL' });
  try {
    await h.settleHeader();
    assert.equal(shopStore.currentStoreId, null, 'loading the shop picker must not auto-select the first shop for an explicit ALL URL');
    assert.match(h.headerText(), /全部可管理门店/);
    await h.changeStoreScope('102');
    assert.equal(new URL(h.href()).searchParams.get('shopId'), '102');
    assert.equal(new URL(h.href()).searchParams.has('shopScope'), false);
    assert.equal(shopStore.currentStoreId, '102');
    await h.navigate('help-list');
    assert.equal(new URL(h.href()).searchParams.get('shopId'), '102', 'single-shop context remains explicit when moving to another page');
    assert.equal(shopStore.currentStoreId, '102');
  } finally { await h.cleanup(); }
});

test('cancelling a dirty Header scope change retains the shop; accepting it clears only after confirmation', async () => {
  const h = await harness('store-list', true, true, { shopId: '101' });
  try {
    await h.openStore(); await h.editStore();
    const original = h.href();
    await h.changeStoreScope(null);
    assert.ok(h.confirmation());
    assert.equal(h.href(), original);
    assert.equal(shopStore.currentStoreId, '101');
    await h.answer(false);
    assert.equal(h.href(), original);
    assert.equal(shopStore.currentStoreId, '101');
    await h.changeStoreScope(null);
    assert.ok(h.confirmation());
    await h.answer(true);
    assert.equal(new URL(h.href()).searchParams.get('shopScope'), 'ALL');
    assert.equal(new URL(h.href()).searchParams.has('shopId'), false);
    assert.equal(shopStore.currentStoreId, null);
  } finally { await h.cleanup(); }
});

for (const state of ['busy', 'unknown'] as const) test('platform settings ' + state + ' blocks sidebar and popstate and restores the current URL', async () => {
  const h = await harness();
  try {
    const original = h.href(), capturedNavigate = h.sidebar().props.onViewChange;
    await h.lifecycle({ ...clean, [state]: true });
    await act(async () => { capturedNavigate('user-list'); capturedNavigate('help-list'); });
    assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original); assert.equal(h.confirmation(), undefined);
    assert.match(text(h.tree()), state === 'unknown' ? /保存结果未知/ : /正在处理/);
    await h.pop('user-list');
    assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original); assert.equal(h.confirmation(), undefined);
    await h.lifecycle(clean); await h.navigate('user-list'); assert.equal(h.currentView(), 'user-list', 'resolved lifecycle can navigate normally');
  } finally { await h.cleanup(); }
});

test('dirty platform settings require a real confirmation and cancellation preserves the current page and URL', async () => {
  const h = await harness();
  try {
    const original = h.href(); await h.lifecycle({ ...clean, dirty: true }); await h.navigate('user-list');
    assert.ok(h.confirmation()); assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original);
    await h.answer(false); assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original);
    await h.navigate('help-list'); assert.ok(h.confirmation()); await h.answer(true);
    assert.equal(h.currentView(), 'help-list'); assert.equal(new URL(h.href()).searchParams.get('module'), 'help-list');
  } finally { await h.cleanup(); }
});

test('dirty popstate restores the editor URL while waiting and only applies the captured destination after confirmation', async () => {
  const h = await harness();
  try {
    const original = h.href(); await h.lifecycle({ ...clean, dirty: true }); await h.pop('user-list');
    assert.ok(h.confirmation()); assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original);
    await h.answer(false); assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original);
    await h.pop('help-list'); assert.equal(h.href(), original); await h.answer(true);
    assert.equal(h.currentView(), 'help-list'); assert.equal(new URL(h.href()).searchParams.get('module'), 'help-list');
    assert.equal(new URL(h.href()).searchParams.get('page'), '3');
  } finally { await h.cleanup(); }
});

for (const state of ['busy', 'unknown'] as const) for (const source of ['sidebar', 'popstate'] as const) test('a pending ' + source + ' leave confirmation cannot outlive new platform settings ' + state, async () => {
  const h = await harness();
  try {
    const original = h.href(); await h.lifecycle({ ...clean, dirty: true });
    if (source === 'sidebar') await h.navigate('user-list'); else await h.pop('user-list');
    assert.ok(h.confirmation());
    await h.lifecycle({ ...clean, dirty: true, [state]: true }); await h.answer(true);
    assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original);
    assert.match(text(h.tree()), state === 'unknown' ? /保存结果未知/ : /正在处理/);
    assert.equal(h.confirmation(), undefined);
  } finally { await h.cleanup(); }
});

test('blocked navigation restores the latest settings list query rather than its initial route', async () => {
  const h = await harness();
  try {
    await act(async () => { h.operation().props.onQueryChange({ page: 4, pageSize: 100 }); });
    const latest = h.href(); assert.equal(new URL(latest).searchParams.get('page'), '4');
    await h.lifecycle({ ...clean, busy: true }); await h.navigate('user-list');
    await h.pop('help-list');
    assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), latest, 'a retained settings editor must retain its current list route after a blocked attempt rerenders Workspace');
  } finally { await h.cleanup(); }
});

test('cancelled Back leaves the original destination intact for another Back and permits Forward after an approved departure', async () => {
  const h = await harness();
  try {
    const original = h.href(), entries = h.historyEntries();
    await h.lifecycle({ ...clean, dirty: true }); await h.back();
    assert.ok(h.confirmation()); assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original);
    assert.equal(h.historyIndex(), 2, 'confirmation waits on the active settings entry');
    await h.answer(false);
    assert.deepEqual(h.historyEntries(), entries, 'cancelling must not replace the previous user-list entry with settings');
    await h.back(); assert.ok(h.confirmation()); await h.answer(true);
    assert.equal(h.currentView(), 'user-list'); assert.equal(new URL(h.href()).searchParams.get('page'), '3');
    assert.equal(h.historyIndex(), 1);
    await h.forward();
    assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original); assert.equal(h.historyIndex(), 2);
    assert.deepEqual(h.historyEntries(), entries, 'the approved history traversal preserves both Back and Forward destinations');
  } finally { await h.cleanup(); }
});

test('the actual Header logout preserves a dirty settings draft on cancel and logs out only after acceptance', async () => {
  const h = await harness('platform-settings', true);
  try {
    const original = h.href(); await h.lifecycle({ ...clean, dirty: true }); await h.logout();
    assert.equal(h.logoutRequests(), 0, 'Header must not reach AuthProvider.logout before the settings leave decision');
    assert.equal(h.loggedOut(), false); assert.ok(h.confirmation()); await h.answer(false);
    assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original); assert.equal(h.logoutRequests(), 0);
    await h.logout(); await h.answer(true);
    assert.equal(h.logoutRequests(), 1); assert.equal(h.loggedOut(), true);
  } finally { await h.cleanup(); }
});

for (const state of ['busy', 'unknown'] as const) test('the actual Header logout cannot bypass platform settings ' + state, async () => {
  const h = await harness('platform-settings', true);
  try {
    const original = h.href(); await h.lifecycle({ ...clean, dirty: true, [state]: true }); await h.logout();
    assert.equal(h.logoutRequests(), 0); assert.equal(h.loggedOut(), false); assert.equal(h.currentView(), 'platform-settings'); assert.equal(h.href(), original);
    assert.equal(h.confirmation(), undefined); assert.match(text(h.tree()), state === 'unknown' ? /保存结果未知/ : /正在处理/);
  } finally { await h.cleanup(); }
});

test('Header logout rechecks a new unknown result after its dirty-draft confirmation', async () => {
  const h = await harness('platform-settings', true);
  try {
    await h.lifecycle({ ...clean, dirty: true }); await h.logout(); assert.ok(h.confirmation());
    await h.lifecycle({ ...clean, dirty: true, unknown: true }); await h.answer(true);
    assert.equal(h.logoutRequests(), 0); assert.equal(h.loggedOut(), false); assert.equal(h.currentView(), 'platform-settings'); assert.match(text(h.tree()), /保存结果未知/);
  } finally { await h.cleanup(); }
});

test('Header logout cannot interrupt a pending settings history decision', async () => {
  const h = await harness('platform-settings', true);
  try {
    const original = h.href(); await h.lifecycle({ ...clean, dirty: true }); await h.back(); assert.ok(h.confirmation());
    await h.logout(); assert.equal(h.logoutRequests(), 0); assert.equal(h.loggedOut(), false); assert.ok(h.confirmation());
    await h.answer(false); assert.equal(h.href(), original); assert.equal(h.currentView(), 'platform-settings');
  } finally { await h.cleanup(); }
});

for (const view of ['platform-settings', 'user-list'] as const) test('the actual Header still logs out normally from clean ' + view, async () => {
  const h = await harness(view, true);
  try {
    if (view === 'platform-settings') await h.lifecycle(clean);
    await h.logout(); assert.equal(h.logoutRequests(), 1); assert.equal(h.loggedOut(), true); assert.equal(h.confirmation(), undefined);
  } finally { await h.cleanup(); }
});

test('a genuine rejected refresh still clears an unknown settings session immediately', async () => {
  const h = await harness('platform-settings', true);
  try {
    await h.lifecycle({ ...clean, dirty: true, unknown: true }); await h.expireSession();
    assert.equal(h.loggedOut(), true); assert.equal(h.logoutRequests(), 0); assert.equal(h.confirmation(), undefined);
  } finally { await h.cleanup(); }
});

for (const source of ['sidebar', 'popstate', 'logout'] as const) test('actual store workspace dirty draft survives cancelled ' + source + ' and can leave after acceptance', async () => {
  const h = await harness('store-list', true, true);
  try {
    await h.openStore(); await h.editStore(); const original = h.href();
    const leave = () => source === 'sidebar' ? h.navigate('user-list') : source === 'popstate' ? h.back() : h.logout();
    await leave(); assert.ok(h.confirmation(), 'real StoreWorkspace state must reach the actual App guard');
    assert.equal(h.href(), original); assert.equal(h.logoutRequests(), 0); await h.answer(false);
    assert.equal(h.currentView(), 'store-list'); assert.match(text(h.editor()), /有未保存的修改/);
    await leave(); await h.answer(true);
    if (source === 'logout') assert.equal(h.loggedOut(), true); else assert.equal(h.currentView(), 'user-list');
  } finally { await h.cleanup(); }
});

for (const state of ['busy', 'unknown'] as const) test('actual account ' + state + ' blocks store sidebar, Back and Header logout', async () => {
  const h = await harness('store-list', true, true);
  try {
    await h.openStore(); if (state === 'busy') await h.accountBusy(); else await h.accountUnknown();
    const original = h.href(); await h.navigate('user-list'); await h.back(); await h.logout();
    assert.equal(h.currentView(), 'store-list'); assert.equal(h.href(), original); assert.equal(h.logoutRequests(), 0); assert.equal(h.confirmation(), undefined);
    assert.match(text(h.tree()), state === 'unknown' ? /保存结果未知/ : /正在处理/);
    if (state === 'busy') await h.finishAccountUnknown();
  } finally { await h.cleanup(); }
});

test('store navigation confirmation rechecks a newly unknown account save and 401 still expires immediately', async () => {
  const h = await harness('store-list', true, true);
  try {
    await h.openStore(); await h.editStore(); const original = h.href(); await h.back(); assert.ok(h.confirmation());
    await h.accountUnknown(); await h.answer(true);
    assert.equal(h.currentView(), 'store-list'); assert.equal(h.href(), original); assert.equal(h.logoutRequests(), 0);
    await h.expireSession(); assert.equal(h.loggedOut(), true); assert.equal(h.confirmation(), undefined);
  } finally { await h.cleanup(); }
});

test('unknown actual profile save blocks sidebar, Back and Header logout without losing its reconciliation panel', async () => {
  const h = await harness('store-list', true, true);
  try {
    await h.openStore(); await h.editStore(); await h.saveProfileUnknown(); const original = h.href();
    await h.navigate('user-list'); await h.back(); await h.logout();
    assert.equal(h.currentView(), 'store-list'); assert.equal(h.href(), original); assert.equal(h.logoutRequests(), 0); assert.equal(h.confirmation(), undefined);
    assert.match(text(h.editor()), /只读核对保存结果/);
  } finally { await h.cleanup(); }
});

test('accepting Header leave in the same turn as a profile request reads its synchronous busy lock', async () => {
  const h = await harness('store-list', true, true);
  try {
    await h.openStore(); await h.editStore(); await h.logout(); assert.ok(h.confirmation());
    await h.startProfileAndAcceptLeave(); assert.equal(h.logoutRequests(), 0); assert.equal(h.currentView(), 'store-list');
    await h.finishProfileUnknown(); assert.match(text(h.editor()), /门店资料保存结果未知/);
  } finally { await h.cleanup(); }
});
