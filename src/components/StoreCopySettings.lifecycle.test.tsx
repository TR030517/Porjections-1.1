import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import { getAdminCopySnapshot } from '../stores/adminCopyStore';
import type { CopyInput, CopyPreview } from '../api/storeCopy';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreCopySettings } = await import('./StoreCopySettings');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const preview = (hash: string): CopyPreview => ({ previewHash: hash, expiresAt: new Date(Date.now() + 300000).toISOString(), summary: 'Synthetic saved opening hours', changes: { hours: { from: { monday: { open: '10:00', close: '20:00' } }, to: { monday: { open: '09:00', close: '22:00' } } } } });

test('copy dialog discards retired previews, requires explicit confirmation, and resumes unknown operations without automatic writes', async () => {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} }, storage = new Map<string, string>();
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, setInterval() { return 1; }, clearInterval() {}, sessionStorage: { getItem(key: string) { return storage.get(key) ?? null; }, removeItem(key: string) { storage.delete(key); }, setItem(key: string, value: string) { storage.set(key, value); } } };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic copy admin' }, previewRequests: CopyInput[] = [], applies: Record<string, unknown>[] = [], resolutions: Record<string, unknown>[] = [];
  let tree: unknown, open = true, applied = 0;
  let previewResponse: () => Promise<Response> = async () => Response.json(preview('synthetic-current-preview'));
  const pendingApply = deferred<Response>(); let applyResponse: () => Promise<Response> = () => pendingApply.promise;
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'test-only', user: identity });
    if (path.endsWith('/auth/me')) return Response.json(identity);
    if (path.endsWith('/account-access/admin/overview')) return Response.json({ shops: ['5', '6', '7'].map(id => ({ id, name: 'Synthetic shop ' + id, status: 'APPROVED', ownerId: '9', email: null, binding: null })), accounts: [], grants: [], permissions: [] });
    if (path.includes('/account-access/copy/history?')) return Response.json({ items: [], total: 0, page: 1, limit: 20 });
    const body = JSON.parse(String(options?.body)); assert.equal(options?.method, 'POST');
    if (path.endsWith('/account-access/copy/preview')) { previewRequests.push(body); return previewResponse(); }
    if (path.endsWith('/account-access/copy/apply')) { applies.push(body); return applyResponse(); }
    assert.ok(path.endsWith('/account-access/copy/resolve'), path); resolutions.push(body);
    return Response.json({ ...body, status: 'APPLIED', operationId: 'a12400be-cf14-49ee-909e-4284a456ea94', created: 0, skipped: 0 });
  };
  clearSession();
  function Probe() { const dialog = StoreCopySettings({ actorId: '7', initialSourceShopId: '5', onClose() {}, onApplied: () => { applied++; } }); tree = (dialog.type as (props: typeof dialog.props) => React.ReactNode)(dialog.props); return null; }
  function SignedIn() { return useAuthStore().user && open ? <Probe /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode>); });
  const control = (predicate: (node: Node) => boolean) => { const result = find(tree, predicate); assert.ok(result, 'expected copy control exists'); return result; };
  const button = (label: string) => control(node => node.type === 'button' && text(node).replace(/\s+/g, ' ').trim() === label);
  const target = (value: string) => act(async () => { control(node => typeof node.type === 'function' && node.type.name === 'ShopSelector' && node.props.label === '目标门店').props.onChange(value); });
  const checked = () => act(async () => { control(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); });
  try {
    await render(); await target('6'); const late = deferred<Response>(); previewResponse = () => late.promise;
    await act(async () => { button('生成预览').props.onClick(); }); assert.equal(previewRequests.length, 1);
    await target('7'); await act(async () => { late.resolve(Response.json(preview('synthetic-retired-preview'))); });
    assert.equal(find(tree, node => node.props['aria-label'] === '核对实际变化'), undefined, 'the old target preview must never become the new target confirmation');
    previewResponse = async () => Response.json(preview('synthetic-current-preview'));
    const request = button('生成预览').props.onClick;
    await act(async () => { request(); request(); }); assert.equal(previewRequests.length, 2, 'rapid preview clicks make one read request');
    assert.equal(button('确认应用到 Synthetic shop 7').props.disabled, true);
    await act(async () => { button('确认应用到 Synthetic shop 7').props.onClick(); }); assert.equal(applies.length, 0, 'a preview alone cannot mutate a shop');
    await checked(); const apply = button('确认应用到 Synthetic shop 7').props.onClick;
    await act(async () => { apply(); apply(); }); assert.equal(applies.length, 1); assert.equal(applies[0].targetShopId, '7'); assert.equal(applied, 0);
    await act(async () => { pendingApply.resolve(Response.json({ ...applies[0], status: 'APPLIED', operationId: 'a12400be-cf14-49ee-909e-4284a456ea93', created: 0, skipped: 0 })); });
    assert.equal(applied, 1); await render(); assert.equal(applied, 1, 'each confirmed receipt notifies the parent once');
    assert.match(text(tree), /服务器已确认复制成功/); await act(async () => { button('结束此记录，准备下一次复制').props.onClick(); });
    await target('6'); await act(async () => { button('生成预览').props.onClick(); }); await checked();
    applyResponse = async () => { throw new TypeError('Synthetic lost copy response'); };
    await act(async () => { button('确认应用到 Synthetic shop 6').props.onClick(); }); assert.equal(applies.length, 2); assert.equal(applied, 1); assert.equal(getAdminCopySnapshot().operation?.state, 'UNKNOWN');
    open = false; await render(); open = true; await render();
    assert.equal(applies.length, 2); assert.equal(resolutions.length, 0, 'reopening an unknown operation never automatically retries or resolves');
    assert.match(text(tree), /原结果尚未确认/); assert.equal(find(tree, node => node.type === 'button' && text(node).trim() === '生成预览'), undefined);
    const check = button('查询原操作结果').props.onClick;
    await act(async () => { check(); check(); }); assert.equal(resolutions.length, 1); assert.equal(applies.length, 2); assert.equal(applied, 2);
    assert.deepEqual(resolutions[0], applies[1], 'read-only reconciliation keeps the exact original shops, preview hash and request key');
    await act(async () => { button('结束此记录，准备下一次复制').props.onClick(); });
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});
