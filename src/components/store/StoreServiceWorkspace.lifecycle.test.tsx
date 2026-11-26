import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BusinessLifecycle } from '../../utils/businessLifecycle';
import type { MediaDraftTransport, StagedMedia } from '../../utils/mediaDraft';
import type { ProjectCatalogItem } from '../../utils/projectCatalog';
import type { ServiceWorkspaceApi, StoreServiceWorkspaceProps, WorkspaceCommand, WorkspaceReceipt, WorkspaceSnapshot } from '../../types/serviceWorkspace';
import { buildWorkspaceCommand, readWorkspaceSnapshot, workspaceCents, workspaceDraft, workspaceHasChanges } from '../../utils/serviceWorkspace';
import { workspaceProfileMenu } from '../../utils/serviceWorkspaceProfile';
import { LegacyAssociationReview } from './StoreLegacyProjectRepair';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreServiceWorkspace } = await import('./StoreServiceWorkspace');

const initialRevision = 'a'.repeat(64), committedRevision = 'b'.repeat(64), selectedRevision = 'c'.repeat(64);
type Node = React.ReactElement<Record<string, any>>;
function findAll(tree: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(child => findAll(child, predicate));
  if (!React.isValidElement(tree)) return [];
  const node = tree as Node;
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children, predicate)];
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function service(shopId = '5'): ProjectCatalogItem {
  return { id: '81', shopId, name: 'Synthetic massage', nameEn: null, description: 'Original description', category: 'MASSAGE', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 8000, priceBasis: 'PER_SESSION', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, hasVariants: true, variantCount: 1, addOnCount: 0, selectionRevision: selectedRevision, preview: null,
    variants: [{ id: '91', serviceId: '81', name: 'Standard', durationMin: 60, priceCents: 8000, priceBasis: 'PER_SESSION', currency: 'USD', isActive: true, sortOrder: 0, preview: null }], addOns: [] };
}
function snapshot(shopId = '5', selected = false): WorkspaceSnapshot {
  return { shopId, service: selected ? service(shopId) : null, priceMenuRevision: initialRevision, selectionRevision: selected ? selectedRevision : null, canManageCatalog: true, canConfigurePolicy: true,
    priceMenu: [{ category: 'Body', items: [{ id: 'display-a', name: 'Keep my custom title', priceText: '', description: 'Keep this copy', imageUrl: 'https://example.invalid/a.webp', isVisible: true, booking: { serviceId: '81', variantId: '91' }, pricing: { kind: 'TIMED', baseName: 'Synthetic massage', durationMin: 60, priceCents: 8000, titleMode: 'CUSTOM' } }] }, { category: 'Specials', items: [{ id: 'display-b', name: 'Keep my second title', priceText: '', isVisible: false, booking: { serviceId: '81', variantId: '91' }, pricing: { kind: 'TIMED', baseName: 'Synthetic massage', durationMin: 60, priceCents: 8000, titleMode: 'CUSTOM' } }, { id: 'legacy:1:1:1234567890abcdef', name: 'Old display only', priceText: '$40–$90, call us', description: 'No inferred price', isVisible: false }] }] };
}
function receipt(command: WorkspaceCommand, overrides: Partial<WorkspaceReceipt> = {}): WorkspaceReceipt {
  return { operationId: 'synthetic-operation', action: command.action, shopId: '5', idempotencyKey: command.idempotencyKey, outcome: 'COMMITTED', serviceId: command.action === 'SAVE_SERVICE_WORKSPACE' ? command.serviceId ?? '82' : null, idMap: { variants: {}, addOns: {}, displays: {} }, priceMenuRevision: committedRevision, selectionRevision: command.action === 'SAVE_SERVICE_WORKSPACE' ? selectedRevision : null, requiredPermissions: ['CATALOG_MANAGE'], changes: { serviceFields: [], policyFields: [], variantIds: [], addOnIds: [], displayIds: [], layout: false }, warnings: [], ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let sequence = 0;
async function harness(options: { strict?: boolean; permissions?: { catalog: boolean; policy: boolean }; readReady?: boolean; focus?: StoreServiceWorkspaceProps['focus']; loadError?: string; catalogError?: string; mediaTransport?: MediaDraftTransport; shopImages?: readonly string[] } = {}) {
  const keys = ['window', 'document', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const storage = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const elements = new Map<string, unknown>(), focused: string[] = [], scrolled: string[] = [], lookedUp: string[] = [];
  const document: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById(id: string) { lookedUp.push(id); return elements.get(id) ?? null; } };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage }; document.defaultView = window;
  for (const [key, value] of Object.entries({ window, document, sessionStorage, requestAnimationFrame: (fn: FrameRequestCallback) => { fn(0); return 1; }, cancelAnimationFrame() {}, HTMLInputElement: class {}, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const prefix = 'synthetic-workspace-' + ++sequence;
  let context = { shopId: '5', scopeKey: prefix + ':admin:7:5', active: true }, tree: unknown, reviewTree: unknown, root: Root;
  let lifecycle: BusinessLifecycle = { dirty: false, busy: false, unknown: false };
  const commands: WorkspaceCommand[] = [], receiptKeys: string[] = [], reconcileKeys: string[] = [], reads: string[] = [], saved: Array<{ snapshot: WorkspaceSnapshot; receipt: WorkspaceReceipt }> = [];
  let state = snapshot(), catalog = [service()], permitWrite = true, readReady = options.readReady !== false, loadError = options.loadError, catalogError = options.catalogError;
  let discardImages: (() => Promise<number>) | null = null;
  const catalogQueries: Array<{ search: string; page: number }> = [];
  if (options.permissions) { state.canManageCatalog = options.permissions.catalog; state.canConfigurePolicy = options.permissions.policy; }
  let save: ServiceWorkspaceApi['save'] = async () => { throw Error('Synthetic connection lost'); };
  let read: ServiceWorkspaceApi['readReceipt'] = async () => { throw Object.assign(Error('Synthetic receipt missing'), { status: 404 }); };
  let reconcile: ServiceWorkspaceApi['reconcile'] = async () => { throw Error('Synthetic reconciliation unavailable'); };
  let load: ServiceWorkspaceApi['loadSnapshot'] = async serviceId => ({ ...structuredClone(state), service: serviceId ? structuredClone(catalog.find(row => row.id === serviceId) ?? service(context.shopId)) : null, selectionRevision: serviceId ? selectedRevision : null });
  const api: ServiceWorkspaceApi = {
    loadCatalog: async query => { catalogQueries.push({ search: query.search, page: query.page }); if (catalogError) throw Error(catalogError); const rows = catalog.filter(row => !query.serviceId || row.id === query.serviceId).filter(row => query.status === 'all' || row.isActive === (query.status === 'active')).filter(row => row.name.includes(query.search)); const offset = (query.page - 1) * query.pageSize; return { ...query, shopId: context.shopId, total: rows.length, hasMore: offset + query.pageSize < rows.length, canManageCatalog: state.canManageCatalog, canConfigurePolicy: state.canConfigurePolicy, items: rows.slice(offset, offset + query.pageSize) }; },
    loadSnapshot: (id, signal) => { reads.push(context.shopId + ':' + (id ?? 'none')); if (loadError) return Promise.reject(Error(loadError)); return load(id, signal); },
    save: command => { assert.ok(storage.size > 0, 'operation journal is durable before POST'); commands.push(structuredClone(command)); return save(command); },
    readReceipt: (key, signal) => { receiptKeys.push(key); return read(key, signal); },
    reconcile: (key, signal) => { reconcileKeys.push(key); return reconcile(key, signal); },
  };
  const changed = (value: BusinessLifecycle) => { lifecycle = value; };
  const registerDiscard = (value: (() => Promise<number>) | null) => { discardImages = value; };
  function ReviewProbe(props: React.ComponentProps<typeof LegacyAssociationReview>) { reviewTree = LegacyAssociationReview(props); return null; }
  function Probe() {
    const original = context;
    const props: StoreServiceWorkspaceProps = { shopId: original.shopId, scopeKey: original.scopeKey, api, readReady, disabled: !readReady, focus: options.focus, isCurrent: () => original.active && original === context, beforeWrite: () => permitWrite, onLifecycleChange: changed, onSaved: value => { saved.push(value); }, mediaTransport: options.mediaTransport, shopImages: options.shopImages, onMediaDiscardReady: registerDiscard };
    tree = StoreServiceWorkspace(props);
    const review = findAll(tree, node => node.type === LegacyAssociationReview)[0];
    if (!review) { reviewTree = null; return null; }
    return <ReviewProbe {...review.props as React.ComponentProps<typeof LegacyAssociationReview>} />;
  }
  function create() { const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' }; root = createRoot(container as unknown as HTMLElement); }
  const render = () => act(async () => { root.render(options.strict ? <StrictMode><Probe /></StrictMode> : <Probe />); });
  create(); await render();
  const nodes = (predicate: (node: Node) => boolean, source = tree) => findAll(source, predicate);
  const control = (predicate: (node: Node) => boolean, index = 0, source = tree) => { const node = nodes(predicate, source)[index]; assert.ok(node, 'expected workspace control'); return node; };
  const button = (label: string, index = 0) => control(node => node.type === 'button' && text(node).trim() === label, index);
  const field = (label: string, index = 0) => { const wrapper = control(node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === label, index); return control(node => ['input', 'textarea', 'select'].includes(String(node.type)), 0, wrapper.props.children); };
  return { commands, receiptKeys, reconcileKeys, reads, saved, storage, catalogQueries, focused, scrolled, lookedUp, tree: () => tree, reviewTree: () => reviewTree, lifecycle: () => lifecycle, button, field, control, nodes, state: () => state,
    discardImages: () => { assert.ok(discardImages); return discardImages(); },
    element(id: string, parentElement: unknown = null, tagName = 'INPUT') { const element = { id, parentElement, tagName, open: false, focus() { focused.push(id); }, scrollIntoView() { scrolled.push(id); } }; elements.set(id, element); return element; },
    setSnapshot: (value: WorkspaceSnapshot) => { state = value; if (value.service) catalog = [value.service]; },
    setCatalog: (value: ProjectCatalogItem[]) => { catalog = value; }, setSave: (handler: typeof save) => { save = handler; }, setRead: (handler: typeof read) => { read = handler; }, setReconcile: (handler: typeof reconcile) => { reconcile = handler; }, setLoad: (handler: typeof load) => { load = handler; }, setBeforeWrite: (value: boolean) => { permitWrite = value; },
    async click(label: string, index = 0) { await act(async () => { button(label, index).props.onClick(); }); },
    async setReady(value: boolean) { readReady = value; await render(); },
    setReadErrors(snapshotFailure?: string, catalogFailure?: string) { loadError = snapshotFailure; catalogError = catalogFailure; },
    async change(label: string, value: string, index = 0) { await act(async () => { field(label, index).props.onChange({ target: { value } }); }); },
    async check(node: Node, checked: boolean) { await act(async () => { node.props.onChange({ target: { checked } }); }); },
    async remount() { await act(async () => root.unmount()); create(); await render(); },
    async otherScope(shopId = '6', actor = '8') { context.active = false; context = { shopId, scopeKey: prefix + ':admin:' + actor + ':' + shopId, active: true }; state = snapshot(shopId); catalog = [service(shopId)]; await render(); },
    async retireSameActor() { context.active = false; await render(); },
    async cleanup() { await act(async () => root.unmount()); keys.forEach((key, i) => { if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!); else Reflect.deleteProperty(globalThis, key); }); },
  };
}

const menuAssetId = '00000000-0000-4000-8000-000000000004';
const menuAsset: StagedMedia = {
  id: menuAssetId, fileUrl: '/api/v1/upload/media/' + menuAssetId + '/file', scope: 'SHOP', shopId: '5', purpose: 'menu',
  status: 'STAGED', mimeType: 'image/webp', sizeBytes: 4, width: 1, height: 1, expiresAt: '2099-01-01T00:00:00.000Z',
};
const sampleMenuImage = () => new File([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)], 'menu.png', { type: 'image/png' });
function menuTransport(overrides: Partial<MediaDraftTransport> = {}) {
  const calls: Array<{ action: string; id?: string; key?: string }> = [];
  const transport: MediaDraftTransport = {
    upload: async (_file, purpose, key) => { calls.push({ action: 'upload', key }); assert.equal(purpose, 'menu'); return overrides.upload ? overrides.upload(_file, purpose, key) : menuAsset; },
    confirm: async id => { calls.push({ action: 'confirm', id }); return overrides.confirm ? overrides.confirm(id) : menuAsset; },
    preview: async id => { calls.push({ action: 'preview', id }); return overrides.preview ? overrides.preview(id) : new Blob([new Uint8Array(4)], { type: 'image/webp' }); },
    abandon: async id => { calls.push({ action: 'abandon', id }); return overrides.abandon?.(id); },
  };
  return { transport, calls };
}
type Harness = Awaited<ReturnType<typeof harness>>;
function displayImage(h: Harness) {
  return h.control(node => typeof node.type === 'function' && node.type.name === 'DisplayEditor' && node.props.row.key === 'display-a').props.image;
}
function fileControl(h: Harness) {
  return h.control(node => node.type === 'input' && node.props['aria-label'] === '上传价目展示图片', 0, displayImage(h));
}
async function chooseFile(h: Harness) {
  const file = sampleMenuImage();
  const input = fileControl(h);
  await act(async () => { input.props.onChange({ target: { files: [file], value: 'menu.png' } }); });
}

test('uploaded menu image previews from its verified blob and the existing save binds only the selected display', async () => {
  const started = deferred<void>();
  const stage = deferred<StagedMedia>();
  const { transport, calls } = menuTransport({ upload: async () => { started.resolve(); return stage.promise; } });
  const shopImage = 'https://example.invalid/shop.webp';
  const h = await harness({ strict: true, mediaTransport: transport, shopImages: [shopImage, shopImage, 'javascript:alert(1)'] });
  try {
    await h.click('编辑');
    const shopImages = h.nodes(node => node.type === 'button' && /^选择本店图片/.test(node.props['aria-label']), displayImage(h));
    assert.equal(shopImages.length, 1);
    await act(async () => { shopImages[0].props.onClick(); });
    assert.equal(h.control(node => node.type === 'img' && node.props.alt === '所选服务图片', 0, displayImage(h)).props.src, shopImage);
    await chooseFile(h);
    await started.promise;
    assert.equal(h.lifecycle().busy, true);
    assert.equal(h.button('保存当前服务').props.disabled, true);
    await h.click('管理分组与顺序');
    assert.equal(h.nodes(node => node.props.label === '未保存的服务修改').length, 0);
    await act(async () => { stage.resolve(menuAsset); });
    assert.equal(h.lifecycle().dirty, true);
    assert.equal(h.lifecycle().busy, false);
    assert.match(h.control(node => node.type === 'img' && node.props.alt === '所选服务图片', 0, displayImage(h)).props.src, /^blob:/);
    h.setSave(async command => {
      assert.equal(command.action, 'SAVE_SERVICE_WORKSPACE');
      if (command.action !== 'SAVE_SERVICE_WORKSPACE') throw Error('wrong action');
      assert.deepEqual(command.displays, [{ id: 'display-a', changes: { imageUrl: menuAsset.fileUrl } }]);
      const next = snapshot('5', true);
      next.priceMenuRevision = committedRevision;
      next.priceMenu[0].items[0].imageUrl = menuAsset.fileUrl;
      h.setSnapshot(next);
      return receipt(command, { changes: { serviceFields: [], policyFields: [], variantIds: [], addOnIds: [], displayIds: ['display-a'], layout: false } });
    });
    await h.click('保存当前服务');
    assert.equal(h.commands.length, 1);
    assert.equal(h.saved.length, 1);
    assert.equal(h.lifecycle().dirty, false);
    assert.equal(h.control(node => node.type === 'img' && node.props.alt === '所选服务图片', 0, displayImage(h)).props.src, menuAsset.fileUrl);
    assert.deepEqual(calls.map(call => call.action), ['upload', 'confirm', 'preview']);
  } finally { await h.cleanup(); }
});

test('unknown save keeps staged media across remount and confirmed non-execution permits explicit cleanup', async () => {
  const uploaded = deferred<void>();
  const { transport, calls } = menuTransport({ preview: async () => {
    uploaded.resolve();
    return new Blob([new Uint8Array(4)], { type: 'image/webp' });
  } });
  const h = await harness({ mediaTransport: transport });
  try {
    await h.click('编辑'); await chooseFile(h); await act(async () => { await uploaded.promise; });
    await h.click('保存当前服务');
    const command = h.commands[0];
    assert.equal(h.lifecycle().unknown, true);
    assert.match([...h.storage.values()][0], new RegExp(menuAssetId));
    assert.equal(await h.discardImages(), 1);
    await h.remount();
    assert.equal(h.lifecycle().unknown, true);
    assert.equal(h.nodes(node => node.type === 'img' && node.props.src === menuAsset.fileUrl, displayImage(h)).length, 0);
    assert.match(text(displayImage(h)), /已保留暂存图片/);
    assert.equal(calls.some(call => call.action === 'abandon'), false);
    h.setReconcile(async () => receipt(command, { outcome: 'NOT_EXECUTED', serviceId: null, priceMenuRevision: initialRevision, selectionRevision: null }));
    await h.click('核对并封存未执行操作');
    assert.equal(h.lifecycle().unknown, false);
    assert.equal(h.lifecycle().dirty, true);
    await h.click('管理分组与顺序');
    await h.click('放弃修改并继续');
    assert.equal(h.nodes(node => node.props['aria-label'] === '管理分组与顺序').length, 1);
    assert.deepEqual(calls.filter(call => call.action === 'abandon'), [{ action: 'abandon', id: menuAssetId }]);
    assert.equal(h.commands.length, 1);
  } finally { await h.cleanup(); }
});

test('late upload completion under another shop uses no confirm, preview, or abandonment request', async () => {
  const started = deferred<void>();
  const stage = deferred<StagedMedia>();
  const { transport, calls } = menuTransport({ upload: async () => { started.resolve(); return stage.promise; } });
  const h = await harness({ mediaTransport: transport });
  try {
    await h.click('编辑'); await chooseFile(h); await started.promise;
    await h.otherScope();
    await act(async () => { stage.resolve(menuAsset); });
    assert.deepEqual(calls.map(call => call.action), ['upload']);
    assert.equal(h.lifecycle().dirty, false);
    assert.equal(h.lifecycle().busy, false);
    assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('persistent save bar shows the exact current draft and local section navigation never reloads or replaces it', async () => {
  const h = await harness();
  try {
    await h.click('编辑');
    const bar = () => h.control(node => node.type === 'footer' && node.props['aria-label'] === '当前服务保存');
    assert.equal(bar().props['data-save-state'], 'saved');
    assert.equal(h.button('保存当前服务').props.disabled, true);
    await h.change('服务名称 *', 'Keep this exact draft');
    await h.change('价格（USD）*', '75.25');
    assert.equal(bar().props['data-save-state'], 'dirty');
    assert.match(text(bar()), /Keep this exact draft/);
    assert.equal(h.nodes(node => node.type === 'button' && text(node).trim() === '保存当前服务').length, 1, 'the existing single save action moves into the bar');
    const reads = h.reads.length;
    for (const label of ['基本资料', '规格与价格', '顾客展示', '预约规则', '附加项目']) {
      const navigation = h.button(label), targetId = navigation.props['aria-controls'];
      const target = h.control(node => node.props.id === targetId);
      const element = h.element(targetId, null, String(target.type).toUpperCase());
      await h.click(label);
      assert.equal(h.scrolled.at(-1), targetId);
      if (target.type === 'details') assert.equal(element.open, true, 'navigation opens the existing collapsed section');
      assert.equal(h.field('服务名称 *').props.value, 'Keep this exact draft');
      assert.equal(h.field('价格（USD）*').props.value, '75.25');
    }
    assert.equal(h.reads.length, reads);
    assert.equal(h.commands.length, 0);
    assert.deepEqual(h.lifecycle(), { dirty: true, busy: false, unknown: false });
  } finally { await h.cleanup(); }
});

test('the persistent save action retains busy, unknown, outdated and identity fences without a second write path', async () => {
  const h = await harness(), pending = deferred<unknown>();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Original sticky save');
    const retainedSave = h.button('保存当前服务').props.onClick;
    const retainedNavigation = h.button('顾客展示').props.onClick;
    h.setSave(() => pending.promise);
    await act(async () => { retainedSave(); retainedSave(); });
    const bar = () => h.control(node => node.type === 'footer' && node.props['aria-label'] === '当前服务保存');
    assert.equal(bar().props['data-save-state'], 'busy');
    assert.equal(h.button('正在保存…').props.disabled, true);
    assert.equal(h.commands.length, 1);
    await act(async () => { pending.resolve({}); });
    assert.equal(bar().props['data-save-state'], 'unknown');
    assert.equal(h.button('保存当前服务').props.disabled, true);
    const key = h.commands[0].idempotencyKey, storage = [...h.storage.entries()];
    const nav = h.button('顾客展示'), target = h.element(nav.props['aria-controls'], null, 'DETAILS');
    await h.click('顾客展示');
    assert.equal(target.open, true);
    assert.deepEqual([...h.storage.entries()], storage, 'read-only navigation retains the original unknown journal');
    await act(async () => { retainedSave(); });
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].idempotencyKey, key);
    await h.otherScope(); await h.click('编辑');
    const scrolls = h.scrolled.length;
    await act(async () => { retainedSave(); retainedNavigation(); });
    assert.equal(h.scrolled.length, scrolls, 'a retired service navigation callback cannot target another identity');
    assert.equal(h.field('服务名称 *').props.value, 'Synthetic massage');
    await h.change('服务名称 *', 'Conflict draft');
    h.setSave(async () => { throw Object.assign(Error('Revision changed'), { response: { status: 409 } }); });
    await h.click('保存当前服务');
    assert.equal(bar().props['data-save-state'], 'outdated');
    assert.equal(h.button('保存当前服务').props.disabled, true);
    assert.equal(h.field('服务名称 *').props.value, 'Conflict draft');
    assert.equal(h.commands.length, 2);
  } finally { await h.cleanup(); }
});

test('new service submits one command with first variant and display, without requesting policy permission for untouched defaults', async () => {
  const h = await harness({ strict: true, permissions: { catalog: true, policy: false } });
  try {
    await h.click('＋ 新增服务'); await h.change('服务名称 *', 'New synthetic service'); await h.change('规格名称 *', 'Standard'); await h.change('价格（USD）*', '85.25');
    assert.equal(h.lifecycle().dirty, true);
    h.setSave(async command => {
      assert.equal(command.action, 'SAVE_SERVICE_WORKSPACE'); if (command.action !== 'SAVE_SERVICE_WORKSPACE') throw Error('wrong action');
      assert.equal(command.policy, undefined); assert.equal(command.variants?.length, 1); assert.equal(command.displays?.length, 1); assert.equal(command.variants[0].changes.priceCents, 8525);
      const variantKey = 'tempKey' in command.variants[0] ? command.variants[0].tempKey : ''; const displayKey = 'tempKey' in command.displays[0] ? command.displays[0].tempKey : '';
      const created = { ...service(), id: '82', name: 'New synthetic service', description: '', priceCents: 8525, variants: [{ ...service().variants[0], id: '92', serviceId: '82', priceCents: 8525 }] };
      const next = snapshot(); next.priceMenuRevision = committedRevision; next.service = created;
      next.priceMenu[0].items.push({ id: 'created-display', name: '60Mins New synthetic service $85.25', priceText: '', isVisible: true, description: '', imageUrl: '', booking: { serviceId: '82', variantId: '92' }, pricing: { kind: 'TIMED', baseName: created.name, durationMin: 60, priceCents: 8525, titleMode: 'AUTO' } }); h.setSnapshot(next);
      return receipt(command, { idMap: { variants: { [variantKey]: '92' }, addOns: {}, displays: { [displayKey]: 'created-display' } } });
    });
    await h.click('创建服务'); assert.equal(h.commands.length, 1); assert.equal(h.saved.length, 1); assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false }); assert.equal(h.storage.size, 0);
    assert.equal(h.field('价格（USD）*').props.value, '85.25'); assert.match(text(h.tree()), /已保存并读回核对/);
  } finally { await h.cleanup(); }
});

test('price and display visibility preserve variant activity and every custom display identity', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('价格（USD）*', '90.50');
    const displayToggle = h.control(node => node.type === 'label' && text(node).includes('顾客价目显示'));
    await h.check(h.control(node => node.type === 'input', 0, displayToggle.props.children), false);
    h.setSave(async command => {
      assert.equal(command.action, 'SAVE_SERVICE_WORKSPACE'); if (command.action !== 'SAVE_SERVICE_WORKSPACE') throw Error('wrong action');
      assert.deepEqual(command.variants, [{ id: '91', changes: { priceCents: 9050 } }]); assert.deepEqual(command.displays, [{ id: 'display-a', changes: { isVisible: false } }]); assert.equal(command.service, undefined); assert.equal(command.policy, undefined);
      const next = snapshot('5', true); next.priceMenuRevision = committedRevision; next.service!.variants[0].priceCents = 9050; next.priceMenu[0].items[0].isVisible = false; h.setSnapshot(next); return receipt(command);
    });
    await h.click('保存当前服务'); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].snapshot.service!.variants[0].isActive, true);
    assert.deepEqual(h.saved[0].snapshot.priceMenu.map(g => g.items.map(row => row.id)), [['display-a'], ['display-b', 'legacy:1:1:1234567890abcdef']]); assert.equal(h.saved[0].snapshot.priceMenu[0].items[0].name, 'Keep my custom title'); assert.equal(h.saved[0].snapshot.priceMenu[0].items[0].imageUrl, 'https://example.invalid/a.webp');
  } finally { await h.cleanup(); }
});

