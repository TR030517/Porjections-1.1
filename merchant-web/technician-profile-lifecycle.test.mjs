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
  return predicate(tree) ? tree : find([tree.props.children, tree.props.extra, tree.props.action, tree.props.items?.map(item => item.children)], predicate);
};
const person = (shopId, id, name) => ({ id, shopId, name, avatarUrl: null, title: null, bio: null, yearsExp: 0,
  gender: null, isActive: true, scheduleMode: 'SHOP', sortOrder: 0 });
const snapshot = shopId => ({ shopId, activeCount: 2, revision: 'a'.repeat(64), serviceAccessMode: 'SHOP_ALL',
  canManageStaff: true, canManageExceptions: true,
  therapists: [person(shopId, shopId === '5' ? '80' : '90', 'Synthetic first ' + shopId), person(shopId, shopId === '5' ? '81' : '91', 'Synthetic second ' + shopId)] });

async function harness(run) {
  const previous = ['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldModal = Modal.useModal, oldForm = Form.useForm;
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const confirmations = [], writes = [], reads = [];
  let confirm = async () => true, patch, read, root, router, auth, tree, shopContext;
  const snapshots = { '5': snapshot('5'), '6': snapshot('6') };
  let shops = ['5', '6'].map(id => ({ id, name: 'Synthetic shop ' + id, permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'], accessType: 'ADMIN', isOwner: true }));
  Modal.useModal = () => [{ confirm: options => { confirmations.push(options); return confirm(options); }, info() {} }, null];
  Form.useForm = () => [React.useMemo(() => {
    let values = {};
    return { resetFields() { values = {}; }, setFieldsValue(next) { values = { ...values, ...next }; }, getFieldsValue() { return { ...values }; }, async validateFields() { return { ...values }; } };
  }, [])];
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') return response(structuredClone(shops));
    const [, shopId] = config.url.match(/^\/reservation-admin\/shops\/(5|6)\/staffing$/) ?? [];
    if (shopId) { assert.equal(config.method, 'get', 'this suite never adjusts staff counts'); reads.push(shopId); return response(read ? await read(shopId) : structuredClone(snapshots[shopId])); }
    const [, id] = config.url.match(/^\/merchant\/therapists\/(80|81|90|91)$/) ?? [];
    assert.ok(id, 'unexpected synthetic request ' + config.url); assert.equal(config.method, 'patch');
    const values = JSON.parse(config.data); writes.push({ id, values });
    if (patch) return response(await patch(id, values));
    const scoped = Number(id) < 90 ? '5' : '6', row = snapshots[scoped].therapists.find(item => item.id === id);
    Object.assign(row, values); return response(structuredClone(row));
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const { MerchantDraftGuard } = await server.ssrLoadModule('/src/components/MerchantDraftGuard.tsx');
    const { default: TechniciansPage, TechnicianCards } = await server.ssrLoadModule('/src/pages/technicians/index.tsx');
    function Probe() { shopContext = useShopId(); tree = TechniciansPage(); return null; }
    auth.getState().setAuth('synthetic-staff', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(MerchantDraftGuard, null, React.createElement(Probe)) }], { initialEntries: ['/technicians?shopId=5'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const form = () => { const result = find(tree, node => node.type === Form && node.props.form); assert.ok(result, 'real technician profile form'); return result.props; };
    const modal = () => { const result = find(tree, node => node.type === Modal && node.props.title === '编辑个人资料'); assert.ok(result, 'real technician profile modal'); return result.props; };
    const button = label => { const result = find(tree, node => node.props.children === label && node.props.onClick); assert.ok(result, 'control ' + label); return result.props; };
    await run({ writes, reads, confirmations, snapshots, form, modal, button, tree: () => tree, auth, router,
      edit: index => act(async () => { const cards = find(tree, node => node.type === TechnicianCards); cards.props.onEdit(cards.props.staff[index]); }),
      change: values => act(async () => { form().form.setFieldsValue(values); form().onValuesChange(values); }),
      save: () => act(async () => { modal().onOk(); }),
      recover: () => act(async () => { button('重新读取并核对').onClick(); }),
      close: () => act(async () => { modal().onCancel(); }),
      actor: id => act(async () => { auth.getState().setAuth('synthetic-' + id, { id, role: 'ADMIN' }); }),
      refreshShop: () => act(async () => { await shopContext.reloadShop('5'); }),
      setShops: next => { shops = next; }, shops: () => structuredClone(shops),
      setRead: next => { read = next; }, setPatch: next => { patch = next; }, setConfirm: next => { confirm = next; },
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldModal; Form.useForm = oldForm;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

for (const mode of ['stale receipt', 'stale readback', 'failed readback', 'lost receipt']) test(`a ${mode} preserves the original technician draft and recovers only by matching GET`, () => harness(async h => {
  await h.edit(0); await h.change({ name: 'Desired profile', bio: 'Desired introduction' });
  const captured = h.modal().onOk, pending = deferred();
  h.setPatch(async (_id, values) => {
    await pending.promise;
    if (mode === 'lost receipt') throw new Error('Synthetic lost profile receipt');
    return { ...h.snapshots['5'].therapists[0], ...(mode === 'stale receipt' ? {} : values) };
  });
  if (mode === 'failed readback') h.setRead(() => { throw new Error('Synthetic profile readback offline'); });
  await act(async () => { captured(); captured(); });
  assert.equal(h.writes.length, 1, 'same-turn double clicks share the synchronous operation fence');
  await act(async () => { pending.resolve(); });
  assert.equal(h.modal().open, true, 'unverified profile results keep the original modal');
  assert.equal(h.form().disabled, true, 'uncertain profile is locked until read-only reconciliation');
  assert.equal(h.form().form.getFieldsValue().name, 'Desired profile');
  await act(async () => { captured(); }); assert.equal(h.writes.length, 1, 'a captured old callback cannot retry the unknown PATCH');
  if (mode === 'failed readback') { await h.recover(); assert.equal(h.modal().open, true); assert.equal(h.form().disabled, true); }
  h.setRead(undefined); await h.recover();
  assert.equal(h.modal().open, true); assert.equal(h.form().disabled, true, 'valid old personnel is not proof of the attempted update');
  Object.assign(h.snapshots['5'].therapists[0], { name: 'Desired profile', bio: 'Desired introduction' });
  await h.recover(); assert.equal(h.modal().open, false, 'matching GET resolves the original write without submitting again');
  assert.equal(h.writes.length, 1);
}));

test('mismatching read-only recovery needs an explicit acknowledgement and retains the operator draft', () => harness(async h => {
  await h.edit(0); await h.change({ name: 'Desired profile after review' });
  h.setPatch(() => { throw new Error('Synthetic interrupted profile'); }); await h.save(); await h.recover();
  assert.equal(h.form().disabled, true); assert.equal(h.confirmations.length, 0);
  await act(async () => { await h.button('已核对，继续编辑').onClick(); });
  assert.equal(h.confirmations.length, 1); assert.match(h.confirmations[0].content, /不会撤销保存/);
  assert.equal(h.form().disabled, false); assert.equal(h.form().form.getFieldsValue().name, 'Desired profile after review');
  assert.equal(h.writes.length, 1, 'acknowledgement never performs a write');
  h.setPatch(undefined); await h.save(); assert.equal(h.writes.length, 2); assert.equal(h.modal().open, false);
}));

test('a matching technician save completes once, while a definite conflict preserves an editable draft', () => harness(async h => {
  await h.edit(0); await h.change({ name: 'Saved profile' });
  await h.save(); assert.equal(h.modal().open, false); assert.equal(h.writes.length, 1);
  await h.edit(0); await h.change({ title: 'Draft title' });
  h.setPatch(() => { throw Object.assign(new Error('Synthetic staff conflict'), { response: { status: 409, data: { message: 'Synthetic staff conflict' } } }); });
  await h.save(); assert.equal(h.modal().open, true); assert.equal(h.form().disabled, false);
  assert.equal(h.form().form.getFieldsValue().title, 'Draft title');
  h.setPatch(undefined); await h.save(); assert.equal(h.modal().open, false); assert.equal(h.writes.length, 3);
}));

test('closed and superseded technician modal callbacks cannot write or close a new draft', () => harness(async h => {
  await h.edit(0); await h.change({ name: 'Discarded first profile' });
  const staleSave = h.modal().onOk, staleClose = h.modal().onCancel;
  await h.close(); assert.equal(h.modal().open, false);
  await act(async () => { staleSave(); }); assert.equal(h.writes.length, 0, 'closed modal never submits');
  await h.edit(1); await h.change({ name: 'Current second profile' });
  await act(async () => { staleSave(); staleClose(); });
  assert.equal(h.writes.length, 0, 'old first-person callbacks never submit another dialog values');
  assert.equal(h.modal().open, true); assert.equal(h.form().form.getFieldsValue().name, 'Current second profile');
  await h.save(); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].id, '81');
}));

test('permission revocation and forced actor/shop changes invalidate old profile writes and late replies', () => harness(async h => {
  await h.edit(0); await h.change({ name: 'Old shop pending profile' });
  const captured = h.modal().onOk;
  h.setShops(h.shops().map(shop => shop.id === '5' ? { ...shop, permissions: [] } : shop));
  await h.refreshShop(); await act(async () => { captured(); }); assert.equal(h.writes.length, 0);
  h.setShops(h.shops().map(shop => ({ ...shop, permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'] }))); await h.refreshShop();
  const pending = deferred(); h.setPatch(() => pending.promise); await h.save(); assert.equal(h.writes.length, 1);
  await h.actor('2'); await act(async () => { await h.router.navigate('/technicians?shopId=6'); });
  await h.edit(0); await h.change({ name: 'New shop independent draft' });
  await act(async () => { pending.resolve({ ...h.snapshots['5'].therapists[0], name: 'Old shop pending profile' }); captured(); });
  assert.equal(h.writes.length, 1); assert.equal(h.modal().open, true);
  assert.equal(h.form().form.getFieldsValue().name, 'New shop independent draft');
  h.setPatch(undefined); await h.save(); assert.equal(h.writes.length, 2); assert.equal(h.writes[1].id, '90');
}));
