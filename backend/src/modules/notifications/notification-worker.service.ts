import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationTopic } from '../../common/notification-outbox';
import { FcmService } from './fcm.service';
import { boundedPush, notificationText, pushOutcome, retryAt } from './notification.rules';
import { customerOrderEmail, orderEmailEventCurrent, readOrderEmailSnapshot, renderBookingOrderEmail, type OrderEmailSnapshot, type OrderEmailStoreContact } from '../../common/booking-order-email';
import { OrderEmailDelivery } from './order-email-delivery';
import { orderEmailAudience, orderEmailPublicStoreContact, orderEmailRecipientFingerprint, readShopOrderEmailEnvelope, renderShopOrderEmail } from '../../common/shop-order-email';
import { SHOP_ORDER_EMAIL_DESTINATION_SELECT, shopOrderEmailEventRecipient } from '../../common/shop-order-email-destination';
import { bookingContactView, hasBookingContactSnapshot, guestBookingContactFingerprint } from '../../common/booking-contact';

const ORDER_EMAIL_CONTACT_SELECT = { contactName: true, contactPhone: true, contactEmail: true, contactVersion: true, contactSource: true, contactEmailVerifiedAt: true } as const;

export interface OutboxRow {
  id: string; user_id: bigint | null; booking_id: bigint | null; expected_start_at_utc: Date | null;
  topic: NotificationTopic; channel: string; status: string; attempts: number; max_attempts: number;
  resource_type: string; resource_id: string; lease_token: string | null;
  data_json?: unknown;
}
/** Delivery is at-least-once after crashes. FCM acceptance is never labelled delivered. */
@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(private readonly prisma: PrismaService, private readonly fcm: FcmService, @Optional() private readonly orderEmail: OrderEmailDelivery = new OrderEmailDelivery()) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.NOTIFICATION_WORKER_ENABLED === 'false') return;
    this.timer = setInterval(() => { void this.runOnce().catch(() => this.logger.warn('Notification worker attempt failed; durable tasks remain available for retry')); }, 5000);
    this.timer.unref();
  }
  onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer); }
  config() { const orderEmail = this.orderEmail.config(); return { enabled: process.env.NOTIFICATION_WORKER_ENABLED !== 'false', automaticRetries: 5, leaseSeconds: 120, externalDelivery: orderEmail.deliveryMode === 'LOCAL_CAPTURE' ? 'LOCAL_CAPTURE_ONLY' : 'PROVIDER_ACCEPTANCE_ONLY', orderEmail, smsEnabled: false, smsReason: 'SMS_CONSENT_NOT_ESTABLISHED' }; }

  async runOnce() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      // A worker that crashed on its last attempt cannot leave a permanently processing task.
      // An EMAIL worker may have crashed after external acceptance. Never reclaim
      // its expired lease for another send, even when attempts remain.
      await this.prisma.$executeRaw(Prisma.sql`UPDATE notification_outbox SET status='FAILED',last_error_code='ORDER_EMAIL_ACCEPTANCE_UNKNOWN',lease_token=NULL,lease_until=NULL,finished_at=NOW(3),updated_at=NOW(3)
        WHERE channel='EMAIL' AND status='PROCESSING' AND lease_until<=NOW(3)`);
      await this.prisma.$executeRaw(Prisma.sql`UPDATE notification_outbox SET status='FAILED',last_error_code='LEASE_EXPIRED_ATTEMPTS_EXHAUSTED',lease_token=NULL,lease_until=NULL,finished_at=NOW(3),updated_at=NOW(3)
        WHERE status='PROCESSING' AND lease_until<=NOW(3) AND attempts>=max_attempts`);
      const candidates = await this.prisma.$queryRaw<{ id: string; booking_id: bigint | null }[]>(Prisma.sql`SELECT id,booking_id FROM notification_outbox
        WHERE attempts<max_attempts AND ((status='PENDING' AND run_at<=NOW(3)) OR (channel<>'EMAIL' AND status='PROCESSING' AND lease_until<=NOW(3)))
        ORDER BY run_at,id LIMIT 20`);
      for (const candidate of candidates) {
        if (this.stopped) break;
        try { await this.process(candidate); }
        catch { this.logger.warn('Notification task attempt failed; lease recovery will retry without exposing message data'); }
      }
    } finally { this.running = false; }
  }

  private async finish(tx: Prisma.TransactionClient, row: OutboxRow, status: string, code: string | null, accepted = 0) {
    const retry = status === 'FAILED' && code !== 'PUSH_ACCEPTANCE_UNKNOWN' && code !== 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN'
      && (row.channel !== 'EMAIL' || code === 'ORDER_EMAIL_RATE_LIMITED') && row.attempts < row.max_attempts;
    await tx.$executeRaw(Prisma.sql`UPDATE notification_outbox SET status=${retry ? 'PENDING' : status},last_error_code=${code},accepted_count=${accepted},lease_token=NULL,lease_until=NULL,
      run_at=IF(${retry},${retryAt(row.attempts, new Date())},run_at),finished_at=${retry ? null : new Date()},updated_at=NOW(3)
      WHERE id=${row.id} AND status='PROCESSING' AND lease_token=${row.lease_token}`);
  }

  private async emailContext(tx: any, row: OutboxRow): Promise<{ code: string } | { recipient: string; snapshot: OrderEmailSnapshot; audience: 'CUSTOMER'; storeContact: OrderEmailStoreContact } | { recipient: string; snapshot: OrderEmailSnapshot; audience: 'SHOP'; customer: any }> {
    if (orderEmailAudience(row.data_json) === 'SHOP') {
      const envelope = readShopOrderEmailEnvelope(row.data_json), snapshot = envelope?.snapshot;
      if (!envelope || !snapshot || !row.booking_id || snapshot.bookingId !== String(row.booking_id) || (snapshot.version === 2 ? row.user_id !== null : snapshot.userId !== String(row.user_id)) || snapshot.topic !== row.topic || row.resource_type !== 'BOOKING' || row.resource_id !== snapshot.bookingId) return { code: 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' };
      const booking = await tx.booking.findUnique({ where: { id: row.booking_id }, select: { id: true, userId: true, bookingSource: true, shopId: true, status: true, deletedAt: true, startTime: true, endTime: true, ...ORDER_EMAIL_CONTACT_SELECT,
        shop: { select: { id: true, deletedAt: true, studioProfile: true, orderEmailSetting: { select: SHOP_ORDER_EMAIL_DESTINATION_SELECT } } } } });
      if (!orderEmailEventCurrent(snapshot, booking)) return { code: 'ORDER_EMAIL_EVENT_OBSOLETE' };
      if (!booking.shop || booking.shop.deletedAt || String(booking.shopId) !== envelope.shopId || String(booking.shop.id) !== envelope.shopId) return { code: 'ORDER_EMAIL_STORE_UNAVAILABLE' };
      // A store account's login state is unrelated to receiving an existing order.
      // An absent original destination can never be replaced by a later address.
      if (!envelope.recipientFingerprint) return { code: 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE' };
      const recipient = shopOrderEmailEventRecipient(envelope, booking.shop);
      if (!recipient) return { code: 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE' };
      if (orderEmailRecipientFingerprint(recipient) !== envelope.recipientFingerprint) return { code: 'ORDER_EMAIL_STORE_RECIPIENT_CHANGED' };
      const contact = bookingContactView(booking);
      if (hasBookingContactSnapshot(booking) && snapshot.contactVersion === undefined) return { code: 'ORDER_EMAIL_CONTACT_REFERENCE_REQUIRED' };
      if (snapshot.contactVersion !== undefined && (!contact.recorded || contact.version !== snapshot.contactVersion)) return { code: 'ORDER_EMAIL_CONTACT_SNAPSHOT_UNAVAILABLE' };
      if (snapshot.version === 2 ? guestBookingContactFingerprint(booking) !== snapshot.guestContactFingerprint
        : snapshot.contactVersion !== undefined && contact.recorded && (contact.source !== 'ONLINE_VERIFIED' || orderEmailRecipientFingerprint(contact.email) !== snapshot.customerRecipientFingerprint)) return { code: 'ORDER_EMAIL_CONTACT_CHANGED' };
      if (!this.orderEmail.config().enabled) return { code: 'ORDER_EMAIL_NOT_CONFIGURED' };
      // New tasks never consult the live customer profile for contact fields.
      // Tasks without a reference retain their pre-snapshot policy explicitly.
      const customer = snapshot.contactVersion !== undefined && contact.recorded ? { name: contact.name, phone: contact.phone, email: contact.email, emailVerifiedAt: contact.emailVerifiedAt }
        : row.user_id !== null ? await tx.user.findFirst({ where: { id: row.user_id, role: 'CUSTOMER', deletedAt: null }, select: { name: true, phone: true, email: true, emailVerifiedAt: true } }) : null;
      return { recipient, snapshot, audience: 'SHOP', customer };
    }
    const snapshot = readOrderEmailSnapshot(row.data_json);
    if (!snapshot || snapshot.version !== 1 || row.user_id === null || !row.booking_id || snapshot.bookingId !== String(row.booking_id) || snapshot.userId !== String(row.user_id) || snapshot.topic !== row.topic || row.resource_type !== 'BOOKING' || row.resource_id !== snapshot.bookingId) return { code: 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' };
    const [booking, user] = await Promise.all([
      tx.booking.findUnique({ where: { id: row.booking_id }, select: { id: true, userId: true, status: true, deletedAt: true, startTime: true, endTime: true, ...ORDER_EMAIL_CONTACT_SELECT,
        shop: { select: { phone: true, studioProfile: true } } } }),
      tx.user.findFirst({ where: { id: row.user_id, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null }, select: { id: true, role: true, status: true, deletedAt: true, email: true, emailVerifiedAt: true } }),
    ]);
    if (!orderEmailEventCurrent(snapshot, booking)) return { code: 'ORDER_EMAIL_EVENT_OBSOLETE' };
    const currentEmail = customerOrderEmail(user?.email), contact = bookingContactView(booking);
    if (hasBookingContactSnapshot(booking) && snapshot.contactVersion === undefined) return { code: 'ORDER_EMAIL_CONTACT_REFERENCE_REQUIRED' };
    if (!user || String(user.id) !== String(row.user_id) || user.role !== 'CUSTOMER' || !currentEmail || !user.emailVerifiedAt) return { code: 'ORDER_EMAIL_RECIPIENT_UNAVAILABLE' };
    let recipient = currentEmail;
    if (snapshot.contactVersion !== undefined) {
      if (!contact.recorded || contact.source !== 'ONLINE_VERIFIED' || contact.version !== snapshot.contactVersion) return { code: 'ORDER_EMAIL_CONTACT_SNAPSHOT_UNAVAILABLE' };
      if (orderEmailRecipientFingerprint(contact.email) !== snapshot.customerRecipientFingerprint) return { code: 'ORDER_EMAIL_CONTACT_CHANGED' };
      if (user.status !== 'ACTIVE' || user.deletedAt) return { code: 'ORDER_EMAIL_RECIPIENT_UNAVAILABLE' };
      if (currentEmail.toLowerCase() !== contact.email) return { code: 'ORDER_EMAIL_RECIPIENT_CHANGED' };
      recipient = contact.email;
    }
    if (!this.orderEmail.config().enabled) return { code: 'ORDER_EMAIL_NOT_CONFIGURED' };
    return { recipient, snapshot, audience: 'CUSTOMER', storeContact: orderEmailPublicStoreContact(booking.shop) };
  }
  private async eligible(tx: Prisma.TransactionClient, row: OutboxRow) {
    if (row.user_id === null) return 'RECIPIENT_UNAVAILABLE';
    const user = await tx.user.findFirst({ where: { id: row.user_id, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!user) return 'RECIPIENT_UNAVAILABLE';
    if (row.booking_id) {
      const booking = await tx.booking.findUnique({ where: { id: row.booking_id }, select: { userId: true, status: true, deletedAt: true, startTime: true } });
      if (!booking || booking.userId !== row.user_id) return 'BOOKING_RECIPIENT_MISMATCH';
      if (row.topic !== 'BOOKING_REMINDER') return null;
      if (!booking || booking.userId !== row.user_id || booking.status !== 'CONFIRMED' || booking.deletedAt || !row.expected_start_at_utc
        || booking.startTime.getTime() !== row.expected_start_at_utc.getTime() || booking.startTime <= new Date()) return 'BOOKING_REMINDER_OBSOLETE';
    }
    return null;
  }

  private async process(candidate: { id: string; booking_id: bigint | null }) {
    const token = randomUUID();
    const row = await this.prisma.$transaction(async tx => {
      // Match business mutations: shop -> booking -> outbox. No job is locked before its parent shop.
      if (candidate.booking_id) {
        const booking = await tx.booking.findUnique({ where: { id: candidate.booking_id }, select: { shopId: true } });
        if (booking) await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${booking.shopId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${candidate.booking_id} FOR UPDATE`);
      }
      const count = await tx.$executeRaw(Prisma.sql`UPDATE notification_outbox SET status='PROCESSING',attempts=attempts+1,lease_token=${token},lease_until=DATE_ADD(NOW(3),INTERVAL 120 SECOND),updated_at=NOW(3)
        WHERE id=${candidate.id} AND attempts<max_attempts AND ((status='PENDING' AND run_at<=NOW(3)) OR (channel<>'EMAIL' AND status='PROCESSING' AND lease_until<=NOW(3)))`);
      if (!count) return null;
      const [job] = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`SELECT * FROM notification_outbox WHERE id=${candidate.id} AND lease_token=${token}`);
      const invalid = job.channel === 'EMAIL' ? null : await this.eligible(tx, job);
      if (invalid) { await this.finish(tx, job, job.topic === 'BOOKING_REMINDER' ? 'CANCELLED' : 'SKIPPED', invalid); return null; }
      const text = notificationText(job.topic);
      if (job.channel === 'IN_APP') {
        await tx.$executeRaw(Prisma.sql`INSERT INTO user_notifications (id,outbox_id,user_id,topic,title,body,resource_type,resource_id,booking_id,created_at)
          VALUES (${randomUUID()},${job.id},${job.user_id},${job.topic},${text.title},${text.body},${job.resource_type},${job.resource_id},${job.booking_id},NOW(3)) ON DUPLICATE KEY UPDATE outbox_id=outbox_id`);
        await this.finish(tx, job, 'PUBLISHED', null); return null;
      }
      // There is currently no verified SMS consent evidence model. A provider credential is not consent.
      if (job.channel === 'SMS') { await this.finish(tx, job, 'SKIPPED', 'SMS_CONSENT_NOT_ESTABLISHED'); return null; }
      if (job.channel === 'EMAIL') {
        const email = await this.emailContext(tx, job);
        if ('code' in email) { await this.finish(tx, job, email.code === 'ORDER_EMAIL_EVENT_OBSOLETE' ? 'CANCELLED' : 'BLOCKED', email.code); return null; }
        return job;
      }
      if (job.channel !== 'PUSH') { await this.finish(tx, job, 'SKIPPED', 'UNSUPPORTED_NOTIFICATION_CHANNEL'); return null; }
      const [pref] = await tx.$queryRaw<{ push_enabled: boolean; push_consented_at: Date | null }[]>(Prisma.sql`SELECT push_enabled,push_consented_at FROM notification_preferences WHERE user_id=${job.user_id}`);
      const skip = !this.fcm.config().enabled ? 'PUSH_NOT_CONFIGURED' : !pref?.push_enabled || !pref.push_consented_at ? 'PUSH_NOT_OPTED_IN' : null;
      if (skip) { await this.finish(tx, job, 'SKIPPED', skip); return null; }
      return job;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (!row) return;
    // Provider calls are outside every business / claim transaction. The stable notificationId lets clients dedupe.
    const heartbeat = setInterval(() => {
      void this.prisma.$executeRaw(Prisma.sql`UPDATE notification_outbox SET lease_until=DATE_ADD(NOW(3),INTERVAL 120 SECOND) WHERE id=${row.id} AND status='PROCESSING' AND lease_token=${token}`).catch(() => undefined);
    }, 30000);
    heartbeat.unref();
    try {
      const current = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM notification_outbox WHERE id=${row.id} AND status='PROCESSING' AND lease_token=${token} AND lease_until>NOW(3)`);
      if (!current.length) return;
      if (row.channel === 'EMAIL') {
        const email = await this.emailContext(this.prisma, row);
        if ('code' in email) { await this.finish(this.prisma, row, email.code === 'ORDER_EMAIL_EVENT_OBSOLETE' ? 'CANCELLED' : 'BLOCKED', email.code); return; }
        const message = email.audience === 'SHOP' ? renderShopOrderEmail(email.snapshot, email.customer) : renderBookingOrderEmail(email.snapshot, email.storeContact);
        const result = await this.orderEmail.send({ ...message, recipient: email.recipient }, row.id);
        await this.finish(this.prisma, row, result.status, result.code, result.accepted); return;
      }
      // Cancellation/ownership and explicit opt-in are rechecked immediately before external dispatch.
      const invalid = await this.eligible(this.prisma, row);
      const [pref] = await this.prisma.$queryRaw<{ push_enabled: boolean }[]>(Prisma.sql`SELECT push_enabled FROM notification_preferences WHERE user_id=${row.user_id} AND push_consented_at IS NOT NULL`);
      if (invalid || !pref?.push_enabled) { await this.finish(this.prisma, row, invalid ? 'CANCELLED' : 'SKIPPED', invalid ?? 'PUSH_NOT_OPTED_IN'); return; }
      const text = notificationText(row.topic);
      const result = pushOutcome(await boundedPush(signal => this.fcm.sendToUser(String(row.user_id), text.title, text.body, { notificationId: row.id, topic: row.topic, ...(row.booking_id ? { bookingId: String(row.booking_id) } : {}) }, signal)));
      await this.finish(this.prisma, row, result.status, result.code, result.accepted);
    } catch (error) { await this.finish(this.prisma, row, 'FAILED', row.channel === 'EMAIL' ? 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN' : error instanceof Error && error.message === 'PUSH_ACCEPTANCE_UNKNOWN' ? 'PUSH_ACCEPTANCE_UNKNOWN' : 'PUSH_PROVIDER_ERROR'); }
    finally { clearInterval(heartbeat); }
  }
}
