import * as rules from './password-policy-rules.json';

export type PasswordRole = keyof typeof rules.minimumUtf8BytesByRole;
export const PASSWORD_MAX_UTF8_BYTES = rules.maximumUtf8Bytes;

/** Pure policy shared with the web forms. Never trim or normalize a password. */
export function passwordPolicy(role: string): { minimumUtf8Bytes: number; maximumUtf8Bytes: number } | null {
  if (!Object.prototype.hasOwnProperty.call(rules.minimumUtf8BytesByRole, role)) return null;
  return { minimumUtf8Bytes: rules.minimumUtf8BytesByRole[role as PasswordRole], maximumUtf8Bytes: PASSWORD_MAX_UTF8_BYTES };
}

export function validRolePassword(value: unknown, role: string): value is string {
  const policy = passwordPolicy(role);
  if (!policy || typeof value !== 'string') return false;
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= policy.minimumUtf8Bytes && bytes <= policy.maximumUtf8Bytes &&
    !rules.forbiddenCodePoints.some(point => value.includes(String.fromCodePoint(point)));
}

export function passwordPolicyError(value: unknown, role: string): string | null {
  if (validRolePassword(value, role)) return null;
  const policy = passwordPolicy(role);
  return policy
    ? `密码须为${policy.minimumUtf8Bytes}–${policy.maximumUtf8Bytes}个UTF-8字节且不可包含空字符或换行`
    : '当前身份不支持此密码操作';
}
