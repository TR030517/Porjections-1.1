import { BadRequestException } from '@nestjs/common';

export const ROOM_TYPES = ['SINGLE', 'COUPLE', 'FOOT_SEAT'] as const;
export const VARIANT_FIELDS = ['name', 'durationMin', 'priceCents', 'priceBasis', 'currency', 'isActive', 'sortOrder'];
export const POLICY_FIELDS = ['participantCount', 'requiredStaffCount', 'requiredRoomType', 'staffBufferMin', 'roomBufferMin'];
export const SHIFT_FIELDS = ['weekday', 'startMin', 'endMin', 'isActive'];
export const WINDOW_FIELDS = ['startAtUtc', 'endAtUtc', 'reason'];
export const ROOM_FIELDS = ['name', 'roomType', 'capacity', 'isActive'];
export type Actor = { id: string; role: string };
export function id(value: unknown, field = 'id'): bigint {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new BadRequestException(`${field}必须是有效的正整数ID`);
  }
  return BigInt(value);
}
export function object(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请求必须为对象');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) throw new BadRequestException('请求包含不允许的字段');
  return result;
}
function int(value: unknown, min: number, max: number, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequestException(`${field}必须为${min}至${max}的整数`);
  }
  return value;
}
function text(value: unknown, field: string, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${field}不能为空且最多${max}字`);
  return value.trim();
}
function boolean(value: unknown) {
  if (typeof value !== 'boolean') throw new BadRequestException('启用状态必须为布尔值');
  return value;
}
function pricingBasis(value: unknown) {
  if (value === undefined || value === 'PER_BOOKING') return 'PER_BOOKING';
  throw new BadRequestException('当前项目统一按整次订单总价计价');
}
export function variantInput(data: Record<string, unknown>) {
  return { name: text(data.name, '规格名称'), durationMin: int(data.durationMin, 5, 240, '预约占用分钟'),
    priceCents: int(data.priceCents, 1, 10000000, '固定价格（分）'), priceBasis: pricingBasis(data.priceBasis),
    currency: data.currency === 'usd' ? 'usd' : (() => { throw new BadRequestException('当前规格币种只支持usd'); })(),
    isActive: boolean(data.isActive), sortOrder: int(data.sortOrder, 0, 10000, '排序') };
}
export function policyInput(data: Record<string, unknown>) {
  const participantCount = int(data.participantCount, 1, 2, '参与人数');
  const requiredStaffCount = int(data.requiredStaffCount, 1, 2, '所需技师数');
  const requiredRoomType = data.requiredRoomType;
  if (requiredRoomType !== null && !ROOM_TYPES.includes(requiredRoomType as any)) throw new BadRequestException('无效房间类型');
  if (requiredStaffCount < participantCount) throw new BadRequestException('每位客人至少需要一位不同技师；四手服务为1位客人和2位技师');
  if (participantCount === 2 && requiredRoomType !== null && requiredRoomType !== 'COUPLE') throw new BadRequestException('双人服务如绑定空间，必须选择双人房');
  return { participantCount, requiredStaffCount, requiredRoomType: requiredRoomType as string | null,
    staffBufferMin: int(data.staffBufferMin, 0, 120, '技师缓冲分钟'), roomBufferMin: int(data.roomBufferMin, 0, 120, '房间缓冲分钟') };
}
export function shiftInput(data: Record<string, unknown>) {
  const result = { weekday: int(data.weekday, 0, 6, '星期'), startMin: int(data.startMin, 0, 1439, '开始分钟'),
    endMin: int(data.endMin, 1, 1440, '结束分钟'), isActive: boolean(data.isActive) };
  if (result.endMin <= result.startMin) throw new BadRequestException('班次结束必须晚于开始；跨日请分为两段');
  return result;
}
export function roomInput(data: Record<string, unknown>) {
  if (!ROOM_TYPES.includes(data.roomType as any)) throw new BadRequestException('无效房间类型');
  const capacity = int(data.capacity, 1, 2, '容量');
  if (capacity !== (data.roomType === 'COUPLE' ? 2 : 1)) throw new BadRequestException('双人房容量为2，单人房或独立足疗座位容量为1');
  return { name: text(data.name, '房间或座位名称'), roomType: data.roomType as string, capacity, isActive: boolean(data.isActive) };
}
export function utcInstant(value: unknown): Date {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new BadRequestException('时间必须为明确的UTC ISO时间（Z结尾）');
  const date = new Date(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) throw new BadRequestException('无效的UTC日期时间');
  return date;
}
export function windowInput(data: Record<string, unknown>) {
  const startAtUtc = data.startAtUtc instanceof Date ? data.startAtUtc : utcInstant(data.startAtUtc);
  const endAtUtc = data.endAtUtc instanceof Date ? data.endAtUtc : utcInstant(data.endAtUtc);
  if (!Number.isFinite(startAtUtc.getTime()) || !Number.isFinite(endAtUtc.getTime()) || endAtUtc <= startAtUtc) throw new BadRequestException('结束时间必须晚于开始时间');
  let reason: string | null = null;
  if (data.reason !== null && data.reason !== undefined) {
    if (typeof data.reason !== 'string' || data.reason.trim().length > 500) throw new BadRequestException('原因最多500字');
    reason = data.reason.trim() || null;
  }
  return { startAtUtc, endAtUtc, reason };
}
// Normalize every ID, including nested relation IDs, without exposing account projections.
export function serialize<T>(value: T): any {
  return JSON.parse(JSON.stringify(value, (_key, field) => typeof field === 'bigint' ? field.toString() : field));
}
