import { listingDetailsIncomplete } from './shop-directory-policy';
import { publicShopProfile } from './shop-public-profile';
import { canonicalShopLink, normalizeShopShortName } from './shop-alias';

describe('public directory completeness warning', () => {
  const complete = { address: '1207 S Jackson St #109B', city: 'Seattle', state: 'Washington' };

  it('marks missing or known placeholder fields without guessing a replacement', () => {
    for (const field of ['address', 'city', 'state']) {
      for (const value of [undefined, null, '', '  ', ' Address pending update ', 'UNKNOWN', 'N/A']) {
        const shop = { ...complete, [field]: value };
        const before = { ...shop };
        expect(listingDetailsIncomplete(shop)).toBe(true);
        expect(shop).toEqual(before);
      }
    }
    expect(listingDetailsIncomplete(undefined)).toBe(true);
    expect(listingDetailsIncomplete(complete)).toBe(false);
    expect(listingDetailsIncomplete({ ...complete, address: '123 Unknown Valley Rd' })).toBe(false);
  });

  it('projects one boolean, never private import, owner, password or unapproved verification claims', () => {
    const secret = { passwordHash: 'private', email: 'private@example.invalid', credential: 'private' };
    const projection = publicShopProfile({ ...complete, address: 'Address pending update', owner: secret,
      studioProfile: { ...secret, listingDetailsIncomplete: false, verified: true, internalNotes: 'private' } }, [], { includeBookingCalendar: false });
    expect(projection.listingDetailsIncomplete).toBe(true);
    expect(JSON.stringify(projection)).not.toContain('private');
    expect(projection).not.toHaveProperty('verified');
    expect(projection).not.toHaveProperty('owner');
    expect(publicShopProfile(complete).listingDetailsIncomplete).toBe(false);
    // Completeness is not an authorization or feature change.
    expect(projection).not.toHaveProperty('features');
  });

  it('reserves public app routes and still rejects invalid shop names', () => {
    for (const path of ['privacy', 'terms', 'support', 'feedback']) {
      expect(() => normalizeShopShortName(path)).toThrow();
      expect(canonicalShopLink(path).canonicalPath).toBeNull();
    }
    expect(canonicalShopLink('wellness-moon-spa').canonicalPath).toBe('/s/wellness-moon-spa');
  });
});
