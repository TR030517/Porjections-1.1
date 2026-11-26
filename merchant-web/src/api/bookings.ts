import { normalizeSavedBooking, type ServiceDurationKind } from '../../../src/utils/serviceDuration';
import client from './client';
import { mapBooking, type Booking } from './merchant';
import { savedBookingAddOns, type SavedBookingAddOn } from '../utils/bookingAddOns';
import { bookingOperationHeaders, checkBookingOperationReceipt } from './bookingOperations';
import { savedTherapistRequest, type TherapistSelection } from '../utils/therapistSelection';

export interface BookingItem extends TherapistSelection {
  id: string;
  participantIndex: number;
  sequence?: number;
  offsetMin?: number;
  preparationMin?: number;
  serviceNameSnapshot: string;
  variantNameSnapshot?: string | null;
  durationMin: number;
  durationKind?: ServiceDurationKind;
  durationKindSnapshot?: ServiceDurationKind;
  reservedDurationMin?: number;
  priceCentsSnapshot: number;
  quotedUnitPriceCents?: number | null;
  priceBasisSnapshot?: string;
  currency?: string;
  timezone?: string | null;
  startAtUtc?: string;
  endAtUtc?: string;
  localStartTime?: string;
  localEndTime?: string;
  assignedTherapistId?: string | null;
  assignedTherapistIds?: string[];
  therapistId?: string | null;
  assignedRoomId?: string | null;
  staffBufferMin: number;
  roomBufferMin: number;
}
export interface BookingDetail extends Booking {
  items: BookingItem[];
  notes?: string | null;
  bookingSource?: string;
  cancelReason?: string | null;
  addOns: SavedBookingAddOn[];
  mainSubtotalCents: number;
  addOnSubtotalCents: number;
}
export async function getBooking(id: string, shopId: string, signal?: AbortSignal): Promise<BookingDetail> {
  const { data } = await client.get(`/bookings/${encodeURIComponent(id)}`, { signal });
  if (String(data?.id) !== id || String(data?.shopId) !== shopId) throw new Error('该预约不属于当前门店。');
  const saved=normalizeSavedBooking<BookingDetail>(data);
  const row=mapBooking(saved),addOns=savedBookingAddOns(data.addOns),addOnSubtotalCents=addOns.reduce((sum,item)=>sum+item.lineTotalCents,0);
  if(addOns.length&&(data.addOnSubtotalCents!==addOnSubtotalCents||!Number.isSafeInteger(data.mainSubtotalCents)||data.mainSubtotalCents+addOnSubtotalCents!==row.priceCents))throw Error('预约主项与附加项目金额不一致，请刷新核对。');
  return {
    ...row,
    items: saved.items.map(item => ({ ...item, ...savedTherapistRequest(item) })),
    notes: data.notes,
    bookingSource: typeof data.bookingSource === 'string' ? data.bookingSource : undefined,
    cancelReason: typeof data.cancelReason === 'string' ? data.cancelReason.trim() || null : null,
    addOns,
    mainSubtotalCents: data.mainSubtotalCents ?? row.priceCents,
    addOnSubtotalCents,
  };
}
export async function cancelBooking(id: string, operationKey?: string, cancelReason?: string): Promise<void> {
  const { data } = await client.post(`/bookings/${encodeURIComponent(id)}/cancel`, cancelReason === undefined ? {} : { cancelReason }, bookingOperationHeaders(operationKey));
  if (operationKey) checkBookingOperationReceipt(data, id, { status: 'CANCELLED', cancelReason });
}
export async function rescheduleBooking(id: string, input: { date: string; startTime: string }, operationKey?: string): Promise<void> {
  // Move the saved itinerary as a whole. Never override its segments with one top-level technician.
  const { data } = await client.post(`/bookings/${encodeURIComponent(id)}/reschedule`, { date: input.date, startTime: input.startTime }, bookingOperationHeaders(operationKey));
  if (operationKey) checkBookingOperationReceipt(data, id, input);
}
export interface BookingRescheduleSlots { date: string; timezone: string; slots: Array<{ time: string; available: boolean }> }
export async function getBookingRescheduleSlots(id: string, date: string, signal?: AbortSignal): Promise<BookingRescheduleSlots> {
  const { data } = await client.get(`/bookings/${encodeURIComponent(id)}/reschedule-slots`, { params: { date }, signal });
  if (!data || data.date !== date || typeof data.timezone !== 'string' || !Array.isArray(data.slots)
    || data.slots.some((item: any) => !item || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) || typeof item.available !== 'boolean')) throw new Error('无法核对原预约行程的可用时段，请刷新核对。');
  return data;
}

