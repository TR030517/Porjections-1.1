import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disposableOrigin, validateSecrets, syntheticPng, runPhase5Http } from './phase5-http-integration.mjs';

function fixture() {
  return { schemaVersion: 1, environmentMarker: 'PHASE5_SYNTHETIC_ONLY', target: 'http://127.0.0.1:53284', runId: '11111111-2222-4333-8444-555555555555',
    ...Object.fromEntries(['admin', 'merchant', 'customer', 'outsider', 'staff'].map(name => [name, { email: `p5-${name}-abcdef12@example.invalid`, password: 'synthetic-password-only' }])),
    fixture: { shopId: '1', serviceId: '2', secondServiceId: '3', variantId: '4', giftProductId: '5', couponWalletId: '6', pastBookingId: '7', customerId: '8',
      therapistIds: ['9', '10'], date: '2030-01-02', unitPriceCents: 3500, secondPriceCents: 2000, giftPriceCents: 4000 } };
}
test('target guard accepts only an explicit disposable IPv4 loopback origin and rejects existing preview ports', () => {
  assert.equal(disposableOrigin('http://127.0.0.1:53284'), 'http://127.0.0.1:53284');
  for (const value of ['http://127.0.0.1:8088', 'http://127.0.0.1:8002', 'http://127.0.0.1:3310', 'http://localhost:53284', 'https://127.0.0.1:53284', 'http://127.0.0.1', 'http://example.invalid:53284', 'http://user:pass@127.0.0.1:53284', 'http://127.0.0.1:53284/admin/', 'http://127.0.0.1:53284/?x=y', 'http://127.0.0.1:53284/#x']) assert.throws(() => disposableOrigin(value));
});
test('secret fixture must name the same target, marker, synthetic accounts and two distinct therapists', () => {
  const valid = fixture(); assert.equal(validateSecrets(valid, valid.target), valid);
  for (const mutate of [v => v.target = 'http://127.0.0.1:53285', v => v.environmentMarker = 'OTHER', v => v.customer.email = 'customer@example.com', v => v.fixture.therapistIds = ['9', '9'], v => v.fixture.unitPriceCents = 0]) {
    const invalid = structuredClone(valid); mutate(invalid); assert.throws(() => validateSecrets(invalid, valid.target));
  }
});
test('missing acknowledgement rejects before fetching, reading credentials or writing a report', async () => {
  await assert.rejects(runPhase5Http({ target: 'http://127.0.0.1:53284', secrets: fixture() }), { code: 'DISPOSABLE_TARGET_ACK_REQUIRED' });
});
test('existing live preview is rejected even with synthetic acknowledgement', async () => {
  await assert.rejects(runPhase5Http({ target: 'http://127.0.0.1:8088', secrets: fixture(), acknowledge: 'PHASE5_SYNTHETIC_ONLY' }), { code: 'TARGET_REJECTED' });
});
test('new attempt must match its privately prepared fixture before any HTTP access', async () => {
  const secrets = fixture(); secrets.attemptKey = 'final';
  await assert.rejects(runPhase5Http({ target: secrets.target, secrets, acknowledge: 'PHASE5_SYNTHETIC_ONLY', attemptKey: 'different' }), { code: 'ATTEMPT_SECRET_MISMATCH' });
  const invalid = fixture(); invalid.attemptKey = 'bad/path'; assert.throws(() => validateSecrets(invalid, invalid.target), { code: 'INVALID_ATTEMPT_KEY' });
});
test('synthetic upload is a deterministic bounded RGBA PNG with valid dimensions and no external image dependency', () => {
  const bytes = syntheticPng(); assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(bytes.readUInt32BE(16), 4); assert.equal(bytes.readUInt32BE(20), 4); assert.ok(bytes.length < 1024);
  assert.deepEqual(bytes, syntheticPng()); assert.equal(bytes.subarray(-8, -4).toString(), 'IEND');
});
