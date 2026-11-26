import { apiRequest } from './session';
export const TASK_STATES = ['PENDING','PROCESSING','PUBLISHED','ACCEPTED','FAILED','SKIPPED','CANCELLED','BLOCKED'] as const;
export const TASK_CHANNELS = ['IN_APP','PUSH','SMS','EMAIL'] as const;
export type TaskState = typeof TASK_STATES[number];
export type TaskChannel = typeof TASK_CHANNELS[number];
export type NotificationAudience = 'CUSTOMER'|'SHOP';
export interface NotificationTask { id:string; topic:string; resourceType:string; resourceId:string; bookingId:string|null; channel:TaskChannel; audience?:NotificationAudience|null; status:TaskState; attempts:number; maxAttempts:number; retryCount:number; lastErrorCode:string|null; acceptedCount:number; createdAt:string; runAt:string; finishedAt:string|null; leaseUntil:string|null; canRetry:boolean }
export interface TaskPage { items:NotificationTask[]; total:number; page:number; pageSize:number; totalPages:number; summary:{status:TaskState;channel:TaskChannel;total:number}[] }
export interface NotificationAvailability { enabled:boolean; reason?:string; inboxEnabled:boolean; worker:{enabled:boolean;automaticRetries:number;leaseSeconds:number;smsEnabled:boolean;smsReason:string;externalDelivery:string;orderEmail?:{enabled:boolean;provider:'resend'|'local'|null;deliveryMode?:'PROVIDER'|'LOCAL_CAPTURE'|null;reasonCode?:string;acceptanceIsDelivery:false}} }
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const optionalDate=(v:unknown):v is string|null=>v===null||date(v);
const safeCode=(v:unknown):v is string|null=>v===null||typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(v);
function invalid():never{throw Error('通知列表响应无效。');}
export function taskQuery(status:string,channel:string,page:number,pageSize:number) {
  if (status && !(TASK_STATES as readonly string[]).includes(status) || channel && !(TASK_CHANNELS as readonly string[]).includes(channel) || !Number.isSafeInteger(page) || page<1 || page>1000000 || ![25,50,100].includes(pageSize)) throw new Error('通知筛选条件无效。');
  return new URLSearchParams({page:String(page),pageSize:String(pageSize),...(status?{status}:{}),...(channel?{channel}:{})});
}
export function readNotificationTaskPage(data:unknown,status:string,channel:string,page:number,pageSize:number):TaskPage {
  taskQuery(status,channel,page,pageSize);
  if (!record(data)||!Array.isArray(data.items)||data.items.length>pageSize||!Array.isArray(data.summary)||!integer(data.total)||data.page!==page||data.pageSize!==pageSize||data.totalPages!==Math.ceil(data.total/pageSize)||data.items.length>data.total) invalid();
  const ids=new Set<string>();
  const items=data.items.map((row):NotificationTask=>{
    if(!record(row)||!uuid(row.id)||ids.has(row.id)||typeof row.topic!=='string'||!/^[A-Z_]{1,40}$/.test(row.topic)||typeof row.resourceType!=='string'||!/^[A-Z_]{1,40}$/.test(row.resourceType)
      ||typeof row.resourceId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(row.resourceId)||row.bookingId!==null&&(typeof row.bookingId!=='string'||!/^([1-9]\d{0,18})$/.test(row.bookingId)||BigInt(row.bookingId)>9223372036854775807n)
      ||!(TASK_CHANNELS as readonly unknown[]).includes(row.channel)||!(TASK_STATES as readonly unknown[]).includes(row.status)||status&&row.status!==status||channel&&row.channel!==channel
      ||row.audience!==undefined&&![null,'CUSTOMER','SHOP'].includes(row.audience as null|string)
      ||!integer(row.attempts)||!integer(row.maxAttempts,1)||row.attempts>row.maxAttempts||!integer(row.retryCount)||!integer(row.acceptedCount)||!safeCode(row.lastErrorCode)||!date(row.createdAt)||!date(row.runAt)||!optionalDate(row.finishedAt)||!optionalDate(row.leaseUntil)||typeof row.canRetry!=='boolean')invalid();
    ids.add(row.id);return{id:row.id,topic:row.topic,resourceType:row.resourceType,resourceId:row.resourceId,bookingId:row.bookingId as string|null,channel:row.channel as TaskChannel,audience:(row.audience??null) as NotificationAudience|null,status:row.status as TaskState,attempts:row.attempts,maxAttempts:row.maxAttempts,retryCount:row.retryCount,lastErrorCode:row.lastErrorCode,acceptedCount:row.acceptedCount,createdAt:row.createdAt,runAt:row.runAt,finishedAt:row.finishedAt,leaseUntil:row.leaseUntil,canRetry:row.canRetry};
  });
  const summaryKeys=new Set<string>();
  const summary=data.summary.map(row=>{if(!record(row)||!(TASK_STATES as readonly unknown[]).includes(row.status)||!(TASK_CHANNELS as readonly unknown[]).includes(row.channel)||!integer(row.total)||summaryKeys.has(String(row.status)+':'+String(row.channel)))invalid();summaryKeys.add(String(row.status)+':'+String(row.channel));return{status:row.status as TaskState,channel:row.channel as TaskChannel,total:row.total};});
  return{items,total:data.total,page,pageSize,totalPages:data.totalPages as number,summary};
}
export async function listNotificationTasks(status:string,channel:string,page:number,pageSize:number,signal?:AbortSignal) {
  return readNotificationTaskPage(await apiRequest<unknown>(`/notifications/admin/tasks?${taskQuery(status,channel,page,pageSize)}`,{signal}),status,channel,page,pageSize);
}
export function readNotificationAvailability(raw:unknown):NotificationAvailability {
  if(!record(raw)||typeof raw.enabled!=='boolean'||typeof raw.inboxEnabled!=='boolean'||raw.reason!==undefined&&!safeCode(raw.reason)||!record(raw.worker)||typeof raw.worker.enabled!=='boolean'||!integer(raw.worker.automaticRetries)||!integer(raw.worker.leaseSeconds,1)||typeof raw.worker.smsEnabled!=='boolean'||typeof raw.worker.smsReason!=='string'||!safeCode(raw.worker.smsReason)||typeof raw.worker.externalDelivery!=='string'||!/^[A-Z_]{1,80}$/.test(raw.worker.externalDelivery))throw Error('通知通道配置响应无效。');
  const email=raw.worker.orderEmail;
  if(email!==undefined&&(!record(email)||typeof email.enabled!=='boolean'||![null,'resend','local'].includes(email.provider as null|string)||email.acceptanceIsDelivery!==false||email.reasonCode!==undefined&&!safeCode(email.reasonCode)
    ||email.deliveryMode!==undefined&&![null,'PROVIDER','LOCAL_CAPTURE'].includes(email.deliveryMode as null|string)
    ||email.provider==='local'&&email.deliveryMode!=='LOCAL_CAPTURE'||email.provider!=='local'&&email.deliveryMode==='LOCAL_CAPTURE'))throw Error('订单邮件配置响应无效。');
  return{enabled:raw.enabled,reason:raw.reason as string|undefined,inboxEnabled:raw.inboxEnabled,worker:{enabled:raw.worker.enabled,automaticRetries:raw.worker.automaticRetries,leaseSeconds:raw.worker.leaseSeconds,smsEnabled:raw.worker.smsEnabled,smsReason:raw.worker.smsReason,externalDelivery:raw.worker.externalDelivery,...(email?{orderEmail:{enabled:(email as Record<string,unknown>).enabled as boolean,provider:(email as Record<string,unknown>).provider as 'resend'|'local'|null,acceptanceIsDelivery:false as const,...((email as Record<string,unknown>).deliveryMode!==undefined?{deliveryMode:(email as Record<string,unknown>).deliveryMode as 'PROVIDER'|'LOCAL_CAPTURE'|null}:{}),...((email as Record<string,unknown>).reasonCode?{reasonCode:(email as Record<string,unknown>).reasonCode as string}:{})}}:{})}};
}
export async function notificationAvailability(signal?:AbortSignal){return readNotificationAvailability(await apiRequest<unknown>('/notifications/config',{signal}));}
/** Server permission remains necessary. Ambiguous acceptance must never expose a retry action. */
export function notificationTaskCanRetry(task:Pick<NotificationTask,'canRetry'|'lastErrorCode'|'status'>):boolean {
  return task.canRetry&&task.lastErrorCode!=='ORDER_EMAIL_ACCEPTANCE_UNKNOWN'&&task.lastErrorCode!=='PUSH_ACCEPTANCE_UNKNOWN'&&['FAILED','SKIPPED','BLOCKED'].includes(task.status);
}
export function retryNotificationTask(id:string,reason:string,signal?:AbortSignal) {
  const value=reason.trim();
  if (!uuid(id)||value.length<5||value.length>500) throw new Error('请填写 5–500 字的重试原因。');
  return apiRequest<unknown>(`/notifications/admin/tasks/${encodeURIComponent(id)}/retry`,{method:'POST',body:JSON.stringify({reason:value}),signal}).then(raw=>{
    if(!record(raw)||raw.id!==id||raw.queued!==true)throw Error('重排结果无法核对，请先刷新当前任务，不要重复操作。');
    return{queued:true as const,id};
  });
}
