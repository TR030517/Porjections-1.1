import { safePriceMenuMediaUrl } from './public-media-url';
import { formatPriceMenuTitle, matchesPriceMenuAutoTitle, normalizePriceMenuPricing, type PriceMenuPricing } from './shop-price-menu-pricing';

/** Explicit links only: legacy wording never implies an appointment SKU. */
export type PriceMenuBooking = { serviceId: string; variantId?: string; addOnId?: string };
const unavailableReasons = ['PARENT_PAUSED', 'ITEM_PAUSED', 'CONFIGURATION_REQUIRED', 'NO_SCHEDULE'] as const;
export type PriceMenuUnavailableReason = typeof unavailableReasons[number];
export type PriceMenuItem = { id?: string; name: string; priceText: string; description?: string; imageUrl?: string; isVisible?: boolean; pricing?: PriceMenuPricing; bookingEnabled?: boolean; bookingAvailable?: boolean; bookingUnavailableReason?: PriceMenuUnavailableReason; booking?: PriceMenuBooking; newVariantOf?: string; reservedDurationMin?: number; bookingMode?: 'SINGLE' | 'COUPLE' | 'FOUR_HANDS' };
export type PriceMenuGroup = { category: string; items: PriceMenuItem[] };
export const PRICE_MENU_LIMITS = Object.freeze({ groups: 100, items: 1000, category: 200, name: 300, priceText: 300, description: 2000, imageUrl: 500, bytes: 768 * 1024 });
export class PriceMenuValidationError extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function plainText(value: unknown, max: number, required = false, multiline = false): string | null {
  if (typeof value !== 'string' || value.length > max) return null;
  const text = value.replace(/\r\n?/g, '\n').trim();
  if ((required && !text) || /<\/?[a-z][^>]*>/iu.test(text)
    || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(text)) return null;
  return text;
}
function invalid(path: string): never { throw new PriceMenuValidationError(`Invalid ${path}`); }
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(path);
}
export function priceMenuBooking(value: unknown): PriceMenuBooking {
  if (!object(value)) invalid('priceMenu.booking');
  keys(value, ['serviceId', 'variantId', 'addOnId'], 'priceMenu.booking');
  const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
  if (!id(value.serviceId) || value.variantId !== undefined && !id(value.variantId) || value.addOnId !== undefined && !id(value.addOnId) || value.variantId !== undefined && value.addOnId !== undefined) invalid('priceMenu.booking');
  return { serviceId: value.serviceId, ...(value.variantId ? { variantId: value.variantId as string } : {}), ...(value.addOnId ? { addOnId: value.addOnId as string } : {}) };
}
function bookingFields(item: Record<string, unknown>, result: PriceMenuItem) {
  if (item.isVisible !== undefined) {
    if (typeof item.isVisible !== 'boolean') invalid('priceMenu.item.isVisible');
    result.isVisible = item.isVisible;
  }
  if (item.newVariantOf !== undefined) {
    if (item.booking !== undefined) invalid('priceMenu.item.newVariantOf (already bound)');
    result.newVariantOf = typeof item.newVariantOf === 'string' && /^item:[a-zA-Z0-9_-]{1,64}$/.test(item.newVariantOf) ? item.newVariantOf : priceMenuBooking({ serviceId: item.newVariantOf }).serviceId;
  }
  if (item.bookingMode !== undefined) {
    if (!['SINGLE', 'COUPLE', 'FOUR_HANDS'].includes(item.bookingMode as string)) invalid('priceMenu.item.bookingMode');
    result.bookingMode = item.bookingMode as PriceMenuItem['bookingMode'];
  }
  if (item.id !== undefined) {
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)) invalid('priceMenu.item.id');
    result.id = item.id;
  }
  if (item.bookingEnabled !== undefined) {
    if (typeof item.bookingEnabled !== 'boolean') invalid('priceMenu.item.bookingEnabled');
    result.bookingEnabled = item.bookingEnabled;
  }
  if (item.booking !== undefined) result.booking = priceMenuBooking(item.booking);
  if (item.reservedDurationMin !== undefined) {
    if (typeof item.reservedDurationMin !== 'number' || !Number.isInteger(item.reservedDurationMin) || item.reservedDurationMin < 5 || item.reservedDurationMin > 240) invalid('priceMenu.item.reservedDurationMin');
    result.reservedDurationMin = item.reservedDurationMin;
  }
}

