import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import { shopStore } from '../stores/shop';
import { operations } from '../config/operations';
import type { ResourceQuery } from '../api/resources';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: OperationalPage } = await import('./OperationalPage');
const { default: AuditLogPage } = await import('./AuditLogPage');
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
async function harness(render: () => unknown, request: (url: URL, options?: RequestInit) => Promise<Response>) {
  const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const previousFetch = globalThis.fetch;
  let copied = '', focused = 0, tree: unknown;
  const doc: Record<string, unknown> = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null, getElementById() { return { focus() { focused++; } }; } };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, location: { href: 'http://synthetic.test/admin/?module=audit-logs&page=2&limit=50' }, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } };
  doc.defaultView = win;
  for (const [key, value] of [['window', win], ['document', doc], ['navigator', { clipboard: { async writeText(value: string) { copied = value; } } }], ['IS_REACT_ACT_ENVIRONMENT', true]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
  const identity = { id: '7', role: 'ADMIN', name: 'Synthetic administrator' };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://synthetic.test');
    if (url.pathname.endsWith('/auth/refresh') || url.pathname.endsWith('/auth/admin/refresh')) return Response.json({ accessToken: 'synthetic-token', user: identity });
    if (url.pathname.endsWith('/auth/me')) return Response.json(identity);
    return request(url, options);
  };
  clearSession();
  function Probe() { tree = render(); return null; }
  function SignedIn() { return useAuthStore().user ? <Probe /> : null; }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  let revision = 0;
  const mount = () => act(async () => { root.render(<AuthProvider><SignedIn key={revision} /></AuthProvider>); });
  const control = (predicate: (node: Node) => boolean) => { const node = find(tree, predicate); assert.ok(node, 'expected control exists'); return node; };
  await mount();
  return {
    control, tree: () => tree, focused: () => focused, copied: () => copied,
    button: (label: string) => control(node => node.type === 'button' && text(node).trim() === label),
    async remount() { revision++; await mount(); },
    async cleanup() {
      await act(async () => root.unmount()); clearSession(); globalThis.fetch = previousFetch;
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    },
  };
}

test('audit submitted filters and page survive remount; draft and detail do not replace the query', async () => {
  let saved: ResourceQuery = { targetType: 'settings', action: 'STUDIO_UPDATE', targetId: '9', operatorId: '7', startDate: '2026-11-01', endDate: '2026-11-12', page: 3, limit: 50 };
  const queries: URLSearchParams[] = [], published: ResourceQuery[] = [];
  const onQueryChange = (query: ResourceQuery) => { saved = query; published.push(query); };
  const h = await harness(() => AuditLogPage({ initialQuery: saved, onQueryChange }), async url => {
    assert.equal(url.pathname, '/api/v1/admin/audit-logs'); queries.push(url.searchParams);
    return Response.json({ items: [{ id: '1', action: 'STUDIO_UPDATE', targetType: 'settings', targetId: '9', operatorId: '7', createdAt: '2026-11-12T00:00:00Z', detail: { fields: ['title'] } }], meta: { total: 200, page: Number(url.searchParams.get('page')), limit: 50, totalPages: 4 } });
  });
  try {
    assert.equal(queries.at(-1)?.get('page'), '3');
    assert.equal(queries.at(-1)?.get('limit'), '50');
    const beforeDraft = published.length;
    await act(async () => h.control(node => node.type === 'input' && node.props.list === 'audit-target-options').props.onChange({ target: { value: 'stores' } }));
    assert.equal(published.length, beforeDraft);
    assert.equal(queries.at(-1)?.get('targetType'), 'settings');
    await act(async () => h.control(node => node.type === 'form').props.onSubmit({ preventDefault() {} }));
    assert.equal(saved.targetType, 'stores'); assert.equal(saved.page, 1);
    await act(async () => h.control(node => node.props['aria-label'] === '下一页审计记录').props.onClick());
    assert.equal(saved.page, 2);
    const beforeDetail = queries.length;
    await act(async () => h.button('查看详情').props.onClick());
    const detail = h.control(node => typeof node.type === 'function' && node.type.name === 'AuditDetail');
    await act(async () => detail.props.onClose());
    assert.equal(queries.length, beforeDetail); assert.equal(saved.page, 2);
    await act(async () => h.button('复制查询链接').props.onClick());
    assert.equal(h.copied(), 'http://synthetic.test/admin/?module=audit-logs&page=2&limit=50');
    await h.remount();
    assert.equal(queries.at(-1)?.get('page'), '2'); assert.equal(queries.at(-1)?.get('targetType'), 'stores');
    assert.equal(h.control(node => node.props.list === 'audit-target-options').props.value, 'stores');
  } finally { await h.cleanup(); }
});

