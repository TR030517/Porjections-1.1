import { passwordPolicyError } from '../../backend/src/common/password-policy';

export interface OwnPasswordInput { currentPassword: string; newPassword: string; }
export interface OwnPasswordResult { changed: true; reauthenticationRequired: true; revokedSessions: number; }

export function ownPasswordError(role: string, currentPassword: string, newPassword: string, confirmation: string): string {
  if (!['ADMIN', 'MERCHANT', 'STAFF'].includes(role)) return '当前身份不支持此密码操作。';
  if (!currentPassword) return '请输入当前密码。';
  const policyError = passwordPolicyError(newPassword, role);
  if (policyError) return policyError;
  if (newPassword !== confirmation) return '两次输入的新密码不一致。';
  if (newPassword === currentPassword) return '新密码须与当前密码不同。';
  return '';
}

export function validOwnPasswordResult(value: unknown): value is OwnPasswordResult {
  const result = value as Partial<OwnPasswordResult> | null;
  return !!result && result.changed === true && result.reauthenticationRequired === true &&
    Number.isSafeInteger(result.revokedSessions) && result.revokedSessions! > 0;
}

export function ownPasswordFailure(error: unknown): { uncertain: boolean; message: string } {
  const failure = error as { status?: number; code?: string; message?: string; response?: { status?: number; data?: { code?: string; error?: { code?: string } } } };
  const status = failure?.response?.status ?? failure?.status;
  const code = failure?.response?.data?.error?.code ?? failure?.response?.data?.code ?? failure?.code;
  if (code === 'CURRENT_PASSWORD_INVALID') return { uncertain: false, message: '当前密码不正确，请重新输入。' };
  const uncertain = status === undefined || status === 0 || status === 408 || status >= 500;
  return { uncertain, message: uncertain ? '暂时无法确认密码是否已修改。请重新登录核对，勿反复提交修改请求。' : failure?.message || '密码未修改，请核对输入后重试。' };
}
