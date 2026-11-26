import { BadRequestException } from '@nestjs/common';
import { id, object } from './reservation-validation';

export type CalendarResourceType = 'THERAPIST' | 'ROOM';
export interface BookingCalendarQuery {
  startDate: string; endDate: string; pageSize: number; cursor?: string;
  status?: string; resourceType?: CalendarResourceType; resourceId?: string;
}
export const CALENDAR_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'];
export function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:19|[2-9]\d)\d{2}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('日历日期必须为有效的 YYYY-MM-DD');
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new BadRequestException('日历日期无效');
  return value;
}
export function addCalendarDays(value: string, days: number): string {
  const time = new Date(`${calendarDate(value)}T00:00:00Z`); time.setUTCDate(time.getUTCDate() + days);
  return time.toISOString().slice(0, 10);
}
export function parseBookingCalendarQuery(raw: unknown): BookingCalendarQuery {
  const input = object(raw, ['startDate', 'endDate', 'pageSize', 'cursor', 'status', 'resourceType', 'resourceId']);
  const startDate = calendarDate(input.startDate), endDate = calendarDate(input.endDate);
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000;
  if (days <= 0 || days > 42) throw new BadRequestException('日历范围必须为1至42个门店当地日期，结束日期不包含在内');
  const pageSize = input.pageSize === undefined ? 100 : typeof input.pageSize === 'string' && /^(?:[1-9]|[1-9]\d|100)$/.test(input.pageSize) ? Number(input.pageSize) : NaN;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('日历每页必须为1至100条');
  if (input.status !== undefined && (typeof input.status !== 'string' || !CALENDAR_STATUSES.includes(input.status))) throw new BadRequestException('日历订单状态无效');
  if (input.resourceType !== undefined && input.resourceType !== 'THERAPIST' && input.resourceType !== 'ROOM') throw new BadRequestException('日历资源类型无效');
  if ((input.resourceType === undefined) !== (input.resourceId === undefined)) throw new BadRequestException('请同时指定资源类型和资源ID');
  if (input.resourceId !== undefined) id(input.resourceId, 'resourceId');
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 320 || !/^[A-Za-z0-9_-]+$/.test(input.cursor))) throw new BadRequestException('日历分页游标无效');
  return { startDate, endDate, pageSize, ...(input.status ? { status: input.status as string } : {}),
    ...(input.resourceType ? { resourceType: input.resourceType as CalendarResourceType, resourceId: input.resourceId as string } : {}),
    ...(input.cursor ? { cursor: input.cursor as string } : {}) };
}
