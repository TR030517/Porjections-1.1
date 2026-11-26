import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogSelectionConflict, remainingSelectionConflicts } from './catalogSelectionErrors';
import type { PriceMenuGroup } from './priceMenu';
const menu: PriceMenuGroup[] = [{ category: '', items: [{ id: 'draft-a', name: 'Body', priceText: '', booking: { serviceId: '9' } }, { id: 'draft-b', name: 'Foot', priceText: '', booking: { serviceId: '10' } }] }];
const before = [{ itemId: 'draft-a', serviceId: '9', expectedSelectionRevision: 'a'.repeat(64) }];
test('selection conflicts expose only existing draft rows for both transport error shapes', () => {
  for (const error of [{ status: 409, code: 'CATALOG_SELECTION_CHANGED', fields: { 'draft-a': '已更新', foreign: 'not this menu' } }, { code: 'ERR_BAD_REQUEST', response: { status: 409, data: { code: 'CATALOG_SELECTION_CHANGED', fields: { 'draft-a': '已更新' } } } }]) {
    assert.deepEqual(catalogSelectionConflict(error, menu), ['draft-a']);
  }
  assert.equal(catalogSelectionConflict({ status: 403, code: 'CATALOG_SELECTION_CHANGED' }, menu), null);
});
test('refresh without a new choice cannot acknowledge stale prices, but explicit reselection or removing the source can', () => {
  assert.deepEqual(remainingSelectionConflicts(['draft-a'], before, structuredClone(before), menu), ['draft-a']);
  assert.deepEqual(remainingSelectionConflicts(['draft-a'], before, [{ ...before[0], expectedSelectionRevision: 'b'.repeat(64) }], menu), []);
  assert.deepEqual(remainingSelectionConflicts(['draft-a'], before, [], []), []);
  const independent: PriceMenuGroup[] = [{ category: '', items: [{ id: 'draft-a', name: 'New main project', priceText: '' }] }];
  assert.deepEqual(remainingSelectionConflicts(['draft-a'], before, [], independent), []);
});
