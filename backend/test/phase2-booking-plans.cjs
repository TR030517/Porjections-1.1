// Current source services + a newly created, empty, disposable SQL database only.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { BookingService } = require('../src/modules/booking/booking.service');
const { PaymentService } = require('../src/modules/payment/payment.service');
const { SettlementService } = require('../src/modules/booking/settlement.service');
const { CouponsService } = require('../src/modules/coupons/coupons.service');
const { MerchantService } = require('../src/modules/merchant/merchant.service');
const { requireShopAccess } = require('../src/common/shop-access');
const { lockShop, reservationTransaction } = require('../src/modules/booking/lifecycle');
const results = [];
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.MASSAJOY_PHASE2_DISPOSABLE !== 'fresh-container-only' || url.hostname !== '127.0.0.1' || url.pathname !== '/massajoy2_phase2_check') throw Error('Disposable SQL target guard rejected');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    await db.$connect(); assert.equal(await db.user.count(), 0);
    await check('all thirteen migrations apply to a newly created empty MySQL', async () => assert.equal((await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).length, 13));
    const owner = await db.user.create({ data: { phone: 'TEST-PHASE2-OWNER', role: 'MERCHANT', name: 'Synthetic Owner' } });
    const customer = await db.user.create({ data: { phone: 'TEST-PHASE2-CUSTOMER', email: 'phase2-customer@example.invalid', emailVerifiedAt: new Date(), name: 'Synthetic Customer' } });
    const other = await db.user.create({ data: { phone: 'TEST-PHASE2-OTHER', name: 'Synthetic Other' } });
    const staff = await db.user.create({ data: { phone: 'TEST-PHASE2-STAFF', role: 'STAFF', name: 'Synthetic Staff' } });
    const shop = await db.shop.create({ data: { ownerId: owner.id, name: 'Phase2 synthetic shop', shortName: 'phase2-shop', phone: 'TEST-ONLY', address: 'Synthetic', city: 'Test', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', status: 'APPROVED', timezone: 'UTC', businessHours: Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => [day, [{ open: '08:00', close: '22:00' }]])), studioProfile: { features: { onlineBooking: true }, paymentPolicy: { payAtStoreEnabled: true } } } });
    const a = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic massage', category: 'MASSAGE', durationMin: 60, priceCents: 10000, staffBufferMin: 15, requiredRoomType: 'SINGLE' } });
    const b = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic second service', category: 'REFLEXOLOGY', durationMin: 30, priceCents: 7000 } });
    const couple = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic fixed package', category: 'MASSAGE', durationMin: 60, priceCents: 10001, priceBasis: 'PER_BOOKING', participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' } });
    for (let index = 0; index < 2; index++) await db.therapist.create({ data: { shopId: shop.id, name: 'Synthetic Therapist ' + index,
      therapistServices: { create: [a, b, couple].map(service => ({ serviceId: service.id })) }, shifts: { create: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMin: 0, endMin: 1440 })) } } });
    await db.shopRoom.create({ data: { shopId: shop.id, name: 'Synthetic single room', roomType: 'SINGLE', capacity: 1 } });
    await db.shopRoom.create({ data: { shopId: shop.id, name: 'Synthetic couple room', roomType: 'COUPLE', capacity: 2 } });
    const payments = new PaymentService(db), bookings = new BookingService(db, payments, {}, new CouponsService(db)), settlement = new SettlementService(db);
    const date = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const input = { shopId: String(shop.id), date, items: [{ participantIndex: 1, sequence: 1, serviceId: String(a.id) }, { participantIndex: 1, sequence: 2, serviceId: String(b.id) }, { participantIndex: 2, sequence: 1, serviceId: String(b.id) }] };
    let booking;
    await check('itinerary preview derives personal sequence, preparation gap and exact total', async () => {
      const preview = await bookings.getPlanSlots(input); assert.equal(preview.durationMin, 105); assert.equal(preview.participantCount, 2); assert.equal(preview.priceCents, 24000);
      assert.deepEqual(preview.items.map(item => item.offsetMin), [0,75,0]); assert.equal(preview.slots.find(slot => slot.time === '10:00').available, true);
    });
    await check('same-key concurrent group submission creates one booking, all segments and no external money', async () => {
      const command = { ...input, userId: String(customer.id), startTime: '10:00', requestKey: 'plan-same-key', paymentMode: 'PAY_AT_STORE', tipCents: 1500 };
      const rows = await Promise.all([bookings.createPlan(command), bookings.createPlan(command)]); assert.equal(rows[0].id, rows[1].id); booking = rows[0];
      assert.equal(booking.totalCents, 25500); assert.equal(booking.tipCents, 1500); assert.equal(booking.items.length, 3); assert.equal(booking.participantCount, 2);
      assert.equal(await db.booking.count(), 1); assert.equal(await db.bookingResourceLock.count({ where: { bookingId: BigInt(booking.id), status: 'ACTIVE' } }), 4);
      assert.equal(await db.paymentRecord.count(), 0); assert.equal(await db.merchantTransaction.count(), 0);
      await assert.rejects(bookings.createPlan({ ...command, tipCents: 1501 }), /different parameters/);
    });
    await check('a conflicting itinerary is rejected without leaving a partial booking or segment', async () => {
      const before = await db.bookingItem.count();
      await assert.rejects(bookings.createPlan({ ...input, userId: String(other.id), startTime: '10:00', requestKey: 'plan-conflict-key', paymentMode: 'PAY_AT_STORE' }), /accommodated/);
      assert.equal(await db.booking.count(), 1); assert.equal(await db.bookingItem.count(), before);
    });
    await check('failed group reschedule preserves the complete old itinerary and resource locks', async () => {
      const blocker = await bookings.createBooking({ shopId: String(shop.id), serviceId: String(couple.id), userId: String(other.id), date, startTime: '14:00', requestKey: 'block-move-key', paymentMode: 'PAY_AT_STORE' });
      const before = await db.bookingResourceLock.findMany({ where: { bookingId: BigInt(booking.id) }, orderBy: { id: 'asc' } });
      await assert.rejects(bookings.rescheduleBooking(booking.id, String(customer.id), { date, startTime: '14:00' }), /itinerary/);
      assert.deepEqual(await db.bookingResourceLock.findMany({ where: { bookingId: BigInt(booking.id) }, orderBy: { id: 'asc' } }), before);
      await bookings.cancelBooking(blocker.id, String(other.id));
    });
    await check('reschedule uses original prices and buffers after current catalog changes', async () => {
      await db.shopService.update({ where: { id: a.id }, data: { priceCents: 22222, durationMin: 120, staffBufferMin: 0 } });
      const preview = await bookings.getRescheduleSlots(booking.id, String(customer.id), 'CUSTOMER', date); assert.equal(preview.durationMin, 105); assert.equal(preview.priceCents, 24000);
      const moved = await bookings.rescheduleBooking(booking.id, String(customer.id), { date, startTime: '14:00' });
      assert.equal(moved.totalCents, 25500); assert.equal(moved.items[0].durationMin, 60); assert.equal(moved.items[1].offsetMin, 75); assert.equal(moved.items[0].quotedUnitPriceCents, 10000);
      assert.equal(moved.items[0].localStartTime, `${date}T14:00`); assert.equal(moved.items[1].localStartTime, `${date}T15:15`);
    });
    await check('legacy double package charges its fixed total once and conserves odd-cent allocation', async () => {
      const row = await bookings.createBooking({ shopId: String(shop.id), serviceId: String(couple.id), userId: String(other.id), date, startTime: '17:00', requestKey: 'fixed-double-key', paymentMode: 'PAY_AT_STORE' });
      assert.equal(row.priceCents, 10001); assert.deepEqual(row.items.map(item => item.priceCentsSnapshot), [5001,5000]);
      assert.equal(row.items.reduce((sum, item) => sum + item.priceCentsSnapshot, 0), row.priceCents);
      await bookings.cancelBooking(row.id, String(other.id));
      await assert.rejects(bookings.createPlan({ ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: String(couple.id) }], userId: String(customer.id), startTime: '17:00', requestKey: 'invalid-double-plan' }), /two-person packages/);
    });
    await check('a full service coupon never discounts the voluntary tip', async () => {
      const coupon = await db.coupon.create({ data: { title: 'Synthetic 100 percent', type: 'PERCENT', value: 100, shopId: shop.id, status: 'ACTIVE' } });
      const wallet = await db.userCoupon.create({ data: { userId: customer.id, couponId: coupon.id } });
      const row = await bookings.createPlan({ ...input, items: [{ participantIndex: 1, sequence: 1, serviceId: String(b.id) }], userId: String(customer.id), startTime: '18:00', requestKey: 'tip-not-discounted', paymentMode: 'PAY_AT_STORE', couponId: String(wallet.id), tipCents: 500 });
      assert.equal(row.discountCents, 7000); assert.equal(row.totalCents, 500); assert.equal(row.paymentMode, 'PAY_AT_STORE'); assert.equal(row.paymentStatus, 'UNPAID');
      assert.equal(await db.bookingSettlementEntry.count({ where: { bookingId: BigInt(row.id), kind: 'ZERO' } }), 0);
      await bookings.cancelBooking(row.id, String(customer.id));
    });
    const setPermissions = async permissions => db.shopStaffGrant.upsert({ where: { shopId_userId: { shopId: shop.id, userId: staff.id } }, create: { shopId: shop.id, userId: staff.id, createdById: owner.id, permissions }, update: { status: 'ACTIVE', permissions, revokedAt: null } });
    await check('staff read permission does not allow collect, change status, refund or read full finance', async () => {
      await setPermissions(['BOOKINGS_READ']);
      const merchant = new MerchantService(db, bookings);
      const shops = await merchant.getMyShops(String(staff.id), 'STAFF'); assert.equal(shops.length, 1); assert.deepEqual(shops[0].permissions, ['BOOKINGS_READ']); assert.equal(shops[0].isOwner, false);
      assert.equal((await bookings.getBooking(booking.id, String(staff.id), 'STAFF')).id, booking.id);
      const summary = await settlement.get(booking.id, String(staff.id), 'STAFF'); assert.equal(summary.allowedActions.confirm, false); assert.equal(summary.allowedActions.recordReceipt, false);
      await assert.rejects(bookings.updateBookingStatus(booking.id, String(staff.id), 'CONFIRMED', 'STAFF'));
      await assert.rejects(settlement.recordReceipt(booking.id, String(staff.id), 'STAFF', { requestKey: 'staff-read-denied', amountCents: 1, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic receipt' }));
      await assert.rejects(requireShopAccess(db, shop.id, { id: String(staff.id), role: 'STAFF' }, 'FINANCE_READ'));
      await assert.rejects(requireShopAccess(db, shop.id, { id: String(staff.id), role: 'STAFF' }, 'OWNER_ONLY'));
    });
    await check('staff operations are checked against precise current grant inside booking transactions', async () => {
      await setPermissions(['BOOKINGS_READ','BOOKINGS_MANAGE','SETTLEMENT_RECORD']);
      await bookings.updateBookingStatus(booking.id, String(staff.id), 'CONFIRMED', 'STAFF');
      const row = await settlement.recordReceipt(booking.id, String(staff.id), 'STAFF', { requestKey: 'staff-authorized-receipt', amountCents: 25500, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic actual cash receipt' }); assert.equal(row.paymentStatus, 'PAID');
      await assert.rejects(settlement.recordRefund(booking.id, String(staff.id), 'STAFF', { requestKey: 'staff-refund-denied', amountCents: 25500, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic refund attempt' }));
    });
    await check('staff single-package rescheduling retains an audit attributed to the actual staff account', async () => {
      const single = await bookings.createBooking({ shopId: String(shop.id), serviceId: String(b.id), userId: String(other.id), date, startTime: '19:00', requestKey: 'staff-single-audit', paymentMode: 'PAY_AT_STORE' });
      await bookings.rescheduleBooking(single.id, String(staff.id), { date, startTime: '19:30' }, 'STAFF');
      assert.equal(await db.auditLog.count({ where: { targetId: BigInt(single.id), action: 'BOOKING_RESCHEDULE', operatorId: staff.id } }), 1);
      await bookings.cancelBooking(single.id, String(other.id));
    });
    await check('revocation committed while another operation waits on the shop mutex prevents the later write', async () => {
      let entered; const locked = new Promise(resolve => entered = resolve); let unlock; const release = new Promise(resolve => unlock = resolve);
      const revoke = reservationTransaction(db, async tx => { await lockShop(tx, shop.id); await tx.shopStaffGrant.update({ where: { shopId_userId: { shopId: shop.id, userId: staff.id } }, data: { status: 'REVOKED', revokedAt: new Date() } }); entered(); await release; });
      await locked;
      let waiting; const attemptedLock = new Promise(resolve => waiting = resolve);
      const proxied = new Proxy(db, { get(target, key) { if (key !== '$transaction') { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; }
        return (callback, options) => target.$transaction(tx => callback(new Proxy(tx, { get(client, field) { const value = client[field]; if (field === '$queryRaw') return (...args) => { waiting(); return value.apply(client, args); }; return typeof value === 'function' ? value.bind(client) : value; } })), options); } });
      const concurrent = new BookingService(proxied, payments, {}, new CouponsService(db));
      const pending = concurrent.rescheduleBooking(booking.id, String(staff.id), { date, startTime: '16:00' }, 'STAFF');
      await attemptedLock; unlock(); await revoke; await assert.rejects(pending); assert.equal((await db.booking.findUnique({ where: { id: BigInt(booking.id) } })).startTime.toISOString(), `${date}T14:00:00.000Z`);
    });
    await check('customer paginated filtering keeps identity scope, stable totals and old array compatibility', async () => {
      const page = await bookings.listUserBookings(String(customer.id), { page: '1', pageSize: '1', search: 'Synthetic second' }); assert.equal(page.pageSize, 1); assert.ok(page.total >= 1); assert.equal(page.items.length, 1); assert.equal(page.items[0].userId, String(customer.id));
      const old = await bookings.listUserBookings(String(other.id)); assert.ok(Array.isArray(old)); assert.ok(old.every(item => item.userId === String(other.id)));
    });
    await check('a DST change in the preparation gap cannot move a later service outside opening hours', async () => {
      const dstShop = await db.shop.create({ data: { ownerId: owner.id, name: 'Synthetic DST shop', phone: 'TEST-ONLY', address: 'Synthetic', city: 'Test', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', status: 'APPROVED', timezone: 'America/New_York',
        businessHours: Object.fromEntries(['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => [day, [{ open: '00:30', close: '04:00' }]])), studioProfile: { features: { onlineBooking: true } } } });
      const first = await db.shopService.create({ data: { shopId: dstShop.id, name: 'Synthetic early service', category: 'MASSAGE', durationMin: 60, priceCents: 1000, staffBufferMin: 120 } });
      const second = await db.shopService.create({ data: { shopId: dstShop.id, name: 'Synthetic later service', category: 'MASSAGE', durationMin: 30, priceCents: 1000 } });
      await db.therapist.create({ data: { shopId: dstShop.id, name: 'Synthetic DST Therapist', therapistServices: { create: [first,second].map(service => ({ serviceId: service.id })) }, shifts: { create: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMin: 0, endMin: 360 })) } } });
      const command = { shopId: String(dstShop.id), date: '2031-03-09', items: [{ participantIndex: 1, sequence: 1, serviceId: String(first.id) }, { participantIndex: 1, sequence: 2, serviceId: String(second.id) }] };
      const preview = await bookings.getPlanSlots(command); assert.equal(preview.slots.find(slot => slot.time === '00:30').available, false);
      await assert.rejects(bookings.createPlan({ ...command, userId: String(customer.id), startTime: '00:30', requestKey: 'dst-gap-rejected' }), /accommodated/);
      assert.equal(await db.booking.count({ where: { shopId: dstShop.id } }), 0);
      const ordinary = await bookings.getPlanSlots({ ...command, date: '2031-03-08' }); assert.equal(ordinary.slots.find(slot => slot.time === '00:30').available, true);
    });
    await fs.writeFile(path.join(__dirname, '../../docs/verification/phase2-mysql-2026-10-28.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Current source services on a new isolated MySQL8.4; no HTTP/browser/provider or existing database', passed: results.length, results, deploymentReady: false }, null, 2) + '\n');
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
