/* OPS-02 real SQL / real child processes / loopback-only HTTP provider.
 * node --test --test-concurrency=1 test/notification-worker-process.integration.cjs
 * TEST_DATABASE_URL must pass booking-resources.support.cjs's unchanged guard.
 * Each invocation migrates and finally drops only its own random database.
 * The production NotificationWorker, OrderEmailDelivery and Resend response
 * parser execute unchanged. A fetch boundary maps only the fixed Resend URL to
 * this suite's loopback HTTP server; no external connection is permitted.
 * IPC barriers sit before provider dispatch or after provider response. They
 * never fake claim SQL, finish SQL, SQL return values or transaction commits.
 */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { fork, spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { installTestEnvironment, withFreshDatabase, isolatedTarget, deferred, within, waitForShopLockQueries } = require('./booking-resources.support.cjs');

function configure() {
  installTestEnvironment();
  Object.assign(process.env, { ORDER_EMAIL_ENABLED: 'true', ORDER_EMAIL_PROVIDER: 'resend',
    ORDER_EMAIL_API_KEY: 'SYNTHETIC-NOT-A-PROVIDER-CREDENTIAL', ORDER_EMAIL_FROM: 'orders@example.invalid',
    ORDER_EMAIL_LOCAL_CAPTURE: 'false', AUTH_EMAIL_API_KEY: '', AUTH_EMAIL_PROVIDER: '',
    NOTIFICATION_WORKER_ENABLED: 'false', MEDIA_STORAGE_DRIVER: 'disabled' });
  require('ts-node/register/transpile-only'); require('reflect-metadata');
}

async function childMain() {
  configure();
  const target = isolatedTarget(process.env.DATABASE_URL);
  assert.match(target.pathname, /^\/mj2_test_booking_resources_[a-f0-9]{16}$/);
  target.searchParams.set('connection_limit', '1');
  const provider = new URL(process.env.OPS02_PROVIDER_ORIGIN);
  assert.equal(provider.protocol, 'http:'); assert.equal(provider.hostname, '127.0.0.1');
  assert.ok(provider.port && provider.pathname === '/');
  const { PrismaClient } = require('@prisma/client');
  const { NotificationWorker } = require('../src/modules/notifications/notification-worker.service');
  const { OrderEmailDelivery, resendOrderEmailTransport } = require('../src/modules/notifications/order-email-delivery');
  const db = new PrismaClient({ datasources: { db: { url: target.href } } });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    assert.equal(String(input), 'https://api.resend.com/emails', 'Only the fixed production provider boundary is mapped');
    return nativeFetch(new URL('/emails', provider).href, options);
  };
  let mode = 'NORMAL', release = null, command = null, busy = false;
  const signal = type => process.send?.({ type, command, pid: process.pid });
  const transport = async (message, key, abortSignal) => {
    if (mode === 'BEFORE_PROVIDER') { const gate = deferred(); release = gate.resolve; signal('before-provider'); await gate.promise; }
    const result = await resendOrderEmailTransport(message, key, abortSignal);
    if (mode === 'AFTER_PROVIDER') { const gate = deferred(); release = gate.resolve; signal('after-provider'); await gate.promise; }
    return result;
  };
  const worker = new NotificationWorker(db, { config: () => ({ enabled: false }), sendToUser: () => { throw Error('PUSH_FORBIDDEN'); } }, new OrderEmailDelivery(transport));
  const [{ id: connectionId }] = await db.$queryRawUnsafe('SELECT CONNECTION_ID() AS id');
  process.send?.({ type: 'ready', pid: process.pid, connectionId: Number(connectionId) });
  process.on('message', async value => {
    if (value?.type === 'release') { release?.(); release = null; return; }
    if (value?.type === 'stop') {
      worker.onModuleDestroy(); await db.$disconnect(); signal('stopped'); process.disconnect(); return;
    }
    if (value?.type !== 'run') return;
    if (busy) { signal('unexpected-concurrent-command'); return; }
    busy = true; command = value.command; mode = value.mode || 'NORMAL';
    try { await worker.runOnce(); signal('done'); }
    catch { signal('run-error'); }
    finally { busy = false; }
  });
  process.on('disconnect', () => process.exit(0));
}

