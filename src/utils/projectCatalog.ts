import { validatePriceMenu, type PriceMenuGroup, type PriceMenuItem } from './priceMenu';
import { sourceServiceIdForItem } from './catalogSelection';
export interface ProjectCatalogQuery { search: string; status: 'all' | 'active' | 'inactive'; page: number; pageSize: number; serviceId?: string; }
export interface ProjectCatalogVariant { id: string; serviceId: string; name: string; durationMin: number | null; priceCents: number | null; priceBasis: string | null; currency: string | null; isActive: boolean; sortOrder: number | null; preview: PriceMenuItem | null; }
export interface ProjectCatalogAddOn { id: string; serviceId: string; name: string; description: string | null; priceCents: number | null; currency: string | null; isActive: boolean; sortOrder: number | null; preview: PriceMenuItem | null; }
export interface ProjectCatalogItem {
  id: string; shopId: string; name: string; nameEn: string | null; description: string | null; category: string | null; isActive: boolean;
  durationKind: string | null; durationMin: number | null; priceCents: number | null; priceBasis: string | null; participantCount: number | null; requiredStaffCount: number | null; requiredRoomType: string | null; staffBufferMin: number | null; roomBufferMin: number | null; sortOrder: number | null;
  hasVariants: boolean; variantCount: number; addOnCount: number; selectionRevision: string; preview: PriceMenuItem | null; variants: ProjectCatalogVariant[]; addOns: ProjectCatalogAddOn[];
}
export interface ProjectCatalogPage extends ProjectCatalogQuery { shopId: string; total: number; hasMore: boolean; canManageCatalog: boolean; canConfigurePolicy: boolean; items: ProjectCatalogItem[]; }
export type ProjectCatalogLoader = (query: ProjectCatalogQuery, signal: AbortSignal) => Promise<unknown>;
export type ProjectMenuAvailability = { status: 'known' } | { status: 'unavailable'; reason: 'permission' | 'loading' | 'error' | 'unread' };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const projectCatalogId = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const nullableInteger = (v: unknown): v is number | null => v === null || integer(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 50000;
const name = (v: unknown): v is string => text(v) && !!v.trim();
const nullableText = (v: unknown): v is string | null => v === null || text(v);
function invalid(): never { throw Error('本店项目目录格式或范围不符，请刷新核对。'); }
export function projectCatalogRequestPath(shopId: string | number, query: ProjectCatalogQuery): string {
  const shop = typeof shopId === 'number' && Number.isSafeInteger(shopId) ? String(shopId) : shopId;
  if (!projectCatalogId(shop) || !query || typeof query.search !== 'string' || query.search.length > 100 || /[\u0000-\u001f\u007f]/.test(query.search)
    || !['all', 'active', 'inactive'].includes(query.status) || !integer(query.page) || query.page < 1 || query.page > 100000 || !integer(query.pageSize) || query.pageSize < 1 || query.pageSize > 50 || query.serviceId !== undefined && !projectCatalogId(query.serviceId)) invalid();
  return '/reservation-admin/shops/' + shop + '/project-catalog?' + new URLSearchParams({ search: query.search.trim(), status: query.status, page: String(query.page), pageSize: String(query.pageSize), ...(query.serviceId ? { serviceId: query.serviceId } : {}) });
}
function preview(raw: unknown, serviceId: string, variantId?: string, addOnId?: string): PriceMenuItem | null {
  if (raw === null) return null;
  try {
    const item = validatePriceMenu([{ category: '', items: [raw as PriceMenuItem] }])[0].items[0];
    if (!item.pricing || item.booking?.serviceId !== serviceId || item.booking.variantId !== variantId || item.booking.addOnId !== addOnId) invalid();
    return item;
  } catch { return invalid(); }
}
/** Keep raw legacy values visible; they are not silently normalized into valid booking parameters. */
export function readProjectCatalogPage(raw: unknown, shopId: string, query: ProjectCatalogQuery): ProjectCatalogPage {
  projectCatalogRequestPath(shopId, query);
  if (!object(raw) || raw.shopId !== shopId || raw.search !== query.search.trim() || raw.status !== query.status || raw.page !== query.page || raw.pageSize !== query.pageSize || raw.serviceId !== query.serviceId
    || !integer(raw.total) || raw.total < 0 || typeof raw.hasMore !== 'boolean' || typeof raw.canManageCatalog !== 'boolean' || typeof raw.canConfigurePolicy !== 'boolean' || !Array.isArray(raw.items)) invalid();
  const offset = (query.page - 1) * query.pageSize;
  if (raw.items.length !== Math.min(query.pageSize, Math.max(0, raw.total - offset)) || raw.hasMore !== (offset + raw.items.length < raw.total)) invalid();
  const seen = new Set<string>();
  const items = raw.items.map((row): ProjectCatalogItem => {
    if (!object(row) || !projectCatalogId(row.id) || row.shopId !== shopId || query.serviceId !== undefined && row.id !== query.serviceId || seen.has(row.id) || !name(row.name) || !nullableText(row.nameEn) || !nullableText(row.description) || !nullableText(row.category) || typeof row.isActive !== 'boolean'
      || !nullableText(row.durationKind) || !nullableText(row.priceBasis) || !nullableText(row.requiredRoomType) || !['durationMin', 'priceCents', 'participantCount', 'requiredStaffCount', 'staffBufferMin', 'roomBufferMin', 'sortOrder'].every(key => nullableInteger(row[key]))
      || typeof row.hasVariants !== 'boolean' || !integer(row.variantCount) || row.variantCount < 0 || row.variantCount > 200 || !integer(row.addOnCount) || row.addOnCount < 0 || row.addOnCount > 50 || !Array.isArray(row.variants) || row.variants.length !== row.variantCount || !Array.isArray(row.addOns) || row.addOns.length !== row.addOnCount || row.hasVariants !== (row.variantCount > 0) || typeof row.selectionRevision !== 'string' || !/^[a-f0-9]{64}$/.test(row.selectionRevision)) invalid();
    seen.add(row.id);
    if (query.status !== 'all' && row.isActive !== (query.status === 'active')) invalid();
    const children = new Set<string>();
    const variants = row.variants.map((child): ProjectCatalogVariant => {
      if (!object(child) || !projectCatalogId(child.id) || child.serviceId !== row.id || children.has('v:' + child.id) || !name(child.name) || !nullableInteger(child.durationMin) || !nullableInteger(child.priceCents) || !nullableInteger(child.sortOrder) || !nullableText(child.priceBasis) || !nullableText(child.currency) || typeof child.isActive !== 'boolean') invalid();
      children.add('v:' + child.id); return { ...child, preview: preview(child.preview, row.id as string, child.id) } as unknown as ProjectCatalogVariant;
    });
    const addOns = row.addOns.map((child): ProjectCatalogAddOn => {
      if (!object(child) || !projectCatalogId(child.id) || child.serviceId !== row.id || children.has('a:' + child.id) || !name(child.name) || !nullableText(child.description) || !nullableInteger(child.priceCents) || !nullableInteger(child.sortOrder) || !nullableText(child.currency) || typeof child.isActive !== 'boolean') invalid();
      children.add('a:' + child.id); return { ...child, preview: preview(child.preview, row.id as string, undefined, child.id) } as unknown as ProjectCatalogAddOn;
    });
    const ownPreview = preview(row.preview, row.id);
    if (row.hasVariants && ownPreview !== null) invalid();
    return { ...row, preview: ownPreview, variants, addOns } as unknown as ProjectCatalogItem;
  });
  return { ...query, search: query.search.trim(), shopId, total: raw.total, hasMore: raw.hasMore, canManageCatalog: raw.canManageCatalog, canConfigurePolicy: raw.canConfigurePolicy, items };
}
export function menuOnlyProjectRows(menu: PriceMenuGroup[]) {
  return menu.flatMap((group, groupIndex) => group.items.flatMap((item, itemIndex) => sourceServiceIdForItem(item, menu) ? [] : [{ groupIndex, itemIndex, item, category: group.category }]));
}
export function projectMenuLocations(menu: PriceMenuGroup[], serviceId: string) {
  return menu.flatMap((group, groupIndex) => group.items.flatMap((item, itemIndex) => sourceServiceIdForItem(item, menu) === serviceId ? [{ groupIndex, itemIndex, name: item.name }] : []));
}
export function projectMenuAvailabilityMessage(availability: ProjectMenuAvailability): string | null {
  if (availability.status === 'known') return null;
  return availability.reason === 'permission' ? '顾客价目展示状态待核对（当前账号无目录权限）'
    : availability.reason === 'loading' ? '顾客价目展示状态待核对（价目正在读取）'
    : availability.reason === 'unread' ? '顾客价目展示状态待核对（请先载入完整价目）'
    : '顾客价目展示状态待核对（价目读取失败，请重新核对）';
}
/** An unavailable menu is not an empty menu and cannot prove that a project is unlisted. */
export function projectMenuDisplayStatus(menu: PriceMenuGroup[], serviceId: string, availability: ProjectMenuAvailability) {
  const unavailable = projectMenuAvailabilityMessage(availability);
  if (unavailable !== null) return { label: unavailable, locations: [] as ReturnType<typeof projectMenuLocations> };
  const locations = projectMenuLocations(menu, serviceId);
  const visible = menu.flatMap(group => group.items).filter(item => sourceServiceIdForItem(item, menu) === serviceId && item.isVisible !== false).length;
  return { label: locations.length ? `顾客显示 ${visible}/${locations.length} 处` : '尚未放入顾客价目', locations };
}
