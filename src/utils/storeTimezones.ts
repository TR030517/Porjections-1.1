import { inferStoreTimezone } from '../../backend/src/common/store-timezone.ts';

export { inferStoreTimezone };
export { storeZipStateConflict } from '../../backend/src/common/store-timezone.ts';

export const STORE_TIMEZONE_CHOICES = [
  { value: 'Europe/London', country: 'United Kingdom', city: 'London' },
  { value: 'America/Adak', country: 'United States', city: 'Adak' },
  { value: 'America/Anchorage', country: 'United States', city: 'Anchorage' },
  { value: 'America/Chicago', country: 'United States', city: 'Chicago' },
  { value: 'America/Denver', country: 'United States', city: 'Denver' },
  { value: 'America/Los_Angeles', country: 'United States', city: 'Los Angeles' },
  { value: 'America/New_York', country: 'United States', city: 'Washington, D.C.' },
  { value: 'America/Phoenix', country: 'United States', city: 'Phoenix' },
  { value: 'Pacific/Honolulu', country: 'United States', city: 'Honolulu' },
  { value: 'Pacific/Midway', country: 'United States Minor Outlying Islands', city: 'Midway' },
] as const;

export function timezoneClock(value: string, now: number) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: value, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
    return { time: `${part('hour')}:${part('minute')} ${part('dayPeriod')}`, abbreviation: part('timeZoneName') };
  } catch { return null; }
}

export function timezoneChoices(currentValue: string, query: string, now: number) {
  const choices: Array<{ value: string; country: string; city: string }> = [...STORE_TIMEZONE_CHOICES];
  // Keep the exact saved IANA ID/alias. Do not silently canonicalize a shop's time zone.
  for (const value of [currentValue, query.trim()]) {
    if (value && !choices.some(item => item.value === value) && timezoneClock(value, now)) choices.push({ value, country: '', city: value });
  }
  const term = query.trim().toLocaleLowerCase();
  return choices.map(item => ({ ...item, ...timezoneClock(item.value, now)! }))
    .filter(item => !term || `${item.country} ${item.city} ${item.value} ${item.abbreviation}`.toLocaleLowerCase().includes(term));
}

export function timezoneLabel(item: { country: string; city: string; abbreviation: string }) {
  return `${item.country ? item.country + ' – ' : ''}${item.city} (${item.abbreviation})`;
}
