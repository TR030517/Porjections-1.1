import { requireShopAccess } from '../../common/shop-access';
import { BadRequestException,ConflictException,ForbiddenException,HttpException,Injectable,Logger,NotFoundException,OnModuleDestroy,OnModuleInit,ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash,randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { mediaUrl,managedMediaId,requireBannerAdministrator,withBannerMediaRetry } from '../../common/managed-media';
import { MediaStorage } from './media-storage';
import { MAX_IMAGE_BYTES,sanitizeImage } from './image-validation';
import { MediaUploadDto } from './media.dto';
export interface MediaActor{id:string;role:string}
export interface MediaRow{id:string;owner_id:bigint;shop_id:bigint|null;shop_owner_id:bigint|null;scope:string;purpose:string;status:string;request_key:string;input_hash:string;content_hash:string;storage_driver:string;storage_namespace:string;object_key:string;mime_type:string;size_bytes:number;width:number;height:number;expires_at:Date;lease_token:string|null}
export const MEDIA_QUOTA={staged:20,active:100,totalBytes:100*1024*1024};
const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const id=(value:string)=>{if(!/^[1-9]\d{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw new BadRequestException('Invalid identity');return BigInt(value);};
const uuid=(value:string)=>{if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(value))throw new BadRequestException('Invalid media ID');return value;};
const pendingShopUpload = { code: 'SHOP_MEDIA_UPLOAD_PENDING', message: 'The shop image upload is still processing. Wait and retry the original upload.' };
const terminalShopUpload = { code: 'SHOP_MEDIA_UPLOAD_TERMINAL', message: 'The previous shop image upload is no longer available. Start a new upload.' };
function shopUploadConflict(row: MediaRow) {
  if (row.scope !== 'SHOP') return;
  if (row.status === 'UPLOADING') throw new ConflictException(pendingShopUpload);
  if (['STAGED', 'ABANDONED', 'DELETING', 'DELETED'].includes(row.status)) throw new ConflictException(terminalShopUpload);
}
@Injectable()
export class UploadService implements OnModuleInit,OnModuleDestroy{
 private readonly logger=new Logger(UploadService.name);
 readonly storage=new MediaStorage();
 private timer?:ReturnType<typeof setInterval>;private collecting=false;private decoding=0;
 constructor(private readonly prisma:PrismaService){}
 onModuleInit(){if(process.env.NODE_ENV==='test'||!this.storage.available())return;this.timer=setInterval(()=>{void this.collectGarbage().catch(()=>this.logger.warn('Media cleanup will retry; no private object details logged'));},60000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 config(){return{enabled:this.storage.available(),driver:this.storage.available()?this.storage.driver:'disabled',...(!this.storage.available()?{reason:'MEDIA_STORAGE_NOT_CONFIGURED'}:{}),maxBytes:MAX_IMAGE_BYTES,maxPixels:25000000,maxEdge:8192,mimeTypes:['image/jpeg','image/png','image/webp'],outputMimeType:'image/webp',stagedTtlSeconds:86400,quota:MEDIA_QUOTA};}
 private item(row:MediaRow){return{id:row.id,fileUrl:mediaUrl(row.id),scope:row.scope,shopId:row.shop_id?.toString()??null,purpose:row.purpose,status:row.status,mimeType:row.mime_type,width:row.width,height:row.height,sizeBytes:row.size_bytes,expiresAt:row.expires_at};}
 private async authorize(tx:Prisma.TransactionClient,actor:MediaActor,scope:string,shopId:bigint|null,purpose:string){
  const actorId=id(actor.id);if(actor.role==='STAFF')throw new ForbiddenException('Staff cannot upload or manage media');
  if(scope==='BANNER'){
   if(shopId!==null)throw new BadRequestException('Banner images cannot belong to a shop');
   await requireBannerAdministrator(tx,actor);return null;
  }
  let shopOwnerId:bigint|null=null;
  if(scope==='SHOP'){
   if(!shopId||!['ADMIN','MERCHANT'].includes(actor.role))throw new ForbiddenException('Only shop owner or administrator can upload shop images');
   await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${shopId} FOR UPDATE`);
   const permission = purpose === 'menu' ? 'CATALOG_MANAGE' : 'SHOP_SETTINGS_MANAGE';
   const {shop}=await requireShopAccess(tx,shopId,actor,permission, { write: true });shopOwnerId=shop.ownerId;
  }
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${actorId} FOR UPDATE`);
  if(!await tx.user.findFirst({where:{id:actorId,status:'ACTIVE',deletedAt:null},select:{id:true}}))throw new ForbiddenException('Account unavailable');
  return shopOwnerId;
 }
 private async owned(tx:Prisma.TransactionClient,actor:MediaActor,mediaId:string,shopPreview=false){
  const [initial]=await tx.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE id=${uuid(mediaId)}`);if(!initial)throw new NotFoundException('Media not found');
  if(shopPreview&&(initial.scope!=='SHOP'||initial.owner_id!==id(actor.id)))throw new NotFoundException('Image not found');
  const currentOwner=await this.authorize(tx,actor,initial.scope,initial.shop_id,initial.purpose);
  const [row]=await tx.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE id=${mediaId} FOR UPDATE`);
  if(!row||row.owner_id!==id(actor.id)&&actor.role!=='ADMIN'||row.scope==='AVATAR'&&row.owner_id!==id(actor.id))throw new NotFoundException('Media not found');
  if(row.scope==='BANNER'&&(row.purpose!=='banner'||row.shop_id!==null||row.shop_owner_id!==null))throw new NotFoundException('Media not found');
  if(row.scope==='BANNER'&&row.status!=='BOUND'&&row.owner_id!==id(actor.id))throw new NotFoundException('Media not found');
  if(row.scope==='SHOP'&&row.status==='STAGED'&&row.shop_owner_id!==currentOwner)throw new ConflictException('Shop owner changed; upload a new image');
  return row;
 }
 private compatible(row:MediaRow){if(row.storage_driver!==this.storage.driver||row.storage_namespace!==this.storage.namespace)throw new ServiceUnavailableException('MEDIA_STORAGE_BINDING_CHANGED');}
 async upload(actor:MediaActor,dto:MediaUploadDto,file:{buffer:Buffer;mimetype:string}){
  this.storage.require();
  const validTarget = dto.scope === 'SHOP'
   ? !!dto.shopId && ['logo', 'cover', 'gallery', 'menu'].includes(dto.purpose)
   : dto.shopId === undefined && ((dto.scope === 'AVATAR' && dto.purpose === 'avatar') || (dto.scope === 'BANNER' && dto.purpose === 'banner'));
  if (!validTarget || !/^[A-Za-z0-9:_-]{8,80}$/.test(dto.requestKey)) throw new BadRequestException('Invalid upload target');
  if(dto.scope==='BANNER'&&actor.role!=='ADMIN')throw new ForbiddenException('Platform administrator required for banner images');
  id(actor.id);if(actor.role==='STAFF')throw new ForbiddenException('Staff cannot upload media');
  if(!file||!Buffer.isBuffer(file.buffer))throw new BadRequestException('An image file is required');
  if(this.decoding>=4)throw new HttpException('Image processing is busy; retry later',429);
  this.decoding++;let image:Awaited<ReturnType<typeof sanitizeImage>>;try{image=await sanitizeImage(file.buffer,file.mimetype);}finally{this.decoding--;}
  const hash=digest(JSON.stringify({scope:dto.scope,shopId:dto.shopId??null,purpose:dto.purpose,mime:file.mimetype,sha:digest(file.buffer)}));
  const token=randomUUID(),mediaId=randomUUID(),shopId=dto.scope==='SHOP'?id(dto.shopId!):null;
  const reserved=await withBannerMediaRetry(dto.scope==='BANNER',()=>this.prisma.$transaction(async tx=>{
   const shopOwnerId=await this.authorize(tx,actor,dto.scope,shopId,dto.purpose);
   const [existing]=await tx.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE owner_id=${id(actor.id)} AND request_key=${dto.requestKey} FOR UPDATE`);
   if(existing){
    if(existing.input_hash!==hash)throw new ConflictException('Upload key already used for different content');
    if(existing.scope==='SHOP'&&existing.status==='STAGED'&&existing.shop_owner_id!==shopOwnerId)throw new ConflictException('Shop owner changed; upload a new image');
    const usable = existing.status === 'BOUND' || existing.status === 'STAGED' && existing.expires_at > new Date();
    if (usable) {
     this.compatible(existing);
     return {row:existing,replayed:true};
    }
    shopUploadConflict(existing);
    this.compatible(existing);
    throw new ConflictException('Upload is already pending, expired or abandoned; use a new request key');
   }
   const [quota]=await tx.$queryRaw<{active:bigint;staged:bigint;bytes:bigint}[]>(Prisma.sql`SELECT COUNT(*) active,SUM(status IN ('UPLOADING','STAGED')) staged,COALESCE(SUM(size_bytes),0) bytes FROM media_assets WHERE owner_id=${id(actor.id)} AND status NOT IN ('DELETED')`);
   if(Number(quota.active)>=MEDIA_QUOTA.active||Number(quota.staged)>=MEDIA_QUOTA.staged||Number(quota.bytes)+image.sizeBytes>MEDIA_QUOTA.totalBytes)throw new ConflictException('Media quota reached; abandon unused uploads and wait for cleanup');
   await tx.$executeRaw(Prisma.sql`INSERT INTO media_assets(id,owner_id,shop_id,shop_owner_id,scope,purpose,status,request_key,input_hash,content_hash,storage_driver,storage_namespace,object_key,mime_type,size_bytes,width,height,expires_at,lease_token,created_at,updated_at) VALUES(${mediaId},${id(actor.id)},${shopId},${shopOwnerId},${dto.scope},${dto.purpose},'UPLOADING',${dto.requestKey},${hash},${digest(image.buffer)},${this.storage.driver},${this.storage.namespace},${mediaId+'.webp'},'image/webp',${image.sizeBytes},${image.width},${image.height},DATE_ADD(NOW(3),INTERVAL 10 MINUTE),${token},NOW(3),NOW(3))`);
   const [row]=await tx.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE id=${mediaId}`);return{row,replayed:false};
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted}));
  if(reserved.replayed){const bytes=await this.storage.read(reserved.row.object_key);if(digest(bytes)!==reserved.row.content_hash)throw new ServiceUnavailableException('MEDIA_INTEGRITY_CHECK_FAILED');return{item:this.item(reserved.row),replayed:true};}
  try{
   await this.storage.put(reserved.row.object_key,image.buffer);
   const count=await this.prisma.$executeRaw(Prisma.sql`UPDATE media_assets SET status='STAGED',expires_at=DATE_ADD(NOW(3),INTERVAL 24 HOUR),lease_token=NULL,updated_at=NOW(3) WHERE id=${mediaId} AND status='UPLOADING' AND lease_token=${token}`);
   if(!count)throw new ConflictException('Upload no longer available');
   const [row]=await this.prisma.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE id=${mediaId}`);return{item:this.item(row),replayed:false};
  }catch(error){
   // A slow provider write can finish after an expired UPLOADING row was garbage-collected.
   // Re-arm only this immutable object tombstone for a second delete; never overwrite a valid binding/finalization.
   const abandoned = await this.prisma.$executeRaw(Prisma.sql`UPDATE media_assets SET status='ABANDONED',expires_at=NOW(3),lease_token=NULL,last_error_code='UPLOAD_NOT_FINALIZED',updated_at=NOW(3) WHERE id=${mediaId} AND status IN ('UPLOADING','ABANDONED','DELETING','DELETED')`).catch(()=>undefined);
   if (dto.scope === 'SHOP' && abandoned) throw new ServiceUnavailableException(terminalShopUpload);
   throw error;
  }
 }
 async confirm(actor:MediaActor,mediaId:string){
  this.storage.require();const row=await this.prisma.$transaction(tx=>this.owned(tx,actor,mediaId),{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  if(!['STAGED','BOUND'].includes(row.status)||row.status==='STAGED'&&row.expires_at<=new Date()){
   shopUploadConflict(row);
   throw new ConflictException('Media is not ready');
  }
  this.compatible(row);
  const buffer=await this.storage.read(row.object_key);if(digest(buffer)!==row.content_hash)throw new ServiceUnavailableException('MEDIA_INTEGRITY_CHECK_FAILED');
  return{item:this.item(row)};
 }
 async commitAvatar(actor:MediaActor,mediaId:string){
  await this.confirm(actor,mediaId);
  return this.prisma.$transaction(async tx=>{
   const row=await this.owned(tx,actor,mediaId);if(row.scope!=='AVATAR'||row.owner_id!==id(actor.id)||!['STAGED','BOUND'].includes(row.status)||row.status==='STAGED'&&row.expires_at<=new Date())throw new ConflictException('Avatar upload is unavailable');
   const user=await tx.user.findUniqueOrThrow({where:{id:id(actor.id)},select:{avatarUrl:true}});const old=managedMediaId(user.avatarUrl??'');
   await tx.user.update({where:{id:id(actor.id)},data:{avatarUrl:mediaUrl(row.id)}});
   await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='BOUND',bound_at=COALESCE(bound_at,NOW(3)),updated_at=NOW(3) WHERE id=${row.id}`);
   if(old&&old!==row.id)await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='ABANDONED',expires_at=NOW(3),updated_at=NOW(3) WHERE id=${old} AND owner_id=${id(actor.id)} AND scope='AVATAR' AND status='BOUND'`);
   return{item:this.item({...row,status:'BOUND'}),avatarUrl:mediaUrl(row.id)};
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
 }
 async abandon(actor:MediaActor,mediaId:string){return this.prisma.$transaction(async tx=>{const row=await this.owned(tx,actor,mediaId);if(['ABANDONED','DELETING','DELETED'].includes(row.status))return{abandoned:true};if(row.status!=='STAGED')throw new ConflictException('Only staged, unbound uploads can be abandoned');await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='ABANDONED',expires_at=NOW(3),updated_at=NOW(3) WHERE id=${row.id}`);return{abandoned:true};},{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});}
 async file(mediaId:string){
  const [row]=await this.prisma.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE id=${uuid(mediaId)} AND (status='BOUND' OR (status='STAGED' AND scope<>'SHOP'))`);
  if(!row||row.status==='STAGED'&&(row.scope==='SHOP'||row.expires_at<=new Date()))throw new NotFoundException('Image not found');
  return this.readImage(row);
 }
 async preview(actor:MediaActor,mediaId:string){
  const row=await this.prisma.$transaction(async tx=>{
   const owned=await this.owned(tx,actor,mediaId,true);
   if(owned.status!=='BOUND'&&(owned.status!=='STAGED'||owned.expires_at<=new Date()))throw new NotFoundException('Image not found');
   return owned;
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  return this.readImage(row);
 }
 private async readImage(row:MediaRow){
  this.compatible(row);
  const buffer=await this.storage.read(row.object_key);
  if(digest(buffer)!==row.content_hash)throw new ServiceUnavailableException('MEDIA_INTEGRITY_CHECK_FAILED');
  return buffer;
 }
 async collectGarbage(){
  if(this.collecting||!this.storage.available())return{deleted:0};this.collecting=true;let deleted=0;
  try{const candidates=await this.prisma.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE status IN ('UPLOADING','STAGED','ABANDONED','DELETING') AND expires_at<=NOW(3) ORDER BY expires_at,id LIMIT 50`);
   for(const candidate of candidates){if(candidate.storage_driver!==this.storage.driver||candidate.storage_namespace!==this.storage.namespace)continue;
    const token=randomUUID();const row=await this.prisma.$transaction(async tx=>{
     if(candidate.shop_id)await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${candidate.shop_id} FOR UPDATE`);
     else await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${candidate.owner_id} FOR UPDATE`);
     const[asset]=await tx.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM media_assets WHERE id=${candidate.id} FOR UPDATE`);if(!asset||!['UPLOADING','STAGED','ABANDONED','DELETING'].includes(asset.status)||asset.expires_at>new Date())return null;
     const url=mediaUrl(asset.id);const[references]=await tx.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT ((SELECT COUNT(*) FROM users WHERE avatar_url=${url})+(SELECT COUNT(*) FROM shops WHERE JSON_SEARCH(studio_profile,'one',${url}) IS NOT NULL)+(SELECT COUNT(*) FROM home_banners WHERE image_url=${url})) total`);
     if(Number(references.total)){await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='BOUND',bound_at=COALESCE(bound_at,NOW(3)),lease_token=NULL,updated_at=NOW(3) WHERE id=${asset.id}`);return null;}
     await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='DELETING',expires_at=DATE_ADD(NOW(3),INTERVAL 5 MINUTE),lease_token=${token},updated_at=NOW(3) WHERE id=${asset.id}`);return asset;
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});if(!row)continue;
    try{await this.storage.remove(row.object_key);await this.prisma.$executeRaw(Prisma.sql`UPDATE media_assets SET status='DELETED',lease_token=NULL,last_error_code=NULL,updated_at=NOW(3) WHERE id=${row.id} AND status='DELETING' AND lease_token=${token}`);deleted++;}catch{await this.prisma.$executeRaw(Prisma.sql`UPDATE media_assets SET last_error_code='STORAGE_DELETE_FAILED',updated_at=NOW(3) WHERE id=${row.id} AND lease_token=${token}`);}
   }return{deleted};
  }finally{this.collecting=false;}
 }
 generateAvatarPresignedUrl(_userId:string,_ext:string){throw new ServiceUnavailableException('DIRECT_UPLOAD_DISABLED_USE_MANAGED_MEDIA');}
 confirmAvatar(_userId:string,_fileUrl:string){throw new BadRequestException('DIRECT_AVATAR_CONFIRM_DISABLED_USE_MANAGED_MEDIA');}
}
