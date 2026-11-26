import { BadRequestException, ConflictException, ForbiddenException, INestApplication, NotFoundException, ServiceUnavailableException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { compare, hashSync } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { merchantCredentialVault } from '../account-access/merchant-credential-vault';
import { AuthController } from './auth.controller';
import { AuthService, hashToken } from './auth.service';
import { CustomerAuthService } from './customer-auth.service';
import { ManagementPasswordController } from './management-password.controller';
import { managementPassword, ManagementPasswordService } from './management-password.service';
import { JwtStrategy } from './strategies/jwt.strategy';

jest.mock('../account-access/merchant-credential-vault', () => ({ merchantCredentialVault: {
  readMerchantCredential: jest.fn(), writeMerchantCredential: jest.fn(),
} }));
const vault = jest.mocked(merchantCredentialVault);
const request = require('supertest');
const oldPassword = 'Synthetic-current-pass-2026';
const oldHash = hashSync(oldPassword, 4);
const newPassword = 'Synthetic-new-pass-2026';
const actor = (id = '1', role = 'ADMIN') => ({ id, role, sessionId: `session-${id}` });
const change = (password = newPassword) => ({ currentPassword: oldPassword, newPassword: password });
const recovery = (password = newPassword) => ({ ...change(password), reason: 'Synthetic identity verified by the responsible operator', verificationReference: 'CASE-synthetic-2026-01' });
const json = (value: unknown) => JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry);

function fixture() {
  const user = (id: bigint, role: string) => ({ id, role, status: 'ACTIVE', deletedAt: null,
    email: `synthetic-${id}@example.invalid`, loginName: null, passwordHash: oldHash });
  let state: any = { users: [user(1n, 'ADMIN'), user(2n, 'MERCHANT'), user(3n, 'STAFF'), user(4n, 'CUSTOMER'), user(5n, 'ADMIN')],
    sessions: [1n, 2n, 3n, 4n, 5n].flatMap(id => [0, 1].map(index => ({ id: index ? `other-${id}` : `session-${id}`, userId: id,
      tokenHash: hashToken(`refresh-${index}-${id}`), revokedAt: null, expiresAt: new Date(Date.now() + 600000) }))),
    bindings: [{ shopId: 20n, userId: 2n }], devices: [1n, 2n, 3n, 4n, 5n].map(userId => ({ userId })), audits: [] };
  let queue = Promise.resolve(), failure: string | undefined, beforeTransaction: (() => void) | undefined;
  const locks: string[] = [];
  const entries = new Map<string, string>();
  vault.writeMerchantCredential.mockImplementation(input => { entries.set(`${input.shopId}:${input.userId}:${input.passwordHash}`, input.password); return { updatedAt: new Date().toISOString() }; });
  vault.readMerchantCredential.mockImplementation(input => { const password = entries.get(`${input.shopId}:${input.userId}:${input.passwordHash}`);
    return password ? { password, updatedAt: new Date().toISOString(), operationId: null } : null; });
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: any) => value && typeof value === 'object' && 'gt' in value ? row[key] > value.gt : row[key] === value);
  const client = (data: any): any => ({
    $queryRaw: jest.fn(async (query: any) => { locks.push(`${query.sql.includes('shops') ? 'shop' : 'user'}:${query.values[0]}`); return []; }),
    user: {
      findUnique: jest.fn(async ({ where }: any) => structuredClone(data.users.find((row: any) => matches(row, where)) ?? null)),
      findMany: jest.fn(async ({ where, take }: any) => data.users.filter((row: any) => matches(row, where)).slice(0, take)),
      update: jest.fn(async ({ where, data: update }: any) => { const row = data.users.find((entry: any) => matches(entry, where)); Object.assign(row, update); return row; }),
    },
    authSession: {
      findUnique: jest.fn(async ({ where, include }: any) => { const row = data.sessions.find((entry: any) => matches(entry, where)); return row && include?.user ? { ...row, user: data.users.find((u: any) => u.id === row.userId) } : row ?? null; }),
      updateMany: jest.fn(async ({ where, data: update }: any) => { if (failure === 'session') { failure = undefined; throw Error('Synthetic session failure'); }
        const rows = data.sessions.filter((entry: any) => matches(entry, where)); rows.forEach((row: any) => Object.assign(row, update)); return { count: rows.length }; }),
      create: jest.fn(async ({ data: input }: any) => { const row = { revokedAt: null, ...input }; data.sessions.push(row); return row; }),
    },
    pushDevice: { deleteMany: jest.fn(async ({ where }: any) => { const count = data.devices.filter((row: any) => matches(row, where)).length;
      data.devices = data.devices.filter((row: any) => !matches(row, where)); return { count }; }) },
    shopLoginBinding: { findUnique: jest.fn(async ({ where }: any) => structuredClone(data.bindings.find((row: any) => matches(row, where)) ?? null)) },
    auditLog: { create: jest.fn(async ({ data: entry }: any) => { if (failure === 'audit') { failure = undefined; throw Error('Synthetic audit failure'); } data.audits.push(entry); return entry; }) },
  });
  const transaction = (work: any, options: any) => {
    expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
    const result = queue.then(async () => { beforeTransaction?.(); beforeTransaction = undefined; const staged = structuredClone(state), value = await work(client(staged));
      if (failure === 'commit') { failure = undefined; throw Error('Synthetic commit failure'); } state = staged; return value; });
    queue = result.then(() => undefined, () => undefined); return result;
  };
  const db: any = new Proxy({}, { get: (_target, key) => key === '$transaction' ? transaction : client(state)[key] });
  return { db, service: new ManagementPasswordService(db), state: () => state, locks,
    fail: (stage: string) => { failure = stage; }, beforeTransaction: (hook: () => void) => { beforeTransaction = hook; } };
}

