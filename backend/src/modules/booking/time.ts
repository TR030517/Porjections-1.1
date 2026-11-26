import { BadRequestException } from '@nestjs/common';
export function bookingLocalFields(booking: { startTime: Date; endTime: Date; bookingTimezone?: string | null }, shopTimezone?: string | null) {
  for (const timezone of new Set([booking.bookingTimezone, shopTimezone].filter((value): value is string => !!value))) {
    try {
      const start = localParts(booking.startTime, timezone); const end = localParts(booking.endTime, timezone);
      return { timezone, localDate: start.slice(0, 10), localStartTime: start.slice(11), localEndTime: end.slice(11) };
    } catch { /* Fall back to the current shop only when its snapshot is invalid. */ }
  }
  return { timezone: null, localDate: null, localStartTime: null, localEndTime: null };
}
export function localParts(instant: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch { throw new BadRequestException('Shop timezone is not configured correctly'); }
}
export function localInstant(date: string, time: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BadRequestException('Invalid booking date or time');
  if (!timezone) throw new BadRequestException('Shop timezone must be configured before accepting bookings');
  const desired = `${date}T${time}`;
  const nominal = Date.parse(`${desired}:00Z`);
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 10) !== date) throw new BadRequestException('Invalid booking date');
  const matches = new Set<number>();
  for (const delta of [-12, 0, 12]) {
    const probe = nominal + delta * 3600000;
    const offset = Date.parse(`${localParts(new Date(probe), timezone)}:00Z`) - probe;
    const candidate = nominal - offset;
    if (localParts(new Date(candidate), timezone) === desired) matches.add(candidate);
  }
  if (matches.size !== 1) throw new BadRequestException('Booking time is missing or ambiguous due to daylight saving time');
  return new Date([...matches][0]);
}
