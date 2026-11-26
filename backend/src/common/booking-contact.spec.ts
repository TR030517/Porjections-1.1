import { BadRequestException, ConflictException } from '@nestjs/common';
import { bookingContactView, hasBookingContactSnapshot, normalizeBookingContact, requireVerifiedBookingContact } from './booking-contact';

const contact = () => ({ name: ' Zoë 李明 ', phone: '+1 (202) 555-0123', email: ' Contact+Booking@Example.Test ' });
const user = () => ({ role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, email: 'contact+booking@example.test', emailVerifiedAt: new Date('2026-01-01T01:02:03.000Z') });
const normalized = () => ({ name: 'Zoë 李明', phone: '+12025550123', email: 'contact+booking@example.test' });
function invalidResult(value: unknown) {
  try { normalizeBookingContact(value); throw Error('Expected contact rejection'); }
  catch (error) { expect(error).toBeInstanceOf(BadRequestException); return (error as BadRequestException).getResponse() as any; }
}

describe('booking contact command normalization and verified snapshot', () => {
  test('normalizes Unicode name, international phone and email without changing the input', () => {
    const input = contact(); expect(normalizeBookingContact(input)).toEqual(normalized());
    expect(input).toEqual(contact());
  });
  test.each([
    ['+44 (20) 7946-0958', '+442079460958'], ['+81 3-1234-5678', '+81312345678'],
    ['+358 40 1234567', '+358401234567'], ['+1234567', '+1234567'], ['+123456789012345', '+123456789012345'],
  ])('accepts supported international formatting %s', (phone, expected) => {
    expect(normalizeBookingContact({ ...contact(), phone }).phone).toBe(expected);
  });
  test.each(['', '   ', 'a'.repeat(101), 'Name\n', '\tName', 'Name\u0085', 'Name\u0000', 'Name\ud800', null, 42, {}, []])('rejects invalid name %j with a fixed field error', name => {
    expect(invalidResult({ ...contact(), name })).toMatchObject({ code: 'BOOKING_CONTACT_INVALID', fields: { name: expect.any(String) } });
  });
  test('accepts the trimmed maximum-length name without rejecting ordinary whitespace or punctuation', () => {
    expect(normalizeBookingContact({ ...contact(), name: '  ' + 'a'.repeat(100) + '  ' }).name).toHaveLength(100);
    expect(normalizeBookingContact({ ...contact(), name: "Anne-Marie O'Neill" }).name).toBe("Anne-Marie O'Neill");
  });
  test('counts supplementary-plane characters once at the 100-character name limit through snapshot projection', () => {
    const name = '\u{20bb7}'.repeat(100);
    expect(name.length).toBe(200);
    expect(Array.from(name)).toHaveLength(100);
    expect(normalizeBookingContact({ ...contact(), name: '  ' + name + '  ' }).name).toBe(name);
    const snapshot = requireVerifiedBookingContact({ ...contact(), name }, user());
    expect(snapshot.contactName).toBe(name);
    expect(bookingContactView(snapshot)).toMatchObject({ recorded: true, version: 1, name });
  });
  test('rejects 101 supplementary-plane characters with the same fixed name field error', () => {
    expect(invalidResult({ ...contact(), name: '\u{20bb7}'.repeat(101) })).toMatchObject({
      code: 'BOOKING_CONTACT_INVALID', fields: { name: expect.any(String) },
    });
  });
  test.each(['\ud800', '\udfff', '\u{20bb7}\ud800'])('still rejects an unpaired surrogate in a name %j', name => {
    expect(invalidResult({ ...contact(), name })).toMatchObject({
      code: 'BOOKING_CONTACT_INVALID', fields: { name: expect.any(String) },
    });
  });
  test.each(['2025550123', '+01234567', '+123456', '+1234567890123456', '+1-202-ABC-0123', '+1\t2025550123', '+12025550123\n', '++12025550123', '+1.202.555.0123', 12025550123, null, {}])('rejects invalid or non-E164 phone %j', phone => {
    expect(invalidResult({ ...contact(), phone })).toMatchObject({ code: 'BOOKING_CONTACT_INVALID', fields: { phone: expect.any(String) } });
  });
  test.each(['', 'bad', 'a@b', 'a..b@example.test', 'a@example.test\n', 'a@example.test\r\nBcc:private@example.test', '<a@example.test>', 123, null, {}])('rejects invalid email %j', email => {
    expect(invalidResult({ ...contact(), email })).toMatchObject({ code: 'BOOKING_CONTACT_INVALID', fields: { email: expect.any(String) } });
  });
  test.each([null, undefined, [], 'SYNTHETIC_PRIVATE_INPUT', { ...contact(), verified: true }, { ...contact(), userId: '5' }])('rejects malformed shape and client-supplied authority %j', input => {
    const response = invalidResult(input); expect(response.code).toBe('BOOKING_CONTACT_INVALID');
    expect(JSON.stringify(response)).not.toMatch(/SYNTHETIC_PRIVATE_INPUT|Zoë|Contact\+Booking|202.*0123/);
  });
  test('collects all missing field errors, without copying contact data into the exception', () => {
    const response = invalidResult({ name: 'SYNTHETIC_PRIVATE_NAME\n', phone: 'SYNTHETIC_PRIVATE_PHONE', email: 'SYNTHETIC_PRIVATE_EMAIL' });
    expect(Object.keys(response.fields).sort()).toEqual(['email', 'name', 'phone']);
    expect(JSON.stringify(response)).not.toContain('SYNTHETIC_PRIVATE');
  });
  test('creates the exact persisted snapshot from the current verified account without mutating that account', () => {
    const account = user(), before = { ...account }, snapshot = requireVerifiedBookingContact(contact(), account);
    expect(snapshot).toEqual({ contactName: 'Zoë 李明', contactPhone: '+12025550123', contactEmail: 'contact+booking@example.test', contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactEmailVerifiedAt: account.emailVerifiedAt });
    expect(account).toEqual(before); expect(snapshot.contactEmailVerifiedAt).not.toBe(account.emailVerifiedAt);
    expect(requireVerifiedBookingContact(contact(), { ...account, email: 'CONTACT+BOOKING@EXAMPLE.TEST' })).toEqual(snapshot);
  });
  test.each([
    null, { role: 'MERCHANT' }, { status: 'SUSPENDED' }, { deletedAt: new Date() }, { email: 'another@example.test' },
    { email: null }, { email: 'invalid' }, { emailVerifiedAt: null }, { emailVerifiedAt: new Date('invalid') },
    { emailVerifiedAt: '2026-01-01T00:00:00.000Z' }, { emailVerifiedAt: true },
  ])('rejects stale or unauthorized account facts with a stable non-PII conflict %j', patch => {
    try { requireVerifiedBookingContact(contact(), patch === null ? null : { ...user(), ...patch }); throw Error('Expected conflict'); }
    catch (error) { expect(error).toBeInstanceOf(ConflictException); const response = (error as ConflictException).getResponse(); expect(response).toMatchObject({ code: 'BOOKING_CONTACT_EMAIL_CHANGED', fields: { email: expect.any(String) } }); expect(JSON.stringify(response)).not.toMatch(/another@example|Zoë|202555/); }
  });
});

