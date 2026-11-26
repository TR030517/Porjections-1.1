export const SHOP_BUTTON_SHAPES = [
  { value: 'rounded', label: '标准圆角', radius: '10px' },
  { value: 'pill', label: '胶囊', radius: '999px' },
  { value: 'square', label: '直角', radius: '2px' },
] as const;

export type ShopButtonShape = typeof SHOP_BUTTON_SHAPES[number]['value'];

export function shopButtonShape(value: unknown): ShopButtonShape {
  return SHOP_BUTTON_SHAPES.some(option => option.value === value)
    ? value as ShopButtonShape
    : 'rounded';
}
