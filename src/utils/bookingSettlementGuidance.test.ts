import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingSettlementGuidance, isSimpleOfflineOrder } from './bookingSettlementGuidance';
const base = { status: 'PENDING', paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', totalCents: 8000, paidCents: 0, refundedCents: 0, netPaidCents: 0, amountDueCents: 8000, allowedActions: { confirm: true, recordReceipt: false } };

test('cancelled reservations never ask for acceptance or new collection, regardless of method and permissions', () => {
  for (const mode of ['PAY_AT_STORE', 'ONLINE']) for (const net of [0, 8000]) {
    const input = { ...base, status: 'CANCELLED', paymentMode: mode, paymentStatus: net ? 'PAID' : 'UNPAID', paidCents: net, netPaidCents: net, amountDueCents: 0 };
    const before = structuredClone(input), view = bookingSettlementGuidance(input);
    assert.equal(view.title, '预约已取消'); assert.match(view.message, /取消预约不会自动退款/);
    assert.doesNotMatch(view.message, /先接受|接受预约不代表|仍有待收余额|如需取消/);
    assert.match(view.message, net ? /仍有净实收/ : /净实收为零/); assert.deepEqual(input, before);
  }
});
test('completed service and a reversed receipt can leave money due without reviving acceptance guidance', () => {
  const view = bookingSettlementGuidance({ ...base, status: 'COMPLETED', allowedActions: { confirm: false, recordReceipt: true } });
  assert.equal(view.title, '服务已完成'); assert.match(view.message, /完成服务不代表已经收齐/); assert.match(view.message, /仍有待收余额/);
  assert.doesNotMatch(view.message, /先接受|预约待接受|已经收齐款项。$/);
});
test('refund lifecycle and payment facts stay separate, including late payment after a released reservation', () => {
  const late = bookingSettlementGuidance({ ...base, status: 'REFUNDING', paymentMode: 'ONLINE', paymentStatus: 'PAID', paidCents: 8000, netPaidCents: 8000, amountDueCents: 0 });
  assert.match(late.message, /不代表款项已退还或到账/); assert.match(late.message, /仍有净实收/); assert.doesNotMatch(late.message, /如需取消|先接受/);
  const refunded = bookingSettlementGuidance({ ...base, status: 'REFUNDED', paymentStatus: 'REFUNDED', paidCents: 8000, refundedCents: 8000, netPaidCents: 0, amountDueCents: 0 });
  assert.equal(refunded.title, '预约标记已退款'); assert.match(refunded.message, /不能单独证明渠道退款已到账/);
});
test('active online guidance avoids offline collection and mentions cancellation only before a terminal state', () => {
  const confirmed = bookingSettlementGuidance({ ...base, status: 'CONFIRMED', paymentMode: 'ONLINE', paymentStatus: 'PAID', paidCents: 8000, netPaidCents: 8000, amountDueCents: 0 });
  assert.match(confirmed.message, /不能混记线下收款/); assert.match(confirmed.message, /如需取消已付款预约/);
  const completed = bookingSettlementGuidance({ ...base, status: 'COMPLETED', paymentMode: 'ONLINE', paymentStatus: 'PAID', paidCents: 8000, netPaidCents: 8000, amountDueCents: 0 });
  assert.doesNotMatch(completed.message, /如需取消/);
});
test('zero mode describes only a consistent server-issued zero settlement and keeps cancellation historical', () => {
  const zero = { ...base, status: 'CANCELLED', paymentMode: 'ZERO', paymentStatus: 'PAID', totalCents: 0, amountDueCents: 0 };
  assert.match(bookingSettlementGuidance(zero).message, /不产生外部付款或可退款资金/);
  for (const patch of [{ totalCents: 1 }, { paidCents: 1 }, { paymentStatus: 'UNPAID' }]) assert.match(bookingSettlementGuidance({ ...zero, ...patch }).message, /核对/);
});
test('missing or contradictory values stay unknown and never borrow a nested stale booking status', () => {
  for (const input of [undefined, {}, { ...base, status: 'UNKNOWN' }, { ...base, paymentMode: 'OTHER' }]) assert.equal(bookingSettlementGuidance(input).title, '结算状态待核对');
  for (const patch of [{ paidCents: '0' }, { netPaidCents: -1 }, { refundedCents: 1 }, { amountDueCents: undefined }, { totalCents: 9007199254740992 }]) assert.match(bookingSettlementGuidance({ ...base, ...patch }).message, /金额记录暂无法核对/);
  assert.equal(bookingSettlementGuidance({ ...base, status: 'CANCELLED', booking: { status: 'PENDING' }, allowedActions: { confirm: true } }).title, '预约已取消');
});
test('action denials do not invent a reason or change the snapshot, and pending wording does not claim live resources', () => {
  for (const allowedActions of [{ confirm: false, recordReceipt: false }, { confirm: true, recordReceipt: true }, undefined]) {
    const input = { ...base, allowedActions }, before = structuredClone(input), view = bookingSettlementGuidance(input);
    assert.equal(view.title, '预约待接受'); assert.match(view.message, /接受预约不代表已经收到/);
    assert.doesNotMatch(view.message, /权限不足|已过期|已释放|已保留实际资源/); assert.deepEqual(input, before);
  }
});

test('explicit order-only unpaid orders have a fulfilment explanation with optional ledger, without making a paid claim or deriving permissions', () => {
  for (const status of ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']) {
    const input = { ...base, orderOnly: true, onlinePaymentEnabled: false, status, entries: [], amountDueCents: status === 'CANCELLED' ? 0 : 8000,
      platformFeeCents: 0, tipCents: 0, allowedActions: { confirm: false, complete: false, recordReceipt: false } }, before = structuredClone(input);
    assert.equal(isSimpleOfflineOrder(input), true); const view = bookingSettlementGuidance(input);
    assert.match(view.message, /线下处理/); assert.doesNotMatch(view.message, /待收余额|已经收齐|登记收款后|权限不足|付款超时/);
    if (status !== 'CANCELLED') assert.match(view.message, /不要求先登记收款/);
    if (status === 'COMPLETED') assert.match(view.message, /不代表已经收款/);
    assert.deepEqual(input, before);
  }
});

test('the global flag never hides real receipts, refunds, zero/online history, missing evidence or nonzero historical fee/tip', () => {
  const pure = { ...base, orderOnly: true, onlinePaymentEnabled: false, entries: [] };
  for (const patch of [{ orderOnly: undefined }, { onlinePaymentEnabled: true }, { entries: undefined }, { entries: [{ kind: 'REVERSAL' }] },
    { paymentMode: 'ONLINE' }, { paymentMode: 'ZERO' }, { paidCents: 1, netPaidCents: 1 }, { refundedCents: 1 }, { paymentStatus: 'PAID' },
    { tipCents: 500 }, { platformFeeCents: 500 }, { amountDueCents: undefined }, { status: 'REFUNDING' }]) assert.equal(isSimpleOfflineOrder({ ...pure, ...patch }), false);
  const history = { ...pure, paidCents: 4000, netPaidCents: 4000, amountDueCents: 4000, entries: [{ kind: 'RECEIPT' }], status: 'COMPLETED' };
  assert.match(bookingSettlementGuidance(history).message, /仍有待收余额/);
  assert.doesNotMatch(bookingSettlementGuidance(history).message, /不要求先登记收款/);
});
