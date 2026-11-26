import { UnauthorizedException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { AuthService } from './auth.service';

const password = 'synthetic-password-only';
const passwordHash = hashSync(password, 4);
const account = (patch: Record<string, unknown> = {}) => ({
  id: 1n, email: null, phone: null, loginName: null,
  role: 'MERCHANT', status: 'ACTIVE', passwordHash, ...patch,
});
function fixture(rows: any[]) {
  const matches = (row: any, where: any): boolean => where.OR
    ? where.OR.some((part: any) => matches(row, part))
    : Object.entries(where).every(([key, value]) => row[key] === value);
  const findMany = jest.fn(async ({ where, take }: any) => rows.filter(row => matches(row, where)).slice(0, take));
  const service = new AuthService({ user: { findMany } } as any, {} as any);
  // This suite exercises identifier resolution and actual password comparison;
  // refresh-session persistence is covered by the separate session tests.
  const session = jest.spyOn(service as any, 'createSession').mockResolvedValue({ authenticated: true });
  return { service, findMany, session };
}

describe('password identifier namespaces', () => {
  test.each([
    ['email', ' Mixed@Example.Invalid ', account({ email: 'mixed@example.invalid' }), { email: 'mixed@example.invalid' }],
    ['E.164 phone', '+12025550101', account({ phone: '+12025550101' }), { phone: '+12025550101' }],
    ['management login name', ' Studio_Name ', account({ loginName: 'studio_name' }), { loginName: 'studio_name' }],
  ])('%s selects only its explicit namespace', async (_label, identifier, user, where) => {
    const f = fixture([user]);
    await expect(f.service.passwordLogin(identifier as string, password)).resolves.toEqual({ authenticated: true });
    expect(f.findMany).toHaveBeenCalledWith({ where, take: 2 });
    expect(f.session).toHaveBeenCalledWith(user, undefined);
  });

  test('a unique legacy numeric phone remains usable', async () => {
    const user = account({ phone: '2025550101' }), f = fixture([user]);
    await f.service.passwordLogin('2025550101', password);
    expect(f.findMany).toHaveBeenCalledWith({ where: { OR: [{ loginName: '2025550101' }, { phone: '2025550101' }] }, take: 2 });
    expect(f.session).toHaveBeenCalledWith(user, undefined);
  });

  test('a numeric username works when it matches one account, including both columns on that account', async () => {
    const user = account({ loginName: '2025550101', phone: '2025550101' }), f = fixture([user]);
    await f.service.passwordLogin('2025550101', password);
    expect(f.session).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])('numeric username and legacy phone collision fails closed regardless of row order (%s)', async reverse => {
    const rows = [account({ loginName: '2025550101' }), account({ id: 2n, phone: '2025550101' })];
    const f = fixture(reverse ? rows.reverse() : rows);
    await expect(f.service.passwordLogin('2025550101', password)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.session).not.toHaveBeenCalled();
  });

  test('an email identifier cannot fall back to a legacy login-name column', async () => {
    const f = fixture([account({ loginName: 'customer@example.invalid' })]);
    await expect(f.service.passwordLogin('customer@example.invalid', password)).rejects.toThrow('Invalid credentials');
    expect(f.session).not.toHaveBeenCalled();
  });

  test('customer endpoint still rejects an otherwise valid management password', async () => {
    const f = fixture([account({ email: 'manager@example.invalid' })]);
    await expect(f.service.passwordLogin('manager@example.invalid', password, 'CUSTOMER')).rejects.toThrow('Invalid credentials');
    expect(f.session).not.toHaveBeenCalled();
  });

  test('wrong passwords and inactive accounts cannot create sessions', async () => {
    const active = fixture([account({ loginName: 'studio' })]);
    await expect(active.service.passwordLogin('studio', 'wrong-synthetic-password')).rejects.toThrow('Invalid credentials');
    expect(active.session).not.toHaveBeenCalled();
    const inactive = fixture([account({ loginName: 'studio', status: 'SUSPENDED' })]);
    await expect(inactive.service.passwordLogin('studio', password)).rejects.toThrow('Invalid credentials');
    expect(inactive.session).not.toHaveBeenCalled();
  });
});
