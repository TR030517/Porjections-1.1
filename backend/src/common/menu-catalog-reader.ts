import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireShopAccess, shopAccessId, type ShopActor } from './shop-access';
import { resolvePriceMenu } from './shop-price-menu-catalog-view';
import { normalizePriceMenu, type PriceMenuBooking, type PriceMenuItem } from './shop-price-menu';
import { catalogSelectionRevision, loadMenuCatalogParents, MENU_CATALOG_LIMITS, MENU_CATALOG_SELECT } from './menu-catalog-snapshot';

export type MenuCatalogKind = 'service' | 'variant' | 'addOn';
export interface ParsedMenuCatalogQuery { kind: MenuCatalogKind; serviceId?: string; q: string; page: number; pageSize: number; }
export interface MenuCatalogItem {
  serviceId: string; variantId?: string; addOnId?: string; serviceName: string; name: string;
  hasVariants: boolean; variantCount: number; addOnCount: number; isActive: boolean; parentIsActive: boolean;
  preview: PriceMenuItem | null; selectionRevision: string;
}
export interface MenuCatalogResult extends ParsedMenuCatalogQuery {
  shopId: string; total: number; hasMore: boolean; canConfigurePolicy: boolean; items: MenuCatalogItem[];
}
const QUERY_KEYS = ['kind', 'serviceId', 'q', 'page', 'pageSize'];
function pageNumber(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new BadRequestException('目录分页须为正整数字符串');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max) throw new BadRequestException('目录分页超出允许范围');
  return result;
}

export function parseMenuCatalogQuery(raw: unknown): ParsedMenuCatalogQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !QUERY_KEYS.includes(key))) throw new BadRequestException('无效的目录查询');
  const query = raw as Record<string, unknown>;
  if (typeof query.kind !== 'string' || !['service', 'variant', 'addOn'].includes(query.kind)) throw new BadRequestException('请选择主项目、规格或附加项目目录');
  if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 100 || /[\u0000-\u001f\u007f]/.test(query.q))) throw new BadRequestException('目录搜索最多100字，不能包含控制字符');
  const serviceId = query.serviceId === undefined ? undefined : shopAccessId(query.serviceId).toString();
  if (query.kind !== 'service' && !serviceId) throw new BadRequestException('读取子目录必须指定本店主项目');
  return { kind: query.kind as MenuCatalogKind, ...(serviceId ? { serviceId } : {}), q: typeof query.q === 'string' ? query.q.trim() : '',
    page: pageNumber(query.page, 1, 100000), pageSize: pageNumber(query.pageSize, 25, MENU_CATALOG_LIMITS.pageSize) };
}

export function menuCatalogPreview(parent: any, selected: any, kind: MenuCatalogKind, shopId: string): PriceMenuItem | null {
  if (kind === 'service' && parent.variants.length > 0) return null;
  const binding: PriceMenuBooking = { serviceId: String(parent.id),
    ...(kind === 'variant' ? { variantId: String(selected.id) } : {}), ...(kind === 'addOn' ? { addOnId: String(selected.id) } : {}) };
  try {
    const item = resolvePriceMenu([{ category: '', items: [{ name: selected.name, priceText: '', booking: binding }] }], [parent], shopId)[0]?.items[0];
    if (!item?.pricing) return null;
    // Validate the canonical preview without discarding its read-only effective
    // availability fields. Invalid legacy rows remain listed, with no invented preview.
    normalizePriceMenu([{ category: '', items: [item] }]);
    return item;
  } catch { return null; }
}
function row(parent: any, selected: any, kind: MenuCatalogKind, shopId: string, revision?: string): MenuCatalogItem {
  return { serviceId: String(parent.id), ...(kind === 'variant' ? { variantId: String(selected.id) } : {}),
    ...(kind === 'addOn' ? { addOnId: String(selected.id) } : {}), serviceName: parent.name, name: selected.name,
    hasVariants: parent.variants.length > 0, variantCount: parent.variants.length, addOnCount: parent.addOns.length,
    isActive: selected.isActive === true, parentIsActive: parent.isActive === true, preview: menuCatalogPreview(parent, selected, kind, shopId),
    selectionRevision: revision ?? catalogSelectionRevision(shopId, parent) };
}
const byNameId = (left: any, right: any) => String(left.name).localeCompare(String(right.name)) || (BigInt(left.id) === BigInt(right.id) ? 0 : BigInt(left.id) < BigInt(right.id) ? -1 : 1);

/** One authorized, consistent, read-only snapshot. This never calls slots or configuration writers. */
export async function readMenuCatalog(db: any, shopId: string, actor: ShopActor, rawQuery: unknown): Promise<MenuCatalogResult> {
  if (!actor || !['ADMIN', 'MERCHANT'].includes(actor.role)) throw new ForbiddenException('仅公司管理员或获授权的商家可读取价目目录');
  const sid = shopAccessId(shopId); shopAccessId(actor.id);
  const query = parseMenuCatalogQuery(rawQuery);
  return db.$transaction(async (tx: any) => {
    const access = await requireShopAccess(tx, sid, actor, 'CATALOG_MANAGE');
    const canConfigurePolicy = access.permissions.includes('RESERVATION_CONFIG');
    const skip = (query.page - 1) * query.pageSize;
    let items: MenuCatalogItem[], total: number;
    if (query.kind === 'service' && query.serviceId) {
      const parent = (await loadMenuCatalogParents(tx, sid, [BigInt(query.serviceId)]))[0];
      if (!parent) throw new NotFoundException('目录主项目不存在或不属于当前门店');
      const needle = query.q.toLocaleLowerCase();
      total = !needle || [parent.name, parent.nameEn].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)) ? 1 : 0;
      items = total && skip === 0 ? [row(parent, parent, query.kind, sid.toString())] : [];
    } else if (query.kind === 'service') {
      const where = { shopId: sid,
        ...(query.q ? { OR: [{ name: { contains: query.q } }, { nameEn: { contains: query.q } }] } : {}) };
      const [parents, count] = await Promise.all([
        tx.shopService.findMany({ where, select: MENU_CATALOG_SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take: query.pageSize }),
        tx.shopService.count({ where }),
      ]);
      // Hashing validates exact IDs, shop ownership and complete child caps.
      items = parents.map((parent: any) => {
        const revision = catalogSelectionRevision(sid, parent);
        return row(parent, parent, query.kind, sid.toString(), revision);
      });
      total = count;
    } else {
      const parents = await loadMenuCatalogParents(tx, sid, [BigInt(query.serviceId!)]);
      const parent = parents[0];
      if (!parent) throw new NotFoundException('目录主项目不存在或不属于当前门店');
      const needle = query.q.toLocaleLowerCase();
      const children = (query.kind === 'variant' ? parent.variants : parent.addOns)
        .filter((child: any) => !needle || String(child.name).toLocaleLowerCase().includes(needle) || String(parent.name).toLocaleLowerCase().includes(needle))
        .sort(byNameId);
      const revision = catalogSelectionRevision(sid, parent);
      total = children.length;
      items = children.slice(skip, skip + query.pageSize).map((child: any) => row(parent, child, query.kind, sid.toString(), revision));
    }
    return { shopId: sid.toString(), ...query, total, hasMore: query.page * query.pageSize < total, canConfigurePolicy, items };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
}

