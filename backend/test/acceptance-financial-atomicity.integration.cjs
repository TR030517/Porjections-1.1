/* ACCEPT-04: real JWT HTTP, independently read MySQL, real late SQL failures.
 * Run only with TEST_DATABASE_URL on the helper's guarded loopback:3310
 * mj2_test_* target. withFreshDatabase creates/migrates/drops its own random
 * schema; no seed, existing schema reset, live order or external delivery.
 * Requires mysql CLI on PATH and TRIGGER rights in that disposable schema.
 * node --test --test-concurrency=1 test/acceptance-financial-atomicity.integration.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync, mkdtempSync, rmdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { isolatedTarget, installTestEnvironment, withFreshDatabase, observedPrisma, deferred, within, waitForShopLockQueries } = require('./booking-resources.support.cjs');
installTestEnvironment();
Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'false', NOTIFICATION_WORKER_ENABLED: 'false',
  BOOKING_ONLINE_PAYMENT_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled',
  ORDER_EMAIL_API_KEY: '', AUTH_EMAIL_API_KEY: '', ORDER_EMAIL_PROVIDER: '', ORDER_EMAIL_FROM: '', ORDER_EMAIL_LOCAL_CAPTURE: 'false' });
require('ts-node/register/transpile-only');
require('reflect-metadata');

function faultDdl(databaseUrl, sql) {
  const target = isolatedTarget(databaseUrl);
  assert.match(target.pathname, /^\/mj2_test_booking_resources_[a-f0-9]{16}$/);
  const loginDirectory = mkdtempSync(path.join(tmpdir(), 'massajoy-accept04-mysql-'));
  try {
    const result = spawnSync('mysql', ['--no-defaults', '--protocol=TCP', '--host=' + target.hostname, '--port=' + target.port,
      '--user=' + decodeURIComponent(target.username), '--database=' + target.pathname.slice(1), '--batch', '--skip-column-names'],
    { input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, MYSQL_PWD: decodeURIComponent(target.password), MYSQL_TEST_LOGIN_FILE: path.join(loginDirectory, 'no-login-paths.cnf') } });
    // No fallback after an uncertain/nonzero SQL result. Output may contain a
    // private URL, so failures disclose only process metadata and not stderr.
    assert.ok(!result.error && result.status === 0, 'ACCEPT04_REAL_SQL_DDL_FAILED ' + JSON.stringify({ exitCode: result.status, spawnError: result.error?.code ?? null }));
  } finally { rmdirSync(loginDirectory); }
}

test('ACCEPT-04 financial contention and late audit/operation-receipt SQL failure are atomic', { timeout: 240000 }, async t => {
  const files = ['prisma/schema.prisma', 'src/modules/booking/settlement.service.ts', 'src/modules/booking/settlement.rules.ts',
    'src/modules/booking/booking-operation.ts', 'src/modules/booking/booking.controller.ts', 'src/modules/booking/lifecycle.ts',
    'src/common/notification-outbox.ts', 'src/common/shop-access.ts', 'test/booking-resources.support.cjs',
    'test/acceptance-financial-atomicity.integration.cjs'];
  const manifest = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]));
  const sourceSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  if (process.env.ACCEPT04_EXPECTED_SOURCE_SHA256) assert.equal(sourceSha256, process.env.ACCEPT04_EXPECTED_SOURCE_SHA256);
  t.diagnostic('ACCEPT04_SOURCE ' + JSON.stringify({ sourceSha256, files: manifest }));
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
    const users = {}, tokens = {}, commands = new Map(), observer = { current: null };
    let app, origin, shop, service, sequence = 0, receiptLookups = 0, faultPhase = null;
    const observedFailures = [], observedRaces = [];
    const originalFetch = globalThis.fetch;
    const http = async (route, actor, body, key, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(origin + '/api/v1' + route, { method,
        headers: { ...(tokens[actor] ? { Authorization: 'Bearer ' + tokens[actor] } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      let json; try { json = await response.json(); } catch { json = {}; }
      return { status: response.status, json };
    };
    const status = (response, expected) => { assert.equal(response.status, expected, 'Unexpected HTTP status; body omitted'); return response.json; };
    const command = key => {
      if (!commands.has(key)) commands.set(key, { requestKey: key, amountCents: 4000, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic physical transaction already completed' });
      return commands.get(key);
    };
    const act = (kind, booking, actor, key) => http('/bookings/' + booking.id + (kind === 'RECEIPT' ? '/offline-receipts' : '/offline-refunds'), actor, command(key), key);
    const reconcile = (booking, actor, key) => http('/bookings/' + booking.id + '/operations/' + key + '/reconcile', actor, {});
    const snapshot = async booking => {
      const bid = BigInt(booking.id);
      return {
        booking: await reader.$queryRaw(Prisma.sql`SELECT * FROM bookings WHERE id=${bid}`),
        entries: await reader.$queryRaw(Prisma.sql`SELECT * FROM booking_settlement_entries WHERE booking_id=${bid} ORDER BY id`),
        locks: await reader.$queryRaw(Prisma.sql`SELECT * FROM booking_resource_locks WHERE booking_id=${bid} ORDER BY id`),
        outbox: await reader.$queryRaw(Prisma.sql`SELECT * FROM notification_outbox WHERE booking_id=${bid} ORDER BY id`),
        audits: await reader.$queryRaw(Prisma.sql`SELECT * FROM audit_logs WHERE target_type='BOOKING' AND target_id=${bid} ORDER BY id`),
        receipts: await reader.$queryRaw(Prisma.sql`SELECT * FROM booking_operation_receipts WHERE booking_id=${bid} ORDER BY id`),
      };
    };
    const fixture = async () => {
      const n = ++sequence, end = new Date(Date.now() - 60000), start = new Date(+end - 1800000);
      const therapist = await db.therapist.create({ data: { shopId: shop.id, name: 'Synthetic finance therapist ' + n } });
      const booking = await db.booking.create({ data: { bookingNo: 'AC04-' + prefix + '-' + n, userId: users.customer.id, shopId: shop.id, serviceId: service.id,
        therapistId: therapist.id, bookingDate: new Date(start.toISOString().slice(0, 10) + 'T00:00:00Z'), bookingTimezone: 'America/Los_Angeles',
        startTime: start, endTime: end, durationMin: 30, priceCents: 4000, totalCents: 4000,
        paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', status: 'CONFIRMED', bookingSource: 'ONLINE',
        contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactName: 'Synthetic customer', contactPhone: '+12025550101',
        contactEmail: users.customer.email, contactEmailVerifiedAt: users.customer.emailVerifiedAt } });
      const item = await db.bookingItem.create({ data: { bookingId: booking.id, serviceId: service.id, participantIndex: 1,
        serviceNameSnapshot: 'Synthetic service', durationMin: 30, durationKindSnapshot: 'TIMED', priceCentsSnapshot: 4000,
        currency: 'usd', startAtUtc: start, endAtUtc: end, assignedTherapistId: therapist.id, staffBufferMin: 60, roomBufferMin: 0 } });
      await db.bookingResourceLock.create({ data: { bookingId: booking.id, bookingItemId: item.id, shopId: shop.id,
        resourceType: 'THERAPIST', resourceId: therapist.id, startAtUtc: start, endAtUtc: new Date(+end + 3600000) } });
      return booking;
    };
    // Observers only: retain real Prisma transactions, SQL and failures. The
    // wrappers count receipt SELECT calls and record sanitized SQL failure codes.
    const real = observedPrisma(db, observer);
    const monitored = new Proxy(real, { get(target, key) {
      if (key !== '$transaction') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; }
      return async (callback, options) => {
        try {
          return await target.$transaction(typeof callback !== 'function' ? callback : tx => callback(new Proxy(tx, { get(transaction, property) {
            if (property === 'bookingOperationReceipt') return new Proxy(transaction.bookingOperationReceipt, { get(model, operation) {
              const value = Reflect.get(model, operation);
              if (typeof value !== 'function') return value;
              return (...args) => { if (operation === 'findUnique') receiptLookups++; return value.apply(model, args); };
            } });
            const value = Reflect.get(transaction, property); return typeof value === 'function' ? value.bind(transaction) : value;
          } })), options);
        } catch (error) {
          if (faultPhase) observedFailures.push({ phase: faultPhase, code: error.code ?? null,
            realSignal: /SYNTHETIC_AC04_/.test(String(error.message) + JSON.stringify(error.meta ?? {})) });
          throw error;
        }
      };
    } });
    const race = async (kind, b, keys) => {
      const ready = deferred(), release = deferred();
      const held = blocker.$transaction(async tx => { await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${shop.id} FOR UPDATE`); ready.resolve(); await release.promise; }, { timeout: 15000 });
      await within(ready.promise, 3000, 'ACCEPT04_BLOCKER_NOT_READY');
      const attempt = { shopId: shop.id, expected: 2, attempts: [], ready: deferred() }; observer.current = attempt;
      const actors = ['owner', 'staff'];
      const requests = Promise.all(actors.map((actor, i) => act(kind, b, actor, keys[i])));
      try { await within(attempt.ready.promise, 3000, 'ACCEPT04_TWO_REQUESTS_NOT_STARTED'); await waitForShopLockQueries(reader, attempt.attempts.map(row => row.connectionId)); }
      finally { release.resolve(); await held; observer.current = null; }
      const responses = await requests;
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 400]);
      observedRaces.push({ kind, twoDistinctTransactions: new Set(attempt.attempts.map(row => row.connectionId)).size === 2,
        isolationLevels: attempt.attempts.map(row => row.isolationLevel), statuses: responses.map(response => response.status) });
      return { responses, actors, winner: responses.findIndex(response => response.status === 201) };
    };
    const assertSingle = (saved, kind, expectedEntries) => {
      const row = saved.booking[0]; assert.equal(row.paid_cents, 4000); assert.equal(row.refunded_cents, kind === 'REFUND' ? 4000 : 0);
      assert.equal(saved.entries.length, expectedEntries); assert.equal(saved.audits.length, expectedEntries); assert.equal(saved.receipts.length, expectedEntries);
      assert.equal(saved.entries.filter(entry => entry.kind === kind).length, 1);
      assert.ok(saved.receipts.every(receipt => receipt.outcome === 'COMMITTED'));
      const receipts = saved.entries.filter(entry => entry.kind === 'RECEIPT').reduce((sum, entry) => sum + entry.amount_cents, 0);
      const refunds = saved.entries.filter(entry => entry.kind === 'REFUND').reduce((sum, entry) => sum + entry.amount_cents, 0);
      assert.equal(receipts, row.paid_cents); assert.equal(refunds, row.refunded_cents); assert.ok(receipts <= row.total_cents && refunds <= receipts);
    };
    try {
      const passwordHash = await hash(password, 10);
      for (const [name, role] of [['customer', 'CUSTOMER'], ['owner', 'MERCHANT'], ['staff', 'STAFF'], ['readonly', 'STAFF'], ['outsider', 'MERCHANT'], ['admin', 'ADMIN']]) {
        users[name] = await db.user.create({ data: { name: 'Synthetic finance ' + name, role, email: prefix + '.' + name + '@example.invalid', passwordHash,
          ...(role === 'CUSTOMER' ? { emailVerifiedAt: new Date(), phone: '+12025550101' } : {}) } });
      }
      shop = await db.shop.create({ data: { ownerId: users.owner.id, shortName: 'finance-' + prefix, name: 'Synthetic finance store',
        phone: '+12025550110', address: '1 Synthetic Way', city: 'Seattle', state: 'WA', zipCode: '98144', latitude: 47.6, longitude: -122.3,
        category: 'MIXED', status: 'APPROVED', timezone: 'America/Los_Angeles', businessHours: {}, studioProfile: { paymentPolicy: { payAtStoreEnabled: true } } } });
      await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: users.owner.id, createdById: users.admin.id, reason: 'Synthetic independent login' } });
      await db.merchantProfile.create({ data: { shopId: shop.id, userId: users.owner.id } });
      for (const name of ['staff', 'readonly']) await db.shopStaffGrant.create({ data: { shopId: shop.id, userId: users[name].id, createdById: users.owner.id,
        permissions: name === 'staff' ? ['BOOKINGS_READ', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE'] : ['BOOKINGS_READ'] } });
      await db.shopOrderEmailSetting.create({ data: { shopId: shop.id, enabled: true, recipientEmail: prefix + '.store@example.invalid', recipientVerifiedAt: new Date() } });
      service = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic service', category: 'MASSAGE', durationMin: 30, priceCents: 4000 } });
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(monitored)
        .overrideProvider(NotificationService).useValue({ notifyBookingConfirmed: async () => undefined, notifyBookingCancelled: async () => undefined, notifyBookingReminder: async () => undefined }).compile();
      app = module.createNestApplication({ rawBody: true, logger: false }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      globalThis.fetch = (input, options) => { if (new URL(String(input)).origin !== origin) throw Error('EXTERNAL_HTTP_FORBIDDEN'); return originalFetch(input, options); };
      for (const [name, user] of Object.entries(users)) tokens[name] = status(await http(user.role === 'CUSTOMER' ? '/auth/customer/password/login' : '/auth/password/login', '', { email: user.email, password }), 200).accessToken;
      assert.notEqual(tokens.owner, tokens.staff, 'Two distinct authorized sessions are required');

      await t.test('different keys in two real waiting transactions cannot collect over the total; winning replay/recovery is stable', async () => {
        const b = await fixture(), before = await snapshot(b), keys = ['race-receipt-owner', 'race-receipt-staff'];
        const result = await race('RECEIPT', b, keys), saved = await snapshot(b);
        assertSingle(saved, 'RECEIPT', 1); assert.deepEqual(saved.locks, before.locks);
        assert.equal(saved.outbox.length, 3); assert.ok(saved.outbox.every(row => row.topic === 'PAYMENT_RECEIVED'));
        status(await act('RECEIPT', b, result.actors[result.winner], keys[result.winner]), 201); assert.deepEqual(await snapshot(b), saved);
        assert.equal(status(await reconcile(b, result.actors[result.winner], keys[result.winner]), 200).outcome, 'COMMITTED');
        assert.deepEqual(await snapshot(b), saved);
      });
      await t.test('different keys cannot refund twice; one cancellation transaction releases resources and enqueues both eligible emails', async () => {
        const b = await fixture(); status(await act('RECEIPT', b, 'owner', 'refund-race-initial-receipt'), 201);
        const keys = ['race-refund-owner', 'race-refund-staff'], result = await race('REFUND', b, keys), saved = await snapshot(b);
        assertSingle(saved, 'REFUND', 2); assert.equal(saved.booking[0].status, 'CANCELLED'); assert.equal(saved.booking[0].payment_status, 'REFUNDED');
        // Resource history is retained. Released rows must cease occupying the
        // slot; deleting the evidence is neither required nor desirable.
        assert.equal(saved.locks.length, 1); assert.ok(saved.locks.every(row => row.status === 'RELEASED'));
        assert.equal(saved.outbox.filter(row => row.topic === 'REFUND_PROCESSED').length, 3);
        assert.equal(saved.outbox.filter(row => row.topic === 'BOOKING_CANCELLED').length, 5);
        assert.equal(saved.outbox.filter(row => row.topic === 'BOOKING_CANCELLED' && row.channel === 'EMAIL' && row.status === 'PENDING').length, 2);
        status(await act('REFUND', b, result.actors[result.winner], keys[result.winner]), 201); assert.deepEqual(await snapshot(b), saved);
        assert.equal(status(await reconcile(b, result.actors[result.winner], keys[result.winner]), 200).outcome, 'COMMITTED'); assert.deepEqual(await snapshot(b), saved);
      });
      for (const kind of ['RECEIPT', 'REFUND']) for (const phase of ['AUDIT', 'OPERATION_RECEIPT']) {
        await t.test('real late SQL ' + phase + ' failure rolls back ' + kind + ' completely; identical retry and receipt recovery commit once', async () => {
          const b = await fixture(), key = 'fault-' + kind.toLowerCase() + '-' + phase.toLowerCase();
          if (kind === 'REFUND') status(await act('RECEIPT', b, 'owner', key + '-initial'), 201);
          const before = await snapshot(b), table = phase === 'AUDIT' ? 'audit_logs' : 'booking_operation_receipts';
          const condition = phase === 'AUDIT' ? `NEW.target_type='BOOKING' AND NEW.target_id=${b.id} AND NEW.action='OFFLINE_${kind}'` : `NEW.booking_id=${b.id} AND NEW.action='OFFLINE:${kind}'`;
          faultDdl(databaseUrl, `DELIMITER $$\nCREATE TRIGGER accept04_late_failure BEFORE INSERT ON ${table} FOR EACH ROW BEGIN IF ${condition} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_AC04_${kind}_${phase}'; END IF; END$$\nDELIMITER ;\n`);
          const failureCount = observedFailures.length;
          try { faultPhase = kind + ':' + phase; status(await act(kind, b, 'owner', key), 500); assert.deepEqual(await snapshot(b), before); }
          finally { faultPhase = null; faultDdl(databaseUrl, 'DROP TRIGGER accept04_late_failure;\n'); }
          assert.equal(observedFailures.length, failureCount + 1); assert.ok(observedFailures.at(-1).realSignal, 'The actual SQL SIGNAL must be observed, not an unrelated 500');
          status(await act(kind, b, 'owner', key), 201); const saved = await snapshot(b); assertSingle(saved, kind, kind === 'RECEIPT' ? 1 : 2);
          status(await act(kind, b, 'owner', key), 201); assert.deepEqual(await snapshot(b), saved);
          assert.equal(status(await reconcile(b, 'owner', key), 200).outcome, 'COMMITTED'); assert.deepEqual(await snapshot(b), saved);
        });
      }
      await t.test('customer, read-only staff and unrelated merchant cannot mutate or inspect operation receipts; zero SQL writes', async () => {
        const b = await fixture(); status(await act('RECEIPT', b, 'owner', 'denied-fixture-initial'), 201);
        for (const actor of ['customer', 'readonly', 'outsider']) for (const kind of ['RECEIPT', 'REFUND']) {
          const before = await snapshot(b), beforeLookups = receiptLookups;
          status(await act(kind, b, actor, 'denied-' + actor + '-' + kind.toLowerCase()), 404);
          assert.equal(receiptLookups, beforeLookups, 'Authorization must precede receipt lookup'); assert.deepEqual(await snapshot(b), before);
        }
        for (const actor of ['customer', 'outsider']) {
          const before = await snapshot(b), recovered = status(await reconcile(b, actor, 'denied-fixture-initial'), actor === 'customer' ? 200 : 404);
          // Customers may reconcile their own command namespace but cannot read
          // another actor's financial receipt. A NOT_EXECUTED fence is deliberate.
          if (actor === 'customer') {
            assert.equal(recovered.outcome, 'NOT_EXECUTED'); assert.equal(recovered.action, null);
            const after = await snapshot(b); assert.equal(after.receipts.length, before.receipts.length + 1);
            assert.equal(after.receipts.find(row => row.actor_id === users.customer.id).outcome, 'NOT_EXECUTED');
            assert.deepEqual({ ...after, receipts: before.receipts }, before);
          } else assert.deepEqual(await snapshot(b), before);
        }
      });
      t.diagnostic('ACCEPT04_HTTP_SQL_EXECUTED ' + JSON.stringify({ migrationCount, observedRaces, observedFailures, cases: 7, realExternalDelivery: false, syntheticOnly: true }));
      for (const [file, digest] of Object.entries(manifest)) assert.equal(createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', file))).digest('hex'), digest, 'Financial candidate source changed during execution');
    } finally { globalThis.fetch = originalFetch; if (app) await app.close(); await reader.$disconnect(); await blocker.$disconnect(); }
  });
});
