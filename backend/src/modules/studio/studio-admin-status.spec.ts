import { BadRequestException } from '@nestjs/common';
import { StudioService } from './studio.service';

function fixture(activeAdminIds: bigint[], status = 'ACTIVE') {
  const statements: string[] = [];
  const previous = { id: 3n, name: 'Synthetic admin', role: 'ADMIN', status };
  const tx = {
    $queryRaw: jest.fn(async (query: any) => {
      const sql = Array.isArray(query) ? query.join(' ') : String(query?.sql ?? query);
      statements.push(sql);
      return activeAdminIds.map(id => ({ id, role: 'ADMIN', status: 'ACTIVE', deleted_at: null }));
    }),
    user: {
      findMany: jest.fn(async () => activeAdminIds.map(id => ({ id }))),
      findFirst: jest.fn(async () => previous),
      update: jest.fn(async ({ data }: any) => ({ ...previous, ...data })),
      findUnique: jest.fn(async () => ({ ...previous, status: 'SUSPENDED' })),
    },
    authSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: jest.fn((work: (value: any) => unknown) => work(tx)),
  };
  return { service: new StudioService(prisma as any), tx, statements };
}

describe('Studio admin status updates preserve an active administrator', () => {
  test('locks active admins before suspending one of multiple admins', async () => {
    const f = fixture([3n, 8n]);

    await f.service.save('admins', '3', { name: 'Synthetic admin', status: 'SUSPENDED' }, { id: '8', role: 'ADMIN' });

    expect(f.statements[0]).toContain('FORCE INDEX (PRIMARY)');
    expect(f.statements[0]).toContain('ORDER BY id FOR UPDATE');
    expect(f.tx.user.update).toHaveBeenCalledWith({ where: { id: 3n }, data: { name: 'Synthetic admin', status: 'SUSPENDED' } });
  });

  test('rejects suspending the final active admin before changing status or revoking sessions', async () => {
    const f = fixture([3n]);

    await expect(f.service.save('admins', '3', { name: 'Synthetic admin', status: 'SUSPENDED' }, { id: '8', role: 'ADMIN' }))
      .rejects.toThrow(BadRequestException);

    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tx.authSession.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  test.each(['ACTIVE', 'SUSPENDED'])('renaming an administrator leaves the %s status and sessions alone', async status => {
    const f = fixture(status === 'ACTIVE' ? [3n] : [8n], status);

    await f.service.save('admins', '3', { name: 'Updated name' }, { id: '8', role: 'ADMIN' });

    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.user.findFirst.mock.invocationCallOrder[0]);
    expect(f.tx.user.update).toHaveBeenCalledWith({ where: { id: 3n }, data: { name: 'Updated name' } });
    expect(f.tx.authSession.updateMany).not.toHaveBeenCalled();
  });
});
