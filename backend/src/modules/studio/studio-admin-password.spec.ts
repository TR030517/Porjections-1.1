import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { StudioService } from './studio.service';

function fixture() {
  const rows: any[] = [], audits: any[] = [];
  const user = {
    create: jest.fn(async ({ data }: any) => { const row = { id: BigInt(rows.length + 20), ...data }; rows.push(row); return row; }),
    findUnique: jest.fn(async ({ where, select }: any) => {
      const row = rows.find(entry => entry.id === where.id);
      return row && select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row;
    }),
  };
  const tx: any = { user, auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) } };
  const db: any = { $transaction: jest.fn(async (work: any) => work(tx)) };
  return { service: new StudioService(db), rows, audits, user, db };
}
const actor = { id: '1', role: 'ADMIN' };
const body = (password: string) => ({ name: 'Synthetic policy account', email: 'policy@example.invalid', phone: '+12025550123', password });

describe('studio administrator creation password boundary before persistence', () => {
  test.each(Array.from({ length: 6 }, (_, n) => n + 6))('rejects %i ASCII bytes with clear 400 and zero writes', async bytes => {
    const f = fixture();
    await expect(f.service.save('admins', undefined, body('a'.repeat(bytes)), actor)).rejects.toMatchObject({
      status: 400, response: { code: 'PASSWORD_POLICY', message: expect.stringContaining('12–72') },
    });
    expect(f.rows).toEqual([]); expect(f.audits).toEqual([]); expect(f.user.create).not.toHaveBeenCalled();
  });

  test.each(['a'.repeat(12), 'a'.repeat(72), '密'.repeat(4), '密'.repeat(24), '😀'.repeat(3)])('accepts a valid UTF-8 boundary without exposing the password', async password => {
    const f = fixture();
    const result = await f.service.save('admins', undefined, body(password), actor);
    expect(f.rows).toHaveLength(1); expect(f.rows[0]).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    expect(await compare(password, f.rows[0].passwordHash)).toBe(true);
    expect(result.item).not.toHaveProperty('passwordHash');
    expect(f.audits).toHaveLength(1); expect(f.audits[0].detail.fields).not.toContain('password');
  });

  test.each(['a'.repeat(73), '密'.repeat(25), '😀'.repeat(19), 'a'.repeat(11) + '\n', 'a'.repeat(11) + '\0'])('rejects oversized or forbidden input with no success writes', async password => {
    const f = fixture();
    await expect(f.service.save('admins', undefined, body(password), actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.user.create).not.toHaveBeenCalled(); expect(f.audits).toEqual([]);
  });

  test.each(['MERCHANT', 'STAFF', 'CUSTOMER'])('%s cannot create an administrator', async role => {
    const f = fixture();
    await expect(f.service.save('admins', undefined, body('a'.repeat(12)), { id: '2', role })).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.user.create).not.toHaveBeenCalled(); expect(f.audits).toEqual([]);
  });

  test('studio customer account creation retains the six-byte minimum and fixed role', async () => {
    const f = fixture();
    await f.service.save('users', undefined, body('123456'), actor);
    expect(f.rows[0].role).toBe('CUSTOMER');
    expect(await compare('123456', f.rows[0].passwordHash)).toBe(true);
  });
});
