jest.mock('../../common/notification-outbox', () => ({ enqueueNotification: jest.fn(async () => {}), enqueueBookingOrderEmail: jest.fn(async () => {}), syncBookingReminder: jest.fn(async () => {}) }));
jest.mock('../../common/shop-access', () => ({ requireShopAccess: jest.fn() }));
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { bookingOperationKey } from './booking-operation';
import { BookingService } from './booking.service';
import { SettlementService } from './settlement.service';
import { BookingController } from './booking.controller';
import { MerchantController } from '../merchant/merchant.controller';
import { MerchantService } from '../merchant/merchant.service';
import { requireShopAccess } from '../../common/shop-access';

const key = '00000000-0000-4000-a000-000000000001';
const access = requireShopAccess as jest.Mock;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

/** Synthetic READ COMMITTED transaction fixture serializes on the real
 * service's shop lock and rolls back both order and operation evidence. */
function fixture() {
  const booking: any = { id: 1n, shopId: 2n, userId: 4n, serviceId: 5n, therapistId: 6n, deletedAt: null, status: 'PENDING', paymentStatus: 'UNPAID',
    paymentMode: 'PAY_AT_STORE', paidCents: 0, refundedCents: 0, totalCents: 6000, priceCents: 6000, discountCents: 0, platformFeeCents: 0, tipCents: 0,
    currency: 'usd', durationMin: 60, bookingDate: new Date('2035-01-01T00:00:00Z'), bookingTimezone: 'America/Los_Angeles',
    startTime: new Date('2035-01-01T18:00:00Z'), endTime: new Date('2035-01-01T19:00:00Z'), couponId: null, holdExpiresAt: null,
    items: [], addOns: [], resourceLocks: [], service: { id: 5n, name: 'Synthetic service' }, shop: { id: 2n, ownerId: 3n, name: 'Synthetic', timezone: 'America/Los_Angeles', status: 'APPROVED', studioProfile: {} } };
  let state: any = { booking, receipts: [], entries: [], audits: [], released: 0, updates: 0, pendingRefund: false }, tail = Promise.resolve();
  let failReceipt = false;
  const events: string[] = [];
  const db: any = {
    booking: { findUnique: async ({ where }: any) => where.id === 1n ? state.booking : null },
    user: { findFirst: async () => null },
    therapist: { findMany: async () => [] },
    $transaction: async (work: any) => {
    let release: (() => void) | undefined, stage: any;
    const guard = () => { if (!stage) throw Error('Evidence or business mutation before shop lock'); };
    const tx: any = {
      $queryRaw: async (sql: any) => {
        if (String(sql.sql).includes('FROM shops') && !release) {
          const previous = tail; tail = new Promise<void>(done => { release = done; }); await previous;
          stage = structuredClone(state); events.push('shop-lock');
        } else if (String(sql.sql).includes('FROM bookings')) { guard(); events.push('booking-lock'); }
        return [];
      },
      booking: { findUnique: async ({ where, select }: any) => where.id === 1n ? select ? { shopId: 2n } : stage.booking : null,
        findMany: async () => [], update: async ({ data }: any) => { guard(); Object.assign(stage.booking, data); stage.updates++; return stage.booking; } },
      bookingResourceLock: { updateMany: async ({ where }: any) => { guard(); if (where.bookingId) stage.released++; return { count: 0 }; },
        createMany: async ({ data }: any) => { guard(); stage.booking.resourceLocks.push(...data); return { count: data.length }; } },
      bookingItem: { create: async ({ data }: any) => { guard(); const item = { ...data, id: 100n }; stage.booking.items.push(item); return item; },
        update: async ({ where, data }: any) => { guard(); const item = stage.booking.items.find((r: any) => r.id === where.id); Object.assign(item, data); return item; } },
      refundRequest: { findFirst: async () => stage.pendingRefund ? { id: 1n } : null }, paymentRecord: { findUnique: async () => null },
      auditLog: { create: async ({ data }: any) => { guard(); stage.audits.push(data); return data; } },
      bookingOperationReceipt: {
        findUnique: async ({ where }: any) => { guard(); const w = where.actorId_bookingId_requestKey; return stage.receipts.find((r: any) => r.actorId === w.actorId && r.bookingId === w.bookingId && r.requestKey === w.requestKey) ?? null; },
        create: async ({ data }: any) => { guard(); if (failReceipt) throw Error('Synthetic operation evidence failure'); stage.receipts.push(data); return data; },
      },
      bookingSettlementEntry: { findMany: async () => stage.entries,
        findUnique: async ({ where }: any) => stage.entries.find((r: any) => r.bookingId === where.bookingId_requestKey.bookingId && r.requestKey === where.bookingId_requestKey.requestKey) ?? null,
        create: async ({ data }: any) => { guard(); const row = { ...data, id: '11111111-1111-4111-a111-111111111111', createdAt: new Date() }; stage.entries.push(row); return row; } },
    };
    try { const value = await work(tx); state = stage; return value; } finally { release?.(); }
  } };
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  const notify = jest.spyOn(service as any, 'notifyBooking').mockResolvedValue(undefined);
  return { service, settlements: new SettlementService(db), state: () => state, events, notify, failReceipt: () => { failReceipt = true; } };
}

