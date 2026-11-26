import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PriceMenuGroup, PriceMenuItem } from './priceMenu';
import { removePriceMenuDraftGroup, removePriceMenuDraftItem } from './priceMenuDraftReferences';

const row = (id: string, minutes: number, newVariantOf?: string): PriceMenuItem => ({
  id, name: `${minutes}Mins Body Massage $${minutes}`, priceText: '',
  pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: minutes, priceCents: minutes * 100, titleMode: 'AUTO' },
  description: `Original ${id}`, imageUrl: `https://images.example.invalid/${id}.webp`,
  bookingEnabled: false, bookingMode: 'FOUR_HANDS', reservedDurationMin: minutes,
  ...(newVariantOf ? { newVariantOf } : {}),
});
const group = (...items: PriceMenuItem[]): PriceMenuGroup => ({ category: 'Massage', items });
const withoutParent = (item: PriceMenuItem) => { const next = { ...item }; delete next.newVariantOf; return next; };

test('deleting the first 30-minute draft promotes 60 and reattaches 90 without changing project values or activation', () => {
  const source = [group(row('first', 30), row('second', 60, 'item:first'), row('third', 90, 'item:first'))];
  const before = structuredClone(source), saved = removePriceMenuDraftItem(source, 0, 0);
  assert.deepEqual(saved, [group(withoutParent(source[0].items[1]), { ...source[0].items[2], newVariantOf: 'item:second' })]);
  assert.deepEqual(source, before, 'deletion leaves the old draft untouched');
  assert.equal(saved[0].items[0].bookingEnabled, false);
  assert.equal(saved[0].items[0].bookingMode, 'FOUR_HANDS');
});

test('a remaining sibling in the deleted root group is promoted ahead of an earlier row in another group', () => {
  const earlier = row('earlier', 90, 'item:first'), first = row('first', 30), sibling = row('sibling', 60, 'item:first');
  const saved = removePriceMenuDraftItem([group(earlier), group(first, sibling)], 1, 0);
  assert.equal(saved[1].items[0].newVariantOf, undefined);
  assert.equal(saved[0].items[0].newVariantOf, 'item:sibling');
  assert.deepEqual(withoutParent(saved[0].items[0]), withoutParent(earlier));
});

test('removing an entire root group repairs all cross-group references while unrelated identical titles keep their own identity', () => {
  const unrelated = row('unrelated', 60), first = row('first', 30), child = row('child', 60, 'item:first'), later = row('later', 90, 'item:first');
  const source = [group(first), group(child, unrelated), group(later)];
  const saved = removePriceMenuDraftGroup(source, 0);
  assert.deepEqual(saved[0].items[0], withoutParent(child));
  assert.equal(saved[1].items[0].newVariantOf, 'item:child');
  assert.equal(saved[0].items[1], unrelated, 'matching words do not merge unrelated drafts');
});

test('deleting an intermediate draft reconnects its children to the retained explicit ancestor', () => {
  const root = row('root', 30), middle = row('middle', 60, 'item:root'), leaf = row('leaf', 90, 'item:middle');
  const source = [group(root, middle), group(leaf)];
  const saved = removePriceMenuDraftItem(source, 0, 1);
  assert.equal(saved[0].items[0], root);
  assert.deepEqual(saved[1].items[0], { ...leaf, newVariantOf: 'item:root' });
});

test('a reordered descendant may be promoted without leaving a chain or cycle through its former parent', () => {
  const first = row('first', 30), middle = row('middle', 60, 'item:first'), leaf = row('leaf', 90, 'item:middle');
  const saved = removePriceMenuDraftItem([group(first, leaf, middle)], 0, 0);
  assert.deepEqual(saved[0].items[0], withoutParent(leaf));
  assert.equal(saved[0].items[1].newVariantOf, 'item:leaf');
});

test('explicit service ancestry survives deleting a local source and direct service references stay unchanged', () => {
  const root = { ...row('root', 30), booking: { serviceId: '20', variantId: '21' } }, middle = row('middle', 60, 'item:root');
  const leaf = row('leaf', 90, 'item:middle'), direct = row('direct', 120, '20');
  const saved = removePriceMenuDraftGroup([group(root, middle), group(leaf, direct)], 0);
  assert.deepEqual(saved[0].items[0], { ...leaf, newVariantOf: '20' });
  assert.equal(saved[0].items[1], direct);
  const external = row('external', 30, '9007199254740997'), child = row('child', 60, 'item:external');
  assert.equal(removePriceMenuDraftItem([group(external, child)], 0, 0)[0].items[0].newVariantOf, '9007199254740997');
});

test('anonymous legacy children can reuse the removed draft identity and retain every copied field', () => {
  const first = row('first', 30), child = { ...row('child', 60, 'item:first'), id: undefined }, later = row('later', 90, 'item:first');
  const saved = removePriceMenuDraftItem([group(first, child, later)], 0, 0);
  assert.deepEqual(saved[0].items[0], { ...withoutParent(child), id: 'first' });
  assert.equal(saved[0].items[1].newVariantOf, 'item:first');
});

test('promotion preserves an explicitly enabled non-fixed option, its reserved minutes and custom wording', () => {
  const root = row('root', 30);
  const option: PriceMenuItem = { ...row('option', 60, 'item:root'), name: 'Custom visit wording',
    pricing: { kind: 'VARIABLE', baseName: 'Body Massage', durationMin: null, priceCents: 9500, titleMode: 'CUSTOM' },
    bookingEnabled: true, bookingMode: 'COUPLE', reservedDurationMin: 45 };
  const saved = removePriceMenuDraftItem([group(root, option)], 0, 0);
  assert.deepEqual(saved[0].items[0], withoutParent(option));
  assert.equal(saved[0].items[0].bookingEnabled, true);
  assert.equal(saved[0].items[0].reservedDurationMin, 45);
});

test('invalid coordinates are no-ops and deletion does not silently repair unrelated malformed references', () => {
  const malformed = row('bad', 60, 'item:missing'), source = [group(row('first', 30), malformed)];
  assert.equal(removePriceMenuDraftItem(source, 0, 9), source);
  assert.equal(removePriceMenuDraftGroup(source, -1), source);
  assert.equal(removePriceMenuDraftItem(source, 0, 0)[0].items[0], malformed);
});