test('legacy repair compares the exact selected draft and requires a visibility choice for each row before one save', async () => {
  const h = await harness();
  try {
    const before = snapshot('5', true), hidden = before.priceMenu[1].items[1];
    hidden.name = 'Old massage $40';
    hidden.description = 'Optional extras cost $10.';
    before.priceMenu[1].items.push({ id: 'visible-legacy', name: 'Call for a massage', priceText: '$95', isVisible: true });
    h.setSnapshot(before);
    await h.click('编辑');
    await h.change('服务名称 *', 'Selected massage');
    await h.change('预约占用分钟 *', '75');
    await h.change('价格（USD）*', '90.50');
    const attach = () => h.control(node => typeof node.type === 'function' && node.type.name === 'StoreLegacyProjectRepair').props.onAssociate;
    const target = { kind: 'VARIANT', id: '91' } as const;
    await act(async () => { attach()(hidden.id, target); });
    await act(async () => { attach()('visible-legacy', target); });
    await h.click('保存当前服务');
    assert.equal(h.commands.length, 0);
    const reviewButton = (name: string) => h.control(node => node.type === 'button' && text(node).trim() === name, 0, h.reviewTree());
    const radios = () => h.nodes(node => node.type === 'input' && node.props.type === 'radio', h.reviewTree());
    const reviewText = text(h.reviewTree()).replace(/\s+/g, ' ');
    for (const label of ['Old massage $40', '$40–$90, call us', '顾客说明 Optional extras cost $10.', '顾客说明中的金额仍会随说明显示', '原来隐藏', '原来可见', 'Selected massage', 'Standard', '75 分钟占用', 'USD 90.50 / 次', '75 min Selected massage $90.5', '技师排班']) assert.ok(reviewText.includes(label), label);
    assert.equal(radios().every(node => !node.props.checked), true);
    assert.equal(reviewButton('确认关联并保存').props.disabled, true);
    const abandoned = h.control(node => node.type === LegacyAssociationReview).props.onConfirm;
    await act(async () => { reviewButton('返回草稿').props.onClick(); });
    await h.click('保存当前服务');
    await act(async () => { abandoned(new Map([[hidden.id, true], ['visible-legacy', true]])); });
    assert.equal(h.commands.length, 0, 'a dismissed confirmation cannot submit the reopened review');
    assert.equal(h.field('服务名称 *').props.value, 'Selected massage');
    await act(async () => { radios()[1].props.onChange(); });
    assert.equal(reviewButton('确认关联并保存').props.disabled, true);
    await act(async () => { radios()[2].props.onChange(); });
    h.setSave(async command => {
      if (command.action !== 'SAVE_SERVICE_WORKSPACE') throw Error('wrong action');
      assert.equal(command.serviceId, '81');
      assert.deepEqual(command.service, { name: 'Selected massage' });
      assert.deepEqual(command.variants, [{ id: '91', changes: { durationMin: 75, priceCents: 9050 } }]);
      assert.deepEqual(command.displays, [
        { id: hidden.id, target, group: { index: 1 }, position: 1, changes: { description: 'Optional extras cost $10.', imageUrl: '', isVisible: false, titleMode: 'AUTO' } },
        { id: 'visible-legacy', target, group: { index: 1 }, position: 2, changes: { name: 'Call for a massage', description: '', imageUrl: '', isVisible: true, titleMode: 'CUSTOM' } },
      ]);
      const next = structuredClone(before);
      next.priceMenuRevision = committedRevision;
      next.service!.name = 'Selected massage';
      Object.assign(next.service!.variants[0], { durationMin: 75, priceCents: 9050 });
      const pricing = { kind: 'TIMED', baseName: 'Selected massage', durationMin: 75, priceCents: 9050 } as const;
      Object.assign(next.priceMenu[1].items[1], { id: 'stored-legacy', name: '75Mins Selected massage $90.5', priceText: '', booking: { serviceId: '81', variantId: '91' }, pricing: { ...pricing, titleMode: 'AUTO' } });
      Object.assign(next.priceMenu[1].items[2], { priceText: '', booking: { serviceId: '81', variantId: '91' }, pricing: { ...pricing, titleMode: 'CUSTOM' } });
      h.setSnapshot(next);
      return receipt(command, { idMap: { variants: {}, addOns: {}, displays: { [hidden.id!]: 'stored-legacy' } } });
    });
    await act(async () => { reviewButton('确认关联并保存').props.onClick(); });
    assert.equal(h.commands.length, 1);
    assert.equal(h.saved.length, 1);
    assert.equal(h.saved[0].snapshot.priceMenu[1].items[1].isVisible, false);
    assert.equal(h.saved[0].snapshot.priceMenu[1].items[2].isVisible, true);
    assert.equal(h.storage.size, 0);
  } finally { await h.cleanup(); }
});

