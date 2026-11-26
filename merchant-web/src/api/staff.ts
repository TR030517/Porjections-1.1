import client from './client';
import { staffPermissions, type ShopPermission } from '../utils/shopPermissions';

export interface StaffGrant { userId: string; shopId: string; name: string; email: string; phone: string; accountStatus: string; status: 'ACTIVE' | 'REVOKED'; permissions: ShopPermission[]; createdAt: string; updatedAt: string; revokedAt: string | null; }
export interface StaffPage { shopId: string; items: StaffGrant[]; total: number; page: number; pageSize: number; totalPages: number; }
export interface CreateStaff { name: string; email: string; phone: string; password: string; permissions: ShopPermission[]; }
const base = (shopId: string) => `/merchant/shops/${encodeURIComponent(shopId)}/staff`;
function checkedGrant(value: StaffGrant, shopId: string): StaffGrant {
  if (!value || value.shopId !== shopId || !/^[1-9]\d*$/.test(value.userId) || !['ACTIVE','REVOKED'].includes(value.status) || !Array.isArray(value.permissions) || value.permissions.some(permission => !staffPermissions.includes(permission))) throw new Error('员工响应与当前门店不符，请刷新核对后再尝试。');
  return value;
}
export async function getStaff(shopId: string, page: number, signal?: AbortSignal): Promise<StaffPage> {
  const { data } = await client.get(base(shopId), { params: { page, pageSize: 20 }, signal });
  if (data?.shopId !== shopId || !Array.isArray(data.items) || !Number.isSafeInteger(data.total)) throw new Error('无法核对员工列表。');
  return { ...data, items: data.items.map((row: StaffGrant) => checkedGrant(row, shopId)) };
}
export async function createStaff(shopId: string, input: CreateStaff): Promise<StaffGrant> { const { data } = await client.post(base(shopId), input); return checkedGrant(data, shopId); }
export async function grantStaff(shopId: string, userId: string, permissions: ShopPermission[]): Promise<StaffGrant> { const { data } = await client.post(base(shopId) + '/grants', { userId, permissions }); return checkedGrant(data, shopId); }
export async function updateStaff(shopId: string, userId: string, permissions: ShopPermission[]): Promise<StaffGrant> { const { data } = await client.patch(base(shopId) + '/' + encodeURIComponent(userId), { permissions }); return checkedGrant(data, shopId); }
export async function revokeStaff(shopId: string, userId: string): Promise<void> {
  const { data } = await client.delete(base(shopId) + '/' + encodeURIComponent(userId));
  if (data?.shopId !== shopId || data?.userId !== userId || data?.status !== 'REVOKED') throw new Error('撤销结果尚未确认，请刷新核对后再尝试。');
}
