import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { enqueueNotification, notificationInput, syncBookingReminder, NOTIFICATION_TOPICS } from '../../common/notification-outbox';
import { boundedPush, notificationText, pushOutcome, retryAt } from './notification.rules';
import { NotificationInboxService, inboxItem } from './notification-inbox.service';
import { NotificationWorker, OutboxRow } from './notification-worker.service';
import { InboxQueryDto, PreferenceDto, RetryNotificationDto } from './dto/notification.dto';

const input = { eventKey: 'booking:1:created', userId: '1', topic: 'BOOKING_CREATED' as const, resourceType: 'BOOKING' as const, resourceId: '1', bookingId: '1' };
const sql = (query: any) => query.strings.join('?');
describe('transactional notification boundaries (no database or provider calls)', () => {
  test('stable canonical content ignores object key order and scheduling retry time', () => {
    const a=notificationInput({...input,data:{currency:'usd',amountCents:1250}});
    const b=notificationInput({...input,runAt:new Date('2030-01-01Z'),data:{amountCents:1250,currency:'usd'}});
    expect(a.hash).toBe(b.hash);
    expect(notificationInput({...input,userId:'2'}).hash).not.toBe(a.hash);
  });
  test.each([{...input,userId:'-1'},{...input,eventKey:'email@example.com'},{...input,resourceId:'https://bad'},{...input,data:{phone:'+15555555555'}}])('rejects unsafe identity / keys / arbitrary private payload', value=>expect(()=>notificationInput(value as any)).toThrow());
  test('enqueue persists three channels with stable event identity and no external dispatch', async()=>{
    const tx={ $executeRaw:jest.fn(async()=>1),$queryRaw:jest.fn(async()=>[{content_hash:notificationInput(input).hash}])};
    await enqueueNotification(tx as any,input);await enqueueNotification(tx as any,input);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(6);
    expect(tx.$executeRaw.mock.calls.slice(0,3).map((call:any)=>call[0].values.find((v:any)=>['IN_APP','PUSH','SMS'].includes(v)))).toEqual(['IN_APP','PUSH','SMS']);
    expect(sql((tx.$executeRaw.mock.calls as any)[0][0])).toContain('ON DUPLICATE KEY UPDATE');
  });
  test('an existing event key cannot silently switch recipient or content',async()=>{
    await expect(enqueueNotification({$executeRaw:async()=>1,$queryRaw:async()=>[{content_hash:'different'}]}as any,input)).rejects.toThrow('NOTIFICATION_EVENT_KEY_CONFLICT');
  });
  test('cancelled / past bookings invalidate old reminders without creating replacements',async()=>{
    const tx={$executeRaw:jest.fn(async()=>1)};
    await syncBookingReminder(tx as any,{id:'1',userId:'1',status:'CANCELLED',startTime:new Date('2030-01-02Z')},new Date('2030-01-01Z'));
    await syncBookingReminder(tx as any,{id:'1',userId:'1',status:'CONFIRMED',startTime:new Date('2020-01-02Z')},new Date('2030-01-01Z'));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);expect(sql((tx.$executeRaw.mock.calls as any)[0][0])).toContain("status IN ('PENDING','PROCESSING')");
  });
  test('confirmed reminder uses UTC start minus 30m and only revives cancelled tasks',async()=>{
    const calls:any[]=[];const tx={$executeRaw:async(q:any)=>{calls.push(q);return 1;},$queryRaw:async(q:any)=>[{content_hash:notificationInput({eventKey:'booking:1:reminder:1893542400000',userId:'1',topic:'BOOKING_REMINDER',resourceType:'BOOKING',resourceId:'1',bookingId:'1',expectedStartAtUtc:new Date('2030-01-02T00:00Z')}).hash}]};
    await syncBookingReminder(tx as any,{id:'1',userId:'1',status:'CONFIRMED',startTime:new Date('2030-01-02T00:00Z')},new Date('2030-01-01Z'));
    expect(calls[1].values.some((v:any)=>v instanceof Date&&v.toISOString()==='2030-01-01T23:30:00.000Z')).toBe(true);
    expect(sql(calls.at(-1))).toContain("status='CANCELLED'");
  });
  test('provider acceptance / partial acceptance / disabled are distinct, never delivered',()=>{
    expect(pushOutcome({sent:1,failed:2})).toEqual({status:'ACCEPTED',code:'PUSH_PARTIAL_ACCEPTANCE',accepted:1});
    expect(pushOutcome({error:'PUSH_NOT_CONFIGURED'}).status).toBe('SKIPPED');
    expect(pushOutcome({failed:1,error:'raw provider private text'})).toEqual({status:'FAILED',code:'PUSH_PROVIDER_REJECTED',accepted:0});
    expect(retryAt(1,new Date(0)).getTime()).toBe(30000);expect(retryAt(30,new Date(0)).getTime()).toBe(3600000);
  });
  test('all supported topics use fixed bounded English templates with no customer payload',()=>{
    for(const topic of NOTIFICATION_TOPICS){
      const text=notificationText(topic);
      expect(text.title.length).toBeLessThanOrEqual(200);
      expect(text.body.length).toBeLessThanOrEqual(1000);
      expect(`${text.title} ${text.body}`).not.toMatch(/\p{Script=Han}/u);
      expect(text.title).not.toContain(' / ');
    }
  });
  test('the booking refund notification directs both cash and online customers to their booking', () => {
    expect(notificationText('REFUND_PROCESSED').body).toBe(
      'Open your booking to review the refund record and current status.',
    );
  });
  test('hung provider stops the lease heartbeat path with ambiguous acceptance and aborts further device dispatch',async()=>{
    jest.useFakeTimers();
    try { let signal:AbortSignal|undefined;const pending=boundedPush(s=>{signal=s;return new Promise(()=>undefined);},100);
      const assertion=expect(pending).rejects.toThrow('PUSH_ACCEPTANCE_UNKNOWN');
      await jest.advanceTimersByTimeAsync(100);await assertion;expect(signal?.aborted).toBe(true);
    } finally { jest.useRealTimers(); }
  });
  test('DTO rejects mass assignment, malformed paging and implicit string opt-in',async()=>{
    for(const [type,value]of [[PreferenceDto,{pushEnabled:'true'}],[PreferenceDto,{pushEnabled:true,smsEnabled:true}],[InboxQueryDto,{page:0}],[InboxQueryDto,{pageSize:101}],[RetryNotificationDto,{reason:'x'}]]as const){const errors=await validate(plainToInstance(type as any,value),{whitelist:true,forbidNonWhitelisted:true});expect(errors.length).toBeGreaterThan(0);}
  });
  test('inbox serialization exposes only safe fields, never raw contacts or outbox data',()=>{
    const value=inboxItem({id:'id',topic:'BOOKING_CREATED',title:'title',body:'body',resource_type:'BOOKING',resource_id:'1',booking_id:1n,created_at:new Date(0),read_at:null,phone:'secret',data_json:{private:'secret'}}as any);
    expect(value.bookingId).toBe('1');expect(JSON.stringify(value)).not.toContain('secret');
  });
  test.each(NOTIFICATION_TOPICS)('historical bilingual %s inbox content reads in English without changing identity or read status',topic=>{
    const createdAt=new Date('2026-11-01T15:00:00Z'),readAt=new Date('2026-11-02T15:00:00Z');
    const row={id:'historical',topic,title:'预约已取消 / Booking cancelled',body:'预约已经取消，请查看订单。',resource_type:'BOOKING',resource_id:'42',booking_id:42n,created_at:createdAt,read_at:readAt};
    const value=inboxItem(row);
    expect(value).toEqual({id:'historical',topic,...notificationText(topic),resourceType:'BOOKING',resourceId:'42',bookingId:'42',createdAt,readAt});
    expect(row.title).toBe('预约已取消 / Booking cancelled');
    expect(row.body).toBe('预约已经取消，请查看订单。');
  });
  test('unknown inbox topics keep their own content instead of receiving an unrelated system template',()=>{
    expect(inboxItem({id:'announcement',topic:'ANNOUNCEMENT',title:'Holiday opening hours',body:'Contact the shop for details.',resource_type:'SHOP',resource_id:'7',booking_id:null,created_at:new Date(0),read_at:null})).toMatchObject({title:'Holiday opening hours',body:'Contact the shop for details.',bookingId:null});
  });
  test('read uses owner predicate and hides another recipient with 404',async()=>{
    const tx={$executeRaw:jest.fn(async()=>0),$queryRaw:jest.fn(async()=>[])};
    const service=new NotificationInboxService({$transaction:async(fn:any)=>fn(tx)}as any);
    await expect(service.read('7','00000000-0000-0000-0000-000000000001')).rejects.toThrow('Notification not found');
    expect((tx.$executeRaw.mock.calls as any)[0][0].values).toContain(7n);expect(sql((tx.$executeRaw.mock.calls as any)[0][0])).toContain('AND user_id=');
  });
  test('merchant cannot inspect tasks or retry; stale/admin retry is conflict',async()=>{
    const service=new NotificationInboxService({$transaction:async(fn:any)=>fn({$executeRaw:async()=>0,$queryRaw:async()=>[]})}as any);
    await expect(service.tasks({id:'1',role:'MERCHANT'},{})).rejects.toThrow('Administrator');
    await expect(service.retry({id:'1',role:'CUSTOMER'},'00000000-0000-0000-0000-000000000001','reviewed config')).rejects.toThrow('Administrator');
    await expect(service.retry({id:'1',role:'ADMIN'},'00000000-0000-0000-0000-000000000001','reviewed config')).rejects.toThrow('refresh');
  });
});

