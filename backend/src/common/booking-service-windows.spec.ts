import { ConflictException } from '@nestjs/common';
import { storedBookingServiceWindows } from './booking-service-windows';
import { BookingService } from '../modules/booking/booking.service';
import { ensureShopBookingSettings, ensureShopConfiguration } from '../modules/reservations/configuration-guard';

const at = (time: string) => new Date('2040-10-29T' + time + ':00Z');
const periods = [{ open: 540, close: 600 }, { open: 660, close: 720 }];
function fixture() {
  const item = (id: bigint, sequence: number, offsetMin: number, start: string, end: string, roomBufferMin: number) => ({ id, bookingId: 100n,
    participantIndex: 1, sequence, offsetMin, requiredStaffCountSnapshot: 1, durationMin: 60, staffBufferMin: 0, roomBufferMin, startAtUtc: at(start), endAtUtc: at(end) });
  const booking: any = { id: 100n, reservationKind: 'PLAN', participantCountSnapshot: 1, durationMin: 180, startTime: at('09:00'), endTime: at('12:00'),
    items: [item(1000n, 1, 0, '09:00', '10:00', 60), item(1001n, 2, 120, '11:00', '12:00', 0)] };
  const shop = { id: 10n, timezone: 'UTC', businessHours: { monday: [{ open: '09:00', close: '10:00' }, { open: '11:00', close: '12:00' }] } };
  const staffShifts = [{ start: at('09:00'), end: at('10:00') }, { start: at('11:00'), end: at('12:00') }];
  const plan: any = { shop, shopBookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [] }, duration: 180, segments: booking.items.map((row: any) => ({ participantIndex: 1, sequence: row.sequence, offsetMin: row.offsetMin,
    c: { duration: 60, windows: periods, preferred: [], allocation: { count: 1, staffCount: 1, duration: 60, staffBuffer: 0, roomBuffer: row.roomBufferMin, needsRoom: true,
      therapists: [{ id: '8', shifts: staffShifts, timeOff: [] }], rooms: [{ id: '40', maintenance: [] }], locks: [], legacy: [] } } })) };
  const service = Object.create(BookingService.prototype) as any;
  const allocation = service.allocateItinerary(plan, '2040-10-29', '09:00');
  const locks = allocation?.allocation.flatMap((row: any) => [
    { resourceType: 'THERAPIST', resourceId: 8n, startAtUtc: row.staffWindow.start, endAtUtc: row.staffWindow.end },
    { resourceType: 'ROOM', resourceId: 40n, startAtUtc: row.roomWindow.start, endAtUtc: row.roomWindow.end },
  ]) ?? [];
  const tx: any = { booking: { findMany: jest.fn(async () => [booking]) }, shopCalendarBlock: { findMany: async () => [], findFirst: async () => null }, bookingResourceLock: { findMany: jest.fn(async () => locks) },
    therapist: { findMany: jest.fn(async () => [{ id: 8n, scheduleMode: 'SHOP' }]) } };
  return { booking, shop, staffShifts, plan, service, allocation, locks, tx };
}

