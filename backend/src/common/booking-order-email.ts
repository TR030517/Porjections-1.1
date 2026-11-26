import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatPublicShopAddress } from './public-shop-address';
import { guestBookingContactFingerprint } from './booking-contact';

export const ORDER_EMAIL_TOPICS = ['BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'BOOKING_COMPLETED'] as const;
export type OrderEmailTopic = typeof ORDER_EMAIL_TOPICS[number];
export interface OrderEmailSnapshot {
  version: 1 | 2; bookingId: string; userId: string | null; bookingNo: string; topic: OrderEmailTopic;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'; shopName: string; address: string;
  timeZone: string; startAtUtc: string; endAtUtc: string; totalCents: number; currency: 'usd';
  items: Array<{ name: string; variant: string | null; participantIndex: number; sequence: number; durationMin: number; durationKind: 'TIMED' | 'PER_SESSION' | 'VARIABLE' }>;
  addOns: Array<{ name: string; participantIndex: number; sequence: number; unitPriceCents: number; quantity: number; lineTotalCents: number }>;
  /** Paired references only. The recorded customer's contact fields never enter the outbox. */
  contactVersion?: 1; customerRecipientFingerprint?: string;
  /** Version 2 is a store-only, accountless guest event. Never a mail authorization. */
  guestContactFingerprint?: string;
}
const id = (value: unknown) => /^(?:[1-9]\d{0,18})$/.test(String(value)) && BigInt(String(value)) <= 9223372036854775807n;
const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(value) ? value.trim() : null;
export function customerOrderEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 255 || /[\s\u0000-\u001f\u007f]/u.test(value)) return null;
  const parts = value.split('@'); if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[A-Za-z0-9._+-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every(label => label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)) ? value : null;
}
/** The active verified account authorizes a new booking's saved recipient.
 * Never accept an arbitrary order-level `to` or silently update old tasks. */
export async function requireCustomerOrderEmail(tx: any, userId: string | bigint): Promise<{ userId: string; email: string }> {
  if (!id(userId)) throw new BadRequestException({ code: 'ORDER_EMAIL_REQUIRED', message: 'Add a valid email to your customer account before placing an order.', fields: { email: 'A customer account email is required.' } });
  const user = await tx.user.findUnique({ where: { id: BigInt(userId) }, select: { id: true, email: true, emailVerifiedAt: true, role: true, status: true, deletedAt: true } });
  const email = customerOrderEmail(user?.email);
  if (!user || String(user.id) !== String(userId) || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE' || user.deletedAt || !email) {
    throw new BadRequestException({ code: 'ORDER_EMAIL_REQUIRED', message: 'Add a valid email to your customer account before placing an order.', fields: { email: 'A valid email on your active customer account is required.' } });
  }
  if (!user.emailVerifiedAt) throw new BadRequestException({ code: 'ORDER_EMAIL_VERIFICATION_REQUIRED', message: 'Verify your customer account email before placing an order.', fields: { email: 'Verify that you can receive mail at this address.' } });
  return { userId: String(user.id), email };
}

