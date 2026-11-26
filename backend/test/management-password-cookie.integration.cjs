/* Real loopback HTTP + independent MySQL reader. Never use an existing schema. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { readFileSync, mkdtempSync, rmdirSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { installTestEnvironment, withFreshDatabase, deferred, within, isolatedTarget } = require('./booking-resources.support.cjs');
installTestEnvironment();
Object.assign(process.env, {
  AUTH_LOCAL_OTP: 'false', AUTH_EMAIL_LOCAL_OTP: 'false', AUTH_EMAIL_API_KEY: '', AUTH_EMAIL_PROVIDER: '',
  AUTH_GOOGLE_CLIENT_IDS: '', AUTH_GOOGLE_WEB_CLIENT_ID: '', AUTH_APPLE_CLIENT_IDS: '',
  AUTH_APPLE_WEB_CLIENT_ID: '', AUTH_APPLE_WEB_REDIRECT_URI: '', ORDER_EMAIL_ENABLED: 'false',
  ORDER_EMAIL_API_KEY: '', NOTIFICATION_WORKER_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled',
});
require('ts-node/register/transpile-only');
require('reflect-metadata');

// Apply the server's real Set-Cookie headers only when the corresponding HTTP
// response arrives. This is a protocol jar, not a browser/UI implementation.
function cookieJar() {
  const values = new Map();
  return {
    header() { return [...values].map(([key, value]) => key + '=' + value).join('; '); },
    apply(headers) {
      for (const header of headers) {
        const [pair, ...attributes] = header.split(';'); const equals = pair.indexOf('=');
        const name = pair.slice(0, equals), value = pair.slice(equals + 1);
        if (!value || attributes.some(part => /^\s*max-age=0\s*$/i.test(part))) values.delete(name);
        else values.set(name, value);
      }
    },
  };
}

// MySQL CREATE TRIGGER does not support Prisma's prepared-statement protocol.
// Use the installed CLI only for fixture DDL, refusing every existing schema.
function auditFaultDdl(databaseUrl, sql) {
  const target = isolatedTarget(databaseUrl);
  assert.match(target.pathname, /^\/mj2_test_booking_resources_[a-f0-9]{16}$/);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'mj2-acc01-mysql-'));
  try {
    const result = spawnSync('mysql', ['--no-defaults', '--protocol=TCP', '--host=' + target.hostname, '--port=' + target.port,
      '--user=' + decodeURIComponent(target.username), '--database=' + target.pathname.slice(1), '--batch', '--skip-column-names'],
    { input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, MYSQL_PWD: decodeURIComponent(target.password), MYSQL_TEST_LOGIN_FILE: path.join(directory, 'no-login-paths.cnf') } });
    assert.ok(!result.error && result.status === 0, 'ACC01_FIXTURE_DDL_FAILED ' + JSON.stringify({ exitCode: result.status, spawnError: result.error?.code ?? null }));
  } finally { rmdirSync(directory); }
}

test('ACC-FULL-01 committed late password responses preserve later management login cookies', { timeout: 240000 }, async t => {
  const files = ['prisma/schema.prisma', 'src/app.module.ts', 'src/modules/auth/management-password.controller.ts',
    'src/modules/auth/management-password.service.ts', 'src/modules/auth/auth.controller.ts',
    'src/modules/auth/auth.service.ts', 'src/modules/auth/strategies/jwt.strategy.ts',
    'test/booking-resources.support.cjs', 'test/management-password-cookie.integration.cjs'];
  const fingerprints = Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
  t.diagnostic('ACC01_FROZEN_SOURCE ' + JSON.stringify(fingerprints));
  const vaultDir = await mkdtemp(path.join(os.tmpdir(), 'mj2-acc01-vault-'));
  process.env.MERCHANT_CREDENTIAL_VAULT_DIR = vaultDir;
  process.env.MERCHANT_CREDENTIAL_VAULT_KEY = randomBytes(32).toString('base64');
  const originalFetch = globalThis.fetch, allowedOrigins = new Set(), observations = [];
  globalThis.fetch = (input, options) => {
    assert.ok(allowedOrigins.has(new URL(String(input)).origin), 'EXTERNAL_HTTP_FORBIDDEN');
    return originalFetch(input, options);
  };
  try { await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash, compare } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const vault = require('../scripts/lib/merchant-credential-vault.cjs');
    const reader = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = randomBytes(8).toString('hex'); let sequence = 0;
    const freshPassword = () => randomBytes(24).toString('base64url');
    const sid = login => JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString()).sid;
    const session = async login => {
      const rows = await reader.$queryRaw(Prisma.sql`SELECT id,user_id,revoked_at,rotated_to FROM auth_sessions WHERE id=${sid(login)}`);
      assert.equal(rows.length, 1); return rows[0];
    };
    const state = async user => ({
      users: await reader.$queryRaw(Prisma.sql`SELECT id,role,status,password_hash FROM users WHERE id=${user.id}`),
      sessions: await reader.$queryRaw(Prisma.sql`SELECT id,token_hash,revoked_at,rotated_to FROM auth_sessions WHERE user_id=${user.id} ORDER BY id`),
      devices: await reader.$queryRaw(Prisma.sql`SELECT id,auth_session_id,token_hash FROM push_devices WHERE user_id=${user.id} ORDER BY id`),
      audits: await reader.$queryRaw(Prisma.sql`SELECT id,action,target_id,detail FROM audit_logs WHERE operator_id=${user.id} ORDER BY id`),
    });
    const account = async role => {
      const password = freshPassword(), passwordHash = await hash(password, 10);
      const user = await db.user.create({ data: { role, status: 'ACTIVE', passwordHash,
        email: prefix + '.' + (++sequence) + '@example.invalid', name: 'ACC01 synthetic ' + role } });
      if (role === 'MERCHANT') {
        const shop = await db.shop.create({ data: { ownerId: user.id, name: 'ACC01 synthetic store', shortName: 'acc01-' + prefix + '-' + sequence,
          address: 'Synthetic test address', city: 'Test', state: 'WA', zipCode: '00000', timezone: 'America/Los_Angeles',
          latitude: 1, longitude: 1, phone: 'TEST-ONLY', category: 'MIXED', status: 'APPROVED' } });
        await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: user.id, createdById: user.id, reason: 'Dedicated ACC01 synthetic binding' } });
        vault.writeMerchantCredential({ shopId: String(shop.id), userId: String(user.id), password, passwordHash });
        user.shopId = shop.id;
      }
      return { ...user, password };
    };
    const status = (result, expected) => {
      assert.equal(result.status, expected, 'Unexpected HTTP status; credentials omitted'); return result.body;
    };

    // Each scenario has a fresh full AppModule (including the unchanged real
    // ThrottlerGuard). No request metadata or rate limits are spoofed/overridden.
    async function withApp(action) {
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
      const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      let proxy, gate, proxyOrigin; const sockets = new Set(); let forwardedChanges = 0;
      try {
        await app.listen(0, '127.0.0.1'); const upstreamOrigin = await app.getUrl();
        proxy = http.createServer((req, res) => {
          const held = req.method === 'POST' && req.url === '/api/v1/auth/password/change' ? gate : null;
          if (req.method === 'POST' && req.url === '/api/v1/auth/password/change') forwardedChanges++;
          const upstream = http.request(upstreamOrigin + req.url, { method: req.method, headers: req.headers }, incoming => {
            const chunks = []; incoming.on('data', chunk => chunks.push(chunk));
            incoming.on('end', async () => {
              const body = Buffer.concat(chunks);
              if (held) {
                held.observed = { status: incoming.statusCode, cookies: incoming.headers['set-cookie'] || [] };
                held.ready.resolve(); await held.release.promise;
              }
              if (!res.destroyed) { res.writeHead(incoming.statusCode, incoming.headers); res.end(body); }
            });
          });
          upstream.on('error', () => { if (!res.destroyed) { res.statusCode = 502; res.end('{}'); } });
          req.pipe(upstream);
        });
        proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
        await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
        proxyOrigin = 'http://127.0.0.1:' + proxy.address().port; allowedOrigins.add(proxyOrigin); process.env.CORS_ORIGINS = proxyOrigin;
        const call = async (route, { jar, cookie, token, body, signal, method = body === undefined ? 'GET' : 'POST' } = {}) => {
          const response = await fetch(proxyOrigin + '/api/v1' + route, { method,
            headers: { Origin: proxyOrigin, 'Sec-Fetch-Site': 'same-origin',
              ...(token ? { Authorization: 'Bearer ' + token } : {}), ...((cookie || jar?.header()) ? { Cookie: cookie || jar.header() } : {}),
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body), signal: signal || AbortSignal.timeout(20000) });
          const cookies = response.headers.getSetCookie(); jar?.apply(cookies);
          return { status: response.status, cookies, cacheControl: response.headers.get('cache-control'), body: await response.json() };
        };
        const login = async (user, jar, password = user.password) => {
          const result = await call('/auth/password/login', { jar, body: { email: user.email, password } });
          const value = status(result, 200); assert.equal(value.user.id, String(user.id)); assert.equal(value.user.role, user.role);
          assert.equal(result.cookies.length, 1); assert.match(result.cookies[0], /^massajoy_refresh=/);
          assert.match(result.cookies[0], /; HttpOnly(?:;|$)/); assert.match(result.cookies[0], /; SameSite=Strict(?:;|$)/);
          assert.ok(result.cookies[0].includes('; Path=/api/v1/auth;')); assert.equal(value.refreshToken, undefined);
          return { ...value, cookie: result.cookies[0].split(';')[0] };
        };
        const hold = () => { assert.ok(!gate, 'Only one held response per scenario'); gate = { ready: deferred(), release: deferred() }; return gate; };
        await action({ call, login, hold, forwarded: () => forwardedChanges });
      } finally {
        gate?.release.resolve();
        if (proxy) { for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve)); }
        allowedOrigins.delete(proxyOrigin); await app.close();
      }
    }

    async function revoked(call, login) {
      status(await call('/auth/me', { token: login.accessToken }), 401);
      status(await call('/auth/refresh', { cookie: login.cookie, body: {} }), 401);
      assert.ok((await session(login)).revoked_at);
    }
    async function newCookieSurvives(call, jar, identity) {
      const first = status(await call('/auth/refresh', { jar, body: {} }), 200);
      assert.equal(first.user.id, String(identity.id));
      status(await call('/auth/me', { token: first.accessToken }), 200);
      assert.equal((await session(first)).revoked_at, null);
      // A new client context retaining only the shared cookie can restore B.
      // Actual whole-page reload/UI identity is verified separately in EGO.
      const reopened = status(await call('/auth/refresh', { jar, body: {} }), 200);
      assert.equal(reopened.user.id, String(identity.id)); assert.equal(reopened.user.role, identity.role);
      assert.equal((await session(reopened)).revoked_at, null);
    }
    try {
      for (const [aRole, bRole, same] of [['ADMIN', 'MERCHANT', false], ['MERCHANT', 'ADMIN', false], ['ADMIN', 'ADMIN', true]]) {
        await t.test(aRole + ' committed response arrives after ' + (same ? 'same-account new-password' : bRole) + ' login', async () => withApp(async ({ call, login, hold, forwarded }) => {
          const aUser = await account(aRole), bUser = same ? aUser : await account(bRole), jar = cookieJar();
          const old = await login(aUser, jar), sibling = await login(aUser, cookieJar());
          const beforeB = same ? null : await login(bUser, cookieJar());
          const next = freshPassword(), gate = hold();
          const pending = call('/auth/password/change', { jar, token: old.accessToken, body: { currentPassword: aUser.password, newPassword: next } });
          try {
            await within(gate.ready.promise, 10000, 'COMMITTED_CHANGE_RESPONSE_NOT_HELD');
            assert.equal(gate.observed.status, 200); assert.deepEqual(gate.observed.cookies, []);
            await revoked(call, old); await revoked(call, sibling);
            const saved = await state(aUser); assert.ok(await compare(next, saved.users[0].password_hash)); assert.equal(saved.audits.length, 1);
            assert.ok(saved.sessions.every(row => row.revoked_at));
            if (beforeB) { status(await call('/auth/me', { token: beforeB.accessToken }), 200); assert.equal((await session(beforeB)).revoked_at, null); }
            const later = await login(bUser, jar, same ? next : bUser.password), cookieBeforeRelease = jar.header();
            status(await call('/auth/me', { token: later.accessToken }), 200); assert.equal((await session(later)).revoked_at, null);
            gate.release.resolve(); const response = await pending;
            const receipt = status(response, 200); assert.equal(receipt.changed, true); assert.equal(receipt.reauthenticationRequired, true); assert.equal(receipt.revokedSessions, 2);
            assert.equal(response.cacheControl, 'no-store'); assert.deepEqual(response.cookies, []); assert.equal(jar.header(), cookieBeforeRelease);
            assert.equal((await session(later)).revoked_at, null); await newCookieSurvives(call, jar, bUser);
            if (beforeB) assert.equal((await session(beforeB)).revoked_at, null);
            await revoked(call, old); await revoked(call, sibling); assert.equal(forwarded(), 1);
            if (aUser.shopId) {
              const row = await reader.user.findUniqueOrThrow({ where: { id: aUser.id } });
              assert.equal(vault.readMerchantCredential({ shopId: String(aUser.shopId), userId: String(aUser.id), passwordHash: row.passwordHash }).password, next);
            }
            observations.push({ case: same ? 'SAME_ACCOUNT_RELOGIN' : aRole + '_TO_' + bRole,
              responseHeldAfterSqlCommit: true, oldASessionsRevoked: 2, bOrLaterSessionPreserved: true, setCookieCount: 0, cookieOnlyReopen: true });
          } finally { gate.release.resolve(); await pending; }
        }));
      }
      await t.test('ordinary change keeps stale cookie but revokes all old privileges and devices', async () => withApp(async ({ call, login, forwarded }) => {
        const user = await account('ADMIN'), other = await account('MERCHANT'), jar = cookieJar();
        const old = await login(user, jar), sibling = await login(user, cookieJar()), untouched = await login(other, cookieJar());
        await db.pushDevice.create({ data: { userId: user.id, authSessionId: sid(old), tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          token: 'synthetic-only-' + randomBytes(16).toString('hex'), bindingVersion: randomUUID() } });
        const next = freshPassword(), oldCookie = jar.header();
        const result = await call('/auth/password/change', { jar, token: old.accessToken, body: { currentPassword: user.password, newPassword: next } });
        assert.equal(status(result, 200).reauthenticationRequired, true); assert.deepEqual(result.cookies, []); assert.equal(jar.header(), oldCookie);
        await revoked(call, old); await revoked(call, sibling); status(await call('/auth/refresh', { jar, body: {} }), 401);
        assert.equal((await state(user)).devices.length, 0); status(await call('/auth/me', { token: untouched.accessToken }), 200);
        status(await call('/auth/password/login', { body: { email: user.email, password: user.password } }), 401);
        const fresh = await login(user, jar, next); status(await call('/auth/me', { token: fresh.accessToken }), 200); assert.equal(forwarded(), 1);
        observations.push({ case: 'ORDINARY_CHANGE', staleCookieCannotRestoreA: true, ownOldSessionsRevoked: 2, devicesDeleted: true, newPasswordLogin: true });
      }));
      await t.test('wrong-current-password late response preserves newer B cookie without any A write', async () => withApp(async ({ call, login, hold, forwarded }) => {
        const user = await account('ADMIN'), b = await account('MERCHANT'), jar = cookieJar(), a = await login(user, jar);
        const before = await state(user), gate = hold();
        const pending = call('/auth/password/change', { jar, token: a.accessToken, body: { currentPassword: freshPassword(), newPassword: freshPassword() } });
        try {
          await within(gate.ready.promise, 10000, 'ERROR_RESPONSE_NOT_HELD'); assert.equal(gate.observed.status, 401);
          const later = await login(b, jar), cookie = jar.header(); gate.release.resolve(); const error = await pending;
          assert.equal(status(error, 401).code, 'CURRENT_PASSWORD_INVALID'); assert.deepEqual(error.cookies, []); assert.equal(jar.header(), cookie);
          assert.deepEqual(await state(user), before); status(await call('/auth/me', { token: a.accessToken }), 200);
          assert.equal((await session(later)).revoked_at, null); await newCookieSurvives(call, jar, b); assert.equal(forwarded(), 1);
          observations.push({ case: 'WRONG_CURRENT_LATE_ERROR', aStateUnchanged: true, newBCookiePreserved: true });
        } finally { gate.release.resolve(); await pending; }
      }));
      await t.test('real SQL audit failure rolls password, sessions and device removal back together', async () => withApp(async ({ call, login, forwarded }) => {
        const user = await account('ADMIN'), jar = cookieJar(), a = await login(user, jar); await login(user, cookieJar());
        await db.pushDevice.create({ data: { userId: user.id, authSessionId: sid(a), tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          token: 'synthetic-only-' + randomBytes(16).toString('hex'), bindingVersion: randomUUID() } });
        const before = await state(user), cookie = jar.header();
        auditFaultDdl(databaseUrl, "CREATE TRIGGER acc01_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_AUDIT_FAILURE';");
        try {
          const result = await call('/auth/password/change', { jar, token: a.accessToken, body: { currentPassword: user.password, newPassword: freshPassword() } });
          status(result, 500); assert.deepEqual(result.cookies, []); assert.equal(jar.header(), cookie); assert.deepEqual(await state(user), before);
        } finally { auditFaultDdl(databaseUrl, 'DROP TRIGGER acc01_reject_audit;'); }
        status(await call('/auth/me', { token: a.accessToken }), 200); await newCookieSurvives(call, jar, user); assert.equal(forwarded(), 1);
        observations.push({ case: 'REAL_AUDIT_ROLLBACK', credentialSessionsDevicesAuditUnchanged: true, oldLoginStillWorks: true });
      }));
      await t.test('dropped committed response is a single unknown-result request; new login survives', async () => withApp(async ({ call, login, hold, forwarded }) => {
        const user = await account('MERCHANT'), jar = cookieJar(), a = await login(user, jar), next = freshPassword(), gate = hold(), abort = new AbortController();
        const pending = call('/auth/password/change', { jar, token: a.accessToken, body: { currentPassword: user.password, newPassword: next }, signal: abort.signal }).then(
          () => ({ received: true }), error => ({ received: false, aborted: error.name === 'AbortError' }));
        try {
          await within(gate.ready.promise, 10000, 'DROP_RESPONSE_NOT_HELD'); assert.equal(gate.observed.status, 200);
          assert.equal((await state(user)).audits.length, 1); await revoked(call, a); abort.abort();
          assert.deepEqual(await pending, { received: false, aborted: true });
          const later = await login(user, jar, next), cookie = jar.header(); gate.release.resolve();
          await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(forwarded(), 1); assert.equal(jar.header(), cookie);
          assert.equal((await state(user)).audits.length, 1); assert.equal((await session(later)).revoked_at, null); await newCookieSurvives(call, jar, user);
          observations.push({ case: 'COMMITTED_RESPONSE_DROPPED', realCommitObserved: true, responseUnconfirmed: true,
            forwardedPasswordRequests: 1, auditWrites: 1, laterExplicitLoginPreserved: true, frontendRetryBehaviorClaimed: false });
        } finally { gate.release.resolve(); await pending; }
      }));
      assert.equal(await reader.booking.count(), 0);
      t.diagnostic('ACC01_HTTP_SQL_EXECUTED ' + JSON.stringify({ migrationCount, cases: observations.length, observations,
        independentSqlReader: true, productionGuardsAndRateLimitsRetained: true, mainDatabaseAccess: false, externalDelivery: false, browserUiProof: false }));
      for (const [file, digest] of Object.entries(fingerprints)) assert.equal(createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex'), digest, 'Frozen ACC01 source changed');
    } finally { await reader.$disconnect(); }
  }); } finally { globalThis.fetch = originalFetch; await rm(vaultDir, { recursive: true, force: true }); }
});
