import { bookingOrderEmailSnapshot } from '../../common/booking-order-email';
import { NotificationWorker, OutboxRow } from './notification-worker.service';
import { OrderEmailDelivery, orderEmailConfig, type OrderEmailTransport } from './order-email-delivery';
import { canRetryNotification, orderEmailTaskStatus } from './order-email-status';
import { NotificationInboxService } from './notification-inbox.service';
import { enqueueBookingOrderEmail } from '../../common/notification-outbox';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sql = (q: any) => q.strings.join('?');
const jobId = '00000000-0000-4000-8000-000000000020';
const order = () => ({ id: 20n, userId: 5n, shopId: 10n, bookingNo: 'MJ_SYNTHETIC_EMAIL', status: 'PENDING', deletedAt: null, bookingTimezone: 'UTC',
  startTime: new Date('2030-06-01T09:00:00Z'), endTime: new Date('2030-06-01T10:00:00Z'), totalCents: 8013, currency: 'usd',
  shop: { name: 'Synthetic store', nameEn: null, address: '146 Synthetic Lane', city: 'Test Harbor', state: 'NY', zipCode: '10002', timezone: 'UTC' },
  items: [{ serviceNameSnapshot: 'Original saved service', variantNameSnapshot: 'Saved option', participantIndex: 1, sequence: 1, durationMin: 60, durationKindSnapshot: 'TIMED' }],
  addOns: [{ nameSnapshot: 'Saved oil', participantIndex: 1, sequence: 1, unitPriceCentsSnapshot: 1013, quantity: 1, lineTotalCentsSnapshot: 1013 }] });
const envKeys = ['ORDER_EMAIL_ENABLED','ORDER_EMAIL_PROVIDER','ORDER_EMAIL_API_KEY','ORDER_EMAIL_FROM','NOTIFICATION_WORKER_ENABLED'];
let oldEnv: Record<string, string | undefined>;
beforeEach(() => { oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]])); Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'true', ORDER_EMAIL_PROVIDER: 'resend', ORDER_EMAIL_API_KEY: 'synthetic-fake-key-never-sent', ORDER_EMAIL_FROM: 'orders@example.test', NOTIFICATION_WORKER_ENABLED: 'false' }); });
afterEach(() => { for (const key of envKeys) if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; jest.useRealTimers(); });

