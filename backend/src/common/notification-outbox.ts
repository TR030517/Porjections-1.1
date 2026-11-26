/** Transactional notification enqueue only. No DI, timers, provider calls or private contact data. */
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { bookingOrderEmailSnapshot, customerOrderEmail, ORDER_EMAIL_BOOKING_SELECT, ORDER_EMAIL_TOPICS, readOrderEmailSnapshot, type OrderEmailTopic } from './booking-order-email';
import { orderEmailRecipientFingerprint, shopOrderEmailEventKey } from './shop-order-email';
import { verifiedShopOrderEmailEnvelope } from './shop-order-email-destination';
import { bookingContactView, hasBookingContactSnapshot } from './booking-contact';

export const NOTIFICATION_TOPICS = ['BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'BOOKING_REMINDER', 'BOOKING_COMPLETED', 'PAYMENT_RECEIVED', 'REFUND_PROCESSED', 'GIFT_PURCHASED', 'GIFT_REFUNDED', 'GIFT_GRANTED', 'GIFT_REDEEMED', 'GIFT_VOIDED', 'AFTER_SALES_UPDATED'] as const;
export type NotificationTopic = typeof NOTIFICATION_TOPICS[number];
export const NOTIFICATION_CHANNELS = ['IN_APP', 'PUSH', 'SMS'] as const;
export interface NotificationInput {
  eventKey: string; userId: string | bigint | null; topic: NotificationTopic;
  resourceType: 'BOOKING' | 'GIFT_ENTITLEMENT' | 'GIFT_ORDER' | 'AFTER_SALES' | 'SYSTEM';
  resourceId: string; bookingId?: string | bigint; expectedStartAtUtc?: Date;
  runAt?: Date; data?: { amountCents?: number; currency?: string };
}
export function notificationInput(input: NotificationInput) {
  if (input.userId === null) throw new Error('INVALID_NOTIFICATION_INPUT');
  if (!/^[A-Za-z0-9:_./-]{1,160}$/.test(input.eventKey) || !NOTIFICATION_TOPICS.includes(input.topic)
    || !['BOOKING', 'GIFT_ENTITLEMENT', 'GIFT_ORDER', 'AFTER_SALES', 'SYSTEM'].includes(input.resourceType)
    || !/^[1-9]\d{0,18}$/.test(String(input.userId)) || BigInt(input.userId) > 9223372036854775807n
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.resourceId)) throw new Error('INVALID_NOTIFICATION_INPUT');
  if (input.bookingId !== undefined && (!/^[1-9]\d{0,18}$/.test(String(input.bookingId)) || BigInt(input.bookingId) > 9223372036854775807n)) throw new Error('INVALID_NOTIFICATION_INPUT');
  if (input.topic === 'BOOKING_REMINDER' && (!input.bookingId || !input.expectedStartAtUtc)) throw new Error('INVALID_NOTIFICATION_REMINDER');
  const date = (value: Date | undefined) => value === undefined ? null : value instanceof Date && Number.isFinite(value.getTime()) ? value : (() => { throw new Error('INVALID_NOTIFICATION_TIME'); })();
  const expected = date(input.expectedStartAtUtc), runAt = date(input.runAt) ?? new Date();
  const data = input.data ?? {};
  if (Object.keys(data).some(key => !['amountCents', 'currency'].includes(key)) || data.amountCents !== undefined && (!Number.isSafeInteger(data.amountCents) || data.amountCents < 0) || data.currency !== undefined && !/^[a-z]{3}$/.test(data.currency)) throw new Error('INVALID_NOTIFICATION_DATA');
  const content = { userId: String(input.userId), topic: input.topic, resourceType: input.resourceType, resourceId: input.resourceId, bookingId: input.bookingId === undefined ? null : String(input.bookingId), expectedStartAtUtc: expected?.toISOString() ?? null, data: { ...(data.amountCents === undefined ? {} : { amountCents: data.amountCents }), ...(data.currency === undefined ? {} : { currency: data.currency }) } };
  return { ...content, expected, runAt, hash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), dataJson: JSON.stringify(content.data) };
}

