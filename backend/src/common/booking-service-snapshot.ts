import { itemDurationMeta } from './service-duration';

/** Catalog relations identify the service, but never redefine an existing order.
 * A PLAN's main service is its first segment, not the whole itinerary/package. */
export function historicalBookingService(booking: any, service = booking.service): any | null {
  if (!service) return null;
  const items = [...(booking.items ?? [])].sort((left: any, right: any) => left.participantIndex - right.participantIndex || left.sequence - right.sequence);
  const first = items[0];
  const duration = first ? itemDurationMeta(first) : { durationKind: 'TIMED' as const, reservedDurationMin: booking.durationMin };
  if (!first) return { ...service, priceCents: booking.priceCents, durationMin: duration.reservedDurationMin, ...duration };
  const plan = booking.reservationKind === 'PLAN';
  const packageItems = plan ? [first] : items;
  const basis = first.priceBasisSnapshot ?? 'PER_PERSON';
  const unitPrice = first.quotedUnitPriceCents ?? (basis === 'PER_BOOKING'
    ? packageItems.reduce((sum: number, item: any) => sum + item.priceCentsSnapshot, 0) : first.priceCentsSnapshot);
  return { ...service, name: first.serviceNameSnapshot ?? service.name, priceCents: unitPrice, priceBasis: basis,
    durationMin: duration.reservedDurationMin, ...duration, currency: first.currency ?? booking.currency,
    participantCount: plan ? 1 : booking.participantCountSnapshot ?? packageItems.length,
    // A special package uses at most two calendars. Older rows may repeat the
    // package's two-staff snapshot on both guest items; do not add it twice.
    requiredStaffCount: plan ? first.requiredStaffCountSnapshot ?? 1 : booking.requiredStaffCountSnapshot ?? Math.max(packageItems.length, ...packageItems.map((item: any) => item.requiredStaffCountSnapshot ?? 1)),
    staffBufferMin: first.staffBufferMin ?? 0, roomBufferMin: first.roomBufferMin ?? 0, requiredRoomType: first.roomTypeSnapshot ?? null };
}
