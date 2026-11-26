// Outbox persistence and rollback are covered against isolated MySQL.
jest.mock('../../common/notification-outbox', () => ({ enqueueNotification: jest.fn(async () => {}), enqueueBookingOrderEmail: jest.fn(async () => {}), syncBookingReminder: jest.fn(async () => {}) }));
import { SettlementService } from './settlement.service';
import { fullySettled, receiptInput, settlementActions } from './settlement.rules';
import { PaymentService } from '../payment/payment.service';
import { shopPaymentPolicy } from '../../common/shop-payment-policy';
import { enqueueBookingOrderEmail, enqueueNotification } from '../../common/notification-outbox';

/** Isolated service/transaction doubles exercise authorization, evidence and
 * atomic failure. They do not establish MySQL lock/concurrency correctness. */
function fixture(options: { mode?: string; status?: string; amount?: number; auditFailure?: boolean } = {}) {
  let state: any = { booking: { id: 1n, shopId: 2n, userId: 4n, shop: { ownerId: 99n }, paymentMode: options.mode ?? 'PAY_AT_STORE',
    totalCents: options.amount ?? 10000, paidCents: 0, refundedCents: 0, currency: 'usd', paymentStatus: 'UNPAID',
    status: options.status ?? 'CONFIRMED', endTime: new Date('2020-01-01T00:00:00Z'), deletedAt: null }, entries: [], audits: [], released: 0 };
  let external = false, fence = false;
  const db: any = { $transaction: async (fn: any) => {
    const stage = structuredClone(state);
    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      user: { findFirst: jest.fn(async ({where}:any) => ['3','5'].includes(String(where.id)) && where.role === 'MERCHANT' ? {id:where.id,role:'MERCHANT',status:'ACTIVE',deletedAt:null} : null) },
      shop: { findFirst: jest.fn(async ({where}:any) => where.id === 2n ? {id:2n,ownerId:99n,status:'APPROVED',deletedAt:null,loginBinding:{userId:3n,user:{role:'MERCHANT',status:'ACTIVE',deletedAt:null}}} : null) },
      shopAccountGrant: {findFirst:jest.fn(async()=>null)},
      booking: { findUnique: jest.fn(async ({ where }: any) => where.id === 1n ? stage.booking : null),
        findMany: jest.fn(async () => []), update: jest.fn(async ({ data }: any) => { Object.assign(stage.booking, data); return stage.booking; }) },
      bookingResourceLock: { updateMany: jest.fn(async ({ data }: any) => { if (data.status === 'RELEASED') stage.released++; return { count: 1 }; }) },
      bookingSettlementEntry: {
        findMany: jest.fn(async () => stage.entries),
        findUnique: jest.fn(async ({ where }: any) => stage.entries.find((e: any) => e.bookingId === where.bookingId_requestKey.bookingId && e.requestKey === where.bookingId_requestKey.requestKey) ?? null),
        create: jest.fn(async ({ data }: any) => { const row = { ...data, id: `00000000-0000-4000-a000-${String(stage.entries.length + 1).padStart(12, '0')}`, createdAt: new Date() }; stage.entries.push(row); return row; }),
      },
      paymentRecord: { findUnique: jest.fn(async () => external ? { id: 'external' } : null) },
      refundRequest: { findFirst: jest.fn(async () => fence ? { id: 'unresolved' } : null) },
      auditLog: { create: jest.fn(async ({ data }: any) => { if (options.auditFailure) throw new Error('Synthetic audit failure'); stage.audits.push(data); return data; }) },
    };
    const result = await fn(tx); state = stage; return result;
  } };
  return { service: new SettlementService(db), state: () => state, setExternal: () => external = true, setFence: () => fence = true };
}
const command = (overrides: any = {}) => ({ requestKey: 'receipt-request-1', amountCents: 10000, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Customer paid at reception', ...overrides });

describe('pay-at-store and zero settlement boundaries', () => {
  beforeEach(() => jest.clearAllMocks());
  let previousOnline: string | undefined;
  beforeAll(() => { previousOnline = process.env.BOOKING_ONLINE_PAYMENT_ENABLED; delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; });
  afterAll(() => { if (previousOnline === undefined) delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; else process.env.BOOKING_ONLINE_PAYMENT_ENABLED = previousOnline; });
  test('store policy requires literal opt-in and never trusts strings', () => {
    expect(shopPaymentPolicy(null).payAtStoreEnabled).toBe(false);
    expect(shopPaymentPolicy({ paymentPolicy: { payAtStoreEnabled: 'true' } }).payAtStoreEnabled).toBe(false);
    expect(shopPaymentPolicy({ paymentPolicy: { payAtStoreEnabled: true } }).payAtStoreEnabled).toBe(true);
  });
  test('acceptance, collection and completion are separate', () => {
    const pending = fixture({ status: 'PENDING' }).state().booking;
    expect(settlementActions(pending, true, false).confirm).toBe(true);
    expect(settlementActions(pending, false, false).confirm).toBe(false);
    expect(settlementActions({ ...pending, paymentMode: 'ONLINE' }, true, false).confirm).toBe(false);
    expect(settlementActions({ ...pending, status: 'CONFIRMED' }, true, false).complete).toBe(true);
    const paid = { ...pending, paidCents: 10000, paymentStatus: 'PAID', status: 'CONFIRMED' };
    expect(settlementActions(paid, true, false).complete).toBe(true);
    expect(settlementActions({ ...paid, endTime: new Date('2099-01-01') }, true, false).complete).toBe(false);
    expect(settlementActions(paid, true, true).complete).toBe(false);
  });
  test('zero settlement requires exact zero amounts and its own mode', () => {
    const zero = { paymentMode: 'ZERO', totalCents: 0, paidCents: 0, refundedCents: 0, paymentStatus: 'PAID' };
    expect(fullySettled(zero)).toBe(true);
    expect(fullySettled({ ...zero, totalCents: 1 })).toBe(false);
    expect(fullySettled({ ...zero, paymentMode: 'ONLINE' })).toBe(false);
    expect(fullySettled({ ...zero, paidCents: 1 })).toBe(false);
  });
  test.each([0, -1, 1.5, 100000000, Number.NaN])('rejects invalid integer amount %s', amountCents => {
    expect(() => receiptInput(command({ amountCents }))).toThrow();
  });
  test('rejects fake methods, invalid dates, local-time guesses, old and future events', () => {
    expect(() => receiptInput(command({ method: 'SQUARE_SUCCESS' }))).toThrow();
    for (const occurredAt of ['2026-02-30T00:00:00Z', '2026-01-01T12:00:00', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) expect(() => receiptInput(command({ occurredAt }))).toThrow();
  });
  test('receipt replay is once-only; changed payload/key and other owner are rejected', async () => {
    const f = fixture(), input = command();
    const first = await f.service.recordReceipt('1', '3', 'MERCHANT', input);
    expect(first.paidCents).toBe(10000); expect(first.paymentStatus).toBe('PAID');
    await f.service.recordReceipt('1', '3', 'MERCHANT', input);
    expect(f.state().entries).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
    await expect(f.service.recordReceipt('1', '3', 'MERCHANT', { ...input, amountCents: 9999 })).rejects.toThrow('different parameters');
    await expect(f.service.recordReceipt('1', '5', 'MERCHANT', input)).rejects.toThrow('not found');
    await expect(f.service.get('1', '4', 'CUSTOMER')).rejects.toThrow('not found');
  });
  test('partial receipts settle exactly, overcollection and repeat reversal are rejected', async () => {
    const f = fixture();
    const a = await f.service.recordReceipt('1', '3', 'MERCHANT', command({ amountCents: 4000 }));
    expect(a.amountDueCents).toBe(6000); expect(a.allowedActions.complete).toBe(true);
    await expect(f.service.recordReceipt('1', '3', 'MERCHANT', command({ requestKey: 'receipt-over', amountCents: 6001 }))).rejects.toThrow('outstanding');
    await f.service.recordReceipt('1', '3', 'MERCHANT', command({ requestKey: 'receipt-rest', amountCents: 6000 }));
    const id = f.state().entries[0].id;
    const reverse = { requestKey: 'reverse-original', reason: 'Wrong receipt corrected' };
    const result = await f.service.reverse('1', id, '3', 'MERCHANT', reverse);
    expect(result.paidCents).toBe(6000); expect(result.status).toBe('CONFIRMED');
    await f.service.reverse('1', id, '3', 'MERCHANT', reverse);
    await expect(f.service.reverse('1', id, '3', 'MERCHANT', { ...reverse, requestKey: 'reverse-again' })).rejects.toThrow('already');
  });
  test('recording an actual full refund releases resources but never erases a receipt', async () => {
    const f = fixture(); await f.service.recordReceipt('1', '3', 'MERCHANT', command());
    await expect(f.service.recordRefund('1', '3', 'MERCHANT', command({ requestKey: 'refund-partial', amountCents: 9999 }))).rejects.toThrow('full remaining');
    const input = command({ requestKey: 'refund-full-1', reason: 'Cash already returned to customer' });
    const result = await f.service.recordRefund('1', '3', 'MERCHANT', input);
    expect(result.netPaidCents).toBe(0); expect(result.refundedCents).toBe(10000); expect(result.status).toBe('CANCELLED');
    expect(result.entries).toHaveLength(2); expect(result.entries[0].canReverse).toBe(false);
    await f.service.recordRefund('1', '3', 'MERCHANT', input);
    expect(f.state().entries).toHaveLength(2);
    expect(enqueueBookingOrderEmail).toHaveBeenCalledTimes(1);
    expect(enqueueBookingOrderEmail).toHaveBeenCalledWith(expect.anything(), {
      eventKey: 'booking:1:cancelled', userId: 4n, bookingId: 1n, topic: 'BOOKING_CANCELLED',
    });
    expect(enqueueNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ topic: 'REFUND_PROCESSED' }));
  });
  test('unaccepted, online, externally linked and refund-fenced bookings reject manual receipt', async () => {
    await expect(fixture({ status: 'PENDING' }).service.recordReceipt('1', '3', 'MERCHANT', command())).rejects.toThrow('Accept');
    await expect(fixture({ mode: 'ONLINE' }).service.recordReceipt('1', '3', 'MERCHANT', command())).rejects.toThrow('pay-at-store');
    const ext = fixture(); ext.setExternal(); await expect(ext.service.recordReceipt('1', '3', 'MERCHANT', command())).rejects.toThrow('External checkout');
    const fence = fixture(); fence.setFence(); await expect(fence.service.recordReceipt('1', '3', 'MERCHANT', command())).rejects.toThrow('Accept');
  });
  test('audit failure rolls back evidence and totals together', async () => {
    const f = fixture({ auditFailure: true });
    await expect(f.service.recordReceipt('1', '3', 'MERCHANT', command())).rejects.toThrow('audit failure');
    expect(f.state().booking.paidCents).toBe(0); expect(f.state().entries).toHaveLength(0);
  });
  test('completed service remains completed and has no receivable after full refund', async () => {
    const f = fixture({ status: 'COMPLETED' });
    await f.service.recordReceipt('1', '3', 'MERCHANT', command());
    const result = await f.service.recordRefund('1', '3', 'MERCHANT', command({ requestKey: 'completed-refund' }));
    expect(result.status).toBe('COMPLETED'); expect(result.amountDueCents).toBe(0);
    expect(result.allowedActions.recordReceipt).toBe(false);
    expect(enqueueBookingOrderEmail).not.toHaveBeenCalled();
    expect(enqueueNotification).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ topic: 'BOOKING_CANCELLED' }));
  });
  test('cancellation email persistence failure rolls back refund evidence, amounts, audit and released locks', async () => {
    const f = fixture(); await f.service.recordReceipt('1', '3', 'MERCHANT', command());
    const before = structuredClone(f.state());
    (enqueueBookingOrderEmail as jest.Mock).mockRejectedValueOnce(new Error('Synthetic cancellation email failure'));
    const refund = command({ requestKey: 'refund-email-fail' });
    await expect(f.service.recordRefund('1', '3', 'MERCHANT', refund)).rejects.toThrow('cancellation email failure');
    expect(f.state()).toEqual(before);
    await f.service.recordRefund('1', '3', 'MERCHANT', refund);
    expect(f.state().booking).toMatchObject({ status: 'CANCELLED', paidCents: 10000, refundedCents: 10000 });
    expect(f.state().entries).toHaveLength(2);
  });
  test('provider checkout rejects pay-at-store before provider configuration/network', async () => {
    const db: any = { booking: { findUnique: async () => ({ id: 1n, userId: 4n, shopId: 2n, paymentMode: 'PAY_AT_STORE' }) } };
    const previous = process.env.BOOKING_ONLINE_PAYMENT_ENABLED; process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true';
    try { await expect(new PaymentService(db).createPaymentIntent({ bookingId: '1', userId: '4' })).rejects.toThrow('online checkout'); }
    finally { if (previous === undefined) delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; else process.env.BOOKING_ONLINE_PAYMENT_ENABLED = previous; }
  });
});