/** Strict server input contract; invalid/oversized input is rejected as a whole, never truncated. */
export function normalizePriceMenu(value: unknown): PriceMenuGroup[] {
  if (!Array.isArray(value) || value.length > PRICE_MENU_LIMITS.groups) invalid('priceMenu (at most 100 groups)');
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).length; } catch { return invalid('priceMenu'); }
  if (bytes > PRICE_MENU_LIMITS.bytes) invalid('priceMenu (at most 768 KiB)');
  let total = 0;
  return value.map((group, groupIndex) => {
    const path = `priceMenu[${groupIndex}]`;
    if (!object(group)) invalid(path);
    keys(group, ['category', 'items'], path);
    const category = plainText(group.category, PRICE_MENU_LIMITS.category);
    if (category === null || !Array.isArray(group.items)) invalid(path);
    total += group.items.length;
    if (total > PRICE_MENU_LIMITS.items) invalid('priceMenu (at most 1000 items in total)');
    const items = group.items.map((item, itemIndex): PriceMenuItem => {
      const itemPath = `${path}.items[${itemIndex}]`;
      if (!object(item)) invalid(itemPath);
      keys(item, ['id', 'name', 'priceText', 'description', 'imageUrl', 'isVisible', 'pricing', 'bookingEnabled', 'bookingAvailable', 'bookingUnavailableReason', 'booking', 'newVariantOf', 'reservedDurationMin', 'bookingMode'], itemPath);
      // Clients may round-trip read metadata, but it is never a persisted mutation.
      if (item.bookingAvailable !== undefined && typeof item.bookingAvailable !== 'boolean') invalid(`${itemPath}.bookingAvailable`);
      if (item.bookingUnavailableReason !== undefined && !unavailableReasons.includes(item.bookingUnavailableReason as PriceMenuUnavailableReason)) invalid(`${itemPath}.bookingUnavailableReason`);
      const name = plainText(item.name, PRICE_MENU_LIMITS.name, true);
      const priceText = plainText(item.priceText, PRICE_MENU_LIMITS.priceText);
      if (name === null || priceText === null) invalid(itemPath);
      const result: PriceMenuItem = { name, priceText };
      bookingFields(item, result);
      if (Object.prototype.hasOwnProperty.call(item, 'pricing')) {
        let pricing: PriceMenuPricing;
        try { pricing = normalizePriceMenuPricing(item.pricing); } catch { invalid(`${itemPath}.pricing`); }
        if (item.priceText !== '') invalid(`${itemPath}.priceText (structured titles require empty priceText)`);
        if (pricing.titleMode === 'AUTO' && !matchesPriceMenuAutoTitle(item.name, pricing)) invalid(`${itemPath}.name (automatic title must match explicit pricing)`);
        result.pricing = pricing;
      }
      if (item.description !== undefined) {
        const description = plainText(item.description, PRICE_MENU_LIMITS.description, false, true);
        if (description === null) invalid(`${itemPath}.description`);
        if (description) result.description = description;
      }
      if (item.imageUrl !== undefined) {
        if (typeof item.imageUrl !== 'string' || item.imageUrl.length > PRICE_MENU_LIMITS.imageUrl) invalid(`${itemPath}.imageUrl`);
        const imageUrl = item.imageUrl.trim();
        if (imageUrl) {
          const safe = safePriceMenuMediaUrl(imageUrl);
          if (!safe) invalid(`${itemPath}.imageUrl (service gallery, HTTPS or managed image required)`);
          result.imageUrl = safe;
        }
      }
      return result;
    });
    return { category, items };
  }).map((group, _index, groups) => {
    const ids = groups.flatMap(entry => entry.items.map(item => item.id).filter(Boolean));
    if (new Set(ids).size !== ids.length) invalid('priceMenu.item.id (duplicate)');
    return group;
  });
}

