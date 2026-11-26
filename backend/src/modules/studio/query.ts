import { BadRequestException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalShopLink, findLegacyShopAlias } from '../../common/shop-alias';
import * as v from './validation';

const LEGACY_CUSTOMER_ORIGIN = 'https://app.asianmassagebook.com';
const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const URL_WITH_HOST = /^(?:(?:[a-z0-9-]+\.)+[a-z0-9-]+|localhost)(?::\d+)?\//i;
const NON_CUSTOMER_PATH = /^\/(?:admin|merchant|api|service-gallery)(?:\/|$)/;

function storeSearchOrigins(): Set<string> {
  const origins = new Set([LEGACY_CUSTOMER_ORIGIN]);
  if (process.env.NODE_ENV !== 'production') origins.add('http://127.0.0.1:3004');
  for (const entry of (process.env.CORS_ORIGINS || '').split(',')) {
    const url = URL.parse(entry.trim());
    if (url && ['http:', 'https:'].includes(url.protocol)) origins.add(url.origin);
  }
  return origins;
}

export async function studioStoreSearch(key: string, db: Pick<PrismaClient, 'shopAlias'>): Promise<Prisma.ShopWhereInput> {
  const alias = { kind: 'SHORT_NAME', source: 'massajoy', isActive: true };
  if (/^store-\d+$/.test(key)) key = '/' + key;
  const hasScheme = URL_WITH_SCHEME.test(key);
  const hasBareHost = URL_WITH_HOST.test(key);
  if (key.startsWith('/') || hasScheme || hasBareHost) {
    const noMatch = { id: { in: [] } };
    if (key.startsWith('//') || key.includes('\\')) return noMatch;

    let url = hasBareHost ? URL.parse('https://' + key) : URL.parse(key, 'http://localhost');
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return noMatch;
    if (hasScheme || hasBareHost) {
      const origins = storeSearchOrigins();
      if (hasBareHost && !origins.has(url.origin)) {
        const httpUrl = URL.parse('http://' + key);
        if (httpUrl && origins.has(httpUrl.origin)) url = httpUrl;
      }
      if (!origins.has(url.origin)) {
        throw new BadRequestException('请粘贴 Massajoy 门店网址，或输入门店名称或短链。');
      }
    }

    if (NON_CUSTOMER_PATH.test(url.pathname)) return noMatch;
    if (url.hash.startsWith('#/')) {
      if (url.hash.startsWith('#//')) return noMatch;
      const route = URL.parse(url.hash.slice(1), url.origin);
      if (!route) return noMatch;
      url = route;
    }
    if (NON_CUSTOMER_PATH.test(url.pathname)) return noMatch;

    let segments: string[];
    try {
      segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return noMatch;
    }

    const legacyPath = segments.length === 1 && segments[0].startsWith('store-');
    const legacyDetail = /^(?:store|shop)details(?:\.html)?$/i.test(segments[segments.length - 1]);
    const currentPath = segments.length === 2 && segments[0] === 'shops';
    if (legacyPath || legacyDetail || currentPath) {
      const detailIds = legacyDetail ? url.searchParams.getAll('id') : [];
      const rawId = currentPath ? segments[1] : legacyPath ? segments[0].slice(6) : detailIds.length === 1 ? detailIds[0] : '';
      let id: bigint;
      try { id = v.id(rawId); } catch { return noMatch; }
      if (currentPath) return { id };
      const legacy = await findLegacyShopAlias(db, id.toString());
      return legacy?.isActive ? { id: legacy.shopId } : noMatch;
    }

    const candidate = segments.length === 1 || (segments.length === 2 && segments[0] === 's') ? segments[segments.length - 1] : undefined;
    const shortName = canonicalShopLink(candidate).canonicalShortName;
    if (!shortName) return noMatch;
    return { aliases: { some: { ...alias, value: shortName } } };
  }

  const matches: Prisma.ShopWhereInput[] = [{ name: { contains: key } }, { shortName: { contains: key } }];
  if (/^[a-z0-9-]+$/i.test(key)) matches.push({ aliases: { some: { ...alias, value: { contains: key.toLowerCase() } } } });
  return { OR: matches };
}

export function pageNumber(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new BadRequestException('Invalid pagination');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max) throw new BadRequestException('Invalid pagination');
  return result;
}

const STATUS: Record<string, string[]> = {
  stores: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'],
  applications: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL'],
  users: ['ACTIVE', 'SUSPENDED'], admins: ['ACTIVE', 'SUSPENDED'], merchants: ['ACTIVE', 'SUSPENDED'],
  'service-orders': ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'],
  'after-sales': ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'],
  technicians: ['ACTIVE', 'INACTIVE'], 'gift-cards': ['DRAFT', 'ACTIVE', 'PAUSED'],
  'gift-card-orders': ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'],
};

/** Adds only validated filters; authorization predicates stay in the caller. */
export function studioFilters(resource: string, query: Record<string, string>) {
  const where: any = {};
  if (query.status !== undefined && query.status !== '') {
    const status = v.choice(query.status, STATUS[resource] ?? []);
    if (resource === 'technicians') where.isActive = status === 'ACTIVE';
    else if (status !== 'ALL') where.status = status;
  } else if (resource === 'applications') where.status = 'PENDING';
  if (query.isActive !== undefined && query.isActive !== '') {
    if (!['services', 'industries', 'content', 'banners'].includes(resource)) throw new BadRequestException('Active filter unavailable');
    where.isActive = v.choice(query.isActive, ['true', 'false']) === 'true';
  }
  if (query.paymentStatus !== undefined && query.paymentStatus !== '') {
    if (!['service-orders', 'after-sales'].includes(resource)) throw new BadRequestException('Payment filter unavailable');
    where.paymentStatus = v.choice(query.paymentStatus, ['UNPAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED']);
  }
  if (query.startDate || query.endDate) {
    if (!['service-orders', 'after-sales'].includes(resource)) throw new BadRequestException('Booking date filter unavailable');
    const date = (value: unknown) => {
      if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Use YYYY-MM-DD booking dates');
      return v.date(value, 'booking date');
    };
    const start = query.startDate ? date(query.startDate) : undefined;
    const end = query.endDate ? date(query.endDate) : undefined;
    if (start && end && start > end) throw new BadRequestException('Start date must not follow end date');
    where.bookingDate = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  }
  if (query.scope !== undefined && query.scope !== '') {
    if (resource !== 'coupons') throw new BadRequestException('Coupon scope unavailable');
    where.shopId = v.choice(query.scope, ['general', 'merchant']) === 'general' ? null : { not: null };
  }
  return where;
}
