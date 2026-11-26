import { shopLocal } from './reservationTime';

/** Finance must use a verified shop zone, never the device zone or a UTC fallback. */
export function requireFinancialTimezone(value: unknown): string {
  if (typeof value === 'string' && value === value.trim() && /^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
      return value;
    } catch { /* reject an unknown IANA identifier */ }
  }
  throw new Error('无法核对门店财务时区，请重新加载门店账本。');
}

export function financialYear(timezone: string, now = new Date()): number {
  return Number(shopLocal(now.toISOString(), requireFinancialTimezone(timezone)).slice(0, 4));
}

/** The offset distinguishes both occurrences of a repeated DST wall-clock time. */
export function financialTimestamp(value: string, timezone: string): string {
  if (typeof value !== 'string' || !value.includes('T') || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return '—';
  const zone = requireFinancialTimezone(timezone);
  const date = new Date(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}
