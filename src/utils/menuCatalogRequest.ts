import type { MenuCatalogQuery } from './catalogSelection';

function id(value: unknown): string {
  const result = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  if (!/^[1-9]\d{0,18}$/.test(result) || BigInt(result) > 9223372036854775807n) throw Error('请选择有效的本店目录。');
  return result;
}
/** Build only the authenticated local API path; names never become path segments. */
export function menuCatalogRequestPath(shopId: string | number, query: MenuCatalogQuery): string {
  const shop = id(shopId);
  if (!query || !['service', 'variant', 'addOn'].includes(query.kind) || typeof query.q !== 'string' || query.q.length > 100
    || !Number.isSafeInteger(query.page) || query.page < 1 || query.page > 10000 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 50) throw Error('目录查询条件无效，请重新搜索。');
  if (query.kind !== 'service' && query.serviceId === undefined) throw Error('请先选择本店主项目。');
  const parent = query.serviceId === undefined ? undefined : id(query.serviceId);
  const params = new URLSearchParams({ kind: query.kind, q: query.q, page: String(query.page), pageSize: String(query.pageSize), ...(parent ? { serviceId: parent } : {}) });
  return '/reservation-admin/shops/' + encodeURIComponent(shop) + '/menu-catalog?' + params;
}
