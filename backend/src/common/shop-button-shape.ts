export const SHOP_BUTTON_SHAPES = ['rounded', 'pill', 'square'] as const;
export type ShopButtonShape = typeof SHOP_BUTTON_SHAPES[number];
export const DEFAULT_SHOP_BUTTON_SHAPE: ShopButtonShape = 'rounded';

export function normalizeShopButtonShape(value: unknown): ShopButtonShape {
  if (value === undefined || value === null || value === '') return DEFAULT_SHOP_BUTTON_SHAPE;
  if (typeof value === 'string' && (SHOP_BUTTON_SHAPES as readonly string[]).includes(value)) return value as ShopButtonShape;
  throw new Error('门店按钮形状无效');
}

export function publicShopButtonShape(value: unknown): ShopButtonShape {
  return typeof value === 'string' && (SHOP_BUTTON_SHAPES as readonly string[]).includes(value)
    ? value as ShopButtonShape
    : DEFAULT_SHOP_BUTTON_SHAPE;
}
