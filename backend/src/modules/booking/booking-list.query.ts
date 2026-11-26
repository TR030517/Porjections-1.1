import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { shopAccessId } from '../../common/shop-access';

export const BOOKING_LIST_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'] as const;
export const BOOKING_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export const BOOKING_PAYMENT_MODES = ['ONLINE', 'PAY_AT_STORE', 'ZERO'] as const;
export const BOOKING_LIST_VIEWS = ['ALL', 'HISTORY'] as const;
export const BOOKING_HISTORY_STATUSES = ['COMPLETED', 'CANCELLED', 'REFUNDED'] as const;

export interface BookingListQuery {
  page?: string; pageSize?: string; status?: string; paymentStatus?: string;
  paymentMode?: string; search?: string; startDate?: string; endDate?: string; view?: string; shopId?: string;
}
export interface ParsedBookingListQuery {
  paged: boolean; page: number; pageSize: number; status?: string; paymentStatus?: string;
  paymentMode?: string; search?: string; startDate?: Date; endDate?: Date; view?: string; shopId?: bigint;
}
const keys = ['page', 'pageSize', 'status', 'paymentStatus', 'paymentMode', 'search', 'startDate', 'endDate', 'view', 'shopId'];

function positive(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new BadRequestException('Invalid booking pagination');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw new BadRequestException('Invalid booking pagination');
  return number;
}
function choice(value: unknown, allowed: readonly string[], name: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value)) throw new BadRequestException(`Invalid ${name}`);
  return value;
}
function date(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Use YYYY-MM-DD booking dates');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(+result) || result.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid booking date');
  return result;
}

/** Explicit pagination opts into a page envelope; existing array clients remain compatible. */
export function parseBookingListQuery(query: BookingListQuery = {}): ParsedBookingListQuery {
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !keys.includes(key))) throw new BadRequestException('Invalid booking filters');
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 100 || /[\x00-\x1f]/.test(query.search))) throw new BadRequestException('Search must contain at most 100 characters');
  const startDate = date(query.startDate), endDate = date(query.endDate);
  if (startDate && endDate && startDate > endDate) throw new BadRequestException('Start date must not follow end date');
  return {
    paged: query.page !== undefined || query.pageSize !== undefined,
    page: positive(query.page, 1, 1000000), pageSize: positive(query.pageSize, 25, 100),
    status: choice(query.status, BOOKING_LIST_STATUSES, 'booking status'),
    paymentStatus: choice(query.paymentStatus, BOOKING_PAYMENT_STATUSES, 'payment status'),
    paymentMode: choice(query.paymentMode, BOOKING_PAYMENT_MODES, 'payment mode'),
    view: choice(query.view, BOOKING_LIST_VIEWS, 'booking view'),
    shopId: query.shopId === undefined ? undefined : shopAccessId(query.shopId),
    search: query.search?.trim() || undefined, startDate, endDate,
  };
}

/** Scope is a separate AND clause so search/date filters cannot replace authorization. */
export function bookingListWhere(query: ParsedBookingListQuery, scope: Prisma.BookingWhereInput, audience: 'customer' | 'merchant'): Prisma.BookingWhereInput {
  const filters: Prisma.BookingWhereInput[] = [scope, { deletedAt: null }];
  if (audience === 'customer') filters.push({ customerHiddenAt: null });
  if (query.shopId !== undefined) filters.push({ shopId: query.shopId });
  if (query.view === 'HISTORY') filters.push({ status: { in: [...BOOKING_HISTORY_STATUSES] } });
  if (query.status) filters.push({ status: query.status as Prisma.EnumBookingStatusFilter['equals'] });
  if (query.paymentStatus) filters.push({ paymentStatus: query.paymentStatus as Prisma.EnumPaymentStatusFilter['equals'] });
  if (query.paymentMode) filters.push({ paymentMode: query.paymentMode });
  if (query.startDate || query.endDate) filters.push({ bookingDate: { ...(query.startDate ? { gte: query.startDate } : {}), ...(query.endDate ? { lte: query.endDate } : {}) } });
  if (query.search) filters.push({ OR: [
    { bookingNo: { contains: query.search } }, { service: { name: { contains: query.search } } },
    { items: { some: { OR: [{ serviceNameSnapshot: { contains: query.search } }, { variantNameSnapshot: { contains: query.search } }] } } },
    ...(audience === 'merchant'
      ? [{ user: { name: { contains: query.search } } }, { contactName: { contains: query.search } }, { contactPhone: { contains: query.search } }]
      : [{ shop: { name: { contains: query.search } } }]),
  ] });
  return { AND: filters };
}

export const BOOKING_LIST_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.BookingOrderByWithRelationInput[];
export function bookingListResult<T>(items: T[], total: number, query: ParsedBookingListQuery) {
  return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) };
}
