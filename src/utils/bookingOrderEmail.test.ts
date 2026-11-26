import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingOrderEmailMessage, bookingOrderEmailReasonMessage, OrderEmailReadFence, orderEmailPath, readBookingOrderEmail } from './bookingOrderEmail';
const response = (status = 'ACCEPTED') => ({ bookingId: '42', channel: 'EMAIL', status,
  configuration: { enabled: true, provider: 'resend', workerEnabled: true, acceptanceIsDelivery: false }, tasks: [], recipient: 'must-not-be-displayed@example.test', rawData: 'private' });
test('guest mail absence is intentional and distinct from delivery failure or verified ownership', () => {
  for (const code of ['ORDER_EMAIL_GUEST_NO_ADDRESS', 'ORDER_EMAIL_GUEST_AUTHORIZATION_REQUIRED']) {
    const view = readBookingOrderEmail({ ...response('NOT_REQUESTED'), statusReasonCode: code }, '42');
    assert.equal(view.statusReasonCode, code);
    assert.match(bookingOrderEmailReasonMessage(code, view.status)!, /未填写邮箱|尚未验证/);
    assert.doesNotMatch(bookingOrderEmailReasonMessage(code, view.status)!, /已发送|发送失败|已送达/);
    assert.equal(bookingOrderEmailReasonMessage(code, view.status, 'SHOP'), undefined);
  }
});
test('mail status whitelist binds the exact order and keeps recipients and raw transport fields out of UI state', () => {
  assert.equal(orderEmailPath('9007199254740993'), '/notifications/bookings/9007199254740993/order-email');
  assert.deepEqual(readBookingOrderEmail(response(), '42'), { bookingId: '42', status: 'ACCEPTED', workerEnabled: true });
  for (const id of ['0', '01', '42/other', '9223372036854775808']) assert.throws(() => orderEmailPath(id));
  for (const patch of [{ bookingId: '43' }, { bookingId: 42 }, { channel: 'SMS' }, { status: 'DELIVERED' },
    { configuration: { ...response().configuration, acceptanceIsDelivery: true } }, { tasks: null }]) assert.throws(() => readBookingOrderEmail({ ...response(), ...patch }, '42'));
});
test('accepted, unconfigured, unknown acceptance and unknown transport never claim confirmed delivery or invite resending', () => {
  assert.match(bookingOrderEmailMessage('ACCEPTED'), /已受理/); assert.match(bookingOrderEmailMessage('ACCEPTED'), /不代表.*收到/);
  assert.match(bookingOrderEmailMessage('NOT_CONFIGURED'), /尚未配置/); assert.match(bookingOrderEmailMessage('ACCEPTANCE_UNKNOWN'), /暂不确定/);
  assert.match(bookingOrderEmailMessage(), /暂无法核对/); assert.doesNotMatch(bookingOrderEmailMessage(), /已发送|已送达/);
  assert.match(bookingOrderEmailMessage('QUEUED',false), /处理器未启动.*不会自动发送/);
  assert.match(bookingOrderEmailMessage('ACCEPTED',false), /已受理.*不代表/);
});

test('local capture is explicitly labeled without implying delivery to the customer', () => {
  const raw = response(); raw.configuration = { ...raw.configuration, provider: 'local', deliveryMode: 'LOCAL_CAPTURE' } as any;
  assert.equal(readBookingOrderEmail(raw, '42').localCapture, true);
  assert.match(bookingOrderEmailMessage('ACCEPTED', true, true), /本地验收文件.*未向客人外发/);
  assert.match(bookingOrderEmailMessage('QUEUED', false, true), /处理器未启动.*未向客人外发/);
  raw.configuration = { ...raw.configuration, deliveryMode: 'PROVIDER' } as any;
  assert.throws(() => readBookingOrderEmail(raw, '42'));
});
test('late order/actor reads, overwritten refreshes and reads after unmount are rejected', () => {
  const fence = new OrderEmailReadFence(); fence.setScope('actorA:shop1:42'); const first = fence.begin();
  assert.equal(fence.current(first), true); fence.setScope('actorA:shop1:43'); assert.equal(fence.current(first), false);
  const second = fence.begin(); fence.setScope('actorB:shop1:43'); assert.equal(fence.current(second), false);
  const oldRefresh = fence.begin(), latest = fence.begin(); assert.equal(fence.current(oldRefresh), false); assert.equal(fence.current(latest), true);
  fence.invalidate(); assert.equal(fence.current(latest), false);
});
