import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const shop='9007199254740993', id='9007199254740994';
const order=(extra={})=>({id,shopId:shop,orderNo:'SYNTHETIC',userId:'3',productId:'4',amountCents:5735,paidCents:0,refundedCents:0,currency:'usd',status:'PENDING',paymentMethod:'PAY_AT_STORE',entitlementId:null,receipts:[],refunds:[],allowedActions:{cancel:false,recordReceipt:true,recordRefund:false},...extra});
const response=(config,data)=>({config,data,status:200,statusText:'OK',headers:{}});
const server=()=>createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});

test('merchant gift policy and paginated orders remain exact-shop scoped with authoritative action flags',async()=>{
  const previous=axios.defaults.adapter,calls=[];let foreign=false;
  axios.defaults.adapter=async config=>{calls.push(config);return response(config,config.url.endsWith('sales-policy')?{shopId:shop,payAtStoreEnabled:!!config.data,onlinePaymentEnabled:false,paymentMethods:config.data?['PAY_AT_STORE']:[]}:{items:[order(foreign?{shopId:'other'}:{})],total:26,page:2,pageSize:25,totalPages:2});};
  const vite=await server();
  try{const api=await vite.ssrLoadModule('/src/api/gifts.ts');assert.equal((await api.getGiftSalesPolicy(shop)).payAtStoreEnabled,false);assert.equal((await api.saveGiftSalesPolicy(shop,true)).payAtStoreEnabled,true);assert.deepEqual(JSON.parse(calls[1].data),{payAtStoreEnabled:true});
    const query={page:2,pageSize:25,status:'PENDING',userId:'3'};assert.equal((await api.getGiftOrders(shop,query)).items[0].id,id);assert.deepEqual(calls[2].params,query);foreign=true;await assert.rejects(api.getGiftOrders(shop,query),/与当前门店不符/);
  }finally{axios.defaults.adapter=previous;await vite.close();}
});
test('merchant receipt and refund transport reuse exact request evidence and fail closed on an unconfirmed refund',async()=>{
  const previous=axios.defaults.adapter,calls=[];let validRefund=false;
  axios.defaults.adapter=async config=>{calls.push(config);return response(config,{item:order({status:config.url.endsWith('refunds')?'REFUNDED':'PAID',paidCents:5735,refundedCents:config.url.endsWith('refunds')&&validRefund?5735:0,entitlementId:'synthetic-right'})});};
  const vite=await server();const body={amountCents:5735,method:'CASH',reason:'Synthetic customer-visible note',requestKey:'same-key'};
  try{const api=await vite.ssrLoadModule('/src/api/gifts.ts');await api.recordGiftSale(shop,id,'receipts',body);await api.recordGiftSale(shop,id,'receipts',body);assert.deepEqual(JSON.parse(calls[0].data),JSON.parse(calls[1].data));assert.equal(calls[0].url,`/gift-cards/admin/shops/${shop}/orders/${id}/receipts`);await assert.rejects(api.recordGiftSale(shop,id,'refunds',body),/收退款结果尚未确认/);validRefund=true;assert.equal((await api.recordGiftSale(shop,id,'refunds',body)).refundedCents,5735);
  }finally{axios.defaults.adapter=previous;await vite.close();}
});
