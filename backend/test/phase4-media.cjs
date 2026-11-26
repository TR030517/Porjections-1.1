const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto'),sharp=require('sharp');
const {UploadService,MEDIA_QUOTA}=require('../src/modules/upload/upload.service');
const {syncShopMedia,mediaUrl}=require('../src/common/managed-media');
const {StudioService}=require('../src/modules/studio/studio.service');
const {MerchantService}=require('../src/modules/merchant/merchant.service');
module.exports.runMedia=async function runMedia(db,{check,owner,customer,shop}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'massajoy-phase4-media-'));
 const previous={driver:process.env.MEDIA_STORAGE_DRIVER,dir:process.env.MEDIA_LOCAL_DIR};
 process.env.MEDIA_STORAGE_DRIVER='local';process.env.MEDIA_LOCAL_DIR=directory;
 const service=new UploadService(db),merchant={id:String(owner.id),role:'MERCHANT'},client={id:String(customer.id),role:'CUSTOMER'};
 const bytes=await sharp({create:{width:16,height:12,channels:3,background:'#48a1a1'}}).withMetadata({exif:{IFD0:{Copyright:'SYNTHETIC_REMOVABLE_METADATA'}}}).png().toBuffer();
 const file={buffer:bytes,mimetype:'image/png'};let uploaded,avatar,abandoned;
 const target=(key,purpose='gallery')=>({scope:'SHOP',shopId:String(shop.id),purpose,requestKey:key});
 try{
  await check('media disabled configuration fails closed and produces no fake storage URL',async()=>{
   process.env.MEDIA_STORAGE_DRIVER='disabled';const disabled=new UploadService(db);process.env.MEDIA_STORAGE_DRIVER='local';
   assert.equal(disabled.config().enabled,false);await assert.rejects(disabled.upload(merchant,target('disabled-check'),file),/NOT_CONFIGURED/);
   assert.throws(()=>disabled.generateAvatarPresignedUrl(String(customer.id),'png'),/DIRECT_UPLOAD_DISABLED/);
   assert.throws(()=>disabled.confirmAvatar(String(customer.id),'https://example.invalid/a.png'),/DIRECT_AVATAR_CONFIRM_DISABLED/);
  });
  await check('media requires valid JPEG PNG WebP magic, full decode and bounded dimensions',async()=>{
   for(const invalid of [{buffer:Buffer.from('<svg onload="x"/>'),mimetype:'image/svg+xml'},{buffer:bytes,mimetype:'image/jpeg'},{buffer:bytes.subarray(0,15),mimetype:'image/png'},{buffer:Buffer.alloc(8*1024*1024+1),mimetype:'image/png'}])await assert.rejects(service.upload(merchant,target('invalid-'+randomUUID()),invalid));
   const large=await sharp({create:{width:8193,height:1,channels:3,background:'black'}}).png().toBuffer();await assert.rejects(service.upload(merchant,target('invalid-dimension'),{buffer:large,mimetype:'image/png'}));
   assert.equal(await db.mediaAsset.count(),0);
  });
  await check('media shop authorization rejects customer, staff and another merchant',async()=>{
   await assert.rejects(service.upload(client,target('customer-denied'),file));
   await assert.rejects(service.upload({id:String(owner.id),role:'STAFF'},target('staff-denied'),file));
   const other=await db.user.create({data:{phone:'TEST-P4-MEDIA-OTHER',role:'MERCHANT'}});
   await assert.rejects(service.upload({id:String(other.id),role:'MERCHANT'},target('other-denied'),file));
  });
  await check('media real local write strips metadata, uses random path and same-key replay is exact',async()=>{
   uploaded=await service.upload(merchant,target('shop-gallery-one'),file);assert.equal(uploaded.replayed,false);assert.equal(uploaded.item.status,'STAGED');
   assert.match(uploaded.item.fileUrl,/^\/api\/v1\/upload\/media\/[a-f\d-]{36}\/file$/);
   const buffer=await service.file(uploaded.item.id),meta=await sharp(buffer).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,16);assert.equal(meta.exif,undefined);
   assert.equal(buffer.includes(Buffer.from('SYNTHETIC_REMOVABLE_METADATA')),false);
   const replay=await service.upload(merchant,target('shop-gallery-one'),file);assert.equal(replay.replayed,true);assert.equal(replay.item.id,uploaded.item.id);
   await assert.rejects(service.upload(merchant,target('shop-gallery-one','logo'),file),/different content/);
   assert.equal((await service.confirm(merchant,uploaded.item.id)).item.status,'STAGED');
  });
  await check('media binding is transactional, preserves referenced images and forbids abandon of bound objects',async()=>{
   await db.$transaction(async tx=>{await syncShopMedia(tx,{shopId:shop.id,actor:merchant,previousUrls:[],nextUrls:[uploaded.item.fileUrl]});await tx.shop.update({where:{id:shop.id},data:{studioProfile:{gallery:[uploaded.item.fileUrl]}}});});
   assert.equal((await db.mediaAsset.findUnique({where:{id:uploaded.item.id}})).status,'BOUND');await assert.rejects(service.abandon(merchant,uploaded.item.id),/Only staged/);
   // Deliberately stale status proves garbage collection rechecks real persisted references before deletion.
   await db.mediaAsset.update({where:{id:uploaded.item.id},data:{status:'STAGED',expiresAt:new Date(0)}});await service.collectGarbage();
   assert.equal((await db.mediaAsset.findUnique({where:{id:uploaded.item.id}})).status,'BOUND');assert.ok((await service.file(uploaded.item.id)).length);
   const another=await db.shop.create({data:{ownerId:owner.id,name:'Phase4 media other shop',phone:'TEST',address:'Test',city:'Test',state:'NY',zipCode:'00000',latitude:1,longitude:1,category:'MIXED'}});
   await assert.rejects(db.$transaction(tx=>syncShopMedia(tx,{shopId:another.id,actor:merchant,previousUrls:[],nextUrls:[uploaded.item.fileUrl]})),/another upload\/shop/);
  });
  await check('media unbound abandon and released shop references are reclaimed from disk',async()=>{
   abandoned=await service.upload(merchant,target('shop-abandon-one'),file);await service.abandon(merchant,abandoned.item.id);await service.abandon(merchant,abandoned.item.id);
   await db.$transaction(async tx=>{await syncShopMedia(tx,{shopId:shop.id,actor:merchant,previousUrls:[uploaded.item.fileUrl],nextUrls:[]});await tx.shop.update({where:{id:shop.id},data:{studioProfile:{gallery:[]}}});});
   await service.collectGarbage();for(const item of[uploaded.item,abandoned.item]){assert.equal((await db.mediaAsset.findUnique({where:{id:item.id}})).status,'DELETED');await assert.rejects(service.file(item.id));await assert.rejects(fs.stat(path.join(directory,item.id+'.webp')));}
  });
  await check('media avatar commit binds only its uploader and retired avatars are garbage-collected',async()=>{
   avatar=await service.upload(client,{scope:'AVATAR',purpose:'avatar',requestKey:'avatar-one'},file);
   await assert.rejects(service.commitAvatar(merchant,avatar.item.id));await service.commitAvatar(client,avatar.item.id);
   assert.equal((await db.user.findUnique({where:{id:customer.id}})).avatarUrl,avatar.item.fileUrl);await assert.rejects(service.abandon(client,avatar.item.id));
   const next=await service.upload(client,{scope:'AVATAR',purpose:'avatar',requestKey:'avatar-two'},file);await service.commitAvatar(client,next.item.id);await service.collectGarbage();
   assert.equal((await db.mediaAsset.findUnique({where:{id:avatar.item.id}})).status,'DELETED');assert.equal((await db.mediaAsset.findUnique({where:{id:next.item.id}})).status,'BOUND');
  });
  await check('media concurrent uploads serialize the bounded per-user staged quota',async()=>{
   for(let i=0;i<MEDIA_QUOTA.staged-1;i++)await service.upload(client,{scope:'AVATAR',purpose:'avatar',requestKey:'quota-item-'+i},file);
   const results=await Promise.allSettled([0,1].map(i=>service.upload(client,{scope:'AVATAR',purpose:'avatar',requestKey:'quota-race-'+i},file)));
   assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected').length,1);
   assert.equal(await db.mediaAsset.count({where:{ownerId:customer.id,status:'STAGED'}}),MEDIA_QUOTA.staged);
   const staged=await db.mediaAsset.findMany({where:{ownerId:customer.id,status:'STAGED'}});for(const row of staged)await service.abandon(client,row.id);await service.collectGarbage();
  });
  await check('media provider late-write after GC re-arms exact tombstone and is deleted on retry',async()=>{
   const actualPut=service.storage.put.bind(service.storage);let lateId;
   service.storage.put=async(key,buffer)=>{lateId=key.slice(0,-5);await actualPut(key,buffer);await db.mediaAsset.update({where:{id:lateId},data:{expiresAt:new Date(0)}});await service.collectGarbage();assert.equal((await db.mediaAsset.findUnique({where:{id:lateId}})).status,'DELETED');await actualPut(key,buffer);};
   try{await assert.rejects(service.upload(merchant,target('late-provider-write'),file),/no longer available/);}finally{service.storage.put=actualPut;}
   assert.equal((await db.mediaAsset.findUnique({where:{id:lateId}})).status,'ABANDONED');assert.ok(await fs.stat(path.join(directory,lateId+'.webp')));await service.collectGarbage();assert.equal((await db.mediaAsset.findUnique({where:{id:lateId}})).status,'DELETED');await assert.rejects(fs.stat(path.join(directory,lateId+'.webp')));
  });
  await check('media storage namespace drift and tampered local bytes fail closed',async()=>{
   const value=await service.upload(merchant,target('storage-integrity'),file);
   process.env.MEDIA_LOCAL_DIR=path.join(directory,'another-namespace');const drift=new UploadService(db);process.env.MEDIA_LOCAL_DIR=directory;
   await assert.rejects(drift.file(value.item.id),/BINDING_CHANGED/);
   await fs.writeFile(path.join(directory,value.item.id+'.webp'),Buffer.from('tampered'));
   await assert.rejects(service.confirm(merchant,value.item.id),/INTEGRITY_CHECK_FAILED/);await assert.rejects(service.upload(merchant,target('storage-integrity'),file),/INTEGRITY_CHECK_FAILED/);
   await service.abandon(merchant,value.item.id);await service.collectGarbage();
  });
  await check('media Studio and Merchant save entry points bind, project, preserve and release real uploaded images',async()=>{
   const studio=new StudioService(db),merchantService=new MerchantService(db,{});
   const administrator=await db.user.create({data:{phone:'TEST-P4-MEDIA-ADMIN',role:'ADMIN'}});
   const created=await studio.save('stores',undefined,{ownerId:String(owner.id),name:'Phase4 media save shop',shortName:'p4-media-save-'+randomUUID().slice(0,8),timezone:'UTC',phones:['+12025550123'],address:'Synthetic upload fixture',city:'Test City',state:'NY',zipCode:'10001',latitude:40.7,longitude:-74.0,businessHours:{monday:{open:'09:00',close:'18:00',closed:false}},status:'PENDING'}, {id:String(administrator.id),role:'ADMIN'});
   const shopId=String(created.item.id);
   assert.equal((await db.shop.findUnique({where:{id:BigInt(shopId)}})).status,'PENDING');
   const logo=await service.upload(merchant,{scope:'SHOP',shopId,purpose:'logo',requestKey:'studio-entry-logo'},file);
   const gallery=await service.upload(merchant,{scope:'SHOP',shopId,purpose:'gallery',requestKey:'merchant-entry-gallery'},file);
   assert.equal((await db.mediaAsset.findUnique({where:{id:logo.item.id}})).status,'STAGED');
   const studioSaved=await studio.save('stores',shopId,{logoUrl:logo.item.fileUrl},merchant);
   assert.equal(studioSaved.item.logoUrl,logo.item.fileUrl);
   assert.equal((await db.mediaAsset.findUnique({where:{id:logo.item.id}})).status,'BOUND');
   const merchantSaved=await merchantService.updateShop(String(owner.id),shopId,{gallery:[gallery.item.fileUrl]});
   assert.equal(merchantSaved.logoUrl,logo.item.fileUrl);assert.deepEqual(merchantSaved.gallery,[gallery.item.fileUrl]);assert.deepEqual(merchantSaved.media.galleryUrls,[gallery.item.fileUrl]);
   const persisted=await db.shop.findUnique({where:{id:BigInt(shopId)}});
   assert.equal(persisted.studioProfile.logoUrl,logo.item.fileUrl);assert.deepEqual(persisted.studioProfile.gallery,[gallery.item.fileUrl]);
   assert.equal((await db.mediaAsset.findUnique({where:{id:gallery.item.id}})).status,'BOUND');
   const ownShops=await merchantService.getMyShops(String(owner.id));
   const projected=ownShops.find(row=>String(row.id)===shopId);assert.ok(projected);assert.equal(projected.media.logoUrl,logo.item.fileUrl);assert.deepEqual(projected.media.galleryUrls,[gallery.item.fileUrl]);
   await merchantService.updateShop(String(owner.id),shopId,{gallery:[]});
   assert.equal((await db.mediaAsset.findUnique({where:{id:gallery.item.id}})).status,'ABANDONED');
   assert.equal((await db.mediaAsset.findUnique({where:{id:logo.item.id}})).status,'BOUND');
   await studio.save('stores',shopId,{logoUrl:''},merchant);await service.collectGarbage();
   for(const entry of[logo,gallery]){assert.equal((await db.mediaAsset.findUnique({where:{id:entry.item.id}})).status,'DELETED');await assert.rejects(fs.stat(path.join(directory,entry.item.id+'.webp')));}
  });
 }finally{
  service.onModuleDestroy();if(previous.driver===undefined)delete process.env.MEDIA_STORAGE_DRIVER;else process.env.MEDIA_STORAGE_DRIVER=previous.driver;if(previous.dir===undefined)delete process.env.MEDIA_LOCAL_DIR;else process.env.MEDIA_LOCAL_DIR=previous.dir;
  // This exact directory was created by mkdtemp above; never remove a configured or existing media directory.
  assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('massajoy-phase4-media-'));await fs.rm(directory,{recursive:true,force:true});
 }
};
