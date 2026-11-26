import type { BookingSegment } from '../types/bookingDetails';

export function sortedBookingSegments<T extends { participantIndex: number; sequence?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.participantIndex - b.participantIndex || (a.sequence ?? 0) - (b.sequence ?? 0));
}
/** Format the actual UTC instants in the saved booking zone, never the browser zone. */
export function bookingSegmentTime(item: BookingSegment, bookingTimezone: string | null) {
  const start = new Date(item.startAtUtc ?? ''), end = new Date(item.endAtUtc ?? '');
  if (!Number.isFinite(+start) || !Number.isFinite(+end)) return '服务段起止时间未提供';
  const timezone = item.timezone || bookingTimezone;
  try {
    if (!timezone) throw new Error('No saved timezone');
    const format = (value: Date) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, timeZoneName: 'shortOffset', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
    return `${format(start)} — ${format(end)} · ${timezone}`;
  } catch { return `${start.toISOString()} — ${end.toISOString()} · UTC（预约时区未提供或无效）`; }
}
