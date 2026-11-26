import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { operations } from '../config/operations';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession, loginWithPassword } from '../api/session';
import { ConfirmationProvider } from './Confirmation';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: OperationalPage } = await import('./OperationalPage');

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
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function harness(request: (url: URL, options?: RequestInit) => Promise<Response>, auth?: (url: URL) => Response | undefined) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return { focus() {} }; } };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const actor = { id: '7', role: 'ADMIN', name: 'Synthetic platform administrator' };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://settings.invalid');
    const custom = auth?.(url); if (custom) return custom;
    if (url.pathname.endsWith('/auth/refresh') || url.pathname.endsWith('/auth/admin/refresh') || url.pathname.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-only', user: actor });
    if (url.pathname.endsWith('/auth/me')) return Response.json(actor);
    return request(url, options);
  };
  clearSession();
  let tree: unknown, confirmation: unknown, revision = 0;
  function Probe() { tree = OperationalPage({ config: operations['platform-settings'] }); return null; }
  function SilentConfirmation({ children }: { children: React.ReactNode }) { const provider = ConfirmationProvider({ children }); confirmation = provider; return React.cloneElement(provider, {}, children); }
  function SignedIn() { const { user } = useAuthStore(); return user ? <SilentConfirmation><Probe key={String(user.id) + ':' + revision} /></SilentConfirmation> : (tree = null, null); }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const root = createRoot(container as unknown as HTMLElement);
  const render = () => act(async () => { root.render(<AuthProvider><SignedIn /></AuthProvider>); });
  await render();
  const control = (predicate: (node: Node) => boolean, source = tree) => { const node = find(source, predicate); assert.ok(node, 'expected platform settings control exists'); return node; };
  const button = (label: string) => control(node => node.type === 'button' && text(node).trim() === label);
  const input = () => control(node => node.props.id === 'operation-value');
  return {
    tree: () => tree, confirmation: () => confirmation, control, button, input,
    edit: () => act(async () => { button('编辑').props.onClick(); }),
    change: (value: string) => act(async () => { input().props.onChange({ target: { value } }); }),
    submit: () => act(async () => { await control(node => node.type === 'form' && node.props.noValidate === true).props.onSubmit({ preventDefault() {}, stopPropagation() {} }); }),
    confirm: () => act(async () => { control(node => node.type === 'button' && text(node).trim() === '已核对，结束本次操作', confirmation).props.onClick(); }),
    decline: () => act(async () => { control(node => node.type === 'button' && text(node).trim() === '取消', confirmation).props.onClick(); }),
    discard: () => act(async () => { control(node => node.type === 'button' && text(node).trim() === '放弃修改', confirmation).props.onClick(); }),
    async cleanup() { await act(async () => root.unmount()); clearSession(); globalThis.fetch = previousFetch; keys.forEach((key, i) => { if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!); else Reflect.deleteProperty(globalThis, key); }); },
  };
}
const row = () => ({ id: '2', key: 'support_email', label: '客服邮箱', value: 'support@example.invalid' });
const page = (value: ReturnType<typeof row>) => Response.json({ items: [value], total: 1, page: 1, pageSize: 25 });

