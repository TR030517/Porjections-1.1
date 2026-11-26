import { BookingService } from '../modules/booking/booking.service';
import { MerchantService } from '../modules/merchant/merchant.service';
import { StudioService } from '../modules/studio/studio.service';
import { BookingManageService } from '../modules/admin/booking-manage.service';
import { historicalBookingService } from './booking-service-snapshot';

function fixture(participants = 1, staff = 1, legacy = false) {
  const start = new Date('2035-01-02T01:00:00Z'), end = new Date('2035-01-02T02:00:00Z');
  const row: any = { id: 100n, bookingNo: 'SYNTHETIC-HISTORY', shopId: 10n, serviceId: 20n, userId: 5n, therapistId: 30n, couponId: null,
    reservationKind: 'SINGLE', durationMin: 60, priceCents: 14057, discountCents: 0, platformFeeCents: 0, totalCents: 14057,
    tipCents: 0, paidCents: 0, refundedCents: 0, currency: 'usd', participantCountSnapshot: participants, requiredStaffCountSnapshot: staff,
    status: 'CANCELLED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE', deletedAt: null,
    bookingDate: new Date('2035-01-01T00:00:00Z'), bookingTimezone: 'America/Los_Angeles', startTime: start, endTime: end,
    createdAt: new Date('2034-12-01T00:00:00Z'), updatedAt: new Date('2034-12-01T00:00:00Z'),
    shop: { id: 10n, ownerId: 2n, name: 'Synthetic shop', timezone: 'America/Los_Angeles', shortName: 'synthetic', address: '', city: '', state: '', phone: '' },
    service: { id: 20n, name: 'New catalog name', durationKind: 'VARIABLE', durationMin: 180, priceCents: 9900, participantCount: 2, requiredStaffCount: 1,
      priceBasis: 'PER_PERSON', staffBufferMin: 45, roomBufferMin: 45, requiredRoomType: 'COUPLE' },
    items: legacy ? [] : Array.from({ length: participants }, (_, index) => ({ id: BigInt(1000 + index), bookingId: 100n, serviceId: 20n, variantId: 40n,
      participantIndex: index + 1, sequence: 1, serviceNameSnapshot: 'Original package', variantNameSnapshot: 'Original sixty minutes', durationKindSnapshot: 'TIMED',
      priceCentsSnapshot: Math.floor(13057 / participants) + (index < 13057 % participants ? 1 : 0), quotedUnitPriceCents: 13057, priceBasisSnapshot: 'PER_BOOKING',
      durationMin: 60, staffBufferMin: 10, roomBufferMin: 5, requiredStaffCountSnapshot: participants === 1 ? staff : 1,
      currency: 'usd', roomTypeSnapshot: null, startAtUtc: start, endAtUtc: end })), addOns: [], resourceLocks: [] };
  const db: any = { user: { findFirst: async () => ({ id: 1n }) },
    shop: { findUnique: async () => row.shop, findFirst: async () => row.shop },
    booking: { findUnique: async () => row, findMany: async () => [row], count: async () => 1 },
    $transaction: async (jobs: any[]) => Promise.all(jobs) };
  const customer = new BookingService(db, {} as any, {} as any, {} as any);
  const merchant = new MerchantService(db, customer);
  const studio: any = new StudioService(db);
  const admin = new BookingManageService(db, { findByTarget: async () => [] } as any, {} as any);
  const views = async () => [await customer.getBooking('100', '5'), studio.map('service-orders', row),
    (await merchant.getShopBookings('1', '10', {}, 'ADMIN') as any[])[0], await admin.findOne('100'), (await admin.findAll({} as any)).items[0]];
  return { row, views, studio };
}

