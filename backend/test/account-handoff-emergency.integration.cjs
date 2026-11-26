/* ACCEPT-03: real HTTP provisioning/password lifecycle + the real offline CLI.
 * Only withFreshDatabase's newly generated, migrated loopback:3310 schema.
 * No public recovery endpoint, existing database or actual mail is used.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync, mkdtempSync, rmdirSync } = require('node:fs');
const { mkdtemp, rm, lstat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { isolatedTarget, installTestEnvironment, withFreshDatabase } = require('./booking-resources.support.cjs');
installTestEnvironment();
Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'false', NOTIFICATION_WORKER_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled',
  ORDER_EMAIL_API_KEY: '', ORDER_EMAIL_PROVIDER: '', ORDER_EMAIL_FROM: '', ORDER_EMAIL_LOCAL_CAPTURE: 'false',
  AUTH_EMAIL_API_KEY: '', AUTH_EMAIL_PROVIDER: '', AUTH_EMAIL_FROM: '', AUTH_LOCAL_OTP: '' });
require('ts-node/register/transpile-only');
require('reflect-metadata');

const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);
const digest = value => createHash('sha256').update(serialize(value)).digest('hex');
const same = (actual, expected, label) => assert.equal(digest(actual), digest(expected), label);

// Setup/teardown-only real SIGNAL trigger, never a mocked Prisma exception.
// mysql uses stdin and an independent empty login-path location. An uncertain
// result stops immediately; there is no retry or alternate database fallback.
function faultDdl(databaseUrl, sql) {
  const target = isolatedTarget(databaseUrl);
  assert.match(target.pathname, /^\/mj2_test_booking_resources_[a-f0-9]{16}$/);
  const directory = mkdtempSync(path.join(tmpdir(), 'massajoy-accept03-mysql-'));
  try {
    const result = spawnSync('mysql', ['--no-defaults', '--protocol=TCP', '--host=' + target.hostname, '--port=' + target.port,
      '--user=' + decodeURIComponent(target.username), '--database=' + target.pathname.slice(1), '--batch', '--skip-column-names'],
    { input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, MYSQL_PWD: decodeURIComponent(target.password), MYSQL_TEST_LOGIN_FILE: path.join(directory, 'no-login-paths.cnf') } });
    assert.ok(!result.error && result.status === 0, 'ACCEPT03_REAL_SQL_DDL_FAILED ' + JSON.stringify({ exitCode: result.status, spawnError: result.error?.code ?? null }));
  } finally { rmdirSync(directory); }
}

test('account handoff, own change, manual recovery and last-admin emergency use actual HTTP/SQL/CLI', { timeout: 240000 }, async t => {
  const files = ['prisma/schema.prisma', 'src/modules/account-access/account-access.service.ts', 'src/modules/account-access/account-access.dto.ts',
    'src/modules/auth/auth.service.ts', 'src/modules/auth/management-password.service.ts', 'src/common/password-policy-rules.json',
    'src/modules/studio/studio.service.ts', 'scripts/lib/password-policy.cjs', 'scripts/recover-last-admin.cjs',
    'test/account-handoff-emergency.integration.cjs', 'test/booking-resources.support.cjs'];
  const sourceManifest = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
  const candidateSha256 = digest(sourceManifest);
  t.diagnostic('ACCEPT03_SOURCE ' + JSON.stringify({ candidateSha256, files: sourceManifest }));
  const vaultDirectory = await mkdtemp(path.join(tmpdir(), 'massajoy-accept03-vault-'));
  process.env.MERCHANT_CREDENTIAL_VAULT_DIR = vaultDirectory;
  process.env.MERCHANT_CREDENTIAL_VAULT_KEY = randomBytes(32).toString('base64');
  try { await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash, compare } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const reader = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = randomBytes(6).toString('hex'), password = randomBytes(24).toString('base64url');
    const initialMerchantPassword = randomBytes(4).toString('hex'), changedMerchantPassword = randomBytes(10).toString('hex');
    const recoveredMerchantPassword = randomBytes(10).toString('hex'), recoveredAdminPassword = randomBytes(24).toString('base64url');
    const users = {}, auth = {}, shops = {};
    let merchant, merchantSessions, controlUsers, controlSessions, historicalOwnership, app, origin;
    const originalFetch = globalThis.fetch;
    const call = async (route, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) => {
      const response = await fetch(origin + '/api/v1' + route, { method, headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
    };
    const expect = (response, expected) => { assert.equal(response.status, expected, 'Unexpected HTTP status; private response omitted'); return response.body; };
    // Both public management login routes retain their real per-IP limits. Split
    // this combined lifecycle between them instead of disabling throttling or
    // manufacturing a forwarded IP that production would not trust.
    let loginCount = 0;
    const login = async (email, secret) => {
      const alternate = ++loginCount % 2 === 0;
      return expect(await call(alternate ? '/auth/login' : '/auth/password/login', {
        body: alternate ? { identifier: email, password: secret } : { email, password: secret } }), 200);
    };
    const userSql = id => reader.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id=${id}`);
    const state = async () => ({ users: await reader.$queryRaw`SELECT * FROM users ORDER BY id`,
      sessions: await reader.$queryRaw`SELECT * FROM auth_sessions ORDER BY id`, devices: await reader.$queryRaw`SELECT * FROM push_devices ORDER BY id`,
      bindings: await reader.$queryRaw`SELECT * FROM shop_login_bindings ORDER BY id`,
      operations: await reader.$queryRaw`SELECT * FROM account_provision_operations ORDER BY id`, audits: await reader.$queryRaw`SELECT * FROM audit_logs ORDER BY id` });
    const ownership = async () => ({ shops: await reader.$queryRaw`SELECT id,owner_id FROM shops ORDER BY id`,
      profiles: await reader.$queryRaw`SELECT * FROM merchant_profiles ORDER BY id`,
      bookings: await reader.$queryRaw`SELECT * FROM bookings ORDER BY id` });
    const merchantIdentity = row => ({ id: row.id, email: row.email, loginName: row.loginName, role: row.role, status: row.status,
      name: row.name, phone: row.phone, emailVerifiedAt: row.emailVerifiedAt, deletedAt: row.deletedAt, createdAt: row.createdAt });
    const checkControls = async () => {
      same(await reader.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id IN (${Prisma.join([users.legacyOwner.id, users.otherMerchant.id, users.staff.id, users.customer.id])}) ORDER BY id`), controlUsers, 'Unrelated identities unchanged');
      same(await reader.$queryRaw(Prisma.sql`SELECT * FROM auth_sessions WHERE user_id IN (${Prisma.join([users.otherMerchant.id, users.staff.id, users.customer.id])}) ORDER BY id`), controlSessions, 'Other role sessions unchanged');
      same(await ownership(), historicalOwnership, 'Historical ownership, ledgers and orders unchanged');
    };
    const sessionsRejected = async sessions => {
      for (const session of sessions) {
        expect(await call('/auth/me', { token: session.accessToken }), 401);
        expect(await call('/auth/refresh', { body: { refreshToken: session.refreshToken } }), 401);
      }
    };
    try {
      const passwordHash = await hash(password, 10);
      for (const [name, role, status] of [['admin','ADMIN','ACTIVE'], ['secondAdmin','ADMIN','SUSPENDED'], ['legacyOwner','MERCHANT','ACTIVE'],
        ['otherMerchant','MERCHANT','ACTIVE'], ['staff','STAFF','ACTIVE'], ['customer','CUSTOMER','ACTIVE']]) {
        users[name] = await db.user.create({ data: { email: prefix + '.' + name.toLowerCase() + '@example.invalid', name: 'Synthetic ' + name,
          role, status, passwordHash, ...(role === 'CUSTOMER' ? { emailVerifiedAt: new Date() } : {}) } });
      }
      for (const name of ['A', 'B']) {
        const owner = name === 'A' ? users.legacyOwner : users.otherMerchant;
        shops[name] = await db.shop.create({ data: { ownerId: owner.id, name: 'Synthetic handoff store ' + name, shortName: 'handoff-' + prefix + '-' + name.toLowerCase(),
          address: '1 Synthetic Way', city: 'Seattle', state: 'WA', zipCode: '98144', timezone: 'America/Los_Angeles', latitude: 47.6, longitude: -122.3,
          phone: '+12025550101', category: 'MIXED', status: 'APPROVED' } });
        await db.merchantProfile.create({ data: { shopId: shops[name].id, userId: owner.id } });
      }
      await db.shopLoginBinding.create({ data: { shopId: shops.B.id, userId: users.otherMerchant.id, createdById: users.admin.id, reason: 'Synthetic control owner' } });
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
      app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      globalThis.fetch = (input, options) => { assert.equal(new URL(String(input)).origin, origin, 'No external HTTP allowed'); return originalFetch(input, options); };
      for (const name of ['admin', 'otherMerchant', 'staff', 'customer']) auth[name] = await login(users[name].email, password);
      auth.adminSecond = await login(users.admin.email, password);
      controlUsers = await reader.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id IN (${Prisma.join([users.legacyOwner.id, users.otherMerchant.id, users.staff.id, users.customer.id])}) ORDER BY id`);
      controlSessions = await reader.$queryRaw(Prisma.sql`SELECT * FROM auth_sessions WHERE user_id IN (${Prisma.join([users.otherMerchant.id, users.staff.id, users.customer.id])}) ORDER BY id`);
      historicalOwnership = await ownership();

      const provisionBody = { shopId: String(shops.A.id), loginName: 'handoff-' + prefix, name: 'Synthetic operating merchant',
        email: prefix + '.handoff@example.invalid', password: initialMerchantPassword, idempotencyKey: 'Handoff-' + prefix + '-provision', reason: 'Synthetic verified handoff' };
      await t.test('first provision binds one email account, stays suspended, and replays without duplication', async () => {
        const before = await state();
        for (const name of ['otherMerchant', 'staff', 'customer']) expect(await call('/account-access/admin/create-and-bind', { token: auth[name].accessToken, body: provisionBody }), 403);
        same(await state(), before, 'Unauthorized provisioning has no writes');
        const result = expect(await call('/account-access/admin/create-and-bind', { token: auth.admin.accessToken, body: provisionBody }), 201);
        merchant = await db.user.findUniqueOrThrow({ where: { id: BigInt(result.binding.userId) } });
        assert.equal(merchant.email, provisionBody.email); assert.equal(merchant.loginName, null); assert.equal(merchant.role, 'MERCHANT'); assert.equal(merchant.status, 'SUSPENDED');
        assert.equal(result.binding.loginReady, false); assert.ok(await compare(initialMerchantPassword, merchant.passwordHash));
        expect(await call('/auth/password/login', { body: { email: merchant.email, password: initialMerchantPassword } }), 401);
        expect(await call('/auth/login', { body: { identifier: merchant.email, password: initialMerchantPassword } }), 401);
        const after = await state();
        const replay = expect(await call('/account-access/admin/create-and-bind', { token: auth.admin.accessToken, body: provisionBody }), 201);
        assert.equal(replay.replayed, true); same(await state(), after, 'Provision retry creates no user, binding, receipt or audit');
        const credentials = await call('/account-access/admin/shops/' + shops.A.id + '/credentials', { token: auth.admin.accessToken });
        assert.equal(credentials.cache, 'no-store'); assert.ok(expect(credentials, 200).password === initialMerchantPassword);
        assert.equal(await reader.shopLoginBinding.count({ where: { shopId: shops.A.id, userId: merchant.id } }), 1);
        await checkControls();
      });

      await t.test('explicit activation permits two real sessions for exactly the bound shop', async () => {
        expect(await call('/studio/merchants/' + merchant.id, { method: 'PATCH', token: auth.admin.accessToken, body: { name: merchant.name, status: 'ACTIVE' } }), 200);
        merchant = await db.user.findUniqueOrThrow({ where: { id: merchant.id } });
        merchantSessions = [await login(merchant.email, initialMerchantPassword), await login(merchant.email, initialMerchantPassword)];
        const list = expect(await call('/merchant/shops', { token: merchantSessions[0].accessToken }), 200);
        assert.deepEqual((Array.isArray(list) ? list : list.items).map(row => row.id), [String(shops.A.id)]);
        expect(await call('/merchant/shops/' + shops.A.id + '/dashboard', { token: merchantSessions[0].accessToken }), 200);
        const denied = await call('/merchant/shops/' + shops.B.id + '/dashboard', { token: merchantSessions[0].accessToken });
        assert.ok([403, 404].includes(denied.status), 'Other shop must stay inaccessible');
        await checkControls();
      });

      let currentMerchant;
      await t.test('own password change preserves identity, ownership and vault while revoking both old sessions', async () => {
        const before = merchantIdentity(await reader.user.findUniqueOrThrow({ where: { id: merchant.id } }));
        const result = expect(await call('/auth/password/change', { token: merchantSessions[0].accessToken,
          body: { currentPassword: initialMerchantPassword, newPassword: changedMerchantPassword } }), 200);
        assert.ok(result.changed && result.reauthenticationRequired); assert.equal(result.revokedSessions, 2);
        await sessionsRejected(merchantSessions);
        expect(await call('/auth/password/login', { body: { email: merchant.email, password: initialMerchantPassword } }), 401);
        const row = await reader.user.findUniqueOrThrow({ where: { id: merchant.id } });
        same(merchantIdentity(row), before, 'Own change preserves merchant identity and activation'); assert.ok(await compare(changedMerchantPassword, row.passwordHash));
        currentMerchant = [await login(merchant.email, changedMerchantPassword), await login(merchant.email, changedMerchantPassword)];
        const credentials = expect(await call('/account-access/admin/shops/' + shops.A.id + '/credentials', { token: auth.admin.accessToken }), 200);
        assert.ok(credentials.password === changedMerchantPassword); await checkControls();
      });

      await t.test('admin manual merchant recovery revokes both current sessions without changing roles or shop bindings', async () => {
        const beforeIdentity = merchantIdentity(await reader.user.findUniqueOrThrow({ where: { id: merchant.id } }));
        const beforeBindings = await reader.$queryRaw`SELECT * FROM shop_login_bindings ORDER BY id`;
        const beforeDenied = await state();
        expect(await call('/account-access/admin/accounts/' + merchant.id + '/password', { method: 'PATCH', token: auth.staff.accessToken,
          body: { password: recoveredMerchantPassword, reason: 'Synthetic independent recovery' } }), 403);
        same(await state(), beforeDenied, 'Non-admin manual recovery writes nothing');
        const result = expect(await call('/account-access/admin/accounts/' + merchant.id + '/password', { method: 'PATCH', token: auth.admin.accessToken,
          body: { password: recoveredMerchantPassword, reason: 'Synthetic independent recovery' } }), 200);
        assert.equal(result.reset, true); assert.equal(result.revokedSessions, 2); assert.ok(!serialize(result).includes(recoveredMerchantPassword));
        await sessionsRejected(currentMerchant);
        expect(await call('/auth/password/login', { body: { email: merchant.email, password: changedMerchantPassword } }), 401);
        const row = await reader.user.findUniqueOrThrow({ where: { id: merchant.id } });
        same(merchantIdentity(row), beforeIdentity, 'Manual recovery preserves role/status/identity'); assert.ok(await compare(recoveredMerchantPassword, row.passwordHash));
        same(await reader.$queryRaw`SELECT * FROM shop_login_bindings ORDER BY id`, beforeBindings, 'Recovery never rebinds shops');
        const session = await login(merchant.email, recoveredMerchantPassword);
        expect(await call('/merchant/shops/' + shops.A.id + '/dashboard', { token: session.accessToken }), 200);
        const credentials = expect(await call('/account-access/admin/shops/' + shops.A.id + '/credentials', { token: auth.admin.accessToken }), 200);
        assert.ok(credentials.password === recoveredMerchantPassword); await checkControls();
      });

      const target = new URL(databaseUrl), server = await reader.$queryRaw`SELECT @@server_uuid AS serverUuid`;
      const emergencyEnv = { ...process.env, DATABASE_URL: databaseUrl,
        RECOVERY_EXPECTED_DATABASE_HOST: target.hostname, RECOVERY_EXPECTED_DATABASE_PORT: target.port,
        RECOVERY_EXPECTED_DATABASE_NAME: target.pathname.slice(1), RECOVERY_EXPECTED_SERVER_UUID: server[0].serverUuid,
        RECOVERY_TARGET_USER_ID: String(users.admin.id), RECOVERY_TARGET_EMAIL: users.admin.email,
        RECOVERY_INCIDENT_REFERENCE: 'Synthetic-Incident-' + prefix, RECOVERY_OPERATOR_REFERENCE: 'Synthetic-Custodian-' + prefix,
        RECOVERY_CONFIRMATION: 'RECOVER_LAST_ACTIVE_ADMIN_ONLY', RECOVERY_MAINTENANCE_CONFIRMED: 'YES' };
      const cli = (mode, env = {}, secret = '') => {
        const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/recover-last-admin.cjs'), ...(mode ? [mode] : [])], {
          cwd: path.resolve(__dirname, '..'), env: { ...emergencyEnv, ...env }, input: secret, encoding: 'utf8', timeout: 30000, windowsHide: true });
        assert.ok(!result.error, 'Emergency CLI process must start and finish');
        for (const secret of [password, initialMerchantPassword, changedMerchantPassword, recoveredMerchantPassword, recoveredAdminPassword]) {
          assert.ok(!String(result.stdout + result.stderr).includes(secret), 'CLI output must not reveal credentials');
        }
        return result;
      };

      await t.test('emergency defaults/read-only checks reject wrong instance, target, confirmation and short secrets with zero writes', async () => {
        const before = await state(), check = (result, code) => { assert.equal(result.status, 1); assert.ok(result.stderr.includes(code), 'Expected fail-closed recovery code'); };
        const dry = cli(); assert.equal(dry.status, 0); assert.deepEqual(JSON.parse(dry.stdout).writes, 0); same(await state(), before, 'No argument defaults to read-only dry-run');
        check(cli('--execute', { RECOVERY_CONFIRMATION: '' }, recoveredAdminPassword), 'RECOVERY_EXPLICIT_CONFIRMATION_REQUIRED');
        check(cli('--dry-run', { RECOVERY_EXPECTED_DATABASE_NAME: target.pathname.slice(1) + '_wrong' }), 'RECOVERY_DATABASE_IDENTITY_REQUIRED');
        check(cli('--dry-run', { RECOVERY_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000000' }), 'RECOVERY_DATABASE_IDENTITY_MISMATCH');
        check(cli('--dry-run', { RECOVERY_TARGET_USER_ID: String(merchant.id), RECOVERY_TARGET_EMAIL: merchant.email }), 'RECOVERY_TARGET_NOT_EXISTING_ACTIVE_ADMIN');
        check(cli('--dry-run', { RECOVERY_TARGET_EMAIL: 'wrong@example.invalid' }), 'RECOVERY_TARGET_NOT_EXISTING_ACTIVE_ADMIN');
        check(cli('--execute', {}, '123456'), 'RECOVERY_PASSWORD_INVALID');
        check(cli('--execute', {}, password), 'RECOVERY_PASSWORD_UNCHANGED');
        same(await state(), before, 'Every rejected emergency request is read-only'); await checkControls();
      });

      await t.test('when another active admin exists, emergency CLI refuses and points to normal recovery', async () => {
        expect(await call('/studio/admins/' + users.secondAdmin.id, { method: 'PATCH', token: auth.admin.accessToken, body: { name: users.secondAdmin.name, status: 'ACTIVE' } }), 200);
        const before = await state(), denied = cli('--execute', {}, recoveredAdminPassword);
        assert.equal(denied.status, 1); assert.ok(denied.stderr.includes('RECOVERY_NOT_LAST_ACTIVE_ADMIN_USE_NORMAL_RECOVERY'));
        same(await state(), before, 'Two-admin guard does not change anything');
        expect(await call('/studio/admins/' + users.secondAdmin.id, { method: 'PATCH', token: auth.admin.accessToken, body: { name: users.secondAdmin.name, status: 'SUSPENDED' } }), 200);
      });

      const oldAdminRows = await reader.authSession.findMany({ where: { userId: users.admin.id, revokedAt: null } });
      assert.equal(oldAdminRows.length, 2);
      for (const [index, row] of oldAdminRows.entries()) await db.pushDevice.create({ data: { userId: users.admin.id, authSessionId: row.id,
        token: 'synthetic-device-' + prefix + '-' + index, tokenHash: createHash('sha256').update('synthetic-' + prefix + index).digest('hex'), bindingVersion: randomBytes(16).toString('hex') } });
      await t.test('actual late SQL audit failure rolls back the emergency password, session revocations and device removals', async () => {
        const before = await state();
        faultDdl(databaseUrl, "CREATE TRIGGER mj2_accept03_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_EMERGENCY_AUDIT_FAILURE';");
        try {
          const result = cli('--execute', {}, recoveredAdminPassword);
          assert.equal(result.status, 1); assert.ok(result.stderr.includes('RECOVERY_DATABASE_OPERATION_FAILED'));
          same(await state(), before, 'Actual SQL failure must roll back password/session/device/audit together');
          expect(await call('/auth/me', { token: auth.admin.accessToken }), 200);
          expect(await call('/auth/me', { token: auth.adminSecond.accessToken }), 200);
          assert.equal(await reader.pushDevice.count({ where: { userId: users.admin.id } }), 2);
        } finally { faultDdl(databaseUrl, 'DROP TRIGGER mj2_accept03_audit;'); }
      });

      await t.test('offline custodian execution rotates only the last existing admin and revokes all old access/refresh/device bindings', async () => {
        const oldSessions = [auth.admin, auth.adminSecond], oldRows = await reader.authSession.findMany({ where: { userId: users.admin.id, revokedAt: null } });
        assert.equal(oldRows.length, 2);
        assert.equal(await reader.pushDevice.count({ where: { userId: users.admin.id } }), 2);
        const previous = await reader.user.findUniqueOrThrow({ where: { id: users.admin.id } });
        const usersCount = await reader.user.count(), bindings = await reader.$queryRaw`SELECT * FROM shop_login_bindings ORDER BY id`;
        const result = cli('--execute', {}, recoveredAdminPassword); assert.equal(result.status, 0, 'Emergency CLI should complete without exposing error/secret');
        const receipt = JSON.parse(result.stdout); assert.equal(receipt.recovered, true); assert.equal(receipt.revokedSessions, 2); assert.equal(receipt.secretsLogged, false);
        await sessionsRejected(oldSessions);
        expect(await call('/auth/password/login', { body: { email: users.admin.email, password } }), 401);
        const row = await reader.user.findUniqueOrThrow({ where: { id: users.admin.id } });
        assert.ok(await compare(recoveredAdminPassword, row.passwordHash)); same(merchantIdentity(row), merchantIdentity(previous), 'Emergency does not create/activate/elevate/rename an account');
        assert.equal(await reader.user.count(), usersCount); assert.equal(await reader.authSession.count({ where: { userId: row.id, revokedAt: null } }), 0);
        assert.equal(await reader.pushDevice.count({ where: { userId: row.id } }), 0);
        same(await reader.$queryRaw`SELECT * FROM shop_login_bindings ORDER BY id`, bindings, 'Emergency never changes bindings');
        const newSession = await login(row.email, recoveredAdminPassword); expect(await call('/auth/me', { token: newSession.accessToken }), 200);
        await checkControls();
      });

      await t.test('independent SQL confirms one complete audit per operation and no credential/evidence leaks', async () => {
        const rows = await reader.$queryRaw`SELECT action,detail FROM audit_logs ORDER BY id`, serialized = serialize(rows);
        for (const secret of [password, initialMerchantPassword, changedMerchantPassword, recoveredMerchantPassword, recoveredAdminPassword,
          emergencyEnv.RECOVERY_INCIDENT_REFERENCE, emergencyEnv.RECOVERY_OPERATOR_REFERENCE]) assert.ok(!serialized.includes(secret), 'Audits must omit credentials and raw verification references');
        for (const action of ['SHOP_LOGIN_CREATED_AND_BOUND', 'MANAGEMENT_PASSWORD_CHANGED', 'SHOP_LOGIN_PASSWORD_RESET', 'CLI_LAST_ADMIN_PASSWORD_RECOVERED']) assert.equal(rows.filter(row => row.action === action).length, 1);
        const emergency = rows.find(row => row.action === 'CLI_LAST_ADMIN_PASSWORD_RECOVERED').detail;
        assert.equal(emergency.secretsLogged, false); assert.equal(emergency.revokedSessions, 2);
        assert.match(emergency.incidentReferenceHash, /^[a-f0-9]{64}$/); assert.match(emergency.custodianReferenceHash, /^[a-f0-9]{64}$/);
        assert.equal(await reader.booking.count(), 0); await checkControls();
      });
      t.diagnostic('ACCEPT03_SQL ' + JSON.stringify({ migrationCount, candidateSha256, cases: 9, syntheticOnly: true, actualHttpAndIndependentSql: true,
        actualEmergencyChildProcess: true, realEmails: 0, mainWrites: 0, formalIdentityAndCustodySignoff: false }));
    } finally { globalThis.fetch = originalFetch; if (app) await app.close(); await reader.$disconnect(); }
  }); } finally {
    const resolved = path.resolve(vaultDirectory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()), 'Only our own temporary vault may be removed');
    assert.ok(path.basename(resolved).startsWith('massajoy-accept03-vault-'));
    assert.equal((await lstat(resolved)).isSymbolicLink(), false);
    await rm(resolved, { recursive: true, force: true });
    assert.equal(await lstat(resolved).catch(() => null), null, 'Temporary vault and key material removed');
    t.diagnostic('ACCEPT03_CLEANUP ' + JSON.stringify({ ownRandomSchemaDroppedByHelper: true, ownVaultRemoved: true, rootOwnedContainerRetainedForOtherTests: true }));
  }
});