test('converting a hidden legacy row confirms visibility and records the explicit choice in recovery', async () => {
  const h = await harness();
  try {
    const before = snapshot(), original = before.priceMenu[1].items[1];
    original.name = 'Old massage $40';
    h.setSnapshot(before);
    await h.click('重新载入');
    const convert = h.control(node => typeof node.type === 'function' && node.type.name === 'StoreLegacyProjectRepair').props.onConvert;
    await act(async () => { convert(original.id); });
    assert.equal(h.field('服务名称 *').props.value, '');
    await h.change('服务名称 *', 'New massage');
    await h.change('价格（USD）*', '70.00');
    await h.click('创建服务');
    assert.equal(h.commands.length, 0);
    const show = h.control(node => node.type === 'button' && text(node).trim() === '保存并继续展示', 0, h.reviewTree());
    await act(async () => { show.props.onClick(); });
    assert.equal(h.commands.length, 1);
    const command = h.commands[0];
    if (command.action !== 'SAVE_SERVICE_WORKSPACE') throw Error('wrong action');
    const variant = command.variants?.[0], display = command.displays?.[0];
    assert.ok(variant && 'tempKey' in variant);
    assert.deepEqual(display?.target, { kind: 'VARIANT', tempKey: variant.tempKey });
    assert.equal(display?.changes.isVisible, true);
    assert.equal(display?.changes.titleMode, 'AUTO');
    assert.equal(display?.changes.name, undefined);
    await h.remount();
    assert.equal(h.commands.length, 1);
    assert.equal(h.lifecycle().unknown, true);
    const journal = JSON.parse([...h.storage.values()][0]);
    assert.equal(journal.draft.displays[0].isVisible, true);
    assert.equal(journal.command.idempotencyKey, command.idempotencyKey);
  } finally { await h.cleanup(); }
});

