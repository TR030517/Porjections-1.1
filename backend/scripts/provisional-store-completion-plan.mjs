import { Prisma } from '@prisma/client';
import * as timezoneModule from '../src/common/store-timezone.ts';
import legacyImport from './import-legacy-stores.cjs';
import legacyBooking from './lib/legacy-booking.cjs';
import { generatedAddressMapLink } from './remaining-store-location-plan.mjs';

const { inferStoreTimezone, usStateCodeFromZip } = timezoneModule.default ?? timezoneModule;
const { legacyLocation, normalizeUsState } = legacyImport;
const { DAYS, parseDay } = legacyBooking;
export const COMPLETION_POLICY_ID = 'local-mvp-provisional-defaults-2026-11-07-v1';
export const DEFAULT_COMPLETION_POLICY = Object.freeze({ state: 'Pending update', city: 'Pending update', address: 'Address pending update',
  zipCode: '00000', timezone: 'America/Chicago', staffCount: 2, open: '09:00', close: '22:00' });
export const completionSelect = { id: true, name: true, address: true, city: true, state: true, zipCode: true, timezone: true,
  businessHours: true, studioProfile: true, status: true, deletedAt: true, updatedAt: true,
  therapists: { orderBy: { id: 'asc' }, select: { id: true, shopId: true, name: true, avatarUrl: true, title: true, bio: true,
    yearsExp: true, gender: true, isActive: true, sortOrder: true, scheduleMode: true, createdAt: true, updatedAt: true } } };
const text = value => String(value ?? '').trim();
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const missingText = value => !text(value) || /^(undefined|null|n\/a)$/i.test(text(value));
export function canonical(value) {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const knownJacksonvilleZipConflict = shop => String(shop.id) === '1085' && shop.city === 'Jacksonville' && shop.state === 'Florida' && shop.zipCode === '46902';
const validZone = value => { try { return !!text(value) && !!new Intl.DateTimeFormat('en', { timeZone: text(value) }); } catch { return false; } };
const https = value => { try { const url = new URL(text(value)); return url.protocol === 'https:' && !url.username && !url.password && !/[\s\\\u0000-\u001f\u007f]/u.test(text(value)) ? url.href : ''; } catch { return ''; } };

export function checkedCompletionPolicy(input = {}) {
  const policy = { ...DEFAULT_COMPLETION_POLICY, ...input };
  if (!validZone(policy.timezone) || policy.timezone !== 'America/Chicago' || policy.staffCount !== 2 || policy.open !== '09:00' || policy.close !== '22:00'
    || policy.zipCode !== '00000' || policy.state !== 'Pending update' || policy.city !== 'Pending update' || policy.address !== 'Address pending update') {
    throw Error('Only the explicitly approved provisional defaults are allowed');
  }
  return policy;
}

function hoursObject(value) { if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } } return object(value) ? value : null; }
function hasOpening(hours) {
  return object(hours) && DAYS.some(day => (Array.isArray(hours[day]) ? hours[day] : [hours[day]]).some(row => object(row) && row.closed !== true
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.open ?? '') && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.close ?? '') && row.open < row.close));
}
function defaultHours(policy) { return Object.fromEntries(DAYS.map(day => [day, { open: policy.open, close: policy.close, closed: false }])); }

/** Existing hours and explicit rest days survive. Only an exact legacy-derived
 * no-opening snapshot may have its missing days completed or all-imported rest
 * days replaced under this explicit one-off instruction. */
function completeHours(before, source, policy) {
  const current = hoursObject(before.businessHours);
  if (before.businessHours == null || current && Object.keys(current).length === 0) return { value: defaultHours(policy), reason: 'missing-weekly-hours-default', replacedDays: DAYS };
  if (!current || hasOpening(current)) return null;
  if (!source || before.studioProfile?.legacyImport?.source !== 'Massajoy1.0') return null;
  const fromSource = Object.fromEntries(DAYS.flatMap(day => { const parsed = parseDay(source[day + '_state'], source[day + '_time']); return parsed.value === null ? [] : [[day, parsed.value]]; }));
  if (!same(fromSource, current)) return null;
  const missing = DAYS.filter(day => !Object.hasOwn(current, day));
  if (missing.length) return { value: { ...current, ...Object.fromEntries(missing.map(day => [day, { open: policy.open, close: policy.close, closed: false }])) },
    reason: 'exact-legacy-unparsed-days-default', replacedDays: missing };
  if (DAYS.every(day => parseDay(source[day + '_state'], source[day + '_time']).value?.closed === true)) {
    return { value: defaultHours(policy), reason: 'explicit-instruction-exact-legacy-all-closed-default', replacedDays: DAYS };
  }
  return null;
}

