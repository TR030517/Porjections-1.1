/** Safe manager-only reception data supplied by the authorized booking detail. */
export interface BookingReception {
  customer: { name: string | null; phone: string | null } | null;
  therapists: Array<{ id: string; name: string | null }>;
  rooms: Array<{ id: string; name: string | null }>;
}

export interface BookingResourceLabel { id: string; name: string | null; label: string }
export interface BookingReceptionResources { therapists: BookingResourceLabel[]; room: BookingResourceLabel | null }

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const identifier = (value: unknown): string | null => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n ? value : null;
const ordinal = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

/** A present service segment must never borrow a renamed live catalog title. */
export function bookingItemServiceLabel(value: unknown): string {
  const item = object(value), name = text(item.serviceNameSnapshot) ?? '历史项目名称未记录', variant = text(item.variantNameSnapshot);
  return variant ? `${name} · ${variant}` : name;
}

/** Preserve every participant/segment, including repeated services for a couple. */
export function bookingServiceSummary(value: unknown): string {
  const booking = object(value);
  if (Array.isArray(booking.items) && booking.items.length) {
    const items = booking.items.map((item, index) => ({ item, index, participant: ordinal(object(item).participantIndex), sequence: ordinal(object(item).sequence) }));
    items.sort((a, b) => (a.participant ?? Infinity) - (b.participant ?? Infinity) || (a.sequence ?? Infinity) - (b.sequence ?? Infinity) || a.index - b.index);
    return items.map(({ item, participant, sequence }) => items.length === 1 ? bookingItemServiceLabel(item)
      : `顾客 ${participant ?? '未记录'} · 第 ${sequence ?? '未记录'} 段：${bookingItemServiceLabel(item)}`).join('；');
  }
  if (booking.items !== undefined && !Array.isArray(booking.items)) return '历史项目名称未记录';
  // Empty/missing items are genuinely legacy records. This fallback is not used
  // for an incomplete snapshot, even when the current service is still present.
  return text(typeof booking.service === 'string' ? booking.service : object(booking.service).name) ?? text(booking.serviceName) ?? '历史项目名称未记录';
}

function resource(id: string, rows: unknown): BookingResourceLabel {
  const matches = Array.isArray(rows) ? rows.filter(row => object(row).id === id) : [];
  // Ambiguous duplicate rows must not choose an arbitrary person's name.
  const name = matches.length === 1 ? text(object(matches[0]).name) : null;
  return { id, name, label: name ? `${name} (#${id})` : `#${id}` };
}

/** Only actual assignments select names; extra lookup rows never add resources. */
export function bookingItemResources(value: unknown, reception?: unknown): BookingReceptionResources {
  const item = object(value), names = object(reception);
  const rawIds = item.assignedTherapistIds;
  const fallback = identifier(item.assignedTherapistId) ?? identifier(item.therapistId);
  // An explicit array, including [], is authoritative. Malformed explicit data
  // also stays empty instead of reviving a stale singular assignment.
  const ids = rawIds === undefined ? (fallback ? [fallback] : []) : Array.isArray(rawIds) ? rawIds.flatMap(value => identifier(value) ? [value as string] : []) : [];
  const roomId = identifier(item.assignedRoomId);
  return { therapists: [...new Set(ids)].map(id => resource(id, names.therapists)), room: roomId ? resource(roomId, names.rooms) : null };
}

/** Legacy bookings have no segment resource assignments; use their saved ID. */
export function bookingLegacyResources(value: unknown): BookingReceptionResources {
  const booking = object(value);
  if (Array.isArray(booking.items) && booking.items.length) return { therapists: [], room: null };
  return bookingItemResources({ therapistId: booking.therapistId }, booking.reception);
}

export function bookingReceptionCustomer(value: unknown): { name: string; phone: string | null; phoneHref: string | null } {
  const customer = object(object(value).customer), phone = text(customer.phone);
  const normalized = phone?.replace(/[ ()-]/g, '') ?? '';
  // Keep authored contact text visible/copyable; only unambiguous numbers dial.
  const phoneHref = phone && /^\+?[0-9 -]*(?:\([0-9]{2,6}\)[0-9 -]*)?$/.test(phone) && /^\+?[0-9]{7,15}$/.test(normalized) ? `tel:${normalized}` : null;
  return { name: text(customer.name) ?? '顾客姓名未提供', phone, phoneHref };
}
