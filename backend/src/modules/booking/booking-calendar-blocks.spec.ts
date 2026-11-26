import { allocate, AllocationContext } from './availability';
import { allocatePlan } from './booking-plan';

const at = (minute: number) => new Date(Date.UTC(2035, 0, 1, 9, minute));
function context(patch: Partial<AllocationContext> = {}): AllocationContext {
  return { count: 1, staffCount: 1, duration: 60, staffBuffer: 15, roomBuffer: 30, needsRoom: true,
    therapists: ['1', '2'].map(id => ({ id, shifts: [{ start: at(-60), end: at(600) }], timeOff: [] })),
    rooms: [{ id: '3', maintenance: [] }], legacy: [], locks: [], shopBlocks: [], ...patch };
}
const segment = (c: AllocationContext, offsetMin = 0, sequence = 1) => ({ participantIndex: 1, sequence, serviceId: '1', offsetMin, context: c, preferred: [] });

describe('true SHOP blocks protect shared reservation allocation', () => {
  test.each([1, 2])('blocks every assignment for a %i-guest service, including four hands', count => {
    for (const staffCount of [1, 2]) {
      const c = context({ count, staffCount, shopBlocks: [{ start: at(15), end: at(45) }] });
      expect(allocate(c, at(0), [])).toBeNull();
    }
  });
  test.each([60, 74, 89])('also protects staff/room preparation at minute %i', minute => {
    const c = context({ shopBlocks: [{ start: at(minute), end: at(minute + 1) }] });
    expect(allocate(c, at(0), [])).toBeNull();
    expect(allocatePlan([segment(c)], at(0))).toBeNull();
  });
  test('uses half-open endpoints and ignores an unused room buffer', () => {
    const c = context({ shopBlocks: [{ start: at(90), end: at(120) }, { start: at(-30), end: at(0) }] });
    expect(allocate(c, at(0), [])).not.toBeNull();
    c.shopBlocks = [{ start: at(75), end: at(90) }]; c.needsRoom = false;
    expect(allocate(c, at(0), [])).not.toBeNull();
    expect(allocatePlan([segment(c)], at(0))).not.toBeNull();
  });
  test('checks every later itinerary segment, not just its anchor', () => {
    const c = context({ needsRoom: false, shopBlocks: [{ start: at(150), end: at(160) }] });
    expect(allocatePlan([segment(c)], at(0))).not.toBeNull();
    expect(allocatePlan([segment(c), segment(c, 90, 2)], at(0))).toBeNull();
  });
  test('a therapist block leaves another staff member available but prevents four hands', () => {
    const c = context(); c.therapists[0].timeOff = [{ start: at(0), end: at(120) }];
    expect(allocate(c, at(0), [])?.therapistIds).toEqual(['2']);
    c.staffCount = 2; expect(allocate(c, at(0), [])).toBeNull();
  });
});
