/* Run with: node --env-file=.env.test.local --test test/integration.cjs
 * Uses only an explicitly supplied loopback mj2_test_* database. Never seeds or resets a database.
 * Every row created by this suite is removed by its tracked IDs, preserving unrelated test rows.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash, createHmac } = require('node:crypto');

const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error('TEST_DATABASE_URL is required; no fallback to DATABASE_URL');
const parsed = new URL(target);
if (parsed.protocol !== 'mysql:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '3310' || !/^\/mj2_test_[a-zA-Z0-9_]+$/.test(parsed.pathname)) {
  throw new Error('Tests require a loopback MySQL:3310 database named mj2_test_*');
}
process.env.DATABASE_URL = target;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('base64url');
process.env.PAYMENT_PROVIDER = 'disabled';
// Exercise existing online settlement guards only inside this isolated fixture;
// the application and deployment defaults remain offline / pay at store.
process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true';
process.env.PLATFORM_FEE_BPS = '1000';
process.env.REFUND_POLICY_FULL_HOURS = '24';
process.env.REFUND_POLICY_PARTIAL_PERCENT = '50';
delete process.env.AUTH_LOCAL_OTP;
// Do not initialize external account SDKs from host-machine environment values.
for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'FCM_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT_PATH', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) delete process.env[name];
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ esModuleInterop: true });
require('ts-node/register/transpile-only');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { Prisma, PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const Stripe = require('stripe');
const { AppModule } = require('../src/app.module');
const { PrismaService } = require('../src/prisma/prisma.service');
const { PaymentService } = require('../src/modules/payment/payment.service');
const { UserManageService } = require('../src/modules/admin/user-manage.service');
const { MerchantService } = require('../src/modules/merchant/merchant.service');
const { SquareProvider } = require('../src/modules/payment/square.provider');
const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
const { jwtSecret } = require('../src/modules/auth/security');
const { localInstant } = require('../src/modules/booking/time');
const { observedPrisma, waitForLockQueries, deferred, within } = require('./booking-resources.support.cjs');

test('isolated HTTP and MySQL security integration', { timeout: 120000 }, async t => {
  const db = new PrismaClient({ datasources: { db: { url: target } } });
  const lockObserver = { current: null };
  const prefix = randomUUID().replace(/-/g, '').slice(0, 12);
  const users = [], shops = [], services = [], therapists = [], bookingIds = [], eventIds = [], regionIds = [], couponIds = [], announcementIds = [];
  let app, origin;
  const password = randomBytes(24).toString('base64url');
  const headers = token => token ? { Authorization: `Bearer ${token}` } : {};
  const call = async (path, { token, body, method = body === undefined ? 'GET' : 'POST', cookie, browser = false, extra = {} } = {}) => {
    const res = await fetch(`${origin}/api/v1${path}`, { method, headers: { ...headers(token), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(browser ? { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } : {}), ...extra }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const content = await res.text(); let json; try { json = JSON.parse(content); } catch { json = {}; }
    return { status: res.status, json, text: content, cookie: res.headers.get('set-cookie'), cache: res.headers.get('cache-control') };
  };
  const expect = (result, status) => { assert.equal(result.status, status, `HTTP ${result.status}: ${JSON.stringify(result.json.message || result.json.error || 'unexpected response')}`); return result; };
  const createUser = async role => {
    const user = await db.user.create({ data: { phone: `T${prefix}${users.length}`, email: `${role.toLowerCase()}.${users.length}.${prefix}@example.invalid`, emailVerifiedAt: role === 'CUSTOMER' ? new Date() : null, name: `Test ${role}`, role, passwordHash: await hash(password, 10) } }); users.push(user.id); return user;
  };
  const login = async user => expect(await call('/auth/password/login', { body: { email: user.email, password } }), 200).json;
  const bookingData = (hour = '10:00') => ({ shopId: shops[0].toString(), serviceId: services[0].toString(), therapistId: therapists[0].toString(), date: '2031-01-15', startTime: hour, requestKey: randomUUID(), paymentMode: 'ONLINE' });
  const withBookingContact = async (token, body) => {
    // Keep explicit overrides, including invalid/absent values in rejection cases.
    if (Object.prototype.hasOwnProperty.call(body, 'contact')) return body;
    // Resolve the actual session rather than assuming the primary customer. This
    // also works after refresh/re-login and for the competing attacker account.
    const user = expect(await call('/auth/me', { token }), 200).json;
    assert.equal(user.role, 'CUSTOMER'); assert.equal(user.emailVerified, true);
    assert.ok(users.some(id => id.toString() === user.id), 'Booking contact must belong to a tracked synthetic customer');
    assert.equal(typeof user.email, 'string');
    return { ...body, contact: { name: user.name, phone: '+12025550123', email: user.email } };
  };
  const signed = async (token, body) => {
    const command = await withBookingContact(token, body);
    // Contact is a create-time snapshot; the quote DTO deliberately excludes it.
    const { contact, requestKey, quoteHash, quoteExpiresAt, ...selection } = command;
    const quote = expect(await call('/bookings/quote', { token, body: selection }), 200).json;
    return { ...command, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
  };
  const newBooking = async (token, hour) => {
    const result = expect(await call('/bookings', { token, body: await signed(token, bookingData(hour)) }), 201);
    bookingIds.push(BigInt(result.json.id)); return result.json;
  };
  try {
    await db.$connect();
    const customer = await createUser('CUSTOMER'), attacker = await createUser('CUSTOMER'), merchant = await createUser('MERCHANT'), admin = await createUser('ADMIN'), outsider = await createUser('MERCHANT');
    const hours = Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => [day, { open: '08:00', close: '22:00' }]));
    for (let i = 0; i < 2; i++) {
      const shop = await db.shop.create({ data: { ownerId: merchant.id, shortName: `test-${prefix}-${i}`, name: `Test ${prefix} ${i}`, phone: 'TEST-ONLY', address: 'Test address', city: 'Test', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', status: 'APPROVED', timezone: 'America/New_York', businessHours: hours,
        studioProfile: { features: { onlineBooking: true, reviews: true }, paymentPolicy: { payAtStoreEnabled: i === 0 } } } }); shops.push(shop.id);
      const loginUser = i === 0 ? merchant : await createUser('MERCHANT');
      await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: loginUser.id, createdById: admin.id, reason: 'Synthetic independent login fixture' } });
      if (i > 0) await db.shopAccountGrant.create({ data: { sourceShopId: shops[0], targetShopId: shop.id, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ', 'SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'], createdById: admin.id, updatedById: admin.id, reason: 'Synthetic explicit linked shop fixture' } });
      const service = await db.shopService.create({ data: { shopId: shop.id, name: 'Test massage', category: 'MASSAGE', durationMin: 60, priceCents: 10000 } }); services.push(service.id);
      const therapist = await db.therapist.create({ data: { shopId: shop.id, name: 'Test therapist', therapistServices: { create: { serviceId: service.id } } } }); therapists.push(therapist.id);
      // Reservation resources now require real active wall-clock shifts, even for
      // legacy services that deliberately have no optional variants or room policy.
      await db.therapistShift.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ therapistId: therapist.id, weekday, startMin: 480, endMin: 1320 })) });
    }
    const profile = await db.merchantProfile.create({ data: { userId: merchant.id, shopId: shops[0] } });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(observedPrisma(db, lockObserver)).compile();
    app = module.createNestApplication({ rawBody: true, logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalInterceptors(new BigIntInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
    let customerAuth = await login(customer); const attackerAuth = await login(attacker), merchantAuth = await login(merchant), adminAuth = await login(admin); let outsiderAuth = await login(outsider);

    await t.test('GPS, keyword, category and radius filters bind correctly and hide unpublished shops', async () => {
      await db.shop.update({ where: { id: shops[1] }, data: { latitude: 1.02, longitude: 1.02 } });
      const search = `/shops?lat=1&lng=1&radius=1&keyword=${prefix}&category=MIXED&city=Test&page=1&limit=10`;
      const result = expect(await call(search), 200).json;
      assert.equal(result.total, 1); assert.equal(result.items.length, 1); assert.equal(result.items[0].id, shops[0].toString()); assert.equal(result.items[0].distanceKm, 0);
      const both = expect(await call(search.replace('radius=1', 'radius=10')), 200).json; assert.equal(both.total, 2);
      await db.shop.update({ where: { id: shops[1] }, data: { status: 'PENDING' } });
      expect(await call(`/shops/${shops[1]}`), 404);
      expect(await call(`/shops/${shops[1]}/services`), 404);
      expect(await call(`/shops/${shops[1]}/therapists`), 404);
      await db.shop.update({ where: { id: shops[1] }, data: { status: 'APPROVED' } });
    });

    await t.test('password authentication, role authorization, and disabled identity providers', async () => {
      expect(await call('/auth/password/login', { body: { email: customer.email, password: 'incorrect' } }), 401);
      expect(await call('/auth/me', { token: customerAuth.accessToken }), 200);
      expect(await call('/studio/summary', { token: customerAuth.accessToken }), 403);
      expect(await call('/admin/dashboard/stats', { token: merchantAuth.accessToken }), 403);
      expect(await call('/auth/google', { body: { idToken: 'unverified', challengeId: randomUUID(), email: admin.email } }), 503);
      expect(await call('/auth/send-otp', { body: { phone: customer.phone } }), 503);
      expect(await call('/admin/send-otp', { body: { phone: admin.phone } }), 503);
      assert.equal(await db.user.count({ where: { googleId: { not: null }, id: { in: users } } }), 0);
    });
    await t.test('direct password registration is retired; new customer accounts require email verification', async () => {
      const body = { email: `register.${prefix}@example.invalid`, phone: `+1999${BigInt(`0x${prefix}`).toString().slice(0, 8)}`, name: 'Test registration', password };
      const before = await db.user.count();
      expect(await call('/auth/register', { body }), 410);
      assert.equal(await db.user.count(), before);
      const authConfig = expect(await call('/auth/customer/config'), 200).json;
      assert.equal(authConfig.passwordRegistrationEnabled, false);
    });
    await t.test('HttpOnly cookie rotation is atomic and CSRF is rejected', async () => {
      const browser = expect(await call('/auth/password/login', { browser: true, body: { email: customer.email, password } }), 200);
      assert.match(browser.cookie, /HttpOnly/i); assert.match(browser.cookie, /SameSite=Strict/i); assert.match(browser.cookie, /Path=\/api\/v1\/auth/i); assert.equal(browser.json.refreshToken, undefined); assert.equal(browser.cache, 'no-store');
      const cookie = browser.cookie.split(';')[0];
      expect(await call('/auth/refresh', { cookie, body: {}, extra: { Origin: 'https://untrusted.invalid' } }), 403);
      expect(await call('/auth/refresh', { cookie, body: {} }), 403);
      const results = await Promise.all([call('/auth/refresh', { cookie, method: 'POST', browser: true }), call('/auth/refresh', { cookie, method: 'POST', browser: true })]);
      assert.deepEqual(results.map(x => x.status).sort(), [200, 401]);
      expect(await call('/auth/me', { token: browser.json.accessToken }), 401);
      const rotated = results.find(x => x.status === 200);
      assert.equal(rotated.json.user.id, customer.id.toString()); assert.equal(rotated.json.refreshToken, undefined);
      expect(await call('/auth/logout', { cookie: rotated.cookie.split(';')[0], browser: true, method: 'POST' }), 200);
      expect(await call('/auth/me', { token: rotated.json.accessToken }), 401);
      const hashes = await db.authSession.findMany({ where: { userId: customer.id } });
      assert.ok(hashes.every(x => /^[a-f0-9]{64}$/.test(x.tokenHash)));
    });
    await t.test('suspended accounts cannot authenticate or use existing sessions', async () => {
      await db.user.update({ where: { id: customer.id }, data: { status: 'SUSPENDED' } });
      expect(await call('/auth/me', { token: customerAuth.accessToken }), 401);
      expect(await call('/auth/refresh', { body: { refreshToken: customerAuth.refreshToken } }), 401);
      expect(await call('/auth/password/login', { body: { email: customer.email, password } }), 401);
      await db.user.update({ where: { id: customer.id }, data: { status: 'ACTIVE' } }); customerAuth = await login(customer);
    });
    await t.test('user profile IDOR and role injection are rejected', async () => {
      expect(await call(`/users/${customer.id}`, { token: attackerAuth.accessToken }), 403);
      expect(await call(`/users/${customer.id}`, { token: attackerAuth.accessToken, method: 'PATCH', body: { name: 'Intrusion' } }), 403);
      expect(await call(`/users/${customer.id}`, { token: customerAuth.accessToken, method: 'PATCH', body: { role: 'ADMIN' } }), 400);
      const self = expect(await call(`/users/${customer.id}`, { token: customerAuth.accessToken, method: 'PATCH', body: { name: 'Updated test customer' } }), 200).json;
      assert.equal(self.name, 'Updated test customer'); assert.equal(self.passwordHash, undefined);
      expect(await call(`/users/${customer.id}`, { token: customerAuth.accessToken, method: 'PATCH', body: { avatarUrl: 'https://unconfirmed.example.invalid/avatar.png' } }), 400);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).avatarUrl, null);
      expect(await call(`/users/${customer.id}`, { token: customerAuth.accessToken, method: 'PATCH', body: { email: attacker.email.toUpperCase() } }), 409);
      expect(await call(`/users/${customer.id}`, { token: customerAuth.accessToken, method: 'PATCH', body: { name: ' '.repeat(20) } }), 400);
      expect(await call(`/users/${customer.id}`, { token: adminAuth.accessToken }), 200);
    });
    await t.test('merchant nested writes cannot elevate roles, move resources or change another store', async () => {
      const payloads = [
        { shop: { update: { owner: { update: { role: 'ADMIN' } } } } },
        { shop: { connect: { id: shops[1].toString() } } },
        { shopId: shops[1].toString() },
        { therapistServices: { deleteMany: {} } },
        { name: { set: 'Injected' } },
      ];
      for (const body of payloads) expect(await call(`/merchant/therapists/${therapists[0]}`, { token: merchantAuth.accessToken, method: 'PATCH', body }), 400);
      expect(await call(`/merchant/services/${services[0]}`, { token: merchantAuth.accessToken, method: 'PATCH', body: payloads[0] }), 400);
      // The service rejects relations independently of Nest's DTO validation pipeline.
      await assert.rejects(app.get(MerchantService).updateTherapist(merchant.id.toString(), therapists[0].toString(), payloads[0]), e => e.getStatus() === 400);
      expect(await call(`/merchant/therapists/${therapists[0]}`, { token: outsiderAuth.accessToken, method: 'PATCH', body: { title: 'Intrusion' } }), 403);
      expect(await call(`/merchant/shops/${shops[0]}/therapists`, { token: merchantAuth.accessToken, body: { name: 'Injected', shop: payloads[0].shop } }), 400);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: merchant.id } })).role, 'MERCHANT');
      assert.equal((await db.therapist.findUniqueOrThrow({ where: { id: therapists[0] } })).shopId, shops[0]);
      assert.equal(await db.therapistService.count({ where: { therapistId: therapists[0] } }), 1);
      expect(await call(`/merchant/therapists/${therapists[0]}`, { token: merchantAuth.accessToken, method: 'PATCH', body: { title: 'Allowed title', yearsExp: 4 } }), 200);
    });
    await t.test('merchant therapist service associations support self-service without nested writes or cross-shop links', async () => {
      const route = `/merchant/shops/${shops[0]}/therapists`;
      const serviceIds = [services[0].toString()];
      const body = { name: `Associated therapist ${prefix}`, yearsExp: 2, serviceIds };
      const before = await db.therapist.count({ where: { shopId: shops[0] } });
      for (const invalid of [null, [Number(services[0])], [{}], { set: serviceIds }, [...serviceIds, ...serviceIds], ['0'], ['-1']]) {
        expect(await call(route, { token: merchantAuth.accessToken, body: { ...body, serviceIds: invalid } }), 400);
      }
      expect(await call(route, { token: merchantAuth.accessToken, body: { ...body, serviceIds: [services[1].toString()] } }), 400);
      expect(await call(route, { token: outsiderAuth.accessToken, body }), 403);
      assert.equal(await db.therapist.count({ where: { shopId: shops[0] } }), before, 'Invalid creates must not leave orphan therapists');

      const created = expect(await call(route, { token: merchantAuth.accessToken, body }), 201).json;
      therapists.push(BigInt(created.id));
      const patch = changes => call(`/merchant/therapists/${created.id}`, { token: merchantAuth.accessToken, method: 'PATCH', body: changes });
      try {
        assert.deepEqual(created.serviceIds, serviceIds); assert.equal(created.therapistServices, undefined);
        const listed = expect(await call(route, { token: merchantAuth.accessToken }), 200).json.find(x => x.id === created.id);
        assert.deepEqual(listed.serviceIds, serviceIds);
        const publicShop = expect(await call(`/shops/${shops[0]}`), 200).json;
        assert.deepEqual(publicShop.therapists.find(x => x.id === created.id).services.map(x => x.serviceId), serviceIds);
        expect(await call(`/bookings/slots?shopId=${shops[0]}&serviceId=${services[0]}&therapistId=${created.id}&date=2031-01-15`, { token: customerAuth.accessToken }), 200);

        const preserved = expect(await patch({ title: 'Preserved service links' }), 200).json;
        assert.deepEqual(preserved.serviceIds, serviceIds);
        for (const invalid of [null, [Number(services[0])], [{}], { set: serviceIds }, [...serviceIds, ...serviceIds], ['0'], ['-1']]) {
          expect(await patch({ serviceIds: invalid }), 400);
        }
        expect(await patch({ title: 'Must roll back', serviceIds: [services[1].toString()] }), 400);
        assert.equal((await db.therapist.findUniqueOrThrow({ where: { id: BigInt(created.id) } })).title, 'Preserved service links');
        assert.deepEqual((await db.therapistService.findMany({ where: { therapistId: BigInt(created.id) } })).map(x => String(x.serviceId)), serviceIds);
        expect(await call(`/merchant/therapists/${created.id}`, { token: outsiderAuth.accessToken, method: 'PATCH', body: { serviceIds: [] } }), 403);
        expect(await patch({ yearsExp: { set: 100 } }), 400);
        expect(await patch({ therapistServices: { deleteMany: {} } }), 400);
        await assert.rejects(app.get(MerchantService).updateTherapist(merchant.id.toString(), created.id, { serviceIds: [services[0].toString()], shop: { update: { owner: { update: { role: 'ADMIN' } } } } }), e => e.getStatus() === 400);

        const cleared = expect(await patch({ serviceIds: [] }), 200).json;
        assert.deepEqual(cleared.serviceIds, []);
        assert.equal(await db.therapistService.count({ where: { therapistId: BigInt(created.id) } }), 0);
        // Service mappings are display metadata; current admission uses the
        // active shop staff pool and its shifts, not legacy qualification links.
        const slots = expect(await call(`/bookings/slots?shopId=${shops[0]}&serviceId=${services[0]}&therapistId=${created.id}&date=2031-01-15`, { token: customerAuth.accessToken }), 200).json;
        assert.ok(Array.isArray(slots.slots));
        assert.deepEqual(expect(await patch({ serviceIds }), 200).json.serviceIds, serviceIds);
      } finally {
        await db.therapist.update({ where: { id: BigInt(created.id) }, data: { isActive: false } });
      }
    });
    await t.test('public shop detail hides certificate files and inactive or cross-store associations', async () => {
      const privateUrl = `https://private.example.invalid/${prefix}/identity-document.pdf`;
      await db.shopCertificate.createMany({ data: [
        { shopId: shops[0], certificateType: 'INSURANCE', fileUrl: privateUrl, isVerified: false },
        { shopId: shops[0], certificateType: 'MASSAGE_LICENSE', fileUrl: privateUrl, isVerified: true, expiryDate: new Date('2099-01-01') },
        { shopId: shops[0], certificateType: 'BUSINESS_LICENSE', fileUrl: privateUrl, isVerified: true, expiryDate: new Date('2000-01-01') },
      ] });
      await db.therapistService.createMany({ data: [{ therapistId: therapists[0], serviceId: services[1] }, { therapistId: therapists[1], serviceId: services[0] }] });
      const activeService = expect(await call(`/services/${services[0]}`), 200).json;
      assert.deepEqual(activeService.therapists.map(x => x.id), [therapists[0].toString()]);
      const activeTherapist = expect(await call(`/therapists/${therapists[0]}`), 200).json;
      assert.deepEqual(activeTherapist.services.map(x => x.id), [services[0].toString()]);
      await db.therapist.update({ where: { id: therapists[1] }, data: { isActive: false } });
      await db.shopService.update({ where: { id: services[1] }, data: { isActive: false } });
      try {
        const detail = expect(await call(`/shops/${shops[0]}`), 200);
        assert.equal(detail.json.certificates.length, 1); assert.equal(detail.json.certificates[0].certificateType, 'MASSAGE_LICENSE');
        assert.ok(detail.json.certificates.every(x => !('fileUrl' in x))); assert.equal(detail.text.includes(privateUrl), false); assert.equal(detail.json.ownerId, undefined);
        assert.deepEqual(detail.json.features, { onlineBooking: true, reviews: true });
        assert.equal(detail.json.therapists[0].services.some(x => x.serviceId === services[1].toString()), false);
        const service = expect(await call(`/services/${services[0]}`), 200).json;
        assert.equal(service.therapists.length, 1);
        assert.equal(service.currency, 'usd'); assert.equal(service.therapists.some(x => x.id === therapists[1].toString()), false);
        const therapist = expect(await call(`/therapists/${therapists[0]}`), 200).json;
        assert.equal(therapist.services.some(x => x.id === services[1].toString()), false);
      } finally {
        await db.therapistService.deleteMany({ where: { OR: [{ therapistId: therapists[0], serviceId: services[1] }, { therapistId: therapists[1], serviceId: services[0] }] } });
        await db.therapist.update({ where: { id: therapists[1] }, data: { isActive: true } });
        await db.shopService.update({ where: { id: services[1] }, data: { isActive: true } });
      }
    });
    await t.test('hidden shops cannot be discovered through favorites, reviews or coupon claiming even in production mode', async () => {
      const coupon = await db.coupon.create({ data: { shopId: shops[1], title: `Hidden ${prefix}`, type: 'FIXED_AMOUNT', value: 100, status: 'ACTIVE', validFrom: new Date('2020-01-01') } }); couponIds.push(coupon.id);
      expect(await call(`/favorites/${shops[1]}/toggle`, { token: customerAuth.accessToken, body: {} }), 201);
      const previousMode = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
      try {
        for (const data of [{ status: 'PENDING' }, { status: 'SUSPENDED' }, { status: 'APPROVED', deletedAt: new Date() }]) {
          await db.shop.update({ where: { id: shops[1] }, data });
          expect(await call(`/reviews/shop/${shops[1]}`), 404);
          // Hidden shops can be removed from an existing favorite, never newly added.
          if (await db.userFavorite.findUnique({ where: { userId_shopId: { userId: customer.id, shopId: shops[1] } } })) {
            assert.equal(expect(await call(`/favorites/${shops[1]}/toggle`, { token: customerAuth.accessToken, body: {} }), 201).json.favorited, false);
          }
          expect(await call(`/favorites/${shops[1]}/toggle`, { token: customerAuth.accessToken, body: {} }), 404);
          assert.equal(expect(await call(`/favorites/${shops[1]}/check`, { token: customerAuth.accessToken }), 200).json.favorited, false);
          assert.equal(expect(await call('/favorites', { token: customerAuth.accessToken }), 200).json.ids.includes(shops[1].toString()), false);
          assert.equal(expect(await call('/favorites/shops', { token: customerAuth.accessToken }), 200).json.some(x => x.id === shops[1].toString()), false);
          assert.equal(expect(await call('/coupons', { token: customerAuth.accessToken }), 200).json.some(x => x.id === coupon.id.toString()), false);
          expect(await call(`/coupons?shopId=${shops[1]}`, { token: customerAuth.accessToken }), 404);
          expect(await call(`/coupons/${coupon.id}/claim`, { token: customerAuth.accessToken, body: {} }), 404);
        }
        assert.equal((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).claimedCount, 0);
      } finally { process.env.NODE_ENV = previousMode; await db.shop.update({ where: { id: shops[1] }, data: { status: 'APPROVED', deletedAt: null } }); }
    });
    await t.test('announcement audiences follow the current database role', async () => {
      for (const scope of ['ALL', 'USERS', 'MERCHANTS']) {
        const row = await db.announcement.create({ data: { title: `${prefix}-${scope}`, content: 'Test audience', scope, isActive: true, startAt: new Date('2020-01-01') } }); announcementIds.push(row.id);
      }
      for (const [auth, allowed] of [[customerAuth, ['ALL', 'USERS']], [merchantAuth, ['ALL', 'MERCHANTS']], [adminAuth, ['ALL', 'USERS', 'MERCHANTS']]]) {
        const items = expect(await call('/announcements', { token: auth.accessToken }), 200).json.filter(x => x.title.startsWith(prefix));
        assert.deepEqual(items.map(x => x.scope).sort(), allowed.sort());
      }
    });
    let booking;
    await t.test('shop, service and therapist relationships are enforced', async () => {
      const rejected = async changes => expect(await call('/bookings', { token: customerAuth.accessToken,
        body: await withBookingContact(customerAuth.accessToken, { ...bookingData(), ...changes }) }), 400).json;
      assert.equal((await rejected({ serviceId: services[1].toString() })).message, 'Service is unavailable at this shop');
      assert.equal((await rejected({ therapistId: therapists[1].toString() })).message, 'Therapist is unavailable for this service');
      assert.equal((await rejected({ date: '2031-02-30' })).message, 'Invalid booking date');
      const durationError = await rejected({ durationMin: 30.5 });
      assert.ok(Array.isArray(durationError.message) && durationError.message.some(message => /durationMin.*integer/.test(message)), 'Fractional duration must fail its own DTO constraint');
    });
    await t.test('simultaneous bookings cannot reserve the same initially empty slot', async () => {
      const [first, second] = await Promise.all([signed(customerAuth.accessToken, bookingData()), signed(attackerAuth.accessToken, bookingData())]);
      const results = await Promise.all([call('/bookings', { token: customerAuth.accessToken, body: first }), call('/bookings', { token: attackerAuth.accessToken, body: second })]);
      assert.deepEqual(results.map(x => x.status).sort(), [201, 409]);
      const winner = results.find(x => x.status === 201).json; bookingIds.push(BigInt(winner.id));
      const winningCommand = results[0].status === 201 ? first : second;
      assert.equal(winner.contact.recorded, true); assert.equal(winner.contact.source, 'ONLINE_VERIFIED');
      assert.equal(winner.contact.email, winningCommand.contact.email); assert.equal(winner.contact.phone, winningCommand.contact.phone);
      // Subsequent authorization/payment cases always use a customer-owned separate slot.
      booking = await newBooking(customerAuth.accessToken, '12:00');
      assert.equal(booking.contact.email, customer.email); assert.equal(booking.contact.source, 'ONLINE_VERIFIED');
      assert.equal(booking.totalCents, 11000); assert.equal(booking.platformFeeCents, 1000);
      assert.equal(booking.bookingTimezone, 'America/New_York'); assert.equal(booking.timezone, 'America/New_York'); assert.equal(booking.localDate, '2031-01-15'); assert.equal(booking.localStartTime, '12:00'); assert.equal(booking.localEndTime, '13:00');
      await db.shop.update({ where: { id: shops[0] }, data: { timezone: 'Europe/London' } });
      try {
        const detail = expect(await call(`/bookings/${booking.id}`, { token: customerAuth.accessToken }), 200).json;
        assert.equal(detail.localStartTime, '12:00'); assert.equal(detail.timezone, 'America/New_York');
        const list = expect(await call('/bookings', { token: customerAuth.accessToken }), 200).json;
        assert.equal(list.find(x => x.id === booking.id).localStartTime, '12:00');
      } finally { await db.shop.update({ where: { id: shops[0] }, data: { timezone: 'America/New_York' } }); }
    });
    await t.test('all booking entry points enforce owner, shop and paid-state rules', async () => {
      expect(await call(`/bookings/${booking.id}`, { token: attackerAuth.accessToken }), 404);
      expect(await call(`/bookings/${booking.id}/status?status=CONFIRMED`, { token: attackerAuth.accessToken, method: 'PATCH' }), 404);
      expect(await call(`/bookings/${booking.id}/status?status=CONFIRMED`, { token: customerAuth.accessToken, method: 'PATCH' }), 403);
      expect(await call(`/merchant/bookings/${booking.id}/confirm`, { token: outsiderAuth.accessToken, body: {} }), 404);
      expect(await call(`/merchant/bookings/${booking.id}/confirm`, { token: merchantAuth.accessToken, body: {} }), 400);
      expect(await call(`/bookings/${booking.id}`, { token: customerAuth.accessToken, method: 'DELETE' }), 400);
    });
    await t.test('after-sales number lookup and handling preserve shop and customer scope', async () => {
      const endpoint = '/after-sales';
      const ticket = expect(await call(endpoint, {
        token: customerAuth.accessToken,
        body: { bookingId: booking.id, type: 'COMPLAINT', reason: 'Synthetic after-sales booking lookup' },
      }), 201).json;
      assert.equal(ticket.booking.bookingNo, booking.bookingNo);
      const list = async (auth, filters) => {
        const query = new URLSearchParams(filters);
        return expect(await call(`${endpoint}?${query}`, { token: auth.accessToken }), 200).json;
      };
      const shopId = shops[0].toString();
      const exact = { bookingNo: ` ${booking.bookingNo} `, shopId };

      for (const auth of [adminAuth, merchantAuth, customerAuth]) {
        const result = await list(auth, exact);
        assert.equal(result.total, 1);
        assert.deepEqual(result.items.map(item => item.id), [ticket.id]);
        assert.equal(result.items[0].booking.bookingNo, booking.bookingNo);
      }

      const empty = { items: [], total: 0, page: 1, pageSize: 25 };
      assert.deepEqual(await list(adminAuth, { ...exact, bookingNo: booking.bookingNo.slice(0, -1) }), empty);
      assert.deepEqual(await list(adminAuth, { ...exact, bookingNo: booking.id }), empty);
      assert.deepEqual(await list(adminAuth, { ...exact, shopId: shops[1].toString() }), empty);
      assert.deepEqual(await list(attackerAuth, exact), empty);
      assert.deepEqual(await list(outsiderAuth, exact), empty);
      assert.deepEqual((await list(adminAuth, { shopId })).items.map(item => item.id), [ticket.id]);
      expect(await call(`${endpoint}?${new URLSearchParams(exact)}`), 401);

      const detailPath = `${endpoint}/${ticket.id}`;
      const adminToken = adminAuth.accessToken;
      const transition = (action, version, reason) => call(`${detailPath}/transition`, {
        token: adminToken,
        body: { action, version, ...(reason === undefined ? {} : { reason }) },
      });
      const accepted = expect(await transition('ACCEPT', ticket.version), 201).json;
      assert.equal(accepted.status, 'IN_PROGRESS');
      const internalNote = 'Synthetic internal follow-up';
      const noted = expect(await call(`${detailPath}/notes`, {
        token: adminToken,
        body: { version: accepted.version, content: internalNote, visibility: 'INTERNAL' },
      }), 201).json;

      for (const action of ['WAIT_FOR_CUSTOMER', 'REJECT', 'RESOLVE']) {
        const missingReason = expect(await transition(action, noted.version), 400).json;
        assert.equal(missingReason.message, 'Public reason must contain 1–2000 characters');
      }
      const waitReason = 'Please send your preferred follow-up time';
      const waiting = expect(await transition('WAIT_FOR_CUSTOMER', noted.version, waitReason), 201).json;
      assert.equal(waiting.status, 'WAITING_CUSTOMER');
      const resumed = expect(await transition('RESUME', waiting.version), 201).json;
      assert.equal(resumed.status, 'IN_PROGRESS');
      const resolution = 'The shop confirmed the new service arrangements';
      const resolved = expect(await transition('RESOLVE', resumed.version, resolution), 201).json;
      assert.equal(resolved.status, 'RESOLVED');

      const eventsPath = `${detailPath}/events`;
      const adminEvents = expect(await call(eventsPath, { token: adminToken }), 200).json;
      assert.deepEqual(adminEvents.items.filter(event => event.visibility === 'INTERNAL').map(event => event.content), [internalNote]);
      const customerToken = customerAuth.accessToken;
      const customerEvents = expect(await call(eventsPath, { token: customerToken }), 200).json;
      const customerDetail = expect(await call(detailPath, { token: customerToken }), 200).json;
      assert.equal(customerDetail.status, 'RESOLVED');
      assert.deepEqual(customerDetail.timeline, customerEvents.items);
      assert.equal(customerEvents.total, 5);
      assert.ok(customerEvents.items.every(event => event.visibility === 'PUBLIC'));
      assert.deepEqual(customerEvents.items.map(event => [event.kind, event.content]), [
        ['CREATED', ticket.reason], ['ACCEPT', null], ['WAIT_FOR_CUSTOMER', waitReason],
        ['RESUME', null], ['RESOLVE', resolution],
      ]);
    });
    await t.test('pay-at-store after-sales resolves only after a full offline refund is recorded', async subtest => {
      const customerToken = customerAuth.accessToken;
      const merchantToken = merchantAuth.accessToken;
      const adminToken = adminAuth.accessToken;
      const shopWhere = { id: shops[0] };
      const { studioProfile } = await db.shop.findUniqueOrThrow({
        where: shopWhere,
        select: { studioProfile: true },
      });
      subtest.after(async () => {
        await db.shop.update({ where: shopWhere, data: { studioProfile } });
      });
      await db.shop.update({
        where: shopWhere,
        data: { studioProfile: {
          ...studioProfile,
          paymentPolicy: { ...studioProfile.paymentPolicy, payAtStoreEnabled: true },
        } },
      });
      const selection = { ...bookingData(), date: '2031-01-19', paymentMode: 'PAY_AT_STORE' };
      const offlineBooking = expect(await call('/bookings', {
        token: customerToken,
        body: await signed(customerToken, selection),
      }), 201).json;
      const bookingId = BigInt(offlineBooking.id);
      bookingIds.push(bookingId);
      const bookingPath = `/bookings/${offlineBooking.id}`;
      const fullAmount = offlineBooking.totalCents;
      const requestedAmount = 2500;
      assert.equal(fullAmount, 10000);
      expect(await call(`/merchant${bookingPath}/confirm`, { token: merchantToken, body: {} }), 201);

      const cashEntry = (amountCents, reason) => ({
        requestKey: randomUUID(),
        amountCents,
        method: 'CASH',
        occurredAt: new Date().toISOString(),
        reason,
      });
      const receipt = expect(await call(`${bookingPath}/offline-receipts`, {
        token: merchantToken,
        body: cashEntry(fullAmount, 'Synthetic cash received at the shop'),
      }), 201).json;
      assert.equal(receipt.paymentMode, 'PAY_AT_STORE');
      assert.equal(receipt.paidCents, fullAmount);

      const reason = 'Request a refund for the service paid at the shop';
      const ticket = expect(await call('/after-sales', {
        token: customerToken,
        body: { bookingId: offlineBooking.id, type: 'REFUND', reason, requestedAmountCents: requestedAmount },
      }), 201).json;
      const ticketPath = `/after-sales/${ticket.id}`;
      const resolution = 'The shop recorded the completed cash refund';
      const transition = (action, version, reason) => call(`${ticketPath}/transition`, {
        token: adminToken,
        body: { action, version, ...(reason === undefined ? {} : { reason }) },
      });
      const accepted = expect(await transition('ACCEPT', ticket.version), 201).json;
      assert.equal(accepted.status, 'IN_PROGRESS');
      assert.equal(accepted.refundMode, 'PAY_AT_STORE');
      assert.equal(accepted.offlineRefundRecordedCents, null);
      assert.equal(accepted.refundState, 'NONE');
      for (const action of ['RESOLVE', 'REFUND', 'RECONCILE']) {
        assert.ok(!accepted.allowedActions.includes(action), `Unavailable action: ${action}`);
      }
      expect(await transition('RESOLVE', accepted.version, resolution), 409);
      for (const action of ['refund', 'reconcile']) {
        expect(await call(`${ticketPath}/${action}`, { token: adminToken, body: { version: accepted.version } }), 409);
      }
      expect(await call(`${bookingPath}/offline-refunds`, {
        token: merchantToken,
        body: cashEntry(requestedAmount, 'Synthetic partial refund attempt'),
      }), 400);

      // Inconsistent legacy totals alone must not replace an offline refund entry.
      const settlement = { status: true, paymentStatus: true, refundedCents: true };
      const beforeRefund = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: settlement });
      try {
        await db.booking.update({
          where: { id: bookingId },
          data: { status: 'CANCELLED', paymentStatus: 'REFUNDED', refundedCents: fullAmount },
        });
        assert.equal(await db.bookingSettlementEntry.count({ where: { bookingId, kind: 'REFUND' } }), 0);
        expect(await transition('RESOLVE', accepted.version, resolution), 409);
        const unchanged = expect(await call(ticketPath, { token: adminToken }), 200).json;
        assert.equal(unchanged.version, accepted.version);
        assert.equal(unchanged.offlineRefundRecordedCents, null);
        assert.ok(!unchanged.allowedActions.includes('RESOLVE'));
      } finally {
        await db.booking.update({ where: { id: bookingId }, data: beforeRefund });
      }

      const refundBody = cashEntry(fullAmount, 'Synthetic full refund returned in cash');
      const recordRefund = () => call(`${bookingPath}/offline-refunds`, { token: merchantToken, body: refundBody });
      const refunded = expect(await recordRefund(), 201).json;
      assert.equal(refunded.status, 'CANCELLED');
      assert.equal(refunded.paymentStatus, 'REFUNDED');
      assert.equal(refunded.refundedCents, fullAmount);
      expect(await recordRefund(), 201);
      const ready = expect(await call(ticketPath, { token: adminToken }), 200).json;
      assert.equal(ready.status, 'IN_PROGRESS');
      assert.equal(ready.offlineRefundRecordedCents, fullAmount);
      assert.equal(ready.refundState, 'SUCCEEDED');
      assert.ok(ready.allowedActions.includes('RESOLVE'));
      assert.ok(!ready.allowedActions.includes('REFUND'));
      const resolved = expect(await transition('RESOLVE', ready.version, resolution), 201).json;
      assert.equal(resolved.status, 'RESOLVED');

      const filter = new URLSearchParams({ bookingNo: offlineBooking.bookingNo, shopId: offlineBooking.shopId });
      const expectedHistory = [['CREATED', reason], ['ACCEPT', null], ['RESOLVE', resolution]];
      for (const token of [customerToken, merchantToken, adminToken]) {
        const detail = expect(await call(ticketPath, { token }), 200).json;
        const result = expect(await call(`/after-sales?${filter}`, { token }), 200).json;
        assert.equal(result.total, 1);
        for (const entry of [detail, result.items[0]]) {
          assert.equal(entry.id, ticket.id);
          assert.equal(entry.status, 'RESOLVED');
          assert.equal(entry.refundMode, 'PAY_AT_STORE');
          assert.equal(entry.refundState, 'SUCCEEDED');
          assert.equal(entry.requestedAmountCents, requestedAmount);
          assert.equal(entry.offlineRefundRecordedCents, fullAmount);
          assert.equal(entry.booking.paymentStatus, 'REFUNDED');
        }
        const history = expect(await call(`${ticketPath}/events`, { token }), 200).json;
        assert.deepEqual(history.items.map(event => [event.kind, event.content]), expectedHistory);
      }
      expect(await call(ticketPath, { token: attackerAuth.accessToken }), 404);
      expect(await call(ticketPath, { token: outsiderAuth.accessToken }), 404);

      const where = { bookingId };
      const refundEvidence = await db.bookingSettlementEntry.findMany({
        where: { bookingId, kind: 'REFUND' },
        select: { amountCents: true, operatorId: true },
      });
      assert.deepEqual(refundEvidence, [{ amountCents: fullAmount, operatorId: merchant.id }]);
      assert.equal(await db.refundRequest.count({ where }), 0);
      assert.equal(await db.paymentRecord.count({ where }), 0);
      const saved = await db.afterSalesCase.findUniqueOrThrow({ where: { id: BigInt(ticket.id) } });
      assert.equal(saved.activeBookingId, null);
      assert.equal(saved.refundRequestId, null);
      assert.equal(saved.refundKey, null);
    });
    await t.test('platform-admin cancellation persists the trimmed reason and replays without a second write', async () => {
      const reservation = await newBooking(customerAuth.accessToken, '11:00');
      const path = '/bookings/' + reservation.id;
      const bookingId = BigInt(reservation.id);
      const key = randomUUID();
      const command = { token: adminAuth.accessToken, extra: { 'Idempotency-Key': key } };
      const reason = 'The customer requested a cancellation';
      const audit = { action: 'BOOKING_CANCELLED', targetType: 'BOOKING', targetId: bookingId, operatorId: admin.id };
      const receipt = { bookingId, actorId: admin.id, requestKey: key };

      expect(await call(path + '/cancel', { ...command, body: {} }), 400);
      const pending = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
      assert.equal(pending.status, 'PENDING');
      assert.equal(pending.cancelReason, null);
      assert.equal(await db.bookingOperationReceipt.count({ where: receipt }), 0);

      const cancelled = expect(await call(path + '/status?status=CANCELLED', {
        ...command,
        method: 'PATCH',
        body: { cancelReason: '  ' + reason + '  ' },
      }), 200).json;
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancelReason, reason);

      const replay = expect(await call(path + '/cancel', { ...command, body: { cancelReason: reason } }), 201).json;
      assert.equal(replay.status, 'CANCELLED');
      assert.equal(replay.cancelReason, reason);
      for (const auth of [adminAuth, merchantAuth, customerAuth]) {
        const saved = expect(await call(path, { token: auth.accessToken }), 200).json;
        assert.equal(saved.status, 'CANCELLED');
        assert.equal(saved.cancelReason, reason);
      }
      assert.equal(await db.auditLog.count({ where: audit }), 1);
      assert.equal(await db.bookingOperationReceipt.count({ where: { ...receipt, outcome: 'COMMITTED' } }), 1);
    });
    await t.test('unconfigured and Square payments refuse settlement, with no mock fallback', async () => {
      expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: booking.id } }), 503);
      assert.equal(await db.paymentRecord.count({ where: { bookingId: BigInt(booking.id) } }), 0);
      process.env.PAYMENT_PROVIDER = 'square'; expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: booking.id } }), 503);
      process.env.NODE_ENV = 'production'; process.env.PAYMENT_PROVIDER = 'local_mock'; assert.equal(app.get(PaymentService).config().enabled, false);
      const old = process.env.JWT_SECRET; process.env.JWT_SECRET = 'weak'; assert.throws(() => jwtSecret(), /strong secret/); process.env.JWT_SECRET = old;
      process.env.NODE_ENV = 'test'; process.env.PAYMENT_PROVIDER = 'local_mock';
    });
    await t.test('payment creation rejects a missing or wrong-owner shop ledger before creating provider state', async () => {
      const result = expect(await call('/bookings', { token: customerAuth.accessToken, body: await signed(customerAuth.accessToken, { ...bookingData('14:00'), shopId: shops[1].toString(), serviceId: services[1].toString(), therapistId: therapists[1].toString() }) }), 201).json;
      bookingIds.push(BigInt(result.id));
      const createIntent = () => call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: result.id } });
      assert.equal(expect(await call('/payments/quote',{token:customerAuth.accessToken,body:{bookingId:result.id}}),201).json.paymentEnabled,false);
      expect(await createIntent(), 503);
      assert.equal(await db.paymentRecord.count({ where: { bookingId: BigInt(result.id) } }), 0);
      // Even an existing shop profile is unsafe when it belongs to a different owner.
      const incorrectProfile = await db.merchantProfile.create({ data: { shopId: shops[1], userId: outsider.id } });
      try {
        assert.equal(expect(await call('/payments/quote',{token:customerAuth.accessToken,body:{bookingId:result.id}}),201).json.paymentEnabled,false);
        expect(await createIntent(), 503);
        assert.equal(await db.paymentRecord.count({ where: { bookingId: BigInt(result.id) } }), 0);
        const saved = await db.booking.findUniqueOrThrow({ where: { id: BigInt(result.id) } });
        assert.equal(saved.paymentId, null); assert.equal(saved.paymentStatus, 'UNPAID'); assert.equal(saved.paidCents, 0);
        assert.equal(await db.merchantTransaction.count({ where: { profileId: incorrectProfile.id } }), 0);
      } finally { await db.merchantProfile.delete({ where: { id: incorrectProfile.id } }); }
    });
    let intent;
    await t.test('server cents quote and payment ownership reject client tampering', async () => {
      const quote = expect(await call('/payments/quote', { token: customerAuth.accessToken, body: { bookingId: booking.id } }), 201).json;
      assert.equal(quote.totalCents, 11000); assert.equal(quote.currency, 'usd');
      expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: booking.id, shopId: shops[1].toString() } }), 400);
      expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: booking.id, amountCents: 1 } }), 400);
      const results = await Promise.all([call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: booking.id } }), call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: booking.id } })]);
      results.forEach(r => expect(r, 201)); assert.equal(results[0].json.paymentIntentId, results[1].json.paymentIntentId); intent = results[0].json;
      expect(await call('/payments/confirm', { token: attackerAuth.accessToken, body: { paymentIntentId: intent.paymentIntentId } }), 404);
    });
    await t.test('parallel payment confirmation credits the merchant ledger exactly once', async () => {
      const results = await Promise.all([call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: intent.paymentIntentId } }), call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: intent.paymentIntentId } })]);
      results.forEach(r => expect(r, 201));
      const b = await db.booking.findUniqueOrThrow({ where: { id: BigInt(booking.id) } });
      assert.equal(b.paidCents, 11000); assert.equal(b.paymentStatus, 'PAID');
      assert.equal((await db.merchantProfile.findUniqueOrThrow({ where: { id: profile.id } })).balanceCents, 10000);
      assert.equal(await db.merchantTransaction.count({ where: { profileId: profile.id, type: 'PAYMENT' } }), 1);
      eventIds.push(`confirmed:${(await db.paymentRecord.findUniqueOrThrow({ where: { bookingId: b.id } })).id}`);
      expect(await call(`/bookings/${booking.id}/cancel`, { token: customerAuth.accessToken, body: {} }), 400);
    });
    await t.test('precise refunds are idempotent and cannot exceed remaining collected cents', async () => {
      expect(await call(`/bookings/${booking.id}/refund-partial`, { token: customerAuth.accessToken, body: { amountCents: 1250 } }), 400);
      const key = `test:${prefix}:partial`;
      expect(await call(`/bookings/${booking.id}/refund-partial`, { token: attackerAuth.accessToken, body: { amountCents: 1250 }, extra: { 'Idempotency-Key': key } }), 404);
      const results = await Promise.all([call(`/bookings/${booking.id}/refund-partial`, { token: customerAuth.accessToken, body: { amountCents: 1250 }, extra: { 'Idempotency-Key': key } }), call(`/bookings/${booking.id}/refund-partial`, { token: customerAuth.accessToken, body: { amountCents: 1250 }, extra: { 'Idempotency-Key': key } })]);
      results.forEach(r => expect(r, 201)); assert.equal(results[0].json.requestId, results[1].json.requestId);
      let b = await db.booking.findUniqueOrThrow({ where: { id: BigInt(booking.id) } }); assert.equal(b.refundedCents, 1250);
      assert.equal(await db.merchantTransaction.count({ where: { profileId: profile.id, type: 'REFUND' } }), 1);
      expect(await call(`/bookings/${booking.id}/refund-partial`, { token: customerAuth.accessToken, body: { amountCents: 1251 }, extra: { 'Idempotency-Key': key } }), 409);
      expect(await call(`/bookings/${booking.id}/refund-partial`, { token: customerAuth.accessToken, body: { amountCents: 20000 }, extra: { 'Idempotency-Key': `test:${prefix}:excess` } }), 400);
      expect(await call(`/bookings/${booking.id}/refund`, { token: customerAuth.accessToken, body: {} }), 201);
      expect(await call(`/bookings/${booking.id}/refund`, { token: customerAuth.accessToken, body: {} }), 201);
      b = await db.booking.findUniqueOrThrow({ where: { id: b.id } }); assert.equal(b.refundedCents, b.paidCents); assert.equal(b.paymentStatus, 'REFUNDED');
      expect(await call(`/bookings/${booking.id}`, { token: customerAuth.accessToken, method: 'DELETE' }), 400);
      assert.equal((await db.merchantProfile.findUniqueOrThrow({ where: { id: profile.id } })).balanceCents, 0);
    });
    await t.test('missing or mismatched merchant ledgers roll settlement and refund back and allow exact retry', async () => {
      const b = await newBooking(customerAuth.accessToken, '13:00');
      const pi = expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: b.id } }), 201).json;
      const record = await db.paymentRecord.findUniqueOrThrow({ where: { bookingId: BigInt(b.id) } });
      const eventId = `confirmed:${record.id}`; eventIds.push(eventId);
      try {
        await db.merchantProfile.update({ where: { id: profile.id }, data: { userId: outsider.id } });
        expect(await call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: pi.paymentIntentId } }), 503);
        let saved = await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } });
        assert.equal(saved.paymentStatus, 'UNPAID'); assert.equal(saved.paidCents, 0); assert.equal(saved.status, 'PENDING');
        assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: record.id } })).status, 'CREATED');
        assert.equal(await db.paymentEvent.count({ where: { provider: 'local_mock', eventId } }), 0);
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id) } }), 0);
        await db.merchantProfile.update({ where: { id: profile.id }, data: { userId: merchant.id } });
        expect(await call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: pi.paymentIntentId } }), 201);
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'PAYMENT' } }), 1);

        // Preserve the existing ledger row and its historical entries while simulating a missing shop mapping.
        await db.merchantProfile.update({ where: { id: profile.id }, data: { shopId: shops[1] } });
        const refundOptions = { token: customerAuth.accessToken, body: {}, extra: { 'Idempotency-Key': `test:${prefix}:ledger-retry` } };
        expect(await call(`/bookings/${b.id}/refund`, refundOptions), 503);
        saved = await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } });
        assert.equal(saved.status, 'CONFIRMED'); assert.equal(saved.paymentStatus, 'PAID'); assert.equal(saved.refundedCents, 0);
        assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: record.id } })).refundedCents, 0);
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'REFUND' } }), 0);
        assert.equal(await db.refundRequest.count({ where: { idempotencyKey: refundOptions.extra['Idempotency-Key'] } }), 0, 'Missing profile must block before sending or reserving a refund');
        await db.merchantProfile.update({ where: { id: profile.id }, data: { shopId: shops[0] } });
        expect(await call(`/bookings/${b.id}/refund`, refundOptions), 201);
        expect(await call(`/bookings/${b.id}/refund`, refundOptions), 201);
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'REFUND' } }), 1);
        saved = await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } });
        assert.equal(saved.refundedCents, saved.paidCents); assert.equal(saved.paymentStatus, 'REFUNDED');
        assert.equal((await db.merchantProfile.findUniqueOrThrow({ where: { id: profile.id } })).balanceCents, 0);
      } finally { await db.merchantProfile.update({ where: { id: profile.id }, data: { userId: merchant.id, shopId: shops[0] } }); }
    });
    await t.test('customer refund policy passes its exact allowed amount, not a full refund', async () => {
      const b = await newBooking(customerAuth.accessToken, '15:00');
      const pi = expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: b.id } }), 201).json;
      expect(await call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: pi.paymentIntentId } }), 201);
      const record = await db.paymentRecord.findUniqueOrThrow({ where: { bookingId: BigInt(b.id) } }); eventIds.push(`confirmed:${record.id}`);
      await db.booking.update({ where: { id: BigInt(b.id) }, data: { startTime: new Date(Date.now() + 3600000) } });
      const refund = expect(await call(`/bookings/${b.id}/refund`, { token: customerAuth.accessToken, body: {} }), 201).json;
      assert.equal(refund.amountCents, 5500); assert.equal(refund.refundedAmount, 5500);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).refundedCents, 5500);
    });
    await t.test('provider timeout retries the same refund without charging or crediting twice', async () => {
      const b = await newBooking(customerAuth.accessToken, '16:00');
      await db.booking.update({ where: { id: BigInt(b.id) }, data: { discountCents: 2000, platformFeeCents: 800, totalCents: 8800 } });
      const pi = expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: b.id } }), 201).json;
      assert.equal(pi.amountCents, 8800);
      expect(await call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: pi.paymentIntentId } }), 201);
      const record = await db.paymentRecord.update({ where: { bookingId: BigInt(b.id) }, data: { provider: 'stripe' } }); eventIds.push(`confirmed:${record.id}`);
      const payments = app.get(PaymentService), savedClient = payments.stripe;
      const returned = new Map(); let calls = 0;
      payments.stripe = { refunds: { create: async (args, options) => {
        calls++; assert.equal(args.amount, 1234);
        let refund = returned.get(options.idempotencyKey);
        if (!refund) { refund = { id: `re_test_${prefix}`, amount: args.amount, status: 'succeeded', payment_intent: args.payment_intent, currency: record.currency, metadata: args.metadata }; returned.set(options.idempotencyKey, refund); throw new Error('Simulated response timeout after provider acceptance'); }
        return refund;
      } } };
      process.env.PAYMENT_PROVIDER = 'stripe'; process.env.PAYMENT_EXTERNAL_ENABLED = 'true'; process.env.STRIPE_SECRET_KEY = 'offline-test-only'; process.env.STRIPE_WEBHOOK_SECRET = 'offline-test-only';
      const options = { token: customerAuth.accessToken, body: { amountCents: 1234 }, extra: { 'Idempotency-Key': `test:${prefix}:timeout` } };
      try {
        expect(await call(`/bookings/${b.id}/refund-partial`, options), 503);
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).refundedCents, 0);
        assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { idempotencyKey: options.extra['Idempotency-Key'] } })).status, 'RETRYABLE');
        expect(await call(`/bookings/${b.id}/cancel`, { token: customerAuth.accessToken, body: {} }), 400);
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).status, 'CONFIRMED');
        expect(await call(`/bookings/${b.id}/refund-partial`, options), 201);
        expect(await call(`/bookings/${b.id}/refund-partial`, options), 201);
        assert.equal(calls, 2); assert.equal(returned.size, 1);
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).refundedCents, 1234);
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'REFUND' } }), 1);
      } finally { payments.stripe = savedClient; process.env.PAYMENT_PROVIDER = 'local_mock'; process.env.PAYMENT_EXTERNAL_ENABLED = 'false'; }
    });
    await t.test('raw-body webhook verifies signatures and deduplicates concurrent deliveries', async () => {
      const b = await newBooking(customerAuth.accessToken, '17:00');
      const pi = expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: b.id } }), 201).json;
      const record = await db.paymentRecord.update({ where: { bookingId: BigInt(b.id) }, data: { provider: 'stripe' } });
      process.env.PAYMENT_PROVIDER = 'stripe'; process.env.PAYMENT_EXTERNAL_ENABLED = 'true';
      process.env.STRIPE_SECRET_KEY = `sk_test_${randomBytes(24).toString('hex')}`;
      process.env.STRIPE_WEBHOOK_SECRET = `whsec_${randomBytes(24).toString('hex')}`;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const eventId = `evt_test_${prefix}`; eventIds.push(eventId);
      const event = { id: eventId, type: 'payment_intent.succeeded', data: { object: { id: pi.paymentIntentId, status: 'succeeded', amount: 11000, amount_received: 11000, currency: 'usd', metadata: { booking_id: b.id, record_id: record.id, shop_id: shops[1].toString() } } } };
      // A hostile metadata shop does not determine the recipient; the persisted booking does.
      const payload = JSON.stringify(event);
      expect(await call('/payments/webhook', { body: payload, extra: { 'stripe-signature': 'invalid' } }), 400);
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      const results = await Promise.all([call('/payments/webhook', { body: payload, extra: { 'stripe-signature': signature } }), call('/payments/webhook', { body: payload, extra: { 'stripe-signature': signature } })]);
      results.forEach(r => expect(r, 201));
      assert.equal(await db.paymentEvent.count({ where: { provider: 'stripe', eventId } }), 1);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).paidCents, 11000);
      assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'PAYMENT' } }), 1);
      const repeated = { ...event, id: `${eventId}_second` }; eventIds.push(repeated.id);
      const repeatedPayload = JSON.stringify(repeated);
      expect(await call('/payments/webhook', { body: repeatedPayload, extra: { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: repeatedPayload, secret: process.env.STRIPE_WEBHOOK_SECRET }) } }), 201);
      assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'PAYMENT' } }), 1);
      const modified = JSON.stringify({ ...event, id: `${eventId}_bad_amount`, data: { object: { ...event.data.object, amount: 1 } } });
      expect(await call('/payments/webhook', { body: modified, extra: { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: modified, secret: process.env.STRIPE_WEBHOOK_SECRET }) } }), 400);
      assert.equal(await db.paymentEvent.count({ where: { provider: 'stripe', eventId: `${eventId}_bad_amount` } }), 0);
      const failed = { ...event, id: `${eventId}_failed`, type: 'payment_intent.payment_failed' }; eventIds.push(failed.id);
      const failedPayload = JSON.stringify(failed);
      expect(await call('/payments/webhook', { body: failedPayload, extra: { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: failedPayload, secret: process.env.STRIPE_WEBHOOK_SECRET }) } }), 201);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).paymentStatus, 'PAID');
      const refund = { id: `re_webhook_${prefix}`, payment_intent: pi.paymentIntentId, amount: 333, currency: 'usd', status: 'succeeded', metadata: {} };
      for (const [suffix, type, object] of [['refund', 'refund.created', refund], ['charge', 'charge.refunded', { id: `ch_test_${prefix}`, refunds: { has_more: false, data: [refund] } }]]) {
        const id = `${eventId}_${suffix}`; eventIds.push(id);
        const refundPayload = JSON.stringify({ id, type, data: { object } });
        expect(await call('/payments/webhook', { body: refundPayload, extra: { 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: refundPayload, secret: process.env.STRIPE_WEBHOOK_SECRET }) } }), 201);
      }
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).refundedCents, 333);
      assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'REFUND' } }), 1);
      process.env.PAYMENT_PROVIDER = 'local_mock'; process.env.PAYMENT_EXTERNAL_ENABLED = 'false';
    });
    await t.test('Square hosted checkout and signed webhooks share the exact idempotent payment and refund ledger', async () => {
      const b = await newBooking(customerAuth.accessToken, '18:00');
      const payments = app.get(PaymentService), savedSquare = payments.square;
      const savedProvider = process.env.PAYMENT_PROVIDER, savedExternal = process.env.PAYMENT_EXTERNAL_ENABLED;
      const env = { PAYMENT_PROVIDER: 'square', PAYMENT_EXTERNAL_ENABLED: 'true', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'offline-test-only', SQUARE_LOCATION_ID: 'offline_location', SQUARE_MERCHANT_ID: 'offline_merchant', SQUARE_CURRENCY: 'USD', SQUARE_SHOP_ID: shops[0].toString(), SQUARE_WEBHOOK_SIGNATURE_KEY: randomBytes(32).toString('hex'), SQUARE_WEBHOOK_NOTIFICATION_URL: 'http://127.0.0.1/api/v1/payments/square/webhook', SQUARE_CHECKOUT_REDIRECT_URL: 'http://127.0.0.1/booking' };
      const orderId = `sq_order_${prefix}`, paymentId = `sq_payment_${prefix}`, checkoutId = `sq_link_${prefix}`;
      const checkoutKeys = new Set(), refunds = new Map(); let refundMode = 'COMPLETED', refundCalls = 0, checkoutCalls = 0;
      const transport = async (url, options) => {
        const endpoint = new URL(url); assert.equal(endpoint.hostname, 'connect.squareupsandbox.com');
        const body = JSON.parse(options.body); assert.equal(body.idempotency_key.length, 40);
        if (endpoint.pathname === '/v2/online-checkout/payment-links') {
          checkoutCalls++;
          checkoutKeys.add(body.idempotency_key); assert.equal(body.order.location_id, env.SQUARE_LOCATION_ID);
          assert.equal(body.order.line_items[0].base_price_money.amount, 11000);
          assert.equal(body.checkout_options.allow_tipping, false);
          return new Response(JSON.stringify({ payment_link: { id: checkoutId, order_id: orderId, url: `https://sandbox.square.link/u/${prefix}` }, related_resources: { orders: [{ id: orderId, location_id: env.SQUARE_LOCATION_ID, total_money: { amount: 11000, currency: 'USD' } }] } }));
        }
        assert.equal(endpoint.pathname, '/v2/refunds'); refundCalls++;
        assert.equal(body.payment_id, paymentId);
        let refund = refunds.get(body.idempotency_key);
        if (!refund) {
          refund = { id: `sq_refund_${prefix}_${refunds.size}`, payment_id: paymentId, order_id: orderId, location_id: env.SQUARE_LOCATION_ID, amount_money: body.amount_money, status: refundMode === 'TIMEOUT' ? 'COMPLETED' : refundMode, reason: body.reason };
          refunds.set(body.idempotency_key, refund);
          if (refundMode === 'TIMEOUT') throw new Error('Offline accepted refund response timeout');
        }
        return new Response(JSON.stringify({ refund }));
      };
      const envelope = (suffix, kind, object) => ({ merchant_id: env.SQUARE_MERCHANT_ID, event_id: `evt_square_${prefix}_${suffix}`, type: `${kind}.updated`, data: { id: object.id, type: kind, object: { [kind]: object } } });
      const deliver = (event, signature) => {
        const raw = JSON.stringify(event); eventIds.push(event.event_id);
        return call('/payments/square/webhook', { body: raw, extra: { 'x-square-hmacsha256-signature': signature ?? createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_NOTIFICATION_URL).update(raw).digest('base64') } });
      };
      try {
        process.env.PAYMENT_PROVIDER = 'square'; process.env.PAYMENT_EXTERNAL_ENABLED = 'true';
        payments.square = new SquareProvider({...env,SQUARE_SHOP_ID:shops[1].toString()}, transport);
        assert.equal(expect(await call('/payments/quote',{token:customerAuth.accessToken,body:{bookingId:b.id}}),201).json.paymentEnabled,false);
        expect(await call('/payments/create-intent',{token:customerAuth.accessToken,body:{bookingId:b.id}}),503);
        assert.equal(await db.paymentRecord.count({where:{bookingId:BigInt(b.id)}}),0);assert.equal(checkoutCalls,0);
        payments.square = new SquareProvider(env, transport);
        assert.equal(expect(await call('/payments/config'), 200).json.checkout, 'hosted');
        const responses = await Promise.all([call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: b.id } }), call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: b.id } })]);
        responses.forEach(r => expect(r, 201)); assert.equal(checkoutKeys.size, 1);
        const checkout = responses[0].json; assert.equal(checkout.providerOrderId, orderId); assert.match(checkout.checkoutUrl, /^https:\/\/sandbox.square.link\//);
        assert.equal(checkout.paymentIntentId, null); assert.equal(checkout.clientSecret, null);
        let record = await db.paymentRecord.findUniqueOrThrow({ where: { bookingId: BigInt(b.id) } });
        assert.deepEqual(record.providerBinding,payments.square.binding());assert.equal(checkout.providerBinding,undefined);assert.equal(checkout.configurationHash,undefined);
        assert.equal(record.providerPaymentId, null); assert.equal(record.providerOrderId, orderId); assert.equal(record.status, 'CREATED');
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).paidCents, 0);
        expect(await call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: checkoutId } }), 404);
        const payment = { id: paymentId, order_id: orderId, location_id: env.SQUARE_LOCATION_ID, status: 'COMPLETED', amount_money: { amount: 11000, currency: 'USD' }, total_money: { amount: 11000, currency: 'USD' }, reference_id: record.id };
        const completed = envelope('completed', 'payment', payment);
        const changes = [
          {SQUARE_SHOP_ID:shops[1].toString()}, {SQUARE_MERCHANT_ID:'changed_merchant'}, {SQUARE_LOCATION_ID:'changed_location'}, {SQUARE_ACCESS_TOKEN:'changed_offline_token'}, {SQUARE_WEBHOOK_SIGNATURE_KEY:'changed_offline_signature'},
          {SQUARE_ENVIRONMENT:'production',SQUARE_WEBHOOK_NOTIFICATION_URL:'https://api.example.invalid/square',SQUARE_CHECKOUT_REDIRECT_URL:'https://app.example.invalid/'},
        ];
        for (let i=0;i<changes.length;i++) {
          const changed={...env,...changes[i]}; payments.square=new SquareProvider(changed,transport);assert.equal(payments.square.config().enabled,true);
          const before=checkoutCalls;
          assert.equal(expect(await call('/payments/quote',{token:customerAuth.accessToken,body:{bookingId:b.id}}),201).json.paymentEnabled,false);
          expect(await call('/payments/create-intent',{token:customerAuth.accessToken,body:{bookingId:b.id}}),503);assert.equal(checkoutCalls,before,'Binding mismatch must not return old checkout or call a provider');
          const event=envelope(`binding_changed_${i}`,'payment',{...payment,location_id:changed.SQUARE_LOCATION_ID});event.merchant_id=changed.SQUARE_MERCHANT_ID;
          const signature=createHmac('sha256',changed.SQUARE_WEBHOOK_SIGNATURE_KEY).update(changed.SQUARE_WEBHOOK_NOTIFICATION_URL).update(JSON.stringify(event)).digest('base64');
          expect(await deliver(event,signature),503);assert.equal(await db.paymentEvent.count({where:{eventId:event.event_id}}),0);
        }
        payments.square=new SquareProvider(env,transport);
        await db.paymentRecord.update({where:{id:record.id},data:{providerBinding:require('@prisma/client').Prisma.DbNull}});
        assert.equal(expect(await call('/payments/quote',{token:customerAuth.accessToken,body:{bookingId:b.id}}),201).json.paymentEnabled,false);
        expect(await call('/payments/create-intent',{token:customerAuth.accessToken,body:{bookingId:b.id}}),503);
        expect(await deliver(envelope('legacy_no_binding','payment',payment)),503);
        assert.equal((await db.booking.findUniqueOrThrow({where:{id:BigInt(b.id)}})).paidCents,0);
        const next=await newBooking(customerAuth.accessToken,'19:00');
        assert.equal(expect(await call('/payments/quote',{token:customerAuth.accessToken,body:{bookingId:next.id}}),201).json.paymentEnabled,false);
        expect(await call('/payments/create-intent',{token:customerAuth.accessToken,body:{bookingId:next.id}}),503);
        assert.equal(await db.paymentRecord.count({where:{bookingId:BigInt(next.id)}}),0,'An unresolved old checkout must block new collection at the same shop');
        await db.paymentRecord.update({where:{id:record.id},data:{providerBinding:record.providerBinding}});
        assert.equal(expect(await call('/payments/quote',{token:customerAuth.accessToken,body:{bookingId:next.id}}),201).json.paymentEnabled,true);
        expect(await call(`/bookings/${next.id}/cancel`,{token:customerAuth.accessToken,body:{}}),201);
        expect(await deliver(completed, 'invalid'), 400);
        expect(await deliver({ ...envelope('wrong_merchant', 'payment', payment), merchant_id: 'another_merchant' }), 400);
        expect(await deliver(envelope('wrong_location', 'payment', { ...payment, location_id: 'another_location' })), 400);
        expect(await deliver(envelope('wrong_currency', 'payment', { ...payment, amount_money: { amount: 11000, currency: 'AUD' } })), 400);
        expect(await deliver(envelope('wrong_amount', 'payment', { ...payment, total_money: { amount: 11001, currency: 'USD' } })), 400);
        expect(await deliver(envelope('wrong_order', 'payment', { ...payment, order_id: 'another_order' })), 400);
        expect(await deliver(envelope('pending', 'payment', { ...payment, status: 'PENDING' })), 201);
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).paymentStatus, 'UNPAID');
        const deliveries = await Promise.all([deliver(completed), deliver(completed)]); deliveries.forEach(r => expect(r, 201));
        expect(await deliver(envelope('completed_again', 'payment', payment)), 201);
        expect(await deliver({ ...completed, changed: true }), 409);
        expect(await deliver(envelope('different_payment', 'payment', { ...payment, id: `${paymentId}_other` })), 409);
        expect(await deliver(envelope('late_failure', 'payment', { ...payment, status: 'FAILED' })), 201);
        record = await db.paymentRecord.findUniqueOrThrow({ where: { id: record.id } }); assert.equal(record.providerPaymentId, paymentId); assert.equal(record.status, 'SUCCEEDED');
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'PAYMENT' } }), 1);
        const options = { token: customerAuth.accessToken, body: { amountCents: 1234 }, extra: { 'Idempotency-Key': `test:${prefix}:square-refund` } };
        payments.square=new SquareProvider({...env,SQUARE_LOCATION_ID:'changed_location'},transport);
        expect(await call('/payments/confirm',{token:customerAuth.accessToken,body:{paymentIntentId:paymentId}}),503);
        expect(await call(`/bookings/${b.id}/refund-partial`,options),503);assert.equal(refundCalls,0);assert.equal(await db.refundRequest.count({where:{bookingId:BigInt(b.id)}}),0);
        const driftRefund=envelope('refund_binding_changed','refund',{id:`drift_refund_${prefix}`,payment_id:paymentId,order_id:orderId,location_id:'changed_location',amount_money:{amount:1234,currency:'USD'},status:'COMPLETED'});
        expect(await deliver(driftRefund),503);assert.equal((await db.booking.findUniqueOrThrow({where:{id:BigInt(b.id)}})).refundedCents,0);
        payments.square=new SquareProvider(env,transport);
        expect(await call(`/bookings/${b.id}/refund-partial`, options), 201);
        expect(await call(`/bookings/${b.id}/refund-partial`, options), 201); assert.equal(refundCalls, 1);
        expect(await call(`/bookings/${b.id}/refund-partial`, { ...options, body: { amountCents: 1235 } }), 409);
        const first = [...refunds.values()][0]; expect(await deliver(envelope('refund_first', 'refund', first)), 201);
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(b.id), type: 'REFUND' } }), 1);
        refundMode = 'PENDING';
        const pendingOptions = { token: customerAuth.accessToken, body: { amountCents: 222 }, extra: { 'Idempotency-Key': `test:${prefix}:square-pending` } };
        const pending = expect(await call(`/bookings/${b.id}/refund-partial`, pendingOptions), 201).json; assert.equal(pending.status, 'PENDING'); assert.equal(pending.refundedAmount, 0);
        const pendingRefund = [...refunds.values()][1]; expect(await deliver(envelope('refund_failed', 'refund', { ...pendingRefund, status: 'FAILED' })), 201);
        assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: pending.requestId } })).status, 'FAILED');
        expect(await deliver(envelope('refund_late_pending', 'refund', pendingRefund)), 201);
        assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: pending.requestId } })).status, 'FAILED');
        refundMode = 'TIMEOUT';
        const timeoutOptions = { token: customerAuth.accessToken, body: { amountCents: 333 }, extra: { 'Idempotency-Key': `test:${prefix}:square-timeout` } };
        expect(await call(`/bookings/${b.id}/refund-partial`, timeoutOptions), 503);
        const timed = await db.refundRequest.findUniqueOrThrow({ where: { idempotencyKey: timeoutOptions.extra['Idempotency-Key'] } }); assert.equal(timed.status, 'RETRYABLE');
        const timedRefund = [...refunds.values()][2];
        // Missing correlation may not guess which local request was accepted after a timeout.
        expect(await deliver(envelope('refund_without_reference', 'refund', { ...timedRefund, reason: undefined })), 503);
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } })).refundedCents, 1234);
        expect(await deliver(envelope('refund_after_timeout', 'refund', timedRefund)), 201);
        const retried = expect(await call(`/bookings/${b.id}/refund-partial`, timeoutOptions), 201).json; assert.equal(retried.requestId, timed.id); assert.equal(refundCalls, 3);
        expect(await deliver(envelope('refund_repeat', 'refund', timedRefund)), 201);
        const saved = await db.booking.findUniqueOrThrow({ where: { id: BigInt(b.id) } }); assert.equal(saved.refundedCents, 1567); assert.equal(saved.paymentStatus, 'PARTIALLY_REFUNDED');
        assert.equal(await db.merchantTransaction.count({ where: { bookingId: saved.id, type: 'REFUND' } }), 2);
      } finally {
        payments.square = savedSquare;
        if (savedProvider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = savedProvider;
        if (savedExternal === undefined) delete process.env.PAYMENT_EXTERNAL_ENABLED; else process.env.PAYMENT_EXTERNAL_ENABLED = savedExternal;
      }
    });
    await t.test('Studio CRUD persists real data and preserves store and administrator scope', async () => {
      const region = expect(await call('/studio/regions', { token: adminAuth.accessToken, body: { kind: 'state', english: `Test ${prefix}`, chinese: '测试州', abbr: 'TS', sort: 100 } }), 201).json.item; regionIds.push(BigInt(region.id));
      expect(await call(`/studio/regions/${region.id}`, { token: merchantAuth.accessToken, method: 'PATCH', body: { chinese: '未授权' } }), 403);
      const updated = expect(await call(`/studio/regions/${region.id}`, { token: adminAuth.accessToken, method: 'PATCH', body: { chinese: '测试更新' } }), 200).json.item; assert.equal(updated.chinese, '测试更新');
      const child = expect(await call('/studio/regions', { token: adminAuth.accessToken, body: { kind: 'city', parentId: region.id, english: `Test City ${prefix}`, chinese: '测试市', sort: 10 } }), 201).json.item; regionIds.push(BigInt(child.id));
      expect(await call(`/studio/regions/${region.id}`, { token: adminAuth.accessToken, method: 'DELETE' }), 409);
      expect(await call(`/studio/regions/${child.id}`, { token: adminAuth.accessToken, method: 'DELETE' }), 200);
      expect(await call(`/studio/regions/${region.id}`, { token: adminAuth.accessToken, method: 'DELETE' }), 200);
      expect(await call(`/studio/stores?shopId=${shops[0]}`, { token: merchantAuth.accessToken }), 403);
      const visible = expect(await call('/merchant/shops', { token: merchantAuth.accessToken }), 200).json; assert.ok(visible.some(shop => shop.id === String(shops[0])));
      expect(await call(`/studio/stores?shopId=${shops[0]}`, { token: outsiderAuth.accessToken }), 403);
      const hidden = expect(await call('/merchant/shops', { token: outsiderAuth.accessToken }), 200).json; assert.equal(hidden.some(shop => shop.id === String(shops[0])), false);
      expect(await call(`/studio/stores/${shops[0]}`, { token: outsiderAuth.accessToken, method: 'PATCH', body: { name: 'Intrusion' } }), 403);
      expect(await call(`/merchant/shops/${shops[0]}`, { token: outsiderAuth.accessToken, method: 'PATCH', body: { name: 'Intrusion' } }), 403);
      expect(await call(`/merchant/shops/${shops[0]}/services`, { token: outsiderAuth.accessToken }), 403);
      expect(await call(`/studio/services`, { token: outsiderAuth.accessToken, body: { shopId: shops[0].toString(), name: 'Intrusion', durationMinutes: 60, priceCents: 100 } }), 403);
      expect(await call('/studio/admins', { token: merchantAuth.accessToken }), 403);
      const created = expect(await call('/studio/services', { token: adminAuth.accessToken, body: { shopId: shops[0].toString(), name: `Studio Service ${prefix}`, durationMinutes: 60, priceCents: 12345 } }), 201).json.item; services.push(BigInt(created.id));
      expect(await call(`/studio/services/${created.id}`, { token: adminAuth.accessToken, method: 'PATCH', body: { priceCents: 12000 } }), 200);
      assert.equal((await db.shopService.findUniqueOrThrow({ where: { id: BigInt(created.id) } })).priceCents, 12000);
      expect(await call(`/studio/services/${created.id}`, { token: adminAuth.accessToken, method: 'DELETE' }), 200);
      const management = expect(await call(`/merchant/shops/${shops[0]}/services`, { token: merchantAuth.accessToken }), 200).json;
      assert.ok(management.some(x => x.id === created.id && !x.isActive));
      const accounts = expect(await call('/studio/users', { token: adminAuth.accessToken }), 200).json.items;
      assert.ok(accounts.every(x => !('passwordHash' in x)));
    });
    await t.test('multiple shops receive independent internal ledgers with explicit financial scope and immutable ownership', async () => {
      const savedProfile = await db.merchantProfile.findUniqueOrThrow({ where: { id: profile.id } });
      const added = [];
      for (let i=0;i<2;i++) {
        const ledgerOwner = await createUser('MERCHANT');
        const shop = expect(await call('/studio/stores', { token:adminAuth.accessToken, body:{ownerId:ledgerOwner.id.toString(),name:`Ledger ${prefix} ${i}`,shortName:`ledger-${prefix}-${i}`,timezone:'America/New_York'} }),201).json.item;
        shops.push(BigInt(shop.id)); added.push(shop);
        await db.shopAccountGrant.create({data:{sourceShopId:shops[0],targetShopId:BigInt(shop.id),permissions:['FINANCE_READ','BOOKINGS_READ'],createdById:admin.id,updatedById:admin.id,reason:'Explicit synthetic ledger reporting permission'}});
        const p=await db.merchantProfile.findUniqueOrThrow({where:{shopId:BigInt(shop.id)}});
        assert.equal(p.userId,ledgerOwner.id);assert.equal(p.balanceCents,0);assert.equal(p.pendingCents,0);assert.equal(p.totalEarnedCents,0);assert.equal(p.stripeAccountId,null);assert.equal(p.stripeOnboarding,false);
        assert.equal(await db.auditLog.count({where:{action:'PROFILE_CREATE',targetId:p.id,operatorId:admin.id}}),1);
        const amount=1234*(i+1);
        await db.$transaction([db.merchantTransaction.create({data:{profileId:p.id,type:'PAYMENT',amount,fee:0,net:amount,status:'COMPLETED',description:`Only ledger ${i}`}}),db.merchantProfile.update({where:{id:p.id},data:{balanceCents:amount,totalEarnedCents:amount}})]);
        expect(await call(`/studio/stores/${shop.id}`,{token:adminAuth.accessToken,method:'PATCH',body:{ownerId:outsider.id.toString()}}),409);
        assert.equal((await db.shop.findUniqueOrThrow({where:{id:BigInt(shop.id)}})).ownerId,ledgerOwner.id);
        const response=expect(await call(`/merchant/transactions?shopId=${shop.id}&page=1&pageSize=1`,{token:merchantAuth.accessToken}),200).json;
        assert.equal(response.shopId,shop.id);assert.equal(response.total,1);assert.equal(response.items[0].amount,amount);
        const tax=expect(await call(`/merchant/tax-report?shopId=${shop.id}`,{token:merchantAuth.accessToken}),200).json;
        assert.equal(tax.shopId,shop.id);assert.equal(tax.total_gross,amount);assert.equal(tax.net_earnings,amount);
        const dashboard=expect(await call(`/merchant/shops/${shop.id}/dashboard`,{token:merchantAuth.accessToken}),200).json;
        assert.equal(dashboard.shopId,shop.id);assert.equal(dashboard.overview.totalRevenue,amount);
        expect(await call(`/merchant/transactions?shopId=${shop.id}`,{token:outsiderAuth.accessToken}),403);
        expect(await call(`/merchant/tax-report?shopId=${shop.id}`,{token:outsiderAuth.accessToken}),403);
        expect(await call(`/merchant/tax-report/export?shopId=${shop.id}`,{token:outsiderAuth.accessToken}),403);
        expect(await call(`/merchant/application-status?shopId=${shop.id}`,{token:merchantAuth.accessToken}),200);
      }
      for(const route of ['/merchant/transactions','/merchant/tax-report','/merchant/tax-report/export','/merchant/application-status']) expect(await call(route,{token:merchantAuth.accessToken}),400);
      assert.deepEqual(await db.merchantProfile.findUniqueOrThrow({where:{id:profile.id}}),savedProfile,'Creating or viewing other shops never moves the old ledger');
      const adminDetail=expect(await call(`/admin/users/${merchant.id}`,{token:adminAuth.accessToken}),200).json;
      assert.ok(adminDetail.merchantProfiles.some(p=>p.id===profile.id.toString() && p.shopId===shops[0].toString()));
      assert.equal(adminDetail.merchantProfile,undefined);
    });
    await t.test('claimed coupon terms are frozen, quantities serialize with claims and unlimited claims are counted', async () => {
      const path = `/merchant/shops/${shops[0]}/coupons`;
      const create = async totalQuantity => {
        const item = expect(await call(path, { token: merchantAuth.accessToken, body: { title: `Coupon ${prefix}`, type: 'FIXED_AMOUNT', value: 100, totalQuantity, validFrom: '2020-01-01T00:00:00Z', validUntil: '2099-01-01T00:00:00Z' } }), 201).json;
        couponIds.push(BigInt(item.id)); return item;
      };
      expect(await call(path, { token: merchantAuth.accessToken, body: { title: 'Invalid', type: 'PERCENT', value: 100.5 } }), 400);
      const item = await create(0);
      expect(await call(`/coupons/${item.id}/claim`, { token: customerAuth.accessToken, body: {} }), 201);
      expect(await call(`/coupons/${item.id}/claim`, { token: attackerAuth.accessToken, body: {} }), 201);
      assert.equal((await db.coupon.findUniqueOrThrow({ where: { id: BigInt(item.id) } })).claimedCount, 2);
      const patch = body => call(`${path}/${item.id}`, { token: merchantAuth.accessToken, method: 'PATCH', body });
      for (const body of [{ type: 'PERCENT' }, { value: 101 }, { minSpendCents: 1 }, { validFrom: '2021-01-01T00:00:00Z' }, { validUntil: null }]) expect(await patch(body), 409);
      expect(await patch({ perUserLimit: 2 }), 400);
      expect(await patch({ shopId: shops[1].toString() }), 400);
      expect(await call(`${path}/${item.id}`, { token: outsiderAuth.accessToken, method: 'PATCH', body: { title: 'Intrusion' } }), 403);
      expect(await patch({ totalQuantity: 1 }), 409);
      expect(await call(`/admin/coupons/${item.id}`, { token: adminAuth.accessToken, method: 'PATCH', body: { value: 101 } }), 409);
      expect(await call(`/admin/coupons/${item.id}`, { token: adminAuth.accessToken, method: 'PATCH', body: { shopId: shops[1].toString() } }), 409);
      expect(await call(`/admin/coupons/${item.id}`, { token: adminAuth.accessToken, method: 'PATCH', body: { totalQuantity: 1 } }), 409);
      for (const body of [{ amount: 1.01 }, { threshold: 1 }, { startDate: '2021-01-01' }, { endDate: '2098-01-01' }, { endDate: '' }, { type: 'general' }, { totalQuantity: 1 }]) {
        expect(await call(`/studio/coupons/${item.id}`, { token: adminAuth.accessToken, method: 'PATCH', body }), 409);
      }
      expect(await call(`/studio/coupons/${item.id}`, { token: merchantAuth.accessToken, method: 'PATCH', body: { name: 'Intrusion' } }), 403);
      const studio = expect(await call(`/studio/coupons/${item.id}`, { token: adminAuth.accessToken, method: 'PATCH', body: { name: 'Clearer issued coupon label', amount: 1, threshold: 0, startDate: '2020-01-01', endDate: '2099-01-01' } }), 200).json.item;
      assert.equal(studio.name, 'Clearer issued coupon label');
      assert.equal((await db.coupon.findUniqueOrThrow({ where: { id: BigInt(item.id) } })).validUntil.toISOString(), '2099-01-01T00:00:00.000Z');
      expect(await patch({ title: 'Clarified label', value: 100, totalQuantity: 2 }), 200);
      expect(await call(`/coupons/${item.id}/claim`, { token: merchantAuth.accessToken, body: {} }), 403);
      const race = await create(2);
      expect(await call(`/coupons/${race.id}/claim`, { token: customerAuth.accessToken, body: {} }), 201);
      const results = await Promise.all([
        call(`/coupons/${race.id}/claim`, { token: attackerAuth.accessToken, body: {} }),
        call(`${path}/${race.id}`, { token: merchantAuth.accessToken, method: 'PATCH', body: { totalQuantity: 1 } }),
      ]);
      assert.ok(results[0].status === 409 || results[1].status === 409);
      assert.ok([201, 409].includes(results[0].status)); assert.ok([200, 409].includes(results[1].status));
      const saved = await db.coupon.findUniqueOrThrow({ where: { id: BigInt(race.id) } });
      assert.ok(saved.claimedCount <= saved.totalQuantity);
      assert.equal(saved.claimedCount, await db.userCoupon.count({ where: { couponId: saved.id } }));
    });
    await t.test('legacy admin financial views expose actual payments and refunds rather than quote prices', async () => {
      const totals = await db.booking.aggregate({ _sum: { paidCents: true, refundedCents: true } });
      const result = expect(await call('/admin/dashboard/stats', { token: adminAuth.accessToken }), 200).json;
      assert.equal(result.paidCents, totals._sum.paidCents ?? 0); assert.equal(result.refundedCents, totals._sum.refundedCents ?? 0);
      assert.equal(result.gmv, (totals._sum.paidCents ?? 0) - (totals._sum.refundedCents ?? 0));
      assert.equal(result.amountBasis, 'paidCents-refundedCents'); assert.equal(result.trendBasis, 'booking-created-utc');
      expect(await call('/admin/dashboard/stats?range=invalid', { token: adminAuth.accessToken }), 400);
      const detail = expect(await call(`/admin/bookings/${booking.id}`, { token: adminAuth.accessToken }), 200).json;
      assert.equal(detail.priceCents, 10000); assert.equal(detail.totalCents, 11000);
      assert.equal(detail.paidCents, 11000); assert.equal(detail.refundedCents, 11000); assert.equal(detail.netPaidCents, 0);
      const list = expect(await call(`/admin/bookings?bookingNo=${encodeURIComponent(detail.bookingNo)}`, { token: adminAuth.accessToken }), 200).json.items;
      assert.equal(list.length, 1); assert.equal(list[0].netPaidCents, 0); assert.equal(list[0].paidCents, detail.paidCents);
      const user = expect(await call(`/admin/users/${customer.id}`, { token: adminAuth.accessToken }), 200).json;
      const recent = user.recentBookings.find(x => x.id === booking.id); assert.ok(recent); assert.equal(recent.refundedCents, 11000);
    });
    await t.test('legacy admin account suspension atomically revokes sessions and reactivation never revives them', async () => {
      const before = await db.authSession.count({ where: { userId: outsider.id, revokedAt: null } }); assert.ok(before > 0);
      // A failed audit insert must roll back both the status and all session revocations.
      await assert.rejects(() => app.get(UserManageService).updateStatus(outsider.id.toString(), { status: 'SUSPENDED' }, '9223372036854775807'));
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: outsider.id } })).status, 'ACTIVE');
      assert.equal(await db.authSession.count({ where: { userId: outsider.id, revokedAt: null } }), before);
      expect(await call(`/admin/users/${admin.id}/status`, { token: adminAuth.accessToken, method: 'PATCH', body: { status: 'SUSPENDED' } }), 400);
      const path = `/admin/users/${outsider.id}/status`;
      expect(await call(path, { token: adminAuth.accessToken, method: 'PATCH', body: { status: 'SUSPENDED', reason: 'Integration test' } }), 200);
      assert.equal(await db.authSession.count({ where: { userId: outsider.id, revokedAt: null } }), 0);
      expect(await call('/auth/me', { token: outsiderAuth.accessToken }), 401);
      expect(await call(path, { token: adminAuth.accessToken, method: 'PATCH', body: { status: 'ACTIVE' } }), 200);
      expect(await call('/auth/me', { token: outsiderAuth.accessToken }), 401);
      expect(await call('/auth/refresh', { body: { refreshToken: outsiderAuth.refreshToken } }), 401);
      const fresh = expect(await call('/auth/login', { body: { identifier: outsider.email, password } }), 200).json; outsiderAuth = fresh;
      expect(await call('/auth/me', { token: fresh.accessToken }), 200);
      const audit = await db.auditLog.findFirstOrThrow({ where: { operatorId: admin.id, targetId: outsider.id, action: 'USER_SUSPENDED' } });
      assert.equal(audit.detail.revokedSessions, before);
      const concurrent = await Promise.all([
        call('/auth/refresh', { body: { refreshToken: fresh.refreshToken } }),
        call(path, { token: adminAuth.accessToken, method: 'PATCH', body: { status: 'SUSPENDED' } }),
      ]);
      assert.ok([200, 401].includes(concurrent[0].status)); expect(concurrent[1], 200);
      assert.equal(await db.authSession.count({ where: { userId: outsider.id, revokedAt: null } }), 0);
      expect(await call(path, { token: adminAuth.accessToken, method: 'PATCH', body: { status: 'ACTIVE' } }), 200);
      if (concurrent[0].status === 200) expect(await call('/auth/me', { token: concurrent[0].json.accessToken }), 401);
    });
    outsiderAuth = await login(outsider);
    await t.test('merchant finance reads only committed ledger entries and exact signed cents', async () => {
      const ledger = await db.merchantTransaction.findMany({ where: { profileId: profile.id } });
      const result = expect(await call(`/merchant/transactions?shopId=${shops[0]}&page=1&pageSize=100`, { token: merchantAuth.accessToken }), 200).json;
      assert.equal(result.total, ledger.length); assert.equal(result.items.length, ledger.length);
      assert.ok(result.items.some(x => x.type === 'PAYMENT')); assert.ok(result.items.some(x => x.type === 'REFUND')); assert.ok(result.items.every(x => x.type !== 'PAYOUT'));
      assert.equal(new Set(result.items.map(x => x.id)).size, ledger.length);
      const dashboard = expect(await call(`/merchant/shops/${shops[0]}/dashboard`, { token: merchantAuth.accessToken }), 200).json;
      assert.equal(dashboard.overview.totalRevenue, ledger.reduce((sum, r) => sum + r.amount, 0));
      assert.equal(dashboard.overview.netRevenue, ledger.reduce((sum, r) => sum + r.net, 0));
      const tax = expect(await call(`/merchant/tax-report?shopId=${shops[0]}`, { token: merchantAuth.accessToken }), 200).json;
      assert.equal(tax.total_refunds, -ledger.filter(x => x.type === 'REFUND').reduce((sum, r) => sum + r.amount, 0));
      assert.equal(tax.total_net, ledger.reduce((sum, r) => sum + r.net, 0));
      const csv = expect(await call(`/merchant/tax-report/export?shopId=${shops[0]}`, { token: merchantAuth.accessToken }), 200);
      assert.equal(csv.text.trim().split('\n').length, ledger.length + 1);
    });
    await t.test('online-booking and review switches are enforced by the server while offline services remain visible', async () => {
      const legacyStore = expect(await call(`/studio/stores?shopId=${shops[0]}`, { token: adminAuth.accessToken }), 200).json.items[0];
      assert.equal(legacyStore.features.onlineBooking, true);
      expect(await call(`/studio/stores/${shops[0]}`, { token: adminAuth.accessToken, method: 'PATCH', body: { subtitle: 'Preserve legacy feature defaults' } }), 200);
      assert.equal((await db.shop.findUniqueOrThrow({ where: { id: shops[0] } })).studioProfile.features.onlineBooking, true);
      const created = await Promise.all(['19:00', '20:00'].map(hour => newBooking(customerAuth.accessToken, hour)));
      for (const b of created) {
        const pi = expect(await call('/payments/create-intent', { token: customerAuth.accessToken, body: { bookingId: b.id } }), 201).json;
        expect(await call('/payments/confirm', { token: customerAuth.accessToken, body: { paymentIntentId: pi.paymentIntentId } }), 201);
        // A review needs an actually finished service. Keep the real payment flow,
        // then explicitly age only this synthetic fixture and its resource rows.
        const ended = new Date('2020-01-15T18:00:00Z'), started = new Date(+ended - 3600000);
        await db.booking.update({ where: { id: BigInt(b.id) }, data: { bookingDate: new Date('2020-01-15T00:00:00Z'), startTime: started, endTime: ended } });
        await db.bookingItem.updateMany({ where: { bookingId: BigInt(b.id) }, data: { startAtUtc: started, endAtUtc: ended } });
        await db.bookingResourceLock.updateMany({ where: { bookingId: BigInt(b.id) }, data: { startAtUtc: started, endAtUtc: ended } });
        expect(await call(`/merchant/bookings/${b.id}/complete`, { token: merchantAuth.accessToken, body: {} }), 201);
      }
      // Update through the actual Studio API; profile flags must be enforced outside the UI.
      const updateFlags = features => call(`/studio/stores/${shops[0]}`, { token: adminAuth.accessToken, method: 'PATCH', body: { features } });
      expect(await updateFlags({ onlineBooking: false, reviews: false }), 200);
      const slotQuery = `/bookings/slots?shopId=${shops[0]}&serviceId=${services[0]}&therapistId=${therapists[0]}&date=2031-01-16`;
      try {
        assert.deepEqual(expect(await call(`/shops/${shops[0]}`), 200).json.features, { onlineBooking: false, reviews: false });
        expect(await call(`/shops/${shops[0]}/services`), 200);
        expect(await call(slotQuery, { token: customerAuth.accessToken }), 400);
        const disabledBooking = expect(await call('/bookings', { token: customerAuth.accessToken,
          body: await withBookingContact(customerAuth.accessToken, { ...bookingData('09:00'), date: '2031-01-16' }) }), 400).json;
        assert.equal(disabledBooking.message, 'Online booking is unavailable for this shop');
        expect(await call('/reviews', { token: customerAuth.accessToken, body: { bookingId: created[0].id, rating: 5 } }), 400);
        expect(await updateFlags({ onlineBooking: true, reviews: true }), 200);
        expect(await call(slotQuery, { token: customerAuth.accessToken }), 200);
        expect(await call('/reviews', { token: attackerAuth.accessToken, body: { bookingId: created[0].id, rating: 5 } }), 404);
        const duplicate = await Promise.all([call('/reviews', { token: customerAuth.accessToken, body: { bookingId: created[0].id, rating: 5 } }), call('/reviews', { token: customerAuth.accessToken, body: { bookingId: created[0].id, rating: 5 } })]);
        assert.deepEqual(duplicate.map(x => x.status).sort(), [201, 409]);
        const review = duplicate.find(x => x.status === 201).json;
        expect(await call('/reviews', { token: customerAuth.accessToken, body: { bookingId: created[1].id, rating: 1 } }), 201);
        const aggregate = await db.shop.findUniqueOrThrow({ where: { id: shops[0] } }); assert.equal(Number(aggregate.avgRating), 3); assert.equal(aggregate.reviewCount, 2);
        expect(await call(`/reviews/${review.id}`, { token: attackerAuth.accessToken, method: 'PATCH', body: { rating: 1 } }), 404);
        expect(await call(`/reviews/${review.id}`, { token: customerAuth.accessToken, method: 'PATCH', body: { images: [{ source: 'unsafe' }] } }), 400);
        expect(await updateFlags({ onlineBooking: true, reviews: false }), 200);
        expect(await call(`/reviews/${review.id}`, { token: customerAuth.accessToken, method: 'PATCH', body: { rating: 1 } }), 400);
        assert.equal(expect(await call(`/reviews/shop/${shops[0]}`), 200).json.items.length, 2, 'Disabling new reviews preserves existing public reviews');
        expect(await call(`/reviews/${review.id}`, { token: customerAuth.accessToken, method: 'DELETE' }), 200);
      } finally { expect(await updateFlags({ onlineBooking: true, reviews: true }), 200); }
    });
    await t.test('merchant business hours and inactive resource management remain reversible', async () => {
      // Management reversibility uses an unbooked shop. The original shop has
      // committed future reservations and must reject destructive reconfiguration.
      expect(await call(`/merchant/shops/${shops[0]}/business-hours`, { token: merchantAuth.accessToken, body: { hours: { monday: [{ open: '09:00', close: '18:00' }] } } }), 409);
      const emptyShop = await db.shop.create({ data: { ownerId: merchant.id, shortName: `management-${prefix}`, name: `Management ${prefix}`, phone: 'TEST-ONLY', address: 'Test address', city: 'Test', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', status: 'APPROVED', timezone: 'America/New_York', businessHours: hours } }); shops.push(emptyShop.id);
      const managementOwner = await createUser('MERCHANT'); await db.shopLoginBinding.create({data:{shopId:emptyShop.id,userId:managementOwner.id,createdById:admin.id,reason:'Independent management fixture account'}});
      await db.shopAccountGrant.create({data:{sourceShopId:shops[0],targetShopId:emptyShop.id,permissions:['RESERVATION_CONFIG','SHOP_SETTINGS_MANAGE','CATALOG_MANAGE'],createdById:admin.id,updatedById:admin.id,reason:'Explicit unbooked management fixture'}});
      const emptyTherapist = await db.therapist.create({ data: { shopId: emptyShop.id, name: 'Unbooked test therapist' } }); therapists.push(emptyTherapist.id);
      await db.therapistShift.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ therapistId: emptyTherapist.id, weekday, startMin: 480, endMin: 1320 })) });
      expect(await call(`/merchant/shops/${emptyShop.id}/business-hours`, { token: merchantAuth.accessToken, body: { hours: { monday: { open: '25:00', close: '26:00' } } } }), 400);
      const saved = expect(await call(`/merchant/shops/${emptyShop.id}/business-hours`, { token: merchantAuth.accessToken, body: { hours: { monday: [{ open: '09:00', close: '18:00' }] } } }), 201).json;
      assert.equal(saved.businessHours.monday.open, '09:00'); assert.equal(saved.businessHours.tuesday.closed, true);
      expect(await call(`/merchant/therapists/${emptyTherapist.id}`, { token: merchantAuth.accessToken, method: 'DELETE' }), 200);
      const management = expect(await call(`/merchant/shops/${emptyShop.id}/therapists`, { token: merchantAuth.accessToken }), 200).json;
      assert.ok(management.some(x => x.id === emptyTherapist.id.toString() && !x.isActive));
      expect(await call(`/merchant/therapists/${emptyTherapist.id}`, { token: merchantAuth.accessToken, method: 'PATCH', body: { isActive: true } }), 200);
      assert.equal((await db.therapist.findUniqueOrThrow({ where: { id: emptyTherapist.id } })).isActive, true);
    });
    await t.test('DST-invalid slots and external merchant account operations fail explicitly', async () => {
      assert.throws(() => localInstant('2031-03-09', '02:30', 'America/New_York'), /daylight saving/);
      assert.throws(() => localInstant('2031-11-02', '01:30', 'America/New_York'), /daylight saving/);
      expect(await call('/merchant/payout', { token: merchantAuth.accessToken, body: { amountCents: 1000 } }), 503);
      expect(await call('/merchant/stripe/onboarding', { token: merchantAuth.accessToken, body: { shopId: shops[0].toString() } }), 503);
    });
    await t.test('Studio filters validate dates and combine booking, payment and ownership predicates', async () => {
      const query = `shopId=${shops[0]}&status=COMPLETED&paymentStatus=PAID&startDate=2020-01-15&endDate=2020-01-15`;
      const expectedRows = await db.booking.findMany({ where: { shopId: shops[0], deletedAt: null, status: 'COMPLETED', paymentStatus: 'PAID', bookingDate: new Date('2020-01-15T00:00:00Z') } });
      assert.equal(expectedRows.length, 2, 'The filter must exercise real completed paid fixtures rather than an empty page');
      const page = expect(await call(`/studio/service-orders?${query}`, { token: adminAuth.accessToken }), 200).json;
      assert.equal(page.total, expectedRows.length);
      assert.deepEqual(page.items.map(x => x.id).sort(), expectedRows.map(x => String(x.id)).sort());
      expect(await call(`/studio/service-orders?${query}`, { token: customerAuth.accessToken }), 403);
      for (const bad of ['page=0', 'page=abc', 'page=1.5', 'pageSize=101', 'status=ALL', 'status=UNKNOWN', 'paymentStatus=COMPLETED', 'startDate=2031-02-29', 'startDate=0000-01-01', 'startDate=2031-01-16&endDate=2031-01-15', 'startDate=2031-01-15T00:00:00Z']) {
        expect(await call(`/studio/service-orders?${bad}`, { token: adminAuth.accessToken }), 400);
      }
      expect(await call('/studio/services?isActive=maybe', { token: adminAuth.accessToken }), 400);
      expect(await call(`/studio/services?shopId=${shops[0]}&isActive=true`, { token: merchantAuth.accessToken }), 403);
      const owned = expect(await call(`/studio/services?shopId=${shops[0]}&isActive=true`, { token: adminAuth.accessToken }), 200).json;
      assert.ok(owned.items.every(x => x.shopId === String(shops[0]) && x.isActive));
      const account = expect(await call(`/studio/merchants?search=${encodeURIComponent(merchant.email)}&status=ACTIVE`, { token: adminAuth.accessToken }), 200).json;
      assert.equal(account.total, 1); assert.equal(account.items[0].id, String(merchant.id));
    });
    await t.test('both publishing APIs reject incomplete shops and save review reasons with the decision', async () => {
      const name = `Review ${prefix}`;
      const reviewOwner = await createUser('MERCHANT');
      const draft = expect(await call('/studio/stores', { token: adminAuth.accessToken, body: { ownerId: String(reviewOwner.id), name, shortName: `review-${prefix}` } }), 201).json.item;
      const sid = BigInt(draft.id); shops.push(sid);
      const before = await db.auditLog.count({ where: { targetId: sid, operatorId: admin.id } });
      assert.equal(draft.publicationReady, false);
      assert.ok(draft.publicationChecklist.some(x => x.key === 'timezone' && !x.complete));
      for (const [path, body] of [[`/studio/stores/${sid}`, { status: 'APPROVED' }], [`/admin/shops/${sid}/review`, { action: 'APPROVE' }]]) {
        expect(await call(path, { token: adminAuth.accessToken, method: 'PATCH', body }), 400);
        assert.equal((await db.shop.findUniqueOrThrow({ where: { id: sid } })).status, 'PENDING');
        assert.equal(await db.auditLog.count({ where: { targetId: sid, operatorId: admin.id } }), before);
      }
      expect(await call(`/admin/shops/${sid}/review`, { token: merchantAuth.accessToken, method: 'PATCH', body: { action: 'APPROVE' } }), 403);
      for (const body of [{ action: 'REJECT', reason: '  ' }, { action: 'REQUEST_INFO' }]) expect(await call(`/admin/shops/${sid}/review`, { token: adminAuth.accessToken, method: 'PATCH', body }), 400);
      expect(await call(`/studio/stores/${sid}`, { token: adminAuth.accessToken, method: 'PATCH', body: { status: 'REJECTED' } }), 400);
      expect(await call(`/admin/shops/${sid}/review`, { token: adminAuth.accessToken, method: 'PATCH', body: { action: 'REQUEST_INFO', reason: 'Complete the local publication checklist' } }), 200);
      const rejected = expect(await call(`/admin/shops/${sid}/review`, { token: adminAuth.accessToken, method: 'PATCH', body: { action: 'REJECT', reason: 'Missing verified store details' } }), 200).json;
      assert.equal(rejected.status, 'REJECTED'); assert.equal(rejected.reviewComment, 'Missing verified store details');
      assert.ok(await db.auditLog.findFirst({ where: { targetId: sid, operatorId: admin.id, action: 'REJECT' } }));
      assert.equal(expect(await call(`/studio/applications?search=${encodeURIComponent(name)}`, { token: adminAuth.accessToken }), 200).json.total, 0);
      assert.equal(expect(await call(`/studio/applications?status=ALL&search=${encodeURIComponent(name)}`, { token: adminAuth.accessToken }), 200).json.total, 1);

      const readReview = () => db.shop.findUniqueOrThrow({
        where: { id: sid },
        select: { status: true, reviewComment: true, reviewedAt: true, reviewedBy: true },
      });
      const initialReview = await readReview();
      const correctedReason = 'A verified street address is required';
      const updateReview = reason => call(`/studio/stores/${sid}`, {
        token: adminAuth.accessToken, method: 'PATCH', body: { status: 'REJECTED', reviewReason: reason },
      });
      const corrected = expect(await updateReview(`  ${correctedReason}  `), 200).json.item;
      assert.equal(corrected.status, 'REJECTED');
      assert.equal(corrected.reviewComment, correctedReason);
      const savedReview = await readReview();
      assert.equal(savedReview.status, 'REJECTED');
      assert.equal(savedReview.reviewComment, correctedReason);
      assert.equal(savedReview.reviewedBy, admin.id);
      assert.ok(savedReview.reviewedAt > initialReview.reviewedAt);
      assert.equal(corrected.reviewedAt, savedReview.reviewedAt.toISOString());

      const directory = expect(await call(`/studio/stores?shopId=${sid}&status=REJECTED`, { token: adminAuth.accessToken }), 200).json;
      const applications = expect(await call(`/studio/applications?status=REJECTED&search=${encodeURIComponent(name)}`, { token: adminAuth.accessToken }), 200).json;
      for (const page of [directory, applications]) {
        assert.equal(page.total, 1);
        assert.equal(page.items[0].id, String(sid));
        assert.equal(page.items[0].reviewComment, correctedReason);
        assert.equal(page.items[0].reviewedAt, savedReview.reviewedAt.toISOString());
      }
      const readinessPath = `/admin/shop-readiness/${sid}`;
      const rejectedReadiness = expect(await call(readinessPath, { token: adminAuth.accessToken }), 200).json;
      assert.equal(rejectedReadiness.shop.status, 'REJECTED');
      assert.equal(rejectedReadiness.publication.ready, false);
      assert.equal(rejectedReadiness.publication.publicVisible, false);
      expect(await call(`/shops/${sid}`), 404);

      expect(await updateReview(correctedReason), 200);
      assert.deepEqual(await readReview(), savedReview);
      const reviewAudit = await db.auditLog.findMany({
        where: { targetType: 'stores', targetId: sid, operatorId: admin.id, action: 'STUDIO_UPDATE' },
      });
      const reviewDecisions = reviewAudit.filter(log => log.detail?.reason !== undefined);
      assert.equal(reviewDecisions.length, 1);
      assert.deepEqual(reviewDecisions[0].detail, {
        fields: ['status', 'reviewReason'], previousStatus: 'REJECTED', newStatus: 'REJECTED', reason: correctedReason,
      });

      const canonicalHours = Object.fromEntries(Object.entries(hours).map(([day, h]) => [day, { ...h, closed: false }]));
      const completed = expect(await call(`/studio/stores/${sid}`, { token: adminAuth.accessToken, method: 'PATCH', body: { phones: ['TEST-ONLY'], address: 'Test address', city: 'Test', state: 'NY', timezone: 'America/New_York', latitude: 40.7, longitude: -73.9, businessHours: canonicalHours, status: 'PENDING' } }), 200).json.item;
      assert.equal(completed.publicationReady, true);
      await db.user.update({ where: { id: reviewOwner.id }, data: { status: 'SUSPENDED' } });
      try {
        const published = expect(await call(`/admin/shops/${sid}/review`, { token: adminAuth.accessToken, method: 'PATCH', body: { action: 'APPROVE' } }), 200).json;
        assert.equal(published.status,'APPROVED','Public directory publication is independent of merchant login activation');
        const publishedReadiness = expect(await call(readinessPath, { token: adminAuth.accessToken }), 200).json;
        assert.equal(publishedReadiness.publication.ready, true);
        assert.equal(publishedReadiness.publication.publicVisible, true);
        assert.equal(publishedReadiness.access.loginReady, false);
        assert.equal(expect(await call(`/shops/${sid}`), 200).json.id, String(sid));
        expect(await call('/auth/login',{body:{identifier:reviewOwner.email,password}}),401);
      }
      finally { await db.user.update({ where: { id: reviewOwner.id }, data: { status: 'ACTIVE' } }); }
      const approved = expect(await call(`/admin/shops/${sid}/review`, { token: adminAuth.accessToken, method: 'PATCH', body: { action: 'APPROVE' } }), 200).json;
      assert.equal(approved.status, 'APPROVED'); assert.equal(approved.reviewedBy, String(admin.id));
      expect(await call(`/studio/stores?shopId=${sid}&status=APPROVED`, { token: outsiderAuth.accessToken }), 403);
      const foreign = expect(await call('/merchant/shops', { token: outsiderAuth.accessToken }), 200).json; assert.equal(foreign.some(shop => shop.id === String(sid)),false);
    });
    await t.test('coupon scopes paginate beyond 500 rows without dropping another type or widening ownership', async () => {
      const marker = `Page ${prefix}`;
      const base = { type: 'FIXED_AMOUNT', value: 100, minSpendCents: 0, totalQuantity: 0, perUserLimit: 1, validFrom: new Date('2030-01-01T00:00:00Z'), status: 'ACTIVE' };
      const tracked = await db.$transaction(async tx => {
        await tx.coupon.createMany({ data: [0, 1].map(i => ({ ...base, title: `${marker} merchant ${i}`, shopId: shops[0] })) });
        await tx.coupon.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ ...base, title: `${marker} general ${i}` })) });
        return tx.coupon.findMany({ where: { title: { startsWith: marker } }, select: { id: true } });
      });
      couponIds.push(...tracked.map(x => x.id)); assert.equal(tracked.length, 503);
      const requestPage = (scope, page, token = adminAuth.accessToken) => call(`/studio/coupons?scope=${scope}&search=${encodeURIComponent(marker)}&page=${page}&pageSize=1`, { token });
      const first = expect(await requestPage('merchant', 1), 200).json;
      const second = expect(await requestPage('merchant', 2), 200).json;
      assert.equal(first.total, 2); assert.equal(second.total, 2); assert.notEqual(first.items[0].id, second.items[0].id);
      assert.ok([...first.items, ...second.items].every(x => x.type === 'merchant' && typeof x.claimedCount === 'number'));
      const last = expect(await call(`/studio/coupons?scope=general&search=${encodeURIComponent(marker)}&page=21&pageSize=25`, { token: adminAuth.accessToken }), 200).json;
      assert.equal(last.total, 501); assert.equal(last.items.length, 1); assert.equal(last.items[0].type, 'general');
      expect(await requestPage('general', 1, merchantAuth.accessToken), 403);
      expect(await requestPage('merchant', 1, merchantAuth.accessToken), 403);
      const merchantCoupons = expect(await call(`/merchant/shops/${shops[0]}/coupons`, {token:merchantAuth.accessToken}),200).json;
      assert.equal(merchantCoupons.filter(row => row.title.startsWith(marker)).length,2);
      expect(await call(`/merchant/shops/${shops[0]}/coupons`,{token:outsiderAuth.accessToken}),403);
      expect(await call('/studio/coupons?scope=invalid', { token: adminAuth.accessToken }), 400);
    });
    await t.test('work queues use real scoped states and keep publication distinct from store totals', async () => {
      const adminSummary = expect(await call('/studio/summary', { token: adminAuth.accessToken }), 200).json;
      assert.equal(adminSummary.workQueues.pendingShops, await db.shop.count({ where: { deletedAt: null, status: 'PENDING' } }));
      assert.equal(adminSummary.workQueues.confirmedPaidBookings, await db.booking.count({ where: { deletedAt: null, status: 'CONFIRMED', paymentStatus: 'PAID' } }));
      assert.equal(adminSummary.storeStatuses.published, await db.shop.count({ where: { deletedAt: null, status: 'APPROVED' } }));
      expect(await call('/studio/summary', { token: merchantAuth.accessToken }), 403);
      const own = expect(await call('/merchant/shops', {token:merchantAuth.accessToken}),200).json;
      assert.ok(own.some(shop => shop.id === String(shops[0])));
      assert.equal(own.some(shop => shop.id === String(shops.at(-1))),false, 'No binding/grant to the publishing fixture');
    });
    await t.test('admin audit queries enforce real JWT roles, bounded pagination and safe projections', async () => {
      await db.auditLog.create({ data: { action: 'ADMIN_TEST', targetType: 'stores', targetId: shops[0], operatorId: admin.id, detail: { fields: ['name', 'password', 'token'], reason: 'synthetic-sensitive-reason', password: 'synthetic-sensitive-secret', arbitrary: { email: 'synthetic-sensitive-address' }, previousStatus: 'PENDING', newStatus: 'APPROVED' } } });
      const path = `/admin/audit-logs?action=ADMIN_TEST&targetType=stores&targetId=${shops[0]}&operatorId=${admin.id}&limit=1`;
      const result = expect(await call(path, { token: adminAuth.accessToken }), 200).json;
      assert.equal(result.meta.total, 1); assert.equal(result.items[0].operatorId, String(admin.id));
      assert.equal(JSON.stringify(result).includes('synthetic-sensitive'), false);
      assert.deepEqual(result.items[0].detail.fields, ['name']);
      expect(await call(path), 401); expect(await call(path, { token: merchantAuth.accessToken }), 403); expect(await call(path, { token: customerAuth.accessToken }), 403);
      expect(await call(`/admin/audit-logs/stores/${shops[0]}`, { token: merchantAuth.accessToken }), 403);
      for (const invalid of ['limit=101', 'page=1.5', 'targetId=9223372036854775808', 'operatorId=1.5', 'startDate=2031-02-29', 'startDate=2031-03-02&endDate=2031-03-01']) expect(await call(`/admin/audit-logs?${invalid}`, { token: adminAuth.accessToken }), 400);
    });
    await t.test('Studio order projections preserve original currency and timezone snapshots without guessing legacy zones', async () => {
      const booking = await db.booking.findFirstOrThrow({ where: { shopId: shops[0], deletedAt: null, bookingTimezone: { not: null } } });
      const shop = await db.shop.findUniqueOrThrow({ where: { id: shops[0] } });
      await db.shop.update({ where: { id: shop.id }, data: { timezone: 'Europe/London' } });
      await db.booking.update({ where: { id: booking.id }, data: { currency: 'EUR' } });
      try {
        const path = `/studio/service-orders?search=${booking.bookingNo}`;
        const row = expect(await call(path, { token: adminAuth.accessToken }), 200).json.items[0];
        assert.equal(row.currency, 'EUR'); assert.equal(row.shopTimezone, booking.bookingTimezone);
        assert.equal(row.localDate, '2031-01-15'); assert.match(row.localStartTime, /^\d{2}:\d{2}$/);
        await db.booking.update({ where: { id: booking.id }, data: { bookingTimezone: null } });
        const legacy = expect(await call(path, { token: adminAuth.accessToken }), 200).json.items[0];
        assert.equal(legacy.shopTimezone, null); assert.equal(legacy.localStartTime, null); assert.equal(legacy.localDate, null);
      } finally {
        await db.shop.update({ where: { id: shop.id }, data: { timezone: shop.timezone } });
        await db.booking.update({ where: { id: booking.id }, data: { currency: booking.currency, bookingTimezone: booking.bookingTimezone } });
      }
    });
    await t.test('concurrent admin suspension through both APIs preserves an active platform administrator', async t => {
      const activeAdmins = { role: 'ADMIN', status: 'ACTIVE', deletedAt: null };
      if (await db.user.count({ where: activeAdmins }) !== 1) {
        t.skip('Requires an isolated schema with only the test administrator active');
        return;
      }
      const secondAdmin = await createUser('ADMIN');
      const secondAdminAuth = expect(await call(
        '/auth/admin/password/login',
        { body: { identifier: secondAdmin.email, password } },
      ), 200).json;
      assert.equal(secondAdminAuth.user.role, 'ADMIN');
      const blocker = new PrismaClient({ datasources: { db: { url: target } } });
      const held = deferred(), release = deferred();
      const gate = {
        matches: sql => /\bFROM users FORCE INDEX \(PRIMARY\)/i.test(sql) && /\bFOR UPDATE\b/i.test(sql),
        attempts: [], expected: 2, ready: deferred(),
      };
      lockObserver.current = gate;
      const holding = blocker.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${admin.id} FOR UPDATE`);
        held.resolve();
        await within(release.promise, 15000, 'ADMIN_LOCK_BARRIER_RELEASE_TIMEOUT');
      }, { timeout: 20000 });
      void holding.catch(() => {});
      let pending = [], results;
      try {
        await within(held.promise, 5000, 'ADMIN_LOCK_BARRIER_NOT_HELD');
        pending = [
          call(`/studio/admins/${admin.id}`, { token: secondAdminAuth.accessToken, method: 'PATCH', body: { status: 'SUSPENDED' } }),
          call(`/admin/users/${secondAdmin.id}/status`, { token: adminAuth.accessToken, method: 'PATCH', body: { status: 'SUSPENDED', reason: 'Synthetic concurrent last-admin test' } }),
        ];
        await within(gate.ready.promise, 7000, 'TWO_ADMIN_TRANSACTIONS_DID_NOT_REACH_LOCK');
        assert.ok(gate.attempts.every(item => item.isolationLevel === 'ReadCommitted'));
        await waitForLockQueries(blocker, gate.attempts.map(item => item.connectionId), 'users');
        release.resolve();
        await holding;
        results = await Promise.all(pending);
      } finally {
        release.resolve();
        await holding.catch(() => {});
        await Promise.allSettled(pending);
        lockObserver.current = null;
        await blocker.$disconnect();
      }
      assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
      assert.equal(results.find(result => result.status === 400).json.message, 'At least one active platform administrator must remain');

      const firstRequestSucceeded = results[0].status === 200;
      const survivor = firstRequestSucceeded ? secondAdmin : admin;
      const survivorAuth = firstRequestSucceeded ? secondAdminAuth : adminAuth;
      const suspended = firstRequestSucceeded ? admin : secondAdmin;
      const suspendedAuth = firstRequestSucceeded ? adminAuth : secondAdminAuth;
      const remaining = await db.user.findMany({ where: activeAdmins, select: { id: true } });
      assert.deepEqual(remaining.map(row => row.id), [survivor.id]);
      expect(await call('/auth/me', { token: survivorAuth.accessToken }), 200);
      expect(await call('/auth/me', { token: suspendedAuth.accessToken }), 401);
      const path = `/studio/admins/${suspended.id}`;
      const renamed = expect(await call(path, { token: survivorAuth.accessToken, method: 'PATCH', body: { name: 'Renamed synthetic admin' } }), 200).json.item;
      assert.equal(renamed.status, 'SUSPENDED');
      assert.equal(renamed.name, 'Renamed synthetic admin');
      expect(await call(path, { token: survivorAuth.accessToken, method: 'PATCH', body: { status: 'ACTIVE' } }), 200);
      expect(await call('/auth/me', { token: suspendedAuth.accessToken }), 401);
    });
  } finally {
    if (app) await app.close();
    // Only tracked rows created by this suite are deleted, in foreign-key order.
    const existingBookings = await db.booking.findMany({ where: { userId: { in: users }, shopId: { in: shops } }, select: { id: true } });
    const ids = existingBookings.map(x => x.id);
    const records = await db.paymentRecord.findMany({ where: { bookingId: { in: ids } }, select: { id: true } });
    await db.paymentEvent.deleteMany({ where: { eventId: { in: [...eventIds, ...records.map(x => `confirmed:${x.id}`)] } } });
    await db.afterSalesEvent.deleteMany({ where: { case: { bookingId: { in: ids } } } });
    await db.afterSalesCase.deleteMany({ where: { bookingId: { in: ids } } });
    await db.refundRequest.deleteMany({ where: { bookingId: { in: ids } } });
    await db.paymentRecord.deleteMany({ where: { bookingId: { in: ids } } });
    await db.merchantTransaction.deleteMany({ where: { profile: { userId: { in: users } } } });
    await db.review.deleteMany({ where: { bookingId: { in: ids } } });
    await db.bookingResourceLock.deleteMany({ where: { bookingId: { in: ids } } });
    await db.bookingOperationReceipt.deleteMany({ where: { bookingId: { in: ids } } });
    await db.bookingSettlementEntry.deleteMany({ where: { bookingId: { in: ids }, referenceEntryId: { not: null } } });
    await db.bookingSettlementEntry.deleteMany({ where: { bookingId: { in: ids } } });
    await db.bookingAddOn.deleteMany({ where: { bookingId: { in: ids } } });
    await db.bookingItem.deleteMany({ where: { bookingId: { in: ids } } });
    await db.booking.deleteMany({ where: { id: { in: ids } } });
    await db.userCoupon.deleteMany({ where: { couponId: { in: couponIds } } });
    await db.coupon.deleteMany({ where: { id: { in: couponIds } } });
    await db.therapistService.deleteMany({ where: { therapist: { shopId: { in: shops } } } });
    await db.therapistTimeOff.deleteMany({ where: { therapist: { shopId: { in: shops } } } });
    await db.therapistShift.deleteMany({ where: { therapist: { shopId: { in: shops } } } });
    await db.therapist.deleteMany({ where: { shopId: { in: shops } } });
    await db.shopServiceVariant.deleteMany({ where: { serviceId: { in: services } } });
    await db.shopService.deleteMany({ where: { id: { in: services } } });
    await db.roomMaintenance.deleteMany({ where: { room: { shopId: { in: shops } } } });
    await db.shopRoom.deleteMany({ where: { shopId: { in: shops } } });
    await db.merchantProfile.deleteMany({ where: { userId: { in: users } } });
    await db.shopCertificate.deleteMany({ where: { shopId: { in: shops } } });
    await db.userFavorite.deleteMany({ where: { userId: { in: users }, shopId: { in: shops } } });
    await db.shopAccountGrant.deleteMany({ where: { OR: [{ sourceShopId: { in: shops } }, { targetShopId: { in: shops } }] } });
    await db.shopLoginBinding.deleteMany({ where: { shopId: { in: shops } } });
    await db.shopAlias.deleteMany({where:{shopId:{in:shops}}});
    await db.shop.deleteMany({ where: { id: { in: shops } } });
    await db.announcement.deleteMany({ where: { id: { in: announcementIds } } });
    await db.region.deleteMany({ where: { parentId: { in: regionIds } } });
    await db.region.deleteMany({ where: { id: { in: regionIds } } });
    await db.auditLog.deleteMany({ where: { operatorId: { in: users } } });
    await db.authSession.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    const remaining = await Promise.all([
      db.user.count({ where: { id: { in: users } } }), db.shop.count({ where: { id: { in: shops } } }),
      db.booking.count({ where: { id: { in: ids } } }), db.coupon.count({ where: { id: { in: couponIds } } }),
    ]);
    await db.$disconnect();
    assert.deepEqual(remaining, [0, 0, 0, 0], 'All tracked test users, shops, bookings and coupons must be cleaned up');
  }
});
