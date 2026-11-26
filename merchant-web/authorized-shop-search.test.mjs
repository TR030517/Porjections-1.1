import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('authorized shop search finds names, exact large IDs, short links, cities and states without changing its authorized collection', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { authorizedShopOptions, matchesAuthorizedShop } = await server.ssrLoadModule('/src/utils/authorizedShopOptions.ts');
    const shops = [
      { id: '9007199254740993', name: 'Café Wellness', nameEn: 'Cafe Wellness', shortName: 'seattle-spa', city: 'Seattle', state: 'Washington', accessType: 'ASSOCIATED', status: 'APPROVED' },
      { id: '9007199254740994', name: 'Café Wellness', shortName: 'new-york-spa', city: 'New York', state: 'NY', accessType: 'OWN', status: 'PENDING' },
    ];
    const before = structuredClone(shops), options = authorizedShopOptions(shops);
    assert.deepEqual(shops, before);
    assert.deepEqual(options.map(option => option.value), shops.map(shop => shop.id), 'IDs remain strings and only authorized shops are emitted');
    assert.notEqual(options[0].label, options[1].label, 'same-name shops are distinguished by their ID');
    assert.match(options[0].label, /#9007199254740993.*关联门店.*已发布/);
    for (const query of ['CAFE', 'Seattle', 'washington', 'seattle-spa', '9007199254740993', '#9007199254740993', 'cafe seattle']) {
      assert.equal(matchesAuthorizedShop(query, options[0]), true, query);
    }
    assert.equal(matchesAuthorizedShop('9007199254740994', options[0]), false);
    assert.deepEqual(options.filter(option => matchesAuthorizedShop('new york', option)).map(option => option.value), ['9007199254740994']);
    assert.deepEqual(options.filter(option => matchesAuthorizedShop('unauthorized-shop', option)), []);
    assert.equal(matchesAuthorizedShop('   ', options[0]), true);
    assert.equal(matchesAuthorizedShop('Seattle', undefined), false);
  } finally { await server.close(); }
});
