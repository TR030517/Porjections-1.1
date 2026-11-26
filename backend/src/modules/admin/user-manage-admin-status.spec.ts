import { BadRequestException } from '@nestjs/common';
import { UserManageService } from './user-manage.service';

function fixture(activeAdminIds: bigint[]) {
  const statements: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query: any) => {
      const sql = query?.sql ?? (Array.isArray(query) ? query.join('?') : String(query));
      statements.push(sql);
      return activeAdminIds.map(id => ({ id, role: 'ADMIN', status: 'ACTIVE', deleted_at: null }));
    }),
    user: {
      findMany: jest.fn(async () => activeAdminIds.map(id => ({ id }))),
      findUnique: jest.fn()
        .mockResolvedValueOnce({ role: 'ADMIN' })
        .mockResolvedValueOnce({ role: 'ADMIN', status: 'ACTIVE' }),
      update: jest.fn(async ({ data }: any) => ({ id: 3n, role: 'ADMIN', status: data.status, updatedAt: new Date() })),
    },
    authSession: { updateMany: jest.fn(async () => ({ count: 2 })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = { $transaction: jest.fn((work: (value: any) => unknown) => work(tx)), user: tx.user };
  return { service: new UserManageService(prisma as any), tx, statements };
}

describe('legacy admin status endpoint preserves an active administrator', () => {
  test('locks the active admin set and the target in one query before disabling either administrator', async () => {
    const f = fixture([3n, 8n]);

    await f.service.updateStatus('3', { status: 'SUSPENDED' } as any, '8');

    expect(f.statements[0]).toContain('FORCE INDEX (PRIMARY)');
    expect(f.statements[0]).toContain('ORDER BY id FOR UPDATE');
    expect(f.statements).toHaveLength(1);
    expect(f.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SUSPENDED' } }));
  });

  test('rejects disabling the only active admin before changing status or revoking sessions', async () => {
    const f = fixture([3n]);

    await expect(f.service.updateStatus('3', { status: 'DELETED' } as any, '8'))
      .rejects.toThrow(BadRequestException);

    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tx.authSession.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
