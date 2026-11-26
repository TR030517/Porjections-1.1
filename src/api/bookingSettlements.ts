import { apiRequest, ApiError } from './session';
import { bookingOperationHeaders } from './bookingOperations';

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
export interface OfflineEntryInput {
  requestKey: string; amountCents: number; method: OfflineMethod; occurredAt: string; reason: string;
}
function checked(value: BookingSettlements, bookingId: string) {
  if (!value || String(value.bookingId) !== bookingId || !['ONLINE', 'PAY_AT_STORE', 'ZERO'].includes(value.paymentMode)
    || typeof value.currency !== 'string' || !value.currency || !Array.isArray(value.entries)
    || !['totalCents', 'paidCents', 'refundedCents', 'netPaidCents', 'amountDueCents'].every(key => Number.isSafeInteger(value[key as keyof BookingSettlements]))
    || !value.allowedActions || !['confirm', 'complete', 'cancel', 'recordReceipt', 'recordRefund'].every(key => typeof value.allowedActions[key as keyof BookingSettlements['allowedActions']] === 'boolean')) {
    throw new ApiError('收款资料返回格式无效，请重新加载核对。');
  }
  return value;
}
const base = (id: string) => '/bookings/' + encodeURIComponent(id);
export async function getBookingSettlements(id: string, signal?: AbortSignal) {
  return checked(await apiRequest<BookingSettlements>(base(id) + '/settlements', { signal }), id);
}
export async function recordOfflineReceipt(id: string, input: OfflineEntryInput, operationKey?: string) {
  return checked(await apiRequest<BookingSettlements>(base(id) + '/offline-receipts', { method: 'POST', headers: bookingOperationHeaders(operationKey), body: JSON.stringify(input) }), id);
}
export async function recordOfflineRefund(id: string, input: OfflineEntryInput, operationKey?: string) {
  return checked(await apiRequest<BookingSettlements>(base(id) + '/offline-refunds', { method: 'POST', headers: bookingOperationHeaders(operationKey), body: JSON.stringify(input) }), id);
}
export async function reverseOfflineReceipt(id: string, entryId: string, input: { requestKey: string; reason: string }, operationKey?: string) {
  return checked(await apiRequest<BookingSettlements>(base(id) + '/offline-receipts/' + encodeURIComponent(entryId) + '/reverse', { method: 'POST', headers: bookingOperationHeaders(operationKey), body: JSON.stringify(input) }), id);
}
export function settlementAmountCents(input: string) {
  const value = input.trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(value)) throw new Error('请输入有效金额，最多两位小数。');
  const [whole, decimals = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 99999999) throw new Error('金额须在 0.01–999999.99 之间。');
  return cents;
}
