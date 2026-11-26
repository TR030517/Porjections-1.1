import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

test('booking command keys reach all mutation routes and malformed receipts stay uncertain', async () => {
  const oldAdapter = axios.defaults.adapter, calls = [];
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const summary = { bookingId: '42', shopId: '5', paymentMode: 'PAY_AT_STORE', currency: 'usd', totalCents: 100, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 100, allowedActions: { confirm: true, complete: false, cancel: true, recordReceipt: true, recordRefund: false }, entries: [] };
  const key = 'synthetic-operation-key-001'; let invalid = false;
  axios.defaults.adapter = async config => {
    calls.push(config);
    const status = config.url.endsWith('/cancel') ? 'CANCELLED' : config.url.endsWith('/complete') ? 'COMPLETED' : 'CONFIRMED';
    return { config, data: config.url.includes('offline-') ? summary : invalid ? { id: '99', status } : { id: '42', status, localDate: '2035-11-08', localStartTime: '10:00' }, status: 200, statusText: 'OK', headers: {} };
  };
  try {
    const api = await server.ssrLoadModule('/src/api/bookings.ts'), merchant = await server.ssrLoadModule('/src/api/merchant.ts');
    const input = { requestKey: 'synthetic-ledger-key-001', amountCents: 100, method: 'CASH', occurredAt: '2035-11-08T18:00:00Z', reason: 'Synthetic test' };
    await merchant.confirmBooking('42', key); await merchant.completeBooking('42', key); await api.cancelBooking('42', key);
    await api.rescheduleBooking('42', { date: '2035-11-08', startTime: '10:00' }, key);
    await api.recordOfflineReceipt('42', '5', input, key); await api.recordOfflineRefund('42', '5', input, key);
    await api.reverseOfflineReceipt('42', '5', 'synthetic-entry', { requestKey: input.requestKey, reason: input.reason }, key);
    assert.equal(calls.length, 7);
    assert.ok(calls.every(call => call.headers.get('Idempotency-Key') === key));
    assert.equal(JSON.parse(calls[4].data).requestKey, input.requestKey, 'ledger idempotency key is retained as well');
    invalid = true;
    await assert.rejects(() => api.cancelBooking('42', key), /回执/);
    await assert.rejects(() => merchant.confirmBooking('42', key), /回执/);
    await assert.rejects(() => merchant.completeBooking('42', key), /回执/);
    await assert.rejects(() => api.rescheduleBooking('42', { date: '2035-11-08', startTime: '10:00' }, key), /回执/);
  } finally { axios.defaults.adapter = oldAdapter; await server.close(); }
});

test('reconciliation accepts only this order, shop, key and terminal action', async () => {
  const oldAdapter = axios.defaults.adapter;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const attempt = { requestKey: 'synthetic-operation-key-001', action: 'STATUS:CANCELLED' };
  let response = { bookingId: '42', shopId: '5', requestKey: attempt.requestKey, outcome: 'COMMITTED', action: attempt.action };
  axios.defaults.adapter = async config => {
    assert.equal(config.url, '/bookings/42/operations/' + attempt.requestKey + '/reconcile');
    return { config, data: response, status: 200, statusText: 'OK', headers: {} };
  };
  try {
    const { reconcileBookingOperation } = await server.ssrLoadModule('/src/api/bookingOperations.ts');
    assert.equal((await reconcileBookingOperation('42', '5', attempt)).outcome, 'COMMITTED');
    const valid = { ...response };
    for (const patch of [{ bookingId: '99' }, { shopId: '6' }, { requestKey: 'different-request' }, { action: 'STATUS:COMPLETED' }, { outcome: 'PENDING' }, { outcome: 'NOT_EXECUTED' }]) {
      response = { ...valid, ...patch }; await assert.rejects(() => reconcileBookingOperation('42', '5', attempt), /核对/);
    }
    response = { ...valid, outcome: 'NOT_EXECUTED', action: null };
    assert.equal((await reconcileBookingOperation('42', '5', attempt)).outcome, 'NOT_EXECUTED');
  } finally { axios.defaults.adapter = oldAdapter; await server.close(); }
});
