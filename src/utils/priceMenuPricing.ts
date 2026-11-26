export const PRICE_MENU_KINDS = ['TIMED', 'PER_SESSION', 'VARIABLE', 'ADD_ON'] as const;
export type PriceMenuKind = typeof PRICE_MENU_KINDS[number];
export interface PriceMenuPricing {
  kind: PriceMenuKind;
  baseName: string;
  durationMin: number | null;
  priceCents: number | null;
  titleMode: 'AUTO' | 'CUSTOM';
  legacySource?: { name: string; priceText: string };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function plain(v: unknown, max: number, required: boolean, trim = true): string {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(v) || required && !v.trim()) throw new Error('项目名称须为有效纯文本。');
  return trim ? v.trim() : v;
}
/** Save boundary. Null numeric values exist only in an incomplete editor draft. */
export function normalizePriceMenuPricing(value: unknown): PriceMenuPricing {
  if (!object(value) || Object.keys(value).some(key => !['kind','baseName','durationMin','priceCents','titleMode','legacySource'].includes(key))
    || !PRICE_MENU_KINDS.includes(value.kind as PriceMenuKind) || !['AUTO','CUSTOM'].includes(value.titleMode as string)) throw new Error('项目计价方式无效。');
  const kind = value.kind as PriceMenuKind, baseName = plain(value.baseName, 200, true);
  if (typeof value.priceCents !== 'number' || !Number.isInteger(value.priceCents) || value.priceCents < 0 || value.priceCents > 99999999) throw new Error('请填写 0–999999.99 美元的项目价格，最多两位小数。');
  if (kind === 'TIMED' ? typeof value.durationMin !== 'number' || !Number.isInteger(value.durationMin) || value.durationMin < 1 || value.durationMin > 1440 : value.durationMin !== null) throw new Error(kind === 'TIMED' ? '固定时长项目须填写 1–1440 的整数分钟。' : '按次、非固定时长和附加项目不填写固定分钟数。');
  const result: PriceMenuPricing = { kind, baseName, durationMin: value.durationMin as number | null, priceCents: value.priceCents, titleMode: value.titleMode as 'AUTO' | 'CUSTOM' };
  if (Object.hasOwn(value, 'legacySource')) {
    const source = value.legacySource;
    if (!object(source) || Object.keys(source).length !== 2 || Object.keys(source).some(key => !['name','priceText'].includes(key))) throw new Error('旧价目原文格式无效。');
    result.legacySource = { name: plain(source.name,300,false,false), priceText: plain(source.priceText,300,false,false) };
  }
  return result;
}
export function formatPriceMenuDollars(cents: number): string {
  const fraction = cents % 100;
  return String(Math.floor(cents / 100)) + (fraction ? '.' + String(fraction).padStart(2,'0').replace(/0$/, '') : '');
}
/** Drafts keep the chosen name until both required values have been provided. */
export function formatPriceMenuTitle(pricing: PriceMenuPricing): string {
  const name = pricing.baseName.trim();
  if (pricing.priceCents === null || pricing.kind === 'TIMED' && pricing.durationMin === null) return name;
  const money = '$' + formatPriceMenuDollars(pricing.priceCents);
  switch (pricing.kind) {
    case 'TIMED': return `${pricing.durationMin} min ${name} ${money}`;
    case 'PER_SESSION': return `${name} ${money} / session`;
    case 'VARIABLE': return `${name} ${money} · Duration varies`;
    case 'ADD_ON': return `${name} +${money} · Add-on`;
  }
}

/** Older AUTO titles remain valid when the stored wording matches every pricing field. */
export function matchesPriceMenuAutoTitle(title: unknown, pricing: PriceMenuPricing): boolean {
  const expected = formatPriceMenuTitle(pricing);
  if (title === expected) return true;
  if (pricing.kind !== 'TIMED' || pricing.durationMin === null || pricing.priceCents === null) return false;
  return title === `${pricing.durationMin}Mins ${pricing.baseName.trim()} $${formatPriceMenuDollars(pricing.priceCents)}`;
}

export function priceMenuKindLabel(kind: PriceMenuKind, language: 'en' | 'zh' = 'zh'): string {
  return (language === 'zh' ? { TIMED:'固定时长', PER_SESSION:'按次', VARIABLE:'非固定时长', ADD_ON:'附加项目' } : { TIMED:'Fixed duration', PER_SESSION:'Per session', VARIABLE:'Duration varies', ADD_ON:'Add-on' })[kind];
}
