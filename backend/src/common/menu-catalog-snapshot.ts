import { createHash } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';

export const MENU_CATALOG_LIMITS = Object.freeze({ pageSize: 50, variants: 200, addOns: 50, parentBatch: 1000 });
const MAX_ID = 9223372036854775807n;
const SERVICE_FIELDS = ['id', 'shopId', 'name', 'nameEn', 'category', 'durationKind', 'durationMin', 'priceCents', 'priceBasis',
  'participantCount', 'requiredStaffCount', 'requiredRoomType', 'staffBufferMin', 'roomBufferMin', 'description', 'isActive', 'sortOrder', 'createdAt', 'updatedAt'] as const;
const VARIANT_FIELDS = ['id', 'serviceId', 'name', 'durationMin', 'priceCents', 'priceBasis', 'currency', 'isActive', 'sortOrder', 'createdAt', 'updatedAt'] as const;
const ADD_ON_FIELDS = ['id', 'serviceId', 'name', 'description', 'priceCents', 'currency', 'isActive', 'sortOrder', 'createdAt', 'updatedAt'] as const;

/** Explicit catalog fields only: never an account, profile, staff or finance include. */
export const MENU_CATALOG_SELECT = {
  id: true, shopId: true, name: true, nameEn: true, category: true, durationKind: true, durationMin: true, priceCents: true, priceBasis: true,
  participantCount: true, requiredStaffCount: true, requiredRoomType: true, staffBufferMin: true, roomBufferMin: true,
  description: true, isActive: true, sortOrder: true, createdAt: true, updatedAt: true,
  _count: { select: { variants: true, addOns: true } },
  variants: { orderBy: { id: 'asc' }, take: MENU_CATALOG_LIMITS.variants + 1, select: {
    id: true, serviceId: true, name: true, durationMin: true, priceCents: true, priceBasis: true, currency: true, isActive: true,
    sortOrder: true, createdAt: true, updatedAt: true,
  } },
  addOns: { orderBy: { id: 'asc' }, take: MENU_CATALOG_LIMITS.addOns + 1, select: {
    id: true, serviceId: true, name: true, description: true, priceCents: true, currency: true, isActive: true,
    sortOrder: true, createdAt: true, updatedAt: true,
  } },
} as const;

function exactId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'bigint') throw new BadRequestException('目录编号必须为精确的正整数字符串');
  const text = String(value);
  if (!/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > MAX_ID) throw new BadRequestException('目录编号无效');
  return text;
}
function tooLarge(resource: 'services' | 'variants' | 'addOns'): never {
  throw new BadRequestException({ code: 'MENU_CATALOG_TOO_LARGE', resource, message: '本店目录超过完整读取的安全上限，请先整理目录；不会返回截断的来源版本。' });
}
function completeChildren(parent: any, resource: 'variants' | 'addOns'): any[] {
  const rows = parent?.[resource], limit = MENU_CATALOG_LIMITS[resource], count = parent?._count?.[resource];
  if (!Array.isArray(rows)) throw new BadRequestException({ code: 'MENU_CATALOG_INCOMPLETE', message: '目录子项未完整加载，请重新读取。' });
  if (rows.length > limit || typeof count === 'number' && count > limit) tooLarge(resource);
  if (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || count !== rows.length)) {
    throw new BadRequestException({ code: 'MENU_CATALOG_INCOMPLETE', message: '目录子项未完整加载，请重新读取。' });
  }
  return rows;
}
const pick = (row: any, fields: readonly string[]) => Object.fromEntries(fields.map(field => [field,
  field === 'id' || field === 'serviceId' || field === 'shopId' ? exactId(row[field]) : row[field],
]));
const byId = (left: any, right: any) => BigInt(left.id) === BigInt(right.id) ? 0 : BigInt(left.id) < BigInt(right.id) ? -1 : 1;

/** Complete parent and children, including inactive rows. A timestamp alone is never a version. */
export function catalogSelectionRevision(shopId: bigint | string, parent: any): string {
  const sid = exactId(shopId);
  if (!parent || exactId(parent.shopId) !== sid) throw new NotFoundException('目录项目不存在或不属于当前门店');
  const pid = exactId(parent.id);
  const variants = completeChildren(parent, 'variants'), addOns = completeChildren(parent, 'addOns');
  for (const child of [...variants, ...addOns]) {
    if (exactId(child.serviceId) !== pid) throw new NotFoundException('目录子项不存在或不属于当前主项目');
  }
  const value = { shopId: sid, service: pick(parent, SERVICE_FIELDS),
    variants: variants.map(row => pick(row, VARIANT_FIELDS)).sort(byId),
    addOns: addOns.map(row => pick(row, ADD_ON_FIELDS)).sort(byId) };
  const canonical = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item)
    : item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  return createHash('sha256').update('massajoy-menu-catalog-selection:v2-per-order:').update(canonical).digest('hex');
}

/** Call only after authorizing this shop. Every returned parent contains its complete bounded children. */
export async function loadMenuCatalogParents(db: any, shopId: bigint, ids: bigint[]): Promise<any[]> {
  const sid = exactId(shopId);
  if (!Array.isArray(ids) || ids.length > MENU_CATALOG_LIMITS.parentBatch) tooLarge('services');
  const requested = [...new Set(ids.map(value => exactId(value)))];
  if (!requested.length) return [];
  const rows = await db.shopService.findMany({ where: { shopId: BigInt(sid), id: { in: requested.map(value => BigInt(value)) } },
    select: MENU_CATALOG_SELECT, orderBy: { id: 'asc' }, take: requested.length });
  const seen = new Set<string>();
  for (const row of rows) {
    const pid = exactId(row.id);
    if (exactId(row.shopId) !== sid || !requested.includes(pid) || seen.has(pid)) throw new NotFoundException('目录项目不存在或不属于当前门店');
    seen.add(pid);
    catalogSelectionRevision(sid, row);
  }
  return rows;
}

