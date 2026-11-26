export const SHOP_BRAND_COLOR_KEYS = ['teal', 'forest', 'blue', 'rose', 'slate'] as const;
export type ShopBrandColorKey = typeof SHOP_BRAND_COLOR_KEYS[number];
export const DEFAULT_SHOP_BRAND_COLOR: ShopBrandColorKey = 'teal';

export function normalizeShopBrandColor(value: unknown): ShopBrandColorKey {
  if (value === undefined || value === null || value === '') return DEFAULT_SHOP_BRAND_COLOR;
  if (typeof value === 'string' && (SHOP_BRAND_COLOR_KEYS as readonly string[]).includes(value)) return value as ShopBrandColorKey;
  throw new Error('门店品牌色无效');
}

export function publicShopBrandColor(value: unknown): ShopBrandColorKey {
  return typeof value === 'string' && (SHOP_BRAND_COLOR_KEYS as readonly string[]).includes(value)
    ? value as ShopBrandColorKey
    : DEFAULT_SHOP_BRAND_COLOR;
}
