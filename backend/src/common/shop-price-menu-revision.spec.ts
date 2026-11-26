import { matchesPriceMenuRevision, priceMenuRevision } from './shop-price-menu-revision';
import { publicShopProfile } from './shop-public-profile';
import { createHash } from 'node:crypto';

const menu = () => [{ category: 'Source', items: [{ name: 'Original item', priceText: '$80 / ask in store' }] }];

describe('internal content-based price menu revisions', () => {
  test('editors using the old effective-status contract must reload before submitting configuration switches', () => {
    const profile = { priceMenu: menu() };
    const stable = JSON.stringify({ shopId: '10', present: true, priceMenu: profile.priceMenu }, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    for (const oldVersion of ['v1', 'v2']) {
      const oldToken = createHash('sha256').update('massajoy-price-menu:' + oldVersion + ':').update(stable).digest('hex');
      expect(matchesPriceMenuRevision(10n, profile, oldToken)).toBe(false);
    }
    expect(matchesPriceMenuRevision(10n, profile, priceMenuRevision(10n, profile))).toBe(true);
  });
  test('is stable across JSON key order/string storage and unrelated private or scalar profile edits', () => {
    const profile = { priceMenu: menu(), sourceSample: { secret: 'PRIVATE_A' } };
    const reordered = { sourceSample: { secret: 'PRIVATE_B' }, priceMenu: [{ items: [{ priceText: '$80 / ask in store', name: 'Original item' }], category: 'Source' }] };
    const revision = priceMenuRevision(10n, profile);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(priceMenuRevision('10', reordered)).toBe(revision);
    expect(priceMenuRevision(10, JSON.stringify(profile))).toBe(revision);
    expect(matchesPriceMenuRevision(10n, reordered, revision)).toBe(true);
  });

  test('binds the same raw menu to its shop and detects all stored wording, image, order and unknown-field changes', () => {
    const profile = { priceMenu: menu() }, revision = priceMenuRevision(10n, profile);
    expect(priceMenuRevision(11n, profile)).not.toBe(revision);
    for (const item of [
      { name: 'Original item ', priceText: '$80 / ask in store' },
      { name: 'Original item', priceText: '$90 / ask in store' },
      { name: 'Original item', priceText: '$80 / ask in store', imageUrl: 'https://images.example.invalid/new.webp' },
      { name: 'Original item', priceText: '$80 / ask in store', unknownStoredField: 'Not in public projection' },
    ]) expect(priceMenuRevision(10n, { priceMenu: [{ category: 'Source', items: [item] }] })).not.toBe(revision);
    const multiple = { priceMenu: [...menu(), { category: 'Second', items: [] }] };
    expect(priceMenuRevision(10n, multiple)).not.toBe(priceMenuRevision(10n, { priceMenu: [...multiple.priceMenu].reverse() }));
    expect(priceMenuRevision(10n, {})).not.toBe(priceMenuRevision(10n, { priceMenu: [] }));
    expect(priceMenuRevision(10n, {})).not.toBe(priceMenuRevision(10n, { priceMenu: null }));
  });

  test('rejects absent, malformed and other-shop baselines; public detail and summaries never expose internal tokens', () => {
    const profile = { priceMenu: menu(), priceMenuRevision: 'PRIVATE_STORED_VALUE' };
    const revision = priceMenuRevision(10n, profile);
    for (const expected of [undefined, null, '', 1, {}, 'a'.repeat(64), revision.toUpperCase(), priceMenuRevision(11n, profile)]) {
      expect(matchesPriceMenuRevision(10n, profile, expected)).toBe(false);
    }
    const shop = { id: 10n, priceMenuRevision: revision, studioProfile: profile };
    for (const options of [{}, { includePriceMenu: false }]) {
      const projected = publicShopProfile(shop, [], options);
      expect(projected).not.toHaveProperty('priceMenuRevision');
      expect(JSON.stringify(projected)).not.toContain(revision);
      expect(JSON.stringify(projected)).not.toContain('PRIVATE_STORED_VALUE');
    }
  });
});
