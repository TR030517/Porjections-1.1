import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingErrorFields, settingField, settingValueError, settingWriteUncertain, verifiedSetting } from './platformSettings';
import { ApiError, apiRequest, clearSession } from '../api/session';

test('public setting fields have key-specific labels, semantics, limits and stable local errors', () => {
  for (const [key, label, type, maximum] of [['site_name', '站点名称', 'text', 200], ['support_email', '客服邮箱', 'email', 255], ['support_phone', '客服电话', 'tel', 20]] as const) {
    assert.deepEqual([settingField(key).label, settingField(key).type, settingField(key).maxLength], [label, type, maximum]);
  }
  assert.equal(settingValueError('site_name', '  '), 'SITE_NAME_REQUIRED');
  assert.equal(settingValueError('site_name', 'x'.repeat(201)), 'SITE_NAME_TOO_LONG');
  assert.equal(settingValueError('support_email', 'bad@'), 'SUPPORT_EMAIL_INVALID');
  assert.equal(settingValueError('support_phone', '123'), 'SUPPORT_PHONE_INVALID');
  assert.equal(settingValueError('support_phone', '+1234567890123456'), 'SUPPORT_PHONE_INVALID');
  assert.equal(settingValueError('support_phone', 'call 2125550100'), 'SUPPORT_PHONE_INVALID');
  assert.equal(settingValueError('support_email', ''), undefined);
  assert.equal(settingValueError('support_phone', ''), undefined);
  assert.equal(settingValueError('support_email', ' support@example.invalid '), undefined);
  assert.equal(settingValueError('support_phone', '+1 (212) 555-0100'), undefined);
  assert.equal(settingValueError('unknown', 'value'), 'SETTING_NOT_EDITABLE');
});
test('stable setting codes are mapped without matching or exposing arbitrary server prose', () => {
  const fields = settingErrorFields({ code: 'SETTINGS_VALIDATION_FAILED', fieldErrors: { value: 'SUPPORT_EMAIL_INVALID' }, message: 'different deployment language and secret' });
  assert.deepEqual(fields, { value: '客服邮箱格式不正确，如 name@example.com。' });
  assert.equal(settingErrorFields({ message: 'Invalid support email' }), undefined);
  assert.deepEqual(settingErrorFields({ code: 'SETTINGS_VALIDATION_FAILED', fieldErrors: { value: 'unrecognized-code' } }), { value: '此配置值未通过校验，请检查后重试。' });
});
test('top-level and nested validation envelopes become Chinese ApiError field errors, retaining draft ownership', async () => {
  const previous = globalThis.fetch; clearSession();
  try {
    for (const nested of [false, true]) {
      const body = { code: 'SETTINGS_VALIDATION_FAILED', fieldErrors: { value: 'SUPPORT_PHONE_INVALID' }, message: 'Not a stable localized string' };
      globalThis.fetch = async () => Response.json(nested ? { error: body } : body, { status: 400 });
      await assert.rejects(apiRequest('/studio/settings/3', { method: 'PATCH', body: JSON.stringify({ value: '123' }) }), error => error instanceof ApiError && error.status === 400 && error.code === body.code && error.fields?.value === error.message && error.message.startsWith('客服电话'));
    }
  } finally { clearSession(); globalThis.fetch = previous; }
});

test('setting readback verifies the exact public field and distinguishes rejections from unknown writes', () => {
  const expected = { id: '2', key: 'support_email', value: 'support@example.invalid' };
  assert.equal(verifiedSetting({ ...expected, id: 2 }, expected), true);
  for (const item of [null, {}, { ...expected, id: '3' }, { ...expected, key: 'support_phone' }, { ...expected, value: 'other@example.invalid' }, { ...expected, value: null }]) assert.equal(verifiedSetting(item, expected), false);
  assert.equal(verifiedSetting({ id: 2, key: 'support_email', value: 'other@example.invalid' }, { id: '2', key: 'support_email' }), true, 'readback may reveal a different current value without replacing the draft');
  assert.equal(verifiedSetting({ id: 2, key: 'support_email', value: 'legacy-invalid' }, { id: '2', key: 'support_email' }), true, 'readback must show even an invalid legacy value so the administrator can finish review and correct it');
  for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(settingWriteUncertain(new ApiError('Synthetic rejection', status)), false);
  for (const status of [0, 408, 500, 502, 503, 504]) assert.equal(settingWriteUncertain(new ApiError('Synthetic uncertain write', status)), true);
  assert.equal(settingWriteUncertain(new TypeError('Synthetic lost response')), true);
});
