// Synthetic fixtures and current source services on this run's new disposable SQL database only.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { GiftCardsService } = require('../src/modules/gift-cards/gift-cards.service');
const { NotificationWorker } = require('../src/modules/notifications/notification-worker.service');
const { NotificationInboxService } = require('../src/modules/notifications/notification-inbox.service');
const { enqueueNotification, syncBookingReminder } = require('../src/common/notification-outbox');
const results = [];
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.MASSAJOY_PHASE3_DISPOSABLE !== 'fresh-container-only' || url.hostname !== '127.0.0.1' || url.pathname !== '/massajoy2_phase3_check') throw Error('Disposable SQL target guard rejected');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    await db.$connect(); assert.equal(await db.user.count(), 0);
    await check('all fifteen migrations apply to a fresh empty MySQL database', async () => assert.equal((await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).length, 15));
    const owner = await db.user.create({ data: { phone: 'TEST-PHASE3-OWNER', role: 'MERCHANT', name: 'Synthetic Owner' } });
    const customer = await db.user.create({ data: { phone: 'TEST-PHASE3-CUSTOMER', email: 'phase3-customer@example.invalid', emailVerifiedAt: new Date(), name: 'Synthetic Customer' } });
    const other = await db.user.create({ data: { phone: 'TEST-PHASE3-OTHER', email: 'phase3-other@example.invalid', emailVerifiedAt: new Date(), name: 'Synthetic Other' } });
    const administrator = await db.user.create({ data: { phone: 'TEST-PHASE3-ADMIN', role: 'ADMIN', name: 'Synthetic Administrator' } });
    const shop = await db.shop.create({ data: { ownerId: owner.id, name: 'Phase3 synthetic shop', shortName: 'phase3-shop', phone: 'TEST-ONLY', address: 'Synthetic', city: 'Test', state: 'NY', zipCode: '00000', latitude: 1, longitude: 1, category: 'MIXED', status: 'APPROVED', timezone: 'UTC' } });
    const service = await db.shopService.create({ data: { shopId: shop.id, name: 'Synthetic service', category: 'MASSAGE', durationMin: 60, priceCents: 5700 } });
    const product = await db.giftCardProduct.create({ data: { shopId: shop.id, title: 'Synthetic three uses', priceCents: 5735, useTimes: 3, expireDays: 30, status: 'ACTIVE' } });
    const actor = { id: String(owner.id), role: 'MERCHANT' }, buyer = { id: String(customer.id), role: 'CUSTOMER' }, admin = { id: String(administrator.id), role: 'ADMIN' };
    const sid = String(shop.id), gifts = new GiftCardsService(db), inbox = new NotificationInboxService(db);
    const input = key => ({ productId: String(product.id), requestKey: key, paymentMethod: 'PAY_AT_STORE' });
    const evidence = key => ({ amountCents: 5735, method: 'CASH', reason: 'Synthetic actual offline payment evidence', requestKey: key });
    let order;
    await check('gift sales default closed and only authorized shop owner can explicitly enable', async () => {
      assert.equal((await gifts.salesPolicy(actor, sid)).payAtStoreEnabled, false);
      assert.equal((await gifts.products({ shopId: sid })).items[0].salesEnabled, false);
      await assert.rejects(gifts.createOrder(buyer, input('closed')));
      await assert.rejects(gifts.setSalesPolicy({ id: String(other.id), role: 'MERCHANT' }, sid, { payAtStoreEnabled: true }));
      await gifts.setSalesPolicy(actor, sid, { payAtStoreEnabled: true });
      assert.equal((await gifts.product(String(product.id))).item.salesEnabled, true);
    });
    await check('concurrent identical gift purchase submits once at frozen server price without issuing unpaid rights', async () => {
      const rows = await Promise.all([gifts.createOrder(buyer, input('purchase-one')), gifts.createOrder(buyer, input('purchase-one'))]);
      assert.equal(rows[0].item.id, rows[1].item.id); order = rows[0].item;
      assert.equal(order.status, 'PENDING'); assert.equal(order.paidCents, 0); assert.equal(order.allowedActions.recordReceipt, false);
      assert.equal(await db.giftCardEntitlement.count(), 0);
      await db.giftCardProduct.update({ where: { id: product.id }, data: { title: 'Later title', useTimes: 9 } });
      assert.equal((await gifts.createOrder(buyer, input('purchase-one'))).item.useTimesSnapshot, 3);
      for (const injection of [{ amountCents: 1 }, { status: 'PAID' }, { providerPaymentId: 'synthetic-forged' }, { paymentMethod: 'ONLINE' }]) await assert.rejects(gifts.createOrder(buyer, { ...input('forged'), ...injection }));
    });
    await check('notification insertion failure rolls back receipt, sale, entitlement and audit together', async () => {
      // Inject a persistence outage only at enqueue; every earlier write is still real MySQL in one real transaction.
      const failingDb = { $transaction: (work, options) => db.$transaction(tx => work(new Proxy(tx, { get(target, key) {
        if (key === '$executeRaw') return async sql => {
          if (sql.strings?.join('').includes('INSERT INTO notification_outbox')) throw Error('SYNTHETIC_OUTBOX_FAILURE');
          return target.$executeRaw(sql);
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } })), options) };
      await assert.rejects(new GiftCardsService(failingDb).recordReceipt(actor, sid, order.id, evidence('receipt-one')), /SYNTHETIC_OUTBOX_FAILURE/);
      assert.equal(await db.giftCardSaleEntry.count(), 0); assert.equal(await db.giftCardEntitlement.count(), 0);
      assert.equal((await gifts.order(buyer.id, order.id)).item.paidCents, 0);
    });
    await check('concurrent receipt replay issues one paid entitlement and immutable evidence with no online merchant funds', async () => {
      const rows = await Promise.all([gifts.recordReceipt(actor, sid, order.id, evidence('receipt-one')), gifts.recordReceipt(actor, sid, order.id, evidence('receipt-one'))]);
      assert.equal(rows[0].item.entitlementId, rows[1].item.entitlementId); order = rows[0].item;
      assert.equal(order.status, 'PAID'); assert.equal(order.receipts.length, 1); assert.equal(order.useTimesSnapshot, 3);
      assert.equal(await db.giftCardEntitlement.count(), 1); assert.equal(await db.giftCardSaleEntry.count(), 1);
      assert.equal(await db.paymentRecord.count(), 0); assert.equal(await db.merchantTransaction.count(), 0);
      await assert.rejects(gifts.recordReceipt(actor, sid, order.id, { ...evidence('receipt-one'), reason: 'Changed command' }));
      await assert.rejects(gifts.cancelOrder(buyer, order.id));
      await assert.rejects(gifts.order(String(other.id), order.id));
      assert.doesNotMatch(JSON.stringify(await gifts.order(buyer.id, order.id)), /tokenHash|purchaseKey|requestHash/);
    });
    await check('used purchase cannot be fully refunded; original credential binds uses and cannot replay', async () => {
      const voucher = await gifts.credential(buyer, order.entitlementId, { usedUses: 1 });
      await gifts.redeem(actor, sid, { token: voucher.token, usedUses: 1, requestKey: 'use-once' });
      await assert.rejects(gifts.redeem(actor, sid, { token: voucher.token, usedUses: 1, requestKey: 'use-again' }));
      await assert.rejects(gifts.recordRefund(actor, sid, order.id, evidence('refund-used')));
      assert.equal((await gifts.adminOrder(actor, sid, order.id)).item.allowedActions.recordRefund, false);
    });
    await check('full unspent refund is recorded once and revokes the issued credential atomically', async () => {
      const next = await gifts.createOrder(buyer, input('purchase-two'));
      const paid = await gifts.recordReceipt(actor, sid, next.item.id, evidence('receipt-two'));
      const voucher = await gifts.credential(buyer, paid.item.entitlementId, { usedUses: 1 });
      const rows = await Promise.all([gifts.recordRefund(actor, sid, paid.item.id, evidence('refund-two')), gifts.recordRefund(actor, sid, paid.item.id, evidence('refund-two'))]);
      assert.equal(rows[0].item.status, 'REFUNDED'); assert.equal(rows[0].item.refundedCents, 5735); assert.equal(rows[0].item.refunds.length, 1);
      await assert.rejects(gifts.redeem(actor, sid, { token: voucher.token, usedUses: 1, requestKey: 'use-refunded' }));
      assert.equal((await db.giftCardEntitlement.findUnique({ where: { id: paid.item.entitlementId } })).status, 'VOIDED');
    });
    await check('concurrent customer cancellation and actual receipt never leave both cancellation and active purchased rights', async () => {
      const next = await gifts.createOrder(buyer, input('purchase-race'));
      const results = await Promise.allSettled([gifts.cancelOrder(buyer, next.item.id), gifts.recordReceipt(actor, sid, next.item.id, evidence('receipt-race'))]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const row = await db.giftCardOrder.findUnique({ where: { id: BigInt(next.item.id) }, include: { rights: true, saleEntries: true } });
      assert.equal(row.rights.length, row.status === 'PAID' ? 1 : 0); assert.equal(row.saleEntries.length, row.status === 'PAID' ? 1 : 0);
      await gifts.setSalesPolicy(actor, sid, { payAtStoreEnabled: false }); await assert.rejects(gifts.createOrder(buyer, input('closed-again')));
    });
    await check('legacy gift quotes remain uncollectible and cannot fabricate purchased rights', async () => {
      const legacy = await db.giftCardOrder.create({ data: { orderNo: 'GC-PHASE3-LEGACY', userId: customer.id, shopId: shop.id, productId: product.id, amountCents: 5735 } });
      await assert.rejects(gifts.recordReceipt(actor, sid, String(legacy.id), evidence('legacy-receipt')));
      assert.equal((await gifts.adminOrder(actor, sid, String(legacy.id))).item.allowedActions.recordReceipt, false);
    });
    await check('outbox event replay keeps recipient immutable and a failed conflicting enqueue rolls back', async () => {
      const n = { eventKey: 'phase3:one-message', userId: customer.id, topic: 'GIFT_GRANTED', resourceType: 'SYSTEM', resourceId: 'synthetic' };
      await db.$transaction(tx => enqueueNotification(tx, n)); await db.$transaction(tx => enqueueNotification(tx, n));
      await assert.rejects(db.$transaction(tx => enqueueNotification(tx, { ...n, userId: other.id })));
      assert.equal(await db.notificationOutbox.count({ where: { eventKey: n.eventKey } }), 3);
    });
    const disabledFcm = { config: () => ({ enabled: false }), sendToUser: () => { throw Error('Disabled provider must never send'); } };
    const workerA = new NotificationWorker(db, disabledFcm), workerB = new NotificationWorker(db, disabledFcm);
    async function drain() { for (let i = 0; i < 20; i++) { if (!await db.notificationOutbox.count({ where: { status: 'PENDING', runAt: { lte: new Date() } } })) return; await Promise.all([workerA.runOnce(), workerB.runOnce()]); } throw Error('Outbox did not drain'); }
    await check('two workers publish one inbox item per event and disabled channels are skipped without provider calls', async () => {
      await drain();
      const published = await db.notificationOutbox.count({ where: { channel: 'IN_APP', status: 'PUBLISHED' } });
      assert.equal(await db.userNotification.count(), published); assert.ok(published > 0);
      assert.equal(await db.notificationOutbox.count({ where: { channel: { in: ['SMS', 'PUSH'] }, status: { not: 'SKIPPED' } } }), 0);
      const list = await inbox.list(String(customer.id), { page: 1, pageSize: 2 }); assert.equal(list.items.length, 2); assert.ok(list.total > 2);
      await assert.rejects(inbox.read(String(other.id), list.items[0].id)); await inbox.read(String(customer.id), list.items[0].id);
      await inbox.readAll(String(customer.id)); assert.equal((await inbox.list(String(customer.id), {})).unreadCount, 0);
      await assert.rejects(inbox.tasks(actor, {})); assert.doesNotMatch(JSON.stringify(await inbox.tasks(admin, {})), /tokenHash|dataJson|phone|contentHash|leaseToken/);
    });
    await check('rescheduled and cancelled bookings cannot publish obsolete reminders', async () => {
      const start = new Date(Date.now() + 600000), end = new Date(+start + 3600000);
      const b = await db.booking.create({ data: { bookingNo: 'P3-REMINDER', userId: customer.id, shopId: shop.id, serviceId: service.id, bookingDate: start, startTime: start, endTime: end, durationMin: 60, priceCents: 5700, totalCents: 5700, status: 'CONFIRMED', paymentMode: 'PAY_AT_STORE' } });
      await db.$transaction(tx => syncBookingReminder(tx, b));
      const moved = await db.booking.update({ where: { id: b.id }, data: { startTime: new Date(+start + 3600000), endTime: new Date(+end + 3600000) } });
      await db.$transaction(tx => syncBookingReminder(tx, moved)); await drain();
      assert.equal(await db.userNotification.count({ where: { bookingId: b.id, topic: 'BOOKING_REMINDER' } }), 0);
      const cancelled = await db.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
      await db.$transaction(tx => syncBookingReminder(tx, cancelled));
      assert.equal(await db.notificationOutbox.count({ where: { bookingId: b.id, topic: 'BOOKING_REMINDER', status: 'PENDING' } }), 0);
    });
    await check('crashed worker lease is reclaimed once and exhausted jobs require bounded audited admin retry', async () => {
      await db.$transaction(tx => enqueueNotification(tx, { eventKey: 'phase3:crash', userId: customer.id, topic: 'GIFT_GRANTED', resourceType: 'SYSTEM', resourceId: 'lease' }));
      const job = await db.notificationOutbox.findFirst({ where: { eventKey: 'phase3:crash', channel: 'IN_APP' } });
      await db.notificationOutbox.update({ where: { id: job.id }, data: { status: 'PROCESSING', attempts: 1, leaseToken: '00000000-0000-4000-8000-000000000001', leaseUntil: new Date(Date.now() - 1000) } });
      await Promise.all([workerA.runOnce(), workerB.runOnce()]); assert.equal(await db.userNotification.count({ where: { outboxId: job.id } }), 1);
      const failed = await db.notificationOutbox.findFirst({ where: { eventKey: 'phase3:crash', channel: 'SMS' } });
      await db.notificationOutbox.update({ where: { id: failed.id }, data: { status: 'PROCESSING', attempts: 5, leaseUntil: new Date(Date.now() - 1000) } });
      await workerA.runOnce(); assert.equal((await db.notificationOutbox.findUnique({ where: { id: failed.id } })).status, 'FAILED');
      await assert.rejects(inbox.retry(actor, failed.id, 'Synthetic retry reason'));
      for (let i = 0; i < 3; i++) { await inbox.retry(admin, failed.id, 'Synthetic retry reason'); await drain(); }
      await assert.rejects(inbox.retry(admin, failed.id, 'Synthetic retry reason'));
    });
    if (await fs.stat(path.join(__dirname, 'phase3-payment-recovery.cjs')).catch(() => null)) await require('./phase3-payment-recovery.cjs').runPaymentRecovery(db, { check, owner, customer, shop, service });
    else throw Error('Payment recovery SQL cases are required for this batch');
    await fs.writeFile(path.join(__dirname, '../../docs/verification/phase3-mysql-2026-10-28.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), target: 'new disposable MySQL only', migrations: 15, results }, null, 2));
    console.log(`Completed ${results.length} source-service SQL checks.`);
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
