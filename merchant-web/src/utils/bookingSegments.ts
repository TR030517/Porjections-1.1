import type { BookingItem } from '../api/bookings';

export function sortedBookingSegments<T extends { participantIndex: number; sequence?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.participantIndex - b.participantIndex || (a.sequence ?? 0) - (b.sequence ?? 0));
}
export function bookingSegmentTime(item: BookingItem, bookingTimezone?: string | null) {
  const start = new Date(item.startAtUtc ?? ''), end = new Date(item.endAtUtc ?? '');
  if (!Number.isFinite(+start) || !Number.isFinite(+end)) return '未提供服务段起止时间';
  const timezone = item.timezone || bookingTimezone;
  try {
    if (!timezone) throw new Error('未保存时区');
    const format = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, timeZoneName: 'shortOffset', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
    return `${format(start)} — ${format(end)} · ${timezone}`;
  } catch { return `${start.toISOString()} — ${end.toISOString()} · UTC（原时区不可用）`; }
}