test('a settings close confirmation cannot discard a draft when a captured save becomes unknown while it waits', async () => {
  const value = row(), pending = deferred<Response>(); let patches = 0;
  const h = await harness(async (_url, options) => {
    if (options?.method === 'PATCH') { patches++; return pending.promise; }
    return page(value);
  });
  try {
    await h.edit(); await h.change('kept@example.invalid');
    const submit = h.control(node => node.type === 'form' && node.props.noValidate === true).props.onSubmit;
    let closing!: Promise<void>, saving!: Promise<void>;
    await act(async () => { closing = h.control(node => node.props['aria-label'] === '关闭表单').props.onClick(); });
    const warning = text(h.confirmation());
    await act(async () => { saving = submit({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(patches, 1);
    await act(async () => { pending.resolve(Response.json({ message: 'Synthetic service unavailable' }, { status: 503 })); await saving; });
    await h.discard(); await act(async () => { await closing; });
    assert.equal(h.input().props.value, 'kept@example.invalid'); assert.equal(h.input().props.readOnly, true);
    assert.match(text(h.tree()), /结果未知/); assert.equal(patches, 1);
    assert.match(warning, /放弃平台设置草稿/); assert.match(warning, /当前平台设置修改/);
  } finally { pending.resolve(Response.json({ item: value })); await h.cleanup(); }
});

test('a committed setting with lost response retains its draft and blocks resubmission until explicit read and review', async () => {
  const value = row(); let patches = 0, unavailableRead = false;
  const h = await harness(async (url, options) => {
    assert.match(url.pathname, /\/studio\/settings(?:\/2)?$/);
    if (options?.method === 'PATCH') { patches++; value.value = JSON.parse(String(options.body)).value; throw new TypeError('Synthetic response lost after commit'); }
    if (unavailableRead) return Response.json({ message: 'Service Unavailable' }, { status: 503 });
    return page(value);
  });
  try {
    await h.edit(); await h.change('preserved@example.invalid'); await h.submit();
    assert.equal(h.input().props.value, 'preserved@example.invalid');
    await h.submit(); assert.equal(patches, 1, 'an unknown response must never dispatch a second PATCH');
    assert.match(text(h.tree()), /结果未知/);
    assert.equal(h.input().props.readOnly, true);
    assert.equal(h.button('已核对，结束本次操作').props.disabled, true);
    unavailableRead = true; await act(async () => { await h.button('只读重新载入并核对').props.onClick(); });
    assert.equal(h.button('已核对，结束本次操作').props.disabled, true);
    unavailableRead = false; value.value = 'another-admin@example.invalid';
    await act(async () => { await h.button('只读重新载入并核对').props.onClick(); });
    assert.match(text(h.tree()), /当前已保存值/); assert.match(text(h.tree()), /another-admin@example\.invalid/);
    assert.equal(h.input().props.value, 'preserved@example.invalid', 'the latest server value must not overwrite the submitted draft');
    assert.equal(patches, 1);
    let finish!: Promise<void>;
    await act(async () => { finish = h.button('已核对，结束本次操作').props.onClick(); });
    await h.confirm(); await act(async () => { await finish; });
    assert.equal(h.input().props.value, 'preserved@example.invalid', 'review does not replace the original draft');
    assert.equal(h.input().props.readOnly, false); assert.equal(patches, 1, 'finishing review never retries a PATCH');
  } finally { await h.cleanup(); }
});

for (const [key, type, invalid, valid, code] of [
  ['site_name', 'text', '   ', 'Synthetic Studio', 'SITE_NAME_REQUIRED'],
  ['support_phone', 'tel', '123', '+1 (212) 555-0100', 'SUPPORT_PHONE_INVALID'],
] as const) test('the actual ' + key + ' editor uses its field type and retains drafts after a definite field rejection', async () => {
  const value = { ...row(), key, value: valid }; let patches = 0;
  const h = await harness(async (_url, options) => {
    if (options?.method === 'PATCH') { patches++; return Response.json({ code: 'SETTINGS_VALIDATION_FAILED', fieldErrors: { value: code } }, { status: 400 }); }
    return page(value);
  });
  try {
    await h.edit(); assert.equal(h.input().props.type, type);
    await h.change(invalid); await h.submit(); assert.equal(patches, 0); assert.equal(h.input().props.value, invalid);
    await h.change(valid); await h.submit(); assert.equal(patches, 1); assert.equal(h.input().props.value, valid);
    assert.equal(h.input().props['aria-invalid'], true); assert.equal(h.input().props.readOnly, false); assert.equal(h.button('保存').props.disabled, false);
  } finally { await h.cleanup(); }
});

test('rapid repeated submit uses one PATCH and an unrelated success receipt never dismisses the setting draft', async () => {
  const value = row(), pending = deferred<Response>(); let patches = 0;
  const h = await harness(async (_url, options) => {
    if (options?.method === 'PATCH') { patches++; return pending.promise; }
    return page(value);
  });
  try {
    await h.edit(); await h.change('draft@example.invalid');
    const submit = h.control(node => node.type === 'form' && node.props.noValidate === true).props.onSubmit;
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = submit({ preventDefault() {}, stopPropagation() {} }); second = submit({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(patches, 1, 'same-turn handlers cannot submit the same form twice');
    await act(async () => { pending.resolve(Response.json({ item: { ...value, id: '999', value: 'draft@example.invalid' } })); await Promise.all([first, second]); });
    assert.equal(h.input().props.value, 'draft@example.invalid'); assert.match(text(h.tree()), /结果未知/);
  } finally { pending.resolve(Response.json({ item: value })); await h.cleanup(); }
});

test('unknown settings resist cancel, Escape, stale controls and invalid readback; declining review keeps the lock', async () => {
  const value = row(), pending = deferred<Response>(); let patches = 0, reads = 0, mode: 'original' | 'wrong' | 'pending' = 'original';
  const h = await harness(async (_url, options) => {
    if (options?.method === 'PATCH') { patches++; throw new TypeError('Synthetic response lost'); }
    if (mode === 'wrong') return page({ ...value, key: 'support_phone' });
    if (mode === 'pending') { reads++; return pending.promise; }
    return page(value);
  });
  try {
    await h.edit(); await h.change('retained@example.invalid');
    const oldClose = h.control(node => node.props['aria-label'] === '关闭表单').props.onClick;
    const oldEdit = h.button('编辑').props.onClick;
    await h.submit();
    await act(async () => { await oldClose(); await h.button('取消').props.onClick(); oldEdit(); });
    await act(async () => { h.control(node => node.props.role === 'dialog').props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
    await h.change('must-not-replace@example.invalid');
    assert.equal(h.input().props.value, 'retained@example.invalid'); assert.equal(h.input().props.readOnly, true);
    mode = 'wrong'; await act(async () => { await h.button('只读重新载入并核对').props.onClick(); });
    assert.equal(h.button('已核对，结束本次操作').props.disabled, true); assert.match(text(h.tree()), /只读核对失败/);
    mode = 'pending';
    const read = h.button('只读重新载入并核对').props.onClick, finish = h.button('已核对，结束本次操作').props.onClick;
    let readPromise!: Promise<void>;
    await act(async () => { readPromise = read(); read(); await finish(); });
    assert.equal(reads, 1); assert.equal(h.input().props.readOnly, true); assert.equal(h.control(node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
    await act(async () => { pending.resolve(page(value)); await readPromise; });
    let review!: Promise<void>; await act(async () => { review = h.button('已核对，结束本次操作').props.onClick(); });
    await h.decline(); await act(async () => { await review; });
    assert.equal(h.input().props.readOnly, true); assert.equal(h.button('保存').props.disabled, true); assert.equal(patches, 1);
    assert.equal(h.input().props.value, 'retained@example.invalid'); assert.match(text(h.tree()), /结果未知/);
  } finally { pending.resolve(page(value)); await h.cleanup(); }
});

test('a refreshed 401 retries only the captured setting payload and an expired session retires its draft', async () => {
  const value = row(); let patches = 0, expire = false, refreshes = 0;
  const h = await harness(async (_url, options) => {
    if (options?.method === 'PATCH') {
      patches++; assert.deepEqual(JSON.parse(String(options.body)), { value: 'same@example.invalid' });
      if (patches === 1 || expire) return Response.json({ message: 'Unauthorized' }, { status: 401 });
      value.value = 'same@example.invalid'; return Response.json({ item: value });
    }
    return page(value);
  }, url => {
    if (!url.pathname.endsWith('/auth/refresh') && !url.pathname.endsWith('/auth/admin/refresh')) return;
    refreshes++; return expire ? Response.json({ message: 'Unauthorized' }, { status: 401 }) : undefined;
  });
  try {
    await h.edit(); await h.change('same@example.invalid'); await h.submit();
    assert.equal(patches, 2); assert.ok(refreshes >= 2); assert.equal(find(h.tree(), node => node.props.role === 'dialog'), undefined);
    expire = true; await h.edit(); await h.change('same@example.invalid'); await h.submit();
    assert.equal(h.tree(), null, 'expired sessions do not keep the old privileged editor visible'); assert.equal(patches, 3);
  } finally { await h.cleanup(); }
});

test('a late setting response cannot overwrite another administrator or close their editor', async () => {
  const value = row(), pending = deferred<Response>(); let patches = 0, nextActor = false;
  const h = await harness(async (_url, options) => {
    if (options?.method === 'PATCH') { patches++; return pending.promise; }
    return page(value);
  }, url => {
    if (nextActor && url.pathname.endsWith('/auth/me')) return Response.json({ id: '8', role: 'ADMIN', name: 'Other synthetic administrator' });
  });
  try {
    await h.edit(); await h.change('old@example.invalid');
    let save!: Promise<void>; await act(async () => { save = h.control(node => node.type === 'form' && node.props.noValidate === true).props.onSubmit({ preventDefault() {}, stopPropagation() {} }); });
    nextActor = true; await act(async () => { await loginWithPassword('other@example.invalid', 'synthetic-only'); });
    await h.edit(); await h.change('new@example.invalid');
    await act(async () => { pending.resolve(Response.json({ item: { ...value, value: 'old@example.invalid' } })); await save; });
    assert.equal(h.input().props.value, 'new@example.invalid'); assert.equal(patches, 1); assert.doesNotMatch(text(h.tree()), /记录已保存/);
  } finally { pending.resolve(Response.json({ item: value })); await h.cleanup(); }
});
