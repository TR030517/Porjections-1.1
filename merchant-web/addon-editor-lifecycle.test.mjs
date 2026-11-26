import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Form, Modal } from 'antd';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { createServer } from 'vite';

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const find = (tree, predicate) => {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  return predicate(tree) ? tree : find([tree.props.children, tree.props.extra, tree.props.action, tree.props.footer, tree.props.items?.map(item => item.children)], predicate);
};
const draft = { name: 'Aromatherapy', description: 'Saved original description', price: '12.50', isActive: true, sortOrder: 2 };

async function harness(run, { embedded = false } = {}) {
  const previous = ['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldUseModal = Modal.useModal, oldUseForm = Form.useForm, oldUseWatch = Form.useWatch;
  const doc = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; doc.defaultView = win;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Modal.useModal = () => [{ confirm: async () => true }, null];
  Form.useForm = () => [React.useMemo(() => {
    let values = {};
    return { resetFields() { values = {}; }, setFieldsValue(next) { values = { ...values, ...next }; }, getFieldsValue() { return values; }, validateFields: async () => values };
  }, [])];
  Form.useWatch = () => undefined;
  const writes = [], reads = [], variantWriteGates = [];
  let tree, pageTree, lifecycle, mainLifecycle, context, root, router, auth, saveFailure, setEmbeddedShop, readResult = async () => {}, actor = 1, childMounted = false;
  let shops = ['5', '6'].map(id => ({ id, name: 'Synthetic shop ' + id, timezone: 'America/Los_Angeles', permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true }));
  const service = { id: '9', shopId: '5', name: 'Massage', nameEn: null, description: 'Saved service description', category: 'MASSAGE', isActive: true,
    selectionRevision: 'a'.repeat(64), durationKind: 'TIMED', durationMin: 60, priceCents: 8000, priceBasis: 'PER_BOOKING', participantCount: 1,
    requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, hasVariants: false, variantCount: 0,
    addOnCount: 1, preview: null, variants: [], addOns: [{ id: '88', serviceId: '9', name: 'Existing add-on', description: 'Existing description', priceCents: 1000, currency: 'usd', isActive: true, sortOrder: 0, preview: null }] };
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(structuredClone(shops));
    const catalogShop = config.url.match(/^\/reservation-admin\/shops\/(5|6)\/project-catalog\?/);
    if (config.method === 'get' && catalogShop) {
      reads.push('catalog'); await readResult();
      const selectedShop = shops.find(shop => shop.id === catalogShop[1]);
      return response({ shopId: selectedShop.id, search: '', status: 'all', page: 1, pageSize: 1, serviceId: '9', total: 1, hasMore: false,
        canManageCatalog: selectedShop.permissions.includes('CATALOG_MANAGE'), canConfigurePolicy: selectedShop.permissions.includes('RESERVATION_CONFIG'), items: [{ ...structuredClone(service), shopId: selectedShop.id }] });
    }
    const payload = config.data ? JSON.parse(config.data) : null;
    if (config.url === '/reservation-admin/shops/5/variants' && config.method === 'post') {
      writes.push({ method: config.method, payload, resource: 'variants' });
      const gate = variantWriteGates.shift(); return response(gate ? await gate.promise : { item: { id: '99' } });
    }
    assert.match(config.url, /^\/reservation-admin\/shops\/5\/add-ons(?:\/88)?$/);
    writes.push({ method: config.method, payload });
    if (saveFailure) throw saveFailure;
    return response(config.method === 'delete' ? { success: true } : { item: { id: '88', ...payload } });
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const AddOnEditor = (await server.ssrLoadModule('/src/components/ServiceAddOnEditor.tsx')).default;
    const ReservationsPage = embedded ? (await server.ssrLoadModule('/src/pages/reservations/index.tsx')).default : undefined;
    const onSaved = async () => { reads.push('read'); await readResult(); };
    const onLifecycleChange = value => { lifecycle = value; };
    function Probe() { context = useShopId(); tree = AddOnEditor({ shopId: '5', service, onSaved, onLifecycleChange }); return null; }
    const parentLifecycle = value => { mainLifecycle = value; };
    function ChildProbe({ props }) {
      const callback = React.useRef(props.onLifecycleChange); callback.current = props.onLifecycleChange;
      const trackLifecycle = React.useCallback(value => { lifecycle = value; callback.current(value); }, []);
      React.useEffect(() => { childMounted = true; return () => { childMounted = false; }; }, []);
      tree = AddOnEditor({ ...props, onLifecycleChange: trackLifecycle }); return null;
    }
    function EmbeddedProbe() {
      context = useShopId(); const [revision, setRevision] = React.useState(0), [shopId, setShopId] = React.useState('5'); setEmbeddedShop = setShopId;
      pageTree = ReservationsPage({ projectEditor: { shopId, serviceId: '9', revision, disabled: false, beforeWrite: () => true,
        onLifecycleChange: parentLifecycle, onSaved: async () => { setRevision(value => value + 1); } } });
      const child = find(pageTree, node => node.type === AddOnEditor);
      return child ? React.createElement(ChildProbe, { props: child.props, key: child.key }) : null;
    }
    auth.getState().setAuth('synthetic-1', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(embedded ? EmbeddedProbe : Probe)) }], { initialEntries: ['/price-menu?shopId=5'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const control = predicate => { const node = find(tree, predicate); assert.ok(node, 'expected add-on control'); return node; };
    const button = label => control(node => node.props.children === label && typeof node.props.onClick === 'function').props;
    const form = () => control(node => node.props.form && node.props.onValuesChange).props;
    const modal = () => control(node => node.type === Modal && node.props.title === '新增附加项目').props;
    const mainControl = predicate => { const node = find(pageTree, predicate); assert.ok(node, 'expected main reservation control'); return node.props; };
    const mainModal = () => mainControl(node => node.type === Modal && typeof node.props.okText === 'string' && node.props.okText.startsWith('保存当前'));
    const mainForm = () => mainControl(node => node.props.form && node.props.onValuesChange);
    await run({
      writes, reads, lifecycle: () => lifecycle, button, form, modal, mounted: () => childMounted,
      click: label => act(async () => { button(label).onClick(); }),
      open: () => act(async () => { button('新增附加项目').onClick(); }),
      change: values => act(async () => { form().form.setFieldsValue(values); form().onValuesChange(values); }),
      setRead: next => { readResult = next; }, setSaveFailure: value => { saveFailure = value; },
      revoke: () => act(async () => { shops = shops.map(shop => ({ ...shop, permissions: [] })); await context.reloadShop('5'); }),
      restore: () => act(async () => { shops = shops.map(shop => ({ ...shop, permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'] })); await context.reloadShop('5'); }),
      changeActor: () => act(async () => { actor++; auth.getState().setAuth('synthetic-' + actor, { id: String(actor), role: 'ADMIN' }); }),
      forceShopChange: async () => { await act(async () => { setEmbeddedShop('6'); }); await act(async () => { await router.navigate('/price-menu?shopId=6'); }); },
      mainModal, mainForm, mainLifecycle: () => mainLifecycle,
      openVariant: () => act(async () => { mainControl(node => node.props.children === '新增规格' && typeof node.props.onClick === 'function').onClick(); }),
      changeVariant: values => act(async () => { mainForm().form.setFieldsValue(values); mainForm().onValuesChange(values); }),
      saveVariant: () => act(async () => { mainModal().onOk(); }), queueVariantWrite: gate => variantWriteGates.push(gate),
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldUseModal; Form.useForm = oldUseForm; Form.useWatch = oldUseWatch;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('acknowledged add-on save retains the draft until readback; failed readback recovers without reposting', () => harness(async h => {
  await h.open(); await h.change(draft);
  const pending = deferred(); h.setRead(() => pending.promise);
  const capturedSave = h.button('保存附加项目').onClick;
  await act(async () => { capturedSave(); });
  assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 1);
  assert.equal(h.modal().open, true, 'readback is part of completing a save');
  assert.equal(h.lifecycle().dirty, true); assert.deepEqual(h.form().form.getFieldsValue(), draft);
  await act(async () => { pending.reject(new Error('Synthetic readback failed')); });
  assert.equal(h.modal().open, true); assert.equal(h.lifecycle().unknown, true); assert.equal(h.lifecycle().dirty, true);
  assert.deepEqual(h.form().form.getFieldsValue(), draft); assert.equal(h.button('保存附加项目').disabled, true);
  await act(async () => { capturedSave(); });
  assert.equal(h.writes.length, 1, 'even a captured pre-failure handler cannot submit again');
  h.setRead(async () => { throw Error('Synthetic reconciliation failed'); });
  await h.click('关闭');
  assert.equal(h.modal().open, true); assert.equal(h.lifecycle().unknown, true); assert.deepEqual(h.form().form.getFieldsValue(), draft);
  h.setRead(async () => {}); await h.click('关闭');
  assert.equal(h.modal().open, false); assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false });
  assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 3);
}));

test('definitively rejected add-on save preserves editable input and permits a corrected retry', () => harness(async h => {
  await h.open(); await h.change(draft);
  h.setSaveFailure(Object.assign(Error('Synthetic rejected input'), { response: { status: 409 } }));
  await h.click('保存附加项目');
  assert.equal(h.modal().open, true); assert.equal(h.lifecycle().dirty, true); assert.equal(h.lifecycle().unknown, false);
  assert.deepEqual(h.form().form.getFieldsValue(), draft); assert.equal(h.reads.length, 0);
  h.setSaveFailure(undefined); await h.change({ price: '15.00' }); await h.click('保存附加项目');
  assert.equal(h.writes.length, 2); assert.equal(h.writes[1].payload.priceCents, 1500);
  assert.equal(h.modal().open, false); assert.equal(h.lifecycle().dirty, false); assert.equal(h.reads.length, 1);
}));

test('interrupted add-on response locks fresh and captured handlers until read-only reconciliation', () => harness(async h => {
  await h.open(); await h.change(draft); h.setSaveFailure(Error('Synthetic interrupted response'));
  const capturedSave = h.button('保存附加项目').onClick;
  await act(async () => { capturedSave(); });
  assert.equal(h.lifecycle().unknown, true); assert.equal(h.modal().open, true);
  await act(async () => { capturedSave(); });
  assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 0);
  await h.click('关闭'); assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 1); assert.equal(h.modal().open, false);
}));

test('acknowledged disable followed by read failure locks repeat deletion and recovers by reading only', () => harness(async h => {
  h.setRead(async () => { throw Error('Synthetic post-disable read failed'); });
  const capturedDisable = h.button('停用').onClick;
  await act(async () => { capturedDisable(); });
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].method, 'delete'); assert.equal(h.lifecycle().unknown, true);
  assert.equal(h.button('新增附加项目').disabled, true);
  await act(async () => { capturedDisable(); }); assert.equal(h.writes.length, 1);
  h.setRead(async () => {}); await h.click('刷新并核对原操作');
  assert.equal(h.writes.length, 1); assert.equal(h.reads.length, 2); assert.equal(h.lifecycle().unknown, false);
}));

test('permission revocation preserves the failed-readback draft and blocks old write callbacks', () => harness(async h => {
  await h.open(); await h.change(draft); const pending = deferred(); h.setRead(() => pending.promise);
  const capturedSave = h.button('保存附加项目').onClick;
  await act(async () => { capturedSave(); }); await h.revoke();
  await act(async () => { pending.reject(Error('Synthetic read failed after revocation')); });
  assert.equal(h.modal().open, true); assert.equal(h.lifecycle().dirty, true); assert.equal(h.lifecycle().unknown, true);
  assert.deepEqual(h.form().form.getFieldsValue(), draft);
  await act(async () => { capturedSave(); }); assert.equal(h.writes.length, 1);
}));

test('late readback from the prior account cannot restore its draft or unknown lock into the new account', () => harness(async h => {
  await h.open(); await h.change(draft); const pending = deferred(); h.setRead(() => pending.promise);
  await h.click('保存附加项目'); await h.changeActor();
  await act(async () => { pending.reject(Error('Synthetic prior-account read failed')); });
  assert.equal(h.modal().open, false); assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false });
  assert.equal(h.writes.length, 1);
}));

