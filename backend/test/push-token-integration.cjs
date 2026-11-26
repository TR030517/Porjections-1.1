/* node --env-file=.env.test.local --test test/push-token-integration.cjs
 * Existing isolated test database only. All Firebase sends are replaced by an in-process stub.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const target = process.env.TEST_DATABASE_URL;
const parsed = new URL(target || 'invalid:');
if (parsed.protocol !== 'mysql:' || !['127.0.0.1','localhost'].includes(parsed.hostname) || parsed.port !== '3310' || !/^\/mj2_test_[a-zA-Z0-9_]+$/.test(parsed.pathname)) throw new Error('Explicit isolated loopback:3310 mj2_test_* database required');
process.env.DATABASE_URL = target;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('base64url');
process.env.PAYMENT_PROVIDER = 'disabled';
// The unconfigured-delivery scenario checks both notification switches.
process.env.NOTIFICATION_WORKER_ENABLED = 'false';
process.env.ORDER_EMAIL_ENABLED = 'false';
for (const key of ['FCM_ENABLED','FCM_SERVICE_ACCOUNT','FIREBASE_SERVICE_ACCOUNT','FIREBASE_SERVICE_ACCOUNT_PATH','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY']) delete process.env[key];
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ esModuleInterop: true });
require('ts-node/register/transpile-only');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');
const { FcmService } = require('../src/modules/notifications/fcm.service');
const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
const digest = token => createHash('sha256').update(token).digest('hex');
const sid = auth => JSON.parse(Buffer.from(auth.accessToken.split('.')[1], 'base64url').toString('utf8')).sid;

test('persistent device tokens, session lifecycle, and isolated Firebase failures', { timeout: 90000 }, async t => {
  const db = new PrismaClient({ datasources: { db: { url: target } } });
  const prefix = randomUUID().replace(/-/g, '').slice(0, 12), userIds = [];
  const password = randomBytes(24).toString('base64url');
  let app, origin, service, transport = async () => 'synthetic-message-id';
  const sent = [];
  const call = async (path, auth, body, method = body === undefined ? 'GET' : 'POST') => {
    const res = await fetch(`${origin}/api/v1${path}`, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth.accessToken}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const expect = (result, status) => { assert.equal(result.status, status, `Unexpected HTTP status ${result.status}`); return result.json; };
  const device = name => `synthetic-${prefix}-${name}`;
  const register = (auth, token) => call('/notifications/fcm-token', auth, { token });
  const unregister = (auth, token) => call('/notifications/fcm-token', auth, { token }, 'DELETE');
  const exists = token => db.pushDevice.findUnique({ where: { tokenHash: digest(token) } });
  const mock = instance => { instance.isConfigured = true; instance.admin = { messaging: () => ({ send: async message => { assert.equal('topic' in message, false); sent.push(message.token); return transport(message); } }) }; };
  try {
    await db.$connect();
    assert.equal(await db.$queryRaw`SELECT COUNT(*) AS n FROM _prisma_migrations WHERE migration_name = '202610270007_push_devices' AND finished_at IS NOT NULL`.then(rows => Number(rows[0].n)), 1);
    const createUser = async label => { const row = await db.user.create({ data: { phone: `T${prefix}${label}`, email: `${prefix}.${label}@example.invalid`, name: 'Synthetic push test', passwordHash: await hash(password, 10), role: 'CUSTOMER' } }); userIds.push(row.id); return row; };
    const a = await createUser('a'), b = await createUser('b');
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new BigIntInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
    service = app.get(FcmService);
    const login = async user => expect(await call('/auth/password/login', null, { email: user.email, password }), 200);
    let a1 = await login(a), a2 = await login(a), b1 = await login(b);
    await t.test('JWT/session ownership and scalar validation cannot be supplied through the request body', async () => {
      expect(await register(null, device('anonymous')), 401);
      for (const token of [42, {}, null, '', 'has space', '\n', 'x'.repeat(4097)]) expect(await register(a1, token), 400);
      expect(await call('/notifications/fcm-token', a1, { token: device('inject'), userId: b.id.toString() }), 400);
      expect(await call('/notifications/fcm-token', a1, { token: device('inject'), authSessionId: sid(b1) }), 400);
      assert.equal(await db.pushDevice.count({ where: { userId: { in: userIds } } }), 0);
    });
    await t.test('unconfigured delivery is explicitly disabled while registration is persisted for multiple devices', async () => {
      const config = expect(await call('/notifications/config', a1), 200);
      assert.deepEqual({ enabled: config.enabled, provider: config.provider, reason: config.reason }, { enabled: false, provider: 'fcm', reason: 'PUSH_NOT_CONFIGURED' });
      assert.equal(config.inboxEnabled, true);
      assert.equal(config.worker.enabled, false);
      assert.equal(config.worker.smsEnabled, false);
      assert.equal(config.worker.orderEmail.enabled, false);
      const result = expect(await register(a1, device('one')), 201);
      assert.deepEqual(result, { registered: true, status: 'disabled', deliveryEnabled: false, reason: 'PUSH_NOT_CONFIGURED' });
      assert.equal(JSON.stringify(result).includes(device('one')), false);
      expect(await register(a2, device('two')), 201);
      expect(await register(a1, device('one')), 201);
      assert.equal(await db.pushDevice.count({ where: { userId: a.id } }), 2);
      const row = await exists(device('one')); assert.equal(row.userId, a.id); assert.equal(row.authSessionId, sid(a1)); assert.equal(row.tokenHash, digest(device('one')));
      assert.deepEqual(await service.sendToUser(a.id.toString(), 'private', 'private'), { error: 'PUSH_NOT_CONFIGURED' });
    });
    await t.test('new service and database-client instances retain registrations without an in-memory map', async () => {
      const reopened = new PrismaClient({ datasources: { db: { url: target } } });
      try {
        const restarted = new FcmService(reopened); mock(restarted); sent.length = 0;
        assert.deepEqual(await restarted.sendToUser(a.id.toString(), 'private', 'private'), { sent: 2, failed: 0, removed: 0 });
        assert.deepEqual(sent.sort(), [device('one'), device('two')].sort());
      } finally { await reopened.$disconnect(); }
      mock(service);
    });
    await t.test('unregister is session-scoped and a token transfer removes the previous account without exposing ownership', async () => {
      expect(await unregister(a2, device('one')), 200); assert.ok(await exists(device('one')));
      expect(await register(b1, device('one')), 201);
      expect(await unregister(a1, device('one')), 200);
      assert.equal((await exists(device('one'))).userId, b.id);
      sent.length = 0; await service.sendToUser(a.id.toString(), 'private', 'private'); assert.deepEqual(sent, [device('two')]);
      sent.length = 0; await service.sendToUser(b.id.toString(), 'private', 'private'); assert.deepEqual(sent, [device('one')]);
    });
    await t.test('stale invalid-token responses cannot delete a token transferred while a send is in flight', async () => {
      expect(await register(a1, device('race')), 201);
      transport = async message => { if (message.token === device('race')) { expect(await register(b1, message.token), 201); throw Object.assign(new Error('synthetic'), { code: 'messaging/registration-token-not-registered' }); } return 'synthetic'; };
      const result = await service.sendToUser(a.id.toString(), 'private', 'private'); assert.equal(result.removed, 0);
      assert.equal((await exists(device('race'))).userId, b.id);
      transport = async () => 'synthetic';
    });
    await t.test('stale invalid-token responses cannot delete a newly registered version of the same binding', async () => {
      const before = await exists(device('two'));
      transport = async message => { expect(await register(a2, message.token), 201); throw Object.assign(new Error('synthetic'), { code: 'messaging/invalid-registration-token' }); };
      const result = await service.sendToUser(a.id.toString(), 'private', 'private'); assert.equal(result.removed, 0);
      assert.notEqual((await exists(device('two'))).bindingVersion, before.bindingVersion);
      transport = async () => 'synthetic';
    });
    await t.test('permanent token failures are removed, transient or payload failures are retained and not reported as success', async () => {
      for (const code of ['messaging/unavailable','messaging/invalid-argument']) {
        transport = async () => { throw Object.assign(new Error('synthetic'), { code }); };
        const result = await service.sendToUser(a.id.toString(), 'private', 'private');
        assert.deepEqual(result, { sent: 0, failed: 1, removed: 0, error: 'PUSH_DELIVERY_FAILED' }); assert.ok(await exists(device('two')));
      }
      transport = async () => { throw Object.assign(new Error('synthetic'), { code: 'messaging/registration-token-not-registered' }); };
      const result = await service.sendToUser(a.id.toString(), 'private', 'private'); assert.equal(result.removed, 1); assert.equal(await exists(device('two')), null);
      transport = async () => 'synthetic'; expect(await register(a2, device('two')), 201);
    });
    await t.test('refresh atomically moves only its session devices and logout leaves another account and device intact', async () => {
      expect(await register(a1, device('three')), 201);
      const oldSid = sid(a1), refreshed = expect(await call('/auth/refresh', null, { refreshToken: a1.refreshToken }), 200);
      assert.notEqual(sid(refreshed), oldSid); assert.equal((await exists(device('three'))).authSessionId, sid(refreshed));
      assert.equal((await exists(device('one'))).authSessionId, sid(b1));
      expect(await register(a1, device('old-session')), 401);
      expect(await call('/auth/logout', null, { refreshToken: refreshed.refreshToken }), 200);
      assert.equal(await exists(device('three')), null); assert.ok(await exists(device('two'))); assert.equal((await exists(device('one'))).userId, b.id);
      a1 = await login(a);
    });
    await t.test('register racing with refresh either migrates the binding or rejects the revoked old session', async () => {
      const old = a1;
      const results = await Promise.all([register(old, device('refresh-race')), call('/auth/refresh', null, { refreshToken: old.refreshToken })]);
      assert.ok([201,401].includes(results[0].status)); a1 = expect(results[1], 200);
      const row = await exists(device('refresh-race')); if (row) assert.equal(row.authSessionId, sid(a1));
      assert.equal(await db.pushDevice.count({ where: { authSessionId: sid(old) } }), 0);
    });
    await t.test('suspended, revoked, expired and owner-mismatched sessions cannot receive private notifications', async () => {
      const sessionId = sid(b1);
      await db.user.update({ where: { id: b.id }, data: { status: 'SUSPENDED' } });
      sent.length = 0; assert.equal((await service.sendToUser(b.id.toString(), 'private', 'private')).error, 'NO_REGISTERED_DEVICE'); assert.equal(sent.length, 0);
      await db.user.update({ where: { id: b.id }, data: { status: 'ACTIVE' } });
      const original = await db.authSession.findUniqueOrThrow({ where: { id: sessionId } });
      for (const data of [{ revokedAt: new Date() }, { revokedAt: null, expiresAt: new Date(0) }]) {
        await db.authSession.update({ where: { id: sessionId }, data }); sent.length = 0;
        assert.equal((await service.sendToUser(b.id.toString(), 'private', 'private')).error, 'NO_REGISTERED_DEVICE'); assert.equal(sent.length, 0);
      }
      await db.authSession.update({ where: { id: sessionId }, data: { revokedAt: null, expiresAt: original.expiresAt } });
      await db.pushDevice.updateMany({ where: { userId: b.id }, data: { authSessionId: sid(a1) } }); sent.length = 0;
      assert.equal((await service.sendToUser(b.id.toString(), 'private', 'private')).error, 'NO_REGISTERED_DEVICE'); assert.equal(sent.length, 0);
      await db.pushDevice.updateMany({ where: { userId: b.id }, data: { authSessionId: sessionId } });
    });
    await t.test('concurrent token ownership changes preserve a single owner, and device retention is bounded at ten', async () => {
      const results = await Promise.all([register(a1, device('concurrent')), register(b1, device('concurrent'))]); results.forEach(result => expect(result, 201));
      assert.equal(await db.pushDevice.count({ where: { tokenHash: digest(device('concurrent')) } }), 1);
      assert.ok([a.id,b.id].includes((await exists(device('concurrent'))).userId));
      for (let i = 0; i < 12; i++) expect(await register(a1, device(`cap-${i}`)), 201);
      assert.equal(await db.pushDevice.count({ where: { userId: a.id } }), 10); assert.ok(await exists(device('cap-11')));
      const more = await Promise.all(Array.from({ length: 4 }, (_, i) => register(a1, device(`parallel-${i}`)))); more.forEach(result => expect(result, 201));
      assert.equal(await db.pushDevice.count({ where: { userId: a.id } }), 10);
    });
    await t.test('logout racing registration cannot leave a device attached to a revoked session', async () => {
      const current = a1;
      const results = await Promise.all([register(current, device('logout-race')), call('/auth/logout', null, { refreshToken: current.refreshToken })]);
      assert.ok([201,401].includes(results[0].status)); expect(results[1], 200);
      assert.equal(await db.pushDevice.count({ where: { authSessionId: sid(current) } }), 0);
      expect(await unregister(current, device('logout-race')), 401);
    });
  } finally {
    if (app) await app.close();
    // Exact tracked synthetic users only; session and device FK cascades are also verified.
    if (userIds.length) {
      await db.user.deleteMany({ where: { id: { in: userIds }, phone: { startsWith: `T${prefix}` } } });
      assert.equal(await db.pushDevice.count({ where: { userId: { in: userIds } } }), 0);
      assert.equal(await db.authSession.count({ where: { userId: { in: userIds } } }), 0);
      assert.equal(await db.user.count({ where: { id: { in: userIds } } }), 0);
    }
    await db.$disconnect();
  }
});
