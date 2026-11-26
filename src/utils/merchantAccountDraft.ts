const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
function randomText(alphabet: string, length: number) {
  const result: string[] = [];
  const limit = 256 - 256 % alphabet.length;
  while (result.length < length) {
    for (const value of crypto.getRandomValues(new Uint8Array(length))) {
      if (value < limit) result.push(alphabet[value % alphabet.length]);
      if (result.length === length) break;
    }
  }
  return result.join('');
}
export function newMerchantAccountDraft() {
  return { loginName: 'shop-' + randomText('abcdefghijklmnopqrstuvwxyz0123456789', 24), password: randomText(LETTERS, 1) + randomText(DIGITS, 1) + randomText(LETTERS + DIGITS, 6) };
}
export function merchantAccountCreatePayload(payload: Record<string, unknown>, loginName: unknown) {
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请填写有效的登录邮箱。');
  if (typeof loginName !== 'string' || !/^shop-[a-z0-9]{24}$/.test(loginName)) throw new Error('内部账户标识未生成，请重新打开创建窗口。');
  return { ...payload, email, loginName };
}
