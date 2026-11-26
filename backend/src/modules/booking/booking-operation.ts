import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { numericId } from '../payment/money';

export function bookingOperationKey(value?: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value)) throw new BadRequestException('Invalid booking operation key');
  return value;
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => [key, canonical(value[key])]));
  return value;
}

const whereKey = (actor: string, bookingId: bigint, requestKey: string) => ({ actorId_bookingId_requestKey: { actorId: numericId(actor), bookingId, requestKey } });
const result = (row: any) => ({ bookingId: String(row.bookingId), shopId: String(row.shopId), requestKey: row.requestKey,
  outcome: row.outcome as 'COMMITTED' | 'NOT_EXECUTED', action: row.action as string | null });

/** Caller must already own the shared shop -> booking row locks and have
 * authorized the actor. Receipt and mutation commit or roll back together. */
export async function bookingOperation<T>(tx: any, booking: { id: bigint; shopId: bigint }, actor: string, key: string | undefined,
  action: string, payload: unknown, perform: () => Promise<T>, replay: () => Promise<T>): Promise<T> {
  if (key === undefined) return perform();
  const requestKey = bookingOperationKey(key)!;
  const hash = createHash('sha256').update(JSON.stringify(canonical({ action, payload }))).digest('hex');
  const previous = await tx.bookingOperationReceipt.findUnique({ where: whereKey(actor, booking.id, requestKey) });
  if (previous) {
    if (previous.outcome === 'NOT_EXECUTED') throw new ConflictException({ code: 'BOOKING_OPERATION_SEALED', message: 'This booking operation was closed without execution; refresh before making a new request' });
    if (previous.outcome !== 'COMMITTED' || previous.action !== action || previous.requestHash !== hash || previous.shopId !== booking.shopId) throw new ConflictException('Booking operation key was reused with different parameters');
    return replay();
  }
  const value = await perform();
  await tx.bookingOperationReceipt.create({ data: { id: randomUUID(), actorId: numericId(actor), bookingId: booking.id, shopId: booking.shopId,
    requestKey, requestHash: hash, action, outcome: 'COMMITTED' } });
  return value;
}

/** Absence is not treated as failure. A durable tombstone under the SAME
 * shop/booking locks fences any delayed command before reporting NOT_EXECUTED. */
export async function reconcileBookingOperation(tx: any, booking: { id: bigint; shopId: bigint }, actor: string, key: string) {
  const requestKey = bookingOperationKey(key)!;
  const previous = await tx.bookingOperationReceipt.findUnique({ where: whereKey(actor, booking.id, requestKey) });
  if (previous) {
    if (previous.shopId !== booking.shopId || !['COMMITTED', 'NOT_EXECUTED'].includes(previous.outcome)) throw new ConflictException('Booking operation evidence is inconsistent');
    return result(previous);
  }
  return result(await tx.bookingOperationReceipt.create({ data: { id: randomUUID(), actorId: numericId(actor), bookingId: booking.id, shopId: booking.shopId,
    requestKey, action: null, requestHash: null, outcome: 'NOT_EXECUTED' } }));
}
