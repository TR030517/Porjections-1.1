import { bookingOrderEmailSnapshot, readOrderEmailSnapshot, renderBookingOrderEmail } from '../../common/booking-order-email';
import { enqueueBookingOrderEmail } from '../../common/notification-outbox';
import { orderEmailPublicStoreContact, orderEmailRecipientFingerprint, readShopOrderEmailEnvelope } from '../../common/shop-order-email';
import { NotificationWorker, type OutboxRow } from './notification-worker.service';
import { OrderEmailDelivery } from './order-email-delivery';

const sql = (query: any) => query.strings.join('?');
const verifiedAt = new Date('2030-01-01T00:00:00Z');
function order(): any {
  return { id: 20n, userId: 5n, shopId: 10n, bookingNo: 'MJ_CONTACT_SNAPSHOT', status: 'PENDING', deletedAt: null, bookingTimezone: 'America/Los_Angeles',
    startTime: new Date('2030-06-01T16:00:00Z'), endTime: new Date('2030-06-01T17:00:00Z'), totalCents: 8000, currency: 'usd',
    contactName: 'Recorded Guest', contactPhone: '+12065550125', contactEmail: 'recorded@example.test', contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactEmailVerifiedAt: verifiedAt,
    shop: { id: 10n, deletedAt: null, name: 'Snapshot Spa', address: '100 Synthetic Lane', city: 'Seattle', state: 'Washington', zipCode: '98144', timezone: 'America/Los_Angeles',
      phone: '+12065550199', studioProfile: { phones: ['+12065550198'], emails: ['store@example.test'] },
      orderEmailSetting: { enabled: true, recipientEmail: 'store@example.test', recipientVerifiedAt: verifiedAt } },
    items: [{ serviceNameSnapshot: 'Saved service', variantNameSnapshot: 'Saved option', participantIndex: 1, sequence: 1, durationMin: 60, durationKindSnapshot: 'TIMED' }], addOns: [] };
}
const user = (): any => ({ id: 5n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, name: 'Live profile guest', phone: '+12065550222', email: 'recorded@example.test', emailVerifiedAt: verifiedAt });
async function enqueue(booking = order(), account = user()) {
  const writes: any[] = [], tx: any = { booking: { findUnique: jest.fn(async () => booking) }, user: { findUnique: jest.fn(async () => account) },
    $executeRaw: jest.fn(async (query: any) => { writes.push(query); return 1; }), $queryRaw: jest.fn(async () => [{ content_hash: writes.at(-1).values[2] }]) };
  const input = { eventKey: 'booking:20:created', userId: 5n, bookingId: 20n, topic: 'BOOKING_CREATED' as const };
  await enqueueBookingOrderEmail(tx, input);
  const payload = (index: number) => JSON.parse(writes[index].values.find((value: unknown) => typeof value === 'string' && value.startsWith('{')));
  return { tx, writes, input, payload };
}
async function workerFixture(audience: 'CUSTOMER' | 'SHOP' = 'CUSTOMER', legacy = false) {
  const booking = order(), account = user();
  if (legacy) for (const key of ['contactName','contactPhone','contactEmail','contactVersion','contactSource','contactEmailVerifiedAt']) delete booking[key];
  const enqueued = await enqueue(booking, account), raw = enqueued.payload(audience === 'SHOP' ? 1 : 0);
  const row: OutboxRow = { id: audience === 'SHOP' ? '00000000-0000-4000-8000-000000000022' : '00000000-0000-4000-8000-000000000021',
    user_id: 5n, booking_id: 20n, expected_start_at_utc: null, topic: 'BOOKING_CREATED', channel: 'EMAIL', status: 'PROCESSING', attempts: 1, max_attempts: 5,
    resource_type: 'BOOKING', resource_id: '20', lease_token: null, data_json: raw };
  const writes: any[] = [], phases: { beforeDispatch?: () => void } = {}; let insideTx = false;
  const tx: any = { booking: { findUnique: jest.fn(async () => booking) }, user: { findFirst: jest.fn(async () => account) },
    $executeRaw: jest.fn(async (query: any) => { writes.push(query); if (sql(query).includes('attempts=attempts+1')) row.lease_token = query.values[0]; return 1; }),
    $queryRaw: jest.fn(async (query: any) => {
      if (sql(query).includes('SELECT * FROM notification_outbox')) return [row];
      if (sql(query).includes('SELECT id FROM notification_outbox')) { phases.beforeDispatch?.(); return [{ id: row.id }]; }
      return [];
    }) };
  const db = { ...tx, $transaction: async (work: any) => { insideTx = true; try { return await work(tx); } finally { insideTx = false; } } };
  const transport = jest.fn(async (_message: any, _key: string) => { expect(insideTx).toBe(false); return { status: 200, acceptedId: 'synthetic-captured-mail' }; });
  const push = { config: jest.fn(), sendToUser: jest.fn() }, worker = new NotificationWorker(db as any, push as any, new OrderEmailDelivery(transport));
  const process = () => (worker as any).process({ id: row.id, booking_id: 20n });
  return { booking, account, row, transport, push, tx, writes, phases, process };
}
const envKeys = ['ORDER_EMAIL_ENABLED','ORDER_EMAIL_PROVIDER','ORDER_EMAIL_API_KEY','ORDER_EMAIL_FROM'];
let env: Record<string, string | undefined>;
beforeEach(() => { env = Object.fromEntries(envKeys.map(key => [key, process.env[key]])); Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'true', ORDER_EMAIL_PROVIDER: 'resend', ORDER_EMAIL_API_KEY: 'synthetic-no-network', ORDER_EMAIL_FROM: 'orders@example.test' }); });
afterEach(() => { for (const key of envKeys) if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; });

