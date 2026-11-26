import { NotificationTopic } from '../../common/notification-outbox';

export const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'PUBLISHED', 'ACCEPTED', 'FAILED', 'SKIPPED', 'CANCELLED', 'BLOCKED'] as const;
export const MAX_MANUAL_RETRIES = 3;
export function retryAt(attempt: number, now: Date) { return new Date(now.getTime() + Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1)) * 1000); }
/** A timeout is ambiguous acceptance, so never automatically repeat that external attempt. */
export async function boundedPush<T>(send: (signal: AbortSignal) => Promise<T>, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([send(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('PUSH_ACCEPTANCE_UNKNOWN')); }, timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export function notificationText(topic: NotificationTopic): { title: string; body: string } {
  const templates: Record<NotificationTopic, [string, string]> = {
    BOOKING_CREATED: ['Booking created', 'Open your booking for its time, payment method and current status.'],
    BOOKING_CONFIRMED: ['Booking confirmed', 'Your appointment is confirmed. Check the shop-local time in booking details.'],
    BOOKING_RESCHEDULED: ['Booking rescheduled', 'Your appointment has changed. Check the latest time in booking details.'],
    BOOKING_CANCELLED: ['Booking cancelled', 'Your appointment is cancelled. Check refund status separately.'],
    BOOKING_REMINDER: ['Appointment reminder', 'Your confirmed appointment starts soon. Check its latest details.'],
    BOOKING_COMPLETED: ['Visit completed', 'The service status has been updated in your booking.'],
    PAYMENT_RECEIVED: ['Payment recorded', 'The payment record was updated. Check your order ledger.'],
    REFUND_PROCESSED: ['Refund processed', 'Open your booking to review the refund record and current status.'],
    GIFT_PURCHASED: ['Gift available', 'Check your gift card for its payment and entitlement status.'],
    GIFT_REFUNDED: ['Gift refund processed', 'Check your gift card for the updated refund and entitlement status.'],
    GIFT_GRANTED: ['Gift granted', 'You received a promotional entitlement, not a paid purchase.'],
    GIFT_REDEEMED: ['Gift redeemed', 'Your gift usage has changed. Check the remaining uses.'],
    GIFT_VOIDED: ['Gift voided', 'Your promotional entitlement has been voided.'],
    AFTER_SALES_UPDATED: ['Support case updated', 'Check your support case for an update.'],
  };
  const value = templates[topic];
  if (!value) throw new Error('UNKNOWN_NOTIFICATION_TOPIC');
  return { title: value[0], body: value[1] };
}
export interface PushResult { sent?: number; failed?: number; error?: string }
export function pushOutcome(result: PushResult) {
  // Partial provider acceptance is terminal: retrying all devices could duplicate already accepted messages.
  if ((result.sent ?? 0) > 0) return { status: 'ACCEPTED', code: result.failed ? 'PUSH_PARTIAL_ACCEPTANCE' : null, accepted: result.sent! };
  if (result.error === 'PUSH_NOT_CONFIGURED' || result.error === 'NO_REGISTERED_DEVICE') return { status: 'SKIPPED', code: result.error, accepted: 0 };
  return { status: 'FAILED', code: 'PUSH_PROVIDER_REJECTED', accepted: 0 };
}
