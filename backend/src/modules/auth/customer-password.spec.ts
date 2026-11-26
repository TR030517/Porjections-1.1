import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { compare, hashSync } from 'bcryptjs';
const request = require('supertest');
import { AuthService, hashToken } from './auth.service';
import { CustomerAuthService, emailCodeHash } from './customer-auth.service';
import { CustomerPasswordService, recoveryCodeHash } from './customer-password.service';
import { CustomerPasswordController } from './customer-password.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from '../../common/guards/roles.guard';

const oldPassword = 'synthetic-old-password';
const newPassword = 'synthetic-new-password';
const oldHash = hashSync(oldPassword, 4);
const envKeys = ['NODE_ENV', 'AUTH_EMAIL_LOCAL_OTP', 'AUTH_EMAIL_PROVIDER', 'AUTH_EMAIL_API_KEY', 'AUTH_EMAIL_FROM', 'JWT_SECRET'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', AUTH_EMAIL_LOCAL_OTP: 'true', JWT_SECRET: 'private-synthetic-fixture-only-not-a-deployment-secret' });
});
afterAll(() => { for (const key of envKeys) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; } });
const actor = { id: '1', role: 'CUSTOMER', sessionId: 'session-a' };

function fixture() {
  let state: any = {
    users: [
      { id: 1n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, email: 'customer@example.invalid', emailVerifiedAt: new Date(0), passwordHash: oldHash, name: 'Synthetic customer' },
      { id: 2n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null, email: 'other@example.invalid', passwordHash: oldHash },
      { id: 3n, role: 'ADMIN', status: 'ACTIVE', deletedAt: null, email: 'admin@example.invalid', passwordHash: oldHash },
    ],
    sessions: [
      { id: 'session-a', userId: 1n, tokenHash: hashToken('refresh-a'), revokedAt: null, expiresAt: new Date(Date.now() + 600000) },
      { id: 'session-b', userId: 1n, tokenHash: hashToken('refresh-b'), revokedAt: null, expiresAt: new Date(Date.now() + 600000) },
      { id: 'session-other', userId: 2n, tokenHash: hashToken('refresh-other'), revokedAt: null, expiresAt: new Date(Date.now() + 600000) },
    ],
    recoveries: [], throttles: [], logins: [], devices: [{ userId: 1n }, { userId: 2n }], audits: [],
    bookings: [{ id: 11n, userId: 1n, contactName: 'Unchanged contact', contactPhone: '+12025550101', contactEmail: 'contact@example.invalid', priceCents: 4000 }],
  };
  let queue = Promise.resolve(), failure: string | undefined, beforeTransaction: (() => void) | undefined;
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: any) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('gt' in value) return row[key] > value.gt;
      if ('lt' in value) return row[key] < value.lt;
      if ('in' in value) return value.in.includes(row[key]);
    }
    return row[key] === value;
  });
  const client = (data: any): any => {
    const delegate = (name: string) => ({
      findUnique: jest.fn(async ({ where, include }: any) => {
        const row = data[name].find((r: any) => matches(r, where));
        return structuredClone(row && include?.user ? { ...row, user: data.users.find((u: any) => u.id === row.userId) } : row ?? null);
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => { const row = data[name].find((r: any) => matches(r, where)); if (!row) throw Error('Not found'); return structuredClone(row); }),
      findMany: jest.fn(async ({ where, take }: any) => structuredClone(data[name].filter((r: any) => matches(r, where)).slice(0, take))),
      create: jest.fn(async ({ data: input }: any) => {
        const row = { consumedAt: null, deliveryState: 'PENDING', attempts: 0, revokedAt: null, ...input };
        data[name].push(row); return structuredClone(row);
      }),
      upsert: jest.fn(async ({ where, create }: any) => { let row = data[name].find((r: any) => matches(r, where)); if (!row) { row = create; data[name].push(row); } return structuredClone(row); }),
      update: jest.fn(async ({ where, data: update }: any) => {
        const row = data[name].find((r: any) => matches(r, where));
        Object.assign(row, Object.fromEntries(Object.entries(update).map(([key, value]: any) => [key, value?.increment ? row[key] + value.increment : value])));
        return structuredClone(row);
      }),
      updateMany: jest.fn(async ({ where, data: update }: any) => {
        const rows = data[name].filter((r: any) => matches(r, where)); rows.forEach((r: any) => Object.assign(r, update)); return { count: rows.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const rows = data[name].filter((r: any) => matches(r, where)); data[name] = data[name].filter((r: any) => !matches(r, where)); return { count: rows.length };
      }),
    });
    return {
      $queryRaw: jest.fn(async () => []),
      user: delegate('users'), authSession: delegate('sessions'), emailPasswordRecoveryChallenge: delegate('recoveries'),
      emailLoginThrottle: delegate('throttles'), emailLoginChallenge: delegate('logins'), pushDevice: delegate('devices'),
      auditLog: { create: jest.fn(async ({ data: input }: any) => { if (failure === 'audit') { failure = undefined; throw Error('Synthetic audit write failure'); } data.audits.push(input); return input; }) },
    };
  };
  const transaction = (work: any) => {
    const result = queue.then(async () => {
      beforeTransaction?.(); beforeTransaction = undefined;
      const staged = structuredClone(state), value = await work(client(staged));
      if (failure === 'commit') { failure = undefined; throw Error('Synthetic commit failure'); }
      state = staged; return value;
    });
    queue = result.then(() => undefined, () => undefined); return result;
  };
  const db: any = new Proxy({}, { get: (_target, key) => key === '$transaction' ? transaction : client(state)[key] });
  const delivery = { send: jest.fn(async () => {}), sendPasswordRecovery: jest.fn(async () => {}) };
  const service = new CustomerPasswordService(db, delivery as any);
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const auth = new AuthService(db, jwt);
  return { db, service, auth, delivery, state: () => state, fail: (at: string) => { failure = at; },
    beforeTransaction: (hook: () => void) => { beforeTransaction = hook; },
    resend: () => { for (const row of state.throttles) row.lastSentAt = new Date(0); },
    body: (challenge: any) => ({ challengeId: challenge.challengeId, code: challenge.devCode!, newPassword }) };
}

describe('customer password rotation and purpose-bound recovery (transaction substitute)', () => {
  test('verified recovery rotates password and revokes both old access/refresh sessions without changing customer, order or contact', async () => {
    const f = fixture(), customerBefore = structuredClone(f.state().users[0]), bookings = structuredClone(f.state().bookings);
    const oldSessionUser = structuredClone(f.state().users[0]);
    const challenge = await f.service.requestRecovery(' CUSTOMER@EXAMPLE.INVALID ');
    expect(f.state().sessions.every((s: any) => !s.revokedAt)).toBe(true);
    expect(f.state().users[0].passwordHash).toBe(oldHash);
    expect(await f.service.recover(f.body(challenge))).toEqual({ changed: true, reauthenticationRequired: true, revokedSessions: 2 });
    expect(await compare(oldPassword, f.state().users[0].passwordHash)).toBe(false);
    expect(await compare(newPassword, f.state().users[0].passwordHash)).toBe(true);
    expect({ ...f.state().users[0], passwordHash: oldHash }).toEqual(customerBefore);
    expect(f.state().bookings).toEqual(bookings);
    expect(f.state().devices).toEqual([{ userId: 2n }]);
    const strategy = new JwtStrategy(f.db);
    await expect(strategy.validate({ sub: '1', sid: 'session-a' })).rejects.toThrow('Session unavailable');
    await expect(strategy.validate({ sub: '1', sid: 'session-b' })).rejects.toThrow('Session unavailable');
    await expect(f.auth.refreshToken('refresh-a', 'CUSTOMER')).rejects.toThrow('Invalid refresh token');
    await expect(f.auth.refreshToken('refresh-b', 'CUSTOMER')).rejects.toThrow('Invalid refresh token');
    await expect(f.auth.passwordLogin('customer@example.invalid', oldPassword, 'CUSTOMER')).rejects.toThrow('Invalid credentials');
    await expect((f.auth as any).createSession(oldSessionUser, 'CUSTOMER')).rejects.toThrow('Account unavailable');
    expect((await f.auth.passwordLogin('customer@example.invalid', newPassword, 'CUSTOMER')).user.id).toBe('1');
    expect((await strategy.validate({ sub: '2', sid: 'session-other' })).id).toBe('2');
    expect(f.state().audits).toHaveLength(1);
    const audit = JSON.stringify(f.state().audits, (_key, value) => typeof value === 'bigint' ? String(value) : value);
    for (const secret of [oldPassword, newPassword, challenge.devCode!, 'customer@example.invalid', 'refresh-a']) expect(audit).not.toContain(secret);
  });

  test('ordinary email OTP sign-in retains the password and other session; its proof cannot reset a password', async () => {
    const f = fixture();
    const customer = new CustomerAuthService(f.db, f.auth, {} as any, f.delivery as any);
    const challenge = await customer.requestEmail('customer@example.invalid');
    const session = await customer.verifyEmail(challenge.challengeId, challenge.devCode!);
    expect(session.user.id).toBe('1');
    expect(f.state().users[0].passwordHash).toBe(oldHash);
    expect(f.state().sessions.find((s: any) => s.id === 'session-a').revokedAt).toBeNull();
    await expect(f.service.recover(f.body(challenge))).rejects.toThrow('invalid, expired or already used');
  });

  test('recovery proof cannot be used as sign-in proof and is domain separated', async () => {
    const f = fixture(), challenge = await f.service.requestRecovery('customer@example.invalid');
    const row = f.state().recoveries[0];
    expect(row.codeHash).toBe(recoveryCodeHash(row.id, row.email, challenge.devCode!));
    expect(row.codeHash).not.toBe(emailCodeHash(row.id, row.email, challenge.devCode!));
    expect(row.codeHash).not.toBe(challenge.devCode);
    const customer = new CustomerAuthService(f.db, f.auth, {} as any, f.delivery as any);
    await expect(customer.verifyEmail(challenge.challengeId, challenge.devCode!)).rejects.toThrow('Invalid email code');
  });

  test.each(['unknown@example.invalid', 'admin@example.invalid'])('request for %s returns the same public contract without sending or creating a proof', async email => {
    const f = fixture(), challenge = await f.service.requestRecovery(email);
    expect(challenge).toMatchObject({ challengeId: expect.any(String), expiresIn: 600, resendAfter: 60, devCode: expect.stringMatching(/^\d{6}$/) });
    expect(f.delivery.sendPasswordRecovery).not.toHaveBeenCalled();
    expect(f.state().recoveries).toHaveLength(0);
    expect(f.state().users[0].passwordHash).toBe(oldHash);
  });

  test('failed delivery does not reveal account existence or make the challenge usable', async () => {
    const f = fixture(); f.delivery.sendPasswordRecovery.mockRejectedValueOnce(Error('Synthetic delivery failure'));
    const challenge = await f.service.requestRecovery('customer@example.invalid');
    expect(challenge.expiresIn).toBe(600);
    expect(f.state().recoveries[0]).toMatchObject({ deliveryState: 'FAILED', consumedAt: expect.any(Date) });
    await expect(f.service.recover(f.body(challenge))).rejects.toThrow('invalid, expired or already used');
  });

  test('wrong codes count attempts, lock after five, and never rotate or revoke', async () => {
    const f = fixture(), challenge = await f.service.requestRecovery('customer@example.invalid');
    const wrong = challenge.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(f.service.recover({ ...f.body(challenge), code: wrong })).rejects.toThrow('invalid, expired or already used');
    expect(f.state().recoveries[0].attempts).toBe(5);
    expect(f.state().recoveries[0].consumedAt).toBeInstanceOf(Date);
    await expect(f.service.recover(f.body(challenge))).rejects.toThrow('invalid, expired or already used');
    expect(f.state().users[0].passwordHash).toBe(oldHash);
    expect(f.state().sessions.every((s: any) => !s.revokedAt)).toBe(true);
    expect(f.state().audits).toHaveLength(0);
  });

  test.each(['expired', 'credentials', 'email', 'suspended', 'role'])('%s proof is rejected without consuming it or mutating credentials', async boundary => {
    const f = fixture(), challenge = await f.service.requestRecovery('customer@example.invalid');
    if (boundary === 'expired') f.state().recoveries[0].expiresAt = new Date(0);
    if (boundary === 'credentials') f.state().users[0].passwordHash = hashSync('another-synthetic-password', 4);
    if (boundary === 'email') f.state().users[0].email = 'changed@example.invalid';
    if (boundary === 'suspended') f.state().users[0].status = 'SUSPENDED';
    if (boundary === 'role') f.state().users[0].role = 'ADMIN';
    const before = structuredClone(f.state());
    await expect(f.service.recover(f.body(challenge))).rejects.toThrow('invalid, expired or already used');
    expect(f.state()).toEqual(before);
  });

  test('same proof submitted concurrently applies once; replay does not add an audit', async () => {
    const f = fixture(), challenge = await f.service.requestRecovery('customer@example.invalid');
    const results = await Promise.allSettled([f.service.recover(f.body(challenge)), f.service.recover(f.body(challenge))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
    await expect(f.service.recover(f.body(challenge))).rejects.toThrow();
    expect(f.state().audits).toHaveLength(1);
  });

  test.each(['audit', 'commit'])('%s failure rolls back password, proof, session and audit changes', async stage => {
    const f = fixture(), challenge = await f.service.requestRecovery('customer@example.invalid'), before = structuredClone(f.state());
    f.fail(stage);
    await expect(f.service.recover(f.body(challenge))).rejects.toThrow('Synthetic');
    expect(f.state()).toEqual(before);
    expect((await f.service.recover(f.body(challenge))).changed).toBe(true);
  });

  test('request is rate limited across recovery and normal email login without invalidating normal OTP', async () => {
    const f = fixture(), customer = new CustomerAuthService(f.db, f.auth, {} as any, f.delivery as any);
    const normal = await customer.requestEmail('customer@example.invalid');
    f.resend();
    await f.service.requestRecovery('customer@example.invalid');
    expect(f.state().logins.find((row: any) => row.id === normal.challengeId).consumedAt).toBeNull();
    await expect(f.service.requestRecovery('customer@example.invalid')).rejects.toThrow('Please wait');
    await expect(customer.requestEmail('customer@example.invalid')).rejects.toThrow('EMAIL_LOGIN_RATE_LIMITED');
  });

  test('changing the password verifies the active actor, revokes both sessions and invalidates old recovery and login proof', async () => {
    const f = fixture(), challenge = await f.service.requestRecovery('customer@example.invalid');
    f.state().logins.push({ id: 'old-sign-in-proof', email: 'customer@example.invalid', consumedAt: null });
    expect(await f.service.change(actor, { currentPassword: oldPassword, newPassword })).toEqual({ changed: true, reauthenticationRequired: true, revokedSessions: 2 });
    expect(f.state().recoveries[0].consumedAt).toBeInstanceOf(Date);
    expect(f.state().logins[0].consumedAt).toBeInstanceOf(Date);
    await expect(f.service.recover(f.body(challenge))).rejects.toThrow();
    expect(f.state().audits[0].action).toBe('CUSTOMER_PASSWORD_CHANGED');
  });

  test.each(['wrong-password', 'other-actor', 'revoked-session', 'changed-during-comparison'])('%s cannot change a password', async boundary => {
    const f = fixture(); let inputActor = { ...actor }, currentPassword = oldPassword;
    if (boundary === 'wrong-password') currentPassword = 'incorrect-synthetic-password';
    if (boundary === 'other-actor') inputActor = { ...actor, id: '2' };
    if (boundary === 'revoked-session') f.state().sessions[0].revokedAt = new Date();
    if (boundary === 'changed-during-comparison') f.beforeTransaction(() => { f.state().users[0].passwordHash = hashSync('concurrent-password', 4); });
    await expect(f.service.change(inputActor, { currentPassword, newPassword })).rejects.toThrow();
    expect(f.state().audits).toHaveLength(0);
    expect(f.state().sessions.filter((s: any) => !s.revokedAt)).toHaveLength(boundary === 'revoked-session' ? 2 : 3);
  });

  test.each(['short', 'x'.repeat(73), 'valid\npassword'])('invalid replacement policy is rejected before consuming proof', async password => {
    const f = fixture(), challenge = await f.service.requestRecovery('customer@example.invalid'), before = structuredClone(f.state());
    await expect(f.service.recover({ ...f.body(challenge), newPassword: password })).rejects.toThrow('6–72 UTF-8 bytes');
    expect(f.state()).toEqual(before);
  });
});

describe('customer password HTTP contract (service substitute, no database)', () => {
  test('validates DTOs, blocks cross-origin, and never mutates a newer browser session cookie', async () => {
    const passwords = { change: jest.fn(async () => ({ changed: true, reauthenticationRequired: true, revokedSessions: 2 })), requestRecovery: jest.fn(async () => ({ challengeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', expiresIn: 600, resendAfter: 60 })), recover: jest.fn(async () => ({ changed: true, reauthenticationRequired: true, revokedSessions: 2 })) };
    const module = await Test.createTestingModule({ controllers: [CustomerPasswordController], providers: [{ provide: CustomerPasswordService, useValue: passwords }, RolesGuard] })
      .overrideGuard(AuthGuard('jwt')).useValue({ canActivate: (context: any) => { context.switchToHttp().getRequest().user = actor; return true; } }).compile();
    const app = module.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
    try {
      expect((await request(app.getHttpServer()).post('/api/v1/auth/customer/password/recovery/request').send({ email: 'not-email' })).status).toBe(400);
      expect((await request(app.getHttpServer()).post('/api/v1/auth/customer/password/recovery/complete').send({ challengeId: 'invalid', code: '123456', newPassword })).status).toBe(400);
      expect((await request(app.getHttpServer()).post('/api/v1/auth/customer/password/change').set('Origin', 'https://untrusted.invalid').send({ currentPassword: oldPassword, newPassword })).status).toBe(403);
      expect(passwords.change).not.toHaveBeenCalled();
      const changed = await request(app.getHttpServer()).post('/api/v1/auth/customer/password/change').send({ currentPassword: oldPassword, newPassword });
      expect(changed.status).toBe(200); expect(changed.headers['cache-control']).toBe('no-store');
      expect(changed.headers['set-cookie']).toBeUndefined();
      const recovered = await request(app.getHttpServer()).post('/api/v1/auth/customer/password/recovery/complete').send({ challengeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', code: '123456', newPassword });
      expect(recovered.status).toBe(200); expect(recovered.headers['set-cookie']).toBeUndefined();
    } finally { await app.close(); }
  });
});