export async function enqueueNotification(tx: Prisma.TransactionClient, input: NotificationInput): Promise<void> {
  // Accountless orders have no customer inbox, device, SMS consent or account
  // reminder. Their separate store EMAIL event is still enqueued below.
  if (input.userId === null && input.resourceType === 'BOOKING' && input.bookingId != null) return;
  const n = notificationInput(input);
  for (const channel of NOTIFICATION_CHANNELS) {
    // No INSERT IGNORE: FK/data failures must remain visible; a duplicate must not replace its recipient.
    await tx.$executeRaw(Prisma.sql`INSERT INTO notification_outbox (id,event_key,content_hash,user_id,topic,resource_type,resource_id,booking_id,expected_start_at_utc,channel,status,run_at,data_json,created_at,updated_at)
      VALUES (${randomUUID()},${input.eventKey},${n.hash},${BigInt(n.userId)},${n.topic},${n.resourceType},${n.resourceId},${n.bookingId === null ? null : BigInt(n.bookingId)},${n.expected},${channel},'PENDING',${n.runAt},${n.dataJson},NOW(3),NOW(3))
      ON DUPLICATE KEY UPDATE event_key=event_key`);
    const rows = await tx.$queryRaw<{ content_hash: string }[]>(Prisma.sql`SELECT content_hash FROM notification_outbox WHERE event_key=${input.eventKey} AND channel=${channel}`);
    if (rows[0]?.content_hash !== n.hash) throw new Error('NOTIFICATION_EVENT_KEY_CONFLICT');
  }
}

/** One EMAIL event in the same booking transaction; delivery is always outside it.
 * Historical missing contact/snapshot becomes a visible blocked task, never a reason
 * to prevent cancellation or lose the durable order. New orders validate email first. */
