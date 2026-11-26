/** Current sales policy, independent of stored historical settlement snapshots.
 * Only an explicit server opt-in can expose a new online checkout. */
export function bookingOnlinePaymentEnabled(): boolean {
  return typeof process !== 'undefined' && process.env?.BOOKING_ONLINE_PAYMENT_ENABLED === 'true';
}
export function bookingOrderPolicy() {
  const onlinePaymentEnabled = bookingOnlinePaymentEnabled();
  return { orderOnly: !onlinePaymentEnabled, onlinePaymentEnabled, pricingPolicy: 'PER_ORDER' as const, requiresCustomerEmail: true };
}
export function newBookingPaymentMode(requested?: 'ONLINE' | 'PAY_AT_STORE'): 'ONLINE' | 'PAY_AT_STORE' {
  return bookingOnlinePaymentEnabled() ? requested ?? 'ONLINE' : 'PAY_AT_STORE';
}
/** Never apply this to an existing booking/item snapshot. Stored legacy catalog
 * labels remain untouched, while every new selection is a whole-order amount. */
export const BOOKING_PRICE_BASIS = 'PER_BOOKING' as const;