/** Bounded explicit public projection; private/raw fields in stored JSON cannot be exposed. */
export function managedPriceMenu(value: unknown): PriceMenuGroup[] {
  if (!Array.isArray(value)) return [];
  const result: PriceMenuGroup[] = [];
  let visited = 0, bytes = 2;
  for (const group of value.slice(0, PRICE_MENU_LIMITS.groups)) {
    if (!object(group) || !Array.isArray(group.items)) continue;
    const category = plainText(group.category, PRICE_MENU_LIMITS.category);
    if (category === null) continue;
    bytes += new TextEncoder().encode(JSON.stringify({ category, items: [] })).length + 1;
    if (bytes >= PRICE_MENU_LIMITS.bytes) break;
    const items: PriceMenuItem[] = [];
    for (const item of group.items) {
      if (visited++ >= PRICE_MENU_LIMITS.items) break;
      if (!object(item)) continue;
      if (item.isVisible !== undefined && typeof item.isVisible !== 'boolean') continue;
      const name = plainText(item.name, PRICE_MENU_LIMITS.name, true);
      const priceText = plainText(item.priceText, PRICE_MENU_LIMITS.priceText);
      if (name === null || priceText === null) continue;
      const projected: PriceMenuItem = { name, priceText };
      try { bookingFields(item, projected); } catch { /* Invalid links never become a booking action. */ }
      if (Object.prototype.hasOwnProperty.call(item, 'pricing')) {
        try {
          const pricing = normalizePriceMenuPricing(item.pricing);
          if (item.priceText === '' && (pricing.titleMode === 'CUSTOM' || matchesPriceMenuAutoTitle(item.name, pricing))) {
            projected.pricing = pricing;
            if (pricing.titleMode === 'AUTO') projected.name = formatPriceMenuTitle(pricing);
          }
        } catch { /* Malformed metadata never leaks; safe legacy wording remains readable. */ }
      }
      const description = plainText(item.description, PRICE_MENU_LIMITS.description, false, true);
      const imageUrl = safePriceMenuMediaUrl(item.imageUrl);
      if (description) projected.description = description;
      if (imageUrl) projected.imageUrl = imageUrl;
      bytes += new TextEncoder().encode(JSON.stringify(projected)).length + 1;
      if (bytes > PRICE_MENU_LIMITS.bytes) break;
      items.push(projected);
    }
    result.push({ category, items });
    if (visited >= PRICE_MENU_LIMITS.items || bytes > PRICE_MENU_LIMITS.bytes) break;
  }
  return result;
}

/** Visibility is presentation only. Keep hidden rows in every management,
 * revision, media-reference and booking-binding path; filter at public edges. */
export function publicPriceMenu(value: unknown): PriceMenuGroup[] {
  return managedPriceMenu(value).map(group => ({ ...group, items: group.items.filter(item => item.isVisible !== false) }))
    .filter(group => group.items.length > 0);
}

/** Old clients omit new optional fields. Only exact stable identity can retain
 * a hidden value; a display name or array position cannot authorize unhiding. */
export function preservePriceMenuVisibility(value: unknown, previous: unknown): PriceMenuGroup[] {
  const menu = normalizePriceMenu(value), before = managedPriceMenu(previous).flatMap(group => group.items);
  const byId = new Map(before.filter(item => item.id).map(item => [item.id!, item]));
  const hidden = before.filter(item => item.isVisible === false);
  for (const item of menu.flatMap(group => group.items)) {
    if (item.isVisible !== undefined) continue;
    const old = item.id ? byId.get(item.id) : undefined;
    if (old) {
      if (old.isVisible !== undefined) item.isVisible = old.isVisible;
    } else if (hidden.length) {
      throw new PriceMenuValidationError('价目含隐藏项目且缺少稳定编号，请重新载入完整价目后保存，不能按名称或位置推断显示状态');
    }
  }
  return menu;
}
