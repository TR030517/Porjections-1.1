import { bookingContactView, hasBookingContactSnapshot } from './booking-contact';

export interface BookingReception {
  customer: { name: string | null; phone: string | null } | null;
  therapists: Array<{ id: string; name: string | null }>;
  rooms: Array<{ id: string; name: string | null }>;
}
const identity = (value: unknown): string | null => {
  const text = typeof value === 'bigint' ? String(value) : typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  return /^[1-9]\d{0,18}$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : null;
};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const instant = (value: unknown) => { const result = new Date(value as any).getTime(); return Number.isFinite(result) ? result : null; };

/** Stored assignment is authoritative, including for cancelled and historical bookings.
 * Legacy missing room IDs may use only the current item's exact occupation window. */
export function bookingItemRoomId(booking: any, item: any): string | null {
  const stored = identity(item.assignedRoomId);
  if (stored) return stored;
  const start = instant(item.startAtUtc), end = instant(item.endAtUtc), buffer = item.roomBufferMin ?? 0;
  if (start === null || end === null || !Number.isInteger(buffer) || buffer < 0) return null;
  const matching = (booking.resourceLocks ?? []).filter((lock: any) => lock.resourceType === 'ROOM'
    && identity(lock.bookingId) === identity(booking.id) && identity(lock.shopId) === identity(booking.shopId)
    && (lock.bookingItemId == null || identity(lock.bookingItemId) === identity(item.id))
    && instant(lock.startAtUtc) === start && instant(lock.endAtUtc) === end + buffer * 60000
    && ['ACTIVE', 'RELEASED'].includes(lock.status) && identity(lock.resourceId));
  const active = matching.filter((lock: any) => lock.status === 'ACTIVE');
  let candidates = active.length ? active : matching;
  const parallelPlanItem = booking.reservationKind === 'PLAN' && (booking.items ?? []).some((other: any) => identity(other.id) !== identity(item.id)
    && instant(other.startAtUtc) === start && instant(other.endAtUtc) !== null
    && instant(other.endAtUtc)! + (other.roomBufferMin ?? 0) * 60000 === end + buffer * 60000);
  if (parallelPlanItem) {
    // Shared null-item locks cannot distinguish simultaneous PLAN segments.
    candidates = candidates.filter((lock: any) => identity(lock.bookingItemId) === identity(item.id));
  }
  const latest = [...candidates].sort((left: any, right: any) => {
    const time = (instant(right.createdAt) ?? 0) - (instant(left.createdAt) ?? 0);
    if (time) return time;
    const a = BigInt(identity(left.id) ?? '0'), b = BigInt(identity(right.id) ?? '0');
    return a === b ? 0 : a < b ? 1 : -1;
  })[0];
  return latest ? identity(latest.resourceId) : null;
}

/** Call only after the booking's existing manager BOOKINGS_READ authorization.
 * IDs come from the actual serialized assignments, never live service requirements.
 * Inactive historical resources remain readable; inactive/deleted/non-customer contacts do not. */
export async function bookingReception(db: any, booking: any, serialized: any): Promise<BookingReception> {
  const contact = bookingContactView(booking);
  const staffIds = new Set<string>(), roomIds = new Set<string>();
  const items = serialized.items ?? [];
  for (const item of items) {
    for (const value of Array.isArray(item.assignedTherapistIds) ? item.assignedTherapistIds : []) {
      const id = identity(value); if (id) staffIds.add(id);
    }
    const room = identity(item.assignedRoomId); if (room) roomIds.add(room);
  }
  if (!items.length) {
    const legacy = identity(serialized.therapistId); if (legacy) staffIds.add(legacy);
  }
  const [customer, therapists, rooms] = await Promise.all([
    contact.recorded ? { name: contact.name, phone: contact.phone }
      : booking.userId != null && !hasBookingContactSnapshot(booking) ? db.user.findFirst({ where: { id: booking.userId, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null }, select: { name: true, phone: true } }) : null,
    staffIds.size ? db.therapist.findMany({ where: { shopId: booking.shopId, id: { in: [...staffIds].map(id => BigInt(id)) } }, select: { id: true, name: true } }) : [],
    roomIds.size ? db.shopRoom.findMany({ where: { shopId: booking.shopId, id: { in: [...roomIds].map(id => BigInt(id)) } }, select: { id: true, name: true } }) : [],
  ]);
  const staffNames = new Map<string, string | null>(therapists.map((row: any) => [String(row.id), text(row.name)]));
  const roomNames = new Map<string, string | null>(rooms.map((row: any) => [String(row.id), text(row.name)]));
  return { customer: customer ? { name: text(customer.name), phone: text(customer.phone) } : null,
    therapists: [...staffIds].map(id => ({ id, name: staffNames.get(id) ?? null })), rooms: [...roomIds].map(id => ({ id, name: roomNames.get(id) ?? null })) };
}
