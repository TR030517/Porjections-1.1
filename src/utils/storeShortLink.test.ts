import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyStoreShortLink, reconcileStoreShortLinkDrafts, savedStoreShortLink, storeShortLinkDraft } from './storeShortLink';

const before = { id: '9007199254740993', shortName: 'sample-spa', canonicalShortName: 'sample-spa', canonicalPath: '/s/sample-spa' };
const receipt = { ...before, shortName: 'new-spa', canonicalShortName: 'new-spa', canonicalPath: '/s/new-spa' };

test('short-link drafts preview exactly the accepted suffix without silently dropping characters', () => {
  assert.deepEqual(storeShortLinkDraft(' New-Spa '), { shortName: 'new-spa', path: '/s/new-spa' });
  for (const text of ['ab', 'spa--one', '-spa', 'spa-', 'spa one', 'spa/one', '/s/spa', 'https://example.test/spa', 's'.repeat(101)]) {
    assert.equal(storeShortLinkDraft(text), null, text);
  }
});

test('a saved canonical link must identify the exact store and the exact submitted destination', () => {
  assert.deepEqual(savedStoreShortLink(receipt, before.id, ' New-Spa '), receipt);
  for (const value of [null, { ...receipt, id: '9007199254740994' }, { ...receipt, id: 9007199254740992 },
    { ...receipt, shortName: 'old-spa' }, { ...receipt, canonicalShortName: 'other-spa' },
    { ...receipt, canonicalPath: '/s/other-spa' }, { ...receipt, canonicalPath: 'https://evil.test/s/new-spa' }]) {
    assert.throws(() => savedStoreShortLink(value, before.id, 'new-spa'), /保存回执/);
  }
});

test('a link receipt only changes the link fields and preserves fresher public and booking configuration', () => {
  const latest = { ...before, status: 'APPROVED', publicVisible: true, loginAccount: { status: 'SUSPENDED' },
    features: { onlineBooking: true }, priceMenu: [{ title: 'Latest menu' }], name: 'Latest store name' };
  const staleServerRow = { ...receipt, status: 'PENDING', publicVisible: false, features: { onlineBooking: false }, name: 'Old name' };
  const result = applyStoreShortLink(latest, savedStoreShortLink(staleServerRow, before.id, 'new-spa'));
  assert.equal(result.name, latest.name); assert.equal(result.status, 'APPROVED'); assert.equal(result.publicVisible, true);
  assert.equal(result.loginAccount, latest.loginAccount); assert.equal(result.features, latest.features); assert.equal(result.priceMenu, latest.priceMenu);
  assert.equal(result.canonicalPath, '/s/new-spa');
  const other = { ...latest, id: '9007199254740994' };
  assert.equal(applyStoreShortLink(other, receipt), other, 'another visible store is never replaced');
});

test('list refresh adopts the saved destination but preserves another store’s unsaved suffix', () => {
  const other = { ...before, id: '2', shortName: 'other-spa', canonicalShortName: 'other-spa', canonicalPath: '/s/other-spa' };
  assert.deepEqual(reconcileStoreShortLinkDrafts({ [before.id]: 'sample-spa', '2': 'unsaved-other' }, [before, other], [receipt, other]), {
    [before.id]: 'new-spa', '2': 'unsaved-other',
  });
  assert.deepEqual(reconcileStoreShortLinkDrafts({ [before.id]: ' New-Spa ' }, [before], [receipt]), { [before.id]: ' New-Spa ' });
  assert.deepEqual(reconcileStoreShortLinkDrafts({ '2': 'stale-scope-draft' }, [before], [receipt]), { [before.id]: 'new-spa' });
});
