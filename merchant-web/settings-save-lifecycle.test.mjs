import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import test from 'node:test';
import axios from 'axios';
import React, { act } from 'react';
import { Form, Grid, Modal } from 'antd';
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
const draftPreview = new Blob([Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoBAAEAAUAmJaACdLoABdQAAP3HHIyG3Rz/5sD+zf3o6ZgA', 'base64')], { type: 'image/webp' });
const makeShop = id => ({ id, name: 'Synthetic shop ' + id, nameEn: '', phone: '206-555-0100', emails: ['orders@example.test'],
  address: '100 Synthetic Street', city: 'Seattle', state: 'Washington', zipCode: '98144', description: 'Saved description',
  logoUrl: '', bannerUrl: '', gallery: [], timezone: 'America/Los_Angeles', permissions: ['SHOP_SETTINGS_MANAGE'], accessType: 'ADMIN', isOwner: true });

async function harness(run) {
  const previous = ['window', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const oldAdapter = axios.defaults.adapter, oldUseModal = Modal.useModal, oldUseForm = Form.useForm, oldBreakpoint = Grid.useBreakpoint;
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null };
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }; document.defaultView = window;
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: document, addEventListener() {}, removeEventListener() {}, textContent: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const confirmations = [], warnings = [], writes = [], reads = [], logouts = [], mediaDeletes = [], staged = new Map();
  let confirm = async () => true, patch, read, tree, layoutTree, root, router, auth, context;
  let shops = ['5', '6'].map(makeShop);
  Modal.useModal = () => [{ confirm: options => { confirmations.push(options); return confirm(options); }, info: options => { warnings.push(options); } }, null];
  Grid.useBreakpoint = () => ({ lg: true });
  Form.useForm = () => [React.useMemo(() => {
    let values = {};
    return { setFieldsValue(next) { values = { ...values, ...next }; }, getFieldsValue() { return { ...values }; } };
  }, [])];
  axios.defaults.adapter = async config => {
    const response = data => ({ config, data, status: 200, statusText: 'OK', headers: {} });
    if (config.url === '/merchant/shops') { reads.push(config.url); return response(read ? await read() : structuredClone(shops)); }
    if (config.url === '/auth/logout') { logouts.push(config); return response({ success: true }); }
    if (config.url === '/upload/media') {
      const id = '00000000-0000-4000-8000-' + String(staged.size + 1).padStart(12, '0');
      const item = { id, fileUrl: `/api/v1/upload/media/${id}/file`, shopId: config.data.get('shopId'), purpose: config.data.get('purpose'), scope: 'SHOP', status: 'STAGED', mimeType: draftPreview.type, sizeBytes: draftPreview.size, width: 1, height: 1, expiresAt: '2031-01-01T00:00:00Z' };
      staged.set(id, item); return response({ item });
    }
    const media = config.url.match(/^\/upload\/media\/([0-9a-f-]+)(\/confirm|\/preview)?$/);
    if (media) {
      if (config.method === 'delete') { mediaDeletes.push(media[1]); return response({ abandoned: true }); }
      if (media[2] === '/preview') return response(draftPreview);
      assert.equal(media[2], '/confirm');
      return response({ item: staged.get(media[1]) });
    }
    const [, id] = config.url.match(/^\/merchant\/shops\/(5|6)$/) ?? [];
    assert.ok(id, 'unexpected request: ' + config.url); assert.equal(config.method, 'patch');
    const changes = JSON.parse(config.data); writes.push({ id, changes });
    if (patch) return response(await patch(id, changes));
    shops = shops.map(shop => shop.id === id ? { ...shop, ...changes } : shop);
    return response(structuredClone(shops.find(shop => shop.id === id)));
  };
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    auth = (await server.ssrLoadModule('/src/stores/authStore.ts')).useAuthStore;
    const { useShopId } = await server.ssrLoadModule('/src/hooks/useShopId.ts');
    const MerchantLayout = (await server.ssrLoadModule('/src/layouts/MerchantLayout.tsx')).default;
    const SettingsPage = (await server.ssrLoadModule('/src/pages/settings/index.tsx')).default;
    const layout = MerchantLayout(), MerchantWorkspace = layout.props.children.type;
    function FormProbe({ component: Component, props }) { tree = Component(props); return null; }
    function SettingsProbe() {
      const page = SettingsPage();
      return typeof page?.type === 'function' && page.props.updateShop
        ? React.createElement(FormProbe, { key: page.key, component: page.type, props: page.props }) : null;
    }
    function WorkspaceProbe() {
      context = useShopId(); layoutTree = MerchantWorkspace();
      const location = useLocation();
      return location.pathname === '/settings' ? React.createElement(SettingsProbe) : null;
    }
    auth.getState().setAuth('synthetic-1', { id: '1', role: 'ADMIN' });
    router = createMemoryRouter([{ path: '*', element: React.createElement(layout.type, null, React.createElement(WorkspaceProbe)) }], { initialEntries: ['/settings?shopId=5'] });
    root = createRoot(container); await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const form = () => { const result = find(tree, node => node.props.form && node.props.onFinish); assert.ok(result, 'real SettingsForm is mounted'); return result.props; };
    const button = label => { const result = find(tree, node => node.props.children === label && (node.props.onClick || node.props.htmlType === 'submit')); assert.ok(result, 'control: ' + label); return result.props; };
    const header = predicate => { const result = find(layoutTree, predicate); assert.ok(result, 'real MerchantWorkspace header control'); return result.props; };
    await run({ writes, reads, logouts, confirmations, warnings, form, button, router, auth, mediaDeletes,
      change: values => act(async () => { form().form.setFieldsValue(values); form().onValuesChange(values); }),
      save: () => act(async () => { await form().onFinish(form().form.getFieldsValue()); }),
      recover: () => act(async () => { await button('刷新并核对保存结果').onClick(); }),
      switchShop: id => act(async () => { header(node => node.props['aria-label'] === '已授权门店').onChange(id); }),
      logout: () => act(async () => { await header(node => node.props.children === '退出登录').onClick(); }),
      actor: id => act(async () => { auth.getState().setAuth('synthetic-' + id, { id, role: 'ADMIN' }); }),
      refresh: () => act(async () => { await context.reloadShop('5'); }),
      setRead: next => { read = next; }, setPatch: next => { patch = next; }, setConfirm: next => { confirm = next; },
      upload: async purpose => {
        let uploaded;
        await act(async () => {
          const field = find(tree, node => node.props.purpose === purpose);
          const file = new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2])], 'synthetic.png', { type: 'image/png' });
          uploaded = await field.props.upload(file, purpose);
        });
        return uploaded.url;
      },
      setShops: next => { shops = next; }, shops: () => structuredClone(shops), tree: () => tree,
    });
  } finally {
    if (root) await act(async () => { root.unmount(); }); router?.dispose(); auth?.getState().logout(); await server.close();
    axios.defaults.adapter = oldAdapter; Modal.useModal = oldUseModal; Form.useForm = oldUseForm; Grid.useBreakpoint = oldBreakpoint;
    previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('verified ordinary saves preserve nullable profile fields and send only the changed intent after a same-shop refresh', () => harness(async h => {
  await h.change({ description: 'New description' });
  h.setShops(h.shops().map(shop => shop.id === '5' ? { ...shop, nameEn: null, phone: '206-555-0199' } : shop));
  await h.refresh();
  assert.equal(h.form().form.getFieldsValue().description, 'New description');
  await h.save();
  assert.deepEqual(h.writes, [{ id: '5', changes: { description: 'New description' } }]);
  assert.equal(h.form().disabled, false); assert.equal(h.form().form.getFieldsValue().phone, '206-555-0199');
  assert.equal(h.form().form.getFieldsValue().nameEn, '');
  await h.logout(); assert.equal(h.logouts.length, 1); assert.equal(h.confirmations.length, 0);
}));

test('unknown profile save locks stale callbacks and real top-level switch/logout until read-only recovery', () => harness(async h => {
  await h.change({ shopName: 'Submitted name' });
  const captured = h.form().onFinish, values = h.form().form.getFieldsValue(), pending = deferred();
  h.setPatch(() => pending.promise);
  await act(async () => { captured(values); captured(values); });
  assert.equal(h.writes.length, 1, 'same-turn saves synchronously share the fence');
  await h.switchShop('6'); await h.logout();
  assert.equal(h.router.state.location.search, '?shopId=5'); assert.equal(h.logouts.length, 0);
  await act(async () => { pending.reject(new Error('Synthetic interrupted write receipt')); });
  assert.equal(h.form().disabled, true, 'a dispatched unknown save remains read-only');
  assert.equal(find(h.tree(), node => node.props.id === 'store-order-emails').props.disabled, true, 'the explicit email disabled prop cannot override the unknown fence');
  for(const purpose of ['logo', 'cover', 'gallery'])assert.equal(find(h.tree(), node => node.props.purpose === purpose).props.disabled, true);
  await h.button('放弃未保存修改').onClick();
  assert.equal(h.form().form.getFieldsValue().shopName, 'Submitted name', 'a captured discard cannot remove an unknown draft');
  await act(async () => { await captured(values); }); assert.equal(h.writes.length, 1);
  const confirmations = h.confirmations.length;
  await h.switchShop('6'); await h.logout();
  assert.equal(h.router.state.location.search, '?shopId=5'); assert.equal(h.logouts.length, 0);
  assert.equal(h.confirmations.length, confirmations, 'unknown is a busy refusal, never an ordinary discard');
  assert.ok(h.warnings.length >= 4);
  h.setShops(h.shops().map(shop => shop.id === '5' ? { ...shop, name: 'Submitted name' } : shop));
  await h.recover(); assert.equal(h.writes.length, 1); assert.equal(h.form().disabled, false);
  assert.equal(h.form().form.getFieldsValue().shopName, 'Submitted name');
  await h.switchShop('6'); assert.equal(h.router.state.location.search, '?shopId=6');
}));

test('malformed write/read receipts preserve the exact draft and guard; good readback resolves without PATCH', () => harness(async h => {
  const logoUrl = await h.upload('logo');
  const logoPreview = () => find(h.tree(), node => node.props.purpose === 'logo').props.previewUrls.get(logoUrl);
  assert.match(logoPreview(), /^blob:/);
  await h.change({ emails: 'new-orders@example.test', description: 'Draft description', logoUrl });
  h.setPatch((id, changes) => { h.setShops(h.shops().map(shop => shop.id === id ? { ...shop, ...changes } : shop)); const result = h.shops().find(shop => shop.id === id); delete result.emails; return result; });
  await h.save(); assert.equal(h.form().disabled, true); assert.equal(h.writes.length, 1);
  assert.match(logoUrl, /^\/api\/v1\/upload\/media\/[^/]+\/file$/);
  assert.equal(h.writes[0].changes.logoUrl, logoUrl);
  assert.match(logoPreview(), /^blob:/);
  h.setRead(() => h.shops().map(shop => { if (shop.id !== '5') return shop; const broken = { ...shop }; delete broken.emails; return broken; }));
  await h.recover(); assert.equal(h.form().disabled, true); assert.equal(h.form().form.getFieldsValue().emails, 'new-orders@example.test');
  assert.equal(h.mediaDeletes.length, 0, 'an uncertain write/readback cannot abandon a possibly bound upload');
  await h.logout(); assert.equal(h.logouts.length, 0);
  h.setRead(() => h.shops()); await h.recover();
  assert.equal(h.form().disabled, false); assert.equal(h.writes.length, 1); assert.equal(h.form().form.getFieldsValue().description, 'Draft description');
  assert.equal(logoPreview(), undefined);
  const before = h.confirmations.length; await h.logout(); assert.equal(h.logouts.length, 1); assert.equal(h.confirmations.length, before, 'verified saved draft is clean');
  assert.equal(h.mediaDeletes.length, 0, 'matched readback marks the saved upload as bound before unmount cleanup');
}));

test('a mismatching 5xx readback stays unknown until explicit review, then preserves the draft without automatically writing', () => harness(async h => {
  const logoUrl = await h.upload('logo');
  await h.change({ shopName: 'Desired name', logoUrl });
  h.setPatch(() => { throw Object.assign(new Error('Synthetic 503'), { response: { status: 503, data: { message: 'Synthetic 503' } } }); });
  await h.save(); assert.equal(h.form().disabled, true);
  h.setShops(h.shops().map(shop => shop.id === '5' ? { ...shop, phone: '206-555-0199' } : shop));
  await h.recover(); assert.equal(h.writes.length, 1); assert.equal(h.form().disabled, true, 'reading old values never proves a timed-out write was not applied');
  assert.equal(h.mediaDeletes.length, 0, 'mismatching readback keeps its uploaded draft');
  const diff = find(h.tree(), node => node.props.title === '服务器资料与提交草稿尚未一致');
  assert.ok(diff); assert.match(renderedText(diff), /草稿：Desired name/); assert.match(renderedText(diff), /服务器：Synthetic shop 5/);
  await h.logout(); assert.equal(h.logouts.length, 0);
  h.setConfirm(async () => false);
  await act(async () => { await h.button('已核对，结束本次操作').onClick(); });
  assert.equal(h.form().disabled, true, 'canceling explicit review retains the unknown fence'); assert.equal(h.writes.length, 1);
  h.setConfirm(async () => true);
  await act(async () => { await h.button('已核对，结束本次操作').onClick(); });
  assert.match(h.confirmations.at(-1).content, /原请求仍可能稍后生效/);
  assert.equal(h.writes.length, 1); assert.equal(h.form().disabled, false);
  assert.equal(h.mediaDeletes.length, 0, 'ending review preserves the upload for a later explicit save');
  assert.equal(h.form().form.getFieldsValue().shopName, 'Desired name'); assert.equal(h.form().form.getFieldsValue().phone, '206-555-0199');
  h.setConfirm(async () => false); await h.switchShop('6');
  assert.equal(h.router.state.location.search, '?shopId=5'); assert.equal(h.confirmations.length, 3, 'remaining unsaved intent still needs discard confirmation');
}));

test('forced settings unmount revokes previews and preserves images that an unresolved save may bind', async t => {
  for (const saveState of ['unsaved', 'pending', 'unknown']) {
    await t.test(saveState, () => harness(async h => {
      const logoUrl = await h.upload('logo');
      const preview = find(h.tree(), node => node.props.purpose === 'logo').props.previewUrls.get(logoUrl);
      assert.equal(resolveObjectURL(preview)?.size, draftPreview.size);
      await h.change({ logoUrl });
      const pending = deferred();
      if (saveState !== 'unsaved') {
        h.setPatch(() => pending.promise);
        await act(async () => { h.form().onFinish(h.form().form.getFieldsValue()); });
        assert.equal(h.writes[0].changes.logoUrl, logoUrl);
      }
      if (saveState === 'unknown') {
        await act(async () => { pending.reject(new Error('Synthetic save receipt loss')); });
        assert.equal(h.form().disabled, true);
      }
      await h.actor('2');
      assert.equal(resolveObjectURL(preview), undefined);
      assert.equal(h.form().form.getFieldsValue().logoUrl, '');
      if (saveState === 'pending') {
        await act(async () => { pending.resolve({ ...h.shops()[0], logoUrl }); });
        assert.equal(h.form().form.getFieldsValue().logoUrl, '');
      }
      const expectedDeletes = saveState === 'unsaved' ? [logoUrl.split('/').at(-2)] : [];
      assert.deepEqual(h.mediaDeletes, expectedDeletes);
    }));
  }
});

test('definite validation rejection stays editable and stale old-actor write/read receipts never change the new form', () => harness(async h => {
  await h.change({ shopName: 'Rejected draft' });
  h.setPatch(() => { throw Object.assign(new Error('Synthetic 400'), { response: { status: 400, data: { message: 'Synthetic rejection' } } }); });
  await h.save(); assert.equal(h.form().disabled, false);
  const pending = deferred(); h.setPatch(() => pending.promise);
  await act(async () => { h.form().onFinish(h.form().form.getFieldsValue()); });
  await h.actor('2'); assert.equal(h.form().disabled, false); assert.equal(h.form().form.getFieldsValue().shopName, 'Synthetic shop 5');
  await act(async () => { pending.resolve({ ...h.shops()[0], name: 'Old actor receipt' }); });
  assert.equal(h.form().form.getFieldsValue().shopName, 'Synthetic shop 5');
  await h.change({ description: 'Actor 2 draft' }); h.setPatch(() => { throw new Error('Synthetic receipt loss'); }); await h.save();
  const reading = deferred(); h.setRead(() => reading.promise);
  await act(async () => { h.button('刷新并核对保存结果').onClick(); });
  h.setRead(undefined); await h.actor('3');
  await act(async () => { reading.resolve(h.shops().map(shop => ({ ...shop, description: 'Actor 2 late read' }))); });
  assert.equal(h.form().disabled, false); assert.equal(h.form().form.getFieldsValue().description, 'Saved description');
}));
