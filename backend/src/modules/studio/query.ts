import { BadRequestException } from '@nestjs/common';
import * as v from './validation';

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