describe('historical order views remain independent of live price-menu edits', () => {
  test.each([[1, 1], [2, 2], [1, 2]])('all order views preserve original name, package price and resource policy (%i guests / %i staff)', async (participants, staff) => {
    const f = fixture(participants, staff), before = structuredClone(f.row);
    for (const view of await f.views()) {
      expect(view.service).toMatchObject({ name: 'Original package', priceCents: 13057, durationKind: 'TIMED', durationMin: 60,
        priceBasis: 'PER_BOOKING', participantCount: participants, requiredStaffCount: staff, staffBufferMin: 10, roomBufferMin: 5, requiredRoomType: null });
      expect(view.totalCents).toBe(14057);
      expect(view.items.map((item: any) => item.serviceNameSnapshot)).toEqual(Array(participants).fill('Original package'));
    }
    expect(f.studio.map('service-orders', f.row).serviceName).toBe('Original package');
    expect(f.row).toEqual(before);
  });
  test('every order projection prefers the stored timezone snapshot over the current shop timezone', async () => {
    const f = fixture(); f.row.shop.timezone = 'America/New_York';
    for (const view of await f.views()) expect(view).toMatchObject({ timezone: 'America/Los_Angeles', localDate: '2035-01-01', localStartTime: '17:00', localEndTime: '18:00' });
  });
  test.each([null, 'Invalid/Timezone'])('legacy timezone %p retains the endpoint-specific fallback contract', async snapshot => {
    const f = fixture(); f.row.bookingTimezone = snapshot; f.row.shop.timezone = 'America/New_York';
    const before = structuredClone(f.row);
    const [customer, studio, merchant, adminDetail, adminList] = await f.views();
    // These existing public and management projections expose the current shop
    // fallback. The historical Studio export instead leaves missing facts null.
    for (const view of [customer, merchant, adminDetail, adminList]) {
      expect(view).toMatchObject({ timezone: 'America/New_York', localDate: '2035-01-01', localStartTime: '20:00', localEndTime: '21:00' });
    }
    expect(studio).toMatchObject({ timezone: null, shopTimezone: null, localDate: null, localStartTime: null, localEndTime: null });
    expect(f.row).toEqual(before);
  });
  test('a legacy order without items retains its stored duration and price rather than todays catalog price', async () => {
    const f = fixture(1, 1, true);
    // With no saved name, the current relation is the only available name.
    for (const view of await f.views()) expect(view.service).toMatchObject({ name: 'New catalog name', durationKind: 'TIMED', durationMin: 60, priceCents: 14057 });
  });
  test('old whole-package shares reconstruct the package price only when the quoted unit snapshot is missing', () => {
    const f = fixture(2, 2);
    for (const item of f.row.items) item.quotedUnitPriceCents = null;
    expect(historicalBookingService(f.row)).toMatchObject({ priceCents: 13057, priceBasis: 'PER_BOOKING' });
    for (const item of f.row.items) item.quotedUnitPriceCents = 11000;
    expect(historicalBookingService(f.row).priceCents).toBe(11000);
  });
  test('legacy per-person prices and nullable optional snapshots never borrow current package policy', () => {
    const f = fixture(2, 2); f.row.requiredStaffCountSnapshot = null;
    for (const item of f.row.items) Object.assign(item, { quotedUnitPriceCents: null, priceBasisSnapshot: null, requiredStaffCountSnapshot: 2,
      staffBufferMin: null, roomBufferMin: null, roomTypeSnapshot: null, currency: null });
    expect(historicalBookingService(f.row)).toMatchObject({ priceCents: 6529, priceBasis: 'PER_PERSON', requiredStaffCount: 2,
      staffBufferMin: 0, roomBufferMin: 0, requiredRoomType: null, currency: 'usd' });
  });
  test('a PLAN top service projects its first segment instead of aggregating all participants or segments', () => {
    const f = fixture(); Object.assign(f.row, { reservationKind: 'PLAN', participantCountSnapshot: 2, requiredStaffCountSnapshot: 2 });
    f.row.items.push({ ...f.row.items[0], id: 1001n, serviceId: 21n, sequence: 2, serviceNameSnapshot: 'Second segment', priceCentsSnapshot: 5000 });
    expect(historicalBookingService(f.row)).toMatchObject({ name: 'Original package', priceCents: 13057, participantCount: 1, requiredStaffCount: 1 });
  });
});
