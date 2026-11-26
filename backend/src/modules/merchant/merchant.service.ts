/**
 * MJAPP — Merchant Service
 * Handles merchant onboarding, shop management, therapist/service mgmt, dashboard
 */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { bookingAddOnsView } from '../../common/booking-addons-view';
import { bookingContactView } from '../../common/booking-contact';
import { historicalBookingService } from '../../common/booking-service-snapshot';
import { readDurationKind, validReservedDurationMin, serviceDurationMeta, itemDurationMeta, bookingDurationMeta, type ServiceDurationKind } from '../../common/service-duration';
import { MerchantTransaction, Prisma } from '@prisma/client';

import { BookingService } from '../booking/booking.service';
import { numericId } from '../payment/money';
import { normalizeHours } from '../booking/hours';
import { shopMediaUrls, syncShopMedia, validateMediaUrl } from '../../common/managed-media';
import { publicShopProfile } from '../../common/shop-public-profile';
import { scalarData } from '../../common/scalar-data';
import { bookingLocalFields, localInstant, localParts } from '../booking/time';
import { BOOKING_LIST_ORDER, bookingListResult, bookingListWhere, BookingListQuery, parseBookingListQuery } from '../booking/booking-list.query';
import { createShopLedger } from '../../common/merchant-ledger';
import { requireShopAccess, SHOP_PERMISSIONS, STAFF_PERMISSIONS, shopAccessWhere, staffPermissions, accountPermissions } from '../../common/shop-access';
import { hasServiceVariants, serviceDisplaySource } from '../../common/service-reservation-options';
import { ensureBaseServiceEdit, withShopConfiguration, configurationAudit, ensureServiceConfiguration, ensureTherapistConfiguration, ensureShopConfiguration } from '../reservations/configuration-guard';
import { normalizePriceMenu, PriceMenuValidationError } from '../../common/shop-price-menu';
import { storedStudioProfile } from '../../common/shop-studio-profile';
import { matchesPriceMenuRevision, priceMenuRevision, PRICE_MENU_CHANGED } from '../../common/shop-price-menu-revision';
import { isPriceMenuOnlyUpdate, parseCatalogSelectionPreconditions } from '../../common/menu-catalog-preconditions';
import { loadPriceMenuCatalog, savePriceMenuCatalog, PRICE_MENU_CATALOG_INCLUDE } from '../../common/shop-price-menu-catalog';
import { validShopServiceDescription, validShopServiceName } from './dto/merchant.dto';
import { canonicalShopLink } from '../../common/shop-alias';
import { shopFeatures } from '../../common/shop-features';
import { customerOrderEmail } from '../../common/booking-order-email';

const SHOP_PROFILE_FIELDS = ['id','ownerId','name','nameEn','shortName','phone','address','city','state','zipCode','latitude','longitude','status','timezone','shopType','businessHours','description','createdAt','updatedAt'] as const;

