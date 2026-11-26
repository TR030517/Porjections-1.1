import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { clearSession } from '../api/session';
import { accountPermissions, type AccessOverview, type AccessShop } from '../api/accountAccess';

// Preserve the established real-component harness while supplying Vite's DEV constant.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; const result = await nextLoad(url, context); return url.endsWith('/merchantWorkspaceUrl.ts') ? {...result, source:String(result.source).replace('import.meta.env.DEV','false')} : result; }"), import.meta.url);
const { default: AccountAccessManagement } = await import('./AccountAccessManagement');

type Node = React.ReactElement<Record<string, any>>;
function all(tree: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate));
  if (!React.isValidElement(tree)) return [];
  const node = tree as Node;
  return [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate)];
}
function text(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (React.isValidElement(tree)) return text((tree as Node).props.children);
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function find(tree: unknown, predicate: (node: Node) => boolean): Node {
  const value = all(tree, predicate)[0]; assert.ok(value, 'expected account-page control exists'); return value;
}
function overview(count = 62): AccessOverview {
  const shops: AccessShop[] = Array.from({ length: count }, (_, index) => {
    const id = index === count - 1 ? '9007199254740993' : String(index + 1);
    const eligible = ['40', '60'].includes(id);
    return { id, name: index === count - 1 ? 'Distant Target Shop' : `Synthetic shop ${String(index + 1).padStart(4, '0')}`, status: id === '50' ? 'SUSPENDED' : 'APPROVED', ownerId: '9', email: `contact-${id}@example.invalid`, binding: id === '1' ? null : {
      id: `binding-${id}`, shopId: id, userId: id, loginName: null, name: `Synthetic account ${id}`, email: `login-${id}@example.invalid`,
      accountStatus: eligible || ['50', '51'].includes(id) ? 'ACTIVE' : 'SUSPENDED', loginReady: eligible || id === '50', createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z', reasonRecorded: true,
    } };
  });
  return { shops, accounts: shops.flatMap(shop => shop.binding ? [{ id: shop.binding.userId, name: shop.binding.name, loginName: null, email: shop.binding.email, role: 'MERCHANT' as const, status: shop.binding.accountStatus, loginReady: shop.binding.loginReady, boundShopId: shop.id }] : []), grants: [], permissions: [...accountPermissions] };
}

async function withPage(run: (page: {
  tree: () => unknown; data: AccessOverview; requests: { method: string; path: string; body: any }[];
  find: (predicate: (node: Node) => boolean) => Node; rows: () => Node[];
  click: (name: string) => Promise<void>; change: (name: string, value: string) => Promise<void>;
  setWrite: (write: (body: any) => Promise<Response>) => void;
}) => Promise<void>, options: { count?: number; initialShopId?: string; onBack?: () => void } = {}) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined };
  doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const data = overview(options.count), requests: { method: string; path: string; body: any }[] = [];
  let write = async (_body: any): Promise<Response> => { throw new TypeError('Synthetic lost creation response'); };
  globalThis.fetch = async (input, init) => {
    const path = String(input), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path, method, body });
    if (path.endsWith('/overview')) return Response.json(data);
    assert.equal(path, '/api/v1/account-access/admin/create-and-bind'); assert.equal(method, 'POST'); return write(body);
  };
  clearSession();
  let tree: unknown;
  function Probe() { tree = AccountAccessManagement({ initialShopId: options.initialShopId, onBack: options.onBack }); return null; }
  const root = createRoot(container as unknown as HTMLElement);
  const control = (predicate: (node: Node) => boolean) => find(tree, predicate);
  const button = (name: string) => control(node => node.type === 'button' && (node.props['aria-label'] === name || text(node).trim() === name));
  const rows = () => {
    const section = control(node => node.type === 'section' && all(node, child => child.type === 'h2' && text(child) === '独立门店账号').length > 0);
    return all(find(section, node => node.type === 'tbody'), node => node.type === 'tr');
  };
  try {
    await act(async () => { root.render(<Probe />); });
    await run({ tree: () => tree, data, requests, find: control, rows,
      click: name => act(async () => { const node = button(name); assert.ok(!node.props.disabled, `${name} should be enabled`); node.props.onClick(); }),
      change: (name, value) => act(async () => { const node = control(candidate => candidate.props['aria-label'] === name && ['input', 'select'].includes(String(candidate.type))); assert.ok(!node.props.disabled, `${name} should be enabled`); node.props.onChange({ target: { value } }); }),
      setWrite: next => { write = next; },
    });
  } finally {
    await act(async () => { root.unmount(); }); clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('binding pagination bounds a 1335-shop collection, preserves exact IDs and clamps a shortened result', async () => {
  await withPage(async page => {
    assert.equal(page.rows().length, 25); assert.match(text(page.tree()), /共 1335 家/);
    await page.change('门店账号每页条数', '100'); assert.equal(page.rows().length, 100);
    for (let index = 0; index < 13; index++) await page.click('门店账号下一页');
    assert.equal(page.rows().length, 35); assert.match(text(page.rows().at(-1)), /9007199254740993/);
    assert.equal(page.find(node => node.props['aria-label'] === '门店账号下一页').props.disabled, true);
    await page.change('门店账号每页条数', '50'); assert.equal(page.rows().length, 50);
    await page.click('门店账号下一页');
    page.data.shops = page.data.shops.slice(0, 10); await page.click('刷新授权');
    assert.equal(page.rows().length, 10); assert.match(text(page.tree()), /第 1 \/ 1 页/);
    assert.equal(page.requests.filter(request => request.method !== 'GET').length, 0);
  }, { count: 1335 });
});

test('binding search filters the complete collection before paging and reset restores the full range', async () => {
  await withPage(async page => {
    await page.change('查找门店账号', 'DISTANT TARGET'); assert.equal(page.rows().length, 1); assert.match(text(page.rows()[0]), /9007199254740993/);
    await page.change('查找门店账号', 'LOGIN-60@EXAMPLE.INVALID'); assert.equal(page.rows().length, 1); assert.match(text(page.rows()[0]), /Synthetic shop 0060/);
    await page.change('查找门店账号', '#9007199254740993'); assert.equal(page.rows().length, 1);
    await page.change('查找门店账号', 'no-synthetic-match'); assert.equal(page.rows().length, 0); assert.match(text(page.tree()), /没有匹配/);
    await page.click('清除搜索'); assert.equal(page.rows().length, 25); assert.match(text(page.tree()), /共 62 家/);
    assert.equal(page.requests.length, 1, 'search and paging use the existing complete overview without network writes or extra reads');
  });
});

test('explicit shop scope stays authoritative under search until the administrator explicitly opens all shops', async () => {
  await withPage(async page => {
    assert.equal(page.rows().length, 1); assert.match(text(page.rows()[0]), /Synthetic shop 0002/);
    await page.change('查找门店账号', 'Distant Target'); assert.equal(page.rows().length, 0);
    await page.click('查看全部门店'); assert.equal(page.rows().length, 1); assert.match(text(page.rows()[0]), /9007199254740993/);
    await page.click('清除搜索'); assert.equal(page.rows().length, 25);
  }, { initialShopId: '2' });
});

test('an open account editor locks view changes and retains its original target and password draft', async () => {
  await withPage(async page => {
    const row = page.rows()[1]; const reset = find(row, node => node.type === 'button' && text(node) === '重置密码');
    await act(async () => { reset.props.onClick(); });
    const input = () => page.find(node => node.type === 'input' && node.props.autoComplete === 'new-password');
    await act(async () => { input().props.onChange({ target: { value: 'SyntheticDraft123' } }); });
    for (const label of ['查找门店账号', '门店账号每页条数', '门店账号下一页']) assert.equal(page.find(node => node.props['aria-label'] === label).props.disabled, true);
    assert.equal(page.find(node => node.type === 'button' && text(node) === '创建与管理账户').props.disabled, true);
    await act(async () => { page.find(node => node.props['aria-label'] === '查找门店账号').props.onChange({ target: { value: 'Distant' } }); });
    assert.equal(input().props.value, 'SyntheticDraft123'); assert.match(text(page.rows()[1]), /Synthetic shop 0002/);
    await page.click('取消'); assert.equal(page.requests.length, 1);
    await page.change('查找门店账号', 'Distant'); assert.equal(page.rows().length, 1);
  });
});

test('grant choices retain eligible off-page shops and exclude suspended, unusable and self targets', async () => {
  await withPage(async page => {
    await page.click('配置门店关联');
    const select = (label: string) => find(page.find(node => node.type === 'label' && text(node).startsWith(label)), node => node.type === 'select');
    const optionIds = (node: Node) => all(node, child => child.type === 'option' && child.props.value).map(child => child.props.value);
    assert.deepEqual(optionIds(select('来源门店')), ['40', '60']);
    await act(async () => { select('来源门店').props.onChange({ target: { value: '40' } }); });
    assert.deepEqual(optionIds(select('允许访问的目标门店')), ['60']);
    assert.equal(page.rows().length, 25, 'full grant options do not require rendering all binding rows');
    assert.equal(page.requests.length, 1);
  });
});

test('unknown creation locks list context, never resends its password and resolves only through matching read-back', async () => {
  let backCalls = 0;
  await withPage(async page => {
    let rejectWrite!: (error: Error) => void;
    const pending = new Promise<Response>((_resolve, reject) => { rejectWrite = reject; });
    page.setWrite(() => pending);
    const create = find(page.rows()[0], node => node.type === 'button' && text(node) === '创建并绑定');
    await act(async () => { create.props.onClick(); });
    const reason = () => page.find(node => node.type === 'textarea');
    await act(async () => { reason().props.onChange({ target: { value: 'Synthetic provisioning regression' } }); });
    const form = () => page.find(node => node.type === 'form');
    await act(async () => { form().props.onSubmit({ preventDefault() {} }); });
    assert.equal(page.requests.filter(request => request.method === 'POST').length, 1);
    assert.equal(page.find(node => node.type === 'button' && text(node) === '创建与管理账户').props.disabled, true);
    assert.equal(page.find(node => node.type === 'button' && text(node).trim() === '返回门店检查').props.disabled, true);
    await act(async () => { rejectWrite(new TypeError('Synthetic lost creation response')); });
    assert.match(text(page.tree()), /结果未知/);
    await page.click('取消');
    for (const label of ['查找门店账号', '门店账号每页条数', '门店账号下一页']) assert.equal(page.find(node => node.props['aria-label'] === label).props.disabled, true);
    assert.equal(page.find(node => node.type === 'button' && text(node) === '创建与管理账户').props.disabled, true);
    const back = page.find(node => node.type === 'button' && text(node).trim() === '返回门店检查');
    assert.equal(back.props.disabled, true); await act(async () => { back.props.onClick(); }); assert.equal(backCalls, 0);
    await page.click('核对最新结果（只读）'); assert.match(text(page.tree()), /不能据此断定原请求未执行/);
    assert.equal(page.requests.filter(request => request.method === 'POST').length, 1);
    const original = page.requests.find(request => request.method === 'POST')!.body;
    page.data.shops[0].binding = { ...page.data.shops[1].binding!, id: 'binding-1', shopId: '1', userId: '8000', email: original.email, accountStatus: 'SUSPENDED', loginReady: false };
    await page.click('核对最新结果（只读）');
    assert.match(text(page.tree()), /账号仍禁用/);
    assert.equal(page.find(node => node.props['aria-label'] === '查找门店账号').props.disabled, false);
    assert.equal(page.requests.filter(request => request.method === 'POST').length, 1);
    assert.ok(page.requests.slice(2).every(request => request.method === 'GET' && request.body === null));
    await page.click('返回门店检查'); assert.equal(backCalls, 1);
  }, { onBack: () => { backCalls += 1; } });
});

test('accounts-tab entry skips unused overview reads but returning to bindings refreshes their authoritative data', async () => {
  await withPage(async page => {
    assert.equal(page.requests.length, 1);
    await page.click('创建与管理账户'); assert.equal(page.requests.length, 1);
    page.data.shops[0].name = 'Synthetic externally updated account context';
    await page.click('门店绑定与关联');
    assert.equal(page.requests.length, 2); assert.match(text(page.rows()[0]), /externally updated/);
  });
});
