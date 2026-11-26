/** Framework-free metadata used by both public server projection and Studio preview.
 * Server write/booking policies live in service-duration.ts. No framework import
 * belongs in this shared browser bundle. */
export function publicDurationMeta(service: { durationKind?: unknown; durationMin?: unknown; reservedDurationMin?: unknown }) {
  const durationKind = service.durationKind === undefined ? 'TIMED' : service.durationKind;
  if (!['TIMED', 'PER_SESSION', 'VARIABLE'].includes(durationKind as string) || typeof durationKind !== 'string') throw Error('服务类型无法核对');
  const reservedDurationMin = service.durationMin;
  if (typeof reservedDurationMin !== 'number' || !Number.isSafeInteger(reservedDurationMin) || reservedDurationMin <= 0
    || Object.prototype.hasOwnProperty.call(service, 'reservedDurationMin') && service.reservedDurationMin !== reservedDurationMin) throw Error('预约预留时间无法核对');
  return { durationKind: durationKind as 'TIMED' | 'PER_SESSION' | 'VARIABLE', reservedDurationMin };
}
export function publicReservedBlockValid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 5 && value <= 240;
}
