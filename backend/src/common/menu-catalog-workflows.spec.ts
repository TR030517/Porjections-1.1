import 'reflect-metadata';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { MerchantService } from '../modules/merchant/merchant.service';
import { StudioService } from '../modules/studio/studio.service';
import { ReservationsService } from '../modules/reservations/reservations.service';
import { UpdateShopDto } from '../modules/merchant/dto/merchant.dto';
import { catalogSelectionRevision } from './menu-catalog-snapshot';
import { priceMenuRevision } from './shop-price-menu-revision';
import { formatPriceMenuTitle } from './shop-price-menu-pricing';

const editor = { id: '3', role: 'MERCHANT' }, admin = { id: '1', role: 'ADMIN' };
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}
const menu = (...items: any[]) => [{ category: 'Synthetic', items }];
function item(patch: any = {}) {
  const pricing = { kind: 'TIMED' as const, baseName: 'Synthetic source', durationMin: 60, priceCents: 8000, titleMode: 'AUTO' as const, ...patch.pricing };
  return { id: 'chosen', name: formatPriceMenuTitle(pricing), priceText: '', bookingEnabled: true, ...patch, pricing };
}
function fixture() {
  const user = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null });
  let state: any = { users: [user(1n, 'ADMIN'), user(2n), user(3n), user(9n)], shops: [10n, 11n].map(id => ({
    id, ownerId: 9n, name: 'Synthetic ' + id, shortName: 'synthetic-' + id, phone: '+12025550100', address: 'Synthetic street', city: 'Synthetic', state: 'NY', zipCode: '',
    latitude: 0, longitude: 0, status: 'PENDING', timezone: 'UTC', deletedAt: null, businessHours: {}, createdAt: new Date('2030-01-01T00:00:00Z'),
    studioProfile: { priceMenu: [], gallery: [], keepServerField: 'KEEP' },
  })), grant: ['CATALOG_MANAGE'], services: [{ id: 20n, shopId: 10n, name: 'Synthetic source', category: 'MASSAGE', description: '', durationKind: 'TIMED', durationMin: 60, priceCents: 8000,
    priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, isActive: true, variants: [], addOns: [] }], audits: [], assets: [] };
  let next = 100n, failAudit = false;
  const futureVariants = new Set<bigint>(), futureServices = new Set<bigint>();
  const writes: string[] = [];
  const decorateShop = (data: any, value: any) => ({ ...clone(value), shopImages: [], shopServices: clone(data.services.filter((row: any) => row.shopId === value.id)),
    owner: data.users.find((row: any) => row.id === 9n), loginBinding: { userId: value.id === 10n ? 2n : 3n, user: data.users.find((row: any) => row.id === (value.id === 10n ? 2n : 3n)) } });
  function client(data: any): any {
    const services = { findMany: jest.fn(async ({ where }: any) => clone(data.services.filter((row: any) => row.shopId === where.shopId && (!where.id?.in || where.id.in.includes(row.id))))),
      findUnique: jest.fn(async ({ where }: any) => clone(data.services.find((row: any) => row.id === where.id))),
      create: jest.fn(async ({ data: changes }: any) => { writes.push('service'); const row = { id: next++, participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, variants: [], addOns: [], ...changes }; data.services.push(row); return clone(row); }),
      update: jest.fn(async ({ where, data: changes }: any) => { writes.push('service'); const row = data.services.find((row: any) => row.id === where.id); Object.assign(row, changes); return clone(row); }) };
    return {
      $queryRaw: jest.fn(async (query: any) => query.sql?.includes('media_assets') ? data.assets.filter((row: any) => query.values.includes(row.id)) : []),
      $executeRaw: jest.fn(async (query: any) => { writes.push('media'); const row = data.assets.find((asset: any) => query.values.includes(asset.id)); if (row) row.status = query.sql.includes("status='ABANDONED'") ? 'ABANDONED' : 'BOUND'; return 1; }),
      user: { findFirst: jest.fn(async ({ where }: any) => data.users.find((row: any) => row.id === where.id && row.role === where.role && row.status === 'ACTIVE') ?? null) },
      shop: {
        findFirst: jest.fn(async ({ where }: any) => { const row = data.shops.find((row: any) => row.id === where.id && (!where.ownerId || row.ownerId === where.ownerId)); return row ? decorateShop(data, row) : null; }),
        findUnique: jest.fn(async ({ where }: any) => { const row = data.shops.find((row: any) => row.id === where.id); return row ? decorateShop(data, row) : null; }),
        update: jest.fn(async ({ where, data: changes }: any) => { writes.push('shop'); const row = data.shops.find((row: any) => row.id === where.id); Object.assign(row, changes); return decorateShop(data, row); }),
      },
      shopAccountGrant: { findFirst: jest.fn(async ({ where, select }: any) => {
        if (where.targetShopId !== 10n || where.sourceShop?.loginBinding?.is?.userId !== 3n) return null;
        return select ? { sourceShopId: 11n } : { status: 'ACTIVE', sourceShopId: 11n, targetShopId: 10n, permissions: clone(data.grant), sourceShop: decorateShop(data, data.shops[1]) };
      }) },
      shopImage: { findMany: jest.fn(async () => []) }, shopService: services,
      shopServiceVariant: {
        create: jest.fn(async ({ data: changes }: any) => { writes.push('variant'); const row = { id: next++, ...changes }; data.services.find((parent: any) => parent.id === changes.serviceId).variants.push(row); return clone(row); }),
        update: jest.fn(async ({ where, data: changes }: any) => { writes.push('variant'); const row = data.services.flatMap((parent: any) => parent.variants).find((row: any) => row.id === where.id); Object.assign(row, changes); return clone(row); }),
      },
      shopServiceAddOn: {
        create: jest.fn(async ({ data: changes }: any) => { writes.push('addOn'); const row = { id: next++, ...changes }; data.services.find((parent: any) => parent.id === changes.serviceId).addOns.push(row); return clone(row); }),
        update: jest.fn(async ({ where, data: changes }: any) => { writes.push('addOn'); const row = data.services.flatMap((parent: any) => parent.addOns).find((row: any) => row.id === where.id); Object.assign(row, changes); return clone(row); }),
      },
      booking: { findFirst: jest.fn(async ({ where }: any) => futureServices.has(where.AND?.[0]?.OR?.[0]?.serviceId) ? { id: 900n } : null) },
      bookingItem: { findFirst: jest.fn(async ({ where }: any) => futureVariants.has(where.variantId) ? { id: 901n } : null) },
      auditLog: { create: jest.fn(async ({ data: changes }: any) => { writes.push('audit'); if (failAudit) throw Error('Synthetic lifecycle audit failure'); data.audits.push(clone(changes)); return {}; }) },
    };
  }
  const db: any = new Proxy({}, { get: (_target, key) => key === '$transaction' ? async (work: any) => { const staged = clone(state); const result = await work(client(staged)); state = staged; return result; } : client(state)[key] });
  const revision = () => priceMenuRevision(10n, state.shops[0].studioProfile, state.services);
  const source = (itemId = 'chosen', id = 20n) => { const row = state.services.find((row: any) => row.id === id); return { itemId, serviceId: String(id), expectedSelectionRevision: catalogSelectionRevision(10n, row) }; };
  return { db, writes, state: () => state, revision, source, futureVariants, futureServices, failAudit: () => { failAudit = true; }, merchant: new MerchantService(db, {} as any), studio: new StudioService(db), reservations: new ReservationsService(db) };
}

