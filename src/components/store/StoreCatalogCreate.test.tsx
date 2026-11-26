import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogMutationRequest } from '../../types/catalogMutation';
import { readCatalogMutationReceipt } from '../../utils/catalogMutation';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreCatalogCreate } = await import('./StoreCatalogCreate');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node = tree as Node; return predicate(node) ? node : find(node.props.children, predicate);
}
function text(tree: unknown): string { return Array.isArray(tree) ? tree.map(text).join(' ') : React.isValidElement(tree) ? text((tree as Node).props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''; }
const receipt = (request: CatalogMutationRequest) => ({ operationId: '1', action: request.action, shopId: '5', serviceId: request.serviceId ?? '9', variantId: request.variantId ?? '11', created: { service: request.action === 'CREATE_SERVICE', variant: request.action !== 'LINK_EXISTING_VARIANT', display: !!request.display }, displayStatus: request.display ? 'ADDED' : 'NOT_REQUESTED', displayItemId: request.display ? 'qa-row' : null, priceMenuRevision: 'b'.repeat(64), selectionRevision: 'c'.repeat(64) });
const project = { id: '9', shopId: '5', name: 'Massage', isActive: false, selectionRevision: 'd'.repeat(64), variants: [{ id: '10', serviceId: '9', name: '60 min', durationMin: 60, priceCents: 6000, isActive: true }] } as any;

async function harness(run: (h: { click: (label: string) => Promise<void>; input: (label: string, value: string) => Promise<void>; save: () => Promise<void>; form: () => Node; button: (label: string) => Node; status: () => string; requests: CatalogMutationRequest[]; saved: unknown[]; lifecycle: () => any; fail: (value: boolean) => void; failRefresh: (value: boolean) => void; readKeys: string[]; changeScope: () => Promise<void> }) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const, descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const doc: any = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} }; const win = { document: doc, HTMLIFrameElement: class {}, event: undefined }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  let tree: unknown, scope = 'actor-1:5', failed = false, refreshFailed = false, state: unknown; const requests: CatalogMutationRequest[] = [], saved: unknown[] = [], readKeys: string[] = [];
  function Probe() { tree = StoreCatalogCreate({ shopId: '5', scopeKey: scope, priceMenuRevision: 'a'.repeat(64), menu: [{ category: 'Massage', items: [] }], project, disabled: false, beforeWrite: () => true, isCurrent: () => true, submit: async (_shop, request) => { requests.push(structuredClone(request)); if (failed) throw Error('Synthetic lost response'); return receipt(request); }, readReceipt: async (_shop, key) => { readKeys.push(key); return receipt(requests[0]); }, onSaved: async value => { saved.push(value); if (refreshFailed) throw Error('Synthetic directory refresh unavailable'); }, onLifecycleChange: value => { state = value; } }); return null; }
  const root = createRoot(container as unknown as HTMLElement);
  const node = (predicate: (node: Node) => boolean) => { const found = find(tree, predicate); assert.ok(found, 'expected control'); return found; };
  const render = () => act(async () => root.render(<StrictMode><Probe /></StrictMode>));
  try {
    await render();
    await run({ click: label => act(async () => node(value => value.type === 'button' && text(value).trim() === label).props.onClick()), input: (label, value) => act(async () => { const wrapper = node(row => row.type === 'label' && text(row).startsWith(label)); const input = find(wrapper.props.children, row => ['input', 'select', 'textarea'].includes(String(row.type))); assert.ok(input); input.props.onChange({ target: { value, checked: value === 'true' } }); }), save: () => act(async () => node(value => value.type === 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} })), form: () => node(value => value.type === 'form'), button: label => node(value => value.type === 'button' && text(value).trim() === label), status: () => text(tree), requests, saved, lifecycle: () => state, fail: value => { failed = value; }, failRefresh: value => { refreshFailed = value; }, readKeys, changeScope: async () => { scope = 'actor-2:5'; await render(); } });
  } finally { await act(async () => root.unmount()); keys.forEach((key, index) => { const descriptor = descriptors[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
}

test('new service and optional row submit one command with exact USD cents after StrictMode reconnect', () => harness(async h => {
  await h.click('＋ 新增服务'); await h.input('服务名称', 'Foot Massage'); await h.input('规格名称', '30 min'); await h.input('预约占用时长', '30'); await h.input('整次订单价格', '0.01'); await h.save();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].variant?.priceCents, 1); assert.equal(h.requests[0].service?.name, 'Foot Massage'); assert.deepEqual(h.requests[0].display, { groupIndex: 0 }); assert.equal(h.saved.length, 1); assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false });
}));
test('a new 120 minute variant retains the service ID, source revision and exact 100.25 whole-order USD', () => harness(async h => {
  await h.click('＋ 为此服务新增规格'); await h.input('规格名称', '120 min'); await h.input('预约占用时长', '120'); await h.input('整次订单价格', '100.25'); assert.match(h.status(), /此服务已暂停/); await h.save();
  assert.equal(h.requests[0].serviceId, '9'); assert.equal(h.requests[0].expectedSelectionRevision, 'd'.repeat(64)); assert.equal(h.requests[0].service, undefined); assert.equal(h.requests[0].variant?.priceCents, 10025);
}));
test('new service accepts the shared metadata and variant text limits without truncating the request', () => harness(async h => {
  const name = 'N'.repeat(200), description = 'D'.repeat(10000), variantName = 'V'.repeat(100);
  await h.click('＋ 新增服务'); await h.input('服务名称', name); await h.input('服务说明', description); await h.input('规格名称', variantName); await h.input('整次订单价格', '60');
  const variantLabel = find(h.form(), node => node.type === 'label' && text(node).startsWith('规格名称'));
  assert.equal(find(variantLabel, node => node.type === 'input')?.props.maxLength, 100);
  await h.save();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].service?.name, name); assert.equal(h.requests[0].service?.description, description); assert.equal(h.requests[0].variant?.name, variantName); assert.equal(h.saved.length, 1);
}));