const ledger = () => ({ requestKey: 'offline-body-key-001', amountCents: 6000, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic completed collection' });

describe('durable booking operation evidence and reconciliation fencing', () => {
  beforeEach(() => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2034-01-01T00:00:00Z')); access.mockReset();
    access.mockImplementation(async (_tx, shopId, actor) => {
      if (shopId !== 2n || !['3', '7'].includes(actor.id)) throw new ForbiddenException();
      return { permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE'] };
    });
  });
  afterEach(() => jest.useRealTimers());

  test.each(['', 'short', 'with space-123', '../not-a-key', 'a'.repeat(101)])('rejects malformed keys before opening a transaction: %s', async bad => {
    const f = fixture(); await expect(f.service.reconcileOperation('1', '3', 'MERCHANT', bad)).rejects.toThrow(BadRequestException); expect(f.events).toEqual([]);
  });
  test('allows UUID keys and legacy calls with no operation key', async () => {
    expect(bookingOperationKey(key)).toBe(key); expect(bookingOperationKey()).toBeUndefined();
    const f = fixture(); expect((await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT')).status).toBe('CONFIRMED'); expect(f.state().receipts).toEqual([]);
  });
  test('commits command evidence with status and returns committed outcome without repeating effects', async () => {
    const f = fixture(); await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key);
    const first = structuredClone(f.state());
    expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', key)).toEqual({ bookingId: '1', shopId: '2', requestKey: key, outcome: 'COMMITTED', action: 'STATUS:CONFIRMED' });
    expect((await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key)).status).toBe('CONFIRMED');
    expect(f.state().updates).toBe(first.updates); expect(f.state().audits).toEqual(first.audits); expect(f.notify).toHaveBeenCalledTimes(1);
    expect(Object.keys(f.state().receipts[0]).sort()).toEqual(['action', 'actorId', 'bookingId', 'id', 'outcome', 'requestHash', 'requestKey', 'shopId']);
  });
  test('same key with changed action cannot apply another transition', async () => {
    const f = fixture(); await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key);
    await expect(f.service.cancelBooking('1', '3', 'MERCHANT', key)).rejects.toThrow(ConflictException);
    expect(f.state().booking.status).toBe('CONFIRMED'); expect(f.state().updates).toBe(1);
  });
  test('reconcile absent key seals it before a delayed status command arrives', async () => {
    const f = fixture(); expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', key)).toMatchObject({ outcome: 'NOT_EXECUTED', action: null });
    await expect(f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key)).rejects.toMatchObject({ response: { code: 'BOOKING_OPERATION_SEALED' } });
    expect(f.state().booking.status).toBe('PENDING'); expect(f.state().updates).toBe(0); expect(f.notify).not.toHaveBeenCalled();
  });
  test('reconciliation waits for a transaction that already holds the shop and reports its commit', async () => {
    const f = fixture(), entered = deferred(), resume = deferred();
    f.notify.mockImplementationOnce(async () => { entered.resolve(); await resume.promise; });
    const write = f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key); await entered.promise;
    let resolved = false; const read = f.service.reconcileOperation('1', '3', 'MERCHANT', key).then(v => { resolved = true; return v; });
    await Promise.resolve(); await Promise.resolve(); expect(resolved).toBe(false);
    resume.resolve(); await write; expect(await read).toMatchObject({ outcome: 'COMMITTED', action: 'STATUS:CONFIRMED' });
    expect(f.state().receipts).toHaveLength(1); expect(f.events).toEqual(['shop-lock', 'booking-lock', 'shop-lock', 'booking-lock']);
  });
  test('two simultaneous identical status commands commit one mutation and one receipt', async () => {
    const f = fixture(); const result = await Promise.all([1, 2].map(() => f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key)));
    expect(result.map(r => r.status)).toEqual(['CONFIRMED', 'CONFIRMED']); expect(f.state().updates).toBe(1); expect(f.state().receipts).toHaveLength(1); expect(f.notify).toHaveBeenCalledTimes(1);
  });
  test('simultaneous completion retries preserve unpaid money and commit one completion, audit, notification and operation receipt', async () => {
    const f = fixture(); f.state().booking.status = 'CONFIRMED';
    jest.setSystemTime(new Date('2035-01-01T19:00:00Z'));
    const original = structuredClone(f.state().booking);
    const results = await Promise.all([1, 2].map(() => f.service.updateBookingStatus('1', '3', 'COMPLETED', 'MERCHANT', key)));
    expect(results.map(row => row.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(f.state().booking).toEqual({ ...original, status: 'COMPLETED' });
    expect(f.state().updates).toBe(1); expect(f.state().released).toBe(1); expect(f.state().entries).toEqual([]);
    expect(f.state().audits).toEqual([expect.objectContaining({ action: 'BOOKING_COMPLETED' })]);
    expect(f.state().receipts).toEqual([expect.objectContaining({ requestKey: key, action: 'STATUS:COMPLETED', outcome: 'COMMITTED' })]);
    expect(f.notify).toHaveBeenCalledTimes(1);
    const committed = structuredClone(f.state());
    await expect(f.service.updateBookingStatus('1', '3', 'COMPLETED', 'MERCHANT', key)).resolves.toMatchObject({ status: 'COMPLETED', paymentStatus: 'UNPAID', paidCents: 0 });
    expect(f.state()).toEqual(committed); expect(f.notify).toHaveBeenCalledTimes(1);
  });
  test('business failure rolls back changes and later reconciliation can seal the rolled-back request', async () => {
    const f = fixture(); f.notify.mockRejectedValueOnce(Error('Synthetic outbox failure'));
    await expect(f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key)).rejects.toThrow('Synthetic outbox failure');
    expect(f.state().booking.status).toBe('PENDING'); expect(f.state().receipts).toEqual([]); expect(f.state().audits).toEqual([]);
    expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', key)).toMatchObject({ outcome: 'NOT_EXECUTED' });
  });
  test('receipt persistence failure rolls back the business change instead of leaving false success', async () => {
    const f = fixture(); f.failReceipt();
    await expect(f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key)).rejects.toThrow('Synthetic operation evidence failure');
    expect(f.state().booking.status).toBe('PENDING'); expect(f.state().updates).toBe(0); expect(f.state().receipts).toEqual([]);
  });
  test('repeated reconciliation does not replace or duplicate the sealed key', async () => {
    const f = fixture(); const first = await f.service.reconcileOperation('1', '3', 'MERCHANT', key);
    expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', key)).toEqual(first); expect(f.state().receipts).toHaveLength(1);
  });
  test('current authorization is required before evidence is exposed or a key is sealed', async () => {
    const f = fixture(); await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key);
    await expect(f.service.reconcileOperation('1', '99', 'MERCHANT', key)).rejects.toThrow(NotFoundException);
    access.mockRejectedValue(new ForbiddenException()); await expect(f.service.reconcileOperation('1', '3', 'MERCHANT', key)).rejects.toThrow(NotFoundException);
    expect(f.state().receipts).toHaveLength(1);
  });
  test('committed replay still requires current mutation permission', async () => {
    const f = fixture(); await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key); access.mockRejectedValue(new ForbiddenException());
    await expect(f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key)).rejects.toThrow(NotFoundException); expect(f.state().updates).toBe(1);
  });
  test('read-capable settlement operator can reconcile without booking-management permission', async () => {
    const f = fixture(); access.mockImplementation(async (_tx, _shop, _actor, permission, options) => {
      expect(permission).toBe('BOOKINGS_READ'); expect(options).toEqual({ write: true });
      return { permissions: ['BOOKINGS_READ', 'SETTLEMENT_RECORD'] };
    });
    expect(await f.service.reconcileOperation('1', '3', 'STAFF', key)).toMatchObject({ outcome: 'NOT_EXECUTED' });
  });
  test('customer can seal an absent own key without exposing an operator receipt', async () => {
    const f = fixture(); await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key);
    const operatorReceipt = { ...f.state().receipts[0] };
    expect(await f.service.reconcileOperation('1', '4', 'CUSTOMER', key)).toMatchObject({ bookingId: '1', requestKey: key, outcome: 'NOT_EXECUTED', action: null });
    expect(f.state().receipts).toHaveLength(2); expect(f.state().receipts[0]).toEqual(operatorReceipt);
    expect(f.state().receipts[1]).toMatchObject({ actorId: 4n, bookingId: 1n, shopId: 2n });
    expect(f.state().updates).toBe(1);
  });
  test('customer can recover only their own committed reschedule', async () => {
    const f = fixture();
    f.state().receipts.push({ actorId: 4n, bookingId: 1n, shopId: 2n, requestKey: key, outcome: 'COMMITTED', action: 'RESCHEDULE' });
    expect(await f.service.reconcileOperation('1', '4', 'CUSTOMER', key)).toMatchObject({ outcome: 'COMMITTED', action: 'RESCHEDULE' });
    expect(f.state().receipts).toHaveLength(1); expect(f.state().updates).toBe(0); expect(f.state().released).toBe(0);
  });
  test('customer cannot recover committed operator actions even under their own actor key', async () => {
    const f = fixture();
    f.state().receipts.push({ actorId: 4n, bookingId: 1n, shopId: 2n, requestKey: key, outcome: 'COMMITTED', action: 'STATUS:CONFIRMED' });
    await expect(f.service.reconcileOperation('1', '4', 'CUSTOMER', key)).rejects.toThrow(ConflictException);
    expect(f.state().receipts).toHaveLength(1); expect(f.state().updates).toBe(0);
  });
  test('another customer cannot read or seal the owner operation', async () => {
    const f = fixture();
    await expect(f.service.reconcileOperation('1', '99', 'CUSTOMER', key)).rejects.toThrow(NotFoundException);
    expect(f.state().receipts).toEqual([]); expect(f.state().updates).toBe(0); expect(f.state().released).toBe(0);
  });
  test('another actor has a distinct key scope and cannot see the original actor receipt', async () => {
    const f = fixture(); await f.service.updateBookingStatus('1', '3', 'CONFIRMED', 'MERCHANT', key);
    expect(await f.service.reconcileOperation('1', '7', 'MERCHANT', key)).toMatchObject({ outcome: 'NOT_EXECUTED' });
    expect(f.state().receipts).toHaveLength(2);
  });
  test.each(['SINGLE', 'PLAN'])('a sealed reschedule is rejected before loading or mutating a %s itinerary', async reservationKind => {
    const f = fixture(); f.state().booking.reservationKind = reservationKind; await f.service.reconcileOperation('1', '3', 'MERCHANT', key);
    const context = jest.spyOn(f.service as any, 'context'), movePlan = jest.spyOn(f.service as any, 'movePlan');
    await expect(f.service.rescheduleBooking('1', '3', { date: '2035-01-02', startTime: '10:00' }, 'MERCHANT', key)).rejects.toThrow(ConflictException);
    expect(context).not.toHaveBeenCalled(); expect(movePlan).not.toHaveBeenCalled(); expect(f.state().released).toBe(0);
  });
  test('successful ordinary reschedule records outcome and retry does not replace resources twice', async () => {
    const f = fixture(), start = new Date('2035-01-02T18:00:00Z'), date = { date: '2035-01-02', startTime: '10:00' };
    const context = jest.spyOn(f.service as any, 'context').mockResolvedValue({ shop: { timezone: 'America/Los_Angeles' }, preferred: [], allocation: {
      count: 1, staffCount: 1, duration: 60, staffBuffer: 0, roomBuffer: 0, needsRoom: false, locks: [], legacy: [], rooms: [],
      therapists: [{ id: '6', shifts: [{ start, end: new Date(+start + 86400000) }], timeOff: [] }] } });
    jest.spyOn(f.service as any, 'selectedTime').mockReturnValue(start);
    await f.service.rescheduleBooking('1', '3', date, 'MERCHANT', key);
    await f.service.rescheduleBooking('1', '3', { startTime: '10:00', date: '2035-01-02' }, 'MERCHANT', key);
    expect(context).toHaveBeenCalledTimes(1); expect(f.state().released).toBe(1); expect(f.state().booking.resourceLocks).toHaveLength(1);
    expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', key)).toMatchObject({ action: 'RESCHEDULE', outcome: 'COMMITTED' });
    await expect(f.service.rescheduleBooking('1', '3', { ...date, startTime: '11:00' }, 'MERCHANT', key)).rejects.toThrow(ConflictException);
  });
  test('cancel route records the same transition action and replay does not release twice', async () => {
    const f = fixture(); await f.service.cancelBooking('1', '3', 'MERCHANT', key); await f.service.cancelBooking('1', '3', 'MERCHANT', key);
    expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', key)).toMatchObject({ outcome: 'COMMITTED', action: 'STATUS:CANCELLED' }); expect(f.state().released).toBe(1);
  });
  test('administrator cancellation records the trimmed reason, preserves read permissions and replays once', async () => {
    const f = fixture();
    const reason = '顾客要求改日';
    const cancelled = await f.service.updateBookingStatus('1', '3', 'CANCELLED', 'ADMIN', key, '  ' + reason + '  ');
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: reason });
    expect(f.state().booking).toMatchObject({ status: 'CANCELLED', cancelReason: reason });
    await expect(f.service.getBooking('1', '4', 'CUSTOMER')).resolves.toMatchObject({ cancelReason: reason });
    await expect(f.service.getBooking('1', '3', 'ADMIN')).resolves.toMatchObject({ cancelReason: reason });
    await expect(f.service.getBooking('1', '7', 'MERCHANT')).resolves.toMatchObject({ cancelReason: reason });
    await expect(f.service.getBooking('1', '99', 'CUSTOMER')).rejects.toThrow(NotFoundException);
    await expect(f.service.cancelBooking('1', '3', 'ADMIN', key, reason)).resolves.toMatchObject({ cancelReason: reason });
    await expect(f.service.cancelBooking('1', '3', 'ADMIN', key, 'Other reason')).rejects.toThrow(ConflictException);
    expect(f.state()).toMatchObject({ released: 1, updates: 1 });
    expect(f.state().receipts).toHaveLength(1);
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.state().audits.map((audit: any) => audit.detail))).not.toContain(reason);
    expect(f.state().receipts[0]).not.toHaveProperty('cancelReason');
    expect(await f.service.reconcileOperation('1', '3', 'ADMIN', key)).toMatchObject({ outcome: 'COMMITTED', action: 'STATUS:CANCELLED' });
  });
  test('both administrator cancel routes require a valid reason and accept exactly 500 characters after trimming', async () => {
    const f = fixture();
    for (const reason of [undefined, '  \t ', 'x'.repeat(501), null, 17]) {
      await expect(f.service.updateBookingStatus('1', '3', 'CANCELLED', 'ADMIN', key, reason)).rejects.toThrow(BadRequestException);
    }
    await expect(f.service.cancelBooking('1', '3', 'ADMIN')).rejects.toThrow(BadRequestException);
    expect(f.state()).toMatchObject({ booking: { status: 'PENDING' }, released: 0, updates: 0, receipts: [], audits: [] });
    const reason = '字'.repeat(500);
    await expect(f.service.cancelBooking('1', '3', 'ADMIN', key, ' ' + reason + ' ')).resolves.toMatchObject({ cancelReason: reason });
  });
  test('administrator cancellation reason does not bypass captured payment or pending refund gates', async () => {
    const f = fixture();
    f.state().booking.paidCents = 6000;
    await expect(f.service.cancelBooking('1', '3', 'ADMIN', key, 'Changed plans')).rejects.toThrow('Refund the payment before cancelling');
    f.state().booking.refundedCents = 6000;
    f.state().pendingRefund = true;
    await expect(f.service.cancelBooking('1', '3', 'ADMIN', key, 'Changed plans')).rejects.toThrow('Resolve the pending refund');
    expect(f.state()).toMatchObject({ booking: { status: 'PENDING' }, released: 0, updates: 0, receipts: [], audits: [] });
    expect(f.state().booking.cancelReason).toBeUndefined();
  });
  test('previously committed reasonless administrator cancellation retains its replay response', async () => {
    const f = fixture();
    f.state().booking.status = 'CANCELLED';
    f.state().receipts.push({ actorId: 3n, bookingId: 1n, shopId: 2n, requestKey: key, action: 'STATUS:CANCELLED', outcome: 'COMMITTED',
      requestHash: createHash('sha256').update('{"action":"STATUS:CANCELLED","payload":{"status":"CANCELLED"}}').digest('hex') });
    await expect(f.service.cancelBooking('1', '3', 'ADMIN', key)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(f.state()).toMatchObject({ released: 0, updates: 0, audits: [] });
  });
  test('offline receipt writes financial evidence and operation evidence once', async () => {
    const f = fixture(); f.state().booking.status = 'CONFIRMED'; const data = ledger();
    await f.settlements.recordReceipt('1', '3', 'MERCHANT', data, key); await f.settlements.recordReceipt('1', '3', 'MERCHANT', data, key);
    expect(f.state().entries).toHaveLength(1); expect(f.state().booking.paidCents).toBe(6000);
    expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', key)).toMatchObject({ action: 'OFFLINE:RECEIPT', outcome: 'COMMITTED' });
    await expect(f.settlements.recordReceipt('1', '3', 'MERCHANT', { ...data, amountCents: 100 }, key)).rejects.toThrow(ConflictException);
  });
  test.each(['refund', 'reverse'])('successful offline %s has committed evidence and no duplicate correction', async kind => {
    const f = fixture(); f.state().booking.status = 'CONFIRMED'; await f.settlements.recordReceipt('1', '3', 'MERCHANT', ledger(), key);
    const correctionKey = '00000000-0000-4000-a000-000000000002', data = { ...ledger(), requestKey: 'offline-correction-key' };
    const run = kind === 'refund' ? () => f.settlements.recordRefund('1', '3', 'MERCHANT', data, correctionKey)
      : () => f.settlements.reverse('1', '11111111-1111-4111-a111-111111111111', '3', 'MERCHANT', data, correctionKey);
    await run(); await run(); expect(f.state().entries).toHaveLength(2); expect(f.state().receipts).toHaveLength(2);
    expect(await f.service.reconcileOperation('1', '3', 'MERCHANT', correctionKey)).toMatchObject({ outcome: 'COMMITTED', action: `OFFLINE:${kind === 'refund' ? 'REFUND' : 'REVERSAL'}` });
  });
  test.each(['receipt', 'refund', 'reverse'])('sealed offline %s cannot apply a delayed financial write', async kind => {
    const f = fixture(); await f.service.reconcileOperation('1', '3', 'MERCHANT', key);
    const run = kind === 'receipt' ? () => f.settlements.recordReceipt('1', '3', 'MERCHANT', ledger(), key)
      : kind === 'refund' ? () => f.settlements.recordRefund('1', '3', 'MERCHANT', ledger(), key)
      : () => f.settlements.reverse('1', '11111111-1111-4111-a111-111111111111', '3', 'MERCHANT', { requestKey: 'reverse-body-key', reason: 'Synthetic correction' }, key);
    await expect(run()).rejects.toThrow(ConflictException); expect(f.state().entries).toEqual([]); expect(f.state().updates).toBe(0);
  });
});

