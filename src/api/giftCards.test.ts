import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGiftOrder, getGiftSalesPolicy, listGiftEntitlements, listGiftOrders, listGiftRedemptions, recordGiftSale, setGiftSalesPolicy, type GiftOrder } from './giftCards';

const shop='9007199254740993',id='9007199254740994';
const order=(overrides:Partial<GiftOrder>={}):GiftOrder=>({id,shopId:shop,orderNo:'SYNTHETIC',userId:'3',productId:'4',productTitleSnapshot:'Synthetic gift',useTimesSnapshot:3,expireDaysSnapshot:30,amountCents:5735,paidCents:0,refundedCents:0,currency:'usd',status:'PENDING',paymentMethod:'PAY_AT_STORE',entitlementId:null,createdAt:'2031-01-01T00:00:00Z',timezone:null,createdAtLocal:null,receipts:[],refunds:[],allowedActions:{cancel:false,recordReceipt:true,recordRefund:false},...overrides});

test('company gift wrappers retain per-row store zones and UTC/local evidence without reinterpreting them', async () => {
  const original = globalThis.fetch, timezone = 'America/New_York', createdAt = '2026-11-01T05:30:00Z', createdAtLocal = '2026-11-01 01:30 GMT-4';
  const row = order({timezone, createdAt, createdAtLocal, receipts:[{id:'receipt',amountCents:5735,method:'CASH',reference:null,reason:'Synthetic',createdAt,createdAtLocal,operatorId:'2'}]});
  const right = {id:'right',shopId:shop,userId:'3',productId:'4',source:'PURCHASE',status:'ACTIVE',totalUses:3,remainingUses:3,timezone,createdAt,createdAtLocal,expiresAt:'2027-01-01T02:30:00Z',expiresAtLocal:'2026-12-31 21:30 GMT-5'};
  const redemption = {id:'redemption',entitlementId:'right',shopId:shop,operatorId:'2',usedUses:1,timezone,createdAt,createdAtLocal};
  globalThis.fetch = async input => {
    const path = new URL(String(input),'http://local.invalid').pathname;
    const items = path.endsWith('/entitlements') ? [right] : path.endsWith('/redemptions') ? [redemption] : [row];
    return Response.json(path.endsWith('/'+id) ? {item:row} : {shopId:shop,items,total:1,page:1,pageSize:20,totalPages:1});
  };
  try {
    assert.deepEqual(await getGiftOrder(shop,id),row);
    assert.deepEqual((await listGiftOrders(shop,{page:1,pageSize:20})).items,[row]);
    assert.deepEqual((await listGiftEntitlements(shop,{page:1,pageSize:20})).items,[right]);
    assert.deepEqual((await listGiftRedemptions(shop,{page:1,pageSize:20})).items,[redemption]);
  } finally { globalThis.fetch = original; }
});

test('gift sales policy is explicit, scoped to exact shop and keeps online payment disabled',async()=>{
  const original=globalThis.fetch;const calls:{url:string;body:unknown}[]=[];
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:options?.body?JSON.parse(String(options.body)):null});assert.equal(options?.credentials,'include');return Response.json({shopId:shop,payAtStoreEnabled:!!options?.body,onlinePaymentEnabled:false,paymentMethods:options?.body?['PAY_AT_STORE']:[]});};
  try{assert.equal((await getGiftSalesPolicy(shop)).payAtStoreEnabled,false);assert.equal((await setGiftSalesPolicy(shop,true)).payAtStoreEnabled,true);assert.deepEqual(calls,[{url:`/api/v1/gift-cards/admin/shops/${shop}/sales-policy`,body:null},{url:`/api/v1/gift-cards/admin/shops/${shop}/sales-policy`,body:{payAtStoreEnabled:true}}]);}
  finally{globalThis.fetch=original;}
});
test('gift order lists use submitted server filters and reject cross-shop or invented financial actions',async()=>{
  const original=globalThis.fetch;let row=order();
  globalThis.fetch=async url=>{const value=new URL(String(url),'http://local.invalid');assert.equal(value.searchParams.get('page'),'2');assert.equal(value.searchParams.get('pageSize'),'20');assert.equal(value.searchParams.get('status'),'PENDING');assert.equal(value.searchParams.get('userId'),'3');return Response.json({items:[row],total:21,page:2,pageSize:20,totalPages:2});};
  try{assert.equal((await listGiftOrders(shop,{page:2,pageSize:20,status:'PENDING',userId:'3'})).items[0].id,id);row=order({shopId:'other'});await assert.rejects(listGiftOrders(shop,{page:2,pageSize:20,status:'PENDING',userId:'3'}));row=order({paidCents:5736});await assert.rejects(listGiftOrders(shop,{page:2,pageSize:20,status:'PENDING',userId:'3'}));}
  finally{globalThis.fetch=original;}
});
test('receipt retries retain exact body and refunds require acknowledged authoritative final accounting',async()=>{
  const original=globalThis.fetch;const bodies:unknown[]=[];let refund=false,invalid=false;
  globalThis.fetch=async(url,options)=>{assert.equal(String(url),`/api/v1/gift-cards/admin/shops/${shop}/orders/${id}/${refund?'refunds':'receipts'}`);bodies.push(JSON.parse(String(options?.body)));return Response.json({item:order({status:refund?'REFUNDED':'PAID',paidCents:5735,refundedCents:refund&&!invalid?5735:0,entitlementId:'synthetic-right'})});};
  const payload={amountCents:5735,method:'CASH' as const,reason:'Synthetic customer-visible note',requestKey:'stable-key'};
  try{await recordGiftSale(shop,id,'receipts',payload);await recordGiftSale(shop,id,'receipts',payload);assert.deepEqual(bodies[0],bodies[1]);refund=true;invalid=true;await assert.rejects(recordGiftSale(shop,id,'refunds',payload),/无法确认/);invalid=false;assert.equal((await recordGiftSale(shop,id,'refunds',payload)).refundedCents,5735);}
  finally{globalThis.fetch=original;}
});
test('detail IDs must match and new purchased entitlements remain readable without treating them as promotions',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({item:order({id:'wrong'})});
  try{await assert.rejects(getGiftOrder(shop,id),/无法核对/);globalThis.fetch=async()=>Response.json({shopId:shop,items:[{id:'synthetic-right',shopId:shop,userId:'3',productId:'4',source:'PURCHASE',status:'ACTIVE',totalUses:3,remainingUses:3}],total:1,page:1,pageSize:20,totalPages:1});assert.equal((await listGiftEntitlements(shop,{page:1,pageSize:20})).items[0].source,'PURCHASE');}
  finally{globalThis.fetch=original;}
});
