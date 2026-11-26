import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import { ConfirmationProvider } from '../Confirmation';
import { blankDraft } from './storeModel';
import type { BusinessLifecycle } from './businessScope';
import type { StoreItem } from './types';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreWorkspace } = await import('./StoreWorkspace');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).filter(Boolean).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const store = (id = '5'): StoreItem => ({ id, ownerId: '9', name: 'Synthetic store', shortName: 'synthetic-store', subtitle: '', status: 'PENDING', timezone: 'America/Chicago', phones: [], emails: [], businessHours: blankDraft().businessHours, address: '10 Synthetic St', city: 'Chicago', state: 'IL', zipCode: '60601', latitude: null, longitude: null, gallery: [], about: '', tags: [], priceMenu: [], priceMenuRevision: 'a'.repeat(64), features: { onlineBooking: false, reviews: false, onlinePayment: false, membershipCard: false } });
async function harness(creating = false) {
  const keys = ['window', 'document', 'requestAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), oldFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 1; }, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  let tree: unknown, confirmation: unknown, item = creating ? null : store(), closed = 0;
  let lifecycle: BusinessLifecycle = { dirty: false, busy: false, unknown: false };
  const saved: StoreItem[] = [], writes: Record<string, unknown>[] = [], reads: URL[] = [], deletes: string[] = [];
  let write = async (_body: Record<string, unknown>): Promise<Response> => Response.json({ message: 'Synthetic uncertain save' }, { status: 503 });
  let read = async (): Promise<Response> => Response.json({ items: [store()], total: 1, page: 1, pageSize: 1 });
  const actor = { id: '7', role: 'ADMIN', name: 'Synthetic administrator' };
  const mediaId = '11111111-1111-4111-8111-111111111111', mediaUrl = `/api/v1/upload/media/${mediaId}/file`;
  const mediaPreview = Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));
  const media = { id: mediaId, fileUrl: mediaUrl, shopId: '5', scope: 'SHOP', purpose: 'logo', status: 'STAGED', mimeType: 'image/webp', sizeBytes: mediaPreview.byteLength, width: 1, height: 1, expiresAt: '2026-11-15T00:00:00Z' };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://workspace.invalid');
    if (url.pathname.endsWith('/auth/refresh') || url.pathname.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'synthetic-only', user: actor });
    if (url.pathname.endsWith('/auth/me')) return Response.json(actor);
    if (url.pathname.includes('/upload/media')) {
      if (url.pathname.endsWith('/preview')) {
        assert.equal(url.pathname, `/api/v1/upload/media/${mediaId}/preview`);
        assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer synthetic-only');
        return new Response(mediaPreview, { headers: { 'Content-Type': media.mimeType } });
      }
      if (options?.method === 'DELETE') { deletes.push(url.pathname); return Response.json({ abandoned: true }); }
      return Response.json({ item: media });
    }
    assert.match(url.pathname, /\/studio\/stores(?:\/5)?$/);
    if (options?.method === 'POST' || options?.method === 'PATCH') { const body = JSON.parse(String(options.body)); writes.push(body); return write(body); }
    reads.push(url); return read();
  };
  clearSession();
  function Probe() { tree = StoreWorkspace({ item, isStoreManager: false, initialSection: 'basic', onClose: () => { closed++; }, onSaved: value => saved.push(value), onLifecycleChange: value => { lifecycle = value; } }); return null; }
  function SilentConfirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); confirmation = provider; return React.cloneElement(provider, {}, children); }
  function SignedIn() { return useAuthStore().user ? <SilentConfirmation><Probe key={item?.id ?? 'new'} /></SilentConfirmation> : null; }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => root.render(<AuthProvider><SignedIn /></AuthProvider>)); await render();
  const control = (predicate: (node: Node) => boolean, source = tree) => { const node = find(source, predicate); assert.ok(node, 'expected actual workspace control'); return node; };
  const button = (label: string) => control(node => node.type === 'button' && text(node).trim() === label);
  const component = (name: string) => control(node => typeof node.type === 'function' && node.type.name === name);
  const input = (id: string) => control(node => node.type === 'input' && node.props.id === id);
  const change = (id: string, value: string) => act(async () => { input(id).props.onChange({ target: { value } }); });
  const submit = () => act(async () => { const target = {}; void control(node => node.props.id === 'store-workspace-form').props.onSubmit({ target, currentTarget: target, preventDefault() {} }); });
  return { tree: () => tree, lifecycle: () => lifecycle, closed: () => closed, writes, reads, deletes, saved, control, button, component, input, change, submit,
    setRead: (handler: typeof read) => { read = handler; }, setWrite: (handler: typeof write) => { write = handler; },
    async fillNew() { await change('store-name', 'Synthetic store'); await change('store-shortName', 'synthetic-store'); await act(async () => { component('ResourcePicker').props.onChange('9'); component('StoreAddressAutocomplete').props.onChange({ address: '10 Synthetic St', city: 'Chicago', state: 'IL', zipCode: '60601' }); }); },
    async upload() { await act(async () => { button('品牌展示').props.onClick(); }); let url = ''; await act(async () => { const mediaEditor = component('StoreMediaEditor'); ({ url } = await mediaEditor.props.onUpload(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'synthetic.png', { type: 'image/png' }))); mediaEditor.props.onChange(url); }); return url; },
    async click(label: string) { await act(async () => { button(label).props.onClick(); }); },
    async answer(accept: boolean) { await act(async () => { control(node => node.type === 'button' && text(node).trim() === (accept ? '结束核对并保留草稿' : '取消'), confirmation).props.onClick(); }); },
    async otherShop() { item = store('6'); await render(); },
    async cleanup() { await act(async () => root.unmount()); clearSession(); globalThis.fetch = oldFetch; keys.forEach((key, i) => { if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!); else Reflect.deleteProperty(globalThis, key); }); },
  };
}

