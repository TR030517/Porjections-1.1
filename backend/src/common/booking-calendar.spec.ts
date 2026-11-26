import { bookingCalendar } from './booking-calendar';
import { publicShopProfile } from './shop-public-profile';
import { priceMenuRevision } from './shop-price-menu-revision';
import { catalogSelectionRevision } from './menu-catalog-snapshot';

describe('shop-local booking calendar', () => {
  test('the American shop still offers its today when a China device has already reached tomorrow', () => {
    const now = new Date('2026-11-04T01:00:00.000Z');
    expect(bookingCalendar('America/New_York', now)).toEqual({ today: '2026-11-03', timezone: 'America/New_York',
      serverNow: now.toISOString(), validUntil: '2026-11-04T05:00:00.000Z' });
    expect(bookingCalendar('Asia/Shanghai', now)?.today).toBe('2026-11-04');
  });
  test.each([
    ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z', 23],
    ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z', 25],
  ])('local midnight expiry follows DST rather than UTC plus 24 hours (%s)', (start, end, hours) => {
    const now = new Date(start), result = bookingCalendar('America/New_York', now)!;
    expect(result.validUntil).toBe(end); expect((Date.parse(result.validUntil) - +now) / 3600000).toBe(hours);
    expect(bookingCalendar(result.timezone, new Date(Date.parse(result.validUntil) - 1))?.today).toBe(result.today);
    expect(bookingCalendar(result.timezone, new Date(result.validUntil))?.today).not.toBe(result.today);
  });
  test('UTC boundary is exact and invalid/missing timezones or time values fail closed without aborting shop projection', () => {
    expect(bookingCalendar('UTC', new Date('2035-01-01T23:59:59.999Z'))).toMatchObject({ today: '2035-01-01', validUntil: '2035-01-02T00:00:00.000Z' });
    for (const timezone of [undefined, null, '', 'Invalid/Zone', {}, 0]) expect(bookingCalendar(timezone)).toBeNull();
    expect(bookingCalendar('UTC', new Date('invalid'))).toBeNull();
    expect(publicShopProfile({ timezone: 'Invalid/Zone' }).bookingCalendar).toBeNull();
  });
  test('fresh public calendars are excluded from history projection and raw menu/catalog versions', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2035-01-01T08:00:00Z'));
      const shop = { id: 10n, timezone: 'UTC', studioProfile: { priceMenu: [] } }, parent = { id: 20n, shopId: 10n, variants: [], addOns: [] };
      const first = publicShopProfile(shop), menuVersion = priceMenuRevision(shop.id, shop.studioProfile), selectionVersion = catalogSelectionRevision(shop.id, parent);
      jest.setSystemTime(new Date('2035-01-01T08:01:00Z'));
      expect(publicShopProfile(shop).bookingCalendar?.serverNow).not.toBe(first.bookingCalendar?.serverNow);
      expect(priceMenuRevision(shop.id, shop.studioProfile)).toBe(menuVersion); expect(catalogSelectionRevision(shop.id, parent)).toBe(selectionVersion);
      expect(publicShopProfile(shop, [], { includeBookingCalendar: false })).not.toHaveProperty('bookingCalendar');
    } finally { jest.useRealTimers(); }
  });
});
