export const ORDER_EMAIL_STATUSES = ['QUEUED','PROCESSING','ACCEPTED','NOT_CONFIGURED','FAILED','ACCEPTANCE_UNKNOWN','CANCELLED','NOT_REQUESTED'] as const;
export type OrderEmailStatus = typeof ORDER_EMAIL_STATUSES[number];
export function orderEmailTaskStatus(row: { status: string; lastErrorCode?: string | null }, enabled: boolean): OrderEmailStatus {
  if (row.lastErrorCode === 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN') return 'ACCEPTANCE_UNKNOWN';
  if (row.status === 'ACCEPTED') return 'ACCEPTED';
  if (row.status === 'CANCELLED') return 'CANCELLED';
  if (row.status === 'PROCESSING') return 'PROCESSING';
  if (row.status === 'PENDING') return enabled ? 'QUEUED' : 'NOT_CONFIGURED';
  if (row.lastErrorCode === 'ORDER_EMAIL_NOT_CONFIGURED') return 'NOT_CONFIGURED';
  return 'FAILED';
}
export function canRetryNotification(row: { channel: string; status: string; retryCount: number; lastErrorCode?: string | null }, limit: number) {
  if (row.retryCount >= limit) return false;
  if (row.channel !== 'EMAIL') return ['FAILED','SKIPPED'].includes(row.status);
  return ['FAILED','SKIPPED','BLOCKED'].includes(row.status)
    && ['ORDER_EMAIL_NOT_CONFIGURED','ORDER_EMAIL_RATE_LIMITED','ORDER_EMAIL_PROVIDER_REJECTED','ORDER_EMAIL_RECIPIENT_UNAVAILABLE'].includes(row.lastErrorCode ?? '');
}