test('generic list restores submitted pagination and keeps unsubmitted search out of navigation state', async () => {
  let saved: ResourceQuery = { status: 'SUSPENDED', search: 'synthetic-private', page: 3, pageSize: 50 };
  const queries: URLSearchParams[] = [], published: ResourceQuery[] = [];
  const onQueryChange = (query: ResourceQuery) => { saved = query; published.push(query); };
  const h = await harness(() => OperationalPage({ config: operations['user-list'], initialQuery: saved, onQueryChange }), async url => {
    assert.equal(url.pathname, '/api/v1/studio/users'); queries.push(url.searchParams);
    return Response.json({ items: [{ id: '9', name: 'Synthetic user', email: 'synthetic@example.invalid', status: 'SUSPENDED' }], total: 200, page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) });
  });
  try {
    assert.equal(queries.at(-1)?.get('page'), '3'); assert.equal(queries.at(-1)?.get('pageSize'), '50');
    const count = published.length;
    await act(async () => h.control(node => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value: 'unsubmitted draft' } }));
    assert.equal(published.length, count); assert.equal(saved.search, 'synthetic-private');
    await h.remount();
    assert.equal(h.control(node => node.props.type === 'search').props.value, 'synthetic-private');
    assert.equal(queries.at(-1)?.get('page'), '3');
    await act(async () => h.control(node => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value: ' next-query ' } }));
    await act(async () => h.control(node => node.type === 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} }));
    assert.equal(saved.page, 1); assert.equal(saved.search, 'next-query');
  } finally { await h.cleanup(); }
});

test('all-store appointment queue omits shopId from the request and a selected shop scopes it explicitly', async () => {
  shopStore.currentStoreId = null;
  const requests: URL[] = [];
  const h = await harness(() => OperationalPage({ config: operations['service-orders'], initialQuery: { status: 'CONFIRMED', shopScope: 'ALL' } }), async url => {
    assert.equal(url.pathname, '/api/v1/studio/service-orders'); requests.push(url);
    return Response.json({ items: [], total: 0, page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) });
  });
  try {
    assert.equal(requests.at(-1)?.searchParams.get('status'), 'CONFIRMED');
    assert.equal(requests.at(-1)?.searchParams.has('shopId'), false, 'ALL requests use server-authorized scope without a stale shop filter');
    await act(async () => { shopStore.currentStoreId = '102'; });
    assert.equal(requests.at(-1)?.searchParams.get('shopId'), '102', 'manual single-shop selection becomes an explicit API filter');
  } finally { await h.cleanup(); shopStore.currentStoreId = null; }
});

test('setting errors are local or stable server field errors, focus the field and retain drafts until success', async () => {
  let mode = 'invalid'; let patchCount = 0;
  const row = { id: '2', key: 'support_email', label: '客服邮箱', value: 'support@example.invalid' };
  const h = await harness(() => OperationalPage({ config: operations['platform-settings'] }), async (url, options) => {
    if (options?.method === 'PATCH') {
      patchCount++;
      if (mode === 'invalid') return Response.json({ code: 'SETTINGS_VALIDATION_FAILED', fieldErrors: { value: 'SUPPORT_EMAIL_INVALID' }, message: 'arbitrary text' }, { status: 400 });
      if (mode === 'unavailable') return Response.json({ message: 'Service Unavailable' }, { status: 503 });
      row.value = JSON.parse(String(options.body)).value; return Response.json({ item: row });
    }
    assert.equal(url.pathname, '/api/v1/studio/settings');
    return Response.json({ items: [row], total: 1, page: 1, pageSize: 25 });
  });
  const input = () => h.control(node => node.props.id === 'operation-value');
  const submit = () => act(async () => h.control(node => node.type === 'form' && node.props.noValidate === true).props.onSubmit({ preventDefault() {}, stopPropagation() {} }));
  try {
    await act(async () => h.button('编辑').props.onClick());
    assert.equal(input().props.type, 'email');
    await act(async () => input().props.onChange({ target: { value: 'bad@' } })); await submit();
    assert.equal(patchCount, 0); assert.equal(input().props.value, 'bad@'); assert.equal(input().props['aria-invalid'], true);
    assert.match(text(h.control(node => node.props.id === 'operation-value-error')), /客服邮箱格式不正确/);
    assert.equal(h.focused(), 1);
    await act(async () => input().props.onChange({ target: { value: 'draft@example.invalid' } })); await submit();
    assert.equal(patchCount, 1); assert.equal(input().props.value, 'draft@example.invalid'); assert.equal(h.focused(), 2);
    mode = 'success'; await submit();
    assert.equal(find(h.tree(), node => node.props.role === 'dialog'), undefined);
    assert.equal(row.value, 'draft@example.invalid');
    await act(async () => h.button('编辑').props.onClick());
    mode = 'unavailable'; await act(async () => input().props.onChange({ target: { value: 'preserved@example.invalid' } })); await submit();
    assert.equal(input().props.value, 'preserved@example.invalid'); assert.match(text(h.tree()), /结果未知/);
    assert.equal(h.button('保存').props.disabled, true);
  } finally { await h.cleanup(); }
});
