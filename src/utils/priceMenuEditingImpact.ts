import type { PriceMenuGroup, PriceMenuItem } from './priceMenu';
import { catalogFamilyKeyForItem } from './catalogSelection';

export type PriceMenuRemovalEffect = 'RETAINED' | 'DISABLE_VARIANT' | 'DISABLE_ADD_ON' | 'BASE_WITH_VARIANTS' | 'CHECK_BASE_SERVICE' | 'DRAFT_ONLY';
export interface PriceMenuRemovalImpact {
  key: string;
  kind: 'service' | 'variant' | 'addOn' | 'display';
  serviceId?: string;
  variantId?: string;
  addOnId?: string;
  serviceName?: string;
  name: string;
  displayNames: string[];
  removedBindings: number;
  remainingBindings: number;
  parentPaused: boolean;
  effect: PriceMenuRemovalEffect;
}
export interface PriceMenuRemovalRequest {
  groupIndex: number; itemIndex?: number; fingerprint: string; label: string; itemCount: number;
  /** Last display bindings being removed, not proof that their parent service will retire. */
  retiringBindings: number;
  impacts: PriceMenuRemovalImpact[];
}
const binding = (item: PriceMenuItem) => item.booking ? `${item.booking.serviceId}:${item.booking.variantId ?? ''}:${item.booking.addOnId ?? ''}` : undefined;

/** Explain the actual explicit selection. Same names never identify another service. */
export function priceMenuFamilySize(menu: PriceMenuGroup[], item: PriceMenuItem): number {
  const key = catalogFamilyKeyForItem(item, menu);
  return key ? menu.flatMap(group => group.items).filter(row => catalogFamilyKeyForItem(row, menu) === key).length : 1;
}
export function preparePriceMenuRemoval(menu: PriceMenuGroup[], groupIndex: number, itemIndex?: number): PriceMenuRemovalRequest | null {
  if (!Number.isInteger(groupIndex) || !menu[groupIndex] || itemIndex !== undefined && (!Number.isInteger(itemIndex) || !menu[groupIndex].items[itemIndex])) return null;
  const group = menu[groupIndex], selected = itemIndex === undefined ? group.items : [group.items[itemIndex]];
  const all = menu.flatMap(entry => entry.items);
  const remaining = menu.flatMap((entry, groupAt) => entry.items.filter((_, itemAt) => groupAt !== groupIndex || itemIndex !== undefined && itemAt !== itemIndex));
  const impacts: PriceMenuRemovalImpact[] = [];
  const seen = new Set<string>();
  for (const [at, item] of selected.entries()) {
    const key = binding(item);
    if (!key) {
      impacts.push({ key: `display:${at}`, kind: 'display', name: item.name || '未命名项目', displayNames: [item.name || '未命名项目'],
        removedBindings: 0, remainingBindings: 0, parentPaused: false, effect: 'DRAFT_ONLY' });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const link = item.booking!;
    const linkedRows = selected.filter(row => binding(row) === key);
    const remainingBindings = remaining.filter(row => binding(row) === key).length;
    const family = all.filter(row => row.booking?.serviceId === link.serviceId);
    const kind = link.addOnId ? 'addOn' : link.variantId ? 'variant' : 'service';
    const serviceName = family.find(row => !row.booking?.addOnId && row.pricing?.baseName)?.pricing?.baseName
      || family.find(row => !row.booking?.variantId && !row.booking?.addOnId)?.name
      || `主项目 #${link.serviceId}`;
    // A menu can omit real catalog variants. Absence here cannot prove a standalone service.
    const hasKnownVariants = family.some(row => !!row.booking?.variantId);
    const effect: PriceMenuRemovalEffect = remainingBindings ? 'RETAINED'
      : kind === 'addOn' ? 'DISABLE_ADD_ON' : kind === 'variant' ? 'DISABLE_VARIANT'
      : hasKnownVariants ? 'BASE_WITH_VARIANTS' : 'CHECK_BASE_SERVICE';
    impacts.push({ key, kind, serviceId: link.serviceId, ...(link.variantId ? { variantId: link.variantId } : {}), ...(link.addOnId ? { addOnId: link.addOnId } : {}),
      serviceName, name: kind === 'service' ? serviceName : kind === 'addOn' ? item.pricing?.baseName || item.name || '未命名附加项' : item.name || '未命名规格',
      displayNames: [...new Set(linkedRows.map(row => row.name || '未命名项目'))], removedBindings: linkedRows.length, remainingBindings,
      parentPaused: family.some(row => row.bookingUnavailableReason === 'PARENT_PAUSED'), effect });
  }
  return { groupIndex, ...(itemIndex === undefined ? {} : { itemIndex }), fingerprint: JSON.stringify(menu),
    label: itemIndex === undefined ? group.category || '未命名分组' : selected[0].name || '未命名项目', itemCount: selected.length,
    retiringBindings: impacts.filter(impact => impact.kind !== 'display' && impact.remainingBindings === 0).length, impacts };
}
/** Late refresh or a reordered draft cannot confirm a removal against an old position. */
export function priceMenuRemovalIsCurrent(menu: PriceMenuGroup[], request: PriceMenuRemovalRequest): boolean {
  return JSON.stringify(menu) === request.fingerprint && preparePriceMenuRemoval(menu, request.groupIndex, request.itemIndex) !== null;
}