const keys = (value: object, allowed: readonly string[]) => Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
export function readOrderEmailSnapshot(raw: unknown): OrderEmailSnapshot | null {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as OrderEmailSnapshot;
  const fields = ['version','bookingId','userId','bookingNo','topic','status','shopName','address','timeZone','startAtUtc','endAtUtc','totalCents','currency','items','addOns'];
  const guest = value.version === 2;
  const hasContact = Object.prototype.hasOwnProperty.call(value, 'contactVersion') || Object.prototype.hasOwnProperty.call(value, 'customerRecipientFingerprint');
  if (guest ? value.userId !== null || value.contactVersion !== 1 || typeof value.guestContactFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.guestContactFingerprint)
    : hasContact && (value.contactVersion !== 1 || typeof value.customerRecipientFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.customerRecipientFingerprint))) return null;
  if (!keys(value, guest ? [...fields, 'contactVersion', 'guestContactFingerprint'] : hasContact ? [...fields, 'contactVersion', 'customerRecipientFingerprint'] : fields)
    || ![1, 2].includes(value.version) || !id(value.bookingId) || (!guest && !id(value.userId)) || !text(value.bookingNo, 30) || !ORDER_EMAIL_TOPICS.includes(value.topic)
    || !['PENDING','CONFIRMED','CANCELLED','COMPLETED'].includes(value.status) || !text(value.shopName, 200) || !text(value.address, 800)
    || !text(value.timeZone, 80) || !Number.isSafeInteger(value.totalCents) || value.totalCents < 0 || value.totalCents > 999999999 || value.currency !== 'usd'
    || !Array.isArray(value.items) || !value.items.length || value.items.length > 12 || !Array.isArray(value.addOns) || value.addOns.length > 120) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone }).format(); } catch { return null; }
  const date = (v: string) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  if (!date(value.startAtUtc) || !date(value.endAtUtc) || Date.parse(value.endAtUtc) <= Date.parse(value.startAtUtc)) return null;
  if (value.items.some(item => !item || typeof item !== 'object' || !keys(item, ['name','variant','participantIndex','sequence','durationMin','durationKind']) || !text(item.name, 200)
    || item.variant !== null && !text(item.variant, 100) || !Number.isInteger(item.participantIndex) || item.participantIndex < 1 || item.participantIndex > 6
    || !Number.isInteger(item.sequence) || item.sequence < 1 || item.sequence > 4 || !Number.isInteger(item.durationMin) || item.durationMin < 1 || item.durationMin > 480 || !['TIMED','PER_SESSION','VARIABLE'].includes(item.durationKind))) return null;
  const coordinates = new Set(value.items.map(item => item.participantIndex + ':' + item.sequence));
  if (coordinates.size !== value.items.length || value.addOns.some(item => !item || typeof item !== 'object' || !keys(item, ['name','participantIndex','sequence','unitPriceCents','quantity','lineTotalCents']) || !text(item.name,100)
    || !coordinates.has(item.participantIndex + ':' + item.sequence) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100
    || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 || item.unitPriceCents > 10000000 || !Number.isSafeInteger(item.lineTotalCents) || item.lineTotalCents !== item.unitPriceCents * item.quantity)) return null;
  const expected = value.topic === 'BOOKING_CREATED' ? 'PENDING' : value.topic === 'BOOKING_CONFIRMED' ? 'CONFIRMED' : value.topic === 'BOOKING_CANCELLED' ? 'CANCELLED' : value.topic === 'BOOKING_COMPLETED' ? 'COMPLETED' : null;
  if (expected && value.status !== expected || value.topic === 'BOOKING_RESCHEDULED' && !['PENDING','CONFIRMED'].includes(value.status)) return null;
  return value;
}

export function bookingOrderEmailSnapshot(booking: any, topic: OrderEmailTopic): OrderEmailSnapshot | null {
  const address = formatPublicShopAddress(booking?.shop?.address, booking?.shop?.city, booking?.shop?.state, booking?.shop?.zipCode) || 'Contact the store for its address';
  const guest = booking?.userId == null && booking?.bookingSource === 'ASSISTED_GUEST';
  const value = { version: guest ? 2 : 1, bookingId: String(booking?.id), userId: guest ? null : String(booking?.userId), bookingNo: booking?.bookingNo, topic,
    ...(guest ? { contactVersion: 1, guestContactFingerprint: guestBookingContactFingerprint(booking) } : {}),
    status: booking?.status, shopName: booking?.shop?.nameEn?.trim() || booking?.shop?.name, address,
    timeZone: booking?.bookingTimezone || booking?.shop?.timezone, startAtUtc: booking?.startTime instanceof Date ? booking.startTime.toISOString() : booking?.startTime,
    endAtUtc: booking?.endTime instanceof Date ? booking.endTime.toISOString() : booking?.endTime, totalCents: booking?.totalCents, currency: booking?.currency,
    items: (booking?.items ?? []).map((item: any) => ({ name: item.serviceNameSnapshot, variant: item.variantNameSnapshot ?? null,
      participantIndex: item.participantIndex, sequence: item.sequence, durationMin: item.durationMin, durationKind: item.durationKindSnapshot ?? 'TIMED' })),
    addOns: (booking?.addOns ?? []).map((item: any) => ({ name: item.nameSnapshot, participantIndex: item.participantIndex, sequence: item.sequence,
      unitPriceCents: item.unitPriceCentsSnapshot, quantity: item.quantity, lineTotalCents: item.lineTotalCentsSnapshot })) };
  return readOrderEmailSnapshot(value);
}

/** Read the order and recorded-contact scalars together; only the validated event
 * projection and non-PII contact reference are persisted in the outbox. */
