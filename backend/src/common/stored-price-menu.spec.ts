import { normalizePriceMenu } from './shop-price-menu';
import { storedPriceMenuProjection } from './stored-price-menu';

// Public price-menu fields copied from the read-only Wellness Moon Spa #1335
// fixture. No account, customer, password or private profile material.
const row = () => ({ id: 'legacy-price-7908', name: '30mins Massage', priceText: '30 min · $40', description: 'Cards+$3',
  booking: { serviceId: '2045', variantId: '6474' }, imageUrl: 'https://appqn.asianmassagebook.com/image/20261104/Fj2kauYtIWNY8B3dmoFeZ7eiAtch.png',
  pricing: { kind: 'TIMED', baseName: 'Massage', durationMin: 30, priceCents: 4000, titleMode: 'CUSTOM',
    legacySource: { name: '30mins Massage', priceText: 'price=40; price_vip=0; og_price=0; price_minute=0; times=1' } } });
const menu = () => [{ category: 'Massage', items: [row()] }];

describe('trusted migrated price-menu projection', () => {
  test('actual migrated row reads without rewriting a byte and keeps custom title and complete legacy source', () => {
    const raw = menu(), before = JSON.stringify(raw), view = storedPriceMenuProjection(raw);
    expect(JSON.stringify(raw)).toBe(before); expect(view[0].items[0]).toEqual({ ...raw[0].items[0], priceText: '' });
    expect(() => normalizePriceMenu(raw)).toThrow('structured titles require empty priceText');
    expect(() => normalizePriceMenu(view)).not.toThrow();
  });
  test('new contradictions and modified or duplicated legacy content cannot borrow saved-data compatibility', () => {
    const prior = menu();
    for (const value of [menu(), [{ category: 'Massage', items: [{ ...row(), id: 'new-row' }] }]]) expect(() => storedPriceMenuProjection(value, [])).toThrow();
    expect(() => storedPriceMenuProjection([{ category: 'Massage', items: [{ ...row(), description: 'Injected changed content' }] }], prior)).toThrow();
    expect(() => storedPriceMenuProjection([{ category: 'Massage', items: [row(), { ...row(), id: 'new-row' }] }], prior)).toThrow();
    const withoutSource: any = menu(); delete withoutSource[0].items[0].pricing.legacySource;
    expect(() => storedPriceMenuProjection(withoutSource)).toThrow();
  });
  test('only ID assignment or group movement can retain an existing ID-less row and its exact content once', () => {
    const raw: any = menu(); delete raw[0].items[0].id;
    const moved = [{ category: 'Moved', items: [{ ...raw[0].items[0], id: 'assigned-by-command' }] }];
    expect(storedPriceMenuProjection(moved, raw)[0].items[0].name).toBe(row().name);
    expect(() => storedPriceMenuProjection([{ category: 'Moved', items: [moved[0].items[0], { ...moved[0].items[0], id: 'extra-copy' }] }], raw)).toThrow();
  });
  test('malformed legacy metadata, unsafe images and unknown fields remain rejected as complete menus', () => {
    for (const patch of [{ imageUrl: 'javascript:invalid' }, { injected: true }, { pricing: { ...row().pricing, legacySource: { name: '<script>x</script>', priceText: '40' } } }]) {
      expect(() => storedPriceMenuProjection([{ category: 'Massage', items: [{ ...row(), ...patch }] }])).toThrow();
    }
  });
});