describe('contact snapshot references in the existing two transactional email tasks', () => {
  test('both existing tasks carry only a paired version/fingerprint, dedupe remains stable, and no contact PII enters the outbox', async () => {
    const f = await enqueue(); await enqueueBookingOrderEmail(f.tx, f.input);
    expect(f.writes).toHaveLength(4);
    expect(f.writes.map(row => row.values[1])).toEqual(['booking:20:created','booking:20:created:shop','booking:20:created','booking:20:created:shop']);
    expect(f.writes[0].values[2]).toBe(f.writes[2].values[2]); expect(f.writes[1].values[2]).toBe(f.writes[3].values[2]);
    const customer = f.payload(0), store = readShopOrderEmailEnvelope(f.payload(1));
    for (const snapshot of [customer, store?.snapshot]) expect(snapshot).toMatchObject({ contactVersion: 1, customerRecipientFingerprint: orderEmailRecipientFingerprint('recorded@example.test') });
    for (const query of f.writes) { expect(query.values).toContain('PENDING'); expect(sql(query)).toContain('ON DUPLICATE KEY UPDATE event_key=event_key'); }
    const serialized = JSON.stringify([customer, f.payload(1)]);
    for (const secret of ['Recorded Guest','+12065550125','recorded@example.test','store@example.test']) expect(serialized).not.toContain(secret);
  });
  test('strict parsing accepts legacy or the exact optional pair; partial/unknown references and raw contact data are rejected', () => {
    const old = bookingOrderEmailSnapshot(order(), 'BOOKING_CREATED')!;
    expect(old).not.toHaveProperty('contactVersion');
    const referenced = { ...old, contactVersion: 1, customerRecipientFingerprint: orderEmailRecipientFingerprint('recorded@example.test') };
    expect(readOrderEmailSnapshot(referenced)).toEqual(referenced);
    for (const value of [{ ...old, contactVersion: 1 }, { ...old, customerRecipientFingerprint: referenced.customerRecipientFingerprint },
      { ...referenced, contactVersion: 2 }, { ...referenced, customerRecipientFingerprint: 'invalid' }, { ...referenced, contactEmail: 'injected@example.test' }]) expect(readOrderEmailSnapshot(value)).toBeNull();
  });
  test('changed current email blocks only the customer task rather than redirecting the saved contact', async () => {
    const f = await enqueue(order(), { ...user(), email: 'later@example.test' });
    expect(f.writes[0].values).toEqual(expect.arrayContaining(['BLOCKED','ORDER_EMAIL_RECIPIENT_CHANGED'])); expect(f.writes[1].values).toContain('PENDING');
  });
  test.each([{ contactVersion: 2 }, { contactVersion: null }, { contactVersion: undefined }, { contactSource: null }, { contactPhone: null }, { contactEmailVerifiedAt: null }])('corrupt new contact never downgrades to legacy %j', async patch => {
    const f = await enqueue({ ...order(), ...patch });
    for (const query of f.writes) expect(query.values).toEqual(expect.arrayContaining(['BLOCKED','ORDER_EMAIL_CONTACT_SNAPSHOT_UNAVAILABLE']));
  });
  test('a historical booking creates historical tasks without manufactured contact version fields', async () => {
    const booking = order(); for (const key of ['contactName','contactPhone','contactEmail','contactVersion','contactSource','contactEmailVerifiedAt']) booking[key] = null;
    const f = await enqueue(booking);
    expect(f.payload(0)).not.toHaveProperty('contactVersion'); expect(f.payload(1).snapshot).not.toHaveProperty('contactVersion');
  });
});

