import { normalizeSavedBooking } from '../utils/serviceDuration';
import { apiRequest, ApiError } from './session';
import type { BookingDetail, BookingRescheduleSlots } from '../types/bookingDetails';
import { bookingOperationHeaders } from './bookingOperations';

type BookingStatusChange =
  | { status: 'CONFIRMED' | 'COMPLETED' }
  | { status: 'CANCELLED'; cancelReason: string };

export function updateBookingStatus(id: string, change: BookingStatusChange, requestKey: string): Promise<BookingDetail> {
  return apiRequest<BookingDetail>(`/bookings/${encodeURIComponent(id)}/status?status=${change.status}`, {
    method: 'PATCH',
    headers: bookingOperationHeaders(requestKey),
    body: change.status === 'CANCELLED' ? JSON.stringify({ cancelReason: change.cancelReason }) : undefined,
  });
}

export function rescheduleBooking(id: string, input: { date: string; startTime: string }, requestKey?: string): Promise<BookingDetail> {
  return apiRequest<BookingDetail>(`/bookings/${encodeURIComponent(id)}/reschedule`, { method: 'POST', headers: bookingOperationHeaders(requestKey), body: JSON.stringify({ date: input.date, startTime: input.startTime }) }).then(normalizeSavedBooking);
}

export async function getBookingRescheduleSlots(id: string, date: string, signal?: AbortSignal): Promise<BookingRescheduleSlots> {
  const data = await apiRequest<BookingRescheduleSlots>(`/bookings/${encodeURIComponent(id)}/reschedule-slots?` + new URLSearchParams({ date }), { signal });
  if (!data || data.date !== date || typeof data.timezone !== 'string' || !Array.isArray(data.slots)
    || data.slots.some(item => !item || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) || typeof item.available !== 'boolean')) throw new ApiError('改期时段返回格式无效，请重新加载。');
  return data;
}
