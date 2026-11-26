// Read-only operational projection. No recipient, event payload, credential,
// provider error text or resource identity is selected or returned.
const DEFAULT_THRESHOLDS = Object.freeze({ dueBacklog: 100, oldestDueSeconds: 300, failed: 1, acceptanceUnknown: 1, expiredProcessing: 1 });

async function notificationQueueHealth(prisma, { thresholds = {}, ownerLabel = '' } = {}) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  if (Object.keys(limits).some(key => !Object.hasOwn(DEFAULT_THRESHOLDS, key) || !Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > 10000000)) throw Error('INVALID_QUEUE_HEALTH_THRESHOLDS');
  if (ownerLabel && !/^[A-Za-z0-9_-]{1,64}$/.test(ownerLabel)) throw Error('INVALID_QUEUE_HEALTH_OWNER_LABEL');
  const rows = await prisma.$queryRawUnsafe(`SELECT NOW(3) AS sampledAt, COUNT(*) AS total,
    COALESCE(SUM(status='PENDING'),0) AS pending,
    COALESCE(SUM(status='PENDING' AND run_at<=NOW(3)),0) AS due,
    COALESCE(SUM(status='PROCESSING'),0) AS processing,
    COALESCE(SUM(status='PROCESSING' AND lease_until<=NOW(3)),0) AS expiredProcessing,
    COALESCE(SUM(status='FAILED'),0) AS failed,
    COALESCE(SUM(status='BLOCKED'),0) AS blocked,
    COALESCE(SUM(last_error_code='ORDER_EMAIL_ACCEPTANCE_UNKNOWN' OR last_error_code='PUSH_ACCEPTANCE_UNKNOWN'),0) AS acceptanceUnknown,
    COALESCE(MAX(CASE WHEN status='PENDING' AND run_at<=NOW(3) THEN TIMESTAMPDIFF(SECOND,run_at,NOW(3)) ELSE 0 END),0) AS oldestDueSeconds
    FROM notification_outbox`);
  const row = rows[0];
  const counts = Object.fromEntries(['total', 'pending', 'due', 'processing', 'expiredProcessing', 'failed', 'blocked', 'acceptanceUnknown', 'oldestDueSeconds'].map(key => [key, Number(row[key])]));
  const alerts = [];
  for (const [metric, threshold, code] of [
    ['due', limits.dueBacklog, 'NOTIFICATION_DUE_BACKLOG'],
    ['oldestDueSeconds', limits.oldestDueSeconds, 'NOTIFICATION_OLDEST_DUE_TOO_OLD'],
    ['failed', limits.failed, 'NOTIFICATION_FAILED_TASKS'],
    ['acceptanceUnknown', limits.acceptanceUnknown, 'NOTIFICATION_ACCEPTANCE_UNKNOWN_REQUIRES_PROVIDER_REVIEW'],
    ['expiredProcessing', limits.expiredProcessing, 'NOTIFICATION_EXPIRED_PROCESSING_LEASE'],
  ]) if (counts[metric] >= threshold) alerts.push({ code, metric, observed: counts[metric], threshold });
  if (!ownerLabel) alerts.push({ code: 'NOTIFICATION_ALERT_OWNER_UNASSIGNED' });
  return { sampledAt: new Date(row.sampledAt).toISOString(), status: alerts.length ? 'ATTENTION_REQUIRED' : 'HEALTHY',
    counts, thresholds: limits, ownerConfigured: !!ownerLabel, ownerLabel: ownerLabel || null,
    alerts, readOnly: true, actualDeliveryConfirmed: false,
    unknownPolicy: 'CHECK_PROVIDER_RECEIPT_WITH_STABLE_KEY_BEFORE_ANY_RECONCILIATION;DO_NOT_BLINDLY_RESEND' };
}

module.exports = { DEFAULT_THRESHOLDS, notificationQueueHealth };