export async function enqueueBookingOrderEmail(tx: Prisma.TransactionClient, input: { eventKey: string; userId: string | bigint | null; bookingId: string | bigint; topic: NotificationTopic }): Promise<void> {
  if (!(ORDER_EMAIL_TOPICS as readonly string[]).includes(input.topic)) return;
  const guest = input.userId === null;
  if (guest && (!/^[A-Za-z0-9:_./-]{1,160}$/.test(input.eventKey) || !/^[1-9]\d{0,18}$/.test(String(input.bookingId)) || BigInt(input.bookingId) > 9223372036854775807n)) throw Error('INVALID_NOTIFICATION_INPUT');
  const identity = guest ? { runAt: new Date() } : notificationInput({ ...input, resourceType: 'BOOKING', resourceId: String(input.bookingId) });
  const booking = await tx.booking.findUnique({ where: { id: BigInt(input.bookingId) }, select: ORDER_EMAIL_BOOKING_SELECT });
  if (!booking || String(booking.userId) !== String(input.userId)) throw Error('ORDER_EMAIL_BOOKING_RECIPIENT_MISMATCH');
  let snapshot = bookingOrderEmailSnapshot(booking, input.topic as OrderEmailTopic);
  const hasRecordedContact = hasBookingContactSnapshot(booking), contact = bookingContactView(booking);
  if (guest && (booking.bookingSource !== 'ASSISTED_GUEST' || snapshot && snapshot.version !== 2)) throw Error('ORDER_EMAIL_GUEST_SNAPSHOT_UNAVAILABLE');
  if (!guest) {
  const user = await tx.user.findUnique({ where: { id: BigInt(input.userId!) }, select: { id: true, email: true, emailVerifiedAt: true, role: true, status: true, deletedAt: true } });
  if (hasRecordedContact) snapshot = contact.recorded && snapshot ? readOrderEmailSnapshot({ ...snapshot, contactVersion: contact.version,
    customerRecipientFingerprint: contact.source === 'ONLINE_VERIFIED' ? orderEmailRecipientFingerprint(contact.email) : null }) : null;
  const recipient = customerOrderEmail(user?.email);
  const reason = !user || String(user.id) !== String(input.userId) || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE' || user.deletedAt || !customerOrderEmail(user.email) || !user.emailVerifiedAt
    ? 'ORDER_EMAIL_RECIPIENT_UNAVAILABLE' : hasRecordedContact && (!contact.recorded || !snapshot) ? 'ORDER_EMAIL_CONTACT_SNAPSHOT_UNAVAILABLE'
      : hasRecordedContact && contact.recorded && recipient?.toLowerCase() !== contact.email ? 'ORDER_EMAIL_RECIPIENT_CHANGED'
        : !snapshot ? 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' : null;
  const data = snapshot ?? { version: 1, unavailableReason: 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' };
  const hash = createHash('sha256').update(JSON.stringify({ ...identity, expected: undefined, runAt: undefined, hash: undefined, dataJson: undefined, data })).digest('hex');
  await tx.$executeRaw(Prisma.sql`INSERT INTO notification_outbox (id,event_key,content_hash,user_id,topic,resource_type,resource_id,booking_id,channel,status,run_at,data_json,last_error_code,created_at,updated_at)
    VALUES (${randomUUID()},${input.eventKey},${hash},${BigInt(input.userId!)},${input.topic},'BOOKING',${String(input.bookingId)},${BigInt(input.bookingId)},'EMAIL',${reason ? 'BLOCKED' : 'PENDING'},${identity.runAt},${JSON.stringify(data)},${reason},NOW(3),NOW(3))
    ON DUPLICATE KEY UPDATE event_key=event_key`);
  const rows = await tx.$queryRaw<{ content_hash: string }[]>(Prisma.sql`SELECT content_hash FROM notification_outbox WHERE event_key=${input.eventKey} AND channel='EMAIL'`);
  if (rows[0]?.content_hash !== hash) throw Error('ORDER_EMAIL_EVENT_KEY_CONFLICT');
  }
  // Each new business event has a separate store task. Customer delivery and
  // retries never create, redirect, or backfill a store message.
  const storeData = verifiedShopOrderEmailEnvelope(booking.shopId, booking.shop?.orderEmailSetting, snapshot);
  const storeKey = shopOrderEmailEventKey(input.eventKey);
  const storeReason = !storeData.recipientFingerprint ? 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE' : !snapshot ? hasRecordedContact ? 'ORDER_EMAIL_CONTACT_SNAPSHOT_UNAVAILABLE' : 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' : null;
  const storeHash = createHash('sha256').update(JSON.stringify({ eventKey: storeKey, userId: String(input.userId), bookingId: String(input.bookingId), topic: input.topic, data: storeData })).digest('hex');
  await tx.$executeRaw(Prisma.sql`INSERT INTO notification_outbox (id,event_key,content_hash,user_id,topic,resource_type,resource_id,booking_id,channel,status,run_at,data_json,last_error_code,created_at,updated_at)
    VALUES (${randomUUID()},${storeKey},${storeHash},${guest ? null : BigInt(input.userId!)},${input.topic},'BOOKING',${String(input.bookingId)},${BigInt(input.bookingId)},'EMAIL',${storeReason ? 'BLOCKED' : 'PENDING'},${identity.runAt},${JSON.stringify(storeData)},${storeReason},NOW(3),NOW(3))
    ON DUPLICATE KEY UPDATE event_key=event_key`);
  const storeRows = await tx.$queryRaw<{ content_hash: string }[]>(Prisma.sql`SELECT content_hash FROM notification_outbox WHERE event_key=${storeKey} AND channel='EMAIL'`);
  if (storeRows[0]?.content_hash !== storeHash) throw Error('ORDER_EMAIL_EVENT_KEY_CONFLICT');
}

/** Call in the booking mutation transaction after acquiring the common shop/booking locks. */
export async function syncBookingReminder(tx: Prisma.TransactionClient, booking: { id: string | bigint; userId: string | bigint | null; startTime: Date; status: string; deletedAt?: Date | null }, now = new Date()): Promise<void> {
  await tx.$executeRaw(Prisma.sql`UPDATE notification_outbox SET status='CANCELLED',last_error_code='BOOKING_SCHEDULE_CHANGED',lease_token=NULL,lease_until=NULL,updated_at=NOW(3)
    WHERE booking_id=${BigInt(booking.id)} AND topic='BOOKING_REMINDER' AND status IN ('PENDING','PROCESSING')`);
  if (booking.userId === null || booking.status !== 'CONFIRMED' || booking.deletedAt || booking.startTime <= now) return;
  const eventKey = `booking:${booking.id}:reminder:${booking.startTime.getTime()}`;
  const runAt = new Date(Math.max(now.getTime(), booking.startTime.getTime() - 30 * 60_000));
  await enqueueNotification(tx, { eventKey, userId: booking.userId, topic: 'BOOKING_REMINDER', resourceType: 'BOOKING', resourceId: String(booking.id), bookingId: booking.id, expectedStartAtUtc: booking.startTime, runAt });
  // Returning to an earlier future slot may revive only a cancelled reminder, never a published one.
  await tx.$executeRaw(Prisma.sql`UPDATE notification_outbox SET status='PENDING',run_at=${runAt},attempts=0,last_error_code=NULL,updated_at=NOW(3) WHERE event_key=${eventKey} AND status='CANCELLED'`);
}
