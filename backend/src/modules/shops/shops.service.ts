import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ShopCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { shopFeatures } from '../../common/shop-features';
import { publicShopIds, publicShopWhere, PUBLIC_SHOP_SQL } from '../../common/shop-eligibility';
import { publicShopProfile, publicServiceView, safePublicMediaUrl } from '../../common/shop-public-profile';
import { canonicalShopLink, normalizeShopShortName } from '../../common/shop-alias';
import { numericId } from '../payment/money';
import { shopPaymentPolicy } from '../../common/shop-payment-policy';
import { hasPublicReservationOptions, publicReservationSource } from '../../common/service-reservation-options';
import { PRICE_MENU_CATALOG_INCLUDE } from '../../common/shop-price-menu-catalog';
import { SHOP_SERVICE_ACCESS_MODE } from '../../common/shop-staff-policy';
import { recurringScheduleCheck } from '../booking/work-schedule';

// Internal input to the explicit serializer, never returned as an object spread.
const SHOP_COLUMNS = 's.id,s.name,s.name_en,s.description,s.phone,s.address,s.city,s.state,s.zip_code,s.latitude,s.longitude,s.category,s.shop_type,s.avg_rating,s.review_count,s.booking_count,s.short_name,s.timezone,s.studio_profile';
const OWNER = { select: { role: true, status: true, deletedAt: true } };
const SERVICE_INCLUDE = { variants: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] }, addOns: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] }, _count: { select: { variants: true } } };

function listing(shop: any, images: readonly any[] = []) {
  return { id: String(shop.id), name: shop.name, nameEn: shop.name_en ?? null, description: shop.description,
    phone: shop.phone, address: shop.address, city: shop.city, state: shop.state, zipCode: shop.zip_code,
    latitude: Number(shop.latitude), longitude: Number(shop.longitude), category: shop.category, shopType: shop.shop_type,
    timezone: shop.timezone ?? null, avgRating: Number(shop.avg_rating), reviewCount: shop.review_count, bookingCount: shop.booking_count,
    distanceKm: shop.distance_km == null ? null : Number(shop.distance_km), features: shopFeatures(shop.studio_profile),
    paymentPolicy: shopPaymentPolicy(shop.studio_profile), ...canonicalShopLink(shop.short_name), ...publicShopProfile(shop, images, { includePriceMenu: false }) };
}

function publicHours(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  const time = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '';
  for (const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) {
    const raw = (value as any)[day];
    const map = (period: any) => period?.closed === true ? { closed: true } : { open: time(period?.open), close: time(period?.close), closed: false };
    if (raw && typeof raw === 'object') out[day] = Array.isArray(raw) ? raw.slice(0, 8).map(map) : map(raw);
  }
  return out;
}

