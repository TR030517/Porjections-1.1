import { requireShopAccess } from './shop-access';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { numericId } from '../modules/payment/money';
import { managedPriceMenu } from './shop-price-menu';
import { storedStudioProfile } from './shop-studio-profile';
import { isServiceGalleryImagePath } from './public-media-url';
export const MANAGED_MEDIA_PATH = /^\/api\/v1\/upload\/media\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/file$/;
export const mediaUrl = (id: string) => `/api/v1/upload/media/${id}/file`;
export function managedMediaId(url: string) { return typeof url === 'string' ? MANAGED_MEDIA_PATH.exec(url)?.[1] ?? null : null; }
/** Only the exact server namespace extends the existing HTTPS-only media URL contract. */
export function validateMediaUrl(value: unknown): string {
  if (value === '' || value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 500 || /[\s\\\u0000-\u001f\u007f]/.test(value)) throw new BadRequestException('Invalid image URL');
  if (managedMediaId(value)) return value;
  try { const parsed = new URL(value); if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) throw Error(); return value; }
  catch { throw new BadRequestException('Use a valid HTTPS image URL or server-managed image'); }
}
export function shopMediaUrls(profile: unknown): string[] {
  let p: Record<string, unknown>;
  try { p = storedStudioProfile(profile); } catch { return []; }
  // Static menu subjects have no shop-owned upload row to bind or release.
  const menuImages = managedPriceMenu(p.priceMenu).flatMap(group => group.items.map(item => item.imageUrl)).filter(url => !isServiceGalleryImagePath(url));
  return [...new Set([p.logoUrl,p.bannerUrl,...(Array.isArray(p.gallery)?p.gallery:[]),...menuImages].filter((v):v is string=>typeof v==='string'&&!!v))];
}
/** Caller must hold shop FOR UPDATE; validate, bind and release references in the same save transaction. */
type ShopMediaSyncArgs = {shopId:string|bigint;actor:{id:string;role:string};previousUrls:string[];nextUrls:string[];copyWorkflow?:boolean}
  & ({purpose?:'SHOP_PROFILE'} | {purpose:'MENU';previousProfile:unknown;nextProfile:unknown});
const menuMediaUrls = (profile: Record<string, unknown>) => [...new Set(managedPriceMenu(profile.priceMenu).flatMap(group => group.items.map(item => item.imageUrl))
  .filter((url): url is string => typeof url === 'string' && !!url && !isServiceGalleryImagePath(url)))];
const nonMenuMedia = (profile: Record<string, unknown>) => JSON.stringify(['logoUrl','bannerUrl','gallery'].map(key => ({present:Object.prototype.hasOwnProperty.call(profile,key),value:profile[key]})));
const sameUrls = (left:string[],right:string[]) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
export async function syncShopMedia(tx: Prisma.TransactionClient, args:ShopMediaSyncArgs) {
  const shopId=BigInt(args.shopId), actorId=BigInt(args.actor.id);
  if (!['ADMIN','MERCHANT'].includes(args.actor.role)) throw new ForbiddenException('Only shop owner or administrator can manage images');
  await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${shopId} FOR UPDATE`);
  const permission=args.purpose==='MENU'?(args.copyWorkflow?'COPY_CONFIG':'CATALOG_MANAGE'):'SHOP_SETTINGS_MANAGE';
  const {shop}=await requireShopAccess(tx,shopId,args.actor,permission, { write: true });
  let nextUrls=args.nextUrls,previousUrls=args.previousUrls,retainedUrls=args.nextUrls;
  if(args.purpose==='MENU') {
    if(args.previousProfile===undefined||args.nextProfile===undefined)throw new BadRequestException('价目图片同步缺少已核对的资料范围');
    const previous=storedStudioProfile(args.previousProfile),next=storedStudioProfile(args.nextProfile),current=storedStudioProfile(shop.studioProfile);
    if(nonMenuMedia(previous)!==nonMenuMedia(next)||nonMenuMedia(next)!==nonMenuMedia(current))throw new ForbiddenException('价目权限不能修改门店Logo、横幅或相册');
    if(!sameUrls(args.previousUrls,shopMediaUrls(previous))||!sameUrls(args.nextUrls,shopMediaUrls(next)))throw new BadRequestException('价目图片引用与已核对的资料范围不一致');
    previousUrls=menuMediaUrls(previous);nextUrls=menuMediaUrls(next);retainedUrls=shopMediaUrls(next);
  }
  const next=[...new Set(nextUrls.map(validateMediaUrl).filter(Boolean))], previous=[...new Set(previousUrls)],retained=new Set(retainedUrls);
  for(const url of next){const id=managedMediaId(url);if(!id)continue;
    const [row]=await tx.$queryRaw<{id:string;owner_id:bigint;shop_owner_id:bigint;shop_id:bigint;scope:string;purpose:string;status:string;expires_at:Date}[]>(Prisma.sql`SELECT id,owner_id,shop_owner_id,shop_id,scope,purpose,status,expires_at FROM media_assets WHERE id=${id} FOR UPDATE`);
    if(!row||row.shop_id!==shopId||row.scope!=='SHOP'||!['STAGED','BOUND'].includes(row.status)||row.status==='STAGED'&&(row.owner_id!==actorId||row.shop_owner_id!==shop.ownerId||row.expires_at<=new Date()))throw new ConflictException('Image is unavailable or belongs to another upload/shop');
    if (row.status === 'STAGED' && row.purpose === 'menu' && permission !== 'CATALOG_MANAGE') {
      throw new ConflictException('请先在服务与价格工作区保存这张价目图片。');
    }
    await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='BOUND',bound_at=COALESCE(bound_at,NOW(3)),updated_at=NOW(3) WHERE id=${id}`);
  }
  for(const url of previous){const id=managedMediaId(url);if(!id||retained.has(url))continue;
    await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='ABANDONED',expires_at=NOW(3),updated_at=NOW(3) WHERE id=${id} AND shop_id=${shopId} AND scope='SHOP' AND status='BOUND'`);
  }
}

/** Banner writers take the active actor lock before any banner or media lock. */
export async function requireBannerAdministrator(tx: Prisma.TransactionClient, actor:{id:string;role:string}) {
  if (actor.role !== 'ADMIN') throw new ForbiddenException('Platform administrator required for banner images');
  const actorId=numericId(actor.id);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${actorId} FOR UPDATE`);
  if (!await tx.user.findFirst({where:{id:actorId,role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}})) throw new ForbiddenException('Active platform administrator required');
  return actorId;
}

