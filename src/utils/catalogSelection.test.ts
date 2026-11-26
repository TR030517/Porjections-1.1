import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCatalogOption, applyCatalogPricingPatch, applyCatalogVariantParent, catalogFamilyKeyForItem, conditionForMenu, copyCatalogSelection, createMenuCatalogReader, inheritCatalogSelections, isExplicitCatalogDescendant, mapCatalogFamily, readMenuCatalogPage, sourceServiceIdForItem, upsertCatalogSelection,
  type CatalogSelectionPrecondition, type MenuCatalogKind, type MenuCatalogOption, type MenuCatalogPage, type MenuCatalogQuery, type MenuCatalogReadState } from './catalogSelection';
import type { PriceMenuGroup, PriceMenuItem } from './priceMenu';
import { formatPriceMenuTitle, type PriceMenuPricing } from './priceMenuPricing';
import { removePriceMenuDraftItem } from './priceMenuDraftReferences';

const revisionA = 'a'.repeat(64), revisionB = 'b'.repeat(64);
function option(kind: MenuCatalogKind = 'variant', patch: Partial<MenuCatalogOption> = {}): MenuCatalogOption {
  const serviceId = patch.serviceId ?? '20', active = patch.isActive ?? true, parentActive = patch.parentIsActive ?? true;
  const hasVariants = patch.hasVariants ?? kind === 'variant';
  const pricing: PriceMenuPricing = { kind: kind === 'addOn' ? 'ADD_ON' : 'TIMED', baseName: kind === 'addOn' ? 'Oil' : 'Body Massage', durationMin: kind === 'addOn' ? null : 60, priceCents: kind === 'addOn' ? 1000 : 8000, titleMode: 'AUTO' };
  const binding = { serviceId, ...(kind === 'variant' ? { variantId: patch.variantId ?? '30' } : {}), ...(kind === 'addOn' ? { addOnId: patch.addOnId ?? '40' } : {}) };
  const preview: PriceMenuItem = { name: formatPriceMenuTitle(pricing), priceText: '', pricing, booking: binding, bookingEnabled: active,
    bookingAvailable: active && parentActive, ...(kind !== 'addOn' ? { bookingMode: 'COUPLE', reservedDurationMin: 60 } : {}) };
  return { ...binding, serviceName: 'Body Massage', name: kind === 'service' ? 'Body Massage' : kind === 'variant' ? '60 min' : 'Oil', hasVariants,
    variantCount: hasVariants ? 2 : 0, addOnCount: kind === 'addOn' ? 1 : 0, isActive: active, parentIsActive: kind === 'service' ? active : parentActive,
    preview: kind === 'service' && hasVariants ? null : preview, selectionRevision: revisionA, ...patch };
}
const query = (kind: MenuCatalogKind = 'variant', patch: Partial<MenuCatalogQuery> = {}): MenuCatalogQuery => ({ kind, ...(kind === 'service' ? {} : { serviceId: '20' }), q: '', page: 1, pageSize: 10, ...patch });
function page(request: MenuCatalogQuery, items: MenuCatalogOption[], total = items.length): MenuCatalogPage {
  return { shopId: '7', ...request, q: request.q.trim(), total, hasMore: (request.page - 1) * request.pageSize + items.length < total, canConfigurePolicy: false, items };
}
const menu = (...items: PriceMenuItem[]): PriceMenuGroup[] => [{ category: 'Massage', items }];
const condition = (itemId: string, expectedSelectionRevision = revisionA, serviceId = '20'): CatalogSelectionPrecondition => ({ itemId, serviceId, expectedSelectionRevision });

test('catalog reads preserve inactive and parent-paused flags and existing couple policy without granting policy editing', () => {
  const row = option('variant', { parentIsActive: false });
  const loaded = readMenuCatalogPage(page(query(), [row]), '7', query());
  assert.equal(loaded.canConfigurePolicy, false); assert.equal(loaded.items[0].preview?.bookingEnabled, true);
  assert.equal(loaded.items[0].preview?.bookingAvailable, false); assert.equal(loaded.items[0].preview?.bookingMode, 'COUPLE');
  const inactive = option('addOn', { isActive: false, parentIsActive: false });
  assert.equal(readMenuCatalogPage(page(query('addOn'), [inactive]), '7', query('addOn')).items[0].isActive, false);
});

