import { requireShopAccess } from '../../common/shop-access';
import { inferStoreTimezone } from '../../common/store-timezone';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import * as v from './validation';
import { publicSettingValue } from './settings-validation';
import { couponData, updateCouponInTransaction } from '../coupons/coupon-policy';
import { shopFeatures } from '../../common/shop-features';
import { createShopLedger } from '../../common/merchant-ledger';
import { requireShopPublication, shopPublication } from '../../common/shop-publication';
import { bookingLocalFields } from '../booking/time';
import { giftTimezone } from '../gift-cards/gift-card.time';
import { bookingAddOnsView } from '../../common/booking-addons-view';
import { bookingContactView } from '../../common/booking-contact';
import { historicalBookingService } from '../../common/booking-service-snapshot';
import { readDurationKind, serviceDurationMeta, itemDurationMeta, bookingDurationMeta } from '../../common/service-duration';
import { pageNumber, studioFilters } from './query';
import { hasServiceVariants, serviceDisplaySource } from '../../common/service-reservation-options';
import { ensureBaseServiceEdit, ensureServiceConfiguration, ensureTherapistConfiguration, ensureShopConfiguration } from '../reservations/configuration-guard';
import { canonicalShopLink, normalizeShopShortName, reserveShopAlias } from '../../common/shop-alias';
import { publicShopProfile } from '../../common/shop-public-profile';
import { shopEligibility } from '../../common/shop-eligibility';
import { announcementData, bannerData, publicationState } from '../../common/content-policy';
import { shopMediaUrls, syncShopMedia, validateMediaUrl, requireBannerAdministrator, syncBannerMedia, withBannerMediaRetry } from '../../common/managed-media';
import { shopPaymentPolicy } from '../../common/shop-payment-policy';
import { merchantAccountInput, merchantRoutedLoginReady } from '../../common/merchant-account';
import { requireRolePassword } from '../../common/validated-password';
import { normalizePriceMenu, PriceMenuValidationError } from '../../common/shop-price-menu';
import { storedStudioProfile } from '../../common/shop-studio-profile';
import { normalizeShopExternalLinks } from '../../common/shop-external-links';
import { normalizeShopBrandColor } from '../../common/shop-branding-colors';
import { normalizeShopButtonShape } from '../../common/shop-button-shape';
import { matchesPriceMenuRevision, priceMenuRevision, PRICE_MENU_CHANGED } from '../../common/shop-price-menu-revision';
import { isPriceMenuOnlyUpdate, parseCatalogSelectionPreconditions } from '../../common/menu-catalog-preconditions';
import { loadPriceMenuCatalog, savePriceMenuCatalog, PRICE_MENU_CATALOG_INCLUDE } from '../../common/shop-price-menu-catalog';
import { lockAdministratorStatus, requireAnotherActiveAdministrator } from '../../common/administrator-status';
type Actor = { id: string; role: string };
const ACCOUNT_SELECT = { id: true, name: true, loginName: true, email: true, phone: true, role: true, status: true, createdAt: true };
function normalizeStudioInput<T>(normalize: () => T): T {
  try { return normalize(); }
  catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '门店资料格式无效'); }
}
const SETTINGS = ['site_name', 'support_email', 'support_phone'];
const CONFIG: Record<string, { model: string; include?: any; select?: any }> = {
  stores: { model: 'shop', include: { shopServices: { include: PRICE_MENU_CATALOG_INCLUDE }, loginBinding: { include: { user: { select: { id: true, loginName: true, email: true, phone: true, passwordHash: true, name: true, role: true, status: true, deletedAt: true } } } }, owner: { select: { email: true, role: true, status: true, deletedAt: true } }, shopImages: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } },
  regions: { model: 'region' }, coupons: { model: 'coupon', include: { shop: true } },
  users: { model: 'user', select: ACCOUNT_SELECT }, admins: { model: 'user', select: ACCOUNT_SELECT }, merchants: { model: 'user', select: ACCOUNT_SELECT },
  'service-orders': { model: 'booking', include: { shop: true, service: true, items: true, addOns: true, user: { select: { name: true } } } },
  services: { model: 'shopService', include: { _count: { select: { variants: true } }, variants: { select: { durationMin: true, priceCents: true, priceBasis: true, currency: true, isActive: true } } } }, technicians: { model: 'therapist', include: { therapistServices: true } },
  banners: { model: 'homeBanner' }, industries: { model: 'category' }, content: { model: 'announcement' }, applications: { model: 'shop', include: { loginBinding: { include: { user: { select: { id: true, loginName:true, email:true, phone:true, passwordHash:true, role: true, status: true, deletedAt: true } } } }, owner: { select: { role: true, status: true, deletedAt: true } } } },
  'after-sales': { model: 'booking', include: { shop: true, refunds: true, items: true } },
  withdrawals: { model: 'merchantTransaction', include: { profile: { select: { shopId: true, userId: true } } } },
  settings: { model: 'platformConfig' }, 'gift-cards': { model: 'giftCardProduct' }, 'gift-card-orders': { model: 'giftCardOrder', include: { product: { select: { title: true } }, shop: { select: { timezone: true } } } },
};
@Injectable()
export class StudioService {
  constructor(private readonly prisma: PrismaService) {}
  private admin(actor: Actor) { if (actor.role !== 'ADMIN') throw new ForbiddenException('Platform administrator required'); }
  private config(resource: string) { const c = CONFIG[resource]; if (!c) throw new NotFoundException('Unknown resource'); return c; }
  private where(resource: string, actor: Actor, query: Record<string, string> = {}): any {
    const where: any = {};
    if (['stores','applications','coupons','service-orders','after-sales','content'].includes(resource)) where.deletedAt = null;
    if (resource === 'applications') this.admin(actor);
    if (['users','admins','merchants'].includes(resource)) {
      where.role = resource === 'admins' ? 'ADMIN' : resource === 'merchants' ? 'MERCHANT' : 'CUSTOMER';
      where.deletedAt = null;
      if (actor.role !== 'ADMIN') {
        if (resource !== 'users') throw new ForbiddenException();
        where.bookings = { some: { shop: { ownerId: v.id(actor.id) } } };
      }
    }
    if (resource === 'after-sales') where.OR = [{ status: 'REFUNDING' }, { refundedCents: { gt: 0 } }, { refunds: { some: {} } }];
    if (resource === 'withdrawals') where.type = 'PAYOUT';
    if (resource === 'coupons') where.type = 'FIXED_AMOUNT';
    if (resource === 'settings') { this.admin(actor); where.key = { in: SETTINGS }; }
    if (actor.role !== 'ADMIN') {
      if (['industries','content','banners'].includes(resource)) throw new ForbiddenException();
      if (resource === 'stores') where.ownerId = v.id(actor.id);
      if (['services','technicians','service-orders','after-sales','gift-cards','gift-card-orders'].includes(resource)) where.shop = { ownerId: v.id(actor.id) };
      if (resource === 'coupons') where.shop = { ownerId: v.id(actor.id) };
      if (resource === 'withdrawals') where.profile = { userId: v.id(actor.id) };
    }
    if (query.shopId) {
      if (resource === 'stores') where.id = v.id(query.shopId);
      else if (['services','technicians','service-orders','after-sales','coupons','gift-cards','gift-card-orders'].includes(resource)) where.shopId = v.id(query.shopId);
    }
    if (query.kind && resource === 'regions') where.kind = v.choice(query.kind, ['state','city']);
    if (query.parentId && resource === 'regions') where.parentId = v.id(query.parentId);
    const filters = studioFilters(resource, query);
    if (Object.keys(filters).length) where.AND = [filters];
    const key = v.text(query.search ?? query.keyword ?? query.q, 'search', 100);
    if (key) {
      const field = resource === 'regions' ? 'english' : ['coupons','content','gift-cards','banners'].includes(resource) ? 'title' : ['service-orders','after-sales'].includes(resource) ? 'bookingNo' : resource === 'gift-card-orders' ? 'orderNo' : 'name';
      if (['users','admins','merchants'].includes(resource)) where.AND = [...(where.AND ?? []), { OR: ['name','loginName','email','phone'].map(name => ({ [name]: { contains: key } })) }];
      else if (resource === 'stores') where.AND = [...(where.AND ?? []), { OR: ['name','shortName'].map(name => ({ [name]: { contains: key } })) }];
      else if (!['settings','withdrawals'].includes(resource)) where[field] = { contains: key };
    }
    return where;
  }
  private map(resource: string, row: any): any {
    const item = JSON.parse(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
    if (resource === 'stores') {
      const profile = row.studioProfile && typeof row.studioProfile === 'object' ? row.studioProfile : {};
      const display = publicShopProfile(row, row.shopImages, { includeHiddenPriceMenu: true });
      return { id: item.id, ownerId: item.ownerId, shortName: row.shortName ?? '', name: row.name, subtitle: display.subtitle,
        phones: display.phones, emails: display.emails, sysAccount: row.loginBinding?.user?.loginName ?? row.loginBinding?.user?.email ?? '', loginAccount: row.loginBinding?.user ? { id:String(row.loginBinding.user.id), loginName:row.loginBinding.user.loginName, email:row.loginBinding.user.email, name:row.loginBinding.user.name, status:row.loginBinding.user.status } : null, loginBinding: row.loginBinding ? { userId:String(row.loginBinding.userId), shopId:String(row.id) } : null, accountBindingStatus:row.loginBinding ? 'BOUND' : 'UNBOUND', timezone: row.timezone ?? '',
        businessHours: v.displayHours(row.businessHours), dataStatus: row.status === 'APPROVED' ? '正常' : row.status === 'SUSPENDED' ? '关闭' : '',
        businessStatus: '', status: row.status, reviewComment: row.reviewComment, reviewedAt: row.reviewedAt, address: row.address, city: row.city, state: row.state, zipCode: row.zipCode, latitude: Number(row.latitude), longitude: Number(row.longitude),
        about: display.about, priceMenu: display.priceMenu, priceMenuRevision: priceMenuRevision(row.id, row.studioProfile, row.shopServices ?? []), createdDate: row.createdAt.toISOString().slice(0,10), logo: display.logo, logoUrl: display.media.logoUrl ?? '', bannerUrl: display.media.coverUrl ?? '', gallery: display.media.galleryUrls, tags: display.tags,
        videoUrl: display.videoUrl ?? '', mapShareUrl: display.mapShareUrl ?? '', links: display.links, brandColor: display.brandColor, buttonShape: display.buttonShape, media: display.media, thumbnail: display.thumbnail,
        features: { onlinePayment: false, membershipCard: false, ...shopFeatures(profile) }, paymentPolicy: shopPaymentPolicy(profile), ...canonicalShopLink(row.shortName), ...shopEligibility(row), ...shopPublication(row) };
    }
    if (resource === 'applications') return { id: item.id, ownerId: item.ownerId, name: row.name, status: row.status, reviewComment: row.reviewComment, createdAt: row.createdAt, reviewedAt: row.reviewedAt, ...shopPublication(row) };
    if (resource === 'regions') return { ...item, stateId: item.parentId, updatedTime: row.updatedAt.toISOString() };
    if (resource === 'coupons') return { id: item.id, type: row.shopId ? 'merchant' : 'general', name: row.title, amount: row.value / 100, threshold: row.minSpendCents / 100,
      description: row.description ?? '', startDate: row.validFrom.toISOString().slice(0,10), endDate: row.validUntil?.toISOString().slice(0,10) ?? '', status: row.status === 'ACTIVE' ? '正常' : '关闭',
      updateDate: row.updatedAt.toISOString(), merchantShortLink: row.shop?.shortName ?? '', merchantName: row.shop?.name ?? '', claimedCount: row.claimedCount, totalQuantity: row.totalQuantity, perUserLimit: 1, configuredPerUserLimit: row.perUserLimit };
    if (resource === 'services') { const { _count, variants, ...visible } = item, display = serviceDisplaySource(row); return { ...visible, durationMin: display.durationMin, hasVariants: hasServiceVariants(row), durationMinutes: display.durationMin, ...serviceDurationMeta(display) }; }
    if (resource === 'technicians') return { ...item, status: row.isActive ? 'ACTIVE' : 'INACTIVE', serviceAccessMode: 'SHOP_ALL' as const, serviceIds: row.therapistServices.map((r: any) => r.serviceId.toString()) };
    if (resource === 'content') return { ...item, body: row.content, isPublished: row.isActive, publicationState: publicationState(row) };
    if (resource === 'banners') return { ...item, publicationState: publicationState(row) };
    if (resource === 'settings') return { id: row.id, key: row.key, label: row.description ?? row.key, value: row.value };
    if (resource === 'gift-card-orders') {
      const { shop, providerPaymentId, requestKey, requestHash, ...visible } = item;
      return { ...visible, productName: row.productTitleSnapshot ?? row.product?.title, timezone: giftTimezone(row.shop?.timezone) };
    }
    if (resource === 'withdrawals') return { ...item, shopId: row.profile?.shopId.toString(), amountCents: Math.abs(row.amount) };
    if (['service-orders','after-sales'].includes(resource)) {
      // Historical order times must use their stored booking snapshot, never a shop's later timezone.
      const local = bookingLocalFields(row);
      const service = historicalBookingService(row, item.service);
      const contact = bookingContactView(row);
      const { contactName, contactPhone, contactEmail, contactVersion, contactSource, contactEmailVerifiedAt, ...safe } = item;
      return { ...safe, contact, contactLabel: contact.recorded ? '下单时记录' : '历史订单未记录当次联系人（如有姓名，为当前账号资料）', ...(resource === 'service-orders' ? bookingAddOnsView(row) : {}), ...bookingDurationMeta(row),
        ...(service ? { service } : {}),
        items: (item.items ?? []).map((entry: any, index: number) => ({ ...entry, ...itemDurationMeta(row.items[index]) })), ...local, shopTimezone: local.timezone, orderNo: row.bookingNo, store: row.shop?.name, storeName: row.shop?.name, serviceName: service?.name, customerName: contact.recorded ? contact.name : row.user?.name, amountCents: row.totalCents, paidCents: row.paidCents, refundedCents: row.refundedCents };
    }
    return item;
  }
  async list(resource: string, query: Record<string, string>, actor: Actor) {
    const c = this.config(resource);
    const page = pageNumber(query.page, 1, 100000);
    const pageSize = pageNumber(query.pageSize, 25, 100);
    const where = this.where(resource, actor, query); const model = (this.prisma as any)[c.model];
    const [rows, total] = await Promise.all([model.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' }, ...(c.include ? { include: c.include } : {}), ...(c.select ? { select: c.select } : {}) }), model.count({ where })]);
    return { items: rows.map((row: any) => this.map(resource, row)), total, page, pageSize };
  }
  async summary(actor: Actor) {
    const names = { stores: 'stores', regions: 'regions', coupons: 'coupons', users: 'users', serviceOrders: 'service-orders', giftCards: 'gift-cards' };
    const counts = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, resource]) => [key, await (this.prisma as any)[this.config(resource).model].count({ where: this.where(resource, actor) })])));
    const bookingScope = this.where('service-orders', actor);
    const [pendingBookings, confirmedBookings, confirmedPaidBookings, refundingBookings, pendingShops, publishedShops, suspendedShops] = await Promise.all([
      this.prisma.booking.count({ where: { AND: [bookingScope, { status: 'PENDING' }] } }),
      this.prisma.booking.count({ where: { AND: [bookingScope, { status: 'CONFIRMED' }] } }),
      this.prisma.booking.count({ where: { AND: [bookingScope, { status: 'CONFIRMED', paymentStatus: 'PAID' }] } }),
      this.prisma.booking.count({ where: { AND: [bookingScope, { status: 'REFUNDING' }] } }),
      actor.role === 'ADMIN' ? this.prisma.shop.count({ where: this.where('applications', actor) }) : Promise.resolve(null),
      this.prisma.shop.count({ where: { AND: [this.where('stores', actor), { status: 'APPROVED' }] } }),
      this.prisma.shop.count({ where: { AND: [this.where('stores', actor), { status: 'SUSPENDED' }] } }),
    ]);
    return { counts, workQueues: { pendingShops, pendingBookings, confirmedBookings, confirmedPaidBookings, refundingBookings }, storeStatuses: { published: publishedShops, suspended: suspendedShops }, paymentProvider: process.env.PAYMENT_PROVIDER ?? 'disabled', currency: 'USD' };
  }
  private async shop(db: any, shopId: unknown, actor: Actor) {
    return (await requireShopAccess(db, v.id(shopId), actor, 'OWNER_ONLY', {write:true})).shop;
  }
  private async data(db: any, resource: string, body: any, previous: any, actor: Actor): Promise<any> {
    const b = { ...previous, ...body };
    if (resource === 'regions') {
      this.admin(actor); const kind = v.choice(b.kind, ['state','city']); const parentId = kind === 'city' ? v.id(b.parentId ?? b.stateId) : null;
      if (parentId) { const parent = await db.region.findUnique({where:{id:parentId}}); if (parent?.kind !== 'state') throw new BadRequestException('City must belong to an existing state'); }
      if (previous && previous.kind !== kind) throw new BadRequestException('Region kind cannot change');
      return { kind, parentId, abbr: v.text(b.abbr,'abbreviation',10), english: v.text(b.english,'English name',200,true), chinese:v.text(b.chinese,'Chinese name',200,true), status:v.choice(b.status,['启用','禁用'],'启用'),sort:v.integer(b.sort ?? 100,'sort',0,999999),zipCode:v.text(b.zipCode,'ZIP',30) || null };
    }
    if (resource === 'stores') {
      // An existing visible catalog may still lack booking/publication data.
      // Editing only its display menu must not rewrite scalar fields, review
      // state or infer missing timezone/contact details to pass publication.
      if (previous && isPriceMenuOnlyUpdate(body)) {
        let profile: Record<string, any>;
        try { profile = storedStudioProfile(previous.studioProfile); }
        catch { throw new ConflictException('Stored shop profile is malformed; repair it before editing'); }
        const catalog = await loadPriceMenuCatalog(db, previous.id, profile.priceMenu);
        if (!matchesPriceMenuRevision(previous.id, profile, body.expectedPriceMenuRevision, catalog)) throw new ConflictException(PRICE_MENU_CHANGED);
        try { return { studioProfile: { ...profile, priceMenu: await savePriceMenuCatalog(db, previous, body.priceMenu, profile.priceMenu, actor, body.catalogSelectionPreconditions) } }; }
        catch (error) { if (error instanceof PriceMenuValidationError) throw new BadRequestException(error.message); throw error; }
      }
      if (!previous) { this.admin(actor); if (parseCatalogSelectionPreconditions(body.catalogSelectionPreconditions).length) throw new BadRequestException('请先保存门店，再选择本店预约目录'); }
      if (body.sysPassword) throw new BadRequestException('Change account passwords through the account service');
      const ownerId = previous?.ownerId ?? v.id(body.ownerId);
      if (previous && body.ownerId !== undefined && v.id(body.ownerId) !== ownerId) throw new ConflictException('Store ownership cannot be changed through profile editing; its ledger and financial history must remain with the original owner');
      if (!previous) await db.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE`);
      const owner = await db.user.findFirst({where:{id:ownerId,...(!previous ? {role:'MERCHANT',status:'ACTIVE',deletedAt:null} : {})}});
      if (!owner) throw new BadRequestException('A valid merchant owner is required');
      if (!previous && !await merchantRoutedLoginReady(db, owner)) throw new BadRequestException('请先为店主设置有效的商家登录名或邮箱/电话和有效密码，再创建门店');
      if (!previous && await db.shopLoginBinding.findUnique({where:{userId:ownerId}})) throw new ConflictException('该经营账号已绑定门店，请新建独立门店账号');
      const loginBinding = previous ? await db.shopLoginBinding.findUnique({where:{shopId:previous.id},include:{user:{select:{id:true,role:true,status:true,deletedAt:true,loginName:true,email:true,phone:true,passwordHash:true}}}}) : {user:owner,userId:ownerId};
      let profile: Record<string, any>;
      try { profile = storedStudioProfile(previous?.studioProfile); }
      catch { throw new ConflictException('Stored shop profile is malformed; repair it before editing'); }
      let priceMenu;
      if (Object.prototype.hasOwnProperty.call(body, 'priceMenu')) {
        const catalog = previous ? await loadPriceMenuCatalog(db, previous.id, profile.priceMenu) : [];
        if (previous && !matchesPriceMenuRevision(previous.id, profile, body.expectedPriceMenuRevision, catalog)) throw new ConflictException(PRICE_MENU_CHANGED);
        try { priceMenu = previous ? await savePriceMenuCatalog(db, previous, body.priceMenu, profile.priceMenu, actor, body.catalogSelectionPreconditions) : normalizePriceMenu(body.priceMenu); if (!previous && priceMenu.some(group => group.items.some(item => item.booking || item.bookingEnabled))) throw new BadRequestException('请先保存门店，再为价目项目开启预约'); }
        catch (error) { if (error instanceof PriceMenuValidationError) throw new BadRequestException(error.message); throw error; }
      }
      const oldImages = previous ? await db.shopImage.findMany({ where: { shopId: previous.id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }) : [];
      const display = publicShopProfile(previous, oldImages, { includePriceMenu: false });
      const phones = v.strings(body.phones ?? profile.phones ?? (previous?.phone ? [previous.phone] : []),5,20);
      const emails = v.strings(body.emails ?? profile.emails ?? [],5,255);
      if (emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) throw new BadRequestException('Invalid email');
      const city = v.text(b.city,'city',100);
      const state = v.text(b.state,'state',50);
      const zipCode = v.text(b.zipCode,'ZIP',10);
      const submittedTimezone = Object.prototype.hasOwnProperty.call(body, 'timezone') ? v.text(body.timezone,'timezone',100) : undefined;
      const locationChanged = !previous || city !== previous.city || state !== previous.state || zipCode !== previous.zipCode;
      const inferredTimezone = inferStoreTimezone(city, state, zipCode);
      const timezone = submittedTimezone
        ? submittedTimezone
        : locationChanged || !previous?.timezone || submittedTimezone === ''
          ? inferredTimezone
          : previous.timezone;
      if (timezone) { try { new Intl.DateTimeFormat('en',{timeZone:timezone}); } catch { throw new BadRequestException('Invalid IANA timezone'); } }
      let status = previous?.status ?? 'PENDING';
      if (actor.role === 'ADMIN' && body.status !== undefined) status = v.choice(body.status,['PENDING','APPROVED','REJECTED','SUSPENDED']);
      else if (body.dataStatus === '关闭') status = 'SUSPENDED';
      // Reopening a suspended shop requires platform review.
      for (const key of ['latitude','longitude']) if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]))) throw new BadRequestException('Coordinates must be finite numbers');
      const latitude = Number(body.latitude ?? previous?.latitude ?? 0); const longitude = Number(body.longitude ?? previous?.longitude ?? 0);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new BadRequestException('Invalid coordinates');
      const businessHours = body.businessHours ? v.hours(body.businessHours) : previous?.businessHours
        ?? (!previous && !Object.prototype.hasOwnProperty.call(body, 'businessHours')
          ? Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [day, { open: '09:00', close: '22:00', closed: false }]))
          : {});
      if (status === 'APPROVED') {
        requireShopPublication({ ...b, phone: phones[0], timezone, latitude: body.latitude ?? previous?.latitude, longitude: body.longitude ?? previous?.longitude, businessHours });
      }
      // Merge locked server data only: unrelated edits retain provenance and
      // unknown/private server fields; clients cannot submit arbitrary profile JSON.
      const oldFeatures = profile.features && typeof profile.features === 'object' && !Array.isArray(profile.features) ? profile.features : {};
      const extra = { ...profile, subtitle:v.text(body.subtitle ?? profile.subtitle,'subtitle',500),phones,emails,logo:v.text(body.logo ?? profile.logo,'logo',30),logoUrl:validateMediaUrl(body.logoUrl ?? display.media.logoUrl),bannerUrl:validateMediaUrl(body.bannerUrl ?? display.media.coverUrl),gallery:v.strings(body.gallery ?? display.media.galleryUrls,20,500).map(validateMediaUrl),videoUrl:v.url(body.videoUrl ?? profile.videoUrl),mapShareUrl:v.url(body.mapShareUrl ?? profile.mapShareUrl),links:normalizeStudioInput(() => normalizeShopExternalLinks(body.links ?? profile.links)),brandColor:normalizeStudioInput(() => normalizeShopBrandColor(body.brandColor ?? profile.brandColor)),buttonShape:normalizeStudioInput(() => normalizeShopButtonShape(body.buttonShape ?? profile.buttonShape)),tags:v.strings(body.tags ?? profile.tags),features:{ ...oldFeatures, onlineBooking: v.bool(body.features?.onlineBooking ?? oldFeatures.onlineBooking, !!previous), onlinePayment: false, reviews:v.bool(body.features?.reviews ?? oldFeatures.reviews,true), membershipCard:false },
        ...(priceMenu !== undefined ? { priceMenu } : {}) };
      const reviewStatusChanged = actor.role === 'ADMIN' && body.status !== undefined && status !== previous?.status;
      const reviewReasonChanged = actor.role === 'ADMIN' && body.status !== undefined && status === 'REJECTED'
        && body.reviewReason !== undefined
        && v.text(body.reviewReason, 'review reason', 2000, true) !== (previous?.reviewComment ?? '');
      const review = reviewStatusChanged || reviewReasonChanged
        ? { reviewComment: v.text(body.reviewReason, 'review reason', 2000, status === 'REJECTED') || null, reviewedAt: new Date(), reviewedBy: v.id(actor.id) }
        : {};
      return { ownerId,name:v.text(b.name,'store name',200,true),shortName:normalizeShopShortName(b.shortName),timezone:timezone || null,phone:phones[0] ?? '',address:v.text(b.address,'address',500),city,state,zipCode,description:v.text(body.about ?? previous?.description,'description',20000),latitude,longitude,category:previous?.category ?? 'MIXED',status,businessHours,studioProfile:extra,...review };
    }
    if (resource === 'coupons') {
      let shopId: bigint | null = null;
      if (body.type === 'merchant' || (body.type === undefined && previous?.shopId)) {
        if (!body.merchantShortLink && !previous?.shopId) throw new BadRequestException('Merchant short name required');
        const shop = body.merchantShortLink ? await db.shop.findFirst({where:{shortName:v.text(body.merchantShortLink,'short name',100,true),deletedAt:null}}) : await db.shop.findUnique({where:{id:previous.shopId}});
        if (!shop) throw new BadRequestException('Unknown merchant'); await this.shop(db,shop.id,actor); shopId=shop.id;
      } else this.admin(actor);
      // A date-only form round trip must preserve the original instant of issued terms.
      const validFrom = body.startDate === undefined || body.startDate === previous?.validFrom?.toISOString().slice(0,10) ? previous?.validFrom ?? new Date() : v.date(body.startDate,'start date');
      let validUntil = body.endDate === undefined || body.endDate === previous?.validUntil?.toISOString().slice(0,10) ? previous?.validUntil ?? null : body.endDate === '' || body.endDate === null ? null : v.date(body.endDate,'end date');
      if (validUntil && body.endDate && body.endDate !== previous?.validUntil?.toISOString().slice(0,10) && body.endDate.length === 10) validUntil.setUTCHours(23,59,59,999);
      if (validUntil && validUntil <= validFrom) throw new BadRequestException('Coupon end must follow start');
      return {shopId,title:v.text(body.name ?? previous?.title,'coupon name',200,true),description:v.text(b.description,'description',500),type:'FIXED_AMOUNT',value:body.amount === undefined ? previous?.value ?? 0 : v.cents(body.amount),minSpendCents:body.threshold === undefined ? previous?.minSpendCents ?? 0 : v.cents(body.threshold),totalQuantity:v.integer(body.totalQuantity ?? previous?.totalQuantity ?? 0,'quantity',0,2147483647),
        ...(body.perUserLimit !== undefined || !previous ? { perUserLimit:v.integer(body.perUserLimit === undefined ? 1 : body.perUserLimit,'per user limit',1,1) } : {}),
        validFrom,validUntil,status:body.status === undefined ? previous?.status ?? 'DRAFT' : v.choice(body.status,['正常','关闭']) === '正常' ? 'ACTIVE' : 'PAUSED'};
    }
    if (['services','technicians','gift-cards'].includes(resource)) {
      const shop = await this.shop(db,previous?.shopId ?? body.shopId,actor);
      if (body.shopId && v.id(body.shopId) !== shop.id) throw new BadRequestException('Store cannot change');
      if (resource === 'services') {
        if (Object.prototype.hasOwnProperty.call(body, 'reservedDurationMin') || Object.prototype.hasOwnProperty.call(body, 'durationKindSnapshot')) throw new BadRequestException('预约占用别名和历史快照仅供读取');
        if (body.durationMinutes !== undefined && body.durationMin !== undefined && body.durationMinutes !== body.durationMin) throw new BadRequestException('基础时长字段不一致，请重新载入服务');
        const reserved = Object.prototype.hasOwnProperty.call(body, 'durationMinutes') ? body.durationMinutes : Object.prototype.hasOwnProperty.call(body, 'durationMin') ? body.durationMin : previous?.durationMin;
        ensureBaseServiceEdit(previous, { durationMin: reserved, priceCents: b.priceCents });
        const variants = hasServiceVariants(previous);
        return {shopId:shop.id,name:v.text(b.name,'service name',200,true),description:v.text(b.description,'description',10000),category:v.choice(b.category,['MASSAGE','REFLEXOLOGY','CUPPING','SCRAPING','HEAD_THERAPY','OTHER'],'MASSAGE'),durationKind:readDurationKind(body.durationKind === undefined ? previous?.durationKind : body.durationKind),durationMin:variants ? previous.durationMin : v.integer(reserved,'reserved duration',5,240),priceCents:variants ? previous.priceCents : v.integer(b.priceCents,'price cents',1),isActive:v.bool(b.isActive,true),...(!previous ? {priceBasis:'PER_BOOKING'} : {})};
      }
      if (resource === 'technicians') return {shopId:shop.id,name:v.text(b.name,'technician name',100,true),bio:v.text(b.bio,'bio',10000),isActive:body.status === undefined ? previous?.isActive ?? true : v.choice(body.status,['ACTIVE','INACTIVE']) === 'ACTIVE'};
      return {shopId:shop.id,title:v.text(b.title,'title',200,true),description:v.text(b.description,'description',10000),priceCents:v.integer(b.priceCents,'price cents',1),useTimes:v.integer(b.useTimes ?? 1,'uses',1,10000),expireDays:v.integer(b.expireDays ?? 365,'expiry days',1,3650),status:v.choice(b.status,['DRAFT','ACTIVE','PAUSED'],'DRAFT')};
    }
    if (['users','admins','merchants'].includes(resource)) {
      this.admin(actor);
      if (previous) {
        const data: { name?: string; status?: string } = {};
        if (body.name !== undefined) data.name = v.text(body.name, 'name', 100);
        if (body.status !== undefined) {
          const status = v.choice(body.status, ['ACTIVE', 'SUSPENDED']);
          if (previous.id === v.id(actor.id) && status !== 'ACTIVE') throw new BadRequestException('You cannot disable your own account');
          data.status = status;
        }
        return data;
      }
      if (resource === 'merchants') {
        const { password, ...account } = merchantAccountInput(b);
        return {...account,passwordHash:await hash(password,12),role:'MERCHANT',status:'ACTIVE'};
      }
      const email=v.text(b.email,'email',255,true).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Valid email required');
      const role = resource === 'admins' ? 'ADMIN' : 'CUSTOMER';
      const password = requireRolePassword(b.password, role);
      return {email,phone:v.text(b.phone,'phone',20,true),name:v.text(b.name,'name',100,true),passwordHash:await hash(password,12),role,status:'ACTIVE'};
    }
    this.admin(actor);
    if (resource === 'industries') return {name:v.text(b.name,'name',100,true),sortOrder:v.integer(b.sortOrder ?? 0,'sort',0,999999),isActive:v.bool(b.isActive,true)};
    if (resource === 'content') return announcementData({ ...body, content: body.body, isActive: body.isPublished }, previous);
    if (resource === 'banners') {
      const data = bannerData(body, previous);
      if (data.targetType === 'SHOP_DETAIL' && !await db.shop.findFirst({ where: { id: v.id(data.targetValue), deletedAt: null }, select: { id: true } })) throw new BadRequestException('Banner target shop does not exist');
      return data;
    }
    if (resource === 'settings') {
      return { value: publicSettingValue(previous?.key, body.value) };
    }
    throw new BadRequestException('This resource requires its dedicated business workflow');
  }
  async save(resource: string, resourceId: string | undefined, body: Record<string, unknown>, actor: Actor) {
    const c=this.config(resource);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Object body required');
    const menuOnly = resource === 'stores' && isPriceMenuOnlyUpdate(body);
    if (resource === 'stores') {
      parseCatalogSelectionPreconditions(body.catalogSelectionPreconditions);
      if (!Object.prototype.hasOwnProperty.call(body, 'priceMenu') && body.catalogSelectionPreconditions !== undefined) throw new BadRequestException('目录选择版本须与价目一起提交');
    }
    // A discovery read supplies only the immutable parent ID. Never trust it for authorization.
    let configurationShopId: bigint | undefined;
    if (resource === 'stores' && resourceId) {
      const discovery = await this.prisma.shop.findFirst({ where: { ...(menuOnly ? { deletedAt: null } : this.where(resource, actor)), id: v.id(resourceId) }, select: { id: true } });
      if (!discovery) throw new NotFoundException('Resource unavailable');
      configurationShopId = discovery.id;
    }
    if (['services','technicians','gift-cards'].includes(resource)) {
      if (resourceId) {
        const discovery = await (this.prisma as any)[c.model].findFirst({ where: { ...this.where(resource, actor), id: v.id(resourceId) }, select: { shopId: true } });
        if (!discovery) throw new NotFoundException('Resource unavailable');
        configurationShopId = discovery.shopId;
      } else configurationShopId = v.id(body.shopId);
    }
    return withBannerMediaRetry(resource==='banners',()=>this.prisma.$transaction(async tx => {
      if(resource==='banners')await requireBannerAdministrator(tx,actor);
      if (configurationShopId) {
        await tx.$queryRaw`SELECT id FROM shops WHERE id = ${configurationShopId} FOR UPDATE`;
        try { if (menuOnly) await requireShopAccess(tx, configurationShopId, actor, 'CATALOG_MANAGE', { write: true }); else await this.shop(tx, configurationShopId, actor); }
        catch (error) { if (resourceId && error instanceof ForbiddenException) throw new NotFoundException('Resource unavailable'); throw error; }
      }
      const db=tx as any; const model=db[c.model]; const key=resourceId ? resource === 'settings' ? Number(v.id(resourceId)) : v.id(resourceId) : undefined;
      const activeAdministratorIds = resource === 'admins' && typeof key === 'bigint'
        ? await lockAdministratorStatus(tx, key, v.id(actor.id))
        : null;
      if (key && c.model === 'user' && !activeAdministratorIds) await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${key} FOR UPDATE`);
      if (resource === 'coupons' && key) await tx.$queryRaw(Prisma.sql`SELECT id FROM coupons WHERE id = ${key} FOR UPDATE`);
      if (resource === 'content' && key) await tx.$queryRaw(Prisma.sql`SELECT id FROM announcements WHERE id = ${key} FOR UPDATE`);
      if (resource === 'banners' && key) await tx.$queryRaw(Prisma.sql`SELECT id FROM home_banners WHERE id = ${key} FOR UPDATE`);
      const previous=key ? await model.findFirst({where:{...(menuOnly ? { deletedAt: null } : this.where(resource,actor)),id:key},...(resource === 'services' ? { include: { _count: { select: { variants: true } } } } : {})}) : undefined;
      if (key && !previous) throw new NotFoundException('Resource unavailable');
      const data=await this.data(db,resource,body,previous,actor);
      if (previous?.role === 'ADMIN' && previous.status === 'ACTIVE' && data.status === 'SUSPENDED') {
        requireAnotherActiveAdministrator(activeAdministratorIds ?? [], previous.id);
      }
      if (previous && resource === 'gift-cards' && ['priceCents','useTimes','expireDays'].some(field => data[field] !== previous[field])) {
        const used = await db.giftCardEntitlement.count({where:{productId:previous.id}})
          || await db.giftCardOrder.count({where:{productId:previous.id,OR:[{status:'PAID'},{paidCents:{gt:0}}]}});
        if (used) throw new ConflictException('This product has issued entitlements or received payments. Create a new product for different price, uses or expiry terms.');
      }
      if (previous && resource === 'stores') await ensureShopConfiguration(db, previous, data);
      if (previous && resource === 'services') await ensureServiceConfiguration(db, previous, data);
      if (previous && resource === 'technicians') {
        const ids = body.serviceIds === undefined ? undefined : v.strings(body.serviceIds,100,19).map(v.id);
        await ensureTherapistConfiguration(db, previous, data, ids);
      }
      const row=resource === 'coupons'
        ? previous ? await updateCouponInTransaction(tx, BigInt(key!), { ...data, shopId: data.shopId?.toString() ?? null }) : await model.create({data:{...couponData(data),shopId:data.shopId}})
        : previous ? await model.update({where:{id:key},data}) : await model.create({data});
      if(resource==='banners')await syncBannerMedia(tx,{actor,previousUrl:previous?.imageUrl,nextUrl:data.imageUrl});
      if (resource === 'stores') {
        const media = { shopId: row.id, actor, previousUrls: shopMediaUrls(previous?.studioProfile), nextUrls: shopMediaUrls(data.studioProfile) };
        if (menuOnly) await syncShopMedia(tx, { ...media, purpose: 'MENU', previousProfile: previous?.studioProfile, nextProfile: data.studioProfile });
        else await syncShopMedia(tx, media);
        // Reserving occurs in this same transaction; a conflict rolls back the
        // profile update. Renaming never frees an older published/shared link.
        if (data.shortName !== undefined) {
          if (previous?.shortName) {
            const old = canonicalShopLink(previous.shortName);
            if (old.canonicalShortName) await reserveShopAlias(tx, row.id, old.canonicalShortName);
          }
          await reserveShopAlias(tx, row.id, data.shortName);
        }
        if (!previous) {
          await createShopLedger(tx, row, v.id(actor.id));
          await db.shopLoginBinding.create({data:{shopId:row.id,userId:row.ownerId,createdById:v.id(actor.id),reason:'Company created an independent shop account'}});
          await db.therapist.createMany({ data: [1, 2].map(number => ({ shopId: row.id, name: `Therapist ${number}`,
            avatarUrl: null, title: null, bio: null, yearsExp: 0, gender: null, isActive: true, scheduleMode: 'SHOP', sortOrder: number })) });
        }
      }
      if (resource === 'technicians' && body.serviceIds !== undefined) {
        const ids=v.strings(body.serviceIds,100,19).map(v.id);
        const count=await db.shopService.count({where:{id:{in:ids},shopId:row.shopId}});
        if (count !== new Set(ids.map(String)).size) throw new BadRequestException('Technician services must belong to this store');
        await db.therapistService.deleteMany({where:{therapistId:row.id}});
        if (ids.length) await db.therapistService.createMany({data:[...new Set(ids.map(String))].map(serviceId=>({therapistId:row.id,serviceId:BigInt(serviceId)}))});
      }
      if (['users','admins','merchants'].includes(resource) && data.status === 'SUSPENDED') await db.authSession.updateMany({where:{userId:row.id,revokedAt:null},data:{revokedAt:new Date()}});
      await db.auditLog.create({data:{action:previous ? 'STUDIO_UPDATE' : 'STUDIO_CREATE',targetType:resource,targetId:BigInt(row.id),operatorId:v.id(actor.id),detail:{fields:Object.keys(body).filter(k=>!['expectedPriceMenuRevision','catalogSelectionPreconditions'].includes(k)&&!/password|token|secret/i.test(k)),...(resource === 'stores' && data.reviewedAt ? { previousStatus: previous?.status ?? null, newStatus: row.status, reason: data.reviewComment } : {})}}});
      const result=await model.findUnique({where:{id:row.id},...(c.include ? {include:c.include}:{}),...(c.select ? {select:c.select}:{})});
      return {item:this.map(resource,result)};
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })).catch((e: any)=>{ if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A record with that unique value already exists'); throw e; });
  }
  async remove(resource: string, resourceId: string, actor: Actor) {
    const c=this.config(resource); const key=v.id(resourceId);
    if (['users','admins','merchants','settings','service-orders','after-sales','applications','withdrawals','gift-card-orders'].includes(resource)) throw new BadRequestException('Financial and account records cannot be deleted');
    let configurationShopId: bigint | undefined;
    if (resource === 'stores') {
      const discovery = await this.prisma.shop.findFirst({ where: { ...this.where(resource, actor), id: key }, select: { id: true } });
      if (!discovery) throw new NotFoundException('Resource unavailable');
      configurationShopId = discovery.id;
    }
    if (['services','technicians','gift-cards'].includes(resource)) {
      const discovery = await (this.prisma as any)[c.model].findFirst({ where: { ...this.where(resource, actor), id: key }, select: { shopId: true } });
      if (!discovery) throw new NotFoundException('Resource unavailable');
      configurationShopId = discovery.shopId;
    }
    return withBannerMediaRetry(resource==='banners',()=>this.prisma.$transaction(async tx=>{
      if(resource==='banners')await requireBannerAdministrator(tx,actor);
      if (configurationShopId) {
        await tx.$queryRaw`SELECT id FROM shops WHERE id = ${configurationShopId} FOR UPDATE`;
        try { await this.shop(tx, configurationShopId, actor); }
        catch (error) { if (error instanceof ForbiddenException) throw new NotFoundException('Resource unavailable'); throw error; }
      }
      const db=tx as any; const model=db[c.model]; const previous=await model.findFirst({where:{...this.where(resource,actor),id:key}});
      if (!previous) throw new NotFoundException('Resource unavailable');
      if (resource === 'services') await ensureServiceConfiguration(db, previous, { isActive: false });
      if (resource === 'technicians') await ensureTherapistConfiguration(db, previous, { isActive: false });
      if (resource === 'regions') { this.admin(actor); if (await db.region.count({where:{parentId:key}})) throw new ConflictException('Remove or reassign child cities first'); await model.delete({where:{id:key}}); }
      else if (resource === 'stores') { this.admin(actor); await model.update({where:{id:key},data:{status:'SUSPENDED'}}); }
      else if (resource === 'coupons') await model.update({where:{id:key},data:{status:'PAUSED'}});
      else if (resource === 'gift-cards') await model.update({where:{id:key},data:{status:'PAUSED'}});
      else if (['services','technicians','industries','content','banners'].includes(resource)) { if (['industries','content','banners'].includes(resource)) this.admin(actor); await model.update({where:{id:key},data:{isActive:false}}); }
      else throw new BadRequestException('Deletion unavailable');
      await db.auditLog.create({data:{action:'STUDIO_DISABLE',targetType:resource,targetId:key,operatorId:v.id(actor.id)}});
      return {success:true};
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));
  }
}
