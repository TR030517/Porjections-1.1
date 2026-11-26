import { BadRequestException, ConflictException } from '@nestjs/common';
import { managedMediaId } from '../../common/managed-media';
import { normalizePriceMenu, PriceMenuGroup, PriceMenuValidationError } from '../../common/shop-price-menu';
import { resolvePriceMenu } from '../../common/shop-price-menu-catalog-view';
import { readDurationKind } from '../../common/service-duration';
import { policyInput } from '../reservations/reservation-validation';
import { serviceAddOnInput } from '../reservations/service-addons';

export const MENU_SERVICE_FIELDS = ['name', 'nameEn', 'category', 'durationMin', 'durationKind', 'priceCents', 'priceBasis', 'participantCount', 'requiredStaffCount', 'requiredRoomType', 'staffBufferMin', 'roomBufferMin', 'description', 'sortOrder'] as const;
export const MENU_VARIANT_FIELDS = ['name', 'durationMin', 'priceCents', 'priceBasis', 'currency', 'sortOrder'] as const;
const ADDON_FIELDS = ['name', 'description', 'priceCents', 'currency', 'sortOrder'] as const;
const pick = (row: any, keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, row[key]]));
const nameKey = (value: string) => value.normalize('NFKC').trim().toLowerCase();
const key = (row: any) => JSON.stringify([nameKey(row.name), row.category, row.priceBasis, row.participantCount, readDurationKind(row.durationKind)]);
const equal = (a: any, b: any, fields: readonly string[]) => fields.every(field => field === 'name' ? nameKey(a.name) === nameKey(b.name) : a[field] === b[field]);
const identity = (value: any) => {
  const text = typeof value === 'bigint' ? value.toString() : value;
  if (typeof text !== 'string' || !/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) throw new BadRequestException('项目与价目复制标识无效');
  return text;
};
export interface MenuCopyLink {
  resource: 'SERVICE' | 'VARIANT' | 'ADD_ON'; sourceId: string; sourceServiceId: string;
  targetId: string | null; targetServiceId: string | null; name: string; action: 'CREATE' | 'REUSE';
}
type ChildPlan = { source: any; target: any | null };
export interface MenuServicePlan extends ChildPlan { variants: ChildPlan[]; addOns: ChildPlan[] }
export interface MenuCopyPlan { menu: PriceMenuGroup[]; services: MenuServicePlan[]; links: MenuCopyLink[]; omittedManagedImages: number }

function validateService(row: any, shopId: bigint) {
  identity(row.id);
  if (String(row.shopId) !== String(shopId) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200
    || !['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'].includes(row.category)
    || !['PER_PERSON', 'PER_BOOKING'].includes(row.priceBasis) || typeof row.isActive !== 'boolean'
    || !Number.isSafeInteger(row.sortOrder) || row.sortOrder < 0 || row.sortOrder > 10000) throw new BadRequestException('来源项目配置无效，请先整理项目与价目');
  policyInput(row); readDurationKind(row.durationKind);
  if (!row.variants.length) validateChoice(row);
}
function validateChoice(row: any) {
  if (!Number.isSafeInteger(row.durationMin) || row.durationMin < 5 || row.durationMin > 240 || !Number.isSafeInteger(row.priceCents) || row.priceCents < 1 || row.priceCents > 10000000
    || !['PER_PERSON', 'PER_BOOKING'].includes(row.priceBasis) || row.currency !== undefined && row.currency !== 'usd') throw new BadRequestException('来源价格、占用时间或币种无效，不自动换汇');
}
function childPlans(source: any[], target: any[], fields: readonly string[], kind: '规格' | '附加项目'): ChildPlan[] {
  const seen = new Set<string>();
  return source.map(row => {
    const normalized = nameKey(row.name), matches = target.filter(candidate => nameKey(candidate.name) === normalized);
    if (seen.has(normalized) || matches.length > 1 || matches[0] && !equal(row, matches[0], fields.filter(field => field !== 'sortOrder'))) throw new ConflictException(`“${row.name}”的${kind}名称重复或目标配置不同，请先整理目标项目与价目`);
    seen.add(normalized);
    return { source: row, target: matches[0] ?? null };
  });
}