test('dirty navigation neither saves nor discards without explicit confirmation', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Keep dirty draft'); await h.click('管理分组与顺序');
    assert.match(text(h.tree()), /有未保存修改/); assert.equal(h.commands.length, 0); await h.click('继续编辑'); assert.equal(h.field('服务名称 *').props.value, 'Keep dirty draft');
    await h.click('管理分组与顺序'); await h.click('放弃修改并继续'); assert.equal(h.nodes(node => node.props['aria-label'] === '管理分组与顺序').length, 1); assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('lost reply, missing receipt and NOT_EXECUTED reconciliation retain exact draft and original key without repeating POST', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Original attempt'); const stale = h.button('保存当前服务').props.onClick;
    await h.click('保存当前服务'); assert.equal(h.lifecycle().unknown, true); const key = h.commands[0].idempotencyKey;
    await act(async () => { stale(); }); await h.click('保存当前服务'); assert.equal(h.commands.length, 1);
    await h.click('查询原保存回执'); assert.equal(h.lifecycle().unknown, true); assert.deepEqual(h.receiptKeys, [key]);
    h.setReconcile(async () => receipt(h.commands[0], { outcome: 'NOT_EXECUTED', action: null, serviceId: null, selectionRevision: null }));
    await h.click('核对并封存未执行操作'); assert.deepEqual(h.reconcileKeys, [key]); assert.equal(h.commands.length, 1); assert.equal(h.lifecycle().unknown, false); assert.equal(h.lifecycle().dirty, true); assert.equal(h.field('服务名称 *').props.value, 'Original attempt'); assert.equal(h.storage.size, 0);
  } finally { await h.cleanup(); }
});

