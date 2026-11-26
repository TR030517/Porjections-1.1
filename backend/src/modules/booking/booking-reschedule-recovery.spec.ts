jest.mock('../../common/shop-access', () => ({ requireShopAccess: jest.fn() }));
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { requireShopAccess } from '../../common/shop-access';
import { BookingService } from './booking.service';

const target = { date: '2035-02-02', startTime: '14:00' };
const key = 'synthetic-reschedule-recovery-001';
const minute = 60000;
const access = requireShopAccess as jest.Mock;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
// Jest's host structuredClone creates dates outside the ts-jest VM realm;
// persistence returns Date instances in the service realm, as Prisma does.
function storageClone(value: any): any {
  if (Object.prototype.toString.call(value) === '[object Date]') return new Date(+value);
  if (Array.isArray(value)) return value.map(storageClone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, storageClone(item)]));
  return value;
}

/** Real BookingService/context/allocator/operation helpers; only storage and
 * outbox persistence are synthetic. Transactions stage both business data and
 * receipts under the real service's shared shop -> booking locking sequence. */
function fixture(kind: 'SINGLE' | 'PLAN') {
  const shop: any = { id: 10n, ownerId: 3n, status: 'APPROVED', deletedAt: null, name: 'Synthetic recovery shop', timezone: 'UTC',
    businessHours: Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, { open: '09:00', close: '22:00' }])),
    studioProfile: { features: { onlineBooking: true } } };
  const catalog: any = { id: 20n, shopId: 10n, isActive: true, name: 'Changed current menu', durationKind: 'TIMED', durationMin: 180,
    priceCents: 99000, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, variants: [] };
  const start = new Date('2035-02-01T10:00:00Z'), duration = kind === 'PLAN' ? 130 : 60;
  const booking: any = { id: 100n, shopId: 10n, userId: 5n, serviceId: 20n, therapistId: 30n, reservationKind: kind,
    status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', paidCents: 0, refundedCents: 0, priceCents: 13057, totalCents: 13057,
    platformFeeCents: 0, tipCents: 0, discountCents: 0, currency: 'usd', couponId: null, deletedAt: null, holdExpiresAt: null,
    durationMin: duration, participantCountSnapshot: kind === 'PLAN' ? 2 : 1, requiredStaffCountSnapshot: 2,
    therapistSelectionMode: 'AUTO', requestedTherapistIds: [], bookingDate: new Date('2035-02-01T00:00:00Z'), bookingTimezone: 'UTC',
    startTime: start, endTime: new Date(+start + duration * minute) };
  const makeItem = (id: bigint, participantIndex: number, sequence: number, offsetMin: number, assignedTherapistId: bigint, assignedRoomId: bigint) => ({
    id, bookingId: booking.id, serviceId: 20n, variantId: null, participantIndex, sequence, offsetMin,
    serviceNameSnapshot: 'Original saved service', durationKindSnapshot: 'TIMED', durationMin: 60, staffBufferMin: 10, roomBufferMin: 5,
    requiredStaffCountSnapshot: kind === 'SINGLE' ? 2 : 1, roomTypeSnapshot: 'SINGLE', assignedTherapistId, assignedRoomId,
    priceCentsSnapshot: kind === 'SINGLE' ? 13057 : id === 1000n ? 4353 : 4352, quotedUnitPriceCents: kind === 'SINGLE' ? 13057 : id === 1000n ? 4353 : 4352,
    currency: 'usd', priceBasisSnapshot: 'PER_BOOKING', therapistSelectionMode: 'AUTO', requestedTherapistIds: [],
    startAtUtc: new Date(+start + offsetMin * minute), endAtUtc: new Date(+start + (offsetMin + 60) * minute) });
  const items = [makeItem(1000n, 1, 1, 0, 30n, 40n)];
  if (kind === 'PLAN') items.push(makeItem(1001n, 1, 2, 70, 30n, 40n), makeItem(1002n, 2, 1, 0, 31n, 41n));
  const locks: any[] = [];
  for (const item of items) {
    for (let index = 0; index < item.requiredStaffCountSnapshot; index++) locks.push({ id: BigInt(2000 + locks.length), bookingId: booking.id,
      bookingItemId: item.id, shopId: shop.id, resourceType: 'THERAPIST', resourceId: item.assignedTherapistId + BigInt(index),
      startAtUtc: item.startAtUtc, endAtUtc: new Date(+item.endAtUtc + item.staffBufferMin * minute), status: 'ACTIVE' });
    locks.push({ id: BigInt(2000 + locks.length), bookingId: booking.id, bookingItemId: null, shopId: shop.id, resourceType: 'ROOM', resourceId: item.assignedRoomId,
      startAtUtc: item.startAtUtc, endAtUtc: new Date(+item.endAtUtc + item.roomBufferMin * minute), status: 'ACTIVE' });
  }
  let state: any = { booking, items, locks, audits: [], receipts: [], outbox: [] };
  let tail = Promise.resolve(), fault: 'locks' | 'receipt' | 'outbox' | null = null, authorized = true;
  let outboxGate: ReturnType<typeof deferred> | null = null, outboxEntered: ReturnType<typeof deferred> | null = null;
  const events: string[] = [];
  const fail = (point: typeof fault) => { if (fault === point) { fault = null; throw Error('Synthetic ' + point + ' persistence failure'); } };
  const db: any = { $transaction: async (work: any) => {
    let unlock: (() => void) | undefined, stage: any;
    const guard = () => { if (!stage) throw Error('Business/evidence mutation before shop lock'); };
    const detail = () => ({ ...stage.booking, items: stage.items, resourceLocks: stage.locks, addOns: [], shop, service: catalog });
    const tx: any = {
      $queryRaw: async (sql: any) => {
        if (String(sql.sql).includes('FROM shops') && !unlock) {
          const previous = tail; tail = new Promise<void>(done => { unlock = done; }); await previous;
          stage = storageClone(state); events.push('shop-lock');
        } else if (String(sql.sql).includes('FROM bookings')) { guard(); events.push('booking-lock'); }
        return [];
      },
      shop: { findUnique: async () => shop }, shopService: { findUnique: async () => catalog },
      therapist: { findMany: async () => [30n, 31n].map(id => ({ id, isActive: true, scheduleMode: 'SHOP', shifts: [], timeOff: [] })) },
      shopRoom: { findMany: async () => [40n, 41n].map(id => ({ id, capacity: 1, maintenance: [] })) },
      booking: {
        findUnique: async ({ where, select }: any) => where.id !== booking.id ? null : select ? { shopId: booking.shopId } : detail(),
        findMany: async () => [],
        update: async ({ data }: any) => { guard(); Object.assign(stage.booking, data); return detail(); },
      },
      bookingItem: { update: async ({ where, data }: any) => { guard(); const item = stage.items.find((row: any) => row.id === where.id); Object.assign(item, data); return item; } },
      shopCalendarBlock: { findMany: async () => [] }, bookingResourceLock: {
        findMany: async ({ where }: any) => stage.locks.filter((row: any) => row.status === 'ACTIVE' && row.bookingId !== where.bookingId?.not),
        updateMany: async ({ where, data }: any) => {
          guard(); const rows = stage.locks.filter((row: any) => where.bookingId === row.bookingId && row.status === where.status);
          rows.forEach((row: any) => Object.assign(row, data)); return { count: rows.length };
        },
        createMany: async ({ data }: any) => { guard(); fail('locks'); for (const row of data) stage.locks.push({ id: BigInt(2000 + stage.locks.length), ...row }); return { count: data.length }; },
      },
      refundRequest: { findFirst: async () => null },
      auditLog: { create: async ({ data }: any) => { guard(); stage.audits.push(data); return data; } },
      bookingOperationReceipt: {
        findUnique: async ({ where }: any) => { guard(); const match = where.actorId_bookingId_requestKey;
          return stage.receipts.find((row: any) => row.actorId === match.actorId && row.bookingId === match.bookingId && row.requestKey === match.requestKey) ?? null; },
        create: async ({ data }: any) => { guard(); fail('receipt'); stage.receipts.push(data); return data; },
      },
      syntheticOutbox: async (row: any, topic: string) => {
        guard(); stage.outbox.push({ bookingId: row.id, topic });
        if (outboxGate) { outboxEntered!.resolve(); await outboxGate.promise; }
        fail('outbox');
      },
    };
    try { const value = await work(tx); guard(); state = stage; return value; } finally { unlock?.(); }
  } };
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  const notify = jest.spyOn(service as any, 'notifyBooking').mockImplementation(async (tx: any, row: any, topic: string) => tx.syntheticOutbox(row, topic));
  access.mockImplementation(async (_tx, shopId, actor) => {
    if (!authorized || shopId !== 10n || actor.id !== '3') throw new ForbiddenException();
    return { shop, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'] };
  });
  return { service, state: () => state, notify, events, fail: (point: typeof fault) => { fault = point; }, revoke: () => { authorized = false; },
    gateOutbox: () => { outboxEntered = deferred(); outboxGate = deferred(); return { entered: outboxEntered.promise, resume: outboxGate.resolve }; } };
}

