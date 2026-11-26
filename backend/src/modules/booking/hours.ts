import { BadRequestException } from '@nestjs/common';
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** A saved period boundary is not a closure when the next period starts at the
 * same minute. Preserve the period origins for slot grids, but allow a service
 * body to span adjoining periods only when every minute remains open. */
export function coveredByOpeningHours(intervals: ReadonlyArray<{ open: number; close: number }>, startMin: number, endMin: number): boolean {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin < 0 || endMin > 1440 || startMin >= endMin) return false;
  let cursor = startMin;
  for (const interval of intervals) {
    if (interval.close <= cursor) continue;
    if (interval.open > cursor) return false;
    cursor = interval.close;
    if (cursor >= endMin) return true;
  }
  return false;
}
export function openingIntervals(input: any): Record<string, Array<{ open: number; close: number }>> {
  // Some existing JSON columns contain a serialized canonical object. Decode
  // once at the common reader; nested JSON strings and malformed values fail.
  if (typeof input === 'string') {
    try { input = JSON.parse(input); }
    catch { throw new BadRequestException('Business hours must contain valid JSON'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Business hours must be a day-to-hours object');
  if (Object.keys(input).some(day => !DAYS.includes(day))) throw new BadRequestException('Unknown day in business hours');
  return Object.fromEntries(DAYS.map(day => {
    const entries = input[day] ? Array.isArray(input[day]) ? input[day] : [input[day]] : [];
    if (entries.length > 4) throw new BadRequestException('At most four opening periods per day');
    const intervals = entries.flatMap((h: any) => {
      if (!h || typeof h !== 'object' || Array.isArray(h) || h.closed !== undefined && typeof h.closed !== 'boolean') throw new BadRequestException('Invalid opening period');
      if (h.closed === true) return [];
      const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!valid.test(h.open || '') || !valid.test(h.close || '') || h.open >= h.close) throw new BadRequestException('Opening hours require valid increasing HH:MM times');
      const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      return [{ open: minutes(h.open), close: minutes(h.close) }];
    }).sort((a: any, b: any) => a.open - b.open);
    if (intervals.some((h: any, i: number) => i > 0 && h.open < intervals[i - 1].close)) throw new BadRequestException('Opening periods cannot overlap');
    return [day, intervals];
  }));
}

export function normalizeHours(input: any): Record<string, any> {
  const all = openingIntervals(input);
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return Object.fromEntries(DAYS.map(day => {
    const entries = all[day].map(h => ({ open: clock(h.open), close: clock(h.close), closed: false }));
    return [day, entries.length > 1 ? entries : entries[0] ?? { closed: true }];
  }));
}
