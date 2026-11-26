import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { managedPriceMenu, preservePriceMenuVisibility, PriceMenuValidationError, type PriceMenuGroup, type PriceMenuItem } from './shop-price-menu';
import { resolvePriceMenu } from './shop-price-menu-catalog-view';
export { resolvePriceMenu } from './shop-price-menu-catalog-view';
import { validReservedDurationMin } from './service-duration';
import { requireShopAccess } from './shop-access';
import { effectiveBookingWhere, ensureServiceConfiguration } from '../modules/reservations/configuration-guard';
import { assertCatalogSelectionPreconditions, previousMenuItems, type MenuCatalogSource } from './menu-catalog-preconditions';
import { planDraftFamilies } from './menu-draft-families';

export const PRICE_MENU_CATALOG_INCLUDE = { variants: true, addOns: true };

function currentBookingMode(service: any): PriceMenuItem['bookingMode'] {
  if (service.participantCount === 2 && service.requiredStaffCount === 2) return 'COUPLE';
  if (service.participantCount === 1 && service.requiredStaffCount === 2) return 'FOUR_HANDS';
  return service.participantCount === 1 && service.requiredStaffCount === 1 ? 'SINGLE' : undefined;
}
function modePolicy(service: any, mode: NonNullable<PriceMenuItem['bookingMode']>) {
  if (service && currentBookingMode(service) === mode) return { participantCount: service.participantCount, requiredStaffCount: service.requiredStaffCount, requiredRoomType: service.requiredRoomType ?? null };
  return { participantCount: mode === 'COUPLE' ? 2 : 1, requiredStaffCount: mode === 'SINGLE' ? 1 : 2,
    requiredRoomType: mode === 'COUPLE' ? service?.requiredRoomType === 'COUPLE' ? 'COUPLE' : null
      : service && currentBookingMode(service) === 'COUPLE' ? null : service?.requiredRoomType ?? null };
}
const changesPolicy = (service: any, policy: ReturnType<typeof modePolicy>) =>
  !service || Object.entries(policy).some(([field, value]) => (field === 'requiredRoomType' ? service[field] ?? null : service[field]) !== value);

/** Permission and parent/child identity checks precede every catalog write. */
async function preflightMenuChanges(db: any, shop: any, plans: Array<{ item: PriceMenuItem }>, catalog: any[], sources: Map<PriceMenuItem, MenuCatalogSource>, actor: { id: string; role: string }, draftModes: Map<PriceMenuItem, NonNullable<PriceMenuItem['bookingMode']>>) {
  let requiresPolicy = false;
  const policies = new Map<string, any>();
  const definitions = new Map<string | PriceMenuItem, string>();
  for (const { item } of plans) {
    const source = sources.get(item)!;
    if (source.previous?.booking && !item.booking) throw new ConflictException('此项目已有预约关联，请重新载入后编辑；不能移除关联后另存价格');
    const service = source.serviceId ? catalog.find(row => String(row.id) === source.serviceId && String(row.shopId) === String(shop.id)) : undefined;
    if (source.serviceId && !service) throw new BadRequestException('预约目录或新规格来源必须属于当前门店');
    const link = item.booking;
    if (link && service) {
      if (link.variantId && item.pricing?.kind === 'ADD_ON' || link.addOnId && item.pricing && item.pricing.kind !== 'ADD_ON') throw new BadRequestException('主项目、规格与附加项目的关联类型不一致');
      if (link.variantId && !service.variants?.some((row: any) => String(row.id) === link.variantId && String(row.serviceId) === link.serviceId)
        || link.addOnId && !service.addOns?.some((row: any) => String(row.id) === link.addOnId && String(row.serviceId) === link.serviceId)) throw new BadRequestException('预约规格或附加项目不属于所选主服务');
      if (!link.variantId && !link.addOnId && item.pricing?.kind !== 'ADD_ON' && service.variants?.length) throw new BadRequestException('此服务已有规格，请关联明确规格，不能直接改基础价格');
    }
    if (item.pricing?.kind === 'ADD_ON' || !item.booking && item.bookingEnabled !== true) continue;
    const mode = draftModes.get(item) ?? item.bookingMode ?? (service ? currentBookingMode(service) : source.root.bookingMode ?? 'SINGLE');
    if (!mode) throw new BadRequestException('主项目的预约人数与技师配置需要先修正');
    if (!item.pricing) throw new BadRequestException('请先明确填写项目名称、类型、价格与时长，再开启预约');
    const key = source.serviceId ?? source.root, definition = JSON.stringify([item.pricing.baseName, item.pricing.kind, mode]);
    if (definitions.has(key) && definitions.get(key) !== definition) throw new BadRequestException('同一服务的规格须使用相同基础名称、类型和预约方式');
    definitions.set(key, definition);
    const policy = modePolicy(service, mode);
    if (changesPolicy(service, policy) && (service || mode !== 'SINGLE')) {
      requiresPolicy = true;
      if (service) policies.set(String(service.id), service);
    }
  }
  if (requiresPolicy) await requireShopAccess(db, shop.id, actor, 'RESERVATION_CONFIG', { write: true });
  for (const service of policies.values()) {
    const future = await db.booking.findFirst({ where: { shopId: shop.id, ...effectiveBookingWhere(), endTime: { gt: new Date() },
      AND: [{ OR: [{ serviceId: service.id }, { items: { some: { serviceId: service.id } } }] }] }, select: { id: true } });
    if (future) throw new ConflictException('服务仍有有效未来预约，不能变更人数或房型政策；请先处理已有预约');
  }
}