export type OfflineMethod = 'CASH' | 'EXTERNAL_TERMINAL' | 'OTHER';
export interface SettlementEntry {
  id: string; kind: 'RECEIPT' | 'REVERSAL' | 'REFUND' | 'ZERO'; amountCents: number;
  method: OfflineMethod | null; occurredAt: string; createdAt: string; reason: string;
  referenceEntryId: string | null; canReverse: boolean;
}
export interface BookingSettlements {
  orderOnly?: boolean; onlinePaymentEnabled?: boolean; pricingPolicy?: 'PER_ORDER';
  bookingId: string; shopId: string; paymentMode: 'ONLINE' | 'PAY_AT_STORE' | 'ZERO'; currency: string;
  totalCents: number; paidCents: number; refundedCents: number; netPaidCents: number; amountDueCents: number;
  status: string; paymentStatus: string;
  allowedActions: { confirm: boolean; complete: boolean; cancel: boolean; recordReceipt: boolean; recordRefund: boolean };
  entries: SettlementEntry[];
}
export interface OfflineEntryInput { requestKey: string; amountCents: number; method: OfflineMethod; occurredAt: string; reason: string; }
function checkedSettlements(value: BookingSettlements, id: string, shopId: string) {
  if (!value || String(value.bookingId) !== id || String(value.shopId) !== shopId || !['ONLINE', 'PAY_AT_STORE', 'ZERO'].includes(value.paymentMode)
    || !value.currency || !Array.isArray(value.entries)
    || !['totalCents', 'paidCents', 'refundedCents', 'netPaidCents', 'amountDueCents'].every(key => Number.isSafeInteger(value[key as keyof BookingSettlements]))
    || !value.allowedActions || !['confirm', 'complete', 'cancel', 'recordReceipt', 'recordRefund'].every(key => typeof value.allowedActions[key as keyof BookingSettlements['allowedActions']] === 'boolean')) {
    throw new Error('无法核对当前门店和预约的结算资料，请刷新核对。');
  }
  return value;
}
export async function getBookingSettlements(id: string, shopId: string, signal?: AbortSignal): Promise<BookingSettlements> {
  const { data } = await client.get(`/bookings/${encodeURIComponent(id)}/settlements`, { signal });
  return checkedSettlements(data, id, shopId);
}
export async function recordOfflineReceipt(id: string, shopId: string, input: OfflineEntryInput, operationKey?: string): Promise<BookingSettlements> {
  const { data } = await client.post(`/bookings/${encodeURIComponent(id)}/offline-receipts`, input, bookingOperationHeaders(operationKey));
  return checkedSettlements(data, id, shopId);
}
export async function recordOfflineRefund(id: string, shopId: string, input: OfflineEntryInput, operationKey?: string): Promise<BookingSettlements> {
  const { data } = await client.post(`/bookings/${encodeURIComponent(id)}/offline-refunds`, input, bookingOperationHeaders(operationKey));
  return checkedSettlements(data, id, shopId);
}
export async function reverseOfflineReceipt(id: string, shopId: string, entryId: string, input: { requestKey: string; reason: string }, operationKey?: string): Promise<BookingSettlements> {
  const { data } = await client.post(`/bookings/${encodeURIComponent(id)}/offline-receipts/${encodeURIComponent(entryId)}/reverse`, input, bookingOperationHeaders(operationKey));
  return checkedSettlements(data, id, shopId);
}
export function settlementAmountCents(input: string): number {
  const value = input.trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(value)) throw new Error('金额最多保留两位小数。');
  const [whole, decimals = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 99999999) throw new Error('金额须在0.01至999999.99之间。');
  return cents;
}

import { shopLocal } from '../utils/reservationTime';

