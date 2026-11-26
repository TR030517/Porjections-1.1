import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { requireShopAccess } from './shop-access';
import { mediaUrl, shopMediaUrls, syncShopMedia } from './managed-media';

jest.mock('./shop-access', () => ({ requireShopAccess: jest.fn() }));
const actor = { id: '3', role: 'MERCHANT' };
const galleryId = '11111111-1111-4111-8111-111111111111', oldId = '22222222-2222-4222-8222-222222222222', newId = '33333333-3333-4333-8333-333333333333';
const menu = (url?: string) => [{ category: 'Synthetic', items: url ? [{ name: 'Synthetic service', priceText: 'Ask in store', imageUrl: url }] : [] }];
function fixture(profile: any, patch: any = {}, allowed = 'CATALOG_MANAGE') {
  const assets = new Map([galleryId, oldId, newId].map(id => [id, { id, owner_id: 3n, shop_owner_id: 9n, shop_id: 10n, scope: 'SHOP', purpose: id === newId ? 'menu' : 'gallery', status: id === newId ? 'STAGED' : 'BOUND', expires_at: new Date('2099-01-01T00:00:00Z'), ...(id === newId ? patch : {}) }]));
  const readAssets: string[] = [], updates: Array<{id:string;status:string}> = [];
  (requireShopAccess as jest.Mock).mockReset().mockImplementation(async (_tx: any, shopId: bigint, _actor: any, permission: string) => {
    if (shopId !== 10n || permission !== allowed) throw new ForbiddenException('Synthetic restricted permission');
    return { shop: { id: 10n, ownerId: 9n, studioProfile: profile } };
  });
  const tx: any = {
    $queryRaw: jest.fn(async (query: any) => {
      if (!query.sql.includes('media_assets')) return [];
      const id = query.values.find((value: any) => typeof value === 'string' && assets.has(value));
      if (id) readAssets.push(id); return id ? [assets.get(id)] : [];
    }),
    $executeRaw: jest.fn(async (query: any) => {
      const id = query.values.find((value: any) => typeof value === 'string' && assets.has(value));
      const status = query.sql.includes("status='ABANDONED'") ? 'ABANDONED' : 'BOUND';
      if (id) { updates.push({ id, status }); assets.get(id)!.status = status; } return 1;
    }),
  };
  const args = (before: any, after: any) => ({ shopId: '10', actor, purpose: 'MENU' as const, previousProfile: before, nextProfile: after, previousUrls: shopMediaUrls(before), nextUrls: shopMediaUrls(after) });
  return { tx, assets, readAssets, updates, args };
}

describe('catalog-only media scope', () => {
  test('MENU authorization binds/releases only menu references and leaves an unchanged gallery untouched', async () => {
    const before = { gallery: [mediaUrl(galleryId)], priceMenu: menu(mediaUrl(oldId)) }, after = { ...before, priceMenu: menu(mediaUrl(newId)) }, f = fixture(before);
    await syncShopMedia(f.tx, f.args(before, after));
    expect((requireShopAccess as jest.Mock).mock.calls[0][3]).toBe('CATALOG_MANAGE');
    expect(f.readAssets).toEqual([newId]); expect(f.updates).toEqual([{ id: newId, status: 'BOUND' }, { id: oldId, status: 'ABANDONED' }]);
    expect(f.assets.get(galleryId)!.status).toBe('BOUND');
  });
  test('removing a menu image never abandons an asset still referenced by the unchanged gallery', async () => {
    const before = { gallery: [mediaUrl(oldId)], priceMenu: menu(mediaUrl(oldId)) }, after = { ...before, priceMenu: menu(mediaUrl(newId)) }, f = fixture(before);
    await syncShopMedia(f.tx, f.args(before, after));
    expect(f.updates).toEqual([{ id: newId, status: 'BOUND' }]); expect(f.assets.get(oldId)!.status).toBe('BOUND');
  });
  test.each([{ logoUrl: mediaUrl(newId) }, { bannerUrl: mediaUrl(newId) }, { gallery: [mediaUrl(oldId), mediaUrl(galleryId)] }])('MENU purpose cannot be used to change profile/logo/banner/gallery state (%p)', async patch => {
    const before = { gallery: [mediaUrl(galleryId), mediaUrl(oldId)], priceMenu: menu() }, after = { ...before, ...patch, priceMenu: menu(mediaUrl(newId)) }, f = fixture(before);
    await expect(syncShopMedia(f.tx, f.args(before, after))).rejects.toThrow(ForbiddenException);
    expect(f.readAssets).toEqual([]); expect(f.updates).toEqual([]);
  });
  test('profile permission stays required by default even when no managed URLs are supplied', async () => {
    const f = fixture({ gallery: [], priceMenu: menu() });
    await expect(syncShopMedia(f.tx, { shopId: '10', actor, previousUrls: [], nextUrls: [] })).rejects.toThrow(ForbiddenException);
    expect((requireShopAccess as jest.Mock).mock.calls[0][3]).toBe('SHOP_SETTINGS_MANAGE'); expect(f.updates).toEqual([]);
  });
  test('a staged menu image must first be saved with catalog permission, then can be reused in the same shop profile', async () => {
    const f = fixture({ gallery: [], priceMenu: menu() }, {}, 'SHOP_SETTINGS_MANAGE');
    const args = { shopId: '10', actor, previousUrls: [], nextUrls: [mediaUrl(newId)] };
    await expect(syncShopMedia(f.tx, args)).rejects.toThrow(ConflictException);
    expect(f.updates).toEqual([]);
    f.assets.get(newId)!.status = 'BOUND';
    await syncShopMedia(f.tx, args);
    expect(f.updates).toEqual([{ id: newId, status: 'BOUND' }]);
  });
  test('a shop can use a bound gallery image in its menu with catalog permission', async () => {
    const before = { gallery: [mediaUrl(galleryId)], priceMenu: menu() };
    const f = fixture(before);
    await syncShopMedia(f.tx, f.args(before, { ...before, priceMenu: menu(mediaUrl(galleryId)) }));
    expect(f.readAssets).toEqual([galleryId]);
    expect(f.updates).toEqual([{ id: galleryId, status: 'BOUND' }]);
  });
  test('MENU purpose requires explicit matching profile proof, not arbitrary URL arrays', async () => {
    const before = { gallery: [], priceMenu: menu() }, f = fixture(before);
    await expect(syncShopMedia(f.tx, { shopId: '10', actor, purpose: 'MENU', previousUrls: [], nextUrls: [] } as any)).rejects.toThrow(BadRequestException);
    await expect(syncShopMedia(f.tx, { ...f.args(before, before), nextUrls: [mediaUrl(newId)] })).rejects.toThrow(BadRequestException);
    expect(f.updates).toEqual([]);
  });
  test.each([{ scope: 'USER' }, { shop_id: 11n }, { owner_id: 4n }, { shop_owner_id: 99n }, { expires_at: new Date(0) }])('avatar/cross-shop/foreign staged/expired media remain unavailable (%p)', async patch => {
    const before = { gallery: [], priceMenu: menu() }, after = { ...before, priceMenu: menu(mediaUrl(newId)) }, f = fixture(before, patch);
    await expect(syncShopMedia(f.tx, f.args(before, after))).rejects.toThrow(ConflictException); expect(f.updates).toEqual([]);
  });
});