@Injectable()
export class MerchantService {
  private readonly logger = new Logger(MerchantService.name);
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingService) {}

  /* ════════════════════════════════════════════
     P2-T01: Merchant Onboarding
     ════════════════════════════════════════════ */

  /**
   * Apply as a merchant — creates shop + merchant profile + certificates
   */
  async apply(_data: any): Promise<any> {
    throw new ForbiddenException('请联系公司管理员开通独立门店账号；顾客账号不能自行升级为商家');
  }

  /**
   * Get merchant application status
   */
  async getApplicationStatus(userId: string, shopId?: string, actorRole = 'MERCHANT') {
    const { profile } = await this.ownedLedger(userId, shopId, actorRole);
    const shop = await this.prisma.shop.findUnique({
      where: { id: profile.shopId },
      select: { id: true, name: true, status: true },
    });
    // Flutter's MerchantApplication model reads `status`/`shopName` from the
    // top level; expose shop.status there while keeping the nested shop too.
    return {
      ...profile,
      status: shop?.status ?? 'PENDING',
      shopName: shop?.name ?? null,
      shop,
    };
  }

  /* ════════════════════════════════════════════
     P2-T02: Shop Management
     ════════════════════════════════════════════ */

  /**
   * Get merchant's own shops (only APPROVED merchants)
   */
  async getMyShops(userId: string, actorRole = 'MERCHANT') {
    const uid = numericId(userId), actor = { id: userId, role: actorRole };
    if (!['MERCHANT','STAFF','ADMIN'].includes(actorRole)) throw new ForbiddenException();
    const operator = await this.prisma.user.findFirst({where:{id:uid,role:actorRole as any,status:'ACTIVE',deletedAt:null},select:{id:true}});
    if (!operator) throw new ForbiddenException('Account unavailable');
    const allowed = actorRole === 'STAFF' ? STAFF_PERMISSIONS : SHOP_PERMISSIONS;
    const where = actorRole === 'ADMIN' ? shopAccessWhere(actor, 'BOOKINGS_READ') : { OR: allowed.map(permission => shopAccessWhere(actor, permission)) };
    const shopFields = SHOP_PROFILE_FIELDS;
    const rows = await (this.prisma as any).shop.findMany({ where, select: {
      ...Object.fromEntries(shopFields.map(field => [field, true])), studioProfile:true,
      shopImages:{orderBy:[{sortOrder:'asc'},{id:'asc'}]}, shopServices:{include:PRICE_MENU_CATALOG_INCLUDE},
      loginBinding:{include:{user:{select:{id:true,name:true,loginName:true,email:true,status:true}}}},
      incomingAccountGrants:{where:{status:'ACTIVE',sourceShop:{loginBinding:{is:{userId:uid}}}},select:{permissions:true,sourceShopId:true}},
      staffGrants:{where:{userId:uid,status:'ACTIVE'},select:{permissions:true}},
    } });
    return rows.map((row: any) => {
      const {staffGrants,shopImages,studioProfile,loginBinding,incomingAccountGrants}=row;
      const shop = Object.fromEntries(shopFields.map(field => [field, row[field]]));
      const owned = actorRole === 'MERCHANT' && loginBinding?.userId === uid;
      const account = loginBinding?.user;
      const loginAccount = (owned || actorRole === 'ADMIN') && account
        ? {id:account.id,name:account.name,loginName:account.loginName,email:account.email,status:account.status} : null;
      let granted: string[] = [];
      try { granted = actorRole === 'STAFF' ? staffPermissions(staffGrants[0]?.permissions ?? []) : owned || actorRole === 'ADMIN' ? [...SHOP_PERMISSIONS] : accountPermissions(incomingAccountGrants[0]?.permissions ?? []); } catch { granted = []; }
      const copyOnly = actorRole === 'MERCHANT' && !owned && granted.length === 1 && granted[0] === 'COPY_CONFIG';
      const profile = copyOnly
        ? { id: shop.id, name: shop.name, status: shop.status, timezone: shop.timezone }
        : {...shop,...this.shopMedia({...shop,studioProfile,shopServices:row.shopServices},shopImages,granted.includes('SHOP_SETTINGS_MANAGE')),features:shopFeatures(studioProfile)};
      return {...profile,...(!copyOnly ? canonicalShopLink(shop.shortName) : {}),
        isOwner:actorRole === 'ADMIN' || owned, accessType:actorRole === 'ADMIN' ? 'ADMIN' : owned ? 'OWN' : actorRole === 'STAFF' ? 'STAFF' : 'ASSOCIATED',
        homeShopId:actorRole === 'ADMIN' || actorRole === 'STAFF' ? null : owned ? String(shop.id) : incomingAccountGrants[0]?.sourceShopId?.toString() ?? null,
        loginAccount, permissions:granted};
    });
  }

  async updateShop(userId: string, shopId: string, data: any, actorRole = 'MERCHANT') {
    const actor = { id: userId, role: actorRole };
    const { logoUrl, bannerUrl, gallery, emails, priceMenu, expectedPriceMenuRevision, catalogSelectionPreconditions, ...scalars } = data;
    const changes = scalarData(scalars, ['name','nameEn','phone','address','city','state','zipCode','latitude','longitude','description']);
    const emailsChanged = Object.prototype.hasOwnProperty.call(data, 'emails');
    if (emailsChanged && (!Array.isArray(emails) || emails.length > 5 || emails.some((email: unknown) => typeof email !== 'string' || email.length > 255 || !customerOrderEmail(email.trim())))) {
      throw new BadRequestException('Contact emails must contain at most five valid addresses');
    }
    const menuChanged = Object.prototype.hasOwnProperty.call(data, 'priceMenu');
    const menuOnly = isPriceMenuOnlyUpdate(data);
    const selections = parseCatalogSelectionPreconditions(catalogSelectionPreconditions);
    if (!menuChanged && catalogSelectionPreconditions !== undefined) throw new BadRequestException('目录选择版本须与价目一起提交');
    let normalizedMenu: ReturnType<typeof normalizePriceMenu> | undefined;
    if (menuChanged) {
      try { normalizedMenu = normalizePriceMenu(priceMenu); }
      catch (error) { if (error instanceof PriceMenuValidationError) throw new BadRequestException(error.message); throw error; }
    }
    return withShopConfiguration(this.prisma, numericId(shopId), actor, async (tx, shop) => {
      const images = await tx.shopImage.findMany({where:{shopId:shop.id},orderBy:[{sortOrder:'asc'},{id:'asc'}]});
      const display = publicShopProfile(shop,images, { includePriceMenu: false });
      let old: Record<string, any>;
      try { old = storedStudioProfile(shop.studioProfile); }
      catch { throw new ConflictException('Stored shop profile is malformed; repair it before editing'); }
      const catalog = menuChanged ? await loadPriceMenuCatalog(tx, shop.id, old.priceMenu) : [];
      if (menuChanged && !matchesPriceMenuRevision(shop.id, old, expectedPriceMenuRevision, catalog)) throw new ConflictException(PRICE_MENU_CHANGED);
      const mediaChanged = ['logoUrl','bannerUrl','gallery'].some(key => Object.prototype.hasOwnProperty.call(data,key));
      if (menuChanged) changes.studioProfile = { ...old, priceMenu: await savePriceMenuCatalog(tx, shop, normalizedMenu, old.priceMenu, actor, selections) };
      if (mediaChanged) {
        if (gallery !== undefined && (!Array.isArray(gallery) || gallery.length > 20)) throw new BadRequestException('Gallery must contain at most 20 image URLs');
        changes.studioProfile = {...(changes.studioProfile ?? old),logoUrl:logoUrl === undefined ? display.media.logoUrl ?? '' : validateMediaUrl(logoUrl),bannerUrl:bannerUrl === undefined ? display.media.coverUrl ?? '' : validateMediaUrl(bannerUrl),gallery:gallery === undefined ? display.media.galleryUrls : gallery.map(validateMediaUrl)};
      }
      if (emailsChanged) changes.studioProfile = { ...(changes.studioProfile ?? old), emails: emails.map((email: string) => email.trim()) };
      if (mediaChanged || menuChanged) {
        const media = {shopId:shop.id,actor,previousUrls:shopMediaUrls(old),nextUrls:shopMediaUrls(changes.studioProfile)};
        if (menuOnly) await syncShopMedia(tx,{...media,purpose:'MENU',previousProfile:old,nextProfile:changes.studioProfile});
        else await syncShopMedia(tx,media);
      }
      await ensureShopConfiguration(tx, shop, changes);
      const updated = await tx.shop.update({ where: { id: shop.id }, data: changes });
      await configurationAudit(tx, actor, 'SHOP', shop.id, 'UPDATE', [...Object.keys(scalars),...(emailsChanged ? ['emails'] : []),...(mediaChanged ? ['logoUrl','bannerUrl','gallery'] : []),...(menuChanged ? ['priceMenu'] : [])]);
      return {...Object.fromEntries(SHOP_PROFILE_FIELDS.map(field => [field, updated[field]])),...this.shopMedia({...updated,shopServices:await loadPriceMenuCatalog(tx, shop.id, (changes.studioProfile ?? old).priceMenu)},images,!menuOnly)};
    }, menuOnly ? 'CATALOG_MANAGE' : 'SHOP_SETTINGS_MANAGE');
  }
  private shopMedia(shop:any,images:any[] = [],includeOrderEmail = false) {
    const view=publicShopProfile(shop,images,{includeHiddenPriceMenu:true});
    return {logoUrl:view.media.logoUrl ?? '',bannerUrl:view.media.coverUrl ?? '',gallery:view.media.galleryUrls,media:view.media,priceMenu:view.priceMenu,priceMenuRevision:priceMenuRevision(shop.id,shop.studioProfile,shop.shopServices ?? []),...(includeOrderEmail ? {emails:view.emails} : {})};
  }

  /**
   * Set business hours for a shop
   */
  async setBusinessHours(userId: string, shopId: string, hours: Record<string, any>, actorRole = 'MERCHANT') {
    const actor = { id: userId, role: actorRole };
    const businessHours = normalizeHours(hours);
    return withShopConfiguration(this.prisma, numericId(shopId), actor, async (tx, shop) => {
      await ensureShopConfiguration(tx, shop, { businessHours });
      const updated = await tx.shop.update({ where: { id: shop.id }, data: { businessHours } });
      await configurationAudit(tx, actor, 'SHOP', shop.id, 'UPDATE', ['businessHours']);
      return { businessHours: updated.businessHours };
    }, 'SHOP_SETTINGS_MANAGE');
  }

  /**
   * Add shop image
   */
  async addShopImage(userId: string, shopId: string, data: { imageUrl: string; imageType?: string; sortOrder?: number }, actorRole = 'MERCHANT') {
    const actor = { id:userId, role:actorRole }, imageUrl = validateMediaUrl(data.imageUrl);
    if (!imageUrl.startsWith('https://')) throw new BadRequestException('Save managed images through shop profile editing');
    return withShopConfiguration(this.prisma,numericId(shopId),actor,async(tx,shop)=>{
      const row = await tx.shopImage.create({data:{shopId:shop.id,imageUrl,imageType:(data.imageType as any)||'STORE_FRONT',sortOrder:data.sortOrder||0}});
      await configurationAudit(tx,actor,'SHOP',shop.id,'IMAGE_CREATE',['shopImages']); return row;
    },'OWNER_ONLY');
  }
  async deleteShopImage(userId: string, imageId: string, actorRole = 'MERCHANT') {
    const ref = await this.prisma.shopImage.findUnique({where:{id:numericId(imageId)},select:{shopId:true}});
    if (!ref) throw new NotFoundException('Image not found');
    const actor={id:userId,role:actorRole};
    return withShopConfiguration(this.prisma,ref.shopId,actor,async(tx,shop)=>{
      const row=await tx.shopImage.findFirst({where:{id:numericId(imageId),shopId:shop.id}});
      if(!row) throw new NotFoundException('Image not found');
      await tx.shopImage.delete({where:{id:row.id}}); await configurationAudit(tx,actor,'SHOP',shop.id,'IMAGE_DELETE',['shopImages']); return {deleted:true};
    },'OWNER_ONLY');
  }
  async addCertificate(userId: string, shopId: string, data: {certUrl:string;certType:string}, actorRole = 'MERCHANT') {
    const actor={id:userId,role:actorRole};
    return withShopConfiguration(this.prisma,numericId(shopId),actor,async(tx,shop)=>{
      const row=await tx.shopCertificate.create({data:{shopId:shop.id,certificateType:data.certType as any,fileUrl:validateMediaUrl(data.certUrl)}});
      await configurationAudit(tx,actor,'SHOP',shop.id,'CERTIFICATE_CREATE',['certificates']); return row;
    },'OWNER_ONLY');
  }

  /**
   * Delete shop image
   */
  async getShopServices(userId: string, shopId: string, actorRole = 'MERCHANT') {
    const shop = await this._getShopOrThrow(shopId);
    await requireShopAccess(this.prisma, shop.id, { id: userId, role: actorRole }, 'CATALOG_MANAGE');
    const rows = await this.prisma.shopService.findMany({
      where: { shopId: numericId(shopId) },
      include: { _count: { select: { variants: true } }, variants: { select: { durationMin: true, priceCents: true, priceBasis: true, currency: true, isActive: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(({ _count, variants, ...row }) => { const display = serviceDisplaySource({ ...row, _count, variants }); return { ...row, durationMin: display.durationMin, hasVariants: hasServiceVariants({ ...row, _count, variants }), ...serviceDurationMeta(display) }; });
  }

  async createShopService(userId: string, shopId: string, data: {
    name: string; nameEn?: string; category: string;
    durationKind?: ServiceDurationKind; durationMin: number; priceCents: number; description?: string; isActive?: boolean;
  }, actorRole = 'MERCHANT') {
    const actor = { id: userId, role: actorRole };
    const changes = scalarData(data, ['name','nameEn','category','durationKind','durationMin','priceCents','description','isActive']);
    if (!validReservedDurationMin(readDurationKind(changes.durationKind), changes.durationMin)) throw new BadRequestException('请明确填写5至240的整数预约占用分钟');
    if (!validShopServiceName(changes.name)) throw new BadRequestException('服务名称须为非空纯文本，最多200字；超长展示名称须明确修改，不能自动截断');
    if (changes.description !== undefined && !validShopServiceDescription(changes.description)) throw new BadRequestException('服务说明须为纯文本，最多65535个UTF-8字节');
    if (changes.isActive !== undefined && typeof changes.isActive !== 'boolean') throw new BadRequestException('isActive须为布尔值，不能为null、字符串或数字');
    changes.name = changes.name.trim();
    return withShopConfiguration(this.prisma, numericId(shopId), actor, async (tx, shop) => {
      const row = await tx.shopService.create({ data: { ...changes, shopId: shop.id, priceBasis: 'PER_BOOKING' } });
      await configurationAudit(tx, actor, 'SERVICE', row.id, 'CREATE', Object.keys(changes));
      return { ...row, hasVariants: false, ...serviceDurationMeta(row) };
    });
  }

  async updateShopService(userId: string, serviceId: string, data: any, actorRole = 'MERCHANT') {
    const changes = scalarData(data, ['name', 'nameEn', 'category', 'durationKind', 'durationMin', 'priceCents', 'description', 'isActive']);
    if (changes.durationKind !== undefined || Object.prototype.hasOwnProperty.call(changes, 'durationKind')) readDurationKind(changes.durationKind);
    const target = await this.prisma.shopService.findUnique({ where: { id: numericId(serviceId) }, select: { shopId: true } });
    if (!target) throw new NotFoundException('Service not found');
    const actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, target.shopId, actor, async (tx, shop) => {
      const previous = await tx.shopService.findFirst({ where: { id: numericId(serviceId), shopId: shop.id }, include: { _count: { select: { variants: true } }, variants: { select: { durationMin: true, priceCents: true, priceBasis: true, currency: true, isActive: true } } } });
      if (!previous) throw new NotFoundException('Service not found');
      ensureBaseServiceEdit(previous, changes);
      const variants = hasServiceVariants(previous);
      if (!variants && Object.prototype.hasOwnProperty.call(changes, 'priceCents') && (!Number.isSafeInteger(changes.priceCents) || changes.priceCents < 0 || changes.priceCents > 99999999)) throw new BadRequestException('基础价格须为0至99999999的整数美分');
      if (!variants && (Object.prototype.hasOwnProperty.call(changes, 'durationKind') || Object.prototype.hasOwnProperty.call(changes, 'durationMin') || changes.isActive === true)) {
        if (!validReservedDurationMin(readDurationKind(changes.durationKind === undefined ? previous.durationKind : changes.durationKind), changes.durationMin === undefined ? previous.durationMin : changes.durationMin)) throw new BadRequestException('请明确填写5至240的整数预约占用分钟');
      }
      await ensureServiceConfiguration(tx, previous, changes);
      const row = await tx.shopService.update({ where: { id: previous.id }, data: changes });
      await configurationAudit(tx, actor, 'SERVICE', row.id, 'UPDATE', Object.keys(changes));
      const display = serviceDisplaySource({ ...previous, ...row });
      return { ...row, durationMin: display.durationMin, hasVariants: variants, ...serviceDurationMeta(display) };
    });
  }

  async deleteShopService(userId: string, serviceId: string, actorRole = 'MERCHANT') {
    const target = await this.prisma.shopService.findUnique({ where: { id: numericId(serviceId) }, select: { shopId: true } });
    if (!target) throw new NotFoundException('Service not found');
    const actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, target.shopId, actor, async (tx, shop) => {
      const previous = await tx.shopService.findFirst({ where: { id: numericId(serviceId), shopId: shop.id } });
      if (!previous) throw new NotFoundException('Service not found');
      await ensureServiceConfiguration(tx, previous, { isActive: false });
      await tx.shopService.update({ where: { id: previous.id }, data: { isActive: false } });
      await configurationAudit(tx, actor, 'SERVICE', previous.id, 'DISABLE', ['isActive']);
      return { deleted: true };
    });
  }

  /* ════════════════════════════════════════════
     P2-T03: Therapist Management
     ════════════════════════════════════════════ */

  async getMyTherapists(userId: string, shopId: string, actorRole = 'MERCHANT') {
    const shop = await this._getShopOrThrow(shopId);
    await requireShopAccess(this.prisma, shop.id, { id: userId, role: actorRole }, 'CATALOG_MANAGE');
    const therapists = await this.prisma.therapist.findMany({
      where: { shopId: numericId(shopId) },
      orderBy: { sortOrder: 'asc' },
      include: { therapistServices: { select: { serviceId: true } } },
    });
    return therapists.map(therapist => this.therapistResponse(therapist));
  }

  private therapistResponse<T extends { therapistServices: { serviceId: bigint }[] }>(row: T) {
    const { therapistServices, ...therapist } = row;
    return { ...therapist, serviceAccessMode: 'SHOP_ALL' as const, serviceIds: therapistServices.map(relation => relation.serviceId.toString()) };
  }

  private therapistInput(data: unknown, editing: boolean) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('Expected an object');
    const { serviceIds, ...fields } = data as Record<string, unknown>;
    const changes = scalarData(fields, ['name', 'avatarUrl', 'title', 'bio', 'yearsExp', 'gender', ...(editing ? ['isActive'] : [])]);
    if (serviceIds === undefined) return { changes, serviceIds: undefined };
    if (!Array.isArray(serviceIds) || serviceIds.length > 100 || serviceIds.some(id => typeof id !== 'string')) {
      throw new BadRequestException('serviceIds must contain at most 100 resource ID strings');
    }
    const ids = serviceIds.map(id => numericId(id));
    if (new Set(ids.map(id => id.toString())).size !== ids.length) throw new BadRequestException('Duplicate service IDs');
    return { changes, serviceIds: ids };
  }

  private async checkTherapistServices(tx: Prisma.TransactionClient, shopId: bigint, serviceIds: bigint[] | undefined) {
    if (!serviceIds?.length) return;
    const services = await tx.shopService.findMany({ where: { id: { in: serviceIds }, shopId }, select: { id: true } });
    if (services.length !== serviceIds.length) throw new BadRequestException('All services must belong to this shop');
  }

  async createTherapist(userId: string, shopId: string, data: {
    name: string; avatarUrl?: string; title?: string; bio?: string;
    yearsExp?: number; gender?: string; serviceIds?: string[];
  }, actorRole = 'MERCHANT') {
    const { changes, serviceIds } = this.therapistInput(data, false);
    const actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, numericId(shopId), actor, async (tx, shop) => {
      await this.checkTherapistServices(tx, shop.id, serviceIds);
      const therapist = await tx.therapist.create({ data: { ...changes, shopId: shop.id, name: changes.name, yearsExp: changes.yearsExp ?? 0 } });
      if (serviceIds?.length) await tx.therapistService.createMany({ data: serviceIds.map(serviceId => ({ therapistId: therapist.id, serviceId })) });
      await configurationAudit(tx, actor, 'THERAPIST', therapist.id, 'CREATE', [...Object.keys(changes), ...(serviceIds !== undefined ? ['serviceIds'] : [])]);
      const result = await tx.therapist.findUniqueOrThrow({ where: { id: therapist.id }, include: { therapistServices: { select: { serviceId: true } } } });
      return this.therapistResponse(result);
    });
  }

  async updateTherapist(userId: string, therapistId: string, data: any, actorRole = 'MERCHANT') {
    const { changes, serviceIds } = this.therapistInput(data, true);
    const target = await this.prisma.therapist.findUnique({ where: { id: numericId(therapistId) }, select: { shopId: true } });
    if (!target) throw new NotFoundException('Therapist not found');
    const actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, target.shopId, actor, async (tx, shop) => {
      const therapist = await tx.therapist.findFirst({ where: { id: numericId(therapistId), shopId: shop.id } });
      if (!therapist) throw new NotFoundException('Therapist not found');
      await this.checkTherapistServices(tx, shop.id, serviceIds);
      await ensureTherapistConfiguration(tx, therapist, changes, serviceIds);
      await tx.therapist.update({ where: { id: therapist.id }, data: changes });
      if (serviceIds !== undefined) {
        await tx.therapistService.deleteMany({ where: { therapistId: therapist.id } });
        if (serviceIds.length) await tx.therapistService.createMany({ data: serviceIds.map(serviceId => ({ therapistId: therapist.id, serviceId })) });
      }
      await configurationAudit(tx, actor, 'THERAPIST', therapist.id, 'UPDATE', [...Object.keys(changes), ...(serviceIds !== undefined ? ['serviceIds'] : [])]);
      const result = await tx.therapist.findUniqueOrThrow({ where: { id: therapist.id }, include: { therapistServices: { select: { serviceId: true } } } });
      return this.therapistResponse(result);
    });
  }

  async deleteTherapist(userId: string, therapistId: string, actorRole = 'MERCHANT') {
    const target = await this.prisma.therapist.findUnique({ where: { id: numericId(therapistId) }, select: { shopId: true } });
    if (!target) throw new NotFoundException('Therapist not found');
    const actor = { id: userId, role: actorRole };
    return withShopConfiguration(this.prisma, target.shopId, actor, async (tx, shop) => {
      const therapist = await tx.therapist.findFirst({ where: { id: numericId(therapistId), shopId: shop.id } });
      if (!therapist) throw new NotFoundException('Therapist not found');
      await ensureTherapistConfiguration(tx, therapist, { isActive: false });
      await tx.therapist.update({ where: { id: therapist.id }, data: { isActive: false } });
      await configurationAudit(tx, actor, 'THERAPIST', therapist.id, 'DISABLE', ['isActive']);
      return { deleted: true };
    });
  }

  /* ════════════════════════════════════════════
     P2-T03: Merchant Booking View
     ════════════════════════════════════════════ */

  async getShopBookings(userId: string, shopId: string, input: BookingListQuery | string = {}, actorRole = 'MERCHANT') {
    const { shop } = await requireShopAccess(this.prisma, numericId(shopId), { id: userId, role: actorRole }, 'BOOKINGS_READ');
    // Keep existing direct-service callers that pass a status string compatible.
    const query = parseBookingListQuery(typeof input === 'string' ? { status: input } : input);
    const where = bookingListWhere(query, { shopId: numericId(shopId) }, 'merchant');
    const include = {
      user: { select: { id: true, name: true, phone: true } },
      service: { select: { id: true, name: true } },
      therapist: { select: { id: true, name: true } },
      review: { select: { id: true, rating: true } }, items: true, addOns: true,
    };
    // Count and rows share one read snapshot; authorization remains shop-scoped.
    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include, orderBy: BOOKING_LIST_ORDER,
        ...(query.paged ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}) }),
      this.prisma.booking.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const items = bookings.map(b => {
      const { contactName, contactPhone, contactEmail, contactVersion, contactSource, contactEmailVerifiedAt, ...safe } = b as typeof b & Record<string, unknown>;
      return { ...safe, contact: bookingContactView(b), ...bookingAddOnsView(b), ...bookingDurationMeta(b),
        ...(b.service ? { service: historicalBookingService(b) } : {}),
        items: b.items.map(item => ({ ...item, ...itemDurationMeta(item) })), ...bookingLocalFields(b, shop.timezone) };
    });
    return query.paged ? { shopId: shop.id.toString(), ...bookingListResult(items, total, query) } : items;
  }

  /**
   * Confirm booking (merchant action)
   */
  async confirmBooking(userId: string, bookingId: string, actorRole = 'MERCHANT', operationKey?: string) { return operationKey === undefined ? this.bookings.updateBookingStatus(bookingId, userId, 'CONFIRMED', actorRole) : this.bookings.updateBookingStatus(bookingId, userId, 'CONFIRMED', actorRole, operationKey); }

  async completeBooking(userId: string, bookingId: string, actorRole = 'MERCHANT', operationKey?: string) { return operationKey === undefined ? this.bookings.updateBookingStatus(bookingId, userId, 'COMPLETED', actorRole) : this.bookings.updateBookingStatus(bookingId, userId, 'COMPLETED', actorRole, operationKey); }

  /**
   * Complete booking (mark service as done)
   */
  /* ════════════════════════════════════════════
     P2-T05: Merchant Dashboard / Stats
     ════════════════════════════════════════════ */

  async getDashboard(userId: string, shopId: string, startDate?: string, endDate?: string, actorRole = 'MERCHANT') {
    const { shop } = await requireShopAccess(this.prisma, numericId(shopId), { id: userId, role: actorRole }, 'FINANCE_READ');
    const timezone = this.ledgerTimezone(shop.timezone);
    const range = this.dateRange(startDate, endDate, timezone);
    // A new shop can expose authorized operating statistics before its ledger is
    // configured. Missing finance is explicit; a ledger owned by somebody else
    // still fails closed. This read never provisions financial records.
    const profile = await this.prisma.merchantProfile.findUnique({ where: { shopId: shop.id } });
    if (profile && profile.userId !== shop.ownerId) throw new ServiceUnavailableException('Merchant ledger is not configured for this shop');
    const [rows, status, reviews, bookingCount] = await Promise.all([
      profile ? this.prisma.merchantTransaction.findMany({ where: { profileId: profile.id, type: { in: ['PAYMENT', 'REFUND'] }, status: 'COMPLETED', ...(range ? { createdAt: range } : {}) }, orderBy: { createdAt: 'desc' } }) : Promise.resolve<MerchantTransaction[]>([]),
      this.prisma.booking.groupBy({ by: ['status'], where: { shopId: shop.id }, _count: true }),
      this.prisma.review.aggregate({ where: { shopId: shop.id }, _avg: { rating: true }, _count: true }),
      this.prisma.booking.count({ where: { shopId: shop.id, ...(range ? { createdAt: range } : {}) } }),
    ]);
    const daily = new Map<string, { date: string; revenue: number; bookings: number }>();
    for (const row of rows) {
      const date = localParts(row.createdAt, timezone).slice(0, 10);
      const day = daily.get(date) || { date, revenue: 0, bookings: 0 };
      day.revenue += row.amount; if (row.type === 'PAYMENT') day.bookings++; daily.set(date, day);
    }
    return {
      shopId: shop.id.toString(), timezone,
      ledgerConfigured: !!profile, financeUnavailableReason: profile ? null : 'LEDGER_NOT_CONFIGURED',
      overview: { totalRevenue: profile ? rows.reduce((s, r) => s + r.amount, 0) : null, totalFees: profile ? rows.reduce((s, r) => s + r.fee, 0) : null, netRevenue: profile ? rows.reduce((s, r) => s + r.net, 0) : null, totalBookings: bookingCount, avgRating: reviews._avg.rating || 0, totalReviews: reviews._count },
      balanceCents: profile ? profile.balanceCents : null, pendingCents: profile ? profile.pendingCents : null, totalEarnedCents: profile ? profile.totalEarnedCents : null,
      bookingStatusDistribution: status.map(s => ({ status: s.status, count: s._count })),
      dailyRevenue: profile ? [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)) : null, recentTransactions: profile ? rows.slice(0, 10).map(r => this.ledgerItem(r)) : null,
    };
  }
  async requestPayout(_userId: string, _amountCents: number): Promise<any> { throw new ServiceUnavailableException('Payout integration is not available; no funds have been transferred'); }

  /* ════════════════════════════════════════════
     P2-T04-US-004: Transactions
     ════════════════════════════════════════════ */

  /**
   * Get paginated transaction list (PAYMENT/REFUND from bookings, PAYOUT from merchant_transactions)
   */
  async getTransactions(userId: string, options: { shopId?: string; page: number; pageSize: number; startDate?: string; endDate?: string }, actorRole = 'MERCHANT') {
    const { page, pageSize } = options;
    if (!Number.isInteger(page) || !Number.isInteger(pageSize) || page < 1 || pageSize < 1 || pageSize > 100) throw new BadRequestException('Invalid pagination');
    const { profile, shop } = await this.ownedLedger(userId, options.shopId, actorRole);
    const timezone = this.ledgerTimezone(shop.timezone);
    const range = this.dateRange(options.startDate, options.endDate, timezone);
    const where = { profileId: profile.id, ...(range ? { createdAt: range } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.merchantTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.merchantTransaction.count({ where }),
    ]);
    return { shopId: profile.shopId.toString(), timezone, items: rows.map(row => this.ledgerItem(row)), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
  async createStripeOnboardingUrl(_userId: string, _shopId: string): Promise<any> { throw new ServiceUnavailableException('External merchant account operations are not enabled'); }

  async getStripeOnboardingStatus(_userId: string): Promise<any> { throw new ServiceUnavailableException('External merchant account verification is not enabled'); }

  private ledgerItem(row: any) {
    return { id: row.id.toString(), bookingId: row.bookingId?.toString() ?? null, type: row.type, amount: row.amount, fee: row.fee, net: row.net, status: row.status, createdAt: row.createdAt.toISOString(), description: row.description ?? '' };
  }
  private ledgerTimezone(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      try { return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).resolvedOptions().timeZone; }
      catch { /* Invalid saved zones must not silently become UTC reports. */ }
    }
    throw new ServiceUnavailableException('Shop timezone must be configured correctly before viewing financial reports');
  }
  private dateRange(start: string | undefined, end: string | undefined, timezone: string): { gte?: Date; lt?: Date } | undefined {
    const parse = (s: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new BadRequestException('Invalid date range');
      return new Date(`${s}T00:00:00Z`);
    };
    if (start) parse(start);
    const nextDate = end ? parse(end) : undefined;
    // Advance the calendar date before converting the second midnight. A local
    // day may contain 23 or 25 hours, so an instant cannot be advanced by 24h.
    if (nextDate) nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const from = start ? localInstant(start, '00:00', timezone) : undefined;
    const to = nextDate ? localInstant(nextDate.toISOString().slice(0, 10), '00:00', timezone) : undefined;
    if (from && to && from >= to) throw new BadRequestException('Invalid date range');
    return start || end ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined;
  }
  private async ownedLedger(userId: string, shopId?: string, actorRole = 'MERCHANT') {
    let shop;
    if (shopId !== undefined) { shop = (await requireShopAccess(this.prisma, numericId(shopId), {id:userId,role:actorRole}, 'FINANCE_READ')).shop; }
    else {
      const shops = await this.prisma.shop.findMany({ where: shopAccessWhere({id:userId,role:actorRole}, 'FINANCE_READ'), take: 2, orderBy: { id: 'asc' } });
      if (shops.length !== 1) throw new BadRequestException('An explicit shopId is required when there is not exactly one owned shop');
      shop = shops[0];
    }
    const profile = await this.prisma.merchantProfile.findUnique({ where: { shopId: shop.id } });
    if (!profile || profile.userId !== shop.ownerId) throw new ServiceUnavailableException('Merchant ledger is not configured for this shop');
    return { profile, shop };
  }
  private async yearlyLedger(userId: string, year?: number, shopId?: string, actorRole = 'MERCHANT') {
    const { profile, shop } = await this.ownedLedger(userId, shopId, actorRole);
    const timezone = this.ledgerTimezone(shop.timezone);
    const value = year ?? Number(localParts(new Date(), timezone).slice(0, 4));
    if (!Number.isInteger(value) || value < 2000 || value > 2100) throw new BadRequestException('Invalid report year');
    const rows = await this.prisma.merchantTransaction.findMany({ where: { profileId: profile.id, status: 'COMPLETED', createdAt: { gte: localInstant(`${value}-01-01`, '00:00', timezone), lt: localInstant(`${value + 1}-01-01`, '00:00', timezone) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { profile, rows, timezone, year: value };
  }
  async getTaxReport(userId: string, year?: number, shopId?: string, actorRole = 'MERCHANT') {
    const { profile, rows, timezone, year: resolvedYear } = await this.yearlyLedger(userId, year, shopId, actorRole);
    const business = rows.filter(r => r.type === 'PAYMENT' || r.type === 'REFUND');
    const total_net = business.reduce((sum, r) => sum + r.net, 0);
    const total_payouts = -rows.filter(r => r.type === 'PAYOUT').reduce((sum, r) => sum + r.amount, 0);
    return { shopId: profile.shopId.toString(), timezone, year: resolvedYear, total_gross: rows.filter(r => r.type === 'PAYMENT').reduce((sum, r) => sum + r.amount, 0), total_platform_fees: business.reduce((sum, r) => sum + r.fee, 0), total_refunds: -rows.filter(r => r.type === 'REFUND').reduce((sum, r) => sum + r.amount, 0), total_net, total_payouts, net_earnings: total_net - total_payouts };
  }
  async exportTaxReportCsv(userId: string, year?: number, shopId?: string, actorRole = 'MERCHANT'): Promise<string> {
    const { profile, rows, timezone } = await this.yearlyLedger(userId, year, shopId, actorRole);
    const bookings = await this.prisma.booking.findMany({ where: { id: { in: rows.map(r => r.bookingId).filter((id): id is bigint => id !== null) }, shopId: profile.shopId }, select: { id: true, bookingNo: true, contactName: true, contactPhone: true, contactEmail: true, contactVersion: true, contactSource: true, contactEmailVerifiedAt: true, user: { select: { name: true } }, service: { select: { name: true } } } });
    const byId = new Map(bookings.map(b => [b.id.toString(), b]));
    const esc = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
    const lines = ['Date,Booking#,Customer,Service,Gross ($),Fee ($),Net ($),Status'];
    for (const row of rows) {
      const booking = row.bookingId ? byId.get(row.bookingId.toString()) : undefined;
      const contact = bookingContactView(booking);
      lines.push([localParts(row.createdAt, timezone).slice(0, 10), esc(booking?.bookingNo ?? ''), esc(contact.recorded ? contact.name : booking?.user?.name ?? ''), esc(booking?.service.name ?? ''), (row.amount / 100).toFixed(2), (row.fee / 100).toFixed(2), (row.net / 100).toFixed(2), esc(row.type)].join(','));
    }
    return lines.join('\n');
  }
  private async _getShopOrThrow(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: numericId(shopId) },
    });
    if (!shop || shop.deletedAt) throw new NotFoundException('Shop not found');
    return shop;
  }

}