/** Retry only database-aborted transactions; never repeat a storage/provider write. */
export async function withBannerMediaRetry<T>(enabled:boolean, work:()=>Promise<T>):Promise<T> {
  for (let attempt=0;;attempt++) {
    try { return await work(); }
    catch (error) {
      const value=error as {code?:string;meta?:{code?:string|number};errno?:number};
      const retryable=value?.code==='P2034'||value?.code==='P2010'&&['1213','1205'].includes(String(value.meta?.code))||['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(value?.code??'')||[1213,1205].includes(value?.errno??0);
      if (!enabled||!retryable) throw error;
      if (attempt>=2) throw new ServiceUnavailableException('轮播图片更新繁忙，请保留原内容并稍后重试。');
    }
  }
}

type BannerMediaRow={id:string;owner_id:bigint;scope:string;purpose:string;status:string;shop_id:bigint|null;shop_owner_id:bigint|null;expires_at:Date};
/**
 * Caller holds actor -> banner locks and has saved imageUrl in this transaction.
 * Lock old/new asset IDs in sorted order, so cross-admin swaps cannot invert them.
 * GC only takes owner -> one asset and never obtains a banner lock afterwards.
 */
export async function syncBannerMedia(tx: Prisma.TransactionClient,args:{actor:{id:string;role:string};previousUrl?:string|null;nextUrl:string}) {
  // Normal writers already hold this row; revalidation keeps the helper fail closed.
  const actorId=await requireBannerAdministrator(tx,args.actor), nextUrl=validateMediaUrl(args.nextUrl);
  const previousId=managedMediaId(args.previousUrl??''), nextId=managedMediaId(nextUrl);
  const assets=new Map<string,BannerMediaRow>();
  for(const mediaId of [...new Set([previousId,nextId].filter((value):value is string=>!!value))].sort()) {
    const [row]=await tx.$queryRaw<BannerMediaRow[]>(Prisma.sql`SELECT id,owner_id,scope,purpose,status,shop_id,shop_owner_id,expires_at FROM media_assets WHERE id=${mediaId} FOR UPDATE`);
    if(row)assets.set(mediaId,row);
  }
  if(nextId) {
    const row=assets.get(nextId);
    if(!row||row.scope!=='BANNER'||row.purpose!=='banner'||row.shop_id!==null||row.shop_owner_id!==null||!['STAGED','BOUND'].includes(row.status)||row.status==='STAGED'&&(row.owner_id!==actorId||row.expires_at<=new Date()))throw new ConflictException('Banner image is unavailable or belongs to another upload target');
    await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='BOUND',bound_at=COALESCE(bound_at,NOW(3)),updated_at=NOW(3) WHERE id=${nextId}`);
  }
  if(previousId&&previousId!==nextId) {
    const row=assets.get(previousId);
    if(row?.scope==='BANNER'&&row.purpose==='banner'&&row.status==='BOUND'&&!await tx.homeBanner.count({where:{imageUrl:mediaUrl(previousId)}})) {
      await tx.$executeRaw(Prisma.sql`UPDATE media_assets SET status='ABANDONED',expires_at=NOW(3),updated_at=NOW(3) WHERE id=${previousId} AND scope='BANNER' AND purpose='banner' AND status='BOUND'`);
    }
  }
}

/** Public projection must never expose an unknown, staged or cross-scope asset. */
export async function publicBannerImageAvailable(db: Pick<Prisma.TransactionClient,'mediaAsset'>,url:string):Promise<boolean> {
  const mediaId=managedMediaId(url);
  if(!mediaId)return true; // The caller already applied bannerData's strict HTTPS validation.
  return !!await db.mediaAsset.findFirst({where:{id:mediaId,scope:'BANNER',purpose:'banner',status:'BOUND',shopId:null,shopOwnerId:null},select:{id:true}});
}
