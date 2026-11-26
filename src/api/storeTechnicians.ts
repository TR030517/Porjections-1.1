import { createResource, listResourcePage, updateResource, deleteResource, type ResourcePage } from './resources';
import { scopedId, technicianPayload, technicianRow, verifyTechnicianReceipt, type TechnicianRow, type TechnicianPayload } from '../utils/storeTechniciansModel';

export interface TechnicianStore { id: string; name: string; }
export interface TechnicianService { id: string; name: string; isActive: boolean; }
const requireShop = (value: unknown) => { const id = scopedId(value); if (!id) throw new Error('请先选择并核对具体门店。'); return id; };

export async function getTechnicianStore(shop: unknown, signal?: AbortSignal): Promise<TechnicianStore> {
  const shopId = requireShop(shop), result = await listResourcePage<{ id: unknown; name: unknown }>('stores', { shopId, pageSize: 1 }, signal);
  const row = result.items[0];
  if (result.total !== 1 || result.items.length !== 1 || scopedId(row?.id) !== shopId || typeof row?.name !== 'string' || !row.name.trim()) throw new Error('未能核对所选门店；不会改为其它门店，请返回门店列表重新选择。');
  return { id: shopId, name: row.name };
}
export async function getStoreTechnicians(shop: unknown, query: { page: number; search?: string; status?: string }, signal?: AbortSignal): Promise<ResourcePage<TechnicianRow>> {
  const shopId = requireShop(shop);
  if (!Number.isSafeInteger(query.page) || query.page < 1 || !['', 'ACTIVE', 'INACTIVE', undefined].includes(query.status)) throw new Error('本店技师筛选无效。');
  const result = await listResourcePage<unknown>('technicians', { shopId, page: query.page, pageSize: 25, search: query.search?.trim(), status: query.status }, signal);
  if (!Number.isSafeInteger(result.total) || result.total < 0 || result.page !== query.page || result.pageSize !== 25 || result.items.length > 25) throw new Error('技师分页结果无法核对，请重新读取。');
  return { ...result, items: result.items.map(row => technicianRow(row, shopId)) };
}
export async function getTechnicianServices(shop: unknown, signal?: AbortSignal): Promise<TechnicianService[]> {
  const shopId = requireShop(shop), rows: Array<{ id: unknown; shopId: unknown; name: unknown; isActive: unknown }> = [];
  for (let page = 1; page <= 5; page++) {
    const result = await listResourcePage<(typeof rows)[number]>('services', { shopId, page, pageSize: 100 }, signal);
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length < 100) break;
  }
  if (rows.length > 500) throw new Error('本店服务目录超过载入上限，请按项目编号继续核对。');
  return rows.map(row => {
    const id = scopedId(row.id);
    if (!id || scopedId(row.shopId) !== shopId || typeof row.name !== 'string' || !row.name.trim() || typeof row.isActive !== 'boolean') throw new Error('本店服务名称无法核对，未使用其它门店资料。');
    return { id, name: row.name, isActive: row.isActive };
  });
}
export async function createStoreTechnician(shop: string, payload: TechnicianPayload): Promise<TechnicianRow> {
  const shopId = requireShop(shop);
  if (payload.shopId !== shopId) throw new Error('新技师归属必须固定为当前门店。');
  const body = technicianPayload(payload, shopId, true);
  const raw = await createResource<unknown>('technicians', body);
  verifyTechnicianReceipt(raw, shopId, payload);
  return technicianRow(raw, shopId);
}
export async function updateStoreTechnician(shop: string, id: string, payload: TechnicianPayload): Promise<TechnicianRow> {
  const shopId = requireShop(shop);
  if (!scopedId(id) || Object.hasOwn(payload, 'shopId')) throw new Error('编辑技师不能改变门店归属。');
  const body = technicianPayload(payload, shopId, false);
  const raw = await updateResource<unknown>('technicians', id, body);
  verifyTechnicianReceipt(raw, shopId, payload, id);
  return technicianRow(raw, shopId);
}
export async function disableStoreTechnician(id: string) {
  if (!scopedId(id)) throw new Error('技师编号无法核对。');
  await deleteResource('technicians', id);
}