describe('operation key route propagation', () => {
  test('booking routes forward optional keys without changing legacy argument shapes', async () => {
    const service: any = { updateBookingStatus: jest.fn(), cancelBooking: jest.fn(), rescheduleBooking: jest.fn(), reconcileOperation: jest.fn() };
    const settlements: any = { recordReceipt: jest.fn(), recordRefund: jest.fn(), reverse: jest.fn() };
    const c = new BookingController(service, settlements), data: any = { date: '2035-01-02', startTime: '10:00' };
    await c.updateStatus('1', 'CONFIRMED', '3', 'MERCHANT', key); expect(service.updateBookingStatus).toHaveBeenLastCalledWith('1', '3', 'CONFIRMED', 'MERCHANT', key);
    await c.cancelBooking('1', '3', 'MERCHANT', key); expect(service.cancelBooking).toHaveBeenLastCalledWith('1', '3', 'MERCHANT', key);
    c.reschedule('1', '3', data, 'MERCHANT', key); expect(service.rescheduleBooking).toHaveBeenLastCalledWith('1', '3', data, 'MERCHANT', key);
    c.receipt('1', '3', 'MERCHANT', data, key); c.offlineRefund('1', '3', 'MERCHANT', data, key); c.reverseReceipt('1', 'entry', '3', 'MERCHANT', data, key);
    expect(settlements.recordReceipt).toHaveBeenLastCalledWith('1', '3', 'MERCHANT', data, key); expect(settlements.recordRefund).toHaveBeenLastCalledWith('1', '3', 'MERCHANT', data, key);
    expect(settlements.reverse).toHaveBeenLastCalledWith('1', 'entry', '3', 'MERCHANT', data, key);
    c.reconcileOperation('1', key, '3', 'STAFF'); expect(service.reconcileOperation).toHaveBeenLastCalledWith('1', '3', 'STAFF', key);
    await c.cancelBooking('1', '3', 'MERCHANT'); expect(service.cancelBooking).toHaveBeenLastCalledWith('1', '3', 'MERCHANT');
  });
  test('merchant aliases propagate keys through controller and service', async () => {
    const service: any = { confirmBooking: jest.fn(), completeBooking: jest.fn() }, c = Object.create(MerchantController.prototype) as MerchantController;
    Object.assign(c, { merchantService: service }); await c.confirmBooking('MERCHANT', '3', '1', key); await c.completeBooking('MERCHANT', '3', '1', key);
    expect(service.confirmBooking).toHaveBeenCalledWith('3', '1', 'MERCHANT', key); expect(service.completeBooking).toHaveBeenCalledWith('3', '1', 'MERCHANT', key);
    const merchant = Object.create(MerchantService.prototype) as MerchantService, bookings: any = { updateBookingStatus: jest.fn() }; Object.assign(merchant, { bookings });
    await merchant.confirmBooking('3', '1', 'MERCHANT', key); expect(bookings.updateBookingStatus).toHaveBeenLastCalledWith('1', '3', 'CONFIRMED', 'MERCHANT', key);
    await merchant.completeBooking('3', '1', 'MERCHANT', key); expect(bookings.updateBookingStatus).toHaveBeenLastCalledWith('1', '3', 'COMPLETED', 'MERCHANT', key);
  });
});
