import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { assertPublicShop, PUBLIC_SHOP_SQL, publicShopIds, publicShopWhere, requirePublicShop, shopEligibility } from './shop-eligibility';
import { canonicalShopLink, normalizeShopShortName, reserveShopAlias } from './shop-alias';
import { publicServiceView, publicShopProfile, safePublicMediaUrl } from './shop-public-profile';
import { ShopsService } from '../modules/shops/shops.service';
import { FavoritesService } from '../modules/favorites/favorites.service';

const activeShop = () => ({ id: 71n, ownerId: 11n, status: 'APPROVED', deletedAt: null,
  owner: { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: null }, loginBinding: { userId: 22n, user: { id:22n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName:'synthetic-merchant', email:null, phone:null, passwordHash:'$2b$12$'+'A'.repeat(53) } }, studioProfile: { features: { onlineBooking: true } } });

describe('Public shop eligibility and explicit projection (synthetic, no database)', () => {
  test('public detail keeps prices and the existing catalog when active staff have no recurring shift during opening hours', async () => {
    const service = { id: 20n, shopId: 71n, isActive: true, name: 'Synthetic massage', durationKind: 'TIMED', durationMin: 60,
      participantCount: 1, requiredStaffCount: 1, priceCents: 6500, priceBasis: 'PER_BOOKING', variants: [], addOns: [] };
    const catalog = [{ category: 'Massage', items: [
      { name: service.name, priceText: '', booking: { serviceId: '20' }, pricing: { kind: 'TIMED',
        baseName: service.name, durationMin: 60, priceCents: 6500, titleMode: 'CUSTOM',
        legacySource: { name: 'Original merchant copy', priceText: 'Original merchant price text' } } },
      { name: 'Unconfigured menu item', priceText: '', booking: { serviceId: '999' } },
      { name: 'Walk-in price', priceText: '$25' },
    ] }];
    const shop = { ...activeShop(), businessHours: { monday: { open: '09:00', close: '17:00' } }, timezone: 'UTC',
      studioProfile: { ...activeShop().studioProfile, priceMenu: catalog }, shopServices: [service], shopImages: [], certificates: [] };
    const staff = [{ id: 30n, name: 'Synthetic technician', isActive: true, shopId: 71n, scheduleMode: 'CUSTOM',
      shifts: [{ weekday: 2, startMin: 540, endMin: 660, isActive: true }], timeOff: [{ startAtUtc: new Date('2090-01-01'), endAtUtc: new Date('2091-01-01') }] }];
    const db = { $queryRaw: jest.fn(async () => [{ id: 71n }]), shop: { findFirst: jest.fn(async () => shop) },
      shopService: { findMany: jest.fn(async () => [service]) },
      therapist: { count: jest.fn(async () => staff.length), findMany: jest.fn(async () => staff) } };
    const shops = new ShopsService(db as any);

    const noShift = await shops.getShop('71');
    expect(noShift.hasConfiguredBookingSchedule).toBe(false);
    expect(noShift.priceMenu?.[0].items).toMatchObject([
      { bookingEnabled: true, bookingAvailable: false, bookingUnavailableReason: 'NO_SCHEDULE', pricing: { priceCents: 6500 } },
      { bookingEnabled: false, bookingAvailable: false, bookingUnavailableReason: 'CONFIGURATION_REQUIRED' },
      { name: 'Walk-in price', priceText: '$25' },
    ]);
    expect(noShift.priceMenu?.[0].items[0].pricing).not.toHaveProperty('legacySource');
    const studio = publicShopProfile(shop, [], { includeHiddenPriceMenu: true });
    expect(studio.priceMenu?.[0].items[0].pricing).toHaveProperty('legacySource', catalog[0].items[0].pricing?.legacySource);
    expect(noShift.services.map(item => item.id)).toEqual(['20']);
    expect(noShift.therapists.map(item => item.id)).toEqual(['30']);
    expect(noShift.therapists[0]).not.toHaveProperty('shifts');
    expect(noShift.therapists[0]).not.toHaveProperty('timeOff');
    expect(db.therapist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: 71n, isActive: true },
      select: { scheduleMode: true, shifts: { where: { isActive: true }, select: { weekday: true, startMin: true, endMin: true, isActive: true } } } }));

    staff[0].shifts[0].weekday = 1;
    const configured = await shops.getShop('71');
    expect(configured.hasConfiguredBookingSchedule).toBe(true);
    expect(configured.priceMenu?.[0].items[0]).toMatchObject({ bookingEnabled: true, bookingAvailable: true });
    expect(configured.priceMenu?.[0].items[0]).not.toHaveProperty('bookingUnavailableReason');
  });

  test.each([
    { status: 'PENDING' }, { status: 'REJECTED' }, { status: 'SUSPENDED' }, { deletedAt: new Date('2026-10-28T00:00:00Z') },
  ])('an unpublished, suspended or deleted shop cannot be exposed or booked %#', patch => {
    const shop = { ...activeShop(), ...patch };
    expect(shopEligibility(shop)).toMatchObject({ publicVisible: false, newBookingAllowed: false, reason: 'SHOP_UNAVAILABLE' });
    expect(() => assertPublicShop(shop)).toThrow(NotFoundException);
    expect(() => assertPublicShop(shop, { forBooking: true })).toThrow(NotFoundException);
  });

  test.each([
    { loginBinding: null },
    { loginBinding: { userId: 22n, user: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } } },
    { loginBinding: { userId: 22n, user: { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: null } } },
    { loginBinding: { userId: 22n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: new Date('2026-10-28T00:00:00Z') } } },
    { loginBinding: { userId: 22n, user: { id:22n, role:'MERCHANT', status:'ACTIVE', deletedAt:null, loginName:'synthetic-merchant', email:null, phone:null, passwordHash:null } } },
    { loginBinding: { userId: 22n, user: { id:22n, role:'MERCHANT', status:'ACTIVE', deletedAt:null, loginName:'invalid/path', email:null, phone:null, passwordHash:'$2b$12$'+'A'.repeat(53) } } },
  ])('independent login availability does not hide a published shop or disable its booking feature %#', patch => {
    const shop = { ...activeShop(), ...patch };
    expect(shopEligibility(shop)).toEqual({ publicVisible: true, newBookingAllowed: true, reason: null });
    expect(assertPublicShop(shop)).toBe(shop);
    expect(assertPublicShop(shop, { forBooking: true })).toBe(shop);
  });

  test('online booking is a separate gate: an open catalog remains visible while new booking is disabled', () => {
    const shop = { ...activeShop(), studioProfile: { features: { onlineBooking: false } } };
    expect(assertPublicShop(shop)).toBe(shop);
    expect(shopEligibility(shop)).toEqual({ publicVisible: true, newBookingAllowed: false, reason: 'ONLINE_BOOKING_DISABLED' });
    expect(() => assertPublicShop(shop, { forBooking: true })).toThrow(BadRequestException);
    expect(publicShopWhere()).toEqual({ status: 'APPROVED', deletedAt: null });
    expect(PUBLIC_SHOP_SQL).toBe("s.status = 'APPROVED' AND s.deleted_at IS NULL");
  });

  test('public collection IDs use publication eligibility independently of logins and parameterize requested shop IDs', async () => {
    const db: any = { $queryRaw: jest.fn(async (..._args: any[]) => [{ id: 71n }]) };
    await expect(publicShopIds(db, [71n])).resolves.toEqual([71n]);
    const query = db.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain("s.status = 'APPROVED'");
    expect(query.sql).toContain('s.deleted_at IS NULL');
    expect(query.sql).not.toMatch(/public_account|login_name|password_hash|users/);
    expect(query.values).toEqual([71n]);
    await expect(publicShopIds(db, [])).resolves.toEqual([]);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  test('legacy login readiness is independent from publication eligibility', () => {
    expect(shopEligibility(activeShop(), false)).toEqual({ publicVisible: true, newBookingAllowed: true, reason: null });
    expect(() => assertPublicShop(activeShop())).not.toThrow();
  });

  test.each([
    { status: 'SUSPENDED' }, { deletedAt: new Date('2026-11-06T00:00:00Z') },
  ])('final transaction rereads publication after the locking read; earlier visibility is insufficient %#', async patch => {
    const events: string[] = [];
    const tx = { shop: { findUnique: jest.fn().mockImplementationOnce(async () => { events.push('initial'); return activeShop(); })
      .mockImplementationOnce(async () => { events.push('reread'); return { ...activeShop(), ...patch }; }) },
    $queryRaw: jest.fn(async (query: any) => { events.push('lock-login'); expect(query.values).toEqual([22n]); return []; }) };
    await expect(requirePublicShop(tx, 71n, { forBooking: true })).rejects.toThrow(NotFoundException);
    expect(events).toEqual(['initial', 'lock-login', 'reread']);
  });

  test('a login suspended between reads leaves the published shop bookable', async () => {
    const later = { ...activeShop(), loginBinding: { userId: 22n, user: { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: null } } };
    const tx = { shop: { findUnique: jest.fn().mockResolvedValueOnce(activeShop()).mockResolvedValueOnce(later) }, $queryRaw: jest.fn(async () => []) };
    await expect(requirePublicShop(tx, 71n, { forBooking: true })).resolves.toBe(later);
    expect(tx.shop.findUnique).toHaveBeenCalledTimes(2);
  });

  test('a booking feature disabled between reads rejects new booking even when the shop remains published', async () => {
    const later = { ...activeShop(), studioProfile: { features: { onlineBooking: false } } };
    const tx = { shop: { findUnique: jest.fn().mockResolvedValueOnce(activeShop()).mockResolvedValueOnce(later) }, $queryRaw: jest.fn(async () => []) };
    await expect(requirePublicShop(tx, 71n, { forBooking: true })).rejects.toThrow(BadRequestException);
    expect(tx.shop.findUnique).toHaveBeenCalledTimes(2);
  });

  test('an unbound shop is also reread before accepting a new booking', async () => {
    const initial = { ...activeShop(), loginBinding: null };
    const tx = { shop: { findUnique: jest.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, status: 'SUSPENDED' }) }, $queryRaw: jest.fn(async () => []) };
    await expect(requirePublicShop(tx, 71n, { forBooking: true })).rejects.toThrow(NotFoundException);
    expect(tx.shop.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test('historical financial ownership cannot change publication eligibility or replace a suspended shop status', () => {
    expect(assertPublicShop(activeShop())).toMatchObject({ ownerId: 11n });
    expect(shopEligibility({ ...activeShop(), owner: null }).publicVisible).toBe(true);
    expect(assertPublicShop({ ...activeShop(), owner: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null }, loginBinding: null })).toMatchObject({ status: 'APPROVED' });
    expect(() => assertPublicShop({ ...activeShop(), status: 'SUSPENDED', owner: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } })).toThrow(NotFoundException);
  });

  test('Studio and public projection use one ordered fallback and never return credentials, owner data or arbitrary JSON', () => {
    const projected = publicShopProfile({ description: 'Public introduction', phone: '+12025550149', owner: { email: 'private@example.invalid' },
      studioProfile: { subtitle: 'Public subtitle', internalNote: 'private', pay_square_info: { token: 'synthetic-do-not-serialize' } } }, [
      { id: 20n, sortOrder: 2, imageUrl: 'https://images.example.test/later.jpg', imageType: 'INTERIOR' },
      { id: 10n, sortOrder: 1, imageUrl: 'https://images.example.test/first.jpg', imageType: 'STORE_FRONT' },
      { id: 1n, sortOrder: 0, imageUrl: 'https://images.example.test/private-certificate.jpg', imageType: 'CERTIFICATE' },
    ]);
    expect(projected.media.galleryUrls).toEqual(['https://images.example.test/first.jpg', 'https://images.example.test/later.jpg']);
    expect(projected.thumbnail).toBe('https://images.example.test/first.jpg');
    expect(JSON.stringify(projected)).not.toMatch(/private|token|pay_square|owner|internalNote/);
  });

  test('explicit clear never resurrects old rows, and unsafe or credential-bearing media is discarded', () => {
    const projected = publicShopProfile({ studioProfile: { gallery: [], bannerUrl: '', logoUrl: 'https://user:pass@images.example.test/x.jpg', videoUrl: 'javascript:alert(1)' } },
      [{ id: 1n, imageUrl: 'https://images.example.test/old.jpg' }]);
    expect(projected.media).toEqual({ logoUrl: null, coverUrl: null, galleryUrls: [], posterUrl: null });
    expect(projected.thumbnail).toBeNull();
    expect(projected.images).toEqual([]);
    for (const value of ['http://images.example.test/x.jpg', 'data:image/png;base64,AA==', 'https://user:pass@images.example.test/x.jpg', 'https://images.example.test/' + 'a'.repeat(501)]) expect(safePublicMediaUrl(value)).toBeNull();
  });

  test('active variants keep their exact integer prices and disabled-only variants do not restore legacy pricing', () => {
    const result = publicServiceView({ id: 1n, shopId: 71n, name: 'Service', priceCents: 6000, durationMin: 30, _count: { variants: 2 }, variants: [], internalNote: 'private' });
    expect(result.hasVariants).toBe(true); expect(result.variants).toEqual([]); expect(result.priceCents).toBe(6000);
    expect(result).not.toHaveProperty('internalNote');
  });

  test('removing an existing favorite remains possible after a shop is hidden', async () => {
    const tx = { $queryRaw: jest.fn(async () => []), userFavorite: { findUnique: jest.fn(async () => ({ id: 3n })), delete: jest.fn(async () => ({})), create: jest.fn() }, shop: { findUnique: jest.fn() } };
    const db = { $transaction: jest.fn(async (work: any) => work(tx)) };
    await expect(new FavoritesService(db as any).toggle('5', '71')).resolves.toEqual({ favorited: false });
    expect(tx.userFavorite.delete).toHaveBeenCalledWith({ where: { id: 3n } });
    expect(tx.shop.findUnique).not.toHaveBeenCalled(); expect(tx.userFavorite.create).not.toHaveBeenCalled();
  });

  test('creating a new favorite is allowed for a published shop whose independent login is suspended', async () => {
    const shop = { ...activeShop(), loginBinding: { userId: 22n, user: { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: null } } };
    const tx = { $queryRaw: jest.fn(async () => []), userFavorite: { findUnique: jest.fn(async () => null), create: jest.fn() }, shop: { findUnique: jest.fn(async () => shop) } };
    const db = { $transaction: jest.fn(async (work: any) => work(tx)) };
    await expect(new FavoritesService(db as any).toggle('5', '71')).resolves.toEqual({ favorited: true });
    expect(tx.userFavorite.create).toHaveBeenCalledWith({ data: { userId: 5n, shopId: 71n } });
  });

  test('creating a new favorite still fails for a truly hidden shop without writing a relationship', async () => {
    const hidden = { ...activeShop(), status: 'SUSPENDED' };
    const tx = { $queryRaw: jest.fn(async () => []), userFavorite: { findUnique: jest.fn(async () => null), create: jest.fn() }, shop: { findUnique: jest.fn(async () => hidden) } };
    const db = { $transaction: jest.fn(async (work: any) => work(tx)) };
    await expect(new FavoritesService(db as any).toggle('5', '71')).rejects.toThrow(NotFoundException);
    expect(tx.userFavorite.create).not.toHaveBeenCalled();
  });
});

