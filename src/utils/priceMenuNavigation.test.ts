import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PriceMenuGroup } from './priceMenu';
import { initialPriceMenuLocation, locatePriceMenuItem, movePriceMenuEntry, priceMenuPage, searchPriceMenu } from './priceMenuNavigation';

function largeMenu(): PriceMenuGroup[] {
  return [{ category: 'Promotions', items: [] }, { category: 'Massage', items: Array.from({ length: 1000 }, (_, n) => ({ name: `Service ${n + 1}`, priceText: `From $${n + 1} / 60 min`, description: n === 999 ? 'Last special wording' : '' })) }];
}

test('a thousand-item menu opens the first nonempty group and every original item appears on exactly one bounded page', () => {
  const menu = largeMenu(), before = structuredClone(menu);
  assert.deepEqual(initialPriceMenuLocation(menu), { groupIndex: 1, page: 0 });
  assert.equal(priceMenuPage(menu, { groupIndex: -1, page: 0 }).groupIndex, 1, 'a menu loaded after an empty initial view also opens its first nonempty group');
  const visited: number[] = [];
  for (let page = 0; page < 50; page++) {
    const view = priceMenuPage(menu, { groupIndex: 1, page });
    assert.equal(view.pageCount, 50);
    assert.ok(view.endIndex - view.startIndex <= 20);
    for (let itemIndex = view.startIndex; itemIndex < view.endIndex; itemIndex++) visited.push(itemIndex);
  }
  assert.deepEqual(visited, Array.from({ length: 1000 }, (_, n) => n));
  assert.deepEqual(menu, before, 'navigation never replaces or edits the draft, including an empty promotion group');
});

test('search locates original late-page indices by name, group, exact price or description without filtering the saved menu', () => {
  const menu = largeMenu(), before = structuredClone(menu);
  for (const query of ['SERVICE 1000', '$1000 / 60', 'special wording']) {
    const result = searchPriceMenu(menu, query);
    assert.deepEqual(result, { total: 1, matches: [{ groupIndex: 1, itemIndex: 999 }] });
    assert.deepEqual(locatePriceMenuItem(menu, result.matches[0].groupIndex, result.matches[0].itemIndex), { groupIndex: 1, page: 49 });
  }
  assert.deepEqual(searchPriceMenu(menu, 'promotions').matches, [{ groupIndex: 0, itemIndex: null }]);
  assert.deepEqual(locatePriceMenuItem(menu, 0, null), { groupIndex: 0, page: 0 });
  const many = searchPriceMenu(menu, 'Service');
  assert.equal(many.total, 1000); assert.equal(many.matches.length, 30);
  assert.deepEqual(searchPriceMenu(menu, '   '), { total: 0, matches: [] });
  assert.deepEqual(menu, before);
});

test('edits after a search or page change use original coordinates and retain hidden groups and hidden items', () => {
  const menu = largeMenu(), before = structuredClone(menu);
  const match = searchPriceMenu(menu, 'special wording').matches[0];
  const selected = locatePriceMenuItem(menu, match.groupIndex, match.itemIndex);
  const view = priceMenuPage(menu, selected);
  assert.equal(view.startIndex, 980); assert.equal(view.endIndex, 1000);
  const edited = menu.map((group, at) => at === match.groupIndex ? { ...group, items: group.items.map((item, n) => n === match.itemIndex ? { ...item, name: 'Reworded completely' } : item) } : group);
  assert.equal(searchPriceMenu(edited, 'Service 1000').total, 0);
  assert.deepEqual(priceMenuPage(edited, selected), view, 'editing a previously matching field never changes the current page');
  assert.deepEqual(edited[0], before[0]); assert.deepEqual(edited[1].items.slice(0, 999), before[1].items.slice(0, 999));
  assert.deepEqual(menu, before);
});

test('moving an original item across a page boundary follows that item without losing or reordering unrelated hidden rows', () => {
  const menu = largeMenu(), original = menu[1].items;
  const moved = movePriceMenuEntry(original, 19, 20);
  assert.equal(moved[20], original[19]); assert.equal(moved[19], original[20]);
  assert.deepEqual(moved.slice(0, 19), original.slice(0, 19)); assert.deepEqual(moved.slice(21), original.slice(21));
  assert.deepEqual(locatePriceMenuItem([{ ...menu[1], items: moved }], 0, 20), { groupIndex: 0, page: 1 });
  assert.notEqual(moved, original); assert.equal(original[19].name, 'Service 20');
  const groups = movePriceMenuEntry(menu, 1, 0);
  assert.equal(groups[0], menu[1]); assert.equal(groups[1], menu[0]);
  assert.equal(movePriceMenuEntry(original, 0, -1), original);
});

test('deleting the last item/page or group clamps the view, while empty and promotion-only groups remain navigable', () => {
  const menu = [{ category: 'Promotions only', items: [] }, { category: 'Services', items: Array.from({ length: 21 }, (_, n) => ({ name: `Item ${n}`, priceText: '' })) }];
  assert.equal(priceMenuPage(menu, { groupIndex: 1, page: 1 }).startIndex, 20);
  const afterItemRemoval = [menu[0], { ...menu[1], items: menu[1].items.slice(0, 20) }];
  assert.equal(priceMenuPage(afterItemRemoval, { groupIndex: 1, page: 1 }).page, 0);
  assert.equal(locatePriceMenuItem(afterItemRemoval, 1, 999).page, 0);
  assert.equal(priceMenuPage([menu[0]], { groupIndex: 1, page: 49 }).groupIndex, 0);
  assert.equal(priceMenuPage([menu[0]], { groupIndex: 0, page: 4 }).itemCount, 0);
  assert.deepEqual(initialPriceMenuLocation([menu[0]]), { groupIndex: 0, page: 0 });
  assert.deepEqual(initialPriceMenuLocation([]), { groupIndex: -1, page: 0 });
  assert.equal(priceMenuPage([], { groupIndex: 9, page: 9 }).groupIndex, -1);
});