beforeEach(() => { jest.resetAllMocks(); });

describe('management password policy and atomic lifecycle (no database)', () => {
  test.each(['ADMIN', 'MERCHANT', 'STAFF'])('%s changes only its own password and invalidates every old session', async role => {
    const id = role === 'ADMIN' ? '1' : role === 'MERCHANT' ? '2' : '3', f = fixture();
    const originalOthers = structuredClone(f.state().users.filter((row: any) => String(row.id) !== id));
    const password = role === 'MERCHANT' ? '246810' : newPassword;
    expect(await f.service.change(actor(id, role), change(password))).toEqual({ changed: true, reauthenticationRequired: true, revokedSessions: 2 });
    const user = f.state().users.find((row: any) => String(row.id) === id);
    expect(user).toMatchObject({ role, status: 'ACTIVE' });
    expect(await compare(password, user.passwordHash)).toBe(true);
    expect(await compare(oldPassword, user.passwordHash)).toBe(false);
    expect(f.state().sessions.filter((row: any) => String(row.userId) === id).every((row: any) => row.revokedAt instanceof Date)).toBe(true);
    expect(f.state().sessions.filter((row: any) => String(row.userId) !== id).every((row: any) => row.revokedAt === null)).toBe(true);
    expect(f.state().devices.some((row: any) => String(row.userId) === id)).toBe(false);
    expect(f.state().users.filter((row: any) => String(row.id) !== id)).toEqual(originalOthers);
    expect(json(f.state().audits)).not.toMatch(new RegExp(`${oldPassword}|${password}|passwordHash|synthetic-.*@`));
    expect(f.state().audits).toHaveLength(1);
    expect(f.state().audits[0]).toMatchObject({ action: 'MANAGEMENT_PASSWORD_CHANGED', operatorId: BigInt(id), targetId: BigInt(id), detail: { revokedSessions: 2 } });
    if (role === 'MERCHANT') {
      expect(f.locks).toEqual(['shop:20', 'user:2']);
      expect(vault.readMerchantCredential({ shopId: '20', userId: id, passwordHash: user.passwordHash })?.password).toBe(password);
      expect(vault.writeMerchantCredential).toHaveBeenCalledTimes(1);
    } else expect(vault.writeMerchantCredential).not.toHaveBeenCalled();
  });

  test('policy uses exact UTF-8 byte boundaries and retains the merchant six-byte rule', () => {
    expect(managementPassword('123456', 'MERCHANT')).toBe('123456');
    for (const role of ['ADMIN', 'STAFF']) {
      expect(() => managementPassword('123456', role)).toThrow(BadRequestException);
      expect(managementPassword('密'.repeat(4), role)).toHaveLength(4);
    }
    for (const role of ['ADMIN', 'STAFF', 'MERCHANT']) {
      expect(managementPassword('密'.repeat(24), role)).toHaveLength(24);
      for (const value of ['密'.repeat(25), 'x'.repeat(73), 'abcdef\nabcdef', 'abcdef\0abcdef', 'abcdef\rabcdef']) expect(() => managementPassword(value, role)).toThrow(BadRequestException);
    }
    expect(() => managementPassword('12345', 'MERCHANT')).toThrow(BadRequestException);
  });

  test.each(['wrong-old', 'unchanged', 'short-admin', 'short-staff', 'customer', 'forged-role', 'revoked-session', 'expired-session', 'deleted-user'])('%s fails without partial writes or secrets', async scenario => {
    const f = fixture(); let identity = actor(), body = change();
    if (scenario === 'wrong-old') body.currentPassword = 'Wrong synthetic password';
    if (scenario === 'unchanged') body.newPassword = oldPassword;
    if (scenario === 'short-admin') body.newPassword = '123456';
    if (scenario === 'short-staff') { identity = actor('3', 'STAFF'); body.newPassword = '123456'; }
    if (scenario === 'customer') identity = actor('4', 'CUSTOMER');
    if (scenario === 'forged-role') identity = actor('2', 'ADMIN');
    if (scenario === 'revoked-session') f.state().sessions[0].revokedAt = new Date();
    if (scenario === 'expired-session') f.state().sessions[0].expiresAt = new Date(0);
    if (scenario === 'deleted-user') f.state().users[0].deletedAt = new Date();
    const before = structuredClone(f.state());
    await expect(f.service.change(identity, body)).rejects.toBeInstanceOf(scenario === 'customer' ? ForbiddenException : ['unchanged','short-admin','short-staff'].includes(scenario) ? BadRequestException : UnauthorizedException);
    expect(f.state()).toEqual(before); expect(vault.writeMerchantCredential).not.toHaveBeenCalled();
  });

  test.each(['session', 'audit', 'commit', 'vault'])('%s failure leaves the old fingerprint and visible merchant credential authoritative', async stage => {
    const f = fixture();
    vault.writeMerchantCredential({ shopId: '20', userId: '2', password: oldPassword, passwordHash: oldHash });
    const before = structuredClone(f.state());
    if (stage === 'vault') vault.writeMerchantCredential.mockImplementationOnce(() => { throw Error('Secret material must not surface'); });
    else f.fail(stage);
    await expect(f.service.change(actor('2', 'MERCHANT'), change('246810'))).rejects.toThrow(stage === 'vault' ? ServiceUnavailableException : /Synthetic .* failure/);
    expect(f.state()).toEqual(before);
    expect(vault.readMerchantCredential({ shopId: '20', userId: '2', passwordHash: f.state().users[1].passwordHash })?.password).toBe(oldPassword);
    expect(await compare(oldPassword, f.state().users[1].passwordHash)).toBe(true);
  });

  test('a concurrent binding change fails before vault, hash, session or audit writes', async () => {
    const f = fixture(); f.beforeTransaction(() => { f.state().bindings[0].shopId = 30n; });
    await expect(f.service.change(actor('2', 'MERCHANT'), change('246810'))).rejects.toThrow(ConflictException);
    expect(f.state().users[1].passwordHash).toBe(oldHash); expect(f.state().audits).toEqual([]);
    expect(f.state().sessions.every((row: any) => row.revokedAt === null)).toBe(true);
    expect(vault.writeMerchantCredential).not.toHaveBeenCalled();
  });

  test('two overlapping changes using one old session cannot both succeed', async () => {
    const f = fixture(), results = await Promise.allSettled([f.service.change(actor(), change()), f.service.change(actor(), change('Another-synthetic-pass-2026'))]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(row => row.status === 'rejected')).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
  });

  test.each([['3', 'STAFF', 'ACTIVE'], ['5', 'ADMIN', 'SUSPENDED']])('ADMIN recovers %s %s without granting roles or activating accounts', async (id, role, status) => {
    const f = fixture(); f.state().users.find((row: any) => String(row.id) === id).status = status;
    expect(await f.service.recover(actor(), id, recovery())).toEqual({ userId: id, recovered: true, reauthenticationRequired: true, revokedSessions: 2 });
    const user = f.state().users.find((row: any) => String(row.id) === id);
    expect(user).toMatchObject({ role, status }); expect(await compare(newPassword, user.passwordHash)).toBe(true);
    expect(await compare(oldPassword, user.passwordHash)).toBe(false);
    expect(f.state().sessions.filter((row: any) => String(row.userId) === id).every((row: any) => row.revokedAt instanceof Date)).toBe(true);
    expect(f.state().sessions.filter((row: any) => row.userId === 1n).every((row: any) => row.revokedAt === null)).toBe(true);
    expect(f.state().audits[0]).toMatchObject({ operatorId: 1n, targetId: BigInt(id), action: 'MANAGEMENT_PASSWORD_RECOVERED', detail: { reasonRecorded: true, verificationRecorded: true, verificationReferenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(json(f.state().audits)).not.toMatch(new RegExp(`${oldPassword}|${newPassword}|CASE-synthetic|identity verified`));
    expect(vault.writeMerchantCredential).not.toHaveBeenCalled();
  });

  test.each(['merchant-operator', 'staff-operator', 'wrong-old', 'self', 'merchant-target', 'customer-target', 'missing-target', 'missing-verification', 'missing-reason', 'short-password', 'operator-changed'])('recovery %s cannot mutate any credentials', async scenario => {
    const f = fixture(); let identity = actor(), id = '3', body = recovery();
    if (scenario === 'merchant-operator') identity = actor('2', 'MERCHANT');
    if (scenario === 'staff-operator') identity = actor('3', 'STAFF');
    if (scenario === 'wrong-old') body.currentPassword = 'Wrong synthetic current pass';
    if (scenario === 'self') id = '1';
    if (scenario === 'merchant-target') id = '2';
    if (scenario === 'customer-target') id = '4';
    if (scenario === 'missing-target') id = '999';
    if (scenario === 'missing-verification') body.verificationReference = '';
    if (scenario === 'missing-reason') body.reason = ' ';
    if (scenario === 'short-password') body.newPassword = '246810';
    if (scenario === 'operator-changed') f.beforeTransaction(() => { f.state().users[0].role = 'STAFF'; });
    await expect(f.service.recover(identity, id, body)).rejects.toBeInstanceOf(['merchant-operator','staff-operator'].includes(scenario) ? ForbiddenException : ['wrong-old','operator-changed'].includes(scenario) ? UnauthorizedException : ['merchant-target','customer-target','missing-target'].includes(scenario) ? NotFoundException : BadRequestException);
    expect(f.state().users.every((row: any) => row.passwordHash === oldHash)).toBe(true);
    expect(f.state().sessions.every((row: any) => row.revokedAt === null)).toBe(true); expect(f.state().audits).toEqual([]);
  });

  test.each(['session', 'audit', 'commit'])('recovery %s failure rolls back password and sessions together', async stage => {
    const f = fixture(), before = structuredClone(f.state()); f.fail(stage);
    await expect(f.service.recover(actor(), '3', recovery())).rejects.toThrow(/Synthetic .* failure/);
    expect(f.state()).toEqual(before);
  });
});

describe('management password actual HTTP/JWT boundaries with isolated transactional store', () => {
  let app: INestApplication, f: ReturnType<typeof fixture>, jwt: JwtService;
  const secret = 'Synthetic-password-route-key-2026-abcdef0123456789!';
  const origin = 'https://password.example.invalid';
  const oldEnvironment = { JWT_SECRET: process.env.JWT_SECRET, CORS_ORIGINS: process.env.CORS_ORIGINS };
  beforeEach(async () => {
    process.env.JWT_SECRET = secret; process.env.CORS_ORIGINS = origin; f = fixture();
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [ManagementPasswordController, AuthController],
      providers: [ManagementPasswordService, AuthService, JwtStrategy, RolesGuard, { provide: PrismaService, useValue: f.db }, { provide: CustomerAuthService, useValue: {} }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })); await app.init(); jwt = module.get(JwtService);
  });
  afterEach(async () => { await app.close(); for (const [key, value] of Object.entries(oldEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const bearer = (id = '1') => 'Bearer ' + jwt.sign({ sub: id, sid: `session-${id}` });
  const post = (path: string, id = '1') => request(app.getHttpServer()).post(`/api/v1/auth/${path}`).set('Origin', origin).set('Authorization', bearer(id));

  test('successful change leaves shared cookies untouched; old password, access and refresh fail, new login succeeds', async () => {
    const oldAccess = bearer('2');
    const result = await post('password/change', '2').send(change('246810'));
    expect(result.status).toBe(200); expect(result.body).toEqual({ changed: true, reauthenticationRequired: true, revokedSessions: 2 });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect((await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', oldAccess)).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Origin', origin).send({ refreshToken: 'refresh-0-2' })).status).toBe(401);
    const login = (password: string) => request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', origin).send({ identifier: 'synthetic-2@example.invalid', password });
    expect((await login(oldPassword)).status).toBe(401);
    const fresh = await login('246810'); expect(fresh.status).toBe(200); expect(fresh.body.user.role).toBe('MERCHANT');
    expect((await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', 'Bearer ' + fresh.body.accessToken)).status).toBe(200);
    expect(f.state().sessions.filter((row: any) => row.userId === 4n).every((row: any) => row.revokedAt === null)).toBe(true);
  });

  test('anonymous/customer, extra target fields and foreign origin are rejected without writes', async () => {
    const before = structuredClone(f.state());
    expect((await request(app.getHttpServer()).post('/api/v1/auth/password/change').send(change())).status).toBe(401);
    expect((await post('password/change', '4').send(change())).status).toBe(403);
    expect((await post('password/change').send({ ...change(), userId: '3' })).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/api/v1/auth/password/change').set('Origin', 'https://foreign.example.invalid').set('Authorization', bearer()).send(change())).status).toBe(403);
    const bad = await post('password/change').send({ ...change(), currentPassword: 'wrong' });
    expect(bad.status).toBe(401); expect(bad.body.code).toBe('CURRENT_PASSWORD_INVALID'); expect(bad.headers['set-cookie']).toBeUndefined();
    expect(f.state()).toEqual(before);
  });

  test('recovery requires ADMIN, present reauthentication and verified-record reference, and revokes target only', async () => {
    expect((await post('accounts/5/password/recover', '2').send(recovery())).status).toBe(403);
    expect((await post('accounts/5/password/recover', '3').send(recovery())).status).toBe(403);
    expect((await post('accounts/5/password/recover').send({ ...recovery(), currentPassword: 'wrong' })).status).toBe(401);
    const result = await post('accounts/5/password/recover').send(recovery());
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ recovered: true, userId: '5', revokedSessions: 2 });
    expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['set-cookie']).toBeUndefined();
    expect((await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', bearer('5'))).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', bearer())).status).toBe(200);
  });
});
