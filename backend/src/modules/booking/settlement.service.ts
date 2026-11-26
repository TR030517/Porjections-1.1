import { enqueueBookingOrderEmail, enqueueNotification, syncBookingReminder } from '../../common/notification-outbox';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { numericId } from '../payment/money';
import { expireShopHolds, lockShop, releaseReservation, reservationTransaction } from './lifecycle';
import { receiptInput, settlementActions, settlementKey, settlementMode, settlementReason } from './settlement.rules';
import { requireShopAccess, ShopPermission } from '../../common/shop-access';
import { bookingOrderPolicy } from '../../common/order-mode';
import { bookingOperation, bookingOperationKey } from './booking-operation';

/** Records already completed physical collection/refund. Never calls a provider
 * or credits merchant payout balances. Every writer uses shop -> booking locks. */
@Injectable()
export class SettlementService {
  constructor(private readonly prisma: PrismaService) {}
  private async owned(tx: any, id: string, actor: string, role: string, permission: ShopPermission = 'BOOKINGS_READ') {
    const bid = numericId(id), actorId = numericId(actor);
    const ref = await tx.booking.findUnique({ where: { id: bid }, select: { shopId: true } });
    if (!ref) throw new NotFoundException('Booking not found');
    await lockShop(tx, ref.shopId); await expireShopHolds(tx, ref.shopId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${bid} FOR UPDATE`);
    const b = await tx.booking.findUnique({ where: { id: bid }, include: { shop: { select: { ownerId: true } } } });
    if (!b || b.deletedAt) throw new NotFoundException('Booking not found');
    try { await requireShopAccess(tx, b.shopId, { id: actor, role }, permission, { write: true }); }
    catch (error) { if (error instanceof ForbiddenException) throw new NotFoundException('Booking not found'); throw error; }
    return b;
  }
  private async fenced(tx: any, id: bigint) {
    return !!await tx.refundRequest.findFirst({ where: { bookingId: id, status: { in: ['PENDING', 'RETRYABLE'] } }, select: { id: true } });
  }
  private async entries(tx: any, id: bigint): Promise<any[]> {
    return tx.bookingSettlementEntry.findMany({ where: { bookingId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }
  private integrity(b: any, entries: any[]) {
    const receipts = entries.filter(e => e.kind === 'RECEIPT').reduce((s, e) => s + e.amountCents, 0);
    const reversals = entries.filter(e => e.kind === 'REVERSAL').reduce((s, e) => s + e.amountCents, 0);
    const refunds = entries.filter(e => e.kind === 'REFUND').reduce((s, e) => s + e.amountCents, 0);
    if (receipts - reversals !== b.paidCents || refunds !== b.refundedCents || entries.some(e => e.currency !== b.currency)
      || b.paidCents < b.refundedCents || b.paidCents > b.totalCents) throw new ConflictException('Offline evidence does not match booking totals; reconcile before recording another action');
  }
  private async summary(tx: any, b: any, actor?: string, role?: string) {
    const entries = await this.entries(tx, b.id), fence = await this.fenced(tx, b.id);
    if (settlementMode(b) === 'PAY_AT_STORE') this.integrity(b, entries);
    const net = b.paidCents - b.refundedCents;
    const permissions = role && actor ? (await requireShopAccess(tx, b.shopId, { id: actor!, role }, 'BOOKINGS_READ', { write: true })).permissions : null;
    const can = (permission: ShopPermission) => !permissions || permissions.includes(permission);
    const actions = settlementActions(b, true, fence);
    const canReverse = can('REFUNDS_MANAGE') && !fence && settlementMode(b) === 'PAY_AT_STORE' && b.refundedCents === 0 && ['CONFIRMED', 'COMPLETED'].includes(b.status);
    return { ...bookingOrderPolicy(), bookingId: b.id.toString(), shopId: b.shopId.toString(), paymentMode: settlementMode(b), currency: b.currency,
      totalCents: b.totalCents, paidCents: b.paidCents, refundedCents: b.refundedCents, netPaidCents: net,
      amountDueCents: b.paymentStatus === 'REFUNDED' || ['CANCELLED', 'REFUNDED', 'REFUNDING'].includes(b.status) ? 0 : Math.max(0, b.totalCents - net),
      status: b.status, paymentStatus: b.paymentStatus, allowedActions: { ...actions,
        confirm: actions.confirm && can('BOOKINGS_MANAGE'), complete: actions.complete && can('BOOKINGS_MANAGE'), cancel: actions.cancel && can('BOOKINGS_MANAGE'),
        recordReceipt: actions.recordReceipt && can('SETTLEMENT_RECORD'), recordRefund: actions.recordRefund && can('REFUNDS_MANAGE') },
      entries: entries.map(e => ({ id: e.id, kind: e.kind, amountCents: e.amountCents, currency: e.currency, method: e.method,
        occurredAt: e.occurredAt, createdAt: e.createdAt, reason: e.reason, referenceEntryId: e.referenceEntryId,
        canReverse: canReverse && e.kind === 'RECEIPT' && !entries.some(other => other.referenceEntryId === e.id && other.kind === 'REVERSAL') })) };
  }
  get(id: string, actor: string, role: string) {
    return reservationTransaction(this.prisma, async tx => this.summary(tx, await this.owned(tx, id, actor, role), actor, role));
  }
  recordReceipt(id: string, actor: string, role: string, data: any, operationKey?: string) { return this.record(id, actor, role, 'RECEIPT', data, undefined, operationKey); }
  recordRefund(id: string, actor: string, role: string, data: any, operationKey?: string) { return this.record(id, actor, role, 'REFUND', data, undefined, operationKey); }
  reverse(id: string, entryId: string, actor: string, role: string, data: any, operationKey?: string) {
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) throw new BadRequestException('Invalid receipt ID');
    return this.record(id, actor, role, 'REVERSAL', data, entryId, operationKey);
  }
  private async record(id: string, actor: string, role: string, kind: 'RECEIPT' | 'REFUND' | 'REVERSAL', data: any, entryId?: string, operationKey?: string) {
    const receiptKey = bookingOperationKey(operationKey);
    const key = settlementKey(data.requestKey), reason = settlementReason(data.reason);
    // Exact immutable command: no automatic key replacement after an uncertain response.
    const hash = createHash('sha256').update(JSON.stringify({ kind, entryId: entryId ?? null, actor, amountCents: data.amountCents ?? null,
      method: data.method ?? null, occurredAt: data.occurredAt ?? null, reason })).digest('hex');
    return reservationTransaction(this.prisma, async tx => {
      let b = await this.owned(tx, id, actor, role, kind === 'RECEIPT' ? 'SETTLEMENT_RECORD' : 'REFUNDS_MANAGE');
      return bookingOperation(tx, b, actor, receiptKey, `OFFLINE:${kind}`, { ...data, entryId }, async () => {
      const previous = await tx.bookingSettlementEntry.findUnique({ where: { bookingId_requestKey: { bookingId: b.id, requestKey: key } } });
      if (previous) {
        if (previous.requestHash !== hash || previous.operatorId !== numericId(actor)) throw new ConflictException('Request key was reused with different parameters');
        return this.summary(tx, b, actor, role);
      }
      if (settlementMode(b) !== 'PAY_AT_STORE') throw new BadRequestException('Only pay-at-store bookings accept offline evidence');
      if (await tx.paymentRecord.findUnique({ where: { bookingId: b.id } })) throw new ConflictException('External checkout exists; offline collection is blocked');
      const entries = await this.entries(tx, b.id); this.integrity(b, entries);
      const actions = settlementActions(b, true, await this.fenced(tx, b.id));
      let record: { amountCents: number; method: string; occurredAt: Date; reason: string }, update: any;
      let cancelledByRefund = false;
      if (kind === 'REVERSAL') {
        const original = entries.find(e => e.id === entryId && e.kind === 'RECEIPT');
        if (!original || b.refundedCents || !['CONFIRMED', 'COMPLETED'].includes(b.status) || await this.fenced(tx, b.id)) throw new BadRequestException('This receipt cannot be reversed');
        if (entries.some(e => e.kind === 'REVERSAL' && e.referenceEntryId === entryId)) throw new ConflictException('Receipt has already been reversed');
        record = { amountCents: original.amountCents, method: original.method, occurredAt: new Date(), reason };
        const paid = b.paidCents - original.amountCents;
        update = { paidCents: paid, paymentStatus: paid === b.totalCents ? 'PAID' : 'UNPAID' };
        // Fulfilment is historical: correcting a receipt never undoes a completed service.
      } else {
        record = receiptInput(data);
        if (kind === 'RECEIPT') {
          if (!actions.recordReceipt) throw new BadRequestException('Accept the pay-at-store reservation before recording a receipt');
          if (record.amountCents > b.totalCents - b.paidCents) throw new BadRequestException('Receipt exceeds the outstanding amount');
          const paid = b.paidCents + record.amountCents;
          update = { paidCents: paid, paymentStatus: paid === b.totalCents ? 'PAID' : 'UNPAID' };
        } else {
          if (!actions.recordRefund || record.amountCents !== b.paidCents - b.refundedCents) throw new BadRequestException('Record the full remaining offline refund; partial offline refunds are not enabled');
          update = { refundedCents: b.paidCents, paymentStatus: 'REFUNDED', ...(b.status === 'COMPLETED' ? {} : { status: 'CANCELLED' }), holdExpiresAt: null };
          cancelledByRefund = b.status !== 'COMPLETED';
          // A refund cannot undo a completed service or its cleanup occupation.
          if (b.status !== 'COMPLETED') await releaseReservation(tx, b.id);
        }
      }
      const entry = await tx.bookingSettlementEntry.create({ data: { bookingId: b.id, operatorId: numericId(actor), kind, currency: b.currency,
        ...record, requestKey: key, requestHash: hash, referenceEntryId: entryId ?? null } });
      b = await tx.booking.update({ where: { id: b.id }, data: update });
      await tx.auditLog.create({ data: { action: `OFFLINE_${kind}`, targetType: 'BOOKING', targetId: b.id, operatorId: numericId(actor),
        detail: { entryId: entry.id, amountCents: record.amountCents, currency: b.currency, method: record.method, reason: 'recorded', referenceEntryId: entryId ?? null } } });
      if (kind !== 'REVERSAL') await enqueueNotification(tx, { eventKey: `settlement:${entry.id}`, userId: b.userId, topic: kind === 'RECEIPT' ? 'PAYMENT_RECEIVED' : 'REFUND_PROCESSED', resourceType: 'BOOKING', resourceId: String(b.id), bookingId: b.id, data: { amountCents: record.amountCents, currency: b.currency } });
      if (cancelledByRefund) {
        // The same immutable cancellation event as the ordinary lifecycle path.
        // Receipt replay returns above; a completed service is never cancelled.
        // Recipient eligibility and guest/store snapshots stay in the shared helper.
        const eventKey = `booking:${b.id}:cancelled`;
        await enqueueNotification(tx, { eventKey, userId: b.userId, topic: 'BOOKING_CANCELLED', resourceType: 'BOOKING', resourceId: String(b.id), bookingId: b.id });
        await enqueueBookingOrderEmail(tx, { eventKey, userId: b.userId, bookingId: b.id, topic: 'BOOKING_CANCELLED' });
      }
      await syncBookingReminder(tx, b);
      return this.summary(tx, b, actor, role);
      }, async () => this.summary(tx, b, actor, role));
    });
  }
}
