import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import legacySql from './lib/legacy-sql.cjs';
import { EXPECTED_DATABASE, localRepairUrl, planDigest } from './store-location-repair-plan.mjs';
import { COMPLETION_POLICY_ID, DEFAULT_COMPLETION_POLICY, completionSelect, provisionalStoreCompletionPlan, applyProvisionalCompletion, canonical } from './provisional-store-completion-plan.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2)), argument = prefix => [...args].find(value => value.startsWith(prefix))?.slice(prefix.length);
const json = value => JSON.stringify(canonical(value), null, 2) + '\n';
const policyFlags = { '--default-state=': 'state', '--default-city=': 'city', '--default-address=': 'address', '--default-zip=': 'zipCode', '--default-timezone=': 'timezone' };

async function main() {
  const apply = args.has('--apply');
  if (apply !== args.has('--acknowledge-local-only')) throw Error('Apply requires --apply --acknowledge-local-only');
  for (const arg of args) if (!['--apply', '--acknowledge-local-only'].includes(arg)
    && !['--expected-digest=', '--report=', ...Object.keys(policyFlags)].some(prefix => arg.startsWith(prefix))) throw Error('Unknown argument: ' + arg);
  const report = argument('--report=') === undefined ? null : path.resolve(argument('--report='));
  if (report && !report.toLowerCase().startsWith((path.join(projectRoot, '.local') + path.sep).toLowerCase())) throw Error('Reports contain internal preimages and must stay inside this project .local directory');
  const policy = { ...DEFAULT_COMPLETION_POLICY, ...Object.fromEntries(Object.entries(policyFlags).flatMap(([flag, key]) => argument(flag) === undefined ? [] : [[key, argument(flag)]])) };
  const sourcePath = path.join(projectRoot, '.local/legacy-store-import-20261105/source-without-platform-stats.sql');
  const sourceSql = fs.readFileSync(sourcePath, 'utf8'), sourceSha256 = crypto.createHash('sha256').update(sourceSql).digest('hex');
  const sourceRows = legacySql.tableRows(sourceSql, 'merchant');
  const target = new PrismaClient({ datasources: { db: { url: localRepairUrl(process.env.DATABASE_URL) } } });
  try {
    const actual = await target.$queryRaw`SELECT DATABASE() AS name`;
    if (actual[0]?.name !== EXPECTED_DATABASE) throw Error('Database identity check failed');
    const shops = await target.shop.findMany({ select: completionSelect, orderBy: { id: 'asc' } });
    if (shops.length !== 1335 || shops.some(shop => shop.status !== 'APPROVED' || shop.deletedAt)) throw Error('Expected exactly 1335 approved, undeleted stores');
    const now = new Date(), [bookings, locks] = await Promise.all([
      target.booking.groupBy({ by: ['shopId'], where: { deletedAt: null, status: { in: ['PENDING', 'CONFIRMED'] }, endTime: { gt: now } }, _count: { _all: true } }),
      target.bookingResourceLock.groupBy({ by: ['shopId'], where: { status: 'ACTIVE', endAtUtc: { gt: now } }, _count: { _all: true } }),
    ]);
    const guards = new Map(shops.map(shop => [String(shop.id), { futureBookings: 0, activeLocks: 0 }]));
    for (const row of bookings) guards.get(String(row.shopId)).futureBookings = row._count._all;
    for (const row of locks) guards.get(String(row.shopId)).activeLocks = row._count._all;
    const plan = provisionalStoreCompletionPlan(shops, sourceRows, guards, policy);
    const digest = planDigest(canonical({ policyId: COMPLETION_POLICY_ID, policy, sourceSha256, changes: plan.changes }));
    const summary = { mode: apply ? 'apply' : 'dry-run', database: EXPECTED_DATABASE, port: 33090, stores: shops.length, policyId: COMPLETION_POLICY_ID,
      policy, sourceSha256, plannedStores: plan.changes.length, counts: plan.counts, before: plan.before, after: plan.after, digest,
      skipped: plan.skipped, examples: plan.changes.slice(0, 8).map(change => ({ id: String(change.before.id), name: change.before.name,
        fields: Object.keys(change.data.studioProfile.provisionalCompletion.fields), newStaff: change.createTherapists.length })) };
    if (apply) {
      if (argument('--expected-digest=') !== digest) throw Error('Exact dry-run --expected-digest required; no writes were made');
      const backup = path.join(projectRoot, '.local', 'provisional-defaults-before-' + digest + '.json');
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, json({ database: EXPECTED_DATABASE, sourceSha256, digest, capturedAt: new Date().toISOString(), policy, changes: plan.changes }), { flag: 'wx', mode: 0o600 });
      summary.backup = backup;
      summary.applied = await applyProvisionalCompletion(target, plan);
    }
    if (report) {
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(report, json({ ...summary, changes: plan.changes }), { mode: 0o600 });
    }
    process.stdout.write(json(summary));
  } finally { await target.$disconnect(); }
}
main().catch(error => { process.stderr.write('Local provisional completion failed: ' + String(error?.message || 'unknown error').replace(/[\r\n]/g, ' ') + '\n'); process.exitCode = 1; });