describe('order mail transport has no implicit real-network test and no ambiguous replay', () => {
  test('default configuration is disabled and separated from auth email secrets', async () => {
    expect(orderEmailConfig({ AUTH_EMAIL_PROVIDER: 'resend', AUTH_EMAIL_FROM: 'login@example.test', AUTH_EMAIL_API_KEY: 'not-an-order-key' })).toMatchObject({ enabled: false, reasonCode: 'ORDER_EMAIL_NOT_CONFIGURED' });
    process.env.ORDER_EMAIL_ENABLED = 'false'; const fake = jest.fn(async () => ({ status: 200, acceptedId: 'capture' }));
    expect(await new OrderEmailDelivery(fake).send({ recipient: 'guest@example.test', subject: 'Order', text: 'Synthetic order' }, jobId)).toMatchObject({ status: 'BLOCKED', code: 'ORDER_EMAIL_NOT_CONFIGURED' }); expect(fake).not.toHaveBeenCalled();
  });
  test('captured transport receives one stable provider idempotency key; only explicit429 retries', async () => {
    const fake = jest.fn(async (_message: any, _key: string, _signal: AbortSignal) => ({ status: 200, acceptedId: 'captured-mail' })), delivery = new OrderEmailDelivery(fake), message = { recipient: 'guest@example.test', subject: 'Order', text: 'Synthetic order' };
    expect(await delivery.send(message, jobId)).toEqual({ status: 'ACCEPTED', code: null, accepted: 1 }); expect(fake).toHaveBeenCalledTimes(1); expect(fake.mock.calls[0][1]).toBe('booking-order/' + jobId);
    expect(await new OrderEmailDelivery(async () => ({ status: 429, acceptedId: null })).send(message, jobId)).toMatchObject({ status: 'FAILED', code: 'ORDER_EMAIL_RATE_LIMITED' });
    for (const status of [200, 500, 503]) expect(await new OrderEmailDelivery(async () => ({ status, acceptedId: null })).send(message, jobId)).toMatchObject({ status: 'FAILED', code: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN' });
    expect(await new OrderEmailDelivery(async () => ({ status: 422, acceptedId: null })).send(message, jobId)).toMatchObject({ status: 'BLOCKED', code: 'ORDER_EMAIL_PROVIDER_REJECTED' });
  });
  test('timeout aborts and becomes acceptance unknown; no blind automatic or manual resend', async () => {
    jest.useFakeTimers(); let signal: AbortSignal | undefined; const transport: OrderEmailTransport = async (_message, _key, value) => { signal = value; return new Promise(() => undefined); };
    const pending = new OrderEmailDelivery(transport).send({ recipient: 'guest@example.test', subject: 'Order', text: 'Order' }, jobId, 100);
    await jest.advanceTimersByTimeAsync(100); expect(await pending).toMatchObject({ code: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN' }); expect(signal?.aborted).toBe(true);
    expect(canRetryNotification({ channel: 'EMAIL', status: 'FAILED', retryCount: 0, lastErrorCode: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN' }, 3)).toBe(false);
    expect(orderEmailTaskStatus({ status: 'FAILED', lastErrorCode: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN' }, true)).toBe('ACCEPTANCE_UNKNOWN');
  });
});

function workerFixture(options: { configured?: boolean; cancelled?: boolean; recipientChanged?: boolean; unverified?: boolean; result?: 'accepted' | 'unknown' | 'rate' } = {}) {
  const booking = order(), snapshot = bookingOrderEmailSnapshot(booking, 'BOOKING_CREATED')!;
  if (options.cancelled) booking.status = 'CANCELLED';
  const row: OutboxRow = { id: jobId, user_id: 5n, booking_id: 20n, expected_start_at_utc: null, topic: 'BOOKING_CREATED', channel: 'EMAIL', status: 'PROCESSING', attempts: 1, max_attempts: 5, resource_type: 'BOOKING', resource_id: '20', lease_token: null, data_json: JSON.stringify(snapshot) };
  const writes: any[] = []; let insideTx = false;
  const tx: any = { booking: { findUnique: async () => booking }, user: { findFirst: async () => ({ id: options.recipientChanged ? 6n : 5n, role: 'CUSTOMER', email: 'guest+capture@example.test', emailVerifiedAt: options.unverified ? null : new Date('2030-01-01T00:00:00Z') }) },
    $executeRaw: jest.fn(async (q: any) => { writes.push(q); if (sql(q).includes('attempts=attempts+1')) row.lease_token = q.values[0]; return 1; }),
    $queryRaw: jest.fn(async (q: any) => { if (sql(q).includes('SELECT * FROM notification_outbox')) return [row]; if (sql(q).includes('SELECT id FROM notification_outbox')) return [{ id: jobId }]; return []; }) };
  const db: any = { ...tx, $transaction: async (work: any) => { insideTx = true; try { return await work(tx); } finally { insideTx = false; } } };
  const transport = jest.fn(async (message: any, key: string) => { expect(insideTx).toBe(false); return { status: options.result === 'rate' ? 429 : options.result === 'unknown' ? 500 : 200, acceptedId: options.result === 'unknown' || options.result === 'rate' ? null : 'captured-provider-id' }; });
  const email = new OrderEmailDelivery(transport); if (options.configured === false) process.env.ORDER_EMAIL_ENABLED = 'false';
  const push = { config: jest.fn(() => ({ enabled: true })), sendToUser: jest.fn() };
  return { worker: new NotificationWorker(db, push as any, email), transport, push, writes, tx, db, row };
}
describe('durable EMAIL worker branch with captured transport', () => {
  test('the order worker saves a real local capture without calling the external transport', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'massajoy-worker-email-'));
    const localKeys = ['NODE_ENV','ORDER_EMAIL_LOCAL_CAPTURE','ORDER_EMAIL_LOCAL_CAPTURE_DIR'];
    const previous = Object.fromEntries(localKeys.map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, { NODE_ENV: 'test', ORDER_EMAIL_PROVIDER: 'local', ORDER_EMAIL_LOCAL_CAPTURE: 'true', ORDER_EMAIL_LOCAL_CAPTURE_DIR: directory });
      const f = workerFixture(); await (f.worker as any).process({ id: jobId, booking_id: 20n });
      expect(f.transport).not.toHaveBeenCalled(); expect(f.writes.at(-1).values).toContain('ACCEPTED');
      const captured = JSON.parse(await readFile(join(directory, jobId + '.json'), 'utf8'));
      expect(captured).toMatchObject({ deliveryMode: 'LOCAL_CAPTURE', externalDelivery: false, recipient: 'guest+capture@example.test' });
      for (const text of ['MJ_SYNTHETIC_EMAIL','Saved oil','Whole-order total: $80.13','offline','UTC']) expect(captured.text).toContain(text);
      expect(f.worker.config()).toMatchObject({ externalDelivery: 'LOCAL_CAPTURE_ONLY', orderEmail: { deliveryMode: 'LOCAL_CAPTURE' } });
    } finally {
      for (const key of localKeys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('transactional enqueue snapshot flows through claim and EMAIL worker into captured English transport', async () => {
    const inserts: any[] = []; const transaction: any = { booking: { findUnique: async () => order() },
      user: { findUnique: async () => ({ id: 5n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, email: 'guest+capture@example.test', emailVerifiedAt: new Date('2030-01-01T00:00:00Z') }) },
      $executeRaw: async (q: any) => { inserts.push(q); return 1; }, $queryRaw: async () => [{ content_hash: inserts.at(-1).values[2] }] };
    await enqueueBookingOrderEmail(transaction, { eventKey: 'booking:20:created', userId: 5n, bookingId: 20n, topic: 'BOOKING_CREATED' });
    expect(inserts.map(row => row.values[1])).toEqual(['booking:20:created', 'booking:20:created:shop']);
    const inserted = inserts.find(row => row.values[1] === 'booking:20:created');
    expect(inserted.values).toContain('PENDING');
    expect(inserts[1].values).toContain('BLOCKED'); expect(inserts[1].values).toContain('ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE');
    const serialized = inserted.values.find((value: unknown) => typeof value === 'string' && value.startsWith('{') && value.includes('"version":1'));
    expect(serialized).toEqual(expect.any(String)); const f = workerFixture(); f.row.data_json = serialized;
    await (f.worker as any).process({ id: jobId, booking_id: 20n });
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.transport.mock.calls[0][0].text).toContain('Saved oil'); expect(f.transport.mock.calls[0][0].text).toContain('Whole-order total: $80.13');
    expect(f.writes.at(-1).values).toContain('ACCEPTED'); expect(f.push.sendToUser).not.toHaveBeenCalled();
  });
  test('claimed immutable order renders full English body and dispatches outside transaction; never enters PUSH', async () => {
    const f = workerFixture(); await (f.worker as any).process({ id: jobId, booking_id: 20n });
    expect(f.transport).toHaveBeenCalledTimes(1); const [message, key] = f.transport.mock.calls[0];
    expect(message.recipient).toBe('guest+capture@example.test'); expect(key).toBe('booking-order/' + jobId);
    for (const value of ['MJ_SYNTHETIC_EMAIL','Synthetic store','146 Synthetic Lane','UTC','Original saved service','Saved option','Saved oil','$10.13','$80.13','offline']) expect(message.text).toContain(value);
    expect(f.push.config).not.toHaveBeenCalled(); expect(f.push.sendToUser).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw.mock.calls.some((call: any) => sql(call[0]).includes('notification_preferences'))).toBe(false);
    expect(f.writes.some(q => q.values.includes('ACCEPTED') && q.values.includes(1))).toBe(true);
  });
  test.each([{ configured: false }, { cancelled: true }, { recipientChanged: true }, { unverified: true }])('missing config/obsolete event/mismatched or unverified recipient never sends %j', async options => {
    const f = workerFixture(options); await (f.worker as any).process({ id: jobId, booking_id: 20n }); expect(f.transport).not.toHaveBeenCalled(); expect(f.push.sendToUser).not.toHaveBeenCalled();
    expect(f.writes.some(q => q.values.includes(options.cancelled ? 'CANCELLED' : 'BLOCKED'))).toBe(true);
  });
  test('unknown acceptance freezes a task; explicit rate rejection retains bounded retry schedule', async () => {
    for (const result of ['unknown','rate'] as const) { const f = workerFixture({ result }); await (f.worker as any).process({ id: jobId, booking_id: 20n }); const finish = f.writes.at(-1);
      expect(f.transport).toHaveBeenCalledTimes(1); expect(finish.values).toContain(result === 'unknown' ? 'FAILED' : 'PENDING'); expect(finish.values).toContain(result === 'unknown' ? 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN' : 'ORDER_EMAIL_RATE_LIMITED'); }
  });
  test('expired EMAIL lease is frozen before candidate selection, never automatically reclaimed', async () => {
    const f = workerFixture(); f.db.$queryRaw = jest.fn(async () => []); await f.worker.runOnce();
    expect(sql(f.writes[0])).toContain("channel='EMAIL'"); expect(sql(f.writes[0])).toContain("ORDER_EMAIL_ACCEPTANCE_UNKNOWN");
    expect(sql((f.db.$queryRaw.mock.calls as any)[0][0])).toContain("channel<>'EMAIL'"); expect(f.transport).not.toHaveBeenCalled();
  });
});

function statusFixture() {
  const job = { id: jobId, topic: 'BOOKING_CREATED', status: 'PENDING', attempts: 0, maxAttempts: 5, retryCount: 0, lastErrorCode: null, acceptedCount: 0, createdAt: new Date(), runAt: new Date(), finishedAt: null, dataJson: JSON.stringify(bookingOrderEmailSnapshot(order(), 'BOOKING_CREATED')) };
  const tx: any = { booking: { findUnique: async () => order() },
    user: { findFirst: async ({ where }: any) => ({ id: where.id }) }, shop: { findFirst: async () => ({ id: 10n, loginBinding: { userId: 2n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } } }) },
    shopAccountGrant: { findFirst: async () => null }, shopStaffGrant: { findUnique: async () => ({ status: 'ACTIVE', permissions: ['BOOKINGS_READ'] }) },
    $queryRaw: jest.fn(async () => [job]) };
  return { service: new NotificationInboxService({ $transaction: async (work: any) => work(tx) } as any), job, tx };
}
describe('order-scoped email status is truthful and does not grant admin access', () => {
  test('own customer sees safe queued/disabled/unknown/accepted status without contacts or raw payload', async () => {
    const f = statusFixture(); const own = { id: '5', role: 'CUSTOMER' };
    expect(await f.service.orderEmail(own, '20')).toMatchObject({ bookingId: '20', channel: 'EMAIL', status: 'QUEUED' });
    expect((await f.service.orderEmail(own,'20')).configuration).toMatchObject({ enabled: true, workerEnabled: false, reasonCode: 'ORDER_EMAIL_WORKER_DISABLED' });
    process.env.ORDER_EMAIL_ENABLED = 'false'; const disabled = await f.service.orderEmail(own, '20'); expect(disabled.status).toBe('NOT_CONFIGURED'); expect(disabled.configuration).toMatchObject({ enabled: false });
    expect(JSON.stringify(disabled)).not.toMatch(/guest@|data_json|API_KEY|recipient|password|Bearer/);
    f.job.status = 'ACCEPTED'; expect((await f.service.orderEmail(own, '20')).status).toBe('ACCEPTED');
    f.job.status = 'FAILED'; (f.job as any).lastErrorCode = 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN'; expect((await f.service.orderEmail(own, '20')).status).toBe('ACCEPTANCE_UNKNOWN');
  });
  test('other customers and stores receive404; admin/own shop/read staff retain normal scope', async () => {
    const f = statusFixture(); for (const actor of [{ id: '6', role: 'CUSTOMER' },{ id: '3', role: 'MERCHANT' }]) await expect(f.service.orderEmail(actor,'20')).rejects.toThrow('Order not found');
    for (const actor of [{ id: '1', role: 'ADMIN' },{ id: '2', role: 'MERCHANT' },{ id: '7', role: 'STAFF' }]) expect((await f.service.orderEmail(actor,'20')).bookingId).toBe('20');
  });
  test('an old queued event is not presented as the email status of the current time or cancellation', async () => {
    const f = statusFixture(); f.tx.booking.findUnique = async () => ({ ...order(), status: 'CANCELLED' });
    expect((await f.service.orderEmail({id:'5',role:'CUSTOMER'},'20')).status).toBe('NOT_REQUESTED');
    f.tx.booking.findUnique = async () => ({ ...order(), startTime: new Date('2030-06-01T11:00Z') });
    expect((await f.service.orderEmail({id:'5',role:'CUSTOMER'},'20')).status).toBe('NOT_REQUESTED');
  });
  test('unknown acceptance is excluded from both advertised and database manual retry paths', async () => {
    const writes: any[] = [], service = new NotificationInboxService({ $transaction: async (work: any) => work({
      $queryRaw: async () => [{ channel: 'EMAIL', bookingId: 20n, dataJson: JSON.stringify(bookingOrderEmailSnapshot(order(), 'BOOKING_CREATED')) }],
      $executeRaw: async (q: any) => { writes.push(q); return 0; },
    }) } as any);
    await expect(service.retry({id:'1',role:'ADMIN'},jobId,'Review acceptance before retry')).rejects.toThrow('refresh');
    expect(sql(writes[0])).toContain("channel='EMAIL'"); expect(sql(writes[0])).toContain('ORDER_EMAIL_RATE_LIMITED'); expect(sql(writes[0])).not.toContain('ORDER_EMAIL_ACCEPTANCE_UNKNOWN');
  });
  test('an incomplete legacy current-state task is failed, while an old different-state task never replaces cancellation status', async () => {
    const f = statusFixture(); f.job.status = 'BLOCKED'; (f.job as any).lastErrorCode = 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE'; f.job.dataJson = JSON.stringify({ version: 1, unavailableReason: 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' });
    expect((await f.service.orderEmail({id:'5',role:'CUSTOMER'},'20')).status).toBe('FAILED');
    f.tx.booking.findUnique = async () => ({ ...order(), status: 'CANCELLED' });
    expect((await f.service.orderEmail({id:'5',role:'CUSTOMER'},'20')).status).toBe('NOT_REQUESTED');
    f.job.topic = 'BOOKING_CANCELLED'; expect((await f.service.orderEmail({id:'5',role:'CUSTOMER'},'20')).status).toBe('FAILED');
  });
});
