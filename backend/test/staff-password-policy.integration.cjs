/* ACC-FULL-02. Real HTTP guards/DTO/services and a second SQL connection.
 * A fresh app per matrix row resets only test-process in-memory throttle state;
 * every route retains its production throttle/authorization implementation.
 * The existing strict helper creates/migrates/drops only a random mj2_test_ DB
 * on loopback:3310. Never run against a main DB or send real notifications.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { installTestEnvironment, withFreshDatabase } = require('./booking-resources.support.cjs');
const matrix = require('./staff-password-policy.matrix.cjs');
installTestEnvironment();
Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'false', NOTIFICATION_WORKER_ENABLED: 'false',
  BOOKING_ONLINE_PAYMENT_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled',
  ORDER_EMAIL_API_KEY: '', ORDER_EMAIL_PROVIDER: '', ORDER_EMAIL_FROM: '', ORDER_EMAIL_LOCAL_CAPTURE: 'false',
  AUTH_EMAIL_API_KEY: '', AUTH_EMAIL_PROVIDER: '', AUTH_EMAIL_FROM: '' });
require('ts-node/register/transpile-only');
require('reflect-metadata');
const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);
const digest = value => createHash('sha256').update(serialize(value)).digest('hex');
const same = (actual, expected, message) => assert.equal(digest(actual), digest(expected), message);
const sourceFiles = ['prisma/schema.prisma', 'src/modules/staff/staff.controller.ts', 'src/modules/staff/staff.service.ts',
  'src/modules/staff/staff.dto.ts', 'src/common/shop-access.ts', 'src/common/password-policy.ts', 'src/common/password-policy-rules.json',
  'src/common/validated-password.ts', 'src/modules/auth/auth.controller.ts', 'src/modules/auth/auth.service.ts',
  'src/modules/auth/management-password.controller.ts', 'src/modules/auth/management-password.service.ts',
  'src/modules/auth/dto/management-password.dto.ts', 'src/modules/auth/strategies/jwt.strategy.ts',
  'test/booking-resources.support.cjs', 'test/staff-password-policy.matrix.cjs', 'test/staff-password-policy.integration.cjs'];

test('ACC-FULL-02 STAFF create / own change / ADMIN recovery share the raw UTF-8 contract', { timeout: 300000 }, async t => {
  const sourceManifest = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
  const candidateSha256 = digest(sourceManifest);
  if (process.env.STAFF_PASSWORD_EXPECTED_CANDIDATE_SHA256) assert.equal(candidateSha256, process.env.STAFF_PASSWORD_EXPECTED_CANDIDATE_SHA256, 'Frozen candidate mismatch');
  t.diagnostic('ACC02_SOURCE ' + JSON.stringify({ candidateSha256, files: sourceManifest }));
  await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash, compare } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const reader = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = randomBytes(6).toString('hex'), initialPassword = randomBytes(24).toString('base64url');
    const initialHash = await hash(initialPassword, 10), users = {}, shops = {};
    const originalFetch = globalThis.fetch;
    let app, origin, httpCount = 0, zeroWriteChecks = 0, independentSqlSnapshots = 0;
    const tableNames = ['users', 'shop_staff_grants', 'auth_sessions', 'push_devices', 'audit_logs', 'shops', 'shop_login_bindings', 'merchant_profiles'];
    const snapshot = async () => {
      independentSqlSnapshots++;
      const values = await Promise.all(tableNames.map(table => reader.$queryRawUnsafe('SELECT * FROM `' + table + '` ORDER BY id')));
      return Object.fromEntries(tableNames.map((table, index) => [table, values[index]]));
    };
    const call = async (route, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) => {
      httpCount++;
      const response = await fetch(origin + '/api/v1' + route, { method,
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
    };
    const expect = (response, expected) => { assert.equal(response.status, expected, 'Unexpected HTTP status; private response omitted'); return response.body; };
    const login = async (user, password, alternate = false) => expect(await call(alternate ? '/auth/password/login' : '/auth/login', {
      body: alternate ? { email: user.email, password } : { identifier: user.email, password } }), 200);
    const startApp = async () => {
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
      app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      globalThis.fetch = (input, options) => { assert.equal(new URL(String(input)).origin, origin, 'External HTTP forbidden'); return originalFetch(input, options); };
    };
    const targetSessions = (value, id) => value.auth_sessions.filter(row => row.user_id === id);
    const unchangedOthers = (after, before, targetId) => {
      for (const table of ['shop_staff_grants', 'shops', 'shop_login_bindings', 'merchant_profiles']) same(after[table], before[table], 'Permissions/ownership changed during password operation: ' + table);
      for (const table of ['users', 'auth_sessions', 'push_devices']) same(after[table].filter(row => (table === 'users' ? row.id : row.user_id) !== targetId), before[table].filter(row => (table === 'users' ? row.id : row.user_id) !== targetId), 'Another account changed: ' + table);
    };
    const verifyNewCredential = async (user, password) => {
      const rows = await reader.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id=${user.id}`);
      assert.equal(rows.length, 1); const row = rows[0];
      assert.equal(row.role, 'STAFF'); assert.equal(row.status, 'ACTIVE'); assert.equal(row.email, user.email);
      assert.match(row.password_hash, /^\$2[aby]\$12\$/);
      assert.equal(await compare(password, row.password_hash), true, 'Stored bcrypt must match the original raw string');
      if (password !== password.trim()) assert.equal(await compare(password.trim(), row.password_hash), false, 'Spaces must never be trimmed before bcrypt');
      const auth = await login(user, password, true);
      assert.equal(auth.user.role, 'STAFF'); assert.equal(auth.user.id, String(user.id));
      const me = expect(await call('/auth/me', { token: auth.accessToken }), 200); assert.equal(me.role, 'STAFF');
      expect(await call('/merchant/shops/' + shops.A.id + '/bookings?page=1&pageSize=20', { token: auth.accessToken }), 200);
      expect(await call('/merchant/shops/' + shops.A.id + '/dashboard', { token: auth.accessToken }), 403);
      expect(await call('/merchant/shops/' + shops.B.id + '/bookings?page=1&pageSize=20', { token: auth.accessToken }), 403);
      if (password !== password.trim()) expect(await call('/auth/password/login', { body: { email: user.email, password: password.trim() } }), 401);
      return auth;
    };
    const createFixtureStaff = async (suffix, hashValue = initialHash) => {
      const user = await db.user.create({ data: { email: prefix + '.' + suffix + '@example.invalid', name: 'Synthetic ' + suffix, role: 'STAFF', passwordHash: hashValue } });
      await db.shopStaffGrant.create({ data: { shopId: shops.A.id, userId: user.id, createdById: users.owner.id, permissions: ['BOOKINGS_READ'] } });
      return user;
    };
    const policyReject = async work => {
      const before = await snapshot(), response = await work();
      expect(response, 400); assert.equal(response.body.code, 'PASSWORD_POLICY', 'The policy rejection must be explicit');
      assert.match(response.body.message, /12–72个UTF-8字节/);
      same(await snapshot(), before, 'Rejected password changed SQL users/grants/hash/sessions/devices/audit/ownership'); zeroWriteChecks++;
    };
    const verifyChange = async (target, raw, operator, recover = false, currentPassword = initialPassword) => {
      const old = [await login(target, currentPassword), await login(target, currentPassword)];
      const before = await snapshot();
      const result = await call(recover ? '/auth/accounts/' + target.id + '/password/recover' : '/auth/password/change', {
        token: recover ? operator.accessToken : old[0].accessToken,
        body: { currentPassword: recover ? initialPassword : currentPassword, newPassword: raw,
          ...(recover ? { reason: 'Synthetic independently verified STAFF recovery', verificationReference: 'QA-' + prefix + '-' + target.id } : {}) } });
      const body = expect(result, 200); assert.equal(recover ? body.recovered : body.changed, true);
      assert.equal(body.reauthenticationRequired, true); assert.equal(body.revokedSessions, 2); assert.equal(result.cache, 'no-store');
      assert.ok(!serialize(body).includes(raw) && !serialize(body).includes('passwordHash'), 'Password response must not disclose a credential');
      const after = await snapshot(); unchangedOthers(after, before, target.id);
      const priorIds = targetSessions(before, target.id).map(row => row.id);
      const changedSessions = targetSessions(after, target.id);
      assert.equal(changedSessions.length, priorIds.length); assert.ok(changedSessions.every(row => row.revoked_at !== null));
      assert.equal(after.audit_logs.length, before.audit_logs.length + 1);
      const audit = after.audit_logs.at(-1);
      assert.equal(audit.action, recover ? 'MANAGEMENT_PASSWORD_RECOVERED' : 'MANAGEMENT_PASSWORD_CHANGED');
      assert.equal(audit.target_id, target.id); assert.ok(!serialize(audit).includes(raw), 'Audit must never contain the password');
      for (const session of old) {
        expect(await call('/auth/me', { token: session.accessToken }), 401);
        expect(await call('/auth/refresh', { body: { refreshToken: session.refreshToken } }), 401);
      }
      await verifyNewCredential(target, raw);
      const final = await snapshot(); unchangedOthers(final, before, target.id);
      const currentSessions = targetSessions(final, target.id);
      assert.equal(currentSessions.filter(row => row.revoked_at === null).length, 1);
      assert.ok(currentSessions.filter(row => priorIds.includes(row.id)).every(row => row.revoked_at !== null), 'New login must not revive old sessions');
    };
    try {
      for (const [name, role] of [['admin', 'ADMIN'], ['owner', 'MERCHANT'], ['otherOwner', 'MERCHANT']]) users[name] = await db.user.create({ data: { email: prefix + '.' + name.toLowerCase() + '@example.invalid', name: 'Synthetic ' + name, role, passwordHash: initialHash } });
      for (const [name, owner] of [['A', users.owner], ['B', users.otherOwner]]) {
        shops[name] = await db.shop.create({ data: { ownerId: owner.id, name: 'Synthetic policy store ' + name, shortName: 'acc02-' + prefix + '-' + name.toLowerCase(),
          address: '1 Synthetic Way', city: 'Seattle', state: 'WA', zipCode: '98144', latitude: 47.6, longitude: -122.3, phone: '+12025550110', timezone: 'America/Los_Angeles', category: 'MIXED', status: 'APPROVED' } });
        await db.shopLoginBinding.create({ data: { shopId: shops[name].id, userId: owner.id, createdById: users.admin.id, reason: 'Synthetic policy owner' } });
        await db.merchantProfile.create({ data: { shopId: shops[name].id, userId: owner.id } });
      }
      for (let index = 0; index < matrix.length; index++) {
        const row = matrix[index];
        await t.test(row.name, async rowTest => {
          assert.equal(Buffer.byteLength(row.value, 'utf8'), row.bytes);
          const own = await createFixtureStaff('own-' + index), recovery = await createFixtureStaff('recover-' + index);
          await startApp();
          try {
            const admin = await login(users.admin, initialPassword), owner = await login(users.owner, initialPassword);
            const createBody = { name: 'Synthetic created staff ' + index, email: prefix + '.created-' + index + '@example.invalid',
              phone: '+1202555' + String(1000 + index), password: row.value, permissions: ['BOOKINGS_READ'] };
            await rowTest.test('owner create: HTTP + independent SQL', async () => {
              const work = () => call('/merchant/shops/' + shops.A.id + '/staff', { token: owner.accessToken, body: createBody });
              if (!row.accepted) return policyReject(work);
              const before = await snapshot(), body = expect(await work(), 201), after = await snapshot();
              assert.equal(body.accountStatus, 'ACTIVE'); assert.deepEqual(body.permissions, ['BOOKINGS_READ']);
              assert.ok(!serialize(body).includes(row.value) && !serialize(body).includes('passwordHash'));
              assert.equal(after.users.length, before.users.length + 1); const targetId = BigInt(body.userId);
              same(after.users.filter(user => user.id !== targetId), before.users, 'Create overwrote an existing account');
              same(after.auth_sessions, before.auth_sessions, 'Create changed existing sessions');
              same(after.push_devices, before.push_devices, 'Create changed existing devices');
              for (const table of ['shops', 'shop_login_bindings', 'merchant_profiles']) same(after[table], before[table], 'Create changed ownership: ' + table);
              assert.equal(after.shop_staff_grants.length, before.shop_staff_grants.length + 1);
              same(after.shop_staff_grants.filter(grant => grant.user_id !== targetId), before.shop_staff_grants, 'Create changed another grant');
              const grants = after.shop_staff_grants.filter(grant => grant.user_id === targetId);
              assert.equal(grants.length, 1); assert.equal(grants[0].shop_id, shops.A.id); assert.equal(grants[0].status, 'ACTIVE');
              assert.deepEqual(typeof grants[0].permissions === 'string' ? JSON.parse(grants[0].permissions) : grants[0].permissions, ['BOOKINGS_READ']);
              assert.equal(after.audit_logs.length, before.audit_logs.length + 1); assert.equal(after.audit_logs.at(-1).action, 'STAFF_CREATED');
              assert.ok(!serialize(after.audit_logs.at(-1)).includes(row.value), 'Create audit disclosed a password');
              await verifyNewCredential({ id: targetId, email: createBody.email }, row.value);
            });
            await rowTest.test('STAFF own change: HTTP + independent SQL', async () => {
              if (row.accepted) return verifyChange(own, row.value);
              const auth = await login(own, initialPassword);
              return policyReject(() => call('/auth/password/change', { token: auth.accessToken, body: { currentPassword: initialPassword, newPassword: row.value } }));
            });
            await rowTest.test('ADMIN recovery of STAFF: HTTP + independent SQL', async () => {
              if (row.accepted) return verifyChange(recovery, row.value, admin, true);
              await login(recovery, initialPassword);
              return policyReject(() => call('/auth/accounts/' + recovery.id + '/password/recover', { token: admin.accessToken,
                body: { currentPassword: initialPassword, newPassword: row.value, reason: 'Synthetic verified STAFF recovery', verificationReference: 'QA-' + prefix + '-' + index } }));
            });
            expect(await call('/auth/me', { token: owner.accessToken }), 200); expect(await call('/auth/me', { token: admin.accessToken }), 200);
          } finally { globalThis.fetch = originalFetch; if (app) { await app.close(); app = null; } }
        });
      }
      await t.test('legacy STAFF password outside the new policy still logs in and can self-change', async () => {
        // Previously accepted 11 ASCII + LF; login/current-password verification
        // must keep comparing the old exact credential, without new-policy gates.
        const legacyPassword = 'z'.repeat(11) + '\n';
        const legacy = await createFixtureStaff('legacy', await hash(legacyPassword, 10));
        await startApp();
        try { await verifyChange(legacy, 'LegacyFixed-123', undefined, false, legacyPassword); }
        finally { globalThis.fetch = originalFetch; if (app) { await app.close(); app = null; } }
      });
      t.diagnostic('ACC02_RESULTS ' + JSON.stringify({ matrixRows: matrix.length, acceptedPerFlow: matrix.filter(row => row.accepted).length,
        rejectedPerFlow: matrix.filter(row => !row.accepted).length, policyFlows: 3, zeroWriteChecks, independentSqlSnapshots,
        httpCount, migrationCount, legacyLoginAndChange: true, throttlesUnchanged: true, syntheticOnly: true, externalHttp: false }));
    } finally {
      globalThis.fetch = originalFetch; if (app) await app.close(); await reader.$disconnect();
    }
  });
});
