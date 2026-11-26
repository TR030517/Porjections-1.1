import { BadRequestException } from '@nestjs/common';
import { assertCatalogSelectionPreconditions, catalogSelectionChanged, menuCatalogSources, parseCatalogSelectionPreconditions } from './menu-catalog-preconditions';
import { catalogSelectionRevision } from './menu-catalog-snapshot';
import { savePriceMenuCatalog } from './shop-price-menu-catalog';
import { formatPriceMenuTitle } from './shop-price-menu-pricing';

jest.mock('./shop-access', () => ({ requireShopAccess: jest.fn(async () => ({})) }));
const actor = { id: '1', role: 'ADMIN' }, shop = { id: 10n };
const parent = (id = 20n, shopId = 10n) => ({ id, shopId, name: 'Saved name', category: 'MASSAGE', durationKind: 'TIMED', durationMin: 60,
  priceCents: 9900, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0,
  isActive: true, variants: [] as any[], addOns: [] as any[] });
function item(patch: any = {}) {
  const pricing = { kind: 'TIMED' as const, baseName: 'Explicit name', durationMin: 60, priceCents: 8000, titleMode: 'AUTO' as const, ...patch.pricing };
  return { id: 'chosen', name: formatPriceMenuTitle(pricing), priceText: '', bookingEnabled: true, bookingMode: 'SINGLE' as const, ...patch, pricing };
}
const menu = (...items: any[]) => [{ category: 'Synthetic', items }];
const condition = (row: any, itemId = 'chosen') => ({ itemId, serviceId: String(row.id), expectedSelectionRevision: catalogSelectionRevision(row.shopId, row) });
function fixture(rows = [parent()]) {
  let next = 100n;
  const writes: string[] = [];
  const db: any = {
    shopService: {
      findMany: jest.fn(async ({ where }: any) => rows.filter(row => row.shopId === where.shopId && where.id.in.includes(row.id))),
      findUnique: jest.fn(async ({ where }: any) => rows.find(row => row.id === where.id)),
      create: jest.fn(async ({ data }: any) => { writes.push('service'); const value = { ...parent(next++), ...data }; rows.push(value); return value; }),
      update: jest.fn(async ({ where, data }: any) => { writes.push('service'); const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return row; }),
    },
    shopServiceVariant: {
      create: jest.fn(async ({ data }: any) => { writes.push('variant'); const row = { id: next++, ...data }; rows.find(parent => parent.id === data.serviceId)!.variants.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { writes.push('variant'); const row = rows.flatMap(parent => parent.variants).find(row => row.id === where.id); Object.assign(row, data); return row; }),
    },
    shopServiceAddOn: {
      create: jest.fn(async ({ data }: any) => { writes.push('addOn'); const row = { id: next++, ...data }; rows.find(parent => parent.id === data.serviceId)!.addOns.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { writes.push('addOn'); const row = rows.flatMap(parent => parent.addOns).find(row => row.id === where.id); Object.assign(row, data); return row; }),
    },
    booking: { findFirst: jest.fn(async () => null) }, bookingItem: { findFirst: jest.fn(async () => null) },
  };
  return { rows, db, writes };
}

describe('catalog selection preconditions before any menu writer', () => {
  test('requires source version on new and retargeted links, while unchanged links remain under the old menu CAS', async () => {
    const f = fixture(), next = menu(item({ booking: { serviceId: '20' } }));
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, next, [], undefined)).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED', fields: { chosen: '来源已更新，请重新选择' } } });
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, next, next, undefined)).resolves.toBeInstanceOf(Map);
    const other = menu(item({ booking: { serviceId: '21' } }));
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, next, other, [])).rejects.toMatchObject({ status: 409, response: { fields: { chosen: expect.any(String) } } });
    expect(f.writes).toEqual([]);
  });
  test.each(['price', 'inactive'])('a drifted whole-parent %s rejects the complete batch before even an earlier fresh row is created', async change => {
    const row = parent(); row.variants = [{ id: 30n, serviceId: 20n, name: '60 min', durationMin: 60, priceCents: 9900, currency: 'usd', priceBasis: 'PER_BOOKING', isActive: true }];
    const f = fixture([row]), source = condition(row), next = menu(item({ id: 'fresh', booking: undefined }), item({ booking: { serviceId: '20', variantId: '30' } }));
    if (change === 'price') row.priceCents += 1; else row.variants[0].isActive = false;
    await expect(savePriceMenuCatalog(f.db, shop, next, [], actor, [source])).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED', fields: { chosen: expect.any(String) } } });
    expect(f.writes).toEqual([]); expect(f.db.shopService.create).not.toHaveBeenCalled(); expect(f.db.shopServiceVariant.update).not.toHaveBeenCalled();
  });
  test('a checked first binding preserves deliberate name, amount and duration edits rather than silently importing latest source values', async () => {
    const row = parent(), f = fixture([row]), next = menu(item({ booking: { serviceId: '20' }, pricing: { durationMin: 90, priceCents: 10501 } }));
    const saved = await savePriceMenuCatalog(f.db, shop, next, [], actor, [condition(row)]);
    expect(f.rows[0]).toMatchObject({ name: 'Explicit name', durationMin: 90, priceCents: 10501 });
    expect(saved[0].items[0].pricing).toMatchObject({ baseName: 'Explicit name', durationMin: 90, priceCents: 10501 });
    expect(saved[0].items[0]).not.toHaveProperty('expectedSelectionRevision');
  });
  test('same shop scope is reread; a valid token for another shop never authorizes its parent', async () => {
    const foreign = parent(20n, 99n), f = fixture([foreign]);
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, menu(item({ booking: { serviceId: '20' } })), [], [condition(foreign)])).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED' } });
    expect(f.db.shopService.findMany.mock.calls[0][0].where.shopId).toBe(10n); expect(f.writes).toEqual([]);
  });
  test('extra, duplicate and other-parent conditions cannot attach a selection token to an unrelated row', async () => {
    const a = parent(), b = parent(21n), f = fixture([a, b]), next = menu(item({ booking: { serviceId: '20' } }));
    for (const conditions of [[condition(b)], [condition(a, 'absent')], [condition(a), condition(a)]]) {
      await expect(assertCatalogSelectionPreconditions(f.db, 10n, next, [], conditions)).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED' } });
    }
    expect(f.writes).toEqual([]);
  });
  test('a new AddOn parent always needs a row condition; new numeric variants may rely on an old referenced parent', async () => {
    const row = parent(), f = fixture([row]), addon = menu(item({ pricing: { kind: 'ADD_ON', durationMin: null }, booking: { serviceId: '20' } }));
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, addon, addon, [])).rejects.toMatchObject({ status: 409 });
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, addon, [], [condition(row)])).resolves.toBeInstanceOf(Map);
    const variant = menu(item({ newVariantOf: '20' }));
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, variant, [], [])).rejects.toMatchObject({ status: 409 });
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, variant, menu(item({ id: 'old', booking: { serviceId: '20' } })), [])).resolves.toBeInstanceOf(Map);
  });
  test('draft references to an existing parent reuse its explicit condition, including transitive references and conflict fields', async () => {
    const row = parent(), f = fixture([row]);
    const next = menu(item({ id: 'child', newVariantOf: 'item:middle' }), item({ id: 'root', booking: { serviceId: '20' } }), item({ id: 'middle', newVariantOf: 'item:root' }));
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, next, [], [condition(row, 'root')])).resolves.toBeInstanceOf(Map);
    const token = condition(row, 'root'); row.priceCents += 1;
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, next, [], [token])).rejects.toMatchObject({ status: 409, response: { fields: { root: expect.any(String), child: expect.any(String), middle: expect.any(String) } } });
  });
  test('new draft services have no existing source to fence; cyclic or missing draft references still reject', async () => {
    const f = fixture([]);
    await expect(assertCatalogSelectionPreconditions(f.db, 10n, menu(item({ id: 'root' }), item({ id: 'child', newVariantOf: 'item:root' })), [], [])).resolves.toBeInstanceOf(Map);
    expect(f.db.shopService.findMany).not.toHaveBeenCalled();
    expect(() => menuCatalogSources(menu(item({ id: 'a', newVariantOf: 'item:b' }), item({ id: 'b', newVariantOf: 'item:a' })), [])).toThrow('循环');
    expect(() => menuCatalogSources(menu(item({ newVariantOf: 'item:absent' })), [])).toThrow('不存在');
  });
  test.each([{baseName:'Other name'},{kind:'VARIABLE',durationMin:null},{bookingMode:'COUPLE'}])('inconsistent fresh draft families reject before creating their root (%p)', async (change:any) => {
    const f=fixture([]),root=item({id:'root'}),child=item({id:'child',newVariantOf:'item:root',...(change.bookingMode?{bookingMode:change.bookingMode}:{}),pricing:{...(!change.bookingMode?change:{})},...(change.kind?{reservedDurationMin:60}:{})});
    await expect(savePriceMenuCatalog(f.db,shop,menu(root,child),[],actor)).rejects.toThrow('相同基础名称');expect(f.writes).toEqual([]);
  });
  test('precondition shape is strict and errors contain only row labels, never source price or revision', () => {
    for (const value of [null, {}, [{ itemId: 'x', serviceId: 20, expectedSelectionRevision: 'a'.repeat(64) }], [{ itemId: 'x', serviceId: '20', expectedSelectionRevision: 'a'.repeat(64), nested: {} }]]) expect(() => parseCatalogSelectionPreconditions(value)).toThrow(BadRequestException);
    try { catalogSelectionChanged(['chosen']); } catch (error: any) {
      const body = error.getResponse(); expect(body.fields).toEqual({ chosen: '来源已更新，请重新选择' }); expect(Object.keys(body).sort()).toEqual(['code', 'fields', 'message']);
    }
  });
});