test('a service with variants is an explicit parent choice and cannot silently become a base service binding', () => {
  const request = query('service'), parent = option('service', { hasVariants: true });
  const loaded = readMenuCatalogPage(page(request, [parent]), '7', request);
  assert.equal(loaded.items[0].preview, null);
  assert.throws(() => applyCatalogOption({ name: 'Draft', priceText: '' }, loaded.items[0], 'draft'), /明确选择/);
});

test('page, search, store and exact parent scopes must match rather than falling back to another result', () => {
  const request = query('service', { q: '  Body  ', page: 2, pageSize: 2 });
  const loaded = page(request, [option('service')], 3);
  assert.equal(readMenuCatalogPage(loaded, '7', request).page, 2);
  assert.equal(readMenuCatalogPage(loaded, '7', request).q, 'Body');
  for (const wrong of [{ ...loaded, shopId: '8' }, { ...loaded, page: 1 }, { ...loaded, serviceId: '21' }, { ...loaded, q: 'Other' }, { ...loaded, hasMore: true }]) {
    assert.throws(() => readMenuCatalogPage(wrong, '7', request), /范围不符/);
  }
  assert.throws(() => readMenuCatalogPage(page(query('service', { pageSize: 51 }), []), '7', query('service', { pageSize: 51 })), /范围不符/);
  const otherParent = option('variant', { serviceId: '21' });
  assert.throws(() => readMenuCatalogPage(page(query(), [otherParent]), '7', query()), /范围不符/);
});

test('invalid source versions, duplicate references or inconsistent canonical previews are not selectable', () => {
  const row = option();
  for (const changed of [{ ...row, selectionRevision: 'old' }, { ...row, isActive: false }, { ...row, preview: { ...row.preview!, booking: { serviceId: '21', variantId: '30' } } },
    { ...row, preview: { ...row.preview!, bookingAvailable: 'false' } }]) {
    assert.throws(() => readMenuCatalogPage(page(query(), [changed as unknown as MenuCatalogOption]), '7', query()));
  }
  assert.throws(() => readMenuCatalogPage(page(query(), [row, row]), '7', query()));
});

test('selecting a catalog option loads its canonical amount and minutes while retaining editorial text and a hand-picked image', () => {
  const source: PriceMenuItem = { id: 'draft', name: 'My custom heading', priceText: '', description: 'Keep my note', imageUrl: 'https://example.invalid/hand.webp',
    newVariantOf: '21', pricing: { kind: 'TIMED', baseName: 'Old name', durationMin: 30, priceCents: 4000, titleMode: 'CUSTOM' } };
  const selected = applyCatalogOption(source, option('variant', { parentIsActive: false }), source.id!);
  assert.equal(selected.id, 'draft'); assert.equal(selected.name, 'My custom heading');
  assert.equal(selected.pricing?.baseName, 'Body Massage'); assert.equal(selected.pricing?.durationMin, 60); assert.equal(selected.pricing?.priceCents, 8000);
  assert.equal(selected.description, source.description); assert.equal(selected.imageUrl, source.imageUrl);
  assert.equal(selected.bookingEnabled, true); assert.equal(selected.bookingAvailable, false); assert.equal(selected.newVariantOf, undefined);
  assert.deepEqual(selected.booking, { serviceId: '20', variantId: '30' });
});
test('reselecting an available option clears an old parent-paused reason', () => {
  const previous = { ...option('variant', { parentIsActive: false }).preview!, id: 'draft', bookingUnavailableReason: 'PARENT_PAUSED' as const };
  const selected = applyCatalogOption(previous, option(), 'draft');
  assert.equal(selected.bookingAvailable, true); assert.equal(selected.bookingUnavailableReason, undefined);
});

