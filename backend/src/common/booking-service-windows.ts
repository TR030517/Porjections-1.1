export interface BookingServiceWindow { startTime: Date; endTime: Date; }
const minute = 60000;
const instant = (value: unknown): value is Date => value instanceof Date && Number.isFinite(+value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

/** Saved offsets remain authoritative when an older no-room PLAN included a
 * room cleanup gap. Only the current resource gap or that exact legacy gap is
 * explainable by the snapshot; arbitrary gaps and overlaps are not valid. */
export function storedPlanPreparationMin(item: any, items: any[]): number | undefined {
  const following = items.find(row => row.participantIndex === item.participantIndex && row.sequence === item.sequence + 1);
  if (!following) return 0;
  const gap = following.offsetMin - item.offsetMin - item.durationMin;
  const legacy = Math.max(item.staffBufferMin, item.roomBufferMin);
  const current = Math.max(item.staffBufferMin, item.roomTypeSnapshot === null ? 0 : item.roomBufferMin);
  return integer(gap, 0, 120) && (gap === current || gap === legacy) ? gap : undefined;
}

/** Validate the complete saved itinerary before deriving service windows or
 * replacing its resource locks. Never reconstruct missing historical stages. */
export function completeStoredPlanItems(booking: any): any[] | null {
  if (booking.reservationKind !== 'PLAN' || booking.id == null || !instant(booking.startTime) || !instant(booking.endTime)
    || !integer(booking.durationMin, 1, 480) || +booking.endTime !== +booking.startTime + booking.durationMin * minute
    || !integer(booking.participantCountSnapshot, 1, 6) || !Array.isArray(booking.items) || !booking.items.length || booking.items.length > 12
    || booking.items.some((item: any) => !item || typeof item !== 'object')) return null;
  const items = [...booking.items].sort((left, right) => left.participantIndex - right.participantIndex || left.sequence - right.sequence);
  const participants = new Set<number>(), ids = new Set<string>();
  const next = new Map<number, { sequence: number; offset: number }>();
  let lastEnd = +booking.startTime;
  for (const item of items) {
    if (item.id == null || ids.has(String(item.id)) || String(item.bookingId) !== String(booking.id)
      || !integer(item.participantIndex, 1, 6) || !integer(item.sequence, 1, 4) || !integer(item.offsetMin, 0, 480)
      || !integer(item.durationMin, 1, 480) || !integer(item.staffBufferMin, 0, 120) || !integer(item.roomBufferMin, 0, 120)
      || item.requiredStaffCountSnapshot !== 1 || !instant(item.startAtUtc) || !instant(item.endAtUtc)
      || +item.startAtUtc !== +booking.startTime + item.offsetMin * minute || +item.endAtUtc !== +item.startAtUtc + item.durationMin * minute) return null;
    const expected = next.get(item.participantIndex) ?? { sequence: 1, offset: 0 };
    if (item.sequence !== expected.sequence || item.offsetMin !== expected.offset || +item.endAtUtc > +booking.endTime) return null;
    const preparation = storedPlanPreparationMin(item, items);
    if (preparation === undefined) return null;
    next.set(item.participantIndex, { sequence: item.sequence + 1, offset: item.offsetMin + item.durationMin + preparation });
    ids.add(String(item.id)); participants.add(item.participantIndex); lastEnd = Math.max(lastEnd, +item.endAtUtc);
  }
  if (participants.size !== booking.participantCountSnapshot || [...participants].some((value, index) => value !== index + 1) || lastEnd !== +booking.endTime) return null;
  return items;
}

/** A PLAN's preparation gap is not a service body. Use segments only when the
 * stored itinerary is complete and internally consistent; otherwise protect
 * the entire historical booking window rather than guessing missing service. */
export function storedBookingServiceWindows(booking: any): BookingServiceWindow[] {
  const items = completeStoredPlanItems(booking);
  if (!items) return [{ startTime: booking.startTime, endTime: booking.endTime }];
  return items.map(item => ({ startTime: item.startAtUtc, endTime: item.endAtUtc }));
}
