const assert=require('node:assert/strict');
const { StudioService }=require('../src/modules/studio/studio.service');
const { AnnouncementsService }=require('../src/modules/announcements/announcements.service');
const { BannersService }=require('../src/modules/banners/banners.service');
const { PublicSupportController }=require('../src/common/public-support.controller');
module.exports.runContent=async function runContent(db,{check,owner,customer,shop}) {
  const admin=await db.user.create({data:{phone:'TEST-P4-CONTENT-ADM',role:'ADMIN'}});
  const studio=new StudioService(db), actor={id:String(admin.id),role:'ADMIN'},merchant={id:String(owner.id),role:'MERCHANT'};
  const publicAnnouncements=new AnnouncementsService(db),banners=new BannersService(db);
  const start=new Date(Date.now()-60000).toISOString(),future=new Date(Date.now()+3600000).toISOString();
  let urgent,scheduled;
  await check('content publication uses shared validation and real Studio audit transaction',async()=>{
    urgent=(await studio.save('content',undefined,{title:'P4 urgent',body:'Synthetic public body',type:'URGENT',scope:'USERS',startAt:start,isPublished:true},actor)).item;
    scheduled=(await studio.save('content',undefined,{title:'P4 scheduled',body:'Synthetic future body',startAt:future,isPublished:true},actor)).item;
    await studio.save('content',undefined,{title:'P4 merchant',body:'Synthetic merchant body',scope:'MERCHANTS',startAt:start,isPublished:true},actor);
    await studio.save('content',undefined,{title:'P4 draft',body:'Synthetic draft'},actor);
    await assert.rejects(studio.save('content',undefined,{title:'Denied',body:'Synthetic'},merchant));
    await assert.rejects(studio.save('content',urgent.id,{title:'Invalid window',startAt:future,endAt:start},actor));
    assert.equal((await db.announcement.findUnique({where:{id:BigInt(urgent.id)}})).title,'P4 urgent');
    assert.ok(await db.auditLog.count({where:{targetType:'content',operatorId:admin.id}}));
  });
  await check('customer and staff see exact publication time, priority and separate content scopes',async()=>{
    assert.deepEqual((await publicAnnouncements.getActiveAnnouncements('CUSTOMER')).map(row=>row.title),['P4 urgent']);
    assert.deepEqual((await publicAnnouncements.getActiveAnnouncements('STAFF')).map(row=>row.title),['P4 merchant']);
    const before=await db.announcement.findUnique({where:{id:BigInt(scheduled.id)}});
    await studio.save('content',scheduled.id,{title:'Scheduled rename',body:'Still future',isPublished:true},actor);
    assert.equal(+(await db.announcement.findUnique({where:{id:before.id}})).startAt,+before.startAt);
    await studio.remove('content',urgent.id,actor);
    assert.equal((await publicAnnouncements.getActiveAnnouncements('CUSTOMER')).length,0);
  });
  await check('banner destinations are validated and unpublished shop targets never appear publicly',async()=>{
    await assert.rejects(studio.save('banners',undefined,{title:'Bad',imageUrl:'https://images.example.invalid/a.jpg',targetType:'EXTERNAL_URL',targetValue:'javascript:x'},actor));
    await assert.rejects(studio.save('banners',undefined,{title:'Bad',imageUrl:'https://images.example.invalid/a.jpg',targetType:'CATEGORY',targetValue:'1'},actor));
    const visible=(await studio.save('banners',undefined,{title:'Visible banner',imageUrl:'https://images.example.invalid/a.jpg',targetType:'NONE',startAt:start,isActive:true},actor)).item;
    await db.shop.update({where:{id:shop.id},data:{status:'SUSPENDED'}});
    await studio.save('banners',undefined,{title:'Hidden destination',imageUrl:'https://images.example.invalid/a.jpg',targetType:'SHOP_DETAIL',targetValue:String(shop.id),startAt:start,isActive:true},actor);
    assert.deepEqual((await banners.getActiveBanners()).map(row=>row.title),['Visible banner']);
    await banners.recordClick(visible.id);assert.equal((await db.homeBanner.findUnique({where:{id:BigInt(visible.id)}})).clickCount,1);
    await studio.remove('banners',visible.id,actor);await assert.rejects(banners.recordClick(visible.id));
    await db.shop.update({where:{id:shop.id},data:{status:'APPROVED'}});
  });
  await check('canonical public support settings exist, clear correctly and never expose unrelated private configuration',async()=>{
    const values=await db.platformConfig.findMany({where:{key:{in:['site_name','support_email','support_phone']}}});assert.equal(values.length,3);
    const email=values.find(row=>row.key==='support_email');
    await studio.save('settings',String(email.id),{value:'help@example.invalid'},actor);
    await db.platformConfig.create({data:{key:'P4_INTERNAL',value:'SYNTHETIC_PRIVATE_VALUE',isPublic:false}});
    const support=new PublicSupportController(db);assert.equal((await support.get()).email,'help@example.invalid');
    assert.doesNotMatch(JSON.stringify(await support.get()),/SYNTHETIC_PRIVATE|P4_INTERNAL/);
    await db.platformConfig.update({where:{id:email.id},data:{isPublic:false}});assert.equal((await support.get()).email,null);
    await db.platformConfig.update({where:{id:email.id},data:{isPublic:true}});
    await studio.save('settings',String(email.id),{value:''},actor);assert.equal((await support.get()).email,null);
  });
};
