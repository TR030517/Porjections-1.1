import type { PriceMenuGroup } from './priceMenu';

export const PRICE_MENU_PAGE_SIZE = 20;
export const PRICE_MENU_SEARCH_LIMIT = 30;
export interface PriceMenuLocation { groupIndex: number; page: number; }
export interface PriceMenuSearchMatch { groupIndex: number; itemIndex: number | null; }

const index = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function initialPriceMenuLocation(menu: PriceMenuGroup[]): PriceMenuLocation {
  const first = menu.findIndex(group => group.items.length > 0);
  return { groupIndex: menu.length ? Math.max(0, first) : -1, page: 0 };
}

/** A view into the original arrays, never a filtered/rebuilt menu to save. */
export function priceMenuPage(menu: PriceMenuGroup[], location: PriceMenuLocation) {
  if (!menu.length) return { groupIndex: -1, page: 0, pageCount: 0, startIndex: 0, endIndex: 0, itemCount: 0 };
  const groupIndex = location.groupIndex < 0 ? initialPriceMenuLocation(menu).groupIndex : Math.min(index(location.groupIndex), menu.length - 1);
  const itemCount = menu[groupIndex].items.length;
  const pageCount = Math.max(1, Math.ceil(itemCount / PRICE_MENU_PAGE_SIZE));
  const page = Math.min(index(location.page), pageCount - 1);
  const startIndex = page * PRICE_MENU_PAGE_SIZE;
  return { groupIndex, page, pageCount, startIndex, endIndex: Math.min(startIndex + PRICE_MENU_PAGE_SIZE, itemCount), itemCount };
}

export function locatePriceMenuItem(menu: PriceMenuGroup[], groupIndex: number, itemIndex: number | null): PriceMenuLocation {
  const group = priceMenuPage(menu, { groupIndex, page: 0 });
  if (group.groupIndex === -1 || itemIndex === null || !group.itemCount) return { groupIndex: group.groupIndex, page: 0 };
  const selectedItem = Math.min(index(itemIndex), group.itemCount - 1);
  return { groupIndex: group.groupIndex, page: Math.floor(selectedItem / PRICE_MENU_PAGE_SIZE) };
}

/** Search returns original coordinates only. Clicking a match is a separate action. */
export function searchPriceMenu(menu: PriceMenuGroup[], query: string) {
  const term = query.trim().toLocaleLowerCase();
  const matches: PriceMenuSearchMatch[] = [];
  let total = 0;
  const add = (match: PriceMenuSearchMatch) => { total++; if (matches.length < PRICE_MENU_SEARCH_LIMIT) matches.push(match); };
  if (!term) return { matches, total };
  menu.forEach((group, groupIndex) => {
    if (group.category.toLocaleLowerCase().includes(term)) add({ groupIndex, itemIndex: null });
    group.items.forEach((item, itemIndex) => {
      if ([item.name, item.priceText, item.description ?? ''].join(' ').toLocaleLowerCase().includes(term)) add({ groupIndex, itemIndex });
    });
  });
  return { matches, total };
}

export function movePriceMenuEntry<T>(entries: T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return entries;
  const next = [...entries];
  const [entry] = next.splice(from, 1); next.splice(to, 0, entry);
  return next;
}
