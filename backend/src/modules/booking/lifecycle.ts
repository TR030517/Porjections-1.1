import { enqueueNotification, syncBookingReminder } from '../../common/notification-outbox';
import { Prisma } from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';
import { isRetryableTransactionError } from '../../common/transaction-retry';

/** All reservation writers acquire the shop before a booking, under READ COMMITTED. */
export async function lockShop(tx: any, shopId: bigint) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`);
}

export async function releaseReservation(tx: any, bookingId: bigint) {
  await tx.bookingResourceLock.updateMany({ where: { bookingId, status: 'ACTIVE' }, data: { status: 'RELEASED' } });
}

export async function restoreBookingCoupon(tx: any, booking: any) {
  if (!booking.couponId || booking.paidCents > 0) return;
  // Match redemption/claiming's coupon -> wallet order, including a platform
  // coupon restored in one shop while its wallet is reused at another shop.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM coupons WHERE id = ${booking.couponId} FOR UPDATE`);
  const restored = await tx.userCoupon.updateMany({ where: { bookingId: booking.id, status: 'USED' }, data: { status: 'UNUSED', usedAt: null, bookingId: null } });
  if (restored.count) await tx.coupon.updateMany({ where: { id: booking.couponId, usedCount: { gte: restored.count } }, data: { usedCount: { decrement: restored.count } } });
}

/** Only new, explicitly expiring prepayment holds expire. Legacy/null holds remain reserved. */
export async function expireShopHolds(tx: any, shopId: bigint, now = new Date()) {
  await tx.bookingResourceLock.updateMany({ where: { shopId, status: 'ACTIVE', endAtUtc: { lte: now }, booking: { status: { in: ['COMPLETED', 'CANCELLED', 'REFUNDED'] } } }, data: { status: 'RELEASED' } });
  const expired = await tx.booking.findMany({ where: { shopId, status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, holdExpiresAt: { lte: now } } });
  for (const booking of expired) {
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelReason: 'Payment reservation expired' } });
    await releaseReservation(tx, booking.id);
    await restoreBookingCoupon(tx, booking);
    await enqueueNotification(tx, { eventKey: `booking:${booking.id}:cancelled`, userId: booking.userId, topic: 'BOOKING_CANCELLED', resourceType: 'BOOKING', resourceId: String(booking.id), bookingId: booking.id });
    await syncBookingReminder(tx, { ...booking, status: 'CANCELLED' });
  }
  return expired.length;
}

export function holdMinutes() {
  const value = Number(process.env.BOOKING_HOLD_MINUTES ?? '15');
  if (!Number.isInteger(value) || value < 5 || value > 60) throw new ServiceUnavailableException('BOOKING_HOLD_MINUTES must be 5–60');
  return value;
}

export async function reservationTransaction<T>(db: any, work: (tx: any) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 }); }
    catch (error) {
      if (!isRetryableTransactionError(error)) throw error;
      if (attempt >= 2) throw new ServiceUnavailableException('Reservation is busy; retry the same request key');
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
