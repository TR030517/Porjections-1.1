import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingService } from './booking.service';

// Any lifecycle/outbox call is a regression: hiding is only a view preference.
jest.mock('../../common/notification-outbox', () => ({
  enqueueNotification: jest.fn(() => { throw Error('Hide must not notify'); }),
  enqueueBookingOrderEmail: jest.fn(() => { throw Error('Hide must not email'); }),
  syncBookingReminder: jest.fn(() => { throw Error('Hide must not change reminders'); }),
}));

function fixture(patch: any = {}, auditFailure = false) {
  let state: any = { booking: { id: 1n, shopId: 2n, userId: 4n, status: 'COMPLETED', paymentMode: 'ZERO',
    totalCents: 0, paidCents: 0, refundedCents: 0, paymentStatus: 'PAID', deletedAt: null, customerHiddenAt: null,
    ...patch }, audits: [] };
  const events: string[] = [];
  const db: any = { booking: { findUnique: async () => state.booking }, $transaction: async (fn: any) => {
    const stage = structuredClone(state);
    const tx: any = {
      $queryRaw: async (sql: any) => { events.push(String(sql.sql).includes('FROM shops') ? 'shop-lock' : 'booking-lock'); return []; },
      booking: { findUnique: async () => stage.booking,
        findMany: () => { throw Error('Hide must not expire shop holds'); },
        update: async ({ data }: any) => { Object.assign(stage.booking, data); return stage.booking; } },
      bookingResourceLock: { updateMany: () => { throw Error('Hide must not alter resource locks'); } },
      $executeRaw: () => { throw Error('Hide must not change outbox'); },
      auditLog: { create: async ({ data }: any) => { if (auditFailure) throw Error('Synthetic audit failure'); stage.audits.push(data); } },
    };
    const result = await fn(tx); state = stage; return result;
  } };
  const service = new BookingService(db, {} as any, {} as any, {} as any);
  return { service, state: () => state, events };
}

describe('customer-only reservation visibility', () => {
  test('zero terminal hide changes only customer preference and records one audit; repeat is idempotent', async () => {
    const f = fixture(), before = structuredClone(f.state().booking);
    expect(await f.service.deleteBooking('1', '4')).toEqual({ success: true });
    expect(f.state().booking.customerHiddenAt).toBeInstanceOf(Date);
    expect({ ...f.state().booking, customerHiddenAt: null }).toEqual(before);
    expect(f.state().audits).toEqual([expect.objectContaining({ action: 'BOOKING_CUSTOMER_HIDDEN', targetId: 1n, operatorId: 4n })]);
    const hiddenAt = f.state().booking.customerHiddenAt;
    await f.service.deleteBooking('1', '4');
    expect(f.state().booking.customerHiddenAt).toEqual(hiddenAt);
    expect(f.state().audits).toHaveLength(1);
    expect(f.events).toEqual(['shop-lock', 'booking-lock', 'shop-lock', 'booking-lock']);
  });
  test.each([
    { totalCents: 4000, paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID' },
    { totalCents: 4000, paidCents: 4000 },
    { status: 'REFUNDED', totalCents: 4000, paidCents: 4000, refundedCents: 4000 },
    { totalCents: -1 }, { refundedCents: 1 },
    { status: 'PENDING' }, { status: 'CONFIRMED' }, { status: 'REFUNDING' },
  ])('outstanding, paid, malformed or nonterminal record rejects with no persisted writes (%j)', async patch => {
    const f = fixture(patch), before = structuredClone(f.state());
    await expect(f.service.deleteBooking('1', '4')).rejects.toBeInstanceOf(BadRequestException);
    expect(f.state()).toEqual(before);
  });
  test.each(['CANCELLED', 'REFUNDED'])('unpaid %s has no receivable and is hidden from customer detail without a global delete', async status => {
    const f = fixture({ status, totalCents: 4000, paymentStatus: 'UNPAID' });
    await f.service.deleteBooking('1', '4');
    await expect(f.service.getBooking('1', '4')).rejects.toBeInstanceOf(NotFoundException);
    // Business detail/list/settlement access is exercised in the HTTP suite.
    expect(f.state().booking.deletedAt).toBeNull();
  });
  test('other customer, guest and globally deleted rows are not changed', async () => {
    for (const patch of [{}, { userId: null }, { deletedAt: new Date() }]) {
      const f = fixture(patch), before = structuredClone(f.state());
      await expect(f.service.deleteBooking('1', '7')).rejects.toBeInstanceOf(NotFoundException);
      expect(f.state()).toEqual(before);
    }
  });
  test('audit failure rolls back the new customer preference', async () => {
    const f = fixture({}, true), before = structuredClone(f.state());
    await expect(f.service.deleteBooking('1', '4')).rejects.toThrow('Synthetic audit failure');
    expect(f.state()).toEqual(before);
  });
});
