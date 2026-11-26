import { bookingOrderEmailSnapshot, customerOrderEmail, orderEmailEventCurrent, readOrderEmailSnapshot, renderBookingOrderEmail, requireCustomerOrderEmail } from './booking-order-email';
import { enqueueBookingOrderEmail } from './notification-outbox';
const booking = () => ({ id: 20n, userId: 5n, shopId: 10n, bookingNo: 'MJ_SYNTHETIC_ORDER', status: 'PENDING', deletedAt: null,
  bookingTimezone: 'America/New_York', startTime: new Date('2030-06-01T14:00:00Z'), endTime: new Date('2030-06-01T15:00:00Z'), totalCents: 8013, currency: 'usd',
  notes: 'PRIVATE_NOTES_NEVER_EMAIL', paymentId: 'PRIVATE_PAYMENT_KEY', shop: { name: 'Synthetic Store', nameEn: 'Synthetic Wellness', address: '146 Synthetic Lane', city: 'Test Harbor', state: 'NY', zipCode: '10002', timezone: 'UTC' },
  items: [{ participantIndex: 1, sequence: 1, serviceNameSnapshot: 'Saved massage', variantNameSnapshot: 'Saved sixty minute option', durationMin: 60, durationKindSnapshot: 'TIMED' }],
  addOns: [{ participantIndex: 1, sequence: 1, nameSnapshot: 'Saved oil', unitPriceCentsSnapshot: 1013, quantity: 1, lineTotalCentsSnapshot: 1013 }],
});
const user = () => ({ id: 5n, role: 'CUSTOMER', status: 'ACTIVE', email: 'guest+order@example.test', emailVerifiedAt: new Date('2030-01-01T00:00:00Z'), deletedAt: null });
const sql = (q: any) => q.strings.join('?');
describe('customer-account email and immutable minimal English order projection', () => {
  test('recipient is only a verified email on an active customer account', async () => {
    const tx = { user: { findUnique: jest.fn(async () => user()) } };
    expect(await requireCustomerOrderEmail(tx, 5n)).toEqual({ userId: '5', email: 'guest+order@example.test' });
    expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5n } }));
    for (const patch of [{ email: null }, { email: 'to@example.test\r\nBcc: third@example.test' }, { role: 'MERCHANT' }, { status: 'SUSPENDED' }, { deletedAt: new Date() }, { id: 6n }]) {
      try { await requireCustomerOrderEmail({ user: { findUnique: async () => ({ ...user(), ...patch }) } }, '5'); throw Error('Expected rejection'); }
      catch (error) { expect((error as any).getResponse()).toMatchObject({ code: 'ORDER_EMAIL_REQUIRED', fields: { email: expect.any(String) } }); }
    }
    await expect(requireCustomerOrderEmail({ user: { findUnique: async () => ({ ...user(), emailVerifiedAt: null }) } }, '5'))
      .rejects.toMatchObject({ response: { code: 'ORDER_EMAIL_VERIFICATION_REQUIRED', fields: { email: expect.any(String) } } });
  });
  test.each(['bad', 'a@b', 'a..b@example.test', '.a@example.test', 'a@example.test?subject=bad', 'a@example.test\n', 'a,b@example.test'])('rejects unsafe or incomplete account email %s', value => expect(customerOrderEmail(value)).toBeNull());
  test('uses shop-local date/time, original main/variant and add-on names, quantity and whole-order total', () => {
    const snapshot = bookingOrderEmailSnapshot(booking(), 'BOOKING_CREATED')!;
    const rendered = renderBookingOrderEmail(snapshot);
    expect(rendered.subject).toContain('Order received'); expect(rendered.text).toContain('10:00 AM');
    for (const value of ['MJ_SYNTHETIC_ORDER','Synthetic Wellness','146 Synthetic Lane','America/New_York','Saved massage','Saved sixty minute option','Saved oil','\u00d7 1 = $10.13','Whole-order total: $80.13','offline','not a payment receipt']) expect(rendered.text).toContain(value);
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_NOTES|PRIVATE_PAYMENT|emailVerified|password|token/);
    expect(readOrderEmailSnapshot({ ...snapshot, recipient: 'attacker@example.test' })).toBeNull();
    expect(readOrderEmailSnapshot({ ...snapshot, addOns: [{ ...snapshot.addOns[0], lineTotalCents: 2 }] })).toBeNull();
  });
  test('missing public address has a truthful fallback; non-fixed service minutes are only reserved blocks', () => {
    const original = booking(); original.shop = { ...original.shop, address: '', city: '', state: '', zipCode: '' };
    for (const durationKindSnapshot of ['VARIABLE','PER_SESSION']) {
      original.items[0].durationKindSnapshot = durationKindSnapshot;
      const snapshot = bookingOrderEmailSnapshot(original, 'BOOKING_CREATED')!;
      expect(snapshot).not.toBeNull(); const email = renderBookingOrderEmail(snapshot);
      expect(email.text).toContain('Contact the store for its address'); expect(email.text).toContain('reserved block 60 min');
      expect(email.text).toContain(durationKindSnapshot === 'VARIABLE' ? 'Duration varies' : 'Per session');
    }
  });
  test('new email snapshots do not repeat a migrated full address; saved snapshots remain unchanged', () => {
    const row = booking();
    row.shop = { ...row.shop, address: '1207 S Jackson St#109B, Seattle, WA98144', city: 'Seattle', state: 'Washington', zipCode: '98144' };
    const snapshot = bookingOrderEmailSnapshot(row, 'BOOKING_CREATED')!;
    expect(snapshot.address).toBe('1207 S Jackson St#109B, Seattle, WA98144');
    row.shop.address = 'Changed street'; row.shop.city = 'Changed city';
    expect(renderBookingOrderEmail(snapshot).text).toContain('Address: 1207 S Jackson St#109B, Seattle, WA98144\n');
  });
  test('cancel/reschedule events cannot be presented as an old confirmation; catalog edits do not rewrite snapshot text', () => {
    const row = booking(); row.status = 'CONFIRMED'; const snapshot = bookingOrderEmailSnapshot(row, 'BOOKING_CONFIRMED')!;
    expect(orderEmailEventCurrent(snapshot, row)).toBe(true);
    expect(orderEmailEventCurrent(snapshot, { ...row, status: 'CANCELLED' })).toBe(false);
    expect(orderEmailEventCurrent(snapshot, { ...row, startTime: new Date('2030-06-01T15:00Z') })).toBe(false);
    expect(orderEmailEventCurrent(snapshot, { ...row, userId: 6n })).toBe(false);
    row.items[0].serviceNameSnapshot = 'Changed current catalog'; expect(renderBookingOrderEmail(snapshot).text).toContain('Saved massage');
    expect(readOrderEmailSnapshot({ ...snapshot, status: 'CANCELLED' })).toBeNull();
  });
});
describe('EMAIL enqueue stays in the caller transaction and has a stable event key', () => {
  test('customer and store EMAIL tasks stay separate; same event replay has stable safe content', async () => {
    const calls: any[] = [], tx: any = { booking: { findUnique: async () => booking() }, user: { findUnique: async () => user() }, $executeRaw: async (q: any) => { calls.push(q); return 1; }, $queryRaw: async () => [{ content_hash: calls.at(-1).values[2] }] };
    const input = { eventKey: 'booking:20:created', userId: 5n, bookingId: 20n, topic: 'BOOKING_CREATED' as const };
    await enqueueBookingOrderEmail(tx, input); await enqueueBookingOrderEmail(tx, input);
    expect(calls).toHaveLength(4);
    expect(calls.map(row => row.values[1])).toEqual([input.eventKey, input.eventKey + ':shop', input.eventKey, input.eventKey + ':shop']);
    expect(calls[0].values[2]).toBe(calls[2].values[2]); expect(calls[1].values[2]).toBe(calls[3].values[2]);
    expect(calls[0].values[2]).not.toBe(calls[1].values[2]);
    for (const call of calls) { expect(sql(call)).toContain("'EMAIL'"); expect(sql(call)).toContain('ON DUPLICATE KEY UPDATE'); }
    expect(calls[0].values).toContain('PENDING'); expect(calls[1].values).toContain('BLOCKED');
    expect(calls[1].values).toContain('ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE');
    expect(JSON.stringify(calls.map(row => row.values), (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('guest+order@example.test');
  });
  test('old missing account email produces a visible blocked task without losing a cancellation', async () => {
    const row = booking(); row.status = 'CANCELLED'; const calls: any[] = [], tx: any = { booking: { findUnique: async () => row }, user: { findUnique: async () => ({ ...user(), email: null }) }, $executeRaw: async (q: any) => { calls.push(q); return 1; }, $queryRaw: async () => [{ content_hash: calls.at(-1).values[2] }] };
    await enqueueBookingOrderEmail(tx, { eventKey: 'booking:20:cancelled', userId: 5n, bookingId: 20n, topic: 'BOOKING_CANCELLED' });
    expect(calls[0].values).toContain('BLOCKED'); expect(calls[0].values).toContain('ORDER_EMAIL_RECIPIENT_UNAVAILABLE');
  });
  test('unverified recipient is blocked even when its email syntax is valid', async () => {
    const calls: any[] = [], tx: any = { booking: { findUnique: async () => booking() }, user: { findUnique: async () => ({ ...user(), emailVerifiedAt: null }) }, $executeRaw: async (q: any) => { calls.push(q); return 1; }, $queryRaw: async () => [{ content_hash: calls.at(-1).values[2] }] };
    await enqueueBookingOrderEmail(tx, { eventKey: 'booking:20:created', userId: 5n, bookingId: 20n, topic: 'BOOKING_CREATED' });
    expect(calls[0].values).toContain('BLOCKED'); expect(calls[0].values).toContain('ORDER_EMAIL_RECIPIENT_UNAVAILABLE');
  });
  test('non-order topics never add EMAIL; recipient mismatch and reused event conflicts remain errors', async () => {
    const tx: any = { booking: { findUnique: jest.fn(async () => ({ ...booking(), userId: 6n })) } };
    await enqueueBookingOrderEmail(tx, { eventKey: 'booking:20:reminder', userId: 5n, bookingId: 20n, topic: 'BOOKING_REMINDER' }); expect(tx.booking.findUnique).not.toHaveBeenCalled();
    await expect(enqueueBookingOrderEmail(tx, { eventKey: 'booking:20:created', userId: 5n, bookingId: 20n, topic: 'BOOKING_CREATED' })).rejects.toThrow('RECIPIENT_MISMATCH');
    const conflict: any = { booking: { findUnique: async () => booking() }, user: { findUnique: async () => user() }, $executeRaw: async () => 1, $queryRaw: async () => [{ content_hash: 'different' }] };
    await expect(enqueueBookingOrderEmail(conflict, { eventKey: 'booking:20:created', userId: 5n, bookingId: 20n, topic: 'BOOKING_CREATED' })).rejects.toThrow('EVENT_KEY_CONFLICT');
  });
});
