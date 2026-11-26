import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireShopAccess, shopAccessId, type ShopActor } from './shop-access';
import { menuCatalogPreview } from './menu-catalog-reader';
import { catalogSelectionRevision, loadMenuCatalogParents, MENU_CATALOG_LIMITS, MENU_CATALOG_SELECT } from './menu-catalog-snapshot';
import type { PriceMenuItem } from './shop-price-menu';

export interface ProjectCatalogQuery { search: string; status: 'all' | 'active' | 'inactive'; page: number; pageSize: number; serviceId?: string; }
export interface ProjectCatalogVariant {
  id: string; serviceId: string; name: string; durationMin: number | null; priceCents: number | null; priceBasis: string | null;
  currency: string | null; isActive: boolean; sortOrder: number | null; preview: PriceMenuItem | null;
}
export interface ProjectCatalogAddOn {
  id: string; serviceId: string; name: string; description: string | null; priceCents: number | null; currency: string | null;
  isActive: boolean; sortOrder: number | null; preview: PriceMenuItem | null;
}
export interface ProjectCatalogItem {
  id: string; shopId: string; name: string; nameEn: string | null; description: string | null; category: string | null; isActive: boolean;
  durationKind: string | null; durationMin: number | null; priceCents: number | null; priceBasis: string | null;
  participantCount: number | null; requiredStaffCount: number | null; requiredRoomType: string | null; staffBufferMin: number | null; roomBufferMin: number | null;
  sortOrder: number | null; hasVariants: boolean; variantCount: number; addOnCount: number; preview: PriceMenuItem | null; selectionRevision: string;
  variants: ProjectCatalogVariant[]; addOns: ProjectCatalogAddOn[];
}
export interface ProjectCatalogResult extends ProjectCatalogQuery {
  shopId: string; items: ProjectCatalogItem[]; total: number; hasMore: boolean; canManageCatalog: boolean; canConfigurePolicy: boolean;
}
const KEYS = ['search', 'status', 'page', 'pageSize', 'serviceId'];
function pageNumber(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new BadRequestException('项目目录分页须为正整数字符串');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max) throw new BadRequestException('项目目录分页超出允许范围');
  return result;
}
export function parseProjectCatalogQuery(raw: unknown): ProjectCatalogQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !KEYS.includes(key))) throw new BadRequestException('无效的项目目录查询');
  const value = raw as Record<string, unknown>;
  if (value.search !== undefined && (typeof value.search !== 'string' || value.search.length > 100 || /[\u0000-\u001f\u007f]/.test(value.search))) throw new BadRequestException('项目搜索最多100字，不能包含控制字符');
  if (value.status !== undefined && !['all', 'active', 'inactive'].includes(value.status as string)) throw new BadRequestException('请选择全部、启用或停用项目');
  return { search: typeof value.search === 'string' ? value.search.trim() : '', status: value.status as ProjectCatalogQuery['status'] ?? 'all',
    page: pageNumber(value.page, 1, 100000), pageSize: pageNumber(value.pageSize, 25, MENU_CATALOG_LIMITS.pageSize),
    ...(value.serviceId !== undefined ? { serviceId: shopAccessId(value.serviceId).toString() } : {}) };
}

/** Never normalize an unused legacy base into a different price or duration.
 * Explicit fields retain invalid legacy values while previews may be null. */
