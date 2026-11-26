import { BadRequestException } from '@nestjs/common';

export const OFFLINE_METHODS = ['CASH', 'EXTERNAL_TERMINAL', 'OTHER'] as const;
export function settlementMode(b: any): string { return b.paymentMode ?? 'ONLINE'; }
export function fullySettled(b: any): boolean {
  if (settlementMode(b) === 'ZERO') return b.totalCents === 0 && b.paidCents === 0 && b.refundedCents === 0 && b.paymentStatus === 'PAID';
  return b.totalCents > 0 && b.paidCents === b.totalCents && b.refundedCents === 0 && b.paymentStatus === 'PAID';
}
/** Fulfilment is separate from recording a physical receipt. This never marks
 * money as paid and cannot waive an online booking's settlement/refund fence. */
export function offlineFulfilmentAllowed(b: any): boolean {
  return settlementMode(b) === 'PAY_AT_STORE' && b.paymentStatus === 'UNPAID'
    && Number.isSafeInteger(b.totalCents) && b.totalCents >= 0 && Number.isSafeInteger(b.paidCents) && b.paidCents >= 0 && b.paidCents <= b.totalCents
    && b.refundedCents === 0;
}
export function settlementActions(b: any, manager: boolean, fenced: boolean, now = new Date()) {
  const mode = settlementMode(b), live = !b.deletedAt;
  const net = b.paidCents - b.refundedCents;
  return {
    confirm: live && manager && !fenced && b.status === 'PENDING' && (mode === 'PAY_AT_STORE' || fullySettled(b)),
    complete: live && manager && !fenced && b.status === 'CONFIRMED' && (fullySettled(b) || offlineFulfilmentAllowed(b)) && +new Date(b.endTime) <= +now,
    cancel: live && !fenced && ['PENDING', 'CONFIRMED'].includes(b.status) && net === 0,
    recordReceipt: live && manager && !fenced && mode === 'PAY_AT_STORE' && ['CONFIRMED', 'COMPLETED'].includes(b.status) && b.refundedCents === 0 && b.paidCents < b.totalCents,
    recordRefund: live && manager && !fenced && mode === 'PAY_AT_STORE' && ['CONFIRMED', 'COMPLETED'].includes(b.status) && net > 0,
  };
}
export function receiptInput(input: any, now = new Date()) {
  if (!OFFLINE_METHODS.includes(input.method)) throw new BadRequestException('Select an offline collection method');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 99999999) throw new BadRequestException('Amount must be positive integer cents');
  if (typeof input.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.occurredAt)) throw new BadRequestException('Use a UTC occurrence time');
  const date = new Date(input.occurredAt);
  if (!Number.isFinite(+date) || date.toISOString() !== input.occurredAt.replace(/Z$/, input.occurredAt.includes('.') ? 'Z' : '.000Z') || +date > +now + 300000 || +date < +now - 31 * 86400000) throw new BadRequestException('Occurrence time must be within the last 31 days and not in the future');
  return { amountCents: input.amountCents, method: input.method, occurredAt: date, reason: settlementReason(input.reason) };
}
export function settlementReason(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 500 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) throw new BadRequestException('Provide a reason of 5–500 characters');
  return value.trim();
}
export function settlementKey(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{8,80}$/.test(value)) throw new BadRequestException('A stable request key of 8–80 characters is required');
  return value;
}
