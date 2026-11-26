import type { ResourceId } from '../api/resources';
import type { ReservationConfig, ReservationFormKind, ReservationResource } from '../types/reservations';

interface Located { row: object; parentId?: ResourceId; }
function sameId(left: unknown, right: unknown) {
  return left != null && right != null && String(left) === String(right);
}
function locate(config: ReservationConfig, kind: ReservationFormKind, id: ResourceId): Located | undefined {
  if (kind === 'policy' || kind === 'schedule' || kind === 'rooms') {
    const rows = kind === 'policy' ? config.services : kind === 'schedule' ? config.therapists : config.rooms;
    const row = rows.find(item => sameId(item.id, id));
    return row && sameId(row.shopId, config.shopId) ? { row } : undefined;
  }
  if (kind === 'variants') {
    for (const parent of config.services) {
      const row = parent.variants.find(item => sameId(item.id, id));
      if (row && sameId(parent.shopId, config.shopId) && sameId(row.serviceId, parent.id)) return { row, parentId: parent.id };
    }
  } else if (kind === 'maintenance') {
    for (const parent of config.rooms) {
      const row = parent.maintenance.find(item => sameId(item.id, id));
      if (row && sameId(parent.shopId, config.shopId) && sameId(row.roomId, parent.id)) return { row, parentId: parent.id };
    }
  } else {
    for (const parent of config.therapists) {
      const rows = kind === 'shifts' ? parent.shifts : parent.timeOff;
      const row = rows.find(item => sameId(item.id, id));
      if (row && sameId(parent.shopId, config.shopId) && sameId(row.therapistId, parent.id)) return { row, parentId: parent.id };
    }
  }
}
function fieldsMatch(row: object, payload: Record<string, unknown>) {
  const saved = row as Record<string, unknown>;
  return Object.entries(payload).every(([key, expected]) => {
    const value = saved[key];
    if (key === 'serviceId' || key === 'therapistId' || key === 'roomId') return sameId(value, expected);
    if (key === 'startAtUtc' || key === 'endAtUtc') {
      return typeof value === 'string' && typeof expected === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) === Date.parse(expected);
    }
    return value === expected;
  });
}

/** A success receipt is insufficient when the fresh configuration still contains old terms. */
export function reservationSaveMatches(before: ReservationConfig, after: ReservationConfig, kind: ReservationFormKind, id: ResourceId, payload: Record<string, unknown>, creating: boolean) {
  if (!sameId(before.shopId, after.shopId)) return false;
  const previous = locate(before, kind, id), saved = locate(after, kind, id);
  if (!saved || (creating ? !!previous : !previous)) return false;
  if (saved.parentId != null) {
    const parentField = kind === 'variants' ? 'serviceId' : kind === 'maintenance' ? 'roomId' : 'therapistId';
    if (!sameId(saved.parentId, creating ? payload[parentField] : previous?.parentId)) return false;
  }
  return fieldsMatch(saved.row, payload);
}

export function reservationRemovalMatches(before: ReservationConfig, after: ReservationConfig, kind: ReservationResource, id: ResourceId) {
  if (!sameId(before.shopId, after.shopId) || !locate(before, kind, id)) return false;
  const saved = locate(after, kind, id);
  if (kind === 'time-off' || kind === 'maintenance') {
    // Absence must be checked across the whole shop, including an unexpectedly moved row.
    return !(kind === 'time-off' ? after.therapists.flatMap(row => row.timeOff) : after.rooms.flatMap(row => row.maintenance)).some(row => sameId(row.id, id));
  }
  const previous = locate(before, kind, id)!;
  return !!saved && (previous.parentId == null || sameId(saved.parentId, previous.parentId)) && (saved.row as { isActive?: unknown }).isActive === false;
}
