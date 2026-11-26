import client from './client';

export const bookingOperationActions = ['STATUS:CONFIRMED', 'STATUS:COMPLETED', 'STATUS:CANCELLED', 'RESCHEDULE', 'OFFLINE:RECEIPT', 'OFFLINE:REFUND', 'OFFLINE:REVERSAL'] as const;
export type BookingOperationAction = typeof bookingOperationActions[number];
export interface BookingOperationAttempt { requestKey: string; action: BookingOperationAction }
export interface BookingOperationOutcome {
  bookingId: string; shopId: string; requestKey: string;
  outcome: 'COMMITTED' | 'NOT_EXECUTED'; action: BookingOperationAction | null;
}
export async function reconcileBookingOperation(id: string, shopId: string, attempt: BookingOperationAttempt): Promise<BookingOperationOutcome> {
  const { data } = await client.post(`/bookings/${encodeURIComponent(id)}/operations/${encodeURIComponent(attempt.requestKey)}/reconcile`, {});
  if (!data || data.bookingId !== id || data.shopId !== shopId || data.requestKey !== attempt.requestKey
    || !(data.outcome === 'COMMITTED' && data.action === attempt.action || data.outcome === 'NOT_EXECUTED' && data.action === null)) {
    throw new Error('无法核对原操作结果，请保留只读状态并重新核对。');
  }
  return data;
}
export function bookingOperationHeaders(requestKey?: string) {
  return requestKey ? { headers: { 'Idempotency-Key': requestKey } } : undefined;
}
export function checkBookingOperationReceipt(value: unknown, id: string, expected: { status?: string; date?: string; startTime?: string; cancelReason?: string }) {
  const row = value as { id?: string; status?: string; localDate?: string; localStartTime?: string; cancelReason?: string | null } | null;
  if (!row || String(row.id) !== id || expected.status !== undefined && row.status !== expected.status
    || expected.date !== undefined && row.localDate !== expected.date || expected.startTime !== undefined && row.localStartTime !== expected.startTime
    || expected.cancelReason !== undefined && row.cancelReason !== expected.cancelReason) {
    throw new Error('操作回执与原订单或提交内容不匹配，请核对原操作结果。');
  }
}
