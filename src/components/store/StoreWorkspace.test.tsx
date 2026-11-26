import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import { emptyHours } from './storeModel';
import type { StoreItem } from './types';
import type { ServiceWorkspaceApi, StoreServiceWorkspaceProps } from '../../types/serviceWorkspace';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreWorkspace, workspaceSectionBlock, workspaceUnknownTarget } = await import('./StoreWorkspace');
const { default: StoreServiceWorkspace } = await import('./StoreServiceWorkspace');
const { syncUnifiedProjectSelection } = await import('./StoreUnifiedProjects');
const store: StoreItem = { id: '9007199254740993', ownerId: '7', name: 'Sample Studio', shortName: 'sample-studio', subtitle: '', status: 'PENDING', timezone: 'America/New_York', phones: [], emails: [], businessHours: emptyHours(), address: '', city: '', state: '', zipCode: '', latitude: null, longitude: null, gallery: [], about: '', tags: [], priceMenu: [], priceMenuRevision: 'a'.repeat(64), features: { onlineBooking: true, reviews: true, onlinePayment: false, membershipCard: false } };

test('unified service search is outside the profile form and Enter or bubbled submit cannot save a dirty profile', async () => {
  const html = renderToStaticMarkup(<AuthProvider><StoreWorkspace item={store} isStoreManager={false} onClose={() => {}} onSaved={() => {}} initialSection="price-menu" /></AuthProvider>);
  let depth = 0, forms = 0;
  for (const token of html.matchAll(/<form\b|<\/form>/g)) { if (token[0] === '</form>') depth--; else { depth++; forms++; } assert.ok(depth >= 0 && depth <= 1, 'forms must never nest'); }
  assert.equal(depth, 0); assert.equal(forms, 1, 'the removed duplicate service CRUD form must not be rendered beside the price editor');
  assert.match(html, /id="store-workspace-form"/);
  assert.ok(html.indexOf('class="service-workspace ') > html.indexOf('</form>'), 'the actual unified editor renders after the profile form closes');
  assert.match(html, /当前服务、分组与顺序分别在本页明确保存/);
  assert.doesNotMatch(html.slice(html.indexOf('<footer class="store-studio-footer"')), /保存门店资料|type="submit"/, 'the service section cannot expose a profile save button');
  assert.doesNotMatch(html, /从这里进入的列表|自动选择当前门店/);

  type Node = React.ReactElement<Record<string, any>>;
  const find = (tree: unknown, predicate: (node: Node) => boolean): Node | undefined => {
    if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
    if (!React.isValidElement(tree)) return;
    const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
  };
  const keys = ['window', 'document', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage }; doc.defaultView = win;
  class Input {}
  for (const [key, value] of Object.entries({ window: win, document: doc, sessionStorage, requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 1; }, cancelAnimationFrame() {}, HTMLInputElement: Input, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const actor = { id: '7', role: 'ADMIN', name: 'Synthetic search administrator' }, queries: string[] = [], writes: string[] = [];
  const api: ServiceWorkspaceApi = {
    loadCatalog: async query => { queries.push(query.search); return { ...query, shopId: store.id, items: [], total: 0, hasMore: false, canManageCatalog: true, canConfigurePolicy: true }; },
    loadSnapshot: async () => ({ shopId: store.id, service: null, priceMenu: [], priceMenuRevision: store.priceMenuRevision, selectionRevision: null, canManageCatalog: true, canConfigurePolicy: true }),
    save: async () => { writes.push('service command'); throw Error('search cannot write'); },
    readReceipt: async () => { throw Error('search cannot reconcile'); }, reconcile: async () => { throw Error('search cannot reconcile'); },
  };
  globalThis.fetch = async (input, options) => {
    if (String(input).endsWith('/auth/refresh') || String(input).endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'synthetic-search-only', user: actor });
    if (String(input).endsWith('/auth/me')) return Response.json(actor);
    writes.push(String(options?.method) + ' ' + String(input)); throw Error('search cannot save profile');
  };
  let tree: unknown, serviceTree: unknown;
  function ServiceProbe(props: StoreServiceWorkspaceProps) { serviceTree = StoreServiceWorkspace({ ...props, api }); return null; }
  function Probe() {
    tree = StoreWorkspace({ item: store, initialSection: 'basic', isStoreManager: false, onClose() {}, onSaved() {} });
    const child = find(tree, node => node.type === StoreServiceWorkspace);
    return child ? <ServiceProbe {...child.props as StoreServiceWorkspaceProps} /> : null;
  }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Node) => boolean, source = tree) => { const node = find(source, predicate); assert.ok(node, 'expected current workspace control'); return node; };
  try {
    clearSession();
    await act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
    await act(async () => { control(node => node.props.id === 'store-name').props.onChange({ target: { value: 'Must remain an unsaved profile' } }); });
    const profileSubmit = control(node => node.props.id === 'store-workspace-form').props.onSubmit;
    await act(async () => { control(node => node.props.id === 'store-tab-price-menu').props.onClick(); });
    const searchField = control(node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === '搜索服务', serviceTree);
    await act(async () => { control(node => node.type === 'input', searchField.props.children).props.onChange({ target: { value: 'Synthetic search' } }); });
    const searchRoot = control(node => node.type === 'div' && typeof node.props.onKeyDown === 'function', serviceTree);
    const queryCount = queries.length;
    let prevented = false, stopped = false;
    await act(async () => { searchRoot.props.onKeyDown({ key: 'Enter', target: new Input(), preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); });
    assert.equal(prevented, true); assert.equal(stopped, true, 'Enter cannot escape the current service editor');
    await act(async () => { void profileSubmit({ target: new Input(), currentTarget: {}, preventDefault() { throw Error('a sibling submit does not belong to the profile form'); } }); });
    assert.deepEqual(writes, [], 'a retained dirty-profile callback also rejects an unrelated submit target');
    assert.equal(queries.length, queryCount, 'Enter does not silently start a search or a save');
    const query = control(node => node.type === 'button' && node.props.children === '查询', serviceTree);
    assert.equal(query.props.type, 'button', 'explicit search is not a form submit');
    await act(async () => { query.props.onClick(); });
    assert.equal(queries.at(-1), 'Synthetic search', 'the explicit search button still performs the read');
    assert.deepEqual(writes, []);
    await act(async () => { control(node => node.props.id === 'store-tab-basic').props.onClick(); });
    assert.equal(control(node => node.props.id === 'store-name').props.value, 'Must remain an unsaved profile', 'the profile draft survives search unchanged');
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});

test('editing a store omits manual coordinates and brand text while retaining the unified menu entry', () => {
  const html = renderToStaticMarkup(<AuthProvider><StoreWorkspace item={store} isStoreManager={false} onClose={() => {}} onSaved={() => {}} /></AuthProvider>);
  assert.doesNotMatch(html, /store-latitude|store-longitude|store-logo"|文字标识/);
  assert.match(html, /服务与价格/);
});

test('store editing uses the same explicit binding status as the list and never assumes a legacy owner is unbound', () => {
  const unknown = renderToStaticMarkup(<AuthProvider><StoreWorkspace initialSection="basic" item={{ ...store, sysAccount: 'legacy-owner' }} isStoreManager={false} onClose={() => {}} onSaved={() => {}} /></AuthProvider>);
  assert.match(unknown, /独立登录账号：登录绑定待核对/); assert.doesNotMatch(unknown, /独立登录账号：legacy-owner|独立登录账号：待绑定/);
  const deleted = renderToStaticMarkup(<AuthProvider><StoreWorkspace initialSection="basic" item={{ ...store, accountBindingStatus: 'BOUND', loginBinding: { shopId: String(store.id), userId: '12' }, loginAccount: { id: '12', loginName: 'store-login', status: 'DELETED' } }} isStoreManager={false} onClose={() => {}} onSaved={() => {}} /></AuthProvider>);
  assert.match(deleted, /独立登录账号：已绑定 · store-login · 账号已删除/); assert.doesNotMatch(deleted, /账号已停用/);
});

test('an unfinished project cannot enter sibling business resources and an unknown project keeps its own recovery entry', () => {
  const clean = { dirty: false, busy: false, unknown: false };
  for (const project of [{ ...clean, dirty: true }, { ...clean, busy: true }, { ...clean, unknown: true }]) {
    assert.equal(workspaceSectionBlock('price-menu', 'business', project, clean), 'project', 'a sibling resource save could reload and erase this project draft');
    assert.equal(workspaceSectionBlock('price-menu', 'hours', project, clean), 'project');
  }
  assert.equal(workspaceSectionBlock('price-menu', 'business', clean, clean), null);
  assert.equal(workspaceSectionBlock('business', 'business', clean, { ...clean, dirty: true }), null, 'remaining in the current business section does not discard its form');
  assert.equal(workspaceSectionBlock('business', 'price-menu', clean, { ...clean, dirty: true }), 'business');
  assert.equal(workspaceUnknownTarget({ ...clean, unknown: true }), 'price-menu', 'project reconciliation must stay in the visible inventory, not hidden behind business resources');
  assert.equal(workspaceUnknownTarget(clean), 'business');
});

test('inventory selection synchronizes the workspace target so returning from A through B can focus A again', () => {
  const a = '9007199254740993', b = '9007199254740994';
  let local = a, workspace = a;
  const selectLocal = (id: string) => { local = id; };
  const selectWorkspace = (id: string) => { workspace = id; };
  syncUnifiedProjectSelection(b, selectLocal, selectWorkspace);
  assert.equal(local, b); assert.equal(workspace, b, 'the inventory cannot leave the parent target stuck at A');
  const previousRequest = workspace;
  selectWorkspace(a);
  assert.notEqual(workspace, previousRequest, 'reopening A must change the selectedServiceId prop from B to A');
  syncUnifiedProjectSelection(a, selectLocal, selectWorkspace);
  assert.equal(local, a); assert.equal(workspace, a);
});


test('saved store opens the existing readiness first while new stores still begin with basic details', () => {
  const props = {isStoreManager:false,onClose(){},onSaved(){}};
  const saved = renderToStaticMarkup(<AuthProvider><StoreWorkspace {...props} item={store} /></AuthProvider>);
  assert.match(saved, /id="store-tab-review"[^>]*aria-selected="true"/);
  assert.ok(saved.indexOf('id="store-tab-review"') < saved.indexOf('id="store-tab-basic"'));
  assert.match(saved, /营业准备检查/);
  const footer=saved.slice(saved.indexOf('<footer class="store-studio-footer"'));
  assert.match(footer,/此按钮仅保存门店基本资料、品牌及营业设置；服务与价格在统一编辑区保存/);
  assert.match(footer,/type="submit" form="store-workspace-form"/,'the profile footer targets only the profile form');
  assert.doesNotMatch(footer,/class="[^"]*(?:\bhidden\b|sm:block)/,'save scope is visible on narrow screens too');
  const fresh=renderToStaticMarkup(<AuthProvider><StoreWorkspace {...props} item={null} /></AuthProvider>);
  assert.match(fresh,/id="store-tab-basic"[^>]*aria-selected="true"/);
  assert.doesNotMatch(fresh,/正在检查已保存配置/);
});
