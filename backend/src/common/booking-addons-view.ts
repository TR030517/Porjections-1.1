import { ConflictException } from '@nestjs/common';

export interface BookingAddOnView {
  id: string; bookingItemId: string; sourceAddOnId: string;
  participantIndex: number; sequence: number; name: string;
  unitPriceCents: number; quantity: 1; lineTotalCents: number; currency: 'usd';
}
const valid = (value: unknown, max = 99_999_999): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const identity = (value: unknown): string | null => {
  const text = typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value : '';
  return /^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : null;
};
const bad = (): never => { throw new ConflictException('Reservation add-on snapshot needs review'); };

/** Read only immutable snapshots. Callers include Booking.addOns; optional main
 * items provide an additional coordinate/subtotal consistency check. */
export function bookingAddOnsView(booking: { id?: unknown; priceCents: number; addOns?: unknown[]; items?: unknown[] }) {
  if (!valid(booking.priceCents) || booking.addOns !== undefined && !Array.isArray(booking.addOns)) bad();
  const seen = new Set<string>(), rows = booking.addOns ?? [];
  if (rows.length > 120) bad();
  const addOns: BookingAddOnView[] = rows.map((value: any) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
    const id = identity(value.id), bookingItemId = identity(value.bookingItemId), sourceAddOnId = identity(value.sourceAddOnId);
    if (!id || !bookingItemId || !sourceAddOnId || booking.id !== undefined && identity(value.bookingId) !== identity(booking.id)
      || !Number.isInteger(value.participantIndex) || value.participantIndex < 1 || value.participantIndex > 6
      || !Number.isInteger(value.sequence) || value.sequence < 1 || value.sequence > 4
      || typeof value.nameSnapshot !== 'string' || !value.nameSnapshot.trim() || value.nameSnapshot.length > 100
      || /[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(value.nameSnapshot)
      || !valid(value.unitPriceCentsSnapshot, 10_000_000) || value.quantity !== 1
      || value.lineTotalCentsSnapshot !== value.unitPriceCentsSnapshot || value.currency !== 'usd') bad();
    const key = bookingItemId + ':' + sourceAddOnId;
    if (seen.has(key)) bad(); seen.add(key);
    if (booking.items) {
      const item: any = booking.items.find((item: any) => identity(item?.id) === bookingItemId);
      if (!item || item.participantIndex !== value.participantIndex || (item.sequence ?? 1) !== value.sequence
        || booking.id !== undefined && identity(item.bookingId) !== identity(booking.id)) bad();
    }
    return { id: id!, bookingItemId: bookingItemId!, sourceAddOnId: sourceAddOnId!, participantIndex: value.participantIndex,
      sequence: value.sequence, name: value.nameSnapshot, unitPriceCents: value.unitPriceCentsSnapshot,
      quantity: 1 as const, lineTotalCents: value.lineTotalCentsSnapshot, currency: 'usd' as const };
  }).sort((a, b) => a.participantIndex - b.participantIndex || a.sequence - b.sequence || (BigInt(a.sourceAddOnId) < BigInt(b.sourceAddOnId) ? -1 : 1));
  const addOnSubtotalCents = addOns.reduce((sum, row) => sum + row.lineTotalCents, 0);
  if (!valid(addOnSubtotalCents) || addOnSubtotalCents > booking.priceCents) bad();
  const mainSubtotalCents = booking.priceCents - addOnSubtotalCents;
  if (addOns.length && booking.items) {
    const main = booking.items.reduce<number>((sum, item: any) => {
      if (!valid(item?.priceCentsSnapshot)) bad(); return sum + item.priceCentsSnapshot;
    }, 0);
    if (main !== mainSubtotalCents) bad();
  }
  return { addOns, mainSubtotalCents, addOnSubtotalCents };
}
