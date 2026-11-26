import { localParts } from '../booking/time';

/** Gift records use the store zone; an unknown zone never falls back to the host. */
export function giftTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch { return null; }
}

/** Keep the offset so both occurrences of a repeated DST wall time are distinct. */
export function giftLocalTimestamp(value: Date | string | null | undefined, timezone: string | null): string | null {
  if (!timezone || value == null || typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const local = localParts(instant, timezone).replace('T', ' ');
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(instant).find(part => part.type === 'timeZoneName')?.value;
    return offset ? `${local} ${offset}` : null;
  } catch { return null; }
}
