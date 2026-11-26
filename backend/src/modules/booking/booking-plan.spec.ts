import { allocatePlan, normalizePlan, participantPrices, priceBasis, servicePrice, tipAmount } from './booking-plan';
import { AllocationContext } from './availability';
import { quoteCents } from '../payment/money';
import { BookingService } from './booking.service';

const at = (minute: number) => new Date(Date.UTC(2031, 0, 10, 9, minute));
function context(staff: string[], changes: Partial<AllocationContext> = {}): AllocationContext {
  return { count: 1, duration: 30, staffBuffer: 0, roomBuffer: 0, needsRoom: false,
    therapists: staff.map(id => ({ id, shifts: [{ start: at(-60), end: at(300) }], timeOff: [] })), rooms: [], locks: [], legacy: [], ...changes };
}
const segment = (participantIndex: number, staff: string[], offsetMin = 0, changes: Partial<AllocationContext> = {}) => ({ participantIndex, sequence: 1,
  serviceId: '1', offsetMin, context: context(staff, changes), preferred: [] as string[] });

describe('multi-service reservation rules', () => {
  it('rejects a complete itinerary crossing a DST change inside its preparation gap', () => {
    const service = Object.create(BookingService.prototype) as any;
    const plan = { shop: { timezone: 'America/New_York' }, duration: 210, segments: [
      { participantIndex: 1, sequence: 1, offsetMin: 0, preferred: [], c: { duration: 60, windows: [{ open: 30, close: 240 }], allocation: context(['1']) } },
      { participantIndex: 1, sequence: 2, offsetMin: 180, preferred: [], c: { duration: 30, windows: [{ open: 30, close: 240 }], allocation: context(['1']) } },
    ] };
    expect(service.allocateItinerary(plan, '2031-03-09', '00:30')).toBeNull();
    expect(service.allocateItinerary(plan, '2031-11-02', '00:30')).toBeNull();
    // Repeated start minutes also remain an unavailable slot, not an exception
    // that aborts the entire day's availability response.
    expect(service.allocateItinerary({ ...plan, duration: 30 }, '2031-11-02', '01:30')).toBeNull();
  });
  it('normalizes itinerary order without accepting duplicate or missing participant/sequence slots', () => {
    expect(normalizePlan({ shopId: '1', date: '2031-01-10', items: [{ participantIndex: 2, sequence: 1, serviceId: '2' }, { participantIndex: 1, sequence: 1, serviceId: '1' }] }).map(item => item.participantIndex)).toEqual([1, 2]);
    for (const items of [[{ participantIndex: 2, sequence: 1, serviceId: '1' }], [{ participantIndex: 1, sequence: 2, serviceId: '1' }], [{ participantIndex: 1, sequence: 1, serviceId: '1' }, { participantIndex: 1, sequence: 1, serviceId: '1' }]]) expect(() => normalizePlan({ shopId: '1', date: '2031-01-10', items })).toThrow();
  });
  it('caps group size, segment counts and rejects unsafe IDs', () => {
    expect(() => normalizePlan({ shopId: '1', date: '', items: Array.from({ length: 13 }, () => ({ participantIndex: 1, sequence: 1, serviceId: '1' })) })).toThrow();
    expect(() => normalizePlan({ shopId: '1', date: '', items: [{ participantIndex: 7, sequence: 1, serviceId: '1' }] })).toThrow();
    expect(() => normalizePlan({ shopId: '1', date: '', items: [{ participantIndex: 1, sequence: 1, serviceId: '9223372036854775808' }] })).toThrow();
  });
  it('finds a complete assignment where choosing the first available staff greedily would fail', () => {
    const assigned = allocatePlan([segment(1, ['1', '2']), segment(2, ['1'])], at(0));
    expect(assigned?.map(item => item.therapistIds[0])).toEqual(['2', '1']);
  });
  it('rejects multi-staff packages rather than reserving only one employee inside an itinerary', () => {
    expect(allocatePlan([segment(1, ['1', '2'], 0, { count: 1, staffCount: 2 })], at(0))).toBeNull();
    expect(allocatePlan([segment(1, ['1', '2'], 0, { count: 2, staffCount: 2 })], at(0))).toBeNull();
  });
  it('never uses the same employee for overlapping parallel participants', () => {
    expect(allocatePlan([segment(1, ['1']), segment(2, ['1'])], at(0))).toBeNull();
  });
  it('permits sequential reuse only after staff buffers finish', () => {
    const first = segment(1, ['1'], 0, { staffBuffer: 15 });
    expect(allocatePlan([first, { ...segment(1, ['1'], 30), sequence: 2 }], at(0))).toBeNull();
    expect(allocatePlan([first, { ...segment(1, ['1'], 45), sequence: 2 }], at(0))).not.toBeNull();
  });
  it('respects room exclusivity, maintenance and distinct-resource parallel allocation', () => {
    const room = { needsRoom: true, rooms: [{ id: '10', maintenance: [] }] };
    expect(allocatePlan([segment(1, ['1'], 0, room), segment(2, ['2'], 0, room)], at(0))).toBeNull();
    expect(allocatePlan([segment(1, ['1'], 0, { needsRoom: true, rooms: [{ id: '10', maintenance: [{ start: at(0), end: at(30) }] }] })], at(0))).toBeNull();
  });
  it('does not bypass existing resource locks, leave, shifts or unknown historical staff', () => {
    const blocks: Partial<AllocationContext>[] = [
      { locks: [{ type: 'THERAPIST', id: '1', start: at(0), end: at(30) }] },
      { legacy: [{ therapistId: null, start: at(0), end: at(30) }] },
      { therapists: [{ id: '1', shifts: [{ start: at(15), end: at(90) }], timeOff: [] }] },
      { therapists: [{ id: '1', shifts: [{ start: at(0), end: at(90) }], timeOff: [{ start: at(0), end: at(30) }] }] },
    ];
    blocks.forEach(block => expect(allocatePlan([segment(1, ['1'], 0, block)], at(0))).toBeNull());
  });
  it('honors an explicit per-segment staff preference', () => {
    expect(allocatePlan([{ ...segment(1, ['1', '2']), preferred: ['2'] }], at(0))?.[0].therapistIds).toEqual(['2']);
    expect(allocatePlan([{ ...segment(1, ['1']), preferred: ['2'] }], at(0))).toBeNull();
  });
  it('keeps total-package prices fixed and allocates odd cents without creating money', () => {
    expect(servicePrice(10001, 2, 'PER_PERSON')).toBe(20002);
    expect(servicePrice(10001, 2, 'PER_BOOKING')).toBe(10001);
    expect(participantPrices(10001, 2)).toEqual([5001, 5000]);
    expect(() => priceBasis('unknown')).toThrow();
  });
  it('never lets a service coupon discount the tip or turn a nonzero tip into zero settlement', () => {
    expect(quoteCents(10000, 10000, 0, 1500).totalCents).toBe(1500);
    expect(quoteCents(10000, 2000, 100, 1500).totalCents).toBe(9600);
    for (const value of [-1, 1.2, 10000000, NaN]) expect(() => tipAmount(value)).toThrow();
    expect(tipAmount(undefined)).toBe(0);
  });
});
