import { Prisma } from '@prisma/client';
import { FavoritesService } from './favorites.service';

describe('favorite shop card contract', () => {
  test('a nonempty list exposes numeric coordinates and the public shop card fields', async () => {
    const savedAt = new Date('2026-11-01T12:00:00Z');
    const shop = {
      id: 7n, name: 'Seattle Wellness', nameEn: 'Seattle Wellness',
      description: 'Local massage services', phone: '206-555-0100',
      address: '1207 S Jackson St #109B', city: 'Seattle', state: 'Washington', zipCode: '98144',
      latitude: new Prisma.Decimal('47.5997'), longitude: new Prisma.Decimal('-122.3168'),
      category: 'MASSAGE', shopType: 'SPA', timezone: 'America/Los_Angeles',
      avgRating: new Prisma.Decimal('4.5'), reviewCount: 3, bookingCount: 8,
      shortName: 'seattle-wellness', shopImages: [],
      studioProfile: { features: { onlineBooking: false, reviews: true }, paymentPolicy: { payAtStoreEnabled: true } },
      loginPassword: 'never-public',
    };
    const db = {
      userFavorite: { findMany: jest.fn()
        .mockResolvedValueOnce([{ shopId: 7n }, { shopId: 9n }])
        .mockResolvedValueOnce([{ shop, createdAt: savedAt }]) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7n }]),
    };

    const result = await new FavoritesService(db as any).listShops('21');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: '7', name: 'Seattle Wellness', description: 'Local massage services', phone: '206-555-0100',
      address: '1207 S Jackson St #109B', city: 'Seattle', state: 'Washington', zipCode: '98144',
      latitude: 47.5997, longitude: -122.3168, timezone: 'America/Los_Angeles',
      category: 'MASSAGE', shopType: 'SPA', avgRating: 4.5, reviewCount: 3, bookingCount: 8,
      distanceKm: null, canonicalPath: '/s/seattle-wellness',
      features: { onlineBooking: false, reviews: true }, paymentPolicy: { payAtStoreEnabled: true }, favoritedAt: savedAt,
    });
    expect(typeof result[0].latitude).toBe('number');
    expect(typeof result[0].longitude).toBe('number');
    expect(JSON.stringify(result)).not.toContain('never-public');
    // Publication filtering must not broaden the collection to other users or hidden shops.
    expect(db.userFavorite.findMany.mock.calls[1][0].where).toEqual({ userId: 21n, shopId: { in: [7n] } });
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual(expect.arrayContaining([7n, 9n]));
  });

  test('an empty or entirely hidden collection does not request shop details', async () => {
    for (const favorites of [[], [{ shopId: 9n }]]) {
      const db = {
        userFavorite: { findMany: jest.fn().mockResolvedValue(favorites) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      expect(await new FavoritesService(db as any).listShops('21')).toEqual([]);
      expect(db.userFavorite.findMany).toHaveBeenCalledTimes(1);
    }
  });
});
