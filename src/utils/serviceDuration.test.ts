import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeReservationService, normalizeSavedBooking, normalizeServiceDuration, readServiceDurationKind, serviceKindDraftChange } from './serviceDuration';
import { buildOperationPayload } from './operationForm';
import { operations } from '../config/operations';

test('read metadata accepts old missing kinds but rejects explicit null, unknown and conflicting aliases', () => {
  assert.equal(readServiceDurationKind(undefined), 'TIMED');
  for (const kind of [null, '', 'MIXED', 'ADD_ON', true]) assert.throws(() => readServiceDurationKind(kind));
  assert.equal(normalizeServiceDuration({ durationMinutes: 60 }).durationMin, 60);
  for (const patch of [{ durationKind: null }, { reservedDurationMin: null }, { reservedDurationMin: 90 }, { durationMinutes: 90 }, { durationMin: '60' }]) {
    assert.throws(() => normalizeServiceDuration({ durationMin: 60, ...patch }));
  }
});

test('a specification inherits its exact parent kind and retains independent reservation blocks', () => {
  const value = { durationKind: 'PER_SESSION', durationMin: 90, reservedDurationMin: 90, variants: [{ durationMin: 30 }, { durationMin: 120, durationKind: 'PER_SESSION', reservedDurationMin: 120 }] };
  const result = normalizeReservationService(value);
  assert.equal(result.durationKind, 'PER_SESSION');
  assert.deepEqual(result.variants.map(item => [item.durationKind, item.reservedDurationMin]), [['PER_SESSION', 30], ['PER_SESSION', 120]]);
  for (const durationKind of ['VARIABLE', 'TIMED', null]) assert.throws(() => normalizeReservationService({ ...value, variants: [{ durationMin: 30, durationKind }] }));
  assert.equal(Object.hasOwn(value.variants[0], 'durationKind'), false);
});

test('changing a new draft to a session/variable kind clears implicit terms while existing edits retain actual configured values', () => {
  const old = { durationKind: 'TIMED', category: 'MASSAGE', durationMin: 60, price: 80, priceCents: 8000 };
  for (const kind of ['PER_SESSION', 'VARIABLE']) {
    const fresh = { ...old, ...serviceKindDraftChange(kind, false) };
    assert.equal(fresh.durationKind, kind); assert.equal(fresh.category, undefined); assert.equal(fresh.durationMin, null); assert.equal(fresh.price, null); assert.equal(fresh.priceCents, null);
    assert.deepEqual({ ...old, ...serviceKindDraftChange(kind, true) }, { ...old, durationKind: kind });
  }
  assert.deepEqual(serviceKindDraftChange('TIMED', false), { durationKind: 'TIMED' });
});

test('saved order metadata ignores changed live services and derives mixed from all frozen items', () => {
  const value = { durationMin: 130, reservedDurationMin: 130, durationKind: 'MIXED', service: { durationKind: 'TIMED', durationMin: 240 }, items: [
    { durationMin: 60, durationKindSnapshot: 'PER_SESSION', service: { durationKind: 'VARIABLE' } },
    { durationMin: 30, durationKindSnapshot: 'TIMED' }, { durationMin: 40, durationKindSnapshot: 'VARIABLE' },
  ] };
  const before = structuredClone(value), result = normalizeSavedBooking(value);
  assert.equal(result.durationKind, 'MIXED'); assert.equal(result.reservedDurationMin, 130);
  assert.deepEqual(result.items.map(item => item.durationKind), ['PER_SESSION', 'TIMED', 'VARIABLE']);
  assert.deepEqual(value, before);
  assert.equal(normalizeSavedBooking({ durationMin: 60, items: [], service: { durationKind: 'VARIABLE' } }).durationKind, 'TIMED');
  assert.throws(() => normalizeSavedBooking({ ...value, durationKind: 'PER_SESSION' }));
  assert.throws(() => normalizeSavedBooking({ ...value, items: [{ durationMin: 60, durationKindSnapshot: 'PER_SESSION', durationKind: 'TIMED' }] }));
});

test('platform service form saves only the selected kind and manual five-through-240-minute block', () => {
  const config = operations.services;
  const payload = buildOperationPayload(config.fields!, { shopId: '5', name: 'Synthetic session', category: 'OTHER', durationKind: 'PER_SESSION', durationMin: '240', priceCents: '8000', description: '', isActive: false, reservedDurationMin: 999 }, false);
  assert.equal(payload.durationKind, 'PER_SESSION'); assert.equal(payload.durationMin, 240);
  assert.equal(Object.hasOwn(payload, 'reservedDurationMin'), false); assert.equal(Object.hasOwn(payload, 'durationMinutes'), false);
  for (const durationMin of ['5', '15', '29', '240']) assert.equal(buildOperationPayload(config.fields!, { ...payload, durationMin }, false).durationMin, Number(durationMin));
  for (const durationMin of ['', '0', '4', '241']) assert.throws(() => buildOperationPayload(config.fields!, { ...payload, durationMin }, false));
  assert.throws(() => buildOperationPayload(config.fields!, { ...payload, durationKind: 'ADD_ON' }, false));
});
