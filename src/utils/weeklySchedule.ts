export interface WeeklyPeriod { weekday: number; startMin: number; endMin: number; }
export interface WeeklyShift extends WeeklyPeriod { isActive: boolean; }
export interface WeeklyScheduleTherapist { id: string | number; scheduleMode?: string; shifts: readonly WeeklyShift[]; }
export interface WeeklyScheduleFit { hasServiceWindow: boolean; hasStaffCoverage: boolean; withoutShiftIds: string[]; }
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY = 1440, WEEK = 7 * DAY;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

/** Canonical stored hours only; mirrors booking/hours.openingIntervals, not the editor's start/end draft. */
export function parseWeeklyBusinessHours(input: unknown): WeeklyPeriod[] | null {
  // The booking context also accepts a legacy JSON string before applying the canonical parser.
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return null; } }
  if (!record(input) || Object.keys(input).some(day => !DAYS.includes(day))) return null;
  const result: WeeklyPeriod[] = [];
  for (const [weekday, day] of DAYS.entries()) {
    const value = input[day], entries = value ? Array.isArray(value) ? value : [value] : [];
    if (entries.length > 4) return null;
    const periods: WeeklyPeriod[] = [];
    for (const entry of entries) {
      if (!record(entry) || entry.closed !== undefined && typeof entry.closed !== 'boolean') return null;
      if (entry.closed === true) continue;
      const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (typeof entry.open !== 'string' || typeof entry.close !== 'string' || !valid.test(entry.open) || !valid.test(entry.close) || entry.open >= entry.close) return null;
      periods.push({ weekday, startMin: minute(entry.open), endMin: minute(entry.close) });
    }
    periods.sort((left, right) => left.startMin - right.startMin);
    if (periods.some((period, index) => index > 0 && period.startMin < periods[index - 1].endMin)) return null;
    result.push(...periods);
  }
  return result;
}

function validPeriod(value: WeeklyPeriod) {
  return Number.isInteger(value.weekday) && value.weekday >= 0 && value.weekday <= 6
    && Number.isInteger(value.startMin) && Number.isInteger(value.endMin) && value.startMin >= 0 && value.endMin <= DAY && value.startMin < value.endMin;
}
type Span = { start: number; end: number };
function staffSpans(therapist: WeeklyScheduleTherapist, periods: readonly WeeklyPeriod[]): Span[] {
  // Missing legacy mode follows the backend's CUSTOM behavior, never implicit SHOP.
  const shifts = therapist.scheduleMode === 'SHOP' ? periods
    : therapist.scheduleMode == null || therapist.scheduleMode === 'CUSTOM'
      ? (Array.isArray(therapist.shifts) ? therapist.shifts.filter(shift => shift.isActive === true && validPeriod(shift)) : []) : [];
  const sorted = [0, WEEK].flatMap(offset => shifts.map(shift => ({ start: offset + shift.weekday * DAY + shift.startMin, end: offset + shift.weekday * DAY + shift.endMin })))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push(span);
  }
  return merged;
}
function covered(spans: readonly Span[], start: number, end: number) {
  for (const span of spans) {
    if (span.start > start) return false;
    if (span.end >= end) return true;
  }
  return false;
}

/** Static weekly template only. Dates, DST, leave, maintenance and existing bookings remain the slot engine's job. */
export function weeklyScheduleFit(input: {
  periods: readonly WeeklyPeriod[]; durationMin: number; staffBufferMin: number; requiredStaffCount: number; therapists: readonly WeeklyScheduleTherapist[];
}): WeeklyScheduleFit {
  const { periods, durationMin, staffBufferMin, requiredStaffCount, therapists } = input;
  const result: WeeklyScheduleFit = { hasServiceWindow: false, hasStaffCoverage: false, withoutShiftIds: [] };
  if (!Number.isSafeInteger(durationMin) || durationMin < 5 || durationMin > 240 || !Number.isInteger(staffBufferMin) || staffBufferMin < 0 || staffBufferMin > 120
    || ![1, 2].includes(requiredStaffCount) || !periods.every(validPeriod)) return result;
  const unique = [...new Map(therapists.map(therapist => [String(therapist.id), therapist])).values()];
  const staff = unique.map(therapist => ({ id: String(therapist.id), spans: staffSpans(therapist, periods) }));
  result.withoutShiftIds = staff.filter(therapist => !therapist.spans.length).map(therapist => therapist.id);
  for (const period of periods) {
    // Both selectedTime and slots anchor their 30-minute grid to each opening period.
    for (let minute = period.startMin; minute + durationMin <= period.endMin; minute += 30) {
      result.hasServiceWindow = true;
      const start = period.weekday * DAY + minute, end = start + durationMin + staffBufferMin;
      // CUSTOM staff may finish after closing; SHOP coverage still ends with its inherited hours.
      if (staff.filter(therapist => covered(therapist.spans, start, end)).length >= requiredStaffCount) return { ...result, hasStaffCoverage: true };
    }
  }
  return result;
}
