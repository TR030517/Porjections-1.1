import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingContactDetails } from './bookingContact';

test('recorded booking contact remains independent of changed account reception data', () => {
  const booking = { contact: { recorded: true, version: 1, source: 'ONLINE_VERIFIED', name: '李 María', phone: '+442079460100', email: 'guest@example.test' },
    reception: { customer: { name: 'Changed account', phone: '+12025550101' } } };
  const before = structuredClone(booking), result = bookingContactDetails(booking);
  assert.equal(result.recorded, true);
  assert.equal(result.name, '李 María'); assert.equal(result.phoneHref, 'tel:+442079460100');
  assert.equal(result.email, 'guest@example.test'); assert.match(result.label, /下单时记录/);
  assert.deepEqual(booking, before);
});

test('legacy account fallback is visibly current and never invents a historical email', () => {
  const result = bookingContactDetails({ contact: { recorded: false, version: null }, reception: { customer: { name: 'Current account', phone: '+12025550101' } } });
  assert.equal(result.recorded, false); assert.equal(result.name, 'Current account');
  assert.equal(result.email, null); assert.match(result.label, /当前账号资料/);
});

test('recorded contact uses the same 100 Unicode character boundary as online creation', () => {
  const contact = { recorded: true, version: 1, source: 'ONLINE_VERIFIED', name: '\u{20000}'.repeat(100), phone: '+12025550101', email: 'guest@example.test' };
  const result = bookingContactDetails({ contact });
  assert.equal(result.recorded, true); assert.equal(result.name, contact.name);
  assert.equal(bookingContactDetails({ contact: { ...contact, name: '\u{20000}'.repeat(101) } }).recorded, false);
  assert.equal(bookingContactDetails({ contact: { ...contact, name: 'Guest\ud800' } }).recorded, false);
});

test('unknown or corrupt snapshot versions cannot manufacture a dial link or verified contact', () => {
  for (const patch of [{ version: 2 }, { recorded: false }, { source: 'INPUT_EMAIL' }, { name: '\u0000bad' }, { phone: 'javascript:alert(1)' }, { email: 'bad@example.test\nBcc:other@example.test' }]) {
    const result = bookingContactDetails({ contact: { recorded: true, version: 1, source: 'ONLINE_VERIFIED', name: 'Guest', phone: '+12025550101', email: 'guest@example.test', ...patch } });
    assert.equal(result.recorded, false); assert.equal(result.phoneHref, null); assert.equal(result.email, null);
  }
});

test('a damaged recorded response cannot downgrade to current account reception data', () => {
  const reception = { customer: { name: 'Current account', phone: '+12025550101' } };
  for (const contact of [
    { recorded: true, version: 2, name: 'Unrecognized snapshot' },
    { recorded: false, version: null, email: 'leftover@example.test' },
    { recorded: true, version: 1, source: 'ONLINE_VERIFIED', name: 'Incomplete snapshot' },
  ]) {
    const result = bookingContactDetails({ contact, reception });
    assert.equal(result.name, null); assert.equal(result.phoneHref, null); assert.equal(result.email, null);
    assert.match(result.label, /无法核验/);
  }
});

test('guest snapshots show contact without suggesting account ownership or verified email', () => {
  for (const email of [null, 'unverified@example.test']) {
    const contact = { recorded: true, version: 1, source: 'GUEST_ASSISTED', emailVerifiedAt: null, name: 'First visitor', phone: '+12025550101', email };
    const result = bookingContactDetails({ contact, reception: { customer: { name: 'Unrelated account', phone: '+12025550102' } } });
    assert.equal(result.recorded, true); assert.equal(result.name, 'First visitor'); assert.equal(result.email, email);
    assert.match(result.label, /未关联顾客账号/); assert.match(result.label, /不发送顾客邮件/);
    assert.equal(bookingContactDetails({ contact: { ...contact, emailVerifiedAt: '2030-01-01T00:00:00Z' } }).recorded, false);
  }
});
