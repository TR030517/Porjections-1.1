/* Run only after the new Prisma Client and explicit migrations are ready:
 * node --env-file=.env.test.local --test test/booking-resources.integration.cjs
 * Creates a brand-new random mj2_test_booking_resources_* database on loopback
 * MySQL:3310, deploys checked-in migrations, exercises real JWT/HTTP/SQL, then
 * drops only that exact disposable database. Does not touch existing test rows.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { installTestEnvironment, withFreshDatabase, observedPrisma, waitForShopLockQueries, deferred, within } = require('./booking-resources.support.cjs');
installTestEnvironment();
// These legacy financial/resource scenarios intentionally use isolated online
// holds. This flag exists only in this test process, never in the main app.
process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true';
require('ts-node/register/transpile-only');
require('reflect-metadata');

test('fresh isolated MySQL: authenticated resource reservations and complete lifecycle', { timeout: 240000 }, async t => {
  await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { PrismaClient, Prisma } = require('@prisma/client');
    const { hash } = require('bcryptjs');
    const { AppModule } = require('../src/app.module');
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { BookingService } = require('../src/modules/booking/booking.service');
    const { NotificationService } = require('../src/modules/notifications/notification.service');
    const { BigIntInterceptor } = require('../src/common/interceptors/bigint.interceptor');
    const { localInstant } = require('../src/modules/booking/time');
    const observer = { current: null };
    const prefix = randomBytes(6).toString('hex');
    const password = randomBytes(24).toString('base64url');
    const baseDate = '2035-01-15', timezone = 'America/New_York';
    const originalFetch = globalThis.fetch;
    let app, origin, fixtures = 0, nextKey = 0, bookingService, sourceShopId;
    const auth = {}, users = {};
    const expect = (result, status) => { assert.equal(result.status, status, `Unexpected HTTP status ${result.status}; response body intentionally omitted`); return result.json; };
    const call = async (route, { token, body, method = body === undefined ? 'GET' : 'POST', extra = {} } = {}) => {
      const response = await fetch(`${origin}/api/v1${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      let json; try { json = await response.json(); } catch { json = {}; }
      return { status: response.status, json };
    };
    const base = fixture => `/reservation-admin/shops/${fixture.shop.id}`;
    const config = async fixture => expect(await call(`${base(fixture)}/config`, { token: auth.owner }), 200);
    const write = async (fixture, route, body, token = auth.owner, method = 'POST') => expect(await call(base(fixture) + route, { token, body, method }), method === 'POST' ? 201 : 200);
    const asId = value => String(value);
    const activeLocks = id => db.bookingResourceLock.findMany({ where: { bookingId: BigInt(id), status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    const readBooking = id => db.booking.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, resourceLocks: true } });
    const contactFor = token => {
      const entry = Object.entries(users).find(([name, user]) => user.role === 'CUSTOMER' && auth[name] === token);
      assert.ok(entry && entry[1].emailVerifiedAt, 'Booking fixtures require the actual verified CUSTOMER identity');
      const [name, user] = entry;
      // The account phone is deliberately a legacy placeholder; the reservation
      // supplies its own valid contact phone and the current verified email.
      return { name: user.name, phone: name === 'customer' ? '+12025550101' : '+12025550102', email: user.email.trim().toLowerCase() };
    };
    const request = (fixture, overrides = {}, token = auth.customer) => ({ shopId: asId(fixture.shop.id), serviceId: asId(fixture.service.id), variantId: asId(fixture.variant.id), date: baseDate, startTime: '10:00', requestKey: `${prefix}-${++nextKey}`, contact: contactFor(token), ...overrides });
    const signedRequest = async (fixture, overrides = {}, token = auth.customer) => {
      const body = request(fixture, { paymentMode: 'ONLINE', ...overrides }, token);
      const { requestKey, quoteHash, quoteExpiresAt, contact, ...selection } = body;
      const quote = expect(await call('/bookings/quote', { token, body: selection }), 200);
      return { ...body, quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
    };
    const create = async (fixture, overrides = {}, token = auth.customer) => expect(await call('/bookings', { token, body: await signedRequest(fixture, overrides, token) }), 201);
    const cancel = async id => expect(await call(`/bookings/${id}/cancel`, { token: auth.customer, body: {} }), 201);
    const slots = async (fixture, overrides = {}, token = auth.customer) => {
      const query = { shopId: asId(fixture.shop.id), serviceId: asId(fixture.service.id), variantId: asId(fixture.variant.id), date: baseDate, ...overrides };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, Array.isArray(value) ? value.join(',') : String(value));
      return call(`/bookings/slots?${params}`, { token });
    };
    const available = (result, time) => {
      const json = expect(result, 200); assert.ok(Array.isArray(json.slots), 'Slots must preserve the public array contract');
      return json.slots.some(slot => slot.time === time && slot.available === true);
    };
    const makeFixture = async ({ count = 2, staff = 3, roomType = count === 2 ? 'COUPLE' : 'SINGLE', roomCount = 1, duration = 60, price = 10025, staffBuffer = 10, roomBuffer = 15, open = '08:00', close = '22:00', shiftStart = 480, shiftEnd = 1320 } = {}) => {
      const number = ++fixtures;
      const businessHours = Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => [day, { open, close, closed: false }]));
      const shop = await db.shop.create({ data: { ownerId: auth.ownerId, name: `Resource test ${prefix}-${number}`, shortName: `resources-${prefix}-${number}`, phone: 'TEST-ONLY', address: 'Synthetic address', city: 'Test', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', status: 'APPROVED', timezone, businessHours, studioProfile: { features: { onlineBooking: true, reviews: false } } } });
      await db.merchantProfile.create({ data: { userId: auth.ownerId, shopId: shop.id } });
      const loginUser = sourceShopId === undefined ? { id: auth.ownerId } : await db.user.create({ data: { role: 'MERCHANT', email: `binding-${prefix}-${number}@example.invalid`, passwordHash: await hash(password, 10), name: 'Synthetic independent shop login' } });
      await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: loginUser.id, createdById: users.admin.id, reason: 'Synthetic independent shop fixture' } });
      if (sourceShopId === undefined) sourceShopId = shop.id;
      else await db.shopAccountGrant.create({ data: { sourceShopId, targetShopId: shop.id, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE', 'SETTLEMENT_RECORD', 'REFUNDS_MANAGE', 'RESERVATION_CONFIG', 'FINANCE_READ', 'SHOP_SETTINGS_MANAGE', 'CATALOG_MANAGE', 'COPY_CONFIG'], createdById: users.admin.id, updatedById: users.admin.id, reason: 'Synthetic explicit owner fixture grant' } });
      // Current catalog selections charge one whole-order amount. Participant
      // snapshots must allocate that exact amount without duplicating a cent.
      const service = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic massage', category: 'MASSAGE', durationMin: 60, priceCents: 11000, priceBasis: 'PER_BOOKING', participantCount: count, requiredStaffCount: count, requiredRoomType: roomType, staffBufferMin: staffBuffer, roomBufferMin: roomBuffer } });
      const variant = await db.shopServiceVariant.create({ data: { serviceId: service.id, name: 'Configured duration', durationMin: duration, priceCents: price, priceBasis: 'PER_BOOKING', currency: 'usd' } });
      const therapists = [];
      for (let index = 0; index < staff; index++) {
        const therapist = await db.therapist.create({ data: { shopId: shop.id, name: `Synthetic therapist ${index}`, scheduleMode: 'CUSTOM', therapistServices: { create: { serviceId: service.id } } } });
        await db.therapistShift.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ therapistId: therapist.id, weekday, startMin: shiftStart, endMin: shiftEnd })) });
        therapists.push(therapist);
      }
      const rooms = [];
      for (let index = 0; index < roomCount; index++) rooms.push(await db.shopRoom.create({ data: { shopId: shop.id, name: `Synthetic room ${index}`, roomType, capacity: count } }));
      return { shop, service, variant, therapists, rooms };
    };
    const utc = (time, date = baseDate) => localInstant(date, time, timezone);
    const noWritesFor = async (fixture, action) => {
      const before = await Promise.all([db.booking.count({ where: { shopId: fixture.shop.id } }), db.bookingItem.count({ where: { booking: { shopId: fixture.shop.id } } }), db.bookingResourceLock.count({ where: { shopId: fixture.shop.id } })]);
      await action();
      assert.deepEqual(await Promise.all([db.booking.count({ where: { shopId: fixture.shop.id } }), db.bookingItem.count({ where: { booking: { shopId: fixture.shop.id } } }), db.bookingResourceLock.count({ where: { shopId: fixture.shop.id } })]), before, 'A rejected reservation must leave no booking, item or resource lock');
    };
    const assertAllocation = async (booking, fixture, count = 2) => {
      const row = await readBooking(booking.id);
      assert.equal(row.status, 'PENDING'); assert.equal(row.paymentStatus, 'UNPAID');
      assert.equal(row.priceCents, fixture.variant.priceCents); assert.equal(row.totalCents, fixture.variant.priceCents);
      assert.equal(row.paidCents, 0); assert.equal(row.refundedCents, 0); assert.equal(row.currency, 'usd');
      assert.equal(row.durationMin, fixture.variant.durationMin); assert.equal(row.bookingTimezone, timezone);
      assert.equal(row.items.length, count); assert.equal(new Set(row.items.map(item => item.participantIndex)).size, count);
      assert.equal(row.items.reduce((sum, item) => sum + item.priceCentsSnapshot, 0), row.priceCents, 'Participant snapshots must conserve the whole-order amount');
      for (const item of row.items) {
        assert.equal(item.serviceId, fixture.service.id); assert.equal(item.variantId, fixture.variant.id);
        assert.equal(item.priceCentsSnapshot, Math.floor(fixture.variant.priceCents / count) + (item.participantIndex <= fixture.variant.priceCents % count ? 1 : 0));
        assert.equal(item.quotedUnitPriceCents, fixture.variant.priceCents); assert.equal(item.priceBasisSnapshot, 'PER_BOOKING'); assert.equal(item.durationMin, fixture.variant.durationMin);
        assert.equal(item.staffBufferMin, fixture.service.staffBufferMin); assert.equal(item.roomBufferMin, fixture.service.roomBufferMin);
        assert.equal(+item.startAtUtc, +row.startTime); assert.equal(+item.endAtUtc, +row.endTime);
      }
      const locks = row.resourceLocks.filter(lock => lock.status === 'ACTIVE');
      const people = locks.filter(lock => lock.resourceType === 'THERAPIST'), rooms = locks.filter(lock => lock.resourceType === 'ROOM');
      assert.equal(people.length, count); assert.equal(new Set(people.map(lock => String(lock.resourceId))).size, count);
      assert.equal(new Set(people.map(lock => String(lock.bookingItemId))).size, count);
      assert.ok(people.every(lock => row.items.some(item => item.id === lock.bookingItemId)));
      assert.equal(rooms.length, fixture.service.requiredRoomType ? 1 : 0);
      for (const lock of people) assert.equal(+lock.endAtUtc, +row.endTime + fixture.service.staffBufferMin * 60000);
      for (const lock of rooms) assert.equal(+lock.endAtUtc, +row.endTime + fixture.service.roomBufferMin * 60000);
      return row;
    };
    try {
      const passwordHash = await hash(password, 10);
      for (const [name, role] of [['customer','CUSTOMER'],['otherCustomer','CUSTOMER'],['owner','MERCHANT'],['outsider','MERCHANT'],['admin','ADMIN']]) {
        users[name] = await db.user.create({ data: { name: `Synthetic ${name}`, email: `${prefix}.${name}@example.invalid`, emailVerifiedAt: role === 'CUSTOMER' ? new Date() : null, phone: `T${prefix}${Object.keys(users).length}`, role, passwordHash } });
      }
      auth.ownerId = users.owner.id;
      const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(observedPrisma(db, observer))
        .overrideProvider(NotificationService).useValue({ notifyBookingConfirmed: async () => undefined, notifyBookingCancelled: async () => undefined, notifyBookingReminder: async () => undefined }).compile();
      app = module.createNestApplication({ rawBody: true, logger: false }); app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new BigIntInterceptor());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
      await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); process.env.CORS_ORIGINS = origin;
      // Hard-deny fetch egress; the only permitted target is this ephemeral HTTP server.
      globalThis.fetch = (input, options) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (url.origin !== origin) throw new Error('EXTERNAL_HTTP_REQUEST_FORBIDDEN_IN_RESOURCE_TEST');
        return originalFetch(input, options);
      };
      for (const [name, user] of Object.entries(users)) auth[name] = expect(await call('/auth/password/login', { body: { email: user.email, password } }), 200).accessToken;
      bookingService = app.get(BookingService);

      await t.test('fresh migrations and real JWT configuration authorization preserve scalar and shop boundaries', async () => {
        assert.ok(migrationCount >= 8); const fixture = await makeFixture({ count: 1 });
        expect(await call(`${base(fixture)}/config`), 401);
        expect(await call(`${base(fixture)}/config`, { token: auth.customer }), 403);
        expect(await call(`${base(fixture)}/config`, { token: auth.outsider }), 403);
        // Availability is public; booking creation and configuration remain authenticated.
        expect(await slots(fixture, {}, null), 200);
        expect(await call('/bookings', { body: request(fixture) }), 401);
        assert.equal(expect(await call(`${base(fixture)}/config`, { token: auth.admin }), 200).shopId, String(fixture.shop.id));
        const view = await config(fixture); assert.equal(view.shopId, String(fixture.shop.id)); assert.equal(view.timezone, timezone);
        assert.equal(view.services[0].variants[0].id, String(fixture.variant.id));
        const variant = { serviceId: String(fixture.service.id), name: 'Ninety minutes', durationMin: 90, priceCents: 15555, currency: 'usd' };
        expect(await call(`${base(fixture)}/variants`, { token: auth.outsider, body: variant }), 403);
        expect(await call(`${base(fixture)}/variants`, { token: auth.customer, body: variant }), 403);
        await write(fixture, '/variants', variant);
        const added = (await config(fixture)).services[0].variants.find(row => row.name === variant.name);
        assert.ok(added); assert.equal(added.durationMin, 90); assert.equal(added.priceCents, 15555);
        expect(await call(`${base(fixture)}/variants/${added.id}`, { token: auth.owner, method: 'PATCH', body: { serviceId: String(fixture.service.id) } }), 400);
        for (const body of [{ ...variant, priceCents: -1 }, { ...variant, priceCents: 10000001 }, { ...variant, durationMin: 241 }, { ...variant, currency: 'eur' }, { ...variant, service: { connect: { id: fixture.service.id.toString() } } }]) expect(await call(`${base(fixture)}/variants`, { token: auth.owner, body }), 400);
        const foreign = await makeFixture({ count: 1 });
        expect(await call(`${base(fixture)}/variants`, { token: auth.owner, body: { ...variant, serviceId: String(foreign.service.id) } }), 404);
        expect(await call(`${base(fixture)}/shifts`, { token: auth.owner, body: { therapistId: String(foreign.therapists[0].id), weekday: 1, startMin: 480, endMin: 1080 } }), 404);
        expect(await call(`${base(fixture)}/time-off`, { token: auth.owner, body: { therapistId: String(fixture.therapists[0].id), startAtUtc: '2035-01-15T15:00:00', endAtUtc: '2035-01-15T16:00:00Z' } }), 400);
        expect(await call(`${base(fixture)}/rooms`, { token: auth.owner, body: { name: 'Invalid couple room', roomType: 'COUPLE', capacity: 1 } }), 400);
        expect(await call(`${base(fixture)}/services/${fixture.service.id}/policy`, { token: auth.owner, method: 'PATCH', body: { participantCount: 2, requiredStaffCount: 1, requiredRoomType: 'COUPLE' } }), 400);
      });

      await t.test('configuration CRUD persists real room and shift rows and rejects cross-shop target IDs', async () => {
        const fixture = await makeFixture({ count: 1 }); const foreign = await makeFixture({ count: 1 });
        await db.therapistShift.deleteMany({ where: { therapistId: fixture.therapists[0].id, weekday: 1 } });
        const shift = { therapistId: String(fixture.therapists[0].id), weekday: 1, startMin: 540, endMin: 720 };
        await write(fixture, '/shifts', shift);
        let view = await config(fixture); const createdShift = view.therapists[0].shifts.find(row => row.startMin === 540 && row.endMin === 720);
        assert.ok(createdShift); assert.equal(typeof createdShift.id, 'string');
        await write(fixture, `/shifts/${createdShift.id}`, { endMin: 750 }, auth.owner, 'PATCH');
        assert.equal((await db.therapistShift.findUniqueOrThrow({ where: { id: BigInt(createdShift.id) } })).endMin, 750);
        expect(await call(`${base(foreign)}/shifts/${createdShift.id}`, { token: auth.owner, method: 'PATCH', body: { endMin: 780 } }), 404);
        expect(await call(`${base(fixture)}/shifts/${createdShift.id}`, { token: auth.outsider, method: 'DELETE' }), 403);
        expect(await call(`${base(fixture)}/shifts/${createdShift.id}`, { token: auth.owner, method: 'DELETE' }), 200);
        assert.equal((await db.therapistShift.findUniqueOrThrow({ where: { id: BigInt(createdShift.id) } })).isActive, false);
        await write(fixture, '/rooms', { name: 'Additional independent seat', roomType: 'FOOT_SEAT', capacity: 1 });
        view = await config(fixture); const room = view.rooms.find(row => row.name === 'Additional independent seat'); assert.ok(room);
        await write(fixture, `/rooms/${room.id}`, { name: 'Renamed seat' }, auth.owner, 'PATCH');
        assert.equal((await db.shopRoom.findUniqueOrThrow({ where: { id: BigInt(room.id) } })).name, 'Renamed seat');
        expect(await call(`${base(fixture)}/maintenance`, { token: auth.owner, body: { roomId: String(foreign.rooms[0].id), startAtUtc: utc('10:00').toISOString(), endAtUtc: utc('11:00').toISOString() } }), 404);
        expect(await call(`${base(fixture)}/rooms/${room.id}`, { token: auth.owner, method: 'DELETE' }), 200);
        assert.equal((await db.shopRoom.findUniqueOrThrow({ where: { id: BigInt(room.id) } })).isActive, false);
        assert.ok(await db.auditLog.count({ where: { operatorId: auth.ownerId } }) > 0, 'Configuration mutation writes audit records');
      });

      await t.test('an explicitly selected variant supplies the whole-order price, exact participant allocations and duration snapshots', async () => {
        const fixture = await makeFixture({ count: 2, duration: 90, price: 15555 });
        assert.equal(available(await slots(fixture), '10:00'), true);
        const contact = { ...contactFor(auth.customer), name: 'Synthetic reservation contact', phone: '+12025550123' };
        const booked = await create(fixture, { contact }); const row = await assertAllocation(booked, fixture);
        assert.deepEqual({ name: row.contactName, phone: row.contactPhone, email: row.contactEmail }, contact, 'The reservation must preserve the submitted contact snapshot, not the legacy account phone');
        assert.equal(+row.endTime - +row.startTime, 90 * 60000); assert.equal(row.totalCents, 15555);
        assert.deepEqual([...row.items].sort((a, b) => a.participantIndex - b.participantIndex).map(item => item.priceCentsSnapshot), [7778, 7777]);
        assert.ok(row.holdExpiresAt > new Date());
        const detail = expect(await call(`/bookings/${booked.id}`, { token: auth.customer }), 200);
        assert.equal(detail.timezone, timezone); assert.equal(detail.localDate, baseDate); assert.equal(detail.localStartTime, '10:00'); assert.equal(detail.localEndTime, '11:30');
        expect(await call(`/bookings/${booked.id}`, { token: auth.otherCustomer }), 404);
        expect(await call(`/bookings/${booked.id}`, { token: auth.outsider }), 404);
        await db.shopServiceVariant.update({ where: { id: fixture.variant.id }, data: { name: 'Changed name', priceCents: 19999 } });
        const preserved = await readBooking(booked.id); assert.equal(preserved.totalCents, 15555);
        assert.deepEqual([...preserved.items].sort((a, b) => a.participantIndex - b.participantIndex).map(item => item.priceCentsSnapshot), [7778, 7777]);
        assert.ok(preserved.items.every(item => item.quotedUnitPriceCents === 15555 && item.priceBasisSnapshot === 'PER_BOOKING' && item.variantNameSnapshot === 'Configured duration'));
      });

      await t.test('variant existence disables old-price fallback and arbitrary client duration or cross-shop selection', async () => {
        const fixture = await makeFixture({ count: 1 }); const foreign = await makeFixture({ count: 1 });
        await noWritesFor(fixture, async () => {
          expect(await call('/bookings', { token: auth.customer, body: request(fixture, { variantId: String(foreign.variant.id) }) }), 400);
          expect(await call('/bookings', { token: auth.customer, body: request(fixture, { serviceId: String(foreign.service.id) }) }), 400);
          expect(await call('/bookings', { token: auth.customer, body: request(fixture, { durationMin: 120 }) }), 400);
          expect(await call('/bookings', { token: auth.customer, body: request(fixture, { variantId: undefined }) }), 400);
          await db.shopServiceVariant.update({ where: { id: fixture.variant.id }, data: { isActive: false } });
          expect(await slots(fixture), 400);
          expect(await call('/bookings', { token: auth.customer, body: request(fixture) }), 400);
          expect(await call('/bookings', { token: auth.customer, body: request(fixture, { variantId: undefined }) }), 400);
        });
      });

      await t.test('legacy services without variants keep their configured price and exact duration only', async () => {
        const fixture = await makeFixture({ count: 1, staffBuffer: 0, roomBuffer: 0 });
        await db.shopServiceVariant.delete({ where: { id: fixture.variant.id } });
        expect(await call('/bookings', { token: auth.customer, body: request(fixture, { variantId: undefined, durationMin: 90 }) }), 400);
        const booked = await create(fixture, { variantId: undefined }); const row = await readBooking(booked.id);
        assert.equal(row.totalCents, fixture.service.priceCents); assert.equal(row.durationMin, fixture.service.durationMin);
        assert.equal(row.items.length, 1); assert.equal(row.items[0].variantId, null);
      });

      await t.test('duplicate, excess, malformed and cross-shop therapist preferences never satisfy a couple allocation', async () => {
        const fixture = await makeFixture(); const foreign = await makeFixture();
        const a = String(fixture.therapists[0].id), b = String(fixture.therapists[1].id), c = String(fixture.therapists[2].id);
        await noWritesFor(fixture, async () => {
          for (const preferredTherapistIds of [[a,a], [a,b,c], [String(foreign.therapists[0].id)], ['0'], [42], ['not-an-id']]) expect(await call('/bookings', { token: auth.customer, body: request(fixture, { preferredTherapistIds }) }), 400);
          expect(await slots(fixture, { preferredTherapistIds: [a,a] }), 400);
          expect(await call('/bookings', { token: auth.customer, body: request(fixture, { therapistId: a, preferredTherapistIds: [b] }) }), 400);
        });
        const booked = await create(fixture, { preferredTherapistIds: [b,a] });
        const locks = await activeLocks(booked.id); assert.deepEqual(locks.filter(lock => lock.resourceType === 'THERAPIST').map(lock => String(lock.resourceId)).sort(), [a,b].sort());
      });

      await t.test('all-shop eligibility, active shifts, staff buffer and time off are rechecked for direct creates', async () => {
        const fixture = await makeFixture({ staff: 2, staffBuffer: 10 }); const target = fixture.therapists[0];
        await db.therapistService.delete({ where: { therapistId_serviceId: { therapistId: target.id, serviceId: fixture.service.id } } });
        assert.equal(available(await slots(fixture), '10:00'), true, 'Legacy service mappings no longer restrict the active shop staff pool');
        await db.therapist.update({ where: { id: target.id }, data: { isActive: false } });
        assert.equal(available(await slots(fixture), '10:00'), false);
        expect(await call('/bookings', { token: auth.customer, body: request(fixture) }), 409);
        await db.therapist.update({ where: { id: target.id }, data: { isActive: true } });
        await db.therapistService.create({ data: { therapistId: target.id, serviceId: fixture.service.id } });
        await db.therapistShift.updateMany({ where: { therapistId: target.id }, data: { endMin: 600 } });
        assert.equal(available(await slots(fixture), '09:00'), false, '09:00-10:00 plus staff buffer must fit the actual shift');
        expect(await call('/bookings', { token: auth.customer, body: request(fixture, { startTime: '09:00' }) }), 409);
        await db.therapistShift.updateMany({ where: { therapistId: target.id }, data: { endMin: 1320 } });
        await write(fixture, '/time-off', { therapistId: String(target.id), startAtUtc: utc('10:30').toISOString(), endAtUtc: utc('11:30').toISOString(), reason: 'Synthetic time off' });
        assert.equal(available(await slots(fixture), '10:00'), false);
        expect(await call('/bookings', { token: auth.customer, body: request(fixture) }), 409);
        const timeOff = (await config(fixture)).therapists.find(row => row.id === String(target.id)).timeOff[0];
        expect(await call(`${base(fixture)}/time-off/${timeOff.id}`, { token: auth.owner, method: 'DELETE' }), 200);
        assert.equal(available(await slots(fixture), '10:00'), true);
        await assertAllocation(await create(fixture), fixture);
      });

      await t.test('room capacity, maintenance and only one available therapist make slots and create agree', async () => {
        const fixture = await makeFixture({ staff: 2 });
        await db.shopRoom.update({ where: { id: fixture.rooms[0].id }, data: { capacity: 1 } });
        assert.equal(available(await slots(fixture), '10:00'), false); expect(await call('/bookings', { token: auth.customer, body: request(fixture) }), 409);
        await db.shopRoom.update({ where: { id: fixture.rooms[0].id }, data: { capacity: 2 } });
        await write(fixture, '/maintenance', { roomId: String(fixture.rooms[0].id), startAtUtc: utc('10:30').toISOString(), endAtUtc: utc('11:15').toISOString(), reason: 'Synthetic maintenance' });
        assert.equal(available(await slots(fixture), '10:00'), false); expect(await call('/bookings', { token: auth.customer, body: request(fixture) }), 409);
        const maintenance = (await config(fixture)).rooms[0].maintenance[0];
        expect(await call(`${base(fixture)}/maintenance/${maintenance.id}`, { token: auth.owner, method: 'DELETE' }), 200);
        await db.therapist.update({ where: { id: fixture.therapists[0].id }, data: { isActive: false } });
        assert.equal(available(await slots(fixture), '10:00'), false); expect(await call('/bookings', { token: auth.customer, body: request(fixture) }), 409);
        await db.therapist.update({ where: { id: fixture.therapists[0].id }, data: { isActive: true } });
        assert.equal(available(await slots(fixture), '10:00'), true);
      });

      await t.test('staff and room buffers are separate half-open resource intervals', async () => {
        const fixture = await makeFixture({ count: 1, staff: 2, staffBuffer: 10, roomBuffer: 30 });
        const booked = await create(fixture, { startTime: '10:00', preferredTherapistIds: [String(fixture.therapists[0].id)] });
        const row = await assertAllocation(booked, fixture, 1);
        assert.equal(available(await slots(fixture), '11:00'), false, 'Room is still held through 11:30 even with another employee available');
        expect(await call('/bookings', { token: auth.customer, body: request(fixture, { startTime: '11:00', preferredTherapistIds: [String(fixture.therapists[1].id)] }) }), 409);
        assert.equal(available(await slots(fixture), '11:30'), true);
        await create(fixture, { startTime: '11:30' });
        assert.equal((await activeLocks(row.id)).find(lock => lock.resourceType === 'ROOM').endAtUtc.toISOString(), utc('11:30').toISOString());
      });

      await t.test('two independent HTTP transactions actually wait for one shop lock and only one couple wins', async () => {
        const fixture = await makeFixture({ staff: 4 });
        const first = await signedRequest(fixture), second = await signedRequest(fixture);
        const blocker = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        const held = deferred(), release = deferred(); let blockedConnection;
        const gate = { shopId: fixture.shop.id, attempts: [], expected: 2, ready: deferred() };
        observer.current = gate;
        const holding = blocker.$transaction(async tx => {
          blockedConnection = String((await tx.$queryRawUnsafe('SELECT CONNECTION_ID() AS id'))[0].id);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${fixture.shop.id} FOR UPDATE`);
          held.resolve(); await within(release.promise, 15000, 'CONCURRENCY_BARRIER_RELEASE_TIMEOUT');
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
        let pending = [];
        try {
          await within(held.promise, 5000, 'CONCURRENCY_SHOP_BARRIER_NOT_HELD');
          let completed = 0;
          pending = [first, second].map(body => call('/bookings', { token: auth.customer, body }).then(result => { completed++; return result; }));
          await within(gate.ready.promise, 7000, 'TWO_REAL_TRANSACTIONS_DID_NOT_REACH_SHOP_LOCK');
          assert.equal(gate.attempts.length, 2); assert.equal(new Set(gate.attempts.map(item => item.connectionId)).size, 2);
          assert.ok(gate.attempts.every(item => item.connectionId !== blockedConnection && item.isolationLevel === 'ReadCommitted'));
          await waitForShopLockQueries(db, gate.attempts.map(item => item.connectionId));
          assert.equal(completed, 0, 'Both HTTP requests must be pending behind the real database barrier');
          release.resolve(); await holding;
          const results = await Promise.all(pending); assert.deepEqual(results.map(result => result.status).sort(), [201,409]);
          assert.equal(await db.booking.count({ where: { shopId: fixture.shop.id } }), 1);
          assert.equal(await db.bookingItem.count({ where: { booking: { shopId: fixture.shop.id } } }), 2);
          assert.equal(await db.bookingResourceLock.count({ where: { shopId: fixture.shop.id, status: 'ACTIVE' } }), 3);
          await assertAllocation(results.find(result => result.status === 201).json, fixture);
        } finally {
          release.resolve(); await holding.catch(() => {}); await Promise.allSettled(pending); observer.current = null; await blocker.$disconnect();
        }
      });

      await t.test('different times or independent staff and rooms coexist without global false conflicts', async () => {
        const fixture = await makeFixture({ count: 1, staff: 2, roomCount: 2, staffBuffer: 0, roomBuffer: 0 });
        const first = await create(fixture, { preferredTherapistIds: [String(fixture.therapists[0].id)] });
        const second = await create(fixture, { preferredTherapistIds: [String(fixture.therapists[1].id)] });
        const one = await activeLocks(first.id), two = await activeLocks(second.id);
        assert.notEqual(one.find(row => row.resourceType === 'ROOM').resourceId, two.find(row => row.resourceType === 'ROOM').resourceId);
        await create(fixture, { startTime: '11:00', preferredTherapistIds: [String(fixture.therapists[0].id)] });
        assert.equal(await db.booking.count({ where: { shopId: fixture.shop.id } }), 3);
        assert.equal(await db.bookingResourceLock.count({ where: { shopId: fixture.shop.id, status: 'ACTIVE' } }), 6);
      });

      await t.test('request keys replay one booking, conflict on changed inputs and do not resurrect cancelled holds', async () => {
        const fixture = await makeFixture(); const body = await signedRequest(fixture);
        const first = expect(await call('/bookings', { token: auth.customer, body }), 201);
        const second = expect(await call('/bookings', { token: auth.customer, body }), 201);
        assert.equal(second.id, first.id); assert.equal(await db.booking.count({ where: { shopId: fixture.shop.id } }), 1); assert.equal((await activeLocks(first.id)).length, 3);
        expect(await call('/bookings', { token: auth.customer, body: { ...body, startTime: '12:00' } }), 409);
        await cancel(first.id); assert.equal((await activeLocks(first.id)).length, 0);
        const replay = expect(await call('/bookings', { token: auth.customer, body }), 201);
        assert.equal(replay.id, first.id); assert.equal(replay.status, 'CANCELLED'); assert.equal((await activeLocks(first.id)).length, 0);
        await create(fixture, { startTime: '10:00' });
      });

      await t.test('simultaneous replays of one request key return the same committed allocation', async () => {
        const fixture = await makeFixture(); const body = await signedRequest(fixture);
        const results = await Promise.all([call('/bookings', { token: auth.customer, body }), call('/bookings', { token: auth.customer, body })]);
        const ids = results.map(result => expect(result, 201).id); assert.equal(ids[0], ids[1]);
        assert.equal(await db.booking.count({ where: { shopId: fixture.shop.id } }), 1);
        assert.equal(await db.bookingItem.count({ where: { bookingId: BigInt(ids[0]) } }), 2);
        assert.equal((await activeLocks(ids[0])).length, 3);
      });

      await t.test('request keys remain case-sensitive in MySQL while exact-case retries remain idempotent', async () => {
        const fixture = await makeFixture();
        const columns = await db.$queryRawUnsafe("SELECT COLUMN_NAME AS columnName, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME IN ('request_key', 'request_hash')");
        assert.equal(columns.length, 2); assert.ok(columns.every(column => column.collationName === 'ascii_bin'), 'Fresh migration must retain the latest binary idempotency-key/hash collation');
        const lower = await signedRequest(fixture, { requestKey: `case-${prefix}-a`, startTime: '10:00' });
        const upper = await signedRequest(fixture, { requestKey: lower.requestKey.toUpperCase(), startTime: '12:00' });
        const first = expect(await call('/bookings', { token: auth.customer, body: lower }), 201);
        const second = expect(await call('/bookings', { token: auth.customer, body: upper }), 201);
        assert.notEqual(first.id, second.id, 'Case-distinct keys must not collapse under MySQL default case-insensitive collation');
        assert.equal(expect(await call('/bookings', { token: auth.customer, body: lower }), 201).id, first.id);
        assert.equal(await db.booking.count({ where: { shopId: fixture.shop.id } }), 2);
        assert.equal(await db.bookingResourceLock.count({ where: { shopId: fixture.shop.id, status: 'ACTIVE' } }), 6);
      });

      await t.test('cancellation enforces ownership and releases all resource locks with no financial invention', async () => {
        const fixture = await makeFixture(); const booked = await create(fixture);
        expect(await call(`/bookings/${booked.id}/cancel`, { token: auth.otherCustomer, body: {} }), 404);
        expect(await call(`/bookings/${booked.id}/cancel`, { token: auth.outsider, body: {} }), 404);
        assert.equal((await activeLocks(booked.id)).length, 3);
        await cancel(booked.id); const row = await readBooking(booked.id);
        assert.equal(row.status, 'CANCELLED'); assert.equal(row.paymentStatus, 'UNPAID'); assert.equal(row.paidCents, 0); assert.equal(row.refundedCents, 0); assert.equal((await activeLocks(booked.id)).length, 0);
        assert.equal(available(await slots(fixture), '10:00'), true);
      });

      await t.test('rescheduling atomically swaps resources, preserves snapshots and rolls back on conflict', async () => {
        const fixture = await makeFixture(); const first = await create(fixture); const occupied = await create(fixture, { startTime: '12:00' });
        const before = await readBooking(first.id); const oldActive = await activeLocks(first.id);
        expect(await call(`/bookings/${first.id}/reschedule`, { token: auth.otherCustomer, body: { date: baseDate, startTime: '14:00' } }), 404);
        expect(await call(`/bookings/${first.id}/reschedule`, { token: auth.customer, body: { date: baseDate, startTime: '12:00' } }), 409);
        assert.deepEqual(await activeLocks(first.id), oldActive); assert.equal(+(await readBooking(first.id)).startTime, +before.startTime);
        // Change the live variant after purchase; moving the booking must use its original quote/duration.
        await db.shopServiceVariant.update({ where: { id: fixture.variant.id }, data: { durationMin: 90, priceCents: 19999 } });
        // A move must preserve the original AUTO request, rather than silently
        // convert the allocator's assignments into a different customer choice.
        expect(await call(`/bookings/${first.id}/reschedule`, { token: auth.customer, body: { date: baseDate, startTime: '14:00', preferredTherapistIds: fixture.therapists.slice(0,2).map(row => String(row.id)) } }), 400);
        assert.deepEqual(await activeLocks(first.id), oldActive); assert.equal(+(await readBooking(first.id)).startTime, +before.startTime);
        const moveKey = `${prefix}-reschedule-${++nextKey}`, body = { date: baseDate, startTime: '14:00' }, extra = { 'Idempotency-Key': moveKey };
        expect(await call(`/bookings/${first.id}/reschedule`, { token: auth.customer, body, extra }), 201);
        const moved = await readBooking(first.id); assert.equal(+moved.startTime, +utc('14:00')); assert.equal(moved.durationMin, before.durationMin); assert.equal(moved.totalCents, before.totalCents);
        assert.equal((await activeLocks(first.id)).length, 3); assert.ok(moved.resourceLocks.filter(lock => oldActive.some(old => old.id === lock.id)).every(lock => lock.status === 'RELEASED'));
        const terms = items => [...items].sort((a, b) => a.participantIndex - b.participantIndex).map(({ startAtUtc, endAtUtc, assignedTherapistId, assignedRoomId, ...snapshot }) => snapshot);
        assert.deepEqual(terms(moved.items), terms(before.items), 'Moving cannot rewrite any purchased item terms after the catalog changes');
        assert.ok(moved.items.every(item => +item.startAtUtc === +utc('14:00') && +item.endAtUtc === +utc('15:00')));
        assert.equal(moved.therapistSelectionMode, 'AUTO'); assert.deepEqual(moved.requestedTherapistIds, []);
        assert.deepEqual([...moved.items].sort((a, b) => a.participantIndex - b.participantIndex).map(item => item.priceCentsSnapshot), [5013, 5012]);
        assert.equal(moved.priceCents, 10025); assert.equal(moved.totalCents, 10025);
        const committedLocks = await activeLocks(first.id);
        expect(await call(`/bookings/${first.id}/reschedule`, { token: auth.customer, body, extra }), 201);
        assert.deepEqual(await activeLocks(first.id), committedLocks, 'An exact retry reuses its committed resource swap');
        expect(await call(`/bookings/${first.id}/reschedule`, { token: auth.customer, body: { ...body, startTime: '16:00' }, extra }), 409);
        assert.deepEqual(await activeLocks(first.id), committedLocks); assert.equal(+(await readBooking(first.id)).startTime, +utc('14:00'));
        const receipts = await db.bookingOperationReceipt.findMany({ where: { bookingId: BigInt(first.id), actorId: users.customer.id, requestKey: moveKey } });
        assert.equal(receipts.length, 1); assert.equal(receipts[0].action, 'RESCHEDULE'); assert.equal(receipts[0].outcome, 'COMMITTED');
        assert.equal(available(await slots(fixture), '10:00'), true); assert.equal((await activeLocks(occupied.id)).length, 3);
      });

      await t.test('expired PENDING prepayment holds release lazily while legacy/null holds and paid bookings remain', async () => {
        const fixture = await makeFixture(); const expired = await create(fixture);
        await db.booking.update({ where: { id: BigInt(expired.id) }, data: { holdExpiresAt: new Date(Date.now() - 60000) } });
        assert.equal(available(await slots(fixture), '10:00'), true);
        assert.equal((await readBooking(expired.id)).status, 'CANCELLED'); assert.equal((await activeLocks(expired.id)).length, 0);
        const retained = await create(fixture, { startTime: '12:00' });
        await db.booking.update({ where: { id: BigInt(retained.id) }, data: { holdExpiresAt: null } });
        await bookingService.expirePendingHolds(); assert.equal((await readBooking(retained.id)).status, 'PENDING'); assert.equal((await activeLocks(retained.id)).length, 3);
        const paid = await create(fixture, { startTime: '14:00' });
        process.env.PAYMENT_PROVIDER = 'local_mock';
        try {
          const intent = expect(await call('/payments/create-intent', { token: auth.customer, body: { bookingId: paid.id } }), 201);
          expect(await call('/payments/confirm', { token: auth.customer, body: { paymentIntentId: intent.paymentIntentId } }), 201);
          await db.booking.update({ where: { id: BigInt(paid.id) }, data: { holdExpiresAt: new Date(Date.now() - 60000) } });
          await bookingService.expirePendingHolds(); assert.equal((await readBooking(paid.id)).status, 'CONFIRMED'); assert.equal((await activeLocks(paid.id)).length, 3);
        } finally { process.env.PAYMENT_PROVIDER = 'disabled'; }
      });

      await t.test('existing unpaid intents and paid confirmations retain their quote during valid rescheduling', async () => {
        const fixture = await makeFixture(); const booked = await create(fixture);
        process.env.PAYMENT_PROVIDER = 'local_mock';
        try {
          const intent = expect(await call('/payments/create-intent', { token: auth.customer, body: { bookingId: booked.id } }), 201);
          const record = await db.paymentRecord.findFirstOrThrow({ where: { bookingId: BigInt(booked.id) } });
          const moved = expect(await call(`/bookings/${booked.id}/reschedule`, { token: auth.customer, body: { date: baseDate, startTime: '12:00' } }), 201);
          assert.equal(moved.totalCents, booked.totalCents); assert.equal((await activeLocks(booked.id)).length, 3);
          const unchanged = await db.paymentRecord.findUniqueOrThrow({ where: { id: record.id } });
          assert.equal(unchanged.amountCents, record.amountCents); assert.equal(unchanged.providerPaymentId, record.providerPaymentId);
          expect(await call('/payments/confirm', { token: auth.customer, body: { paymentIntentId: intent.paymentIntentId } }), 201);
          const confirmed = expect(await call(`/bookings/${booked.id}/reschedule`, { token: auth.customer, body: { date: baseDate, startTime: '14:00' } }), 201);
          assert.equal(confirmed.status, 'CONFIRMED'); assert.equal(confirmed.paymentStatus, 'PAID'); assert.equal(confirmed.paidCents, booked.totalCents);
          assert.equal(+new Date(confirmed.startTime), +utc('14:00')); assert.equal((await activeLocks(booked.id)).length, 3);
          expect(await call(`/bookings/${booked.id}/status?status=COMPLETED`, { token: auth.owner, method: 'PATCH', body: {} }), 400);
          assert.equal((await readBooking(booked.id)).status, 'CONFIRMED'); assert.equal((await activeLocks(booked.id)).length, 3);
          expect(await call(`/bookings/${booked.id}/cancel`, { token: auth.customer, body: {} }), 400);
          assert.equal((await activeLocks(booked.id)).length, 3);
        } finally { process.env.PAYMENT_PROVIDER = 'disabled'; }
      });

      await t.test('configuration cannot remove resources already committed to a future reservation', async () => {
        const fixture = await makeFixture({ staff: 2 }); const booked = await create(fixture);
        const existing = await config(fixture); const firstTherapist = existing.therapists[0];
        const weekday = new Date(baseDate + 'T12:00:00Z').getUTCDay();
        const shift = firstTherapist.shifts.find(row => row.weekday === weekday && row.isActive);
        expect(await call(`${base(fixture)}/shifts/${shift.id}`, { token: auth.owner, method: 'PATCH', body: { endMin: 600 } }), 409);
        expect(await call(`${base(fixture)}/time-off`, { token: auth.owner, body: { therapistId: firstTherapist.id, startAtUtc: utc('10:30').toISOString(), endAtUtc: utc('11:30').toISOString() } }), 409);
        expect(await call(`${base(fixture)}/maintenance`, { token: auth.owner, body: { roomId: String(fixture.rooms[0].id), startAtUtc: utc('10:30').toISOString(), endAtUtc: utc('11:30').toISOString() } }), 409);
        expect(await call(`${base(fixture)}/rooms/${fixture.rooms[0].id}`, { token: auth.owner, method: 'DELETE' }), 409);
        assert.equal((await activeLocks(booked.id)).length, 3);
        assert.equal((await db.therapistShift.findUniqueOrThrow({ where: { id: BigInt(shift.id) } })).endMin, 1320);
        assert.equal(await db.therapistTimeOff.count({ where: { therapistId: fixture.therapists[0].id } }), 0);
        assert.equal(await db.roomMaintenance.count({ where: { roomId: fixture.rooms[0].id } }), 0);
        assert.equal((await db.shopRoom.findUniqueOrThrow({ where: { id: fixture.rooms[0].id } })).isActive, true);
      });

      await t.test('COMPLETED service keeps its unfinished cleanup buffers protected until their real end', async () => {
        const fixture = await makeFixture({ staff: 2, staffBuffer: 30, roomBuffer: 45 }); const booked = await create(fixture);
        process.env.PAYMENT_PROVIDER = 'local_mock';
        try {
          const intent = expect(await call('/payments/create-intent', { token: auth.customer, body: { bookingId: booked.id } }), 201);
          expect(await call('/payments/confirm', { token: auth.customer, body: { paymentIntentId: intent.paymentIntentId } }), 201);
        } finally { process.env.PAYMENT_PROVIDER = 'disabled'; }
        const ended = new Date(Date.now() - 60000), started = new Date(+ended - 3600000);
        await db.booking.update({ where: { id: BigInt(booked.id) }, data: { startTime: started, endTime: ended } });
        await db.bookingItem.updateMany({ where: { bookingId: BigInt(booked.id) }, data: { startAtUtc: started, endAtUtc: ended } });
        await db.bookingResourceLock.updateMany({ where: { bookingId: BigInt(booked.id), resourceType: 'THERAPIST' }, data: { startAtUtc: started, endAtUtc: new Date(+ended + 30 * 60000) } });
        await db.bookingResourceLock.updateMany({ where: { bookingId: BigInt(booked.id), resourceType: 'ROOM' }, data: { startAtUtc: started, endAtUtc: new Date(+ended + 45 * 60000) } });
        expect(await call(`/bookings/${booked.id}/status?status=COMPLETED`, { token: auth.owner, method: 'PATCH', body: {} }), 200);
        assert.equal((await readBooking(booked.id)).status, 'COMPLETED'); assert.equal((await activeLocks(booked.id)).length, 3);
        const window = { startAtUtc: new Date().toISOString(), endAtUtc: new Date(Date.now() + 5 * 60000).toISOString() };
        const leave = { therapistId: String(fixture.therapists[0].id), ...window };
        const maintenance = { roomId: String(fixture.rooms[0].id), ...window };
        expect(await call(`${base(fixture)}/time-off`, { token: auth.owner, body: leave }), 409);
        expect(await call(`${base(fixture)}/maintenance`, { token: auth.owner, body: maintenance }), 409);
        expect(await call(`${base(fixture)}/rooms/${fixture.rooms[0].id}`, { token: auth.owner, method: 'DELETE' }), 409);
        expect(await call(`/merchant/therapists/${fixture.therapists[0].id}`, { token: auth.owner, method: 'DELETE' }), 409);
        assert.equal((await activeLocks(booked.id)).length, 3);
        // Simulate elapsed cleanup time on the exact fixture locks; no global clock
        // override invalidates authentication or changes unrelated reservations.
        await db.bookingResourceLock.updateMany({ where: { bookingId: BigInt(booked.id) }, data: { endAtUtc: new Date(Date.now() - 1000) } });
        await write(fixture, '/time-off', leave); await write(fixture, '/maintenance', maintenance);
        expect(await call(`${base(fixture)}/rooms/${fixture.rooms[0].id}`, { token: auth.owner, method: 'DELETE' }), 200);
        expect(await call(`/merchant/therapists/${fixture.therapists[0].id}`, { token: auth.owner, method: 'DELETE' }), 200);
      });

      await t.test('pending or retryable refunds block rescheduling and completion without changing resources', async () => {
        process.env.PAYMENT_PROVIDER = 'local_mock';
        try {
          for (const status of ['PENDING', 'RETRYABLE']) {
            const fixture = await makeFixture(); const booked = await create(fixture);
            const intent = expect(await call('/payments/create-intent', { token: auth.customer, body: { bookingId: booked.id } }), 201);
            expect(await call('/payments/confirm', { token: auth.customer, body: { paymentIntentId: intent.paymentIntentId } }), 201);
            const payment = await db.paymentRecord.findUniqueOrThrow({ where: { bookingId: BigInt(booked.id) } });
            const pending = await db.refundRequest.create({ data: { bookingId: BigInt(booked.id), paymentRecordId: payment.id, idempotencyKey: `pending-${prefix}-${status}`, amountCents: booked.totalCents, status } });
            const before = await activeLocks(booked.id);
            expect(await call(`/bookings/${booked.id}/reschedule`, { token: auth.customer, body: { date: baseDate, startTime: '12:00' } }), 409);
            assert.deepEqual(await activeLocks(booked.id), before); assert.equal(+(await readBooking(booked.id)).startTime, +utc('10:00'));
            // Age only this settled fixture to exercise the refund guard after the
            // service end, rather than merely hitting the separate early-end guard.
            const ended = new Date(Date.now() - 3600000), started = new Date(+ended - 3600000);
            await db.booking.update({ where: { id: BigInt(booked.id) }, data: { startTime: started, endTime: ended } });
            await db.bookingItem.updateMany({ where: { bookingId: BigInt(booked.id) }, data: { startAtUtc: started, endAtUtc: ended } });
            await db.bookingResourceLock.updateMany({ where: { bookingId: BigInt(booked.id) }, data: { startAtUtc: started, endAtUtc: ended } });
            const aged = await activeLocks(booked.id);
            expect(await call(`/bookings/${booked.id}/status?status=COMPLETED`, { token: auth.owner, method: 'PATCH', body: {} }), 409);
            assert.deepEqual(await activeLocks(booked.id), aged);
            const saved = await readBooking(booked.id); assert.equal(saved.status, 'CONFIRMED'); assert.equal(saved.refundedCents, 0);
            assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: pending.id } })).status, status);
            assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(booked.id), type: 'REFUND' } }), 0);
          }
        } finally { process.env.PAYMENT_PROVIDER = 'disabled'; }
      });

      await t.test('definitively failed refunds permit moving but cannot reuse their old key under a changed policy window', async () => {
        const fixture = await makeFixture(); const booked = await create(fixture);
        process.env.PAYMENT_PROVIDER = 'local_mock';
        try {
          const intent = expect(await call('/payments/create-intent', { token: auth.customer, body: { bookingId: booked.id } }), 201);
          expect(await call('/payments/confirm', { token: auth.customer, body: { paymentIntentId: intent.paymentIntentId } }), 201);
          const payment = await db.paymentRecord.findUniqueOrThrow({ where: { bookingId: BigInt(booked.id) } });
          const oldKey = `failed-${prefix}-refund`;
          const failed = await db.refundRequest.create({ data: { bookingId: BigInt(booked.id), paymentRecordId: payment.id, idempotencyKey: oldKey, amountCents: booked.totalCents, status: 'FAILED' } });
          expect(await call(`/bookings/${booked.id}/reschedule`, { token: auth.customer, body: { date: baseDate, startTime: '12:00' } }), 201);
          assert.equal((await activeLocks(booked.id)).length, 3);
          const near = new Date(Date.now() + 3600000), end = new Date(+near + 3600000);
          await db.booking.update({ where: { id: BigInt(booked.id) }, data: { startTime: near, endTime: end } });
          await db.bookingItem.updateMany({ where: { bookingId: BigInt(booked.id) }, data: { startAtUtc: near, endAtUtc: end } });
          await db.bookingResourceLock.updateMany({ where: { bookingId: BigInt(booked.id) }, data: { startAtUtc: near, endAtUtc: end } });
          expect(await call(`/bookings/${booked.id}/refund`, { token: auth.customer, body: {}, extra: { 'Idempotency-Key': oldKey } }), 400);
          assert.equal((await db.refundRequest.findUniqueOrThrow({ where: { id: failed.id } })).status, 'FAILED');
          assert.equal((await readBooking(booked.id)).refundedCents, 0);
          assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(booked.id), type: 'REFUND' } }), 0);
          const fresh = expect(await call(`/bookings/${booked.id}/refund`, { token: auth.customer, body: {}, extra: { 'Idempotency-Key': `new-policy-${prefix}` } }), 201);
          assert.equal(fresh.amountCents, Math.round(booked.totalCents * 0.5));
          assert.equal((await readBooking(booked.id)).refundedCents, Math.round(booked.totalCents * 0.5));
          assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(booked.id), type: 'REFUND' } }), 1);
        } finally { process.env.PAYMENT_PROVIDER = 'disabled'; }
      });

      await t.test('a verified local-only payment arriving after expiry does not reacquire released resources', async () => {
        const fixture = await makeFixture(); const booked = await create(fixture);
        process.env.PAYMENT_PROVIDER = 'local_mock';
        try {
          const intent = expect(await call('/payments/create-intent', { token: auth.customer, body: { bookingId: booked.id } }), 201);
          assert.equal(intent.provider, 'local_mock'); assert.equal(intent.mock, true);
          await db.booking.update({ where: { id: BigInt(booked.id) }, data: { holdExpiresAt: new Date(Date.now() - 60000) } });
          await slots(fixture); const replacement = await create(fixture);
          expect(await call('/payments/confirm', { token: auth.customer, body: { paymentIntentId: intent.paymentIntentId } }), 201);
          const late = await readBooking(booked.id); assert.equal(late.status, 'REFUNDING'); assert.equal(late.paymentStatus, 'PAID'); assert.equal(late.paidCents, late.totalCents); assert.equal((await activeLocks(booked.id)).length, 0);
          assert.equal((await activeLocks(replacement.id)).length, 3);
          expect(await call('/payments/confirm', { token: auth.customer, body: { paymentIntentId: intent.paymentIntentId } }), 201);
          assert.equal(await db.merchantTransaction.count({ where: { bookingId: BigInt(booked.id), type: 'PAYMENT' } }), 1);
          assert.equal(await db.paymentRecord.count({ where: { bookingId: BigInt(booked.id) } }), 1);
          await db.booking.update({ where: { id: BigInt(booked.id) }, data: { startTime: new Date(Date.now() + 3600000), endTime: new Date(Date.now() + 7200000) } });
          const refund = expect(await call(`/bookings/${booked.id}/refund`, { token: auth.customer, body: {}, extra: { 'Idempotency-Key': `late-full-${prefix}` } }), 201);
          assert.equal(refund.amountCents, late.totalCents, 'Released-resource late payments receive the full amount even within the usual partial-refund window');
          const refunded = await readBooking(booked.id); assert.equal(refunded.refundedCents, late.paidCents); assert.equal(refunded.paymentStatus, 'REFUNDED');
          assert.equal((await activeLocks(booked.id)).length, 0); assert.equal((await activeLocks(replacement.id)).length, 3);
        } finally { process.env.PAYMENT_PROVIDER = 'disabled'; }
      });

      await t.test('historical bookings without items or resource locks still conservatively block new reservations', async () => {
        const fixture = await makeFixture();
        const legacy = await db.booking.create({ data: { bookingNo: `LEG${randomUUID().replace(/-/g,'').slice(0,24)}`, userId: users.customer.id, shopId: fixture.shop.id, serviceId: fixture.service.id, therapistId: null, bookingDate: new Date(baseDate+'T00:00:00Z'), bookingTimezone: timezone, startTime: utc('10:00'), endTime: utc('11:00'), durationMin: 60, priceCents: 10025, totalCents: 10025, currency: 'usd', status: 'PENDING', paymentStatus: 'UNPAID', holdExpiresAt: null } });
        assert.equal(await db.bookingItem.count({ where: { bookingId: legacy.id } }), 0); assert.equal(await db.bookingResourceLock.count({ where: { shopId: fixture.shop.id } }), 0);
        assert.equal(available(await slots(fixture), '10:00'), false);
        await noWritesFor(fixture, async () => expect(await call('/bookings', { token: auth.customer, body: request(fixture) }), 409));
        await bookingService.expirePendingHolds(); assert.equal((await readBooking(legacy.id)).status, 'PENDING');
        await cancel(legacy.id); assert.equal(available(await slots(fixture), '10:00'), true);
      });

      await t.test('nonexistent or ambiguous local times and DST-crossing windows cannot be directly booked', async () => {
        const fixture = await makeFixture({ count: 1, duration: 60, staffBuffer: 0, roomBuffer: 0, open: '00:00', close: '06:00', shiftStart: 0, shiftEnd: 360 });
        const spring = '2035-03-11', autumn = '2035-11-04';
        assert.equal(new Date(spring+'T12:00:00Z').getUTCDay(), 0); assert.equal(new Date(autumn+'T12:00:00Z').getUTCDay(), 0);
        for (const [date, startTime] of [[spring,'02:30'], [autumn,'01:30']]) {
          assert.equal(available(await slots(fixture, { date }), startTime), false);
          expect(await call('/bookings', { token: auth.customer, body: request(fixture, { date, startTime }) }), 400);
        }
        assert.equal(available(await slots(fixture, { date: spring }), '01:30'), false, 'A wall-clock service spanning the skipped hour must not be offered');
        assert.equal(available(await slots(fixture, { date: spring }), '03:00'), true);
        const booked = await create(fixture, { date: spring, startTime: '03:00' });
        assert.equal(+(await readBooking(booked.id)).startTime, +new Date('2035-03-11T07:00:00Z'));
      });
      t.diagnostic(`RESOURCE_HTTP_MYSQL_EXECUTED migrations=${migrationCount}; exact disposable database cleanup follows; no external provider calls`);
    } finally {
      observer.current = null; globalThis.fetch = originalFetch;
      if (app) await app.close();
    }
  });
});