test('uncertain profile write locks stale controls, retains uploaded media through failed/different readback and explicit review', async () => {
  const h = await harness();
  try {
    await h.change('store-name', 'Edited synthetic store'); const oldChange = h.input('store-name').props.onChange;
    const logoUrl = await h.upload();
    const editor = h.component('StoreMediaEditor');
    const customerPreview = h.component('StoreCustomerPreview');
    const previewUrl = editor.props.previewUrls.get(logoUrl);
    assert.match(previewUrl, /^blob:/);
    assert.equal(customerPreview.props.previewUrls.get(logoUrl), previewUrl);
    assert.equal(editor.props.value, logoUrl);
    await h.submit();
    assert.equal(h.lifecycle().unknown, true); assert.equal(h.writes.length, 1);
    await act(async () => { oldChange({ target: { value: 'Must not replace draft' } }); });
    await h.submit(); await h.click('关闭'); assert.equal(h.closed(), 0); assert.equal(h.writes.length, 1); assert.equal(h.deletes.length, 0);
    h.setRead(async () => { throw new Error('Synthetic read failed'); }); await h.click('只读核对保存结果'); assert.equal(h.lifecycle().unknown, true);
    h.setRead(async () => Response.json({ items: [{ ...store(), name: 'Different server value' }], total: 1, page: 1, pageSize: 1 }));
    await h.click('只读核对保存结果'); assert.equal(h.lifecycle().unknown, true); assert.equal(h.saved.length, 0); assert.match(text(h.tree()), /Different server value/);
    await h.click('结束核对并保留草稿'); await h.answer(false); assert.equal(h.lifecycle().unknown, true);
    await h.click('结束核对并保留草稿'); await h.answer(true);
    assert.equal(h.lifecycle().unknown, false); assert.equal(h.lifecycle().dirty, true); assert.equal(h.deletes.length, 0);
    await h.click('基本资料'); assert.equal(h.input('store-name').props.value, 'Edited synthetic store');
    assert.match(text(h.tree()), /原请求仍可能/); assert.equal(h.writes[0].logoUrl, logoUrl);
  } finally { await h.cleanup(); }
});

