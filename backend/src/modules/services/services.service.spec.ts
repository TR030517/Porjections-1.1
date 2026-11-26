import { ShopsService } from '../shops/shops.service';
import { ServicesService } from './services.service';

const variant = (patch: any = {}) => ({ id: 30n, serviceId: 20n, name: '60 minutes', isActive: true, durationMin: 60, priceCents: 13057, currency: 'usd', priceBasis: 'PER_BOOKING', ...patch });
const publicShop = { id: 10n, owner: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null }, status: 'APPROVED', deletedAt: null,
  loginBinding: { userId: 2n, user: { id: 2n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: '$2b$10$' + 'a'.repeat(53) } } };
const service = (patch: any = {}) => ({ id: 20n, shopId: 10n, name: 'Synthetic variant service', isActive: true, durationKind: 'TIMED', durationMin: 15,
  priceCents: 0, priceBasis: 'PER_PERSON', participantCount: 1, requiredStaffCount: 2, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0,
  variants: [variant()], _count: { variants: 1 }, shop: { id: 10n, name: 'Synthetic shop' }, therapistServices: [], ...patch });

function fixture(rows: any[]) {
  const db: any = { $queryRaw: jest.fn(async () => [{ id: 10n }]), shop: { findFirst: jest.fn(async () => publicShop), findUnique: jest.fn(async () => publicShop) }, shopService: {
    findMany: jest.fn(async () => rows), findFirst: jest.fn(async () => rows[0]),
  }, therapist: { count: jest.fn(async () => 2), findMany: jest.fn(async () => []) } };
  return { db, shops: new ShopsService(db), services: new ServicesService(db) };
}

describe('public catalogs use selected active variants', () => {
  test('collection reads exclude shops absent from the strict public account predicate', async () => {
    const f = fixture([service()]);
    f.db.$queryRaw.mockResolvedValue([]);
    await expect(f.services.listServices({})).resolves.toEqual([]);
    expect(f.db.shopService.findMany).not.toHaveBeenCalled();
  });

  test('shop list, general list and direct service entry expose a valid60-minute option over an unused15-minute base', async () => {
    const f = fixture([service()]);
    const rows = await Promise.all([f.shops.getShopServices('10'), f.services.listServices({ shopId: '10' })]);
    for (const list of rows) { expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ hasVariants: true, variants: [{ id: '30', durationMin: 60, priceCents: 13057 }] }); }
    expect(await f.services.getService('20')).toMatchObject({ hasVariants: true, variants: [{ id: '30', priceCents: 13057 }] });
  });
  test('an unreadable unused base never prevents serialization of real active variant metadata', async () => {
    const row=service({durationMin:0}),f=fixture([row]);
    const visible=await f.shops.getShopServices('10');
    expect(visible[0]).toMatchObject({hasVariants:true,reservedDurationMin:60,variants:[{id:'30',durationMin:60,priceCents:13057}]});
    expect(row.durationMin).toBe(0);
  });
  test('all-disabled/invalid variants, invalid parent kind and paused parents never restore a valid base', async () => {
    for (const change of [
      { variants: [] }, { variants: [variant({ isActive: false })] }, { variants: [variant({ priceCents: 0 })] },
      { variants: [variant({ currency: 'eur' })] }, { durationKind: null }, { isActive: false },
    ]) {
      const f = fixture([service({ durationMin: 60, priceCents: 8000, ...change })]);
      expect(await f.shops.getShopServices('10')).toEqual([]); expect(await f.services.listServices({ shopId: '10' })).toEqual([]);
      await expect(f.services.getService('20')).rejects.toMatchObject({ status: 404 });
    }
  });
  test('invalid siblings are omitted while valid variant price and amount basis remain unchanged', async () => {
    const f = fixture([service({ variants: [variant(), variant({ id: 31n, priceCents: -1 }), variant({ id: 32n, durationMin: 4 })], _count: { variants: 3 } })]);
    const rows = await f.shops.getShopServices('10');
    expect(rows[0].variants.map((row: any) => [row.id, row.durationMin, row.priceCents, row.priceBasis])).toEqual([['30', 60, 13057, 'PER_BOOKING']]);
  });
  test('shop therapists without legacy mappings expose every same-shop service whose effective variant is valid', async () => {
    const row = service(), db: any = { $queryRaw: async () => [{ id: 10n }], shop: { findFirst: async () => publicShop, findUnique: async () => publicShop }, shopService: { findMany: async () => [row] }, therapist: { findMany: async () => [{ id: 40n, name: 'Synthetic', therapistServices: [] }, { id: 41n, name: 'Other', therapistServices: [] }] } };
    const therapists = await new ShopsService(db).getShopTherapists('10');
    expect(therapists[0].services).toMatchObject([{ serviceId: '20', hasVariants: true, variants: [{ id: '30', durationMin: 60 }] }]);
  });
  test('shop catalog does not offer a two-staff service when active capacity is one', async () => {
    const f=fixture([service(),service({id:21n,requiredStaffCount:1})]);
    f.db.therapist.count.mockResolvedValue(1);
    expect((await f.shops.getShopServices('10')).map(row=>row.id)).toEqual(['21']);
    expect(f.db.therapist.count).toHaveBeenCalledWith({where:{shopId:10n,isActive:true}});
  });
});

