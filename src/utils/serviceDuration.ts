export const SERVICE_DURATION_KINDS = ['TIMED', 'PER_SESSION', 'VARIABLE'] as const;
export type ServiceDurationKind = typeof SERVICE_DURATION_KINDS[number];
export type BookingDurationKind = ServiceDurationKind | 'MIXED';
type ServiceMeta = { durationKind: ServiceDurationKind; durationMin: number; reservedDurationMin: number };
type NormalizedEntries<T, K extends string> = T extends Record<K, readonly (infer Entry)[]> ? Array<Entry & ServiceMeta> : Array<Record<string, unknown> & ServiceMeta>;
type NormalizedReservationService<T> = Omit<T, 'variants'> & ServiceMeta & { variants: NormalizedEntries<T, 'variants'> };
type NormalizedSavedBooking<T> = Omit<T, 'items'> & { durationKind: BookingDurationKind; reservedDurationMin: number; items: NormalizedEntries<T, 'items'> };
export const SERVICE_DURATION_LABELS: Record<BookingDurationKind, string> = { TIMED: '固定时长', PER_SESSION: '按次', VARIABLE: '时长不固定', MIXED: '混合项目' };

export function readServiceDurationKind(value: unknown): ServiceDurationKind {
  if (value === undefined) return 'TIMED';
  if (typeof value !== 'string' || !SERVICE_DURATION_KINDS.includes(value as ServiceDurationKind)) throw new Error('项目时长类型无法核对，请刷新资料。');
  return value as ServiceDurationKind;
}
export function readBookingDurationKind(value: unknown): BookingDurationKind {
  return value === 'MIXED' ? value : readServiceDurationKind(value);
}
export function durationFieldLabel(kind: unknown) {
  return readServiceDurationKind(kind) === 'TIMED' ? '固定服务时长（分钟）' : '预约预留时间（分钟）';
}
export function durationHelp(kind: unknown) {
  return readServiceDurationKind(kind) === 'TIMED'
    ? '明确填写 5–240 整数分钟及固定价格；价格不按时长推算。'
    : '实际服务时长可变；须明确预留 5–240 整数分钟以安排技师和场地、避免冲突。这是预约占用块，不承诺服务固定分钟，价格仍为明确固定金额。';
}
/** New non-timed drafts require a fresh manual decision; editing preserves real existing terms. */
export function serviceKindDraftChange(kind: unknown, editing: boolean) {
  const durationKind = readServiceDurationKind(kind);
  return editing || durationKind === 'TIMED' ? { durationKind } : { durationKind, category: undefined, durationMin: null, price: null, priceCents: null };
}
export function assertServiceDurationWrite(value: unknown, creating: boolean) {
  const row = object(value);
  if (Object.hasOwn(row, 'reservedDurationMin') || Object.hasOwn(row, 'durationMinutes')) throw new Error('预约预留别名只读，保存请使用 durationMin。');
  if (creating || row.durationKind !== undefined) readServiceDurationKind(row.durationKind);
  if (creating || row.durationMin !== undefined) {
    if (typeof row.durationMin !== 'number' || !Number.isSafeInteger(row.durationMin) || row.durationMin < 5 || row.durationMin > 240) throw new Error('服务时长／预约预留须为 5–240 整数分钟。');
  }
}
export function serviceDurationLabel(kind: unknown, minutes: number) {
  const type = readServiceDurationKind(kind);
  return type === 'TIMED' ? `固定服务 ${minutes} 分钟` : `${SERVICE_DURATION_LABELS[type]} · 预约预留 ${minutes} 分钟`;
}
export function bookingDurationLabel(kind: unknown, minutes: number) {
  return `${SERVICE_DURATION_LABELS[readBookingDurationKind(kind)]} · 预约总跨度 ${minutes} 分钟`;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('预约时长资料无法核对，请刷新。');
  return value as Record<string, unknown>;
}
function minutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('预约预留分钟无法核对，请刷新。');
  return value;
}
/** Read-only aliases never enter a save payload. Explicit null and contradictions fail closed. */
export function readDurationMinutes(value: unknown): number {
  const row = object(value), raw = row.durationMin === undefined ? row.durationMinutes : row.durationMin;
  const result = minutes(raw);
  for (const key of ['durationMin', 'durationMinutes', 'reservedDurationMin']) {
    if (row[key] !== undefined && minutes(row[key]) !== result) throw new Error('预约预留时间与原时长不一致，请刷新核对。');
  }
  return result;
}
export function normalizeServiceDuration<T>(value: T): T & { durationKind: ServiceDurationKind; durationMin: number; reservedDurationMin: number } {
  const row = object(value), kind = readServiceDurationKind(row.durationKind), durationMin = readDurationMinutes(row);
  return { ...value, durationKind: kind, durationMin, reservedDurationMin: durationMin };
}
export function normalizeReservationService<T>(value: T): NormalizedReservationService<T> {
  const row = object(value), result = normalizeServiceDuration(value);
  if (!Array.isArray(row.variants)) throw new Error('服务规格无法核对，请刷新。');
  const variants = row.variants.map(raw => {
    const variant = object(raw);
    if (variant.durationKind !== undefined && readServiceDurationKind(variant.durationKind) !== result.durationKind) throw new Error('规格类型与主服务不一致，请刷新。');
    return normalizeServiceDuration({ ...variant, durationKind: result.durationKind });
  });
  return { ...result, variants } as NormalizedReservationService<T>;
}
export function normalizeSavedBookingItem<T>(value: T): T & ServiceMeta {
  const row = object(value);
  // The standard DTO was derived from the frozen snapshot. Never inspect row.service.
  const kind = row.durationKindSnapshot === undefined ? readServiceDurationKind(row.durationKind) : readServiceDurationKind(row.durationKindSnapshot);
  if (row.durationKind !== undefined && readServiceDurationKind(row.durationKind) !== kind) throw new Error('预约项目类型与已保存快照不一致，请刷新。');
  const durationMin = readDurationMinutes(row);
  return { ...value, durationKind: kind, durationMin, reservedDurationMin: durationMin };
}
export function normalizeSavedBooking<T>(value: T): NormalizedSavedBooking<T> {
  const row = object(value);
  if (row.items !== undefined && !Array.isArray(row.items)) throw new Error('预约服务段无法核对，请刷新。');
  const items = (row.items as unknown[] | undefined)?.map(normalizeSavedBookingItem) ?? [];
  const kinds = new Set(items.map(item => item.durationKind));
  const kind: BookingDurationKind = !items.length ? 'TIMED' : kinds.size === 1 ? items[0].durationKind : 'MIXED';
  if (row.durationKind !== undefined && readBookingDurationKind(row.durationKind) !== kind) throw new Error('预约总类型与已保存服务段不一致，请刷新。');
  return { ...value, items, durationKind: kind, reservedDurationMin: readDurationMinutes(row) } as NormalizedSavedBooking<T>;
}
/** Lists do not necessarily include item snapshots. Validate metadata without guessing from live service. */
export function normalizeBookingListDuration<T>(value: T): T & { durationKind: BookingDurationKind; reservedDurationMin: number } {
  const row = object(value);
  return { ...value, durationKind: readBookingDurationKind(row.durationKind), reservedDurationMin: readDurationMinutes(row) };
}