function substantiveStreet(value) {
  const street = text(value);
  return street.length >= 12 && !/pending update/i.test(street)
    && (/^\d[\dA-Za-z]*(?:-\d[\dA-Za-z]*)?(?=\s|#)/.test(street) && /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|drive|dr\.?|highway|hwy|lane|ln\.?|way|court|ct\.?|pkwy)\b/i.test(street)
      || /\bStorgata\s+\d+/i.test(street) || /(?:路|街|道|巷).*\d|\d+号/u.test(street));
}

function mapLink(shop, fields) {
  const exact = generatedAddressMapLink(shop);
  if (exact && !['address', 'city', 'state', 'zipCode'].some(field => fields[field]?.provisional)) return { url: exact, kind: 'generated-address-search' };
  if (!substantiveStreet(shop.address) || fields.address?.provisional) return null;
  const query = [shop.address, ...['city', 'state', 'zipCode'].flatMap(field => !missingText(shop[field]) && !fields[field]?.provisional && !/pending update|^00000$/i.test(text(shop[field])) ? [shop[field]] : [])].map(text).join(', ');
  return { url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query), kind: 'generated-source-address-search' };
}

export function completionMissingCounts(shops) {
  return { ...Object.fromEntries(['address', 'city', 'state', 'zipCode', 'timezone'].map(field => [field, shops.filter(row => missingText(row[field])).length])),
    mapShareUrl: shops.filter(row => missingText(row.studioProfile?.mapShareUrl)).length,
    zeroActiveStaff: shops.filter(row => !row.therapists.some(person => person.isActive === true)).length,
    noOpeningPeriods: shops.filter(row => !hasOpening(hoursObject(row.businessHours))).length };
}