if (process.argv.includes('--worker-child')) {
  childMain().catch(() => { process.send?.({ type: 'fatal', pid: process.pid }); process.exit(1); });
} else {
  configure();
  const { test } = require('node:test');
  const { PrismaClient } = require('@prisma/client');
  const { bookingOrderEmailSnapshot } = require('../src/common/booking-order-email');
  const { NotificationInboxService } = require('../src/modules/notifications/notification-inbox.service');
  const { orderEmailTaskStatus } = require('../src/modules/notifications/order-email-status');

  test('OPS-02 two real worker processes preserve SQL claims and ambiguous-provider boundaries', { timeout: 180000 }, async t => {
    await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
      const reader = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const evidence = { scope: 'SYNTHETIC_SQL_AND_LOOPBACK_PROVIDER_ONLY', migrationCount, startedAt: new Date().toISOString(),
        productionWorkerAndTransport: true, realExternalRequests: 0, events: [], provider: [], checks: [] };
      const sockets = new Set(), children = new Set(), requests = [], plans = new Map();
      let serial = 0;
      const record = (type, value = {}) => evidence.events.push({ at: new Date().toISOString(), type, ...value });
      const provider = createServer(async (request, response) => {
        try {
          assert.equal(request.method, 'POST'); assert.equal(request.url, '/emails');
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const bytes = Buffer.concat(chunks), body = JSON.parse(bytes.toString('utf8'));
          assert.equal(body.from, 'orders@example.invalid'); assert.equal(body.to.length, 1);
          assert.match(body.to[0], /@example\.invalid$/); assert.match(request.headers['idempotency-key'], /^booking-order\/[a-f0-9-]{36}$/);
          assert.equal(request.headers.authorization, 'Bearer SYNTHETIC-NOT-A-PROVIDER-CREDENTIAL');
          const key = request.headers['idempotency-key'], id = key.slice('booking-order/'.length);
          const plan = plans.get(id) || ['ACCEPT'], mode = plan.length > 1 ? plan.shift() : plan[0];
          const item = { id, key, mode, bodySha256: createHash('sha256').update(bytes).digest('hex'), response, accepted: false };
          requests.push(item); record('provider-request', { outboxId: id, key, mode });
          if (mode === 'HOLD' || mode === 'TIMEOUT') return;
          if (mode === '429') { response.writeHead(429).end('{}'); return; }
          if (mode === '503') { response.writeHead(503).end('{}'); return; }
          if (mode === 'MALFORMED') { response.writeHead(200).end('{"id":42}'); return; }
          if (mode === '422') { response.writeHead(422).end('{}'); return; }
          item.accepted = true; response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'fake-' + id }));
        } catch { response.writeHead(500).end('{}'); record('provider-fixture-error'); }
      });
      provider.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
      await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
      const providerOrigin = 'http://127.0.0.1:' + provider.address().port;
      const spawnWorker = async label => {
        const events = [], waiters = new Set(), exited = deferred();
        const child = fork(__filename, ['--worker-child'], { cwd: path.resolve(__dirname, '..'), execArgv: [], silent: true,
          env: { ...process.env, DATABASE_URL: databaseUrl, OPS02_PROVIDER_ORIGIN: providerOrigin } });
        children.add(child);
        child.stdout.on('data', () => undefined); child.stderr.on('data', () => undefined);
        child.on('message', event => {
          events.push(event); record('worker-' + event.type, { label, pid: event.pid, command: event.command ?? null, ...(event.connectionId ? { connectionId: event.connectionId } : {}) });
          for (const waiter of [...waiters]) if (waiter.matches(event)) { waiters.delete(waiter); waiter.resolve(event); }
        });
        child.on('exit', (code, signal) => { record('worker-exit', { label, pid: child.pid, code, signal }); exited.resolve(); });
        const wait = (type, command) => {
          const matches = event => event.type === type && (command === undefined || event.command === command);
          const existing = events.find(matches); if (existing) return Promise.resolve(existing);
          return within(new Promise(resolve => waiters.add({ matches, resolve })), 20000, 'CHILD_' + type.toUpperCase() + '_NOT_OBSERVED');
        };
        const ready = await wait('ready');
        return { pid: child.pid, connectionId: ready.connectionId, wait,
          run(mode = 'NORMAL') { const command = ++serial; child.send({ type: 'run', mode, command }); return { command, done: wait('done', command) }; },
          release() { child.send({ type: 'release' }); },
          async kill() { child.kill(); await within(exited.promise, 5000, 'WORKER_DID_NOT_EXIT'); children.delete(child); },
          async stop() { if (child.exitCode !== null) { children.delete(child); return; } child.send({ type: 'stop' }); await within(exited.promise, 5000, 'WORKER_STOP_DID_NOT_EXIT'); children.delete(child); },
        };
      };
      const sql = async id => {
        const rows = await reader.$queryRaw`SELECT id,status,attempts,retry_count AS retryCount,last_error_code AS lastErrorCode,accepted_count AS acceptedCount,lease_token AS leaseToken,lease_until AS leaseUntil,run_at AS runAt,finished_at AS finishedAt FROM notification_outbox WHERE id=${id}`;
        assert.equal(rows.length, 1); return rows[0];
      };
      const expectState = async (id, expected) => {
        const row = await sql(id); for (const [key, value] of Object.entries(expected)) assert.equal(row[key], value, key);
        record('independent-sql-state', { outboxId: id, status: row.status, attempts: row.attempts, lastErrorCode: row.lastErrorCode,
          acceptedCount: row.acceptedCount, leaseCleared: row.leaseToken === null && row.leaseUntil === null, finished: row.finishedAt !== null });
        return row;
      };
      const providerCount = id => requests.filter(value => value.id === id).length;
      const awaitRequests = async (id, count) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) { if (providerCount(id) === count) return requests.filter(value => value.id === id); await new Promise(resolve => setTimeout(resolve, 10)); }
        throw Error('PROVIDER_REQUEST_NOT_OBSERVED');
      };
      const expireLease = async id => {
        assert.equal(await db.$executeRaw`UPDATE notification_outbox SET lease_until=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=${id} AND status='PROCESSING'`, 1);
        record('fixture-clock-advanced-by-expiring-own-row', { outboxId: id, productionLeaseSeconds: 120 });
      };
      let user, shop, service;
      const fixture = async (mode = ['ACCEPT'], channel = 'EMAIL') => {
        const id = randomUUID(), n = ++serial, start = new Date('2031-01-02T18:00:00.000Z'), end = new Date('2031-01-02T18:30:00.000Z');
        const booking = await db.booking.create({ data: { bookingNo: 'WORK-' + n + '-' + randomBytes(4).toString('hex'), userId: user.id, shopId: shop.id,
          serviceId: service.id, bookingDate: new Date('2031-01-02T00:00:00.000Z'), bookingTimezone: 'America/Los_Angeles',
          startTime: start, endTime: end, durationMin: 30, priceCents: 4000, totalCents: 4000, paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', status: 'PENDING' } });
        const snapshot = bookingOrderEmailSnapshot({ ...booking, shop, items: [{ serviceNameSnapshot: 'Synthetic test service', variantNameSnapshot: null,
          participantIndex: 1, sequence: 1, durationMin: 30, durationKindSnapshot: 'TIMED' }], addOns: [] }, 'BOOKING_CREATED');
        assert.ok(snapshot);
        await db.notificationOutbox.create({ data: { id, eventKey: 'worker-process:' + id, contentHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
          userId: user.id, bookingId: booking.id, topic: 'BOOKING_CREATED', resourceType: 'BOOKING', resourceId: String(booking.id), channel,
          runAt: new Date(Date.now() - 1000), dataJson: channel === 'EMAIL' ? snapshot : {} } });
        plans.set(id, [...mode]); return { id, booking };
      };
      try {
        const suffix = randomBytes(5).toString('hex');
        user = await db.user.create({ data: { role: 'CUSTOMER', name: 'Synthetic worker customer', email: 'worker-' + suffix + '@example.invalid', emailVerifiedAt: new Date() } });
        const owner = await db.user.create({ data: { role: 'MERCHANT', name: 'Synthetic worker owner' } });
        const admin = await db.user.create({ data: { role: 'ADMIN', name: 'Synthetic worker operator' } });
        shop = await db.shop.create({ data: { ownerId: owner.id, shortName: 'worker-' + suffix, name: 'Synthetic worker store', phone: '+12025550199', address: '1 Synthetic Way',
          city: 'Seattle', state: 'WA', zipCode: '98144', latitude: 47.6, longitude: -122.3, category: 'MIXED', timezone: 'America/Los_Angeles', businessHours: {} } });
        service = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic test service', category: 'MASSAGE', durationMin: 30, priceCents: 4000 } });
        const [{ id: readerConnection }] = await reader.$queryRawUnsafe('SELECT CONNECTION_ID() AS id');
        let a = await spawnWorker('A'), b = await spawnWorker('B');
        assert.notEqual(a.pid, b.pid); assert.notEqual(a.connectionId, b.connectionId);
        assert.notEqual(Number(readerConnection), a.connectionId); assert.notEqual(Number(readerConnection), b.connectionId);
        evidence.initialWorkerPids = [a.pid, b.pid]; evidence.independentSqlConnectionId = Number(readerConnection);

        await t.test('two workers contend for one EMAIL: one durable claim and one provider request', async () => {
          const { id } = await fixture(['HOLD']);
          const locked = deferred(), unlock = deferred();
          const blocker = db.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM shops WHERE id=${shop.id} FOR UPDATE`;
            locked.resolve(); await unlock.promise;
          }, { timeout: 15000 });
          await locked.promise; const ra = a.run(), rb = b.run();
          try { await waitForShopLockQueries(reader, [a.connectionId, b.connectionId]); record('two-real-worker-shop-lock-queries-observed'); }
          finally { unlock.resolve(); await blocker; }
          const [request] = await awaitRequests(id, 1);
          await expectState(id, { status: 'PROCESSING', attempts: 1, acceptedCount: 0 });
          request.accepted = true; request.response.writeHead(200).end(JSON.stringify({ id: 'fake-' + id }));
          await Promise.all([ra.done, rb.done]);
          await expectState(id, { status: 'ACCEPTED', attempts: 1, acceptedCount: 1, leaseToken: null, leaseUntil: null });
          assert.equal(providerCount(id), 1); evidence.checks.push('DOUBLE_PROCESS_CLAIM_SINGLE_SEND');
        });
        await t.test('crash after committed claim before dispatch: expiry is visible UNKNOWN without a send', async () => {
          const { id } = await fixture(); const run = a.run('BEFORE_PROVIDER'); run.done.catch(() => undefined);
          await a.wait('before-provider', run.command); await expectState(id, { status: 'PROCESSING', attempts: 1 }); assert.equal(providerCount(id), 0);
          await a.kill(); await expireLease(id); await b.run().done;
          await expectState(id, { status: 'FAILED', attempts: 1, lastErrorCode: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN', acceptedCount: 0, leaseToken: null });
          await b.run().done; assert.equal(providerCount(id), 0); a = await spawnWorker('A-replacement');
          evidence.checks.push('CRASH_BEFORE_SEND_CONSERVATIVE_UNKNOWN');
        });
        await t.test('provider accepted then process crashed: no automatic second external attempt', async () => {
          const { id } = await fixture(); const run = a.run('AFTER_PROVIDER'); run.done.catch(() => undefined);
          await a.wait('after-provider', run.command); await expectState(id, { status: 'PROCESSING', attempts: 1 }); assert.equal(providerCount(id), 1); assert.equal(requests.find(value => value.id === id).accepted, true);
          await a.kill(); await expireLease(id); await b.run().done; await b.run().done;
          await expectState(id, { status: 'FAILED', attempts: 1, lastErrorCode: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN', acceptedCount: 0, leaseToken: null });
          assert.equal(providerCount(id), 1); a = await spawnWorker('A-second-replacement'); evidence.checks.push('CRASH_AFTER_PROVIDER_ACCEPTANCE_NO_REPLAY');
        });
        await t.test('late worker cannot overwrite UNKNOWN after another worker expires its lease', async () => {
          const { id } = await fixture(['HOLD']); const run = a.run(); const [request] = await awaitRequests(id, 1);
          await expireLease(id); await b.run().done;
          const unknown = await expectState(id, { status: 'FAILED', attempts: 1, lastErrorCode: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN', leaseToken: null });
          request.accepted = true; request.response.writeHead(200).end(JSON.stringify({ id: 'fake-' + id })); await run.done;
          assert.deepEqual(await sql(id), unknown, 'The stale lease holder cannot finalize or renew the recovered task');
          assert.equal(providerCount(id), 1); evidence.checks.push('EXPIRED_LEASE_FENCES_LATE_FINISH');
        });
        await t.test('429 alone schedules bounded retry; second worker uses identical stable provider key', async () => {
          const { id } = await fixture(['429', 'ACCEPT']); await a.run().done;
          const limited = await expectState(id, { status: 'PENDING', attempts: 1, lastErrorCode: 'ORDER_EMAIL_RATE_LIMITED', leaseToken: null, finishedAt: null });
          assert.ok(limited.runAt > new Date()); await b.run().done; assert.equal(providerCount(id), 1);
          await db.notificationOutbox.update({ where: { id }, data: { runAt: new Date(Date.now() - 1000) } });
          await b.run().done; await expectState(id, { status: 'ACCEPTED', attempts: 2, acceptedCount: 1, lastErrorCode: null });
          const pair = requests.filter(value => value.id === id); assert.equal(pair.length, 2); assert.equal(pair[0].key, pair[1].key); assert.equal(pair[0].bodySha256, pair[1].bodySha256);
          evidence.checks.push('RATE_LIMIT_RETRY_STABLE_KEY_AND_PAYLOAD');
        });
        for (const mode of ['503', 'MALFORMED', 'TIMEOUT']) await t.test(mode + ' is terminal acceptance UNKNOWN and cannot be manually retried', async () => {
          const { id } = await fixture([mode]); await a.run().done;
          const row = await expectState(id, { status: 'FAILED', attempts: 1, lastErrorCode: 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN', acceptedCount: 0, leaseToken: null });
          assert.equal(orderEmailTaskStatus(row, true), 'ACCEPTANCE_UNKNOWN');
          const inbox = new NotificationInboxService(reader);
          const tasks = await inbox.tasks({ id: String(admin.id), role: 'ADMIN' }, { page: 1, pageSize: 100, channel: 'EMAIL' });
          const item = tasks.items.find(item => item.id === id); assert.ok(item); assert.equal(item.canRetry, false); assert.equal(item.lastErrorCode, 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN');
          assert.equal(Object.hasOwn(item, 'dataJson'), false, 'Operator view does not expose raw event/customer payload');
          const audits = await reader.auditLog.count(); await assert.rejects(() => inbox.retry({ id: String(admin.id), role: 'ADMIN' }, id, 'Synthetic unknown receipt check'), error => error.getStatus?.() === 409);
          assert.equal(await reader.auditLog.count(), audits); assert.deepEqual(await sql(id), row);
          await b.run().done; assert.equal(providerCount(id), 1); evidence.checks.push(mode + '_UNKNOWN_VISIBLE_AND_NO_MANUAL_OR_AUTO_REPLAY');
        });
        await t.test('explicit provider rejection stays visible BLOCKED without automatic retry', async () => {
          const { id } = await fixture(['422']); await a.run().done; await b.run().done;
          await expectState(id, { status: 'BLOCKED', attempts: 1, lastErrorCode: 'ORDER_EMAIL_PROVIDER_REJECTED', acceptedCount: 0 });
          assert.equal(providerCount(id), 1); evidence.checks.push('PROVIDER_REJECTION_BLOCKED');
        });
        await t.test('two worker processes publish IN_APP tasks exactly once per durable key', async () => {
          const jobs = await Promise.all(Array.from({ length: 12 }, () => fixture(['ACCEPT'], 'IN_APP')));
          await Promise.all([a.run().done, b.run().done]);
          for (const { id } of jobs) { await expectState(id, { status: 'PUBLISHED', attempts: 1 }); assert.equal(await reader.userNotification.count({ where: { outboxId: id } }), 1); assert.equal(providerCount(id), 0); }
          await Promise.all([a.run().done, b.run().done]); assert.equal(await reader.userNotification.count(), jobs.length);
          evidence.checks.push('IN_APP_UNIQUE_DURABLE_PUBLICATION');
        });
        await t.test('read-only queue monitor exposes real overdue, failure and UNKNOWN counts with an explicit local owner', async () => {
          const overdue = await fixture(['ACCEPT'], 'IN_APP'), future = await fixture(['ACCEPT'], 'IN_APP');
          await db.notificationOutbox.update({ where: { id: overdue.id }, data: { runAt: new Date(Date.now() - 600000) } });
          await db.notificationOutbox.update({ where: { id: future.id }, data: { runAt: new Date(Date.now() + 600000) } });
          const before = await reader.notificationOutbox.findMany({ orderBy: { id: 'asc' } });
          const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/notification-queue-health.cjs')], {
            cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 15000, windowsHide: true,
            env: { ...process.env, DATABASE_URL: databaseUrl, NOTIFICATION_ALERT_OWNER: 'local-qa-operator', NOTIFICATION_ALERT_THRESHOLDS: JSON.stringify({ dueBacklog: 1 }) },
          });
          assert.equal(cli.status, 2, 'Observed queue anomalies must set the monitor attention exit code');
          const monitor = JSON.parse(cli.stdout); assert.equal(monitor.ownerLabel, 'local-qa-operator'); assert.equal(monitor.readOnly, true);
          assert.equal(monitor.counts.pending, 2); assert.equal(monitor.counts.due, 1); assert.ok(monitor.counts.oldestDueSeconds >= 600);
          assert.equal(monitor.counts.acceptanceUnknown, 6); assert.equal(monitor.counts.failed, 6); assert.equal(monitor.counts.blocked, 1);
          for (const code of ['NOTIFICATION_DUE_BACKLOG', 'NOTIFICATION_OLDEST_DUE_TOO_OLD', 'NOTIFICATION_FAILED_TASKS', 'NOTIFICATION_ACCEPTANCE_UNKNOWN_REQUIRES_PROVIDER_REVIEW']) assert.ok(monitor.alerts.some(alert => alert.code === code));
          assert.equal(monitor.actualDeliveryConfirmed, false); assert.deepEqual(await reader.notificationOutbox.findMany({ orderBy: { id: 'asc' } }), before);
          const { notificationQueueHealth } = require('../scripts/lib/notification-queue-health.cjs');
          const unassigned = await notificationQueueHealth(reader); assert.ok(unassigned.alerts.some(alert => alert.code === 'NOTIFICATION_ALERT_OWNER_UNASSIGNED'));
          evidence.queueMonitor = monitor; evidence.checks.push('READ_ONLY_QUEUE_MONITOR_COUNTS_THRESHOLDS_AND_OWNER');
        });
        await a.stop(); await b.stop();
        assert.equal(children.size, 0); assert.equal(evidence.checks.length, 11, 'Every business fault scenario must finish before a success receipt'); evidence.passed = true;
      } finally {
        for (const child of children) { child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); }
        for (const socket of sockets) socket.destroy(); await new Promise(resolve => provider.close(resolve));
        await reader.$disconnect();
        evidence.provider = requests.map(({ id, key, mode, bodySha256, accepted }) => ({ outboxId: id, key, mode, bodySha256, accepted }));
        evidence.finishedAt = new Date().toISOString(); evidence.childProcessesStopped = true; evidence.loopbackProviderStopped = true;
        if (process.env.OPS02_PUBLIC_EVIDENCE_FILE) writeFileSync(path.resolve(process.env.OPS02_PUBLIC_EVIDENCE_FILE), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
      }
    });
  });
}
