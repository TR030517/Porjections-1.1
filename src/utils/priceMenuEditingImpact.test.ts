import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparePriceMenuRemoval, priceMenuFamilySize, priceMenuRemovalIsCurrent } from './priceMenuEditingImpact';
import type { PriceMenuGroup } from './priceMenu';
const menu: PriceMenuGroup[] = [{ category: 'Body', items: [
  { id: 'root', name: '60 minutes', priceText: '', booking: { serviceId: '1', variantId: '2' } },
  { id: 'next', name: '90 minutes', priceText: '', newVariantOf: 'item:root' },
  { id: 'other', name: '60 minutes', priceText: '', booking: { serviceId: '3' } },
] }, { category: 'Other placement', items: [{ id: 'duplicate', name: '60 minutes again', priceText: '', booking: { serviceId: '1', variantId: '2' } }] }];
test('removal counts only distinct selected bindings not still retained elsewhere in the full draft', () => {
  const before = structuredClone(menu), item = preparePriceMenuRemoval(menu, 0, 0)!;
  assert.equal(item.itemCount, 1); assert.equal(item.retiringBindings, 0);
  assert.equal(item.impacts[0].effect, 'RETAINED'); assert.equal(item.impacts[0].remainingBindings, 1);
  const group = preparePriceMenuRemoval(menu, 0)!;
  assert.equal(group.itemCount, 3); assert.equal(group.retiringBindings, 1); assert.equal(group.label, 'Body');
  assert.deepEqual(menu, before);
});
test('remaining bindings count each exact placement across all groups, not names or parent siblings', () => {
  const rows: PriceMenuGroup[] = [{ category: 'Remove', items: [
    { name: '60 min', priceText: '', booking: { serviceId: '1', variantId: '2' } },
    { name: 'Duplicate label', priceText: '', booking: { serviceId: '1', variantId: '2' } },
  ] }, { category: 'Keep', items: [
    { name: '60 min', priceText: '', booking: { serviceId: '1', variantId: '2' } },
    { name: 'Another placement', priceText: '', booking: { serviceId: '1', variantId: '2' } },
    { name: '60 min', priceText: '', booking: { serviceId: '9', variantId: '2' } },
    { name: '90 min', priceText: '', booking: { serviceId: '1', variantId: '3' } },
  ] }];
  const request = preparePriceMenuRemoval(rows, 0)!;
  assert.equal(request.impacts.length, 1);
  assert.deepEqual(request.impacts[0], { key: '1:2:', kind: 'variant', serviceId: '1', variantId: '2', serviceName: '主项目 #1', name: '60 min',
    displayNames: ['60 min', 'Duplicate label'], removedBindings: 2, remainingBindings: 2, parentPaused: false, effect: 'RETAINED' });
  assert.equal(request.retiringBindings, 0);
});
test('last variant and add-on bindings identify only their own saved targets', () => {
  const rows: PriceMenuGroup[] = [{ category: 'Remove', items: [
    { name: '60 min Body', priceText: '', pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 60, priceCents: 6000, titleMode: 'AUTO' }, booking: { serviceId: '1', variantId: '2' } },
    { name: 'Oil display', priceText: '', pricing: { kind: 'ADD_ON', baseName: 'Aroma Oil', durationMin: null, priceCents: 1000, titleMode: 'CUSTOM' }, booking: { serviceId: '1', addOnId: '3' } },
  ] }];
  const request = preparePriceMenuRemoval(rows, 0)!;
  assert.equal(request.retiringBindings, 2);
  assert.deepEqual(request.impacts.map(row => [row.kind, row.name, row.serviceName, row.remainingBindings, row.effect]), [
    ['variant', '60 min Body', 'Body Massage', 0, 'DISABLE_VARIANT'], ['addOn', 'Aroma Oil', 'Body Massage', 0, 'DISABLE_ADD_ON'],
  ]);
});
test('legacy base removal does not retire a parent with real variants even when both are selected', () => {
  const rows: PriceMenuGroup[] = [{ category: 'Remove', items: [
    { name: 'Body Massage', priceText: '', booking: { serviceId: '1' } },
    { name: '60 min Body', priceText: '', booking: { serviceId: '1', variantId: '2' } },
  ] }];
  assert.equal(preparePriceMenuRemoval(rows, 0, 0)!.impacts[0].effect, 'BASE_WITH_VARIANTS');
  assert.deepEqual(preparePriceMenuRemoval(rows, 0)!.impacts.map(row => row.effect), ['BASE_WITH_VARIANTS', 'DISABLE_VARIANT']);
});
test('absence of variants in the display menu never proves that the catalog parent is standalone', () => {
  const rows: PriceMenuGroup[] = [{ category: 'Remove', items: [{ name: 'Legacy base', priceText: '', booking: { serviceId: '1' } }] }];
  assert.equal(preparePriceMenuRemoval(rows, 0)!.impacts[0].effect, 'CHECK_BASE_SERVICE');
});
test('a paused parent remains explicit even when another binding is retained', () => {
  const rows = structuredClone(menu); rows[1].items[0].bookingUnavailableReason = 'PARENT_PAUSED';
  const impact = preparePriceMenuRemoval(rows, 0, 0)!.impacts[0];
  assert.equal(impact.parentPaused, true); assert.equal(impact.effect, 'RETAINED'); assert.equal(impact.remainingBindings, 1);
});
test('unlinked display and new-variant drafts cannot deactivate saved booking targets', () => {
  const rows: PriceMenuGroup[] = [{ category: 'Drafts', items: [
    { name: 'Display only', priceText: '$40' }, { name: 'Unsaved variant', priceText: '', newVariantOf: '1' },
  ] }];
  const request = preparePriceMenuRemoval(rows, 0)!;
  assert.equal(request.retiringBindings, 0);
  assert.deepEqual(request.impacts.map(row => [row.kind, row.effect, row.name]), [
    ['display', 'DRAFT_ONLY', 'Display only'], ['display', 'DRAFT_ONLY', 'Unsaved variant'],
  ]);
});
test('a confirmed target becomes stale on edit, reorder or deletion, even when the old numeric position still exists', () => {
  const request = preparePriceMenuRemoval(menu, 0, 2)!;
  assert.equal(priceMenuRemovalIsCurrent(structuredClone(menu), request), true);
  const edited = structuredClone(menu); edited[0].items[2].name = 'Changed'; assert.equal(priceMenuRemovalIsCurrent(edited, request), false);
  const reordered = structuredClone(menu); reordered[0].items.reverse(); assert.equal(priceMenuRemovalIsCurrent(reordered, request), false);
  assert.equal(priceMenuRemovalIsCurrent([], request), false);
  for (const target of [[-1, 0], [0, 99], [0.5, 0]]) assert.equal(preparePriceMenuRemoval(menu, target[0], target[1]), null);
});
test('shared-field impact follows explicit family identity across groups, preserving independent same-name projects', () => {
  assert.equal(priceMenuFamilySize(menu, menu[0].items[0]), 3);
  assert.equal(priceMenuFamilySize(menu, menu[0].items[1]), 3);
  assert.equal(priceMenuFamilySize(menu, menu[0].items[2]), 1);
});
