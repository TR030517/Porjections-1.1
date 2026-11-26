import { PRICE_MENU_LIMITS, type PriceMenuItem } from './priceMenu';
import { formatPriceMenuTitle, normalizePriceMenuPricing, type PriceMenuKind } from './priceMenuPricing';

export interface PriceMenuQuickSteps { minutes: number; priceCents: number; }
export interface PriceMenuQuickEntry { item: PriceMenuItem; incremented: boolean; notice: string; }
export const DEFAULT_PRICE_MENU_STEPS: Readonly<PriceMenuQuickSteps> = Object.freeze({ minutes: 30, priceCents: 3000 });
export const PRICE_MENU_QUICK_LIMITS = Object.freeze({ minutes: 1440, priceCents: 99_999_999 });

/** The explicitly entered starting values seed item one; later items use them as increments. */
export function firstPriceMenuItem(baseName: string, values: PriceMenuQuickSteps, kind: PriceMenuKind = 'TIMED'): PriceMenuQuickEntry {
  checkedSteps(values);
  if (kind === 'TIMED' && values.minutes === 0) throw new Error('首个项目的初始时长须为 1–1440 分钟；已有项目后，时间步长可以为 0。');
  const pricing = { kind, baseName, durationMin: kind === 'TIMED' ? values.minutes : null, priceCents: values.priceCents, titleMode: 'AUTO' as const };
  return { item: { name: formatPriceMenuTitle(pricing), priceText: '', pricing }, incremented: false, notice: '已使用所填初始时长和价格创建项目 1；继续添加将复制上一项并按下方步长递增。' };
}

// Only explicit minute units and USD amounts are supported. Dollar signs here
// mean the USD format explicitly selected by the editor; no currency conversion.
const NUMBER = '(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?';
const MONEY = `(?:\\$[ \\t]*${NUMBER}|USD[ \\t]+${NUMBER}|${NUMBER}[ \\t]+USD)`;
const MINUTES = '[1-9]\\d*[ \\t]*(?:minutes?|mins?)\\b';
const AMBIGUOUS = /\b(?:from|starting|starts?|up\s+to|and\s+up|per|each|persons?|people|couples?|double|duo|two|pair|packages?|bundles?|combos?|combinations?|sessions?|visits?|buy|get|hands?|CAD|AUD|NZD|HKD|SGD|EUR|GBP|JPY|CNY|RMB)\b|[€£¥￥]|双人|雙人|二人|两人|兩人|每人|按人|套餐|套票|次卡|起价|起價|起步|区间|區間|范围|範圍|赠送|贈送|买\S*送|買\S*送/iu;

interface Token { kind: 'minutes' | 'price'; start: number; end: number; value: number; decimals: number; numberStart: number; numberEnd: number; }
interface Parsed { tokens: Token[]; minutes?: number; priceCents?: number; reason?: string; }

function checkedSteps(steps: PriceMenuQuickSteps): void {
  if (!steps || !Number.isInteger(steps.minutes) || steps.minutes < 0 || steps.minutes > PRICE_MENU_QUICK_LIMITS.minutes
    || !Number.isInteger(steps.priceCents) || steps.priceCents < 0 || steps.priceCents > PRICE_MENU_QUICK_LIMITS.priceCents) {
    throw new Error('新增未执行：时间步长须为 0–1440 的整数分钟，价格步长须为 0–99999999 的整数美分；0 表示保持原值。');
  }
}

function copyItem(previous: PriceMenuItem): PriceMenuItem {
  if (!previous || typeof previous.name !== 'string' || typeof previous.priceText !== 'string'
    || previous.description !== undefined && typeof previous.description !== 'string'
    || previous.imageUrl !== undefined && typeof previous.imageUrl !== 'string') throw new Error('上一项格式无效，未新增或修改价目。');
  return { name: previous.name, priceText: previous.priceText,
    ...(previous.pricing?.kind !== 'ADD_ON' && !previous.booking?.addOnId && (previous.booking || previous.newVariantOf || previous.id) ? { newVariantOf: previous.booking?.serviceId ?? previous.newVariantOf ?? `item:${previous.id}`, bookingEnabled: false } : {}),
    ...(previous.bookingMode ? { bookingMode: previous.bookingMode } : {}),
    ...(previous.reservedDurationMin !== undefined ? { reservedDurationMin: previous.reservedDurationMin } : {}),
    ...(previous.description !== undefined ? { description: previous.description } : {}),
    ...(previous.imageUrl !== undefined ? { imageUrl: previous.imageUrl } : {}),
    ...(previous.pricing !== undefined ? { pricing: structuredClone(previous.pricing) } : {}) };
}

