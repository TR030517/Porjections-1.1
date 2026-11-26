/** Import and invoke only in the root-owned fresh disposable Compose API container. No .env loading. */
const {randomUUID,randomBytes}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path');
const {hash}=require('bcryptjs');
const DB_NAME='massajoy2_phase5_http';
function targetOrigin(value){const url=new URL(value);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||!url.port||['8088','3000','3001','8002','3310','3306'].includes(url.port)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('PHASE5_TARGET_GUARD');return url.origin;}
async function databaseGuard(db,empty=false){const [{name}]=await db.$queryRawUnsafe('SELECT DATABASE() AS name');if(name!==DB_NAME)throw Error('PHASE5_DATABASE_GUARD');const rows=await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');if(rows.length!==18)throw Error('PHASE5_MIGRATION_GUARD');if(empty&&await db.user.count()!==0)throw Error('PHASE5_REQUIRES_EMPTY_USERS');}
module.exports.createPhase5HttpFixture=async function createPhase5HttpFixture(db,{target,secretsFile,acknowledge}){
 if(acknowledge!=='PHASE5_SYNTHETIC_ONLY')throw Error('PHASE5_ACK_REQUIRED');const origin=targetOrigin(target);
 if(!path.isAbsolute(secretsFile)||!/^phase5-http-secrets(?:-[a-z\d_-]+)?\.json$/i.test(path.basename(secretsFile)))throw Error('PHASE5_SECRET_FILE_GUARD');
 await databaseGuard(db,true);await fs.mkdir(path.dirname(secretsFile),{recursive:true});
 const runId=randomUUID(),suffix=runId.slice(0,8),roles={admin:'ADMIN',merchant:'MERCHANT',customer:'CUSTOMER',outsider:'MERCHANT',staff:'STAFF'};
 const logins={};let index=10;
 for(const[name,role]of Object.entries(roles)){const password=randomBytes(24).toString('base64url'),email=`p5-${name}-${suffix}@example.invalid`;logins[name]={email,password,role,phone:'+120255501'+String(index++),passwordHash:await hash(password,12)};}
 const fixture=await db.$transaction(async tx=>{
  const users={};for(const[name,data]of Object.entries(logins))users[name]=await tx.user.create({data:{email:data.email,emailVerifiedAt:data.role==='CUSTOMER'?new Date():null,passwordHash:data.passwordHash,phone:data.phone,name:'Synthetic '+name,role:data.role,status:'ACTIVE'}});
  const hours=Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day=>[day,[{open:'00:00',close:'23:59',closed:false}]]));
  const shop=await tx.shop.create({data:{ownerId:users.merchant.id,name:'Phase5 HTTP synthetic shop',shortName:'p5-http-'+suffix,phone:'+12025550199',address:'Synthetic fixture only',city:'Test City',state:'NY',zipCode:'10001',latitude:40.7,longitude:-74,category:'MIXED',status:'APPROVED',timezone:'UTC',businessHours:hours,studioProfile:{features:{onlineBooking:true,reviews:true},paymentPolicy:{payAtStoreEnabled:false},gallery:[]}}});
  await tx.merchantProfile.create({data:{userId:users.merchant.id,shopId:shop.id,balanceCents:0,pendingCents:0,totalEarnedCents:0}});
  await tx.shopStaffGrant.create({data:{shopId:shop.id,userId:users.staff.id,createdById:users.merchant.id,status:'ACTIVE',permissions:['BOOKINGS_READ']}});
  const a=await tx.shopService.create({data:{shopId:shop.id,name:'Synthetic fixed massage',category:'MASSAGE',durationMin:30,priceCents:3000,requiredRoomType:'SINGLE',staffBufferMin:5,roomBufferMin:5}});
  const b=await tx.shopService.create({data:{shopId:shop.id,name:'Synthetic second segment',category:'REFLEXOLOGY',durationMin:30,priceCents:2000,requiredRoomType:'SINGLE',staffBufferMin:5,roomBufferMin:5}});
  const variant=await tx.shopServiceVariant.create({data:{serviceId:a.id,name:'Explicit fixed 30 minute SKU',durationMin:30,priceCents:3500,currency:'usd',priceBasis:'PER_PERSON',isActive:true}});
  const therapists=[],rooms=[];
  for(let i=0;i<2;i++){therapists.push(await tx.therapist.create({data:{shopId:shop.id,name:'Synthetic Therapist '+(i+1),therapistServices:{create:[a,b].map(service=>({serviceId:service.id}))},shifts:{create:Array.from({length:7},(_,weekday)=>({weekday,startMin:0,endMin:1440,isActive:true}))}}}));rooms.push(await tx.shopRoom.create({data:{shopId:shop.id,name:'Synthetic Room '+(i+1),roomType:'SINGLE',capacity:1,isActive:true}}));}
  const coupon=await tx.coupon.create({data:{shopId:shop.id,title:'Synthetic full service cover',type:'PERCENT',value:100,status:'ACTIVE',validFrom:new Date(Date.now()-60000),claimedCount:1}});
  const wallet=await tx.userCoupon.create({data:{userId:users.customer.id,couponId:coupon.id}});
  const product=await tx.giftCardProduct.create({data:{shopId:shop.id,title:'Synthetic purchased gift',priceCents:4000,useTimes:3,expireDays:365,status:'ACTIVE'}});
  await tx.shopGiftSalesPolicy.create({data:{shopId:shop.id,payAtStoreEnabled:false}});
  for(const[key,value]of Object.entries({site_name:'Phase5 synthetic support',support_email:'help@example.invalid',support_phone:'+12025550198'}))await tx.platformConfig.upsert({where:{key},create:{key,value,isPublic:true},update:{value,isPublic:true}});
  const end=new Date(Date.now()-3600000),start=new Date(end.getTime()-30*60000);
  const past=await tx.booking.create({data:{bookingNo:'P5H'+suffix,userId:users.customer.id,shopId:shop.id,serviceId:a.id,therapistId:therapists[0].id,bookingDate:new Date(start.toISOString().slice(0,10)+'T00:00:00Z'),bookingTimezone:'UTC',startTime:start,endTime:end,durationMin:30,priceCents:3500,totalCents:3500,paymentMode:'PAY_AT_STORE',status:'CONFIRMED',paymentStatus:'UNPAID',items:{create:{serviceId:a.id,variantId:variant.id,participantIndex:1,sequence:1,assignedTherapistId:therapists[0].id,assignedRoomId:rooms[0].id,serviceNameSnapshot:a.name,variantNameSnapshot:variant.name,roomTypeSnapshot:'SINGLE',durationMin:30,staffBufferMin:5,roomBufferMin:5,priceCentsSnapshot:3500,quotedUnitPriceCents:3500,priceBasisSnapshot:'PER_PERSON',currency:'usd',startAtUtc:start,endAtUtc:end}}}});
  return{shopId:String(shop.id),shortName:shop.shortName,serviceId:String(a.id),secondServiceId:String(b.id),variantId:String(variant.id),therapistIds:therapists.map(t=>String(t.id)),giftProductId:String(product.id),couponWalletId:String(wallet.id),pastBookingId:String(past.id),date:new Date(Date.now()+2*86400000).toISOString().slice(0,10),unitPriceCents:3500,secondPriceCents:2000,giftPriceCents:4000,customerId:String(users.customer.id)};
 },{timeout:30000});
 const secrets={schemaVersion:1,target:origin,environmentMarker:'PHASE5_SYNTHETIC_ONLY',runId,...Object.fromEntries(Object.entries(logins).map(([key,value])=>[key,{email:value.email,password:value.password}])),fixture};
 await fs.writeFile(secretsFile,JSON.stringify(secrets,null,2)+'\n',{flag:'wx',mode:0o600});
 return{created:true,migrations:18,accounts:5,shops:1,services:2,therapists:2,rooms:2,preparedPastBooking:true,secretsWritten:true};
};
module.exports.databaseGuard=databaseGuard;
/** A new attempt reuses accounts/shop but gets its own ended, unpaid fixture.
 * Return secrets only to the root's private capture; never print this return value. */
