import { BadRequestException, NotFoundException } from '@nestjs/common';
import { catalogSelectionRevision, loadMenuCatalogParents, MENU_CATALOG_LIMITS, MENU_CATALOG_SELECT } from './menu-catalog-snapshot';

function parent() {
  return { id: 20n, shopId: 10n, name: 'Synthetic massage', nameEn: null, category: 'MASSAGE', description: 'Catalog text',
    durationKind: 'TIMED', durationMin: 15, priceCents: 0, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 2,
    requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, isActive: true, sortOrder: 0,
    variants: [{ id: 30n, serviceId: 20n, name: '60 minutes', durationMin: 60, priceCents: 13057, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true, sortOrder: 0 },
      { id: 31n, serviceId: 20n, name: '90 minutes', durationMin: 90, priceCents: 16057, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: false, sortOrder: 1 }],
    addOns: [{ id: 40n, serviceId: 20n, name: 'Oil', description: 'Catalog extra', priceCents: 1001, currency: 'usd', isActive: true, sortOrder: 0 }] };
}

describe('complete menu catalog selection version', () => {
  test('array order and private unrelated fields never change a canonical catalog version', () => {
    const before = parent(), digest = catalogSelectionRevision(10n, before);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(catalogSelectionRevision('10', { ...before, variants: [...before.variants].reverse(), ownerId: 99n, studioProfile: { private: 'hidden' } })).toBe(digest);
  });
  test.each(['inactivePrice', 'inactiveState', 'addOnPrice', 'addOnState', 'staffCount', 'durationKind', 'priceBasis', 'roomBuffer', 'parentState', 'description'])('version includes complete parent and inactive sibling state (%s)', field => {
    const row = parent(), before = catalogSelectionRevision(10n, row);
    if (field === 'inactivePrice') row.variants[1].priceCents++;
    if (field === 'inactiveState') row.variants[1].isActive = true;
    if (field === 'addOnPrice') row.addOns[0].priceCents++;
    if (field === 'addOnState') row.addOns[0].isActive = false;
    if (field === 'staffCount') row.requiredStaffCount = 1;
    if (field === 'durationKind') row.durationKind = 'VARIABLE';
    if (field === 'priceBasis') row.priceBasis = 'PER_PERSON';
    if (field === 'roomBuffer') row.roomBufferMin = 15;
    if (field === 'parentState') row.isActive = false;
    if (field === 'description') row.description = 'Edited catalog text';
    expect(catalogSelectionRevision(10n, row)).not.toBe(before);
  });
  test('an exact large ID is preserved, and numeric or foreign IDs cannot form a token', () => {
    const row: any = parent(); row.id = 9223372036854775807n;
    for (const item of [...row.variants, ...row.addOns]) item.serviceId = row.id;
    expect(catalogSelectionRevision('10', row)).toMatch(/^[a-f0-9]{64}$/);
    row.id = Number.MAX_SAFE_INTEGER + 1;
    expect(() => catalogSelectionRevision(10n, row)).toThrow(BadRequestException);
    expect(() => catalogSelectionRevision('11', parent())).toThrow(NotFoundException);
    const foreign = parent(); foreign.variants[0].serviceId = 21n;
    expect(() => catalogSelectionRevision(10n, foreign)).toThrow(NotFoundException);
  });
  test.each(['variants', 'addOns'] as const)('never hashes a truncated or oversized %s relation', kind => {
    const row: any = parent(), limit = MENU_CATALOG_LIMITS[kind];
    row[kind] = Array.from({ length: limit + 1 }, (_, index) => ({ id: BigInt(100 + index), serviceId: row.id }));
    try { catalogSelectionRevision(10n, row); throw Error('Expected cap rejection'); }
    catch (error: any) { expect(error.getResponse?.()).toMatchObject({ code: 'MENU_CATALOG_TOO_LARGE', resource: kind }); }
    row[kind] = []; row._count = { [kind]: 1 };
    try { catalogSelectionRevision(10n, row); throw Error('Expected incomplete rejection'); }
    catch (error: any) { expect(error.getResponse?.()).toMatchObject({ code: 'MENU_CATALOG_INCOMPLETE' }); }
  });
  test('a loader uses only exact current-shop IDs and cap+1 relations, preserving inactive rows', async () => {
    const row = parent(), findMany = jest.fn(async () => [row]), db = { shopService: { findMany } };
    expect(await loadMenuCatalogParents(db, 10n, [20n, 20n])).toEqual([row]);
    expect(findMany).toHaveBeenCalledWith({ where: { shopId: 10n, id: { in: [20n] } }, select: MENU_CATALOG_SELECT, orderBy: { id: 'asc' }, take: 1 });
    expect(MENU_CATALOG_SELECT.variants.take).toBe(MENU_CATALOG_LIMITS.variants + 1);
    expect(MENU_CATALOG_SELECT.addOns.take).toBe(MENU_CATALOG_LIMITS.addOns + 1);
    expect(MENU_CATALOG_SELECT.variants).not.toHaveProperty('where.isActive');
    expect(MENU_CATALOG_SELECT.addOns).not.toHaveProperty('where.isActive');
    expect(MENU_CATALOG_SELECT).not.toHaveProperty('studioProfile'); expect(MENU_CATALOG_SELECT).not.toHaveProperty('therapists');
  });
  test('a loader cannot leak a foreign or unrequested parent even if a delegate returns it', async () => {
    const row = parent(); row.shopId = 11n;
    await expect(loadMenuCatalogParents({ shopService: { findMany: async () => [row] } }, 10n, [20n])).rejects.toThrow(NotFoundException);
    await expect(loadMenuCatalogParents({ shopService: { findMany: async () => [parent()] } }, 10n, [21n])).rejects.toThrow(NotFoundException);
  });
});

