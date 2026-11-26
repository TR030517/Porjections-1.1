// A scheduler may collect this JSON / exit code. This CLI never sends alerts,
// retries a task, changes a lease or claims to replace an on-call integration.
const { notificationQueueHealth } = require('./lib/notification-queue-health.cjs');

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Read-only notification queue health. Set DATABASE_URL and NOTIFICATION_ALERT_OWNER (operator label). Optional NOTIFICATION_ALERT_THRESHOLDS is a JSON object. Exit: 0 healthy, 2 attention, 1 configuration/database error. No tasks are changed or resent.');
    return 0;
  }
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const thresholds = process.env.NOTIFICATION_ALERT_THRESHOLDS ? JSON.parse(process.env.NOTIFICATION_ALERT_THRESHOLDS) : {};
    if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) throw Error('INVALID_THRESHOLDS');
    const result = await notificationQueueHealth(prisma, { thresholds, ownerLabel: process.env.NOTIFICATION_ALERT_OWNER || '' });
    console.log(JSON.stringify(result));
    return result.alerts.length ? 2 : 0;
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  console.error('Notification queue health unavailable. Verify configuration and read-only database access. No task was changed.'); process.exitCode = 1;
});
module.exports = { main };