module.exports.preparePhase5HttpAttempt=async function preparePhase5HttpAttempt(db,{secrets,attemptKey,acknowledge}){
 if(acknowledge!=='PHASE5_SYNTHETIC_ONLY'||!secrets||secrets.environmentMarker!==acknowledge||secrets.schemaVersion!==1||!/^\w[\w-]{0,15}$/.test(attemptKey||'')||!/^p5-http-[a-f\d]{8}$/.test(secrets.fixture?.shortName||''))throw Error('PHASE5_ATTEMPT_GUARD');
 targetOrigin(secrets.target);await databaseGuard(db);const f=secrets.fixture;
 for(const key of ['shopId','customerId','serviceId','variantId'])if(!/^[1-9]\d*$/.test(f[key]||''))throw Error('PHASE5_FIXTURE_GUARD');
 const result=await db.$transaction(async tx=>{
  const shop=await tx.shop.findFirst({where:{id:BigInt(f.shopId),shortName:f.shortName,deletedAt:null},include:{owner:true}});
  const customer=await tx.user.findFirst({where:{id:BigInt(f.customerId),email:secrets.customer.email,role:'CUSTOMER',status:'ACTIVE',deletedAt:null}});
  const service=await tx.shopService.findFirst({where:{id:BigInt(f.serviceId),shopId:BigInt(f.shopId),isActive:true}});
  const variant=await tx.shopServiceVariant.findFirst({where:{id:BigInt(f.variantId),serviceId:BigInt(f.serviceId),isActive:true}});
  const therapist=await tx.therapist.findFirst({where:{id:BigInt(f.therapistIds[0]),shopId:BigInt(f.shopId),isActive:true}});
  const room=await tx.shopRoom.findFirst({where:{shopId:BigInt(f.shopId),roomType:'SINGLE',isActive:true}});
  if(!shop||shop.owner?.email!==secrets.merchant.email||shop.owner.role!=='MERCHANT'||!customer||!service||!variant||!therapist||!room||variant.priceCents!==3500||variant.durationMin!==30)throw Error('PHASE5_ATTEMPT_OWNERSHIP_GUARD');
  const end=new Date(Date.now()-3600000),start=new Date(+end-30*60000);
  return tx.booking.create({data:{bookingNo:'P5H'+randomBytes(10).toString('hex'),userId:customer.id,shopId:shop.id,serviceId:service.id,therapistId:therapist.id,bookingDate:new Date(start.toISOString().slice(0,10)+'T00:00:00Z'),bookingTimezone:'UTC',startTime:start,endTime:end,durationMin:30,priceCents:3500,totalCents:3500,paymentMode:'PAY_AT_STORE',status:'CONFIRMED',paymentStatus:'UNPAID',items:{create:{serviceId:service.id,variantId:variant.id,participantIndex:1,sequence:1,assignedTherapistId:therapist.id,assignedRoomId:room.id,serviceNameSnapshot:service.name,variantNameSnapshot:variant.name,roomTypeSnapshot:'SINGLE',durationMin:30,staffBufferMin:5,roomBufferMin:5,priceCentsSnapshot:3500,quotedUnitPriceCents:3500,priceBasisSnapshot:'PER_PERSON',currency:'usd',startAtUtc:start,endAtUtc:end}}}});
 },{timeout:15000});
 return{secrets:{...secrets,attemptKey,fixture:{...f,pastBookingId:String(result.id)}},summary:{preparedPastBooking:true,existingAccountsAndShopReused:true,existingBusinessRowsChanged:0}};
};