for (const [label, value, error] of [
  ['服务名称', 'N'.repeat(201), /服务名称最多 200/],
  ['服务说明', 'D'.repeat(10001), /服务说明最多 10000/],
  ['规格名称', 'V'.repeat(101), /规格名称最多 100/],
] as const) test(`overlong ${label} stays in the new-service draft without posting`, () => harness(async h => {
  await h.click('＋ 新增服务'); await h.input('服务名称', 'Foot Massage'); await h.input('规格名称', '60 min'); await h.input('整次订单价格', '60'); await h.input(label, value); await h.save();
  assert.equal(h.requests.length, 0); assert.equal(h.saved.length, 0); assert.match(h.status(), error);
  const wrapper = find(h.form(), node => node.type === 'label' && text(node).startsWith(label));
  assert.equal(find(wrapper, node => ['input', 'textarea'].includes(String(node.type)))?.props.value, value);
  assert.deepEqual(h.lifecycle(), { dirty: true, busy: false, unknown: false });
}));

test('overlong name on a new variant of an existing service is rejected before posting', () => harness(async h => {
  await h.click('＋ 为此服务新增规格'); await h.input('规格名称', 'V'.repeat(101)); await h.input('整次订单价格', '60'); await h.save();
  assert.equal(h.requests.length, 0); assert.match(h.status(), /规格名称最多 100/); assert.equal(h.lifecycle().unknown, false);
}));

test('existing variant association submits no business price or duplicate variant', () => harness(async h => {
  await h.click('将已有规格加入顾客价目'); await h.input('已有规格', '10'); await h.save(); assert.equal(h.requests[0].variantId, '10'); assert.equal(h.requests[0].variant, undefined); assert.equal(h.requests[0].action, 'LINK_EXISTING_VARIANT');
}));
test('unknown response keeps draft and operation key; read-only recovery never posts twice', () => harness(async h => {
  h.fail(true); await h.click('＋ 为此服务新增规格'); await h.input('规格名称', '120 min'); await h.input('预约占用时长', '120'); await h.input('整次订单价格', '100.25'); await h.save(); assert.equal(h.lifecycle().unknown, true); assert.match(h.status(), /可能已经保存/); await h.click('只读核对本次保存结果'); assert.equal(h.requests.length, 1); assert.deepEqual(h.readKeys, [h.requests[0].idempotencyKey]); assert.equal(h.saved.length, 1);
}));
test('invalid amounts keep input and stale actor callbacks cannot create objects', () => harness(async h => {
  await h.click('＋ 为此服务新增规格'); await h.input('规格名称', '120 min'); await h.input('预约占用时长', '120'); await h.input('整次订单价格', '100.251'); await h.save(); assert.equal(h.requests.length, 0); assert.match(h.status(), /美元/); const stale = h.form().props.onSubmit; await h.input('整次订单价格', '100.25'); await h.changeScope(); await act(async () => stale({ preventDefault() {}, stopPropagation() {} })); assert.equal(h.requests.length, 0);
}));
test('malformed or cross-scope receipts never acknowledge success', () => {
  const request: CatalogMutationRequest = { action: 'LINK_EXISTING_VARIANT', idempotencyKey: 'qa', expectedPriceMenuRevision: 'a'.repeat(64), serviceId: '9', variantId: '10', display: { groupIndex: 0 } };
  assert.throws(() => readCatalogMutationReceipt({ ...receipt(request), shopId: '6' }, '5', request));
  assert.throws(() => readCatalogMutationReceipt({ ...receipt(request), variantId: '12' }, '5', request));
  assert.throws(() => readCatalogMutationReceipt({ ...receipt(request), displayItemId: null }, '5', request));
  const alreadyLinked = { ...receipt(request), displayStatus: 'ALREADY_LINKED', displayItemId: null, created: { service: false, variant: false, display: false } };
  assert.equal(readCatalogMutationReceipt(alreadyLinked, '5', request).displayItemId, null, 'legacy rows without IDs can acknowledge an existing association without creating a duplicate');
  assert.throws(() => readCatalogMutationReceipt({ ...alreadyLinked, displayItemId: '' }, '5', request));
});

