/** Actual Nest routes, cookie jar, JWT verification and AuthService rotation.
 * The transactional store below is an in-memory substitute, not a MySQL test.
 * Social/email delivery is substituted; no identity or message provider is called. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { hashSync } from 'bcryptjs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CustomerAuthService } from './customer-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
const request = require('supertest');

const origin = 'https://session.example.invalid';
const secret = 'Synthetic-Session-Isolation-Only-2026!abcdef0123456789';
const password = 'Synthetic-password-2026!';
const passwordHash = hashSync(password, 4);
const managementCookie = 'massajoy_refresh';
const customerCookie = 'massajoy_customer_refresh';
const user = (id: bigint, role: string) => ({ id, role, status: 'ACTIVE', passwordHash,
  email: `synthetic-${role.toLowerCase()}@example.invalid`, loginName: `synthetic_${role.toLowerCase()}`,
  phone: null, name: 'Synthetic account', avatarUrl: null });

function store() {
  const users = new Map<bigint, any>([user(1n, 'ADMIN'), user(2n, 'MERCHANT'), user(3n, 'CUSTOMER'), user(4n, 'STAFF')].map(row => [row.id, row]));
  const sessions = new Map<string, any>();
  let nextUser = 10n, queue = Promise.resolve(), afterDiscovery: (() => void) | undefined;
  const match = (row: any, where: any): boolean => where.OR ? where.OR.some((part: any) => match(row, part)) : Object.entries(where).every(([key, expected]: [string, any]) => {
    const actual = row[key];
    return expected && typeof expected === 'object' && 'gt' in expected ? actual > expected.gt : actual === expected;
  });
  const db: any = {
    $queryRaw: jest.fn(async () => { if (afterDiscovery) { const hook = afterDiscovery; afterDiscovery = undefined; hook(); } return []; }),
    user: {
      findMany: jest.fn(async ({ where, take }: any) => [...users.values()].filter(row => match(row, where)).slice(0, take)),
      findUnique: jest.fn(async ({ where }: any) => [...users.values()].find(row => match(row, where)) ?? null),
      create: jest.fn(async ({ data }: any) => { const row = { ...user(nextUser++, 'CUSTOMER'), ...data }; users.set(row.id, row); return row; }),
      upsert: jest.fn(async ({ where, create }: any) => { const old = [...users.values()].find(row => match(row, where)); if (old) return old;
        const row = { ...user(nextUser++, 'CUSTOMER'), ...create }; users.set(row.id, row); return row; }),
    },
    authSession: {
      findUnique: jest.fn(async ({ where }: any) => { const row = [...sessions.values()].find(row => match(row, where));
        return row ? { ...row, user: users.get(row.userId) } : null; }),
      create: jest.fn(async ({ data }: any) => { const row = { revokedAt: null, rotatedTo: null, ...data }; sessions.set(row.id, row); return row; }),
      updateMany: jest.fn(async ({ where, data }: any) => { let count = 0; for (const row of sessions.values()) if (match(row, where)) { Object.assign(row, data); count++; } return { count }; }),
    },
    pushDevice: { updateMany: jest.fn(async () => ({ count: 0 })), deleteMany: jest.fn(async () => ({ count: 0 })) },
  };
  // Model serialized transactional claims, while preserving the production
  // CAS predicate and read-after-user-lock order in the actual AuthService.
  db.$transaction = (work: (tx: any) => any) => { const result = queue.then(() => work(db)); queue = result.catch(() => undefined); return result; };
  return { db, users, sessions, afterDiscovery: (hook: () => void) => { afterDiscovery = hook; } };
}

function cookies(response: any) { return response.headers['set-cookie'] ?? []; }
function pair(response: any, name: string) { const entry = cookies(response).find((value: string) => value.startsWith(name + '=')); expect(entry).toBeDefined(); return entry.split(';')[0]; }
function assertCustomerCookie(response: any, secure = false) {
  expect(cookies(response)).toHaveLength(1);
  const value = cookies(response)[0];
  expect(value).toMatch(/^massajoy_customer_refresh=/);
  expect(value).toMatch(/; Path=\/api\/v1\/auth\/customer(?:;|$)/);
  expect(value).toMatch(/; HttpOnly(?:;|$)/); expect(value).toMatch(/; SameSite=Strict(?:;|$)/);
  expect(/; Secure(?:;|$)/.test(value)).toBe(secure);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.refreshToken).toBeUndefined();
}

describe('customer and management session isolation', () => {
  let app: INestApplication, fixture: ReturnType<typeof store>, auth: AuthService;
  const keys = ['NODE_ENV', 'JWT_SECRET', 'CORS_ORIGINS', 'AUTH_LOCAL_OTP'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  beforeEach(async () => {
    Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: secret, CORS_ORIGINS: origin, AUTH_LOCAL_OTP: 'true' });
    fixture = store();
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret, signOptions: { algorithm: 'HS256' } })],
      controllers: [AuthController], providers: [AuthService, JwtStrategy, { provide: PrismaService, useValue: fixture.db },
        { provide: CustomerAuthService, useFactory: (service: AuthService) => ({
          config: () => ({}), verifyEmail: async () => service.createCustomerSession(fixture.users.get(3n), true),
          socialLogin: async () => service.createCustomerSession(fixture.users.get(3n)),
        }), inject: [AuthService] },
      ] }).compile();
    auth = module.get(AuthService); app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })); await app.init();
  });
  afterEach(async () => { await app.close(); for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
  const browser = (pending: any) => pending.set('Origin', origin).set('Sec-Fetch-Site', 'same-origin');
  const login = (agent: any, role = 'CUSTOMER') => browser(agent.post(role === 'CUSTOMER' ? '/api/v1/auth/customer/password/login' : '/api/v1/auth/login'))
    .send(role === 'CUSTOMER' ? { email: 'synthetic-customer@example.invalid', password } : { identifier: `synthetic_${role.toLowerCase()}`, password });
  const me = (token: string) => request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', 'Bearer ' + token);

  test('one browser retains independent customer and management sessions through both rotations and customer logout', async () => {
    const agent = request.agent(app.getHttpServer());
    const admin = await login(agent, 'ADMIN'); expect(admin.status).toBe(200); expect(pair(admin, managementCookie)).toBeTruthy();
    const customer = await login(agent); expect(customer.status).toBe(200); assertCustomerCookie(customer);
    const customerRefresh = await browser(agent.post('/api/v1/auth/customer/refresh')).send({});
    expect(customerRefresh.status).toBe(200); expect(customerRefresh.body.user.role).toBe('CUSTOMER'); assertCustomerCookie(customerRefresh);
    expect((await me(admin.body.accessToken)).status).toBe(200); expect((await me(customer.body.accessToken)).status).toBe(401);
    const adminRefresh = await browser(agent.post('/api/v1/auth/refresh')).send({});
    expect(adminRefresh.status).toBe(200); expect(adminRefresh.body.user.role).toBe('ADMIN');
    expect((await me(customerRefresh.body.accessToken)).status).toBe(200);
    const logout = await browser(agent.post('/api/v1/auth/customer/logout')).send({}); expect(logout.status).toBe(200);
    expect(cookies(logout)).toHaveLength(0); // Cannot clear a newer login's browser cookie.
    expect((await me(customerRefresh.body.accessToken)).status).toBe(401);
    expect((await me(adminRefresh.body.accessToken)).status).toBe(200);
  });

  test('each refresh route ignores the other cookie name even if manually supplied', async () => {
    const admin = await login(request(app.getHttpServer()), 'ADMIN');
    const customer = await login(request(app.getHttpServer()));
    expect((await browser(request(app.getHttpServer()).post('/api/v1/auth/customer/refresh')).set('Cookie', pair(admin, managementCookie)).send({})).status).toBe(401);
    expect((await browser(request(app.getHttpServer()).post('/api/v1/auth/refresh')).set('Cookie', pair(customer, customerCookie)).send({})).status).toBe(401);
    expect((await me(admin.body.accessToken)).status).toBe(200); expect((await me(customer.body.accessToken)).status).toBe(200);
  });

  test('platform password login accepts only ADMIN while the merchant login remains shared', async () => {
    const admin = await browser(request(app.getHttpServer()).post('/api/v1/auth/admin/password/login'))
      .send({ identifier: 'synthetic_admin', password });
    expect(admin.status).toBe(200); expect(admin.body.user.role).toBe('ADMIN');
    expect(admin.body.refreshToken).toBeUndefined(); expect(pair(admin, managementCookie)).toBeTruthy();

    for (const role of ['MERCHANT', 'STAFF', 'CUSTOMER']) {
      const denied = await browser(request(app.getHttpServer()).post('/api/v1/auth/admin/password/login'))
        .send({ identifier: `synthetic_${role.toLowerCase()}`, password });
      expect(denied.status).toBe(401);
    }

    const merchant = await browser(request(app.getHttpServer()).post('/api/v1/auth/login'))
      .send({ identifier: 'synthetic_merchant', password });
    expect(merchant.status).toBe(200); expect(merchant.body.user.role).toBe('MERCHANT');
  });

  test('platform refresh rotates only ADMIN sessions while shared refresh remains available to management accounts', async () => {
    const admin = await login(request(app.getHttpServer()), 'ADMIN');
    const adminRefresh = await browser(request(app.getHttpServer()).post('/api/v1/auth/admin/refresh'))
      .set('Cookie', pair(admin, managementCookie)).send({});
    expect(adminRefresh.status).toBe(200); expect(adminRefresh.body.user.role).toBe('ADMIN');

    for (const role of ['MERCHANT', 'STAFF', 'CUSTOMER']) {
      const session = await login(request(app.getHttpServer()), role);
      const cookie = pair(session, role === 'CUSTOMER' ? customerCookie : managementCookie);
      fixture.db.authSession.updateMany.mockClear();
      const denied = await browser(request(app.getHttpServer()).post('/api/v1/auth/admin/refresh'))
        .set('Cookie', cookie).send({});
      expect(denied.status).toBe(401);
      expect(fixture.db.authSession.updateMany).not.toHaveBeenCalled();
      expect((await me(session.body.accessToken)).status).toBe(200);
    }

    for (const role of ['MERCHANT', 'STAFF']) {
      const session = await login(request(app.getHttpServer()), role);
      const refreshed = await browser(request(app.getHttpServer()).post('/api/v1/auth/refresh'))
        .set('Cookie', pair(session, managementCookie)).send({});
      expect(refreshed.status).toBe(200); expect(refreshed.body.user.role).toBe(role);
    }
  });

  test.each(['ADMIN', 'MERCHANT', 'STAFF'])('customer native refresh/logout rejects a %s token without rotating or revoking it', async role => {
    const result = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ identifier: `synthetic_${role.toLowerCase()}`, password });
    expect(result.status).toBe(200); const token = result.body.refreshToken;
    fixture.db.authSession.updateMany.mockClear(); fixture.db.pushDevice.deleteMany.mockClear();
    for (const route of ['refresh', 'logout']) expect((await request(app.getHttpServer()).post('/api/v1/auth/customer/' + route).send({ refreshToken: token })).status).toBe(401);
    expect(fixture.db.authSession.updateMany).not.toHaveBeenCalled(); expect(fixture.db.pushDevice.deleteMany).not.toHaveBeenCalled();
    expect((await me(result.body.accessToken)).status).toBe(200);
  });

  test('customer cookies preserve CSRF/origin checks before any rotation or revocation', async () => {
    const result = await login(request(app.getHttpServer())); const cookie = pair(result, customerCookie);
    for (const route of ['refresh', 'logout']) {
      const url = '/api/v1/auth/customer/' + route;
      expect((await request(app.getHttpServer()).post(url).set('Cookie', cookie).send({})).status).toBe(403);
      expect((await request(app.getHttpServer()).post(url).set('Cookie', cookie).set('Origin', origin).set('Sec-Fetch-Site', 'cross-site').send({})).status).toBe(403);
      expect((await request(app.getHttpServer()).post(url).set('Cookie', cookie).set('Origin', 'https://untrusted.invalid').send({})).status).toBe(403);
    }
    expect((await me(result.body.accessToken)).status).toBe(200);
  });

  test('native customer body tokens still rotate once and logout revokes the resulting access session', async () => {
    const result = await request(app.getHttpServer()).post('/api/v1/auth/customer/password/login').send({ email: 'synthetic-customer@example.invalid', password });
    expect(result.status).toBe(200); expect(typeof result.body.refreshToken).toBe('string');
    const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post('/api/v1/auth/customer/refresh').send({ refreshToken: result.body.refreshToken })));
    expect(responses.map(value => value.status).sort()).toEqual([200, 401]);
    const next = responses.find(value => value.status === 200)!;
    expect(next.body.user.role).toBe('CUSTOMER'); expect((await me(result.body.accessToken)).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/auth/customer/logout').send({ refreshToken: next.body.refreshToken })).status).toBe(200);
    expect((await me(next.body.accessToken)).status).toBe(401);
    expect(fixture.db.pushDevice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 3n }) }));
  });

  test('required customer role is reread under the user lock before the CAS claim', async () => {
    const session = await auth.passwordLogin('synthetic-customer@example.invalid', password, 'CUSTOMER');
    fixture.db.authSession.updateMany.mockClear();
    fixture.afterDiscovery(() => { fixture.users.get(3n).role = 'ADMIN'; });
    await expect(auth.refreshToken(session.refreshToken, 'CUSTOMER')).rejects.toThrow('Invalid refresh token');
    expect(fixture.db.authSession.updateMany).not.toHaveBeenCalled();
  });

  test('required admin role is reread under the user lock before the CAS claim', async () => {
    const session = await auth.passwordLogin('synthetic_admin', password, 'ADMIN');
    fixture.db.authSession.updateMany.mockClear();
    fixture.afterDiscovery(() => { fixture.users.get(1n).role = 'MERCHANT'; });
    await expect(auth.refreshToken(session.refreshToken, 'ADMIN')).rejects.toThrow('Invalid refresh token');
    expect(fixture.db.authSession.updateMany).not.toHaveBeenCalled();
  });

  test.each(['customer/email/verify', 'apple', 'google', 'verify-otp'])('%s writes only the customer cookie', async route => {
    let body: any;
    if (route === 'customer/email/verify') body = { challengeId: '11111111-1111-4111-8111-111111111111', code: '123456' };
    else if (route === 'verify-otp') { const issued = await auth.sendOtp('+12025550123'); body = { phone: '+12025550123', code: issued.devCode }; }
    else body = { idToken: 'synthetic-provider-transport-only', challengeId: '11111111-1111-4111-8111-111111111111' };
    const result = await browser(request(app.getHttpServer()).post('/api/v1/auth/' + route)).send(body);
    expect(result.status).toBe(200); assertCustomerCookie(result); expect(result.body.user.role).toBe('CUSTOMER');
  });

  test('legacy direct registration no longer issues an unverified customer session', async () => {
    const result = await browser(request(app.getHttpServer()).post('/api/v1/auth/register')).send({ email: 'unverified@example.invalid', name: 'Synthetic customer', password });
    expect(result.status).toBe(410); expect(result.body.code).toBe('CUSTOMER_REGISTRATION_REQUIRES_VERIFIED_EMAIL');
    expect(result.headers['set-cookie']).toBeUndefined();
  });

  test('production customer cookie retains Secure and strict whitelisting rejects foreign body keys', async () => {
    process.env.NODE_ENV = 'production';
    const result = await login(request(app.getHttpServer())); expect(result.status).toBe(200); assertCustomerCookie(result, true);
    const invalid = await browser(request(app.getHttpServer()).post('/api/v1/auth/customer/refresh')).send({ refreshToken: 'synthetic', requiredRole: 'ADMIN' });
    expect(invalid.status).toBe(400);
  });
});
