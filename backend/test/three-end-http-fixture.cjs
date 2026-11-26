/** Synthetic-only fixture for the root-owned NEW three-end stack. Never prints secrets. */
const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises'), path = require('node:path');
const { hash } = require('bcryptjs');
const MARKER = 'THREE_END_SYNTHETIC_ONLY';
function origin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || ['8088', '3000', '3001', '8002', '3310', '3306'].includes(url.port) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('THREE_END_TARGET_GUARD');
  return url.origin;
}
async function guard(db, { empty = false, expectedDatabase } = {}) {
  const rows = await db.$queryRawUnsafe('SELECT DATABASE() AS name');
  if (!/^massajoy2_three_end_[a-f0-9]{8}$/.test(rows[0]?.name ?? '') || expectedDatabase && rows[0].name !== expectedDatabase) throw Error('THREE_END_DATABASE_GUARD');
  const migrations = await db.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations');
  if (migrations.length !== 23 || migrations.some(row => !row.finished_at || row.rolled_back_at)) throw Error('THREE_END_MIGRATION_GUARD');
  if (process.env.PAYMENT_PROVIDER !== 'disabled' || process.env.PAYMENT_EXTERNAL_ENABLED !== 'false' || process.env.NODE_ENV !== 'test' || process.env.FCM_ENABLED !== 'false' || process.env.NOTIFICATION_WORKER_ENABLED !== 'false') throw Error('THREE_END_DISABLED_PROVIDER_GUARD');
  if (empty && (await db.user.count() || await db.shop.count() || await db.booking.count())) throw Error('THREE_END_EMPTY_BUSINESS_REQUIRED');
  return rows[0].name;
}
async function createThreeEndFixture(db, { target, secretsFile, acknowledge, expectedDatabase }) {
  if (acknowledge !== MARKER) throw Error('THREE_END_ACK_REQUIRED');
  const targetOrigin = origin(target);
  if (!path.isAbsolute(secretsFile) || !/^three-end-secrets(?:-[a-f0-9]{8})?\.json$/.test(path.basename(secretsFile))) throw Error('THREE_END_SECRETS_PATH_GUARD');
  await guard(db, { empty: true, expectedDatabase });
  // Refuse an existing secret bundle before creating any synthetic data.
  try { await fs.lstat(secretsFile); throw Error('THREE_END_SECRETS_ALREADY_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(secretsFile), { recursive: true });
  const runId = randomUUID(), suffix = runId.slice(0, 8), accounts = {}, users = {};
  for (const [index, [key, role]] of Object.entries({ admin: 'ADMIN', merchant: 'MERCHANT', linkedMerchant: 'MERCHANT', customer: 'CUSTOMER', otherCustomer: 'CUSTOMER', staff: 'STAFF' }).entries()) {
    const password = 'Synthetic-' + randomBytes(24).toString('base64url');
    const management = ['admin', 'merchant', 'linkedMerchant'].includes(key);
    accounts[key] = { role, identifier: management ? `three-${key.toLowerCase()}-${suffix}` : `three-${key.toLowerCase()}-${suffix}@example.invalid`, password,
      ...(management ? {} : { email: `three-${key.toLowerCase()}-${suffix}@example.invalid` }),
      passwordHash: await hash(password, 12), phone: management ? null : '+12025550' + String(100 + index) };
  }
  const fixture = await db.$transaction(async tx => {
    await guard(tx, { empty: true, expectedDatabase });
    for (const [key, data] of Object.entries(accounts)) users[key] = await tx.user.create({ data: {
      role: data.role, status: 'ACTIVE', name: 'Three-end synthetic ' + key, passwordHash: data.passwordHash,
      loginName: data.email ? null : data.identifier, email: data.email ?? null, emailVerifiedAt: data.role === 'CUSTOMER' ? new Date() : null, phone: data.phone,
    } });
    const historical = await tx.user.create({ data: { name: 'Synthetic suspended historical owner', role: 'MERCHANT', status: 'SUSPENDED', email: null, phone: null, passwordHash: null } });
    const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => [day, [{ open: '09:00', close: '21:00', closed: false }]]));
    const shops = [];
    for (const [index, [owner, login]] of [[historical, users.merchant], [users.linkedMerchant, users.linkedMerchant]].entries()) {
      const shop = await tx.shop.create({ data: { ownerId: owner.id, name: `Three-end Synthetic ${index ? 'B' : 'A'}`, shortName: `three-end-${suffix}-${index ? 'b' : 'a'}`,
        description: 'Synthetic business for isolated end-to-end acceptance only.', phone: '+12025550199', address: 'Synthetic business address', city: 'New York', state: 'NY', zipCode: '10001',
        latitude: 40.7128, longitude: -74.006, category: 'MIXED', timezone: 'America/New_York', status: 'APPROVED', businessHours: hours,
        studioProfile: { features: { onlineBooking: true, reviews: true }, paymentPolicy: { payAtStoreEnabled: true }, gallery: [] } } });
      await tx.shopLoginBinding.create({ data: { shopId: shop.id, userId: login.id, createdById: users.admin.id, reason: 'Synthetic explicit independent login binding' } });
      await tx.merchantProfile.create({ data: { shopId: shop.id, userId: owner.id, balanceCents: 0, pendingCents: 0, totalEarnedCents: 0 } });
      await tx.shopAlias.create({ data: { shopId: shop.id, kind: 'SHORT_NAME', source: 'massajoy', value: shop.shortName.toLowerCase() } });
      shops.push(shop);
    }
    const [shop, otherShop] = shops, legacyId = '900000' + String(100 + parseInt(suffix.slice(0, 2), 16));
    await tx.shopAlias.create({ data: { shopId: shop.id, kind: 'LEGACY_ID', source: 'massajoy1', value: legacyId } });
    await tx.shopStaffGrant.create({ data: { shopId: shop.id, userId: users.staff.id, createdById: users.merchant.id, status: 'ACTIVE', permissions: ['BOOKINGS_READ'] } });
    const service = await tx.shopService.create({ data: { shopId: shop.id, name: 'Synthetic Fixed Massage', category: 'MASSAGE', durationMin: 30, priceCents: 3000, priceBasis: 'PER_PERSON',
      requiredRoomType: 'SINGLE', staffBufferMin: 5, roomBufferMin: 10 } });
    const second = await tx.shopService.create({ data: { shopId: shop.id, name: 'Synthetic Foot Therapy', category: 'REFLEXOLOGY', durationMin: 30, priceCents: 2000,
      priceBasis: 'PER_PERSON', requiredRoomType: 'SINGLE', staffBufferMin: 5, roomBufferMin: 10 } });
    const variant = await tx.shopServiceVariant.create({ data: { serviceId: service.id, name: 'Fixed 30 Minutes', durationMin: 30, priceCents: 3500, priceBasis: 'PER_PERSON', currency: 'usd', isActive: true } });
    const variant60 = await tx.shopServiceVariant.create({ data: { serviceId: service.id, name: 'Fixed 60 Minutes', durationMin: 60, priceCents: 6000, priceBasis: 'PER_PERSON', currency: 'usd', isActive: true } });
    const therapists = [], rooms = [];
    for (let index = 0; index < 2; index++) {
      therapists.push(await tx.therapist.create({ data: { shopId: shop.id, name: `Synthetic Therapist ${index + 1}`, therapistServices: { create: [service, second].map(item => ({ serviceId: item.id })) },
        shifts: { create: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMin: 9 * 60, endMin: 21 * 60, isActive: true })) } } }));
      rooms.push(await tx.shopRoom.create({ data: { shopId: shop.id, name: `Synthetic Room ${index + 1}`, roomType: 'SINGLE', capacity: 1, isActive: true } }));
    }
    const coupon = await tx.coupon.create({ data: { shopId: shop.id, title: 'Synthetic full service coupon', type: 'PERCENT', value: 100, status: 'ACTIVE', validFrom: new Date(Date.now() - 60000), totalQuantity: 10, perUserLimit: 1 } });
    const product = await tx.giftCardProduct.create({ data: { shopId: shop.id, title: 'Synthetic Three-use Gift', priceCents: 4000, useTimes: 3, expireDays: 365, status: 'ACTIVE' } });
    await tx.shopGiftSalesPolicy.create({ data: { shopId: shop.id, payAtStoreEnabled: true } });
    const end = new Date(Date.now() - 3600000), start = new Date(+end - 30 * 60000);
    const past = await tx.booking.create({ data: { bookingNo: 'THREEPAST' + suffix, userId: users.customer.id, shopId: shop.id, serviceId: service.id, therapistId: therapists[0].id,
      bookingDate: new Date(start.toISOString().slice(0, 10) + 'T00:00:00Z'), bookingTimezone: shop.timezone, startTime: start, endTime: end, durationMin: 30,
      priceCents: 3500, totalCents: 3500, paymentMode: 'PAY_AT_STORE', status: 'CONFIRMED', paymentStatus: 'UNPAID',
      items: { create: { serviceId: service.id, variantId: variant.id, participantIndex: 1, sequence: 1, assignedTherapistId: therapists[0].id, assignedRoomId: rooms[0].id,
        serviceNameSnapshot: service.name, variantNameSnapshot: variant.name, roomTypeSnapshot: 'SINGLE', durationMin: 30, staffBufferMin: 5, roomBufferMin: 10,
        priceCentsSnapshot: 3500, quotedUnitPriceCents: 3500, priceBasisSnapshot: 'PER_PERSON', currency: 'usd', startAtUtc: start, endAtUtc: end } } } });
    return { shopId: String(shop.id), otherShopId: String(otherShop.id), shortName: shop.shortName, legacyId, serviceId: String(service.id), secondServiceId: String(second.id),
      variantId: String(variant.id), variant60Id: String(variant60.id), therapistIds: therapists.map(item => String(item.id)), roomIds: rooms.map(item => String(item.id)),
      productId: String(product.id), couponId: String(coupon.id), pastBookingId: String(past.id), customerId: String(users.customer.id), otherCustomerId: String(users.otherCustomer.id),
      historicalOwnerId: String(historical.id), independentMerchantId: String(users.merchant.id), timezone: shop.timezone,
      date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), unitPriceCents: 3500, giftPriceCents: 4000 };
  }, { timeout: 60000 });
  const secrets = { schemaVersion: 1, environmentMarker: MARKER, runId, target: targetOrigin,
    ...Object.fromEntries(Object.entries(accounts).map(([key, value]) => [key, { identifier: value.identifier, ...(value.email ? { email: value.email } : {}), password: value.password, role: value.role }])), fixture };
  await fs.writeFile(secretsFile, JSON.stringify(secrets, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { created: true, migrations: 23, accounts: 7, shops: 2, independentBindings: 2, staffReadGrants: 1, services: 2, variants: 2, therapists: 2, rooms: 2,
    actualEndedFixture: true, suspendedHistoricalOwnerIndependentOfLogin: true, secretsWritten: true };
}
module.exports = { createThreeEndFixture, threeEndDatabaseGuard: guard, threeEndOrigin: origin, THREE_END_MARKER: MARKER };