/** One signed plan owns both presentation and canonical target IDs. It never edits an existing resource. */
export function planMenuCopy(rawMenu: unknown, sourceRows: any[], targetRows: any[], sourceShopId: bigint, targetShopId: bigint): MenuCopyPlan {
  let menu: PriceMenuGroup[];
  try { menu = normalizePriceMenu(rawMenu ?? []); }
  catch (error) { if (error instanceof PriceMenuValidationError) throw new BadRequestException('来源项目与价目格式异常，请先修正'); throw error; }
  if (sourceRows.length > 500 || targetRows.length > 500 || [...sourceRows, ...targetRows].some(row => row.variants.length > 100 || row.addOns.length > 50)
    || [...sourceRows, ...targetRows].reduce((n, row) => n + row.variants.length + row.addOns.length, 0) > 5000) throw new BadRequestException('项目与价目目录过大，请分批整理');
  const source = new Map(sourceRows.map(row => [identity(row.id), row]));
  const references = new Map<string, Set<string>>();
  for (const item of menu.flatMap(group => group.items)) {
    if (item.newVariantOf) throw new ConflictException('来源价目有未保存的规格关联，请先保存来源门店');
    if (!item.booking) continue;
    const row = source.get(item.booking.serviceId);
    if (!row || String(row.shopId) !== String(sourceShopId)) throw new ConflictException('来源价目关联的服务不存在或不属于来源店，请先修正');
    const child = item.booking.variantId ? row.variants.find((v: any) => identity(v.id) === item.booking!.variantId && identity(v.serviceId) === item.booking!.serviceId)
      : item.booking.addOnId ? row.addOns.find((v: any) => identity(v.id) === item.booking!.addOnId && identity(v.serviceId) === item.booking!.serviceId) : row;
    if (!child || !item.booking.variantId && !item.booking.addOnId && row.variants.length) throw new ConflictException('来源价目规格关联失效，请先修正来源项目与价目');
    const addons = references.get(item.booking.serviceId) ?? new Set<string>();
    if (item.booking.addOnId) addons.add(item.booking.addOnId);
    references.set(item.booking.serviceId, addons);
  }
  const services: MenuServicePlan[] = [], links: MenuCopyLink[] = [], usedKeys = new Set<string>();
  let newServices = 0;
  for (const [sourceId, addonIds] of references) {
    const row = source.get(sourceId)!; validateService(row, sourceShopId);
    const signature = key(row), matches = targetRows.filter(candidate => String(candidate.shopId) === String(targetShopId) && key(candidate) === signature);
    if (usedKeys.has(signature) || matches.length > 1 || matches[0] && !equal({ ...row, durationKind: readDurationKind(row.durationKind) }, { ...matches[0], durationKind: readDurationKind(matches[0].durationKind) }, MENU_SERVICE_FIELDS.filter(field => field !== 'sortOrder'))) throw new ConflictException(`“${row.name}”存在同名重复或目标价格、时间及资源规则不同，请先整理目标项目与价目`);
    usedKeys.add(signature);
    const target = matches[0] ?? null;
    if (target && Boolean(target.variants.length) !== Boolean(row.variants.length)) throw new ConflictException(`“${row.name}”的目标规格结构不同，请先整理目标项目与价目`);
    if (!target) newServices++;
    for (const variant of row.variants) { identity(variant.id); if (identity(variant.serviceId) !== sourceId) throw new BadRequestException('来源规格父服务无效'); validateChoice(variant); }
    const addons = row.addOns.filter((addon: any) => addonIds.has(identity(addon.id)));
    for (const addon of addons) { if (identity(addon.serviceId) !== sourceId) throw new BadRequestException('来源附加项目父服务无效'); serviceAddOnInput(addon); }
    const variants = childPlans(row.variants, target?.variants ?? [], MENU_VARIANT_FIELDS, '规格');
    const addOns = childPlans(addons, target?.addOns ?? [], ADDON_FIELDS, '附加项目');
    if ((target?.variants.length ?? 0) + variants.filter(item => !item.target).length > 100 || (target?.addOns.length ?? 0) + addOns.filter(item => !item.target).length > 50) throw new BadRequestException('目标项目规格或附加项目超过上限');
    services.push({ source: row, target, variants, addOns });
    const link = (resource: MenuCopyLink['resource'], item: ChildPlan) => ({ resource, sourceId: identity(item.source.id), sourceServiceId: sourceId, targetId: item.target ? identity(item.target.id) : null, targetServiceId: target ? identity(target.id) : null, name: item.source.name, action: item.target ? 'REUSE' as const : 'CREATE' as const });
    links.push(link('SERVICE', { source: row, target }), ...variants.map(item => link('VARIANT', item)), ...addOns.map(item => link('ADD_ON', item)));
  }
  if (targetRows.length + newServices > 500 || links.length > 3000) throw new BadRequestException('目标服务目录超过复制上限');
  let omittedManagedImages = 0;
  menu = resolvePriceMenu(menu, sourceRows, sourceShopId).map(group => ({ ...group, items: group.items.map(item => {
    const { id: _id, newVariantOf: _new, bookingAvailable: _available, bookingUnavailableReason: _reason, ...saved } = item;
    if (saved.imageUrl && managedMediaId(saved.imageUrl)) { omittedManagedImages++; delete saved.imageUrl; }
    return saved;
  }) }));
  return { menu, services, links, omittedManagedImages };
}

