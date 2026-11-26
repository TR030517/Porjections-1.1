// Invoked only by the parent-owned fresh disposable phase3 runner. No env/DB setup or network access here.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { PaymentService } = require('../src/modules/payment/payment.service');
const { SquareProvider } = require('../src/modules/payment/square.provider');
const { AfterSalesService } = require('../src/modules/after-sales/after-sales.service');

async function runPaymentRecovery(db, { check, owner, customer, shop, service }) {
  const id = value => BigInt(value.id ?? value), ownerId = id(owner), customerId = id(customer), shopId = id(shop), serviceId = id(service);
  const seed = randomUUID().replaceAll('-', '').slice(0, 12);
  const merchant = { id: String(ownerId), role: 'MERCHANT' }, client = { id: String(customerId), role: 'CUSTOMER' };
  const environment = { PAYMENT_PROVIDER: 'square', PAYMENT_EXTERNAL_ENABLED: 'true', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'synthetic-phase3-no-real-token',
    SQUARE_LOCATION_ID: 'SYNTHETIC_LOCATION', SQUARE_MERCHANT_ID: 'SYNTHETIC_MERCHANT', SQUARE_CURRENCY: 'USD', SQUARE_SHOP_ID: String(shopId),
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'synthetic-phase3-signature', SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://api.example.test/square', SQUARE_CHECKOUT_REDIRECT_URL: 'https://app.example.test/' };
  const orders = new Map(), paymentsById = new Map(), refundsById = new Map(), submissions = [];
  let loseFirstResponse = true, nextRefundStatus = 'COMPLETED';
  const transport = async (url, options) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://connect.squareupsandbox.com');
    let result;
    if (options.method === 'GET') {
      assert.equal(options.body, undefined);
      const parts = parsed.pathname.split('/'), key = decodeURIComponent(parts.at(-1));
      if (parts[2] === 'orders') result = { order: orders.get(key) };
      else if (parts[2] === 'payments') result = { payment: paymentsById.get(key) };
      else if (parts[2] === 'refunds') result = { refund: refundsById.get(key) };
      else throw Error('Unexpected synthetic channel GET');
    } else {
      assert.equal(options.method, 'POST'); assert.equal(parsed.pathname, '/v2/refunds');
      const input = JSON.parse(options.body); submissions.push(input);
      let refund = [...refundsById.values()].find(row => row.syntheticKey === input.idempotency_key);
      if (!refund) {
        refund = { id: `REFUND_${seed}_${refundsById.size}`, payment_id: input.payment_id, location_id: environment.SQUARE_LOCATION_ID,
          status: nextRefundStatus, amount_money: input.amount_money, reason: input.reason, syntheticKey: input.idempotency_key };
        refundsById.set(refund.id, refund);
      }
      if (loseFirstResponse) { loseFirstResponse = false; throw Error('Synthetic provider accepted refund then response was lost'); }
      result = { refund };
    }
    return new Response(JSON.stringify(result), { status: 200 });
  };
  const square = new SquareProvider(environment, transport), payments = new PaymentService(db), after = new AfterSalesService(db, payments);
  payments.square = square;
  // Local service instance only; no process env configuration, real credentials or providers are enabled.
  payments.config = () => ({ ...square.config(), checkout: 'hosted' });
  await db.merchantProfile.upsert({ where: { shopId }, create: { shopId, userId: ownerId }, update: {} });
  const makeBooking = async suffix => {
    const start = new Date(Date.now() + 10 * 86400000), end = new Date(+start + 3600000);
    const booking = await db.booking.create({ data: { bookingNo: `B07${seed}${suffix}`, userId: customerId, shopId, serviceId,
      bookingDate: new Date(start.toISOString().slice(0, 10) + 'T00:00:00Z'), bookingTimezone: 'UTC', startTime: start, endTime: end, durationMin: 60,
      priceCents: 9000, platformFeeCents: 1000, totalCents: 10000, currency: 'usd', paymentMode: 'ONLINE', holdExpiresAt: new Date(Date.now() + 15 * 60000) } });
    const record = await db.paymentRecord.create({ data: { bookingId: booking.id, provider: 'square', providerBinding: square.binding(),
      providerOrderId: `ORDER_${seed}_${suffix}`, idempotencyKey: `b07:${seed}:${suffix}:payment`, amountCents: 10000, currency: 'usd' } });
    const paymentId = `PAY_${seed}_${suffix}`;
    orders.set(record.providerOrderId, { id: record.providerOrderId, location_id: environment.SQUARE_LOCATION_ID, reference_id: record.id,
      total_money: { amount: 10000, currency: 'USD' }, tenders: [{ payment_id: paymentId }] });
    paymentsById.set(paymentId, { id: paymentId, order_id: record.providerOrderId, location_id: environment.SQUARE_LOCATION_ID, status: 'COMPLETED',
      amount_money: { amount: 10000, currency: 'USD' }, total_money: { amount: 10000, currency: 'USD' } });
    return { booking, record, paymentId };
  };
  const main = await makeBooking('main');
  await check('B07 trusted Square GET proof settles once with transactional customer notifications', async () => {
    await payments.reconcileBooking(String(main.booking.id), client.id, client.role);
    await payments.reconcileBooking(String(main.booking.id), client.id, client.role);
    const row = await db.booking.findUniqueOrThrow({ where: { id: main.booking.id } });
    assert.equal(row.paidCents, 10000); assert.equal(row.status, 'CONFIRMED');
    assert.equal(await db.merchantTransaction.count({ where: { bookingId: row.id, type: 'PAYMENT' } }), 1);
    const notify = await db.$queryRaw(Prisma.sql`SELECT topic,COUNT(*) AS count FROM notification_outbox WHERE event_key=${`payment:${main.record.id}:completed`} GROUP BY topic`);
    assert.equal(notify.length, 1); assert.equal(notify[0].topic, 'PAYMENT_RECEIVED'); assert.equal(Number(notify[0].count), 3);
    assert.equal(submissions.length, 0);
  });
  let ticket;
  await check('B07 accepted refund case uses real customer and owner workflow', async () => {
    ticket = await after.create(client, { bookingId: String(main.booking.id), type: 'REFUND', reason: 'Synthetic phase3 refund request', requestedAmountCents: 2500 });
    ticket = await after.claim(merchant, ticket.id, { version: ticket.version });
    ticket = await after.transition(merchant, ticket.id, { version: ticket.version, action: 'ACCEPT' });
    assert.equal(ticket.status, 'IN_PROGRESS');
  });
  let original;
  await check('B07 lost refund response fences another key and controlled GET does not submit another refund', async () => {
    await assert.rejects(after.refund(merchant, ticket.id, { version: ticket.version }), /not confirmed/);
    original = await db.refundRequest.findUniqueOrThrow({ where: { idempotencyKey: `after-sales:${ticket.id}:refund` } });
    assert.equal(original.status, 'RETRYABLE'); assert.equal(original.providerRefundId, null);
    await assert.rejects(payments.refundBooking(String(main.booking.id), merchant.id, merchant.role, 2500, `b07:${seed}:other-key`), /original refund is still unresolved/);
    ticket = await after.detail(merchant, ticket.id);
    ticket = await after.reconcile(merchant, ticket.id, { version: ticket.version });
    assert.equal(ticket.refundState, 'RETRYABLE'); assert.equal(ticket.status, 'IN_PROGRESS'); assert.equal(submissions.length, 1);
    await assert.rejects(after.transition(merchant, ticket.id, { version: ticket.version, action: 'RESOLVE', reason: 'Must remain fenced' }), /refund|Reconcile/i);
  });
  await check('B07 original-key retry recovers accepted provider result and synchronizes without automatic resolution or actor event', async () => {
    const beforeEvents = await db.afterSalesEvent.count({ where: { caseId: BigInt(ticket.id) } });
    await payments.refundBooking(String(main.booking.id), merchant.id, merchant.role, 2500, original.idempotencyKey);
    assert.equal(submissions.length, 2); assert.equal(submissions[0].idempotency_key, submissions[1].idempotency_key);
    assert.equal(await db.refundRequest.count({ where: { bookingId: main.booking.id } }), 1);
    const fresh = await db.afterSalesCase.findUniqueOrThrow({ where: { id: BigInt(ticket.id) } });
    assert.equal(fresh.refundState, 'SUCCEEDED'); assert.equal(fresh.refundRequestId, original.id); assert.equal(fresh.status, 'IN_PROGRESS');
    assert.equal(await db.afterSalesEvent.count({ where: { caseId: fresh.id } }), beforeEvents);
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: main.booking.id } })).refundedCents, 2500);
  });
  await check('B07 duplicate confirmed refund proof does not double ledger or enqueue', async () => {
    const row = await db.refundRequest.findUniqueOrThrow({ where: { id: original.id } });
    const refund = await square.getRefund(row.providerRefundId);
    for (const suffix of ['a', 'b']) await payments.processEvent('square', { id: `b07:${seed}:duplicate:${suffix}`, type: 'square.refund', data: { object: refund } });
    await payments.refundBooking(String(main.booking.id), merchant.id, merchant.role, 2500, original.idempotencyKey);
    assert.equal(submissions.length, 2);
    assert.equal(await db.merchantTransaction.count({ where: { bookingId: main.booking.id, type: 'REFUND' } }), 1);
    const notify = await db.$queryRaw(Prisma.sql`SELECT COUNT(*) AS count FROM notification_outbox WHERE event_key=${`refund:${original.id}:processed`}`);
    assert.equal(Number(notify[0].count), 3);
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: main.booking.id } })).refundedCents, 2500);
  });
  await check('B07 known pending refund is recovered by GET rather than another submit', async () => {
    nextRefundStatus = 'PENDING';
    const result = await payments.refundBooking(String(main.booking.id), merchant.id, merchant.role, 1500, `b07:${seed}:second-refund`);
    assert.equal(result.status, 'PENDING'); const before = submissions.length;
    refundsById.get(result.refundId).status = 'COMPLETED';
    await payments.reconcileBooking(String(main.booking.id), merchant.id, merchant.role);
    assert.equal(submissions.length, before);
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: main.booking.id } })).refundedCents, 4000);
  });
  for (const mismatch of ['amount', 'location']) await check(`B07 ${mismatch} mismatch rejects provider proof without local settlement`, async () => {
    const f = await makeBooking(mismatch), order = orders.get(f.record.providerOrderId);
    if (mismatch === 'amount') order.total_money.amount = 9999; else order.location_id = 'OTHER_LOCATION';
    await assert.rejects(payments.reconcileBooking(String(f.booking.id), client.id, client.role), /match/);
    assert.equal((await db.paymentRecord.findUniqueOrThrow({ where: { id: f.record.id } })).status, 'CREATED');
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: f.booking.id } })).paidCents, 0);
    assert.equal(await db.merchantTransaction.count({ where: { bookingId: f.booking.id } }), 0);
  });
  return { scope: 'real local MySQL ledger and outbox; fully mocked Square transport; no external payment', checks: 8 };
}
module.exports = { runPaymentRecovery };
