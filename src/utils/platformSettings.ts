import type { OperationField } from '../config/operations';

export const SETTING_ERROR_MESSAGES: Record<string, string> = {
  SITE_NAME_REQUIRED: '请填写站点名称。',
  SITE_NAME_TOO_LONG: '站点名称不能超过 200 个字符。',
  SUPPORT_EMAIL_INVALID: '客服邮箱格式不正确，如 name@example.com。',
  SUPPORT_EMAIL_TOO_LONG: '客服邮箱不能超过 255 个字符。',
  SUPPORT_PHONE_INVALID: '客服电话请填写 7–15 位数字，可使用 +、空格、括号、点或横线。',
  SUPPORT_PHONE_TOO_LONG: '客服电话不能超过 20 个字符。',
  SETTING_VALUE_INVALID: '请填写有效的配置值。',
  SETTING_NOT_EDITABLE: '此配置项不可编辑，请刷新平台设置。',
};
export function settingField(key: unknown): OperationField {
  if (key === 'site_name') return { key: 'value', label: '站点名称', type: 'text', required: true, maxLength: 200, hint: '显示给顾客的站点名称，最多 200 个字符。' };
  if (key === 'support_email') return { key: 'value', label: '客服邮箱', type: 'email', maxLength: 255, hint: '如 name@example.com；留空可撤下客服邮箱。' };
  if (key === 'support_phone') return { key: 'value', label: '客服电话', type: 'tel', maxLength: 20, hint: '含 7–15 位数字，如 +1 (212) 555-0100；留空可撤下客服电话。' };
  return { key: 'value', label: '配置值', readOnly: true, hint: SETTING_ERROR_MESSAGES.SETTING_NOT_EDITABLE };
}
export function settingValueError(key: unknown, raw: unknown): string | undefined {
  if (!['site_name', 'support_email', 'support_phone'].includes(String(key))) return 'SETTING_NOT_EDITABLE';
  if (typeof raw !== 'string') return 'SETTING_VALUE_INVALID';
  const value = raw.trim();
  if (key === 'site_name') return !value ? 'SITE_NAME_REQUIRED' : value.length > 200 ? 'SITE_NAME_TOO_LONG' : undefined;
  if (key === 'support_email') return value.length > 255 ? 'SUPPORT_EMAIL_TOO_LONG' : value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'SUPPORT_EMAIL_INVALID' : undefined;
  return value.length > 20 ? 'SUPPORT_PHONE_TOO_LONG' : value && (!/^[+\d() .-]+$/.test(value) || value.replace(/\D/g, '').length < 7 || value.replace(/\D/g, '').length > 15) ? 'SUPPORT_PHONE_INVALID' : undefined;
}
export function settingErrorFields(body: unknown): Record<string, string> | undefined {
  if (!body || typeof body !== 'object') return;
  const value = body as Record<string, unknown>;
  if (value.code !== 'SETTINGS_VALIDATION_FAILED') return;
  const fields = value.fieldErrors;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
  const code = (fields as Record<string, unknown>).value;
  if (typeof code === 'string' && Object.hasOwn(SETTING_ERROR_MESSAGES, code)) return { value: SETTING_ERROR_MESSAGES[code] };
  return { value: '此配置值未通过校验，请检查后重试。' };
}

/** A transport failure or ambiguous server response cannot prove the PATCH failed. */
export function settingWriteUncertain(error: unknown): boolean {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
  return typeof status !== 'number' || ![400, 401, 403, 404, 409, 422, 429].includes(status);
}

export function verifiedSetting(value: unknown, expected: { id: unknown; key: unknown; value?: string }): value is { id: string | number; key: string; value: string } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (typeof row.id === 'string' || typeof row.id === 'number') && String(row.id) === String(expected.id)
    && row.key === expected.key && ['site_name', 'support_email', 'support_phone'].includes(String(row.key)) && typeof row.value === 'string'
    && (expected.value === undefined || row.value === expected.value && !settingValueError(row.key, row.value));
}
