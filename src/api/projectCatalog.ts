import { apiRequest } from './session';
import { projectCatalogRequestPath, type ProjectCatalogQuery } from '../utils/projectCatalog';
export function getProjectCatalog(shopId: string | number, query: ProjectCatalogQuery, signal?: AbortSignal): Promise<unknown> {
  return apiRequest(projectCatalogRequestPath(shopId, query), { signal, cache: 'no-store' });
}
