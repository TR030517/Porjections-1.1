import { apiRequest, ApiError } from './session';

export type BookingOperationAction = 'STATUS:CONFIRMED' | 'STATUS:COMPLETED' | 'STATUS:CANCELLED' | 'RESCHEDULE' | 'OFFLINE:RECEIPT' | 'OFFLINE:REFUND' | 'OFFLINE:REVERSAL';
export interface BookingOperationOutcome {
  bookingId: string; shopId: string; requestKey: string;
  outcome: 'COMMITTED' | 'NOT_EXECUTED'; action: BookingOperationAction | null;
}
const requestKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;
export function bookingOperationHeaders(requestKey?: string): HeadersInit | undefined {
  if (requestKey === undefined) return undefined;
  if (!requestKeyPattern.test(requestKey)) throw new ApiError('订单操作编号无效，请保留原操作并重新核对。');
  return { 'Idempotency-Key': requestKey };
}
/** A missing command is sealed by the server so that a delayed original cannot run. */
export async function reconcileBookingOperation(bookingId: string, shopId: string, requestKey: string, action: BookingOperationAction): Promise<BookingOperationOutcome> {
  bookingOperationHeaders(requestKey);
  const result = await apiRequest<BookingOperationOutcome>(`/bookings/${encodeURIComponent(bookingId)}/operations/${encodeURIComponent(requestKey)}/reconcile`, { method: 'POST' });
  if (!result || result.bookingId !== bookingId || result.shopId !== shopId || result.requestKey !== requestKey
    || !(result.outcome === 'COMMITTED' && result.action === action || result.outcome === 'NOT_EXECUTED' && result.action === null)) {
    throw new ApiError('原操作核对回执不匹配，请继续保留订单只读状态。');
  }
  return result;
}
