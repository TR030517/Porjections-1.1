import { ConflictException } from '@nestjs/common';
import { storedBookingServiceWindows } from '../../common/booking-service-windows';
import { isShopClosedDuring, readShopBookingSettings } from '../../common/shop-booking-settings';
import { effectiveBookingWhere, resourceBookingWhere } from './configuration-guard';
import { CalendarBlockScope } from './calendar-actions.dto';

export interface CalendarBlockWindow { startAtUtc: Date; endAtUtc: Date; }
const overlaps = (a: Date, b: Date, window: CalendarBlockWindow) => a < window.endAtUtc && b > window.startAtUtc;
const buffer = (value: unknown): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 120 ? value : 120;

/** Assignments/locks are authoritative. Unknown legacy assignments remain
 * conservative; no customer account/contact fields are read for configuration. */
export function calendarBookingConflicts(booking: any, scope: CalendarBlockScope, resourceId: bigint | null, window: CalendarBlockWindow): boolean {
  const items = Array.isArray(booking.items) ? booking.items : [];
  if (scope === 'SHOP' && storedBookingServiceWindows(booking).some(row => overlaps(row.startTime, row.endTime, window))) return true;
  if (!items.length) {
    if (scope === 'THERAPIST' && booking.therapistId != null && String(booking.therapistId) !== String(resourceId)
      && (booking.requiredStaffCountSnapshot ?? 1) <= 1 && (booking.participantCountSnapshot ?? 1) <= 1) return false;
    return overlaps(booking.startTime, new Date(+booking.endTime + 120 * 60000), window);
  }
  for (const item of items) {
    const start = item.startAtUtc, end = item.endAtUtc;
    // Malformed old itineraries fail closed across their saved booking window.
    if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) {
      if (overlaps(booking.startTime, new Date(+booking.endTime + 120 * 60000), window)) return true;
      continue;
    }
    if (scope === 'SHOP') {
      const cleanup = Math.max(buffer(item.staffBufferMin), item.roomTypeSnapshot != null || item.assignedRoomId != null ? buffer(item.roomBufferMin) : 0);
      if (overlaps(start, new Date(+end + cleanup * 60000), window)) return true;
    } else if (scope === 'THERAPIST') {
      const assigned = (booking.resourceLocks ?? []).filter((lock: any) => lock.resourceType === 'THERAPIST' && String(lock.bookingItemId) === String(item.id));
      const complete = new Set(assigned.map((lock: any) => String(lock.resourceId))).size >= (item.requiredStaffCountSnapshot ?? 1);
      const matches = complete ? assigned.some((lock: any) => String(lock.resourceId) === String(resourceId))
        : item.assignedTherapistId == null || String(item.assignedTherapistId) === String(resourceId) || item.requiredStaffCountSnapshot > 1;
      if (matches
        && overlaps(start, new Date(+end + buffer(item.staffBufferMin) * 60000), window)) return true;
    } else if ((item.assignedRoomId != null ? String(item.assignedRoomId) === String(resourceId) : item.roomTypeSnapshot != null)
      && overlaps(start, new Date(+end + buffer(item.roomBufferMin) * 60000), window)) return true;
  }
  return false;
}

export async function ensureCalendarBlockAvailable(tx: any, shop: any, scope: CalendarBlockScope, resourceId: bigint | null,
  window: CalendarBlockWindow, previous?: any, allowClosed = false) {
  const conflict = () => { throw new ConflictException('所选区间与已有预约或占用冲突，请先处理已有安排'); };
  if (!allowClosed && isShopClosedDuring(readShopBookingSettings(shop.studioProfile), window.startAtUtc, window.endAtUtc, shop.timezone)) conflict();
  const interval = { startAtUtc: { lt: window.endAtUtc }, endAtUtc: { gt: window.startAtUtc } };
  const block = await tx.shopCalendarBlock.findFirst({ where: { shopId: shop.id, status: 'ACTIVE', ...interval,
    ...(previous ? { id: { not: previous.id } } : {}),
    ...(scope === 'SHOP' ? {} : { OR: [{ scope: 'SHOP' }, { scope, resourceId }] }) }, select: { id: true } });
  if (block) conflict();
  if (scope === 'SHOP' || scope === 'THERAPIST') {
    const leave = await tx.therapistTimeOff.findFirst({ where: { ...interval, therapist: { shopId: shop.id },
      ...(scope === 'THERAPIST' ? { therapistId: resourceId } : {}), ...(previous?.timeOffId ? { id: { not: previous.timeOffId } } : {}) }, select: { id: true } });
    if (leave) conflict();
  }
  if (scope === 'SHOP' || scope === 'ROOM') {
    const maintenance = await tx.roomMaintenance.findFirst({ where: { ...interval, room: { shopId: shop.id },
      ...(scope === 'ROOM' ? { roomId: resourceId } : {}), ...(previous?.maintenanceId ? { id: { not: previous.maintenanceId } } : {}) }, select: { id: true } });
    if (maintenance) conflict();
  }
  const now = new Date();
  const lock = await tx.bookingResourceLock.findFirst({ where: { shopId: shop.id, status: 'ACTIVE', ...interval, booking: resourceBookingWhere(now),
    ...(scope === 'SHOP' ? {} : { resourceType: scope, resourceId }) }, select: { id: true } });
  if (lock) conflict();
  const bookings = await tx.booking.findMany({ where: { shopId: shop.id, ...effectiveBookingWhere(now),
    startTime: { lt: window.endAtUtc }, endTime: { gt: new Date(+window.startAtUtc - 120 * 60000) } }, select: {
    id: true, reservationKind: true, participantCountSnapshot: true, durationMin: true, therapistId: true, startTime: true, endTime: true,
    resourceLocks: { where: { status: 'ACTIVE' }, select: { bookingItemId: true, resourceType: true, resourceId: true } },
    items: { select: { id: true, bookingId: true, participantIndex: true, sequence: true, offsetMin: true, requiredStaffCountSnapshot: true,
      durationMin: true, staffBufferMin: true, roomBufferMin: true, roomTypeSnapshot: true, startAtUtc: true, endAtUtc: true,
      assignedTherapistId: true, assignedRoomId: true } } } });
  if (bookings.some((booking: any) => calendarBookingConflicts(booking, scope, resourceId, window))) conflict();
}
