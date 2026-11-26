/** Gift records use their own store zone, never the viewer's device calendar. */
export function giftTimestamp(value: unknown, timezone: unknown): string {
  if (typeof timezone !== 'string' || !timezone || timezone !== timezone.trim()) return '门店时区未配置';
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
    });
  } catch { return '门店时区未配置'; }
  // A local wall clock without an offset is not an authoritative instant.
  if (typeof value !== 'string' || !value.includes('T') || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return '—';
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName} · ${timezone}`;
}
