import { Injectable, BadRequestException, NotFoundException, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { requireShopAccess } from '../../common/shop-access';
import { cents, numericId, quoteCents } from './money';
import { SquareProvider } from './square.provider';
import { expireShopHolds, lockShop, releaseReservation, reservationTransaction } from '../booking/lifecycle';
import { syncRefundCase } from '../after-sales/refund-sync';
import { enqueueNotification, syncBookingReminder } from '../../common/notification-outbox';
import { bookingAddOnsView } from '../../common/booking-addons-view';
import { bookingOnlinePaymentEnabled, bookingOrderPolicy } from '../../common/order-mode';

@Injectable()
export class PaymentService {
  private stripe?: Stripe;
  private square?: SquareProvider;
  constructor(private readonly prisma: PrismaService) {}
  private refundPolicy() {
    const local = process.env.PAYMENT_PROVIDER === 'local_mock' && process.env.NODE_ENV !== 'production';
    const hours = process.env.REFUND_POLICY_FULL_HOURS ?? (local ? '24' : undefined);
    const percentage = process.env.REFUND_POLICY_PARTIAL_PERCENT ?? (local ? '50' : undefined);
    if (!hours?.trim() || !percentage?.trim()) return null;
    const fullHours = Number(hours); const percent = Number(percentage);
    return Number.isFinite(fullHours) && fullHours >= 0 && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? { fullHours, percent } : null;
  }
  private configuredPayment(): { enabled: boolean; provider: string; reason?: string; mock?: boolean; publishableKey?: string; environment?: string; currency?: string; checkout?: string; shopId?: string } {
    const provider = process.env.PAYMENT_PROVIDER || 'disabled';
    if (['square', 'stripe'].includes(provider) && !this.refundPolicy()) return { enabled: false, provider, reason: 'An explicit valid refund policy is required before accepting payments' };
    if (provider === 'square') return { ...this.squareClient().config(), checkout: 'hosted' };
    if (provider === 'local_mock' && process.env.NODE_ENV !== 'production') return { enabled: true, provider, mock: true };
    if (provider === 'stripe' && process.env.PAYMENT_EXTERNAL_ENABLED === 'true' && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) return { enabled: true, provider, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY };
    return { enabled: false, provider, reason: 'Payment is not configured' };
  }
  config(): ReturnType<PaymentService['configuredPayment']> & ReturnType<typeof bookingOrderPolicy> {
    if (!bookingOnlinePaymentEnabled()) return { ...bookingOrderPolicy(), enabled: false, provider: process.env.PAYMENT_PROVIDER || 'disabled',
      reason: 'Online booking payment is currently disabled; arrange payment directly with the shop' };
    return { ...this.configuredPayment(), ...bookingOrderPolicy() };
  }
  isRefundProviderAvailable(): boolean {
    return this.configuredPayment().enabled;
  }
  private requireNewOnlinePayment() {
    if (!bookingOnlinePaymentEnabled()) throw new ServiceUnavailableException({ code: 'BOOKING_ONLINE_PAYMENT_DISABLED',
      message: 'Online booking payment is currently disabled; arrange payment directly with the shop' });
  }
  private provider() {
    // Existing provider settlement, signed webhooks, reconciliation and refunds
    // must remain available after closing new checkout admission.
    const config = this.configuredPayment();
    if (!config.enabled) throw new ServiceUnavailableException(config.reason);
    return config.provider;
  }
  private client() {
    if (this.provider() !== 'stripe') throw new ServiceUnavailableException('Stripe is not enabled');
    return this.stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  private squareClient() { return this.square ?? new SquareProvider(); }
  private assertSquareShop(provider: string, shopId: bigint) {
    if (provider === 'square' && this.squareClient().config().shopId !== shopId.toString()) throw new ServiceUnavailableException('Square is not configured for this shop');
  }
  private assertSquareRecord(record: any, shopId: bigint) {
    if (record.provider !== 'square') return;
    this.assertSquareShop(record.provider, shopId);
    const current = this.squareClient().binding(); const saved = record.providerBinding;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length !== Object.keys(current).length || Object.entries(current).some(([key,value]) => saved[key] !== value)) throw new ServiceUnavailableException('Square payment configuration changed or its original binding is unavailable; reconcile with the original configuration');
  }
  private async assertSquareAvailability(db: any, shopId: bigint, bookingId: bigint) {
    this.assertSquareShop('square', shopId);
    const records = await db.paymentRecord.findMany({ where: { provider: 'square', OR: [{ bookingId }, { status: 'CREATED', booking: { shopId } }] } });
    for (const record of records) this.assertSquareRecord(record, shopId);
  }
  private async ownedBooking(id: string, user: string) {
    const b = await this.prisma.booking.findUnique({ where: { id: numericId(id) }, include: { items: true, addOns: true } });
    if (!b || b.deletedAt || b.userId?.toString() !== user) throw new NotFoundException('Booking not found'); return b;
  }
  async quote(bookingId: string, userId: string) {
    const b = await this.ownedBooking(bookingId, userId);
    const q = quoteCents(b.priceCents, b.discountCents, b.platformFeeCents, b.tipCents ?? 0);
    if (q.totalCents !== b.totalCents) throw new ConflictException('Booking quote needs review');
    const config = this.config(); let paymentEnabled = config.enabled; let reason = config.reason;
    if ((b.paymentMode ?? 'ONLINE') !== 'ONLINE') { paymentEnabled = false; reason = b.paymentMode === 'ZERO' ? 'No money is due for this reservation' : 'This reservation is payable at the store'; }
    if (b.status !== 'PENDING' || b.paymentStatus !== 'UNPAID' || b.holdExpiresAt && b.holdExpiresAt <= new Date()) { paymentEnabled = false; reason = 'Reservation is no longer payable; refresh its status'; }
    if (paymentEnabled) {
      try { this.assertSquareShop(config.provider, b.shopId); if (config.provider === 'square') await this.assertSquareAvailability(this.prisma, b.shopId, b.id); await this.requiredMerchantProfile(this.prisma, b); }
      catch (error) { if (!(error instanceof ServiceUnavailableException)) throw error; paymentEnabled = false; reason = error.message; }
    }
    return { ...q, ...bookingOrderPolicy(), ...bookingAddOnsView(b), tipCents: b.tipCents ?? 0, currency: b.currency, paymentMode: b.paymentMode ?? 'ONLINE', paymentEnabled, reason, holdExpiresAt: b.holdExpiresAt };
  }
  async createPaymentIntent(data: { bookingId: string; userId: string; amountCents?: number; currency?: string; shopId?: string }) {
    this.requireNewOnlinePayment();
    const b = await this.ownedBooking(data.bookingId, data.userId);
    if ((b.paymentMode ?? 'ONLINE') !== 'ONLINE') throw new BadRequestException('This reservation does not accept an online checkout');
    const q = await this.quote(data.bookingId, data.userId);
    if (data.shopId && data.shopId !== b.shopId.toString()) throw new BadRequestException('Shop must match the booking');
    if (data.amountCents !== undefined && data.amountCents !== q.totalCents) throw new BadRequestException('Amount must match the server quote');
    if (data.currency && data.currency.toLowerCase() !== b.currency) throw new BadRequestException('Currency must match the booking');
    const provider = this.provider();
    this.assertSquareShop(provider, b.shopId);
    if (provider === 'square' && this.config().currency !== b.currency) throw new BadRequestException('Square currency does not match the booking');
    const record = await reservationTransaction(this.prisma, async tx => {
      const current = await this.lockBooking(tx, b.id);
      if ((current.paymentMode ?? 'ONLINE') !== 'ONLINE') throw new ConflictException('Reservation collection mode does not allow an online checkout');
      if (current.paymentStatus !== 'UNPAID' || current.status !== 'PENDING' || current.deletedAt || current.totalCents !== q.totalCents) throw new BadRequestException('Booking is not payable');
      if (current.totalCents <= 0) throw new BadRequestException('Zero-value bookings need explicit settlement');
      // Reject before creating provider state or collecting funds for an unconfigured shop ledger.
      await this.requiredMerchantProfile(tx, current);
      if (provider === 'square') await this.assertSquareAvailability(tx, current.shopId, current.id);
      const existing = await tx.paymentRecord.findUnique({ where: { bookingId: b.id } });
      if (existing) {
        if (existing.provider !== provider || existing.amountCents !== current.totalCents || existing.currency !== current.currency) throw new ConflictException('Payment provider or quote has changed');
        this.assertSquareRecord(existing, current.shopId);
        return existing;
      }
      return tx.paymentRecord.create({ data: { bookingId: b.id, provider, idempotencyKey: `booking:${b.id}:payment:v1`, amountCents: current.totalCents, currency: current.currency, ...(provider === 'square' ? { providerBinding: this.squareClient().binding() as unknown as Prisma.InputJsonValue } : {}) } });
    });
    if (provider === 'square') {
      this.assertSquareRecord(record, b.shopId);
      if (record.checkoutUrl && record.providerOrderId) return { ...q, amountCents: record.amountCents, provider, mock: false, paymentRecordId: record.id, providerOrderId: record.providerOrderId, checkoutUrl: record.checkoutUrl, paymentIntentId: record.providerPaymentId, clientSecret: null };
      const checkout = await this.squareClient().createCheckout({ idempotencyKey: record.idempotencyKey, amountCents: record.amountCents, currency: record.currency, referenceId: record.id, bookingNo: b.bookingNo });
      await reservationTransaction(this.prisma, async tx => {
        await this.lockBooking(tx, b.id);
        const current = await tx.paymentRecord.findUniqueOrThrow({ where: { id: record.id } });
        this.assertSquareRecord(current, b.shopId);
        if (current.providerOrderId && current.providerOrderId !== checkout.orderId) throw new ConflictException('Square order changed for the same payment');
        await tx.paymentRecord.update({ where: { id: record.id }, data: { providerOrderId: checkout.orderId, checkoutUrl: checkout.checkoutUrl } });
      });
      return { ...q, amountCents: record.amountCents, provider, mock: false, paymentRecordId: record.id, providerOrderId: checkout.orderId, checkoutUrl: checkout.checkoutUrl, paymentIntentId: record.providerPaymentId, clientSecret: null };
    }
    let intent: { id: string; client_secret?: string | null };
    if (provider === 'local_mock') intent = { id: `local_${record.id}`, client_secret: null };
    else intent = await this.client().paymentIntents.create({ amount: record.amountCents, currency: record.currency,
      metadata: { booking_id: b.id.toString(), shop_id: b.shopId.toString(), record_id: record.id }, automatic_payment_methods: { enabled: true } }, { idempotencyKey: record.idempotencyKey });
    await reservationTransaction(this.prisma, async tx => {
      await this.lockBooking(tx, b.id);
      await tx.paymentRecord.update({ where: { id: record.id }, data: { providerPaymentId: intent.id } });
      await tx.booking.update({ where: { id: b.id }, data: { paymentId: intent.id } });
    });
    return { paymentIntentId: intent.id, clientSecret: intent.client_secret, ...q, amountCents: record.amountCents, provider, mock: provider === 'local_mock' };
  }
  async confirmPaymentIntent(data: { paymentIntentId: string; userId: string }) {
    this.requireNewOnlinePayment();
    const record = await this.prisma.paymentRecord.findUnique({ where: { providerPaymentId: data.paymentIntentId }, include: { booking: true } });
    if (!record || record.booking.userId?.toString() !== data.userId) throw new NotFoundException('Payment not found');
    if (record.provider !== this.provider()) throw new ConflictException('Payment provider has changed');
    this.assertSquareShop(record.provider, record.booking.shopId);
    this.assertSquareRecord(record, record.booking.shopId);
    if (record.provider === 'square') return { paymentIntentId: record.providerPaymentId, status: record.status, settled: record.status === 'SUCCEEDED', provider: record.provider, mock: false };
    if (record.provider === 'local_mock') {
      const object = { id: data.paymentIntentId, amount: record.amountCents, amount_received: record.amountCents, currency: record.currency, status: 'succeeded', metadata: { record_id: record.id, booking_id: record.bookingId.toString() } };
      await this.processEvent('local_mock', { id: `confirmed:${record.id}`, type: 'payment_intent.succeeded', data: { object } });
      return { paymentIntentId: data.paymentIntentId, status: 'succeeded', provider: 'local_mock', mock: true };
    }
    // Card authorization is performed by the provider's client UI. Only a verified webhook settles the ledger.
    const intent = await this.client().paymentIntents.retrieve(data.paymentIntentId);
    return { paymentIntentId: intent.id, status: intent.status, settled: record.status === 'SUCCEEDED', provider: record.provider, mock: false };
  }
  async receiveWebhook(raw: Buffer | undefined, signature: string | undefined) {
    if (this.provider() !== 'stripe' || !raw || !signature) throw new BadRequestException('Signed Stripe raw body is required');
    let event: Stripe.Event;
    try { event = this.client().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET!); }
    catch { throw new BadRequestException('Invalid webhook signature'); }
    await this.processEvent('stripe', event, createHash('sha256').update(raw).digest('hex'));
    return { received: true };
  }
  async receiveSquareWebhook(raw: Buffer | undefined, signature: string | undefined) {
    if (this.provider() !== 'square' || !raw) throw new BadRequestException('Signed Square raw body is required');
    const event = this.squareClient().verifyWebhook(raw, signature);
    const object = event.kind === 'payment' ? event.payment : event.kind === 'refund' ? event.refund : {};
    await this.processEvent('square', { id: event.id, type: `square.${event.kind}`, data: { object } }, createHash('sha256').update(raw).digest('hex'));
    return { received: true };
  }
  private async lockBooking(tx: any, id: bigint) {
    const reference = await tx.booking.findUnique({ where: { id }, select: { shopId: true } });
    if (!reference) throw new NotFoundException('Booking not found');
    await lockShop(tx, reference.shopId);
    await expireShopHolds(tx, reference.shopId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`);
    return tx.booking.findUniqueOrThrow({ where: { id }, include: { shop: true } });
  }
  private async requiredMerchantProfile(tx: any, b: any) {
    const shop = await tx.shop.findUnique({ where: { id: b.shopId }, select: { ownerId: true } });
    const profile = await tx.merchantProfile.findUnique({ where: { shopId: b.shopId } });
    if (!shop || !profile || profile.userId !== shop.ownerId) throw new ServiceUnavailableException('Merchant ledger is not configured for this shop');
    return profile;
  }
  private async adjustMerchant(tx: any, b: any, amount: number, fee: number, type: 'PAYMENT' | 'REFUND') {
    // A lost or mismatched ledger must roll the entire settlement/refund transaction back.
    const profile = await this.requiredMerchantProfile(tx, b);
    const net = amount - fee;
    await tx.merchantProfile.update({ where: { id: profile.id }, data: { balanceCents: { increment: net }, totalEarnedCents: { increment: net } } });
    await tx.merchantTransaction.create({ data: { profileId: profile.id, type, amount, fee, net, status: 'COMPLETED', bookingId: b.id, description: `${type} for ${b.bookingNo}` } });
  }
  private async reconciliationActor(tx: any, b: any, actorId: string, role: string) {
    if (role === 'CUSTOMER' && b.userId?.toString() === actorId) return;
    if (!['ADMIN', 'MERCHANT', 'STAFF'].includes(role)) throw new NotFoundException('Booking not found');
    await requireShopAccess(tx, b.shopId, { id: actorId, role }, 'REFUNDS_MANAGE', { write: true });
  }
  /** Re-reads only existing server provider IDs; never accepts a claimed paid state or creates another checkout/refund. */
  async reconcileBooking(bookingId: string, actorId: string, role: string) {
    const bid = numericId(bookingId);
    const snapshot = await reservationTransaction(this.prisma, async tx => {
      const b = await this.lockBooking(tx, bid);
      if (b.deletedAt) throw new NotFoundException('Booking not found');
      await this.reconciliationActor(tx, b, actorId, role);
      const record = await tx.paymentRecord.findUnique({ where: { bookingId: bid } });
      if (!record) throw new NotFoundException('No online payment record exists for this booking');
      if (record.amountCents !== b.totalCents || record.currency !== b.currency || (b.paymentMode ?? 'ONLINE') !== 'ONLINE') throw new ConflictException('Payment and booking require reconciliation');
      return { b, record };
    });
    const { b, record } = snapshot;
    const provider = this.provider();
    if (record.provider !== provider) throw new ServiceUnavailableException('The original payment provider is not active; its pending records remain fenced');
    this.assertSquareRecord(record, b.shopId);
    const apply = (type: string, object: any) => {
      const digest = createHash('sha256').update(JSON.stringify({ type, object })).digest('hex');
      return this.processEvent(provider, { id: `reconcile:${digest}`, type, data: { object } });
    };
    let checked = false;
    if (provider === 'square') {
      if (!record.providerOrderId) throw new ServiceUnavailableException('The original checkout response is unknown; recover the same checkout key while still payable. No replacement checkout was created');
      const order = await this.squareClient().getOrder(record.providerOrderId);
      if (order.id !== record.providerOrderId || order.referenceId !== record.id || order.amountCents !== record.amountCents || order.currency !== record.currency) throw new ConflictException('Square order does not match the original payment');
      const candidates = [...new Set([...(record.providerPaymentId ? [record.providerPaymentId] : []), ...order.paymentIds])];
      if (candidates.length > 1) throw new ConflictException('Multiple Square payments require manual channel investigation; no payment was guessed');
      if (candidates.length) {
        const payment = await this.squareClient().getPayment(candidates[0]);
        if (payment.orderId !== record.providerOrderId || payment.amountCents !== record.amountCents || payment.totalCents !== record.amountCents || payment.currency !== record.currency || payment.referenceId && payment.referenceId !== record.id) throw new ConflictException('Square payment does not match the original order');
        await apply('square.payment', payment);
      }
      checked = true;
    } else if (provider === 'stripe') {
      if (!record.providerPaymentId) throw new ServiceUnavailableException('The original payment identifier is unknown; no replacement payment was created');
      const intent = await this.client().paymentIntents.retrieve(record.providerPaymentId);
      if (intent.id !== record.providerPaymentId || intent.amount !== record.amountCents || intent.currency !== record.currency || intent.metadata.record_id !== record.id || intent.metadata.booking_id !== bid.toString() || intent.metadata.shop_id !== b.shopId.toString()) throw new ConflictException('Stripe payment does not match the original booking');
      if (intent.status === 'succeeded') await apply('payment_intent.succeeded', intent);
      checked = true;
    }
    const requests = await this.prisma.refundRequest.findMany({ where: { paymentRecordId: record.id, status: { in: ['PENDING', 'RETRYABLE'] } }, orderBy: { id: 'asc' }, take: 101 });
    if (requests.length > 100) throw new ConflictException('Too many unresolved refunds require channel investigation');
    for (const request of requests) {
      if (!request.providerRefundId) continue; // Unknown response: only the original refund action may retry its original key.
      if (provider === 'square') {
        const refund = await this.squareClient().getRefund(request.providerRefundId);
        if (refund.paymentId !== record.providerPaymentId || refund.amountCents !== request.amountCents || refund.currency !== record.currency || refund.referenceId && refund.referenceId !== request.id || refund.orderId && refund.orderId !== record.providerOrderId) throw new ConflictException('Square refund does not match the original request');
        await apply('square.refund', refund);
      } else if (provider === 'stripe') {
        const refund = await this.client().refunds.retrieve(request.providerRefundId);
        if (refund.id !== request.providerRefundId || refund.payment_intent !== record.providerPaymentId || refund.amount !== request.amountCents || refund.currency !== record.currency || refund.metadata?.refund_request_id && refund.metadata.refund_request_id !== request.id) throw new ConflictException('Stripe refund does not match the original request');
        await apply('refund.updated', refund);
      }
    }
    return reservationTransaction(this.prisma, async tx => {
      const current = await this.lockBooking(tx, bid);
      await this.reconciliationActor(tx, current, actorId, role);
      const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { id: record.id } });
      const refunds = await tx.refundRequest.findMany({ where: { paymentRecordId: record.id }, orderBy: { createdAt: 'desc' }, take: 100 });
      await tx.auditLog.create({ data: { action: 'PAYMENT_RECONCILE', targetType: 'BOOKING', targetId: bid, operatorId: numericId(actorId), detail: { provider, checked, recordStatus: payment.status, pendingRefunds: refunds.filter((r: any) => ['PENDING', 'RETRYABLE'].includes(r.status)).length } } });
      return { bookingId: bid.toString(), paymentRecordId: payment.id, paymentStatus: current.paymentStatus, recordStatus: payment.status, checked,
        refunds: refunds.map((r: any) => ({ requestId: r.id, status: r.status, amountCents: r.amountCents, originalKeyRetryRequired: ['PENDING', 'RETRYABLE'].includes(r.status) && !r.providerRefundId })) };
    });
  }
  async processEvent(provider: string, event: any, hash?: string) {
    if (provider !== this.provider()) throw new ServiceUnavailableException('Payment provider is not active');
    if (!event?.id || !event?.type || !event?.data?.object) throw new BadRequestException('Invalid payment event');
    if (provider === 'square' && ['square.payment', 'square.refund'].includes(event.type)) {
      const object = event.data.object;
      const record = await this.prisma.paymentRecord.findUnique({ where: event.type === 'square.payment' ? { providerOrderId: object.orderId || '' } : { providerPaymentId: object.paymentId || '' }, include: { booking: { select: { shopId: true } } } });
      if (!record || record.provider !== 'square') throw new BadRequestException('Unknown Square payment');
      this.assertSquareShop(provider, record.booking.shopId);
      this.assertSquareRecord(record, record.booking.shopId);
    }
    const payloadHash = hash || createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const previous = await this.prisma.paymentEvent.findUnique({ where: { provider_eventId: { provider, eventId: event.id } } });
    if (previous) { if (previous.payloadHash !== payloadHash) throw new ConflictException('Event payload changed'); return { duplicate: true }; }
    try {
      return await reservationTransaction(this.prisma, async tx => {
        await tx.paymentEvent.create({ data: { provider, eventId: event.id, payloadHash } });
        const object = event.data.object;
        if (provider === 'square' && event.type === 'square.payment') {
          await this.applySquarePayment(tx, object);
        } else if (provider === 'square' && event.type === 'square.refund') {
          await this.applySquareRefund(tx, object);
        } else if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
          const record = await tx.paymentRecord.findUnique({ where: { providerPaymentId: object.id } });
          if (!record || record.provider !== provider) throw new BadRequestException('Unknown payment');
          const b = await this.lockBooking(tx, record.bookingId);
          if (event.type === 'payment_intent.payment_failed') {
            // Failure notifications cannot undo a successful payment or change booking state.
            return { received: true };
          }
          if (object.status !== 'succeeded' || object.amount !== record.amountCents || object.amount_received !== record.amountCents || object.currency !== record.currency || object.metadata?.record_id !== record.id || object.metadata?.booking_id !== b.id.toString()) throw new BadRequestException('Payment details do not match the ledger');
          await this.settlePayment(tx, record, b);
        } else if (['refund.created', 'refund.updated'].includes(event.type)) {
          if (object.status === 'succeeded') await this.applyProviderRefund(tx, provider, object);
          else if (['failed', 'canceled'].includes(object.status)) {
            const request = object.metadata?.refund_request_id
              ? await tx.refundRequest.findUnique({ where: { id: object.metadata.refund_request_id } })
              : await tx.refundRequest.findUnique({ where: { providerRefundId: object.id } });
            if (request) {
              await this.lockBooking(tx, request.bookingId);
              const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { id: request.paymentRecordId } });
              if (payment.provider !== provider || payment.providerPaymentId !== object.payment_intent || request.amountCents !== object.amount || payment.currency !== object.currency) throw new BadRequestException('Failed refund does not match request');
              await tx.refundRequest.updateMany({ where: { id: request.id, status: { not: 'SUCCEEDED' } }, data: { status: 'FAILED', providerRefundId: object.id, failureCode: 'PROVIDER_REFUND_FAILED' } });
              await this.syncRefund(tx, request.id);
            }
          }
        } else if (event.type === 'charge.refunded') {
          // Never trust only metadata or a cumulative value: account for each uniquely identified refund.
          if (object.refunds?.has_more) throw new ServiceUnavailableException('Refund reconciliation requires complete refund events');
          for (const refund of object.refunds?.data || []) if (refund.status === 'succeeded') await this.applyProviderRefund(tx, provider, refund);
        }
        return { received: true };
      });
    } catch (err) {
      if ((err as any).code === 'P2002') {
        const duplicate = await this.prisma.paymentEvent.findUnique({ where: { provider_eventId: { provider, eventId: event.id } } });
        if (duplicate?.payloadHash === payloadHash) return { duplicate: true };
      }
      throw err;
    }
  }
  private async settlePayment(tx: any, record: any, b: any) {
    if ((b.paymentMode ?? 'ONLINE') !== 'ONLINE') throw new ConflictException('External payment conflicts with the reservation collection mode');
    const settled = await tx.paymentRecord.updateMany({ where: { id: record.id, status: 'CREATED' }, data: { status: 'SUCCEEDED' } });
    if (settled.count === 0) return;
    if (b.totalCents !== record.amountCents || b.currency !== record.currency || b.paidCents) throw new ConflictException('Booking amount does not match payment');
    const released = b.status === 'CANCELLED' || b.holdExpiresAt && b.holdExpiresAt <= new Date();
    const settledBooking = await tx.booking.update({ where: { id: b.id }, data: { paidCents: record.amountCents, paymentStatus: 'PAID', status: released ? 'REFUNDING' : 'CONFIRMED', holdExpiresAt: null, ...(record.provider === 'square' ? { paymentId: record.providerPaymentId } : {}) } });
    if (released) await releaseReservation(tx, b.id);
    await this.adjustMerchant(tx, b, record.amountCents, b.platformFeeCents, 'PAYMENT');
    await enqueueNotification(tx, { eventKey: `payment:${record.id}:completed`, userId: b.userId, topic: 'PAYMENT_RECEIVED', resourceType: 'BOOKING', resourceId: b.id.toString(), bookingId: b.id, data: { amountCents: record.amountCents, currency: b.currency } });
    if (!released) await enqueueNotification(tx, { eventKey: `booking:${b.id}:confirmed`, userId: b.userId, topic: 'BOOKING_CONFIRMED', resourceType: 'BOOKING', resourceId: b.id.toString(), bookingId: b.id });
    await syncBookingReminder(tx, settledBooking);
  }
  private async applySquarePayment(tx: any, payment: any) {
    const known = await tx.paymentRecord.findUnique({ where: { providerOrderId: payment.orderId } });
    if (!known || known.provider !== 'square') throw new BadRequestException('Unknown Square order');
    const b = await this.lockBooking(tx, known.bookingId);
    this.assertSquareShop('square', b.shopId);
    const record = await tx.paymentRecord.findUniqueOrThrow({ where: { id: known.id } });
    this.assertSquareRecord(record, b.shopId);
    if (payment.amountCents !== record.amountCents || payment.totalCents !== record.amountCents || payment.currency !== record.currency || (payment.referenceId && payment.referenceId !== record.id)) throw new BadRequestException('Square payment does not match the ledger');
    if (record.providerPaymentId && record.providerPaymentId !== payment.id) throw new ConflictException('Square order has a different settled payment');
    if (payment.status !== 'COMPLETED') return;
    const current = await tx.paymentRecord.update({ where: { id: record.id }, data: { providerPaymentId: payment.id } });
    await this.settlePayment(tx, current, b);
  }
  private async applySquareRefund(tx: any, refund: any) {
    const known = await tx.paymentRecord.findUnique({ where: { providerPaymentId: refund.paymentId } });
    if (!known || known.provider !== 'square' || known.currency !== refund.currency || (refund.orderId && refund.orderId !== known.providerOrderId)) throw new BadRequestException('Square refund payment does not match the ledger');
    const b = await this.lockBooking(tx, known.bookingId);
    this.assertSquareShop('square', b.shopId);
    const record = await tx.paymentRecord.findUniqueOrThrow({ where: { id: known.id } });
    this.assertSquareRecord(record, b.shopId);
    let request = refund.referenceId ? await tx.refundRequest.findUnique({ where: { id: refund.referenceId } }) : null;
    request ??= await tx.refundRequest.findUnique({ where: { providerRefundId: refund.id } });
    if (!request && refund.referenceId) throw new BadRequestException('Unknown Square refund request');
    if (!request && ['FAILED', 'REJECTED'].includes(refund.status)) return;
    if (!request) {
      const unresolved = await tx.refundRequest.count({ where: { paymentRecordId: record.id, providerRefundId: null, status: { in: ['PENDING', 'RETRYABLE'] } } });
      // A response timeout must not cause the webhook and the retried request to deduct twice.
      if (unresolved) throw new ServiceUnavailableException('Retry the original refund to reconcile its Square refund ID');
      const reserved = await tx.refundRequest.aggregate({ where: { paymentRecordId: record.id, status: { in: ['PENDING', 'RETRYABLE'] } }, _sum: { amountCents: true } });
      if (cents(refund.amountCents) <= 0 || refund.amountCents > b.paidCents - b.refundedCents - (reserved._sum.amountCents ?? 0)) throw new BadRequestException('Square refund exceeds the unreserved payment');
      request = await tx.refundRequest.create({ data: { bookingId: b.id, paymentRecordId: record.id, idempotencyKey: `external:square:${refund.id}`, amountCents: refund.amountCents, providerRefundId: refund.id } });
    }
    if (request.paymentRecordId !== record.id || request.amountCents !== refund.amountCents || (request.providerRefundId && request.providerRefundId !== refund.id)) throw new BadRequestException('Square refund does not match request');
    if (refund.status === 'COMPLETED') await this.finalizeRefund(tx, b, record, request, refund.id);
    else await tx.refundRequest.updateMany({ where: { id: request.id, status: ['FAILED', 'REJECTED'].includes(refund.status) ? { not: 'SUCCEEDED' } : { in: ['PENDING', 'RETRYABLE'] } }, data: { providerRefundId: refund.id, status: ['FAILED', 'REJECTED'].includes(refund.status) ? 'FAILED' : 'PENDING', failureCode: ['FAILED', 'REJECTED'].includes(refund.status) ? 'PROVIDER_REFUND_FAILED' : null } });
    await this.syncRefund(tx, request.id);
  }
  private async applyProviderRefund(tx: any, provider: string, refund: any) {
    const paymentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
    const record = await tx.paymentRecord.findUnique({ where: { providerPaymentId: paymentId || '' } });
    if (!record || record.provider !== provider || refund.currency !== record.currency) throw new BadRequestException('Refund payment does not match ledger');
    const b = await this.lockBooking(tx, record.bookingId);
    let request = refund.metadata?.refund_request_id ? await tx.refundRequest.findUnique({ where: { id: refund.metadata.refund_request_id } }) : null;
    request ??= await tx.refundRequest.findUnique({ where: { providerRefundId: refund.id } });
    if (!request && refund.metadata?.refund_request_id) throw new BadRequestException('Unknown refund request');
    if (!request) {
      const unresolved = await tx.refundRequest.count({ where: { paymentRecordId: record.id, status: { in: ['PENDING', 'RETRYABLE'] } } });
      if (unresolved) throw new ServiceUnavailableException('An unresolved original refund must be reconciled before accepting an unlinked refund');
      if (cents(refund.amount) <= 0 || refund.amount > b.paidCents - b.refundedCents) throw new BadRequestException('Refund exceeds collected payment');
      request = await tx.refundRequest.create({ data: { bookingId: b.id, paymentRecordId: record.id, idempotencyKey: `external:${provider}:${refund.id}`, amountCents: cents(refund.amount), providerRefundId: refund.id } });
    }
    if (request.paymentRecordId !== record.id || request.amountCents !== refund.amount || request.providerRefundId && request.providerRefundId !== refund.id) throw new BadRequestException('Refund does not match request');
    await this.finalizeRefund(tx, b, record, request, refund.id);
  }
  private async syncRefund(tx: any, requestId: string) {
    const request = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
    await syncRefundCase(tx, request);
  }
  private async finalizeRefund(tx: any, b: any, record: any, request: any, providerRefundId: string) {
    const current = await tx.refundRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (current.status === 'SUCCEEDED') { await syncRefundCase(tx, current); return; }
    const fresh = await tx.paymentRecord.findUniqueOrThrow({ where: { id: record.id } });
    const totalRefunded = fresh.refundedCents + current.amountCents;
    if (totalRefunded > b.paidCents || fresh.status !== 'SUCCEEDED') throw new BadRequestException('Refund exceeds collected payment');
    await tx.refundRequest.update({ where: { id: request.id }, data: { status: 'SUCCEEDED', providerRefundId, failureCode: null } });
    await tx.paymentRecord.update({ where: { id: record.id }, data: { refundedCents: totalRefunded } });
    const refundedBooking = await tx.booking.update({ where: { id: b.id }, data: { refundedCents: totalRefunded, paymentStatus: totalRefunded === b.paidCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED', ...(totalRefunded === b.paidCents && b.status !== 'COMPLETED' ? { status: 'CANCELLED' } : {}) } });
    if (totalRefunded === b.paidCents && b.status !== 'COMPLETED') await releaseReservation(tx, b.id);
    // Difference of cumulative fees makes repeated small refunds round exactly to the original fee.
    const fee = Math.round(totalRefunded * b.platformFeeCents / b.paidCents) - Math.round(fresh.refundedCents * b.platformFeeCents / b.paidCents);
    await this.adjustMerchant(tx, b, -current.amountCents, -fee, 'REFUND');
    await this.syncRefund(tx, current.id);
    await enqueueNotification(tx, { eventKey: `refund:${current.id}:processed`, userId: b.userId, topic: 'REFUND_PROCESSED', resourceType: 'BOOKING', resourceId: b.id.toString(), bookingId: b.id, data: { amountCents: current.amountCents, currency: b.currency } });
    await syncBookingReminder(tx, refundedBooking);
  }
  async refundBooking(bookingId: string, actorId: string, role: string, requestedAmount?: number, key?: string) {
    const bid = numericId(bookingId);
    if (requestedAmount !== undefined && cents(requestedAmount) <= 0) throw new BadRequestException('Refund must be positive integer cents');
    if (key && !/^[A-Za-z0-9:_-]{8,80}$/.test(key)) throw new BadRequestException('Invalid idempotency key');
    if (requestedAmount !== undefined && !key) throw new BadRequestException('Idempotency-Key is required for partial refunds');
    const provider = this.provider();
    const request = await reservationTransaction(this.prisma, async tx => {
      const b = await this.lockBooking(tx, bid);
      this.assertSquareShop(provider, b.shopId);
      // Validate the local recipient ledger before sending any external refund request.
      await this.requiredMerchantProfile(tx, b);
      const manager = ['ADMIN','MERCHANT','STAFF'].includes(role);
      if (manager) await requireShopAccess(tx,b.shopId,{id:actorId,role},'REFUNDS_MANAGE', { write: true });
      else if (role !== 'CUSTOMER' || b.userId?.toString() !== actorId) throw new NotFoundException('Booking not found');
      const idempotencyKey = key || `booking:${bid}:refund:full`;
      const existing = await tx.refundRequest.findUnique({ where: { idempotencyKey } });
      if (provider === 'square') {
        const original = await tx.paymentRecord.findUnique({ where: { bookingId: bid } });
        if (!original || original.provider !== provider) throw new BadRequestException('No matching Square payment is available');
        this.assertSquareRecord(original, b.shopId);
      }
      if (existing) {
        if (existing.bookingId !== bid || (requestedAmount !== undefined && existing.amountCents !== requestedAmount)) throw new ConflictException('Idempotency key reused with different parameters');
        if (existing.status === 'FAILED') throw new BadRequestException('This refund definitively failed; submit a new request key under the current policy');
        return existing;
      }
      const payment = await tx.paymentRecord.findUnique({ where: { bookingId: bid } });
      if (!payment || payment.provider !== provider || payment.status !== 'SUCCEEDED' || b.paidCents <= 0) throw new BadRequestException('No settled payment is available');
      const reserved = await tx.refundRequest.aggregate({ where: { bookingId: bid, status: { in: ['PENDING', 'RETRYABLE'] } }, _sum: { amountCents: true } });
      if ((reserved._sum.amountCents ?? 0) > 0) throw new ConflictException('An original refund is still unresolved; reconcile or retry that same request key before starting another refund');
      let limit = b.paidCents;
      // A payment arriving after resources were released cannot incur a cancellation penalty.
      if (!manager && b.status !== 'REFUNDING') {
        const hours = (b.startTime.getTime() - Date.now()) / 3600000;
        const policy = this.refundPolicy();
        if (!policy) throw new ServiceUnavailableException('Refund policy needs configuration');
        const { fullHours, percent } = policy;
        limit = hours >= fullHours ? b.paidCents : hours > 0 ? Math.round(b.paidCents * percent / 100) : 0;
      }
      const available = limit - b.refundedCents - (reserved._sum.amountCents || 0);
      const amount = requestedAmount ?? available;
      if (amount <= 0 || amount > available) throw new BadRequestException('Requested refund exceeds remaining policy allowance');
      const created = await tx.refundRequest.create({ data: { bookingId: bid, paymentRecordId: payment.id, idempotencyKey, amountCents: amount } });
      await syncRefundCase(tx, created);
      return created;
    });
    if (request.status === 'SUCCEEDED') return this.refundResult(request);
    const payment = await this.prisma.paymentRecord.findUniqueOrThrow({ where: { id: request.paymentRecordId } });
    if (payment.provider !== provider) throw new ConflictException('Refund provider has changed');
    try {
      let refund: { id: string; status?: string | null; amount: number };
      if (provider === 'local_mock') refund = { id: `local_refund_${request.id}`, status: 'succeeded', amount: request.amountCents };
      else if (provider === 'square') {
        if (!payment.providerPaymentId) throw new ConflictException('Square payment is not settled');
        const input = { paymentId: payment.providerPaymentId, amountCents: request.amountCents, currency: payment.currency, idempotencyKey: request.idempotencyKey, referenceId: request.id };
        const result = request.providerRefundId ? await this.squareClient().getRefund(request.providerRefundId) : await this.squareClient().refund(input);
        if (request.providerRefundId && result.id !== request.providerRefundId || result.referenceId && result.referenceId !== request.id) throw new ConflictException('Square refund identity does not match the original request');
        if (result.paymentId !== payment.providerPaymentId || result.currency !== payment.currency || (result.orderId && result.orderId !== payment.providerOrderId)) throw new ConflictException('Square refund does not match payment');
        refund = { id: result.id, amount: result.amountCents, status: result.status === 'COMPLETED' ? 'succeeded' : ['FAILED', 'REJECTED'].includes(result.status) ? 'failed' : 'pending' };
      }
      else {
        const result = request.providerRefundId ? await this.client().refunds.retrieve(request.providerRefundId) : await this.client().refunds.create({ payment_intent: payment.providerPaymentId!, amount: request.amountCents, metadata: { refund_request_id: request.id } }, { idempotencyKey: request.idempotencyKey });
        if (result.payment_intent !== payment.providerPaymentId || result.currency !== payment.currency || request.providerRefundId && result.id !== request.providerRefundId || result.metadata?.refund_request_id && result.metadata.refund_request_id !== request.id) throw new ConflictException('Stripe refund does not match payment');
        refund = result;
      }
      if (refund.amount !== request.amountCents) throw new ConflictException('Provider refund amount differs from request');
      await reservationTransaction(this.prisma, async tx => {
        const b = await this.lockBooking(tx, bid);
        if (refund.status === 'succeeded') await this.finalizeRefund(tx, b, payment, request, refund.id);
        else await tx.refundRequest.updateMany({ where: { id: request.id, status: ['failed', 'canceled'].includes(refund.status || '') ? { not: 'SUCCEEDED' } : { in: ['PENDING', 'RETRYABLE'] } }, data: { providerRefundId: refund.id, status: refund.status === 'failed' || refund.status === 'canceled' ? 'FAILED' : 'PENDING' } });
        await this.syncRefund(tx, request.id);
      });
    } catch (err) {
      await reservationTransaction(this.prisma, async tx => {
        await this.lockBooking(tx, bid);
        await tx.refundRequest.updateMany({ where: { id: request.id, status: { in: ['PENDING', 'RETRYABLE'] } }, data: { status: 'RETRYABLE', failureCode: 'PROVIDER_OR_PERSISTENCE_ERROR' } });
        await this.syncRefund(tx, request.id);
      });
      throw new ServiceUnavailableException('Refund is pending reconciliation; retry with the same Idempotency-Key');
    }
    return this.refundResult(await this.prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } }));
  }
  private refundResult(r: any) { return { refundId: r.providerRefundId, requestId: r.id, refundedAmount: r.status === 'SUCCEEDED' ? r.amountCents : 0, amountCents: r.amountCents, status: r.status }; }
  async processRefund(_paymentId: string): Promise<{ refundId: string; amountCents: number }> { throw new ServiceUnavailableException('Use the authorized, idempotent booking refund endpoint'); }
  async processPartialRefund(_paymentId: string, _amount: number): Promise<{ refundId: string; amountCents: number }> { throw new ServiceUnavailableException('Use the authorized, idempotent booking refund endpoint'); }
}
