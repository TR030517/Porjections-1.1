import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AllocationContext, coveredBy, overlaps, overlapsShopBlock } from './availability';
import { cents, numericId } from '../payment/money';

export type PlanSelection = { participantIndex: number; sequence: number; serviceId: string; variantId?: string; therapistId?: string };
export type PlanInput = { shopId: string; date: string; items: PlanSelection[] };
export function normalizePlan(input: PlanInput): PlanSelection[] {
  numericId(input.shopId);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 12) throw new BadRequestException('A plan must contain 1–12 service segments');
  const items = input.items.map(item => {
    if (!item || !Number.isInteger(item.participantIndex) || item.participantIndex < 1 || item.participantIndex > 6 || !Number.isInteger(item.sequence) || item.sequence < 1 || item.sequence > 4) throw new BadRequestException('Use 1–6 participants and 1–4 sequential services each');
    return { participantIndex: item.participantIndex, sequence: item.sequence, serviceId: numericId(item.serviceId).toString(),
      ...(item.variantId ? { variantId: numericId(item.variantId).toString() } : {}), ...(item.therapistId ? { therapistId: numericId(item.therapistId).toString() } : {}) };
  }).sort((a, b) => a.participantIndex - b.participantIndex || a.sequence - b.sequence);
  const participants = [...new Set(items.map(item => item.participantIndex))];
  if (participants.some((id, i) => id !== i + 1)) throw new BadRequestException('Participant indexes must start at 1 and be consecutive');
  for (const participant of participants) if (items.filter(item => item.participantIndex === participant).some((item, i) => item.sequence !== i + 1)) throw new BadRequestException('Service sequences must be distinct and consecutive for each participant');
  return items;
}
export function tipAmount(value?: number) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 9999999) throw new BadRequestException('Tip must be integer cents from 0 to 9999999');
  return value;
}
export function priceBasis(value: unknown) {
  if (value === undefined || value === null) return 'PER_PERSON';
  if (value !== 'PER_PERSON' && value !== 'PER_BOOKING') throw new BadRequestException('Service price basis needs configuration');
  return value;
}
export function servicePrice(unit: number, count: number, basis: string) { return cents(unit * (priceBasis(basis) === 'PER_PERSON' ? count : 1)); }
export function participantPrices(total: number, count: number) { return Array.from({ length: count }, (_, index) => Math.floor(total / count) + (index < total % count ? 1 : 0)); }

export type PlanSegment = PlanSelection & { offsetMin: number; context: AllocationContext; preferred: string[] };
export type PlanAssignment = { therapistIds: string[]; roomId: string | null; staffWindow: { start: Date; end: Date }; roomWindow: { start: Date; end: Date } };

/** Search across the entire itinerary, rather than greedily assigning the first
 * staff member and making a later segment impossible. Bounded work fails closed. */
export function allocatePlan(segments: PlanSegment[], anchor: Date): PlanAssignment[] | null {
  const candidates = segments.map(segment => {
    const c = segment.context;
    const start = new Date(+anchor + segment.offsetMin * 60000);
    const staffWindow = { start, end: new Date(+start + (c.duration + c.staffBuffer) * 60000) };
    const roomWindow = { start, end: new Date(+start + (c.duration + c.roomBuffer) * 60000) };
    if (overlapsShopBlock(c, staffWindow, roomWindow)) return [];
    if (c.count !== 1 || (c.staffCount ?? c.count) !== 1 || c.legacy.some(b => b.therapistId === null && overlaps(staffWindow, b))) return [];
    const staff = c.therapists.filter(t => (!segment.preferred.length || segment.preferred.includes(t.id)) && coveredBy(t.shifts, staffWindow)
      && !t.timeOff.some(b => overlaps(b, staffWindow)) && !c.locks.some(b => b.type === 'THERAPIST' && b.id === t.id && overlaps(b, staffWindow))
      && !c.legacy.some(b => b.therapistId === t.id && overlaps(b, staffWindow)));
    const rooms: Array<string | null> = c.needsRoom ? c.rooms.filter(r => !r.maintenance.some(b => overlaps(b, roomWindow))
      && !c.locks.some(b => b.type === 'ROOM' && b.id === r.id && overlaps(b, roomWindow)) && !c.legacy.some(b => overlaps(b, roomWindow))).map(r => r.id) : [null];
    return staff.flatMap(t => rooms.map(roomId => ({ therapistIds: [t.id], roomId, staffWindow, roomWindow })));
  });
  if (candidates.some(list => !list.length)) return null;
  const order = segments.map((_, i) => i).sort((a, b) => candidates[a].length - candidates[b].length || segments[a].offsetMin - segments[b].offsetMin || a - b);
  const assigned: Array<PlanAssignment | undefined> = new Array(segments.length);
  let visits = 0;
  function search(depth: number): boolean {
    if (depth === order.length) return true;
    const index = order[depth];
    for (const candidate of candidates[index]) {
      if (++visits > 20000) throw new ServiceUnavailableException('This itinerary requires more allocation work; narrow the service or staff selection');
      if (assigned.some(other => other && (other.therapistIds[0] === candidate.therapistIds[0] && overlaps(other.staffWindow, candidate.staffWindow)
        || other.roomId && other.roomId === candidate.roomId && overlaps(other.roomWindow, candidate.roomWindow)))) continue;
      assigned[index] = candidate;
      if (search(depth + 1)) return true;
      assigned[index] = undefined;
    }
    return false;
  }
  return search(0) ? assigned as PlanAssignment[] : null;
}