function parse(raw: string, field: 'name' | 'priceText'): Parsed {
  const label = field === 'name' ? '项目名称' : '原价文字';
  if (!raw.trim()) return { tokens: [] };
  if (AMBIGUOUS.test(raw)) return { tokens: [], reason: `${label}含起价、套餐、多人或非美元等不明确口径` };
  const tokens: Token[] = [];
  // One combined scan prevents overlapping tokens from interpreting a dollar
  // amount as a duration. All unconsumed text is checked below.
  for (const match of raw.matchAll(new RegExp(`${MINUTES}|${MONEY}`, 'giu'))) {
    const start = match.index!, number = /\d+(?:\.\d{1,2})?/u.exec(match[0])!;
    const numeric = number[0], kind = /(?:minutes?|mins?)$/iu.test(match[0]) ? 'minutes' : 'price';
    const [whole, fraction = ''] = numeric.split('.');
    const value = kind === 'minutes' ? Number(whole) : Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(value) || value < (kind === 'minutes' ? 1 : 0) || value > (kind === 'minutes' ? PRICE_MENU_QUICK_LIMITS.minutes : PRICE_MENU_QUICK_LIMITS.priceCents)) {
      return { tokens: [], reason: `${label}中的时间或美元金额超出支持范围` };
    }
    tokens.push({ kind, start, end: start + match[0].length, value, decimals: fraction.length, numberStart: start + number.index, numberEnd: start + number.index + numeric.length });
  }
  const times = tokens.filter(token => token.kind === 'minutes'), prices = tokens.filter(token => token.kind === 'price');
  if (times.length > 1 || prices.length > 1) return { tokens: [], reason: `${label}含多个时长或金额` };
  if (field === 'priceText') {
    if (!tokens.length || raw.slice(0, tokens[0].start).trim() || raw.slice(tokens[tokens.length - 1].end).trim()
      || tokens.length === 2 && !/^(?:[ \t]+|[ \t]*[\/·][ \t]*)$/u.test(raw.slice(tokens[0].end, tokens[1].start))) {
      return { tokens: [], reason: '原价文字不是单一美元金额、分钟时长或二者以空格、/、· 分隔的完整格式' };
    }
  } else {
    const time = times[0], price = prices[0];
    // A name can remain an arbitrary plain label. Numeric technique names are
    // intentionally not interpreted as a time or a price.
    let title = raw;
    for (const token of [...tokens].reverse()) title = title.slice(0, token.start) + title.slice(token.end);
    if (time && raw.slice(0, time.start).trim() || price && raw.slice(price.end).trim()
      || !/^[\p{L}\p{M} \t'’()\-]*$/u.test(title)) return { tokens: [], reason: '项目名称含其他数字或不支持的格式，仅支持开头分钟时长与结尾美元金额' };
  }
  return { tokens, ...(times[0] ? { minutes: times[0].value } : {}), ...(prices[0] ? { priceCents: prices[0].value } : {}) };
}

function money(cents: number, originalDecimals: number): string {
  const whole = Math.floor(cents / 100), fraction = cents % 100;
  const decimals = fraction % 10 ? 2 : fraction ? Math.max(1, originalDecimals) : originalDecimals;
  return String(whole) + (decimals ? '.' + String(fraction).padStart(2, '0').slice(0, decimals) : '');
}

function advance(raw: string, parsed: Parsed, steps: PriceMenuQuickSteps): string | null {
  let next = raw;
  for (const token of [...parsed.tokens].reverse()) {
    const value = token.value + (token.kind === 'minutes' ? steps.minutes : steps.priceCents);
    if (value > (token.kind === 'minutes' ? PRICE_MENU_QUICK_LIMITS.minutes : PRICE_MENU_QUICK_LIMITS.priceCents)) return null;
    const replacement = token.kind === 'minutes' ? String(value) : money(value, token.decimals);
    next = next.slice(0, token.numberStart) + replacement + next.slice(token.numberEnd);
  }
  return next;
}

/** Clone the complete preceding item. An uncertain format keeps both text fields
 * unchanged; description and image are always copied verbatim, independent of UI
 * switches. This never creates a booking SKU or fills in a missing amount/time. */
export function cloneNextPriceMenuItem(previous: PriceMenuItem | undefined, steps: PriceMenuQuickSteps): PriceMenuQuickEntry {
  checkedSteps(steps);
  if (previous === undefined) return { item: { name: '', priceText: '' }, incremented: false, notice: '本组首项为空白模板，请填写名称与原价文字；未推测金额或时长。' };
  const item = copyItem(previous);
  const unchanged = (reason: string): PriceMenuQuickEntry => ({ item, incremented: false, notice: `已完整复制上一项，名称和原价文字保持不变：${reason}，请手动核对。` });
  if (item.pricing) {
    let pricing;
    try { pricing = normalizePriceMenuPricing(item.pricing); }
    catch { return unchanged('上一项目的名称、价格或时长尚未设置完整'); }
    const priceCents = pricing.priceCents! + steps.priceCents;
    const durationMin = pricing.kind === 'TIMED' ? pricing.durationMin! + steps.minutes : null;
    if (priceCents > PRICE_MENU_QUICK_LIMITS.priceCents || durationMin !== null && durationMin > PRICE_MENU_QUICK_LIMITS.minutes) return unchanged('递增后的金额或时长超出支持范围');
    const nextPricing = { ...pricing, durationMin, priceCents, titleMode: 'AUTO' as const };
    const name = formatPriceMenuTitle(nextPricing);
    if (name.length > PRICE_MENU_LIMITS.name) return unchanged('递增后标题超过300字');
    return { item: { ...item, name, priceText: '', pricing: nextPricing }, incremented: name !== item.name || priceCents !== pricing.priceCents || durationMin !== pricing.durationMin,
      notice: pricing.kind === 'TIMED' ? '已复制上一项，并按时间与价格步长生成新标题。自定义标题在新增项中恢复自动生成。' : '已复制上一项并递增价格；按次、非固定时长和附加项目不增加分钟数。' };
  }
  if (!steps.minutes && !steps.priceCents) return { item, incremented: false, notice: '两个步长均为 0，已完整原样复制上一项。' };
  const name = parse(item.name, 'name'), price = parse(item.priceText, 'priceText');
  const ambiguousDescription = item.description && AMBIGUOUS.test(item.description);
  if (name.reason || price.reason || ambiguousDescription) return unchanged(name.reason ?? price.reason ?? '说明含套餐、多人或其他不明确口径');
  if (name.minutes !== undefined && price.minutes !== undefined && name.minutes !== price.minutes
    || name.priceCents !== undefined && price.priceCents !== undefined && name.priceCents !== price.priceCents) return unchanged('名称与原价文字的金额或时长不一致');
  const nextName = advance(item.name, name, steps), nextPrice = advance(item.priceText, price, steps);
  if (nextName === null || nextPrice === null) return unchanged('递增后的时长超过 1440 分钟或金额超过 999999.99 美元');
  if (nextName.length > PRICE_MENU_LIMITS.name || nextPrice.length > PRICE_MENU_LIMITS.priceText) return unchanged('递增后文字超出 300 字限制，未截断');
  const incremented = nextName !== item.name || nextPrice !== item.priceText;
  return { item: { ...item, name: nextName, priceText: nextPrice }, incremented,
    notice: incremented ? '已完整复制上一项，并按所设步长递增明确的分钟时长与美元金额；缺少的数值未补填，请核对后保存。' : '已完整复制上一项；未找到对应非零步长可递增的明确数值，未补填金额或时长。' };
}
