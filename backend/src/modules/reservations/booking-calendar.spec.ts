import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { BookingCalendarService, calendarDayBoundary, MAX_CALENDAR_EVENTS } from './booking-calendar.service';
import { parseBookingCalendarQuery } from './booking-calendar.dto';
import { BookingCalendarController } from './booking-calendar.controller';

const actor = { id: '2', role: 'MERCHANT' };
const range = { startDate: '2030-01-15', endDate: '2030-01-16' };
const date = (time: string) => new Date(time);
function booking(id: number, overrides: Record<string, unknown> = {}): any {
  return { id: BigInt(id), status: 'CONFIRMED', deletedAt: null, startTime: date('2030-01-15T17:00:00Z'), endTime: date('2030-01-15T18:00:00Z'),
    paymentStatus: 'UNPAID', paidCents: 0, holdExpiresAt: null, therapistId: 20n, service: { name: 'Massage' }, _count: { items: 0 }, items: [], resourceLocks: [],
    contactName: 'DO NOT PROJECT', contactEmail: 'private@example.test', contactPhone: '+15555555555', notes: 'PRIVATE', bookingNo: 'SECRET', ...overrides };
}
function fixture() {
  const state: any = { bookings: [], therapists: [{ id: 20n, name: 'Therapist A' }, { id: 21n, name: 'Therapist B' }], rooms: [{ id: 30n, name: 'Room A' }],
    timeOff: [], maintenance: [], blocks: [], closedPeriods: [], timezone: 'America/Los_Angeles', active: true, permissions: ['BOOKINGS_READ'], grantStatus: 'ACTIVE' };
  const tx: any = {
    user: { findFirst: jest.fn(async ({ where }: any) => state.active && ['1', '2', '3'].includes(String(where.id)) ? { id: where.id } : null) },
    shop: { findFirst: jest.fn(async () => ({ id: 10n, deletedAt: null, status: 'PUBLISHED', timezone: state.timezone,
      studioProfile: { bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: state.closedPeriods } },
      loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } } })) },
    shopStaffGrant: { findUnique: jest.fn(async () => ({ status: state.grantStatus, permissions: state.permissions })) },
    booking: { findMany: jest.fn(async () => state.bookings) },
    bookingItem: { findMany: jest.fn(async () => state.items ?? state.bookings.flatMap((row: any) => row.items.map((item: any) => ({ ...item, bookingId: row.id })))) },
    bookingResourceLock: { findMany: jest.fn(async () => state.resourceLocks ?? state.bookings.flatMap((row: any) => row.resourceLocks.map((lock: any) => ({ shopId: 10n, ...lock, bookingId: row.id })))) },
    therapist: { findMany: jest.fn(async () => state.therapists) }, shopRoom: { findMany: jest.fn(async () => state.rooms) },
    therapistTimeOff: { findMany: jest.fn(async () => state.timeOff) }, roomMaintenance: { findMany: jest.fn(async () => state.maintenance) },
    shopCalendarBlock: { findMany: jest.fn(async () => state.blocks) },
  };
  const prisma: any = { $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)) };
  return { state, tx, prisma, service: new BookingCalendarService(prisma) };
}

function crossMidnightFixture(buffered: 'THERAPIST' | 'ROOM', bufferEnd = '2030-01-15T08:30:00Z') {
  const f = fixture(), startAtUtc = date('2030-01-15T07:00:00Z'), endAtUtc = date('2030-01-15T07:30:00Z');
  const item = { id: 1n, serviceNameSnapshot: 'Late service', startAtUtc, endAtUtc, assignedTherapistId: 20n, assignedRoomId: 30n };
  f.state.bookings = [booking(1, { startTime: startAtUtc, endTime: endAtUtc, _count: { items: 1 }, items: [item],
    resourceLocks: (['THERAPIST', 'ROOM'] as const).map((resourceType, index) => ({ id: BigInt(index + 1), bookingItemId: item.id,
      resourceType, resourceId: resourceType === 'THERAPIST' ? 20n : 30n, startAtUtc,
      endAtUtc: resourceType === buffered ? date(bufferEnd) : endAtUtc })) })];
  // Unlike the general fixtures, emulate the DB's requested half-open range:
  // the ended resource lock must not be returned with the other cleanup lock.
  f.tx.bookingResourceLock.findMany.mockImplementation(async ({ where }: any) => f.state.bookings.flatMap((row: any) => row.resourceLocks
    .filter((lock: any) => lock.startAtUtc < where.startAtUtc.lt && lock.endAtUtc > where.endAtUtc.gt)
    .map((lock: any) => ({ shopId: 10n, ...lock, bookingId: row.id }))));
  return f;
}

