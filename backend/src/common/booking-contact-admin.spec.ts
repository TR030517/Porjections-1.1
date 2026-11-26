import { BookingManageService } from '../modules/admin/booking-manage.service';
import { StudioService } from '../modules/studio/studio.service';
import { requireVerifiedBookingContact } from './booking-contact';

function fixture(recorded = true) {
  const verifiedAt = new Date('2030-01-01T00:00:00Z');
  const row: any = { id: 1n, bookingNo: 'SYNTHETIC-CONTACT', userId: 2n, shopId: 3n, serviceId: 4n,
    user: { id: 2n, name: 'Changed account', phone: '+12025550101', email: 'changed@example.test', role: 'CUSTOMER' },
    shop: { id: 3n, name: 'Synthetic shop', timezone: 'America/Los_Angeles' },
    items: [], addOns: [], priceCents: 6000, totalCents: 6000, paidCents: 0, refundedCents: 0,
    durationMin: 60, status: 'PENDING', paymentStatus: 'UNPAID', currency: 'usd',
    bookingDate: new Date('2035-01-01T00:00:00Z'), bookingTimezone: 'America/Los_Angeles',
    startTime: new Date('2035-01-01T17:00:00Z'), endTime: new Date('2035-01-01T18:00:00Z') };
  if (recorded) Object.assign(row, requireVerifiedBookingContact({ name: 'Original guest', phone: '+442079460100', email: 'original@example.test' },
    { role: 'CUSTOMER', status: 'ACTIVE', email: 'original@example.test', emailVerifiedAt: verifiedAt }));
  const db: any = { booking: { findMany: async () => [row], count: async () => 1, findUnique: async () => row },
    $transaction: async (work: any[]) => Promise.all(work) };
  return { row, admin: new BookingManageService(db, { findByTarget: async () => [] } as any, {} as any), studio: new StudioService(db) as any };
}

describe('authorized platform booking contact projections', () => {
  test('global list and detail keep recorded contact independent of current account', async () => {
    const f = fixture();
    const list = await f.admin.findAll({} as any), detail = await f.admin.findOne('1');
    for (const result of [list.items[0], detail]) {
      expect(result.contact).toMatchObject({ recorded: true, version: 1, name: 'Original guest', phone: '+442079460100', email: 'original@example.test' });
      expect(result.user?.name).toBe('Changed account');
      expect(result).not.toHaveProperty('contactEmail');
    }
  });
  test('studio rows select order contact for display and keep raw snapshot scalars private', () => {
    const f = fixture(), before = structuredClone(f.row), result = f.studio.map('service-orders', f.row);
    expect(result.customerName).toBe('Original guest'); expect(result.contactLabel).toBe('下单时记录');
    expect(result.contact).toMatchObject({ recorded: true, phone: '+442079460100' });
    for (const key of ['contactName', 'contactPhone', 'contactEmail', 'contactVersion', 'contactSource', 'contactEmailVerifiedAt']) expect(result).not.toHaveProperty(key);
    expect(f.row).toEqual(before);
  });
  test('legacy administrator projections explicitly lack an order-time contact', async () => {
    const f = fixture(false), list = await f.admin.findAll({} as any), detail = await f.admin.findOne('1');
    for (const result of [list.items[0], detail]) expect(result.contact).toEqual({ recorded: false, version: null, label: 'Historical booking has no recorded contact' });
    const row = f.studio.map('service-orders', f.row);
    expect(row.customerName).toBe('Changed account'); expect(row.contactLabel).toContain('当前账号资料');
    expect(row.contact).not.toHaveProperty('email');
  });
});
