import { BadRequestException } from '@nestjs/common';
import { publicSettingValue } from './settings-validation';
import { StudioService } from './studio.service';

describe('public platform settings field validation', () => {
  test.each([
    ['site_name', '', 'SITE_NAME_REQUIRED'], ['site_name', '   ', 'SITE_NAME_REQUIRED'],
    ['site_name', 'x'.repeat(201), 'SITE_NAME_TOO_LONG'],
    ['support_email', 'invalid', 'SUPPORT_EMAIL_INVALID'], ['support_email', 'a@b', 'SUPPORT_EMAIL_INVALID'],
    ['support_email', 'a'.repeat(256), 'SUPPORT_EMAIL_TOO_LONG'],
    ['support_phone', '123', 'SUPPORT_PHONE_INVALID'], ['support_phone', 'call 2125550100', 'SUPPORT_PHONE_INVALID'],
    ['support_phone', '+1234567890123456', 'SUPPORT_PHONE_INVALID'], ['support_phone', '1'.repeat(21), 'SUPPORT_PHONE_TOO_LONG'],
    ['support_email', null, 'SETTING_VALUE_INVALID'], ['support_phone', 2125550100, 'SETTING_VALUE_INVALID'],
    ['site_name', { set: 'nested' }, 'SETTING_VALUE_INVALID'], ['private_setting', 'value', 'SETTING_NOT_EDITABLE'],
  ])('%s invalid input returns stable code %s', (key, raw, expected) => {
    try { publicSettingValue(key, raw); throw new Error('Expected validation rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SETTINGS_VALIDATION_FAILED', fieldErrors: { value: expected } });
    }
  });
  test.each([
    ['site_name', ' Massajoy ', 'Massajoy'], ['support_email', ' support@example.invalid ', 'support@example.invalid'],
    ['support_phone', '+1 (212) 555-0100', '+1 (212) 555-0100'], ['support_email', '', ''], ['support_phone', '', ''],
  ])('%s accepts and normalizes permitted public value', (key, raw, expected) => { expect(publicSettingValue(key, raw)).toBe(expected); });
  test('real studio input path preserves ADMIN authorization before field validation', async () => {
    const service = new StudioService({} as any) as any;
    await expect(service.data({}, 'settings', { value: 'bad' }, { key: 'support_email' }, { id: '1', role: 'MERCHANT' })).rejects.toThrow();
    await expect(service.data({}, 'settings', { value: 'support@example.invalid' }, { key: 'support_email' }, { id: '1', role: 'ADMIN' })).resolves.toEqual({ value: 'support@example.invalid' });
  });
});
