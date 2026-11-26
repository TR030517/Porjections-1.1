/* ACCEPT-02 server controls: real AuthModule, HTTP cookies, JWT and MySQL.
 * TEST_DATABASE_URL must satisfy the existing loopback:3310/mj2_test_* guard.
 * A new random schema is migrated and finally dropped; no live account or DB.
 * A service barrier only delays one captured logout call, then invokes the
 * unmodified real AuthService.logout. Prisma, results and revocation are real.
 * Browser 503/disconnect/full-reopen testing belongs to its separate EGO proof.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { installTestEnvironment, withFreshDatabase, deferred, within } = require('./booking-resources.support.cjs');
installTestEnvironment();
Object.assign(process.env, { AUTH_LOCAL_OTP: 'false', AUTH_EMAIL_LOCAL_OTP: 'false', AUTH_EMAIL_API_KEY: '', AUTH_EMAIL_PROVIDER: '',
  AUTH_GOOGLE_CLIENT_IDS: '', AUTH_GOOGLE_WEB_CLIENT_ID: '', AUTH_APPLE_CLIENT_IDS: '', AUTH_APPLE_WEB_CLIENT_ID: '', AUTH_APPLE_WEB_REDIRECT_URI: '',
  ORDER_EMAIL_ENABLED: 'false', ORDER_EMAIL_API_KEY: '', NOTIFICATION_WORKER_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled' });
require('ts-node/register/transpile-only');
require('reflect-metadata');

test('ACCEPT-02 successful and late logout revoke only captured sessions without erasing newer cookies', { timeout: 180000 }, async t => {
  const files = ['prisma/schema.prisma', 'src/modules/auth/auth.controller.ts', 'src/modules/auth/auth.service.ts',
    'src/modules/auth/auth.module.ts', 'src/modules/auth/strategies/jwt.strategy.ts', 'src/modules/auth/security.ts',
    'test/booking-resources.support.cjs', 'test/logout-session.integration.cjs'];
  const manifest = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
  const sourceSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  t.diagnostic('ACCEPT02_LOGOUT_SOURCE ' + JSON.stringify({ sourceSha256, files: manifest }));
  await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash } = require('bcryptjs');
    const { AuthModule } = require('../src/modules/auth/auth.module');
    const { AuthService, hashToken } = require('../src/modules/auth/auth.service');
    const { PrismaModule } = require('../src/prisma/prisma.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const reader = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const originalFetch = globalThis.fetch, password = randomBytes(24).toString('base64url'), prefix = randomBytes(6).toString('hex');
    const users = {}, observations = [];
    let app, origin, auth;
    const customer = role => role === 'CUSTOMER';
    const cookieName = role => customer(role) ? 'massajoy_customer_refresh' : 'massajoy_refresh';
    const refreshRoute = role => '/auth/' + (customer(role) ? 'customer/' : '') + 'refresh';
    const logoutRoute = role => '/auth/' + (customer(role) ? 'customer/' : '') + 'logout';
    const call = async (route, { cookie, token, body, browser = true, method = body === undefined ? 'GET' : 'POST' } = {}) => {
      const response = await fetch(origin + '/api/v1' + route, { method,
        headers: { ...(browser ? { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      let bodyJson; try { bodyJson = await response.json(); } catch { bodyJson = {}; }
      return { status: response.status, body: bodyJson, cookies: response.headers.getSetCookie(), cacheControl: response.headers.get('cache-control') };
    };
    const status = (response, expected) => { assert.equal(response.status, expected, 'Unexpected auth HTTP status; private response omitted'); return response.body; };
    const pair = (response, role) => {
      assert.equal(response.cookies.length, 1);
      const value = response.cookies[0], name = cookieName(role);
      assert.ok(value.startsWith(name + '=')); assert.match(value, /; HttpOnly(?:;|$)/); assert.match(value, /; SameSite=Strict(?:;|$)/);
      assert.ok(value.includes('; Path=' + (customer(role) ? '/api/v1/auth/customer;' : '/api/v1/auth;')));
      assert.equal(response.cacheControl, 'no-store'); assert.equal(response.body.refreshToken, undefined, 'Browser response must not expose refresh token');
      return value.split(';')[0];
    };
    const rawRefresh = cookie => decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    const sid = access => JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString()).sid;
    const session = async login => {
      const rows = await reader.$queryRaw(Prisma.sql`SELECT id,user_id,revoked_at,rotated_to FROM auth_sessions WHERE id=${sid(login.accessToken)}`);
      assert.equal(rows.length, 1); return rows[0];
    };
    const login = async role => {
      const result = await call('/auth/' + (customer(role) ? 'customer/' : '') + 'password/login', { body: { email: users[role].email, password } });
      const value = status(result, 200); assert.equal(value.user.role, role); assert.equal(value.user.id, String(users[role].id));
      return { ...value, cookie: pair(result, role) };
    };
    const me = login => call('/auth/me', { token: login.accessToken });
    const assertRevoked = async (login, role) => {
      status(await me(login), 401);
      status(await call(refreshRoute(role), { cookie: login.cookie, body: {} }), 401);
      // Also exercise the native proof path: a revoked captured refresh token
      // must not regain access just because it is supplied in the request body.
      status(await call(refreshRoute(role), { browser: false, body: { refreshToken: rawRefresh(login.cookie) } }), 401);
      const saved = await session(login); assert.ok(saved.revoked_at); return saved;
    };
    try {
      const passwordHash = await hash(password, 10);
      for (const role of ['ADMIN', 'MERCHANT', 'CUSTOMER']) users[role] = await db.user.create({ data: { role, status: 'ACTIVE',
        email: prefix + '.' + role.toLowerCase() + '@example.invalid', name: 'Synthetic logout ' + role, passwordHash,
        ...(customer(role) ? { emailVerifiedAt: new Date() } : {}) } });
      const module = await Test.createTestingModule({ imports: [PrismaModule, AuthModule] }).overrideProvider(PrismaService).useValue(db).compile();
      app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      auth = module.get(AuthService);
      globalThis.fetch = (input, options) => { if (new URL(String(input)).origin !== origin) throw Error('EXTERNAL_HTTP_FORBIDDEN'); return originalFetch(input, options); };

      for (const role of ['ADMIN', 'MERCHANT', 'CUSTOMER']) await t.test(role + ' successful cookie logout revokes old access/refresh and preserves its sibling session', async () => {
        const a = await login(role), sibling = await login(role);
        status(await me(a), 200); status(await me(sibling), 200);
        const result = await call(logoutRoute(role), { cookie: a.cookie, body: {} });
        assert.equal(status(result, 200).success, true); assert.deepEqual(result.cookies, []); assert.equal(result.cacheControl, 'no-store');
        await assertRevoked(a, role); status(await me(sibling), 200); assert.equal((await session(sibling)).revoked_at, null);
        const beforeReplay = await session(a); status(await call(logoutRoute(role), { cookie: a.cookie, body: {} }), 200); assert.deepEqual(await session(a), beforeReplay);
        observations.push({ case: 'SUCCESS', role, capturedSessionRevoked: true, oldAccessAndRefreshRejected: true, siblingSessionActive: true, responseSetCookieCount: result.cookies.length });
      });

      await t.test('management and customer cookie names/paths remain independent through both logout directions', async () => {
        const management = await login('ADMIN'), customerA = await login('CUSTOMER'), combined = management.cookie + '; ' + customerA.cookie;
        const beforeWrongCookie = await reader.authSession.count({ where: { revokedAt: null } });
        status(await call('/auth/customer/refresh', { cookie: management.cookie, body: {} }), 401);
        status(await call('/auth/refresh', { cookie: customerA.cookie, body: {} }), 401);
        assert.equal(await reader.authSession.count({ where: { revokedAt: null } }), beforeWrongCookie);
        const customerOut = await call('/auth/customer/logout', { cookie: combined, body: {} }); status(customerOut, 200); assert.deepEqual(customerOut.cookies, []);
        await assertRevoked(customerA, 'CUSTOMER'); status(await me(management), 200); assert.equal((await session(management)).revoked_at, null);
        const rotatedResult = await call('/auth/refresh', { cookie: combined, body: {} }), managementB = { ...status(rotatedResult, 200), cookie: pair(rotatedResult, 'ADMIN') };
        const customerB = await login('CUSTOMER');
        const managementOut = await call('/auth/logout', { cookie: managementB.cookie + '; ' + customerB.cookie, body: {} }); status(managementOut, 200); assert.deepEqual(managementOut.cookies, []);
        await assertRevoked(managementB, 'ADMIN'); status(await me(customerB), 200); assert.equal((await session(customerB)).revoked_at, null);
        const customerRefresh = await call('/auth/customer/refresh', { cookie: managementB.cookie + '; ' + customerB.cookie, body: {} });
        assert.equal(status(customerRefresh, 200).user.role, 'CUSTOMER'); pair(customerRefresh, 'CUSTOMER');
        observations.push({ case: 'COOKIE_NAMESPACES', wrongNameRefreshRejectedWithoutRotation: true, customerLogoutPreservesManagement: true, managementLogoutPreservesCustomer: true });
      });

      for (const role of ['ADMIN', 'MERCHANT', 'CUSTOMER']) await t.test(role + ' late A logout never clears newer B login cookie and revokes exactly captured A in SQL', async () => {
        const a = await login(role), entered = deferred(), release = deferred(), originalLogout = auth.logout;
        let captured = false, finished = false, pending;
        auth.logout = async function (token, requiredRole) {
          if (!captured && hashToken(token) === hashToken(rawRefresh(a.cookie))) {
            captured = true; entered.resolve(); await release.promise;
          }
          // The barrier never substitutes a result or persistence operation.
          const result = await originalLogout.call(this, token, requiredRole); finished = true; return result;
        };
        try {
          pending = call(logoutRoute(role), { cookie: a.cookie, body: {} });
          await within(entered.promise, 5000, 'REAL_SERVER_LOGOUT_DID_NOT_REACH_BARRIER');
          assert.equal(finished, false); assert.equal((await session(a)).revoked_at, null);
          const b = await login(role); assert.notEqual(sid(a.accessToken), sid(b.accessToken)); assert.notEqual(a.cookie, b.cookie);
          status(await me(b), 200); assert.equal((await session(b)).revoked_at, null);
          // B is now the browser's replacement cookie. The late A response is
          // inspected before applying anything to this cookie jar.
          release.resolve(); const out = await pending;
          assert.equal(status(out, 200).success, true); assert.deepEqual(out.cookies, []); assert.equal(out.cacheControl, 'no-store'); assert.equal(finished, true);
          await assertRevoked(a, role); status(await me(b), 200);
          const aSql = await session(a), bSql = await session(b); assert.ok(aSql.revoked_at); assert.equal(aSql.rotated_to, null); assert.equal(bSql.revoked_at, null); assert.equal(bSql.user_id, aSql.user_id);
          const refreshed = await call(refreshRoute(role), { cookie: b.cookie, body: {} });
          const latest = { ...status(refreshed, 200), cookie: pair(refreshed, role) }; status(await me(latest), 200); assert.equal((await session(latest)).revoked_at, null);
          observations.push({ case: 'LATE_A_NEW_B', role, barrierReachedThroughRealHttp: true, newLoginCompletedBeforeARelease: true,
            capturedARevoked: true, newBActiveAfterAResponse: true, newBCookieRefreshSucceeded: true, responseSetCookieCount: out.cookies.length });
        } finally { release.resolve(); if (pending) await pending; auth.logout = originalLogout; }
      });
      const finalUsers = await reader.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, role: true, status: true, passwordHash: true } });
      assert.equal(finalUsers.length, 3); assert.ok(finalUsers.every(row => row.status === 'ACTIVE' && row.passwordHash === passwordHash));
      assert.equal(await reader.booking.count(), 0); assert.equal(await reader.shop.count(), 0);
      t.diagnostic('ACCEPT02_LOGOUT_HTTP_SQL_EXECUTED ' + JSON.stringify({ migrationCount, businessCases: 7, observations,
        usersAndPasswordsUnchanged: true, mainDatabaseAccess: false, externalDelivery: false, browserFaultProofIncluded: false }));
      for (const [file, digest] of Object.entries(manifest)) assert.equal(createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex'), digest, 'Logout candidate source changed during execution');
    } finally { globalThis.fetch = originalFetch; if (app) await app.close(); await reader.$disconnect(); }
  });
});
