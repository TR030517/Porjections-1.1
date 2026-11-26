import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession, loginWithPassword } from '../../api/session';
import { shopStore } from '../../stores/shop';
import type { PriceMenuGroup } from '../../utils/priceMenu';
import { formatPriceMenuTitle } from '../../utils/priceMenuPricing';
import type { CatalogSelectionPrecondition } from '../../utils/catalogSelection';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreMenuCatalogEditor } = await import('./StoreMenuCatalogEditor');
const { default: StorePriceMenuEditor } = await import('./StorePriceMenuEditor');

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
const savedMenu = (): PriceMenuGroup[] => [{ category: 'Massage', items: [30, 60, 90].map((durationMin, index) => {
  const pricing = { kind: 'TIMED', baseName: 'Massage', durationMin, priceCents: (40 + index * 20) * 100, titleMode: 'AUTO' } as const;
  return { id: 'row-' + index, name: formatPriceMenuTitle(pricing), priceText: '', pricing };
}) }];

async function harness(strict: boolean, exercise: (h: {
  node: (predicate: (node: Node) => boolean) => Node;
  click: (label: string) => Promise<void>;
  input: (label: string, value: string) => Promise<void>;
  status: () => string;
  state: () => { menu: PriceMenuGroup[]; paste: string; selections: CatalogSelectionPrecondition[]; dirty: boolean; connections: number; configured: number; edited: { serviceId: string; variantId?: string }[] };
  callbacks: () => ReturnType<typeof StoreMenuCatalogEditor>['props'];
  reject: (value: boolean) => void;
  shop: (value: string) => Promise<void>;
  reopen: () => Promise<void>;
  unmount: () => Promise<void>;
  actor: (value: string) => Promise<void>;
}) => Promise<void>, options: { initialMenu?: () => PriceMenuGroup[]; canManage?: boolean } = {}) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const initialMenu = options.initialMenu ?? savedMenu;
  let actorId = '7', shopId = '5', key = 0, reject = false, tree: unknown, menu = initialMenu(), paste = '', selectionState: CatalogSelectionPrecondition[] = [], connections = 0, configured = 0;
  const edited: { serviceId: string; variantId?: string }[] = [];
  let callbacks: ReturnType<typeof StoreMenuCatalogEditor>['props'];
  let reset!: () => void;
  const writes: string[] = [];
  globalThis.fetch = async (input, options) => {
    const path = String(input), user = { id: actorId, role: 'ADMIN', name: 'Synthetic draft admin' };
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh') || path.endsWith('/auth/login')) return Response.json({ accessToken: 'test-only', user });
    if (path.endsWith('/auth/me')) return Response.json(user);
    if (options?.method && options.method !== 'GET') writes.push(path);
    throw Error('Unexpected business request: ' + path);
  };
  // Keep the real wrapper's hooks in a distinct committed React boundary from
  // the editor hooks: child-only input must not accidentally recapture its fence.
  // Omit only host rendering; events come from the actual returned controls.
  function EditorProbe(props: Parameters<typeof StorePriceMenuEditor>[0]) {
    tree = StorePriceMenuEditor(props);
    return null;
  }
  function WrapperProbe(props: Parameters<typeof StoreMenuCatalogEditor>[0]) {
    const wrapped = StoreMenuCatalogEditor(props); callbacks = wrapped.props;
    useEffect(() => { connections++; }, []);
    return <EditorProbe {...wrapped.props} />;
  }
  function ControlledParent() {
    const [value, setValue] = useState(initialMenu), [pasted, setPasted] = useState('');
    const [selections, setSelections] = useState<CatalogSelectionPrecondition[]>([]); selectionState = selections;
    menu = value; paste = pasted; reset = () => { setValue(initialMenu()); setPasted(''); };
    return <WrapperProbe key={key} shopId={shopId} value={value} pasteText={pasted}
      onChange={(next, selections) => { if (reject) return false; setValue(next); if (selections) setSelections([...selections]); return true; }}
      onPasteTextChange={next => { if (reject) return false; setPasted(next); return true; }}
      catalogSelectionAllowed={options.canManage ?? true}
      onEditService={(serviceId, variantId) => { edited.push({ serviceId, variantId }); }}
      onConfigureService={() => { configured++; }} />;
  }
  function SignedIn() { return useAuthStore().user ? <ControlledParent /> : null; }
  clearSession(); const root = createRoot(container as unknown as HTMLElement); let mounted = true;
  const render = () => act(async () => { root.render(strict ? <StrictMode><AuthProvider><SignedIn /></AuthProvider></StrictMode> : <AuthProvider><SignedIn /></AuthProvider>); });
  const node = (predicate: (node: Node) => boolean) => { const result = find(tree, predicate); assert.ok(result, 'expected editor control'); return result; };
  try {
    await render();
    await exercise({ node, click: label => act(async () => { node(node => node.type === 'button' && text(node).trim() === label).props.onClick(); }),
      input: (label, value) => act(async () => { node(node => node.props['aria-label'] === label).props.onChange({ target: { value } }); }),
      status: () => text(tree), state: () => ({ menu, paste, selections: selectionState, dirty: JSON.stringify(menu) !== JSON.stringify(initialMenu()) || paste.length > 0, connections, configured, edited }),
      callbacks: () => callbacks, reject: value => { reject = value; }, shop: async value => { shopId = value; await render(); },
      reopen: async () => { await act(async () => { reset(); }); key++; await render(); },
      unmount: async () => { await act(async () => { root.unmount(); }); mounted = false; },
      actor: value => act(async () => { actorId = value; await loginWithPassword('synthetic', 'synthetic'); }),
    });
    assert.deepEqual(writes, [], 'draft edits never persist business data');
  } finally {
    if (mounted) await act(async () => { root.unmount(); });
    clearSession(); globalThis.fetch = previousFetch;
    keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('real controlled catalog wrapper accepts rename, 3 to 4 rows and 1 to 2 groups after StrictMode reconnect', () => harness(true, async h => {
  assert.equal(h.state().connections, 2, 'the actual scope has passed StrictMode cleanup and reconnect');
  await h.click('＋ 添加展示行并定位');
  assert.match(h.status(), /请填写 0–1440/); assert.equal(h.state().menu[0].items.length, 3); assert.equal(h.state().dirty, false);
  await h.input('新增项目时间步长', '30'); await h.input('新增项目价格步长', '20');
  await h.click('＋ 添加展示行并定位');
  assert.equal(h.state().menu[0].items.length, 4, 'accepted parent draft has the fourth row');
  assert.equal(h.state().menu[0].items[3].pricing?.durationMin, 120);
  assert.equal(h.state().menu[0].items[3].pricing?.priceCents, 10000);
  assert.equal(h.state().menu[0].items[3].isVisible, false, 'new unbound rows start hidden');
  assert.equal(h.state().dirty, true); assert.match(h.status(), /已复制上一项/);
  await act(async () => { h.node(node => node.props.label === '第 1 组名称').props.onChange('Massage QA'); });
  assert.equal(h.state().menu[0].category, 'Massage QA');
  await h.click('＋ 新增分组'); assert.equal(h.state().menu.length, 2);
  await h.reopen(); assert.deepEqual(h.state().menu, savedMenu()); assert.equal(h.state().dirty, false);
}));

test('refused parent receipt keeps parsed paste and reports no successful draft addition', () => harness(true, async h => {
  const pasted = 'Extra\tNew wording\t$20';
  await act(async () => { h.node(node => node.type === 'textarea' && node.props.rows === 5).props.onChange({ target: { value: pasted } }); });
  assert.equal(h.state().paste, pasted);
  await h.click('解析并预览'); h.reject(true);
  await h.click('确认追加到本店草稿');
  assert.deepEqual(h.state().menu, savedMenu()); assert.equal(h.state().paste, pasted);
  assert.match(h.status(), /未接收|上下文已变化/); assert.doesNotMatch(h.status(), /已追加 1 条展示行到本店草稿/);
  assert.ok(h.node(node => node.type === 'button' && text(node) === '确认追加到本店草稿'));
  h.reject(false); await h.click('确认追加到本店草稿');
  assert.equal(h.state().menu.length, 2); assert.equal(h.state().menu[1].items[0].isVisible, false);
  assert.equal(h.state().paste, ''); assert.match(h.status(), /已追加 1 条展示行草稿，当前均隐藏/);
}));

test('render event guards survive only same-identity reconnect and reject retired shop, actor, paste and navigation callbacks', () => harness(true, async h => {
  const old = h.callbacks();
  await act(async () => { shopStore.currentStoreId = '99'; });
  await act(async () => { assert.equal(old.onChange(savedMenu()), true, 'header filter cannot replace the explicit editor shop'); });
  await h.shop('6');
  await act(async () => { assert.equal(old.onChange([]), false); assert.equal(old.onPasteTextChange?.('stale'), false); old.onConfigureService?.('7'); });
  await assert.rejects(old.catalogLoader!({ kind: 'service', q: '', page: 1, pageSize: 10 }, new AbortController().signal), /上下文已变化/);
  assert.equal(h.state().configured, 0); assert.equal(h.state().paste, '');
  await h.shop('5'); assert.equal(old.onChange([]), false, 'returning to a shop never revives the old callback');
  const beforeActor = h.callbacks();
  await h.actor('8');
  assert.equal(beforeActor.onChange([]), false); assert.equal(beforeActor.onPasteTextChange?.('stale'), false);
  const beforeUnmount = h.callbacks(); await h.unmount();
  assert.equal(beforeUnmount.onChange([]), false); assert.equal(beforeUnmount.onPasteTextChange?.('stale'), false);
  await assert.rejects(beforeUnmount.catalogLoader!({ kind: 'service', q: '', page: 1, pageSize: 10 }, new AbortController().signal), /上下文已变化/);
}));

test('normal single-connection controlled wrapper accepts editing without StrictMode', () => harness(false, async h => {
  assert.equal(h.state().connections, 1); await h.click('＋ 新增分组');
  assert.equal(h.state().menu.length, 2); assert.equal(h.state().dirty, true);
}));

test('fresh StrictMode rename and group creation work before any parent draft rerender', async () => {
  await harness(true, async h => {
    await act(async () => { h.node(node => node.props.label === '第 1 组名称').props.onChange('Massage QA'); });
    assert.equal(h.state().menu[0].category, 'Massage QA'); assert.equal(h.state().dirty, true);
  });
  await harness(true, async h => {
    await h.click('＋ 新增分组'); assert.equal(h.state().menu.length, 2); assert.equal(h.state().dirty, true);
  });
});

test('catalog binding and its revision conditions share one explicit parent receipt', () => harness(true, async h => {
  const selectionRevision = 'a'.repeat(64);
  const option = { serviceId: '21', variantId: '31', serviceName: 'Massage', name: '60mins Massage', hasVariants: true, variantCount: 3, addOnCount: 0,
    isActive: true, parentIsActive: true, selectionRevision,
    preview: { ...savedMenu()[0].items[1], booking: { serviceId: '21', variantId: '31' }, bookingEnabled: true, bookingAvailable: true } };
  const choose = () => act(async () => { h.node(node => typeof node.type === 'function' && node.type.name === 'PriceMenuBookingFields').props.onCatalogSelect(option, 'bind'); });
  h.reject(true); await choose();
  assert.deepEqual(h.state().menu, savedMenu()); assert.deepEqual(h.state().selections, []); assert.doesNotMatch(h.status(), /已载入所选目录/);
  h.reject(false); await choose();
  assert.deepEqual(h.state().menu[0].items[0].booking, { serviceId: '21', variantId: '31' });
  assert.deepEqual(h.state().selections, [{ itemId: 'row-0', serviceId: '21', expectedSelectionRevision: selectionRevision }]);
  assert.match(h.status(), /已载入所选目录/);
}));

test('refused edits keep image controls, gallery choice and parsed paste available without successful notices', () => harness(true, async h => {
  h.reject(true);
  await act(async () => { h.node(node => node.props.label === '第 1 组名称').props.onChange('Rejected name'); });
  assert.equal(h.state().menu[0].category, 'Massage'); assert.match(h.status(), /父层未接收/);
  await act(async () => { h.node(node => node.props['aria-label'] === '本组第 1 项自动配图').props.onClick(); });
  assert.equal(h.node(node => node.props['aria-label'] === '本组第 1 项自动配图').props['aria-checked'], true);
  assert.doesNotMatch(h.status(), /已关闭本项自动配图/);
  await h.click('从图库选择');
  const firstImage = () => h.node(node => node.type === 'button' && String(node.props['aria-label'] ?? '').startsWith('选择图库图片 '));
  await act(async () => { firstImage().props.onClick(); });
  assert.equal(h.state().menu[0].items[0].imageUrl, undefined); assert.ok(firstImage(), 'rejected image choice keeps the gallery open');
  h.reject(false);
  const pasted = 'Extra\tStill recoverable\t$20';
  await act(async () => { h.node(node => node.type === 'textarea' && node.props.rows === 5).props.onChange({ target: { value: pasted } }); });
  await h.click('解析并预览'); h.reject(true); await h.click('清除粘贴内容');
  assert.equal(h.state().paste, pasted); assert.ok(h.node(node => node.type === 'button' && text(node) === '确认追加到本店草稿'));
}));

const linkedMenu = (): PriceMenuGroup[] => savedMenu().map(group => ({ ...group, items: group.items.map((row, index) => ({ ...row,
  booking: { serviceId: '21', variantId: String(31 + index) }, bookingEnabled: true, bookingAvailable: true,
  description: 'Editorial description', imageUrl: 'https://example.test/service.png',
})) }));

test('linked layout edits only editorial title and forwards exact service and variant after StrictMode reconnect', () => harness(true, async h => {
  const original = linkedMenu();
  assert.match(h.status(), /1\s+个展示分组 ·\s+3\s+条展示行/);
  const summary = h.node(node => node.props['aria-label'] === '本组第 2 项关联来源');
  assert.match(text(summary), /规格 #32/); assert.match(text(summary), /USD 60/); assert.match(text(summary), /60 分钟/);
  assert.equal(find(summary, node => ['input', 'select', 'textarea'].includes(String(node.type))), undefined);
  assert.equal(find(h.node(node => node.props['aria-label'] === '本组第 2 项'), node => typeof node.type === 'function' && ['PriceMenuItemPricingFields', 'PriceMenuBookingFields'].includes(node.type.name)), undefined);
  await act(async () => { h.node(node => node.props['aria-label'] === '本组第 2 项维护来源').props.onClick(); });
  assert.deepEqual(h.state().edited, [{ serviceId: '21', variantId: '32' }]);
  const old = h.callbacks();
  await act(async () => { h.node(node => node.props['aria-label'] === '本组第 2 项切换展示标题').props.onClick(); });
  await h.input('本组第 2 项展示标题', 'A calmer hour');
  const changed = h.state().menu[0].items[1];
  assert.equal(changed.name, 'A calmer hour');
  assert.deepEqual(changed.pricing, { ...original[0].items[1].pricing, titleMode: 'CUSTOM' });
  assert.deepEqual(changed.booking, original[0].items[1].booking);
  assert.equal(changed.description, original[0].items[1].description); assert.equal(changed.imageUrl, original[0].items[1].imageUrl);
  assert.deepEqual(h.state().menu[0].items[0], original[0].items[0]); assert.deepEqual(h.state().menu[0].items[2], original[0].items[2]);
  await h.shop('6'); old.onEditService?.('21', '32');
  await h.shop('5'); old.onEditService?.('21', '32');
  const beforeActor = h.callbacks(); await h.actor('8'); beforeActor.onEditService?.('21', '32');
  const beforeUnmount = h.callbacks(); await h.unmount(); beforeUnmount.onEditService?.('21', '32');
  assert.deepEqual(h.state().edited, [{ serviceId: '21', variantId: '32' }], 'old navigation callbacks never cross identities or unmount');
}, { initialMenu: linkedMenu }));

test('linked repair keeps the picker on refusal and accepts replacement plus revision in one receipt', () => harness(true, async h => {
  const selectionRevision = 'b'.repeat(64), original = linkedMenu();
  const pricing = { ...original[0].items[1].pricing!, durationMin: 120, priceCents: 10025 };
  const option = { serviceId: '21', variantId: '34', serviceName: 'Massage', name: '120 minute Massage', hasVariants: true, variantCount: 4, addOnCount: 0,
    isActive: true, parentIsActive: true, selectionRevision, preview: { name: formatPriceMenuTitle(pricing), priceText: '', pricing, booking: { serviceId: '21', variantId: '34' }, bookingEnabled: true, bookingAvailable: true } };
  await h.click('更换展示行关联');
  const picker = () => h.node(node => typeof node.type === 'function' && node.type.name === 'MenuCatalogPicker');
  h.reject(true); await act(async () => { picker().props.onSelect(option, true); });
  assert.deepEqual(h.state().menu, original); assert.deepEqual(h.state().selections, []); assert.ok(picker()); assert.doesNotMatch(h.status(), /已载入所选目录/);
  h.reject(false); await act(async () => { picker().props.onSelect(option, true); });
  const changed = h.state().menu[0].items[0];
  assert.deepEqual(changed.booking, { serviceId: '21', variantId: '34' });
  assert.equal(changed.pricing?.priceCents, 10025); assert.equal(changed.pricing?.durationMin, 120);
  assert.equal(changed.description, original[0].items[0].description); assert.equal(changed.imageUrl, original[0].items[0].imageUrl);
  assert.deepEqual(h.state().selections, [{ itemId: 'row-0', serviceId: '21', expectedSelectionRevision: selectionRevision }]);
  assert.match(h.status(), /已载入所选目录/);
  assert.equal(find(h.node(node => node.props['aria-label'] === '本组第 1 项'), node => typeof node.type === 'function' && node.type.name === 'MenuCatalogPicker'), undefined);
}, { initialMenu: linkedMenu }));

test('layout without catalog maintenance permission preserves editorial fields and omits repair controls', () => harness(true, async h => {
  const original = savedMenu();
  assert.match(h.status(), /需要本店目录维护权限/);
  assert.equal(find(h.node(node => node.props['aria-label'] === '本组第 1 项'), node => node.type === 'details' && node.props.className === 'price-menu-wide price-menu-repair'), undefined);
  assert.equal(find(h.node(node => node.props['aria-label'] === '本组第 1 项'), node => typeof node.type === 'function' && ['PriceMenuItemPricingFields', 'PriceMenuBookingFields'].includes(node.type.name)), undefined);
  await act(async () => { h.node(node => node.props['aria-label'] === '本组第 1 项切换展示标题').props.onClick(); });
  await h.input('本组第 1 项展示标题', 'Layout wording only');
  assert.equal(h.state().menu[0].items[0].name, 'Layout wording only');
  assert.deepEqual(h.state().menu[0].items[0].pricing, { ...original[0].items[0].pricing, titleMode: 'CUSTOM' });
}, { canManage: false }));

test('removing a linked row always requests confirmation even when another row retains the binding', () => harness(true, async h => {
  const original = linkedMenu(); original[0].items[1].booking = { ...original[0].items[0].booking! };
  await h.click('移除展示行');
  assert.equal(h.state().menu[0].items.length, 3);
  const confirmation = h.node(node => typeof node.type === 'function' && node.type.name === 'PriceMenuRemovalConfirmation');
  assert.ok(confirmation.props.request.impacts.some((impact: { kind: string; remainingBindings: number }) => impact.kind === 'variant' && impact.remainingBindings === 1));
  await act(async () => { confirmation.props.onCancel(); });
  assert.equal(h.state().menu[0].items.length, 3);
}, { initialMenu: () => { const menu = linkedMenu(); menu[0].items[1].booking = { ...menu[0].items[0].booking! }; return menu; } }));
