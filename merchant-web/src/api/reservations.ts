import { normalizeReservationService, type ServiceDurationKind } from '../../../src/utils/serviceDuration';
import { checkedShopBookingSettings } from '../../../src/utils/shopBookingSettings';
import client from './client';
import type { CatalogMutationRequest } from '../../../src/types/catalogMutation';
import type { WorkspaceCommand } from '../../../src/types/serviceWorkspace';
import { checkedBusinessHours } from '../utils/reservationHours';

export type ResourceKind = 'variants' | 'shifts' | 'time-off' | 'rooms' | 'maintenance';
export type RoomType = 'SINGLE' | 'COUPLE' | 'FOOT_SEAT';
export type PriceBasis = 'PER_PERSON' | 'PER_BOOKING';
export interface Variant { id: string; serviceId: string; name: string; durationMin: number; durationKind?: ServiceDurationKind; reservedDurationMin?: number; priceCents: number; priceBasis: PriceBasis; currency: string; isActive: boolean; sortOrder: number; }
export interface ServiceAddOn { id:string;serviceId:string;name:string;description:string|null;priceCents:number;currency:'usd';isActive:boolean;sortOrder:number; }
export interface ReservationService { id: string; shopId: string; name: string; isActive: boolean; durationMin: number; durationKind?: ServiceDurationKind; reservedDurationMin?: number; priceCents: number; priceBasis: PriceBasis; participantCount: 1 | 2; requiredStaffCount: number; requiredRoomType: RoomType | null; staffBufferMin: number; roomBufferMin: number; variants: Variant[]; addOns?:ServiceAddOn[]; }
export interface Shift { id: string; therapistId: string; weekday: number; startMin: number; endMin: number; isActive: boolean; }
export interface Interval { id: string; startAtUtc: string; endAtUtc: string; reason: string | null; }
export interface ReservationTherapist { id: string; shopId: string; name: string; isActive: boolean; scheduleMode: 'SHOP' | 'CUSTOM'; serviceIds: string[]; shifts: Shift[]; timeOff: Interval[]; }
export interface Room { id: string; shopId: string; name: string; roomType: RoomType; capacity: number; isActive: boolean; maintenance: Interval[]; }
export type OpeningPeriod = { open: string; close: string; closed?: false } | { closed: true; open?: string; close?: string };
export type BusinessHours = Record<string, OpeningPeriod | OpeningPeriod[]>;
export interface ClosedPeriod { startDate: string; endDate: string; }
export interface ShopBookingSettings { minimumNoticeMinutes: number; closedPeriods: ClosedPeriod[]; }
export const DEFAULT_SHOP_BOOKING_SETTINGS: ShopBookingSettings = { minimumNoticeMinutes: 0, closedPeriods: [] };
export interface ReservationConfig { shopId: string; orderOnly?: boolean; onlinePaymentEnabled?: boolean; pricingPolicy?: 'PER_ORDER'; timezone: string | null; businessHours?: BusinessHours | null; bookingSettings?: ShopBookingSettings; bookingSettingsHash?: string; paymentPolicy?: { payAtStoreEnabled: boolean }; services: ReservationService[]; therapists: ReservationTherapist[]; rooms: Room[]; }
const validSettingsHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const base = (shopId: string) => `/reservation-admin/shops/${encodeURIComponent(shopId)}`;
export async function createCatalogObject(shopId: string, request: CatalogMutationRequest): Promise<unknown> {
  const { data } = await client.post(base(shopId) + '/catalog-actions', request); return data;
}
export async function readCatalogOperation(shopId: string, key: string): Promise<unknown> {
  const { data } = await client.get(base(shopId) + '/catalog-actions/' + encodeURIComponent(key)); return data;
}
export async function readServiceWorkspace(shopId: string, serviceId?: string, signal?: AbortSignal): Promise<unknown> {
  const { data } = await client.get(base(shopId) + '/service-workspace-actions/snapshot', { params: serviceId ? { serviceId } : undefined, signal, headers: { 'Cache-Control': 'no-cache' } }); return data;
}
export async function saveServiceWorkspace(shopId: string, command: WorkspaceCommand): Promise<unknown> {
  const { data } = await client.post(base(shopId) + '/service-workspace-actions', command); return data;
}
export async function readServiceWorkspaceOperation(shopId: string, key: string, signal?: AbortSignal): Promise<unknown> {
  const { data } = await client.get(base(shopId) + '/service-workspace-actions/' + encodeURIComponent(key), { signal, headers: { 'Cache-Control': 'no-cache' } }); return data;
}
export async function reconcileServiceWorkspaceOperation(shopId: string, key: string, signal?: AbortSignal): Promise<unknown> {
  const { data } = await client.post(base(shopId) + '/service-workspace-actions/' + encodeURIComponent(key) + '/reconcile', {}, { signal }); return data;
}
export async function getReservationConfig(shopId: string, signal?: AbortSignal): Promise<ReservationConfig> {
  const { data } = await client.get(base(shopId) + '/config', { signal });
  if (String(data?.shopId) !== shopId || !Array.isArray(data?.services) || !Array.isArray(data?.therapists) || !Array.isArray(data?.rooms) || typeof data?.paymentPolicy?.payAtStoreEnabled !== 'boolean') throw new Error('预约设置与当前门店不符。');
  if (data.bookingSettings !== undefined && !validSettingsHash(data.bookingSettingsHash)) throw new Error('预约规则版本尚未读取，请刷新核对。');
  return { ...data, businessHours: checkedBusinessHours(data.businessHours), ...(data.bookingSettings === undefined ? {} : { bookingSettings: checkedShopBookingSettings(data.bookingSettings) }), services: data.services.map(normalizeReservationService) };
}
export async function getShopBookingSettings(shopId: string, signal?: AbortSignal): Promise<ShopBookingSettings> {
  const { data } = await client.get(base(shopId) + '/booking-settings', { signal });
  if (String(data?.shopId) !== shopId || !validSettingsHash(data.bookingSettingsHash)) throw new Error('预约设置与当前门店不符或版本未能读取。');
  return checkedShopBookingSettings(data.bookingSettings);
}
export async function saveShopPaymentPolicy(shopId: string, payAtStoreEnabled: boolean) {
  await client.patch(base(shopId) + '/payment-policy', { payAtStoreEnabled });
}
export async function saveShopBookingSettings(shopId: string, bookingSettings: ShopBookingSettings, expectedSettingsHash: string) {
  const normalized = checkedShopBookingSettings(bookingSettings);
  if (!validSettingsHash(expectedSettingsHash)) throw new Error('预约规则版本缺失，请先读取最新规则；尚未提交。');
  const { data } = await client.patch(base(shopId) + '/booking-settings', { ...normalized, expectedSettingsHash });
  if (String(data?.item?.shopId) !== shopId || !validSettingsHash(data?.item?.bookingSettingsHash)) throw new Error('预约提前时间或临时闭店保存结果无法确认，请刷新核对。');
  const saved = checkedShopBookingSettings(data.item.bookingSettings);
  if (JSON.stringify(saved) !== JSON.stringify(normalized)) throw new Error('预约提前时间或临时闭店保存结果无法确认，请刷新核对。');
  return { bookingSettings: saved, bookingSettingsHash: data.item.bookingSettingsHash as string };
}
export async function saveTherapistScheduleMode(shopId: string, therapistId: string, scheduleMode: 'SHOP' | 'CUSTOM') {
  const { data } = await client.patch(base(shopId) + '/therapists/' + encodeURIComponent(therapistId) + '/schedule', { scheduleMode });
  if (String(data?.item?.id) !== therapistId || data.item.scheduleMode !== scheduleMode) throw new Error('排班方式保存结果尚未确认，请刷新核对。');
  return data.item;
}
export async function saveResource(shopId: string, kind: ResourceKind, payload: Record<string, unknown>, id?: string) {
  const url = base(shopId) + '/' + kind + (id ? '/' + encodeURIComponent(id) : '');
  const { data } = id ? await client.patch(url, payload) : await client.post(url, payload);
  if (data?.item?.id == null || id && String(data.item.id) !== id) throw new Error('保存结果尚未确认，请刷新核对后再尝试。');
  return data.item;
}
export async function removeResource(shopId: string, kind: ResourceKind, id: string) {
  const { data } = await client.delete(base(shopId) + '/' + kind + '/' + encodeURIComponent(id));
  if (data?.success !== true) throw new Error('结果尚未确认，请刷新资源核对。');
}
export async function savePolicy(shopId: string, serviceId: string, payload: Record<string, unknown>) {
  const { data } = await client.patch(base(shopId) + '/services/' + encodeURIComponent(serviceId) + '/policy', payload);
  if (String(data?.item?.id) !== serviceId) throw new Error('规则保存结果尚未确认，请刷新核对。');
}
export async function saveHours(shopId: string, businessHours: BusinessHours) {
  await client.patch(base(shopId) + '/hours', { businessHours: checkedBusinessHours(businessHours) });
}
export async function saveServiceAddOn(shopId:string,serviceId:string,payload:Omit<ServiceAddOn,'id'|'serviceId'>,addOnId?:string):Promise<ServiceAddOn>{
  const url=base(shopId)+'/add-ons'+(addOnId?'/'+encodeURIComponent(addOnId):'');
  const {data}=addOnId?await client.patch(url,payload):await client.post(url,{serviceId,...payload});
  const row=data?.item;
  if(!row||!/^[1-9]\d{0,18}$/.test(String(row.id))||String(row.serviceId)!==serviceId||addOnId&&String(row.id)!==addOnId
    ||row.name!==payload.name.trim()||row.priceCents!==payload.priceCents||row.currency!=='usd'||row.isActive!==payload.isActive||row.sortOrder!==payload.sortOrder)throw new Error('附加项目保存结果尚未确认，请先刷新列表核对，不要重复新增。');
  return {id:String(row.id),serviceId:String(row.serviceId),name:row.name,description:row.description??null,priceCents:row.priceCents,currency:'usd',isActive:row.isActive,sortOrder:row.sortOrder};
}
export async function disableServiceAddOn(shopId:string,addOnId:string){
  const {data}=await client.delete(base(shopId)+'/add-ons/'+encodeURIComponent(addOnId));
  if(data?.success!==true)throw new Error('停用结果尚未确认，请刷新核对。');
}
