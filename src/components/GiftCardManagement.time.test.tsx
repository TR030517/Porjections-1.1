import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../stores/authStore';
import { clearSession } from '../api/session';
import { shopStore } from '../stores/shop';
import { operations } from '../config/operations';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: GiftCardManagement } = await import('./GiftCardManagement');
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

async function harness(generic: boolean, missingZone: boolean, exercise: (h: { tab: (label: string) => Promise<void>; detail: () => Promise<void>; body: () => string }) => Promise<void>) {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), previousFetch = globalThis.fetch, previousZone = process.env.TZ;
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} } }; doc.defaultView = win;
  for (const [key, value] of Object.entries({ window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc, addEventListener() {}, removeEventListener() {}, textContent: '' };
  const timezone = missingZone ? null : 'America/New_York', createdAt = '2026-11-01T05:30:00Z';
  const order = { id:'9',shopId:'7',orderNo:'SYNTHETIC-GIFT',userId:'3',productId:'4',productTitleSnapshot:'Synthetic gift',useTimesSnapshot:2,expireDaysSnapshot:30,
    amountCents:1025,paidCents:1025,refundedCents:1025,currency:'usd',status:'REFUNDED',paymentMethod:'PAY_AT_STORE',entitlementId:'right',createdAt,timezone,
    receipts:[{id:'receipt',amountCents:1025,method:'CASH',reason:'Synthetic received',operatorId:'2',createdAt:'2026-11-01T06:30:00Z'}],
    refunds:[{id:'refund',amountCents:1025,method:'CASH',reason:'Synthetic refunded',operatorId:'2',createdAt:'2027-01-01T02:30:00Z'}],
    allowedActions:{cancel:false,recordReceipt:false,recordRefund:false} };
  const right = {id:'right',shopId:'7',userId:'3',productId:'4',orderId:'9',productTitleSnapshot:'Synthetic gift',source:'PURCHASE',status:'ACTIVE',totalUses:2,remainingUses:1,
    createdAt,timezone,expiresAt:'2027-01-01T02:30:00Z'};
  const redemption = {id:'redemption',entitlementId:'right',shopId:'7',operatorId:'2',usedUses:1,createdAt:'2026-11-01T06:30:00Z',timezone};
  const config = { salesEnabled:true,onlinePaymentEnabled:false,promotionalEntitlementsEnabled:true,reason:'Synthetic policy',credentialTtlSeconds:300 };
  const reads: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input),'http://synthetic.invalid'), path = url.pathname, user = {id:'2',role:'ADMIN',name:'Synthetic gift admin'};
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh')) return Response.json({accessToken:'test-only',user});
    if (path.endsWith('/auth/me')) return Response.json(user);
    assert.equal(options?.method ?? 'GET','GET','timestamp rendering cannot mutate business data'); reads.push(path);
    if (path.endsWith('/gift-cards/config')) return Response.json(config);
    if (path.endsWith('/sales-policy')) return Response.json({shopId:'7',payAtStoreEnabled:false,onlinePaymentEnabled:false,paymentMethods:[]});
    if (path.endsWith('/orders/9')) return Response.json({item:order});
    const items = path.endsWith('/entitlements') ? [right] : path.endsWith('/redemptions') ? [redemption] : generic ? [order,{...order,id:'10',shopId:'8',timezone:'America/Los_Angeles'}] : [order];
    assert.ok(/\/(?:orders|entitlements|redemptions|gift-card-orders)$/.test(path),path);
    return Response.json({shopId:'7',items,total:items.length,page:1,pageSize:20,totalPages:1});
  };
  clearSession(); shopStore.currentStoreId = generic ? null : '7'; process.env.TZ = 'Asia/Shanghai';
  let management: unknown, panel: unknown;
  function PanelProbe({node}:{node:Node}) { panel = (node.type as (props:any)=>React.ReactNode)(node.props); return null; }
  function ManagementProbe() {
    management = GiftCardManagement();
    const selected = find(management,node=>typeof node.type==='function'&&['GiftOrdersPanel','EntitlementsPanel','RedemptionsPanel'].includes(node.type.name));
    return selected ? <PanelProbe key={selected.key} node={selected} /> : null;
  }
  function GenericProbe() { panel = OperationalPage({config:operations['gift-card-orders']}); return null; }
  function SignedIn() { return useAuthStore().user ? generic ? <GenericProbe /> : <ManagementProbe /> : null; }
  const root = createRoot(container as unknown as HTMLElement);
  const button = (tree:unknown,label:string) => { const node = find(tree,node=>node.type==='button'&&text(node).trim()===label); assert.ok(node,label); return node; };
  try {
    await act(async()=>{root.render(<AuthProvider><SignedIn /></AuthProvider>);});
    await exercise({
      tab: label=>act(async()=>{button(management,label).props.onClick();}),
      detail: ()=>act(async()=>{button(panel,'查看 / 办理').props.onClick();}),
      body: ()=>text(panel),
    });
    assert.ok(reads.length>0);
  } finally {
    await act(async()=>{root.unmount();}); clearSession(); globalThis.fetch=previousFetch;
    if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone;
    keys.forEach((key,index)=>{const descriptor=descriptors[index];if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
  }
}

test('real company gift panels use store zones for order, receipt, refund, benefit and redemption timestamps', () => harness(false,false,async h=>{
  await h.tab('购买订单与销售政策'); assert.match(h.body(),/2026-11-01 01:30:00 GMT-4 · America\/New_York/);
  await h.detail(); assert.match(h.body(),/2026-11-01 01:30:00 GMT-5 · America\/New_York/); assert.match(h.body(),/2026-12-31 21:30:00 GMT-5 · America\/New_York/);
  assert.match(h.body(),/USD 10\.25/);
  await h.tab('顾客权益与赠送'); assert.match(h.body(),/2026-12-31 21:30:00 GMT-5 · America\/New_York/); assert.match(h.body(),/2026-11-01 01:30:00 GMT-4 · America\/New_York/);
  assert.doesNotMatch(h.body(),/本机|预约时区/);
  await h.tab('核销与记录'); assert.match(h.body(),/2026-11-01 01:30:00 GMT-5 · America\/New_York/); assert.doesNotMatch(h.body(),/本机/);
}));

test('real company gift panels explicitly report a missing store zone', () => harness(false,true,async h=>{
  for (const label of ['购买订单与销售政策','顾客权益与赠送','核销与记录']) {
    await h.tab(label); assert.match(h.body(),/门店时区未配置/); assert.doesNotMatch(h.body(),/GMT|本机|预约时区/);
  }
}));

test('the generic company gift-order list uses each row zone across shops, independently of selected store and device', () => harness(true,false,async h=>{
  assert.match(h.body(),/2026-11-01 01:30:00 GMT-4 · America\/New_York/);
  assert.match(h.body(),/2026-10-31 22:30:00 GMT-7 · America\/Los_Angeles/);
  assert.doesNotMatch(h.body(),/本机时间|预约时区/);
}));
