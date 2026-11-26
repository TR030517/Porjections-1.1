/** Structured menu wording. Linked amounts come from the service catalog; checkout still accepts IDs only. */
export type PriceMenuPricingKind = 'TIMED' | 'PER_SESSION' | 'VARIABLE' | 'ADD_ON';
export interface PriceMenuPricing {
  kind: PriceMenuPricingKind;
  baseName: string;
  durationMin: number | null;
  priceCents: number;
  titleMode: 'AUTO' | 'CUSTOM';
  legacySource?: { name: string; priceText: string };
}

const KINDS = ['TIMED', 'PER_SESSION', 'VARIABLE', 'ADD_ON'] as const;
const KEYS = ['kind', 'baseName', 'durationMin', 'priceCents', 'titleMode', 'legacySource'];
export class PriceMenuPricingValidationError extends Error {}
function invalid(field: string): never { throw new PriceMenuPricingValidationError(`Invalid display-menu pricing.${field}`); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function plain(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)
    || /<\/?[a-z][^>]*>/iu.test(value)) invalid(field);
  return value;
}

/** Strict persisted metadata. No numeric coercion, inferred duration or source parsing. */
export function normalizePriceMenuPricing(value: unknown): PriceMenuPricing {
  if (!record(value) || Object.keys(value).some(key => !KEYS.includes(key))) invalid('shape');
  if (typeof value.kind !== 'string' || !KINDS.includes(value.kind as PriceMenuPricingKind)) invalid('kind');
  const kind = value.kind as PriceMenuPricingKind;
  const baseName = plain(value.baseName, 200, 'baseName').trim();
  if (!baseName) invalid('baseName');
  if (kind === 'TIMED') {
    if (typeof value.durationMin !== 'number' || !Number.isInteger(value.durationMin) || value.durationMin < 1 || value.durationMin > 1440) invalid('durationMin');
  } else if (value.durationMin !== null) invalid('durationMin');
  if (typeof value.priceCents !== 'number' || !Number.isInteger(value.priceCents) || value.priceCents < 0 || value.priceCents > 99_999_999) invalid('priceCents');
  if (value.titleMode !== 'AUTO' && value.titleMode !== 'CUSTOM') invalid('titleMode');
  const result: PriceMenuPricing = { kind, baseName, durationMin: value.durationMin as number | null, priceCents: value.priceCents, titleMode: value.titleMode };
  if (Object.prototype.hasOwnProperty.call(value, 'legacySource')) {
    if (!record(value.legacySource) || Object.keys(value.legacySource).some(key => !['name', 'priceText'].includes(key))) invalid('legacySource');
    // Keep the original two fields byte-for-byte; conversion must be explicit.
    result.legacySource = { name: plain(value.legacySource.name, 300, 'legacySource.name'), priceText: plain(value.legacySource.priceText, 300, 'legacySource.priceText') };
  }
  return result;
}

function dollars(cents: number): string {
  const whole = Math.floor(cents / 100), fraction = cents % 100;
  return String(whole) + (fraction ? '.' + String(fraction).padStart(2, '0').replace(/0$/, '') : '');
}

/** Call with normalized persisted metadata; values never depend on locale/float rounding. */
export function formatPriceMenuTitle(pricing: PriceMenuPricing): string {
  const price = dollars(pricing.priceCents);
  switch (pricing.kind) {
    case 'TIMED': return `${pricing.durationMin} min ${pricing.baseName} $${price}`;
    case 'PER_SESSION': return `${pricing.baseName} $${price} / session`;
    case 'VARIABLE': return `${pricing.baseName} $${price} · Duration varies`;
    case 'ADD_ON': return `${pricing.baseName} +$${price} · Add-on`;
  }
}

/** Check the previous AUTO format using the same explicit pricing fields. */
export function matchesPriceMenuAutoTitle(title: unknown, pricing: PriceMenuPricing): boolean {
  return title === formatPriceMenuTitle(pricing)
    || pricing.kind === 'TIMED' && title === `${pricing.durationMin}Mins ${pricing.baseName} $${dollars(pricing.priceCents)}`;
}
