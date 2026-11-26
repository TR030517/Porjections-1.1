import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingOperationHeaders, reconcileBookingOperation } from './bookingOperations';
import { rescheduleBooking } from './bookingDetails';
import { recordOfflineReceipt, recordOfflineRefund, reverseOfflineReceipt } from './bookingSettlements';

const key = 'synthetic-operation-request-001';
const receipt = { bookingId: '9007199254740993', shopId: '5', requestKey: key, outcome: 'COMMITTED', action: 'RESCHEDULE' };
test('operation recovery uses the exact order and request key and validates every receipt identity field', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `/api/v1/bookings/9007199254740993/operations/${key}/reconcile`);
      assert.equal(options?.method, 'POST'); assert.equal(options?.body, undefined);
      return Response.json(receipt);
    };
    assert.deepEqual(await reconcileBookingOperation(receipt.bookingId, '5', key, 'RESCHEDULE'), receipt);
    for (const changed of [{ bookingId: '9' }, { shopId: '6' }, { requestKey: 'different-request' }, { outcome: 'PENDING' }, { action: 'STATUS:CANCELLED' }, { action: null }, { outcome: 'NOT_EXECUTED', action: 'RESCHEDULE' }]) {
      globalThis.fetch = async () => Response.json({ ...receipt, ...changed });
      await assert.rejects(reconcileBookingOperation(receipt.bookingId, '5', key, 'RESCHEDULE'), /核对回执不匹配/);
    }
    globalThis.fetch = async () => Response.json({ ...receipt, outcome: 'NOT_EXECUTED', action: null });
    assert.equal((await reconcileBookingOperation(receipt.bookingId, '5', key, 'RESCHEDULE')).outcome, 'NOT_EXECUTED');
  } finally { globalThis.fetch = original; }
});

test('invalid operation keys never reach the network and legacy callers send no key', async () => {
  let calls = 0; const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return Response.json(receipt); };
  try {
    assert.equal(bookingOperationHeaders(), undefined);
    for (const value of ['', 'short', 'bad/request-key', 'x'.repeat(101)]) {
      await assert.rejects(reconcileBookingOperation(receipt.bookingId, '5', value, 'RESCHEDULE'), /操作编号无效/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('reschedule and offline ledger writes preserve their command while carrying the matching operation header', async () => {
  const original = globalThis.fetch, seen: string[] = [];
  const summary = { bookingId: '42', shopId: '5', paymentMode: 'PAY_AT_STORE', currency: 'USD', totalCents: 100, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 100, entries: [], allowedActions: { confirm: false, complete: false, cancel: false, recordReceipt: true, recordRefund: false } };
  const payload = { requestKey: 'ledger-body-key-001', amountCents: 100, method: 'CASH' as const, occurredAt: '2030-01-01T12:00:00Z', reason: 'Synthetic cash evidence' };
  globalThis.fetch = async (url, options) => {
    seen.push(String(url)); assert.equal(new Headers(options?.headers).get('Idempotency-Key'), key);
    if (String(url).endsWith('/reschedule')) { assert.deepEqual(JSON.parse(String(options?.body)), { date: '2030-01-01', startTime: '10:00' }); return Response.json({ id: '42', items: [], durationMin: 60 }); }
    const body = JSON.parse(String(options?.body)); assert.equal(body.requestKey, payload.requestKey);
    assert.equal(body.reason, payload.reason); return Response.json(summary);
  };
  try {
    await rescheduleBooking('42', { date: '2030-01-01', startTime: '10:00' }, key);
    await recordOfflineReceipt('42', payload, key); await recordOfflineRefund('42', payload, key);
    await reverseOfflineReceipt('42', 'entry-id', { requestKey: payload.requestKey, reason: payload.reason }, key);
    assert.equal(seen.length, 4);
  } finally { globalThis.fetch = original; }
});
