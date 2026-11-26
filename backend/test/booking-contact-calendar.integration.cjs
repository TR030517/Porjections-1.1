/* Formal contracts promoted from the verified contact/calendar/guest SQL runs.
 * Run with an isolated TEST_DATABASE_URL, after generating the current client:
 * node --env-file=.env.test.local --test test/booking-contact-calendar.integration.cjs
 * withFreshDatabase creates/migrates a random mj2_test_booking_resources_* DB
 * on loopback:3310 and drops only that exact DB in finally. No main DB, vault,
 * AppModule dotenv, worker, payment transport or external delivery is loaded.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { installTestEnvironment, withFreshDatabase, deferred, within } = require('./booking-resources.support.cjs');

installTestEnvironment();
Object.assign(process.env, {
  BOOKING_ONLINE_PAYMENT_ENABLED: 'false', NOTIFICATION_WORKER_ENABLED: 'false',
  ORDER_EMAIL_ENABLED: 'false', ORDER_EMAIL_PROVIDER: '', ORDER_EMAIL_API_KEY: '',
  ORDER_EMAIL_FROM: '', ORDER_EMAIL_LOCAL_CAPTURE: 'false', ORDER_EMAIL_LOCAL_CAPTURE_DIR: '',
  NOTIFICATION_EMAIL_TRANSPORT: 'disabled', SOURCE_VAULT_KEY: '',
});
require('ts-node/register/transpile-only');
require('reflect-metadata');

async function rejected(action, statuses) {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  assert.ok(error, 'The command must reject');
  assert.ok([].concat(statuses).includes(error.getStatus?.()), 'Unexpected rejection status; private command/response omitted');
  return error;
}

// Pause after the actual SQL shop mutex, without replacing allocation/SQL or
// weakening transactions. The second client still uses a real MySQL connection.
function shopLockProbe(client, pauseAfterAcquire = true) {
  const entered = deferred(), release = deferred(); let intercepted = false;
  const proxy = new Proxy(client, {
    get(target, key) {
      if (key === '$transaction') return (callback, options) => target.$transaction(tx => callback(new Proxy(tx, {
        get(transaction, property) {
          const value = transaction[property];
          if (property !== '$queryRaw') return typeof value === 'function' ? value.bind(transaction) : value;
          return async (...args) => {
            const query = args[0], sql = query?.sql || query?.strings?.join('?') || (Array.isArray(query) ? query.join('?') : '');
            const firstShopLock = !intercepted && /\bFROM\s+`?shops`?\s/i.test(sql) && /\bFOR\s+UPDATE\b/i.test(sql);
            if (firstShopLock) intercepted = true;
            if (firstShopLock && !pauseAfterAcquire) entered.resolve();
            const result = await value.apply(transaction, args);
            if (firstShopLock && pauseAfterAcquire) {
              entered.resolve();
              await within(release.promise, 10000, 'SHOP_MUTEX_RELEASE_TIMEOUT');
            }
            return result;
          };
        },
      })), options);
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client: proxy, entered: within(entered.promise, 10000, 'SHOP_MUTEX_ENTER_TIMEOUT'), release: release.resolve };
}

test('fresh MySQL: verified booking contacts, accountless assisted guests and calendar commands', { timeout: 180000 }, async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('EXTERNAL_HTTP_FORBIDDEN_IN_CONTACT_CALENDAR_TEST'); };
  try {
    await withFreshDatabase(async ({ db, databaseUrl, migrationCount }) => {
      const { PrismaClient } = require('@prisma/client');
      const { BookingService } = require('../src/modules/booking/booking.service');
      const { CouponsService } = require('../src/modules/coupons/coupons.service');
      const { CalendarActionsService } = require('../src/modules/reservations/calendar-actions.service');
      const { BookingCalendarService } = require('../src/modules/reservations/booking-calendar.service');
      const { ReservationsService } = require('../src/modules/reservations/reservations.service');
      const { NotificationInboxService } = require('../src/modules/notifications/notification-inbox.service');
      const { localInstant } = require('../src/modules/booking/time');
      const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const bookingService = client => new BookingService(client, {}, {}, new CouponsService(client));
      const bookings = bookingService(db), calendar = new BookingCalendarService(db);
      const actions = new CalendarActionsService(db), reservations = new ReservationsService(db);
      const inbox = new NotificationInboxService(db), prefix = randomBytes(6).toString('hex');
      const timezone = 'America/New_York';
      // Future dates remain valid when CI is run in a later year.
      const dateAnchor = Date.now();
      const date = offset => new Date(dateAnchor + (14 + offset) * 86400000).toISOString().slice(0, 10);
      const actors = {}, users = {};
      const counters = async () => ({
        users: await db.user.count(), bookings: await db.booking.count(), items: await db.bookingItem.count(),
        locks: await db.bookingResourceLock.count(), tasks: await db.notificationOutbox.count(),
        guestReceipts: await db.guestBookingOperation.count(), calendarReceipts: await db.calendarActionReceipt.count(),
        blocks: await db.shopCalendarBlock.count(), settlements: await db.bookingSettlementEntry.count(),
        payments: await db.paymentRecord.count(), ledger: await db.merchantTransaction.count(), refunds: await db.refundRequest.count(),
      });
      const noMoney = async () => {
        assert.equal(await db.bookingSettlementEntry.count(), 0);
        assert.equal(await db.paymentRecord.count(), 0);
        assert.equal(await db.merchantTransaction.count(), 0);
        assert.equal(await db.refundRequest.count(), 0);
      };
      const noChanges = async work => { const before = await counters(); await work(); assert.deepEqual(await counters(), before); };
      const row = id => db.booking.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, resourceLocks: true } });
      let shop, foreign, services, therapists, room, foreignTherapist, staffGrant;
      const sid = () => String(shop.id);
      const contact = () => ({ name: '  Recorded contact  ', phone: '+1 (202) 555-0102', email: users.customer.email.toUpperCase() });
      const normalized = () => ({ name: 'Recorded contact', phone: '+12025550102', email: users.customer.email.toLowerCase() });
      const standard = (offset, time = '10:00', extra = {}) => ({ shopId: sid(), userId: String(users.customer.id),
        serviceId: String(services.first.id), date: date(offset), startTime: time,
        paymentMode: 'PAY_AT_STORE', contact: contact(), ...extra });
      const plan = (offset, time = '13:00') => ({ shopId: sid(), userId: String(users.customer.id), date: date(offset),
        startTime: time, paymentMode: 'PAY_AT_STORE', contact: contact(), items: [
          { participantIndex: 1, sequence: 1, serviceId: String(services.first.id) },
          { participantIndex: 1, sequence: 2, serviceId: String(services.second.id) },
        ] });
      const signed = async (input, isPlan = false) => {
        const quote = await bookings[isPlan ? 'quotePlan' : 'quoteBooking'](input);
        return { ...input, requestKey: randomUUID(), quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
      };
      const guest = (offset, extra = {}) => ({ shopId: sid(), serviceId: String(services.first.id), date: date(offset),
        startTime: '14:00', guestSource: 'PHONE', contact: { name: 'Private synthetic phone guest', phone: '+1 (202) 555-0198' }, ...extra });
      const guestCommand = async (input, actor = actors.owner) => {
        const quote = await bookings.quoteGuestAssistedBooking(actor, input);
        assert.equal(quote.paymentMode, 'PAY_AT_STORE');
        return { ...input, requestKey: randomUUID(), quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
      };
      const block = (offset, extra = {}) => ({ requestKey: randomUUID(), action: 'CREATE', expectedTimezone: timezone,
        purpose: 'TIME_BLOCK', scope: 'SHOP', startLocal: date(offset) + 'T14:00', endLocal: date(offset) + 'T16:00',
        reason: 'Private synthetic internal hold', ...extra });
      const execute = body => actions.execute(sid(), actors.owner, body);
      const release = receipt => execute({ requestKey: randomUUID(), action: 'RELEASE', expectedTimezone: timezone,
        blockId: receipt.result.blockId, expectedVersion: receipt.result.version });
      const slots = (offset, extra = {}) => bookings.getAvailableSlots({ shopId: sid(), serviceId: String(services.first.id), date: date(offset), ...extra });
      const available = (view, time) => view.slots.some(slot => slot.time === time && slot.available === true);
      const range = offset => ({ startDate: date(offset), endDate: date(offset + 1), pageSize: '100' });
      const verifyContact = booking => {
        assert.deepEqual({ name: booking.contactName, phone: booking.contactPhone, email: booking.contactEmail }, normalized());
        assert.equal(booking.contactSource, 'ONLINE_VERIFIED'); assert.equal(booking.contactVersion, 1);
        assert.ok(booking.contactEmailVerifiedAt instanceof Date); assert.equal(booking.bookingTimezone, timezone);
        assert.equal(booking.paymentMode, 'PAY_AT_STORE'); assert.equal(booking.paymentStatus, 'UNPAID');
      };

      try {
        for (const [name, role] of [['admin', 'ADMIN'], ['owner', 'MERCHANT'], ['outsider', 'MERCHANT'],
          ['manager', 'STAFF'], ['reader', 'STAFF'], ['config', 'STAFF'], ['customer', 'CUSTOMER']]) {
          users[name] = await db.user.create({ data: { role, name: 'Synthetic ' + name, email: `${prefix}.${name}@example.invalid`,
            ...(role === 'CUSTOMER' ? { emailVerifiedAt: new Date(), phone: '+12025550101' } : {}) } });
          actors[name] = { id: String(users[name].id), role };
        }
        const businessHours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
          .map(day => [day, { open: '09:00', close: '22:00', closed: false }]));
        const shopData = { ownerId: users.outsider.id, name: 'Synthetic contact and calendar', phone: '+12025550110',
          address: '1 Synthetic Way', city: 'New York', state: 'New York', zipCode: '10001', latitude: '40.7', longitude: '-74',
          category: 'MIXED', status: 'APPROVED', timezone, businessHours,
          studioProfile: { features: { onlineBooking: true }, bookingSettings: { minimumNoticeMinutes: 0, closedPeriods: [] },
            paymentPolicy: { payAtStoreEnabled: true } } };
        shop = await db.shop.create({ data: { ...shopData, shortName: 'contact-calendar-' + prefix } });
        foreign = await db.shop.create({ data: { ...shopData, shortName: 'contact-foreign-' + prefix } });
        await db.shopLoginBinding.create({ data: { shopId: shop.id, userId: users.owner.id, createdById: users.admin.id, reason: 'Synthetic binding' } });
        staffGrant = await db.shopStaffGrant.create({ data: { shopId: shop.id, userId: users.manager.id,
          createdById: users.admin.id, permissions: ['BOOKINGS_READ', 'BOOKINGS_MANAGE'] } });
        await db.shopStaffGrant.create({ data: { shopId: shop.id, userId: users.reader.id, createdById: users.admin.id, permissions: ['BOOKINGS_READ'] } });
        await db.shopStaffGrant.create({ data: { shopId: shop.id, userId: users.config.id, createdById: users.admin.id, permissions: ['RESERVATION_CONFIG'] } });
        await db.shopOrderEmailSetting.create({ data: { shopId: shop.id, enabled: true,
          recipientEmail: 'private.store@example.invalid', recipientVerifiedAt: new Date() } });
        services = {};
        for (const [name, priceCents, buffer] of [['first', 4000, 15], ['second', 3000, 0]]) {
          services[name] = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic ' + name,
            category: 'MASSAGE', durationMin: 30, priceCents, requiredRoomType: 'SINGLE', staffBufferMin: buffer, roomBufferMin: buffer } });
        }
        therapists = await Promise.all([1, 2].map(index => db.therapist.create({ data: { shopId: shop.id, name: 'Synthetic therapist ' + index } })));
        room = await db.shopRoom.create({ data: { shopId: shop.id, name: 'Synthetic treatment room', roomType: 'SINGLE' } });
        foreignTherapist = await db.therapist.create({ data: { shopId: foreign.id, name: 'Foreign synthetic therapist' } });

        await t.test('fresh checked-in migrations expose contact, guest receipt and calendar tables', async () => {
          assert.ok(migrationCount >= 34); assert.equal(await db.booking.count(), 0);
          assert.equal(await db.guestBookingOperation.count(), 0); assert.equal(await db.calendarActionReceipt.count(), 0);
          assert.equal(await db.shopCalendarBlock.count(), 0); await noMoney();
        });

        await t.test('STANDARD stores verified normalized contact and replays without rewriting it after a profile edit', async () => {
          const command = await signed(standard(0)), result = await bookings.createBooking(command), booking = await row(result.id);
          verifyContact(booking); assert.equal(booking.items.length, 1); assert.equal(booking.resourceLocks.length, 2);
          assert.equal(+booking.startTime, +localInstant(date(0), '10:00', timezone));
          assert.equal(booking.totalCents, 4000); assert.equal(booking.userId, users.customer.id);
          const emailTasks = await db.notificationOutbox.findMany({ where: { bookingId: booking.id, channel: 'EMAIL' } });
          assert.equal(emailTasks.length, 2); assert.ok(emailTasks.some(task => task.dataJson.audience === 'SHOP'));
          const serialized = JSON.stringify(emailTasks.map(task => task.dataJson));
          for (const value of Object.values(normalized())) assert.ok(!serialized.includes(value), 'Outbox must reference contact without copying PII');
          const original = await db.user.findUniqueOrThrow({ where: { id: users.customer.id } });
          try {
            await db.user.update({ where: { id: users.customer.id }, data: { name: 'Later profile name', phone: '+12025550103',
              email: `${prefix}.changed@example.invalid`, emailVerifiedAt: new Date() } });
            const detail = await bookings.getBooking(result.id, String(users.customer.id));
            assert.equal(detail.contact.email, original.email); assert.equal(detail.contact.name, 'Recorded contact');
            await noChanges(async () => {
              assert.equal((await bookings.createBooking(command)).id, result.id);
              await rejected(() => bookings.createBooking({ ...command, contact: { ...command.contact, name: 'Different snapshot' } }), 409);
            });
          } finally {
            await db.user.update({ where: { id: users.customer.id }, data: { name: original.name, phone: original.phone,
              email: original.email, emailVerifiedAt: original.emailVerifiedAt } });
          }
        });

        await t.test('ASSISTED_CUSTOMER stores the reviewed contact snapshot and exact retries keep it after account edits', async () => {
          const original = await db.user.findUniqueOrThrow({ where: { id: users.customer.id }, select: { name: true, phone: true, email: true, emailVerifiedAt: true } });
          const input = { shopId: sid(), customerId: String(users.customer.id), serviceId: String(services.first.id), date: date(18),
            startTime: '16:00', contact: contact() };
          const quote = await bookings.quoteAssistedBooking(actors.owner, input);
          const command = { ...input, requestKey: randomUUID(), quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
          try {
            const receipt = await bookings.createAssistedBooking(actors.owner, command);
            const booking = await row(receipt.id);
            verifyContact(booking); assert.equal(booking.bookingSource, 'ASSISTED_CUSTOMER'); assert.equal(booking.assistedById, users.owner.id);
            assert.equal(booking.status, 'PENDING'); assert.equal(booking.paymentStatus, 'UNPAID'); assert.equal(booking.paidCents, 0);
            assert.equal(await db.notificationOutbox.count({ where: { bookingId: booking.id, channel: 'EMAIL' } }), 2);
            await db.user.update({ where: { id: users.customer.id }, data: { name: 'Changed assisted profile', phone: '+12025550109', email: `${prefix}.assisted.changed@example.invalid`, emailVerifiedAt: null } });
            await noChanges(async () => {
              const replay = await bookings.createAssistedBooking(actors.owner, command);
              assert.equal(replay.id, receipt.id); assert.equal(replay.bookingNo, receipt.bookingNo);
              assert.deepEqual({ name: replay.contact.name, phone: replay.contact.phone, email: replay.contact.email }, normalized());
              const detail = await bookings.getBooking(receipt.id, actors.owner.id, actors.owner.role);
              assert.deepEqual(detail.reception.customer, { name: 'Recorded contact', phone: '+12025550102' });
              await rejected(() => bookings.createAssistedBooking(actors.owner, { ...command, contact: { ...command.contact, phone: '+12025550111' } }), 409);
            });
            assert.deepEqual(await row(receipt.id), booking);
          } finally {
            await db.user.update({ where: { id: users.customer.id }, data: original });
          }
        });

        await t.test('assisted quote binds normalized contact and missing contact never creates a new order', async () => {
          const input = { shopId: sid(), customerId: String(users.customer.id), serviceId: String(services.first.id), date: date(19), startTime: '16:00', contact: contact() };
          const quote = await bookings.quoteAssistedBooking(actors.owner, input);
          const command = { ...input, requestKey: randomUUID(), quoteHash: quote.quoteHash, quoteExpiresAt: quote.quoteExpiresAt };
          await noChanges(async () => {
            await rejected(() => bookings.createAssistedBooking(actors.owner, { ...command, contact: { ...contact(), name: 'Changed after review' } }), 409);
            await rejected(() => bookings.quoteAssistedBooking(actors.owner, { ...input, contact: undefined }), 400);
            await rejected(() => bookings.createAssistedBooking(actors.owner, { ...command, contact: undefined }), 400);
            const changedEmail = await rejected(() => bookings.quoteAssistedBooking(actors.owner, { ...input, contact: { ...contact(), email: 'another@example.invalid' } }), 409);
            assert.equal(changedEmail.getResponse().code, 'BOOKING_CONTACT_EMAIL_CHANGED');
            for (const actor of [actors.reader, actors.outsider, actors.customer]) await rejected(() => bookings.quoteAssistedBooking(actor, input), [403, 404]);
          });
          // Equivalent whitespace, phone formatting and email case share the
          // reviewed signature; a genuine change above cannot reuse it.
          const result = await bookings.createAssistedBooking(actors.owner, { ...command, contact: normalized() });
          verifyContact(await row(result.id)); await noMoney();
        });

        await t.test('legacy assisted no-contact commands may only recover their original committed order', async () => {
          const command = { shopId: sid(), customerId: String(users.customer.id), serviceId: String(services.first.id), date: date(20), startTime: '16:00', requestKey: randomUUID() };
          const requestHash = createHash('sha256').update(JSON.stringify({ shopId: sid(), serviceId: command.serviceId, variantId: null,
            preferredTherapistIds: [], date: command.date, startTime: command.startTime, durationMin: null, notes: null, couponId: null, paymentMode: 'PAY_AT_STORE' })).digest('hex');
          const legacy = await db.booking.create({ data: { userId: users.customer.id, shopId: shop.id, serviceId: services.first.id,
            therapistId: therapists[0].id, bookingNo: 'LEGACY-' + randomBytes(8).toString('hex'), bookingSource: 'ASSISTED_CUSTOMER', assistedById: users.owner.id,
            bookingDate: new Date(command.date + 'T00:00:00Z'), bookingTimezone: timezone,
            startTime: localInstant(command.date, command.startTime, timezone), endTime: localInstant(command.date, '16:30', timezone), durationMin: 30,
            priceCents: 4000, discountCents: 0, platformFeeCents: 0, tipCents: 0, totalCents: 4000, currency: 'usd',
            paymentMode: 'PAY_AT_STORE', paymentStatus: 'UNPAID', status: 'PENDING', requestKey: command.requestKey, requestHash } });
          const originalVerification = users.customer.emailVerifiedAt;
          await db.user.update({ where: { id: users.customer.id }, data: { emailVerifiedAt: null } });
          try {
            await noChanges(async () => {
              const replay = await bookings.createAssistedBooking(actors.owner, command);
              assert.equal(replay.id, String(legacy.id)); assert.equal(replay.bookingNo, legacy.bookingNo); assert.equal(replay.contact.recorded, false);
              await rejected(() => bookings.createAssistedBooking(actors.owner, { ...command, requestKey: randomUUID() }), 400);
              await rejected(() => bookings.createAssistedBooking(actors.owner, { ...command, contact: contact() }), 409);
            });
            const persisted = await db.booking.findUniqueOrThrow({ where: { id: legacy.id } });
            assert.equal(persisted.contactName, null); assert.equal(persisted.contactVersion, null); assert.equal(persisted.requestHash, requestHash);
          } finally { await db.user.update({ where: { id: users.customer.id }, data: { emailVerifiedAt: originalVerification } }); }
        });

        await t.test('PLAN carries the same verified contact through sequence, preparation time and exact totals', async () => {
          const command = await signed(plan(1), true), result = await bookings.createPlan(command), booking = await row(result.id);
          verifyContact(booking); assert.equal(booking.reservationKind, 'PLAN'); assert.equal(booking.totalCents, 7000);
          assert.equal(booking.durationMin, 75); assert.equal(booking.items.length, 2); assert.equal(booking.resourceLocks.length, 4);
          const items = booking.items.sort((a, b) => a.sequence - b.sequence);
          assert.equal(items[0].offsetMin, 0); assert.equal(items[1].offsetMin, 45);
          assert.equal(+items[1].startAtUtc - +items[0].endAtUtc, 15 * 60000);
          assert.equal(items.reduce((total, item) => total + item.priceCentsSnapshot, 0), 7000);
          await noChanges(async () => {
            assert.equal((await bookings.createPlan(command)).id, result.id);
            await rejected(() => bookings.createPlan({ ...command, contact: { ...command.contact, name: 'Changed plan contact' } }), 409);
          });
        });

        await t.test('missing, mismatched or unverified email rejects STANDARD and PLAN atomically', async () => {
          for (const isPlan of [false, true]) {
            const command = await signed(isPlan ? plan(2) : standard(2), isPlan);
            for (const value of [undefined, { ...contact(), email: 'another@example.invalid' }, { ...contact(), email: 'invalid' }]) {
              await noChanges(() => rejected(() => bookings[isPlan ? 'createPlan' : 'createBooking']({ ...command, contact: value }), [400, 409]));
            }
            await db.user.update({ where: { id: users.customer.id }, data: { emailVerifiedAt: null } });
            try { await noChanges(() => rejected(() => bookings[isPlan ? 'createPlan' : 'createBooking'](command), [400, 409])); }
            finally { await db.user.update({ where: { id: users.customer.id }, data: { emailVerifiedAt: users.customer.emailVerifiedAt } }); }
          }
        });

        await t.test('phone/walk-in guests never create or claim an account and have store-only email tasks', async () => {
          const originalUsers = await db.user.findMany({ orderBy: { id: 'asc' } });
          for (const [offset, extra] of [[3, {}], [4, { guestSource: 'WALK_IN', contact: {
            name: users.customer.name, phone: users.customer.phone, email: users.customer.email } }]]) {
            const receipt = await bookings.createGuestAssistedBooking(actors.owner, await guestCommand(guest(offset, extra)));
            const booking = await row(receipt.result.bookingId);
            assert.equal(booking.userId, null); assert.equal(booking.assistedById, users.owner.id);
            assert.equal(booking.bookingSource, 'ASSISTED_GUEST'); assert.equal(booking.contactSource, 'GUEST_ASSISTED');
            assert.equal(booking.contactEmailVerifiedAt, null); assert.equal(booking.status, 'PENDING');
            assert.equal(booking.paymentMode, 'PAY_AT_STORE'); assert.equal(booking.paymentStatus, 'UNPAID'); assert.equal(booking.paidCents, 0);
            assert.equal(booking.totalCents, 4000); assert.equal(booking.bookingTimezone, timezone);
            assert.equal(+booking.startTime, +localInstant(date(offset), '14:00', timezone));
            assert.equal(booking.items.length, 1); assert.equal(booking.resourceLocks.length, 2);
            assert.ok(booking.resourceLocks.every(lock => lock.status === 'ACTIVE' && +lock.endAtUtc === +booking.endTime + 15 * 60000));
            const tasks = await db.notificationOutbox.findMany({ where: { bookingId: booking.id } });
            assert.equal(tasks.length, 1); assert.equal(tasks[0].channel, 'EMAIL'); assert.equal(tasks[0].userId, null);
            assert.equal(tasks[0].dataJson.audience, 'SHOP'); assert.equal(tasks[0].dataJson.snapshot.version, 2);
            assert.equal(tasks[0].status, 'PENDING');
            const mail = await inbox.orderEmail(actors.owner, String(booking.id));
            assert.equal(mail.status, 'NOT_REQUESTED'); assert.equal(mail.tasks.length, 0); assert.equal(mail.storeTasks.length, 1);
            assert.equal(mail.statusReasonCode, offset === 3 ? 'ORDER_EMAIL_GUEST_NO_ADDRESS' : 'ORDER_EMAIL_GUEST_AUTHORIZATION_REQUIRED');
            await rejected(() => bookings.getBooking(String(booking.id), String(users.customer.id)), 404);
            await rejected(() => bookings.rescheduleBooking(String(booking.id), String(users.customer.id), { date: date(offset), startTime: '17:00' }, 'CUSTOMER', randomUUID()), 404);
            assert.ok(!(await bookings.listUserBookings(String(users.customer.id))).some(item => item.id === String(booking.id)));
            await bookings.updateBookingStatus(String(booking.id), actors.owner.id, 'CONFIRMED', actors.owner.role, randomUUID());
            const accepted = await row(booking.id); assert.equal(accepted.status, 'CONFIRMED'); assert.equal(accepted.paidCents, 0);
            assert.equal(accepted.paymentStatus, 'UNPAID');
            assert.ok((await db.notificationOutbox.findMany({ where: { bookingId: booking.id } })).every(task => task.channel === 'EMAIL' && task.userId === null && task.dataJson.audience === 'SHOP'));
          }
          assert.deepEqual(await db.user.findMany({ orderBy: { id: 'asc' } }), originalUsers); await noMoney();
        });

        await t.test('guest quote binds contact and rejects read-only, historical-owner and foreign-shop access', async () => {
          const command = await guestCommand(guest(5));
          await noChanges(async () => {
            await rejected(() => bookings.createGuestAssistedBooking(actors.owner, { ...command, contact: { ...command.contact, name: 'Unconfirmed replacement' } }), 409);
            for (const actor of [actors.reader, actors.outsider, actors.customer]) await rejected(() => bookings.quoteGuestAssistedBooking(actor, guest(5)), [403, 404]);
            await rejected(() => bookings.quoteGuestAssistedBooking(actors.owner, guest(5, { shopId: String(foreign.id) })), [403, 404]);
            await rejected(() => bookings.quoteGuestAssistedBooking(actors.owner, guest(5, { preferredTherapistIds: [String(foreignTherapist.id)] })), [400, 409]);
            await rejected(() => bookings.quoteGuestAssistedBooking(actors.owner, guest(5, { customerId: String(users.customer.id) })), 400);
          });
        });

        await t.test('concurrent same guest key creates once, lost replies recover and reconcile fences delayed originals', async () => {
          const command = await guestCommand(guest(6)), before = await counters();
          const results = await Promise.all([bookings.createGuestAssistedBooking(actors.owner, command), bookingService(other).createGuestAssistedBooking(actors.owner, command)]);
          assert.deepEqual(results[0], results[1]); assert.equal((await counters()).bookings, before.bookings + 1);
          assert.equal((await counters()).guestReceipts, before.guestReceipts + 1);
          await noChanges(async () => {
            assert.deepEqual(await bookings.guestAssistedBookingOperation(actors.owner, sid(), command.requestKey), results[0]);
            assert.deepEqual(await bookings.reconcileGuestAssistedBookingOperation(actors.owner, sid(), command.requestKey), results[0]);
            assert.deepEqual(await bookings.createGuestAssistedBooking(actors.owner, command), results[0]);
            await rejected(() => bookings.createGuestAssistedBooking(actors.owner, { ...command, guestSource: 'WALK_IN' }), 409);
          });
          const late = await guestCommand(guest(7));
          assert.equal((await bookings.guestAssistedBookingOperation(actors.owner, sid(), late.requestKey)).outcome, 'NOT_FOUND');
          const fence = await bookings.reconcileGuestAssistedBookingOperation(actors.owner, sid(), late.requestKey);
          assert.equal(fence.outcome, 'NOT_EXECUTED');
          await noChanges(async () => {
            assert.deepEqual(await bookings.reconcileGuestAssistedBookingOperation(actors.owner, sid(), late.requestKey), fence);
            await rejected(() => bookings.createGuestAssistedBooking(actors.owner, late), 409);
          });
          assert.equal((await bookings.guestAssistedBookingOperation(actors.manager, sid(), command.requestKey)).outcome, 'NOT_FOUND');
          await rejected(() => bookings.guestAssistedBookingOperation(actors.reader, sid(), command.requestKey), [403, 404]);
          await rejected(() => bookings.guestAssistedBookingOperation(actors.owner, String(foreign.id), command.requestKey), [403, 404]);
        });

        await t.test('SHOP occupancy blocks STANDARD and PLAN previews, quote/create, then versioned release restores them', async () => {
          const online = await signed(standard(8, '14:00')), itinerary = await signed(plan(8, '14:00'), true);
          const before = await counters(), command = block(8, { purpose: 'INTERNAL_OCCUPANCY' }), receipt = await execute(command);
          assert.equal(receipt.outcome, 'COMMITTED'); assert.equal(receipt.result.version, 1);
          const after = await counters(); assert.equal(after.bookings, before.bookings); assert.equal(after.tasks, before.tasks);
          assert.equal(available(await slots(8), '14:00'), false);
          assert.equal(available(await bookings.getPlanSlots(plan(8, '14:00')), '14:00'), false);
          for (const work of [() => bookings.quoteBooking(online), () => bookings.createBooking(online),
            () => bookings.quotePlan(itinerary), () => bookings.createPlan(itinerary)]) await noChanges(() => rejected(work, [400, 409]));
          await noChanges(async () => {
            assert.deepEqual(await execute(command), receipt);
            await rejected(() => execute({ ...command, reason: 'Changed key payload' }), 409);
          });
          const released = await release(receipt); assert.equal(released.result.version, 2);
          const stored = await db.shopCalendarBlock.findUniqueOrThrow({ where: { id: BigInt(receipt.result.blockId) } });
          assert.equal(stored.status, 'RELEASED'); assert.equal(stored.version, 2);
          assert.equal(available(await slots(8), '14:00'), true);
          assert.equal(available(await bookings.getPlanSlots(plan(8)), '14:00'), true);
          const final = await bookings.createPlan(await signed(plan(8, '14:00'), true)); assert.equal(final.status, 'PENDING');
          await noMoney();
        });

        await t.test('resource block CAS owns its backing row, stale edits fail and release removes exact time-off', async () => {
          const command = block(9, { scope: 'THERAPIST', resourceId: String(therapists[0].id) });
          const receipt = await execute(command), stored = await db.shopCalendarBlock.findUniqueOrThrow({ where: { id: BigInt(receipt.result.blockId) } });
          assert.ok(stored.timeOffId); assert.equal(available(await slots(9, { therapistId: String(therapists[0].id) }), '14:00'), false);
          assert.equal(available(await slots(9, { therapistId: String(therapists[1].id) }), '14:00'), true);
          const update = { ...command, action: 'UPDATE', requestKey: randomUUID(), blockId: receipt.result.blockId,
            expectedVersion: 1, startLocal: date(9) + 'T16:00', endLocal: date(9) + 'T17:00' };
          const edited = await execute(update); assert.equal(edited.result.version, 2);
          assert.equal((await db.shopCalendarBlock.findUniqueOrThrow({ where: { id: stored.id } })).timeOffId, stored.timeOffId);
          await noChanges(async () => {
            await rejected(() => execute({ ...update, requestKey: randomUUID(), reason: 'Stale overwrite' }), 409);
            await rejected(() => reservations.mutate(sid(), actors.owner, 'time-off', {}, String(stored.timeOffId), true), 409);
          });
          await release(edited); assert.equal(await db.therapistTimeOff.count({ where: { id: stored.timeOffId } }), 0);
          assert.equal(available(await slots(9, { therapistId: String(therapists[0].id) }), '16:00'), true);
        });

        await t.test('calendar projection hides contact/reasons while private configuration enforces current scope and grants', async () => {
          const receipt = await execute(block(10));
          const view = await calendar.events(sid(), actors.reader, range(10));
          assert.ok(view.events.some(event => event.blockId === receipt.result.blockId));
          const text = JSON.stringify(view);
          for (const value of ['Private synthetic internal hold', 'Private synthetic phone guest', users.customer.email, '+12025550198']) assert.ok(!text.includes(value));
          assert.equal((await actions.block(sid(), actors.config, receipt.result.blockId)).reason, 'Private synthetic internal hold');
          await rejected(() => actions.block(sid(), actors.reader, receipt.result.blockId), 403);
          await rejected(() => calendar.events(sid(), actors.config, range(10)), 403);
          await rejected(() => actions.block(String(foreign.id), actors.admin, receipt.result.blockId), 404);
          await rejected(() => execute(block(10, { scope: 'THERAPIST', resourceId: String(foreignTherapist.id) })), [400, 404]);
          await db.shopStaffGrant.update({ where: { id: staffGrant.id }, data: { status: 'REVOKED' } });
          try { await rejected(() => bookings.quoteGuestAssistedBooking(actors.manager, guest(11)), [403, 404]); }
          finally { await db.shopStaffGrant.update({ where: { id: staffGrant.id }, data: { status: 'ACTIVE' } }); }
          await release(receipt);
        });

        await t.test('CLOSE_DAY and legacy settings PATCH share CAS and cannot silently overwrite each other', async () => {
          const options = await actions.options(sid(), actors.owner, { date: date(12) });
          const settings = await reservations.bookingSettingsView(sid(), actors.owner);
          assert.equal(options.settingsHash, settings.bookingSettingsHash);
          const patched = await reservations.bookingSettings(sid(), actors.owner, { minimumNoticeMinutes: 0,
            closedPeriods: [{ startDate: date(13), endDate: date(13) }], expectedSettingsHash: settings.bookingSettingsHash });
          await rejected(() => execute({ requestKey: randomUUID(), action: 'CLOSE_DAY', expectedTimezone: timezone,
            date: date(12), expectedSettingsHash: options.settingsHash }), 409);
          const fresh = await actions.options(sid(), actors.owner, { date: date(12) });
          const close = { requestKey: randomUUID(), action: 'CLOSE_DAY', expectedTimezone: timezone,
            date: date(12), expectedSettingsHash: fresh.settingsHash };
          const receipt = await execute(close); assert.equal(receipt.result.closedDate, date(12));
          await noChanges(async () => {
            assert.deepEqual(await execute(close), receipt);
            await rejected(() => reservations.bookingSettings(sid(), actors.owner, { minimumNoticeMinutes: 0, closedPeriods: [],
              expectedSettingsHash: patched.item.bookingSettingsHash }), 409);
          });
          const projected = await calendar.events(sid(), actors.reader, range(12));
          assert.ok(projected.events.some(event => event.eventType === 'SHOP_CLOSURE' && event.allDay));
          assert.equal(available(await slots(12), '14:00'), false);
        });

        await t.test('existing guest order makes conflicting calendar commands fail without cancellation or new mail', async () => {
          const receipt = await bookings.createGuestAssistedBooking(actors.owner, await guestCommand(guest(14)));
          const before = await row(receipt.result.bookingId), counts = await counters();
          await rejected(() => execute(block(14)), 409);
          assert.deepEqual(await row(before.id), before); assert.deepEqual(await counters(), counts);
          const missing = randomUUID(); assert.equal((await actions.receipt(sid(), actors.owner, missing)).outcome, 'NOT_FOUND');
          assert.equal((await actions.reconcile(sid(), actors.owner, missing)).outcome, 'NOT_EXECUTED');
          await noChanges(() => rejected(() => execute({ ...block(15), requestKey: missing }), 409));
        });

        await t.test('actual MySQL shop mutex serializes calendar-first and guest-first conflicts in both directions', async () => {
          for (const calendarFirst of [true, false]) {
            const offset = calendarFirst ? 16 : 17, command = await guestCommand(guest(offset));
            const before = await counters();
            const gate = shopLockProbe(db), competing = shopLockProbe(other, false); let winner, loser;
            try {
              winner = calendarFirst ? new CalendarActionsService(gate.client).execute(sid(), actors.owner, block(offset))
                : bookingService(gate.client).createGuestAssistedBooking(actors.owner, command);
              // Attach an error observer immediately, including on setup failure.
              const winning = winner.then(value => ({ value }), error => ({ error }));
              await gate.entered;
              loser = calendarFirst ? bookingService(competing.client).createGuestAssistedBooking(actors.owner, command)
                : new CalendarActionsService(competing.client).execute(sid(), actors.owner, block(offset));
              let secondSettled = false;
              const losing = loser.then(value => { secondSettled = true; return { value }; }, error => { secondSettled = true; return { error }; });
              await competing.entered;
              assert.equal(secondSettled, false, 'The competing transaction must reach the real shop mutex before the first is released');
              gate.release();
              const result = await within(winning, 15000, 'SHOP_MUTEX_WINNER_TIMEOUT');
              assert.ok(!result.error, 'The first real shop-lock owner must commit'); assert.equal(result.value.outcome, 'COMMITTED');
              const conflict = await within(losing, 15000, 'SHOP_MUTEX_CONFLICT_TIMEOUT');
              assert.equal(conflict.error?.getStatus?.(), 409, 'The second real transaction must reread occupancy');
              const after = await counters();
              assert.equal(after.bookings, before.bookings + (calendarFirst ? 0 : 1));
              assert.equal(after.guestReceipts, before.guestReceipts + (calendarFirst ? 0 : 1));
              assert.equal(after.calendarReceipts, before.calendarReceipts + (calendarFirst ? 1 : 0));
              assert.equal(after.blocks, before.blocks + (calendarFirst ? 1 : 0));
              assert.equal(after.tasks, before.tasks + (calendarFirst ? 0 : 1));
            } finally {
              gate.release(); await Promise.allSettled([winner, loser].filter(Boolean));
            }
          }
          await noMoney();
        });
      } finally {
        // Direct services never start timers; disconnect the second client before
        // withFreshDatabase drops its generated database and verifies absence.
        await other.$disconnect();
      }
      t.diagnostic(`CONTACT_CALENDAR_CONTRACTS_COMPLETE migrations=${migrationCount}; exact disposable database cleanup follows`);
    });
  } finally { globalThis.fetch = originalFetch; }
});