describe('worker resolves fixed recorded contact and never redirects a modern task', () => {
  test('customer receives the saved address with public store contact and pending-not-confirmed wording', async () => {
    const f = await workerFixture(); f.account.name = 'Changed live name'; f.account.phone = '+12065550333'; f.account.email = 'RECORDED@example.test';
    await f.process(); expect(f.transport).toHaveBeenCalledTimes(1);
    const message = f.transport.mock.calls[0][0];
    expect(message.recipient).toBe('recorded@example.test'); expect(message.text).toContain('Store phone: +12065550198'); expect(message.text).toContain('Store email: store@example.test');
    expect(message.text).toContain('awaiting store confirmation'); expect(message.text).toContain('not confirmed yet'); expect(message.subject).not.toContain('Appointment confirmed');
    expect(f.writes.at(-1).values).toContain('ACCEPTED'); expect(f.push.sendToUser).not.toHaveBeenCalled();
  });
  test('shop message uses recorded name/phone/email even after the live account changes; it does not query user contact', async () => {
    const f = await workerFixture('SHOP'); Object.assign(f.account, { name: 'Later Guest', phone: '+12065550999', email: 'later@example.test', emailVerifiedAt: null, status: 'SUSPENDED' });
    await f.process(); expect(f.transport).toHaveBeenCalledTimes(1); expect(f.tx.user.findFirst).not.toHaveBeenCalled();
    const message = f.transport.mock.calls[0][0]; expect(message.recipient).toBe('store@example.test');
    for (const value of ['Contact source: Recorded booking contact.','Name: Recorded Guest','Phone: +12065550125','Email: recorded@example.test','not a confirmed appointment']) expect(message.text).toContain(value);
    expect(message.text).not.toMatch(/Later Guest|later@example|12065550999/);
  });
  test('shop mail preserves a recorded name containing the maximum 100 supplementary Unicode characters', async () => {
    const f = await workerFixture('SHOP'), name = '\u{20000}'.repeat(100);
    f.booking.contactName = name;
    await f.process();
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.transport.mock.calls[0][0].text).toContain('Name: ' + name);
    expect(f.transport.mock.calls[0][0].text).not.toContain('Name: Not provided');
  });
  test.each([{ email: 'later@example.test' }, { emailVerifiedAt: null }, { status: 'SUSPENDED' }, { deletedAt: new Date() }, { role: 'MERCHANT' }])('current account eligibility changes block modern customer mail %j', async patch => {
    const f = await workerFixture(); Object.assign(f.account, patch); await f.process(); expect(f.transport).not.toHaveBeenCalled(); expect(f.writes.at(-1).values).toContain('BLOCKED');
  });
  test('a current email change after claim is rechecked immediately before transport', async () => {
    const f = await workerFixture(); f.phases.beforeDispatch = () => { f.account.email = 'after-claim@example.test'; };
    await f.process(); expect(f.transport).not.toHaveBeenCalled(); expect(f.writes.at(-1).values).toContain('ORDER_EMAIL_RECIPIENT_CHANGED');
  });
  test.each(['CUSTOMER','SHOP'] as const)('missing or changed booking contact blocks %s without account fallback', async audience => {
    for (const patch of [{ contactVersion: 2 }, { contactVersion: null }, { contactEmail: 'other@example.test' }, { contactEmailVerifiedAt: null }]) {
      const f = await workerFixture(audience); Object.assign(f.booking, patch); await f.process(); expect(f.transport).not.toHaveBeenCalled(); expect(f.writes.at(-1).values).toContain('BLOCKED');
    }
  });
  test.each(['CUSTOMER','SHOP'] as const)('a %s task missing its contact reference cannot invoke legacy policy for a modern or partially damaged booking', async audience => {
    for (const missingVersion of [false, true]) {
      const f = await workerFixture(audience), payload: any = f.row.data_json;
      const snapshot = audience === 'SHOP' ? payload.snapshot : payload;
      delete snapshot.contactVersion; delete snapshot.customerRecipientFingerprint;
      if (missingVersion) f.booking.contactVersion = null;
      await f.process();
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.writes.at(-1).values).toEqual(expect.arrayContaining(['BLOCKED', 'ORDER_EMAIL_CONTACT_REFERENCE_REQUIRED']));
      if (audience === 'SHOP') expect(f.tx.user.findFirst).not.toHaveBeenCalled();
    }
  });
  test('shop destination fingerprint remains protected', async () => {
    const f = await workerFixture('SHOP'); f.booking.shop.orderEmailSetting.recipientEmail = 'new-store@example.test';
    await f.process(); expect(f.transport).not.toHaveBeenCalled(); expect(f.writes.at(-1).values).toContain('ORDER_EMAIL_STORE_RECIPIENT_CHANGED');
  });
  test('new events without private recipient proof keep the order/customer mail and block only store mail', async () => {
    const booking = order(); booking.shop.orderEmailSetting = null;
    const f = await enqueue(booking);
    expect(f.writes[0].values).toContain('PENDING');
    expect(f.writes[1].values).toEqual(expect.arrayContaining(['BLOCKED', 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE']));
    expect(f.payload(1)).toMatchObject({ version: 2, recipientFingerprint: null });
  });
  test('a public contact edit does not redirect or interrupt a verified private destination', async () => {
    const f = await workerFixture('SHOP'); f.booking.shop.studioProfile.emails = ['public-only@example.test'];
    await f.process(); expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.transport.mock.calls[0][0].recipient).toBe('store@example.test');
  });
  test('unverified replacement remains pending while the existing target continues to receive its task', async () => {
    const f = await workerFixture('SHOP'); Object.assign(f.booking.shop.orderEmailSetting, { pendingEmail: 'pending@example.test', deliveryState: 'UNKNOWN' });
    await f.process(); expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.transport.mock.calls[0][0].recipient).toBe('store@example.test');
  });
  test.each([{ enabled: false }, { recipientVerifiedAt: null }, { recipientEmail: 'changed@example.test' }])('private recipient eligibility is rechecked after claim %j', async patch => {
    const f = await workerFixture('SHOP'); f.phases.beforeDispatch = () => Object.assign(f.booking.shop.orderEmailSetting, patch);
    await f.process(); expect(f.transport).not.toHaveBeenCalled(); expect(f.writes.at(-1).values).toContain('BLOCKED');
  });
  test('a stored v1 legacy task is read with its original fingerprint and never rewritten into v2', async () => {
    const f = await workerFixture('SHOP'); const raw: any = f.row.data_json; raw.version = 1;
    f.booking.shop.orderEmailSetting = null; const original = JSON.stringify(raw);
    await f.process(); expect(f.transport).toHaveBeenCalledTimes(1); expect(JSON.stringify(f.row.data_json)).toBe(original);
    const g = await workerFixture('SHOP'); const empty: any = g.row.data_json; empty.version = 1; empty.recipientFingerprint = null;
    await g.process(); expect(g.transport).not.toHaveBeenCalled(); expect(g.writes.at(-1).values).toContain('ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE');
  });
  test('legacy shop tasks keep account-contact behavior and explicitly disclose that no booking contact was recorded', async () => {
    const f = await workerFixture('SHOP', true); f.account.name = 'Legacy live name';
    await f.process(); expect(f.transport).toHaveBeenCalledTimes(1); expect(f.tx.user.findFirst).toHaveBeenCalled();
    const text = f.transport.mock.calls[0][0].text;
    expect(text).toContain('Name: Legacy live name'); expect(text).toContain('Current customer account for a historical booking; no booking contact was recorded.'); expect(text).not.toContain('Contact source: Recorded booking contact.');
  });
  test('legacy customer tasks retain their verified-current-account recipient policy', async () => {
    const f = await workerFixture('CUSTOMER', true); f.account.email = 'legacy-current@example.test';
    await f.process(); expect(f.transport.mock.calls[0][0].recipient).toBe('legacy-current@example.test');
  });
});

