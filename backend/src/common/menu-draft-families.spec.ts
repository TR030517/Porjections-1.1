import { menuCatalogSources } from './menu-catalog-preconditions';
import { planDraftFamilies } from './menu-draft-families';
import type { PriceMenuItem } from './shop-price-menu';

const item = (id: string, extra: any = {}): PriceMenuItem => ({ id, name: id, priceText: '', bookingEnabled: false,
  pricing: { kind: 'TIMED', baseName: 'Synthetic family', durationMin: 60, priceCents: 8000, titleMode: 'CUSTOM' }, ...extra });
const plan = (items: PriceMenuItem[]) => planDraftFamilies(items, menuCatalogSources([{ category: 'Synthetic', items }], []));

describe('pure fresh-family catalog planning before writers', () => {
  test('a multilevel closed60/closed90/enabled120 chain retains independent values, independent flags and an enabled seed', () => {
    const earlier = item('first'), middle = item('second', { newVariantOf: 'item:first', pricing: { ...earlier.pricing, durationMin: 90, priceCents: 11000 } }),
      enabled = item('third', { newVariantOf: 'item:second', bookingEnabled: true, pricing: { ...earlier.pricing, durationMin: 120, priceCents: 14003 } });
    const before = JSON.stringify([earlier, middle, enabled]), families = plan([enabled, middle, earlier]);
    expect(families).toHaveLength(1); expect(families[0].seed).toEqual({ item: enabled, durationMin: 120 });
    expect(families[0].options.map(row => [row.item.id, row.durationMin, row.item.pricing!.priceCents, row.item.bookingEnabled])).toEqual([
      ['third', 120, 14003, true], ['second', 90, 11000, false], ['first', 60, 8000, false],
    ]);
    expect(JSON.stringify([earlier, middle, enabled])).toBe(before);
  });

  test('unstructured or unrepresentable closed ancestors are not converted into made-up options', () => {
    for (const earlier of [
      { id: 'first', name: 'Original text', priceText: 'Call us', bookingEnabled: false },
      item('first', { pricing: { kind: 'TIMED', baseName: 'Synthetic family', durationMin: 15, priceCents: 0, titleMode: 'CUSTOM' } }),
    ]) {
      const enabled = item('second', { bookingEnabled: true, newVariantOf: 'item:first' }), result = plan([earlier, enabled]);
      expect(result[0].options).toEqual([{ item: enabled, durationMin: 60 }]); expect(result[0].members).toContain(earlier);
    }
  });

  test('no enabled descendant means no eager service or option materialization plan', () => {
    const first = item('first'), second = item('second', { newVariantOf: 'item:first' });
    expect(plan([first, second])).toEqual([]);
    expect(plan([item('independent', { bookingEnabled: true })])).toEqual([]);
  });

  test('an existing canonical paused source is never handled as a fresh family', () => {
    const first = item('first', { booking: { serviceId: '20', variantId: '30' } }), second = item('second', { bookingEnabled: true, newVariantOf: 'item:first' });
    expect(plan([first, second])).toEqual([]);
  });

  test('a conflicting disabled ancestor or invalid explicitly enabled child fails before any planning mutation', () => {
    const inherited = plan([item('first', { bookingMode: 'COUPLE' }), item('second', { bookingEnabled: true, newVariantOf: 'item:first' })]);
    expect(inherited[0].mode).toBe('COUPLE');
    for (const first of [item('first', { bookingMode: 'COUPLE' }), item('first', { pricing: { ...item('unused').pricing, baseName: 'Other parent' } })]) {
      expect(() => plan([first, item('second', { bookingEnabled: true, bookingMode: 'SINGLE', newVariantOf: 'item:first' })])).toThrow('相同基础名称');
    }
    expect(() => plan([item('first'), item('second', { bookingEnabled: true, newVariantOf: 'item:first', pricing: { ...item('unused').pricing, durationMin: 4 } })])).toThrow('占用时间');
  });
});
