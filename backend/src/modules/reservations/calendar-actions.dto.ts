import { BadRequestException } from '@nestjs/common';
import { Allow } from 'class-validator';
import { createHash } from 'crypto';
import { calendarDate } from './booking-calendar.dto';
import { id, object } from './reservation-validation';

export type CalendarAction = 'CREATE' | 'UPDATE' | 'RELEASE' | 'CLOSE_DAY' | 'REOPEN_DAY';
export type CalendarBlockScope = 'SHOP' | 'THERAPIST' | 'ROOM';
export type CalendarBlockPurpose = 'INTERNAL_OCCUPANCY' | 'TIME_BLOCK';
export class CalendarActionDto {
  @Allow() requestKey?: unknown;
  @Allow() action?: unknown;
  @Allow() expectedTimezone?: unknown;
  @Allow() blockId?: unknown;
  @Allow() expectedVersion?: unknown;
  @Allow() purpose?: unknown;
  @Allow() scope?: unknown;
  @Allow() resourceId?: unknown;
  @Allow() startLocal?: unknown;
  @Allow() endLocal?: unknown;
  @Allow() reason?: unknown;
  @Allow() date?: unknown;
  @Allow() expectedSettingsHash?: unknown;
}
export interface ParsedCalendarAction {
  requestKey: string; requestHash: string; action: CalendarAction; expectedTimezone: string;
  blockId?: string; expectedVersion?: number; purpose?: CalendarBlockPurpose; scope?: CalendarBlockScope;
  resourceId?: string; startLocal?: string; endLocal?: string; reason?: string; date?: string; expectedSettingsHash?: string;
}
export interface CalendarActionResult {
  shopId: string; requestKey: string; action: CalendarAction; outcome: 'COMMITTED';
  result: { blockId: string | null; version: number | null; closedDate: string | null };
}
export function calendarActionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new BadRequestException('操作编号必须为 UUID');
  return value.toLowerCase();
}
function local(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new BadRequestException('请输入门店当地日期和时间（YYYY-MM-DDTHH:mm）');
  calendarDate(value.slice(0, 10)); return value;
}
export function parseCalendarAction(raw: unknown): ParsedCalendarAction {
  const body = object(raw, ['requestKey', 'action', 'expectedTimezone', 'blockId', 'expectedVersion', 'purpose', 'scope', 'resourceId', 'startLocal', 'endLocal', 'reason', 'date', 'expectedSettingsHash']);
  if (!['CREATE', 'UPDATE', 'RELEASE', 'CLOSE_DAY', 'REOPEN_DAY'].includes(body.action as string)) throw new BadRequestException('未知日历操作');
  const action = body.action as CalendarAction;
  const dateAction = action === 'CLOSE_DAY' || action === 'REOPEN_DAY';
  const allowed = ['requestKey', 'action', 'expectedTimezone', ...(dateAction ? ['date', 'expectedSettingsHash'] : action === 'RELEASE' ? ['blockId', 'expectedVersion'] : ['purpose', 'scope', 'resourceId', 'startLocal', 'endLocal', 'reason', ...(action === 'UPDATE' ? ['blockId', 'expectedVersion'] : [])])];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException('本次操作包含不允许的字段');
  if (typeof body.expectedTimezone !== 'string' || !body.expectedTimezone || body.expectedTimezone.length > 100) throw new BadRequestException('请重新加载门店时区');
  try { new Intl.DateTimeFormat('en-US', { timeZone: body.expectedTimezone }).format(); } catch { throw new BadRequestException('门店时区无效'); }
  // Hash the original scalar values, not trimmed reason text. Object key order
  // is irrelevant; an edited draft must never replay a different command.
  const requestHash = createHash('sha256').update(JSON.stringify(Object.keys(body).filter(key => body[key] !== undefined).sort().map(key => [key, body[key]]))).digest('hex');
  const result: ParsedCalendarAction = { requestKey: calendarActionKey(body.requestKey), requestHash, action, expectedTimezone: body.expectedTimezone };
  if (dateAction) {
    result.date = calendarDate(body.date);
    if (typeof body.expectedSettingsHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedSettingsHash)) throw new BadRequestException('请重新加载闭店设置版本');
    result.expectedSettingsHash = body.expectedSettingsHash; return result;
  }
  if (action === 'UPDATE' || action === 'RELEASE') {
    result.blockId = id(body.blockId, 'blockId').toString();
    if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1 || (body.expectedVersion as number) >= 2147483647) throw new BadRequestException('请重新加载区间版本');
    result.expectedVersion = body.expectedVersion as number;
  }
  if (action === 'RELEASE') return result;
  if (!['SHOP', 'THERAPIST', 'ROOM'].includes(body.scope as string)) throw new BadRequestException('请选择全店、技师或场地范围');
  if (!['INTERNAL_OCCUPANCY', 'TIME_BLOCK'].includes(body.purpose as string)) throw new BadRequestException('请选择内部占用或屏蔽时段');
  result.scope = body.scope as CalendarBlockScope; result.purpose = body.purpose as CalendarBlockPurpose;
  if (result.scope !== 'SHOP') result.resourceId = id(body.resourceId, 'resourceId').toString();
  else if (body.resourceId !== undefined) throw new BadRequestException('全店区间不能指定单个资源');
  result.startLocal = local(body.startLocal); result.endLocal = local(body.endLocal);
  const localDuration = Date.parse(`${result.endLocal}:00Z`) - Date.parse(`${result.startLocal}:00Z`);
  if (localDuration <= 0 || localDuration > 42 * 86400000) throw new BadRequestException('区间结束须晚于开始，且最多42个当地日');
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.reason)) throw new BadRequestException('请填写区间原因，最多500字');
  result.reason = body.reason.trim(); return result;
}
