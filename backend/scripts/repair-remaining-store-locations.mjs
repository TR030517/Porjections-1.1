import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import legacySql from './lib/legacy-sql.cjs';
import { EXPECTED_DATABASE, locationSelect, localRepairUrl, planDigest } from './store-location-repair-plan.mjs';
import { remainingLocationPlan, applyRemainingLocationPlan } from './remaining-store-location-plan.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
const argument = prefix => [...args].find(value => value.startsWith(prefix))?.slice(prefix.length);
const json = value => JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry, 2);

async function main() {
  const apply = args.has('--apply');
  if (apply !== args.has('--acknowledge-local-only')) throw new Error('Apply requires --apply --acknowledge-local-only');
  for (const arg of args) if (!['--apply', '--acknowledge-local-only', '--generate-address-map-links'].includes(arg)
    && !['--expected-digest=', '--report='].some(prefix => arg.startsWith(prefix))) throw new Error('Unknown argument: ' + arg);
  const sourcePath = path.join(projectRoot, '.local/legacy-store-import-20261105/source-without-platform-stats.sql');
  const sourceSql = fs.readFileSync(sourcePath, 'utf8');
  const sourceSha256 = crypto.createHash('sha256').update(sourceSql).digest('hex');
  const sourceRows = legacySql.tableRows(sourceSql, 'merchant');
  const target = new PrismaClient({ datasources: { db: { url: localRepairUrl(process.env.DATABASE_URL) } } });
  try {
    const identity = await target.$queryRaw`SELECT DATABASE() AS name`;
    if (identity[0]?.name !== EXPECTED_DATABASE) throw new Error('Database identity check failed');
    const shops = await target.shop.findMany({ select: { ...locationSelect, name: true, status: true, deletedAt: true }, orderBy: { id: 'asc' } });
    if (shops.length !== 1335 || shops.some(shop => shop.status !== 'APPROVED' || shop.deletedAt)) throw new Error('Expected exactly 1335 approved, undeleted stores; no writes were made');
    const plan = remainingLocationPlan(shops, sourceRows, { generateAddressMapLinks: args.has('--generate-address-map-links') });
    const digest = planDigest({ sourceSha256, changes: plan.changes });
    const summary = { mode: apply ? 'apply' : 'dry-run', database: EXPECTED_DATABASE, stores: shops.length, sourceRows: sourceRows.length, sourceSha256,
      plannedStores: plan.changes.length, provenance: plan.provenance, before: plan.before, after: plan.after,
      changes: plan.changes.map(({ before, data, evidence }) => ({ id: String(before.id), name: before.name,
        sourceShopId: String(before.studioProfile.legacyImport.sourceShopId),
        before: { address: before.address, city: before.city, state: before.state, zipCode: before.zipCode, timezone: before.timezone, mapShareUrl: before.studioProfile?.mapShareUrl },
        fill: { ...data, ...(data.studioProfile ? { studioProfile: undefined, mapShareUrl: data.studioProfile.mapShareUrl, mapShareUrlSource: data.studioProfile.mapShareUrlSource } : {}) }, evidence })),
      skipped: plan.skipped, missingSourceMapIds: plan.missingSourceMapIds, digest };
    if (apply) {
      if (argument('--expected-digest=') !== digest) throw new Error('Exact dry-run --expected-digest required; no writes were made');
      const backupPath = path.join(projectRoot, '.local', 'remaining-location-before-' + digest + '.json');
      // Refuse to replace a preimage backup. It includes the full profile for a
      // manual restore and is intentionally excluded from version control.
      fs.writeFileSync(backupPath, json({ database: EXPECTED_DATABASE, sourceSha256, digest,
        capturedAt: new Date().toISOString(), changes: plan.changes }), { flag: 'wx', mode: 0o600 });
      summary.backup = backupPath;
      await applyRemainingLocationPlan(target, plan.changes);
      summary.updatedStores = plan.changes.length;
    }
    if (argument('--report=')) fs.writeFileSync(path.resolve(argument('--report=')), json(summary) + '\n');
    process.stdout.write(json(summary) + '\n');
  } finally { await target.$disconnect(); }
}

main().catch(error => { process.stderr.write('Remaining location repair failed: ' + String(error?.message || 'unknown error').replace(/[\r\n]/g, ' ') + '\n'); process.exitCode = 1; });
