import { BadRequestException } from '@nestjs/common';
import { validReservedDurationMin } from './service-duration';
import type { MenuCatalogSource } from './menu-catalog-preconditions';
import type { PriceMenuItem } from './shop-price-menu';

export interface DraftFamilyOption { item: PriceMenuItem; durationMin: number; }
export interface DraftFamilyPlan {
  seed: DraftFamilyOption;
  mode: NonNullable<PriceMenuItem['bookingMode']>;
  members: PriceMenuItem[];
  options: DraftFamilyOption[];
}
/** A display price is not automatically a reservation block. Never parse old
 * wording or borrow a child's price/minutes to manufacture an ancestor option. */
function option(item: PriceMenuItem): DraftFamilyOption | null {
  const pricing = item.pricing;
  if (!pricing || pricing.kind === 'ADD_ON') return null;
  const durationMin = pricing.kind === 'TIMED' ? pricing.durationMin : item.reservedDurationMin;
  return validReservedDurationMin(pricing.kind, durationMin) && pricing.priceCents > 0 && pricing.priceCents <= 10_000_000 ? { item, durationMin } : null;
}

/** Pure preflight, before the first writer. Only a wholly new family with an
 * explicitly enabled descendant needs eager identity materialization. Existing
 * canonical parents, including paused ones, remain on the normal guarded path. */
export function planDraftFamilies(items: readonly PriceMenuItem[], sources: Map<PriceMenuItem, MenuCatalogSource>): DraftFamilyPlan[] {
  const roots = new Set(items.filter(item => item.newVariantOf?.startsWith('item:') && item.bookingEnabled === true && !sources.get(item)?.serviceId)
    .map(item => sources.get(item)!.root));
  const result: DraftFamilyPlan[] = [];
  for (const root of roots) {
    const members = items.filter(item => sources.get(item)?.root === root && !sources.get(item)?.serviceId);
    const enabled = members.filter(item => item.bookingEnabled === true);
    const seedItem = enabled[0], seed = seedItem ? option(seedItem) : null;
    if (!seed) throw new BadRequestException('开启预约须设置5–240分钟占用时间与0.01–100000美元价格');
    const mode = seed.item.bookingMode ?? root.bookingMode ?? 'SINGLE';
    const pricing = seed.item.pricing!;
    for (const item of members) {
      if (item.pricing && (item.pricing.kind === 'ADD_ON' || item.pricing.baseName !== pricing.baseName || item.pricing.kind !== pricing.kind)
        || item.bookingMode !== undefined && item.bookingMode !== mode) throw new BadRequestException('同一服务的规格须使用相同基础名称、类型和预约方式');
      if (item.bookingEnabled === true && !option(item)) throw new BadRequestException('开启预约须设置5–240分钟占用时间与0.01–100000美元价格');
    }
    result.push({ seed, mode, members, options: members.flatMap(item => { const configured = option(item); return configured ? [configured] : []; }) });
  }
  return result;
}
