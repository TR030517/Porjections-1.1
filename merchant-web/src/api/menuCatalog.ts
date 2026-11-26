import client from './client';
import type { MenuCatalogQuery } from '../../../src/utils/catalogSelection';
import { menuCatalogRequestPath } from '../../../src/utils/menuCatalogRequest';

export async function getMenuCatalog(shopId: string, query: MenuCatalogQuery, signal?: AbortSignal): Promise<unknown> {
  const { data } = await client.get(menuCatalogRequestPath(shopId, query), { signal, headers: { 'Cache-Control': 'no-cache' } });
  return data;
}