test('uncertain journal survives remount, while another actor and store never see or reconcile its draft', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Private pending draft'); await h.click('保存当前服务'); const key = h.commands[0].idempotencyKey;
    await h.remount(); assert.equal(h.lifecycle().unknown, true); assert.equal(h.field('服务名称 *').props.value, 'Private pending draft');
    await h.click('查询原保存回执'); assert.deepEqual(h.receiptKeys, [key]); assert.equal(h.commands.length, 1);
    await h.otherScope(); assert.equal(h.lifecycle().unknown, false); assert.equal(h.nodes(node => node.props.value === 'Private pending draft').length, 0); assert.equal(h.saved.length, 0); assert.equal(h.storage.size, 1, 'retirement does not destroy an unresolved original operation');
  } finally { await h.cleanup(); }
});

test('late successful write cannot publish into a changed store or retired same actor session', async () => {
  for (const sameActor of [false, true]) {
    const h = await harness(), waiting = deferred<unknown>();
    try {
      await h.click('编辑'); await h.change('服务名称 *', 'Late reply'); h.setSave(() => waiting.promise); await h.click('保存当前服务');
      if (sameActor) await h.retireSameActor(); else await h.otherScope();
      await act(async () => { waiting.resolve(receipt(h.commands[0])); }); assert.equal(h.saved.length, 0); assert.equal(h.commands.length, 1); assert.equal(h.storage.size, 1);
    } finally { await h.cleanup(); }
  }
});