describe.each(['SINGLE', 'PLAN'] as const)('%s reschedule transaction/unknown-result recovery', kind => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2035-01-01T00:00:00Z')); access.mockReset(); });
  afterEach(() => jest.useRealTimers());

  test('commit followed by a lost response reconciles and replays once without changing snapshots or resources again', async () => {
    const f = fixture(kind), before = structuredClone(f.state());
    await expect(f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key).then(() => { throw Error('Synthetic response transport loss'); })).rejects.toThrow('transport loss');
    const committed = structuredClone(f.state());
    expect(committed.booking).toMatchObject({ startTime: new Date('2035-02-02T14:00:00Z'), durationMin: before.booking.durationMin, priceCents: 13057, totalCents: 13057, participantCountSnapshot: before.booking.participantCountSnapshot });
    expect(committed.items.map(({ startAtUtc, endAtUtc, assignedTherapistId, assignedRoomId, ...terms }: any) => terms))
      .toEqual(before.items.map(({ startAtUtc, endAtUtc, assignedTherapistId, assignedRoomId, ...terms }: any) => terms));
    expect(committed.locks.filter((row: any) => row.status === 'ACTIVE')).toHaveLength(kind === 'PLAN' ? 6 : 3);
    expect(await f.service.reconcileOperation('100', '3', 'MERCHANT', key)).toMatchObject({ action: 'RESCHEDULE', outcome: 'COMMITTED' });
    await expect(f.service.rescheduleBooking('100', '3', { startTime: '14:00', date: '2035-02-02' }, 'MERCHANT', key)).resolves.toMatchObject({ localStartTime: '14:00' });
    expect(f.state()).toEqual(committed); expect(f.notify).toHaveBeenCalledTimes(1);
    expect(committed.audits).toHaveLength(1); expect(committed.receipts).toHaveLength(1); expect(committed.outbox).toHaveLength(1);
  });

  test.each(['locks', 'outbox', 'receipt'] as const)('%s failure rolls back the entire swap and can be sealed before a fresh attempt', async point => {
    const f = fixture(kind), before = structuredClone(f.state()); f.fail(point);
    await expect(f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key)).rejects.toThrow('Synthetic ' + point + ' persistence failure');
    expect(f.state()).toEqual(before);
    expect(await f.service.reconcileOperation('100', '3', 'MERCHANT', key)).toMatchObject({ action: null, outcome: 'NOT_EXECUTED' });
    const sealed = structuredClone(f.state());
    await expect(f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key)).rejects.toMatchObject({ response: { code: 'BOOKING_OPERATION_SEALED' } });
    expect(f.state()).toEqual(sealed);
    await expect(f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key + ':new')).resolves.toMatchObject({ localStartTime: '14:00' });
    expect(f.state().receipts.map((row: any) => row.outcome)).toEqual(['NOT_EXECUTED', 'COMMITTED']);
    expect(f.state().audits).toHaveLength(1); expect(f.state().outbox).toHaveLength(1);
  });

  test('a reconciliation that arrives first fences a delayed command without releasing its original locks', async () => {
    const f = fixture(kind), before = structuredClone(f.state());
    await f.service.reconcileOperation('100', '3', 'MERCHANT', key);
    await expect(f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key)).rejects.toThrow(ConflictException);
    expect(f.state().booking).toEqual(before.booking); expect(f.state().items).toEqual(before.items); expect(f.state().locks).toEqual(before.locks);
    expect(f.notify).not.toHaveBeenCalled();
  });

  test('reconciliation waits for a pending swap and returns the committed receipt', async () => {
    const f = fixture(kind), gate = f.gateOutbox();
    const command = f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key); await gate.entered;
    let settled = false;
    const reconcile = f.service.reconcileOperation('100', '3', 'MERCHANT', key).then(value => { settled = true; return value; });
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    gate.resume(); await command;
    expect(await reconcile).toMatchObject({ action: 'RESCHEDULE', outcome: 'COMMITTED' });
    expect(f.state().receipts).toHaveLength(1); expect(f.state().audits).toHaveLength(1); expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.events).toEqual(['shop-lock', 'booking-lock', 'shop-lock', 'booking-lock']);
  });

  test('simultaneous identical keys replace the full resources once', async () => {
    const f = fixture(kind);
    const results = await Promise.all([1, 2].map(() => f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key)));
    expect(results.map(row => row.localStartTime)).toEqual(['14:00', '14:00']);
    expect(f.state().receipts).toHaveLength(1); expect(f.state().audits).toHaveLength(1); expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.state().locks.filter((row: any) => row.status === 'ACTIVE')).toHaveLength(kind === 'PLAN' ? 6 : 3);
    expect(f.state().locks.filter((row: any) => row.status === 'RELEASED')).toHaveLength(kind === 'PLAN' ? 6 : 3);
  });

  test('reusing a committed key for a different time cannot move or duplicate resources', async () => {
    const f = fixture(kind); await f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key);
    const before = structuredClone(f.state());
    await expect(f.service.rescheduleBooking('100', '3', { ...target, startTime: '15:00' }, 'MERCHANT', key)).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(before); expect(f.notify).toHaveBeenCalledTimes(1);
  });

  test('committed retries and evidence reads require current authorization', async () => {
    const f = fixture(kind); await f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key);
    const before = structuredClone(f.state()); f.revoke();
    await expect(f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key)).rejects.toThrow(NotFoundException);
    await expect(f.service.reconcileOperation('100', '3', 'MERCHANT', key)).rejects.toThrow(NotFoundException);
    expect(f.state()).toEqual(before); expect(f.notify).toHaveBeenCalledTimes(1);
  });

  test('an exact committed retry after the appointment starts does not execute another move', async () => {
    const f = fixture(kind); await f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key);
    const before = structuredClone(f.state()); jest.setSystemTime(new Date('2035-02-03T00:00:00Z'));
    await expect(f.service.rescheduleBooking('100', '3', target, 'MERCHANT', key)).resolves.toMatchObject({ localDate: target.date, localStartTime: target.startTime });
    expect(f.state()).toEqual(before); expect(f.notify).toHaveBeenCalledTimes(1);
  });
});
