import { BadRequestException, ConflictException } from '@nestjs/common';
import { managedPriceMenu, type PriceMenuGroup, type PriceMenuItem } from './shop-price-menu';
import { catalogSelectionRevision, loadMenuCatalogParents } from './menu-catalog-snapshot';

export type CatalogSelectionPrecondition = { itemId: string; serviceId: string; expectedSelectionRevision: string };
const ITEM_ID = /^[a-zA-Z0-9_-]{1,64}$/, ID = /^[1-9]\d{0,18}$/, REVISION = /^[a-f0-9]{64}$/;

export function isPriceMenuOnlyUpdate(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'priceMenu')
    && Object.keys(value).every(key => ['priceMenu', 'expectedPriceMenuRevision', 'catalogSelectionPreconditions'].includes(key));
}

export function parseCatalogSelectionPreconditions(raw: unknown): CatalogSelectionPrecondition[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 1000) throw new BadRequestException('目录选择版本须为最多1000项的数组');
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 3 || !['itemId', 'serviceId', 'expectedSelectionRevision'].every(key => Object.prototype.hasOwnProperty.call(value, key))
      || typeof value.itemId !== 'string' || !ITEM_ID.test(value.itemId)
      || typeof value.serviceId !== 'string' || !ID.test(value.serviceId) || BigInt(value.serviceId) > 9223372036854775807n
      || typeof value.expectedSelectionRevision !== 'string' || !REVISION.test(value.expectedSelectionRevision)) {
      throw new BadRequestException('目录选择版本必须含有效的项目行、服务编号与选择版本');
    }
    return { itemId: value.itemId, serviceId: value.serviceId, expectedSelectionRevision: value.expectedSelectionRevision };
  });
}

export function catalogSelectionChanged(ids: Iterable<string | undefined>): never {
  const fields = Object.fromEntries([...new Set(ids)].filter((id): id is string => typeof id === 'string' && ITEM_ID.test(id))
    .map(id => [id, '来源已更新，请重新选择']));
  throw new ConflictException({ code: 'CATALOG_SELECTION_CHANGED',
    message: '所选目录已更新或缺少选择版本，请保留当前草稿，重新选择并核对名称、价格与占用时间后再保存。', fields });
}

const sameBooking = (a?: PriceMenuItem['booking'], b?: PriceMenuItem['booking']) =>
  !!a && !!b && a.serviceId === b.serviceId && a.variantId === b.variantId && a.addOnId === b.addOnId;

export interface MenuCatalogSource {
  serviceId?: string;
  root: PriceMenuItem;
  conditionItemIds: string[];
  viaDraft: boolean;
  required: boolean;
  previous?: PriceMenuItem;
}

/** Positional fallback is only for unchanged legacy rows that never had IDs. */
export function previousMenuItems(menu: PriceMenuGroup[], previous: unknown): Map<PriceMenuItem, PriceMenuItem | undefined> {
  const before = managedPriceMenu(previous).flatMap(group => group.items);
  return new Map(menu.flatMap(group => group.items).map((item, index) => {
    const named = item.id ? before.find(old => old.id === item.id) : undefined;
    const legacy = before[index]?.id === undefined && (!item.id || sameBooking(item.booking, before[index]?.booking)) ? before[index] : undefined;
    return [item, named ?? legacy] as const;
  }));
}

/** Resolve draft references without mutating the menu or creating a service. */
export function menuCatalogSources(menu: PriceMenuGroup[], previous: unknown): Map<PriceMenuItem, MenuCatalogSource> {
  const items = menu.flatMap(group => group.items), prior = previousMenuItems(menu, previous);
  const byId = new Map<string, PriceMenuItem>(items.filter(item => item.id).map(item => [item.id!, item] as const));
  const oldParents = new Set(managedPriceMenu(previous).flatMap(group => group.items.flatMap(item =>
    item.booking ? [item.booking.serviceId] : item.newVariantOf && !item.newVariantOf.startsWith('item:') ? [item.newVariantOf] : [])));
  const resolved = new Map<PriceMenuItem, MenuCatalogSource>(), visiting = new Set<PriceMenuItem>();
  const visit = (item: PriceMenuItem): MenuCatalogSource => {
    const cached = resolved.get(item); if (cached) return cached;
    if (visiting.has(item)) throw new BadRequestException('新规格的来源不能循环关联');
    visiting.add(item);
    const old = prior.get(item);
    let source: MenuCatalogSource = { root: item, conditionItemIds: item.id ? [item.id] : [], viaDraft: false, required: false, previous: old };
    if (item.booking) {
      source.serviceId = item.booking.serviceId;
      source.required = !sameBooking(item.booking, old?.booking) || item.pricing?.kind === 'ADD_ON' && !item.booking.addOnId;
    } else if (item.newVariantOf?.startsWith('item:')) {
      const parent = byId.get(item.newVariantOf.slice(5));
      if (!parent || parent.pricing?.kind === 'ADD_ON' || parent.booking?.addOnId) throw new BadRequestException('新规格的来源主项目不存在');
      const inherited = visit(parent);
      source = { ...source, serviceId: inherited.serviceId, root: inherited.root,
        conditionItemIds: [...source.conditionItemIds, ...inherited.conditionItemIds], viaDraft: true, required: !!inherited.serviceId };
    } else if (item.newVariantOf) {
      source.serviceId = item.newVariantOf; source.required = !oldParents.has(item.newVariantOf);
    }
    visiting.delete(item); resolved.set(item, source); return source;
  };
  items.forEach(visit); return resolved;
}

/** Caller holds the shop mutex and has already checked the old menu CAS.
 * Validate all source conditions together before the first catalog/profile/media write. */
export async function assertCatalogSelectionPreconditions(db: any, shopId: bigint, menu: PriceMenuGroup[], previous: unknown, raw: unknown) {
  const conditions = parseCatalogSelectionPreconditions(raw), sources = menuCatalogSources(menu, previous);
  const items = menu.flatMap(group => group.items), byId = new Map<string, PriceMenuItem>(items.filter(item => item.id).map(item => [item.id!, item] as const));
  const byItem = new Map<string, CatalogSelectionPrecondition>(), conflicts = new Set<string | undefined>();
  for (const condition of conditions) {
    const item = byId.get(condition.itemId), source = item ? sources.get(item) : undefined;
    if (byItem.has(condition.itemId) || !source?.serviceId || source.serviceId !== condition.serviceId) conflicts.add(condition.itemId);
    else byItem.set(condition.itemId, condition);
  }
  for (const [item, source] of sources) {
    if (source.required && !source.conditionItemIds.some(id => byItem.get(id)?.serviceId === source.serviceId)) conflicts.add(item.id);
  }
  if (conflicts.size) catalogSelectionChanged(conflicts);
  const ids = [...new Set(conditions.map(condition => condition.serviceId))].map(BigInt);
  const parents = ids.length ? await loadMenuCatalogParents(db, shopId, ids) : [];
  const current = new Map<string, any>(parents.map(parent => [String(parent.id), parent]));
  for (const condition of conditions) {
    const parent = current.get(condition.serviceId);
    if (!parent || String(parent.shopId) !== String(shopId) || catalogSelectionRevision(shopId, parent) !== condition.expectedSelectionRevision) {
      conflicts.add(condition.itemId);
      for (const [item, source] of sources) if (source.required && source.serviceId === condition.serviceId && source.conditionItemIds.includes(condition.itemId)) conflicts.add(item.id);
    }
  }
  if (conflicts.size) catalogSelectionChanged(conflicts);
  return sources;
}