test('a matching receipt with changed current data stays unresolved until explicit adoption and never rewrites', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'My attempted title'); h.setSave(async command => { const next = snapshot('5', true); next.priceMenuRevision = 'd'.repeat(64); next.service!.name = 'A later confirmed title'; h.setSnapshot(next); return receipt(command); });
    await h.click('保存当前服务'); assert.equal(h.lifecycle().unknown, true); assert.equal(h.saved.length, 0); assert.equal(h.field('服务名称 *').props.value, 'My attempted title'); assert.match(text(h.tree()), /已提交/);
    await h.click('放弃本地草稿，采用当前已保存资料'); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].snapshot.service!.name, 'A later confirmed title'); assert.equal(h.commands.length, 1); assert.equal(h.lifecycle().unknown, false); assert.equal(h.lifecycle().dirty, false);
  } finally { await h.cleanup(); }
});

test('legacy text save preserves literal price wording and only changes the selected stable read token', async () => {
  const h = await harness();
  try {
    await h.click('编辑展示文字'); await h.change('标题', 'Changed display only');
    h.setSave(async command => { assert.equal(command.action, 'SAVE_LEGACY_DISPLAY'); if (command.action !== 'SAVE_LEGACY_DISPLAY') throw Error('wrong action'); assert.equal(command.itemId, 'legacy:1:1:1234567890abcdef'); assert.deepEqual(command.changes, { name: 'Changed display only' }); const next = snapshot(); next.priceMenuRevision = committedRevision; Object.assign(next.priceMenu[1].items[1], { id: 'stored-legacy', name: 'Changed display only' }); h.setSnapshot(next); return receipt(command, { idMap: { variants: {}, addOns: {}, displays: { [command.itemId]: 'stored-legacy' } } }); });
    await h.click('保存展示文字'); assert.equal(h.commands.length, 1); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].snapshot.priceMenu[1].items[1].priceText, '$40–$90, call us'); assert.equal(h.saved[0].snapshot.priceMenu[1].items[1].booking, undefined);
  } finally { await h.cleanup(); }
});

test('catalog permission alone cannot send policy edits, but policy-only roles can save rules without catalog changes', async () => {
  const h = await harness({ permissions: { catalog: false, policy: true } });
  try {
    await h.click('编辑'); await h.change('技师收尾缓冲（分钟）', '10');
    h.setSave(async command => { assert.equal(command.action, 'SAVE_SERVICE_WORKSPACE'); if (command.action !== 'SAVE_SERVICE_WORKSPACE') throw Error('wrong action'); assert.equal(command.service, undefined); assert.equal(command.variants, undefined); assert.equal(command.displays, undefined); assert.deepEqual(command.policy, { staffBufferMin: 10 }); const next = snapshot('5', true); next.canManageCatalog = false; next.priceMenuRevision = committedRevision; next.service!.staffBufferMin = 10; h.setSnapshot(next); return receipt(command, { requiredPermissions: ['RESERVATION_CONFIG'] }); });
    await h.click('保存当前服务'); assert.equal(h.saved.length, 1); assert.equal(h.commands.length, 1);
  } finally { await h.cleanup(); }
});

test('group moves and removal use original stable indexes, preserve all rows and send one layout command', async () => {
  const h = await harness();
  try {
    await h.click('管理分组与顺序');
    await act(async () => { h.control(node => node.props['aria-label'] === '分组名称', 1).props.onChange({ target: { value: 'Updated specials' } }); });
    await act(async () => { h.control(node => node.props['aria-label'] === '目标分组', 0).props.onChange({ target: { value: 'g:1' } }); });
    await h.change('移走内容并删除此分组', 'g:1', 0);
    h.setSave(async command => {
      assert.equal(command.action, 'SAVE_MENU_LAYOUT'); if (command.action !== 'SAVE_MENU_LAYOUT') throw Error('wrong action');
      assert.deepEqual(command.groups, [{ index: 1, category: 'Updated specials' }]); assert.deepEqual(command.groupOrder, [{ index: 1 }]); assert.deepEqual(command.removeGroups, [{ index: 0, moveTo: { index: 1 } }]); assert.deepEqual(command.moves, [{ itemId: 'display-a', group: { index: 1 }, position: 0 }]);
      const next = snapshot(); next.priceMenuRevision = committedRevision; next.priceMenu = [{ category: 'Updated specials', items: [next.priceMenu[0].items[0], ...next.priceMenu[1].items] }]; h.setSnapshot(next); return receipt(command);
    });
    await h.click('保存分组与顺序'); assert.equal(h.commands.length, 1); assert.equal(h.saved.length, 1); assert.deepEqual(h.saved[0].snapshot.priceMenu[0].items.map(row => row.id), ['display-a', 'display-b', 'legacy:1:1:1234567890abcdef']);
  } finally { await h.cleanup(); }
});

