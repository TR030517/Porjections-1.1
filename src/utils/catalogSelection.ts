import { validatePriceMenu, type PriceMenuGroup, type PriceMenuItem } from './priceMenu';
import { formatPriceMenuTitle, type PriceMenuPricing } from './priceMenuPricing';

export type MenuCatalogKind = 'service' | 'variant' | 'addOn';
export interface MenuCatalogQuery { kind: MenuCatalogKind; serviceId?: string; q: string; page: number; pageSize: number; }
export interface MenuCatalogOption {
  serviceId: string; variantId?: string; addOnId?: string; serviceName: string; name: string;
  hasVariants: boolean; variantCount: number; addOnCount: number; isActive: boolean; parentIsActive: boolean;
  preview: PriceMenuItem | null; selectionRevision: string;
}
export interface MenuCatalogPage {
  shopId: string; kind: MenuCatalogKind; serviceId?: string; q: string; page: number; pageSize: number;
  total: number; hasMore: boolean; canConfigurePolicy: boolean; items: MenuCatalogOption[];
}
export type MenuCatalogLoader = (query: MenuCatalogQuery, signal: AbortSignal) => Promise<unknown>;
export interface CatalogSelectionPrecondition { itemId: string; serviceId: string; expectedSelectionRevision: string; }
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const numericReference = (value: string): boolean => id(value);
const itemId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const plain = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function invalid(): never { throw new Error('本店目录返回格式或查询范围不符，请刷新后重试。'); }

/** One response must describe the exact shop, parent, search and page requested. */
export function readMenuCatalogPage(value: unknown, expectedShopId: string, query: MenuCatalogQuery): MenuCatalogPage {
  const expectedQ = typeof query.q === 'string' ? query.q.trim() : invalid();
  if (!id(expectedShopId) || !record(value) || value.shopId !== expectedShopId || value.kind !== query.kind
    || !['service', 'variant', 'addOn'].includes(query.kind) || query.serviceId !== undefined && !id(query.serviceId) || expectedQ.length > 100
    || value.serviceId !== query.serviceId || value.q !== expectedQ || value.page !== query.page || value.pageSize !== query.pageSize
    || !count(value.total) || !Number.isSafeInteger(query.page) || query.page < 1 || query.page > 100000 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 50
    || typeof value.hasMore !== 'boolean' || typeof value.canConfigurePolicy !== 'boolean' || !Array.isArray(value.items) || value.items.length > query.pageSize
    || query.kind !== 'service' && !id(query.serviceId)) invalid();
  const offset = (query.page - 1) * query.pageSize;
  if (value.items.length !== Math.min(query.pageSize, Math.max(0, value.total - offset)) || value.hasMore !== (offset + value.items.length < value.total)) invalid();
  const keys = new Set<string>();
  const items = value.items.map((raw): MenuCatalogOption => {
    if (!record(raw) || !id(raw.serviceId) || !plain(raw.serviceName) || !plain(raw.name) || !revision(raw.selectionRevision)
      || typeof raw.hasVariants !== 'boolean' || typeof raw.isActive !== 'boolean' || typeof raw.parentIsActive !== 'boolean'
      || !count(raw.variantCount) || raw.variantCount > 200 || !count(raw.addOnCount) || raw.addOnCount > 50 || raw.hasVariants !== (raw.variantCount > 0)
      || query.serviceId !== undefined && raw.serviceId !== query.serviceId) invalid();
    if (query.kind === 'service' && (raw.variantId !== undefined || raw.addOnId !== undefined || raw.isActive !== raw.parentIsActive)
      || query.kind === 'variant' && (!id(raw.variantId) || raw.addOnId !== undefined || !raw.hasVariants)
      || query.kind === 'addOn' && (!id(raw.addOnId) || raw.variantId !== undefined || raw.addOnCount < 1)) invalid();
    const key = `${raw.serviceId}:${raw.variantId ?? ''}:${raw.addOnId ?? ''}`;
    if (keys.has(key)) invalid(); keys.add(key);
    let preview: PriceMenuItem | null = null;
    if (raw.preview !== null) {
      if (!record(raw.preview)) invalid();
      try { preview = validatePriceMenu([{ category: '', items: [raw.preview as unknown as PriceMenuItem] }])[0].items[0]; } catch { return invalid(); }
      if (!preview.pricing || preview.priceText !== '' || preview.booking?.serviceId !== raw.serviceId || preview.booking?.variantId !== raw.variantId || preview.booking?.addOnId !== raw.addOnId
        || preview.bookingEnabled !== raw.isActive || typeof preview.bookingAvailable !== 'boolean' || preview.bookingAvailable && (!raw.isActive || !raw.parentIsActive)
        || query.kind === 'addOn' && (preview.pricing.kind !== 'ADD_ON' || preview.pricing.baseName !== raw.name)
        || query.kind !== 'addOn' && (preview.pricing.kind === 'ADD_ON' || preview.pricing.baseName !== raw.serviceName)) invalid();
    }
    if (query.kind === 'service' && raw.hasVariants && preview !== null) invalid();
    return { serviceId: raw.serviceId, ...(raw.variantId ? { variantId: raw.variantId as string } : {}), ...(raw.addOnId ? { addOnId: raw.addOnId as string } : {}),
      serviceName: raw.serviceName, name: raw.name, hasVariants: raw.hasVariants, variantCount: raw.variantCount, addOnCount: raw.addOnCount,
      isActive: raw.isActive, parentIsActive: raw.parentIsActive, preview, selectionRevision: raw.selectionRevision };
  });
  return { shopId: expectedShopId, kind: query.kind, ...(query.serviceId ? { serviceId: query.serviceId } : {}), q: expectedQ, page: query.page, pageSize: query.pageSize,
    total: value.total, hasMore: value.hasMore, canConfigurePolicy: value.canConfigurePolicy, items };
}

