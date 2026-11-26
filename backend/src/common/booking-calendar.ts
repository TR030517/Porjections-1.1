export interface BookingCalendar {
  today: string; timezone: string; serverNow: string; validUntil: string;
}

/** Framework/node-free: shared with the browser customer preview. The next
 * local date boundary may be 23/25 hours away, or skip/repeat midnight. Find
 * its first instant rather than adding 24 hours or guessing an offset. */
export function bookingCalendar(timezone: unknown, now = new Date()): BookingCalendar | null {
  if (typeof timezone !== 'string' || !timezone || timezone.length > 100 || !Number.isFinite(+now)) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const day = (instant: number) => {
      const fields = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
      return `${fields.year}-${fields.month}-${fields.day}`;
    };
    const today = day(+now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    let lower = +now, upper = +now + 48 * 3600000;
    if (day(upper) <= today) return null;
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      if (day(middle) <= today) lower = middle; else upper = middle;
    }
    return { today, timezone, serverNow: now.toISOString(), validUntil: new Date(upper).toISOString() };
  } catch { return null; }
}
