/* NEXT-01 + NEXT-04. Run only in a clean candidate after prisma generate.
 * node --test --test-concurrency=1 test/customer-booking-visibility.integration.cjs
 * Uses withFreshDatabase: explicit loopback:3310 mj2_test_* URL, new random DB,
 * all checked-in migrations, exact finally cleanup. Requires TRIGGER privilege
 * in that disposable DB for a real late-outbox SQL failure. No external delivery.
 * Fixtures are directly inserted synthetic orders; read/mutation assertions use
 * actual JWT HTTP routes and a distinct Prisma connection for SQL verification.
 * Fault-fixture DDL uses mysql CLI stdin (Prisma prepares DDL unsupported by
 * MySQL). Both MySQL 8.0 and 8.4 clients use --no-defaults plus an independent
 * nonexistent MYSQL_TEST_LOGIN_FILE, preventing a user's login-path overrides.
 * If mysql is absent, set TEST_MYSQL_CONTAINER to the dedicated
 * container labelled massajoy.owner=massajoy-next-20261120 and bound to :3310.
 * Its own MYSQL_ROOT_PASSWORD stays inside the container; no secret CLI args.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { readFileSync, mkdtempSync, rmdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { isolatedTarget, installTestEnvironment, withFreshDatabase, observedPrisma, deferred, within, waitForShopLockQueries } = require('./booking-resources.support.cjs');
installTestEnvironment();
Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'false', NOTIFICATION_WORKER_ENABLED: 'false',
  BOOKING_ONLINE_PAYMENT_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled',
  ORDER_EMAIL_API_KEY: '', ORDER_EMAIL_PROVIDER: '', ORDER_EMAIL_FROM: '', ORDER_EMAIL_LOCAL_CAPTURE: 'false' });
require('ts-node/register/transpile-only');
require('reflect-metadata');

// Setup/teardown only. Product writes and failure observation still use the real
// HTTP/Prisma path. Refuse an existing test DB or an unverified Docker target.
function faultFixtureDdl(databaseUrl, sql) {
  const target = isolatedTarget(databaseUrl);
  assert.match(target.pathname, /^\/mj2_test_booking_resources_[a-f0-9]{16}$/, 'Fault DDL requires this suite\'s random disposable database');
  const database = target.pathname.slice(1);
  const options = { input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true };
  const diagnostic = result => {
    let stderr = String(result.stderr || '').slice(0, 1200);
    for (const secret of [databaseUrl, target.password, decodeURIComponent(target.password), target.username, decodeURIComponent(target.username), database].filter(Boolean)) stderr = stderr.split(secret).join('[REDACTED]');
    stderr = stderr.replace(/mysql:\/\/[^\s"']+/gi, 'mysql://[REDACTED]').replace(/password\s*[=:]\s*[^\s]+/gi, 'password=[REDACTED]');
    return JSON.stringify({ exitCode: result.status, signal: result.signal ?? null, spawnError: result.error?.code ?? null, stderr });
  };
  // --no-defaults alone still reads .mylogin.cnf. Redirect it to a nonexistent
  // file inside our own empty directory: supported by 8.0 (Windows/Ubuntu) and
  // 8.4, without the newer and incompatible --no-login-paths option.
  const loginDirectory = mkdtempSync(path.join(tmpdir(), 'massajoy-next04-mysql-'));
  try {
    const clientEnv = { ...process.env, MYSQL_PWD: decodeURIComponent(target.password),
      MYSQL_TEST_LOGIN_FILE: path.join(loginDirectory, 'no-login-paths.cnf') };
    const probe = spawnSync('mysql', ['--no-defaults', '--version'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 64 * 1024, env: clientEnv });
    if (probe.error?.code !== 'ENOENT') {
      assert.ok(!probe.error && probe.status === 0, 'Local mysql offline option probe failed: ' + diagnostic(probe));
      const local = spawnSync('mysql', ['--no-defaults', '--protocol=TCP', '--host=' + target.hostname, '--port=' + target.port,
        '--user=' + decodeURIComponent(target.username), '--database=' + database, '--batch', '--skip-column-names'],
      { ...options, env: clientEnv });
      // Once a command can execute SQL, an uncertain/nonzero outcome fails closed;
      // never retry that DDL using another target or quietly skip the assertion.
      assert.ok(!local.error && local.status === 0, 'Isolated mysql CLI DDL failed: ' + diagnostic(local));
      return;
    }
    const container = process.env.TEST_MYSQL_CONTAINER || '';
    assert.match(container, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'mysql CLI unavailable before DDL: set the dedicated TEST_MYSQL_CONTAINER');
    const inspected = spawnSync('docker', ['inspect', '--format', '{"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}', container],
      { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 64 * 1024 });
    assert.ok(!inspected.error && inspected.status === 0, 'Cannot inspect isolated MySQL container; output omitted');
    let metadata;
    try { metadata = JSON.parse(inspected.stdout); } catch { throw Error('Invalid isolated container metadata'); }
    assert.equal(metadata.labels?.['massajoy.owner'], 'massajoy-next-20261120', 'Fault DDL container ownership does not match this verification run');
    assert.ok(metadata.ports?.['3306/tcp']?.some(binding => binding.HostPort === target.port && ['127.0.0.1', '::1'].includes(binding.HostIp)), 'Fault DDL container must serve the guarded loopback:3310 database');
    const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --no-defaults --no-login-paths --user=root --database="$1" --batch --skip-column-names',
      'next04-fault-ddl', database], options);
    assert.ok(!result.error && result.status === 0, 'Isolated container mysql DDL failed: ' + diagnostic(result));
  } finally {
    // This directory contains no files. Never recursively remove a supplied path.
    rmdirSync(loginDirectory);
  }
}

test('customer hiding is isolated from business history and offline refund cancellation emails are atomic', { timeout: 240000 }, async t => {
  const sourceFiles = ['prisma/schema.prisma', 'prisma/migrations/202611200035_customer_booking_visibility/migration.sql',
    'src/modules/booking/booking.service.ts', 'src/modules/booking/booking-list.query.ts', 'src/modules/booking/settlement.service.ts',
    'src/common/notification-outbox.ts', 'src/common/booking-order-email.ts', 'src/common/booking-contact.ts', 'src/common/shop-order-email.ts',
    'test/customer-booking-visibility.integration.cjs'];
  const sourceManifest = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
  const candidateSha256 = createHash('sha256').update(JSON.stringify(sourceManifest)).digest('hex');
  if (process.env.NEXT01_EXPECTED_CANDIDATE_SHA256) assert.equal(candidateSha256, process.env.NEXT01_EXPECTED_CANDIDATE_SHA256, 'Candidate changed since approval');
  t.diagnostic('NEXT01_NEXT04_SOURCE ' + JSON.stringify({ candidateSha256, files: sourceManifest }));
  await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { hash } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { NotificationService } = require('../src/modules/notifications/notification.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const reader = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const blocker = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const prefix = randomBytes(6).toString('hex'), password = randomBytes(24).toString('base64url');
    const users = {}, auth = {}, observer = { current: null };
    const originalFetch = globalThis.fetch;
    let app, origin, shop, service, index = 0;
    const http = async (route, actor = 'customer', body, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(origin + '/api/v1' + route, { method,
        headers: { ...(auth[actor] ? { Authorization: 'Bearer ' + auth[actor] } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      let json; try { json = await response.json(); } catch { json = {}; }
      return { status: response.status, json };
    };
    const status = (response, expected) => { assert.equal(response.status, expected, 'Unexpected HTTP status; private body omitted'); return response.json; };
    const item = (id, actor = 'customer') => http('/bookings/' + id, actor);
    const hide = (id, actor = 'customer') => http('/bookings/' + id, actor, undefined, 'DELETE');
    const commands = new Map();
    const command = key => {
      if (!commands.has(key)) commands.set(key, { requestKey: key, amountCents: 4000, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic physical transaction already completed' });
      return commands.get(key);
    };
    const collect = (id, key) => http('/bookings/' + id + '/offline-receipts', 'owner', command(key));
    const refund = (id, key) => http('/bookings/' + id + '/offline-refunds', 'owner', command(key));
    const snapshot = async id => {
      const bid = BigInt(id);
      return {
        // Independent SQL, not the HTTP response or product's serializer.
        booking: await reader.$queryRaw(Prisma.sql`SELECT id,status,payment_status,total_cents,paid_cents,refunded_cents,deleted_at,customer_hidden_at,hold_expires_at FROM bookings WHERE id=${bid}`),
        entries: await reader.$queryRaw(Prisma.sql`SELECT * FROM booking_settlement_entries WHERE booking_id=${bid} ORDER BY id`),
        locks: await reader.$queryRaw(Prisma.sql`SELECT * FROM booking_resource_locks WHERE booking_id=${bid} ORDER BY id`),
        outbox: await reader.$queryRaw(Prisma.sql`SELECT * FROM notification_outbox WHERE booking_id=${bid} ORDER BY id`),
        audits: await reader.$queryRaw(Prisma.sql`SELECT * FROM audit_logs WHERE target_type='BOOKING' AND target_id=${bid} ORDER BY id`),
        receipts: await reader.$queryRaw(Prisma.sql`SELECT * FROM booking_operation_receipts WHERE booking_id=${bid} ORDER BY id`),
      };
    };
    const fixture = async (patch = {}) => {
      const n = ++index, end = new Date(Date.now() - 60000), start = new Date(+end - 1800000);
      const therapist = await db.therapist.create({ data: { shopId: shop.id, name: 'Synthetic therapist ' + n } });
      const booking = await db.booking.create({ data: { bookingNo: 'VIS-' + prefix + '-' + n, userId: users.customer.id, shopId: shop.id, serviceId: service.id,
        therapistId: therapist.id, bookingDate: new Date(start.toISOString().slice(0, 10) + 'T00:00:00Z'), bookingTimezone: 'America/Los_Angeles',
        startTime: start, endTime: end, durationMin: 30, priceCents: 4000, totalCents: 4000,
        paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', status: 'COMPLETED', bookingSource: 'ONLINE',
        contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactName: 'Synthetic customer', contactPhone: '+12025550101',
        contactEmail: users.customer.email, contactEmailVerifiedAt: users.customer.emailVerifiedAt, ...patch } });
      const bookingItem = await db.bookingItem.create({ data: { bookingId: booking.id, serviceId: service.id, participantIndex: 1,
        serviceNameSnapshot: 'Synthetic service', durationMin: 30, durationKindSnapshot: 'TIMED', priceCentsSnapshot: booking.totalCents,
        currency: 'usd', startAtUtc: start, endAtUtc: end, assignedTherapistId: therapist.id, staffBufferMin: 60, roomBufferMin: 0 } });
      // The real cleanup interval remains active after service completion.
      await db.bookingResourceLock.create({ data: { bookingId: booking.id, bookingItemId: bookingItem.id, shopId: shop.id,
        resourceType: 'THERAPIST', resourceId: therapist.id, startAtUtc: start, endAtUtc: new Date(+end + 3600000) } });
      return booking;
    };
    try {
      const passwordHash = await hash(password, 10);
      for (const [name, role] of [['customer','CUSTOMER'], ['other','CUSTOMER'], ['owner','MERCHANT'], ['staff','STAFF'], ['admin','ADMIN']]) {
        users[name] = await db.user.create({ data: { name: 'Synthetic ' + name, role, email: prefix + '.' + name + '@example.invalid', passwordHash,
          ...(role === 'CUSTOMER' ? { emailVerifiedAt: new Date(), phone: name === 'customer' ? '+12025550101' : '+12025550102' } : {}) } });
      }
      shop = await db.shop.create({ data: { ownerId: users.owner.id, shortName: 'visibility-' + prefix, name: 'Synthetic visibility store',
        phone: '+12025550110', address: '1 Synthetic Way', city: 'Seattle', state: 'WA', zipCode: '98144', latitude: 47.6, longitude: -122.3,
        category: 'MIXED', status: 'APPROVED', timezone: 'America/Los_Angeles', businessHours: {}, studioProfile: { paymentPolicy: { payAtStoreEnabled: true } } } });
      await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: users.owner.id, createdById: users.admin.id, reason: 'Synthetic independent login' } });
      await db.merchantProfile.create({ data: { shopId: shop.id, userId: users.owner.id } });
      await db.shopStaffGrant.create({ data: { shopId: shop.id, userId: users.staff.id, createdById: users.owner.id, permissions: ['BOOKINGS_READ'] } });
      await db.shopOrderEmailSetting.create({ data: { shopId: shop.id, enabled: true, recipientEmail: prefix + '.store@example.invalid', recipientVerifiedAt: new Date() } });
      service = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic service', category: 'MASSAGE', durationMin: 30, priceCents: 4000 } });
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(observedPrisma(db, observer))
        .overrideProvider(NotificationService).useValue({ notifyBookingConfirmed: async () => undefined, notifyBookingCancelled: async () => undefined, notifyBookingReminder: async () => undefined }).compile();
      app = module.createNestApplication({ rawBody: true, logger: ['error'] }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      globalThis.fetch = (input, options) => { const target = new URL(String(input)); if (target.origin !== origin) throw Error('EXTERNAL_HTTP_FORBIDDEN'); return originalFetch(input, options); };
      for (const [name, user] of Object.entries(users)) auth[name] = status(await http(user.role === 'CUSTOMER' ? '/auth/customer/password/login' : '/auth/password/login', '', { email: user.email, password }), 200).accessToken;

      await t.test('uncollected completed service rejects hiding with zero SQL writes', async () => {
        const b = await fixture(), before = await snapshot(b.id);
        status(await hide(b.id), 400); assert.deepEqual(await snapshot(b.id), before);
        assert.equal(status(await http('/bookings/' + b.id + '/settlements', 'owner'), 200).amountDueCents, 4000);
      });
      await t.test('zero terminal hide affects customer list/detail only; business history, audit, resources and reminders survive', async () => {
        const b = await fixture({ paymentMode: 'ZERO', priceCents: 0, totalCents: 0, paymentStatus: 'PAID' });
        await db.notificationOutbox.create({ data: { id: randomUUID(), eventKey: 'synthetic:' + b.id + ':reminder', contentHash: 'a'.repeat(64),
          userId: users.customer.id, bookingId: b.id, topic: 'BOOKING_REMINDER', resourceType: 'BOOKING', resourceId: String(b.id), channel: 'IN_APP', status: 'PENDING', runAt: new Date(Date.now() + 3600000), dataJson: {} } });
        const before = await snapshot(b.id); status(await hide(b.id), 200); status(await hide(b.id), 200);
        const after = await snapshot(b.id);
        assert.ok(after.booking[0].customer_hidden_at); assert.equal(after.booking[0].deleted_at, null);
        assert.deepEqual({ ...after.booking[0], customer_hidden_at: null }, before.booking[0]);
        for (const key of ['entries', 'locks', 'outbox', 'receipts']) assert.deepEqual(after[key], before[key]);
        assert.equal(after.audits.length, 1); assert.equal(after.audits[0].action, 'BOOKING_CUSTOMER_HIDDEN');
        status(await item(b.id), 404);
        const mine = status(await http('/bookings?page=1&pageSize=100'), 200); assert.ok(!mine.items.some(row => row.id === String(b.id)));
        const history = status(await http('/bookings?view=HISTORY&page=1&pageSize=100'), 200); assert.ok(!history.items.some(row => row.id === String(b.id)));
        status(await item(b.id, 'owner'), 200); status(await item(b.id, 'staff'), 200); status(await item(b.id, 'admin'), 200);
        const merchant = status(await http('/merchant/shops/' + shop.id + '/bookings?page=1&pageSize=100', 'owner'), 200);
        assert.ok(merchant.items.some(row => row.id === String(b.id)));
        const merchantHistory = status(await http('/merchant/shops/' + shop.id + '/bookings?view=HISTORY&page=1&pageSize=100', 'owner'), 200);
        assert.ok(merchantHistory.items.some(row => row.id === String(b.id)));
        status(await http('/bookings/' + b.id + '/settlements', 'owner'), 200);
        status(await http('/bookings/' + b.id + '/settlements', 'staff'), 200);
        const staffList = status(await http('/merchant/shops/' + shop.id + '/bookings?view=HISTORY&page=1&pageSize=100', 'staff'), 200);
        assert.ok(staffList.items.some(row => row.id === String(b.id)));
        status(await http('/admin/bookings/' + b.id, 'admin'), 200);
        const operations = status(await http('/admin/bookings?bookingNo=' + encodeURIComponent(b.bookingNo), 'admin'), 200);
        assert.ok(operations.items.some(row => row.id === String(b.id)));
      });
      await t.test('other customer, paid history and global deletion are protected without writes', async () => {
        for (const [patch, actor, expected] of [[{}, 'other', 404], [{ paidCents: 4000, paymentStatus: 'PAID' }, 'customer', 400], [{ deletedAt: new Date() }, 'customer', 404]]) {
          const b = await fixture(patch), before = await snapshot(b.id); status(await hide(b.id, actor), expected); assert.deepEqual(await snapshot(b.id), before);
        }
      });
      await t.test('two real shop-lock waiters: receipt vs hiding cannot conceal a completed receivable', async () => {
        const b = await fixture(), ready = deferred(), release = deferred();
        const held = blocker.$transaction(async tx => { await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${shop.id} FOR UPDATE`); ready.resolve(); await release.promise; }, { timeout: 15000 });
        await within(ready.promise, 3000, 'BLOCKER_NOT_READY');
        const attempt = { shopId: shop.id, expected: 2, attempts: [], ready: deferred() }; observer.current = attempt;
        const operations = Promise.all([hide(b.id), collect(b.id, 'visibility-race-receipt')]);
        try { await within(attempt.ready.promise, 3000, 'TWO_REQUESTS_NOT_STARTED'); await waitForShopLockQueries(reader, attempt.attempts.map(row => row.connectionId)); }
        finally { release.resolve(); await held; observer.current = null; }
        const [hidden, collected] = await operations; status(hidden, 400); status(collected, 201);
        const saved = await snapshot(b.id); assert.equal(saved.booking[0].customer_hidden_at, null); assert.equal(saved.booking[0].paid_cents, 4000);
        assert.equal(saved.entries.length, 1); assert.equal(saved.audits.filter(row => row.action === 'BOOKING_CUSTOMER_HIDDEN').length, 0);
      });
      await t.test('refund cancellation adds independently keyed customer/shop EMAIL; replay adds nothing', async () => {
        const firstCustomer = await db.user.create({ data: { role: 'CUSTOMER', name: 'First synthetic booking customer',
          email: prefix + '.first@example.invalid', emailVerifiedAt: new Date() } });
        assert.equal(await reader.booking.count({ where: { userId: firstCustomer.id } }), 0);
        const b = await fixture({ status: 'CONFIRMED', userId: firstCustomer.id, contactEmail: firstCustomer.email, contactEmailVerifiedAt: firstCustomer.emailVerifiedAt });
        status(await collect(b.id, 'email-positive-receipt'), 201);
        status(await refund(b.id, 'email-positive-refund'), 201); const first = await snapshot(b.id);
        assert.equal(first.booking[0].status, 'CANCELLED'); assert.equal(first.booking[0].refunded_cents, 4000);
        const emails = first.outbox.filter(row => row.topic === 'BOOKING_CANCELLED' && row.channel === 'EMAIL');
        assert.equal(emails.length, 2); assert.ok(emails.every(row => row.status === 'PENDING'));
        assert.deepEqual(emails.map(row => row.event_key).sort(), ['booking:' + b.id + ':cancelled', 'booking:' + b.id + ':cancelled:shop']);
        assert.equal(first.outbox.filter(row => row.topic === 'REFUND_PROCESSED').length, 3);
        status(await refund(b.id, 'email-positive-refund'), 201); assert.deepEqual(await snapshot(b.id), first);
      });
      await t.test('completed refund sends no cancellation and retains active cleanup; guest/email eligibility remain enforced', async () => {
        const complete = await fixture(); status(await collect(complete.id, 'complete-receipt'), 201);
        const locks = (await snapshot(complete.id)).locks; status(await refund(complete.id, 'complete-refund'), 201);
        const done = await snapshot(complete.id); assert.equal(done.booking[0].status, 'COMPLETED'); assert.deepEqual(done.locks, locks);
        assert.equal(done.outbox.filter(row => row.topic === 'BOOKING_CANCELLED').length, 0);
        const guest = await fixture({ status: 'CONFIRMED', userId: null, bookingSource: 'ASSISTED_GUEST', assistedById: users.owner.id,
          guestSource: 'PHONE', contactSource: 'GUEST_ASSISTED', contactEmailVerifiedAt: null });
        status(await collect(guest.id, 'guest-receipt'), 201); status(await refund(guest.id, 'guest-refund'), 201);
        const guestEmail = (await snapshot(guest.id)).outbox.filter(row => row.topic === 'BOOKING_CANCELLED' && row.channel === 'EMAIL');
        assert.equal(guestEmail.length, 1); assert.equal(guestEmail[0].event_key, 'booking:' + guest.id + ':cancelled:shop');
        assert.equal(guestEmail[0].status, 'PENDING');
        const blocked = await fixture({ status: 'CONFIRMED' }); status(await collect(blocked.id, 'blocked-receipt'), 201);
        await db.user.update({ where: { id: users.customer.id }, data: { emailVerifiedAt: null } });
        try { status(await refund(blocked.id, 'blocked-refund'), 201); }
        finally { await db.user.update({ where: { id: users.customer.id }, data: { emailVerifiedAt: users.customer.emailVerifiedAt } }); }
        const customerEmail = (await snapshot(blocked.id)).outbox.find(row => row.event_key === 'booking:' + blocked.id + ':cancelled' && row.channel === 'EMAIL');
        assert.equal(customerEmail.status, 'BLOCKED'); assert.equal(customerEmail.last_error_code, 'ORDER_EMAIL_RECIPIENT_UNAVAILABLE');
        const missingStore = await fixture({ status: 'CONFIRMED' }); status(await collect(missingStore.id, 'store-blocked-receipt'), 201);
        await db.shopOrderEmailSetting.update({ where: { shopId: shop.id }, data: { recipientVerifiedAt: null } });
        try { status(await refund(missingStore.id, 'store-blocked-refund'), 201); }
        finally { await db.shopOrderEmailSetting.update({ where: { shopId: shop.id }, data: { recipientVerifiedAt: new Date() } }); }
        const storeEmail = (await snapshot(missingStore.id)).outbox.find(row => row.event_key === 'booking:' + missingStore.id + ':cancelled:shop' && row.channel === 'EMAIL');
        assert.equal(storeEmail.status, 'BLOCKED'); assert.equal(storeEmail.last_error_code, 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE');
      });
      await t.test('real SQL second-email failure rolls back ledger, audit, outbox, receipts and resources; exact retry recovers', async () => {
        const b = await fixture({ status: 'CONFIRMED' }); status(await collect(b.id, 'rollback-receipt'), 201);
        const before = await snapshot(b.id);
        faultFixtureDdl(databaseUrl, `DELIMITER $$\nCREATE TRIGGER next04_email_failure BEFORE INSERT ON notification_outbox FOR EACH ROW BEGIN IF NEW.booking_id=${b.id} AND NEW.channel='EMAIL' AND NEW.event_key='booking:${b.id}:cancelled:shop' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_NEXT04_STORE_EMAIL_FAILURE'; END IF; END$$\nDELIMITER ;\n`);
        try { status(await refund(b.id, 'rollback-refund'), 500); assert.deepEqual(await snapshot(b.id), before); }
        finally { faultFixtureDdl(databaseUrl, 'DROP TRIGGER next04_email_failure;\n'); }
        status(await refund(b.id, 'rollback-refund'), 201);
        const after = await snapshot(b.id); assert.equal(after.entries.length, 2); assert.equal(after.audits.length, 2);
        assert.equal(after.outbox.filter(row => row.topic === 'BOOKING_CANCELLED' && row.channel === 'EMAIL').length, 2);
      });
      t.diagnostic('NEXT01_NEXT04_HTTP_SQL_EXECUTED migrations=' + migrationCount + '; all identities and records synthetic; no external delivery');
    } finally { globalThis.fetch = originalFetch; if (app) await app.close(); await reader.$disconnect(); await blocker.$disconnect(); }
  });
});
