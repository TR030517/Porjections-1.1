import { createHash } from 'crypto';
import { readShopBookingSettings } from './shop-booking-settings';

/** Server-only CAS token. Keep crypto out of the shared browser settings module. */
export function shopBookingSettingsHash(shop: { timezone: string | null; studioProfile: unknown }): string {
  return createHash('sha256').update(JSON.stringify({ timezone: shop.timezone, bookingSettings: readShopBookingSettings(shop.studioProfile) })).digest('hex');
}