export async function loadMenuCopyCatalog(tx: any, shopId: bigint) {
  return tx.shopService.findMany({ where: { shopId }, orderBy: { id: 'asc' }, take: 501, select: {
    id: true, shopId: true, isActive: true, ...Object.fromEntries(MENU_SERVICE_FIELDS.map(field => [field, true])),
    variants: { orderBy: { id: 'asc' }, take: 101, select: { id: true, serviceId: true, isActive: true, ...Object.fromEntries(MENU_VARIANT_FIELDS.map(field => [field, true])) } },
    addOns: { orderBy: { id: 'asc' }, take: 51, select: { id: true, serviceId: true, isActive: true, ...Object.fromEntries(ADDON_FIELDS.map(field => [field, true])) } },
  } });
}

export async function applyMenuCopyPlan(tx: any, targetShopId: bigint, plan: MenuCopyPlan): Promise<PriceMenuGroup[]> {
  const services = new Map<string, string>(), variants = new Map<string, string>(), addons = new Map<string, string>();
  const catalog: any[] = [];
  for (const entry of plan.services) {
    const service = entry.target ?? await tx.shopService.create({ data: { ...pick(entry.source, MENU_SERVICE_FIELDS), durationKind: readDurationKind(entry.source.durationKind), shopId: targetShopId, isActive: false } });
    services.set(identity(entry.source.id), identity(service.id));
    const savedVariants: any[] = [...(entry.target?.variants ?? [])], savedAddons: any[] = [...(entry.target?.addOns ?? [])];
    for (const item of entry.variants) {
      const variant = item.target ?? await tx.shopServiceVariant.create({ data: { ...pick(item.source, MENU_VARIANT_FIELDS), serviceId: service.id, isActive: false } });
      variants.set(identity(item.source.id), identity(variant.id)); if (!item.target) savedVariants.push(variant);
    }
    for (const item of entry.addOns) {
      const addon = item.target ?? await tx.shopServiceAddOn.create({ data: { ...pick(item.source, ADDON_FIELDS), serviceId: service.id, isActive: false } });
      addons.set(identity(item.source.id), identity(addon.id)); if (!item.target) savedAddons.push(addon);
    }
    catalog.push({ ...service, variants: savedVariants, addOns: savedAddons });
  }
  const menu = plan.menu.map(group => ({ ...group, items: group.items.map(item => item.booking ? { ...item, booking: {
    serviceId: services.get(item.booking.serviceId)!, ...(item.booking.variantId ? { variantId: variants.get(item.booking.variantId)! } : {}), ...(item.booking.addOnId ? { addOnId: addons.get(item.booking.addOnId)! } : {}),
  } } : item) }));
  // Read activation from target resources, never copy source activation flags.
  return normalizePriceMenu(resolvePriceMenu(menu, catalog, targetShopId));
}
