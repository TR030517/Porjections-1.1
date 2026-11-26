import type { PriceMenuGroup, PriceMenuItem } from './priceMenu';
import { sourceServiceIdForItem } from './catalogSelection';

type Mode = NonNullable<PriceMenuItem['bookingMode']>;
const counts: Record<Mode, string> = {
  SINGLE: '单人服务：1位客人／1位技师。',
  COUPLE: '情侣按摩：2位客人／2位不同技师，同一时段同时服务。',
  FOUR_HANDS: '四手按摩：1位客人／2位不同技师，同一时段同时服务。',
};
/** Explain explicit ancestry only. Missing parent policy is not a single-person default. */
export function inheritedBookingMode(item: PriceMenuItem, menu: PriceMenuGroup[], seen = new Set<PriceMenuItem>()): Mode | undefined {
  if (seen.has(item)) return undefined;
  seen.add(item);
  const rows = menu.flatMap(group => group.items);
  const serviceId = sourceServiceIdForItem(item, menu);
  const parents = item.newVariantOf?.startsWith('item:')
    ? rows.filter(row => row.id === item.newVariantOf!.slice(5))
    : serviceId ? rows.filter(row => row !== item && row.booking?.serviceId === serviceId
      && !row.booking?.variantId && !row.booking?.addOnId && row.pricing?.kind !== 'ADD_ON') : [];
  if (parents.length !== 1) return undefined;
  const parent = parents[0];
  return parent.bookingMode ?? inheritedBookingMode(parent, menu, seen);
}
export function bookingModeHelp(item: PriceMenuItem, menu: PriceMenuGroup[], defaultSingle = false, catalogMode?: Mode): string {
  if (item.bookingMode) return `当前选择：${counts[item.bookingMode]}${item.newVariantOf || item.booking?.variantId ? '预约方式由主项目及其规格共用。' : ''}`;
  if (defaultSingle) return `新建独立项目默认：${counts.SINGLE}`;
  const inherited = inheritedBookingMode(item, menu) ?? catalogMode;
  if (inherited) return `沿用主项目预约方式：${counts[inherited]}`;
  return item.newVariantOf || item.booking ? '沿用主项目预约方式；主项目人数尚未读取，请先核对主项目预约设置。' : '请选择预约方式，以确定客人与技师人数。';
}
