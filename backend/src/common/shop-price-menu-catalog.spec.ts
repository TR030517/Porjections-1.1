import { catalogSelectionRevision } from './menu-catalog-snapshot';
import { normalizePriceMenu } from './shop-price-menu';
import { formatPriceMenuTitle, type PriceMenuPricing } from './shop-price-menu-pricing';
import { resolvePriceMenu, savePriceMenuCatalog } from './shop-price-menu-catalog';
import { matchesPriceMenuRevision, priceMenuRevision } from './shop-price-menu-revision';

jest.mock('./shop-access', () => ({ requireShopAccess: jest.fn(async () => ({})) }));
const shop = { id: 10n }, actor = { id: '1', role: 'ADMIN' };
function item(patch: any = {}) {
  const pricing: PriceMenuPricing = { kind: 'TIMED', baseName: 'Body Massage', durationMin: 60, priceCents: 8000, titleMode: 'AUTO', ...patch.pricing };
  return { name: formatPriceMenuTitle(pricing), priceText: '', ...patch, pricing };
}
const menu = (...items: any[]) => [{ category: 'Massage', items }];
const selection = (row: any, itemId: string) => ({ itemId, serviceId: String(row.id), expectedSelectionRevision: catalogSelectionRevision(shop.id, row) });
function fixture(initial: any[] = []) {
  const rows = initial.map(row => ({ durationKind: 'TIMED', durationMin: 60, name: 'Body Massage', priceCents: 8000,
    priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, isActive: true, shopId: shop.id, ...row,
    variants: (row.variants ?? []).map((child: any) => ({ serviceId: row.id, ...child })), addOns: (row.addOns ?? []).map((child: any) => ({ serviceId: row.id, ...child })) }));
  let next = 100n;
  const db: any = {
    shopService: {
      findMany: jest.fn(async ({ where }: any) => rows.filter(row => row.shopId === where.shopId && where.id.in.includes(row.id))),
      findUnique: jest.fn(async ({ where }: any) => rows.find(row => row.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => { const row = { id: next++, variants: [], addOns: [], ...data }; rows.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return row; }),
    },
    shopServiceVariant: {
      create: jest.fn(async ({ data }: any) => { const row = { id: next++, ...data }; rows.find(parent => parent.id === data.serviceId)!.variants.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = rows.flatMap(row => row.variants).find(row => row.id === where.id); Object.assign(row, data); return row; }),
    },
    shopServiceAddOn: {
      create: jest.fn(async ({ data }: any) => { const row = { id: next++, ...data }; rows.find(parent => parent.id === data.serviceId)!.addOns.push(row); return row; }),
      update: jest.fn(async ({ where, data }: any) => { const row = rows.flatMap(row => row.addOns).find(row => row.id === where.id); Object.assign(row, data); return row; }),
    },
    booking: { findFirst: jest.fn(async () => null) },
    bookingItem: { findFirst: jest.fn(async () => null) },
  };
  return { db, rows };
}

describe('one catalog behind the menu and booking', () => {
  test('an old client without stable IDs receives a validation response before any catalog writes when hidden rows exist', async () => {
    const f = fixture(), previous = menu({ id: 'hidden', name: 'Hidden legacy', priceText: 'Call us', isVisible: false });
    await expect(savePriceMenuCatalog(f.db, shop, menu({ name: 'Hidden legacy', priceText: 'Call us' }), previous, actor))
      .rejects.toMatchObject({ status: 400, response: { message: expect.stringContaining('稳定编号') } });
    expect(f.db.shopService.findMany).not.toHaveBeenCalled();
    expect(f.db.shopService.create).not.toHaveBeenCalled();
    expect(f.db.shopService.update).not.toHaveBeenCalled();
    expect(f.rows).toEqual([]);
  });
  test('legacy wording and display-only structured projects do not create or enable services', async () => {
    const f = fixture(), source = menu({ name: 'From $80, call first', priceText: '60–90 min' }, item({ pricing: { kind: 'PER_SESSION', durationMin: null } }));
    expect(await savePriceMenuCatalog(f.db, shop, source, [], actor)).toEqual(source);
    expect(f.db.shopService.create).not.toHaveBeenCalled();
  });
  test.each([['SINGLE', 1, 1], ['COUPLE', 2, 2], ['FOUR_HANDS', 1, 2]])('explicit %s uses one total visit price and unchanged minutes', async (bookingMode, participantCount, requiredStaffCount) => {
    const f = fixture();
    const saved = await savePriceMenuCatalog(f.db, shop, menu(item({ bookingEnabled: true, bookingMode })), [], actor);
    expect(f.rows[0]).toMatchObject({ priceBasis: 'PER_BOOKING', participantCount, requiredStaffCount, requiredRoomType: null, priceCents: 8000, durationMin: 60, isActive: true });
    expect(saved[0].items[0]).toMatchObject({ bookingEnabled: true, bookingMode, booking: { serviceId: '100' } });
    expect(saved[0].items[0].id).toBeTruthy();
  });
  test('a non-fixed project needs a separate explicit occupied block and booking mode', async () => {
    const f = fixture(), source = item({ pricing: { kind: 'VARIABLE', durationMin: null }, bookingEnabled: true, bookingMode: 'SINGLE' });
    await expect(savePriceMenuCatalog(f.db, shop, menu(source), [], actor)).rejects.toThrow('占用时间');
    expect(f.db.shopService.create).not.toHaveBeenCalled();
    const saved = await savePriceMenuCatalog(f.db, shop, menu({ ...source, reservedDurationMin: 45 }), [], actor);
    expect(f.rows[0]).toMatchObject({ durationKind: 'VARIABLE', durationMin: 45 });
    expect(saved[0].items[0].pricing?.durationMin).toBeNull();
    expect(saved[0].items[0].reservedDurationMin).toBe(45);
  });
  test('versioned new links preserve explicit first edits; subsequent linked edits change the same one price', async () => {
    const f = fixture([{ id: 20n, name: 'Saved name', priceCents: 9900 }]);
    const linked = await savePriceMenuCatalog(f.db, shop, menu(item({ id: 'linked', booking: { serviceId: '20' }, bookingEnabled: true })), [], actor, [selection(f.rows[0], 'linked')]);
    expect(linked[0].items[0].pricing).toMatchObject({ baseName: 'Body Massage', priceCents: 8000 });
    const changed = { ...linked[0].items[0], pricing: { ...linked[0].items[0].pricing!, priceCents: 10500 } };
    changed.name = formatPriceMenuTitle(changed.pricing);
    const saved = await savePriceMenuCatalog(f.db, shop, menu(changed), linked, actor);
    expect(f.rows[0].priceCents).toBe(10500);
    expect(saved[0].items[0].pricing?.priceCents).toBe(10500);
  });
  test('variant prices stay on their variants and the service keeps one base name', async () => {
    const f = fixture([{ id: 20n, variants: [
      { id: 30n, serviceId: 20n, durationMin: 30, priceCents: 5000, currency: 'usd', isActive: true },
      { id: 31n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: true },
    ] }]);
    const previous = resolvePriceMenu(menu(item({ id: 'a', booking: { serviceId: '20', variantId: '30' } }), item({ id: 'b', booking: { serviceId: '20', variantId: '31' } })), f.rows, shop.id);
    const changed = previous.map(group => ({ ...group, items: group.items.map(row => {
      const pricing = { ...row.pricing!, baseName: 'Deep Tissue', priceCents: row.pricing!.priceCents + 1000 };
      return { ...row, pricing, name: formatPriceMenuTitle(pricing) };
    }) }));
    await savePriceMenuCatalog(f.db, shop, changed, previous, actor);
    expect(f.rows[0]).toMatchObject({ name: 'Deep Tissue', priceCents: 8000 });
    expect(f.rows[0].variants.map((row: any) => row.priceCents)).toEqual([6000, 9000]);
  });
  test('an add-on is attached to its parent and never updates the main price or time', async () => {
    const f = fixture([{ id: 20n }]);
    const saved = await savePriceMenuCatalog(f.db, shop, menu(item({ id: 'stones', bookingEnabled: true, booking: { serviceId: '20' }, pricing: { kind: 'ADD_ON', durationMin: null, baseName: 'Hot stones', priceCents: 1000 } })), [], actor, [selection(f.rows[0], 'stones')]);
    expect(saved[0].items[0].booking).toEqual({ serviceId: '20', addOnId: '100' });
    expect(f.rows[0]).toMatchObject({ durationMin: 60, priceCents: 8000 });
    expect(f.db.shopService.update).not.toHaveBeenCalled();
    expect(f.rows[0].addOns[0]).not.toHaveProperty('durationMin');
  });
  test('cross-shop IDs, unrelated variants and mixed variant/add-on references are rejected', async () => {
    const f = fixture([{ id: 20n, shopId: 99n }, { id: 21n }]);
    await expect(savePriceMenuCatalog(f.db, shop, menu(item({ id: 'foreign', booking: { serviceId: '20' } })), [], actor, [{ itemId:'foreign',serviceId:'20',expectedSelectionRevision:'a'.repeat(64) }])).rejects.toMatchObject({status:409,response:{code:'CATALOG_SELECTION_CHANGED'}});
    await expect(savePriceMenuCatalog(f.db, shop, menu(item({ id: 'wrong-child', booking: { serviceId: '21', variantId: '30' } })), [], actor, [selection(f.rows[1], 'wrong-child')])).rejects.toThrow('不属于');
    expect(() => normalizePriceMenu(menu(item({ booking: { serviceId: '21', variantId: '30', addOnId: '40' } })))).toThrow();
  });
  test('directory price and status edits invalidate an old menu editor even when its JSON is unchanged', () => {
    const f = fixture([{ id: 20n }]), profile = { priceMenu: menu(item({ id: 'a', booking: { serviceId: '20' } })) };
    const token = priceMenuRevision(shop.id, profile, f.rows);
    f.rows[0].priceCents = 9000;
    expect(matchesPriceMenuRevision(shop.id, profile, token, f.rows)).toBe(false);
    const newer = priceMenuRevision(shop.id, profile, f.rows); f.rows[0].isActive = false;
    expect(matchesPriceMenuRevision(shop.id, profile, newer, f.rows)).toBe(false);
    expect(resolvePriceMenu(profile.priceMenu, f.rows, shop.id)[0].items[0].bookingEnabled).toBe(false);
  });
  test('legacy per-person label stays stored while new menu values are one whole-order amount across a mode change', async () => {
    const f = fixture([{ id: 20n, participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE', priceBasis: 'PER_PERSON', priceCents: 5000 }]);
    const previous = resolvePriceMenu(menu(item({ id: 'a', booking: { serviceId: '20' } })), f.rows, shop.id);
    expect(previous[0].items[0].pricing?.priceCents).toBe(5000);
    const changed = { ...previous[0].items[0], bookingMode: 'FOUR_HANDS' as const };
    const saved = await savePriceMenuCatalog(f.db, shop, menu(changed), previous, actor);
    expect(f.rows[0]).toMatchObject({ participantCount: 1, requiredStaffCount: 2, priceBasis: 'PER_PERSON', priceCents: 5000 });
    expect(saved[0].items[0].pricing?.priceCents).toBe(5000);
  });
  test('custom headings survive while their numeric badges come from the directory', () => {
    const f = fixture([{ id: 20n, priceCents: 9500 }]);
    const source = menu(item({ id: 'a', name: 'Signature visit', booking: { serviceId: '20' }, pricing: { titleMode: 'CUSTOM' } }));
    const projected = resolvePriceMenu(source, f.rows, shop.id)[0].items[0];
    expect(projected.name).toBe('Signature visit');
    expect(projected.pricing).toMatchObject({ titleMode: 'CUSTOM', priceCents: 9500 });
  });
  test('explicit draft parent references make 30/60/90 options one service and three variants, even after reordering', async () => {
    const f = fixture();
    const first = item({ id: 'first', bookingEnabled: true, bookingMode: 'SINGLE', pricing: { durationMin: 30, priceCents: 5000 } });
    const second = item({ id: 'second', newVariantOf: 'item:first', bookingEnabled: true, bookingMode: 'SINGLE' });
    const third = item({ id: 'third', newVariantOf: 'item:second', bookingEnabled: true, bookingMode: 'SINGLE', pricing: { durationMin: 90, priceCents: 11000 } });
    const saved = await savePriceMenuCatalog(f.db, shop, menu(third, first, second), [], actor);
    expect(f.db.shopService.create).toHaveBeenCalledTimes(1);
    expect(f.rows[0].variants.map((row: any) => row.durationMin)).toEqual([30, 60, 90]);
    const ids = saved[0].items.map(row => row.booking?.serviceId);
    expect(new Set(ids).size).toBe(1);
    expect(saved[0].items.every(row => !!row.booking?.variantId && !row.newVariantOf)).toBe(true);
  });
  test('new variant source references reject cycles and foreign parents before creating a service', async () => {
    const f = fixture();
    await expect(savePriceMenuCatalog(f.db, shop, menu(item({ id: 'a', newVariantOf: 'item:b' }), item({ id: 'b', newVariantOf: 'item:a' })), [], actor)).rejects.toThrow('循环');
    await expect(savePriceMenuCatalog(f.db, shop, menu(item({ id:'foreign-parent',newVariantOf: '999', bookingEnabled: true, bookingMode: 'SINGLE' })), [], actor)).rejects.toMatchObject({status:409,response:{code:'CATALOG_SELECTION_CHANGED'}});
    expect(f.db.shopService.create).not.toHaveBeenCalled();
  });
  test('removing one variant disables only that option; deleting a last primary project respects future reservations', async () => {
    const f = fixture([{ id: 20n, variants: [
      { id: 30n, serviceId: 20n, durationMin: 30, priceCents: 5000, currency: 'usd', isActive: true },
      { id: 31n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: true },
    ] }]);
    const previous = resolvePriceMenu(menu(item({ id: 'a', booking: { serviceId: '20', variantId: '30' } }), item({ id: 'b', booking: { serviceId: '20', variantId: '31' } })), f.rows, shop.id);
    await savePriceMenuCatalog(f.db, shop, menu(previous[0].items[1]), previous, actor);
    expect(f.rows[0].variants[0].isActive).toBe(false); expect(f.rows[0].variants[1].isActive).toBe(true); expect(f.rows[0].isActive).toBe(true);
    const g = fixture([{ id: 21n }]), original = resolvePriceMenu(menu(item({ id: 'only', booking: { serviceId: '21' } })), g.rows, shop.id);
    g.db.booking.findFirst.mockResolvedValue({ id: 99n });
    await expect(savePriceMenuCatalog(g.db, shop, [], original, actor)).rejects.toThrow('有效未来预约');
    expect(g.rows[0].isActive).toBe(true);
    g.db.booking.findFirst.mockResolvedValue(null);
    expect(await savePriceMenuCatalog(g.db, shop, [], original, actor)).toEqual([]);
    expect(g.rows[0].isActive).toBe(false);
  });
  test('a paused parent keeps configured variant and add-on switches during an unrelated menu save', async () => {
    const f = fixture([{ id: 20n, isActive: false, variants: [
      { id: 30n, serviceId: 20n, durationMin: 30, priceCents: 5000, currency: 'usd', isActive: true },
      { id: 31n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: false },
    ], addOns: [
      { id: 40n, serviceId: 20n, name: 'Oil', priceCents: 1000, currency: 'usd', isActive: true },
      { id: 41n, serviceId: 20n, name: 'Stones', priceCents: 1000, currency: 'usd', isActive: false },
    ] }]);
    const previous = resolvePriceMenu(menu(
      item({ id: 'v-on', booking: { serviceId: '20', variantId: '30' } }),
      item({ id: 'v-off', booking: { serviceId: '20', variantId: '31' } }),
      item({ id: 'a-on', booking: { serviceId: '20', addOnId: '40' }, pricing: { kind: 'ADD_ON', durationMin: null } }),
      item({ id: 'a-off', booking: { serviceId: '20', addOnId: '41' }, pricing: { kind: 'ADD_ON', durationMin: null } }),
    ), f.rows, shop.id);
    expect(previous[0].items.map(row => row.bookingEnabled)).toEqual([true, false, true, false]);
    expect(previous[0].items.every(row => row.bookingAvailable === false && row.bookingUnavailableReason === 'PARENT_PAUSED')).toBe(true);
    const edited = previous.map(group => ({ ...group, items: group.items.map((row, index) => index === 0 ? { ...row, description: 'Only the description changed' } : row) }));
    const saved = await savePriceMenuCatalog(f.db, shop, edited, previous, actor);
    expect(f.rows[0].isActive).toBe(false);
    expect(f.rows[0].variants.map((row: any) => row.isActive)).toEqual([true, false]);
    expect(f.rows[0].addOns.map((row: any) => row.isActive)).toEqual([true, false]);
    for (const call of f.db.shopService.update.mock.calls) expect(call[0].data).not.toHaveProperty('isActive');
    for (const row of saved[0].items) { expect(row).not.toHaveProperty('bookingAvailable'); expect(row).not.toHaveProperty('bookingUnavailableReason'); }
    f.rows[0].isActive = true; // An explicit parent operation restores the configured children.
    expect(resolvePriceMenu(saved, f.rows, shop.id)[0].items.map(row => row.bookingAvailable)).toEqual([true, false, true, false]);
  });
  test('enabling a child or adding a variant never resumes its paused parent or exposes hidden active siblings', async () => {
    const f = fixture([{ id: 20n, isActive: false, variants: [
      { id: 30n, serviceId: 20n, durationMin: 30, priceCents: 5000, currency: 'usd', isActive: false },
      { id: 31n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: true },
    ] }]);
    const previous = resolvePriceMenu(menu(item({ id: 'v', booking: { serviceId: '20', variantId: '30' } })), f.rows, shop.id);
    const enabled = { ...previous[0].items[0], bookingEnabled: true, bookingAvailable: true };
    const saved = await savePriceMenuCatalog(f.db, shop, menu(enabled, item({ id: 'new', newVariantOf: '20', bookingEnabled: true, bookingMode: 'SINGLE', pricing: { durationMin: 90 } })), previous, actor);
    expect(f.rows[0].isActive).toBe(false);
    expect(f.rows[0].variants.map((row: any) => row.isActive)).toEqual([true, true, true]);
    expect(resolvePriceMenu(saved, f.rows, shop.id)[0].items.every(row => row.bookingEnabled === true && row.bookingAvailable === false)).toBe(true);
    for (const call of f.db.shopService.update.mock.calls) expect(call[0].data).not.toHaveProperty('isActive');
  });
  test('single base links still use their own explicit primary switch', async () => {
    const f = fixture([{ id: 20n, isActive: false }]);
    const previous = resolvePriceMenu(menu(item({ id: 'base', booking: { serviceId: '20' } })), f.rows, shop.id);
    const untouched = await savePriceMenuCatalog(f.db, shop, menu({ ...previous[0].items[0], description: 'Display edit' }), previous, actor);
    expect(f.rows[0].isActive).toBe(false);
    const resumed = await savePriceMenuCatalog(f.db, shop, menu({ ...untouched[0].items[0], bookingEnabled: true }), untouched, actor);
    expect(f.rows[0].isActive).toBe(true);
    expect(resolvePriceMenu(resumed, f.rows, shop.id)[0].items[0].bookingAvailable).toBe(true);
  });
  test('read-only availability cannot enable or disable a catalog item and is validated then discarded on write', async () => {
    const f = fixture([{ id: 20n, variants: [{ id: 30n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: false }] }]);
    const previous = resolvePriceMenu(menu(item({ id: 'v', booking: { serviceId: '20', variantId: '30' } })), f.rows, shop.id);
    const spoofed = menu({ ...previous[0].items[0], bookingAvailable: true, bookingUnavailableReason: 'PARENT_PAUSED' });
    const normalized = normalizePriceMenu(spoofed)[0].items[0];
    expect(normalized).not.toHaveProperty('bookingAvailable'); expect(normalized).not.toHaveProperty('bookingUnavailableReason');
    await savePriceMenuCatalog(f.db, shop, spoofed, previous, actor);
    expect(f.rows[0].variants[0].isActive).toBe(false);
    expect(() => normalizePriceMenu(menu(item({ bookingAvailable: 'true' })))).toThrow('bookingAvailable');
    expect(() => normalizePriceMenu(menu(item({ bookingUnavailableReason: 'arbitrary' })))).toThrow('bookingUnavailableReason');
    const withoutSwitch = { ...previous[0].items[0] }; delete withoutSwitch.bookingEnabled;
    f.rows[0].variants[0].isActive = true;
    await savePriceMenuCatalog(f.db, shop, menu(withoutSwitch), previous, actor);
    expect(f.rows[0].variants[0].isActive).toBe(true);
  });
  test('an active add-on is unavailable when all primary variants are disabled without losing its own switch', () => {
    const f = fixture([{ id: 20n, variants: [{ id: 30n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: false }],
      addOns: [{ id: 40n, serviceId: 20n, name: 'Oil', priceCents: 1000, currency: 'usd', isActive: true }] }]);
    const projected = resolvePriceMenu(menu(item({ booking: { serviceId: '20', addOnId: '40' }, pricing: { kind: 'ADD_ON', durationMin: null } })), f.rows, shop.id)[0].items[0];
    expect(projected).toMatchObject({ bookingEnabled: true, bookingAvailable: false, bookingUnavailableReason: 'CONFIGURATION_REQUIRED' });
  });
  test('a new add-on stays configured while its parent remains paused', async () => {
    const f = fixture([{ id: 20n, isActive: false }]);
    const saved = await savePriceMenuCatalog(f.db, shop, menu(item({ id:'oil',booking: { serviceId: '20' }, bookingEnabled: true,
      pricing: { kind: 'ADD_ON', baseName: 'Oil', durationMin: null, priceCents: 1000 } })), [], actor, [selection(f.rows[0], 'oil')]);
    expect(f.rows[0].isActive).toBe(false); expect(f.rows[0].addOns[0].isActive).toBe(true);
    expect(f.db.shopService.update).not.toHaveBeenCalled();
    expect(resolvePriceMenu(saved, f.rows, shop.id)[0].items[0]).toMatchObject({ bookingEnabled: true, bookingAvailable: false, bookingUnavailableReason: 'PARENT_PAUSED' });
  });
  test('converting a paused base service to variants does not silently resume it', async () => {
    const f = fixture([{ id: 20n, isActive: false }]);
    const previous = resolvePriceMenu(menu(item({ id: 'base', booking: { serviceId: '20' } })), f.rows, shop.id);
    const saved = await savePriceMenuCatalog(f.db, shop, menu(previous[0].items[0], item({ id: 'new', newVariantOf: '20', bookingEnabled: true, bookingMode: 'SINGLE', pricing: { durationMin: 90 } })), previous, actor);
    expect(f.rows[0].isActive).toBe(false);
    expect(f.rows[0].variants.map((row: any) => row.isActive)).toEqual([false, true]);
    expect(resolvePriceMenu(saved, f.rows, shop.id)[0].items.map(row => row.bookingAvailable)).toEqual([false, false]);
  });
  test.each([15, 0, 300])('a valid 60-minute variant and its add-on ignore unused base duration %i and zero base price', baseDuration => {
    const f = fixture([{ id: 20n, durationMin: baseDuration, priceCents: 0,
      variants: [{ id: 30n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: true }],
      addOns: [{ id: 40n, serviceId: 20n, name: 'Oil', priceCents: 1000, currency: 'usd', isActive: true }] }]);
    const source = menu(item({ booking: { serviceId: '20', variantId: '30' } }),
      item({ booking: { serviceId: '20', addOnId: '40' }, pricing: { kind: 'ADD_ON', durationMin: null } }));
    expect(resolvePriceMenu(source, f.rows, shop.id)[0].items.map(row => row.bookingAvailable)).toEqual([true, true]);
    f.rows[0].variants[0].isActive = false;
    expect(resolvePriceMenu(source, f.rows, shop.id)[0].items.map(row => row.bookingAvailable)).toEqual([false, false]);
  });
  test.each([{ durationMin: 4 }, { durationMin: 0 }, { durationMin: 300 }, { priceCents: 0 }, { priceCents: -1 }, { priceCents: 10_000_001 }, { currency: 'eur' }])('invalid variant policy %j cannot make its option or add-on available', patch => {
    const f = fixture([{ id: 20n,
      variants: [{ id: 30n, serviceId: 20n, durationMin: 60, priceCents: 8000, currency: 'usd', isActive: true, ...patch }],
      addOns: [{ id: 40n, serviceId: 20n, name: 'Oil', priceCents: 1000, currency: 'usd', isActive: true }] }]);
    const source = menu(item({ booking: { serviceId: '20', variantId: '30' } }),
      item({ booking: { serviceId: '20', addOnId: '40' }, pricing: { kind: 'ADD_ON', durationMin: null } }));
    expect(resolvePriceMenu(source, f.rows, shop.id)[0].items.map(row => row.bookingAvailable)).toEqual([false, false]);
  });
  test.each([4, 0, 300])('legacy services without variants still validate base duration %i', baseDuration => {
    const f = fixture([{ id: 20n, durationMin: baseDuration }]);
    expect(resolvePriceMenu(menu(item({ booking: { serviceId: '20' } })), f.rows, shop.id)[0].items[0].bookingAvailable).toBe(false);
  });
});