export function provisionalStoreCompletionPlan(shops, sourceRows, guards = new Map(), suppliedPolicy = {}) {
  const policy = checkedCompletionPolicy(suppliedPolicy), sources = new Map(sourceRows.map(row => [String(row.id), row]));
  const changes = [], skipped = [], counts = { fields: {}, newTherapists: 0, staffingStores: 0, hoursStores: 0, provisionalTimezoneStores: 0, generatedMaps: 0, copiedMaps: 0 };
  for (const before of shops) {
    const profile = before.studioProfile ?? {}, previousMarker = profile.provisionalCompletion;
    if (!object(profile) || previousMarker !== undefined && (!object(previousMarker) || previousMarker.fields !== undefined && !object(previousMarker.fields))) { skipped.push({ id: String(before.id), reason: 'profile-shape-needs-review' }); continue; }
    const imported = profile.legacyImport, sourceId = imported?.source === 'Massajoy1.0' ? String(imported.sourceShopId) : null;
    const source = sources.get(sourceId), extracted = source ? legacyLocation(source) : {};
    const data = {}, fields = {}, evidence = [], guard = guards.get(String(before.id)) ?? { futureBookings: 0, activeLocks: 0 };
    const record = (field, value, reason, provisional = false) => { data[field] = value; fields[field] = { value, before: before[field] ?? null, source: reason, provisional, needsReview: provisional }; };
    for (const field of ['address', 'city', 'state', 'zipCode']) {
      if (!missingText(before[field])) continue;
      let candidate = text(extracted[field]);
      if (missingText(candidate)) candidate = '';
      if (field === 'state' && !candidate) { const code = usStateCodeFromZip(text(!missingText(before.zipCode) ? before.zipCode : extracted.zipCode)); if (code) { record(field, normalizeUsState(code), 'current-or-legacy-zip-state', true); continue; } }
      if (candidate) record(field, candidate, 'Massajoy1.0-local-source-field');
      else record(field, policy[field], 'explicit-provisional-placeholder', true);
    }
    // This one exact imported combination was explicitly approved for a
    // provisional ZIP correction; no city/state or replacement ZIP is guessed.
    if (knownJacksonvilleZipConflict(before)) record('zipCode', policy.zipCode, 'explicit-known-Jacksonville-Florida-incompatible-46902-placeholder', true);
    if (missingText(before.timezone)) {
      if (guard.futureBookings || guard.activeLocks) skipped.push({ id: String(before.id), field: 'timezone', reason: 'future-reservations-or-resource-locks' });
      else {
        const effective = { ...before, ...data }, inferred = inferStoreTimezone(effective.city, effective.state, effective.zipCode);
        const original = [imported?.legacyTimezone, source?.utc].map(text).find(validZone);
        if (inferred) record('timezone', inferred, 'state-primary-timezone-inference', true);
        else if (original) record('timezone', original, 'Massajoy1.0-valid-IANA-timezone');
        else { record('timezone', policy.timezone, 'explicit-provisional-timezone-default', true); counts.provisionalTimezoneStores++; }
      }
    }
    const hours = completeHours(before, source, policy);
    if (hours) {
      if (guard.futureBookings || guard.activeLocks) skipped.push({ id: String(before.id), field: 'businessHours', reason: 'future-reservations-or-resource-locks' });
      else { record('businessHours', hours.value, hours.reason, true); fields.businessHours.replacedDays = hours.replacedDays; counts.hoursStores++; }
    } else if (!hasOpening(hoursObject(before.businessHours))) skipped.push({ id: String(before.id), field: 'businessHours', reason: 'nonempty-hours-without-exact-legacy-evidence-preserved' });
    const staff = [];
    if (!before.therapists.some(person => person.isActive === true)) {
      if (guard.futureBookings || guard.activeLocks) skipped.push({ id: String(before.id), field: 'therapists', reason: 'future-reservations-or-resource-locks' });
      else {
        const names = new Set(before.therapists.map(person => person.name)); let number = 1, order = Math.min(10000, Math.max(0, ...before.therapists.map(person => person.sortOrder)) + 1);
        for (let at = 0; at < policy.staffCount; at++) { while (names.has('Therapist ' + number)) number++; const name = 'Therapist ' + number++; names.add(name);
          staff.push({ name, avatarUrl: null, title: null, bio: null, yearsExp: 0, gender: null, isActive: true, scheduleMode: 'SHOP', sortOrder: order }); order = Math.min(10000, order + 1); }
        fields.therapists = { beforeActiveCount: 0, value: policy.staffCount, names: staff.map(person => person.name), source: 'explicit-provisional-default-staff-count', provisional: true, needsReview: true };
        counts.newTherapists += staff.length; counts.staffingStores++;
      }
    }
    let nextProfile = { ...profile };
    if (missingText(profile.mapShareUrl)) {
      const copied = https(source?.google_map_share_url) || https(source?.google_map), generated = copied ? null : mapLink({ ...before, ...data }, fields);
      if (copied || generated) { nextProfile.mapShareUrl = copied || generated.url; nextProfile.mapShareUrlSource = { kind: copied ? 'legacy-source-link' : generated.kind, source: copied ? 'Massajoy1.0' : COMPLETION_POLICY_ID, sourceShopId: sourceId };
        fields.mapShareUrl = { value: nextProfile.mapShareUrl, before: profile.mapShareUrl ?? null, source: nextProfile.mapShareUrlSource.kind, provisional: false, needsReview: !copied };
        counts[copied ? 'copiedMaps' : 'generatedMaps']++; }
      else skipped.push({ id: String(before.id), field: 'mapShareUrl', reason: 'no-substantive-street-kept-empty' });
    }
    if (!Object.keys(fields).length) continue;
    nextProfile.provisionalCompletion = { ...(previousMarker ?? {}), version: 1, policyId: COMPLETION_POLICY_ID, needsReview: true,
      fields: { ...(previousMarker?.fields ?? {}), ...fields } };
    data.studioProfile = nextProfile;
    for (const field of Object.keys(fields)) counts.fields[field] = (counts.fields[field] ?? 0) + 1;
    evidence.push({ source: source ? 'local-merchant-sql' : 'explicit-provisional-policy', sourceShopId: sourceId, fields });
    changes.push({ before, data, createTherapists: staff, evidence, futureGuard: guard });
  }
  const updated = new Map(changes.map(change => [String(change.before.id), { ...change.before, ...change.data, therapists: [...change.before.therapists, ...change.createTherapists] }]));
  return { policyId: COMPLETION_POLICY_ID, policy, changes, skipped, counts, before: completionMissingCounts(shops), after: completionMissingCounts(shops.map(shop => updated.get(String(shop.id)) ?? shop)) };
}

