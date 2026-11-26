import { buildShopReadiness, ReadinessSnapshot } from './shop-readiness.rules';
import { shopPublication } from '../../common/shop-publication';
import { shopEligibility } from '../../common/shop-eligibility';

export const fixtureSnapshot = (): ReadinessSnapshot => ({
  shop: { id:11n,name:'Synthetic studio',status:'APPROVED',deletedAt:null,shortName:'synthetic-studio',timezone:'America/New_York',phone:'+12025550149',address:'Synthetic',city:'Synthetic',state:'NY',latitude:40.7,longitude:-73.9,
    businessHours:{monday:{open:'09:00',close:'18:00',closed:false}},studioProfile:{features:{onlineBooking:true},paymentPolicy:{payAtStoreEnabled:false}},description:'English description',loginBinding:{user:{id:7n,role:'MERCHANT',status:'ACTIVE',deletedAt:null,loginName:'synthetic-merchant',passwordHash:'$2b$12$'+'A'.repeat(53)}} },
  services:[{id:20n,shopId:11n,name:'Body massage',isActive:true,durationMin:180,priceCents:7500,priceBasis:'PER_PERSON',participantCount:1,requiredStaffCount:1,requiredRoomType:null,staffBufferMin:0,roomBufferMin:0}],
  variants:[],therapists:[{id:30n,shopId:11n,isActive:true}],qualifications:[{therapistId:30n,serviceId:20n}],shifts:[{id:40n,therapistId:30n,isActive:true,weekday:1,startMin:540,endMin:1080}],rooms:[],images:[],
});
const section = (snapshot:ReadinessSnapshot) => buildShopReadiness(snapshot,true).services[0];
const state = (snapshot:ReadinessSnapshot,key:string) => section(snapshot).checks.find(c=>c.key===key)?.state;

