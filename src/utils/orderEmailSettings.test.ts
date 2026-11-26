import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderEmailOperationMatches, orderEmailRecovery, orderEmailSettingsSummary, readOrderEmailSettings, uncertainOrderEmailWrite, type OrderEmailSettingsView } from './orderEmailSettings';

const id = '04ee65f8-062e-44db-889b-660bec285c91';
function view(): OrderEmailSettingsView { return { shopId: '5', revision: 0, state: 'LEGACY_UNVERIFIED', recipient: null, verifiedAt: null, legacyCandidate: 'public@example.test', pending: null, delivery: { configured: true, mode: 'PROVIDER', workerEnabled: true, reasonCode: null } }; }
test('a syntactically valid legacy/public email is never shown as verified or ready', () => {
  const saved = readOrderEmailSettings(view(), '5'), summary = orderEmailSettingsSummary(saved);
  assert.equal(summary.level, 'warning'); assert.match(summary.title, /尚未验证/); assert.match(summary.detail, /订单仍保存在后台/);
  for (const field of ['recipient', 'verifiedAt', 'pending', 'delivery']) { const partial = structuredClone(saved) as any; delete partial[field]; assert.throws(() => readOrderEmailSettings(partial, '5')); }
});
test('verified display requires consistent ownership proof, explicit recipient, full transport state and exact shop', () => {
  const saved = { ...view(), state: 'VERIFIED' as const, recipient: 'private@example.test', verifiedAt: '2026-11-18T00:00:00.000Z' };
  assert.equal(orderEmailSettingsSummary(readOrderEmailSettings(saved, '5')).level, 'ready');
  for (const broken of [{ ...saved, verifiedAt: null }, { ...saved, recipient: null }, { ...saved, state: 'MISSING' }, { ...saved, shopId: '6' }, { ...saved, revision: 1.5 }, { ...saved, delivery: { ...saved.delivery, mode: null } }]) assert.throws(() => readOrderEmailSettings(broken, '5'));
});
test('local capture, stopped worker and absent sender never claim real delivery readiness', () => {
  const saved = { ...view(), state: 'VERIFIED' as const, recipient: 'private@example.test', verifiedAt: '2026-11-18T00:00:00.000Z' };
  const local = orderEmailSettingsSummary({ ...saved, delivery: { ...saved.delivery, mode: 'LOCAL_CAPTURE' } });
  assert.equal(local.level, 'warning'); assert.match(local.detail, /不会发送到真实邮箱/);
  for (const delivery of [{ ...saved.delivery, workerEnabled: false }, { ...saved.delivery, configured: false }]) { const state = orderEmailSettingsSummary({ ...saved, delivery }); assert.equal(state.level, 'warning'); assert.match(state.detail, /订单仍保存在后台/); }
});
test('request receipts bind the exact UUID, normalized recipient and next revision', () => {
  const request = { kind: 'request' as const, revision: 0, requestId: id, email: 'private@example.test' };
  const sent = { ...view(), revision: 1, pending: { challengeId: id, email: request.email, expiresAt: '2026-11-18T00:10:00Z', deliveryState: 'SENT' as const, attemptsRemaining: 5 } };
  assert.equal(orderEmailOperationMatches(readOrderEmailSettings(sent, '5'), request), true);
  assert.equal(orderEmailOperationMatches({ ...sent, pending: { ...sent.pending, email: 'other@example.test' } }, request), false);
  assert.equal(orderEmailOperationMatches({ ...sent, revision: 2 }, request), false);
  assert.throws(() => readOrderEmailSettings({ ...sent, pending: { ...sent.pending, attemptsRemaining: 6 } }, '5'));
});
test('old-revision reads keep uncertain writes locked; later CAS revisions never replay them', () => {
  const operation = { kind: 'verify' as const, revision: 1, email: 'private@example.test', challengeId: id };
  assert.equal(orderEmailRecovery({ ...view(), revision: 1 }, operation), 'UNRESOLVED');
  assert.equal(orderEmailRecovery({ ...view(), revision: 2, state: 'VERIFIED', recipient: operation.email, verifiedAt: '2026-11-18T00:00:00Z' }, operation), 'MATCHED');
  assert.equal(orderEmailRecovery({ ...view(), revision: 3, state: 'DISABLED' }, operation), 'CHANGED');
  assert.equal(orderEmailOperationMatches({ ...view(), revision: 2, state: 'DISABLED' }, { kind: 'disable', revision: 1 }), true);
});
test('transport failures and malformed acknowledgements stay uncertain, definite refusals may be reviewed without retry', () => {
  for (const error of [new TypeError('Synthetic network'), new Error('Invalid receipt'), { status: 408 }, { response: { status: 503 } }]) assert.equal(uncertainOrderEmailWrite(error), true);
  for (const status of [400, 401, 403, 409, 429]) assert.equal(uncertainOrderEmailWrite({ status }), false);
});
