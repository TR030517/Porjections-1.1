/* Dedicated synthetic customer accounts and a newly-created MySQL schema only.
 * Run only in an isolated dependency copy with a generated current Prisma client.
 * booking-resources.support rejects every target except loopback :3310/mj2_test_*.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { installTestEnvironment, withFreshDatabase } = require('./booking-resources.support.cjs');
installTestEnvironment();
process.env.AUTH_EMAIL_LOCAL_OTP = 'true';
for (const key of ['AUTH_EMAIL_PROVIDER', 'AUTH_EMAIL_API_KEY', 'AUTH_EMAIL_FROM', 'AUTH_GOOGLE_CLIENT_IDS', 'AUTH_GOOGLE_WEB_CLIENT_ID', 'AUTH_APPLE_CLIENT_IDS', 'AUTH_APPLE_WEB_CLIENT_ID', 'AUTH_APPLE_WEB_REDIRECT_URI']) process.env[key] = '';
process.env.NOTIFICATION_WORKER_ENABLED = 'false';
require('ts-node/register/transpile-only');
require('reflect-metadata');

test('customer password lifecycle: real auth HTTP, MySQL sessions, one-time proof and independent SQL readback', { timeout: 180000 }, async t => {
  await withFreshDatabase(async ({ db }) => {
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { ThrottlerModule, ThrottlerGuard } = require('@nestjs/throttler');
    const { APP_GUARD } = require('@nestjs/core');
    const { hash, compare } = require('bcryptjs');
    const { AuthModule } = require('../src/modules/auth/auth.module');
    const { PrismaModule } = require('../src/prisma/prisma.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const prefix = randomBytes(6).toString('hex');
    const originalPassword = randomBytes(18).toString('base64url');
    const nextPassword = randomBytes(18).toString('base64url');
    const changedPassword = randomBytes(18).toString('base64url');
    const passwordHash = await hash(originalPassword, 10);
    const customer = await db.user.create({ data: { email: prefix + '.customer@example.invalid', name: 'Synthetic customer recovery', role: 'CUSTOMER', status: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash } });
    const other = await db.user.create({ data: { email: prefix + '.other@example.invalid', role: 'CUSTOMER', status: 'ACTIVE', passwordHash } });
    const merchant = await db.user.create({ data: { email: prefix + '.merchant@example.invalid', role: 'MERCHANT', status: 'ACTIVE', passwordHash } });
    const shop = await db.shop.create({ data: { ownerId: merchant.id, name: 'Recovery synthetic shop', shortName: 'recover-' + prefix, address: 'Synthetic address', city: 'Test', state: 'WA', zipCode: '00000', timezone: 'America/Los_Angeles', latitude: 1, longitude: 1, phone: 'TEST-ONLY', category: 'MIXED', status: 'APPROVED' } });
    const service = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic recovery service', category: 'MASSAGE', durationMin: 30, priceCents: 4000 } });
    const booking = await db.booking.create({ data: { bookingNo: 'REC-' + prefix, userId: customer.id, shopId: shop.id, serviceId: service.id,
      bookingDate: new Date('2036-01-01T00:00:00Z'), startTime: new Date('2036-01-01T18:00:00Z'), endTime: new Date('2036-01-01T18:30:00Z'), bookingTimezone: 'America/Los_Angeles', durationMin: 30, priceCents: 4000, totalCents: 4000,
      contactName: 'Unchanged synthetic contact', contactPhone: '+12025550101', contactEmail: 'contact@example.invalid', contactVersion: 1, contactSource: 'CUSTOMER_CONFIRMED', contactEmailVerifiedAt: new Date('2035-01-01T00:00:00Z') } });
    const module = await Test.createTestingModule({ imports: [PrismaModule, AuthModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])], providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }] })
      .overrideProvider(PrismaService).useValue(db).compile();
    const app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalInterceptors(new BigIntInterceptor()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    let origin = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      assert.ok(origin && new URL(String(input)).origin === origin, 'External HTTP must never be used');
      return originalFetch(input, options);
    };
    try {
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      const call = async (route, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) => {
        const response = await fetch(origin + '/api/v1' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'), cache: response.headers.get('cache-control') };
      };
      const expect = (result, status) => { assert.equal(result.status, status, 'Unexpected HTTP status; credentials intentionally omitted'); return result.body; };
      const login = async (user, password) => expect(await call('/auth/customer/password/login', { body: { email: user.email, password } }), 200);
      const first = await login(customer, originalPassword), second = await login(customer, originalPassword), independent = await login(other, originalPassword);
      const identityBefore = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
      const bookingBefore = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
      let challenge, newSession;

      await t.test('normal OTP sign-in does not rotate the password or revoke a second session', async () => {
        const sent = expect(await call('/auth/customer/email/request', { body: { email: customer.email } }), 200);
        expect(await call('/auth/customer/email/verify', { body: { challengeId: sent.challengeId, code: sent.devCode } }), 200);
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).passwordHash, passwordHash);
        expect(await call('/auth/me', { token: second.accessToken }), 200);
        expect(await call('/auth/customer/password/recovery/complete', { body: { challengeId: sent.challengeId, code: sent.devCode, newPassword: nextPassword } }), 401);
      });

      await t.test('recovery request does not change identity or sessions; wrong proof writes only bounded attempt evidence', async () => {
        await db.emailLoginThrottle.update({ where: { email: customer.email }, data: { lastSentAt: new Date(0) } });
        challenge = expect(await call('/auth/customer/password/recovery/request', { body: { email: customer.email } }), 200);
        assert.equal(challenge.expiresIn, 600);
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).passwordHash, passwordHash);
        expect(await call('/auth/me', { token: first.accessToken }), 200);
        const row = await db.emailPasswordRecoveryChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } });
        assert.notEqual(row.codeHash, challenge.devCode); assert.equal(row.deliveryState, 'SENT'); assert.equal(row.consumedAt, null);
        const wrong = challenge.devCode === '000000' ? '111111' : '000000';
        expect(await call('/auth/customer/password/recovery/complete', { body: { challengeId: challenge.challengeId, code: wrong, newPassword: nextPassword } }), 401);
        assert.equal((await db.emailPasswordRecoveryChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } })).attempts, 1);
        assert.equal(await db.auditLog.count({ where: { action: 'CUSTOMER_PASSWORD_RECOVERED' } }), 0);
      });

      await t.test('verified recovery revokes all old access/refresh credentials, preserves orders and permits the new password', async () => {
        const recovered = await call('/auth/customer/password/recovery/complete', { body: { challengeId: challenge.challengeId, code: challenge.devCode, newPassword: nextPassword } });
        assert.equal(expect(recovered, 200).changed, true); assert.equal(recovered.cache, 'no-store');
        assert.equal(recovered.cookie, null, 'A late recovery response must not clear a newer account cookie');
        for (const session of [first, second]) {
          expect(await call('/auth/me', { token: session.accessToken }), 401);
          expect(await call('/auth/customer/refresh', { body: { refreshToken: session.refreshToken } }), 401);
        }
        expect(await call('/auth/customer/password/login', { body: { email: customer.email, password: originalPassword } }), 401);
        newSession = await login(customer, nextPassword);
        assert.equal(newSession.user.id, String(customer.id));
        expect(await call('/auth/me', { token: independent.accessToken }), 200);
        const current = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
        assert.ok(await compare(nextPassword, current.passwordHash)); assert.equal(current.id, identityBefore.id); assert.equal(current.role, identityBefore.role); assert.equal(current.email, identityBefore.email);
        assert.deepEqual(await db.booking.findUniqueOrThrow({ where: { id: booking.id } }), bookingBefore);
        const counts = await db.$queryRaw`SELECT COUNT(*) AS total, SUM(revoked_at IS NULL) AS active FROM auth_sessions WHERE user_id = ${customer.id}`;
        assert.equal(Number(counts[0].active), 1, 'Only the explicitly new password login remains active');
        assert.equal(await db.auditLog.count({ where: { action: 'CUSTOMER_PASSWORD_RECOVERED', targetId: customer.id } }), 1);
        const proof = await db.emailPasswordRecoveryChallenge.findUniqueOrThrow({ where: { id: challenge.challengeId } }); assert.ok(proof.consumedAt);
      });

      await t.test('replaying proof cannot rotate or add audit; authenticated change requires the current password', async () => {
        expect(await call('/auth/customer/password/recovery/complete', { body: { challengeId: challenge.challengeId, code: challenge.devCode, newPassword: changedPassword } }), 401);
        assert.equal(await db.auditLog.count({ where: { action: 'CUSTOMER_PASSWORD_RECOVERED', targetId: customer.id } }), 1);
        expect(await call('/auth/customer/password/change', { token: newSession.accessToken, body: { currentPassword: originalPassword, newPassword: changedPassword } }), 401);
        assert.equal(await db.auditLog.count({ where: { action: 'CUSTOMER_PASSWORD_CHANGED' } }), 0);
        const changed = await call('/auth/customer/password/change', { token: newSession.accessToken, body: { currentPassword: nextPassword, newPassword: changedPassword } });
        assert.equal(expect(changed, 200).changed, true); assert.equal(changed.cookie, null, 'Credential rotation must not overwrite a newer browser cookie');
        expect(await call('/auth/me', { token: newSession.accessToken }), 401);
        expect(await call('/auth/customer/refresh', { body: { refreshToken: newSession.refreshToken } }), 401);
        expect(await call('/auth/customer/password/login', { body: { email: customer.email, password: nextPassword } }), 401);
        const last = await login(customer, changedPassword); assert.equal(last.user.id, String(customer.id));
        assert.deepEqual(await db.booking.findUniqueOrThrow({ where: { id: booking.id } }), bookingBefore);
      });

      await t.test('independent SQL audit excludes passwords, codes, refresh tokens and contacts', async () => {
        const audits = await db.$queryRaw`SELECT action, detail FROM audit_logs WHERE target_type = 'USER' AND target_id = ${customer.id}`;
        const text = JSON.stringify(audits);
        for (const secret of [originalPassword, nextPassword, changedPassword, challenge.devCode, first.refreshToken, customer.email, booking.contactPhone]) assert.ok(!text.includes(secret), 'Audit must omit credentials and contacts');
        assert.equal(audits.length, 2);
      });
    } finally { globalThis.fetch = originalFetch; await app.close(); }
  });
});
