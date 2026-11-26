import { createHash } from 'node:crypto';
import { customerOrderEmail, readOrderEmailSnapshot, renderBookingOrderEmail, type OrderEmailSnapshot, type OrderEmailStoreContact } from './booking-order-email';
import { publicShopProfile } from './shop-public-profile';

export interface ShopOrderEmailEnvelope {
  version: 1 | 2; audience: 'SHOP'; shopId: string; recipientFingerprint: string | null; snapshot: OrderEmailSnapshot | null;
}
function record(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}
export function orderEmailAudience(raw: unknown): 'SHOP' | 'CUSTOMER' {
  return record(raw)?.audience === 'SHOP' ? 'SHOP' : 'CUSTOMER';
}
/** Only the store's configured contact list is a notification destination. */
export function shopOrderEmailRecipient(profile: unknown): string | null {
  const emails = record(profile)?.emails;
  if (!Array.isArray(emails)) return null;
  for (const value of emails.slice(0, 5)) {
    const email = customerOrderEmail(typeof value === 'string' ? value.trim() : value);
    if (email) return email;
  }
  return null;
}
/** Customer mail exposes the same public contact fields as the store page.
 * In particular an explicitly cleared phone list never resurrects a legacy phone. */
export function orderEmailPublicStoreContact(shop: unknown): OrderEmailStoreContact {
  const profile = publicShopProfile(shop, [], { includePriceMenu: false, includeBookingCalendar: false });
  return { phone: profile.phones.map(value => contactText(value, 30)).find(Boolean) ?? null,
    email: profile.emails.map(customerOrderEmail).find(Boolean) ?? null };
}
export function orderEmailRecipientFingerprint(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
export function shopOrderEmailEventKey(eventKey: string): string {
  const suffixed = eventKey + ':shop';
  return suffixed.length <= 160 ? suffixed : eventKey.slice(0, 89) + ':' + createHash('sha256').update(eventKey).digest('hex') + ':shop';
}
export function readShopOrderEmailEnvelope(raw: unknown): ShopOrderEmailEnvelope | null {
  const value = record(raw);
  if (!value || Object.keys(value).length !== 5 || !['version','audience','shopId','recipientFingerprint','snapshot'].every(key => key in value)
    || ![1, 2].includes(value.version as number) || value.audience !== 'SHOP' || typeof value.shopId !== 'string' || !/^[1-9]\d{0,18}$/.test(value.shopId)
    || BigInt(value.shopId) > 9223372036854775807n || value.recipientFingerprint !== null && (typeof value.recipientFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.recipientFingerprint))
    || value.snapshot !== null && !readOrderEmailSnapshot(value.snapshot)) return null;
  return value as unknown as ShopOrderEmailEnvelope;
}
/** Historical v1 fixture/reader compatibility only. New events use the verified v2 envelope. */
export function shopOrderEmailEnvelope(shopId: string | bigint, profile: unknown, snapshot: OrderEmailSnapshot | null): ShopOrderEmailEnvelope {
  const recipient = shopOrderEmailRecipient(profile);
  return { version: 1, audience: 'SHOP', shopId: String(shopId), recipientFingerprint: recipient ? orderEmailRecipientFingerprint(recipient) : null, snapshot };
}
function contactText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && Array.from(value).length <= max && !/[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(value) ? value.trim() : null;
}
/** The worker supplies recorded booking contact for new tasks and explicitly
 * labelled account contact for historical tasks. Neither is in the outbox payload. */
export function renderShopOrderEmail(snapshot: OrderEmailSnapshot, customer: { name?: unknown; phone?: unknown; email?: unknown; emailVerifiedAt?: unknown } | null) {
  const order = renderBookingOrderEmail(snapshot);
  const name = contactText(customer?.name, 100), phone = contactText(customer?.phone, 30);
  const email = customer?.emailVerifiedAt ? customerOrderEmail(customer.email) : null;
  const customerSection = ['Customer contact:', snapshot.contactVersion === 1 ? 'Contact source: Recorded booking contact.' : 'Contact source: Current customer account for a historical booking; no booking contact was recorded.',
    'Name: ' + (name ?? 'Not provided'), 'Phone: ' + (phone ?? 'Not provided'),
    'Email: ' + (email ?? (snapshot.version === 2 ? 'No verified recipient; customer email was not requested.' : 'Not provided'))];
  const neutralOrderText = order.text.split('\n').filter(line => !line.startsWith('Your booking request has been received.') && !line.startsWith('Contact the store directly') && !line.startsWith('Please use the latest order status') && !line.startsWith('Store phone:') && !line.startsWith('Store email:'));
  return { subject: order.subject.replace('Massajoy — ', 'Massajoy store — '),
    text: [...neutralOrderText, ...(snapshot.status === 'PENDING' ? ['', 'This booking request is awaiting store confirmation; it is not a confirmed appointment.'] : []), '', ...customerSection, '', 'Please review this order in your store workspace and contact the customer directly to arrange confirmation, changes, or payment. All appointment times above use the store time zone.'].join('\n') };
}
