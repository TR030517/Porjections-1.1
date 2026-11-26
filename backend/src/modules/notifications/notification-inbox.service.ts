import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxQueryDto, OutboxQueryDto } from './dto/notification.dto';
import { MAX_MANUAL_RETRIES, OUTBOX_STATUSES, notificationText } from './notification.rules';
import { NOTIFICATION_TOPICS, NotificationTopic } from '../../common/notification-outbox';
import { requireShopAccess } from '../../common/shop-access';
import { orderEmailConfig } from './order-email-delivery';
import { canRetryNotification, orderEmailTaskStatus } from './order-email-status';
import { orderEmailEventCurrent, readOrderEmailSnapshot } from '../../common/booking-order-email';
import { orderEmailAudience, orderEmailRecipientFingerprint, readShopOrderEmailEnvelope } from '../../common/shop-order-email';
import { SHOP_ORDER_EMAIL_DESTINATION_SELECT, shopOrderEmailEventRecipient } from '../../common/shop-order-email-destination';

interface InboxRow { id: string; topic: string; title: string; body: string; resource_type: string; resource_id: string; booking_id: bigint | null; created_at: Date; read_at: Date | null }
export function inboxItem(row: InboxRow) {
  // System topics have fixed, non-personal templates. Render historical rows
  // through the current English template without rewriting or resending them.
  const text = NOTIFICATION_TOPICS.includes(row.topic as NotificationTopic)
    ? notificationText(row.topic as NotificationTopic)
    : { title: row.title, body: row.body };
  return { id: row.id, topic: row.topic, ...text, resourceType: row.resource_type, resourceId: row.resource_id, bookingId: row.booking_id?.toString() ?? null, createdAt: row.created_at, readAt: row.read_at };
}
export function notificationIdentity(value: string) { if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new BadRequestException('Invalid identity'); return BigInt(value); }
function uuid(value: string) { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new BadRequestException('Invalid notification ID'); return value; }
function pagination(query: InboxQueryDto) {
  const page = query.page ?? 1, pageSize = query.pageSize ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('Invalid pagination');
  return { page, pageSize, skip: (page - 1) * pageSize };
}
@Injectable()
export class NotificationInboxService {
  constructor(private readonly prisma: PrismaService) {}
  async list(userId: string, query: InboxQueryDto) {
    const owner = notificationIdentity(userId), { page, pageSize, skip } = pagination(query);
    if (query.unreadOnly !== undefined && !['true', 'false'].includes(query.unreadOnly)) throw new BadRequestException('Invalid unread filter');
    const where = Prisma.sql`user_id=${owner} ${query.unreadOnly === 'true' ? Prisma.sql`AND read_at IS NULL` : Prisma.empty}`;
    return this.prisma.$transaction(async tx => {
      const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM user_notifications WHERE ${where}`);
      const [unread] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM user_notifications WHERE user_id=${owner} AND read_at IS NULL`);
      const rows = await tx.$queryRaw<InboxRow[]>(Prisma.sql`SELECT id,topic,title,body,resource_type,resource_id,booking_id,created_at,read_at FROM user_notifications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${skip}`);
      const total = Number(count.total);
      return { items: rows.map(inboxItem), total, page, pageSize, totalPages: Math.ceil(total / pageSize), unreadCount: Number(unread.total) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async read(userId: string, id: string) {
    const owner = notificationIdentity(userId); uuid(id);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`UPDATE user_notifications SET read_at=COALESCE(read_at,NOW(3)) WHERE id=${id} AND user_id=${owner}`);
      const [row] = await tx.$queryRaw<InboxRow[]>(Prisma.sql`SELECT id,topic,title,body,resource_type,resource_id,booking_id,created_at,read_at FROM user_notifications WHERE id=${id} AND user_id=${owner}`);
      if (!row) throw new NotFoundException('Notification not found');
      return { item: inboxItem(row) };
    });
  }
  async readAll(userId: string) { return { updatedCount: await this.prisma.$executeRaw(Prisma.sql`UPDATE user_notifications SET read_at=NOW(3) WHERE user_id=${notificationIdentity(userId)} AND read_at IS NULL`) }; }
  async preferences(userId: string) {
    const [row] = await this.prisma.$queryRaw<{ push_enabled: boolean; push_consented_at: Date | null }[]>(Prisma.sql`SELECT push_enabled,push_consented_at FROM notification_preferences WHERE user_id=${notificationIdentity(userId)}`);
    return { pushEnabled: Boolean(row?.push_enabled), pushConsentedAt: row?.push_consented_at ?? null, smsEnabled: false, smsReason: 'SMS_CONSENT_NOT_ESTABLISHED' };
  }
  async updatePreferences(userId: string, pushEnabled: boolean) {
    if (typeof pushEnabled !== 'boolean') throw new BadRequestException('pushEnabled must be boolean');
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO notification_preferences (user_id,push_enabled,push_consented_at,updated_at) VALUES (${notificationIdentity(userId)},${pushEnabled},${pushEnabled ? new Date() : null},NOW(3))
      ON DUPLICATE KEY UPDATE push_enabled=VALUES(push_enabled),push_consented_at=VALUES(push_consented_at),updated_at=NOW(3)`);
    return this.preferences(userId);
  }
  /** Read-only order-scoped status. Customer ownership never grants global task access. */
  async orderEmail(actor: { id: string; role: string }, bookingId: string) {
    const id = notificationIdentity(bookingId), actorId = notificationIdentity(actor.id);
    return this.prisma.$transaction(async tx => {
      const booking = await tx.booking.findUnique({ where: { id }, select: { id: true, userId: true, bookingSource: true, contactEmail: true, shopId: true, status: true, deletedAt: true, startTime: true, endTime: true } });
      if (!booking || booking.deletedAt) throw new NotFoundException('Order not found');
      const user = await tx.user.findFirst({ where: { id: actorId, role: actor.role as any, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!user) throw new NotFoundException('Order not found');
      if (actor.role === 'CUSTOMER') { if (booking.userId !== actorId) throw new NotFoundException('Order not found'); }
      else if (['ADMIN','MERCHANT','STAFF'].includes(actor.role)) {
        try { await requireShopAccess(tx, booking.shopId, actor, 'BOOKINGS_READ'); } catch { throw new NotFoundException('Order not found'); }
      } else throw new NotFoundException('Order not found');
      const rows = await tx.$queryRaw<Array<{ id: string; topic: string; status: string; attempts: number; maxAttempts: number; retryCount: number; lastErrorCode: string | null; acceptedCount: number; createdAt: Date; runAt: Date; finishedAt: Date | null; dataJson: unknown }>>(Prisma.sql`SELECT id,topic,status,attempts,max_attempts AS maxAttempts,retry_count AS retryCount,last_error_code AS lastErrorCode,accepted_count AS acceptedCount,created_at AS createdAt,run_at AS runAt,finished_at AS finishedAt,data_json AS dataJson
        FROM notification_outbox WHERE booking_id=${id} AND user_id <=> ${booking.userId} AND channel='EMAIL' ORDER BY created_at DESC,id DESC LIMIT 100`);
      const config = orderEmailConfig(), workerEnabled = process.env.NOTIFICATION_WORKER_ENABLED !== 'false';
      const configuration = { ...config, workerEnabled, ...(config.enabled && !workerEnabled ? { reasonCode: 'ORDER_EMAIL_WORKER_DISABLED' } : {}) };
      const currentTopic = booking.status === 'CANCELLED' ? 'BOOKING_CANCELLED' : booking.status === 'COMPLETED' ? 'BOOKING_COMPLETED' : booking.status === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : booking.status === 'PENDING' ? 'BOOKING_CREATED' : null;
      const project = (audience: 'CUSTOMER' | 'SHOP') => {
        const matching = rows.filter(row => orderEmailAudience(row.dataJson) === audience);
        const tasks = matching.map(row => ({ id: row.id, topic: row.topic, audience, status: orderEmailTaskStatus(row, configuration.enabled), rawStatus: row.status,
          attempts: row.attempts, maxAttempts: row.maxAttempts, retryCount: row.retryCount,
          lastErrorCode: row.lastErrorCode && /^ORDER_EMAIL_[A-Z_]{1,80}$/.test(row.lastErrorCode) ? row.lastErrorCode : null,
          acceptedCount: row.acceptedCount, createdAt: row.createdAt, runAt: row.runAt, finishedAt: row.finishedAt }));
        const currentIndex = matching.findIndex(row => {
          const snapshot = audience === 'SHOP' ? readShopOrderEmailEnvelope(row.dataJson)?.snapshot : readOrderEmailSnapshot(row.dataJson);
          return snapshot && snapshot.topic === row.topic && orderEmailEventCurrent(snapshot, booking);
        });
        // A blocked legacy projection is a real failed attempt, not "no record".
        const blockedIndex = currentIndex < 0 && currentTopic ? matching.findIndex(row => row.topic === currentTopic && row.status === 'BLOCKED'
          && (row.lastErrorCode === 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' || audience === 'SHOP' && /^ORDER_EMAIL_STORE_/.test(row.lastErrorCode ?? ''))) : -1;
        const current = currentIndex >= 0 ? tasks[currentIndex] : blockedIndex >= 0 ? tasks[blockedIndex] : undefined;
        return { status: current?.status ?? 'NOT_REQUESTED', statusReasonCode: current?.lastErrorCode ?? null, tasks };
      };
      const customer = booking.userId === null && booking.bookingSource === 'ASSISTED_GUEST'
        ? { status: 'NOT_REQUESTED', statusReasonCode: booking.contactEmail ? 'ORDER_EMAIL_GUEST_AUTHORIZATION_REQUIRED' : 'ORDER_EMAIL_GUEST_NO_ADDRESS', tasks: [] } : project('CUSTOMER');
      const store = actor.role === 'CUSTOMER' ? null : project('SHOP');
      return { bookingId: String(id), channel: 'EMAIL' as const, configuration, ...customer,
        ...(store ? { storeStatus: store.status, storeStatusReasonCode: store.statusReasonCode, storeTasks: store.tasks } : {}) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  private admin(actor: { id: string; role: string }) { if (actor.role !== 'ADMIN') throw new ForbiddenException('Administrator access required'); return notificationIdentity(actor.id); }
  async tasks(actor: { id: string; role: string }, query: OutboxQueryDto) {
    this.admin(actor);
    const { page, pageSize, skip } = pagination(query);
    if (query.status && !(OUTBOX_STATUSES as readonly string[]).includes(query.status) || query.channel && !['IN_APP', 'PUSH', 'SMS', 'EMAIL'].includes(query.channel) || query.topic && !/^[A-Z_]{1,40}$/.test(query.topic)) throw new BadRequestException('Invalid task filter');
    const where = Prisma.sql`1=1 ${query.status ? Prisma.sql`AND status=${query.status}` : Prisma.empty} ${query.channel ? Prisma.sql`AND channel=${query.channel}` : Prisma.empty} ${query.topic ? Prisma.sql`AND topic=${query.topic}` : Prisma.empty}`;
    return this.prisma.$transaction(async tx => {
      const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM notification_outbox WHERE ${where}`);
      const rows = await tx.$queryRaw<any[]>(Prisma.sql`SELECT id,topic,resource_type AS resourceType,resource_id AS resourceId,booking_id AS bookingId,channel,status,attempts,max_attempts AS maxAttempts,retry_count AS retryCount,last_error_code AS lastErrorCode,accepted_count AS acceptedCount,created_at AS createdAt,run_at AS runAt,finished_at AS finishedAt,lease_until AS leaseUntil,data_json AS dataJson FROM notification_outbox WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ${pageSize} OFFSET ${skip}`);
      const summary = await tx.$queryRaw<{ status: string; channel: string; total: bigint }[]>(Prisma.sql`SELECT status,channel,COUNT(*) AS total FROM notification_outbox GROUP BY status,channel`);
      const total = Number(count.total);
      return { items: rows.map(({ dataJson, ...row }) => ({ ...row, audience: row.channel === 'EMAIL' ? orderEmailAudience(dataJson) : null,
        bookingId: row.bookingId?.toString() ?? null, canRetry: canRetryNotification(row, MAX_MANUAL_RETRIES) })), total, page, pageSize, totalPages: Math.ceil(total / pageSize), summary: summary.map(row => ({ ...row, total: Number(row.total) })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async retry(actor: { id: string; role: string }, id: string, reason: string) {
    const operatorId = this.admin(actor); uuid(id);
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) throw new BadRequestException('Retry reason must contain 5 to 500 characters');
    await this.prisma.$transaction(async tx => {
      // Retrying a previously unconfigured task must not silently redirect it if
      // the store changed its address after the original business event.
      const [task] = await tx.$queryRaw<Array<{ channel: string; dataJson: unknown; bookingId: bigint | null }>>(Prisma.sql`SELECT channel,data_json AS dataJson,booking_id AS bookingId FROM notification_outbox WHERE id=${id}`);
      if (task?.channel === 'EMAIL' && orderEmailAudience(task.dataJson) === 'SHOP') {
        const envelope = readShopOrderEmailEnvelope(task.dataJson);
        if (!envelope?.recipientFingerprint) throw new ConflictException({ code: 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE', message: 'The original store recipient is unavailable. This task cannot be redirected to a new address.' });
        const booking = task.bookingId ? await tx.booking.findUnique({ where: { id: task.bookingId }, select: { shopId: true } }) : null;
        if (!booking || String(booking.shopId) !== envelope.shopId) throw new ConflictException({ code: 'ORDER_EMAIL_STORE_UNAVAILABLE', message: 'The original store is unavailable.' });
        await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${booking.shopId} FOR UPDATE`);
        const shop = await tx.shop.findUnique({ where: { id: booking.shopId }, select: { deletedAt: true, studioProfile: true, orderEmailSetting: { select: SHOP_ORDER_EMAIL_DESTINATION_SELECT } } });
        if (!shop || shop.deletedAt) throw new ConflictException({ code: 'ORDER_EMAIL_STORE_UNAVAILABLE', message: 'The original store is unavailable.' });
        const recipient = shopOrderEmailEventRecipient(envelope, shop);
        if (!recipient) throw new ConflictException({ code: 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE', message: 'The original store recipient is unavailable.' });
        if (orderEmailRecipientFingerprint(recipient) !== envelope.recipientFingerprint) throw new ConflictException({ code: 'ORDER_EMAIL_STORE_RECIPIENT_CHANGED', message: 'The store recipient has changed. This task cannot be redirected to the new address.' });
      }
      const count = await tx.$executeRaw(Prisma.sql`UPDATE notification_outbox SET status='PENDING',attempts=0,retry_count=retry_count+1,run_at=NOW(3),finished_at=NULL,last_error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=NOW(3)
        WHERE id=${id} AND retry_count<${MAX_MANUAL_RETRIES} AND ((channel<>'EMAIL' AND status IN ('FAILED','SKIPPED')) OR (channel='EMAIL' AND status IN ('FAILED','SKIPPED','BLOCKED') AND last_error_code IN ('ORDER_EMAIL_NOT_CONFIGURED','ORDER_EMAIL_RATE_LIMITED','ORDER_EMAIL_PROVIDER_REJECTED','ORDER_EMAIL_RECIPIENT_UNAVAILABLE')))`);
      if (!count) throw new ConflictException('Task cannot be retried; refresh its current status');
      // UUID target is recorded as a safe opaque ID in detail; no recipient, reason or payload is logged.
      await tx.auditLog.create({ data: { action: 'NOTIFICATION_RETRY', targetType: 'NOTIFICATION_OUTBOX', targetId: 0n, operatorId, detail: { notificationId: id, reasonRecorded: true } } });
    });
    return { queued: true, id };
  }
}