describe('booking calendar strict local-date query', () => {
  test.each([
    {}, { ...range, startDate: '2030-02-30' }, { ...range, endDate: range.startDate }, { startDate: '2030-01-01', endDate: '2030-02-13' },
    { ...range, pageSize: '101' }, { ...range, pageSize: '0' }, { ...range, pageSize: '1.0' }, { ...range, pageSize: ['1'] },
    { ...range, resourceType: 'THERAPIST' }, { ...range, resourceId: '20' }, { ...range, resourceType: 'SHOP', resourceId: '20' },
    { ...range, resourceType: 'ROOM', resourceId: '0' }, { ...range, status: 'WRONG' }, { ...range, cursor: 'bad=' },
    { ...range, startDate: ['2030-01-15'] }, { ...range, contactEmail: 'private@example.test' },
  ])('rejects malformed or excessive input (%j)', value => expect(() => parseBookingCalendarQuery(value)).toThrow(BadRequestException));
  test('accepts exactly six local weeks and a bounded explicit page size', () => {
    expect(parseBookingCalendarQuery({ startDate: '2030-01-01', endDate: '2030-02-12', pageSize: '25' })).toEqual({ startDate: '2030-01-01', endDate: '2030-02-12', pageSize: 25 });
  });
  test.each([
    ['2026-03-08', '2026-03-09', 'America/New_York', 23], ['2026-11-01', '2026-11-02', 'America/New_York', 25],
    ['2026-03-08', '2026-03-09', 'America/Havana', 23], ['2026-11-01', '2026-11-02', 'America/Havana', 25],
  ])('uses actual day boundaries %s %s %s (%i hours)', (start, end, zone, hours) => {
    expect((+calendarDayBoundary(end, zone) - +calendarDayBoundary(start, zone)) / 3600000).toBe(hours);
  });
  test('rejects a completely skipped date and invalid IANA timezone', () => {
    expect(() => calendarDayBoundary('2011-12-30', 'Pacific/Apia')).toThrow(BadRequestException);
    expect(() => calendarDayBoundary('2030-01-15', 'Missing/Zone')).toThrow(BadRequestException);
  });
});