function workerFixture(channel:string,options:{stale?:boolean;claimed?:boolean;preference?:boolean;configured?:boolean}={}){
  const row:OutboxRow={id:'job',user_id:1n,booking_id:1n,expected_start_at_utc:new Date('2040-01-02Z'),topic:'BOOKING_REMINDER',channel,status:'PROCESSING',attempts:1,max_attempts:5,resource_type:'BOOKING',resource_id:'1',lease_token:'lease'};
  const calls:string[]=[];
  const tx:any={user:{findFirst:async()=>({id:1n})},booking:{findUnique:async(args:any)=>args.select.shopId?{shopId:2n}:{userId:1n,status:options.stale?'CANCELLED':'CONFIRMED',deletedAt:null,startTime:row.expected_start_at_utc}},$executeRaw:jest.fn(async(q:any)=>{const text=sql(q);calls.push(text);return text.includes('attempts=attempts+1')&&options.claimed===false?0:1;}),$queryRaw:jest.fn(async(q:any)=>{const text=sql(q);calls.push(text);if(text.includes('SELECT *'))return[row];if(text.includes('notification_preferences'))return options.preference?[{push_enabled:true,push_consented_at:new Date()}]:[];return[];})};
  const db:any={...tx,$transaction:async(fn:any)=>fn(tx)};
  const fcm={config:()=>({enabled:options.configured??false}),sendToUser:jest.fn(async()=>({sent:1}))};
  return{worker:new NotificationWorker(db,fcm as any),tx,fcm,calls};
}
describe('worker claim and reminder boundaries without real providers',()=>{
  test('obsolete reminder is cancelled and publishes nothing',async()=>{const {worker,tx,fcm}=workerFixture('IN_APP',{stale:true});await(worker as any).process({id:'job',booking_id:1n});expect(tx.$executeRaw.mock.calls.some((call:any)=>sql(call[0]).includes('INSERT INTO user_notifications'))).toBe(false);expect(fcm.sendToUser).not.toHaveBeenCalled();expect(tx.$executeRaw.mock.calls.some((call:any)=>call[0].values.includes('CANCELLED'))).toBe(true);});
  test('claim loser never publishes and shop/booking locks precede claim',async()=>{const {worker,calls,tx}=workerFixture('IN_APP',{claimed:false});await(worker as any).process({id:'job',booking_id:1n});expect(calls[0]).toContain('FROM shops');expect(calls[1]).toContain('FROM bookings');expect(calls[2]).toContain('attempts=attempts+1');expect(tx.$executeRaw.mock.calls).toHaveLength(1);});
  test('inbox publish is unique per durable task and terminal PUBLISHED',async()=>{const {worker,tx}=workerFixture('IN_APP');await(worker as any).process({id:'job',booking_id:1n});expect(tx.$executeRaw.mock.calls.some((call:any)=>sql(call[0]).includes('ON DUPLICATE KEY UPDATE outbox_id'))).toBe(true);expect(tx.$executeRaw.mock.calls.some((call:any)=>call[0].values.includes('PUBLISHED'))).toBe(true);});
  test.each(['SMS','PUSH'])('disabled/consent unknown %s skips rather than sends',async channel=>{const {worker,tx,fcm}=workerFixture(channel);await(worker as any).process({id:'job',booking_id:1n});expect(fcm.sendToUser).not.toHaveBeenCalled();expect(tx.$executeRaw.mock.calls.some((call:any)=>call[0].values.includes('SKIPPED'))).toBe(true);});
  test('configured push without explicit preference cannot dispatch',async()=>{const {worker,fcm}=workerFixture('PUSH',{configured:true});await(worker as any).process({id:'job',booking_id:1n});expect(fcm.sendToUser).not.toHaveBeenCalled();});
  test('test environment never starts a timer',()=>{const {worker}=workerFixture('IN_APP');worker.onModuleInit();expect((worker as any).timer).toBeUndefined();worker.onModuleDestroy();});
});