test('publishing directs an administrator to the missing fields without sending a partial save', async () => {
  const h = await harness();
  try {
    await h.change('store-subtitle', 'A draft worth keeping');
    await h.click('营业设置');
    const hours = h.component('StoreHoursEditor');
    await act(async () => hours.props.onChange(Object.fromEntries(
      Object.keys(hours.props.value).map(day => [day, { open: false, start: '', end: '' }]),
    )));
    await h.click('营业准备');
    await act(async () => { h.control(node => node.props.id === 'store-status').props.onChange({ target: { value: 'APPROVED' } }); });
    await h.submit();
    const alert = () => text(h.control(node => node.props.role === 'alert'));
    const section = () => h.control(node => node.props.id === 'store-editor-panel').props['aria-labelledby'];
    assert.equal(section(), 'store-tab-basic');
    assert.equal(alert(), '发布前请在「基本资料」补充联系电话，再在「营业设置」添加至少一天营业时间。');
    assert.equal(h.input('store-subtitle').props.value, 'A draft worth keeping');
    await act(async () => { h.control(node => node.props.id === 'store-phones').props.onChange({ target: { value: '+1 202-555-0144' } }); });
    await h.submit();
    assert.equal(section(), 'store-tab-hours');
    assert.equal(alert(), '发布前请在「营业设置」添加至少一天营业时间。');
    assert.equal(h.writes.length, 0);
    const editor = h.component('StoreHoursEditor');
    await act(async () => editor.props.onChange({
      ...editor.props.value, '周一': { open: true, start: '09:00', end: '17:00' },
    }));
    await h.submit();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].status, 'APPROVED');
    assert.equal(h.writes[0].subtitle, 'A draft worth keeping');
  } finally { await h.cleanup(); }
});

test('profile readback only accepts the fixed shop and every submitted field, with no repeated write', async () => {
  const h = await harness();
  try {
    await h.change('store-name', 'Edited synthetic store'); await h.change('store-subtitle', 'New subtitle'); await h.submit();
    h.setRead(async () => Response.json({ items: [{ ...store('6'), name: 'Edited synthetic store', subtitle: 'New subtitle' }], total: 1, page: 1, pageSize: 1 }));
    await h.click('只读核对保存结果'); assert.equal(h.lifecycle().unknown, true); assert.equal(h.saved.length, 0);
    h.setRead(async () => Response.json({ items: [{ ...store(), name: 'Edited synthetic store', subtitle: 'Old subtitle' }], total: 1, page: 1, pageSize: 1 }));
    await h.click('只读核对保存结果'); assert.equal(h.lifecycle().unknown, true);
    h.setRead(async () => Response.json({ items: [{ ...store(), name: 'Edited synthetic store', subtitle: 'New subtitle' }], total: 1, page: 1, pageSize: 1 }));
    await h.click('只读核对保存结果'); assert.equal(h.lifecycle().unknown, false); assert.equal(h.lifecycle().dirty, false);
    assert.equal(h.saved.length, 1); assert.equal(h.writes.length, 1); assert.equal(h.reads.at(-1)!.searchParams.get('shopId'), '5');
  } finally { await h.cleanup(); }
});

test('unknown creation freezes its original short link and exact candidates never claim creation success', async () => {
  const h = await harness(true);
  try {
    await h.fillNew(); const change = h.input('store-shortName').props.onChange; await h.submit(); assert.equal(h.lifecycle().unknown, true);
    await act(async () => { change({ target: { value: 'different-link' } }); }); await h.submit();
    assert.equal(h.input('store-shortName').props.value, 'synthetic-store'); assert.equal(h.writes.length, 1);
    h.setRead(async () => Response.json({ items: [{ ...store('6'), shortName: 'synthetic-store-other' }, { ...store('7'), ownerId: '10' }], total: 2, page: 1, pageSize: 100 }));
    await h.click('只读核对保存结果'); assert.match(text(h.tree()), /未找到可核对的同短链门店/); assert.equal(h.lifecycle().unknown, true);
    h.setRead(async () => Response.json({ items: [{ ...store('8'), name: 'Exact candidate' }], total: 1, page: 1, pageSize: 100 }));
    await h.click('只读核对保存结果'); assert.match(text(h.tree()), /Exact candidate/); assert.match(text(h.tree()), /无法可靠确认原创建请求/);
    assert.equal(h.saved.length, 0); assert.equal(h.lifecycle().unknown, true); assert.equal(h.reads.at(-1)!.searchParams.get('search'), 'synthetic-store');
    await h.click('结束核对并保留草稿'); await h.answer(true);
    assert.equal(h.lifecycle().dirty, true); assert.equal(h.input('store-shortName').props.value, 'synthetic-store'); assert.equal(h.writes.length, 1);
  } finally { await h.cleanup(); }
});

