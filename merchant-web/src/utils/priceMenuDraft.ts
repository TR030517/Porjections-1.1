import { priceMenuFromShop, validatePriceMenu, type PriceMenuGroup } from '../../../src/utils/priceMenu';
import { conditionForMenu, type CatalogSelectionPrecondition } from '../../../src/utils/catalogSelection';
import type { ProjectMenuAvailability } from '../../../src/utils/projectCatalog';

export function priceMenuSnapshot(shop: { id: string; priceMenu?: PriceMenuGroup[]; studioProfile?: Record<string, unknown>; priceMenuRevision?: string }, expectedShopId: string) {
  if (String(shop?.id) !== expectedShopId || !Array.isArray(shop.priceMenu) || typeof shop.priceMenuRevision !== 'string' || !/^[a-f0-9]{64}$/.test(shop.priceMenuRevision)) throw new Error('无法核对本店价目或编辑版本，请保留草稿并载入最新价目。');
  return { priceMenu: validatePriceMenu(priceMenuFromShop(shop)), revision: shop.priceMenuRevision };
}

/** A missing/failed menu read never proves that the authorized catalog is unlisted. */
export function priceMenuReadAvailability(shop: Parameters<typeof priceMenuSnapshot>[0], expectedShopId: string, canManageCatalog: boolean): ProjectMenuAvailability {
  if (!canManageCatalog) return { status: 'unavailable', reason: 'permission' };
  try { priceMenuSnapshot(shop, expectedShopId); return { status: 'known' }; }
  catch { return { status: 'unavailable', reason: 'error' }; }
}

export function priceMenuSavePayload(value: PriceMenuGroup[], revision: string, paste: string, selections: readonly CatalogSelectionPrecondition[] = []) {
  if (paste.length) throw new Error('粘贴内容尚未追加，请先预览并追加，或清除粘贴内容后再保存。');
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('缺少本店编辑版本，请先载入最新价目再保存。');
  const catalogSelectionPreconditions = conditionForMenu(value, selections);
  return { priceMenu: validatePriceMenu(value), expectedPriceMenuRevision: revision, ...(catalogSelectionPreconditions.length ? { catalogSelectionPreconditions } : {}) };
}

export function isPriceMenuConflict(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  return response?.status === 409 && response.data?.code === 'PRICE_MENU_CHANGED';
}
