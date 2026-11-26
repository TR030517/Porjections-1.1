import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { SquareProvider } from './square.provider';
import { syncRefundCase } from '../after-sales/refund-sync';

// Staged local doubles test transaction composition and transport contracts.
// They do not reproduce MySQL locks or contact a payment network.
jest.mock('../../common/notification-outbox', () => ({
  enqueueNotification: jest.fn(async (tx: any, input: any) => {
    if (tx.state.failNotification) throw new Error('Synthetic outbox failure');
    tx.state.notifications.push(input);
  }),
  syncBookingReminder: jest.fn(async (tx: any, booking: any) => { tx.state.reminders.push({ id: booking.id, status: booking.status }); }),
}));
const rid = '00000000-0000-4000-8000-000000000001';
const binding = { environment: 'sandbox', merchantId: 'M', locationId: 'L', shopId: '5', currency: 'usd', configurationHash: 'synthetic-binding' };
const confirmed = { id: 'PAY', orderId: 'ORDER', locationId: 'L', status: 'COMPLETED', amountCents: 10000, totalCents: 10000, currency: 'usd' };
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if (value.in) return value.in.includes(row[key]);
      if (value.not !== undefined) return row[key] !== value.not;
      if (value.lte !== undefined) return row[key] !== null && row[key] <= value.lte;
    }
    return row[key] === value;
  });
}
function fixture(paid = false) {
  let state: any = {
    booking: { id: 7n, shopId: 5n, userId: 3n, bookingNo: 'SYNTHETIC', shop: { ownerId: 2n }, deletedAt: null, paymentMode: 'ONLINE',
      priceCents: 9000, platformFeeCents: 1000, totalCents: 10000, paidCents: paid ? 10000 : 0, refundedCents: 0, currency: 'usd',
      status: paid ? 'CONFIRMED' : 'PENDING', paymentStatus: paid ? 'PAID' : 'UNPAID', startTime: new Date('2050-01-02T10:00:00Z'), holdExpiresAt: paid ? null : new Date('2050-01-01T00:00:00Z') },
    record: { id: rid, bookingId: 7n, provider: 'square', amountCents: 10000, refundedCents: 0, currency: 'usd', idempotencyKey: 'booking:7:payment:v1',
      status: paid ? 'SUCCEEDED' : 'CREATED', providerOrderId: 'ORDER', providerPaymentId: paid ? 'PAY' : null, providerBinding: binding },
    refunds: [], events: [], audits: [], transactions: [], notifications: [], reminders: [], case: null,
    profile: { id: 8n, userId: 2n, balanceCents: paid ? 9000 : 0, totalEarnedCents: paid ? 9000 : 0 }, permissions: ['BOOKINGS_READ'], released: 0,
  };
  let active = false;
  const model = (s: any): any => ({
    state: s, $queryRaw: jest.fn(async () => [{ id: 5n }]),
    booking: {
      findUnique: jest.fn(async ({ where }: any) => s.booking.id === where.id ? s.booking : null), findUniqueOrThrow: jest.fn(async () => s.booking),
      findMany: jest.fn(async ({ where }: any) => matches(s.booking, where) ? [s.booking] : []),
      update: jest.fn(async ({ data }: any) => Object.assign(s.booking, data)),
    },
    shop: { findUnique: jest.fn(async () => ({ ownerId: 2n })), findFirst: jest.fn(async () => ({ id: 5n, ownerId: 2n, owner: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null }, loginBinding: { shopId: 5n, userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } } })) },
    user: { findFirst: jest.fn(async ({ where }: any) => ['1:ADMIN', '2:MERCHANT', '4:STAFF'].includes(`${where.id}:${where.role}`) ? { id: where.id } : null) },
    shopStaffGrant: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', permissions: s.permissions })) },
    paymentRecord: {
      findUnique: jest.fn(async ({ where, include }: any) => matches(s.record, where) ? include?.booking ? { ...s.record, booking: s.booking } : s.record : null), findUniqueOrThrow: jest.fn(async () => s.record),
      update: jest.fn(async ({ data }: any) => Object.assign(s.record, data)),
      updateMany: jest.fn(async ({ where, data }: any) => { if (!matches(s.record, where)) return { count: 0 }; Object.assign(s.record, data); return { count: 1 }; }),
    },
    paymentEvent: {
      findUnique: jest.fn(async ({ where }: any) => s.events.find((e: any) => matches(e, where.provider_eventId)) ?? null),
      create: jest.fn(async ({ data }: any) => { s.events.push(data); return data; }),
    },
    refundRequest: {
      findUnique: jest.fn(async ({ where }: any) => s.refunds.find((r: any) => matches(r, where)) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => { const r = s.refunds.find((r: any) => matches(r, where)); if (!r) throw Error('Missing synthetic refund'); return r; }),
      findMany: jest.fn(async ({ where }: any) => s.refunds.filter((r: any) => matches(r, where))),
      count: jest.fn(async ({ where }: any) => s.refunds.filter((r: any) => matches(r, where)).length),
      aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amountCents: s.refunds.filter((r: any) => matches(r, where)).reduce((a: number, r: any) => a + r.amountCents, 0) } })),
      create: jest.fn(async ({ data }: any) => { const r = { id: '00000000-0000-4000-8000-000000000002', status: 'PENDING', providerRefundId: null, ...data }; s.refunds.push(r); return r; }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(s.refunds.find((r: any) => matches(r, where)), data)),
      updateMany: jest.fn(async ({ where, data }: any) => { const rows = s.refunds.filter((r: any) => matches(r, where)); rows.forEach((r: any) => Object.assign(r, data)); return { count: rows.length }; }),
    },
    afterSalesCase: {
      findUnique: jest.fn(async ({ where }: any) => s.case && matches(s.case, where) ? s.case : null),
      updateMany: jest.fn(async ({ where, data }: any) => { if (!s.case || !matches(s.case, where)) return { count: 0 }; const version = s.case.version; Object.assign(s.case, data); s.case.version = version + data.version.increment; return { count: 1 }; }),
    },
    merchantProfile: {
      findUnique: jest.fn(async () => s.profile),
      update: jest.fn(async ({ data }: any) => { s.profile.balanceCents += data.balanceCents.increment; s.profile.totalEarnedCents += data.totalEarnedCents.increment; return s.profile; }),
    },
    merchantTransaction: { create: jest.fn(async ({ data }: any) => { s.transactions.push(data); return data; }) },
    bookingResourceLock: { updateMany: jest.fn(async ({ where }: any) => { if (where.bookingId) s.released++; return { count: 1 }; }) },
    auditLog: { create: jest.fn(async ({ data }: any) => { s.audits.push(data); return data; }) },
  });
  const db: any = { $transaction: jest.fn(async (work: any, options: any) => { expect(options.isolationLevel).toBe('ReadCommitted'); const staged = structuredClone(state); active = true; try { const result = await work(model(staged)); state = staged; return structuredClone(result); } finally { active = false; } }) };
  for (const key of ['booking', 'paymentRecord', 'paymentEvent', 'refundRequest']) Object.defineProperty(db, key, { get: () => model(state)[key] });
  const square = {
    config: () => ({ enabled: true, provider: 'square', shopId: '5', currency: 'usd' }), binding: () => binding,
    getOrder: jest.fn(async () => { expect(active).toBe(false); return { id: 'ORDER', referenceId: rid, amountCents: 10000, currency: 'usd', paymentIds: ['PAY'] }; }),
    getPayment: jest.fn(async () => { expect(active).toBe(false); return confirmed; }),
    getRefund: jest.fn(async () => { expect(active).toBe(false); return { id: 'REFUND', paymentId: 'PAY', orderId: 'ORDER', currency: 'usd', amountCents: 2500, status: 'COMPLETED' }; }),
    refund: jest.fn(async () => { expect(active).toBe(false); throw Error('Synthetic response lost'); }),
  };
  const service: any = new PaymentService(db); service.square = square;
  return { service: service as PaymentService, db, square, state: () => state, change: (update: (s: any) => void) => update(state), model };
}
const savedEnv = { ...process.env };
beforeEach(() => { process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'false'; process.env.PAYMENT_PROVIDER = 'square'; process.env.REFUND_POLICY_FULL_HOURS = '24'; process.env.REFUND_POLICY_PARTIAL_PERCENT = '50'; });
afterAll(() => { process.env = savedEnv; });