describe('complete stored PLAN service bodies for shop opening changes', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2040-10-01T00:00:00Z')); });
  afterEach(() => { jest.useRealTimers(); });
  test.each([60, 75, 120])('a no-room snapshot preserves only the recorded current or legacy preparation gap (offset %i)', offset => {
    const f = fixture();
    Object.assign(f.booking, { durationMin: offset + 60, endTime: at(offset === 60 ? '11:00' : offset === 75 ? '11:15' : '12:00') });
    Object.assign(f.booking.items[0], { roomTypeSnapshot: null, staffBufferMin: offset === 75 ? 15 : 0 });
    Object.assign(f.booking.items[1], { roomTypeSnapshot: null, offsetMin: offset,
      startAtUtc: at(offset === 60 ? '10:00' : offset === 75 ? '10:15' : '11:00'), endAtUtc: f.booking.endTime });
    const before = structuredClone(f.booking);
    expect(storedBookingServiceWindows(f.booking)).toEqual(f.booking.items.map((item: any) => ({ startTime: item.startAtUtc, endTime: item.endAtUtc })));
    expect(f.booking).toEqual(before);
  });
  test.each(['unexplainedGap', 'overlap', 'sequence'])('no-room compatibility never accepts %s as a valid stored itinerary', change => {
    const f = fixture();
    for (const item of f.booking.items) item.roomTypeSnapshot = null;
    const offset = change === 'overlap' ? 30 : 90;
    Object.assign(f.booking.items[1], { offsetMin: offset, sequence: change === 'sequence' ? 3 : 2,
      startAtUtc: at(change === 'overlap' ? '09:30' : '10:30'), endAtUtc: at(change === 'overlap' ? '10:30' : '11:30') });
    Object.assign(f.booking, { durationMin: offset + 60, endTime: f.booking.items[1].endAtUtc });
    expect(storedBookingServiceWindows(f.booking)).toEqual([{ startTime: f.booking.startTime, endTime: f.booking.endTime }]);
  });
  test.each(['SINGLE', undefined])('a required or unknown room snapshot (%s) cannot omit its saved cleanup gap', roomTypeSnapshot => {
    const f = fixture();
    Object.assign(f.booking, { durationMin: 120, endTime: at('11:00') });
    Object.assign(f.booking.items[0], { roomTypeSnapshot });
    Object.assign(f.booking.items[1], { roomTypeSnapshot, offsetMin: 60, startAtUtc: at('10:00'), endAtUtc: at('11:00') });
    expect(storedBookingServiceWindows(f.booking)).toEqual([{ startTime: f.booking.startTime, endTime: f.booking.endTime }]);
  });
  test('the real configuration queries read room snapshots and protect actual service bodies without reintroducing a phantom gap', async () => {
    const f = fixture();
    Object.assign(f.booking, { durationMin: 135, endTime: at('11:15') });
    Object.assign(f.booking.items[0], { roomTypeSnapshot: null, staffBufferMin: 15 });
    Object.assign(f.booking.items[1], { roomTypeSnapshot: null, offsetMin: 75, startAtUtc: at('10:15'), endAtUtc: at('11:15') });
    f.locks.splice(0);
    f.tx.booking.findMany.mockImplementation(async ({ select }: any) => [{ ...f.booking, items: f.booking.items.map((item: any) =>
      Object.fromEntries(Object.keys(select.items.select).map(field => [field, item[field]]))) }]);
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours: { monday: [{ open: '09:00', close: '10:00' }, { open: '10:15', close: '11:15' }] } })).resolves.toBeUndefined();
    expect(f.tx.booking.findMany.mock.calls[0][0].select.items.select.roomTypeSnapshot).toBe(true);
    await expect(ensureShopBookingSettings(f.tx, f.shop, { minimumNoticeMinutes: 0, closedPeriods: [{ startDate: '2040-10-30', endDate: '2040-10-30' }] })).resolves.toBeUndefined();
    expect(f.tx.booking.findMany.mock.calls[1][0].select.items.select.roomTypeSnapshot).toBe(true);
  });
  test('actual allocator permits room cleanup across lunch and reuse at11, and harmless opening extension stays valid', async () => {
    const f = fixture(); expect(f.allocation).not.toBeNull();
    expect(f.allocation.allocation.map((row: any) => [row.therapistIds, row.roomId])).toEqual([[['8'], '40'], [['8'], '40']]);
    expect(f.allocation.allocation[0].roomWindow.end).toEqual(at('11:00'));
    expect(f.allocation.allocation[0].staffWindow.end).toEqual(at('10:00'));
    expect(storedBookingServiceWindows(f.booking)).toEqual([{ startTime: at('09:00'), endTime: at('10:00') }, { startTime: at('11:00'), endTime: at('12:00') }]);
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours: { monday: [{ open: '08:00', close: '10:00' }, { open: '11:00', close: '12:00' }] } })).resolves.toBeUndefined();
    expect(f.tx.booking.findMany.mock.calls[0][0].select.items.select).toHaveProperty('offsetMin', true);
  });
  test('SHOP staff buffer across a real closure is still impossible and protected even with complete stored segments', async () => {
    const f = fixture(); f.plan.segments[0].c.allocation.staffBuffer = 15;
    expect(f.service.allocateItinerary(f.plan, '2040-10-29', '09:00')).toBeNull();
    f.booking.items[0].staffBufferMin = 15; f.locks[0].endAtUtc = at('10:15');
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours: { monday: [{ open: '08:00', close: '10:00' }, { open: '11:00', close: '12:00' }] } })).rejects.toThrow('收尾缓冲');
  });
  test('harmless adjoining period boundaries do not strand an existing whole service or itinerary segment', async () => {
    const f = fixture(), businessHours = { monday: [{ open: '08:00', close: '09:30' }, { open: '09:30', close: '12:00' }] };
    // The first PLAN service crosses 09:30; the ordinary historical fallback
    // crosses the same boundary. Neither crosses an actual closed minute.
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours })).resolves.toBeUndefined();
    f.booking.reservationKind = 'SINGLE';
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours })).resolves.toBeUndefined();
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours: { monday: [{ open: '08:00', close: '09:30' }, { open: '09:31', close: '12:00' }] } })).rejects.toThrow(ConflictException);
  });
  test('custom staff cleanup does not erase the requirement that each actual service body stays inside continuous opening time', async () => {
    const f = fixture(); f.tx.therapist.findMany.mockResolvedValue([{ id: 8n, scheduleMode: 'CUSTOM' }]);
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours: { monday: [{ open: '08:00', close: '09:45' }, { open: '11:00', close: '12:00' }] } })).rejects.toThrow('已有预约');
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours: { monday: [{ open: '08:00', close: '10:00' }, { open: '11:00', close: '11:45' }] } })).rejects.toThrow('已有预约');
  });
  test.each(['missingItems', 'missingLast', 'missingParticipant', 'wrongOwner', 'wrongDuration', 'wrongOffset', 'missingSequence', 'duplicateId', 'missingBuffer', 'ordinary'])('incomplete or historical %s records retain conservative whole-window protection', async change => {
    const f = fixture();
    if (change === 'missingItems') delete f.booking.items;
    if (change === 'missingLast') f.booking.items.pop();
    if (change === 'missingParticipant') f.booking.participantCountSnapshot = 2;
    if (change === 'wrongOwner') f.booking.items[1].bookingId = 101n;
    if (change === 'wrongDuration') f.booking.items[0].durationMin = 30;
    if (change === 'wrongOffset') f.booking.items[1].offsetMin = 90;
    if (change === 'missingSequence') f.booking.items[1].sequence = 3;
    if (change === 'duplicateId') f.booking.items[1].id = f.booking.items[0].id;
    if (change === 'missingBuffer') delete f.booking.items[0].roomBufferMin;
    if (change === 'ordinary') f.booking.reservationKind = 'SINGLE';
    expect(storedBookingServiceWindows(f.booking)).toEqual([{ startTime: at('09:00'), endTime: at('12:00') }]);
    await expect(ensureShopConfiguration(f.tx, f.shop, { businessHours: { monday: [{ open: '08:00', close: '10:00' }, { open: '11:00', close: '12:00' }] } })).rejects.toThrow(ConflictException);
  });
  test('timezone changes remain blocked for the complete itinerary without modifying saved segments or locks', async () => {
    const f = fixture(), before = structuredClone({ booking: f.booking, locks: f.locks });
    await expect(ensureShopConfiguration(f.tx, f.shop, { timezone: 'America/New_York' })).rejects.toThrow('预约时区');
    expect({ booking: f.booking, locks: f.locks }).toEqual(before);
  });
});