describe('menu picker writes keep separate catalog and policy permissions (transaction substitute)', () => {
  test('CAT-only associated merchant and company pure-menu paths preserve explicit selected edits without profile permission', async () => {
    for (const path of ['merchant', 'company']) {
      const f = fixture(), body = { priceMenu: menu(item({ booking: { serviceId: '20' }, pricing: { baseName: 'Explicit source edit', priceCents: 8101 } })), expectedPriceMenuRevision: f.revision(), catalogSelectionPreconditions: [f.source()] };
      const result = path === 'merchant' ? await f.merchant.updateShop('3', '10', body) : (await f.studio.save('stores', '10', body, editor)).item;
      expect(result.priceMenu[0].items[0].pricing).toMatchObject({ baseName: 'Explicit source edit', priceCents: 8101 });
      expect(f.state().services[0]).toMatchObject({ name: 'Explicit source edit', priceCents: 8101, participantCount: 1, requiredStaffCount: 1, requiredRoomType: null });
      expect(f.state().grant).toEqual(['CATALOG_MANAGE']); expect(f.state().shops[0].studioProfile.keepServerField).toBe('KEEP');
      expect(f.state().shops[0].studioProfile).not.toHaveProperty('catalogSelectionPreconditions');
      expect(f.state().audits[0].detail.fields).toEqual(['priceMenu']); expect(JSON.stringify(f.state().audits, (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('expectedSelectionRevision');
    }
  });
  test('CAT-only merchant binds and releases menu media without touching retained brand media or acquiring settings permission', async () => {
    const f = fixture(), brandId = '11111111-1111-4111-8111-111111111111', menuId = '22222222-2222-4222-8222-222222222222';
    const brandUrl = `/api/v1/upload/media/${brandId}/file`, menuUrl = `/api/v1/upload/media/${menuId}/file`;
    f.state().shops[0].studioProfile.logoUrl = brandUrl;
    f.state().assets.push({ id: brandId, shop_id: 10n, owner_id: 2n, shop_owner_id: 9n, scope: 'SHOP', status: 'BOUND' },
      { id: menuId, shop_id: 10n, owner_id: 3n, shop_owner_id: 9n, scope: 'SHOP', status: 'STAGED', expires_at: new Date(Date.now() + 60000) });
    const brandBefore = clone(f.state().assets[0]);
    const saved = await f.merchant.updateShop('3', '10', { priceMenu: menu(item({ imageUrl: menuUrl, booking: { serviceId: '20' } })), expectedPriceMenuRevision: f.revision(), catalogSelectionPreconditions: [f.source()] });
    expect(Array.isArray(saved.priceMenu)).toBe(true);
    if (!saved.priceMenu) throw Error('Saved menu-media response must include the price menu');
    expect(saved.priceMenu[0].items[0].imageUrl).toBe(menuUrl);
    expect(f.state().assets[1].status).toBe('BOUND'); expect(f.state().assets[0]).toEqual(brandBefore);
    expect(f.state().shops[0].studioProfile.logoUrl).toBe(brandUrl); expect(f.state().grant).toEqual(['CATALOG_MANAGE']);
    await f.merchant.updateShop('3', '10', { priceMenu: [], expectedPriceMenuRevision: f.revision() });
    expect(f.state().assets[1].status).toBe('ABANDONED'); expect(f.state().assets[0]).toEqual(brandBefore);
    expect(f.writes.filter(value => value === 'media')).toHaveLength(2);
  });
  test('CAT-only can create a default SINGLE project, specification and AddOn without gaining reservation policy permission', async () => {
    const f = fixture(), spec = item({ id: 'spec', newVariantOf: '20', pricing: { durationMin: 90, priceCents: 11001 } });
    const extra = item({ id: 'extra', booking: { serviceId: '20' }, pricing: { kind: 'ADD_ON', baseName: 'Oil', durationMin: null, priceCents: 1001 } });
    const saved = await f.merchant.updateShop('3', '10', { priceMenu: menu(spec, extra), expectedPriceMenuRevision: f.revision(), catalogSelectionPreconditions: [f.source('spec'), f.source('extra')] });
    const savedExtra = saved.priceMenu?.[0]?.items.find((row:any)=>row.id==='extra');
    if (!savedExtra?.booking) throw Error('Saved AddOn must have its own catalog binding');
    expect(savedExtra.booking).toMatchObject({serviceId:'20',addOnId:expect.any(String)});
    expect(savedExtra.booking).not.toHaveProperty('variantId');
    expect(f.state().services[0].variants.find((row:any)=>row.durationMin===60).isActive).toBe(false);
    expect(f.state().services[0].variants.some((row: any) => row.durationMin === 90 && row.priceCents === 11001)).toBe(true);
    expect(f.state().services[0].addOns).toMatchObject([{ name: 'Oil', priceCents: 1001 }]); expect(f.state().grant).toEqual(['CATALOG_MANAGE']);
    const fresh = fixture();
    await fresh.merchant.updateShop('3', '10', { priceMenu: menu(item({ id: 'fresh' })), expectedPriceMenuRevision: fresh.revision() });
    expect(fresh.state().services.find((row: any) => row.id !== 20n)).toMatchObject({ participantCount: 1, requiredStaffCount: 1, requiredRoomType: null });
  });
  test('CAT-only can bind and reprice an existing COUPLE variant while retaining its two-person policy', async () => {
    const f = fixture(), row = f.state().services[0];
    Object.assign(row, { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE', isActive: false,
      variants: [{ id: 30n, serviceId: 20n, name: '60 min', durationMin: 60, priceCents: 20001, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true }] });
    await f.merchant.updateShop('3', '10', { priceMenu: menu(item({ booking: { serviceId: '20', variantId: '30' }, bookingMode: 'COUPLE', pricing: { priceCents: 21001 } })), expectedPriceMenuRevision: f.revision(), catalogSelectionPreconditions: [f.source()] });
    expect(f.state().services[0]).toMatchObject({ participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE', isActive: false });
    expect(f.state().services[0].variants[0].priceCents).toBe(21001);
  });
  test('CAT-only mixed profile changes, booking mode changes and dedicated policy updates reject with no committed business write', async () => {
    const f = fixture(), unchanged = clone(f.state());
    await expect(f.merchant.updateShop('3', '10', { priceMenu: [], expectedPriceMenuRevision: f.revision(), phone: '+12025550199' })).rejects.toThrow(ForbiddenException);
    await expect(f.merchant.updateShop('3', '10', { priceMenu: [], expectedPriceMenuRevision: f.revision(), address: 'Other address' })).rejects.toThrow(ForbiddenException);
    for (const changes of [{ logoUrl: 'https://example.invalid/logo.webp' }, { bannerUrl: 'https://example.invalid/banner.webp' }, { gallery: ['https://example.invalid/gallery.webp'] }]) {
      await expect(f.merchant.updateShop('3', '10', { priceMenu: [], expectedPriceMenuRevision: f.revision(), ...changes })).rejects.toThrow(ForbiddenException);
    }
    const source = f.source('changed');
    await expect(f.merchant.updateShop('3', '10', { priceMenu: menu(item({ id: 'fresh' }), item({ id: 'changed', booking: { serviceId: '20' }, bookingMode: 'COUPLE' })), expectedPriceMenuRevision: f.revision(), catalogSelectionPreconditions: [source] })).rejects.toThrow(ForbiddenException);
    await expect(f.reservations.policy('10', '20', editor, { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' })).rejects.toThrow(ForbiddenException);
    expect(f.state()).toEqual(unchanged); expect(f.writes).toEqual([]);
  });
  test('new source drift passes the old unlinked menu CAS but rejects before service/profile/media/audit writes', async () => {
    const f = fixture(), source = f.source(), oldMenuRevision = f.revision();
    f.state().services[0].priceCents = 9000; const before = clone(f.state());
    expect(f.revision()).toBe(oldMenuRevision);
    await expect(f.merchant.updateShop('3', '10', { priceMenu: menu(item({ booking: { serviceId: '20' } })), expectedPriceMenuRevision: oldMenuRevision, catalogSelectionPreconditions: [source] })).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED', fields: { chosen: expect.any(String) } } });
    expect(f.state()).toEqual(before); expect(f.writes).toEqual([]);
  });
  test('real UpdateShopDto retains top-level conditions for the service parser and never accepts nested private writes', async () => {
    const f = fixture(), pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
    const body = { priceMenu: menu(item({ booking: { serviceId: '20' } })), expectedPriceMenuRevision: f.revision(), catalogSelectionPreconditions: [f.source()] };
    const dto = await pipe.transform(body, { type: 'body', metatype: UpdateShopDto });
    expect(dto.catalogSelectionPreconditions).toEqual(body.catalogSelectionPreconditions);
    await f.merchant.updateShop('3', '10', dto);
    expect(f.state().shops[0].studioProfile.priceMenu[0].items[0].booking.serviceId).toBe('20');
    await expect(pipe.transform({ ...body, studioProfile: {} }, { type: 'body', metatype: UpdateShopDto })).rejects.toThrow();
  });
});

describe('draft family materialization and option-only removal through real save transactions', () => {
  const raw = (extra: any = {}) => ({ id: 'earlier', name: 'Original display wording', priceText: 'Ask in store', description: 'Keep original description', imageUrl: 'https://example.invalid/earlier.jpg', bookingEnabled: false, ...extra });
  const later = (extra: any = {}) => item({ id: 'later', newVariantOf: 'item:earlier', pricing: { durationMin: 90, priceCents: 11001 }, ...extra });
  const save = async (f: ReturnType<typeof fixture>, value: any, path = 'merchant', extra: any = {}) => {
    const body = { priceMenu: value, expectedPriceMenuRevision: f.revision(), ...extra };
    return path === 'company' ? (await f.studio.save('stores', '10', body, admin)).item : f.merchant.updateShop('3', '10', body);
  };

  test.each(['merchant', 'company'])('an inactive structured60 ancestor and active90 child save as independent variants of one active parent (%s)', async path => {
    const f = fixture(), earlier = item({ id: 'earlier', bookingEnabled: false, pricing: { durationMin: 60, priceCents: 8001 } });
    const saved = await save(f, menu(earlier, later()), path), family = f.state().services.find((row: any) => String(row.id) === saved.priceMenu[0].items[1].booking.serviceId);
    expect(f.state().services).toHaveLength(2); expect(family.isActive).toBe(true);
    expect(family.variants.map((row: any) => [row.durationMin, row.priceCents, row.isActive])).toEqual([[60, 8001, false], [90, 11001, true]]);
    expect(saved.priceMenu[0].items.map((row: any) => row.bookingEnabled)).toEqual([false, true]);
    expect(new Set(saved.priceMenu[0].items.map((row: any) => row.booking.serviceId)).size).toBe(1);
    await save(f, saved.priceMenu, path);
    expect(f.state().services).toHaveLength(2); expect(f.state().services.find((row: any) => row.id === family.id).variants).toHaveLength(2);
  });

  test.each(['unstructured', 'short-and-zero', 'non-fixed-without-block'])('display-only %s ancestor retains original display fields and stable pending source across saves and a third variant', async kind => {
    const f = fixture(), earlier = kind === 'unstructured' ? raw() : item({ id: 'earlier', bookingEnabled: false, description: 'Keep original description', imageUrl: 'https://example.invalid/earlier.jpg',
      pricing: kind === 'short-and-zero' ? { durationMin: 15, priceCents: 0 } : { kind: 'VARIABLE', durationMin: null, priceCents: 9001 } });
    const enabled = kind === 'non-fixed-without-block' ? later({ pricing: { kind: 'VARIABLE', durationMin: null, priceCents: 11001 }, reservedDurationMin: 90 }) : later();
    const saved = await save(f, menu(earlier, enabled)), first = saved.priceMenu[0].items[0], chosen = saved.priceMenu[0].items[1], sid = chosen.booking.serviceId;
    for (const key of ['name', 'priceText', 'description', 'imageUrl', 'pricing']) expect(first[key]).toEqual((earlier as any)[key]);
    expect(first.booking).toBeUndefined(); expect(first.bookingEnabled).toBe(false); expect(first.newVariantOf).toBe(sid);
    const family = f.state().services.find((row: any) => String(row.id) === sid);
    expect(family).toMatchObject({ durationMin: 90, priceCents: 11001, isActive: true });
    expect(family.variants.map((row: any) => [row.durationMin, row.priceCents, row.isActive])).toEqual([[90, 11001, true]]);
    const again = await save(f, saved.priceMenu);
    const third = item({ id: 'third', newVariantOf: first.newVariantOf, pricing: { kind: chosen.pricing.kind, durationMin: chosen.pricing.kind === 'TIMED' ? 120 : null, priceCents: 14003 },
      ...(chosen.pricing.kind !== 'TIMED' ? { reservedDurationMin: 120 } : {}) });
    const final = await save(f, menu(...again.priceMenu[0].items, third));
    expect(final.priceMenu[0].items[2].booking.serviceId).toBe(sid); expect(final.priceMenu[0].items[0].newVariantOf).toBe(sid);
    expect(f.state().services).toHaveLength(2);
    expect(f.state().services.find((row: any) => String(row.id) === sid).variants.map((row: any) => [row.durationMin, row.priceCents, row.isActive])).toEqual([[90, 11001, true], [120, 14003, true]]);
  });

  test.each([{ pricing: { baseName: 'Another family' } }, { pricing: { kind: 'VARIABLE', durationMin: null } }, { bookingMode: 'COUPLE' }])('all structured ancestors are checked before the first unrelated write (%p)', async change => {
    const f = fixture(), before = clone(f.state()), earlier = item({ id: 'earlier', bookingEnabled: false, ...change });
    await expect(save(f, menu(item({ id: 'unrelated' }), earlier, later({ bookingMode: 'SINGLE' })))).rejects.toThrow('相同基础名称');
    expect(f.state()).toEqual(before); expect(f.writes).toEqual([]);
  });

  test('existing paused canonical parent and disabled siblings are never resumed by a new enabled draft descendant', async () => {
    const f = fixture(); Object.assign(f.state().services[0], { isActive: false, variants: [{ id: 30n, serviceId: 20n, name: 'Earlier', durationMin: 60, priceCents: 8000, currency: 'usd', priceBasis: 'PER_BOOKING', isActive: false }] });
    const earlier = item({ id: 'earlier', booking: { serviceId: '20', variantId: '30' }, bookingEnabled: false });
    const saved = await save(f, menu(earlier, later()), 'merchant', { catalogSelectionPreconditions: [f.source('earlier')] });
    expect(f.state().services).toHaveLength(1); expect(f.state().services[0].isActive).toBe(false);
    expect(f.state().services[0].variants.map((row: any) => row.isActive)).toEqual([false, true]);
    expect(saved.priceMenu[0].items[1].booking.serviceId).toBe('20');
  });

  test('foreign canonical ancestry and stale menu CAS reject before any materialized family writer', async () => {
    const f = fixture(); f.state().services.push({ ...clone(f.state().services[0]), id: 21n, shopId: 11n });
    const before = clone(f.state());
    await expect(save(f, menu(raw({ newVariantOf: '21' }), later()), 'merchant', { catalogSelectionPreconditions: [{ itemId: 'earlier', serviceId: '21', expectedSelectionRevision: catalogSelectionRevision(11n, f.state().services[1]) }] })).rejects.toMatchObject({ status: 409, response: { code: 'CATALOG_SELECTION_CHANGED' } });
    await expect(save(f, menu(raw(), later()), 'company', { expectedPriceMenuRevision: 'a'.repeat(64) })).rejects.toMatchObject({ status: 409, response: { code: 'PRICE_MENU_CHANGED' } });
    expect(f.state()).toEqual(before); expect(f.writes).toEqual([]);
  });

  function existingFamily(f: ReturnType<typeof fixture>) {
    Object.assign(f.state().services[0], { variants: [
      { id: 30n, serviceId: 20n, name: 'Listed60', durationMin: 60, priceCents: 8000, currency: 'usd', priceBasis: 'PER_BOOKING', isActive: true },
      { id: 31n, serviceId: 20n, name: 'Unlisted90', durationMin: 90, priceCents: 11000, currency: 'usd', priceBasis: 'PER_BOOKING', isActive: true },
    ], addOns: [{ id: 40n, serviceId: 20n, name: 'Oil', priceCents: 1000, currency: 'usd', isActive: true }, { id: 41n, serviceId: 20n, name: 'Unlisted extra', priceCents: 1500, currency: 'usd', isActive: true }] });
    const listed = item({ id: 'listed', booking: { serviceId: '20', variantId: '30' } }), extra = item({ id: 'oil', booking: { serviceId: '20', addOnId: '40' }, pricing: { kind: 'ADD_ON', baseName: 'Oil', durationMin: null, priceCents: 1000 } });
    f.state().shops[0].studioProfile.priceMenu = menu(listed, extra);
    return { listed, extra };
  }

  test.each(['merchant', 'company'])('removing the last listed variant/add-on stops only these options and keeps unlisted siblings and parent active (%s)', async path => {
    const f = fixture(); existingFamily(f); await save(f, [], path);
    const parent = f.state().services[0]; expect(parent.isActive).toBe(true);
    expect(parent.variants.map((row: any) => row.isActive)).toEqual([false, true]); expect(parent.addOns.map((row: any) => row.isActive)).toEqual([false, true]);
  });

  test('one remaining duplicate binding protects the exact option; stale legacy base links cannot pause a variant parent', async () => {
    const f = fixture(), { listed, extra } = existingFamily(f), duplicate = { ...clone(listed), id: 'duplicate' };
    f.state().shops[0].studioProfile.priceMenu = menu(listed, duplicate, extra);
    await save(f, menu(duplicate, extra));
    expect(f.state().services[0].variants.map((row: any) => row.isActive)).toEqual([true, true]);
    const g = fixture(); existingFamily(g); g.state().shops[0].studioProfile.priceMenu = menu(item({ id: 'legacy-base', booking: { serviceId: '20' } }));
    await save(g, []); expect(g.state().services[0].isActive).toBe(true); expect(g.state().services[0].variants.every((row: any) => row.isActive)).toBe(true);
  });

  test.each(['remove', 'disable', 'minutes'])('future-bound option %s rejects with complete transaction rollback, including earlier new family writers', async operation => {
    const f = fixture(), { listed, extra } = existingFamily(f); f.futureVariants.add(30n); const before = clone(f.state());
    const changed = operation === 'remove' ? [] : [{ ...listed, ...(operation === 'disable' ? { bookingEnabled: false } : { pricing: { ...listed.pricing, durationMin: 90 }, name: formatPriceMenuTitle({ ...listed.pricing, durationMin: 90 }) }) }];
    await expect(save(f, menu(raw(), later(), ...changed, extra))).rejects.toThrow('未来预约');
    expect(f.state()).toEqual(before); expect(f.state().shops[0].studioProfile.priceMenu).toEqual(before.shops[0].studioProfile.priceMenu);
    expect(f.state().audits).toEqual(before.audits);
  });

  test('late audit failure rolls all newly materialized identity/options back with the menu', async () => {
    const f = fixture(), before = clone(f.state()); f.failAudit();
    await expect(save(f, menu(raw(), later()))).rejects.toThrow('Synthetic lifecycle audit failure');
    expect(f.state()).toEqual(before);
  });
});

