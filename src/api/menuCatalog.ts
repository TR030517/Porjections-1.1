import { apiRequest } from './session';
import type { ResourceId } from './resources';
import type { MenuCatalogQuery } from '../utils/catalogSelection';
import { menuCatalogRequestPath } from '../utils/menuCatalogRequest';

export function getMenuCatalog(shopId: ResourceId, query: MenuCatalogQuery, signal?: AbortSignal): Promise<unknown> {
  return apiRequest(menuCatalogRequestPath(shopId, query), { signal, cache: 'no-store' });
}
