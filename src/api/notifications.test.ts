import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listNotificationTasks, notificationAvailability, notificationTaskCanRetry, readNotificationAvailability, readNotificationTaskPage, retryNotificationTask, taskQuery } from './notifications';
test('notification task filters use actual bounded server pagination',()=>{
  assert.equal(taskQuery('FAILED','PUSH',3,50).toString(),'page=3&pageSize=50&status=FAILED&channel=PUSH');
  assert.equal(taskQuery('','',1,25).has('status'),false);
  for(const args of [['SENT','',1,25],['','ANY',1,25],['','',0,25],['','',1,500]]as const)assert.throws(()=>taskQuery(args[0],args[1],args[2],args[3]));
});
test('malformed envelopes cannot turn a partial task page into full totals',async()=>{
  const original=globalThis.fetch;
  try{for(const data of [[],{items:[],total:100,page:1,pageSize:25,totalPages:1,summary:[]},{items:[],total:0,page:2,pageSize:25,totalPages:0,summary:[]}]){
    globalThis.fetch=async()=>Response.json(data);
    await assert.rejects(listNotificationTasks('','',1,25),/响应无效/);
  }}finally{globalThis.fetch=original;}
});
test('retry requests whitelist one reason and keep authenticated session credentials',async()=>{
 const original=globalThis.fetch;const controller=new AbortController();
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/v1/notifications/admin/tasks/00000000-0000-0000-0000-000000000001/retry');assert.equal(options?.method,'POST');assert.equal(options?.credentials,'include');assert.deepEqual(JSON.parse(String(options?.body)),{reason:'reviewed provider configuration'});return Response.json({queued:true,id:'00000000-0000-0000-0000-000000000001'});};
 try{assert.equal((await retryNotificationTask('00000000-0000-0000-0000-000000000001',' reviewed provider configuration ',controller.signal)).queued,true);}finally{globalThis.fetch=original;}
});
test('retry rejects short reasons and unsafe IDs before making a network request',()=>{
 assert.throws(()=>retryNotificationTask('../another-user','reviewed condition'),/重试原因/);
 assert.throws(()=>retryNotificationTask('00000000-0000-0000-0000-000000000001','x'),/重试原因/);
});
const task = (patch: Record<string,unknown> = {}) => ({ id:'00000000-0000-4000-8000-000000000020',topic:'BOOKING_CREATED',resourceType:'BOOKING',resourceId:'42',bookingId:'42',channel:'EMAIL',status:'BLOCKED',attempts:1,maxAttempts:5,retryCount:0,lastErrorCode:'ORDER_EMAIL_NOT_CONFIGURED',acceptedCount:0,createdAt:'2030-01-01T00:00:00.000Z',runAt:'2030-01-01T00:00:00.000Z',finishedAt:null,leaseUntil:null,canRetry:true,...patch });
const envelope = (items = [task()]) => ({ items,total:items.length,page:1,pageSize:25,totalPages:items.length?1:0,summary:[{status:'BLOCKED',channel:'EMAIL',total:items.length}] });
test('EMAIL/BLOCKED query reaches the exact authenticated GET and keeps task payload/contact fields out of state',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/v1/notifications/admin/tasks?page=1&pageSize=25&status=BLOCKED&channel=EMAIL');assert.equal(options?.credentials,'include');assert.ok(!options?.body);return Response.json(envelope([task({recipient:'hidden@example.test',dataJson:{secret:'do not copy'}})]));};
 try{const page=await listNotificationTasks('BLOCKED','EMAIL',1,25);assert.equal(calls,1);assert.equal(page.items[0].channel,'EMAIL');assert.equal(page.items[0].status,'BLOCKED');assert.doesNotMatch(JSON.stringify(page),/hidden@|recipient|dataJson|secret/);}finally{globalThis.fetch=original;}
});
test('invalid states, mixed channel filters, duplicate tasks and bad row totals cannot be displayed as valid EMAIL results',()=>{
 for(const row of [task({channel:'SMTP'}),task({status:'DELIVERED'}),task({channel:'PUSH'}),task({attempts:-1}),task({attempts:6}),task({canRetry:'true'}),task({lastErrorCode:'secret@example.test'}),task({bookingId:'9223372036854775808'})])assert.throws(()=>readNotificationTaskPage(envelope([row]),'BLOCKED','EMAIL',1,25),/响应无效/);
 assert.throws(()=>readNotificationTaskPage(envelope([task(),task()]),'BLOCKED','EMAIL',1,25),/响应无效/);
 assert.throws(()=>readNotificationTaskPage({...envelope(),summary:[{status:'BLOCKED',channel:'EMAIL',total:1},{status:'BLOCKED',channel:'EMAIL',total:1}]},'BLOCKED','EMAIL',1,25),/响应无效/);
 assert.equal(readNotificationTaskPage(envelope([task({channel:'PUSH',status:'FAILED'})]),'','',1,25).items[0].channel,'PUSH');
});
const availability=()=>({enabled:false,reason:'PUSH_NOT_CONFIGURED',inboxEnabled:true,worker:{enabled:false,automaticRetries:5,leaseSeconds:120,smsEnabled:false,smsReason:'SMS_CONSENT_NOT_ESTABLISHED',externalDelivery:'PROVIDER_ACCEPTANCE_ONLY',orderEmail:{enabled:true,provider:'resend',acceptanceIsDelivery:false}}});
test('configuration preserves disabled worker and provider readiness independently without copying keys or requiring EMAIL on an old push server',async()=>{
 const data=availability(),parsed=readNotificationAvailability({...data,ORDER_EMAIL_API_KEY:'secret',worker:{...data.worker,orderEmail:{...data.worker.orderEmail,apiKey:'secret'}}});
 assert.equal(parsed.worker.enabled,false);assert.equal(parsed.worker.orderEmail?.enabled,true);assert.doesNotMatch(JSON.stringify(parsed),/secret|apiKey|API_KEY/);
 const {orderEmail: _email,...oldWorker}=data.worker;assert.equal(readNotificationAvailability({...data,worker:oldWorker}).worker.orderEmail,undefined);
 assert.throws(()=>readNotificationAvailability({...data,worker:{...data.worker,orderEmail:{...data.worker.orderEmail,acceptanceIsDelivery:true}}}),/配置响应无效/);
 const original=globalThis.fetch;globalThis.fetch=async(url)=>{assert.equal(url,'/api/v1/notifications/config');return Response.json(data);};try{assert.equal((await notificationAvailability()).worker.enabled,false);}finally{globalThis.fetch=original;}
});
test('both EMAIL and PUSH unknown acceptance are blocked client-side even if a response advertises retry',()=>{
 for(const lastErrorCode of ['ORDER_EMAIL_ACCEPTANCE_UNKNOWN','PUSH_ACCEPTANCE_UNKNOWN'])assert.equal(notificationTaskCanRetry({canRetry:true,status:'FAILED',lastErrorCode}),false);
 assert.equal(notificationTaskCanRetry({canRetry:false,status:'BLOCKED',lastErrorCode:'ORDER_EMAIL_NOT_CONFIGURED'}),false);
 assert.equal(notificationTaskCanRetry({canRetry:true,status:'ACCEPTED',lastErrorCode:null}),false);
 assert.equal(notificationTaskCanRetry({canRetry:true,status:'BLOCKED',lastErrorCode:'ORDER_EMAIL_NOT_CONFIGURED'}),true);
 assert.equal(notificationTaskCanRetry({canRetry:true,status:'FAILED',lastErrorCode:'PUSH_PROVIDER_REJECTED'}),true);
});
test('a mismatched or unqueued retry receipt cannot report that this task was requeued',async()=>{
 const original=globalThis.fetch;
 try{for(const response of [{queued:true,id:'00000000-0000-4000-8000-000000000099'},{queued:false,id:'00000000-0000-4000-8000-000000000020'}]){globalThis.fetch=async()=>Response.json(response);await assert.rejects(retryNotificationTask('00000000-0000-4000-8000-000000000020','reviewed explicit rejection'),/重排结果无法核对/);}}finally{globalThis.fetch=original;}
});
