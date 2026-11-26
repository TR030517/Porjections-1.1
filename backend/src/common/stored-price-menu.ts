import { normalizePriceMenu, PRICE_MENU_LIMITS, PriceMenuValidationError, type PriceMenuGroup } from './shop-price-menu';

function record(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function isLegacyStructuredPriceRow(value: unknown): boolean {
  return record(value) && typeof value.priceText === 'string' && value.priceText !== ''
    && record(value.pricing) && value.pricing.titleMode === 'CUSTOM' && record(value.pricing.legacySource);
}
const signature = (item: Record<string, any>, withoutId = false) => {
  // Layout may assign a real ID to an old ID-less row. Every content field,
  // including old wording, links and the complete legacySource, stays exact.
  const { id: _id, ...content } = item;
  return JSON.stringify(withoutId ? content : item, (_key, value) => record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
};

/** Trusted saved-data compatibility only, never a request-input normalizer.
 * Migrated CUSTOM rows retained a redundant priceText plus legacySource.
 * Project that redundant text away for reads/validation without rewriting the
 * saved JSON. A later command may retain only byte-equivalent legacy content
 * from its authoritative baseline; newly introduced contradictions still fail. */
export function storedPriceMenuProjection(value: unknown, baseline: unknown = value): PriceMenuGroup[] {
  if (new TextEncoder().encode(JSON.stringify(value)).length > PRICE_MENU_LIMITS.bytes) throw new PriceMenuValidationError('Invalid saved priceMenu (at most 768 KiB)');
  const saved: Record<string, any>[] = Array.isArray(baseline) ? baseline.flatMap(group => record(group) && Array.isArray(group.items) ? group.items.filter(isLegacyStructuredPriceRow) : []) : [];
  const used = new Set<number>();
  const compatible = (item: Record<string, any>) => {
    const match = saved.findIndex((prior, index) => !used.has(index) && (prior.id === undefined ? signature(prior, true) === signature(item, true) : signature(prior) === signature(item)));
    if (match < 0) return false; used.add(match); return true;
  };
  const projection = Array.isArray(value) ? value.map(group => record(group) && Array.isArray(group.items) ? {
    ...group, items: group.items.map(item => isLegacyStructuredPriceRow(item) && compatible(item) ? { ...item, priceText: '' } : item),
  } : group) : value;
  return normalizePriceMenu(projection);
}
