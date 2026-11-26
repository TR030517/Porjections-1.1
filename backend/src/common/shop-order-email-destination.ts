import { verifiedShopOrderEmailRecipient } from './shop-order-email-settings';
import { orderEmailRecipientFingerprint, shopOrderEmailRecipient, type ShopOrderEmailEnvelope } from './shop-order-email';
import type { OrderEmailSnapshot } from './booking-order-email';

// The worker/outbox never load verification codes or the pending destination.
export const SHOP_ORDER_EMAIL_DESTINATION_SELECT = {
  enabled: true, recipientEmail: true, recipientVerifiedAt: true,
} as const;

/** New events require independent proof of the private destination. A legacy
 * public address is only a candidate for the settings screen, never proof. */
export function verifiedShopOrderEmailEnvelope(shopId: string | bigint, setting: unknown, snapshot: OrderEmailSnapshot | null): ShopOrderEmailEnvelope {
  const recipient = verifiedShopOrderEmailRecipient(setting);
  return { version: 2, audience: 'SHOP', shopId: String(shopId),
    recipientFingerprint: recipient ? orderEmailRecipientFingerprint(recipient) : null, snapshot };
}

/** Preserve the policy of existing v1 tasks without rewriting their fingerprint
 * or payload. Activating a dedicated destination/disable applies to dispatch;
 * any mismatch blocks, never redirects an old task to a new address. */
export function shopOrderEmailEventRecipient(envelope: ShopOrderEmailEnvelope, shop: { studioProfile?: unknown; orderEmailSetting?: unknown }): string | null {
  const setting = shop.orderEmailSetting as Record<string, unknown> | null | undefined;
  if (envelope.version === 2) return verifiedShopOrderEmailRecipient(setting);
  if (setting?.enabled === false) return null;
  if (setting?.recipientEmail != null || setting?.recipientVerifiedAt != null) return verifiedShopOrderEmailRecipient(setting);
  // A pending replacement alone never changes the destination of legacy jobs.
  if (setting != null && setting.enabled !== true) return null;
  return shopOrderEmailRecipient(shop.studioProfile);
}
