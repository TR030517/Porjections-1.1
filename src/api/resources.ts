import { normalizeServiceDuration, normalizeBookingListDuration, readServiceDurationKind, assertServiceDurationWrite } from '../utils/serviceDuration';
import { apiRequest, ApiError } from './session';
import { bookingServiceSummary } from '../utils/bookingReception';
export type ResourceId = string | number;
export type ResourceName = 'stores' | 'regions' | 'coupons' | 'users' | 'service-orders' | 'services' | 'technicians' | 'industries' | 'banners' | 'content' | 'applications' | 'after-sales' | 'gift-cards' | 'gift-card-orders' | 'withdrawals' | 'admins' | 'merchants' | 'settings';
export type ResourceQuery = Record<string, string | number | boolean | undefined>;
export interface PublicationCheck { key: string; label: string; complete: boolean; }
export interface PublicationReadiness { publicationChecklist?: PublicationCheck[]; publicationReady?: boolean; }
export type StoreReviewAction = 'APPROVE' | 'REJECT' | 'REQUEST_INFO';
export interface StoreReviewResult { id: ResourceId; status: string; reviewComment?: string | null; }
export interface ResourcePage<T> { items: T[]; total: number; page: number; pageSize: number; }
const RESOURCES = new Set<string>(['stores', 'regions', 'coupons', 'users', 'service-orders', 'services', 'technicians', 'industries', 'banners', 'content', 'applications', 'after-sales', 'gift-cards', 'gift-card-orders', 'withdrawals', 'admins', 'merchants', 'settings']);
function resourcePath(resource: string) {
  if (!RESOURCES.has(resource)) throw new Error('不支持的数据资源。');
  return '/studio/' + resource;
}
export async function listResourcePage<T>(resource: string, query: ResourceQuery = {}, signal?: AbortSignal): Promise<ResourcePage<T>> {
  const params = new URLSearchParams({ page: '1', pageSize: '25' });
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  const result = await apiRequest<ResourcePage<T>>(resourcePath(resource) + '?' + params, { signal });
  if (!Array.isArray(result?.items) || !Number.isFinite(result.total)) throw new ApiError('服务返回的列表格式无效。');
  return { ...result, items: result.items.map(item => resource === 'services' ? normalizeServiceDuration(item) : resource === 'service-orders' ? { ...normalizeBookingListDuration(item), serviceName: bookingServiceSummary(item) } : item) };
}
// Detailed editors have a strict bound; server-paginated pages use listResourcePage.
export async function listResources<T>(resource: string, query: ResourceQuery = {}, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await listResourcePage<T>(resource, { ...query, page, pageSize: 100 }, signal);
    items.push(...result.items);
    if (!result.items.length || items.length >= result.total || result.items.length < result.pageSize) break;
  }
  return items.slice(0, 500);
}
function savedService<T>(item: T, payload: object, creating: boolean): T {
  const result = normalizeServiceDuration(item), sent = payload as Record<string, unknown>;
  if ((creating || sent.durationKind !== undefined) && result.durationKind !== readServiceDurationKind(sent.durationKind)
    || sent.durationMin !== undefined && result.durationMin !== sent.durationMin) throw new ApiError('保存的服务类型或预约预留时间与请求不一致，请保留草稿并刷新核对。');
  return result;
}
export async function createResource<T>(resource: string, payload: object): Promise<T> {
  if (resource === 'services') assertServiceDurationWrite(payload, true);
  const result = await apiRequest<{ item: T }>(resourcePath(resource), { method: 'POST', body: JSON.stringify(payload) });
  if (!result?.item) throw new ApiError('服务未返回保存结果，请刷新核对。');
  return resource === 'services' ? savedService(result.item, payload, true) : result.item;
}
export async function updateResource<T>(resource: string, id: ResourceId, payload: object): Promise<T> {
  if (resource === 'services') assertServiceDurationWrite(payload, false);
  const result = await apiRequest<{ item: T }>(resourcePath(resource) + '/' + encodeURIComponent(String(id)), { method: 'PATCH', body: JSON.stringify(payload) });
  if (!result?.item) throw new ApiError('服务未返回保存结果，请刷新核对。');
  return resource === 'services' ? savedService(result.item, payload, false) : result.item;
}
export async function deleteResource(resource: string, id: ResourceId): Promise<void> {
  await apiRequest(resourcePath(resource) + '/' + encodeURIComponent(String(id)), { method: 'DELETE' });
}
export async function reviewStore(id: ResourceId, action: StoreReviewAction, reason?: string): Promise<StoreReviewResult> {
  const result = await apiRequest<StoreReviewResult>('/admin/shops/' + encodeURIComponent(String(id)) + '/review', {
    method: 'PATCH', body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
  });
  if (!result || (typeof result.id !== 'string' && typeof result.id !== 'number') || typeof result.status !== 'string') throw new ApiError('服务未返回审核结果，请刷新核对。');
  return result;
}