@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService) {}

  async listShops(params: { lat?: number; lng?: number; radius?: number; category?: ShopCategory; keyword?: string; city?: string; page?: number; limit?: number }) {
    const { lat, lng, radius = 50, category, keyword, city, page = 1, limit = 20 } = params;
    if (!Number.isInteger(page) || !Number.isInteger(limit) || page < 1 || page > 100000 || limit < 1 || limit > 100 || !Number.isFinite(radius) || radius <= 0 || radius > 200) throw new BadRequestException('Invalid pagination or radius');
    if ((lat === undefined) !== (lng === undefined) || (lat !== undefined && (Math.abs(lat) > 90 || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lng!) > 180))) throw new BadRequestException('Invalid coordinates');
    const conditions = [PUBLIC_SHOP_SQL]; const bindings: any[] = [];
    if (category) { conditions.push('s.category = ?'); bindings.push(category); }
    if (keyword) { conditions.push('(s.name LIKE ? OR s.name_en LIKE ? OR s.address LIKE ? OR s.city LIKE ?)'); bindings.push(...Array(4).fill(`%${keyword}%`)); }
    if (city) { conditions.push('s.city = ?'); bindings.push(city); }
    const distance = `6371 * 2 * ASIN(SQRT(POWER(SIN((? - s.latitude) * PI() / 360), 2) + COS(? * PI() / 180) * COS(s.latitude * PI() / 180) * POWER(SIN((? - s.longitude) * PI() / 360), 2)))`;
    if (lat !== undefined) { conditions.push(`(${distance}) <= ?`); bindings.push(lat, lat, lng, radius); }
    const where = conditions.join(' AND ');
    const count = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>('SELECT COUNT(*) AS total FROM shops s WHERE ' + where, ...bindings);
    const total = Number(count[0]?.total ?? 0);
    const rows = await this.prisma.$queryRawUnsafe<any[]>('SELECT ' + SHOP_COLUMNS + (lat === undefined ? '' : `,ROUND(${distance},2) AS distance_km`) + ' FROM shops s WHERE ' + where
      + ' ORDER BY ' + (lat === undefined ? 's.created_at DESC,s.id DESC' : 'distance_km ASC,s.id ASC') + ' LIMIT ? OFFSET ?',
    ...(lat === undefined ? [] : [lat,lat,lng]), ...bindings, limit, (page - 1) * limit);
    const images = rows.length ? await this.prisma.shopImage.findMany({ where: { shopId: { in: rows.map(row => BigInt(row.id)) } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }) : [];
    return { items: rows.map(row => listing(row, images.filter(image => String(image.shopId) === String(row.id)))), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findNearby(params: { lat: number; lng: number; radius?: number; limit?: number }) {
    const result = await this.listShops({ ...params, radius: params.radius ?? 25, page: 1 });
    return { items: result.items, total: result.items.length };
  }

  async resolve(input: { shortName?: string; legacyId?: string }) {
    if ((input.shortName === undefined) === (input.legacyId === undefined)) throw new BadRequestException('Provide exactly one shop shortName or legacyId');
    const kind = input.shortName === undefined ? 'LEGACY_ID' : 'SHORT_NAME';
    const source = kind === 'LEGACY_ID' ? 'massajoy1' : 'massajoy';
    const value = kind === 'SHORT_NAME' ? normalizeShopShortName(input.shortName) : numericId(input.legacyId!).toString();
    let alias = await (this.prisma as any).shopAlias.findUnique({ where: { kind_source_value: { kind, source, value } }, select: { shopId: true, isActive: true } });
    // The first 1.0 importer used a different alias namespace. Accept its
    // explicit mapping until all local migration datasets have been backfilled.
    // A revoked canonical alias remains revoked; never fall through past it.
    if (!alias && kind === 'LEGACY_ID') alias = await (this.prisma as any).shopAlias.findUnique({
      where: { kind_source_value: { kind: 'LEGACY_STORE_ID', source: 'Massajoy1.0', value } }, select: { shopId: true, isActive: true },
    });
    // Only an explicit alias can resolve a legacy numeric ID. No ID fallback.
    if (!alias?.isActive) throw new NotFoundException('Shop unavailable');
    return this.getShop(String(alias.shopId));
  }

  async getShop(id: string) {
    const sid = numericId(id);
    const shop = await this.prisma.shop.findFirst({ where: { id: sid, ...publicShopWhere() }, include: { shopServices: { include: PRICE_MENU_CATALOG_INCLUDE }, owner: OWNER, shopImages: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      certificates: { where: { isVerified: true, OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] }, select: { id: true, certificateType: true, isVerified: true } } } });
    if (!shop || !(await publicShopIds(this.prisma, [sid])).length) throw new NotFoundException('Shop unavailable');
    const [services, therapists, schedules] = await Promise.all([
      this.getShopServices(id),
      this.getShopTherapists(id),
      this.prisma.therapist.findMany({ where: { shopId: sid, isActive: true }, select: {
        scheduleMode: true,
        shifts: { where: { isActive: true }, select: { weekday: true, startMin: true, endMin: true, isActive: true } },
      } }),
    ]);
    const hasConfiguredBookingSchedule = schedules.some(recurringScheduleCheck(shop.businessHours));
    return { id: String(shop.id), name: shop.name, nameEn: shop.nameEn, description: shop.description,
      phone: shop.phone, address: shop.address, city: shop.city, state: shop.state, zipCode: shop.zipCode,
      latitude: Number(shop.latitude), longitude: Number(shop.longitude), category: shop.category, status: shop.status, shopType: shop.shopType,
      businessHours: publicHours(shop.businessHours), timezone: shop.timezone, features: shopFeatures(shop.studioProfile), paymentPolicy: shopPaymentPolicy(shop.studioProfile),
      avgRating: Number(shop.avgRating), reviewCount: shop.reviewCount, bookingCount: shop.bookingCount, createdAt: shop.createdAt,
      ...canonicalShopLink(shop.shortName),
      ...publicShopProfile(shop, shop.shopImages, { activeStaffCount: therapists.length, hasConfiguredBookingSchedule }),
      hasConfiguredBookingSchedule, services, therapists,
      certificates: shop.certificates.map(certificate => ({ id: String(certificate.id), certificateType: certificate.certificateType, isVerified: certificate.isVerified })) };
  }

  async getAvailableSlots(_shopId: string, _date: string): Promise<never> { throw new BadRequestException('Use /bookings/slots with shopId, serviceId and date'); }

  async getShopServices(shopId: string) {
    const sid = numericId(shopId);
    if (!(await publicShopIds(this.prisma, [sid])).length) throw new NotFoundException('Shop unavailable');
    const [services, activeStaffCount] = await Promise.all([
      this.prisma.shopService.findMany({ where: { shopId: sid, isActive: true }, include: SERVICE_INCLUDE, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.therapist.count({ where: { shopId: sid, isActive: true } }),
    ]);
    return services.filter(service => hasPublicReservationOptions(service) && (service.requiredStaffCount ?? 1) <= activeStaffCount).map(service => publicServiceView(publicReservationSource(service)));
  }

  async getShopTherapists(shopId: string) {
    const sid = numericId(shopId);
    if (!(await publicShopIds(this.prisma, [sid])).length) throw new NotFoundException('Shop unavailable');
    const [therapists, services] = await Promise.all([
      this.prisma.therapist.findMany({ where: { shopId: sid, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.shopService.findMany({ where: { shopId: sid, isActive: true }, include: SERVICE_INCLUDE, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);
    const catalog = services.filter(service => hasPublicReservationOptions(service) && (service.requiredStaffCount ?? 1) <= therapists.length).map(service => ({ ...publicServiceView(publicReservationSource(service)), serviceId: String(service.id) }));
    return therapists.map(therapist => ({ id: String(therapist.id), name: therapist.name, avatarUrl: safePublicMediaUrl(therapist.avatarUrl), title: therapist.title, bio: therapist.bio, yearsExp: therapist.yearsExp, gender: therapist.gender,
      serviceAccessMode: SHOP_SERVICE_ACCESS_MODE, services: catalog }));
  }
}