test('copying an unsaved selection carries its real parent snapshot, while saved bindings never fabricate one', () => {
  const source: PriceMenuItem = { ...option().preview!, id: 'source' }, second = { ...source, id: 'second', booking: undefined, newVariantOf: '20' };
  let snapshots = copyCatalogSelection([condition('source')], source, second, menu(source, second));
  const third = { ...second, id: 'third' }; snapshots = copyCatalogSelection(snapshots, second, third, menu(source, second, third));
  assert.deepEqual(snapshots.map(row => row.itemId), ['source', 'second', 'third']);
  assert.deepEqual(copyCatalogSelection([], source, second), []);
  const retained = conditionForMenu(menu(second, third), snapshots);
  assert.deepEqual(retained.map(row => row.itemId), ['second', 'third']);
  assert.deepEqual(conditionForMenu(menu({ ...second, newVariantOf: undefined }, { ...third, newVariantOf: '21' }), retained), []);
});

test('source conditions remain per row and reselecting one cannot refresh another row silently', () => {
  const first = { ...option().preview!, id: 'first' }, second = { ...first, id: 'second' };
  const snapshots = conditionForMenu(menu(first, second), [condition('first'), condition('second', revisionB)]);
  assert.deepEqual(snapshots.map(row => row.expectedSelectionRevision), [revisionA, revisionB]);
  const reselected = upsertCatalogSelection(snapshots, condition('first', revisionB));
  assert.equal(reselected.length, 2); assert.equal(snapshots[0].expectedSelectionRevision, revisionA);
  const local = { name: 'Local clone', priceText: '', id: 'local', newVariantOf: 'item:first' };
  assert.equal(sourceServiceIdForItem(local, menu(first, local)), '20');
  assert.equal(sourceServiceIdForItem({ ...local, newVariantOf: 'item:local' }, menu(local)), undefined);
});

function draft(id: string | undefined, minutes: number, cents: number, newVariantOf?: string): PriceMenuItem {
  const pricing: PriceMenuPricing = { kind: 'TIMED', baseName: 'Body Massage', durationMin: minutes, priceCents: cents, titleMode: 'AUTO' };
  return { ...(id ? { id } : {}), name: formatPriceMenuTitle(pricing), priceText: '', pricing, bookingMode: 'SINGLE', ...(newVariantOf ? { newVariantOf } : {}) };
}
test('shared name, type and mode edits reach explicit numeric and draft chains without merging names or changing independent prices/minutes', () => {
  const first = { ...draft('first', 30, 5000), booking: { serviceId: '20' } }, second = draft('second', 60, 8000, 'item:first');
  const third = draft('third', 90, 11000, 'item:second'), numeric = draft('numeric', 120, 14000, '20');
  const unrelated = draft('other', 60, 6000), anonymous = draft(undefined, 45, 4500);
  const original = menu(first, second, third, numeric, unrelated, anonymous), conditions = [condition('first'), condition('second', revisionB)];
  assert.equal(catalogFamilyKeyForItem(third, original), 'service:20'); assert.equal(catalogFamilyKeyForItem(numeric, original), 'service:20');
  let updated = mapCatalogFamily(original, first, row => applyCatalogPricingPatch(row, { baseName: 'Deep Tissue' }));
  updated = mapCatalogFamily(updated, updated[0].items[0], row => ({ ...row, bookingMode: 'COUPLE' }));
  assert.deepEqual(updated[0].items.slice(0, 4).map(row => row.pricing?.baseName), Array(4).fill('Deep Tissue'));
  assert.deepEqual(updated[0].items.slice(0, 4).map(row => row.pricing?.durationMin), [30, 60, 90, 120]);
  assert.deepEqual(updated[0].items.slice(0, 4).map(row => row.pricing?.priceCents), [5000, 8000, 11000, 14000]);
  assert.equal(updated[0].items[4], unrelated); assert.equal(updated[0].items[5], anonymous);
  updated = mapCatalogFamily(updated, updated[0].items[0], row => applyCatalogPricingPatch(row, { kind: 'VARIABLE', durationMin: null }));
  assert.deepEqual(updated[0].items.slice(0, 4).map(row => row.reservedDurationMin), [30, 60, 90, 120]);
  assert.deepEqual(updated[0].items.slice(0, 4).map(row => row.pricing?.priceCents), [5000, 8000, 11000, 14000]);
  assert.deepEqual(conditionForMenu(updated, conditions), conditions);
  const anotherAnonymous = draft(undefined, 45, 4500), anonymousMenu = menu(anonymous, anotherAnonymous);
  const onlyOne = mapCatalogFamily(anonymousMenu, anonymous, row => ({ ...row, bookingMode: 'FOUR_HANDS' }));
  assert.equal(onlyOne[0].items[1], anotherAnonymous, 'two missing identities must never become a family');
});

