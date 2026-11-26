import { ApiError, apiRequest } from './session';

export const accountPermissions = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ', 'SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'] as const;
export type AccountPermission = typeof accountPermissions[number];
export const accountPermissionLabels: Record<AccountPermission, string> = {
  BOOKINGS_READ: '查看预约', BOOKINGS_MANAGE: '处理预约', SETTLEMENT_RECORD: '登记实收款', REFUNDS_MANAGE: '退款与冲正',
  RESERVATION_CONFIG: '预约资源与排班', FINANCE_READ: '财务报表', SHOP_SETTINGS_MANAGE: '门店资料', CATALOG_MANAGE: '服务与技师', COPY_CONFIG: '快捷复制营业时间/展示价目',
};
export interface LoginBinding { id: string; shopId: string; userId: string; loginName: string | null; email: string | null; name: string | null; accountStatus: string; loginReady: boolean; createdAt: string; updatedAt: string; reasonRecorded: boolean }
export interface AccessShop { id: string; name: string; status: string; ownerId: string; email: string | null; binding: LoginBinding | null }
export interface AccessAccount { id: string; name: string | null; loginName: string | null; email: string | null; role: 'MERCHANT'; status: string; loginReady: boolean; boundShopId: string | null }
export interface AssociationGrant { id: string; sourceShopId: string; targetShopId: string; permissions: string[]; status: 'ACTIVE' | 'REVOKED'; createdAt: string; updatedAt: string; revokedAt: string | null }
export interface AccessOverview { shops: AccessShop[]; accounts: AccessAccount[]; grants: AssociationGrant[]; permissions: string[] }
export async function getAccessOverview(signal?: AbortSignal): Promise<AccessOverview> {
  const data = await apiRequest<AccessOverview>('/account-access/admin/overview', { signal });
  if (!data || !Array.isArray(data.shops) || !Array.isArray(data.accounts) || !Array.isArray(data.grants) || !Array.isArray(data.permissions) || data.shops.some(shop => shop.binding && typeof shop.binding.loginReady !== 'boolean') || data.accounts.some(account => typeof account.loginReady !== 'boolean')) throw new Error('账户授权数据无效，请重新加载。');
  return data;
}
export interface CreateAndBindInput { shopId: string; loginName: string; name: string; password: string; email: string; phone?: string; reason: string; idempotencyKey: string }
export interface CreateAndBindResult { operationId: string; status: 'APPLIED'; binding: LoginBinding; replayed: boolean }
export function prepareCreateAndBind(input: CreateAndBindInput): CreateAndBindInput {
  const result = { shopId: input.shopId, loginName: input.loginName.trim().toLowerCase(), name: input.name.trim(), password: input.password, reason: input.reason.trim(), email: input.email.trim().toLowerCase(), phone: input.phone?.trim() || undefined, idempotencyKey: input.idempotencyKey };
  if (!/^[1-9]\d{0,18}$/.test(result.shopId) || BigInt(result.shopId) > 9223372036854775807n) throw new Error('门店 ID 无效。');
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(result.loginName)) throw new Error('独立登录名须为 3–64 位小写字母、数字、点、下划线或短横线。');
  if (!result.name || result.name.length > 100 || !result.reason || result.reason.length > 1000) throw new Error('请填写姓名（最多 100 字）和操作原因（最多 1000 字）。');
  if (new TextEncoder().encode(result.password).length < 6 || new TextEncoder().encode(result.password).length > 72 || result.password.trim() !== result.password || /[\u0000\r\n]/u.test(result.password)) throw new Error('密码至少 6 位且不超过 72 UTF-8 字节，首尾不可留空或包含换行。');
  if (!result.email || result.email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('请填写有效的门店登录邮箱。');
  if (result.phone && !/^\+[1-9]\d{7,14}$/.test(result.phone)) throw new Error('可选电话须为国际格式，如 +1 开头。');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/.test(result.idempotencyKey)) throw new Error('创建请求标识无效。');
  return result;
}
/** A matching current binding is evidence of configuration, not a receipt for this exact request. */
export function matchingCreatedBinding(data: AccessOverview, shopId: string, email: string): LoginBinding | null {
  const binding = data.shops.find(shop => shop.id === shopId)?.binding;
  return binding?.shopId === shopId && binding.email?.toLowerCase() === email.trim().toLowerCase()
    && (binding.accountStatus === 'SUSPENDED' && binding.loginReady === false || binding.accountStatus === 'ACTIVE' && binding.loginReady === true) ? binding : null;
}
export async function createAndBindShopAccount(input: CreateAndBindInput): Promise<CreateAndBindResult> {
  const body = prepareCreateAndBind(input);
  const data = await apiRequest<CreateAndBindResult>('/account-access/admin/create-and-bind', { method: 'POST', body: JSON.stringify(body) });
  if (data?.status !== 'APPLIED' || typeof data.operationId !== 'string' || !data.operationId || typeof data.replayed !== 'boolean' || data.binding?.shopId !== body.shopId || typeof data.binding.userId !== 'string' || !/^[1-9]\d{0,18}$/.test(data.binding.userId)
    || data.binding.email?.toLowerCase() !== body.email || !(data.binding.loginName === null || data.replayed && data.binding.loginName === body.loginName)
    || !(data.binding.accountStatus === 'SUSPENDED' && data.binding.loginReady === false || data.replayed && data.binding.accountStatus === 'ACTIVE' && data.binding.loginReady === true)) throw new Error('创建并绑定结果无法确认，请核对最新绑定；不要重复创建。');
  return data;
}
export function bindShopAccount(shopId: string, userId: string, reason: string) {
  return apiRequest<{ binding: LoginBinding }>('/account-access/admin/bind', { method: 'POST', body: JSON.stringify({ shopId, userId, reason }) });
}
export function saveAssociation(sourceShopId: string, targetShopId: string, permissions: AccountPermission[], reason: string) {
  return apiRequest<{ grant: AssociationGrant }>('/account-access/admin/grants', { method: 'POST', body: JSON.stringify({ sourceShopId, targetShopId, permissions, reason }) });
}
export function revokeAssociation(id: string, reason: string) {
  return apiRequest<{ grant: AssociationGrant }>(`/account-access/admin/grants/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}
export function resetMerchantPassword(id: string, password: string, reason: string) {
  return apiRequest<{ userId: string; reset: boolean; revokedSessions: number }>(`/account-access/admin/accounts/${encodeURIComponent(id)}/password`, { method: 'PATCH', body: JSON.stringify({ password, reason }) });
}

export interface StoreAccountCredentials {
  shopId: string; userId: string | null; email: string | null; accountStatus: string | null;
  loginReady: boolean; password: string | null; credentialUpdatedAt: string | null; version: string;
}
export interface StoreAccountCredentialsInput {
  email?: string; password?: string; expectedUserId: string | null;
  version: string; requestKey: string; reason: string;
}
export interface StoreAccountCredentialsResult extends StoreAccountCredentials { replayed: boolean; }
function readStoreAccountCredentials(value: unknown, shopId: string): StoreAccountCredentials {
  const data = value as StoreAccountCredentials | null;
  if (!data || data.shopId !== shopId || !(data.userId === null || typeof data.userId === 'string' && /^[1-9]\d{0,18}$/.test(data.userId))
    || !(data.email === null || typeof data.email === 'string') || !(data.accountStatus === null || typeof data.accountStatus === 'string' && data.accountStatus.length > 0)
    || typeof data.loginReady !== 'boolean' || !(data.password === null || typeof data.password === 'string' && new TextEncoder().encode(data.password).length >= 6 && new TextEncoder().encode(data.password).length <= 72)
    || !(data.credentialUpdatedAt === null || typeof data.credentialUpdatedAt === 'string' && Number.isFinite(Date.parse(data.credentialUpdatedAt)))
    || typeof data.version !== 'string' || !data.version) throw new ApiError('商家账号设置返回格式无效，请重新读取核对。');
  return data;
}
export async function getStoreAccountCredentials(shopId: string, signal?: AbortSignal): Promise<StoreAccountCredentials> {
  return readStoreAccountCredentials(await apiRequest<unknown>(`/account-access/admin/shops/${encodeURIComponent(shopId)}/credentials`, { signal, cache: 'no-store' }), shopId);
}
export async function saveStoreAccountCredentials(shopId: string, input: StoreAccountCredentialsInput): Promise<StoreAccountCredentialsResult> {
  const result = await apiRequest<unknown>(`/account-access/admin/shops/${encodeURIComponent(shopId)}/credentials`, { method: 'PATCH', body: JSON.stringify(input), cache: 'no-store' });
  const data = readStoreAccountCredentials(result, shopId) as StoreAccountCredentialsResult;
  if (typeof data.replayed !== 'boolean' || data.userId === null || input.expectedUserId !== null && data.userId !== input.expectedUserId
    || input.email !== undefined && data.email !== input.email || input.password !== undefined && data.password !== input.password) throw new ApiError('商家账号保存结果无法确认，请核对原请求。');
  return data;
}
