import { BadRequestException, ConflictException } from '@nestjs/common';
import { customerOrderEmail } from './booking-order-email';
import { createHash } from 'node:crypto';

export interface BookingContactInput { name: string; phone: string; email: string }
export interface GuestBookingContactInput { name: string; phone: string; email: string | null }
export interface VerifiedBookingContact {
  contactName: string; contactPhone: string; contactEmail: string;
  contactVersion: 1; contactSource: 'ONLINE_VERIFIED'; contactEmailVerifiedAt: Date;
}
type ContactFields = Partial<Record<'contact' | keyof BookingContactInput, string>>;
const controls = /[\p{Cc}\p{Cs}]/u;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
/** A partial or damaged new snapshot must never downgrade to live-account policy. */
export function hasBookingContactSnapshot(booking: unknown): boolean {
  return isRecord(booking) && ['contactName', 'contactPhone', 'contactEmail', 'contactVersion', 'contactSource', 'contactEmailVerifiedAt']
    .some(key => booking[key] != null);
}
function invalid(fields: ContactFields): never {
  throw new BadRequestException({ code: 'BOOKING_CONTACT_INVALID', message: 'Check the booking contact details.', fields });
}

/** Normalize the command before hashing or persistence. No input is copied to
 * errors, and this function never updates the account or accepts verification. */
function normalizeContact(raw: unknown, guest: boolean): GuestBookingContactInput {
  if (!isRecord(raw) || Object.keys(raw).some(key => !['name', 'phone', 'email'].includes(key))) {
    return invalid({ contact: 'Provide a name, international phone number and email.' });
  }
  const fields: ContactFields = {};
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || Array.from(name).length > 100 || controls.test(typeof raw.name === 'string' ? raw.name : '')) fields.name = 'Enter a name of 1 to 100 characters without control characters.';
  const originalPhone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
  const phone = originalPhone.replace(/[ ()-]/g, '');
  if (!/^\+[0-9 ()-]+$/.test(originalPhone) || !/^\+[1-9][0-9]{6,14}$/.test(phone) || typeof raw.phone !== 'string' || controls.test(raw.phone)) {
    fields.phone = 'Enter an international phone number beginning with + and 7 to 15 digits.';
  }
  const originalEmail = typeof raw.email === 'string' ? raw.email.trim() : '';
  const email = customerOrderEmail(originalEmail)?.toLowerCase() ?? null;
  if (!(guest && (raw.email == null || raw.email === '')) && (!email || typeof raw.email !== 'string' || controls.test(raw.email))) fields.email = 'Enter a valid email address.';
  if (Object.keys(fields).length) return invalid(fields);
  return { name, phone, email };
}
export function normalizeBookingContact(raw: unknown): BookingContactInput {
  return normalizeContact(raw, false) as BookingContactInput;
}
/** Merchant-entered details are a snapshot, never proof of account ownership or
 * permission to send mail. Empty email does not prevent an offline order. */
export function normalizeGuestBookingContact(raw: unknown): GuestBookingContactInput {
  return normalizeContact(raw, true);
}
export function guestBookingContactSnapshot(raw: unknown) {
  const contact = normalizeGuestBookingContact(raw);
  return { contactName: contact.name, contactPhone: contact.phone, contactEmail: contact.email,
    contactVersion: 1 as const, contactSource: 'GUEST_ASSISTED' as const, contactEmailVerifiedAt: null };
}

/** The account's current verified address authorizes this one snapshot. The
 * caller must read/lock that user inside its booking transaction. */
export function requireVerifiedBookingContact(raw: unknown, user: unknown): VerifiedBookingContact {
  const contact = normalizeBookingContact(raw);
  const email = isRecord(user) ? customerOrderEmail(user.email)?.toLowerCase() : null;
  if (!isRecord(user) || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE' || user.deletedAt != null
    || !validDate(user.emailVerifiedAt) || !email || email !== contact.email) {
    throw new ConflictException({ code: 'BOOKING_CONTACT_EMAIL_CHANGED', message: 'Your verified email or account changed. Review your booking contact before submitting again.', fields: { email: 'Use the current verified email on your customer account.' } });
  }
  return { contactName: contact.name, contactPhone: contact.phone, contactEmail: contact.email,
    contactVersion: 1, contactSource: 'ONLINE_VERIFIED', contactEmailVerifiedAt: new Date(user.emailVerifiedAt.getTime()) };
}

const historical = () => ({ version: null, recorded: false, label: 'Historical booking has no recorded contact' } as const);
export type BookingContactView = ReturnType<typeof historical> | {
  version: 1; recorded: true; name: string; phone: string; email: string;
  source: 'ONLINE_VERIFIED'; emailVerifiedAt: string;
} | {
  version: 1; recorded: true; name: string; phone: string; email: string | null;
  source: 'GUEST_ASSISTED'; emailVerifiedAt: null;
};
/** A projection of stored fields only. Never read or use a live User fallback. */
export function bookingContactView(booking: unknown): BookingContactView {
  if (isRecord(booking) && booking.contactVersion === 1 && booking.contactSource === 'GUEST_ASSISTED'
    && booking.contactEmailVerifiedAt == null) {
    let contact: GuestBookingContactInput;
    try { contact = normalizeGuestBookingContact({ name: booking.contactName, phone: booking.contactPhone, email: booking.contactEmail }); }
    catch { return historical(); }
    if (contact.name !== booking.contactName || contact.phone !== booking.contactPhone || contact.email !== booking.contactEmail) return historical();
    return { version: 1, recorded: true, ...contact, source: 'GUEST_ASSISTED', emailVerifiedAt: null };
  }
  if (!isRecord(booking) || booking.contactVersion !== 1 || booking.contactSource !== 'ONLINE_VERIFIED' || !validDate(booking.contactEmailVerifiedAt)) return historical();
  let contact: BookingContactInput;
  try { contact = normalizeBookingContact({ name: booking.contactName, phone: booking.contactPhone, email: booking.contactEmail }); }
  catch { return historical(); }
  if (contact.name !== booking.contactName || contact.phone !== booking.contactPhone || contact.email !== booking.contactEmail) return historical();
  return { version: 1, recorded: true, ...contact, source: 'ONLINE_VERIFIED', emailVerifiedAt: booking.contactEmailVerifiedAt.toISOString() };
}
/** Private snapshot stays in bookings; outbox contains only this integrity reference. */
export function guestBookingContactFingerprint(booking: unknown): string | null {
  const contact = bookingContactView(booking);
  return contact.recorded && contact.source === 'GUEST_ASSISTED'
    ? createHash('sha256').update(JSON.stringify({ name: contact.name, phone: contact.phone, email: contact.email })).digest('hex') : null;
}
