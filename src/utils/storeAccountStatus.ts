import type { StoreItem } from '../components/store/types';

export interface StoreAccountSummary { state: 'BOUND' | 'UNBOUND' | 'UNKNOWN'; label: string; }
const exactId = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  return /^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : null;
};
const visibleText = (value: unknown) => typeof value === 'string' && value.trim() && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : '';

/** Binding and account identity come from this store response, never another snapshot or its historical owner. */
export function storeAccountSummary(item: Pick<StoreItem, 'id' | 'accountBindingStatus' | 'loginBinding' | 'loginAccount'>): StoreAccountSummary {
  const unknown: StoreAccountSummary = { state: 'UNKNOWN', label: '登录绑定待核对' };
  const shopId = exactId(item.id);
  if (!shopId) return unknown;
  if (item.accountBindingStatus === 'UNBOUND') {
    return item.loginBinding === null && item.loginAccount === null ? { state: 'UNBOUND', label: '独立账号待绑定' } : unknown;
  }
  if (item.accountBindingStatus !== 'BOUND' || !item.loginBinding || exactId(item.loginBinding.shopId) !== shopId) return unknown;
  const userId = exactId(item.loginBinding.userId);
  if (!userId) return unknown;
  const account = item.loginAccount;
  if (account == null) return { state: 'UNKNOWN', label: `账号 #${userId} 的绑定资料待核对` };
  if (exactId(account.id) !== userId) return unknown;
  const identifier = visibleText(account.loginName) || visibleText(account.email);
  const name = identifier || visibleText(account.name) || `账号 #${userId}`;
  const status = account.status === 'SUSPENDED' ? ' · 账号已停用' : account.status === 'DELETED' ? ' · 账号已删除' : account.status === 'ACTIVE' ? '' : ' · 账号状态待核对';
  // ACTIVE is an account state, not proof that a password or login alias is usable.
  return { state: 'BOUND', label: `已绑定 · ${name}${status}${identifier ? '' : ' · 登录标识待完善'}` };
}
