import { PrismaClient } from '@prisma/client';
import { EXPECTED_DATABASE, locationSelect, localRepairUrl, planDigest, confirmedLocationRepairPlan, applyLocationPlan } from './store-location-repair-plan.mjs';

const args = new Set(process.argv.slice(2));

async function main() {
  const apply = args.has('--apply');
  if (apply !== args.has('--acknowledge-local-only')) throw new Error('Apply requires --apply --acknowledge-local-only');
  const target = new PrismaClient({ datasources: { db: { url: localRepairUrl(process.env.DATABASE_URL) } } });
  try {
    const identity = await target.$queryRaw`SELECT DATABASE() AS name`;
    if (identity[0]?.name !== EXPECTED_DATABASE) throw new Error('Database identity check failed; no writes were made');
    const shops = await target.shop.findMany({ select: locationSelect, orderBy: { id: 'asc' } });
    const repairKnownTimezones = args.has('--repair-known-migration-timezones');
    const plan = confirmedLocationRepairPlan(shops, { repairKnownTimezones });
    const digest = planDigest(plan.changes);
    const summary = { mode: apply ? 'apply' : 'dry-run', shops: shops.length, repairKnownTimezones, planned: plan.changes.length,
      changes: plan.changes.map(({ before, data }) => ({ id: String(before.id), city: before.city, zipCode: before.zipCode,
        oldState: before.state, oldTimezone: before.timezone, ...data })),
      unresolvedConflictIds: plan.conflicts, preservedTimezones: plan.preservedTimezones, digest };
    if (apply) {
      if (!args.has('--expected-digest=' + digest)) throw new Error('Apply requires the exact --expected-digest from the dry-run; no writes were made');
      await applyLocationPlan(target, plan.changes);
    }
    process.stdout.write(JSON.stringify(summary) + '\n');
  } finally { await target.$disconnect(); }
}

main().catch(error => { process.stderr.write('Confirmed location repair failed: ' + String(error?.message || 'unknown error').replace(/[\r\n]/g, ' ') + '\n'); process.exitCode = 1; });
