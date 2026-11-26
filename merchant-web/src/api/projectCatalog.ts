import client from './client';
import { projectCatalogRequestPath, type ProjectCatalogQuery } from '../../../src/utils/projectCatalog';

export async function getProjectCatalog(shopId: string, query: ProjectCatalogQuery, signal?: AbortSignal): Promise<unknown> {
  const { data } = await client.get(projectCatalogRequestPath(shopId, query), { signal, headers: { 'Cache-Control': 'no-cache' } });
  return data;
}
