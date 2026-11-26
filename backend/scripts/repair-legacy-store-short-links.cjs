'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Prisma, PrismaClient } = require('@prisma/client');
const { IMPORT_SOURCE, shortName } = require('./import-legacy-stores.cjs');
const { targetUrl } = require('./migrate-legacy-store-accounts.cjs');
const { tableRows } = require('./lib/legacy-sql.cjs');
const { selectLegacyStoreShortLinks } = require('./lib/legacy-store-short-links.cjs');

const sourceFile = path.resolve(__dirname, '../../.local/legacy-store-import-20261105/source-without-platform-stats.sql');
const shortLink = { kind: 'SHORT_NAME', source: 'massajoy' };
const sourceMappings = [
  { kind: 'LEGACY_STORE_ID', source: IMPORT_SOURCE },
  { kind: 'LEGACY_ID', source: 'massajoy1' },
];

function readSource() {
  const allRows = tableRows(fs.readFileSync(sourceFile, 'utf8'), 'merchant');
  if (!allRows.length || !['name', 'redirect', 'delete_time'].every(key => key in allRows[0])) {
    throw new Error('Legacy merchant short-link fields are missing');
  }
  const rows = allRows.filter(row => row.name?.trim());
  if (!rows.length || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('Invalid legacy merchant identities');
  }
  return rows;
}

async function inspect(tx, rows) {
  const [stores, aliases] = await Promise.all([
    tx.shop.findMany({ select: { id: true, shortName: true, status: true, deletedAt: true } }),
    tx.shopAlias.findMany({ where: { OR: [shortLink, ...sourceMappings] }, select: { shopId: true, kind: true, value: true, isActive: true } }),
  ]);
  const shopById = new Map(stores.map(shop => [shop.id, shop]));
  const canonical = new Map(stores.filter(shop => shop.shortName).map(shop => [shop.shortName.toLowerCase(), shop.id]));
  const byKind = Object.fromEntries([shortLink, ...sourceMappings].map(({ kind }) => [kind, new Map()]));
  for (const alias of aliases) byKind[alias.kind].set(alias.value.toLowerCase(), alias);

  const { links, skipped } = selectLegacyStoreShortLinks(rows);
  const sourceById = new Map(rows.map(row => [row.id, row]));
  const changes = [];
  let verified = 0;
  for (const { legacyId, value, original } of links) {
    const [legacy, publicId] = sourceMappings.map(({ kind }) => byKind[kind].get(legacyId));
    const shop = shopById.get(legacy?.shopId);
    if (!shop || !legacy.isActive || !publicId?.isActive || publicId.shopId !== shop.id ||
        shop.status !== 'APPROVED' || shop.deletedAt) {
      skipped.push({ value, reason: 'target-unavailable', legacyIds: [legacyId] });
      continue;
    }
    const existing = byKind.SHORT_NAME.get(value);
    const canonicalOwner = canonical.get(value);
    if ((existing && (existing.shopId !== shop.id || !existing.isActive)) ||
        (canonicalOwner !== undefined && canonicalOwner !== shop.id)) {
      skipped.push({ value, reason: 'reserved', legacyIds: [legacyId] });
      continue;
    }
    const fallback = byKind.SHORT_NAME.get(shop.shortName?.toLowerCase());
    const changeCanonical = shop.shortName !== value && shop.shortName === shortName(sourceById.get(legacyId)) &&
      fallback?.shopId === shop.id && fallback.isActive;
    verified++;
    if (!existing || changeCanonical) {
      changes.push({
        legacyId,
        shopId: String(shop.id),
        value,
        original,
        previousCanonical: shop.shortName,
        changeCanonical,
        createAlias: !existing,
      });
    }
  }
  changes.sort((a, b) => Number(a.shopId) - Number(b.shopId));
  const digest = crypto.createHash('sha256').update(JSON.stringify(changes)).digest('hex');
  const summary = {
    sourceStores: rows.length,
    targetStores: stores.length,
    published: stores.filter(shop => shop.status === 'APPROVED' && !shop.deletedAt).length,
    verified,
    aliasesToCreate: changes.filter(change => change.createAlias).length,
    canonicalToUpdate: changes.filter(change => change.changeCanonical).length,
    skipped: Object.fromEntries([...new Set(skipped.map(entry => entry.reason))].map(reason => {
      const entries = skipped.filter(entry => entry.reason === reason);
      return [reason, { groups: entries.length, rows: entries.reduce((sum, entry) => sum + entry.legacyIds.length, 0) }];
    })),
    digest,
  };
  return { summary, changes, skipped };
}

async function apply(db, source, preview, receiptPath) {
  return db.$transaction(async tx => {
    const ids = preview.changes.map(change => BigInt(change.shopId));
    await tx.$queryRaw`SELECT id FROM shops WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    const plan = await inspect(tx, source);
    if (plan.summary.digest !== preview.summary.digest) throw new Error('Short-link plan changed before apply');

    fs.writeFileSync(receiptPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    const aliases = plan.changes.filter(change => change.createAlias).map(change => ({
      ...shortLink,
      shopId: BigInt(change.shopId),
      value: change.value,
    }));
    if (aliases.length) await tx.shopAlias.createMany({ data: aliases });
    for (const change of plan.changes.filter(entry => entry.changeCanonical)) {
      await tx.shop.update({ where: { id: BigInt(change.shopId) }, data: { shortName: change.value } });
    }
    return plan.summary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
}

async function main() {
  const [expectedDigest, receiptPath] = process.argv.slice(2);
  if (expectedDigest && (!/^[a-f0-9]{64}$/.test(expectedDigest) || !receiptPath)) {
    throw new Error('Apply requires the dry-run digest and a new receipt file');
  }
  const db = new PrismaClient({ datasources: { db: { url: targetUrl(process.env.DATABASE_URL) } } });
  try {
    const source = readSource();
    const preview = await inspect(db, source);
    if (!expectedDigest) {
      console.log(JSON.stringify(preview.summary, null, 2));
      return;
    }
    if (preview.summary.digest !== expectedDigest) throw new Error('Short-link plan differs from the dry run');
    const result = preview.changes.length ? await apply(db, source, preview, receiptPath) : preview.summary;
    console.log(JSON.stringify({ status: 'committed', ...result }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error('Legacy short-link repair failed:', error.message);
  process.exitCode = 1;
});