test('real reservation parent retains the add-on editor across a saved catalog revision and failed configuration readback', () => harness(async h => {
  assert.equal(h.mounted(), true); await h.open(); await h.change(draft);
  const pending = deferred(); h.setRead(() => pending.promise);
  await h.click('保存附加项目');
  assert.equal(h.writes.length, 1); assert.equal(h.mounted(), true, 'parent revision must not unmount an in-flight add-on draft');
  assert.equal(h.modal().open, true); assert.deepEqual(h.form().form.getFieldsValue(), draft);
  await act(async () => { pending.reject(Error('Synthetic saved-catalog read failed')); });
  assert.equal(h.mounted(), true, 'failed refresh must preserve the child and its recovery control');
  assert.equal(h.lifecycle().unknown, true); assert.deepEqual(h.form().form.getFieldsValue(), draft);
  h.setRead(async () => {}); await h.click('关闭');
  assert.equal(h.writes.length, 1); assert.equal(h.mounted(), true); assert.equal(h.modal().open, false);
  assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false });
}, { embedded: true }));

test('real reservation parent preserves a same-account add-on draft during permission revocation and permits read-only recovery after restoration', () => harness(async h => {
  await h.open(); await h.change(draft); const pending = deferred(); h.setRead(() => pending.promise);
  const capturedSave = h.button('保存附加项目').onClick;
  await act(async () => { capturedSave(); }); await h.revoke();
  assert.equal(h.mounted(), true, 'revocation removes write access but must not discard this actor draft');
  assert.deepEqual(h.form().form.getFieldsValue(), draft); assert.equal(h.button('保存附加项目').disabled, true);
  await act(async () => { pending.reject(Error('Synthetic revoked-permission read failed')); });
  assert.equal(h.mounted(), true); assert.equal(h.lifecycle().unknown, true);
  await act(async () => { capturedSave(); }); assert.equal(h.writes.length, 1);
  h.setRead(async () => {}); await h.restore(); await h.click('关闭');
  assert.equal(h.writes.length, 1); assert.equal(h.modal().open, false); assert.equal(h.lifecycle().unknown, false);
}, { embedded: true }));

