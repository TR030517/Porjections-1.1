import { BookingService } from './booking.service';

describe('assisted booking service projection', () => {
  const shopId = 10n;
  const prisma: any = {
    user: { findFirst: jest.fn(async () => ({ id: 2n })) },
    shop: { findFirst: jest.fn(async () => ({ id: shopId, status: 'APPROVED', deletedAt: null, owner: {}, loginBinding: null })) },
    shopService: { findMany: jest.fn() },
  };
  const service = new BookingService(prisma, {} as any, {} as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('returns only active bookable services and active variants with minimal fields', async () => {
    prisma.shopService.findMany.mockResolvedValue([
      { id: 11n, shopId, name: 'Massage', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 8000,
        priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, hasVariants: false, _count: { variants: 0 }, variants: [] },
      { id: 12n, shopId, name: 'Couple massage', isActive: true, durationKind: 'TIMED', durationMin: 0, priceCents: 0,
        priceBasis: 'UNKNOWN', participantCount: 2, requiredStaffCount: 2, hasVariants: true, _count: { variants: 2 }, variants: [
          { id: 121n, serviceId: 12n, name: '60 minutes', durationMin: 60, priceCents: 15000, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true },
          { id: 122n, serviceId: 12n, name: 'Disabled', durationMin: 60, priceCents: 14000, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: false },
        ] },
      { id: 13n, shopId, name: 'Inactive', isActive: false, durationKind: 'TIMED', durationMin: 60, priceCents: 8000,
        priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, hasVariants: false, _count: { variants: 0 }, variants: [] },
      { id: 14n, shopId, name: 'Invalid price', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 0,
        priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, hasVariants: false, _count: { variants: 0 }, variants: [] },
    ]);

    const rows = await service.assistedBookingServices({ id: '2', role: 'ADMIN' }, String(shopId));

    expect(rows).toEqual([
      { id: '11', name: 'Massage', isActive: true, durationMin: 60, participantCount: 1, requiredStaffCount: 1, hasVariants: false, variants: [] },
      { id: '12', name: 'Couple massage', isActive: true, durationMin: 60, participantCount: 2, requiredStaffCount: 2, hasVariants: true,
        variants: [{ id: '121', name: '60 minutes', durationMin: 60, priceCents: 15000, isActive: true }] },
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual(['durationMin', 'hasVariants', 'id', 'isActive', 'name', 'participantCount', 'requiredStaffCount', 'variants']);
  });
});
