import { PrismaClient } from '@prisma/client';
import { EXPECTED_DATABASE, locationSelect, localRepairUrl, planDigest, timezoneBackfillPlan, applyLocationPlan } from './store-location-repair-plan.mjs';

const args = new Set(process.argv.slice(2));

async function main() {
  const apply = args.has('--apply');
  if (apply !== args.has('--acknowledge-local-only')) throw new Error('Apply requires --apply --acknowledge-local-only');
  const target = new PrismaClient({ datasources: { db: { url: localRepairUrl(process.env.DATABASE_URL) } } });
  try {
    const actualDatabase = await target.$queryRaw`SELECT DATABASE() AS name`;
    if (String(actualDatabase[0]?.name || '') !== EXPECTED_DATABASE) throw new Error('Database identity check failed; no writes were made');
    const shops = await target.shop.findMany({ select: locationSelect, orderBy: { id: 'asc' } });
    const overwriteExisting = args.has('--overwrite-existing');
    const plan = timezoneBackfillPlan(shops, { overwriteExisting });
    const digest = planDigest(plan.changes);
    const summary = { mode: apply ? 'apply' : 'dry-run', policy: overwriteExisting ? 'explicit-overwrite' : 'fill-empty-only', shops: shops.length,
      planned: plan.changes.length, preservedExisting: plan.preserved, unchanged: plan.unchanged, unresolved: plan.unresolved.length,
      unresolvedIds: plan.unresolved, addressConflictIds: plan.conflicts, digest };
    if (apply) {
      if (!args.has('--expected-digest=' + digest)) throw new Error('Apply requires the exact --expected-digest from the dry-run; no writes were made');
      await applyLocationPlan(target, plan.changes);
    }
    process.stdout.write(JSON.stringify(summary) + '\n');
  } finally { await target.$disconnect(); }
}

main().catch(error => { process.stderr.write('Store timezone backfill failed: ' + String(error?.message || 'unknown error').replace(/[\r\n]/g, ' ') + '\n'); process.exitCode = 1; });
