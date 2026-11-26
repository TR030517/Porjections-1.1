import { bookingContactView, guestBookingContactFingerprint, guestBookingContactSnapshot, normalizeBookingContact, normalizeGuestBookingContact } from './booking-contact';
import { bookingOrderEmailSnapshot, orderEmailEventCurrent, readOrderEmailSnapshot } from './booking-order-email';
import { enqueueBookingOrderEmail, enqueueNotification, syncBookingReminder } from './notification-outbox';
import { renderShopOrderEmail } from './shop-order-email';
import { NotificationWorker, OutboxRow } from '../modules/notifications/notification-worker.service';

function booking(email: string | null = null): any {
  return { id: 22n, userId: null, bookingSource: 'ASSISTED_GUEST', guestSource: 'PHONE', shopId: 10n, bookingNo: 'MJ_SYNTHETIC_GUEST',
    status: 'PENDING', deletedAt: null, ...guestBookingContactSnapshot({ name: ' 李 Zoë ', phone: '+1 (202) 555-0123', email }),
    startTime: new Date('2030-06-01T14:00:00Z'), endTime: new Date('2030-06-01T15:00:00Z'), bookingTimezone: 'America/New_York', totalCents: 6000, currency: 'usd',
    shop: { id: 10n, name: 'Synthetic Guest Spa', address: '100 Synthetic Lane', timezone: 'America/New_York', deletedAt: null,
      orderEmailSetting: { enabled: true, recipientEmail: 'store@example.test', recipientVerifiedAt: new Date('2030-01-01T00:00Z') } },
    items: [{ serviceNameSnapshot: 'Saved service', variantNameSnapshot: null, participantIndex: 1, sequence: 1, durationMin: 60 }], addOns: [] };
}
async function enqueue(row = booking()) {
  const writes: any[] = [];
  const tx: any = { booking: { findUnique: jest.fn(async () => row) }, user: { findUnique: jest.fn(), findFirst: jest.fn() },
    $executeRaw: jest.fn(async (q: any) => { writes.push(q); return 1; }), $queryRaw: jest.fn(async () => [{ content_hash: writes.at(-1).values[2] }]) };
  const command = { eventKey: 'booking:22:created', userId: null, bookingId: 22n, topic: 'BOOKING_CREATED' as const };
  await enqueueBookingOrderEmail(tx, command);
  const payload = JSON.parse(writes[0].values.find((v: unknown) => typeof v === 'string' && v.startsWith('{')));
  return { tx, writes, payload, command, row };
}
describe('accountless guest contact and store-only order notifications', () => {
  test.each([undefined, null, ''])('normalizes an optional empty email %j without weakening online contact', email => {
    const raw = { name: '李 Zoë', phone: '+1 (202) 555-0123', email };
    expect(normalizeGuestBookingContact(raw)).toEqual({ name: '李 Zoë', phone: '+12025550123', email: null });
    expect(() => normalizeBookingContact(raw)).toThrow();
  });
  test.each([{ name: '' }, { name: '\u{20000}'.repeat(101) }, { phone: '2025550123' }, { email: 'bad' }, { email: 'a@example.test\n' }, { verified: true }, { userId: '5' }])('rejects malformed guest contact or client authority %j', patch => {
    expect(() => normalizeGuestBookingContact({ name: 'Guest', phone: '+12025550123', ...patch })).toThrow();
  });
  test('records a Unicode snapshot with optional unverified email, never a verified identity', () => {
    const raw = { name: '\u{20000}'.repeat(100), phone: '+12025550123', email: 'Guest@Example.Test' };
    const snapshot = guestBookingContactSnapshot(raw);
    expect(bookingContactView(snapshot)).toMatchObject({ recorded: true, name: raw.name, email: 'guest@example.test', source: 'GUEST_ASSISTED', emailVerifiedAt: null });
    expect(bookingContactView({ ...snapshot, contactEmailVerifiedAt: new Date() }).recorded).toBe(false);
    expect(snapshot).not.toHaveProperty('userId');
  });
  test.each([null, 'unverified@example.test'])('creates exactly the independent store task with no customer query or destination for %j', async email => {
    const f = await enqueue(booking(email)); await enqueueBookingOrderEmail(f.tx, f.command);
    expect(f.writes).toHaveLength(2);
    expect(f.writes.map(q => q.values[1])).toEqual(['booking:22:created:shop', 'booking:22:created:shop']);
    expect(f.writes[0].values[2]).toBe(f.writes[1].values[2]); expect(f.writes[0].values[3]).toBeNull();
    expect(f.tx.user.findUnique).not.toHaveBeenCalled();
    expect(f.payload.snapshot).toMatchObject({ version: 2, userId: null, contactVersion: 1, guestContactFingerprint: expect.any(String) });
    expect(JSON.stringify(f.payload)).not.toMatch(/李|Zoë|12025550123|unverified@example/);
    expect(f.writes[0].values).toContain('PENDING');
  });
  test('a missing store recipient remains a store BLOCKED task; customer absence is not a failed task', async () => {
    const row = booking(); row.shop.orderEmailSetting = null;
    const f = await enqueue(row); expect(f.writes).toHaveLength(1);
    expect(f.writes[0].values).toContain('BLOCKED'); expect(f.writes[0].values).toContain('ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE');
  });
  test.each([['BOOKING_CREATED', 'PENDING'], ['BOOKING_CONFIRMED', 'CONFIRMED'], ['BOOKING_CANCELLED', 'CANCELLED']] as const)('an unusable mail snapshot never blocks the %s business transaction', async (topic, status) => {
    const row = booking(); row.status = status; row.items[0].serviceNameSnapshot = '<unusable mail text>';
    const writes: any[] = [], tx: any = { booking: { findUnique: async () => row }, user: { findUnique: jest.fn() },
      $executeRaw: async (q: any) => { writes.push(q); return 1; }, $queryRaw: async () => [{ content_hash: writes.at(-1).values[2] }] };
    await expect(enqueueBookingOrderEmail(tx, { eventKey: 'booking:22:' + topic, userId: null, bookingId: 22n, topic })).resolves.toBeUndefined();
    expect(writes).toHaveLength(1); expect(writes[0].values).toContain('BLOCKED'); expect(tx.user.findUnique).not.toHaveBeenCalled();
    const payload = JSON.parse(writes[0].values.find((v: unknown) => typeof v === 'string' && v.startsWith('{')));
    expect(payload.audience).toBe('SHOP'); expect(payload.snapshot).toBeNull();
  });
  test('nullable ownership alone cannot opt legacy or account bookings into the guest contract', async () => {
    const row = booking(); row.bookingSource = 'ONLINE';
    await expect(enqueue(row)).rejects.toThrow('ORDER_EMAIL_GUEST_SNAPSHOT_UNAVAILABLE');
    const snapshot = bookingOrderEmailSnapshot(booking(), 'BOOKING_CREATED')!;
    expect(readOrderEmailSnapshot({ ...snapshot, version: 1 })).toBeNull();
    expect(readOrderEmailSnapshot({ ...snapshot, userId: '5' })).toBeNull();
    expect(orderEmailEventCurrent(snapshot, { ...booking(), userId: 5n })).toBe(false);
  });
  test('the store worker resolves only the verified store destination and the immutable guest snapshot', async () => {
    const f = await enqueue(booking('unverified@example.test'));
    const worker: any = new NotificationWorker({} as any, {} as any, { config: () => ({ enabled: true }) } as any);
    const row: OutboxRow = { id: '00000000-0000-4000-8000-000000000022', user_id: null, booking_id: 22n, expected_start_at_utc: null,
      topic: 'BOOKING_CREATED', channel: 'EMAIL', status: 'PROCESSING', attempts: 1, max_attempts: 5, resource_type: 'BOOKING', resource_id: '22', lease_token: null, data_json: f.payload };
    const context = await worker.emailContext(f.tx, row);
    expect(context).toMatchObject({ audience: 'SHOP', recipient: 'store@example.test', customer: { name: '李 Zoë', phone: '+12025550123', emailVerifiedAt: null } });
    expect(f.tx.user.findFirst).not.toHaveBeenCalled();
    const rendered = renderShopOrderEmail(context.snapshot, context.customer);
    expect(rendered.text).toContain('awaiting store confirmation'); expect(rendered.text).toContain('No verified recipient'); expect(rendered.text).not.toContain('unverified@example.test');
    f.row.contactName = 'Changed'; expect(guestBookingContactFingerprint(f.row)).not.toBe(f.payload.snapshot.guestContactFingerprint);
    expect(await worker.emailContext(f.tx, row)).toEqual({ code: 'ORDER_EMAIL_CONTACT_CHANGED' });
    row.data_json = f.payload.snapshot;
    expect(await worker.emailContext(f.tx, row)).toEqual({ code: 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' });
  });
  test('guest confirmation cannot enqueue inbox, push, SMS or an account reminder', async () => {
    const tx: any = { $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn() };
    await enqueueNotification(tx, { eventKey: 'booking:22:confirmed', userId: null, bookingId: 22n, topic: 'BOOKING_CONFIRMED', resourceType: 'BOOKING', resourceId: '22' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    await syncBookingReminder(tx, { ...booking(), status: 'CONFIRMED' }, new Date('2030-01-01'));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1); expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