describe('trusted booking payment recovery (local staged doubles)', () => {
  test('server GET result settles once, emits exact notifications, and never exposes provider binding', async () => {
    const f = fixture();
    const result = await f.service.reconcileBooking('7', '3', 'CUSTOMER');
    await f.service.reconcileBooking('7', '3', 'CUSTOMER');
    expect(result).toMatchObject({ checked: true, recordStatus: 'SUCCEEDED', paymentStatus: 'PAID' });
    expect(f.state().transactions).toHaveLength(1); expect(f.state().profile.balanceCents).toBe(9000);
    expect(f.state().notifications.map((n: any) => n.eventKey)).toEqual([`payment:${rid}:completed`, 'booking:7:confirmed']);
    expect(JSON.stringify(result)).not.toMatch(/configurationHash|locationId|merchantId|checkoutUrl/);
  });
  test.each(['amount', 'currency', 'reference', 'multiple'])('rejects untrusted %s before any money mutation', async kind => {
    const f = fixture();
    f.square.getOrder.mockResolvedValue({ id: 'ORDER', referenceId: kind === 'reference' ? 'other' : rid, amountCents: kind === 'amount' ? 9999 : 10000, currency: kind === 'currency' ? 'eur' : 'usd', paymentIds: kind === 'multiple' ? ['PAY', 'OTHER'] : ['PAY'] });
    await expect(f.service.reconcileBooking('7', '3', 'CUSTOMER')).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().booking.paidCents).toBe(0); expect(f.state().transactions).toHaveLength(0);
  });
  test('disabled or changed original account sends no channel request and preserves pending records', async () => {
    const f = fixture(); f.change(s => { s.record.providerBinding = { ...binding, merchantId: 'other' }; });
    await expect(f.service.reconcileBooking('7', '3', 'CUSTOMER')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.square.getOrder).not.toHaveBeenCalled();
    f.square.config = () => ({ enabled: false, provider: 'square', shopId: '5', currency: 'usd' });
    await expect(f.service.reconcileBooking('7', '3', 'CUSTOMER')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.square.getOrder).not.toHaveBeenCalled();
  });
  test('READ-only staff and another customer cannot trigger a channel query', async () => {
    const f = fixture();
    await expect(f.service.reconcileBooking('7', '4', 'STAFF')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.reconcileBooking('7', '99', 'CUSTOMER')).rejects.toThrow('Booking not found');
    expect(f.square.getOrder).not.toHaveBeenCalled();
  });
  test('late verified payment becomes REFUNDING without restoring resources or confirming an expired reservation', async () => {
    const f = fixture(); f.change(s => { s.booking.status = 'CANCELLED'; s.booking.holdExpiresAt = new Date(0); });
    await f.service.reconcileBooking('7', '3', 'CUSTOMER');
    expect(f.state().booking.status).toBe('REFUNDING'); expect(f.state().released).toBeGreaterThan(0);
    expect(f.state().notifications.map((n: any) => n.topic)).toEqual(['PAYMENT_RECEIVED']);
  });
  test('outbox failure rolls back local settlement; original provider proof safely replays without recollection', async () => {
    const f = fixture(); f.change(s => { s.failNotification = true; });
    await expect(f.service.reconcileBooking('7', '3', 'CUSTOMER')).rejects.toThrow('Synthetic outbox failure');
    expect(f.state().record.status).toBe('CREATED'); expect(f.state().transactions).toHaveLength(0);
    f.change(s => { s.failNotification = false; });
    await f.service.reconcileBooking('7', '3', 'CUSTOMER'); expect(f.state().transactions).toHaveLength(1);
  });
  test('unknown refund stays fenced, another key is rejected, and the original key is reused after timeout', async () => {
    const f = fixture(true);
    await expect(f.service.refundBooking('7', '2', 'MERCHANT', 2500, 'same-key-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(f.service.refundBooking('7', '2', 'MERCHANT', 2500, 'other-key-2')).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.refundBooking('7', '2', 'MERCHANT', 2500, 'same-key-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.state().refunds).toHaveLength(1); expect(f.state().refunds[0].status).toBe('RETRYABLE');
    expect(f.square.refund.mock.calls.map((call: any) => call[0].idempotencyKey)).toEqual(['same-key-1', 'same-key-1']);
    const result = await f.service.reconcileBooking('7', '2', 'MERCHANT');
    expect(result.refunds[0].originalKeyRetryRequired).toBe(true); expect(f.square.getRefund).not.toHaveBeenCalled();
    expect(f.square.refund).toHaveBeenCalledTimes(2); expect(f.state().booking.refundedCents).toBe(0);
  });
  test('known refund is GET-recovered exactly once and synchronizes case without closing it or inventing an actor', async () => {
    const f = fixture(true);
    f.change(s => { s.refunds.push({ id: 'req-1', bookingId: 7n, paymentRecordId: rid, idempotencyKey: 'case-key', amountCents: 2500, status: 'RETRYABLE', providerRefundId: 'REFUND' });
      s.case = { id: 9n, bookingId: 7n, type: 'REFUND', status: 'IN_PROGRESS', version: 4, refundKey: 'case-key', requestedAmountCents: 2500, refundState: 'RETRYABLE', refundRequestId: 'req-1' }; });
    await f.service.reconcileBooking('7', '2', 'MERCHANT'); await f.service.reconcileBooking('7', '2', 'MERCHANT');
    expect(f.square.refund).not.toHaveBeenCalled(); expect(f.square.getRefund).toHaveBeenCalledTimes(1);
    expect(f.state().booking.refundedCents).toBe(2500); expect(f.state().transactions).toHaveLength(1);
    expect(f.state().case).toMatchObject({ status: 'IN_PROGRESS', refundState: 'SUCCEEDED', version: 5 });
    expect(f.state().notifications.filter((n: any) => n.topic === 'REFUND_PROCESSED')).toHaveLength(1);
    expect(f.state().reminders.at(-1).status).toBe('CONFIRMED');
  });
  test('unknown checkout and empty provider order never invent another payment', async () => {
    const f = fixture(); f.change(s => { s.record.providerOrderId = null; });
    await expect(f.service.reconcileBooking('7', '3', 'CUSTOMER')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.square.getOrder).not.toHaveBeenCalled();
    f.change(s => { s.record.providerOrderId = 'ORDER'; }); f.square.getOrder.mockResolvedValue({ id: 'ORDER', referenceId: rid, amountCents: 10000, currency: 'usd', paymentIds: [] });
    await f.service.reconcileBooking('7', '3', 'CUSTOMER'); expect(f.state().record.status).toBe('CREATED'); expect(f.square.getPayment).not.toHaveBeenCalled();
  });
  test('controller refuses client-paid state and supplied provider IDs', async () => {
    const service = { reconcileBooking: jest.fn() }, controller = new PaymentController(service as any);
    for (const body of [{ status: 'SUCCEEDED' }, { providerPaymentId: 'PAY' }, { amountCents: 1 }, []]) expect(() => controller.reconcile('7', body, '3', 'CUSTOMER')).toThrow(BadRequestException);
    expect(service.reconcileBooking).not.toHaveBeenCalled();
  });
  test('case linkage mismatch cannot be silently synchronized', async () => {
    const tx = { afterSalesCase: { findUnique: jest.fn(async () => ({ type: 'REFUND', bookingId: 99n, requestedAmountCents: 2500 })), updateMany: jest.fn() } };
    await expect(syncRefundCase(tx, { id: 'req', bookingId: 7n, amountCents: 2500, idempotencyKey: 'case-key', status: 'SUCCEEDED' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.afterSalesCase.updateMany).not.toHaveBeenCalled();
  });
});

describe('Square official read-only recovery wire contract', () => {
  const env: NodeJS.ProcessEnv = { PAYMENT_PROVIDER: 'square', PAYMENT_EXTERNAL_ENABLED: 'true', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'synthetic-unit-token', SQUARE_LOCATION_ID: 'L', SQUARE_MERCHANT_ID: 'M', SQUARE_CURRENCY: 'USD', SQUARE_SHOP_ID: '5', SQUARE_WEBHOOK_SIGNATURE_KEY: 'synthetic-unit-signature', SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://api.example.test/square', SQUARE_CHECKOUT_REDIRECT_URL: 'https://app.example.test/' };
  const money = { amount: 10000, currency: 'USD' };
  test('GETs only persisted IDs with no request body and strips provider card/private fields', async () => {
    const transport = jest.fn(async (url: any, options: any) => {
      expect(options.method).toBe('GET'); expect(options).not.toHaveProperty('body');
      const value = String(url).includes('/orders/') ? { order: { id: 'ORDER', location_id: 'L', reference_id: rid, total_money: money, tenders: [{ payment_id: 'PAY' }] } }
        : String(url).includes('/payments/') ? { payment: { id: 'PAY', order_id: 'ORDER', location_id: 'L', status: 'COMPLETED', amount_money: money, total_money: money, card_details: { private: true } } }
          : { refund: { id: 'REFUND', payment_id: 'PAY', location_id: 'L', status: 'PENDING', amount_money: money } };
      return new Response(JSON.stringify(value));
    });
    const provider = new SquareProvider(env, transport as any);
    await provider.getOrder('ORDER'); const payment = await provider.getPayment('PAY'); await provider.getRefund('REFUND');
    expect(transport.mock.calls.map((call: any) => call[0])).toEqual(['https://connect.squareupsandbox.com/v2/orders/ORDER', 'https://connect.squareupsandbox.com/v2/payments/PAY', 'https://connect.squareupsandbox.com/v2/refunds/REFUND']);
    expect(payment).not.toHaveProperty('card_details');
  });
  test.each(['wrong-id', 'wrong-location', 'wrong-currency', 'missing-reference'])('rejects %s in the order response', async mismatch => {
    const order: any = { id: 'ORDER', location_id: 'L', reference_id: rid, total_money: money };
    if (mismatch === 'wrong-id') order.id = 'OTHER'; if (mismatch === 'wrong-location') order.location_id = 'OTHER';
    if (mismatch === 'wrong-currency') order.total_money = { ...money, currency: 'EUR' }; if (mismatch === 'missing-reference') delete order.reference_id;
    const provider = new SquareProvider(env, jest.fn(async () => new Response(JSON.stringify({ order }))) as any);
    await expect(provider.getOrder('ORDER')).rejects.toBeInstanceOf(BadRequestException);
  });
  test('disabled configuration refuses all read calls without making transport requests', async () => {
    const transport = jest.fn(), provider = new SquareProvider({ ...env, PAYMENT_EXTERNAL_ENABLED: 'false' }, transport);
    for (const action of [() => provider.getOrder('ORDER'), () => provider.getPayment('PAY'), () => provider.getRefund('REFUND')]) await expect(action()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(transport).not.toHaveBeenCalled();
  });
});