function validCondition(value: CatalogSelectionPrecondition): boolean { return itemId(value?.itemId) && id(value.serviceId) && revision(value.expectedSelectionRevision); }
function sourceService(item: PriceMenuItem, menu: readonly PriceMenuGroup[], visited = new Set<PriceMenuItem>()): string | undefined {
  if (visited.has(item)) return undefined;
  visited.add(item);
  if (item.booking) return item.booking.serviceId;
  if (!item.newVariantOf) return undefined;
  if (numericReference(item.newVariantOf)) return item.newVariantOf;
  if (!item.newVariantOf.startsWith('item:')) return undefined;
  const parent = menu.flatMap(group => group.items).find(row => row.id === item.newVariantOf!.slice(5));
  return parent ? sourceService(parent, menu, visited) : undefined;
}
export function sourceServiceIdForItem(item: PriceMenuItem, menu: readonly PriceMenuGroup[]): string | undefined { return sourceService(item, menu); }
/** Shared names/types/policy follow explicit ancestry, never matching words. */
export function catalogFamilyKeyForItem(item: PriceMenuItem, menu: readonly PriceMenuGroup[]): string | undefined {
  let current: PriceMenuItem | undefined = item; const seen = new Set<PriceMenuItem>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.booking?.addOnId || current.pricing?.kind === 'ADD_ON') return undefined;
    if (current.booking) return id(current.booking.serviceId) ? `service:${current.booking.serviceId}` : undefined;
    if (!current.newVariantOf) return itemId(current.id) ? `draft:${current.id}` : undefined;
    if (numericReference(current.newVariantOf)) return `service:${current.newVariantOf}`;
    if (!current.newVariantOf.startsWith('item:')) return undefined;
    const parentId: string = current.newVariantOf.slice(5);
    const matches = menu.flatMap(group => group.items).filter(row => row.id === parentId);
    current = matches.length === 1 ? matches[0] : undefined;
  }
  return undefined;
}
export function mapCatalogFamily(menu: PriceMenuGroup[], source: PriceMenuItem, update: (row: PriceMenuItem) => PriceMenuItem): PriceMenuGroup[] {
  const family = catalogFamilyKeyForItem(source, menu);
  return menu.map(group => {
    let changed = false;
    const items = group.items.map(row => {
      if (family ? catalogFamilyKeyForItem(row, menu) !== family : row !== source) return row;
      const next = update(row); changed ||= next !== row; return next;
    });
    return changed ? { ...group, items } : group;
  });
}
export function applyCatalogPricingPatch(item: PriceMenuItem, patch: Partial<PriceMenuPricing>): PriceMenuItem {
  if (!item.pricing) return item;
  const pricing = { ...item.pricing, ...patch }, next: PriceMenuItem = { ...item, pricing };
  if (patch.kind && patch.kind !== item.pricing.kind) {
    const ownMinutes = item.pricing.kind === 'TIMED' ? item.pricing.durationMin : item.reservedDurationMin;
    pricing.durationMin = patch.kind === 'TIMED' ? ownMinutes ?? null : null;
    if (patch.kind !== 'ADD_ON' && typeof ownMinutes === 'number' && Number.isInteger(ownMinutes) && ownMinutes >= 5 && ownMinutes <= 240) next.reservedDurationMin = ownMinutes;
    else delete next.reservedDurationMin;
  }
  next.name = pricing.titleMode === 'AUTO' ? formatPriceMenuTitle(pricing) : item.name;
  return next;
}
export function isExplicitCatalogDescendant(item: PriceMenuItem, ancestorId: string, menu: readonly PriceMenuGroup[]): boolean {
  let current: PriceMenuItem | undefined = item; const seen = new Set<PriceMenuItem>();
  while (current && !seen.has(current) && current.newVariantOf?.startsWith('item:')) {
    seen.add(current); const parentId: string = current.newVariantOf.slice(5);
    if (parentId === ancestorId) return true;
    current = menu.flatMap(group => group.items).find(row => row.id === parentId);
  }
  return false;
}
/** Keep different rows' snapshots separate, even when they refer to one service. */
export function conditionForMenu(menu: readonly PriceMenuGroup[], conditions: readonly CatalogSelectionPrecondition[]): CatalogSelectionPrecondition[] {
  const rows = menu.flatMap(group => group.items), seen = new Map<string, CatalogSelectionPrecondition>();
  for (const condition of conditions) {
    if (!validCondition(condition)) throw new Error('目录选择版本无效，请重新选择关联项目。');
    const row = rows.find(item => item.id === condition.itemId);
    if (!row || sourceService(row, menu) !== condition.serviceId) continue;
    const previous = seen.get(condition.itemId);
    if (previous && (previous.serviceId !== condition.serviceId || previous.expectedSelectionRevision !== condition.expectedSelectionRevision)) throw new Error('同一项目存在不同目录版本，请重新选择关联项目。');
    seen.set(condition.itemId, { ...condition });
  }
  return [...seen.values()];
}
/** A real ancestor snapshot may seed an explicit descendant which has none. */
export function inheritCatalogSelections(menu: readonly PriceMenuGroup[], conditions: readonly CatalogSelectionPrecondition[]): CatalogSelectionPrecondition[] {
  const result = conditionForMenu(menu, conditions), rows = menu.flatMap(group => group.items), byItem = new Map<string, CatalogSelectionPrecondition>(result.map(row => [row.itemId, row]));
  for (const row of rows) {
    if (!row.id || byItem.has(row.id)) continue;
    const serviceId = sourceService(row, menu); if (!serviceId) continue;
    let current: PriceMenuItem | undefined = row; const seen = new Set<PriceMenuItem>();
    while (current?.newVariantOf?.startsWith('item:') && !seen.has(current)) {
      seen.add(current); const parentId: string = current.newVariantOf.slice(5);
      const candidate = byItem.get(parentId);
      if (candidate?.serviceId === serviceId) { const inherited = { ...candidate, itemId: row.id }; result.push(inherited); byItem.set(row.id, inherited); break; }
      current = rows.find(item => item.id === parentId);
    }
  }
  return result;
}
export function upsertCatalogSelection(conditions: readonly CatalogSelectionPrecondition[], entry: CatalogSelectionPrecondition): CatalogSelectionPrecondition[] {
  if (!validCondition(entry)) throw new Error('目录选择版本无效，请重新选择关联项目。');
  return [...conditions.filter(row => row.itemId !== entry.itemId), { ...entry }];
}
export function copyCatalogSelection(conditions: readonly CatalogSelectionPrecondition[], source: PriceMenuItem, target: PriceMenuItem, menu: readonly PriceMenuGroup[] = []): CatalogSelectionPrecondition[] {
  const condition = conditions.find(row => row.itemId === source.id);
  if (!condition || !target.id || !validCondition(condition)) return [...conditions];
  const targetSource = sourceService(target, menu) ?? (target.newVariantOf === `item:${source.id}` ? sourceService(source, menu) : undefined);
  if (targetSource !== condition.serviceId) return [...conditions];
  return upsertCatalogSelection(conditions, { ...condition, itemId: target.id });
}

