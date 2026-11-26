import { normalizeReservationService } from '../utils/serviceDuration';
import { apiRequest, ApiError } from './session';
import type { ResourceId } from './resources';
import type { ReservationConfig, ReservationPolicy, ReservationResource } from '../types/reservations';
import { checkedBookingSettingsHash, checkedShopBookingSettings } from '../utils/shopBookingSettings';
import type { CatalogMutationRequest } from '../types/catalogMutation';
import type { WorkspaceCommand } from '../types/serviceWorkspace';

const resources = new Set<ReservationResource>(['variants', 'shifts', 'time-off', 'rooms', 'maintenance']);
function base(shopId: ResourceId) { return '/reservation-admin/shops/' + encodeURIComponent(String(shopId)); }
export function createCatalogObject(shopId: string, request: CatalogMutationRequest): Promise<unknown> {
  return apiRequest(base(shopId) + '/catalog-actions', { method: 'POST', body: JSON.stringify(request) });
}
export function readCatalogOperation(shopId: string, key: string): Promise<unknown> {
  return apiRequest(base(shopId) + '/catalog-actions/' + encodeURIComponent(key));
}
export function readServiceWorkspace(shopId: string, serviceId?: string, signal?: AbortSignal): Promise<unknown> {
  return apiRequest(base(shopId) + '/service-workspace-actions/snapshot' + (serviceId ? '?serviceId=' + encodeURIComponent(serviceId) : ''), { signal, cache: 'no-store' });
}
export function saveServiceWorkspace(shopId: string, command: WorkspaceCommand): Promise<unknown> {
  return apiRequest(base(shopId) + '/service-workspace-actions', { method: 'POST', body: JSON.stringify(command) });
}
export function readServiceWorkspaceOperation(shopId: string, key: string, signal?: AbortSignal): Promise<unknown> {
  return apiRequest(base(shopId) + '/service-workspace-actions/' + encodeURIComponent(key), { signal, cache: 'no-store' });
}
export function reconcileServiceWorkspaceOperation(shopId: string, key: string, signal?: AbortSignal): Promise<unknown> {
  return apiRequest(base(shopId) + '/service-workspace-actions/' + encodeURIComponent(key) + '/reconcile', { method: 'POST', body: '{}', signal });
}
export interface ReservationClosedPeriod { startDate: string; endDate: string; }
export interface ReservationShopBookingSettings { minimumNoticeMinutes: number; closedPeriods: ReservationClosedPeriod[]; }
export const EMPTY_RESERVATION_BOOKING_SETTINGS: ReservationShopBookingSettings = { minimumNoticeMinutes: 0, closedPeriods: [] };
export async function getReservationConfig(shopId: ResourceId, signal?: AbortSignal): Promise<ReservationConfig> {
  const result = await apiRequest<ReservationConfig>(base(shopId) + '/config', { signal });
  if (!result || String(result.shopId) !== String(shopId) || !Array.isArray(result.services) || !Array.isArray(result.therapists) || !Array.isArray(result.rooms) || typeof result.paymentPolicy?.payAtStoreEnabled !== 'boolean') {
    throw new ApiError('预约设置返回格式无效，请重新加载。');
  }
  return { ...result, ...(result.bookingSettings === undefined ? {} : { bookingSettings: checkedShopBookingSettings(result.bookingSettings) }), services: result.services.map(normalizeReservationService) };
}
export async function updateShopPaymentPolicy(shopId: ResourceId, payAtStoreEnabled: boolean) {
  await apiRequest(base(shopId) + '/payment-policy', { method: 'PATCH', body: JSON.stringify({ payAtStoreEnabled }) });
}
export async function getShopBookingSettings(shopId: ResourceId, signal?: AbortSignal): Promise<ReservationShopBookingSettings> {
  return (await getShopBookingSettingsSnapshot(shopId, signal)).bookingSettings;
}
export interface BookingSettingsSnapshot { bookingSettings: ReservationShopBookingSettings; bookingSettingsHash: string; }
export async function getShopBookingSettingsSnapshot(shopId: ResourceId, signal?: AbortSignal): Promise<BookingSettingsSnapshot> {
  const result = await apiRequest<{ shopId: ResourceId; bookingSettings: ReservationShopBookingSettings; bookingSettingsHash: string }>(base(shopId) + '/booking-settings', { signal, cache: 'no-store' });
  if (!result || String(result.shopId) !== String(shopId)) throw new ApiError('预约规则返回门店不匹配。');
  return { bookingSettings: checkedShopBookingSettings(result.bookingSettings), bookingSettingsHash: checkedBookingSettingsHash(result.bookingSettingsHash) };
}
export async function updateShopBookingSettings(shopId: ResourceId, settings: ReservationShopBookingSettings, expectedSettingsHash: string): Promise<BookingSettingsSnapshot> {
  const normalized = checkedShopBookingSettings(settings);
  checkedBookingSettingsHash(expectedSettingsHash);
  const result = await apiRequest<{ item: { shopId: string; bookingSettings: ReservationShopBookingSettings; bookingSettingsHash: string } }>(base(shopId) + '/booking-settings', { method: 'PATCH', body: JSON.stringify({ ...normalized, expectedSettingsHash }) });
  if (String(result?.item?.shopId) !== String(shopId)) throw new ApiError('预约提前时间与临时闭店的保存结果无法确认。');
  const saved = checkedShopBookingSettings(result.item.bookingSettings);
  if (JSON.stringify(saved) !== JSON.stringify(normalized)) throw new ApiError('预约提前时间与临时闭店的保存结果无法确认。');
  return { bookingSettings: saved, bookingSettingsHash: checkedBookingSettingsHash(result.item.bookingSettingsHash) };
}
export async function updateTherapistScheduleMode(shopId: ResourceId, therapistId: ResourceId, scheduleMode: 'SHOP' | 'CUSTOM') {
  const result = await apiRequest<{ item: { id: ResourceId; scheduleMode: 'SHOP' | 'CUSTOM' } }>(base(shopId) + '/therapists/' + encodeURIComponent(String(therapistId)) + '/schedule', { method: 'PATCH', body: JSON.stringify({ scheduleMode }) });
  if (String(result?.item?.id) !== String(therapistId) || result.item.scheduleMode !== scheduleMode) throw new ApiError('排班方式保存结果无法确认，请重新加载核对。');
  return result.item;
}
function resourcePath(shopId: ResourceId, resource: ReservationResource, id?: ResourceId) {
  if (!resources.has(resource)) throw new ApiError('不支持的预约设置。');
  return base(shopId) + '/' + resource + (id == null ? '' : '/' + encodeURIComponent(String(id)));
}
function savedItem(result: { item: { id: ResourceId } }, id?: ResourceId) {
  if (result?.item?.id == null || (id != null && String(result.item.id) !== String(id))) throw new ApiError('保存结果无法确认，请重新加载核对。');
  return result.item;
}
export async function saveReservationResource(shopId: ResourceId, resource: ReservationResource, payload: object, id?: ResourceId) {
  const result = await apiRequest<{ item: { id: ResourceId } }>(resourcePath(shopId, resource, id), {
    method: id == null ? 'POST' : 'PATCH', body: JSON.stringify(payload),
  });
  return savedItem(result, id);
}
export async function updateReservationPolicy(shopId: ResourceId, serviceId: ResourceId, policy: ReservationPolicy) {
  const result = await apiRequest<{ item: { id: ResourceId } }>(base(shopId) + '/services/' + encodeURIComponent(String(serviceId)) + '/policy', {
    method: 'PATCH', body: JSON.stringify(policy),
  });
  return savedItem(result, serviceId);
}
export async function removeReservationResource(shopId: ResourceId, resource: ReservationResource, id: ResourceId) {
  const result = await apiRequest<{ success: boolean }>(resourcePath(shopId, resource, id), { method: 'DELETE' });
  if (result?.success !== true) throw new ApiError('操作结果无法确认，请重新加载核对。');
}
