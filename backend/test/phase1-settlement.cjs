// Direct source-service + disposable MySQL checks; no provider or production DB.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BookingService } = require('../src/modules/booking/booking.service');
const { SettlementService } = require('../src/modules/booking/settlement.service');
const { PaymentService } = require('../src/modules/payment/payment.service');
const { CouponsService } = require('../src/modules/coupons/coupons.service');
const { ReservationsService } = require('../src/modules/reservations/reservations.service');
const { ShopsService } = require('../src/modules/shops/shops.service');
const { reserveShopAlias } = require('../src/common/shop-alias');
const results=[];
async function check(name, fn) { await fn(); results.push({name,passed:true}); console.log('PASS '+name); }
(async()=>{
 const url=new URL(process.env.DATABASE_URL||'');
 if(process.env.MASSAJOY_PHASE1_DISPOSABLE!=='fresh-container-only'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/massajoy2_phase1_check')throw Error('Disposable database guard rejected target');
 const db=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
 await db.$connect();
 try {
  assert.equal(await db.user.count(),0,'Fixture requires a newly migrated empty DB');
  const migrations=await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL');
  assert.equal(migrations.length,11);
  const owner=await db.user.create({data:{phone:'TEST-PHASE1-OWNER',email:'phase1-owner@example.invalid',name:'Phase1 Owner',role:'MERCHANT'}});
  const customer=await db.user.create({data:{phone:'TEST-PHASE1-CUSTOMER',email:'phase1-customer@example.invalid',emailVerifiedAt:new Date(),name:'Phase1 Customer',role:'CUSTOMER'}});
  const outsider=await db.user.create({data:{phone:'TEST-PHASE1-OUTSIDER',email:'phase1-outsider@example.invalid',name:'Phase1 Outsider',role:'MERCHANT'}});
  const hours=Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k=>[k,[{open:'08:00',close:'22:00'}]]));
  const shop=await db.shop.create({data:{ownerId:owner.id,name:'Phase1 Test Shop',shortName:'phase1-test-store',phone:'TEST-ONLY',address:'Test only',city:'Test',state:'NY',zipCode:'00000',latitude:1,longitude:1,category:'MIXED',status:'APPROVED',timezone:'UTC',businessHours:hours,
   studioProfile:{features:{onlineBooking:true},paymentPolicy:{payAtStoreEnabled:true},bannerUrl:'https://example.invalid/store.jpg',gallery:['https://example.invalid/gallery.jpg']}}});
  const service=await db.shopService.create({data:{shopId:shop.id,name:'Test fixed SKU',category:'MASSAGE',durationMin:60,priceCents:10000}});
  const therapist=await db.therapist.create({data:{shopId:shop.id,name:'Test Therapist',therapistServices:{create:{serviceId:service.id}},shifts:{create:Array.from({length:7},(_,weekday)=>({weekday,startMin:0,endMin:1440}))}}});
  const payments=new PaymentService(db), booking=new BookingService(db,payments,{},new CouponsService(db));
  const settlement=new SettlementService(db), reservations=new ReservationsService(db), shops=new ShopsService(db);
  const input=(startTime,requestKey,extra={})=>({userId:String(customer.id),shopId:String(shop.id),serviceId:String(service.id),therapistId:String(therapist.id),date:'2031-01-15',startTime,paymentMode:'PAY_AT_STORE',requestKey,...extra});
  const receipt=(requestKey,amountCents=10000)=>({requestKey,amountCents,method:'CASH',occurredAt:new Date().toISOString(),reason:'Synthetic already collected cash'});
  let b;
  await check('all eleven migrations apply to a fresh isolated MySQL',async()=>assert.equal(migrations.length,11));
  await check('pay-at-store create/replay, mode key mismatch and atomic resource contention',async()=>{
   const outcomes=await Promise.allSettled([booking.createBooking(input('10:00','create-offline-1')),booking.createBooking(input('10:00','create-offline-2'))]);
   assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
   b=outcomes.find(x=>x.status==='fulfilled').value;
   const key=b.requestKey; // requestKey is deliberately absent from public projection.
   assert.equal(key,undefined);assert.equal(b.paymentMode,'PAY_AT_STORE');assert.equal(b.paymentStatus,'UNPAID');assert.equal(b.status,'PENDING');
   const saved=await db.booking.findUniqueOrThrow({where:{id:BigInt(b.id)}});
   const replay=await booking.createBooking(input('10:00',saved.requestKey));assert.equal(replay.id,b.id);
   await assert.rejects(booking.createBooking(input('10:00',saved.requestKey,{paymentMode:'ONLINE'})),/different parameters/);
  });
  await check('manager can accept unpaid, resource remains occupied after acceptance',async()=>{
   await booking.updateBookingStatus(b.id,String(owner.id),'CONFIRMED','MERCHANT');
   const current=await db.booking.findUniqueOrThrow({where:{id:BigInt(b.id)}});assert.equal(current.paymentStatus,'UNPAID');assert.equal(current.holdExpiresAt,null);
   await assert.rejects(booking.createBooking(input('10:00','resource-after-accept')),/unavailable/);
  });
  await check('cross-shop operator and online checkout cannot collect offline reservation',async()=>{
   await assert.rejects(settlement.recordReceipt(b.id,String(outsider.id),'MERCHANT',receipt('attacker-receipt')),/not found/);
   await assert.rejects(payments.createPaymentIntent({bookingId:b.id,userId:String(customer.id)}),/online checkout/);
   await assert.rejects(booking.updateBookingStatus(b.id,String(owner.id),'COMPLETED','MERCHANT'),/outstanding/);
  });
  await check('same-key concurrent receipts collect once; overcollection and changed command rejected',async()=>{
   const cmd=receipt('receipt-same-key',6000);
   await Promise.all([settlement.recordReceipt(b.id,String(owner.id),'MERCHANT',cmd),settlement.recordReceipt(b.id,String(owner.id),'MERCHANT',cmd)]);
   assert.equal(await db.bookingSettlementEntry.count({where:{bookingId:BigInt(b.id)}}),1);
   await assert.rejects(settlement.recordReceipt(b.id,String(owner.id),'MERCHANT',{...cmd,amountCents:6001}),/different parameters/);
   await assert.rejects(settlement.recordReceipt(b.id,String(owner.id),'MERCHANT',receipt('too-much-money',4001)),/outstanding/);
   const current=await settlement.recordReceipt(b.id,String(owner.id),'MERCHANT',receipt('remaining-money',4000));assert.equal(current.paymentStatus,'PAID');assert.equal(current.amountDueCents,0);
   assert.equal(await db.paymentRecord.count(),0);assert.equal(await db.merchantTransaction.count(),0);
  });
  await check('completed service survives receipt reversal; exact correction can be recorded',async()=>{
   await db.booking.update({where:{id:BigInt(b.id)},data:{endTime:new Date(Date.now()-60000)}});
   await booking.updateBookingStatus(b.id,String(owner.id),'COMPLETED','MERCHANT');
   const info=await settlement.get(b.id,String(owner.id),'MERCHANT');const original=info.entries.find(x=>x.amountCents===6000);
   const cmd={requestKey:'reverse-correction',reason:'Synthetic correction, no refund sent'};
   const results=await Promise.allSettled([settlement.reverse(b.id,original.id,String(owner.id),'MERCHANT',cmd),settlement.reverse(b.id,original.id,String(owner.id),'MERCHANT',{...cmd,requestKey:'reverse-competing'})]);
   assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
   const after=await settlement.get(b.id,String(owner.id),'MERCHANT');assert.equal(after.status,'COMPLETED');assert.equal(after.paidCents,4000);assert.equal(after.allowedActions.recordReceipt,true);
   await settlement.recordReceipt(b.id,String(owner.id),'MERCHANT',receipt('correction-new-receipt',6000));
  });
  await check('full physical refund recorded once without calling a provider',async()=>{
   const cmd=receipt('offline-refund-full');
   const locks=await db.bookingResourceLock.count({where:{bookingId:BigInt(b.id),status:'ACTIVE',endAtUtc:{gt:new Date()}}});
   const info=await settlement.recordRefund(b.id,String(owner.id),'MERCHANT',cmd);assert.equal(info.refundedCents,10000);assert.equal(info.netPaidCents,0);assert.equal(info.status,'COMPLETED');assert.equal(info.amountDueCents,0);
   assert.equal(await db.bookingResourceLock.count({where:{bookingId:BigInt(b.id),status:'ACTIVE',endAtUtc:{gt:new Date()}}}),locks);
   await settlement.recordRefund(b.id,String(owner.id),'MERCHANT',cmd);
   assert.equal(await db.bookingSettlementEntry.count({where:{bookingId:BigInt(b.id),kind:'REFUND'}}),1);
  });
  await check('zero-value coupon creates one explicit zero evidence, can cancel and restore coupon',async()=>{
   const coupon=await db.coupon.create({data:{shopId:shop.id,title:'Synthetic full cover',type:'PERCENT',value:100,validFrom:new Date(Date.now()-60000)}});
   const wallet=await db.userCoupon.create({data:{couponId:coupon.id,userId:customer.id}});
   const data=input('12:00','zero-order-create',{paymentMode:'ONLINE',couponId:String(wallet.id)});
   const z=await booking.createBooking(data);assert.equal(z.paymentMode,'ZERO');assert.equal(z.status,'CONFIRMED');assert.equal(z.paymentStatus,'PAID');assert.equal(z.paidCents,0);
   assert.equal((await booking.createBooking(data)).id,z.id);
   assert.equal(await db.bookingSettlementEntry.count({where:{bookingId:BigInt(z.id),kind:'ZERO'}}),1);
   await booking.cancelBooking(z.id,String(customer.id),'CUSTOMER');
   assert.equal((await db.userCoupon.findUniqueOrThrow({where:{id:wallet.id}})).status,'UNUSED');
   assert.equal((await db.coupon.findUniqueOrThrow({where:{id:coupon.id}})).usedCount,0);
  });
  await check('policy changes opt out of new offline orders without altering existing snapshots',async()=>{
   await reservations.paymentPolicy(String(shop.id),{id:String(owner.id),role:'MERCHANT'},{payAtStoreEnabled:false});
   await assert.rejects(booking.createBooking(input('14:00','disabled-pay-at-store')),/not enabled/);
   assert.equal((await db.booking.findUniqueOrThrow({where:{id:BigInt(b.id)}})).paymentMode,'PAY_AT_STORE');
  });
  await check('hiding a completed zero-value order cannot skip its active cleanup buffer',async()=>{
   const coupon=await db.coupon.create({data:{shopId:shop.id,title:'Synthetic full cover second',type:'PERCENT',value:100,validFrom:new Date(Date.now()-60000)}});
   const wallet=await db.userCoupon.create({data:{couponId:coupon.id,userId:customer.id}});
   const z=await booking.createBooking(input('13:00','zero-completion-hide',{paymentMode:'ONLINE',couponId:String(wallet.id)}));
   await db.booking.update({where:{id:BigInt(z.id)},data:{endTime:new Date(Date.now()-60000)}});
   await db.bookingResourceLock.updateMany({where:{bookingId:BigInt(z.id)},data:{startAtUtc:new Date(Date.now()-7200000),endAtUtc:new Date(Date.now()+900000)}});
   await booking.updateBookingStatus(z.id,String(owner.id),'COMPLETED','MERCHANT');
   await booking.deleteBooking(z.id,String(customer.id));
   assert.equal(await db.bookingResourceLock.count({where:{bookingId:BigInt(z.id),status:'ACTIVE',endAtUtc:{gt:new Date()}}}),1);
  });
  await check('aliases resolve only explicit mappings and never guess a legacy numeric ID',async()=>{
   await db.$transaction(tx=>reserveShopAlias(tx,shop.id,'phase1-test-store'));
   const current=await shops.resolve({shortName:'phase1-test-store'});assert.equal(current.id,String(shop.id));
   await assert.rejects(shops.resolve({legacyId:String(shop.id)}),/unavailable|not found/i);
   await db.shopAlias.create({data:{shopId:shop.id,kind:'LEGACY_ID',source:'massajoy1',value:'3740'}});
   assert.equal((await shops.resolve({legacyId:'3740'})).id,String(shop.id));
  });
  await check('disabled owner disappears from public resolver and cannot accept new reservations',async()=>{
   await db.user.update({where:{id:owner.id},data:{status:'SUSPENDED'}});
   await assert.rejects(shops.resolve({shortName:'phase1-test-store'}),/unavailable|not found/i);
   await assert.rejects(booking.createBooking(input('16:00','suspended-shop-create',{paymentMode:'ONLINE'})),/unavailable/i);
   assert.equal((await booking.getBooking(b.id,String(customer.id),'CUSTOMER')).id,b.id);
  });
  const output={generatedAt:new Date().toISOString(),scope:'Disposable MySQL8.4; direct current source services, not HTTP/browser/provider or production; all eleven migrations applied',results,passed:results.length,deploymentReady:false};
  await fs.writeFile(path.resolve(__dirname,'../../docs/verification/phase1-mysql-2026-10-28.json'),JSON.stringify(output,null,2));
 } finally { await db.$disconnect(); }
})().catch(async e=>{console.error('Phase1 isolated check failed: '+e.message.replace(/mysql:\/\/[^\s]+/g,'[redacted DSN]'));process.exitCode=1;});
