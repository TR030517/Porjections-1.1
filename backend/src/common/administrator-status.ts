import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockAdministratorStatus(tx: Prisma.TransactionClient, targetId: bigint, operatorId: bigint): Promise<bigint[]> {
  const candidates = await tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  const ids = [...new Set([targetId, operatorId, ...candidates.map(row => row.id)])];
  // Acquire the same primary-key lock order as password recovery and recheck
  // eligibility on the locked rows, since discovery can see a prior status.
  const rows = await tx.$queryRaw<Array<{ id: bigint; role: string; status: string; deleted_at: Date | null }>>(Prisma.sql`
    SELECT id, role, status, deleted_at FROM users FORCE INDEX (PRIMARY)
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id FOR UPDATE
  `);
  return rows.filter(row => row.role === 'ADMIN' && row.status === 'ACTIVE' && row.deleted_at === null)
    .map(row => row.id);
}

export function requireAnotherActiveAdministrator(activeIds: readonly bigint[], targetId: bigint) {
  if (!activeIds.some(id => id !== targetId)) {
    throw new BadRequestException('At least one active platform administrator must remain');
  }
}
