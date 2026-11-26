import { BadRequestException } from '@nestjs/common';
import { localInstant } from './time';

export interface Interval { start: Date; end: Date; }
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && a.end > b.start;
export const contains = (outer: Interval, inner: Interval) => outer.start <= inner.start && outer.end >= inner.end;

export function shiftInterval(date: string, startMin: number, endMin: number, timezone: string): Interval | null {
  try {
    const start = minuteInstant(date, startMin, timezone), end = minuteInstant(date, endMin, timezone);
    return start < end ? { start, end } : null;
  } catch { return null; }
}

export function coveredBy(intervals: Interval[], target: Interval) {
  let cursor = +target.start;
  for (const span of [...intervals].sort((a, b) => +a.start - +b.start)) {
    if (+span.end <= cursor) continue;
    if (+span.start > cursor) return false;
    cursor = +span.end;
    if (cursor >= +target.end) return true;
  }
  return false;
}

export function minuteInstant(date: string, minute: number, timezone: string) {
  if (minute === 1440) {
    const tomorrow = new Date(`${date}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return localInstant(tomorrow.toISOString().slice(0, 10), '00:00', timezone);
  }
  return localInstant(date, `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, timezone);
}

/** A wall-clock span across a DST transition is deliberately unavailable. */
export function wallInterval(date: string, startMin: number, endMin: number, timezone: string): Interval | null {
  try {
    const start = minuteInstant(date, startMin, timezone), end = minuteInstant(date, endMin, timezone);
    if (end.getTime() - start.getTime() !== (endMin - startMin) * 60000) return null;
    return { start, end };
  } catch { return null; }
}

export function preferredIds(input: { therapistId?: string; preferredTherapistIds?: string[] }, count: number) {
  const ids = input.preferredTherapistIds ?? (input.therapistId ? [input.therapistId] : []);
  if (input.therapistId && input.preferredTherapistIds && (ids.length !== 1 || ids[0] !== input.therapistId)) throw new BadRequestException('Use one consistent therapist preference');
  if (!Array.isArray(ids) || ids.length > count || new Set(ids).size !== ids.length) throw new BadRequestException('Therapist preferences must be distinct and no more than the required staff count');
  return ids;
}

export interface AllocationContext {
  count: number; staffCount?: number; duration: number; staffBuffer: number; roomBuffer: number; needsRoom: boolean;
  therapists: Array<{ id: string; shifts: Interval[]; timeOff: Interval[] }>;
  rooms: Array<{ id: string; maintenance: Interval[] }>;
  locks: Array<Interval & { type: string; id: string }>;
  legacy: Array<Interval & { therapistId: string | null }>;
  shopBlocks?: Interval[];
}

/** Protect complete resource occupancy, including applicable preparation.
 * Services without a room ignore the unused room buffer. */
export function overlapsShopBlock(context: AllocationContext, staffWindow: Interval, roomWindow: Interval) {
  return (context.shopBlocks ?? []).some(block => overlaps(staffWindow, block) || context.needsRoom && overlaps(roomWindow, block));
}

/** Shared by preview, creation and rescheduling; employees include their own buffer. */
export function allocate(context: AllocationContext, start: Date, preferred: string[]) {
  const staffWindow = { start, end: new Date(+start + (context.duration + context.staffBuffer) * 60000) };
  const roomWindow = { start, end: new Date(+start + (context.duration + context.roomBuffer) * 60000) };
  if (overlapsShopBlock(context, staffWindow, roomWindow)) return null;
  if (context.legacy.some(b => b.therapistId === null && overlaps(staffWindow, b))) return null;
  const freeStaff = context.therapists.filter(t => coveredBy(t.shifts, staffWindow)
    && !t.timeOff.some(b => overlaps(staffWindow, b))
    && !context.locks.some(b => b.type === 'THERAPIST' && b.id === t.id && overlaps(staffWindow, b))
    && !context.legacy.some(b => b.therapistId === t.id && overlaps(staffWindow, b))).map(t => t.id);
  const required = context.staffCount ?? context.count;
  if (freeStaff.length < required || preferred.some(id => !freeStaff.includes(id))) return null;
  const therapistIds = [...preferred, ...freeStaff.filter(id => !preferred.includes(id))].slice(0, required);
  const room = context.rooms.find(r => !r.maintenance.some(b => overlaps(roomWindow, b))
    && !context.locks.some(b => b.type === 'ROOM' && b.id === r.id && overlaps(roomWindow, b)));
  // A historical booking has no reliable room assignment, so it conservatively blocks rooms too.
  if (context.needsRoom && (!room || context.legacy.some(b => overlaps(roomWindow, b)))) return null;
  return { therapistIds, roomId: context.needsRoom ? room!.id : null, staffWindow, roomWindow };
}