const sameLink = (a: PriceMenuItem, b?: PriceMenuItem) => !!a.booking && !!b?.booking && a.booking.serviceId === b.booking.serviceId && a.booking.variantId === b.booking.variantId && a.booking.addOnId === b.booking.addOnId;
export function menuServiceIds(value: unknown): bigint[] {
  return [...new Set(managedPriceMenu(value).flatMap(group => group.items.flatMap(item => item.booking ? [item.booking.serviceId] : item.newVariantOf && !item.newVariantOf.startsWith('item:') ? [item.newVariantOf] : [])))].map(BigInt);
}
export async function loadPriceMenuCatalog(db: any, shopId: bigint, value: unknown): Promise<any[]> {
  const ids = menuServiceIds(value);
  return ids.length ? db.shopService.findMany({ where: { shopId, id: { in: ids } }, include: PRICE_MENU_CATALOG_INCLUDE }) : [];
}
/** Called under the shop configuration lock, after checking the revision. Never parse legacy text. */
export async function savePriceMenuCatalog(db: any, shop: any, value: unknown, previous: unknown, actor: { id: string; role: string }, catalogSelectionPreconditions?: unknown): Promise<PriceMenuGroup[]> {
  let menu: PriceMenuGroup[];
  try { menu = preservePriceMenuVisibility(value, previous); }
  catch (error) { if (error instanceof PriceMenuValidationError) throw new BadRequestException(error.message); throw error; }
  const before = managedPriceMenu(previous).flatMap(group => group.items);
  await requireShopAccess(db, shop.id, actor, 'CATALOG_MANAGE', { write: true });
  const sources = await assertCatalogSelectionPreconditions(db, shop.id, menu, previous, catalogSelectionPreconditions);
  const prior = previousMenuItems(menu, previous);
  const catalog = await loadPriceMenuCatalog(db, shop.id, menu);
  for (const row of await loadPriceMenuCatalog(db, shop.id, previous)) if (!catalog.some(existing => String(existing.id) === String(row.id))) catalog.push(row);
  const unordered = menu.flatMap(group => group.items.map(item => ({ item, category: group.category })));
  const plans: typeof unordered = [], visiting = new Set<PriceMenuItem>(), visited = new Set<PriceMenuItem>();
  const visit = (plan: typeof unordered[number]): void => {
    if (visiting.has(plan.item)) throw new BadRequestException('新规格的来源不能循环关联');
    if (visited.has(plan.item)) return;
    visiting.add(plan.item);
    if (plan.item.newVariantOf?.startsWith('item:')) {
      const parent = unordered.find(row => row.item.id === plan.item.newVariantOf!.slice(5));
      if (!parent || parent.item.pricing?.kind === 'ADD_ON' || parent.item.booking?.addOnId) throw new BadRequestException('新规格的来源主项目不存在');
      visit(parent);
    }
    visiting.delete(plan.item); visited.add(plan.item); plans.push(plan);
  };
  unordered.forEach(visit);
  const draftFamilies = planDraftFamilies(plans.map(plan => plan.item), sources);
  const draftModes = new Map(draftFamilies.flatMap(family => family.members.map(item => [item, family.mode] as const)));
  await preflightMenuChanges(db, shop, plans, catalog, sources, actor, draftModes);
  const materialized = new Set<PriceMenuItem>();
  for (const family of draftFamilies) {
    const pricing = family.seed.item.pricing!;
    const service = await db.shopService.create({ data: { name: pricing.baseName, durationKind: pricing.kind, durationMin: family.seed.durationMin,
      priceCents: pricing.priceCents, isActive: true, ...modePolicy(undefined, family.mode), shopId: shop.id, category: 'OTHER', priceBasis: 'PER_BOOKING' } });
    for (const [sortOrder, { item, durationMin }] of family.options.entries()) {
      const variant = await db.shopServiceVariant.create({ data: { serviceId: service.id, name: `${durationMin} min`, durationMin,
        priceCents: item.pricing!.priceCents, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: item.bookingEnabled === true, sortOrder } });
      item.id ??= randomUUID(); item.booking = { serviceId: String(service.id), variantId: String(variant.id) };
      item.bookingEnabled = item.bookingEnabled === true; item.bookingMode = family.mode; delete item.newVariantOf;
      materialized.add(item);
    }
    for (const item of family.members) if (!materialized.has(item)) {
      // Preserve display-only values byte-for-byte; the pending numeric parent
      // makes later saves/copies stable without inventing an invalid option.
      item.newVariantOf = String(service.id); materialized.add(item);
    }
    catalog.push(await db.shopService.findUnique({ where: { id: service.id }, include: PRICE_MENU_CATALOG_INCLUDE }));
  }
  const updates = new Map<string, string>(), serviceDefinitions = new Map<string, string>(), addOnCounts = new Map<string, number>();
  for (const { item } of plans) {
    if (materialized.has(item)) continue;
    const old = prior.get(item);
    // Removing a binding must be explicit; an old client cannot silently split a linked item.
    if (old?.booking && !item.booking) throw new ConflictException('此项目已有预约关联，请重新载入后编辑；不能移除关联后另存价格');
    if (item.newVariantOf?.startsWith('item:')) {
      const parent = unordered.find(row => row.item.id === item.newVariantOf!.slice(5))!.item;
      if (parent.booking && !parent.booking.addOnId) item.newVariantOf = parent.booking.serviceId;
      else if (item.bookingEnabled === true) throw new BadRequestException('请先为来源主项目明确开启预约，再添加可预约规格');
    }
    if (item.newVariantOf && !item.newVariantOf.startsWith('item:') && !catalog.some(row => String(row.id) === item.newVariantOf && String(row.shopId) === String(shop.id))) throw new BadRequestException('新规格的主服务必须属于当前门店');
    if (!item.booking && item.bookingEnabled !== true) continue;
    item.id ??= randomUUID();
    let service: any, selected: any;
    if (item.newVariantOf) {
      service = await db.shopService.findUnique({ where: { id: BigInt(item.newVariantOf) }, include: PRICE_MENU_CATALOG_INCLUDE });
      if (!service || String(service.shopId) !== String(shop.id) || item.pricing?.kind === 'ADD_ON') throw new BadRequestException('新规格的主服务必须属于当前门店');
      selected = { priceBasis: 'PER_BOOKING' };
    }
    if (item.booking) {
      const link = item.booking;
      if (link.variantId && item.pricing?.kind === 'ADD_ON' || link.addOnId && item.pricing && item.pricing.kind !== 'ADD_ON') throw new BadRequestException('主项目、规格与附加项目的关联类型不一致');
      service = catalog.find(row => String(row.id) === link.serviceId);
      if (!service || String(service.shopId) !== String(shop.id)) throw new BadRequestException('预约关联必须属于当前门店');
      selected = link.addOnId ? service.addOns?.find((row: any) => String(row.id) === link.addOnId && String(row.serviceId) === link.serviceId)
        : link.variantId ? service.variants?.find((row: any) => String(row.id) === link.variantId && String(row.serviceId) === link.serviceId) : service;
      // ADD_ON may initially identify just its parent service; create the extra below.
      if (!selected) throw new BadRequestException('预约规格或附加项目不属于所选主服务');
      if (item.bookingEnabled === undefined && (link.variantId || link.addOnId || item.pricing?.kind !== 'ADD_ON')) item.bookingEnabled = selected.isActive === true;
    }
    const pricing = item.pricing;
    if (!pricing) throw new BadRequestException('请先明确填写项目名称、类型、价格与时长，再开启预约');
    if (pricing.kind === 'ADD_ON') {
      if (!service) throw new BadRequestException('附加项目必须先选择本店主服务');
      if (pricing.baseName.length > 100 || pricing.priceCents > 10_000_000) throw new BadRequestException('附加项目名称最多100字，价格最多100000美元');
      const changes = { name: pricing.baseName, priceCents: pricing.priceCents, isActive: item.bookingEnabled === true };
      if (!item.booking?.addOnId) {
        const count = addOnCounts.get(String(service.id)) ?? service.addOns?.length ?? 0;
        if (count >= 50) throw new BadRequestException('每个主服务最多50个附加项目，请编辑已有配置');
        addOnCounts.set(String(service.id), count + 1);
      }
      const row = item.booking?.addOnId ? await db.shopServiceAddOn.update({ where: { id: selected.id }, data: changes })
        : await db.shopServiceAddOn.create({ data: { ...changes, serviceId: service.id, currency: 'usd' } });
      item.booking = { serviceId: String(service.id), addOnId: String(row.id) };
      continue;
    }
    const durationMin = pricing.kind === 'TIMED' ? pricing.durationMin : item.reservedDurationMin;
    if (!validReservedDurationMin(pricing.kind, durationMin) || pricing.priceCents <= 0 || pricing.priceCents > 10_000_000) throw new BadRequestException('开启预约须设置5–240分钟占用时间与0.01–100000美元价格');
    item.bookingMode ??= service ? currentBookingMode(service) : 'SINGLE';
    if (!item.bookingMode) throw new BadRequestException('主项目的预约人数与技师配置需要先修正');
    const desired = modePolicy(service, item.bookingMode), modeChanged = changesPolicy(service, desired);
    const policy: { participantCount?: number; requiredStaffCount?: number; requiredRoomType?: string | null } = modeChanged ? desired : {};
    const unitPriceCents = pricing.priceCents;
    const data = { name: pricing.baseName, durationKind: pricing.kind, durationMin, priceCents: unitPriceCents, isActive: item.bookingEnabled === true, ...policy };
    let createdVariant = false;
    if (item.newVariantOf) {
      const baseVariants = service.variants ?? [];
      if (!baseVariants.length) {
        const base = await db.shopServiceVariant.create({ data: { serviceId: service.id, name: `${service.durationMin} min`, durationMin: service.durationMin, priceCents: service.priceCents,
          priceBasis: service.priceBasis ?? 'PER_PERSON', currency: 'usd', isActive: service.isActive === true && unordered.some(({ item: source }) => source.booking?.serviceId === String(service.id) && !source.booking.variantId && !source.booking.addOnId && source.pricing?.kind !== 'ADD_ON'), sortOrder: 0 } });
        for (const { item: original } of unordered) if (original.booking?.serviceId === String(service.id) && !original.booking.variantId && !original.booking.addOnId && original.pricing?.kind !== 'ADD_ON') {
          original.booking = { serviceId: String(service.id), variantId: String(base.id) };
        }
      }
      const variant = await db.shopServiceVariant.create({ data: { serviceId: service.id, name: `${durationMin} min`, durationMin, priceCents: unitPriceCents,
        priceBasis: 'PER_BOOKING', currency: 'usd', isActive: data.isActive, sortOrder: baseVariants.length + 1 } });
      item.booking = { serviceId: String(service.id), variantId: String(variant.id) }; delete item.newVariantOf;
      selected = variant; createdVariant = true;
    }
    if (service) {
      const key = item.booking!.variantId ? `variant:${item.booking!.variantId}` : `service:${service.id}`;
      const encoded = JSON.stringify(data), pending = updates.get(key);
      if (pending && pending !== encoded) throw new BadRequestException('同一预约项目被填写为不同价格或时长，请核对关联');
      updates.set(key, encoded);
      const definition = JSON.stringify([pricing.baseName, pricing.kind, item.bookingMode]);
      const shared = serviceDefinitions.get(String(service.id));
      if (shared && shared !== definition) throw new BadRequestException('同一服务的规格须使用相同基础名称、类型和预约方式');
      serviceDefinitions.set(String(service.id), definition);
      if (item.booking!.variantId) {
        // A child configuration does not resume a paused parent service.
        const sharedChanges = { name: pricing.baseName, durationKind: pricing.kind, ...policy };
        const current = await db.shopService.findUnique({ where: { id: service.id } });
        await ensureServiceConfiguration(db, current, sharedChanges);
        if (!createdVariant) {
          if ((selected.durationMin !== durationMin || selected.isActive === true && data.isActive === false) && await db.bookingItem.findFirst({ where: { variantId: selected.id, booking: { ...effectiveBookingWhere(), endTime: { gt: new Date() } } }, select: { id: true } })) throw new ConflictException('规格仍有未来预约，不能停用或修改占用时间；请新建规格，保留原规格供已有订单使用');
          await db.shopServiceVariant.update({ where: { id: selected.id }, data: { durationMin, priceCents: unitPriceCents, isActive: data.isActive } });
        }
        await db.shopService.update({ where: { id: service.id }, data: sharedChanges });
      } else {
        if (service.variants?.length) throw new BadRequestException('此服务已有规格，请关联明确规格，不能直接改基础价格');
        await ensureServiceConfiguration(db, service, data);
        await db.shopService.update({ where: { id: service.id }, data });
      }
    } else {
      service = await db.shopService.create({ data: { ...data, shopId: shop.id, category: 'OTHER', priceBasis: 'PER_BOOKING' } });
      catalog.push({ ...service, variants: [], addOns: [] });
      item.booking = { serviceId: String(service.id) };
    }
    const latest = await db.shopService.findUnique({ where: { id: service.id }, include: PRICE_MENU_CATALOG_INCLUDE });
    const position = catalog.findIndex(row => String(row.id) === String(service.id));
    if (latest && position >= 0) catalog[position] = latest;
  }
  const remaining = menu.flatMap(group => group.items);
  const removed = before.filter(old => old.booking && !remaining.some(item => sameLink(item, old)));
  const disabled = new Set<string>();
  for (const old of removed) {
    const link = old.booking!, service = await db.shopService.findUnique({ where: { id: BigInt(link.serviceId) }, include: PRICE_MENU_CATALOG_INCLUDE });
    if (!service || String(service.shopId) !== String(shop.id)) continue;
    if (link.addOnId) {
      const key = `addon:${link.addOnId}`;
      if (disabled.has(key)) continue;
      const extra = service.addOns?.find((row: any) => String(row.id) === link.addOnId);
      if (extra?.isActive) await db.shopServiceAddOn.update({ where: { id: extra.id }, data: { isActive: false } });
      disabled.add(key); continue;
    }
    if (link.variantId) {
      const key = `variant:${link.variantId}`;
      if (!disabled.has(key)) {
        const variant = service.variants?.find((row: any) => String(row.id) === link.variantId);
        if (variant?.isActive) {
          if (await db.bookingItem.findFirst({ where: { variantId: variant.id, booking: { ...effectiveBookingWhere(), endTime: { gt: new Date() } } }, select: { id: true } })) throw new ConflictException('规格仍有有效未来预约，请先处理已有预约后再移除项目');
          await db.shopServiceVariant.update({ where: { id: variant.id }, data: { isActive: false } });
        }
        disabled.add(key);
      }
      continue;
    }
    // A removed legacy base reference is not an instruction to pause a parent
    // whose real options now live in variants, including unlisted siblings.
    if (!service.variants?.length && !disabled.has(`service:${link.serviceId}`)) {
      await ensureServiceConfiguration(db, service, { isActive: false });
      if (service.isActive) await db.shopService.update({ where: { id: service.id }, data: { isActive: false } });
      disabled.add(`service:${link.serviceId}`);
    }
  }
  // Effective availability belongs to reads, not stored configuration or write intent.
  return managedPriceMenu(resolvePriceMenu(menu, await loadPriceMenuCatalog(db, shop.id, menu), shop.id));
}