describe('public store contact rendering', () => {
  test('the public legacy phone fallback is available only when phones are absent, never after explicit clearing', () => {
    expect(orderEmailPublicStoreContact({ phone: '+12065550199', studioProfile: { emails: ['bad', 'shop@example.test'] } })).toEqual({ phone: '+12065550199', email: 'shop@example.test' });
    expect(orderEmailPublicStoreContact({ phone: '+12065550199', studioProfile: { phones: [], emails: [] } })).toEqual({ phone: null, email: null });
    const missing = renderBookingOrderEmail(bookingOrderEmailSnapshot(order(), 'BOOKING_CREATED')!, {});
    expect(missing.text).toContain('Store phone: Not provided; use the store page for contact details.'); expect(missing.text).toContain('Store email: Not provided; use the store page for contact details.');
  });
  test('unsafe public contacts do not become message headers or body lines', () => {
    const rendered = renderBookingOrderEmail(bookingOrderEmailSnapshot(order(), 'BOOKING_CREATED')!, { phone: 'phone\nInjected: line', email: 'shop@example.test\nBcc: third@example.test' });
    expect(rendered.text).not.toMatch(/Injected:|Bcc:/); expect(rendered.subject).not.toContain('\n');
  });
  test('confirmed mail uses confirmed wording and never carries a pending warning', () => {
    const booking = { ...order(), status: 'CONFIRMED' }, rendered = renderBookingOrderEmail(bookingOrderEmailSnapshot(booking, 'BOOKING_CONFIRMED')!);
    expect(rendered.subject).toContain('Appointment confirmed'); expect(rendered.text).not.toMatch(/awaiting store confirmation|not confirmed yet/);
  });
});
