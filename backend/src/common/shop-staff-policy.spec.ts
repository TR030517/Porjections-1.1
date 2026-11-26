import { ShopsService } from '../modules/shops/shops.service';
import { ServicesService } from '../modules/services/services.service';
import { TherapistsService } from '../modules/therapists/therapists.service';
import { publicShopWhere } from './shop-eligibility';

const service = (id: bigint, shopId: bigint, extra: any = {}) => ({ id, shopId, isActive: true, name: 'Synthetic service ' + id, category: 'MASSAGE',
  durationKind: 'TIMED', durationMin: 60, priceCents: 6000, participantCount: 1, requiredStaffCount: 1, variants: [], addOns: [], _count: { variants: 0 }, ...extra });
function fixture() {
  const shops = [{ id: 10n, name: 'Synthetic A' }, { id: 11n, name: 'Synthetic B' }];
  const staff: any[] = [
    { id: 30n, shopId: 10n, name: 'Synthetic Alice', isActive: true, therapistServices: [], shop: shops[0] },
    { id: 31n, shopId: 10n, name: 'Synthetic Bob', isActive: true, therapistServices: [{ service: service(99n, 11n) }], shop: shops[0] },
    { id: 32n, shopId: 10n, name: 'Inactive', isActive: false, therapistServices: [], shop: shops[0] },
    { id: 33n, shopId: 11n, name: 'Synthetic Other shop', isActive: true, therapistServices: [], shop: shops[1] },
  ];
  const services = [service(20n, 10n), service(21n, 10n, { isActive: false }), service(22n, 10n, { durationMin: 15, priceCents: 0,
    _count: { variants: 2 }, variants: [{ id: 40n, serviceId: 22n, name: 'Active option', durationMin: 60, priceCents: 13057, currency: 'usd', isActive: true },
      { id: 41n, serviceId: 22n, name: 'Inactive option', durationMin: 90, priceCents: 15000, currency: 'usd', isActive: false }] }),
    service(23n, 10n, { _count: { variants: 1 }, variants: [{ id: 42n, serviceId: 23n, durationMin: 60, priceCents: 5000, currency: 'usd', isActive: false }] }), service(99n, 11n)];
  const staffRows = (where: any) => staff.filter(row => (where.id === undefined || row.id === where.id) && (where.shopId === undefined || (typeof where.shopId === 'bigint' ? row.shopId === where.shopId : where.shopId.in?.includes(row.shopId))) && (where.isActive === undefined || row.isActive === where.isActive));
  const serviceRows = (where: any) => services.filter(row => (typeof where.shopId === 'bigint' ? row.shopId === where.shopId : where.shopId?.in ? where.shopId.in.includes(row.shopId) : true)
    && (where.isActive === undefined || row.isActive === where.isActive)).map(row => ({ ...row, shop: shops.find(shop => shop.id === row.shopId), variants: row.variants.filter((variant: any) => variant.isActive) }));
  const publicShop = { id: 10n, status: 'APPROVED', deletedAt: null, owner: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null },
    loginBinding: { userId: 2n, user: { id: 2n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: '$2b$10$' + 'a'.repeat(53) } } };
  const db: any = { $queryRaw: jest.fn(async () => [{ id: 10n }, { id: 11n }]), shop: { findFirst: jest.fn(async ({ where }: any) => shops.find(row => row.id === where.id)), findUnique: jest.fn(async () => publicShop) },
    therapist: { findMany: jest.fn(async ({ where }: any) => staffRows(where)), findFirst: jest.fn(async ({ where }: any) => staffRows(where)[0] ?? null) },
    shopService: { findMany: jest.fn(async ({ where }: any) => serviceRows(where)), findFirst: jest.fn(async ({ where }: any) => serviceRows({ isActive: true }).find(row => row.id === where.id)) },
    therapistService: { findMany: jest.fn(() => { throw Error('Legacy mapping lookup is not admission'); }) } };
  return { db, staff, services, shops: new ShopsService(db), catalog: new ServicesService(db), therapists: new TherapistsService(db) };
}

describe('public same-shop whole-catalog staff projection', () => {
  test('global technician lists exclude shops absent from the strict public account predicate', async () => {
    const f = fixture(); f.db.$queryRaw.mockResolvedValue([]);
    await expect(f.therapists.listTherapists({})).resolves.toEqual([]);
    expect(f.db.therapist.findMany).not.toHaveBeenCalled();
  });

  test('shop staff expose valid active services without links and never another shop or an inactive option', async () => {
    const f = fixture(), rows = await f.shops.getShopTherapists('10');
    expect(rows.map(row => row.id)).toEqual(['30', '31']);
    for (const row of rows) {
      expect(row.serviceAccessMode).toBe('SHOP_ALL'); expect(row.services.map(service => service.id)).toEqual(['20', '22']);
      expect(row.services[1].variants.map((variant: any) => variant.id)).toEqual(['40']);
    }
    expect(f.db.therapist.findMany).toHaveBeenCalledTimes(1); expect(f.db.shopService.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.therapist.findMany.mock.calls[0][0].where).toEqual({ shopId: 10n, isActive: true });
    expect(f.db.therapistService.findMany).not.toHaveBeenCalled();
  });

  test('service detail uses every active same-shop technician, ignoring sparse and foreign legacy links', async () => {
    const f = fixture(), row = await f.catalog.getService('20');
    expect(row.therapists.map(therapist => therapist.id)).toEqual(['30', '31']);
    expect(f.db.therapist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: 10n, isActive: true } }));
    expect(f.db.shopService.findFirst.mock.calls[0][0].include.therapistServices).toBeUndefined();
  });

  test('global technician list reads catalogs once for the complete returned shop set and groups by real shop', async () => {
    const f = fixture(), rows = await f.therapists.listTherapists({});
    expect(rows.map(row => row.id)).toEqual(['30', '31', '33']);
    expect(rows.filter(row => row.shopId === '10').every(row => row.services.every(service => service.shopId === '10'))).toBe(true);
    expect(rows.find(row => row.id === '33')?.services.map(service => service.id)).toEqual(['99']);
    expect(f.db.shopService.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.shopService.findMany.mock.calls[0][0].where).toEqual({ shopId: { in: [10n, 11n] }, isActive: true, shop: publicShopWhere() });
    expect(f.db.therapist.findMany.mock.calls[0][0].where).toEqual({ shopId: { in: [10n, 11n] }, isActive: true, shop: publicShopWhere() });
    expect(f.db.therapist.findMany.mock.calls[0][0].include.therapistServices).toBeUndefined();
  });

  test('direct technician entry and newly added catalog rows require no mapping backfill', async () => {
    const f = fixture(); f.services.push(service(24n, 10n));
    const result = await f.therapists.getTherapist('30');
    expect(result.serviceAccessMode).toBe('SHOP_ALL'); expect(result.services.map(row => row.id)).toEqual(['20', '22', '24']);
    expect(f.db.shopService.findMany.mock.calls[0][0].where).toEqual({ shopId: 10n, isActive: true, shop: publicShopWhere() });
    await expect(f.therapists.getTherapist('32')).rejects.toMatchObject({ status: 404 });
    expect(f.db.therapistService.findMany).not.toHaveBeenCalled();
  });
});