/** Preserve editorial content while replacing only the canonical catalog fields. */
export function applyCatalogOption(item: PriceMenuItem, option: MenuCatalogOption, stableId: string): PriceMenuItem {
  if (!option.preview?.pricing || !itemId(stableId)) throw new Error('请明确选择一个可关联的服务或规格。');
  const next: PriceMenuItem = { ...item, ...option.preview, id: stableId, description: item.description, imageUrl: item.imageUrl };
  if (option.preview.bookingUnavailableReason === undefined) delete next.bookingUnavailableReason;
  next.pricing = { ...option.preview.pricing, ...(item.pricing?.legacySource ? { legacySource: item.pricing.legacySource } : {}) };
  if (item.pricing?.titleMode === 'CUSTOM' && item.name.trim()) {
    next.name = item.name; next.pricing = { ...next.pricing, titleMode: 'CUSTOM' };
  }
  delete next.newVariantOf;
  if (next.pricing.kind === 'ADD_ON') { delete next.reservedDurationMin; delete next.bookingMode; }
  return next;
}
/** Confirm a new variant's real parent without replacing its independent price/time. */
export function applyCatalogVariantParent(item: PriceMenuItem, option: MenuCatalogOption, stableId: string): PriceMenuItem {
  const source = option.preview?.pricing;
  if (!item.pricing || !source || source.kind === 'ADD_ON' || !itemId(stableId)) throw new Error('请明确选择此新规格的主项目。');
  const ownMinutes = item.pricing.kind === 'TIMED' ? item.pricing.durationMin : item.reservedDurationMin;
  const pricing = { ...item.pricing, baseName: source.baseName, kind: source.kind, durationMin: source.kind === 'TIMED' ? ownMinutes ?? null : null };
  const next: PriceMenuItem = { ...item, id: stableId, pricing, name: pricing.titleMode === 'CUSTOM' ? item.name : formatPriceMenuTitle(pricing),
    newVariantOf: option.serviceId, bookingMode: option.preview?.bookingMode, bookingAvailable: false,
    bookingUnavailableReason: !option.parentIsActive ? 'PARENT_PAUSED' : item.bookingEnabled ? 'CONFIGURATION_REQUIRED' : 'ITEM_PAUSED' };
  delete next.booking;
  if (typeof ownMinutes === 'number' && Number.isInteger(ownMinutes) && ownMinutes >= 5 && ownMinutes <= 240) next.reservedDurationMin = ownMinutes;
  else delete next.reservedDurationMin;
  return next;
}

export type MenuCatalogReadState = { status: 'loading' } | { status: 'ready'; page: MenuCatalogPage } | { status: 'error'; message: string };
/** Abort plus an independent generation protects against loaders which finish after abort. */
export function createMenuCatalogReader() {
  let generation = 0, controller: AbortController | undefined;
  const cancel = () => { generation++; controller?.abort(); controller = undefined; };
  return { cancel, async read(loader: MenuCatalogLoader, shopId: string, query: MenuCatalogQuery, publish: (state: MenuCatalogReadState) => void): Promise<void> {
    cancel(); const current = generation; const request = new AbortController(); controller = request; publish({ status: 'loading' });
    try {
      const raw = await loader(query, request.signal);
      if (request.signal.aborted || current !== generation) return;
      const page = readMenuCatalogPage(raw, shopId, query);
      if (!request.signal.aborted && current === generation) publish({ status: 'ready', page });
    } catch (error) {
      if (!request.signal.aborted && current === generation) publish({ status: 'error', message: error instanceof Error ? error.message : '本店目录加载失败，请重试。' });
    }
  } };
}
