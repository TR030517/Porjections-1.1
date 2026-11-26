import { formatPriceMenuTitle, normalizePriceMenuPricing, PriceMenuPricingValidationError, type PriceMenuPricing } from './shop-price-menu-pricing';
import { normalizePriceMenu, PriceMenuValidationError, publicPriceMenu } from './shop-price-menu';
import { ValidationPipe } from '@nestjs/common';
import { UpdateShopDto } from '../modules/merchant/dto/merchant.dto';

const timed = (): PriceMenuPricing => ({ kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO' });
const entry = (pricing: PriceMenuPricing = timed()) => ({ name: formatPriceMenuTitle(pricing), priceText: '', description: 'Original note', imageUrl: '/service-gallery/v1/body-massage.webp', pricing });
const menu = (item: unknown) => [{ category: 'Body Massage', items: [item] }];

describe('explicit structured display-menu pricing', () => {
  test('actual global ValidationPipe preserves nested pricing without coercing strings into numeric metadata', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
    const body = { priceMenu: menu(entry()) }, dto = await pipe.transform(body, { type: 'body', metatype: UpdateShopDto });
    expect(normalizePriceMenu(dto.priceMenu)).toEqual(body.priceMenu);
    const invalid = await pipe.transform({ priceMenu: menu({ ...entry(), pricing: { ...timed(), priceCents: '5000' } }) }, { type: 'body', metatype: UpdateShopDto });
    expect(() => normalizePriceMenu(invalid.priceMenu)).toThrow(PriceMenuValidationError);
  });

  test('four kinds generate complete titles only from explicit metadata, without duration guessing or booking fields', () => {
    const variants: [PriceMenuPricing, string][] = [
      [timed(), '30 min Body Massage $50'],
      [{ ...timed(), kind: 'PER_SESSION', durationMin: null }, 'Body Massage $50 / session'],
      [{ ...timed(), kind: 'VARIABLE', durationMin: null }, 'Body Massage $50 · Duration varies'],
      [{ ...timed(), kind: 'ADD_ON', baseName: 'Essential Oil', durationMin: null, priceCents: 1000 }, 'Essential Oil +$10 · Add-on'],
    ];
    for (const [pricing, title] of variants) {
      expect(normalizePriceMenuPricing(pricing)).toEqual(pricing);
      expect(formatPriceMenuTitle(pricing)).toBe(title);
      expect(normalizePriceMenu(menu(entry(pricing)))).toEqual(menu(entry(pricing)));
      expect(publicPriceMenu(menu(entry(pricing)))).toEqual(menu(entry(pricing)));
      expect(JSON.stringify(normalizePriceMenu(menu(entry(pricing))))).not.toMatch(/currency|serviceId|participantCount|isActive/);
    }
  });

  test('integer cents produce stable zero, fractional and maximum dollar wording, while minute bounds stay explicit', () => {
    for (const [priceCents, expected] of [[0, '0'], [1, '0.01'], [10, '0.1'], [105, '1.05'], [1050, '10.5'], [99_999_999, '999999.99']] as const) {
      expect(formatPriceMenuTitle(normalizePriceMenuPricing({ ...timed(), priceCents }))).toBe(`30 min Body Massage $${expected}`);
    }
    for (const durationMin of [1, 1440]) expect(normalizePriceMenuPricing({ ...timed(), durationMin }).durationMin).toBe(durationMin);
    expect(normalizePriceMenuPricing({ ...timed(), baseName: ` ${'a'.repeat(198)} ` }).baseName).toBe('a'.repeat(198));
    expect(normalizePriceMenuPricing({ ...timed(), baseName: 'a'.repeat(200) }).baseName).toHaveLength(200);
  });

  test('rejects incomplete drafts, coercion, impossible mode/time combinations and unknown nested fields', () => {
    const invalid: unknown[] = [null, undefined, [], '50', {}, { ...timed(), unknown: true },
      { ...timed(), kind: 'SESSION' }, { ...timed(), titleMode: 'MANUAL' },
      ...[undefined, null, '', '30', 0, -1, 1.5, 1441, NaN, Infinity, false].map(durationMin => ({ ...timed(), durationMin })),
      ...[undefined, null, '', '5000', -1, 0.5, 100_000_000, NaN, Infinity, false].map(priceCents => ({ ...timed(), priceCents })),
      ...['PER_SESSION', 'VARIABLE', 'ADD_ON'].flatMap(kind => [undefined, 0, 30, '30'].map(durationMin => ({ ...timed(), kind, durationMin }))),
      ...[undefined, null, '', ' ', '<b>Massage</b>', 'Name\n', 'Name\u0000', 'x'.repeat(201)].map(baseName => ({ ...timed(), baseName })),
      ...[null, undefined, [], {}, { name: 'Old title' }, { name: 'Old title', priceText: '', secret: 'PRIVATE' }, { name: 1, priceText: '' }, { name: 'Old', priceText: null }, { name: 'x'.repeat(301), priceText: '' }, { name: 'Old', priceText: 'x'.repeat(301) }, { name: 'Old', priceText: '$50\n' }].map(legacySource => ({ ...timed(), legacySource })),
    ];
    for (const value of invalid) {
      expect(() => normalizePriceMenuPricing(value)).toThrow(PriceMenuPricingValidationError);
      expect(() => normalizePriceMenu(menu({ ...entry(), pricing: value }))).toThrow(PriceMenuValidationError);
    }
  });

  test('legacy menus keep literal name/price text and explicit conversions retain their exact source without sharing objects', () => {
    const legacy = { name: 'Old custom title', priceText: 'From CAD 80 / package?', description: 'Do not infer' };
    expect(normalizePriceMenu(menu(legacy))).toEqual(menu(legacy));
    expect(publicPriceMenu(menu(legacy))).toEqual(menu(legacy));
    const legacySource = { name: ' Original title ', priceText: ' From CAD 80 / package? ' };
    const pricing = { ...timed(), legacySource }, normalized = normalizePriceMenu(menu(entry(pricing)));
    expect(normalized[0].items[0].pricing?.legacySource).toEqual(legacySource);
    expect(normalized[0].items[0].pricing?.legacySource).not.toBe(legacySource);
    expect(normalized[0].items[0].pricing).not.toBe(pricing);
    legacySource.priceText = 'Later source mutation';
    expect(normalized[0].items[0].pricing?.legacySource?.priceText).toBe(' From CAD 80 / package? ');
  });

  test('automatic titles and empty legacy-price fields are enforced; custom complete titles remain explicit', () => {
    const savedAuto = { ...entry(), name: '30Mins Body Massage $50' };
    expect(normalizePriceMenu(menu(savedAuto))).toEqual(menu(savedAuto));
    expect(publicPriceMenu(menu(savedAuto))).toEqual(menu(entry()));
    expect(savedAuto.name).toBe('30Mins Body Massage $50');
    for (const item of [{ ...entry(), name: '30Mins Body Massage $80' }, { ...entry(), name: ' 30Mins Body Massage $50 ' }, { ...entry(), priceText: '$50' }, { ...entry(), priceText: ' ' }]) {
      expect(() => normalizePriceMenu(menu(item))).toThrow(PriceMenuValidationError);
      const { pricing: _pricing, ...wording } = item;
      expect(publicPriceMenu(menu(item))[0].items[0]).not.toHaveProperty('pricing');
      expect(publicPriceMenu(menu(item))[0].items[0].name).toBe(wording.name.trim());
    }
    const custom = { ...entry({ ...timed(), titleMode: 'CUSTOM' }), name: 'My exact custom complete title' };
    expect(normalizePriceMenu(menu(custom))).toEqual(menu(custom));
    expect(publicPriceMenu(menu(custom))).toEqual(menu(custom));
  });

  test('malformed stored metadata falls back to safe legacy wording and never exposes nested private data', () => {
    const value = [{ category: 'Body', items: [
      { name: 'Readable old row', priceText: 'Call for price', pricing: { secret: 'PRIVATE' } },
      { ...entry(), pricing: { ...timed(), legacySource: { name: 'Old', priceText: '', secret: 'PRIVATE' } } },
      { ...entry(), pricing: null },
    ] }];
    const projected = publicPriceMenu(value);
    expect(projected[0].items).toHaveLength(3);
    expect(projected[0].items.every(item => !Object.prototype.hasOwnProperty.call(item, 'pricing'))).toBe(true);
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|secret|legacySource/);
    expect(projected[0].items[0]).toEqual({ name: 'Readable old row', priceText: 'Call for price' });
  });
});