export interface GuestContact { name: string; phone: string; email: string | null }
export interface GuestBookingInput {
  contact: GuestContact; guestSource: 'PHONE' | 'WALK_IN'; serviceId: string; variantId?: string;
  date: string; startTime: string; preferredTherapistIds?: string[]; notes?: string;
}
export interface GuestBookingCommand extends GuestBookingInput { requestKey: string; quoteHash: string; quoteExpiresAt: string }
export interface GuestBookingQuote {
  quoteHash: string; quoteExpiresAt: string; totalCents: number; currency: string; durationMin: number;
  timezone: string; localDate: string; localStartTime: string; requestedTherapistIds: string[]; assignedTherapistIds: string[];
}
export interface GuestBookingReceipt { shopId: string; requestKey: string; outcome: 'COMMITTED'; result: { bookingId: string; bookingNo: string } }
export type GuestBookingOperation = GuestBookingReceipt | { shopId: string; requestKey: string; outcome: 'NOT_FOUND' | 'NOT_EXECUTED' };
export interface BookingTherapist { id: string; name: string }
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const controls = /[\p{Cc}\p{Cs}]/u;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00Z')) && new Date(value + 'T00:00Z').toISOString().slice(0, 10) === value;
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const fail = (): never => { throw new Error('无法核对首次客预约结果，原请求已保留，请查询并核对原请求。'); };
export function normalizeGuestContact(value: GuestContact): GuestContact {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!name || Array.from(name).length > 100 || controls.test(value.name)) throw new Error('请填写客人姓名（1–100个字符，不含控制字符）。');
  const originalPhone = typeof value.phone === 'string' ? value.phone.trim() : '', phone = originalPhone.replace(/[ ()-]/g, '');
  if (!/^\+[0-9 ()-]+$/.test(originalPhone) || !/^\+[1-9][0-9]{6,14}$/.test(phone) || controls.test(value.phone)) throw new Error('请填写以 + 和国家代码开头、含7–15位数字的国际电话号码。');
  const originalEmail = value.email == null ? '' : typeof value.email === 'string' ? value.email.trim() : '!';
  if (originalEmail && (originalEmail.length > 255 || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(originalEmail) || controls.test(value.email!))) throw new Error('请填写有效邮箱，或留空。');
  return { name, phone, email: originalEmail ? originalEmail.toLowerCase() : null };
}
export function checkedGuestInput(value: GuestBookingInput): GuestBookingInput {
  if (!value || !['PHONE', 'WALK_IN'].includes(value.guestSource) || !id(value.serviceId) || value.variantId !== undefined && !id(value.variantId)
    || !validDate(value.date) || !validTime(value.startTime)) throw new Error('请选择来访来源、真实服务／规格、门店当地日期和可用时间。');
  const preferred = value.preferredTherapistIds ?? [];
  if (!Array.isArray(preferred) || preferred.length > 2 || preferred.some(item => !id(item)) || new Set(preferred).size !== preferred.length) throw new Error('请选择本店可提供该服务的技师，或选择无偏好。');
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.notes))) throw new Error('备注最多500字，不得包含控制字符。');
  return { contact: normalizeGuestContact(value.contact), guestSource: value.guestSource, serviceId: value.serviceId,
    ...(value.variantId ? { variantId: value.variantId } : {}), date: value.date, startTime: value.startTime,
    preferredTherapistIds: [...preferred], ...(value.notes?.trim() ? { notes: value.notes.trim() } : {}) };
}
export function checkedGuestCommand(value: GuestBookingCommand): GuestBookingCommand {
  const input = checkedGuestInput(value);
  if (!uuid(value.requestKey) || !/^[a-f0-9]{64}$/.test(value.quoteHash) || typeof value.quoteExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.quoteExpiresAt))) throw new Error('预约报价或请求编号无效，请先重新核价。');
  return { ...input, requestKey: value.requestKey, quoteHash: value.quoteHash, quoteExpiresAt: value.quoteExpiresAt };
}
export function requireGuestQuote(value: any, input: GuestBookingInput): GuestBookingQuote {
  const preferred = input.preferredTherapistIds ?? [];
  if (!value || !/^[a-f0-9]{64}$/.test(value.quoteHash) || typeof value.quoteExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.quoteExpiresAt))
    || !Number.isSafeInteger(value.totalCents) || value.totalCents < 0 || !/^[a-z]{3}$/i.test(value.currency) || !Number.isSafeInteger(value.durationMin) || value.durationMin < 1
    || typeof value.timezone !== 'string' || value.localDate !== input.date || value.localStartTime !== input.startTime
    || !Array.isArray(value.requestedTherapistIds) || !Array.isArray(value.assignedTherapistIds)
    || value.requestedTherapistIds.some((item: unknown) => !id(item)) || value.assignedTherapistIds.some((item: unknown) => !id(item))
    || [...preferred].sort().join(',') !== [...value.requestedTherapistIds].sort().join(',') || preferred.some(item => !value.assignedTherapistIds.includes(item))) return fail();
  shopLocal(new Date().toISOString(), value.timezone);
  return { quoteHash: value.quoteHash, quoteExpiresAt: value.quoteExpiresAt, totalCents: value.totalCents, currency: value.currency,
    durationMin: value.durationMin, timezone: value.timezone, localDate: value.localDate, localStartTime: value.localStartTime,
    requestedTherapistIds: [...value.requestedTherapistIds], assignedTherapistIds: [...value.assignedTherapistIds] };
}
export function requireGuestOperation(value: any, shopId: string, command: Pick<GuestBookingCommand, 'requestKey'>, settled = false): GuestBookingOperation {
  if (!value || value.shopId !== shopId || value.requestKey !== command.requestKey) return fail();
  if (value.outcome === 'NOT_EXECUTED' || !settled && value.outcome === 'NOT_FOUND') return { shopId, requestKey: command.requestKey, outcome: value.outcome };
  if (value.outcome !== 'COMMITTED' || !id(value.result?.bookingId) || typeof value.result.bookingNo !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.result.bookingNo)) return fail();
  return { shopId, requestKey: command.requestKey, outcome: 'COMMITTED', result: { bookingId: value.result.bookingId, bookingNo: value.result.bookingNo } };
}
const base = (shopId: string) => `/merchant/shops/${encodeURIComponent(shopId)}`;
export async function quoteGuestBooking(shopId: string, input: GuestBookingInput) { const checked = checkedGuestInput(input); const { data } = await client.post(base(shopId) + '/guest-assisted-quote', checked); return requireGuestQuote(data, checked); }
export async function createGuestBooking(shopId: string, command: GuestBookingCommand): Promise<GuestBookingReceipt> { const checked = checkedGuestCommand(command); const { data } = await client.post(base(shopId) + '/guest-assisted-bookings', checked); const result = requireGuestOperation(data, shopId, checked, true); if (result.outcome !== 'COMMITTED') return fail(); return result; }
export async function queryGuestBooking(shopId: string, command: GuestBookingCommand) { const { data } = await client.get(base(shopId) + '/guest-assisted-bookings/operations/' + encodeURIComponent(command.requestKey)); return requireGuestOperation(data, shopId, command); }
export async function reconcileGuestBooking(shopId: string, command: GuestBookingCommand) { const { data } = await client.post(base(shopId) + '/guest-assisted-bookings/operations/' + encodeURIComponent(command.requestKey) + '/reconcile', {}); return requireGuestOperation(data, shopId, command, true); }
export async function getBookingTherapists(shopId: string, signal?: AbortSignal): Promise<BookingTherapist[]> {
  const { data } = await client.get(base(shopId) + '/booking-therapists', { signal });
  if (!Array.isArray(data) || data.some((row: any) => !id(row?.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200)) throw new Error('无法读取本店该服务可选技师。');
  return data.map((row: any) => ({ id: row.id, name: row.name }));
}
export async function getGuestBookingSlots(shopId: string, input: Pick<GuestBookingInput, 'serviceId' | 'variantId' | 'date' | 'preferredTherapistIds'>, signal?: AbortSignal): Promise<{ timezone: string; durationMin: number; slots: { time: string; available: boolean }[] }> {
  const { data } = await client.get(base(shopId) + '/assisted-slots', { params: { serviceId: input.serviceId, date: input.date, ...(input.variantId ? { variantId: input.variantId } : {}), ...(input.preferredTherapistIds?.length ? { preferredTherapistIds: input.preferredTherapistIds.join(',') } : {}) }, signal });
  if (!data || data.date !== input.date || typeof data.timezone !== 'string' || !Number.isSafeInteger(data.durationMin) || data.durationMin < 1 || !Array.isArray(data.slots)
    || data.slots.some((slot: any) => !validTime(slot?.time) || typeof slot.available !== 'boolean')) throw new Error('无法核对本店服务和技师的可用时段。');
  shopLocal(new Date().toISOString(), data.timezone);
  return { timezone: data.timezone as string, durationMin: data.durationMin as number, slots: data.slots.map((slot: any) => ({ time: slot.time as string, available: slot.available as boolean })) };
}
