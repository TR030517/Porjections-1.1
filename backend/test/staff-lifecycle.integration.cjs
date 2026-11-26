/* ACCEPT-01: actual owner/staff HTTP sessions, no mocked authorization.
 * node --test --test-concurrency=1 test/staff-lifecycle.integration.cjs
 * Requires generated Prisma client in the candidate and the existing guarded
 * TEST_DATABASE_URL on loopback:3310. withFreshDatabase deploys all migrations
 * to a newly generated schema and drops only that schema in finally.
 * Users/stores/orders are synthetic; no external delivery or existing DB writes.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { installTestEnvironment, withFreshDatabase } = require('./booking-resources.support.cjs');
installTestEnvironment();
Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'false', NOTIFICATION_WORKER_ENABLED: 'false',
  BOOKING_ONLINE_PAYMENT_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled',
  ORDER_EMAIL_API_KEY: '', ORDER_EMAIL_PROVIDER: '', ORDER_EMAIL_FROM: '', ORDER_EMAIL_LOCAL_CAPTURE: 'false',
  AUTH_EMAIL_API_KEY: '', AUTH_EMAIL_PROVIDER: '', AUTH_EMAIL_FROM: '' });
require('ts-node/register/transpile-only');
require('reflect-metadata');

const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);
const digest = value => createHash('sha256').update(serialize(value)).digest('hex');
// Raw SQL snapshots can contain password/session hashes. Failed assertions must
// report only digests, never raw rows or response bodies containing credentials.
const same = (actual, expected, message) => assert.equal(digest(actual), digest(expected), message);

test('staff lifecycle: two actual sessions preserve B when A is revoked and never revive globally revoked sessions', { timeout: 240000 }, async t => {
  const sourceFiles = ['prisma/schema.prisma', 'src/modules/staff/staff.controller.ts', 'src/modules/staff/staff.service.ts',
    'src/modules/staff/staff.dto.ts', 'src/common/shop-access.ts', 'src/modules/auth/auth.service.ts',
    'src/modules/auth/strategies/jwt.strategy.ts', 'src/modules/admin/user-manage.service.ts',
    'src/modules/merchant/merchant.service.ts', 'src/modules/booking/booking.service.ts',
    'test/booking-resources.support.cjs', 'test/staff-lifecycle.integration.cjs'];
  const sourceManifest = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
  const candidateSha256 = createHash('sha256').update(JSON.stringify(sourceManifest)).digest('hex');
  if (process.env.STAFF_LIFECYCLE_EXPECTED_CANDIDATE_SHA256) assert.equal(candidateSha256, process.env.STAFF_LIFECYCLE_EXPECTED_CANDIDATE_SHA256, 'Staff candidate changed since approval');
  t.diagnostic('ACCEPT01_SOURCE ' + JSON.stringify({ candidateSha256, files: sourceManifest }));
  const vaultDirectory = await mkdtemp(path.join(tmpdir(), 'massajoy-staff-lifecycle-'));
  process.env.MERCHANT_CREDENTIAL_VAULT_DIR = vaultDirectory;
  process.env.MERCHANT_CREDENTIAL_VAULT_KEY = randomBytes(32).toString('base64');
  try { await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const reader = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = randomBytes(6).toString('hex');
    const ownerPassword = randomBytes(24).toString('base64url'), staffPassword = randomBytes(24).toString('base64url');
    const users = {}, shops = {}, bookings = {}, auth = {}, oldStaffSessions = [];
    const allDuties = ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ'];
    const selectedDuties = ['BOOKINGS_READ'];
    const originalFetch = globalThis.fetch;
    let app, origin, baselineUser, baselineOtherSessions, baselineOwnership, baselineBGrant;
    const call = async (route, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) => {
      const result = await fetch(origin + '/api/v1' + route, { method,
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      let json; try { json = await result.json(); } catch { json = {}; }
      return { status: result.status, body: json };
    };
    const expect = (response, expected) => { assert.equal(response.status, expected, 'Unexpected HTTP status; private response omitted'); return response.body; };
    const login = async (email, password) => expect(await call('/auth/password/login', { body: { email, password } }), 200);
    const staffRoute = shop => '/merchant/shops/' + shops[shop].id + '/staff';
    const detail = (name, session) => call('/bookings/' + bookings[name].id, { token: session.accessToken });
    const cancel = (name, session) => call('/bookings/' + bookings[name].id + '/cancel', { token: session.accessToken, body: {} });
    const list = (shop, session) => call('/merchant/shops/' + shops[shop].id + '/bookings?page=1&pageSize=20', { token: session.accessToken });
    const dashboard = (shop, session) => call('/merchant/shops/' + shops[shop].id + '/dashboard', { token: session.accessToken });
    const grant = (shop, permissions = selectedDuties) => call(staffRoute(shop) + '/grants', {
      token: auth['owner' + shop].accessToken, body: { userId: String(users.staff.id), permissions } });
    const userSql = () => reader.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id=${users.staff.id}`);
    const grantsSql = () => reader.$queryRaw(Prisma.sql`SELECT * FROM shop_staff_grants WHERE user_id=${users.staff.id} ORDER BY shop_id,id`);
    const grantSql = shop => reader.$queryRaw(Prisma.sql`SELECT * FROM shop_staff_grants WHERE user_id=${users.staff.id} AND shop_id=${shops[shop].id}`);
    const sessionsSql = () => reader.$queryRaw(Prisma.sql`SELECT * FROM auth_sessions WHERE user_id=${users.staff.id} ORDER BY id`);
    const otherSessionsSql = () => reader.$queryRaw(Prisma.sql`SELECT * FROM auth_sessions WHERE user_id<>${users.staff.id} ORDER BY id`);
    const ownershipSql = async () => ({ shops: await reader.$queryRaw`SELECT id,owner_id FROM shops ORDER BY id`,
      bindings: await reader.$queryRaw`SELECT * FROM shop_login_bindings ORDER BY id`,
      ledgers: await reader.$queryRaw`SELECT * FROM merchant_profiles ORDER BY id` });
    const bookingSql = name => reader.$queryRaw(Prisma.sql`SELECT * FROM bookings WHERE id=${bookings[name].id}`);
    const completeSnapshot = async () => ({ users: await reader.$queryRaw`SELECT * FROM users ORDER BY id`,
      sessions: await reader.$queryRaw`SELECT * FROM auth_sessions ORDER BY id`, grants: await grantsSql(),
      bookings: await reader.$queryRaw`SELECT * FROM bookings ORDER BY id`, items: await reader.$queryRaw`SELECT * FROM booking_items ORDER BY id`,
      locks: await reader.$queryRaw`SELECT * FROM booking_resource_locks ORDER BY id`, entries: await reader.$queryRaw`SELECT * FROM booking_settlement_entries ORDER BY id`,
      outbox: await reader.$queryRaw`SELECT * FROM notification_outbox ORDER BY id`, audits: await reader.$queryRaw`SELECT * FROM audit_logs ORDER BY id`,
      receipts: await reader.$queryRaw`SELECT * FROM booking_operation_receipts ORDER BY id` });
    const deniedWithoutWrites = async (work, message) => {
      const before = await completeSnapshot(); await work(); same(await completeSnapshot(), before, message);
    };
    const ownersRemainActive = async () => {
      for (const name of ['admin', 'ownerA', 'ownerB']) expect(await call('/auth/me', { token: auth[name].accessToken }), 200);
      same(await otherSessionsSql(), baselineOtherSessions, 'Staff actions must not change owner/admin sessions');
      same(await ownershipSql(), baselineOwnership, 'Staff lifecycle must not change historical ownership, bindings or ledgers');
    };
    const fixtureBooking = async (name, shopName, offset) => {
      const shop = shops[shopName], start = new Date(Date.now() + (24 + offset) * 3600000), end = new Date(+start + 1800000);
      const therapist = await db.therapist.create({ data: { shopId: shop.id, name: 'Synthetic therapist ' + name } });
      const service = await db.shopService.findFirstOrThrow({ where: { shopId: shop.id } });
      const booking = await db.booking.create({ data: { bookingNo: 'STAFF-' + prefix + '-' + offset, userId: users.customer.id, shopId: shop.id,
        serviceId: service.id, therapistId: therapist.id, bookingDate: new Date(start.toISOString().slice(0, 10) + 'T00:00:00Z'),
        bookingTimezone: 'America/Los_Angeles', startTime: start, endTime: end, durationMin: 30, priceCents: 4000, totalCents: 4000,
        status: 'CONFIRMED', paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', bookingSource: 'ONLINE',
        contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactName: 'Synthetic customer', contactPhone: '+12025550101',
        contactEmail: users.customer.email, contactEmailVerifiedAt: users.customer.emailVerifiedAt } });
      const item = await db.bookingItem.create({ data: { bookingId: booking.id, serviceId: service.id, participantIndex: 1,
        serviceNameSnapshot: 'Synthetic service', durationKindSnapshot: 'TIMED', durationMin: 30, staffBufferMin: 0, roomBufferMin: 0, priceCentsSnapshot: 4000,
        currency: 'usd', startAtUtc: start, endAtUtc: end, assignedTherapistId: therapist.id } });
      await db.bookingResourceLock.create({ data: { bookingId: booking.id, bookingItemId: item.id, shopId: shop.id,
        resourceType: 'THERAPIST', resourceId: therapist.id, startAtUtc: start, endAtUtc: end } });
      bookings[name] = booking;
    };
    try {
      const passwordHash = await hash(ownerPassword, 10);
      for (const [name, role] of [['admin', 'ADMIN'], ['ownerA', 'MERCHANT'], ['ownerB', 'MERCHANT'], ['customer', 'CUSTOMER']]) {
        users[name] = await db.user.create({ data: { email: prefix + '.' + name.toLowerCase() + '@example.invalid', name: 'Synthetic ' + name,
          passwordHash, role, ...(role === 'CUSTOMER' ? { emailVerifiedAt: new Date() } : {}) } });
      }
      for (const name of ['A', 'B']) {
        shops[name] = await db.shop.create({ data: { ownerId: users['owner' + name].id, name: 'Synthetic staff store ' + name,
          shortName: 'staff-' + prefix + '-' + name.toLowerCase(), address: '1 Synthetic Way', city: 'Seattle', state: 'WA', zipCode: '98144',
          latitude: 47.6, longitude: -122.3, phone: '+12025550110', timezone: 'America/Los_Angeles', category: 'MIXED', status: 'APPROVED',
          studioProfile: { paymentPolicy: { payAtStoreEnabled: true } } } });
        await db.shopLoginBinding.create({ data: { shopId: shops[name].id, userId: users['owner' + name].id, createdById: users.admin.id,
          reason: 'Synthetic independent staff lifecycle owner' } });
        await db.merchantProfile.create({ data: { shopId: shops[name].id, userId: users['owner' + name].id } });
        await db.shopService.create({ data: { shopId: shops[name].id, name: 'Synthetic service', category: 'MASSAGE', durationMin: 30, priceCents: 4000 } });
      }
      await fixtureBooking('A', 'A', 0); await fixtureBooking('B', 'B', 1); await fixtureBooking('BafterRestore', 'B', 2);
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
      app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      globalThis.fetch = (input, options) => { assert.equal(new URL(String(input)).origin, origin, 'External HTTP forbidden'); return originalFetch(input, options); };
      for (const name of ['admin', 'ownerA', 'ownerB']) auth[name] = await login(users[name].email, ownerPassword);

      await t.test('owner creates STAFF and both owners grant their own shop; two real sessions receive exact duties', async () => {
        const created = expect(await call(staffRoute('A'), { token: auth.ownerA.accessToken, body: { name: 'Synthetic shared staff',
          email: prefix + '.staff@example.invalid', phone: '+12025550123', password: staffPassword, permissions: allDuties } }), 201);
        assert.equal(created.accountStatus, 'ACTIVE'); same(created.permissions, allDuties, 'Create must return only selected duties');
        assert.ok(!serialize(created).includes(staffPassword) && !serialize(created).includes('passwordHash'), 'Create response must omit password/hash');
        users.staff = await db.user.findUniqueOrThrow({ where: { id: BigInt(created.userId) } });
        expect(await grant('B', allDuties), 201);
        oldStaffSessions.push(await login(users.staff.email, staffPassword), await login(users.staff.email, staffPassword));
        assert.ok(oldStaffSessions[0].accessToken !== oldStaffSessions[1].accessToken && oldStaffSessions[0].refreshToken !== oldStaffSessions[1].refreshToken, 'Two staff devices need independent credentials');
        baselineUser = await userSql(); baselineOtherSessions = await otherSessionsSql(); baselineOwnership = await ownershipSql(); baselineBGrant = await grantSql('B');
        assert.equal((await sessionsSql()).length, 2);
        for (const session of oldStaffSessions) for (const shop of ['A', 'B']) {
          expect(await detail(shop, session), 200); expect(await list(shop, session), 200); expect(await dashboard(shop, session), 200);
          expect(await call('/reservation-admin/shops/' + shops[shop].id + '/config', { token: session.accessToken }), 200);
        }
        await deniedWithoutWrites(async () => {
          expect(await call(staffRoute('B') + '/grants', { token: auth.ownerA.accessToken, body: { userId: String(users.staff.id), permissions: [] } }), 403);
          expect(await call(staffRoute('A') + '/grants', { token: oldStaffSessions[0].accessToken, body: { userId: String(users.staff.id), permissions: allDuties } }), 403);
        }, 'Foreign owner and staff self-escalation must cause zero writes');
      });

      await t.test('revoking A is idempotent and old JWTs lose A reads/writes without changing B or the staff account/session', async () => {
        const sessionsBefore = await sessionsSql(), orderBefore = await bookingSql('A');
        const route = staffRoute('A') + '/' + users.staff.id;
        expect(await call(route, { token: auth.ownerA.accessToken, method: 'DELETE' }), 200);
        const revoked = await grantSql('A'); assert.equal(revoked[0].status, 'REVOKED'); same(revoked[0].permissions, [], 'Revocation clears duties'); assert.ok(revoked[0].revoked_at);
        const afterFirst = await completeSnapshot();
        expect(await call(route, { token: auth.ownerA.accessToken, method: 'DELETE' }), 200);
        same(await completeSnapshot(), afterFirst, 'Repeated revocation cannot add audits or mutate timestamps');
        for (const session of oldStaffSessions) {
          expect(await detail('A', session), 404); expect(await cancel('A', session), 404); expect(await list('A', session), 403);
          expect(await call('/auth/me', { token: session.accessToken }), 200);
          const visible = expect(await call('/merchant/shops', { token: session.accessToken }), 200);
          same(visible.map(row => String(row.id)).sort(), [String(shops.B.id)], 'Old sessions must list only shop B after A is revoked');
        }
        same(await bookingSql('A'), orderBefore, 'Denied A writes must retain its actual order');
        same(await grantSql('B'), baselineBGrant, 'A revocation must leave B grant unchanged');
        same(await userSql(), baselineUser, 'A revocation cannot change the global staff account');
        same(await sessionsSql(), sessionsBefore, 'Local A revocation cannot revoke B-capable sessions');
        const audits = await reader.$queryRaw(Prisma.sql`SELECT id FROM audit_logs WHERE action='STAFF_REVOKED' AND target_id=${shops.A.id}`);
        assert.equal(audits.length, 1); await ownersRemainActive();
      });

      await t.test('the same old staff JWTs still read B and perform a genuine authorized B cancellation', async () => {
        const beforeA = await bookingSql('A');
        for (const session of oldStaffSessions) { expect(await detail('B', session), 200); expect(await list('B', session), 200); }
        assert.equal(expect(await cancel('B', oldStaffSessions[0]), 201).status, 'CANCELLED');
        assert.equal((await bookingSql('B'))[0].status, 'CANCELLED');
        const locks = await reader.$queryRaw(Prisma.sql`SELECT status FROM booking_resource_locks WHERE booking_id=${bookings.B.id}`);
        assert.ok(locks.length > 0 && locks.every(row => row.status === 'RELEASED'));
        expect(await detail('B', oldStaffSessions[1]), 200);
        same(await bookingSql('A'), beforeA, 'An authorized B write cannot touch A'); same(await grantSql('B'), baselineBGrant, 'B duties remain stable');
      });

      await t.test('old permission editing cannot revive A; explicit regrant restores only selected read duty', async () => {
        const revoked = await grantSql('A'), sessionsBefore = await sessionsSql();
        await deniedWithoutWrites(async () => expect(await call(staffRoute('A') + '/' + users.staff.id, { token: auth.ownerA.accessToken,
          method: 'PATCH', body: { permissions: allDuties } }), 404), 'Editing revoked A permission must not reauthorize it');
        const regranted = expect(await grant('A'), 201); same(regranted.permissions, selectedDuties, 'Regrant returns exact selected duties');
        const rows = await grantSql('A'); assert.equal(String(rows[0].id), String(revoked[0].id)); assert.equal(rows[0].status, 'ACTIVE');
        assert.equal(rows[0].revoked_at, null); same(rows[0].created_at, revoked[0].created_at, 'Regrant preserves identity/creation');
        same(rows[0].permissions, selectedDuties, 'Old broad permissions cannot survive read-only regrant');
        for (const session of oldStaffSessions) {
          expect(await detail('A', session), 200); expect(await list('A', session), 200);
          await deniedWithoutWrites(async () => {
            expect(await cancel('A', session), 404); expect(await dashboard('A', session), 403);
            expect(await call('/reservation-admin/shops/' + shops.A.id + '/config', { token: session.accessToken }), 403);
            expect(await call(staffRoute('A'), { token: session.accessToken }), 403);
          }, 'Read-only A regrant cannot recover booking-write, finance, configuration or owner powers');
          expect(await dashboard('B', session), 200);
        }
        same(await userSql(), baselineUser, 'Regrant preserves global staff identity and password');
        same(await sessionsSql(), sessionsBefore, 'Regrant does not silently issue or revoke sessions');
        same(await grantSql('B'), baselineBGrant, 'A regrant does not modify B');
      });

      await t.test('global suspension revokes both staff sessions; shop regrant cannot activate the account', async () => {
        const grantsBefore = await grantsSql(), sessionsBefore = await sessionsSql(); assert.equal(sessionsBefore.length, 2);
        expect(await call('/admin/users/' + users.staff.id + '/status', { token: auth.admin.accessToken, method: 'PATCH',
          body: { status: 'SUSPENDED', reason: 'Synthetic staff lifecycle suspension' } }), 200);
        const rows = await sessionsSql(); same(rows.map(row => row.id), sessionsBefore.map(row => row.id), 'Suspension cannot create replacement sessions');
        assert.ok(rows.length === 2 && rows.every(row => row.revoked_at));
        assert.equal((await userSql())[0].status, 'SUSPENDED');
        for (const session of oldStaffSessions) {
          expect(await call('/auth/me', { token: session.accessToken }), 401);
          for (const shop of ['A', 'B']) { expect(await detail(shop, session), 401); expect(await cancel(shop, session), 401); }
          expect(await call('/auth/refresh', { body: { refreshToken: session.refreshToken } }), 401);
        }
        await deniedWithoutWrites(async () => {
          expect(await grant('A', allDuties), 404); expect(await grant('B', allDuties), 404);
          expect(await call('/auth/password/login', { body: { email: users.staff.email, password: staffPassword } }), 401);
        }, 'Grant/login while globally suspended cannot change any account, grant or session');
        same(await grantsSql(), grantsBefore, 'Global suspension retains per-shop duties for explicit later recovery');
        await ownersRemainActive();
      });

      await t.test('global restore does not revive any old access/refresh token or implicitly log the employee in', async () => {
        const oldSessions = await sessionsSql(), oldGrants = await grantsSql();
        expect(await call('/admin/users/' + users.staff.id + '/status', { token: auth.admin.accessToken, method: 'PATCH',
          body: { status: 'ACTIVE', reason: 'Synthetic staff lifecycle restore requiring re-login' } }), 200);
        assert.equal((await userSql())[0].status, 'ACTIVE');
        same(await sessionsSql(), oldSessions, 'Restoring ACTIVE must not modify old session revocation or issue a session');
        for (const session of oldStaffSessions) await deniedWithoutWrites(async () => {
          expect(await call('/auth/me', { token: session.accessToken }), 401);
          expect(await detail('A', session), 401); expect(await detail('B', session), 401);
          expect(await call('/auth/refresh', { body: { refreshToken: session.refreshToken } }), 401);
        }, 'Old access and refresh must remain unusable after restore');
        same(await grantsSql(), oldGrants, 'Restore cannot widen selected shop duties');
        const statusAudits = await reader.$queryRaw(Prisma.sql`SELECT action,detail FROM audit_logs WHERE target_type='USER' AND target_id=${users.staff.id} ORDER BY id`);
        same(statusAudits.map(row => ({ action: row.action, revoked: row.detail.revokedSessions })), [
          { action: 'USER_SUSPENDED', revoked: 2 }, { action: 'USER_ACTIVE', revoked: 0 }], 'Status audit must account for exact revoked devices');
        await ownersRemainActive();
      });

      await t.test('only a fresh password login restores selected A reads and full B duties', async () => {
        const oldSessions = await sessionsSql(); auth.freshStaff = await login(users.staff.email, staffPassword);
        assert.ok(oldStaffSessions.every(session => session.accessToken !== auth.freshStaff.accessToken && session.refreshToken !== auth.freshStaff.refreshToken));
        const rows = await sessionsSql(); assert.equal(rows.length, 3); assert.equal(rows.filter(row => !row.revoked_at).length, 1);
        same(rows.filter(row => oldSessions.some(old => old.id === row.id)), oldSessions, 'Fresh login cannot revive previous session records');
        expect(await detail('A', auth.freshStaff), 200); expect(await list('A', auth.freshStaff), 200);
        expect(await cancel('A', auth.freshStaff), 404); expect(await dashboard('A', auth.freshStaff), 403);
        expect(await detail('BafterRestore', auth.freshStaff), 200); expect(await dashboard('B', auth.freshStaff), 200);
        assert.equal(expect(await cancel('BafterRestore', auth.freshStaff), 201).status, 'CANCELLED');
        assert.equal((await bookingSql('BafterRestore'))[0].status, 'CANCELLED'); assert.equal((await bookingSql('A'))[0].status, 'CONFIRMED');
        const stableUser = rows => rows.map(({ updated_at, ...identity }) => identity);
        same(stableUser(await userSql()), stableUser(baselineUser), 'Entire lifecycle must preserve identity/password and restore only account status; updated_at may advance');
        same(await grantSql('B'), baselineBGrant, 'B grant must survive the entire A/global lifecycle'); await ownersRemainActive();
      });

      await t.test('independent SQL audits record exact staff transitions without password, token or credential hashes', async () => {
        const audits = await reader.$queryRaw`SELECT action,target_type,target_id,operator_id,detail FROM audit_logs ORDER BY id`;
        const transitions = audits.filter(row => row.action.startsWith('STAFF_'));
        same(transitions.map(row => ({ action: row.action, shop: String(row.target_id), operator: String(row.operator_id) })), [
          { action: 'STAFF_CREATED', shop: String(shops.A.id), operator: String(users.ownerA.id) },
          { action: 'STAFF_GRANTED', shop: String(shops.B.id), operator: String(users.ownerB.id) },
          { action: 'STAFF_REVOKED', shop: String(shops.A.id), operator: String(users.ownerA.id) },
          { action: 'STAFF_GRANTED', shop: String(shops.A.id), operator: String(users.ownerA.id) }], 'Staff audit must identify actor, target shop and exact accepted transitions');
        assert.ok(transitions.every(row => row.detail.staffUserId === String(users.staff.id)));
        const content = serialize(audits), secrets = [ownerPassword, staffPassword, users.staff.passwordHash,
          ...Object.values(users).map(user => user.passwordHash), ...Object.values(auth).flatMap(session => [session.accessToken, session.refreshToken]),
          ...oldStaffSessions.flatMap(session => [session.accessToken, session.refreshToken]), ...(await sessionsSql()).map(row => row.token_hash)];
        for (const value of secrets.filter(Boolean)) assert.ok(!content.includes(value), 'Audit must not include credential material; content omitted');
        assert.ok(!/passwordHash|password_hash|refreshToken|accessToken|token_hash/.test(content), 'Audit fields must not contain secret keys');
        assert.equal((await grantsSql()).length, 2);
      });
      t.diagnostic('ACCEPT01_HTTP_SQL_EXECUTED migrations=' + migrationCount + '; 2 stores, 2 staff sessions, owner/admin sessions, synthetic identities only; no browser claim or external delivery');
    } finally {
      globalThis.fetch = originalFetch;
      if (app) await app.close();
      await reader.$disconnect();
    }
  }); } finally {
    assert.equal(path.dirname(path.resolve(vaultDirectory)), path.resolve(tmpdir()), 'Cleanup must stay inside the intended temporary directory');
    assert.match(path.basename(vaultDirectory), /^massajoy-staff-lifecycle-/);
    await rm(vaultDirectory, { recursive: true, force: true });
  }
});