test('a malformed successful reply freezes its attempted command and a parent write fence prevents dispatch', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Keep original draft'); h.setBeforeWrite(false); await h.click('保存当前服务'); assert.equal(h.commands.length, 0); assert.equal(h.lifecycle().dirty, true);
    h.setBeforeWrite(true); h.setSave(async () => ({ outcome: 'COMMITTED', shopId: '5' })); await h.click('保存当前服务'); assert.equal(h.commands.length, 1); assert.equal(h.lifecycle().unknown, true); assert.equal(h.field('服务名称 *').props.value, 'Keep original draft'); await h.click('保存当前服务'); assert.equal(h.commands.length, 1);
  } finally { await h.cleanup(); }
});

test('parent profile conversion strips only snapshot legacy tokens and preserves hidden rows and real IDs', () => {
  const menu = snapshot().priceMenu, converted = workspaceProfileMenu(menu);
  assert.equal(converted[0].items[0].id, 'display-a'); assert.equal(converted[1].items[0].id, 'display-b'); assert.equal(converted[1].items[1].id, undefined); assert.equal(converted[1].items[1].isVisible, false); assert.equal(menu[1].items[1].id, 'legacy:1:1:1234567890abcdef');
});

test('strict USD amounts and default new service command keep server IDs and permission scope intact', () => {
  for (const [input, cents] of [['0.01', 1], ['12.30', 1230], ['100000', 10000000]] as const) assert.equal(workspaceCents(input), cents);
  for (const input of ['0', '-1', '1.001', '1e2', 'Infinity', '100000.01']) assert.throws(() => workspaceCents(input)); assert.equal(workspaceCents('0.00', true), 0);
  const base = readWorkspaceSnapshot({ ...snapshot(), priceMenu: [], canConfigurePolicy: false }, '5'); const draft = workspaceDraft(base); draft.name = 'Synthetic'; draft.variants[0].name = 'Standard'; draft.variants[0].price = '80.00';
  const command = buildWorkspaceCommand(base, draft, 'wSynthetic'); assert.equal(workspaceHasChanges(command), true); assert.equal(command.policy, undefined); assert.equal(command.newGroups?.length, 1); assert.equal(command.displays?.length, 1); assert.equal(command.serviceId, undefined);
  draft.participantCount = '2'; draft.requiredStaffCount = '2'; assert.throws(() => buildWorkspaceCommand(base, draft, 'wOther'), /核对/);
});

