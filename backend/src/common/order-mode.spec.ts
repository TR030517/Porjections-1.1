import { ServiceUnavailableException } from '@nestjs/common';
import { BOOKING_PRICE_BASIS, bookingOnlinePaymentEnabled, bookingOrderPolicy, newBookingPaymentMode } from './order-mode';
import { PaymentService } from '../modules/payment/payment.service';
import { publicServiceView, publicShopProfile } from './shop-public-profile';

describe('whole-order booking policy and closed online checkout admission', () => {
  const keys = ['BOOKING_ONLINE_PAYMENT_ENABLED', 'PAYMENT_PROVIDER', 'NODE_ENV'] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = Object.fromEntries(keys.map(key => [key, process.env[key]])); delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; });
  afterEach(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

  test.each([undefined, '', 'false', 'TRUE', '1', ' true '])('defaults closed for %p and does not trust client ONLINE mode', value => {
    if (value === undefined) delete process.env.BOOKING_ONLINE_PAYMENT_ENABLED; else process.env.BOOKING_ONLINE_PAYMENT_ENABLED = value;
    expect(bookingOnlinePaymentEnabled()).toBe(false); expect(bookingOrderPolicy()).toEqual({ orderOnly: true, onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER', requiresCustomerEmail: true });
    expect(newBookingPaymentMode()).toBe('PAY_AT_STORE'); expect(newBookingPaymentMode('ONLINE')).toBe('PAY_AT_STORE');
  });
  test('explicit enablement can reopen checkout while the sales price remains per order', () => {
    process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true';
    expect(bookingOrderPolicy()).toEqual({ orderOnly: false, onlinePaymentEnabled: true, pricingPolicy: 'PER_ORDER', requiresCustomerEmail: true });
    expect(newBookingPaymentMode()).toBe('ONLINE'); expect(newBookingPaymentMode('PAY_AT_STORE')).toBe('PAY_AT_STORE'); expect(BOOKING_PRICE_BASIS).toBe('PER_BOOKING');
  });
  test('public whole-order projections never rewrite the stored legacy catalog or copy private account data', () => {
    const service = { id: 20n, shopId: 10n, name: 'Synthetic couple visit', durationKind: 'TIMED', durationMin: 60, priceCents: 20001, priceBasis: 'PER_PERSON',
      participantCount: 2, requiredStaffCount: 2, isActive: true, variants: [{ id: 30n, serviceId: 20n, name: '90 minutes', durationMin: 90,
        priceCents: 30003, priceBasis: 'PER_PERSON', isActive: true, currency: 'usd' }] };
    const before = structuredClone(service), result = publicServiceView(service);
    expect(result).toMatchObject({ priceCents: 20001, priceBasis: 'PER_BOOKING', orderOnly: true, onlinePaymentEnabled: false, pricingPolicy: 'PER_ORDER' });
    expect(result.variants[0]).toMatchObject({ priceCents: 30003, priceBasis: 'PER_BOOKING' }); expect(service).toEqual(before);
    expect(publicShopProfile({ studioProfile: {}, owner: { email: 'not-public@example.test' } })).toMatchObject(bookingOrderPolicy());
  });
  test('configured local provider cannot start or confirm payment when order-only, before any DB or external call', async () => {
    process.env.PAYMENT_PROVIDER = 'local_mock'; process.env.NODE_ENV = 'test';
    const access = jest.fn(() => { throw Error('Payment admission must reject before database/provider access'); });
    const db = new Proxy({}, { get: access }), payment = new PaymentService(db as any);
    expect(payment.config()).toMatchObject({ enabled: false, onlinePaymentEnabled: false, orderOnly: true });
    await expect(payment.createPaymentIntent({ bookingId: '1', userId: '5' })).rejects.toThrow(ServiceUnavailableException);
    await expect(payment.confirmPaymentIntent({ paymentIntentId: 'existing-id', userId: '5' })).rejects.toThrow(ServiceUnavailableException);
    expect(access).not.toHaveBeenCalled();
    // The historical provider path stays available to authenticated refund,
    // signed webhook and reconciliation methods with their own existing fences.
    expect((payment as any).provider()).toBe('local_mock');
    process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true'; expect(payment.config().enabled).toBe(true);
  });
});
