import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

function fixture() {
  const row: any = { id: 42n, phone: null, email: 'customer@example.invalid', emailVerifiedAt: new Date('2035-01-01T00:00:00.000Z'), name: 'Original', avatarUrl: null, role: 'CUSTOMER', status: 'ACTIVE', createdAt: new Date('2034-01-01T00:00:00.000Z') };
  const calls: any[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => []),
    user: {
      findUnique: jest.fn(async () => ({ ...row })),
      update: jest.fn(async ({ data }: any) => { calls.push(data); Object.assign(row, data); return { ...row }; }),
    },
  };
  const prisma: any = { $transaction: (work: any, options: any) => { expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted); return work({ ...tx, user: { ...tx.user, findUnique: jest.fn(async () => ({ ...row })) } }); } };
  return { service: new UsersService(prisma), tx, row, calls };
}

describe('customer email verification state in user profiles', () => {
  test('changing a profile name or resubmitting the same email preserves verification', async () => {
    const f = fixture();
    const name = await f.service.updateProfile('42', { name: 'Updated name', email: 'CUSTOMER@example.invalid' });
    expect(name).toMatchObject({ name: 'Updated name', email: 'customer@example.invalid', emailVerified: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).not.toHaveProperty('emailVerifiedAt');
  });

  test('changing the address clears verification until its mailbox is confirmed', async () => {
    const f = fixture();
    const result = await f.service.updateProfile('42', { email: 'new@example.invalid' });
    expect(result.email).toBe('new@example.invalid');
    expect(result.emailVerified).toBe(false);
    expect(f.calls[0]).toMatchObject({ email: 'new@example.invalid', emailVerifiedAt: null });
  });

  test('a conflicting mailbox remains a conflict and never changes the saved address', async () => {
    const f = fixture();
    f.tx.user.update.mockRejectedValueOnce({ code: 'P2002' });
    await expect(f.service.updateProfile('42', { email: 'taken@example.invalid' })).rejects.toThrow(ConflictException);
    expect(f.row.email).toBe('customer@example.invalid');
    expect(f.row.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