describe('saved operating configuration rules',()=>{
  test('public email is an unverified candidate, independent of publication and durable booking eligibility',()=>{
    const s=fixtureSnapshot();s.shop.studioProfile.emails=['public@example.test'];
    const r=buildShopReadiness(s,true),finding=r.booking.checks.find(c=>c.key==='storeOrderEmail');
    expect(finding).toMatchObject({state:'ATTENTION',label:'预约通知收件邮箱'});
    expect(finding?.detail).toContain('订单仍保存在后台');expect(finding?.detail).toContain('不等于收件权已验证');
    expect(r.publication.ready).toBe(true);expect(JSON.stringify(r)).not.toContain('public@example.test');
  });
  test('readiness distinguishes recipient proof, configured provider, stopped worker and local capture without exposing private email',()=>{
    const s=fixtureSnapshot();s.shop.orderEmailSetting={enabled:true,recipientEmail:'private-orders@example.test',recipientVerifiedAt:new Date()};
    const state=()=>buildShopReadiness(s,true).booking.checks.find(c=>c.key==='storeOrderEmail');
    expect(state()?.state).toBe('ATTENTION');
    s.orderEmailDelivery={configured:true,mode:'LOCAL_CAPTURE',workerEnabled:true};expect(state()?.detail).toContain('未向真实邮箱发送');
    s.orderEmailDelivery={configured:true,mode:'PROVIDER',workerEnabled:false};expect(state()?.detail).toContain('发送任务已停用');
    s.orderEmailDelivery.workerEnabled=true;expect(state()?.state).toBe('PASS');expect(state()?.detail).toContain('不代表具体订单已经发送或收到');
    expect(JSON.stringify(buildShopReadiness(s,true))).not.toContain('private-orders@example.test');
    s.shop.orderEmailSetting.enabled=false;expect(state()?.state).toBe('ATTENTION');
  });
  test.each(['PER_SESSION','VARIABLE'])('separates %s service wording from positive reserved blocks without changing publication',durationKind=>{
    const s=fixtureSnapshot(),original=shopPublication(s.shop).publicationReady;Object.assign(s.services[0],{durationKind,durationMin:90});
    const r=buildShopReadiness(s,true),policy=r.services[0].checks.find(c=>c.key==='durationPolicy');
    expect(policy?.state).toBe('PASS');expect(policy?.detail).toContain('预约预留90分钟');expect(policy?.detail).toContain('不将实际服务承诺为固定分钟');
    expect(r.services[0].checks.find(c=>c.key==='price')?.state).toBe('PASS');expect(r.publication.ready).toBe(original);
    s.services[0].durationKind=null;expect(state(s,'durationPolicy')).toBe('ATTENTION');expect(state(s,'price')).toBe('ATTENTION');
  });
  test('variant validity inherits parent kind rather than accepting an independently claimed timed variant',()=>{
    const s=fixtureSnapshot();s.services[0].durationKind='VARIABLE';s.variants=[{id:1n,serviceId:20n,isActive:true,durationMin:45,priceCents:3000,priceBasis:'PER_PERSON',currency:'usd'}];
    expect(state(s,'price')).toBe('PASS');s.services[0].durationKind='UNKNOWN';expect(state(s,'price')).toBe('ATTENTION');
    expect(state(s,'variantValidity')).toBe('ATTENTION');
  });
  test('reuses actual publication checks and visibility separately, with no overall booking-ready score',()=>{
    const snapshot=fixtureSnapshot(),result=buildShopReadiness(snapshot,true,'2026-10-29T00:00:00.000Z');
    expect(result.publication.ready).toBe(shopPublication(snapshot.shop).publicationReady);expect(result.publication.publicVisible).toBe(shopEligibility(snapshot.shop).publicVisible);
    expect(result.publication.checks.slice(0,shopPublication(snapshot.shop).publicationChecklist.length).map(c=>c.key)).toEqual(shopPublication(snapshot.shop).publicationChecklist.map(c=>c.key));
    expect(result.checkedAt).toBe('2026-10-29T00:00:00.000Z');expect(result.summary).toEqual({activeServices:1,disabledServices:0,activeServicesWithFindings:0});
    expect(result).not.toHaveProperty('readyForBooking');expect(result).not.toHaveProperty('score');expect(result.booking.checks.find(c=>c.key==='onlinePayment')?.state).toBe('INFO');
  });
  test('supports legacy no-variant 180/240-minute services and a null legacy price basis without requiring a room',()=>{
    const s=fixtureSnapshot();s.services[0].durationMin=240;s.services[0].priceBasis=null;
    expect(section(s).mode).toBe('LEGACY');expect(state(s,'price')).toBe('PASS');expect(state(s,'room')).toBe('INFO');expect(state(s,'policy')).toBe('PASS');
  });
  test.each([{durationMin:4},{durationMin:241},{durationMin:60.5},{priceCents:0},{priceCents:NaN},{priceCents:Number.MAX_SAFE_INTEGER+1},{priceBasis:'UNKNOWN'}])('flags invalid legacy price/policy (%p)',change=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],change);expect(state(s,'price')).toBe('ATTENTION');
  });
  test.each([
    {participants:1,price:99999999,basis:'PER_PERSON',expected:'PASS'},
    {participants:1,price:100000000,basis:'PER_PERSON',expected:'ATTENTION'},
    {participants:2,price:50000000,basis:'PER_PERSON',expected:'PASS'},
    {participants:2,price:49999999,basis:'PER_PERSON',expected:'PASS'},
    {participants:2,price:50000000,basis:'PER_BOOKING',expected:'PASS'},
    {participants:2,price:100000000,basis:'PER_BOOKING',expected:'ATTENTION'},
  ])('legacy and variant totals share the actual booking quote boundary (%p)',({participants,price,basis,expected})=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],{participantCount:participants,requiredStaffCount:participants,requiredRoomType:participants===2?'COUPLE':null,priceCents:price,priceBasis:basis});
    expect(state(s,'price')).toBe(expected);
    s.variants=[{id:50n,serviceId:20n,isActive:true,durationMin:60,priceCents:price,priceBasis:basis,currency:'usd'}];
    expect(state(s,'price')).toBe(expected);expect(state(s,'variantValidity')).toBe(expected);
  });
  test('variant price basis falls back to the service basis exactly as booking selection does',()=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],{participantCount:2,requiredStaffCount:2,requiredRoomType:'COUPLE',priceBasis:'PER_BOOKING'});
    s.variants=[{id:50n,serviceId:20n,isActive:true,durationMin:60,priceCents:50000000,priceBasis:null,currency:'usd'}];
    expect(state(s,'price')).toBe('PASS');expect(state(s,'variantValidity')).toBe('PASS');
  });
  test('active valid specifications replace unused legacy base amounts and duration in readiness',()=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],{durationMin:15,priceCents:0,priceBasis:'UNKNOWN'});
    s.variants=[{id:50n,serviceId:20n,isActive:true,durationMin:60,priceCents:13057,priceBasis:'PER_BOOKING',currency:'usd'}];
    for(const key of ['durationPolicy','price','policy','variantValidity'])expect(state(s,key)).toBe('PASS');
    const detail=section(s).checks.find(c=>c.key==='durationPolicy')!.detail;expect(detail).toContain('预约预留60分钟');expect(detail).toContain('基础金额与基础时长不用于预约');expect(detail).not.toContain('15分钟');
    s.variants[0].isActive=false;expect(state(s,'durationPolicy')).toBe('ATTENTION');expect(state(s,'price')).toBe('ATTENTION');
    s.services[0].durationMin=60;s.services[0].priceCents=9000;expect(state(s,'price')).toBe('ATTENTION');
  });
  test('any variant disables legacy fallback; all-disabled variants need preparation but are not invalid active variants',()=>{
    const s=fixtureSnapshot();s.variants=[{id:50n,serviceId:20n,isActive:false,durationMin:15,priceCents:0,currency:'eur'}];
    expect(section(s).mode).toBe('VARIANTS');expect(state(s,'price')).toBe('ATTENTION');expect(state(s,'variantValidity')).toBe('PASS');
    s.variants.push({id:51n,serviceId:20n,isActive:true,durationMin:240,priceCents:1000,priceBasis:'PER_BOOKING',currency:'usd'});
    expect(state(s,'price')).toBe('PASS');expect(state(s,'variantValidity')).toBe('PASS');
    s.variants.push({id:52n,serviceId:20n,isActive:true,durationMin:60,priceCents:1000,currency:'eur'});
    expect(state(s,'price')).toBe('PASS');expect(state(s,'variantValidity')).toBe('ATTENTION');
  });
  test.each([{participantCount:3},{requiredStaffCount:3},{staffBufferMin:-1},{roomBufferMin:121},{priceBasis:'OTHER'},{requiredRoomType:'INVALID'},{participantCount:2,requiredStaffCount:2,requiredRoomType:'SINGLE'},{participantCount:2,requiredStaffCount:1,requiredRoomType:null}])('actual booking policy invalidity is visible (%p)',change=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],change);expect(state(s,'policy')).toBe('ATTENTION');
  });
  test('couple services without a room require only two distinct scheduled store staff and do not create resources',()=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],{participantCount:2,requiredStaffCount:2,requiredRoomType:null,priceBasis:'PER_BOOKING'});
    s.therapists=[{id:30n,shopId:11n,isActive:true,scheduleMode:'SHOP'},{id:31n,shopId:11n,isActive:true,scheduleMode:'SHOP'}];
    s.qualifications=[];s.shifts=[];s.rooms=[];
    const before=structuredClone(s),result=buildShopReadiness(s,true);
    for(const key of ['policy','staff','shifts'])expect(result.services[0].checks.find(c=>c.key===key)?.state).toBe('PASS');
    expect(result.services[0].checks.find(c=>c.key==='room')?.state).toBe('INFO');
    expect(result.summary.activeServicesWithFindings).toBe(0);expect(s).toEqual(before);
    s.therapists[1].isActive=false;expect(state(s,'staff')).toBe('ATTENTION');
  });
  test('single and couple bookings count distinct active same-shop staff without any qualification mapping',()=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],{participantCount:2,requiredStaffCount:2,requiredRoomType:'COUPLE'});
    s.qualifications=[];s.therapists.push({id:31n,shopId:12n,isActive:true});
    expect(state(s,'staff')).toBe('ATTENTION');s.therapists[1].shopId=11n;expect(state(s,'staff')).toBe('PASS');expect(state(s,'shifts')).toBe('ATTENTION');
    s.shifts.push({therapistId:31n,isActive:true,weekday:1,startMin:0,endMin:1440});expect(state(s,'shifts')).toBe('PASS');
    s.therapists[1].isActive=false;expect(state(s,'staff')).toBe('ATTENTION');
  });
  test('inherited staff need no personal shifts and four hands use two staff with one-guest room capacity',()=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],{participantCount:1,requiredStaffCount:2,requiredRoomType:'SINGLE',priceBasis:'PER_BOOKING'});
    s.therapists=[{id:30n,shopId:11n,isActive:true,scheduleMode:'SHOP'},{id:31n,shopId:11n,isActive:true,scheduleMode:'SHOP'}];
    s.qualifications=[];s.shifts=[];s.rooms=[{id:60n,shopId:11n,isActive:true,roomType:'SINGLE',capacity:1}];
    for(const key of ['policy','staff','shifts','room'])expect(state(s,key)).toBe('PASS');
    s.therapists[1].scheduleMode='CUSTOM';expect(state(s,'shifts')).toBe('ATTENTION');
    s.shifts=[{therapistId:31n,isActive:false,weekday:1,startMin:540,endMin:1080}];expect(state(s,'shifts')).toBe('ATTENTION');
  });
  test('readiness counts only personal shifts that overlap the shop opening hours', () => {
    const s = fixtureSnapshot();
    s.shifts[0].startMin = 480;
    s.shifts[0].endMin = 540; // Ends exactly at Monday opening.
    expect(state(s, 'staff')).toBe('PASS');
    expect(section(s).checks.find(row => row.key === 'shifts')).toMatchObject({
      state: 'ATTENTION',
      action: { kind: 'reservation', tab: 'therapists', therapistId: '30' },
    });

    s.shifts[0].endMin = 541;
    expect(state(s, 'shifts')).toBe('PASS');
    s.shifts[0].weekday = 2;
    expect(state(s, 'shifts')).toBe('ATTENTION');
  });
  test.each([{isActive:false},{weekday:7},{weekday:1.5},{startMin:1440,endMin:1440},{startMin:600,endMin:590},{startMin:-1},{endMin:1441}])('rejects malformed or disabled shifts when counting preparation (%p)',change=>{
    const s=fixtureSnapshot();Object.assign(s.shifts[0],change);expect(state(s,'shifts')).toBe('ATTENTION');
  });
  test('room checks require matching active same-shop capacity only when requested',()=>{
    const s=fixtureSnapshot();s.services[0].requiredRoomType='COUPLE';s.rooms=[{id:60n,shopId:12n,isActive:true,roomType:'COUPLE',capacity:2}];expect(state(s,'room')).toBe('ATTENTION');
    s.rooms[0].shopId=11n;expect(state(s,'room')).toBe('PASS');s.rooms[0].isActive=false;expect(state(s,'room')).toBe('ATTENTION');
    Object.assign(s.services[0],{participantCount:2,requiredStaffCount:2});Object.assign(s.rooms[0],{isActive:true,capacity:1});expect(state(s,'room')).toBe('ATTENTION');
  });
  test('disabled services retain informative preparation details without active findings or publication blockers',()=>{
    const s=fixtureSnapshot();Object.assign(s.services[0],{isActive:false,priceCents:0,participantCount:99});s.therapists=[];
    const r=buildShopReadiness(s,false);expect(r.services[0].checks.every(c=>c.state==='INFO')).toBe(true);expect(r.summary).toEqual({activeServices:0,disabledServices:1,activeServicesWithFindings:0});
    expect(r.publication.ready).toBe(true);expect(r.access.loginReady).toBe(false);expect(r.access.checks.find(c=>c.key==='loginReady')?.state).toBe('ATTENTION');expect(r.publication.checks.some(c=>c.key==='loginAccount')).toBe(false);expect(r.booking.checks.find(c=>c.key==='activeServices')?.state).toBe('ATTENTION');
  });
  test('booking flags are configuration, independent of publication; payment opt-in is informational',()=>{
    const s=fixtureSnapshot();s.shop.status='PENDING';let r=buildShopReadiness(s,true);expect(r.publication.publicVisible).toBe(false);expect(r.booking.enabled).toBe(true);expect(r.booking.payAtStoreEnabled).toBe(false);
    s.shop.studioProfile={features:{onlineBooking:false},paymentPolicy:{payAtStoreEnabled:true}};r=buildShopReadiness(s,true);expect(r.booking.enabled).toBe(false);expect(r.booking.payAtStoreEnabled).toBe(true);expect(r.booking.checks.find(c=>c.key==='payAtStore')?.state).toBe('INFO');
  });
  test('order-only readiness reports whole-order totals and does not ask to enable the obsolete pay-at-store gate',()=>{
    const previous=process.env.BOOKING_ONLINE_PAYMENT_ENABLED;
    try {
      process.env.BOOKING_ONLINE_PAYMENT_ENABLED='false';
      const s=fixtureSnapshot();Object.assign(s.services[0],{participantCount:2,requiredStaffCount:2,requiredRoomType:'COUPLE',priceBasis:'PER_PERSON',priceCents:50000000});
      const before=structuredClone(s),r=buildShopReadiness(s,true);
      expect(r.services[0].checks.find(c=>c.key==='policy')?.detail).toContain('整次订单总价');
      expect(r.services[0].checks.find(c=>c.key==='price')?.detail).not.toContain('每人价');
      const policy=r.booking.checks.find(c=>c.key==='payAtStore');
      expect(policy).toMatchObject({state:'INFO',label:'预约订单线下处理'});expect(policy?.detail).toContain('不受旧到店付款政策开关限制');expect(policy).not.toHaveProperty('action');
      expect(r.booking.checks.find(c=>c.key==='onlinePayment')?.detail).toContain('当前未开放');expect(s).toEqual(before);
      process.env.BOOKING_ONLINE_PAYMENT_ENABLED='true';const online=buildShopReadiness(s,true);
      expect(online.services[0].checks.find(c=>c.key==='policy')?.detail).toContain('整次订单总价');
      expect(online.booking.checks.find(c=>c.key==='payAtStore')).toMatchObject({state:'INFO',label:'到店付款政策',action:{kind:'reservation',tab:'services'}});
    } finally {if(previous===undefined)delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED;else process.env.BOOKING_ONLINE_PAYMENT_ENABLED=previous;}
  });
  test('presentation reuses public projection, honors deliberate clears, never guesses English quality, and action keys are unique',()=>{
    const s=fixtureSnapshot();s.shop.studioProfile={gallery:[],bannerUrl:''};s.shop.description='中文也不猜测';s.images=[{id:1n,imageType:'COVER',imageUrl:'https://example.invalid/old.jpg',sortOrder:0}];
    const r=buildShopReadiness(s,true);expect(r.presentation.checks.find(c=>c.key==='cover')?.state).toBe('INFO');expect(r.presentation.checks.find(c=>c.key==='gallery')?.detail).toContain('0张');expect(r.presentation.checks.find(c=>c.key==='description')?.detail).toContain('不判断语言');
    for(const checks of [r.publication.checks,r.access.checks,r.booking.checks,r.presentation.checks,...r.services.map(x=>x.checks)])expect(new Set(checks.map(c=>c.key)).size).toBe(checks.length);
    expect(r.limitations.join('')).toContain('夏令时');expect(r.limitations.join('')).toContain('不会自动');
  });
  test('saved-field actions lead to actual store sections and exact service/therapist configuration',()=>{
    const r=buildShopReadiness(fixtureSnapshot(),true);
    const action=(checks:typeof r.publication.checks,key:string)=>checks.find(c=>c.key===key)?.action;
    expect(action(r.access.checks,'loginReady')).toEqual({kind:'accounts'});
    expect(action(r.publication.checks,'timezone')).toEqual({kind:'store-section',section:'basic'});
    expect(action(r.publication.checks,'hours')).toEqual({kind:'store-section',section:'hours'});
    expect(action(r.publication.checks,'publicStatus')).toEqual({kind:'store-section',section:'review'});
    expect(action(r.booking.checks,'onlineBooking')).toEqual({kind:'store-section',section:'hours'});
    expect(action(r.presentation.checks,'description')).toEqual({kind:'store-section',section:'basic'});
    expect(action(r.presentation.checks,'cover')).toEqual({kind:'store-section',section:'brand'});
    expect(action(r.services[0].checks,'policy')).toEqual({kind:'reservation',tab:'services',serviceId:'20'});
    expect(action(r.services[0].checks,'shifts')).toEqual({kind:'reservation',tab:'therapists',therapistId:'30'});
  });
});
