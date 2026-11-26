import { BadRequestException } from '@nestjs/common';

export type ServiceDurationKind = 'TIMED' | 'PER_SESSION' | 'VARIABLE';
export type BookingDurationKind = ServiceDurationKind | 'MIXED';
export const SERVICE_DURATION_KINDS = ['TIMED', 'PER_SESSION', 'VARIABLE'] as const;

/** Missing is the old TIMED contract. Explicit invalid values never downgrade. */
export function readDurationKind(value: unknown): ServiceDurationKind {
  if (value === undefined) return 'TIMED';
  if (typeof value !== 'string' || !SERVICE_DURATION_KINDS.includes(value as ServiceDurationKind)) throw new BadRequestException('无效的主服务时长类型');
  return value as ServiceDurationKind;
}

/** New reservation allocation blocks remain positive, bounded integer minutes. */
export function validReservedDurationMin(kind: unknown, value: unknown): value is number {
  try { readDurationKind(kind); } catch { return false; }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 5 && value <= 240;
}
function minutes(value: unknown): number {
  // Read existing snapshots as stored. The new 5–240 write policy must not
  // reinterpret historical durations or a PLAN's independently stored span.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new BadRequestException('预约占用时间无法核对');
  return value;
}
function alias(value: any, reservedDurationMin: number) {
  if (Object.prototype.hasOwnProperty.call(value, 'reservedDurationMin') && value.reservedDurationMin !== reservedDurationMin) throw new BadRequestException('预约占用时间别名不一致');
}
export function serviceDurationMeta(service: { durationKind?: unknown; durationMin?: unknown; reservedDurationMin?: unknown }) {
  if (!service || typeof service !== 'object' || Array.isArray(service)) throw new BadRequestException('主服务时长资料无法核对');
  const durationKind = readDurationKind(service.durationKind), reservedDurationMin = minutes(service.durationMin);
  alias(service, reservedDurationMin); return { durationKind, reservedDurationMin };
}
export function itemDurationMeta(item: { durationKindSnapshot?: unknown; durationMin?: unknown; durationKind?: unknown; reservedDurationMin?: unknown }) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('订单主项目快照无法核对');
  const durationKind = readDurationKind(item.durationKindSnapshot), reservedDurationMin = minutes(item.durationMin);
  alias(item, reservedDurationMin);
  if (Object.prototype.hasOwnProperty.call(item, 'durationKind') && readDurationKind(item.durationKind) !== durationKind) throw new BadRequestException('订单时长类型与已保存快照不一致');
  return { durationKind, reservedDurationMin };
}
export function bookingDurationMeta(booking: { durationMin?: unknown; items?: unknown[] | null; reservedDurationMin?: unknown }) {
  if (!booking || typeof booking !== 'object' || Array.isArray(booking)) throw new BadRequestException('订单预约占用资料无法核对');
  const reservedDurationMin = minutes(booking.durationMin); alias(booking, reservedDurationMin);
  if (booking.items !== undefined && !Array.isArray(booking.items)) throw new BadRequestException('订单主项目快照无法核对');
  const kinds = new Set((booking.items ?? []).map((item: any) => itemDurationMeta(item).durationKind));
  const durationKind: BookingDurationKind = kinds.size > 1 ? 'MIXED' : kinds.size === 1 ? [...kinds][0] : 'TIMED';
  return { durationKind, reservedDurationMin };
}