export const ORDER_EMAIL_BOOKING_SELECT = {
  id: true, userId: true, bookingSource: true, shopId: true, bookingNo: true, status: true, deletedAt: true, startTime: true, endTime: true,
  bookingTimezone: true, totalCents: true, currency: true,
  contactName: true, contactPhone: true, contactEmail: true, contactVersion: true, contactSource: true, contactEmailVerifiedAt: true,
  shop: { select: { name: true, nameEn: true, address: true, city: true, state: true, zipCode: true, timezone: true, studioProfile: true,
    orderEmailSetting: { select: { enabled: true, recipientEmail: true, recipientVerifiedAt: true } } } },
  items: { orderBy: [{ participantIndex: 'asc' as const }, { sequence: 'asc' as const }], select: { serviceNameSnapshot: true, variantNameSnapshot: true, participantIndex: true, sequence: true, durationMin: true, durationKindSnapshot: true } },
  addOns: { orderBy: [{ participantIndex: 'asc' as const }, { sequence: 'asc' as const }, { id: 'asc' as const }], select: { nameSnapshot: true, participantIndex: true, sequence: true, unitPriceCentsSnapshot: true, quantity: true, lineTotalCentsSnapshot: true } },
} satisfies Prisma.BookingSelect;

export function orderEmailEventCurrent(snapshot: OrderEmailSnapshot, booking: any): boolean {
  return !!booking && !booking.deletedAt && String(booking.id) === snapshot.bookingId
    && (snapshot.version === 2 ? booking.userId === null && booking.bookingSource === 'ASSISTED_GUEST' : String(booking.userId) === snapshot.userId)
    && booking.status === snapshot.status && booking.startTime instanceof Date && booking.startTime.toISOString() === snapshot.startAtUtc
    && booking.endTime instanceof Date && booking.endTime.toISOString() === snapshot.endAtUtc;
}

export interface OrderEmailStoreContact { phone?: unknown; email?: unknown }
/** Plain text is intentional: store strings can never become executable HTML or header fields. */
export function renderBookingOrderEmail(snapshot: OrderEmailSnapshot, storeContact?: OrderEmailStoreContact): { subject: string; text: string } {
  if (!readOrderEmailSnapshot(snapshot)) throw Error('ORDER_EMAIL_SNAPSHOT_INVALID');
  const action: Record<OrderEmailTopic, string> = { BOOKING_CREATED: 'Order received', BOOKING_CONFIRMED: 'Appointment confirmed', BOOKING_RESCHEDULED: 'Appointment updated', BOOKING_CANCELLED: 'Order cancelled', BOOKING_COMPLETED: 'Visit completed' };
  const format = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: snapshot.timeZone, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(new Date(date));
  const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  const phone = text(storeContact?.phone, 30), email = customerOrderEmail(storeContact?.email);
  const lines = [action[snapshot.topic], '', 'Order number: ' + snapshot.bookingNo, 'Store: ' + snapshot.shopName, 'Address: ' + snapshot.address,
    'Store phone: ' + (phone ?? 'Not provided; use the store page for contact details.'), 'Store email: ' + (email ?? 'Not provided; use the store page for contact details.'),
    'Store-local start: ' + format(snapshot.startAtUtc), 'Store-local end: ' + format(snapshot.endAtUtc), 'Time zone: ' + snapshot.timeZone,
    'Status: ' + snapshot.status, '', 'Services:', ...snapshot.items.map(item => `- Guest ${item.participantIndex}, step ${item.sequence}: ${item.name}${item.variant ? ' — ' + item.variant : ''} (${item.durationKind === 'TIMED' ? item.durationMin + ' min' : (item.durationKind === 'PER_SESSION' ? 'Per session' : 'Duration varies') + '; reserved block ' + item.durationMin + ' min'})`),
    ...(snapshot.addOns.length ? ['', 'Add-ons (no additional appointment time):', ...snapshot.addOns.map(item => `- Guest ${item.participantIndex}, step ${item.sequence}: ${item.name} — ${money(item.unitPriceCents)} × ${item.quantity} = ${money(item.lineTotalCents)}`)] : []),
    '', 'Whole-order total: ' + money(snapshot.totalCents), '', 'The store handles this order and any payment or changes offline. This email is an order update, not a payment receipt.',
    snapshot.status === 'PENDING' ? 'Your booking request has been received and is awaiting store confirmation. Your appointment is not confirmed yet. Contact the store for confirmation or assistance.' : 'Contact the store directly if you need assistance.',
    'Please use the latest order status and store-local time shown in your account.'];
  return { subject: 'Massajoy — ' + action[snapshot.topic] + ' — ' + snapshot.bookingNo, text: lines.join('\n') };
}