test('binding a previously local ancestor seeds real descendant snapshots and deleting that ancestor retains them', () => {
  const first = draft('first', 30, 5000), second = draft('second', 60, 8000, 'item:first'), third = draft('third', 90, 11000, 'item:second');
  const original = menu(first, second, third);
  assert.equal(isExplicitCatalogDescendant(third, 'first', original), true);
  const linked = menu(applyCatalogOption(first, option('service'), 'first'), second, third);
  const inherited = inheritCatalogSelections(linked, [condition('first')]);
  assert.deepEqual(inherited.map(row => row.itemId), ['first', 'second', 'third']);
  const removed = removePriceMenuDraftItem(linked, 0, 0);
  assert.deepEqual(removed[0].items.map(row => row.newVariantOf), ['20', 'item:second']);
  assert.deepEqual(conditionForMenu(removed, inherited), [condition('second'), condition('third')]);
  const separateSnapshots = inheritCatalogSelections(linked, [condition('first'), condition('second', revisionB)]);
  assert.equal(separateSnapshots.find(row => row.itemId === 'second')?.expectedSelectionRevision, revisionB);
  assert.equal(separateSnapshots.find(row => row.itemId === 'third')?.expectedSelectionRevision, revisionB, 'an existing nearer ancestor snapshot remains authoritative');
});

test('confirming a new variant parent keeps its own authored amount and duration', () => {
  const pending = { ...draft('new', 90, 11000, '20'), description: 'Keep note', imageUrl: 'https://example.invalid/manual.webp', bookingEnabled: false };
  const confirmed = applyCatalogVariantParent(pending, option(), 'new');
  assert.equal(confirmed.newVariantOf, '20'); assert.equal(confirmed.booking, undefined);
  assert.equal(confirmed.pricing?.durationMin, 90); assert.equal(confirmed.pricing?.priceCents, 11000);
  assert.equal(confirmed.bookingMode, 'COUPLE'); assert.equal(confirmed.bookingEnabled, false);
  assert.equal(confirmed.description, pending.description); assert.equal(confirmed.imageUrl, pending.imageUrl);
});

test('a late response cannot replace a new search or a different shop scope, even if the loader ignores abort', async () => {
  const reader = createMenuCatalogReader(), signals: AbortSignal[] = [], resolvers: Array<(value: unknown) => void> = [], states: MenuCatalogReadState[] = [];
  const loader = (_request: MenuCatalogQuery, signal: AbortSignal) => { signals.push(signal); return new Promise<unknown>(resolve => resolvers.push(resolve)); };
  const first = reader.read(loader, '7', query('service'), state => states.push(state));
  const secondRequest = query('service', { q: 'Body' });
  const second = reader.read(loader, '8', secondRequest, state => states.push(state));
  assert.equal(signals[0].aborted, true);
  resolvers[0](page(query('service'), [option('service')])); await first;
  assert.equal(states.some(state => state.status === 'ready'), false);
  resolvers[1]({ ...page(secondRequest, [option('service', { serviceId: '21' })]), shopId: '8' }); await second;
  const ready = states.filter(state => state.status === 'ready');
  assert.equal(ready.length, 1); assert.equal(ready[0].status === 'ready' && ready[0].page.shopId, '8');
});

test('wrong-shop responses produce a visible error and cancellation never publishes stale results', async () => {
  const reader = createMenuCatalogReader(), states: MenuCatalogReadState[] = [];
  await reader.read(async () => ({ ...page(query('service'), [option('service')]), shopId: '8' }), '7', query('service'), state => states.push(state));
  assert.equal(states.at(-1)?.status, 'error'); assert.equal(states.some(state => state.status === 'ready'), false);
  let complete!: (value: unknown) => void;
  const pending = reader.read(() => new Promise(resolve => { complete = resolve; }), '7', query('service'), state => states.push(state));
  const beforeCancel = states.length; reader.cancel(); complete(page(query('service'), [option('service')])); await pending;
  assert.equal(states.length, beforeCancel);
});
