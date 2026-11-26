/** Legacy facade. New business code uses the common enqueue helper inside its own transaction. */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { enqueueNotification, NotificationTopic, syncBookingReminder } from '../../common/notification-outbox';
export interface BookingNotificationContext { bookingNo: string; shopName: string; shopNameEn?: string; date: string; time: string; serviceName: string; durationMin: number; priceCents: number }
export interface UserNotificationContext { id: string | number; phone: string; name?: string }
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}
  private async enqueue(context: BookingNotificationContext, user: UserNotificationContext, topic: NotificationTopic) {
    if (typeof user.id === 'number' && !Number.isSafeInteger(user.id) || !/^[1-9]\d{0,18}$/.test(String(user.id))) return;
    await this.prisma.$transaction(async tx => {
      const found = await tx.booking.findFirst({ where: { bookingNo: context.bookingNo, userId: BigInt(user.id), deletedAt: null }, select: { id: true, shopId: true } });
      if (!found) return;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${found.shopId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id=${found.id} FOR UPDATE`);
      const booking = await tx.booking.findFirst({ where: { id: found.id, userId: BigInt(user.id), deletedAt: null }, select: { id: true, userId: true, startTime: true, status: true } });
      if (!booking || topic === 'BOOKING_CONFIRMED' && booking.status !== 'CONFIRMED' || topic === 'BOOKING_CANCELLED' && booking.status !== 'CANCELLED' || topic === 'BOOKING_COMPLETED' && booking.status !== 'COMPLETED') return;
      if (topic === 'BOOKING_REMINDER') return syncBookingReminder(tx, booking);
      await enqueueNotification(tx, { eventKey: 'booking:' + booking.id + ':legacy:' + topic, userId: booking.userId, topic, resourceType: 'BOOKING', resourceId: String(booking.id), bookingId: booking.id });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  notifyBookingConfirmed(b: BookingNotificationContext, u: UserNotificationContext) { return this.enqueue(b,u,'BOOKING_CONFIRMED'); }
  notifyBookingReminder(b: BookingNotificationContext, u: UserNotificationContext) { return this.enqueue(b,u,'BOOKING_REMINDER'); }
  notifyBookingCancelled(b: BookingNotificationContext, u: UserNotificationContext) { return this.enqueue(b,u,'BOOKING_CANCELLED'); }
  notifyReviewRequest(b: BookingNotificationContext, u: UserNotificationContext) { return this.enqueue(b,u,'BOOKING_COMPLETED'); }
  notifyRefundProcessed(b: BookingNotificationContext, u: UserNotificationContext, _amountCents: number) { return this.enqueue(b,u,'REFUND_PROCESSED'); }
}