describe('complete booking calendar projection', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2030-01-01T00:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  test('uses BOOKING_READ current database authority and a read-only repeatable snapshot', async () => {
    const f = fixture();
    await f.service.events('10', actor, range);
    expect(f.prisma.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'RepeatableRead' });
    expect(f.tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } }));
    f.state.active = false;
    await expect(f.service.events('10', actor, range)).rejects.toThrow(ForbiddenException);
  });
  test('read-only staff can view but revoked/missing read grants cannot', async () => {
    const f = fixture(), staff = { id: '3', role: 'STAFF' };
    await expect(f.service.events('10', staff, range)).resolves.toMatchObject({ complete: true });
    f.state.permissions = [];
    await expect(f.service.events('10', staff, range)).rejects.toThrow(ForbiddenException);
    f.state.permissions = ['BOOKINGS_READ']; f.state.grantStatus = 'REVOKED';
    await expect(f.service.events('10', staff, range)).rejects.toThrow(ForbiddenException);
  });
  test('all queries are shop-scoped half-open instant windows with explicit row ceilings', async () => {
    const f = fixture(); f.state.bookings = [booking(1)]; await f.service.events('10', actor, range);
    const query = f.tx.booking.findMany.mock.calls[0][0];
    expect(query.take).toBe(MAX_CALENDAR_EVENTS + 1);
    expect(query.where.shopId).toBe(10n);
    expect(query.where.OR[0]).toEqual({ deletedAt: null, startTime: { lt: date('2030-01-16T08:00:00Z') }, endTime: { gt: date('2030-01-15T08:00:00Z') } });
    expect(query.where.OR[2].resourceLocks.some).toMatchObject({ status: 'ACTIVE', startAtUtc: { lt: date('2030-01-16T08:00:00Z') }, endAtUtc: { gt: date('2030-01-15T08:00:00Z') } });
    expect(query.select.contactName).toBeUndefined(); expect(query.select.user).toBeUndefined(); expect(query.select.notes).toBeUndefined();
    expect(query.select.items).toBeUndefined(); expect(query.select.resourceLocks).toBeUndefined();
    expect(f.tx.bookingItem.findMany.mock.calls[0][0]).toMatchObject({ take: MAX_CALENDAR_EVENTS + 1, where: { bookingId: { in: [1n] } } });
    expect(f.tx.bookingResourceLock.findMany.mock.calls[0][0]).toMatchObject({ take: MAX_CALENDAR_EVENTS + 1, where: { bookingId: { in: [1n] }, status: 'ACTIVE' } });
    expect(f.tx.therapistTimeOff.findMany.mock.calls[0][0].where.therapist.shopId).toBe(10n);
    expect(f.tx.roomMaintenance.findMany.mock.calls[0][0].where.room.shopId).toBe(10n);
  });
  test('projects managed resource occupancy once and hides private block details from read-only staff', async () => {
    const f = fixture(), startAtUtc = date('2030-01-15T17:00:00Z'), endAtUtc = date('2030-01-15T18:00:00Z');
    f.state.timeOff = [{ id: 50n, therapistId: 20n, startAtUtc, endAtUtc }];
    f.state.maintenance = [{ id: 51n, roomId: 30n, startAtUtc, endAtUtc }];
    f.state.blocks = [
      { id: 60n, scope: 'THERAPIST', resourceId: 20n, purpose: 'INTERNAL_OCCUPANCY', startAtUtc, endAtUtc, timeOffId: 50n, maintenanceId: null, reason: 'SECRET REASON', operatorId: 2n },
      { id: 61n, scope: 'ROOM', resourceId: 30n, purpose: 'TIME_BLOCK', startAtUtc, endAtUtc, timeOffId: null, maintenanceId: 51n },
      { id: 62n, scope: 'SHOP', resourceId: null, purpose: 'TIME_BLOCK', startAtUtc, endAtUtc, timeOffId: null, maintenanceId: null },
    ];
    const page = await f.service.events('10', { id: '3', role: 'STAFF' }, range);
    expect(page.events).toHaveLength(3);
    expect(page.events[0]).toMatchObject({ id: 'calendar-block:60', blockId: '60', eventType: 'INTERNAL_OCCUPANCY', bookingId: null, resources: [{ type: 'THERAPIST', id: '20' }] });
    expect(page.events[1]).toMatchObject({ blockId: '61', eventType: 'TIME_BLOCK', resources: [{ type: 'ROOM', id: '30' }] });
    expect(page.events[2]).toMatchObject({ blockId: '62', resources: [] });
    expect(JSON.stringify(page)).not.toMatch(/SECRET|operatorId|reason/);
    expect(f.tx.shopCalendarBlock.findMany.mock.calls[0][0]).toMatchObject({ where: { shopId: 10n, status: 'ACTIVE' }, take: MAX_CALENDAR_EVENTS + 1 });
    expect(f.tx.shopCalendarBlock.findMany.mock.calls[0][0].select.reason).toBeUndefined();
    const filtered = await f.service.events('10', actor, { ...range, resourceType: 'THERAPIST', resourceId: '21' });
    expect(filtered.events.map(row => row.blockId)).toEqual(['62']);
  });
  test.each(['missing', 'changed-resource', 'changed-time', 'wrong-scope'])('fails closed when managed backing is inconsistent (%s)', async change => {
    const f = fixture(), startAtUtc = date('2030-01-15T17:00:00Z'), endAtUtc = date('2030-01-15T18:00:00Z');
    f.state.timeOff = [{ id: 50n, therapistId: 20n, startAtUtc, endAtUtc }];
    f.state.blocks = [{ id: 60n, scope: 'THERAPIST', resourceId: 20n, purpose: 'TIME_BLOCK', startAtUtc, endAtUtc, timeOffId: 50n, maintenanceId: null }];
    if (change === 'missing') f.state.timeOff = [];
    if (change === 'changed-resource') f.state.timeOff[0].therapistId = 21n;
    if (change === 'changed-time') f.state.timeOff[0].endAtUtc = date('2030-01-15T18:01:00Z');
    if (change === 'wrong-scope') f.state.blocks[0].scope = 'SHOP';
    await expect(f.service.events('10', actor, range)).rejects.toThrow(ServiceUnavailableException);
  });
  test('returns all 251 events by stable bounded pages and no customer identifiers', async () => {
    const f = fixture(); f.state.bookings = Array.from({ length: 251 }, (_, index) => booking(index + 1));
    const pages: any[] = []; let cursor: string | undefined;
    do { const page = await f.service.events('10', actor, { ...range, pageSize: '100', ...(cursor ? { cursor } : {}) }); pages.push(page); cursor = page.nextCursor ?? undefined; } while (cursor);
    expect(pages.map(page => page.events.length)).toEqual([100, 100, 51]);
    expect(new Set(pages.flatMap(page => page.events.map((event: any) => event.id))).size).toBe(251);
    expect(new Set(pages.map(page => page.version)).size).toBe(1);
    expect(pages.map(page => page.complete)).toEqual([false, false, true]);
    expect(JSON.stringify(pages)).not.toMatch(/DO NOT PROJECT|private@example|15555555555|PRIVATE|SECRET|contactName|bookingNo/);
  });
  test.each(['status', 'title', 'resources', 'removed', 'timezone'])('rejects a changed range after page one (%s)', async change => {
    const f = fixture(); f.state.bookings = [booking(1), booking(2)];
    const first = await f.service.events('10', actor, { ...range, pageSize: '1' });
    if (change === 'status') f.state.bookings[1].status = 'CANCELLED';
    if (change === 'title') f.state.bookings[1].service.name = 'Updated massage';
    if (change === 'resources') f.state.therapists[0].name = 'New name';
    if (change === 'removed') f.state.bookings = [];
    if (change === 'timezone') f.state.timezone = 'America/New_York';
    await expect(f.service.events('10', actor, { ...range, pageSize: '1', cursor: first.nextCursor! })).rejects.toMatchObject({ response: { code: 'CALENDAR_RANGE_CHANGED' } });
  });
  test('cursor cannot be silently reused for a different range, filter or actor', async () => {
    const f = fixture(); f.state.bookings = [booking(1), booking(2)];
    const first = await f.service.events('10', actor, { ...range, pageSize: '1' });
    await expect(f.service.events('10', actor, { ...range, endDate: '2030-01-17', cursor: first.nextCursor! })).rejects.toThrow(ConflictException);
    await expect(f.service.events('10', actor, { ...range, status: 'CONFIRMED', cursor: first.nextCursor! })).rejects.toThrow(ConflictException);
    await expect(f.service.events('10', { id: '1', role: 'ADMIN' }, { ...range, cursor: first.nextCursor! })).rejects.toThrow(ConflictException);
  });
  test('hold expiry between pages invalidates a previously occupied projection', async () => {
    const f = fixture(); f.state.bookings = [booking(1, { status: 'PENDING', holdExpiresAt: date('2030-01-01T00:01:00Z') }), booking(2)];
    const first = await f.service.events('10', actor, { ...range, pageSize: '1' });
    jest.setSystemTime(new Date('2030-01-01T00:02:00Z'));
    await expect(f.service.events('10', actor, { ...range, cursor: first.nextCursor! })).rejects.toMatchObject({ response: { code: 'CALENDAR_RANGE_CHANGED' } });
    const latest = await f.service.events('10', actor, range);
    expect(latest.events.find(row => row.bookingId === '1')).toMatchObject({ expiredHold: true, occupiesResources: false, occupancySource: 'NONE' });
  });
  test('previous-day service remains visible on actual next-day active resource buffer', async () => {
    const f = fixture(); f.state.bookings = [booking(1, { startTime: date('2030-01-15T06:00:00Z'), endTime: date('2030-01-15T07:00:00Z'),
      resourceLocks: [{ id: 50n, bookingItemId: null, resourceType: 'THERAPIST', resourceId: 20n, startAtUtc: date('2030-01-15T06:00:00Z'), endAtUtc: date('2030-01-15T08:30:00Z') }] })];
    const page = await f.service.events('10', actor, range);
    expect(page.events[0]).toMatchObject({ serviceEndAt: '2030-01-15T07:00:00.000Z', endAt: '2030-01-15T08:30:00.000Z', occupiesResources: true,
      resources: [{ type: 'THERAPIST', id: '20', startAt: '2030-01-15T06:00:00.000Z', endAt: '2030-01-15T08:30:00.000Z' }] });
  });
  test.each(['ROOM', 'THERAPIST'] as const)('next-day %s cleanup never projects the already-ended other resource', async buffered => {
    const f = crossMidnightFixture(buffered), other = buffered === 'ROOM' ? 'THERAPIST' : 'ROOM';
    const resourceId = buffered === 'ROOM' ? '30' : '20', otherId = buffered === 'ROOM' ? '20' : '30';
    const page = await f.service.events('10', actor, range);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({ occupiesResources: true, occupancySource: 'ACTIVE_LOCKS',
      serviceEndAt: '2030-01-15T07:30:00.000Z', endAt: '2030-01-15T08:30:00.000Z' });
    expect(page.events[0].resources).toEqual([{ type: buffered, id: resourceId, name: buffered === 'ROOM' ? 'Room A' : 'Therapist A',
      startAt: '2030-01-15T07:00:00.000Z', endAt: '2030-01-15T08:30:00.000Z' }]);
    expect((await f.service.events('10', actor, { ...range, resourceType: other, resourceId: otherId })).events).toEqual([]);
    expect((await f.service.events('10', actor, { ...range, resourceType: buffered, resourceId })).events).toHaveLength(1);
  });
  test.each(['ROOM', 'THERAPIST'] as const)('%s cleanup respects the exact next-day half-open boundary', async buffered => {
    const f = crossMidnightFixture(buffered, '2030-01-15T08:00:00Z');
    expect((await f.service.events('10', actor, range)).events).toEqual([]);
    const lock = f.state.bookings[0].resourceLocks.find((row: any) => row.resourceType === buffered);
    lock.endAtUtc = date('2030-01-15T08:00:00.001Z');
    const page = await f.service.events('10', actor, range);
    expect(page.events).toHaveLength(1);
    expect(page.events[0].resources.map(row => row.type)).toEqual([buffered]);
    expect(page.events[0].endAt).toBe('2030-01-15T08:00:00.001Z');
  });
  test('cross-midnight buffer pages remain consistent over the full 42-local-day range', async () => {
    const f = crossMidnightFixture('ROOM'), first = f.state.bookings[0];
    f.state.bookings.push({ ...first, id: 2n, items: [{ ...first.items[0], id: 2n }],
      resourceLocks: first.resourceLocks.map((lock: any) => ({ ...lock, id: lock.id + 2n, bookingItemId: 2n })) });
    const query = { startDate: '2030-01-15', endDate: '2030-02-26', pageSize: '1' };
    const a = await f.service.events('10', actor, query);
    const b = await f.service.events('10', actor, { ...query, cursor: a.nextCursor! });
    expect(a.complete).toBe(false); expect(b.complete).toBe(true); expect(a.version).toBe(b.version);
    expect([a, b].flatMap(page => page.events.map(event => event.bookingId))).toEqual(['1', '2']);
    expect([a, b].flatMap(page => page.events).every(event => event.resources.length === 1 && event.resources[0].type === 'ROOM')).toBe(true);
  });
  test('a no-lock cross-midnight legacy booking retains conservative resource filtering', async () => {
    const f = fixture(); f.state.bookings = [booking(1, { therapistId: null,
      startTime: date('2030-01-15T07:30:00Z'), endTime: date('2030-01-15T08:30:00Z') })];
    for (const filter of [{ resourceType: 'THERAPIST', resourceId: '21' }, { resourceType: 'ROOM', resourceId: '30' }]) {
      const page = await f.service.events('10', actor, { ...range, ...filter });
      expect(page.events).toHaveLength(1);
      expect(page.events[0]).toMatchObject({ occupancySource: 'LEGACY_SERVICE', occupiesResources: true, resources: [] });
    }
  });
  test('a terminal item without active locks retains historical identities without occupation', async () => {
    const f = fixture(), startAtUtc = date('2030-01-15T17:00:00Z'), endAtUtc = date('2030-01-15T18:00:00Z');
    f.state.bookings = [booking(1, { status: 'COMPLETED', _count: { items: 1 }, items: [{ id: 1n, serviceNameSnapshot: 'Saved service',
      startAtUtc, endAtUtc, assignedTherapistId: 20n, assignedRoomId: 30n }] })];
    const page = await f.service.events('10', actor, range);
    expect(page.events[0]).toMatchObject({ occupancySource: 'NONE', occupiesResources: false });
    expect(page.events[0].resources).toEqual([{ type: 'ROOM', id: '30', name: 'Room A' }, { type: 'THERAPIST', id: '20', name: 'Therapist A' }]);
    expect((await f.service.events('10', actor, { ...range, resourceType: 'THERAPIST', resourceId: '20' })).events).toHaveLength(1);
    expect((await f.service.events('10', actor, { ...range, resourceType: 'THERAPIST', resourceId: '21' })).events).toEqual([]);
  });
  test('half-open boundary excludes a service ending exactly at visible start', async () => {
    const f = fixture(); f.state.bookings = [booking(1, { startTime: date('2030-01-15T07:00:00Z'), endTime: date('2030-01-15T08:00:00Z') })];
    expect((await f.service.events('10', actor, range)).events).toEqual([]);
  });
  test('four-hand/couple resources are item events under one booking identity', async () => {
    const f = fixture(); const row = booking(1, { _count: { items: 2 }, items: [1n, 2n].map(itemId => ({ id: itemId, serviceNameSnapshot: 'Saved service',
      startAtUtc: date('2030-01-15T17:00:00Z'), endAtUtc: date('2030-01-15T18:00:00Z'), assignedTherapistId: itemId === 1n ? 20n : 21n, assignedRoomId: 30n })) });
    row.resourceLocks = [20n, 21n].map((resourceId, index) => ({ id: BigInt(index + 1), bookingItemId: 1n, resourceType: 'THERAPIST', resourceId,
      startAtUtc: date('2030-01-15T17:00:00Z'), endAtUtc: date('2030-01-15T18:15:00Z') }));
    f.state.bookings = [row]; const page = await f.service.events('10', actor, range);
    expect(page.events).toHaveLength(2); expect(new Set(page.events.map(event => event.bookingId)).size).toBe(1);
    expect(page.events[0].resources.filter(resource => resource.startAt)).toHaveLength(2);
    expect(page.events[0].title).toBe('Saved service');
  });
  test.each(['CANCELLED', 'COMPLETED', 'REFUNDED'])('protects stale ACTIVE terminal locks until lifecycle release (%s)', async status => {
    const f = fixture(); f.state.bookings = [booking(1, { status, deletedAt: date('2029-12-01T00:00:00Z'),
      resourceLocks: [{ id: 50n, bookingItemId: null, resourceType: 'ROOM', resourceId: 30n, startAtUtc: date('2030-01-15T17:00:00Z'), endAtUtc: date('2030-01-15T18:30:00Z') }] })];
    const page = await f.service.events('10', actor, range);
    expect(page.events[0]).toMatchObject({ status, occupiesResources: true, occupancySource: 'ACTIVE_LOCKS' });
    f.state.bookings[0].resourceLocks = [];
    expect((await f.service.events('10', actor, range)).events).toEqual([]);
  });
  test('whole unpaid expired PENDING holds lose ACTIVE occupation, but partial-paid/null-expiry holds do not', async () => {
    const f = fixture(); const lock = { id: 50n, bookingItemId: null, resourceType: 'ROOM', resourceId: 30n, startAtUtc: date('2030-01-15T17:00:00Z'), endAtUtc: date('2030-01-15T18:30:00Z') };
    f.state.bookings = [booking(1, { status: 'PENDING', holdExpiresAt: date('2029-12-31T23:59:00Z'), resourceLocks: [lock] }),
      booking(2, { status: 'PENDING', paidCents: 1, holdExpiresAt: date('2029-12-31T23:59:00Z'), resourceLocks: [lock] }), booking(3, { status: 'PENDING', resourceLocks: [lock] })];
    const rows = (await f.service.events('10', actor, range)).events;
    expect(rows.map(row => row.occupiesResources)).toEqual([false, true, true]); expect(rows[0].endAt).toBe('2030-01-15T18:00:00.000Z');
  });
  test('legacy effective bookings remain conservative occupation without fabricated resource locks', async () => {
    const f = fixture(); f.state.bookings = [booking(1, { status: 'PENDING' }), booking(2, { status: 'COMPLETED' })];
    const page = await f.service.events('10', actor, range);
    expect(page.events[0]).toMatchObject({ occupancySource: 'LEGACY_SERVICE', occupiesResources: true, resources: [{ id: '20', startAt: '2030-01-15T17:00:00.000Z' }] });
    expect(page.events[1]).toMatchObject({ occupancySource: 'NONE', occupiesResources: false });
  });
  test('resource filters retain conservative unknown legacy occupation without fabricating assignments', async () => {
    const f = fixture(); f.state.bookings = [booking(1, { therapistId: null }), booking(2)];
    const staffPage = await f.service.events('10', actor, { ...range, resourceType: 'THERAPIST', resourceId: '21' });
    expect(staffPage.events.map(row => row.bookingId)).toEqual(['1']); expect(staffPage.events[0].resources).toEqual([]);
    const roomPage = await f.service.events('10', actor, { ...range, resourceType: 'ROOM', resourceId: '30' });
    expect(roomPage.events.map(row => row.bookingId)).toEqual(['1', '2']);
    expect(roomPage.events.every(row => row.resources.every(resource => resource.type !== 'ROOM'))).toBe(true);
  });
  test.each(['therapist', 'room', 'lockResource', 'lockShop'])('fails incomplete on unknown/foreign resource identity (%s)', async kind => {
    const f = fixture(); const row = booking(1);
    if (kind === 'therapist') row.therapistId = 999n;
    if (kind === 'room') { row._count.items = 1; row.items = [{ id: 1n, serviceNameSnapshot: 'Service', startAtUtc: row.startTime, endAtUtc: row.endTime, assignedRoomId: 999n }]; }
    if (kind.startsWith('lock')) row.resourceLocks = [{ id: 1n, shopId: kind === 'lockShop' ? 999n : 10n, bookingItemId: null, resourceType: 'ROOM', resourceId: kind === 'lockResource' ? 999n : 30n, startAtUtc: row.startTime, endAtUtc: row.endTime }];
    f.state.bookings = [row];
    await expect(f.service.events('10', actor, range)).rejects.toThrow(ServiceUnavailableException);
  });
  test('closure dates are inclusive in config and converted to exclusive actual DST boundaries', async () => {
    const f = fixture(); f.state.timezone = 'America/New_York'; f.state.closedPeriods = [{ startDate: '2026-11-01', endDate: '2026-11-01' }];
    const page = await f.service.events('10', actor, { startDate: '2026-11-01', endDate: '2026-11-02' });
    expect(page.events[0]).toMatchObject({ eventType: 'SHOP_CLOSURE', allDay: true, startAt: '2026-11-01T04:00:00.000Z', endAt: '2026-11-02T05:00:00.000Z' });
  });
  test('status/resource filtering retains full-shop closures and all resource filter choices, excludes private reasons', async () => {
    const f = fixture(); f.state.closedPeriods = [{ startDate: '2030-01-15', endDate: '2030-01-15' }];
    f.state.timeOff = [{ id: 1n, therapistId: 20n, startAtUtc: date('2030-01-15T17:00:00Z'), endAtUtc: date('2030-01-15T18:00:00Z'), reason: 'PRIVATE MEDICAL' }];
    f.state.maintenance = [{ id: 2n, roomId: 30n, startAtUtc: date('2030-01-15T17:00:00Z'), endAtUtc: date('2030-01-15T18:00:00Z'), reason: 'PRIVATE REASON' }];
    const page = await f.service.events('10', actor, { ...range, status: 'CONFIRMED', resourceType: 'ROOM', resourceId: '30' });
    expect(page.events.map(event => event.eventType)).toEqual(['SHOP_CLOSURE', 'ROOM_MAINTENANCE']);
    expect(page.resources).toHaveLength(3); expect(JSON.stringify(page)).not.toMatch(/PRIVATE/);
    expect(f.tx.booking.findMany.mock.calls[0][0].where.status).toBe('CONFIRMED');
    await expect(f.service.events('10', actor, { ...range, resourceType: 'ROOM', resourceId: '999' })).rejects.toThrow(BadRequestException);
  });
  test.each(['bookings', 'items', 'resourceLocks', 'therapists', 'rooms', 'timeOff', 'maintenance'])('fails explicitly when %s exceeds bounded range capacity', async source => {
    const f = fixture(); if (source !== 'bookings') f.state.bookings = [booking(1)];
    f.state[source] = Array.from({ length: MAX_CALENDAR_EVENTS + 1 }, () => ({}));
    await expect(f.service.events('10', actor, range)).rejects.toThrow(ServiceUnavailableException);
  });
  test('does not silently ignore invalid closure configuration or malformed event windows', async () => {
    const f = fixture(); f.state.closedPeriods = [{ startDate: 'broken', endDate: '2030-01-15' }];
    await expect(f.service.events('10', actor, range)).rejects.toThrow(ServiceUnavailableException);
    f.state.closedPeriods = []; f.state.bookings = [booking(1, { endTime: date('2030-01-15T16:00:00Z') })];
    await expect(f.service.events('10', actor, range)).rejects.toThrow(ServiceUnavailableException);
  });
  test('controller exposes no-store and delegates only explicit authenticated context', async () => {
    const service = { events: jest.fn(async () => ({ complete: true })) };
    const controller = new BookingCalendarController(service as any); await controller.events('10', actor, range);
    expect(service.events).toHaveBeenCalledWith('10', actor, range);
    expect(Reflect.getMetadata('__headers__', controller.events)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    expect(Reflect.getMetadata('roles', BookingCalendarController)).toEqual(['ADMIN', 'MERCHANT', 'STAFF']);
  });
});
