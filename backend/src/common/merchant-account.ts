import { BadRequestException } from '@nestjs/common';

const LOGIN_NAME = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9]\d{7,14}$/;
// Recognize an actual bcrypt envelope, rather than accepting an arbitrary
// nonempty legacy placeholder. This does not attempt to recover a password.
const BCRYPT = /^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

function text(value: unknown, label: string, max: number, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new BadRequestException(`${label}不能为空`);
    return '';
  }
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new BadRequestException(`${label}格式不正确`);
  return value.trim();
}

/** One input contract for Studio creation and atomic account provisioning. */
export function merchantAccountInput(input: Record<string, unknown>) {
  const loginName = text(input.loginName, '独立登录名', 64, true).toLowerCase();
  const name = text(input.name, '姓名', 100, true);
  const email = text(input.email, '邮箱', 255, true).toLowerCase();
  const phone = text(input.phone, '电话', 20) || null;
  const password = input.password;
  if (!LOGIN_NAME.test(loginName)) throw new BadRequestException('独立登录名须为3–64位小写字母、数字、点、下划线或连字符');
  if (!EMAIL.test(email) || (phone && !PHONE.test(phone))) throw new BadRequestException('门店登录邮箱或电话格式不正确');
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 6 || Buffer.byteLength(password, 'utf8') > 72 || password.trim() !== password || /[\u0000\r\n]/u.test(password)) throw new BadRequestException('密码须为6–72个UTF-8字节，首尾不能含空白或包含换行');
  return { loginName, name, email, phone, password };
}

type LoginAccount = { role?: unknown; status?: unknown; deletedAt?: unknown; loginName?: unknown; email?: unknown; phone?: unknown; passwordHash?: unknown };
export function merchantLoginReady(user: LoginAccount | null | undefined) {
  return Boolean(user && user.role === 'MERCHANT' && user.status === 'ACTIVE' && !user.deletedAt &&
    typeof user.passwordHash === 'string' && BCRYPT.test(user.passwordHash) &&
    ((typeof user.loginName === 'string' && LOGIN_NAME.test(user.loginName)) || merchantContactLoginReady(user)));
}

export function merchantContactLoginReady(user: LoginAccount) {
  return (typeof user.email === 'string' && user.email.length <= 255 && EMAIL.test(user.email)) ||
    (typeof user.phone === 'string' && PHONE.test(user.phone));
}

/** Same identifier routing as account provisioning. Callers may read only the
 * boolean; no credential or contact projection is returned by this helper. */
export async function merchantRoutedLoginReady(db: any, user: (LoginAccount & { id?: unknown }) | null | undefined): Promise<boolean> {
  if (!merchantLoginReady(user)) return false;
  if (/^\d+$/.test(String(user!.loginName ?? '')) && !merchantContactLoginReady(user!)) {
    const candidates = await db.user.findMany({ where: { OR: [{ loginName: user!.loginName }, { phone: user!.loginName }] }, take: 2, select: { id: true } });
    return candidates.length === 1 && String(candidates[0].id) === String(user!.id);
  }
  return true;
}
