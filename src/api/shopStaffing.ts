import { apiRequest } from './session';
import { buildStaffingPayload, readStaffingSnapshot } from '../utils/shopStaffing';
export async function getShopStaffing(shopId: string, signal?: AbortSignal) {
  return readStaffingSnapshot(await apiRequest('/reservation-admin/shops/' + encodeURIComponent(shopId) + '/staffing', { signal, cache: 'no-store' }), shopId);
}
export async function setShopStaffing(shopId: string, count: unknown, revision: string) {
  const body = buildStaffingPayload(count, revision);
  const result = readStaffingSnapshot(await apiRequest('/reservation-admin/shops/' + encodeURIComponent(shopId) + '/staffing', { method: 'PATCH', body: JSON.stringify(body) }), shopId);
  if (result.activeCount !== body.targetActiveCount || !result.createdIds || !result.deactivatedIds) throw Error('人数保存回执待核对，请只读重新读取，勿重复提交。');
  return result;
}
export async function updateStaffProfile(shopId: string, id: string, changes: { name?: string; bio?: string; avatarUrl?: string }) {
  if (!/^[1-9][0-9]{0,18}$/.test(id)) throw Error('请重新读取本店技师资料。');
  const raw = await apiRequest<Record<string, unknown>>('/merchant/therapists/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(changes) });
  if (raw?.id !== id || raw.shopId !== shopId || Object.entries(changes).some(([key, value]) => raw[key] !== value && !(value === '' && raw[key] === null))) throw Error('资料保存回执待核对，请重新读取，勿重复提交。');
}