test('read failures never masquerade as an empty catalog or an authoritative zero display count, and retry recovers', async () => {
  const h = await harness({ loadError: 'Synthetic snapshot unavailable', catalogError: 'Synthetic catalog unavailable' });
  try {
    assert.match(text(h.tree()), /完整价目读取失败/); assert.match(text(h.tree()), /服务总数待核对/);
    assert.doesNotMatch(text(h.tree()), /共\s+0\s+个服务|当前页没有符合条件|顾客价目显示\s+0\s*\/\s*0/);
    for (const label of ['＋ 新增服务', '管理分组与顺序']) assert.equal(h.button(label).props.disabled, true);
    assert.equal(h.button('重新载入').props.disabled, false);
    h.setReadErrors(); await h.click('重新载入');
    assert.match(text(h.tree()), /共\s+1\s+个服务/); assert.equal(h.button('＋ 新增服务').props.disabled, false);
    h.setReadErrors('Synthetic snapshot unavailable'); await h.click('重新载入');
    assert.match(text(h.tree()), /Synthetic massage/); assert.match(text(h.tree()), /顾客展示待核对/);
    assert.doesNotMatch(text(h.tree()), /顾客价目显示/); assert.equal(h.button('编辑').props.disabled, true);
    assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('a failed catalog refresh preserves prior rows and does not permit creating against a partial read', async () => {
  const h = await harness();
  try {
    h.setReadErrors(undefined, 'Synthetic catalog unavailable'); await h.click('查询');
    assert.match(text(h.tree()), /Synthetic massage/); assert.match(text(h.tree()), /服务总数待核对/);
    assert.doesNotMatch(text(h.tree()), /共\s+0\s+个服务|当前页没有符合条件/);
    assert.equal(h.button('＋ 新增服务').props.disabled, true);
    h.setReadErrors(); await h.click('重新载入'); assert.match(text(h.tree()), /共\s+1\s+个服务/);
    assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('customer preview distinguishes confirmed data, dirty drafts and unknown write results', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.click('预览顾客页面');
    const preview = () => h.control(node => node.type === 'section' && String(node.props['aria-label']).startsWith('顾客预览 ·'));
    assert.equal(preview().props['aria-label'], '顾客预览 · 与已保存资料一致');
    await h.change('服务名称 *', 'Changed draft'); assert.equal(preview().props['aria-label'], '顾客预览 · 尚未保存');
    await h.click('保存当前服务'); assert.equal(preview().props['aria-label'], '顾客预览 · 保存结果待核对');
    assert.doesNotMatch(text(preview()), /与已保存资料一致/);
    h.setReconcile(async key => receipt(h.commands[0], { idempotencyKey: key, outcome: 'NOT_EXECUTED', action: null, serviceId: null }));
    await h.click('核对并封存未执行操作'); assert.equal(preview().props['aria-label'], '顾客预览 · 尚未保存');
    h.setSave(async command => { const next = snapshot('5', true); next.priceMenuRevision = committedRevision; next.service!.name = 'Changed draft'; h.setSnapshot(next); return receipt(command); });
    await h.click('保存当前服务'); assert.equal(preview().props['aria-label'], '顾客预览 · 与已保存资料一致');
    assert.equal(h.saved.length, 1); assert.equal(h.commands.length, 2);
  } finally { await h.cleanup(); }
});

test('invalid price on a later variant keeps a stable accessible field ID after removing a preceding draft row', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.click('＋ 添加规格'); await h.change('规格名称 *', 'Temporary earlier row', 1); await h.change('价格（USD）*', '40.00', 1);
    await h.click('＋ 添加规格'); await h.change('规格名称 *', 'Later variant', 2); await h.change('价格（USD）*', '12.345', 2);
    const wrapper = (index: number) => h.control(node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === '价格（USD）*', index);
    const id = wrapper(2).props.fieldId;
    await h.click('移除未保存规格', 0); assert.equal(wrapper(1).props.fieldId, id);
    const outer = { tagName: 'DETAILS', open: false, parentElement: null }, inner = { tagName: 'DETAILS', open: false, parentElement: outer };
    h.element(id, inner); await h.click('保存当前服务');
    assert.deepEqual(h.focused, [id]); assert.deepEqual(h.scrolled, [id]); assert.equal(inner.open, true); assert.equal(outer.open, true);
    const markup = renderToStaticMarkup(wrapper(1));
    assert.ok(markup.includes('id="' + id + '"')); assert.ok(markup.includes('aria-invalid="true"'));
    assert.ok(markup.includes('aria-describedby="' + id + '-error"')); assert.ok(markup.includes('id="' + id + '-error"'));
    assert.equal(h.field('价格（USD）*', 1).props.value, '12.345'); assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('invalid add-on inside a collapsed section expands, focuses its own field and retains all service drafts', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Keep draft title'); await h.click('＋ 添加附加项');
    await h.change('附加项名称 *', 'Hot stones'); await h.change('附加金额（USD）*', '-1');
    const field = h.control(node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === '附加金额（USD）*');
    const details = { tagName: 'DETAILS', open: false, parentElement: null }; h.element(field.props.fieldId, details);
    await h.click('保存当前服务'); assert.equal(details.open, true); assert.deepEqual(h.focused, [field.props.fieldId]);
    assert.ok(renderToStaticMarkup(h.control(node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === '附加金额（USD）*')).includes('aria-invalid="true"'));
    assert.equal(h.field('服务名称 *').props.value, 'Keep draft title'); assert.equal(h.field('附加金额（USD）*').props.value, '-1');
    assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('authorization becoming ready automatically reloads the original deep-linked service and focuses its exact variant', async () => {
  const h = await harness({ readReady: false, focus: { serviceId: '81', variantId: '91', revision: 'serviceId=81&variantId=91' } });
  try {
    assert.deepEqual(h.reads, []); assert.deepEqual(h.catalogQueries, []); h.element('workspace-variant-91', null, 'FIELDSET');
    await h.setReady(true); assert.deepEqual(h.reads, ['5:81']); assert.equal(h.field('服务名称 *').props.value, 'Synthetic massage');
    assert.deepEqual(h.focused, ['workspace-variant-91']); assert.equal(h.commands.length, 0);
    await h.change('服务名称 *', 'Preserved across authorization refresh'); const before = h.reads.length;
    await h.setReady(false); await h.setReady(true);
    assert.equal(h.reads.length, before, 'an authorization refresh cannot replace an existing dirty draft');
    assert.equal(h.field('服务名称 *').props.value, 'Preserved across authorization refresh'); assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('Enter in a service input prevents implicit outer form submission and never sends either save', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Unsubmitted by Enter');
    let prevented = false, stopped = false, outerSubmits = 0;
    const root = h.control(node => node.type === 'div' && String(node.props.className).startsWith('service-workspace'));
    await act(async () => { root.props.onKeyDown({ key: 'Enter', target: new HTMLInputElement(), preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); if (!prevented) outerSubmits++; });
    assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(outerSubmits, 0);
    assert.equal(h.commands.length, 0); assert.equal(h.saved.length, 0); assert.equal(h.lifecycle().dirty, true);
  } finally { await h.cleanup(); }
});

test('global layout after searching and paging retains every hidden and unlisted display in the full baseline', async () => {
  const h = await harness();
  try {
    h.setCatalog(Array.from({ length: 21 }, (_, index) => ({ ...service(), id: String(81 + index), name: 'Synthetic row ' + index })));
    await h.change('搜索服务', 'Synthetic row'); await h.click('查询'); await h.click('下一页');
    assert.ok(h.catalogQueries.some(query => query.search === 'Synthetic row' && query.page === 2));
    await h.click('管理分组与顺序');
    assert.deepEqual(h.nodes(node => node.props['aria-label'] === '目标分组').map(node => node.props.value), ['g:0', 'g:1', 'g:1']);
    assert.match(text(h.tree()), /Keep my second title/); assert.match(text(h.tree()), /Old display only/); assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('an invalid display image focuses the URL input inside collapsed display details, not the gallery select', async () => {
  const h = await harness();
  try {
    await h.click('编辑');
    const display = () => h.control(node => typeof node.type === 'function' && node.type.name === 'DisplayEditor');
    const id = display().props.fieldId('displays.0.imageUrl'), details = { tagName: 'DETAILS', open: false, parentElement: null };
    h.element(id, details); await act(async () => display().props.onChange({ imageUrl: 'javascript:invalid' }));
    await h.click('保存当前服务'); assert.equal(details.open, true); assert.deepEqual(h.focused, [id]);
    const markup = renderToStaticMarkup(display());
    assert.match(markup, new RegExp('<input[^>]*id="' + id + '"[^>]*aria-invalid="true"'));
    assert.doesNotMatch(markup, /<select[^>]*aria-invalid="true"/); assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('a response from a pre-refresh authorization read cannot overwrite the later confirmed service', async () => {
  const h = await harness({ focus: { serviceId: '81', variantId: '91', revision: 'original-link' } });
  try {
    const stale = deferred<unknown>(); h.setLoad(() => stale.promise);
    await h.setReady(false); await h.setReady(true);
    await h.setReady(false);
    h.setLoad(async () => { const next = snapshot('5', true); next.service!.name = 'Fresh authorized service'; return next; });
    await h.setReady(true);
    await act(async () => { const prior = snapshot('5', true); prior.service!.name = 'Stale authorization read'; stale.resolve(prior); });
    assert.equal(h.field('服务名称 *').props.value, 'Fresh authorized service'); assert.equal(h.commands.length, 0);
  } finally { await h.cleanup(); }
});

test('a server baseline rejection without field issues focuses its summary once and clearing it while typing never steals focus', async () => {
  const h = await harness();
  try {
    await h.click('编辑'); await h.change('服务名称 *', 'Rejected draft stays');
    const field = h.control(node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === '服务名称 *');
    const summaryId = field.props.fieldId.replace(/-name$/, '-error-summary'); h.element(summaryId, null, 'P');
    h.setSave(async () => { throw Object.assign(Error('Synthetic baseline conflict'), { status: 409 }); });
    await h.click('保存当前服务');
    assert.deepEqual(h.focused, [summaryId]); assert.deepEqual(h.scrolled, [summaryId]);
    const summary = h.control(node => node.type === 'p' && node.props.id === summaryId);
    assert.equal(summary.props.role, 'alert'); assert.equal(summary.props.tabIndex, -1);
    assert.equal(h.lifecycle().unknown, false); assert.equal(h.field('服务名称 *').props.value, 'Rejected draft stays');
    await h.change('服务名称 *', 'Typing after rejection'); assert.deepEqual(h.focused, [summaryId]);
    assert.equal(h.commands.length, 1); assert.equal(h.saved.length, 0); assert.equal(h.lifecycle().dirty, true);
  } finally { await h.cleanup(); }
});