export function projectRow(parent: any, shopId: string): ProjectCatalogItem {
  const selectionRevision = catalogSelectionRevision(shopId, parent);
  return { id: String(parent.id), shopId: String(parent.shopId), name: parent.name, nameEn: parent.nameEn ?? null,
    description: parent.description ?? null, category: parent.category ?? null, isActive: parent.isActive === true,
    durationKind: parent.durationKind ?? null, durationMin: parent.durationMin ?? null, priceCents: parent.priceCents ?? null, priceBasis: parent.priceBasis ?? null,
    participantCount: parent.participantCount ?? null, requiredStaffCount: parent.requiredStaffCount ?? null, requiredRoomType: parent.requiredRoomType ?? null,
    staffBufferMin: parent.staffBufferMin ?? null, roomBufferMin: parent.roomBufferMin ?? null, sortOrder: parent.sortOrder ?? null,
    hasVariants: parent.variants.length > 0, variantCount: parent.variants.length, addOnCount: parent.addOns.length,
    preview: menuCatalogPreview(parent, parent, 'service', shopId), selectionRevision,
    variants: parent.variants.map((variant: any) => ({ id: String(variant.id), serviceId: String(variant.serviceId), name: variant.name,
      durationMin: variant.durationMin ?? null, priceCents: variant.priceCents ?? null, priceBasis: variant.priceBasis ?? null, currency: variant.currency ?? null,
      isActive: variant.isActive === true, sortOrder: variant.sortOrder ?? null, preview: menuCatalogPreview(parent, variant, 'variant', shopId) })),
    addOns: parent.addOns.map((addOn: any) => ({ id: String(addOn.id), serviceId: String(addOn.serviceId), name: addOn.name, description: addOn.description ?? null,
      priceCents: addOn.priceCents ?? null, currency: addOn.currency ?? null, isActive: addOn.isActive === true, sortOrder: addOn.sortOrder ?? null,
      preview: menuCatalogPreview(parent, addOn, 'addOn', shopId) })),
  };
}

/** A safe subset of either existing catalog or reservation-config access.
 * Only a permission denial may trigger fallback; missing shops/errors propagate. */
async function authorize(tx: any, shopId: bigint, actor: ShopActor) {
  try { return await requireShopAccess(tx, shopId, actor, 'CATALOG_MANAGE'); }
  catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
  return requireShopAccess(tx, shopId, actor, 'RESERVATION_CONFIG');
}

/** One read-only consistent snapshot, with complete bounded children for each
 * paged parent. Total parent count is not truncated to a readiness limit. */
export async function readProjectCatalog(db: any, shopId: string, actor: ShopActor, rawQuery: unknown): Promise<ProjectCatalogResult> {
  if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException('当前账号不可读取本店项目目录');
  const sid = shopAccessId(shopId); shopAccessId(actor.id); const query = parseProjectCatalogQuery(rawQuery);
  return db.$transaction(async (tx: any) => {
    const access = await authorize(tx, sid, actor), skip = (query.page - 1) * query.pageSize;
    let items: ProjectCatalogItem[], total: number;
    if (query.serviceId) {
      const parent = (await loadMenuCatalogParents(tx, sid, [BigInt(query.serviceId)]))[0];
      if (!parent) throw new NotFoundException('项目不存在或不属于当前门店');
      const needle = query.search.toLocaleLowerCase(), match = (query.status === 'all' || parent.isActive === (query.status === 'active'))
        && (!needle || [parent.name, parent.nameEn, parent.description].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)));
      total = match ? 1 : 0; items = match && skip === 0 ? [projectRow(parent, String(sid))] : [];
    } else {
      const where = { shopId: sid, ...(query.status === 'all' ? {} : { isActive: query.status === 'active' }),
        ...(query.search ? { OR: [{ name: { contains: query.search } }, { nameEn: { contains: query.search } }, { description: { contains: query.search } }] } : {}) };
      const [parents, count] = await Promise.all([
        tx.shopService.findMany({ where, select: MENU_CATALOG_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], skip, take: query.pageSize }),
        tx.shopService.count({ where }),
      ]);
      if (!Number.isSafeInteger(count) || count < 0) throw new BadRequestException('项目总数无法核对');
      total = count; items = parents.map((parent: any) => projectRow(parent, String(sid)));
    }
    return { shopId: String(sid), ...query, total, hasMore: query.page * query.pageSize < total,
      canManageCatalog: access.permissions.includes('CATALOG_MANAGE'), canConfigurePolicy: access.permissions.includes('RESERVATION_CONFIG'), items };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
}
