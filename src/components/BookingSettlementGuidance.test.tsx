import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import BookingSettlementGuidance from './BookingSettlementGuidance';
const base = { status: 'CANCELLED', paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', totalCents: 8000, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 0 };
test('platform cancelled guidance is historical and introduces no acceptance, collection or refund controls', () => {
  const before = structuredClone(base), html = renderToStaticMarkup(<BookingSettlementGuidance settlements={base} />);
  assert.match(html, /预约已取消/); assert.match(html, /历史账目/); assert.doesNotMatch(html, /先接受|可先接受|<button|<form|<a /);
  assert.deepEqual(base, before);
});
test('platform guidance updates from an independent settlement snapshot rather than stale booking metadata', () => {
  const paid = { ...base, status: 'COMPLETED', paymentStatus: 'PAID', paidCents: 4000, netPaidCents: 4000, amountDueCents: 4000, booking: { status: 'PENDING' } };
  const html = renderToStaticMarkup(<BookingSettlementGuidance settlements={paid} />);
  assert.match(html, /服务已完成/); assert.match(html, /仍有待收余额/); assert.doesNotMatch(html, /预约待接受|先接受/);
});

test('pure order presentation does not require receipts or show financial success while paid history stays explicit', () => {
  const pure = { ...base, orderOnly: true, onlinePaymentEnabled: false, status: 'COMPLETED', amountDueCents: 8000, entries: [] };
  const html = renderToStaticMarkup(<BookingSettlementGuidance settlements={pure} />);
  assert.match(html, /线下处理|不要求先登记收款/); assert.match(html, /不代表已经收款/);
  assert.doesNotMatch(html, /已结清|平台服务费|小费|<button|<form/);
  const history = renderToStaticMarkup(<BookingSettlementGuidance settlements={{ ...pure, paidCents: 4000, netPaidCents: 4000, amountDueCents: 4000, entries: [{ kind: 'RECEIPT' }] }} />);
  assert.match(history, /仍有待收余额/); assert.doesNotMatch(history, /不要求先登记收款/);
});