function validateChange(change, policy) {
  const { before, data, createTherapists } = change;
  if (Object.keys(data).some(key => !['address', 'city', 'state', 'zipCode', 'timezone', 'businessHours', 'studioProfile'].includes(key))) throw Error('Unexpected completion write field');
  for (const field of ['address', 'city', 'state', 'zipCode', 'timezone']) if (field in data && !missingText(before[field])
    && !(field === 'zipCode' && knownJacksonvilleZipConflict(before) && data.zipCode === policy.zipCode)) throw Error('Completion refuses to overwrite existing ' + field);
  if (createTherapists.length && (before.therapists.some(person => person.isActive) || createTherapists.length !== policy.staffCount
    || createTherapists.some(person => person.scheduleMode !== 'SHOP' || person.isActive !== true))) throw Error('Invalid default personnel changes');
  const { provisionalCompletion, mapShareUrl, mapShareUrlSource, ...kept } = data.studioProfile;
  const { provisionalCompletion: oldMarker, mapShareUrl: oldMap, mapShareUrlSource: oldMapSource, ...oldKept } = before.studioProfile ?? {};
  if (!same(kept, oldKept) || provisionalCompletion?.policyId !== COMPLETION_POLICY_ID) throw Error('Completion refuses unrelated profile changes');
  if (!same(mapShareUrl, oldMap) && (!missingText(oldMap) || !https(mapShareUrl))) throw Error('Completion refuses replacing an existing map');
  if (same(mapShareUrl, oldMap) && !same(mapShareUrlSource, oldMapSource)) throw Error('Completion refuses changing retained map provenance');
}

/** Every writer shares the shop mutex with bookings. Compare the full selected
 * shop+staff preimage after locking, then leave existing personnel, exceptions,
 * accounts, publication, orders and time snapshots untouched. */
export async function applyProvisionalCompletion(target, plan) {
  const policy = checkedCompletionPolicy(plan.policy);
  for (const change of plan.changes) validateChange(change, policy);
  return target.$transaction(async tx => {
    const total = await tx.shop.count(), published = await tx.shop.count({ where: { status: 'APPROVED', deletedAt: null } });
    if (total !== 1335 || published !== 1335) throw Error('Store set/publication changed after planning');
    const created = [];
    for (const change of plan.changes) {
      const { before, data, createTherapists } = change;
      await tx.$queryRaw`SELECT id FROM shops WHERE id = ${before.id} FOR UPDATE`;
      const current = await tx.shop.findUnique({ where: { id: before.id }, select: completionSelect });
      if (!same(current, before)) throw Error('Store ' + before.id + ' or personnel changed after planning; entire transaction rolled back');
      if (data.timezone !== undefined || data.businessHours !== undefined || createTherapists.length) {
        const now = new Date(), futureBookings = await tx.booking.count({ where: { shopId: before.id, deletedAt: null, status: { in: ['PENDING', 'CONFIRMED'] }, endTime: { gt: now } } });
        const activeLocks = await tx.bookingResourceLock.count({ where: { shopId: before.id, status: 'ACTIVE', endAtUtc: { gt: now } } });
        if (futureBookings || activeLocks) throw Error('Store ' + before.id + ' now has future reservations/resources; entire transaction rolled back');
      }
      const result = await tx.shop.updateMany({ where: { id: before.id, updatedAt: before.updatedAt, status: 'APPROVED', deletedAt: null,
        address: before.address, city: before.city, state: before.state, zipCode: before.zipCode, timezone: before.timezone,
        businessHours: { equals: before.businessHours === null ? Prisma.DbNull : before.businessHours },
        studioProfile: { equals: before.studioProfile === null ? Prisma.DbNull : before.studioProfile } }, data });
      if (result.count !== 1) throw Error('Store ' + before.id + ' failed compare-and-set; entire transaction rolled back');
      for (const person of createTherapists) { const row = await tx.therapist.create({ data: { ...person, shopId: before.id } }); created.push({ shopId: String(before.id), id: String(row.id), name: row.name }); }
    }
    return { updatedStores: plan.changes.length, createdTherapists: created };
  }, { maxWait: 30000, timeout: 600000, isolationLevel: 'ReadCommitted' });
}
