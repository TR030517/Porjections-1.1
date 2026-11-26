import { BadRequestException } from '@nestjs/common';

// Company account links never expand the separate STAFF permission vocabulary.
export const ACCOUNT_PERMISSIONS = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ', 'SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'] as const;
export type AccountPermission = typeof ACCOUNT_PERMISSIONS[number];
export type AccountActor = { id: string; role: string };
export const ACCOUNT_ID_PATTERN = /^[1-9]\d{0,18}$/;

export function accountId(value: unknown): bigint {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value) || BigInt(value) > 9223372036854775807n) throw new BadRequestException('账户或门店ID无效');
  return BigInt(value);
}
export function accountReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new BadRequestException('请填写1–1000字的操作原因');
  return value.trim();
}
export function accountPermissions(value: unknown): AccountPermission[] {
  if (!Array.isArray(value) || !value.length || value.length > ACCOUNT_PERMISSIONS.length || new Set(value).size !== value.length || value.some(permission => !ACCOUNT_PERMISSIONS.includes(permission as AccountPermission))) throw new BadRequestException('关联授权包含无效、重复或空权限');
  if (['BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE'].some(permission => value.includes(permission)) && !value.includes('BOOKINGS_READ')) throw new BadRequestException('预约处理、收款或退款权限必须同时授予查看预约权限');
  // COPY_CONFIG is independent from editing permissions. The copy service
  // adds catalog/reservation checks only for service and add-on workflows.
  return ACCOUNT_PERMISSIONS.filter(permission => value.includes(permission));
}
export function accountPassword(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 6 || Buffer.byteLength(value, 'utf8') > 72 || /[\u0000\r\n]/u.test(value)) throw new BadRequestException('密码须为6–72个UTF-8字节且不可包含换行');
  return value;
}
