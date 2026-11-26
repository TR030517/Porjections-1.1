/* NEXT-03. Run only against the guarded, disposable MySQL test prefix. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { installTestEnvironment, withFreshDatabase } = require('./booking-resources.support.cjs');
installTestEnvironment();
require('ts-node/register/transpile-only');
require('reflect-metadata');

test('administrator creation enforces UTF-8 policy through real HTTP and independent SQL reads', { timeout: 180000 }, async t => {
  await withFreshDatabase(async ({ db }) => {
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash, compare } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const prefix = randomBytes(6).toString('hex'), initialPassword = randomBytes(24).toString('base64url');
    const passwordHash = await hash(initialPassword, 10), identities = {}, sessions = {};
    for (const role of ['ADMIN', 'MERCHANT', 'STAFF', 'CUSTOMER']) {
      identities[role] = await db.user.create({ data: { email: `${prefix}.${role.toLowerCase()}@example.invalid`, name: 'Synthetic policy actor', role,
        passwordHash, ...(role === 'CUSTOMER' ? { emailVerifiedAt: new Date() } : {}) } });
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    const app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalInterceptors(new BigIntInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const originalFetch = globalThis.fetch;
    try {
      await app.listen(0, '127.0.0.1'); const origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      globalThis.fetch = (input, options) => {
        assert.equal(new URL(String(input)).origin, origin, 'EXTERNAL_HTTP_FORBIDDEN'); return originalFetch(input, options);
      };
      const call = async (route, body, token) => {
        const result = await fetch(origin + '/api/v1' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
        return { status: result.status, body: await result.json() };
      };
      for (const role of Object.keys(identities)) {
        const response = await call('/auth/login', { identifier: identities[role].email, password: initialPassword });
        assert.equal(response.status, 200, 'SYNTHETIC_ACTOR_LOGIN_FAILED'); sessions[role] = response.body;
      }
      const snapshot = async () => ({ users: await db.user.count(), audits: await db.auditLog.count() });
      let number = 0;
      const accountBody = password => ({ name: 'Synthetic created policy account', email: `${prefix}.created.${++number}@example.invalid`, phone: '+1202' + String(number).padStart(7, '0'), password });

      await t.test('each 6–11 byte ADMIN password is rejected with no user or audit write', async () => {
        const before = await snapshot();
        for (let bytes = 6; bytes < 12; bytes++) {
          const request = accountBody('a'.repeat(bytes)), response = await call('/studio/admins', request, sessions.ADMIN.accessToken);
          assert.equal(response.status, 400, 'SHORT_ADMIN_PASSWORD_ACCEPTED');
          assert.equal(response.body.code ?? response.body.error?.code, 'PASSWORD_POLICY', 'POLICY_ERROR_NOT_EXPLICIT');
          assert.equal(await db.user.count({ where: { email: request.email } }), 0, 'REJECTED_ACCOUNT_PERSISTED');
        }
        assert.deepEqual(await snapshot(), before, 'REJECTED_REQUEST_CHANGED_PERSISTED_STATE');
      });

      await t.test('12 and 72 ASCII bytes, 12/72 CJK bytes and 12 astral bytes persist bcrypt hashes and secret-free audit', async () => {
        for (const password of ['a'.repeat(12), 'a'.repeat(72), '密'.repeat(4), '密'.repeat(24), '😀'.repeat(3)]) {
          const request = accountBody(password), response = await call('/studio/admins', request, sessions.ADMIN.accessToken);
          assert.equal(response.status, 201, 'VALID_ADMIN_POLICY_REJECTED');
          assert.ok(!JSON.stringify(response.body).includes('passwordHash'), 'HASH_EXPOSED_IN_HTTP');
          const row = await db.user.findUniqueOrThrow({ where: { email: request.email } });
          assert.equal(row.role, 'ADMIN'); assert.equal(row.status, 'ACTIVE');
          assert.ok(await compare(password, row.passwordHash), 'SQL_PASSWORD_HASH_MISMATCH');
          const audit = await db.auditLog.findMany({ where: { action: 'STUDIO_CREATE', targetType: 'admins', targetId: row.id } });
          assert.equal(audit.length, 1); assert.ok(!JSON.stringify(audit[0].detail).match(/password|hash|secret/i), 'SECRET_FIELD_IN_AUDIT');
        }
      });

      await t.test('oversized and forbidden passwords are rejected without persistence', async () => {
        const before = await snapshot();
        for (const password of ['a'.repeat(73), '密'.repeat(25), '😀'.repeat(19), 'a'.repeat(11) + '\n', 'a'.repeat(11) + '\0']) {
          assert.equal((await call('/studio/admins', accountBody(password), sessions.ADMIN.accessToken)).status, 400, 'INVALID_ADMIN_POLICY_ACCEPTED');
        }
        assert.deepEqual(await snapshot(), before, 'INVALID_POLICY_MUTATED_SQL');
      });

      await t.test('merchant, staff, customer and unauthenticated callers cannot create an ADMIN', async () => {
        const before = await snapshot();
        for (const role of ['MERCHANT', 'STAFF', 'CUSTOMER']) {
          assert.equal((await call('/studio/admins', accountBody('a'.repeat(12)), sessions[role].accessToken)).status, 403, 'NON_ADMIN_CREATED_ADMIN');
        }
        assert.equal((await call('/studio/admins', accountBody('a'.repeat(12)))).status, 401, 'ANONYMOUS_CREATED_ADMIN');
        assert.deepEqual(await snapshot(), before, 'FORBIDDEN_REQUEST_CHANGED_SQL');
      });
    } finally { globalThis.fetch = originalFetch; await app.close(); }
  });
});
