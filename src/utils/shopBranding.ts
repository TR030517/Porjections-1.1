export const SHOP_BRAND_COLORS = {
  teal: { label: '青绿', hex: '#287C7C' },
  forest: { label: '森林绿', hex: '#2D6A4F' },
  blue: { label: '蓝色', hex: '#32648A' },
  rose: { label: '玫瑰红', hex: '#8E4552' },
  slate: { label: '石墨灰', hex: '#45515C' },
} as const;

export type ShopBrandColor = keyof typeof SHOP_BRAND_COLORS;

export function shopBrandColor(value: unknown): ShopBrandColor {
  return typeof value === 'string' && Object.hasOwn(SHOP_BRAND_COLORS, value)
    ? value as ShopBrandColor
    : 'teal';
}

export function shopBrandHex(value: unknown): string {
  return SHOP_BRAND_COLORS[shopBrandColor(value)].hex;
}
