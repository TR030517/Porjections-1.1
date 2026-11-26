import { customerOrderEmail } from './booking-order-email';
import { shopOrderEmailRecipient } from './shop-order-email';

export const SHOP_ORDER_EMAIL_STATES = ['VERIFIED', 'LEGACY_UNVERIFIED', 'MISSING', 'DISABLED', 'INVALID'] as const;
export type ShopOrderEmailState = typeof SHOP_ORDER_EMAIL_STATES[number];
export type ShopOrderEmailDeliveryState = 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';
export interface ShopOrderEmailSettingsView {
  shopId: string; revision: number; state: ShopOrderEmailState;
  recipient: string | null; verifiedAt: string | null; legacyCandidate: string | null;
  pending: null | { challengeId: string; email: string; expiresAt: string; deliveryState: ShopOrderEmailDeliveryState; attemptsRemaining: number };
  delivery: { configured: boolean; mode: 'LOCAL_CAPTURE' | 'PROVIDER' | null; workerEnabled: boolean; reasonCode: string | null };
}
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
/** Syntactic validity, a public email, or an account binding is never receipt proof. */
export function verifiedShopOrderEmailRecipient(setting: unknown): string | null {
  if (!setting || typeof setting !== 'object' || Array.isArray(setting)) return null;
  const row = setting as Record<string, unknown>;
  const recipient = customerOrderEmail(row.recipientEmail);
  return row.enabled === true && recipient && validDate(row.recipientVerifiedAt) ? recipient.toLowerCase() : null;
}
export function shopOrderEmailSettingsView(setting: any, profile: unknown, shopId: string | bigint,
  delivery: ShopOrderEmailSettingsView['delivery'], now = new Date()): ShopOrderEmailSettingsView {
  const recipient = verifiedShopOrderEmailRecipient(setting);
  const legacyCandidate = shopOrderEmailRecipient(profile)?.toLowerCase() ?? null;
  const invalid = setting?.recipientEmail != null || setting?.recipientVerifiedAt != null;
  const state: ShopOrderEmailState = setting?.enabled === false ? 'DISABLED' : recipient ? 'VERIFIED'
    : invalid ? 'INVALID' : legacyCandidate ? 'LEGACY_UNVERIFIED' : 'MISSING';
  const pendingEmail = customerOrderEmail(setting?.pendingEmail);
  const pending = !setting?.consumedAt && typeof setting?.challengeId === 'string' && /^[a-f0-9-]{36}$/i.test(setting.challengeId)
    && pendingEmail && validDate(setting.pendingExpiresAt) && setting.pendingExpiresAt > now && Number.isInteger(setting.attempts)
    && setting.attempts >= 0 && setting.attempts < 5 && ['SENDING', 'SENT', 'FAILED', 'UNKNOWN'].includes(setting.deliveryState)
    ? { challengeId: setting.challengeId, email: pendingEmail.toLowerCase(), expiresAt: setting.pendingExpiresAt.toISOString(),
      deliveryState: setting.deliveryState as ShopOrderEmailDeliveryState, attemptsRemaining: 5 - setting.attempts } : null;
  return { shopId: String(shopId), revision: Number.isSafeInteger(setting?.revision) && setting.revision >= 0 ? setting.revision : 0,
    state, recipient, verifiedAt: recipient ? setting.recipientVerifiedAt.toISOString() : null,
    legacyCandidate, pending, delivery };
}
