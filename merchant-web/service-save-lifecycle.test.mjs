import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Form, Grid, Modal, message } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { createServer } from 'vite';

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find([tree.props.children, tree.props.extra, tree.props.action, tree.props.footer], predicate);
};
const renderedText = tree => Array.isArray(tree) ? tree.map(renderedText).join('') : React.isValidElement(tree) ? renderedText(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const makeShop = id => ({ id, name: 'Synthetic shop ' + id, timezone: 'America/Los_Angeles',
  permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true });
const makeService = shopId => ({ id: shopId === '5' ? '51' : '61', shopId, name: 'Saved service ' + shopId,
  category: 'MASSAGE', durationKind: 'TIMED', durationMin: 60, reservedDurationMin: 60,
  priceCents: 8000, description: 'Original description', isActive: true, hasVariants: true });

async function harness(run, { embedded = false } = {}) {
  const previous = ['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal, oldBreakpoint = Grid.useBreakpoint;
  const oldUseForm = Form.useForm, oldUseWatch = Form.useWatch, oldSuccess = message.success, oldError = message.error;
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const confirmations = [], warnings = [], writes = [], reads = [], logouts = [], successes = [], errors = [], lifecycle = [], saved = [];
  let confirm = async () => true, patch, read, remove, tree, layoutTree, root, router, auth, context, values = {};
  let shops = ['5', '6'].map(makeShop), services = ['5', '6'].map(makeService);
  const form = { setFieldsValue: changes => { values = { ...values, ...changes }; }, resetFields: () => { values = {}; },
    validateFields: async () => structuredClone(values), getFieldsValue: () => structuredClone(values) };
  Form.useForm = () => [form]; Form.useWatch = key => values[key];
  Modal.useModal = () => [{ confirm: options => { confirmations.push(options); return confirm(options); }, info: options => { warnings.push(options); } }, null];
  Grid.useBreakpoint = () => ({ lg: true });
  message.success = text => successes.push(text); message.error = text => errors.push(text);
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(structuredClone(shops));
    if (config.url === '/auth/logout') { logouts.push(config); return response({ success: true }); }
    if (config.url.startsWith('/reservation-admin/shops/')) {
      const url = new URL(config.url, 'http://local.invalid'), shopId = url.pathname.split('/')[3], serviceId = url.searchParams.get('serviceId');
      reads.push(shopId);
      const source = read ? await read(shopId) : structuredClone(services.filter(service => service.shopId === shopId));
      const items = source.filter(service => service.id === serviceId).map(service => ({ ...service, nameEn: null, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1,
        requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, variantCount: service.hasVariants ? 1 : 0, addOnCount: 0,
        selectionRevision: 'a'.repeat(64), preview: null, addOns: [], variants: service.hasVariants ? [{ id: '511', serviceId, name: 'Saved variant', durationMin: 60,
          priceCents: 8000, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true, sortOrder: 0, preview: null }] : [] }));
      return response({ shopId, serviceId, search: '', status: 'all', page: 1, pageSize: 1, total: items.length, hasMore: false,
        canManageCatalog: true, canConfigurePolicy: false, items });
    }
    const [, shopId] = config.url.match(/^\/merchant\/shops\/(5|6)\/services$/) ?? [];
    if (shopId) { reads.push(shopId); return response(read ? await read(shopId) : structuredClone(services.filter(service => service.shopId === shopId))); }
    const [, id] = config.url.match(/^\/merchant\/services\/(51|61)$/) ?? [];
    assert.ok(id, 'unexpected request: ' + config.url);
    const changes = config.method === 'delete' ? null : JSON.parse(config.data);
    writes.push({ id, method: config.method, changes });
    if (config.method === 'delete') { if (remove) return response(await remove(id)); services = services.map(service => service.id === id ? { ...service, isActive: false } : service); return response({ success: true }); }
    assert.equal(config.method, 'patch');
    if (patch) return response(await patch(id, changes));
    services = services.map(service => service.id === id ? { ...service, ...changes } : service);
    return response(structuredClone(services.find(service => service.id === id)));
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const MerchantLayout = (await server.ssrLoadModule('/src/layouts/MerchantLayout.tsx')).default;
    const ServicesPage = (await server.ssrLoadModule('/src/pages/services/index.tsx')).default;
    const layout = MerchantLayout(), MerchantWorkspace = layout.props.children.type;
    const handlers = { beforeWrite: () => true, onLifecycleChange: state => lifecycle.push(state), onSaved: async () => { saved.push(true); } };
    function FormProbe() { tree = ServicesPage(embedded ? { projectEditor: { ...handlers, shopId: context.shopId, serviceId: context.shopId === '5' ? '51' : '61' } } : undefined); return null; }
    function WorkspaceProbe() {
      context = useShopId(); layoutTree = MerchantWorkspace();
      const location = useLocation();
      return location.pathname === '/services' ? React.createElement(FormProbe) : null;
    }
    auth.getState().setAuth('synthetic-1', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(layout.type, null, React.createElement(WorkspaceProbe)) }], { initialEntries: ['/services?shopId=5'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const table = () => { const result = find(tree, node => Array.isArray(node.props.dataSource) && Array.isArray(node.props.columns)); assert.ok(result, 'real ServicesPage table'); return result.props; };
    const editor = () => { const result = find(tree, node => node.props.form === form); assert.ok(result, 'real service edit form'); return result.props; };
    const editModal = () => { const result = find(tree, node => ['编辑服务', '新增服务'].includes(node.props.title) && node.props.onOk); assert.ok(result, 'real service edit modal'); return result.props; };
    const button = label => { const result = find(tree, node => renderedText(node.props.children) === label && node.props.onClick); assert.ok(result, 'control: ' + label); return result.props; };
    const action = (label, predicate) => {
      const record = table().dataSource[0];
      const cell = table().columns.find(column => column.key === 'action').render(null, record);
      const result = find(cell, predicate ?? (node => renderedText(node.props.children) === label && node.props.onClick));
      assert.ok(result, 'row control: ' + label); return result.props;
    };
    const status = () => table().columns.find(column => column.key === 'isActive').render(true, table().dataSource[0]).props;
    const header = predicate => { const result = find(layoutTree, predicate); assert.ok(result, 'real MerchantWorkspace header control'); return result.props; };
    await run({ writes, reads, logouts, confirmations, warnings, successes, errors, lifecycle, saved, editor, editModal, button, action, status, router, auth,
      open: () => act(async () => { (embedded ? button('编辑服务共同资料') : action('编辑')).onClick(); }),
      change: next => act(async () => { form.setFieldsValue(next); editor().onValuesChange(next); }),
      save: () => act(async () => { await editModal().onOk(); }),
      switchShop: id => act(async () => { header(node => node.props['aria-label'] === '已授权门店').onChange(id); }),
      logout: () => act(async () => { await header(node => node.props.children === '退出登录').onClick(); }),
      actor: id => act(async () => { auth.getState().setAuth('synthetic-' + id, { id, role: 'ADMIN' }); }),
      refresh: () => act(async () => { await context.reloadShop('5'); }),
      unmount: () => act(async () => { root.unmount(); root = undefined; }),
      values: () => structuredClone(values), table, tree: () => tree,
      setRead: next => { read = next; }, setPatch: next => { patch = next; }, setRemove: next => { remove = next; }, setConfirm: next => { confirm = next; },
      setShops: next => { shops = next; }, shops: () => structuredClone(shops),
      setServices: next => { services = next; }, services: () => structuredClone(services),
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal; Grid.useBreakpoint = oldBreakpoint;
    Form.useForm = oldUseForm; Form.useWatch = oldUseWatch; message.success = oldSuccess; message.error = oldError;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('old same-service success contents cannot claim an edit succeeded or discard its draft', () => harness(async h => {
  await h.open(); await h.change({ name: 'Requested service', description: 'Requested description', category: 'CUPPING' });
  h.setPatch(() => makeService('5'));
  await h.save();
  assert.equal(h.editModal().open, true, 'unmatched receipt keeps the current edit visible');
  assert.equal(h.editor().disabled, true, 'unmatched receipt is uncertain rather than an editable retry');
  assert.equal(h.values().name, 'Requested service');
  assert.equal(find(h.tree(), node => node.props.title?.includes?.('本服务共同资料已更新')), undefined);
  await h.logout(); assert.equal(h.logouts.length, 0);
}));

test('captured save callbacks cannot resubmit after an uncertain edit, and same-turn saves write once', () => harness(async h => {
  await h.open(); await h.change({ name: 'Submitted once' });
  const save = h.editModal().onOk, pending = deferred(); h.setPatch(() => pending.promise);
  await act(async () => { save(); save(); }); assert.equal(h.writes.length, 1);
  await act(async () => { pending.reject(new Error('Synthetic lost receipt')); });
  assert.equal(h.editor().disabled, true);
  await act(async () => { await save(); });
  assert.equal(h.writes.length, 1, 'a callback captured before unknown cannot bypass the synchronous unknown fence');
  await h.switchShop('6'); await h.logout(); assert.equal(h.logouts.length, 0); assert.match(h.router.state.location.search, /shopId=5/);
}));

test('verified edit receipt still requires readback of the submitted service intent', () => harness(async h => {
  await h.open(); await h.change({ name: 'Requested but not read back' });
  h.setPatch((id, changes) => ({ ...makeService('5'), ...changes }));
  await h.save();
  assert.equal(h.editModal().open, true); assert.equal(h.editor().disabled, true);
  assert.equal(h.values().name, 'Requested but not read back');
}));

test('matched read-only recovery settles uncertain edits without another mutation', () => harness(async h => {
  await h.open(); await h.change({ name: 'Committed response lost', description: '' });
  h.setPatch((id, changes) => { h.setServices(h.services().map(service => service.id === id ? { ...service, ...changes, description: null } : service)); throw new Error('Synthetic lost response'); });
  await h.save();
  const before = h.reads.length;
  await act(async () => { await h.button('只读核对本次保存结果').onClick(); });
  assert.equal(h.reads.length, before + 1); assert.equal(h.writes.length, 1);
  assert.equal(h.editModal().open, false); await h.switchShop('6'); assert.match(h.router.state.location.search, /shopId=6/);
}));

test('definite rejections preserve editable input; foreign and late identity receipts never settle the next actor', () => harness(async h => {
  await h.open(); await h.change({ name: 'Rejected draft' });
  h.setPatch(() => { throw Object.assign(new Error('Synthetic conflict'), { response: { status: 409 } }); });
  await h.save(); assert.equal(h.editor().disabled, false); assert.equal(h.values().name, 'Rejected draft');
  const pending = deferred(); h.setPatch(() => pending.promise);
  await act(async () => { h.editModal().onOk(); });
  await h.actor('2'); await act(async () => { pending.resolve({ ...makeService('5'), name: 'Rejected draft' }); });
  assert.equal(h.editModal().open, false); assert.equal(h.table().dataSource[0].name, 'Saved service 5');
  await h.open(); await h.change({ name: 'Actor 2 draft' });
  h.setPatch((id, changes) => ({ ...makeService('5'), ...changes, shopId: '6' }));
  await h.save(); assert.equal(h.editModal().open, true); assert.equal(h.editor().disabled, true);
}));

test('uncertain status mutations block inverse writes until matching read-only service recovery', () => harness(async h => {
  const toggle = h.status().onChange;
  h.setPatch((id, changes) => { h.setServices(h.services().map(service => service.id === id ? { ...service, ...changes } : service)); throw new Error('Synthetic status response lost'); });
  await act(async () => { await toggle(false); });
  await act(async () => { await toggle(true); });
  assert.equal(h.writes.length, 1, 'lost disable receipt cannot be followed by a stale inverse toggle');
  await h.logout(); assert.equal(h.logouts.length, 0);
  await act(async () => { await h.button('只读核对本次保存结果').onClick(); });
  assert.equal(h.table().dataSource[0].isActive, false); assert.equal(h.status().disabled, false);
}));

test('disable waits for a matching active-state readback before success and locks unknown responses', () => harness(async h => {
  h.setRemove(() => ({ success: true }));
  await act(async () => { await h.action('停用', node => node.props.onConfirm).onConfirm(); });
  assert.equal(h.successes.length, 0, 'an unchanged active service is not successful disable');
  assert.equal(h.status().disabled, true);
  await h.logout(); assert.equal(h.logouts.length, 0);
}));

test('embedded common information edits compare only submitted metadata and retain unusable legacy base values', () => harness(async h => {
  h.setServices(h.services().map(service => ({ ...service, durationMin: 15, reservedDurationMin: 15, priceCents: 0 })));
  await h.open(); await h.change({ name: 'Shared updated name', description: 'Shared updated description', category: 'CUPPING', price: 999, durationMin: 999 });
  await h.save();
  assert.equal(h.editModal().open, false); assert.equal(h.saved.length, 1);
  assert.deepEqual(h.writes[0].changes, { name: 'Shared updated name', category: 'CUPPING', description: 'Shared updated description', isActive: true });
  assert.equal(h.services()[0].durationMin, 15); assert.equal(h.services()[0].priceCents, 0);
  assert.equal(h.lifecycle.at(-1).unknown, false);
}, { embedded: true }));

test('embedded unknown recovery preserves drafts on old, missing or malformed readback and permission refresh', () => harness(async h => {
  await h.open(); await h.change({ name: 'Embedded retained draft' });
  h.setPatch(() => { throw new Error('Synthetic lost receipt'); }); await h.save();
  const oldSave = h.editModal().onOk;
  await act(async () => { await h.button('只读核对本次保存结果').onClick(); });
  assert.equal(h.editModal().open, true); assert.equal(h.values().name, 'Embedded retained draft'); assert.equal(h.lifecycle.at(-1).unknown, true);
  h.setRead(() => []); await act(async () => { await h.button('只读核对本次保存结果').onClick(); });
  assert.equal(h.editor().disabled, true); assert.equal(h.values().name, 'Embedded retained draft');
  h.setRead(() => [{ ...makeService('5'), description: 42 }]);
  await act(async () => { await h.button('只读核对本次保存结果').onClick(); });
  h.setShops(h.shops().map(shop => ({ ...shop, permissions: [] }))); await h.refresh();
  await act(async () => { await oldSave(); }); assert.equal(h.writes.length, 1);
  assert.equal(h.lifecycle.at(-1).unknown, true); assert.equal(h.values().name, 'Embedded retained draft');
  h.setShops(h.shops().map(shop => ({ ...shop, permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'] }))); await h.refresh();
  h.setRead(undefined); h.setServices(h.services().map(service => service.id === '51' ? { ...service, name: 'Embedded retained draft' } : service));
  await act(async () => { await h.button('只读核对本次保存结果').onClick(); });
  assert.equal(h.editModal().open, false); assert.equal(h.saved.length, 1); assert.equal(h.writes.length, 1);
}, { embedded: true }));

test('explicit unknown discard is guarded across a session change and old edit callbacks cannot write for the next actor', () => harness(async h => {
  await h.open(); await h.change({ name: 'Actor 1 uncertain draft' }); const oldSave = h.editModal().onOk;
  h.setPatch(() => { throw new Error('Synthetic lost receipt'); }); await h.save();
  const pending = deferred(); h.setConfirm(() => pending.promise);
  await act(async () => { h.button('结束草稿并核对').onClick(); });
  const readCount = h.reads.length;
  await h.actor('2'); await h.open(); await h.change({ name: 'Actor 2 new draft' });
  await act(async () => { pending.resolve(true); await oldSave(); });
  assert.equal(h.writes.length, 1); assert.equal(h.values().name, 'Actor 2 new draft'); assert.equal(h.editModal().open, true);
  assert.equal(h.editor().disabled, false); assert.equal(h.reads.length, readCount + 1, 'only the new actor mounted service list was read');
}));

test('late service save after unmount cannot refresh or announce the detached embedded editor', () => harness(async h => {
  await h.open(); await h.change({ name: 'Unmounted edit' });
  const pending = deferred(); h.setPatch(() => pending.promise);
  await act(async () => { h.editModal().onOk(); }); const before = h.reads.length;
  await h.unmount(); await act(async () => { pending.resolve({ ...makeService('5'), name: 'Unmounted edit' }); });
  assert.equal(h.reads.length, before); assert.equal(h.saved.length, 0); assert.equal(h.successes.length, 0);
  assert.deepEqual(h.lifecycle.at(-1), { dirty: false, busy: false, unknown: false });
}, { embedded: true }));

test('a verified normal status change and disable remain usable without recovery or duplicate writes', () => harness(async h => {
  await act(async () => { h.status().onChange(false); });
  assert.equal(h.writes.length, 1); assert.equal(h.table().dataSource[0].isActive, false); assert.equal(h.status().disabled, false);
  await act(async () => { h.status().onChange(true); });
  assert.equal(h.writes.length, 2); assert.equal(h.table().dataSource[0].isActive, true);
  await act(async () => { await h.action('停用', node => node.props.onConfirm).onConfirm(); });
  assert.equal(h.writes.length, 3); assert.equal(h.writes.at(-1).method, 'delete');
  assert.equal(h.table().dataSource[0].isActive, false); assert.equal(h.status().disabled, false);
  assert.equal(h.successes.length, 3);
}));

test('explicitly ending an unmatched edit requires confirmation and invalidates its captured save callback', () => harness(async h => {
  await h.open(); await h.change({ name: 'Explicitly abandoned edit' }); const oldSave = h.editModal().onOk;
  h.setPatch(() => { throw Error('Synthetic lost receipt'); }); await h.save();
  h.setConfirm(async () => false); await act(async () => { h.button('结束草稿并核对').onClick(); });
  assert.equal(h.editModal().open, true); assert.equal(h.values().name, 'Explicitly abandoned edit');
  h.setConfirm(async () => true); await act(async () => { h.button('结束草稿并核对').onClick(); });
  assert.equal(h.editModal().open, false); assert.match(h.confirmations.at(-1).content, /可能稍后完成/);
  await act(async () => { await oldSave(); }); assert.equal(h.writes.length, 1);
  await h.logout(); assert.equal(h.logouts.length, 1);
}));
