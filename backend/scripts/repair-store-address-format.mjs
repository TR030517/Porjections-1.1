import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import legacySql from './lib/legacy-sql.cjs';
import { QA_TARGET, SOURCE_SHA256, SHOP_ID, SOURCE_ID, cloneRepairUrl, verifyRuntimeScalarFields, addressFormatPlan, executeAddressFormatPlan, digest, canonical } from './store-address-format-repair-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scope = path.join(root, '.local/store-address-format-repair-20261110');
const args = process.argv.slice(2);
const option = name => args.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
const allowed = ['--apply', '--rollback', '--acknowledge-qa-only'];
const prefixes = ['--expected-digest=', '--plan=', '--report='];
const json = value => JSON.stringify(canonical(value), null, 2) + '\n';
function privatePath(value) {
  const resolved = path.resolve(value);
  const relative = path.relative(scope, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !resolved.endsWith('.private.json')) throw Error('ADDRESS_FORMAT_RECEIPT_MUST_BE_PRIVATE_IN_SCOPE');
  return resolved;
}
async function main() {
  if (args.some(arg => !allowed.includes(arg) && !prefixes.some(prefix => arg.startsWith(prefix))) || new Set(args).size !== args.length) throw Error('ADDRESS_FORMAT_UNKNOWN_OR_DUPLICATE_ARGUMENT');
  const apply = args.includes('--apply'), rollback = args.includes('--rollback'), acknowledge = args.includes('--acknowledge-qa-only');
  if (apply && rollback || (apply || rollback) !== acknowledge || !option('--report')) throw Error('ADDRESS_FORMAT_EXPLICIT_MODE_AND_PRIVATE_REPORT_REQUIRED');
  // Target guard runs before constructing any client or writing a local receipt.
  const databaseUrl = cloneRepairUrl(process.env.DATABASE_URL);
  verifyRuntimeScalarFields(Prisma.dmmf.datamodel.models.find(model => model.name === 'Shop').fields.filter(field => field.kind !== 'object').map(field => field.name));
  const reportPath = privatePath(option('--report'));
  if (fs.existsSync(reportPath)) throw Error('ADDRESS_FORMAT_REPORT_ALREADY_EXISTS');
  const sourceBytes = fs.readFileSync(path.join(root, '.local/legacy-store-import-20261105/source-without-platform-stats.sql'));
  const sourceSha256 = (await import('node:crypto')).createHash('sha256').update(sourceBytes).digest('hex');
  if (sourceSha256 !== SOURCE_SHA256) throw Error('ADDRESS_FORMAT_SOURCE_SHA_MISMATCH');
  const sourceRow = legacySql.tableRows(sourceBytes.toString('utf8'), 'merchant').find(row => String(row.id) === SOURCE_ID);
  const sealed = JSON.parse(fs.readFileSync(path.join(root, '.local/store-data-preflight-20261110/snapshot.private.json'), 'utf8'));
  const sealedAnchor = sealed.shops.find(row => String(row.id) === SHOP_ID);
  fs.mkdirSync(scope, { recursive: true });
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    let plan, result;
    if (apply || rollback) {
      if (!option('--plan') || !option('--expected-digest')) throw Error('ADDRESS_FORMAT_SEALED_PLAN_AND_DIGEST_REQUIRED');
      const planReceipt = JSON.parse(fs.readFileSync(privatePath(option('--plan')), 'utf8'));
      plan = planReceipt.plan;
      // The receipt is written exclusively BEFORE the transaction. A failed or
      // interrupted execution retains its preimage and must be read back safely.
      const preimage = path.join(scope, (rollback ? 'rollback' : 'apply') + '-preimage-' + plan.digest + '.private.json');
      fs.writeFileSync(preimage, json({ operation: rollback ? 'rollback' : 'apply', target: QA_TARGET, capturedAt: new Date().toISOString(), plan }), { flag: 'wx', mode: 0o600 });
      result = await executeAddressFormatPlan(db, plan, { databaseUrl, expectedDigest: option('--expected-digest'), rollback });
    } else {
      if (option('--plan') || option('--expected-digest')) throw Error('ADDRESS_FORMAT_DRY_RUN_DOES_NOT_ACCEPT_WRITE_ARGUMENTS');
      const input = await db.$transaction(async tx => {
        const identity = await tx.$queryRaw`SELECT DATABASE() AS name`;
        if (identity[0]?.name !== QA_TARGET.database) throw Error('ADDRESS_FORMAT_DATABASE_IDENTITY_MISMATCH');
        if (await tx.shop.count() !== 1335 || await tx.shop.count({ where: { status: 'APPROVED', deletedAt: null } }) !== 1335) throw Error('ADDRESS_FORMAT_UNEXPECTED_STORE_POPULATION');
        return { shop: await tx.shop.findUnique({ where: { id: BigInt(SHOP_ID) } }), aliases: await tx.shopAlias.findMany({ where: { shopId: BigInt(SHOP_ID) }, orderBy: { id: 'asc' } }) };
      }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
      plan = addressFormatPlan({ ...input, sourceRow, sourceSha256, sealedAnchor });
      result = { status: plan.status, updatedStores: 0, dryRun: true };
    }
    const receipt = { stage: 'Step 7 single-store QA-only format repair', mode: apply ? 'apply' : rollback ? 'rollback' : 'dry-run', target: QA_TARGET, capturedAt: new Date().toISOString(), sourceSha256, plan, result };
    fs.writeFileSync(reportPath, json(receipt), { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ mode: receipt.mode, target: QA_TARGET, shopId: SHOP_ID, sourceShopId: SOURCE_ID, digest: plan.digest, status: result.status, updatedStores: result.updatedStores, privateReceiptSha256: digest(receipt) }) + '\n');
  } finally { await db.$disconnect(); }
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(String(error?.message ?? 'ADDRESS_FORMAT_REPAIR_FAILED').replace(/[\r\n]/g, ' ') + '\n'); process.exitCode = 1; });
