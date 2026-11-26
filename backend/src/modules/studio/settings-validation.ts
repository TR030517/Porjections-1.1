import { BadRequestException } from '@nestjs/common';

function invalid(code: string, message: string): never {
  throw new BadRequestException({ code: 'SETTINGS_VALIDATION_FAILED', fieldErrors: { value: code }, message });
}
export function publicSettingValue(key: unknown, raw: unknown) {
  if (!['site_name', 'support_email', 'support_phone'].includes(String(key))) invalid('SETTING_NOT_EDITABLE', 'Only existing public display settings can be edited');
  if (typeof raw !== 'string') invalid('SETTING_VALUE_INVALID', 'Invalid value');
  const value = raw.trim();
  if (key === 'site_name') {
    if (!value) invalid('SITE_NAME_REQUIRED', 'Invalid value');
    if (value.length > 200) invalid('SITE_NAME_TOO_LONG', 'Invalid value');
  } else if (key === 'support_email') {
    if (value.length > 255) invalid('SUPPORT_EMAIL_TOO_LONG', 'Invalid support email');
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) invalid('SUPPORT_EMAIL_INVALID', 'Invalid support email');
  } else {
    if (value.length > 20) invalid('SUPPORT_PHONE_TOO_LONG', 'Support phone must contain 7–15 digits');
    if (value && (!/^[+\d() .-]+$/.test(value) || value.replace(/\D/g, '').length < 7 || value.replace(/\D/g, '').length > 15)) invalid('SUPPORT_PHONE_INVALID', 'Support phone must contain 7–15 digits');
  }
  return value;
}