describe('Stable short names and explicit legacy mapping', () => {
  test('normalization and canonical path agree; reserved paths and invalid names cannot claim routes', () => {
    expect(normalizeShopShortName('  AngelFootMassage  ')).toBe('angelfootmassage');
    expect(canonicalShopLink('AngelFootMassage')).toEqual({ canonicalShortName: 'angelfootmassage', canonicalPath: '/s/angelfootmassage' });
    for (const value of ['admin', 'merchant', 'api', 'login', 'icons', 'canvaskit', 'pages', 'store-3740', 'hello--world', '../other', 'https://example.test', 'ab', 'a'.repeat(101)]) expect(() => normalizeShopShortName(value)).toThrow(BadRequestException);
    expect(canonicalShopLink('admin').canonicalPath).toBeNull();
  });

  test('a historical alias stays with its original shop and another shop cannot steal it', async () => {
    const tx = { shop: { findFirst: jest.fn(async () => null) }, shopAlias: { findUnique: jest.fn(async () => ({ id: 1n, shopId: 71n, isActive: true })), create: jest.fn(), update: jest.fn() } };
    await expect(reserveShopAlias(tx, 71n, 'old-studio')).resolves.toBe('old-studio');
    expect(tx.shopAlias.create).not.toHaveBeenCalled();
    await expect(reserveShopAlias(tx, 99n, 'old-studio')).rejects.toThrow(ConflictException);
    expect(tx.shopAlias.update).not.toHaveBeenCalled();
  });

  test('unmapped legacy IDs fail without attempting to open a current shop with the same numeric ID', async () => {
    const db = { shopAlias: { findUnique: jest.fn(async () => null) } };
    const service = new ShopsService(db as any); const getShop = jest.spyOn(service, 'getShop');
    await expect(service.resolve({ legacyId: '3740' })).rejects.toThrow(NotFoundException);
    expect(db.shopAlias.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { kind_source_value: { kind: 'LEGACY_ID', source: 'massajoy1', value: '3740' } } }));
    expect(getShop).not.toHaveBeenCalled();
  });

  test('retained 1.0 provenance aliases resolve when a canonical legacy alias has not yet been backfilled', async () => {
    const db = { shopAlias: { findUnique: jest.fn(async (input: any) => input.where.kind_source_value.kind === 'LEGACY_STORE_ID' ? { shopId: 71n, isActive: true } : null) } };
    const service = new ShopsService(db as any); const getShop = jest.spyOn(service, 'getShop').mockResolvedValue({ id: '71' } as any);
    await expect(service.resolve({ legacyId: '3740' })).resolves.toMatchObject({ id: '71' });
    expect(db.shopAlias.findUnique.mock.calls[1][0]).toMatchObject({ where: { kind_source_value: { kind: 'LEGACY_STORE_ID', source: 'Massajoy1.0', value: '3740' } } });
    expect(getShop).toHaveBeenCalledWith('71');
  });

  test('a revoked canonical legacy alias cannot be bypassed through retained provenance', async () => {
    const db = { shopAlias: { findUnique: jest.fn(async () => ({ shopId: 71n, isActive: false })) } };
    const service = new ShopsService(db as any); const getShop = jest.spyOn(service, 'getShop');
    await expect(service.resolve({ legacyId: '3740' })).rejects.toThrow(NotFoundException);
    expect(db.shopAlias.findUnique).toHaveBeenCalledTimes(1);
    expect(getShop).not.toHaveBeenCalled();
  });

  test('old and new names resolve the exact mapped shop and conflicting resolver parameters are rejected', async () => {
    const db = { shopAlias: { findUnique: jest.fn(async () => ({ shopId: 71n, isActive: true })) } };
    const service = new ShopsService(db as any); const getShop = jest.spyOn(service, 'getShop').mockResolvedValue({ id: '71', canonicalPath: '/s/new-studio' } as any);
    await expect(service.resolve({ shortName: 'OLD-STUDIO' })).resolves.toMatchObject({ id: '71', canonicalPath: '/s/new-studio' });
    await expect(service.resolve({ shortName: 'new-studio' })).resolves.toMatchObject({ id: '71' });
    expect(getShop.mock.calls).toEqual([['71'], ['71']]);
    await expect(service.resolve({ shortName: 'new-studio', legacyId: '71' })).rejects.toThrow(BadRequestException);
  });
});
