// Separate reviewed main-local entry. Default QA entry and all old guards stay
// unchanged; this command has no rollback mode and selects only store 919.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import legacySql from './lib/legacy-sql.cjs';
import { MAIN_TARGET, SOURCE_SHA256, SHOP_ID, SOURCE_ID, mainRepairUrl, verifyRuntimeScalarFields,
  mainAddressFormatPlan, executeMainAddressFormatPlan, canonical } from './store-address-format-repair-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scope = path.join(root, '.local/store-address-format-repair-20261110');
const SEALED_SNAPSHOT_SHA256 = '3ba19ac0dbed99c1b4ada948658230de877fa861155ec541942700d0e28261ec';
const args = process.argv.slice(2);
const option = name => args.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(canonical(value), null, 2) + '\n';
function privatePath(value) {
  const resolved = path.resolve(value), relative = path.relative(scope, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !resolved.endsWith('.private.json')) throw Error('ADDRESS_FORMAT_MAIN_PRIVATE_SCOPE_REQUIRED');
  return resolved;
}
async function main() {
  if (args.some(arg => !['--apply', '--acknowledge-main-919-format-only'].includes(arg) && !['--expected-digest=', '--plan=', '--report='].some(prefix => arg.startsWith(prefix))) || new Set(args).size !== args.length) throw Error('ADDRESS_FORMAT_MAIN_UNKNOWN_OR_DUPLICATE_ARGUMENT');
  const apply = args.includes('--apply'), acknowledged = args.includes('--acknowledge-main-919-format-only');
  const databaseUrl = mainRepairUrl(process.env.DATABASE_URL, { acknowledgeMain919FormatOnly: acknowledged });
  if (!option('--report')) throw Error('ADDRESS_FORMAT_MAIN_PRIVATE_REPORT_REQUIRED');
  const reportPath = privatePath(option('--report'));
  if (fs.existsSync(reportPath)) throw Error('ADDRESS_FORMAT_MAIN_REPORT_EXISTS');
  verifyRuntimeScalarFields(Prisma.dmmf.datamodel.models.find(model => model.name === 'Shop').fields.filter(field => field.kind !== 'object').map(field => field.name));
  const sourceBytes = fs.readFileSync(path.join(root, '.local/legacy-store-import-20261105/source-without-platform-stats.sql'));
  if (sha256(sourceBytes) !== SOURCE_SHA256) throw Error('ADDRESS_FORMAT_SOURCE_SHA_MISMATCH');
  const sourceRow = legacySql.tableRows(sourceBytes.toString('utf8'), 'merchant').find(row => String(row.id) === SOURCE_ID);
  const sealedBytes = fs.readFileSync(path.join(root, '.local/store-data-preflight-20261110/snapshot.private.json'));
  if (sha256(sealedBytes) !== SEALED_SNAPSHOT_SHA256) throw Error('ADDRESS_FORMAT_SEALED_SNAPSHOT_SHA_MISMATCH');
  const sealedAnchor = JSON.parse(sealedBytes).shops.find(row => String(row.id) === SHOP_ID);
  fs.mkdirSync(scope, { recursive: true });
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    let plan, result;
    if (apply) {
      if (!option('--plan') || !option('--expected-digest')) throw Error('ADDRESS_FORMAT_MAIN_SEALED_PLAN_AND_DIGEST_REQUIRED');
      plan = JSON.parse(fs.readFileSync(privatePath(option('--plan')), 'utf8')).plan;
      if (!plan || plan.digest !== option('--expected-digest') || plan.target?.database !== MAIN_TARGET.database || plan.target?.port !== MAIN_TARGET.port) throw Error('ADDRESS_FORMAT_MAIN_EXACT_SEALED_PLAN_REQUIRED');
      const preimage = path.join(scope, 'main-apply-preimage-' + plan.digest + '.private.json');
      fs.writeFileSync(preimage, json({ operation: 'main-local-single-919-address-format-only', target: MAIN_TARGET, capturedAt: new Date().toISOString(), sourceSha256: SOURCE_SHA256, sealedSnapshotSha256: SEALED_SNAPSHOT_SHA256, plan }), { flag: 'wx', mode: 0o600 });
      result = await executeMainAddressFormatPlan(db, plan, { databaseUrl, expectedDigest: option('--expected-digest'), acknowledgeMain919FormatOnly: acknowledged });
    } else {
      if (option('--plan') || option('--expected-digest')) throw Error('ADDRESS_FORMAT_MAIN_DRY_RUN_NO_WRITE_ARGUMENTS');
      const input = await db.$transaction(async tx => {
        const identity = await tx.$queryRaw`SELECT DATABASE() AS name`;
        if (identity[0]?.name !== MAIN_TARGET.database) throw Error('ADDRESS_FORMAT_DATABASE_IDENTITY_MISMATCH');
        if (await tx.shop.count() !== 1335 || await tx.shop.count({ where: { status: 'APPROVED', deletedAt: null } }) !== 1335) throw Error('ADDRESS_FORMAT_UNEXPECTED_STORE_POPULATION');
        return { shop: await tx.shop.findUnique({ where: { id: BigInt(SHOP_ID) } }), aliases: await tx.shopAlias.findMany({ where: { shopId: BigInt(SHOP_ID) }, orderBy: { id: 'asc' } }) };
      }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
      plan = mainAddressFormatPlan({ ...input, sourceRow, sourceSha256: SOURCE_SHA256, sealedAnchor }, { acknowledgeMain919FormatOnly: acknowledged });
      result = { status: plan.status, dryRun: true, updatedStores: 0 };
    }
    const receipt = { stage: 'Step 7 reviewed main-local single-store format repair', mode: apply ? 'apply' : 'dry-run', target: MAIN_TARGET, shopId: SHOP_ID, capturedAt: new Date().toISOString(), sourceSha256: SOURCE_SHA256, sealedSnapshotSha256: SEALED_SNAPSHOT_SHA256, plan, result };
    const contents = json(receipt);
    fs.writeFileSync(reportPath, contents, { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ mode: receipt.mode, target: MAIN_TARGET, shopId: SHOP_ID, sourceShopId: SOURCE_ID, digest: plan.digest, status: result.status, updatedStores: result.updatedStores, receiptSha256: sha256(contents) }) + '\n');
  } finally { await db.$disconnect(); }
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(String(error?.message ?? 'ADDRESS_FORMAT_MAIN_REPAIR_FAILED').replace(/[\r\n]/g, ' ') + '\n'); process.exitCode = 1; });
