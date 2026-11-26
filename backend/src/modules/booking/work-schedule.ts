import { BadRequestException } from '@nestjs/common';
import { coveredBy, shiftInterval } from './availability';
import { openingIntervals } from './hours';
import { localParts } from './time';

export type ScheduleMode = 'SHOP' | 'CUSTOM';
export type WeeklyShift = { weekday: number; startMin: number; endMin: number; isActive: boolean };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Missing legacy values fail closed to the explicit-schedule behavior. The DB
// default is SHOP for new therapists; migration preserves every old shift row.
export function readScheduleMode(value: unknown): ScheduleMode {
  if (value == null) return 'CUSTOM';
  if (value !== 'SHOP' && value !== 'CUSTOM') throw new BadRequestException('Invalid therapist schedule mode');
  return value;
}
export function effectiveWeeklyShifts(mode: unknown, businessHours: unknown, shifts: WeeklyShift[]): WeeklyShift[] {
  if (readScheduleMode(mode) === 'CUSTOM') return shifts.filter(shift => shift.isActive);
  const opening = openingIntervals(businessHours);
  return DAYS.flatMap((day, weekday) => opening[day].map(span => ({ weekday, startMin: span.open, endMin: span.close, isActive: true })));
}

/** A saved weekly schedule can offer times only where a shift overlaps opening hours. */
export function recurringScheduleCheck(businessHours: unknown): (therapist: { scheduleMode?: unknown; shifts: WeeklyShift[] }) => boolean {
  let opening: WeeklyShift[];
  try { opening = effectiveWeeklyShifts('SHOP', businessHours, []); }
  catch { return () => false; }

  if (!opening.length) return () => false;
  return therapist => {
    try {
      if (readScheduleMode(therapist.scheduleMode) === 'SHOP') return true;
      return effectiveWeeklyShifts(therapist.scheduleMode, businessHours, therapist.shifts).some(shift =>
        shift.isActive === true && Number.isInteger(shift.startMin) && Number.isInteger(shift.endMin)
        && shift.startMin >= 0 && shift.endMin <= 1440 && shift.startMin < shift.endMin
        && opening.some(period => period.weekday === shift.weekday && shift.startMin < period.endMin && shift.endMin > period.startMin));
    } catch { return false; }
  };
}

export function workIntervals(date: string, timezone: string, shifts: WeeklyShift[], days = 2) {
  return Array.from({ length: days }, (_, delta) => {
    const day = new Date(`${date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + delta);
    return shifts.filter(shift => shift.isActive && shift.weekday === day.getUTCDay())
      .map(shift => shiftInterval(day.toISOString().slice(0, 10), shift.startMin, shift.endMin, timezone));
  }).flat().filter((span): span is NonNullable<typeof span> => span !== null);
}
/** Coverage includes the full UTC occupation, including cleanup after service. */
export function coveredByShifts(window: { startAtUtc: Date; endAtUtc: Date }, timezone: string | null, shifts: WeeklyShift[]) {
  if (!timezone || window.endAtUtc <= window.startAtUtc) return false;
  try {
    const date = localParts(window.startAtUtc, timezone).slice(0, 10);
    return coveredBy(workIntervals(date, timezone, shifts, 3), { start: window.startAtUtc, end: window.endAtUtc });
  } catch { return false; }
}