async function variantDraft(h: { click: (label: string) => Promise<void>; input: (label: string, value: string) => Promise<void> }) {
  await h.click('＋ 为此服务新增规格'); await h.input('规格名称', '120 min'); await h.input('预约占用时长', '120'); await h.input('整次订单价格', '100.25');
}
const submitEvent = () => ({ preventDefault() {}, stopPropagation() {} });

test('canceling a catalog creation retires its retained submit callback', () => harness(async h => {
  await variantDraft(h); const old = h.form().props.onSubmit; await h.click('取消本次新增'); await act(async () => { old(submitEvent()); });
  assert.equal(h.requests.length, 0); assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false });
}));
test('a retained cancel callback cannot erase a replacement creation draft', () => harness(async h => {
  await variantDraft(h); const old = h.button('取消本次新增').props.onClick; await h.click('取消本次新增'); await variantDraft(h); await h.input('规格名称', 'New replacement draft');
  await act(async () => { old(); });
  assert.match(h.status(), /新增规格/); assert.equal(h.lifecycle().dirty, true);
  const label = find(h.form(), node => node.type === 'label' && text(node).startsWith('规格名称'));
  assert.equal(find(label, node => node.type === 'input')?.props.value, 'New replacement draft'); assert.equal(h.requests.length, 0);
}));
test('a retained start callback cannot replace an open creation draft', () => harness(async h => {
  const old = h.button('＋ 新增服务').props.onClick; await variantDraft(h); await act(async () => { old(); });
  assert.match(h.status(), /为 Massage 新增规格/); assert.equal(find(h.form(), node => node.type === 'label' && text(node).startsWith('服务名称')), undefined); assert.equal(h.requests.length, 0);
}));
test('a retained submit callback cannot resend an unknown catalog operation', () => harness(async h => {
  h.fail(true); await variantDraft(h); const old = h.form().props.onSubmit; await h.save(); await act(async () => { old(submitEvent()); });
  assert.equal(h.requests.length, 1); assert.equal(h.lifecycle().unknown, true); assert.equal(h.lifecycle().dirty, true);
}));
test('a retained cancel callback cannot clear an unknown catalog operation or unlock new creation', () => harness(async h => {
  h.fail(true); await variantDraft(h); const old = h.button('取消本次新增').props.onClick; await h.save(); await act(async () => { old(); });
  assert.equal(h.lifecycle().dirty, true); assert.equal(h.lifecycle().unknown, true); assert.ok(h.form()); assert.equal(h.requests.length, 1); assert.match(h.status(), /只读核对本次保存结果/);
}));
test('a retained input cannot change the draft of an unknown catalog operation', () => harness(async h => {
  h.fail(true); await variantDraft(h); const label = find(h.form(), node => node.type === 'label' && text(node).startsWith('规格名称'));
  const old = find(label, node => node.type === 'input')!.props.onChange; await h.save(); await act(async () => { old({ target: { value: 'Unsubmitted replacement' } }); });
  const current = find(h.form(), node => node.type === 'label' && text(node).startsWith('规格名称'));
  assert.equal(find(current, node => node.type === 'input')?.props.value, '120 min'); assert.equal(h.requests.length, 1); assert.equal(h.lifecycle().unknown, true);
}));
test('refresh failure after successful creation retains the exact draft and recovers only by receipt read', () => harness(async h => {
  h.failRefresh(true); await variantDraft(h); await h.save();
  assert.equal(h.requests.length, 1); assert.equal(h.lifecycle().unknown, true); assert.equal(h.lifecycle().dirty, true); assert.match(h.status(), /Synthetic directory refresh unavailable/);
  h.failRefresh(false); await h.click('只读核对本次保存结果');
  assert.deepEqual(h.readKeys, [h.requests[0].idempotencyKey]); assert.equal(h.requests.length, 1); assert.deepEqual(h.lifecycle(), { dirty: false, busy: false, unknown: false });
}));
test('a retained submit cannot create again after its successful acknowledgement closes the draft', () => harness(async h => {
  await variantDraft(h); const old = h.form().props.onSubmit; await h.save(); await act(async () => { old(submitEvent()); });
  assert.equal(h.requests.length, 1); assert.equal(h.saved.length, 1); assert.equal(h.lifecycle().dirty, false);
}));
