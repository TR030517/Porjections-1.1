#!/usr/bin/env node
// Offline validation only. No network, database client, credential loading or import path.
import {readFileSync, statSync, writeFileSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const COLLECTIONS = ['users', 'shops', 'services', 'therapists', 'therapistServices', 'bookings', 'payments'];
const MAX_ID = 9223372036854775807n;
const MAX_CENTS = 99999999;
const MAX_ISSUES = 2000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ROLES = ['CUSTOMER', 'MERCHANT', 'ADMIN'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'];
const FIELDS = {
  users: ['id', 'role', 'roles', 'status', 'phone', 'email'],
  shops: ['id', 'ownerId', 'name', 'status', 'timezone', 'phone', 'address', 'city', 'state', 'zipCode', 'latitude', 'longitude', 'category', 'shopType', 'businessHours'],
  services: ['id', 'shopId', 'name', 'category', 'durationMin', 'priceCents', 'isActive', 'variantIds'],
  therapists: ['id', 'shopId', 'name', 'isActive'],
  therapistServices: ['therapistId', 'serviceId'],
  bookings: ['id', 'bookingNo', 'kind', 'userId', 'shopId', 'serviceIds', 'therapistIds', 'quantity', 'participantCount', 'legacyGroupId', 'bookingDate', 'timezone', 'startAt', 'endAt', 'durationMin', 'priceCents', 'discountCents', 'platformFeeCents', 'totalCents', 'paidCents', 'refundedCents', 'currency', 'status', 'paymentStatus', 'tipCents', 'taxCents', 'walletAppliedCents', 'giftCardAppliedCents'],
  payments: ['id', 'bookingId', 'userId', 'shopId', 'kind', 'parentPaymentId', 'provider', 'providerTransactionId', 'status', 'amountCents', 'currency', 'occurredAt'],
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const id = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_ID;
const paymentId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS;
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const currency = value => value === 'usd';

function validDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}
function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^([1-9]\d{3}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  if (!match || !validDate(match[1]) || match[6] === '-00:00' || /[+-]14:(?!00)/.test(match[6])) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? {stamp, local: `${match[1]}T${match[2]}:${match[3]}:${match[4]}`} : null;
}
function zone(value) {
  if (typeof value !== 'string' || value.length > 100 || !(value === 'UTC' || value.includes('/'))) return false;
  try { new Intl.DateTimeFormat('en-US', {timeZone: value}).format(0); return true; } catch { return false; }
}
function localParts(stamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(stamp);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Accept the documented intermediate export only; never guess raw legacy fields. */
export function preflightLegacyExport(input) {
  const issues = [];
  const issueCounts = {};
  let blockers = 0;
  let infos = 0;
  const counts = Object.fromEntries(COLLECTIONS.map(key => [key, Array.isArray(input?.[key]) ? input[key].length : 0]));
  function issue(code, collection = 'export', row, field, severity = 'blocker') {
    if (severity === 'blocker') blockers++; else infos++;
    issueCounts[code] = (issueCounts[code] || 0) + 1;
    // All location labels come from constants, never untrusted identifiers/keys/values.
    if (issues.length < MAX_ISSUES) issues.push({code, severity, collection, ...(row === undefined ? {} : {row}), ...(field ? {field} : {})});
  }
  function shape(value, allowed, collection, row) {
    if (!object(value)) { issue('RECORD_NOT_OBJECT', collection, row); return false; }
    if (Object.keys(value).some(key => !allowed.includes(key))) issue('FIELD_NOT_IN_CONTRACT', collection, row);
    return true;
  }
  function required(value, field, collection, row, max) {
    if (!text(value, max)) issue('REQUIRED_TEXT_INVALID', collection, row, field);
  }
  function enumeration(value, allowed, field, collection, row, code = 'ENUM_UNMAPPED') {
    if (!allowed.includes(value)) issue(code, collection, row, field);
  }
  function amount(value, field, collection, row) {
    if (!money(value)) issue('MONEY_NOT_INTEGER_CENTS_OR_OUT_OF_RANGE', collection, row, field);
  }
  const maps = Object.fromEntries(COLLECTIONS.map(key => [key, new Map()]));
  const rows = {};
  const duplicateValues = {};
  function unique(value, key, collection, row) {
    if (!text(value, 1024)) return;
    duplicateValues[key] ??= new Set();
    if (duplicateValues[key].has(value)) issue('UNIQUE_VALUE_DUPLICATE', collection, row);
    duplicateValues[key].add(value);
  }
  function reference(value, target, field, collection, row) {
    if (!id(value)) { issue('REFERENCE_ID_INVALID', collection, row, field); return undefined; }
    const match = maps[target].get(value);
    if (!match) issue('ORPHAN_REFERENCE', collection, row, field);
    return match;
  }

  if (!shape(input, ['schemaVersion', 'format', 'source', ...COLLECTIONS], 'export')) input = {};
  if (input.schemaVersion !== 1 || input.format !== 'massajoy-legacy-export') issue('EXPORT_SCHEMA_UNSUPPORTED');
  const source = object(input.source) ? input.source : {};
  shape(input.source, ['system', 'datasetKind', 'exportedAt', 'declaredComplete', 'unsupportedDomains'], 'source');
  if (source.system !== 'Massajoy1.0') issue('SOURCE_SYSTEM_UNSUPPORTED', 'source');
  enumeration(source.datasetKind, ['full', 'partial', 'synthetic'], 'datasetKind', 'source');
  if (!timestamp(source.exportedAt)) issue('EXPORT_TIMESTAMP_INVALID', 'source', undefined, 'exportedAt');
  if (!Array.isArray(source.declaredComplete) || new Set(source.declaredComplete).size !== COLLECTIONS.length || source.declaredComplete.length !== COLLECTIONS.length || COLLECTIONS.some(key => !source.declaredComplete.includes(key))) {
    issue('CORE_COVERAGE_UNCONFIRMED', 'source', undefined, 'declaredComplete');
  }
  if (!Array.isArray(source.unsupportedDomains)) issue('UNSUPPORTED_DOMAINS_DECLARATION_REQUIRED', 'source');
  else if (source.unsupportedDomains.length) issue('UNSUPPORTED_DOMAIN_PRESENT', 'source');
  if (source.datasetKind === 'partial') issue('PARTIAL_EXPORT_NOT_MIGRATION', 'source');
  if (source.datasetKind === 'synthetic') issue('SYNTHETIC_VALIDATION_ONLY', 'source', undefined, undefined, 'info');

  for (const collection of COLLECTIONS) {
    if (!Array.isArray(input[collection])) { issue('COLLECTION_REQUIRED', collection); rows[collection] = []; continue; }
    if (input[collection].length > 100000) { issue('COLLECTION_LIMIT_EXCEEDED', collection); rows[collection] = []; continue; }
    rows[collection] = input[collection];
    rows[collection].forEach((record, index) => {
      const row = index + 1;
      if (!shape(record, FIELDS[collection], collection, row)) return;
      if (collection === 'therapistServices') return;
      const validId = collection === 'payments' ? paymentId(record.id) : id(record.id);
      if (!validId) issue('RECORD_ID_INVALID', collection, row, 'id');
      else if (maps[collection].has(record.id)) issue('RECORD_ID_DUPLICATE', collection, row, 'id');
      else maps[collection].set(record.id, record);
    });
  }
  if (COLLECTIONS.every(collection => counts[collection] === 0)) issue('EMPTY_EXPORT');
  for (const [index, user] of rows.users.entries()) {
    if (!object(user)) continue;
    const row = index + 1;
    enumeration(user.role, ROLES, 'role', 'users', row, 'ROLE_UNMAPPED');
    if (user.roles !== undefined && (!Array.isArray(user.roles) || user.roles.length !== 1 || user.roles[0] !== user.role)) issue('MULTIPLE_OR_CONFLICTING_ROLES_UNSUPPORTED', 'users', row, 'roles');
    enumeration(user.status, ['ACTIVE', 'SUSPENDED', 'DELETED'], 'status', 'users', row);
    if (!text(user.phone, 20) || !/^\+?[0-9]{7,15}$/.test(user.phone)) issue('PHONE_IDENTITY_INVALID', 'users', row, 'phone');
    if (typeof user.phone === 'string') unique(user.phone.replace(/^\+/, ''), 'phone', 'users', row);
    if (user.email !== undefined && user.email !== null) {
      if (!text(user.email, 255) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) issue('EMAIL_IDENTITY_INVALID', 'users', row, 'email');
      if (typeof user.email === 'string') unique(user.email.toLowerCase(), 'email', 'users', row);
    }
  }
  for (const [index, shop] of rows.shops.entries()) {
    if (!object(shop)) continue;
    const row = index + 1;
    const owner = reference(shop.ownerId, 'users', 'ownerId', 'shops', row);
    if (owner && owner.role !== 'MERCHANT') issue('SHOP_OWNER_ROLE_INVALID', 'shops', row, 'ownerId');
    required(shop.name, 'name', 'shops', row, 200);
    enumeration(shop.status, ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'], 'status', 'shops', row, 'SHOP_STATUS_UNMAPPED');
    enumeration(shop.category, ['TUINA', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'MIXED'], 'category', 'shops', row);
    enumeration(shop.shopType, ['CERTIFIED', 'APPRENTICE'], 'shopType', 'shops', row);
    if (!zone(shop.timezone)) issue('IANA_TIMEZONE_INVALID_OR_MISSING', 'shops', row, 'timezone');
    for (const [field, max] of [['phone', 20], ['address', 500], ['city', 100], ['state', 50], ['zipCode', 10]]) required(shop[field], field, 'shops', row, max);
    if (typeof shop.latitude !== 'number' || !Number.isFinite(shop.latitude) || Math.abs(shop.latitude) > 90 || typeof shop.longitude !== 'number' || !Number.isFinite(shop.longitude) || Math.abs(shop.longitude) > 180 || shop.latitude === 0 && shop.longitude === 0) issue('SHOP_COORDINATES_INVALID', 'shops', row);
    if (!object(shop.businessHours)) { issue('BUSINESS_HOURS_INVALID_OR_MISSING', 'shops', row); continue; }
    if (Object.keys(shop.businessHours).some(key => !DAYS.includes(key)) || DAYS.some(day => !Array.isArray(shop.businessHours[day]))) issue('BUSINESS_HOURS_DAYS_INCOMPLETE', 'shops', row);
    for (const day of DAYS) {
      const intervals = shop.businessHours[day];
      if (!Array.isArray(intervals)) continue;
      if (intervals.length > 1) issue('MULTIPLE_OPENING_INTERVALS_UNSUPPORTED', 'shops', row);
      for (const interval of intervals) if (!object(interval) || Object.keys(interval).some(key => !['open', 'close'].includes(key)) || !time(interval.open) || !time(interval.close) || interval.open >= interval.close) issue('OPENING_INTERVAL_INVALID_OR_OVERNIGHT', 'shops', row);
    }
  }
  for (const [index, service] of rows.services.entries()) {
    if (!object(service)) continue;
    const row = index + 1;
    reference(service.shopId, 'shops', 'shopId', 'services', row);
    required(service.name, 'name', 'services', row, 200);
    enumeration(service.category, ['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'], 'category', 'services', row);
    if (!Number.isInteger(service.durationMin) || service.durationMin < 30 || service.durationMin > 120) issue('DURATION_OUT_OF_TARGET_RANGE', 'services', row, 'durationMin');
    amount(service.priceCents, 'priceCents', 'services', row);
    if (typeof service.isActive !== 'boolean') issue('ACTIVE_FLAG_UNMAPPED', 'services', row);
    if (service.variantIds !== undefined && (!Array.isArray(service.variantIds) || service.variantIds.length)) issue('SERVICE_VARIANTS_UNSUPPORTED', 'services', row);
  }
  for (const [index, therapist] of rows.therapists.entries()) {
    if (!object(therapist)) continue;
    reference(therapist.shopId, 'shops', 'shopId', 'therapists', index + 1);
    required(therapist.name, 'name', 'therapists', index + 1, 100);
    if (typeof therapist.isActive !== 'boolean') issue('ACTIVE_FLAG_UNMAPPED', 'therapists', index + 1);
  }
  const links = new Set();
  for (const [index, link] of rows.therapistServices.entries()) {
    if (!object(link)) continue;
    const therapist = reference(link.therapistId, 'therapists', 'therapistId', 'therapistServices', index + 1);
    const service = reference(link.serviceId, 'services', 'serviceId', 'therapistServices', index + 1);
    if (therapist && service && therapist.shopId !== service.shopId) issue('CROSS_SHOP_ASSOCIATION', 'therapistServices', index + 1);
    if (id(link.therapistId) && id(link.serviceId)) {
      const key = link.therapistId + ':' + link.serviceId;
      if (links.has(key)) issue('ASSOCIATION_DUPLICATE', 'therapistServices', index + 1);
      links.add(key);
    }
  }
  for (const [index, booking] of rows.bookings.entries()) {
    if (!object(booking)) continue;
    const row = index + 1;
    required(booking.bookingNo, 'bookingNo', 'bookings', row, 30);
    unique(booking.bookingNo, 'bookingNo', 'bookings', row);
    if (booking.kind !== 'SERVICE') issue('NON_SERVICE_ORDER_UNSUPPORTED', 'bookings', row, 'kind');
    reference(booking.userId, 'users', 'userId', 'bookings', row);
    reference(booking.shopId, 'shops', 'shopId', 'bookings', row);
    for (const [field, target, maximum] of [['serviceIds', 'services', 1], ['therapistIds', 'therapists', 1]]) {
      if (!Array.isArray(booking[field])) { issue('ORDER_RESOURCE_ARRAY_REQUIRED', 'bookings', row, field); continue; }
      if (booking[field].length > maximum) issue(field === 'serviceIds' ? 'MULTI_SERVICE_ORDER_UNSUPPORTED' : 'MULTI_THERAPIST_ORDER_UNSUPPORTED', 'bookings', row, field);
      if (field === 'serviceIds' && !booking[field].length) issue('ORDER_SERVICE_REQUIRED', 'bookings', row, field);
      if (new Set(booking[field]).size !== booking[field].length) issue('ORDER_RESOURCE_DUPLICATE', 'bookings', row, field);
      for (const value of booking[field]) {
        const resource = reference(value, target, field, 'bookings', row);
        if (resource && resource.shopId !== booking.shopId) issue('CROSS_SHOP_ORDER_RESOURCE', 'bookings', row, field);
      }
    }
    if (Array.isArray(booking.serviceIds) && booking.serviceIds.length === 1 && id(booking.serviceIds[0]) && Array.isArray(booking.therapistIds) && booking.therapistIds.length === 1 && id(booking.therapistIds[0]) && !links.has(booking.therapistIds[0] + ':' + booking.serviceIds[0])) issue('THERAPIST_SERVICE_LINK_MISSING', 'bookings', row);
    if (booking.quantity !== 1 || booking.participantCount !== 1) issue('MULTI_QUANTITY_OR_PARTICIPANT_UNSUPPORTED', 'bookings', row);
    if (booking.legacyGroupId !== undefined && booking.legacyGroupId !== null && booking.legacyGroupId !== '') issue('GROUPED_ORDER_REQUIRES_MAPPING', 'bookings', row);
    if (!validDate(booking.bookingDate)) issue('BOOKING_DATE_INVALID', 'bookings', row, 'bookingDate');
    const validZone = zone(booking.timezone);
    if (!validZone) issue('IANA_TIMEZONE_INVALID_OR_MISSING', 'bookings', row, 'timezone');
    const start = timestamp(booking.startAt), end = timestamp(booking.endAt);
    if (!start || !end) issue('EXPLICIT_TIMESTAMP_INVALID_OR_MISSING', 'bookings', row);
    if (start && end) {
      if (end.stamp <= start.stamp) issue('BOOKING_INTERVAL_NOT_INCREASING', 'bookings', row);
      if (end.stamp - start.stamp !== booking.durationMin * 60000) issue('BOOKING_DURATION_MISMATCH', 'bookings', row);
      if (validZone) {
        if (localParts(start.stamp, booking.timezone) !== start.local || localParts(end.stamp, booking.timezone) !== end.local) issue('TIMESTAMP_OFFSET_TIMEZONE_MISMATCH', 'bookings', row);
        if (localParts(start.stamp, booking.timezone).slice(0, 10) !== booking.bookingDate) issue('BOOKING_LOCAL_DATE_MISMATCH', 'bookings', row);
      }
    }
    if (!Number.isInteger(booking.durationMin) || booking.durationMin < 30 || booking.durationMin > 120) issue('DURATION_OUT_OF_TARGET_RANGE', 'bookings', row, 'durationMin');
    for (const field of ['priceCents', 'discountCents', 'platformFeeCents', 'totalCents', 'paidCents', 'refundedCents']) amount(booking[field], field, 'bookings', row);
    for (const field of ['tipCents', 'taxCents', 'walletAppliedCents', 'giftCardAppliedCents']) if (booking[field] !== undefined && booking[field] !== 0) issue('UNSUPPORTED_MONEY_COMPONENT', 'bookings', row, field);
    if (!currency(booking.currency)) issue('CURRENCY_UNMAPPED', 'bookings', row, 'currency');
    if (['priceCents', 'discountCents', 'platformFeeCents', 'totalCents'].every(field => money(booking[field])) && (booking.discountCents > booking.priceCents || booking.priceCents - booking.discountCents + booking.platformFeeCents !== booking.totalCents)) issue('BOOKING_TOTAL_MISMATCH', 'bookings', row);
    if (money(booking.totalCents) && money(booking.paidCents) && booking.paidCents > booking.totalCents) issue('OVERPAYMENT_UNSUPPORTED', 'bookings', row);
    if (money(booking.paidCents) && money(booking.refundedCents) && booking.refundedCents > booking.paidCents) issue('REFUND_EXCEEDS_PAID', 'bookings', row);
    enumeration(booking.status, BOOKING_STATUSES, 'status', 'bookings', row, 'BOOKING_STATUS_UNMAPPED');
    enumeration(booking.paymentStatus, ['UNPAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'], 'paymentStatus', 'bookings', row, 'PAYMENT_STATUS_UNMAPPED');
    const paid = booking.paidCents, refunded = booking.refundedCents;
    if (money(paid) && money(refunded) && money(booking.totalCents)) {
      const consistent = booking.paymentStatus === 'UNPAID' ? paid === 0 && refunded === 0
        : booking.paymentStatus === 'PAID' ? paid === booking.totalCents && refunded === 0
        : booking.paymentStatus === 'PARTIALLY_REFUNDED' ? paid === booking.totalCents && refunded > 0 && refunded < paid
        : booking.paymentStatus === 'REFUNDED' ? paid > 0 && paid === refunded : true;
      if (!consistent) issue('BOOKING_PAYMENT_STATUS_CONFLICT', 'bookings', row);
      if (['CONFIRMED', 'COMPLETED'].includes(booking.status) && (paid !== booking.totalCents || booking.paymentStatus === 'UNPAID') || booking.status === 'REFUNDED' && booking.paymentStatus !== 'REFUNDED' || booking.status === 'CANCELLED' && paid > refunded) issue('BOOKING_LIFECYCLE_CONFLICT', 'bookings', row);
    }
  }

  const ledger = new Map();
  for (const [index, payment] of rows.payments.entries()) {
    if (!object(payment)) continue;
    const row = index + 1;
    const booking = reference(payment.bookingId, 'bookings', 'bookingId', 'payments', row);
    if (payment.userId !== undefined && booking && payment.userId !== booking.userId || payment.shopId !== undefined && booking && payment.shopId !== booking.shopId) issue('PAYMENT_OWNERSHIP_MISMATCH', 'payments', row);
    enumeration(payment.kind, ['PAYMENT', 'REFUND'], 'kind', 'payments', row, 'PAYMENT_KIND_UNMAPPED');
    enumeration(payment.provider, ['square', 'stripe'], 'provider', 'payments', row, 'PAYMENT_PROVIDER_UNMAPPED');
    enumeration(payment.status, payment.kind === 'REFUND' ? ['PENDING', 'RETRYABLE', 'SUCCEEDED', 'FAILED'] : ['CREATED', 'SUCCEEDED'], 'status', 'payments', row, 'LEDGER_STATUS_UNMAPPED');
    amount(payment.amountCents, 'amountCents', 'payments', row);
    if (!currency(payment.currency) || booking && payment.currency !== booking.currency) issue('PAYMENT_CURRENCY_MISMATCH', 'payments', row);
    if (!timestamp(payment.occurredAt)) issue('EXPLICIT_TIMESTAMP_INVALID_OR_MISSING', 'payments', row, 'occurredAt');
    if (payment.status === 'SUCCEEDED' && !text(payment.providerTransactionId, 255)) issue('SETTLEMENT_REFERENCE_REQUIRED', 'payments', row);
    if (payment.providerTransactionId !== undefined && payment.providerTransactionId !== null) {
      if (!text(payment.providerTransactionId, 255)) issue('SETTLEMENT_REFERENCE_INVALID', 'payments', row);
      else if (typeof payment.provider === 'string') unique(payment.provider + ':' + payment.providerTransactionId, 'providerTransaction', 'payments', row);
    }
    if (payment.kind === 'PAYMENT' && payment.parentPaymentId !== undefined && payment.parentPaymentId !== null) issue('PAYMENT_PARENT_UNEXPECTED', 'payments', row);
    if (payment.kind === 'REFUND') {
      if (!paymentId(payment.parentPaymentId)) issue('REFUND_PARENT_ID_INVALID', 'payments', row, 'parentPaymentId');
      const parent = maps.payments.get(payment.parentPaymentId);
      if (!parent || parent.kind !== 'PAYMENT') issue('REFUND_PARENT_MISSING', 'payments', row);
      else if (parent.bookingId !== payment.bookingId || parent.provider !== payment.provider || parent.currency !== payment.currency) issue('REFUND_PARENT_MISMATCH', 'payments', row);
      else if (payment.status === 'SUCCEEDED' && parent.status !== 'SUCCEEDED') issue('REFUND_PARENT_NOT_SETTLED', 'payments', row);
      else if (timestamp(payment.occurredAt) && timestamp(parent.occurredAt) && timestamp(payment.occurredAt).stamp < timestamp(parent.occurredAt).stamp) issue('REFUND_PRECEDES_PAYMENT', 'payments', row);
      if (parent && money(parent.amountCents) && money(payment.amountCents) && payment.amountCents > parent.amountCents) issue('REFUND_EXCEEDS_PARENT_PAYMENT', 'payments', row);
    }
    const bucket = ledger.get(payment.bookingId) || {paymentRows: 0, settledPaymentRows: 0, paid: 0n, refunded: 0n};
    if (payment.kind === 'PAYMENT') bucket.paymentRows++;
    if (money(payment.amountCents) && payment.status === 'SUCCEEDED') {
      if (payment.kind === 'PAYMENT') { bucket.paid += BigInt(payment.amountCents); bucket.settledPaymentRows++; }
      if (payment.kind === 'REFUND') bucket.refunded += BigInt(payment.amountCents);
    }
    ledger.set(payment.bookingId, bucket);
    if (booking && payment.kind === 'PAYMENT' && money(payment.amountCents) && money(booking.totalCents) && payment.amountCents !== booking.totalCents) issue('PAYMENT_QUOTE_MISMATCH', 'payments', row);
  }
  for (const [index, booking] of rows.bookings.entries()) {
    if (!object(booking)) continue;
    const bucket = ledger.get(booking.id) || {paymentRows: 0, settledPaymentRows: 0, paid: 0n, refunded: 0n};
    if (bucket.paymentRows > 1) issue('MULTIPLE_PAYMENT_RECORDS_UNSUPPORTED', 'bookings', index + 1);
    if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(booking.paymentStatus) && bucket.settledPaymentRows !== 1) issue('SETTLED_PAYMENT_REQUIRED', 'bookings', index + 1);
    if (money(booking.paidCents) && bucket.paid !== BigInt(booking.paidCents)) issue('PAID_LEDGER_RECONCILIATION_FAILED', 'bookings', index + 1);
    if (money(booking.refundedCents) && bucket.refunded !== BigInt(booking.refundedCents)) issue('REFUND_LEDGER_RECONCILIATION_FAILED', 'bookings', index + 1);
  }
  return {
    schemaVersion: 1, tool: 'massajoy-legacy-migration-preflight', inputSchemaVersion: input.schemaVersion === 1 ? 1 : null,
    mode: 'offline-read-only-dry-run', preflightPassed: blockers === 0,
    eligibleForImportPlanning: blockers === 0 && source.datasetKind === 'full',
    canImport: false, importerNotImplemented: true, deploymentReady: false,
    counts, summary: {blockers, infos, issuesTotal: blockers + infos, issuesReturned: issues.length, issuesTruncated: blockers + infos > issues.length},
    issueCounts, issues,
    assurance: 'Declared completeness is unverified. Core mapping checks only; no import, state repair, payment confirmation, data-truth verification or production readiness is performed.',
  };
}

export function runCli(args = process.argv.slice(2)) {
  function fail(code) { process.stdout.write(JSON.stringify({schemaVersion: 1, tool: 'massajoy-legacy-migration-preflight', error: {code}, canImport: false, importerNotImplemented: true}) + '\n'); return 1; }
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/legacy-migration-preflight.mjs local-export.json [--report new-report.json]\nOffline only. Exit 0: preflight passed; 2: mapping blockers; 1: invocation/file failure. No database import is implemented.\n');
    return 0;
  }
  if (![1, 3].includes(args.length) || args.length === 3 && args[1] !== '--report' || !args[0] || args[0].startsWith('-')) return fail('CLI_ARGUMENTS_INVALID');
  const inputPath = args[0], reportPath = args[2];
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath) || extname(inputPath).toLowerCase() !== '.json') return fail('LOCAL_JSON_FILE_REQUIRED');
  if (reportPath && (/^[a-z][a-z0-9+.-]*:\/\//i.test(reportPath) || extname(reportPath).toLowerCase() !== '.json' || resolve(reportPath) === resolve(inputPath))) return fail('REPORT_PATH_INVALID');
  let input;
  try {
    const stat = statSync(inputPath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return fail('INPUT_FILE_SIZE_OR_TYPE_INVALID');
    input = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch { return fail('INPUT_READ_OR_JSON_INVALID'); }
  let report;
  try { report = preflightLegacyExport(input); } catch { return fail('PREFLIGHT_INTERNAL_FAILURE'); }
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (reportPath) {
    try { writeFileSync(reportPath, serialized, {flag: 'wx', mode: 0o600}); }
    catch { return fail('REPORT_CREATE_FAILED_NO_OVERWRITE'); }
  }
  process.stdout.write(serialized);
  return report.preflightPassed ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = runCli();
