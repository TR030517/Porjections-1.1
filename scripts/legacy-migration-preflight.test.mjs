import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {preflightLegacyExport} from './legacy-migration-preflight.mjs';

const good = JSON.parse(readFileSync(new URL('./fixtures/legacy-preflight-valid.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(good);
const codes = data => preflightLegacyExport(data).issueCounts;
const cli = fileURLToPath(new URL('./legacy-migration-preflight.mjs', import.meta.url));

test('synthetic sample passes core checks, preserves signed-BigInt IDs and never offers import', () => {
  const input = clone();
  const snapshot = JSON.stringify(input);
  const report = preflightLegacyExport(input);
  assert.equal(report.preflightPassed, true);
  assert.equal(report.canImport, false);
  assert.equal(report.importerNotImplemented, true);
  assert.equal(report.deploymentReady, false);
  assert.equal(report.eligibleForImportPlanning, false);
  assert.deepEqual(report.counts, {users: 2, shops: 1, services: 1, therapists: 1, therapistServices: 1, bookings: 1, payments: 1});
  assert.equal(JSON.stringify(input), snapshot, 'No defaults or repairs may mutate the export');
  assert.equal(input.users[1].id, '9223372036854775807');
});

test('full declaration only enables planning; partial/sample exports never become migrations', () => {
  const input = clone(); input.source.datasetKind = 'full';
  const report = preflightLegacyExport(input);
  assert.equal(report.preflightPassed, true);
  assert.equal(report.eligibleForImportPlanning, true);
  assert.equal(report.canImport, false);
  input.source.datasetKind = 'partial';
  assert.ok(codes(input).PARTIAL_EXPORT_NOT_MIGRATION);
  input.source.datasetKind = 'full'; input.source.declaredComplete.pop();
  assert.ok(codes(input).CORE_COVERAGE_UNCONFIRMED);
});

test('raw exports, unsupported versions and absent collections are rejected', () => {
  assert.ok(codes({schemaVersion: 2}).EXPORT_SCHEMA_UNSUPPORTED);
  assert.ok(codes(null).COLLECTION_REQUIRED);
  assert.ok(codes([]).RECORD_NOT_OBJECT);
  const input = clone(); delete input.payments;
  assert.ok(codes(input).COLLECTION_REQUIRED);
});

test('duplicate records, identity collisions and unsafe numeric IDs are blocked', () => {
  const input = clone(); input.users.push({...input.users[1]});
  assert.ok(codes(input).RECORD_ID_DUPLICATE);
  assert.ok(codes(input).UNIQUE_VALUE_DUPLICATE);
  input.users.pop(); input.users[1].phone = input.users[0].phone.slice(1);
  assert.ok(codes(input).UNIQUE_VALUE_DUPLICATE);
  input.users[1].id = 9223372036854775807;
  assert.ok(codes(input).RECORD_ID_INVALID);
  input.users[1].id = '9223372036854775808';
  assert.ok(codes(input).RECORD_ID_INVALID);
});

test('roles, explicit approval state and ownership must be resolved before planning', () => {
  const input = clone(); input.users[0].role = 'SHOP_MANAGER';
  input.users[1].roles = ['CUSTOMER', 'ADMIN']; input.shops[0].status = 1;
  const result = codes(input);
  assert.ok(result.ROLE_UNMAPPED);
  assert.ok(result.SHOP_OWNER_ROLE_INVALID);
  assert.ok(result.MULTIPLE_OR_CONFLICTING_ROLES_UNSUPPORTED);
  assert.ok(result.SHOP_STATUS_UNMAPPED);
});

test('orphan and same-owner cross-shop relationships cannot be flattened', () => {
  const input = clone();
  input.shops.push({...structuredClone(input.shops[0]), id: '102'});
  input.services[0].shopId = '102';
  input.therapists[0].shopId = '999';
  const result = codes(input);
  assert.ok(result.ORPHAN_REFERENCE);
  assert.ok(result.CROSS_SHOP_ASSOCIATION);
  assert.ok(result.CROSS_SHOP_ORDER_RESOURCE);
  input.therapistServices = [];
  assert.ok(codes(input).THERAPIST_SERVICE_LINK_MISSING);
});

test('duplicate links, multi-service, multi-therapist, grouped and multi-quantity orders block', () => {
  const input = clone(); input.therapistServices.push({...input.therapistServices[0]});
  const booking = input.bookings[0];
  booking.serviceIds.push('201'); booking.therapistIds.push('301');
  booking.quantity = 2; booking.participantCount = 2; booking.legacyGroupId = 'synthetic-group';
  const result = codes(input);
  for (const code of ['ASSOCIATION_DUPLICATE', 'MULTI_SERVICE_ORDER_UNSUPPORTED', 'MULTI_THERAPIST_ORDER_UNSUPPORTED', 'ORDER_RESOURCE_DUPLICATE', 'MULTI_QUANTITY_OR_PARTICIPANT_UNSUPPORTED', 'GROUPED_ORDER_REQUIRES_MAPPING']) assert.ok(result[code], code);
});

test('multi-period and overnight opening hours, variants and unsupported domains block', () => {
  const input = clone();
  input.shops[0].businessHours.monday.push({open: '18:00', close: '22:00'});
  input.shops[0].businessHours.tuesday = [{open: '22:00', close: '02:00'}];
  input.services[0].variantIds = ['legacy-variant'];
  input.source.unsupportedDomains = ['giftCards', 'balances'];
  const result = codes(input);
  for (const code of ['MULTIPLE_OPENING_INTERVALS_UNSUPPORTED', 'OPENING_INTERVAL_INVALID_OR_OVERNIGHT', 'SERVICE_VARIANTS_UNSUPPORTED', 'UNSUPPORTED_DOMAIN_PRESENT']) assert.ok(result[code], code);
});

test('real calendar dates, explicit offsets and IANA agreement are required', () => {
  const input = clone(); input.bookings[0].bookingDate = '2031-02-30';
  input.bookings[0].startAt = '2031-01-15 10:00:00'; input.shops[0].timezone = 'CST';
  let result = codes(input);
  assert.ok(result.BOOKING_DATE_INVALID); assert.ok(result.EXPLICIT_TIMESTAMP_INVALID_OR_MISSING);
  assert.ok(result.IANA_TIMEZONE_INVALID_OR_MISSING);
  input.bookings[0].startAt = '2031-01-15T10:00:00-05:00';
  assert.ok(codes(input).TIMESTAMP_OFFSET_TIMEZONE_MISMATCH);
  input.bookings[0].startAt = '2031-01-15T10:00:00-00:00';
  assert.ok(codes(input).EXPLICIT_TIMESTAMP_INVALID_OR_MISSING);
});

test('DST gaps fail and explicit fold offsets preserve the exact two instants', () => {
  const input = clone(); const booking = input.bookings[0];
  booking.bookingDate = '2031-03-09'; booking.startAt = '2031-03-09T02:30:00-06:00'; booking.endAt = '2031-03-09T04:30:00-05:00';
  assert.ok(codes(input).TIMESTAMP_OFFSET_TIMEZONE_MISMATCH);
  booking.bookingDate = '2031-11-02'; booking.startAt = '2031-11-02T01:30:00-05:00'; booking.endAt = '2031-11-02T01:30:00-06:00';
  assert.equal(preflightLegacyExport(input).preflightPassed, true, 'An explicitly disambiguated fold is not guessed');
  booking.durationMin = 90;
  assert.ok(codes(input).BOOKING_DURATION_MISMATCH);
});

test('decimal/string/negative/oversized cents and unsupported money components are blocked', () => {
  for (const value of ['55.00', 5500.5, -1, Number.MAX_SAFE_INTEGER, 100000000]) {
    const input = clone(); input.bookings[0].paidCents = value;
    assert.ok(codes(input).MONEY_NOT_INTEGER_CENTS_OR_OUT_OF_RANGE);
  }
  const input = clone(); input.bookings[0].tipCents = 100; input.bookings[0].walletAppliedCents = 200;
  input.bookings[0].kind = 'GIFT_CARD';
  assert.ok(codes(input).UNSUPPORTED_MONEY_COMPONENT);
  assert.ok(codes(input).NON_SERVICE_ORDER_UNSUPPORTED);
});

test('payment truth comes from reconciled ledger, never paid flags or quote alone', () => {
  const input = clone(); input.payments = [];
  assert.ok(codes(input).PAID_LEDGER_RECONCILIATION_FAILED);
  assert.ok(codes(input).SETTLED_PAYMENT_REQUIRED);
  input.payments = structuredClone(good.payments); input.payments[0].status = 'CREATED';
  assert.ok(codes(input).PAID_LEDGER_RECONCILIATION_FAILED);
  input.payments[0].status = 'SUCCEEDED'; input.payments[0].amountCents = 5000;
  assert.ok(codes(input).PAYMENT_QUOTE_MISMATCH);
  input.bookings[0].totalCents = 7000;
  assert.ok(codes(input).BOOKING_TOTAL_MISMATCH);
});

test('unpaid records without a payment stay unpaid; zero paid flags need settlement evidence', () => {
  const input = clone(); Object.assign(input.bookings[0], {status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0}); input.payments = [];
  assert.equal(preflightLegacyExport(input).preflightPassed, true);
  Object.assign(input.bookings[0], {priceCents: 0, discountCents: 0, platformFeeCents: 0, totalCents: 0, paymentStatus: 'PAID'});
  assert.ok(codes(input).SETTLED_PAYMENT_REQUIRED);
});

test('payment ownership, currency, provider and transaction uniqueness must match', () => {
  const input = clone(); const payment = input.payments[0];
  payment.userId = '999'; payment.shopId = '998'; payment.currency = 'eur'; payment.provider = 'cash';
  input.payments.push({...payment, id: 'synthetic-payment-2'});
  const result = codes(input);
  for (const code of ['PAYMENT_OWNERSHIP_MISMATCH', 'PAYMENT_CURRENCY_MISMATCH', 'PAYMENT_PROVIDER_UNMAPPED', 'MULTIPLE_PAYMENT_RECORDS_UNSUPPORTED', 'UNIQUE_VALUE_DUPLICATE']) assert.ok(result[code], code);
});

test('successful refunds reconcile with their settled parent and cannot precede or exceed payment', () => {
  const input = clone(); const booking = input.bookings[0];
  booking.refundedCents = 500; booking.paymentStatus = 'PARTIALLY_REFUNDED';
  input.payments.push({id: 'synthetic-refund-1', bookingId: '401', kind: 'REFUND', parentPaymentId: 'synthetic-payment-1', provider: 'stripe', providerTransactionId: 'synthetic-provider-refund-1', status: 'SUCCEEDED', amountCents: 500, currency: 'usd', occurredAt: '2031-01-16T10:00:00Z'});
  assert.equal(preflightLegacyExport(input).preflightPassed, true);
  input.payments[1].occurredAt = '2031-01-01T00:00:00Z';
  assert.ok(codes(input).REFUND_PRECEDES_PAYMENT);
  input.payments[1].parentPaymentId = 'absent';
  assert.ok(codes(input).REFUND_PARENT_MISSING);
  input.payments[1].parentPaymentId = {toString: null};
  assert.ok(codes(input).REFUND_PARENT_ID_INVALID);
  input.payments[1].parentPaymentId = 'synthetic-payment-1';
  input.payments[1].amountCents = 6000; booking.refundedCents = 6000;
  assert.ok(codes(input).REFUND_EXCEEDS_PAID);
  assert.ok(codes(input).REFUND_EXCEEDS_PARENT_PAYMENT);
});

test('pending refunds do not count as refunded and maximum-length transaction IDs remain unique', () => {
  const input = clone();
  input.payments.push({id: 'synthetic-refund-1', bookingId: '401', kind: 'REFUND', parentPaymentId: 'synthetic-payment-1', provider: 'stripe', status: 'PENDING', amountCents: 500, currency: 'usd', occurredAt: '2031-01-16T10:00:00Z'});
  assert.equal(preflightLegacyExport(input).preflightPassed, true);
  input.bookings[0].refundedCents = 500;
  assert.ok(codes(input).REFUND_LEDGER_RECONCILIATION_FAILED);
  input.payments[0].providerTransactionId = 'x'.repeat(255);
  input.payments[1].providerTransactionId = 'x'.repeat(255);
  assert.ok(codes(input).UNIQUE_VALUE_DUPLICATE);
});

test('malformed nested objects do not execute coercions or leak through reports', () => {
  const input = clone();
  input.bookings[0].serviceIds = [{toString: null}]; input.bookings[0].therapistIds = [{toString: null}];
  input.payments[0].provider = {toString: null}; input.payments[0].providerTransactionId = {toString: null};
  input.users[0].unrecognizedSecretField = 'PRIVATE_MARKER_DO_NOT_ECHO';
  const report = preflightLegacyExport(input);
  const output = JSON.stringify(report);
  for (const marker of ['PRIVATE_MARKER_DO_NOT_ECHO', 'unrecognizedSecretField', good.users[0].phone, good.users[0].email, good.users[0].id, good.bookings[0].bookingNo, good.payments[0].providerTransactionId]) assert.equal(output.includes(marker), false, marker);
  assert.ok(report.issueCounts.FIELD_NOT_IN_CONTRACT);
  assert.ok(report.issueCounts.REFERENCE_ID_INVALID);
});

test('issue details are bounded while aggregate issue counts remain accurate', () => {
  const input = clone(); input.services = Array.from({length: 2100}, () => null);
  const report = preflightLegacyExport(input);
  assert.equal(report.summary.issuesReturned, 2000);
  assert.equal(report.summary.issuesTruncated, true);
  assert.equal(report.issueCounts.RECORD_NOT_OBJECT, 2100);
});

test('CLI uses exit 0/2/1, writes only a new report and cannot overwrite input or business files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'massajoy-preflight-'));
  try {
    const input = join(directory, 'input.json'), report = join(directory, 'report.json'), existing = join(directory, 'business.json');
    writeFileSync(input, JSON.stringify(good)); writeFileSync(existing, 'UNCHANGED');
    const run = args => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 10000});
    const success = run([input, '--report', report]);
    assert.equal(success.status, 0); assert.equal(JSON.parse(success.stdout).preflightPassed, true);
    assert.equal(JSON.parse(readFileSync(report, 'utf8')).canImport, false);
    assert.equal(run([input, '--report', input]).status, 1);
    assert.equal(run([input, '--report', existing]).status, 1);
    assert.equal(readFileSync(existing, 'utf8'), 'UNCHANGED');
    assert.equal(readFileSync(input, 'utf8'), JSON.stringify(good));
    const invalid = clone(); invalid.payments = []; writeFileSync(input, JSON.stringify(invalid));
    assert.equal(run([input]).status, 2);
    assert.equal(run(['https://example.invalid/legacy.json']).status, 1);
    writeFileSync(input, '{"private":"PRIVATE_MARKER_DO_NOT_ECHO",');
    const malformed = run([input]); assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout.includes('PRIVATE_MARKER_DO_NOT_ECHO'), false);
    assert.equal(run([input, '--report', join(directory, 'absent', 'report.json')]).status, 1);
    assert.deepEqual(readdirSync(directory).sort(), ['business.json', 'input.json', 'report.json']);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('CLI works without project dependencies and is independent of the host local timezone', () => {
  const directory = mkdtempSync(join(tmpdir(), 'massajoy-offline-'));
  try {
    const input = join(directory, 'input.json'); writeFileSync(input, JSON.stringify(good));
    const run = TZ => spawnSync(process.execPath, [cli, input], {cwd: directory, env: {...process.env, TZ}, encoding: 'utf8', timeout: 10000});
    const utc = run('UTC'), hawaii = run('Pacific/Honolulu');
    assert.equal(utc.status, 0); assert.equal(hawaii.status, 0);
    assert.equal(utc.stdout, hawaii.stdout);
    assert.deepEqual(readdirSync(directory), ['input.json'], 'No implicit files or environment config may be created');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