test('real reservation parent destroys the old account add-on draft and ignores its late readback', () => harness(async h => {
  await h.open(); await h.change(draft); const pending = deferred(); h.setRead(() => pending.promise);
  await h.click('保存附加项目'); h.setRead(async () => {}); await h.changeActor();
  await act(async () => { pending.reject(Error('Synthetic former-account read failed')); });
  assert.equal(h.mounted(), true); assert.equal(h.modal().open, false);
  assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false }); assert.equal(h.writes.length, 1);
}, { embedded: true }));

test('real reservation parent isolates a forced shop change from the old add-on save and readback', () => harness(async h => {
  await h.open(); await h.change(draft); const pending = deferred(); h.setRead(() => pending.promise);
  const capturedSave = h.button('保存附加项目').onClick;
  await act(async () => { capturedSave(); }); h.setRead(async () => {}); await h.forceShopChange();
  await act(async () => { pending.reject(Error('Synthetic former-shop read failed')); capturedSave(); });
  assert.equal(h.mounted(), true); assert.equal(h.modal().open, false);
  assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false }); assert.equal(h.writes.length, 1);
}, { embedded: true }));

test('real reservation parent clears the prior account main-variant draft and keeps its late completion outside the new scope lock', () => harness(async h => {
  const oldWrite = deferred(), nextWrite = deferred();
  await h.openVariant(); await h.changeVariant({ name: 'Prior account option', durationMin: 60, priceUsd: 60, sortOrder: 0, isActive: true });
  const oldSave = h.mainModal().onOk; h.queueVariantWrite(oldWrite); await h.saveVariant();
  assert.equal(h.writes.length, 1); assert.equal(h.mainModal().confirmLoading, true);
  await h.changeActor();
  assert.equal(h.mainModal().open, false, 'a forced account change must destroy the prior main editor');
  assert.equal(h.mainLifecycle().dirty, false); assert.equal(h.mainForm().form.getFieldsValue().name, undefined);
  await h.openVariant(); await h.changeVariant({ name: 'Current account option', durationMin: 90, priceUsd: 90, sortOrder: 0, isActive: true });
  h.queueVariantWrite(nextWrite); await h.saveVariant(); assert.equal(h.writes.length, 2);
  await act(async () => { oldWrite.resolve({ item: { id: '99' } }); oldSave(); });
  assert.equal(h.mainModal().confirmLoading, true, 'old finally must not clear the current operation lock');
  assert.equal(h.mainForm().form.getFieldsValue().name, 'Current account option');
  await h.saveVariant(); assert.equal(h.writes.length, 2);
  await act(async () => { nextWrite.resolve({ item: { id: '100' } }); });
  assert.equal(h.mainModal().open, false); assert.equal(h.mainModal().confirmLoading, false); assert.equal(h.mainLifecycle().dirty, false);
}, { embedded: true }));
