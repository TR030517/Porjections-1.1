import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicContactList, publicEmail, publicPhone, publicStoreMap } from './publicContacts';

test('public phone links preserve explicit country codes, deduplicate formats and never guess a country', () => {
  assert.deepEqual(publicPhone(' (202) 555-0144 '), { label: '(202) 555-0144', href: 'tel:2025550144' });
  assert.equal(publicPhone('+1 202-555-0144')?.href, 'tel:+12025550144');
  assert.equal(publicContactList(['202-555-0144', '(202) 555-0144'], 'phone').length, 1);
  for (const value of ['tel:2025550144', '2025550144?x=1', '2025550144#1', '2025550144%0a', '202\n5550144', '20+25550144', '123456', '1'.repeat(16)]) assert.equal(publicPhone(value), null);
});

test('public email links have one recipient and cannot introduce headers, schemes or URI query', () => {
  assert.equal(publicEmail('shop+front@example.test')?.href, 'mailto:shop+front@example.test');
  assert.equal(publicContactList(['Shop@example.test', 'shop@example.test'], 'email').length, 1);
  for (const value of ['mailto:shop@example.test', 'shop@example.test?bcc=other@example.test', 'shop@example.test#x', 'shop%0d@example.test', 'shop@example.test\r\nBcc:x', 'a..b@example.test', '.a@example.test', 'a@-example.test', 'a@example', 'a@例子.test']) assert.equal(publicEmail(value), null);
});

test('cleared or malformed contact arrays stay empty and output is limited without truncating values into valid contacts', () => {
  for (const value of [undefined, null, [], ['2025550144', 1], '2025550144']) assert.deepEqual(publicContactList(value, 'phone'), []);
  assert.equal(publicContactList(Array.from({ length: 8 }, (_, i) => '202555014' + i), 'phone').length, 5);
  assert.deepEqual(publicContactList(['bad@example.test?subject=x'], 'email'), []);
});

test('map links encode only a specific public store address into a fixed HTTPS map destination', () => {
  const uri = new URL(publicStoreMap('12 Main St #3 & West', 'Test City', 'NY', '10002')!);
  assert.equal(uri.origin, 'https://www.google.com'); assert.equal(uri.pathname, '/maps/search/');
  assert.equal(uri.searchParams.get('api'), '1'); assert.equal(uri.searchParams.get('query'), '12 Main St #3 & West, Test City, NY, 10002');
  assert.equal(uri.hash, ''); assert.equal([...uri.searchParams].length, 2);
  for (const input of ['', null, 'Main\nStreet', 'a'.repeat(501)]) assert.equal(publicStoreMap(input, 'Test City'), null);
  assert.equal(publicStoreMap('', 'A city without a specific shop address'), null);
});

test('map queries do not append location fields already present at the end of migrated addresses', () => {
  const legacy = '1207 S Jackson St#109B, Seattle, WA98144';
  assert.equal(new URL(publicStoreMap(legacy, 'Seattle', 'Washington', '98144')!).searchParams.get('query'), legacy);
  const street = '12 Washington Ave #2';
  assert.equal(new URL(publicStoreMap(street, 'Seattle', 'Washington', '98144')!).searchParams.get('query'), street + ', Seattle, Washington, 98144');
  assert.equal(new URL(publicStoreMap('12 Main St, Seattle, WA', 'Seattle', 'Washington', '98144')!).searchParams.get('query'), '12 Main St, Seattle, WA, 98144');
  assert.equal(new URL(publicStoreMap('12 Main St, Seattle, WA 98144-1234, USA', 'Seattle', 'Washington', '98144')!).searchParams.get('query'), '12 Main St, Seattle, WA 98144-1234, USA');
  const periodDelimited = '3108 Old Denton Rd Suite 105 Carrollton. TX 75007';
  assert.equal(new URL(publicStoreMap(periodDelimited, 'Carrollton', 'Texas', '75007')!).searchParams.get('query'), periodDelimited);
});
