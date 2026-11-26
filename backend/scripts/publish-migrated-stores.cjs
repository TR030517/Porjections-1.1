const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs/promises');
const path = require('node:path');

const EXPECTED_DATABASE = 'mj2_store_migration_84cec1e6';
const EXPECTED_PORT = '33090';
const EXPECTED_SHOPS = 1335;
const REASON = '按用户明确指示，将本地 Massajoy2.0 迁移门店全部发布';
const args = new Set(process.argv.slice(2));
const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item, 2);

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Local migration job only');
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== EXPECTED_PORT || decodeURIComponent(url.pathname.slice(1)) !== EXPECTED_DATABASE || url.search || url.hash) {
    throw new Error('Unexpected database: only the isolated local migration schema is allowed');
  }
  if (!args.has('--apply') || !args.has('--acknowledge-all-stores')) throw new Error('Use --apply --acknowledge-all-stores for the user-authorized publication');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const result = await db.$transaction(async tx => {
      const identity = await tx.$queryRaw`SELECT DATABASE() AS name`;
      if (identity[0]?.name !== EXPECTED_DATABASE) throw new Error('Database identity mismatch');
      await tx.$queryRaw`SELECT id FROM shops ORDER BY id FOR UPDATE`;
      const shops = await tx.shop.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, status: true, deletedAt: true, reviewComment: true, reviewedAt: true, reviewedBy: true, updatedAt: true },
      });
      if (shops.length !== EXPECTED_SHOPS || shops.some(shop => shop.deletedAt !== null)) throw new Error('Unexpected shop count or deleted shop; no publication applied');
      const operator = await tx.user.findFirst({ where: { role: 'ADMIN', loginName: 'admin', status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!operator) throw new Error('Local administrator missing');
      const pending = shops.filter(shop => shop.status !== 'APPROVED');
      if (!pending.length) return { shops: shops.length, published: shops.length, updated: 0 };

      const now = new Date();
      const backupDir = path.resolve(__dirname, '../../.local/store-publication-20261106');
      await fs.mkdir(backupDir, { recursive: true });
      const backup = path.join(backupDir, `before-${now.toISOString().replace(/[:.]/g, '-')}.json`);
      await fs.writeFile(backup, serialize({ schema: EXPECTED_DATABASE, timestamp: now, reason: REASON, shops }), { encoding: 'utf8', flag: 'wx' });

      const ids = pending.map(shop => shop.id);
      const changed = await tx.shop.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { status: 'APPROVED', reviewComment: REASON, reviewedAt: now, reviewedBy: operator.id } });
      if (changed.count !== pending.length) throw new Error('Publication count mismatch; transaction rolled back');
      await tx.auditLog.createMany({ data: pending.map(shop => ({
        action: 'APPROVE', targetType: 'SHOP', targetId: shop.id, operatorId: operator.id,
        detail: { reason: REASON, previousStatus: shop.status, newStatus: 'APPROVED', source: 'local-migration-bulk-publication', userRequested: true, publicationChecklistOverride: true },
      })) });
      const published = await tx.shop.count({ where: { status: 'APPROVED', deletedAt: null } });
      if (published !== EXPECTED_SHOPS) throw new Error('Not all stores published; transaction rolled back');
      return { shops: shops.length, published, updated: changed.count, auditRecords: pending.length, backup };
    }, { isolationLevel: 'ReadCommitted', maxWait: 30000, timeout: 120000 });
    process.stdout.write(serialize(result) + '\n');
  } finally { await db.$disconnect(); }
}

main().catch(error => { process.stderr.write(String(error?.message || error) + '\n'); process.exitCode = 1; });