describe('booking contact stored projection', () => {
  const historical = { version: null, recorded: false, label: 'Historical booking has no recorded contact' };
  test.each(['contactName', 'contactPhone', 'contactEmail', 'contactVersion', 'contactSource', 'contactEmailVerifiedAt'])('any surviving stored %s prevents a damaged snapshot from downgrading to account fallback', field => {
    const snapshot = requireVerifiedBookingContact(contact(), user());
    expect(hasBookingContactSnapshot({ [field]: snapshot[field as keyof typeof snapshot] })).toBe(true);
    expect(hasBookingContactSnapshot({ ...snapshot, contactVersion: null })).toBe(true);
  });
  test('only absent or entirely null contact columns qualify for the historical policy', () => {
    for (const booking of [null, undefined, {}, { user: { name: 'Current account' } }, Object.fromEntries(Object.keys(requireVerifiedBookingContact(contact(), user())).map(key => [key, null]))]) expect(hasBookingContactSnapshot(booking)).toBe(false);
    expect(hasBookingContactSnapshot({ contactName: '' })).toBe(true);
    expect(hasBookingContactSnapshot({ contactVersion: 0 })).toBe(true);
  });
  test('projects only stored snapshot, with an explicit version and verification source', () => {
    const snapshot = requireVerifiedBookingContact(contact(), user());
    const booking = { ...snapshot, user: { name: 'Changed account', phone: '+442079460958', email: 'changed@example.test' } };
    expect(bookingContactView(booking)).toEqual({ recorded: true, version: 1, ...normalized(), source: 'ONLINE_VERIFIED', emailVerifiedAt: '2026-01-01T01:02:03.000Z' });
    booking.user.name = 'Changed again'; expect(bookingContactView(booking)).toMatchObject({ name: 'Zoë 李明' });
  });
  test.each([null, undefined, {}, { user: { name: 'SYNTHETIC_PRIVATE_NAME', phone: '+12025550123', email: 'private@example.test' } }])('does not invent historical contact from current user %j', booking => expect(bookingContactView(booking)).toEqual(historical));
  test.each([
    { contactVersion: null }, { contactVersion: 2 }, { contactSource: 'CLIENT_VERIFIED' }, { contactName: null },
    { contactPhone: '2025550123' }, { contactEmail: 'invalid' }, { contactEmailVerifiedAt: null },
    { contactEmailVerifiedAt: new Date('invalid') }, { contactName: '  Trim would change the snapshot  ' }, { contactEmail: 'CONTACT+BOOKING@EXAMPLE.TEST' },
  ])('rejects incomplete, unversioned or noncanonical stored snapshot %j', patch => {
    expect(bookingContactView({ ...requireVerifiedBookingContact(contact(), user()), ...patch })).toEqual(historical);
  });
});
