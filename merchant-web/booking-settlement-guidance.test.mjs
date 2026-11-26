import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, BookingSettlementGuidanceView, bookingSettlementGuidance;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('./', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  ({ BookingSettlementGuidanceView } = await server.ssrLoadModule('/src/components/BookingDetails.tsx'));
  const shared = '/@fs/' + fileURLToPath(new URL('../src/utils/bookingSettlementGuidance.ts', import.meta.url)).replaceAll('\\', '/');
  ({ bookingSettlementGuidance } = await server.ssrLoadModule(shared));
});
after(async () => { await server?.close(); });

const noActions = { confirm: false, complete: false, cancel: false, recordReceipt: false, recordRefund: false };
const settlement = patch => ({ bookingId: '42', shopId: '2', status: 'PENDING', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', currency: 'usd',
  totalCents: 10000, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 10000, allowedActions: { ...noActions, confirm: true, cancel: true }, entries: [], ...patch });
const render = (value, permissions = {}) => {
  const original = structuredClone(value), guidance = bookingSettlementGuidance(value, permissions);
  const html = renderToStaticMarkup(createElement(BookingSettlementGuidanceView, { settlements: value, ...permissions }));
  const text = html.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  assert.match(html, /<h5[^>]*>订单处理说明<\/h5>/);
  assert.ok(text.includes(guidance.title)); assert.ok(text.includes(guidance.message));
  assert.doesNotMatch(html, /<button\b|<form\b|<input\b|<a\b/, 'the explanation component cannot introduce an action or payment link');
  assert.deepEqual(value, original, 'display must not modify server status, money or allowed actions');
  return text;
};

test('cancelled unpaid pay-at-store bookings no longer invite acceptance or collection', () => {
  const text = render(settlement({ status: 'CANCELLED', amountDueCents: 0, allowedActions: noActions }));
  assert.match(text, /取消/);
  assert.doesNotMatch(text, /请先接受|接受预约再登记|请登记收款|取消已付款预约前/);
});

test('cancelled bookings with remaining net receipts do not turn zero due into a refund or settlement claim', () => {
  const text = render(settlement({ status: 'CANCELLED', paymentStatus: 'PAID', paidCents: 10000, netPaidCents: 10000, amountDueCents: 0, allowedActions: noActions }));
  assert.match(text, /取消/); assert.match(text, /净收款|实收|结算|售后/);
  assert.doesNotMatch(text, /已结清|已全部退款|已退款到账|请先接受|请登记收款/);
});

test('completed service with a corrected receipt stays completed without claiming its balance is paid', () => {
  const text = render(settlement({ status: 'COMPLETED', paidCents: 3000, netPaidCents: 3000, amountDueCents: 7000, allowedActions: noActions }));
  assert.match(text, /完成/); assert.match(text, /核对|待收|未结清|余额/);
  assert.doesNotMatch(text, /请先接受|接受预约再登记|已结清|已全部收款/);
});

test('confirmed partial receipts are explained separately from accepting an appointment', () => {
  const text = render(settlement({ status: 'CONFIRMED', paidCents: 4000, netPaidCents: 4000, amountDueCents: 6000,
    allowedActions: { ...noActions, recordReceipt: true, recordRefund: true } }));
  assert.match(text, /确认/); assert.match(text, /待收|余额|未收|核对/);
  assert.doesNotMatch(text, /请先接受|接受预约再登记|已结清|已全部收款/);
});

test('refunding with a paid payment status does not assert provider completion or repeat a cancellation instruction', () => {
  const text = render(settlement({ status: 'REFUNDING', paymentStatus: 'PAID', paymentMode: 'ONLINE', paidCents: 10000, netPaidCents: 10000,
    amountDueCents: 0, allowedActions: noActions }));
  assert.match(text, /退款/); assert.match(text, /核对|渠道|售后/);
  assert.doesNotMatch(text, /请先接受|接受预约再登记|请登记收款|取消已付款预约前|已退款到账|退款已到账/);
});

test('fully refunded and completed bookings do not revive acceptance or cancellation guidance', () => {
  for (const status of ['REFUNDED', 'COMPLETED']) {
    const text = render(settlement({ status, paymentStatus: 'REFUNDED', paymentMode: 'ONLINE', paidCents: 10000, refundedCents: 10000,
      netPaidCents: 0, amountDueCents: 0, allowedActions: noActions }));
    assert.match(text, /退款|已退/);
    assert.doesNotMatch(text, /请先接受|接受预约再登记|请登记收款|取消已付款预约前/);
  }
});

test('zero settlement and absent data cannot introduce an external collection or refund action', () => {
  const zero = render(settlement({ status: 'CONFIRMED', paymentStatus: 'PAID', paymentMode: 'ZERO', totalCents: 0, amountDueCents: 0,
    allowedActions: { ...noActions, complete: true, cancel: true } }));
  assert.match(zero, /零金额|零额/);
  assert.doesNotMatch(zero, /请先接受|接受预约再登记|请登记收款/);
  const unknown = render(null);
  assert.match(unknown, /核对|刷新|读取/);
  assert.doesNotMatch(unknown, /请先接受|接受预约再登记|请登记收款/);
});

test('read-only guidance keeps booking and payment facts without proposing unavailable actions', () => {
  const permissions = { canManageBooking: false, canRecordSettlement: false };
  const simple = settlement({ orderOnly: true, onlinePaymentEnabled: false });
  const offline = render(simple, permissions);
  assert.match(offline, /等待门店确认预约.*线下处理/);
  assert.doesNotMatch(offline, /确认或完成服务|可使用可选账本/);
  assert.match(render(simple, { ...permissions, canRecordSettlement: true }), /可使用可选账本/);

  const online = render(settlement({ status: 'CONFIRMED', paymentStatus: 'PAID', paymentMode: 'ONLINE', paidCents: 10000, netPaidCents: 10000, amountDueCents: 0 }), permissions);
  assert.match(online, /预约已确认.*在线款项以渠道和服务端账本为准/);
  assert.doesNotMatch(online, /如需取消已付款预约/);
});

test('new offline orders use the same simple fulfilment guidance while real collection history stays visible', () => {
  const simple = render(settlement({ orderOnly: true, onlinePaymentEnabled: false, status: 'COMPLETED' }));
  assert.match(simple, /线下处理/); assert.match(simple, /不要求先登记收款/); assert.match(simple, /不代表已经收款/);
  assert.doesNotMatch(simple, /仍有待收余额|已全部收款/);
  const historical = render(settlement({ orderOnly: true, onlinePaymentEnabled: false, status: 'COMPLETED', paidCents: 3000,
    netPaidCents: 3000, amountDueCents: 7000, entries: [{ kind: 'RECEIPT' }] }));
  assert.match(historical, /仍有待收余额/); assert.doesNotMatch(historical, /不要求先登记收款/);
});
