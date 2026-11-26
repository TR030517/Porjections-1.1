/** Order metadata uses the saved shop zone, independently of the viewer's device. */
export function bookingTimestamp(value: unknown, timezone: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return '—';
  try {
    if (typeof timezone !== 'string' || !timezone) throw new Error('Missing booking zone');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} · ${timezone}`;
  } catch {
    return `${instant.toISOString()} UTC（预约时区未提供或无效）`;
  }
}
