import { ConflictException } from '@nestjs/common';

/** Caller holds the booking's shop/booking locks. No invented user/system actor. */
export async function syncRefundCase(tx: any, request: { id: string; idempotencyKey: string; bookingId: bigint; amountCents: number; status: string }) {
  const row = await tx.afterSalesCase.findUnique({ where: { refundKey: request.idempotencyKey } });
  if (!row) return;
  if (row.bookingId !== request.bookingId || row.requestedAmountCents !== request.amountCents || row.type !== 'REFUND' || row.refundRequestId && row.refundRequestId !== request.id) {
    throw new ConflictException('Refund and after-sales case do not match');
  }
  if (row.refundState === request.status && row.refundRequestId === request.id) return;
  // The immutable PaymentEvent/RefundRequest is the automatic update's source.
  // Human case events remain attributable only to a real authenticated operator.
  const updated = await tx.afterSalesCase.updateMany({ where: { id: row.id, version: row.version }, data: {
    refundState: request.status, refundRequestId: request.id, version: { increment: 1 },
  } });
  if (updated.count !== 1) throw new ConflictException('After-sales case changed during refund synchronization');
}
