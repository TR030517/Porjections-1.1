import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockAdministratorStatus, requireAnotherActiveAdministrator } from './administrator-status';

describe('active administrator protection', () => {
  test('locks the target, the operator, and the active candidates before checking eligibility', async () => {
    const tx = {
      user: { findMany: jest.fn(async () => [{ id: 3n }, { id: 9n }, { id: 10n }]) },
      $queryRaw: jest.fn(async (_query: Prisma.Sql) => [
        { id: 2n, role: 'ADMIN', status: 'SUSPENDED', deleted_at: null },
        { id: 3n, role: 'ADMIN', status: 'ACTIVE', deleted_at: null },
        { id: 9n, role: 'ADMIN', status: 'SUSPENDED', deleted_at: null },
        { id: 10n, role: 'ADMIN', status: 'ACTIVE', deleted_at: new Date() },
        { id: 11n, role: 'CUSTOMER', status: 'ACTIVE', deleted_at: null },
      ]),
    };

    await expect(lockAdministratorStatus(tx as unknown as Prisma.TransactionClient, 2n, 11n)).resolves.toEqual([3n]);
    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, select: { id: true },
    });
    const [[query]] = tx.$queryRaw.mock.calls;
    expect(query.sql).toContain('FORCE INDEX (PRIMARY)');
    expect(query.sql).toContain('ORDER BY id FOR UPDATE');
    expect(new Set(query.values)).toEqual(new Set([2n, 3n, 9n, 10n, 11n]));
  });

  test('allows disabling one administrator when another active administrator remains', () => {
    expect(() => requireAnotherActiveAdministrator([3n, 9n], 3n)).not.toThrow();
  });

  test('rejects disabling the final active administrator', () => {
    expect(() => requireAnotherActiveAdministrator([3n], 3n)).toThrow(BadRequestException);
  });
});
