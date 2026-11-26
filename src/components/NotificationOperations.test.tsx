import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NotificationOperations, { NotificationAvailabilityPanel, NotificationTaskRow, notificationTaskReason, orderEmailReadiness } from './NotificationOperations';
import type { NotificationAvailability, NotificationTask } from '../api/notifications';
const availability=(configured:boolean,workerEnabled:boolean):NotificationAvailability=>({enabled:false,inboxEnabled:true,worker:{enabled:workerEnabled,automaticRetries:5,leaseSeconds:120,smsEnabled:false,smsReason:'SMS_CONSENT_NOT_ESTABLISHED',externalDelivery:'PROVIDER_ACCEPTANCE_ONLY',orderEmail:{enabled:configured,provider:configured?'resend':null,acceptanceIsDelivery:false}}});
const task=(patch:Partial<NotificationTask>={}):NotificationTask=>({id:'00000000-0000-4000-8000-000000000020',topic:'BOOKING_CREATED',resourceType:'BOOKING',resourceId:'42',bookingId:'42',channel:'EMAIL',status:'BLOCKED',attempts:1,maxAttempts:5,retryCount:0,lastErrorCode:'ORDER_EMAIL_NOT_CONFIGURED',acceptedCount:0,createdAt:'2030-01-01T00:00:00Z',runAt:'2030-01-01T00:00:00Z',finishedAt:null,leaseUntil:null,canRetry:true,...patch});
const row=(item:NotificationTask)=>renderToStaticMarkup(<table><tbody><NotificationTaskRow item={item} onRetry={()=>{throw Error('SSR must never retry');}}/></tbody></table>);
test('initial notification operations offers EMAIL/BLOCKED filters without requesting or sending on render',()=>{
 const html=renderToStaticMarkup(<NotificationOperations/>);assert.match(html,/<option value="EMAIL">订单邮件/);assert.match(html,/<option value="BLOCKED">条件未满足/);assert.match(html,/受理未知任务不可直接重排/);assert.doesNotMatch(html,/已发送|已送达|崩溃恢复可能重复外部请求/);
});
test('email readiness distinguishes missing sender configuration and stopped processing from delivery',()=>{
 assert.match(orderEmailReadiness(availability(false,false)),/尚未配置.*不会发送/);
 const stopped=renderToStaticMarkup(<NotificationAvailabilityPanel config={availability(true,false)}/>);assert.match(stopped,/已配置.*处理器未启动.*不会自动发送/);
 const ready=renderToStaticMarkup(<NotificationAvailabilityPanel config={availability(true,true)}/>);assert.match(ready,/启用处理；服务受理不代表客人或门店已收到/);assert.doesNotMatch(ready,/邮件已送达/);
});
test('blocked and obsolete snapshots use specific Chinese operational reasons, with server retry permission respected',()=>{
 const missing=row(task());assert.match(missing,/订单邮件/);assert.match(missing,/条件未满足/);assert.match(missing,/订单仍已保存/);assert.match(missing,/检查后重试/);
 const stale=row(task({canRetry:false,lastErrorCode:'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE'}));assert.match(stale,/历史订单快照无法核对/);assert.doesNotMatch(stale,/检查后重试/);
 assert.match(notificationTaskReason('ORDER_EMAIL_EVENT_OBSOLETE'),/旧邮件事件作废/);
});
test('unknown acceptance never renders a retry control even with forged canRetry and EMAIL acceptance is not counted as devices',()=>{
 for(const channel of ['EMAIL','PUSH']as const){const html=row(task({channel,status:'FAILED',lastErrorCode:channel==='EMAIL'?'ORDER_EMAIL_ACCEPTANCE_UNKNOWN':'PUSH_ACCEPTANCE_UNKNOWN',canRetry:true}));assert.match(html,/先核对受理记录/);assert.match(html,/禁止直接重新排队/);assert.doesNotMatch(html,/检查后重试/);}
 const email=row(task({status:'ACCEPTED',acceptedCount:1,canRetry:false,lastErrorCode:null}));assert.match(email,/渠道受理 1 次请求/);assert.match(email,/不代表送达/);assert.doesNotMatch(email,/台设备/);
 const push=row(task({channel:'PUSH',status:'ACCEPTED',acceptedCount:2,canRetry:false,lastErrorCode:'PUSH_PARTIAL_ACCEPTANCE'}));assert.match(push,/渠道受理 2 台设备/);assert.match(push,/部分设备已受理/);assert.doesNotMatch(push,/检查后重试/);
});