test('a malformed successful receipt remains unknown and a late reconciliation cannot enter another shop', async () => {
  const h = await harness();
  try {
    h.setWrite(async () => Response.json({ item: { id: '5', name: 'Edited synthetic store', priceMenu: [], priceMenuRevision: 'a'.repeat(64) } }));
    await h.change('store-name', 'Edited synthetic store'); await h.submit(); assert.equal(h.lifecycle().unknown, true); assert.equal(h.saved.length, 0);
    let finish!: (value: Response) => void; h.setRead(() => new Promise(resolve => { finish = resolve; })); await h.click('只读核对保存结果');
    await h.otherShop(); await act(async () => { finish(Response.json({ items: [{ ...store(), name: 'Edited synthetic store' }], total: 1, page: 1, pageSize: 1 })); });
    assert.equal(h.input('store-name').props.value, 'Synthetic store'); assert.equal(h.saved.length, 0); assert.equal(h.lifecycle().unknown, false);
  } finally { await h.cleanup(); }
});

test('forced workspace retirement retains staged media when the original profile write is unknown', async () => {
  const h = await harness();
  try {
    await h.change('store-name', 'Edited synthetic store'); const logoUrl = await h.upload(); await h.submit();
    assert.equal(h.lifecycle().unknown, true); await h.otherShop();
    assert.equal(h.deletes.length, 0, 'disposing the retired workspace cannot delete a file the original request may reference');
    assert.equal(h.input('store-name').props.value, 'Synthetic store');
    assert.equal(h.component('StoreCustomerPreview').props.previewUrls.get(logoUrl), undefined);
  } finally { await h.cleanup(); }
});

test('a confirmed single-page menu save advances only its profile baseline and preserves unsaved parent fields', async () => {
  const h = await harness();
  try {
    await h.change('store-name', 'Unsaved parent store title'); await h.change('store-subtitle', 'Unsaved parent subtitle'); await h.click('服务与价格');
    const menu = [{ category: 'Synthetic menu', items: [{ id: 'stored-display', name: 'Synthetic display', priceText: '$80', isVisible: false }, { id: 'legacy:0:1:1234567890abcdef', name: 'Old display', priceText: '$30' }] }];
    await act(async () => { await h.component('StoreServiceWorkspace').props.onSaved({ snapshot: { shopId: '5', service: null, selectionRevision: null, priceMenu: menu, priceMenuRevision: 'b'.repeat(64), canManageCatalog: true, canConfigurePolicy: true }, receipt: {} }); });
    assert.equal(h.writes.length, 0, 'service save callback never sends the independent profile draft'); assert.equal(h.saved.length, 1); assert.equal(h.saved[0].name, 'Synthetic store'); assert.equal(h.saved[0].priceMenuRevision, 'b'.repeat(64)); assert.equal(h.saved[0].priceMenu[0].items[1].id, undefined); assert.equal(h.saved[0].priceMenu[0].items[0].isVisible, false); assert.equal(h.lifecycle().dirty, true);
    await h.click('基本资料'); assert.equal(h.input('store-name').props.value, 'Unsaved parent store title'); assert.equal(h.input('store-subtitle').props.value, 'Unsaved parent subtitle');
    h.setWrite(async body => Response.json({ item: { ...store(), ...body, priceMenu: h.saved[0].priceMenu, priceMenuRevision: 'b'.repeat(64) } })); await h.submit();
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].name, 'Unsaved parent store title'); assert.equal(h.writes[0].subtitle, 'Unsaved parent subtitle'); assert.equal(h.writes[0].expectedPriceMenuRevision, undefined); assert.equal(h.writes[0].priceMenu, undefined, 'profile saving cannot overwrite the separately saved service menu'); assert.equal(h.lifecycle().dirty, false); assert.equal(h.saved[1].priceMenuRevision, 'b'.repeat(64)); assert.deepEqual(h.saved[1].priceMenu, h.saved[0].priceMenu);
  } finally { await h.cleanup(); }
});

test('an unknown profile save blocks an already mounted single-page service writer', async () => {
  const h = await harness();
  try {
    await h.click('服务与价格'); assert.equal(h.component('StoreServiceWorkspace').props.beforeWrite(), true); await h.click('基本资料'); await h.change('store-name', 'Pending profile title'); await h.submit();
    assert.equal(h.lifecycle().unknown, true); assert.equal(h.component('StoreServiceWorkspace').props.beforeWrite(), false); assert.equal(h.component('StoreServiceWorkspace').props.disabled, true);
  } finally { await h.cleanup(); }
});
