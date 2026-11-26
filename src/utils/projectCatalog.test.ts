import assert from 'node:assert/strict';
import { test } from 'node:test';
import { menuOnlyProjectRows, projectMenuAvailabilityMessage, projectMenuDisplayStatus, projectMenuLocations, projectCatalogRequestPath, readProjectCatalogPage } from './projectCatalog';
const query = { search: '', status: 'all' as const, page: 1, pageSize: 10 };
const parent = { id: '9007199254740993', shopId: '5', name: 'Old project', nameEn: null, description: null, category: null, isActive: false, durationKind: null, durationMin: 15, priceCents: 0, priceBasis: null, participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, hasVariants: true, variantCount: 1, addOnCount: 0, preview: null, selectionRevision: 'a'.repeat(64), variants: [{ id: '9', serviceId: '9007199254740993', name: 'Inactive old 60', durationMin: 60, priceCents: 8000, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: false, sortOrder: 0, preview: null }], addOns: [] };
const response = () => ({ shopId: '5', ...query, total: 1, hasMore: false, canManageCatalog: false, canConfigurePolicy: true, items: [structuredClone(parent)] });
test('legacy unused base values and inactive complete children remain readable for RES-only users without becoming valid bookable prices', () => {
  const raw = response(), before = structuredClone(raw), page = readProjectCatalogPage(raw, '5', query);
  assert.equal(page.items[0].priceCents, 0); assert.equal(page.items[0].durationMin, 15); assert.equal(page.items[0].category, null); assert.equal(page.items[0].preview, null);
  assert.equal(page.items[0].variants[0].isActive, false); assert.equal(page.canManageCatalog, false); assert.equal(page.canConfigurePolicy, true); assert.deepEqual(raw, before);
});
test('reader rejects wrong shop, wrong explicit project, inconsistent pages and truncated child arrays', () => {
  for (const mutate of [(raw: ReturnType<typeof response>) => { raw.shopId = '6'; }, (raw: ReturnType<typeof response>) => { raw.items[0].variants[0].serviceId = '99'; }, (raw: ReturnType<typeof response>) => { raw.items[0].variantCount = 2; }, (raw: ReturnType<typeof response>) => { raw.total = 11; }]) {
    const raw = response(); mutate(raw); assert.throws(() => readProjectCatalogPage(raw, '5', query));
  }
  assert.throws(() => readProjectCatalogPage({ ...response(), serviceId: '10' }, '5', { ...query, serviceId: '10' }));
  assert.throws(() => readProjectCatalogPage({ ...response(), items: [parent, parent], total: 2 }, '5', query));
});
test('scope path preserves exact IDs and search encoding, with bounded page reads and no fallback', () => {
  const path = projectCatalogRequestPath('9007199254740995', { ...query, search: 'Body & foot', serviceId: parent.id });
  const url = new URL(path, 'http://local.invalid'); assert.equal(url.searchParams.get('search'), 'Body & foot'); assert.equal(url.searchParams.get('serviceId'), parent.id);
  for (const id of ['0', '../5', '9223372036854775808', 9007199254740992]) assert.throws(() => projectCatalogRequestPath(id, query));
  assert.throws(() => projectCatalogRequestPath('5', { ...query, pageSize: 51 }));
});
test('display-only rows are retained separately and explicit ancestry finds existing projects across groups', () => {
  const menu = [{ category: 'Visible', items: [{ id: 'draft', name: 'Raw original', priceText: 'Ask' }, { id: 'bound', name: 'Saved', priceText: '', booking: { serviceId: parent.id, variantId: '9' } }] }, { category: 'More', items: [{ id: 'child', name: 'New90', priceText: '', newVariantOf: 'item:bound' }] }];
  assert.deepEqual(menuOnlyProjectRows(menu).map(row => row.item.name), ['Raw original']); assert.deepEqual(projectMenuLocations(menu, parent.id).map(row => [row.groupIndex, row.itemIndex]), [[0, 1], [1, 0]]);
});

test('an unavailable customer menu never proves a project is unlisted or offers a stale location', () => {
  const menu = [{ category: 'Visible', items: [{ name: 'Saved linked service', priceText: '', booking: { serviceId: parent.id } }] }];
  const before = structuredClone(menu);
  for (const reason of ['permission', 'loading', 'error', 'unread'] as const) {
    const unavailable = { status: 'unavailable', reason } as const;
    for (const value of [[], menu]) {
      const display = projectMenuDisplayStatus(value, parent.id, unavailable);
      assert.match(display.label, /顾客价目展示状态待核对/);
      assert.doesNotMatch(display.label, /尚未放入顾客价目|已在价目中展示/);
      assert.deepEqual(display.locations, []);
    }
  }
  assert.equal(projectMenuAvailabilityMessage({ status: 'unavailable', reason: 'permission' }), '顾客价目展示状态待核对（当前账号无目录权限）');
  assert.match(projectMenuAvailabilityMessage({ status: 'unavailable', reason: 'loading' })!, /正在读取/);
  assert.match(projectMenuAvailabilityMessage({ status: 'unavailable', reason: 'error' })!, /读取失败/);
  assert.match(projectMenuAvailabilityMessage({ status: 'unavailable', reason: 'unread' })!, /载入完整价目/);
  assert.deepEqual(menu, before);
});

test('only a confirmed full menu distinguishes displayed projects from an explicitly empty menu', () => {
  const menu = [{ category: 'Body', items: [{ id: 'bound', name: 'Saved linked service', priceText: '', booking: { serviceId: parent.id } }] },
    { category: 'Longer', items: [{ name: 'Pending sibling', priceText: '', newVariantOf: 'item:bound' }] }];
  const known = { status: 'known' } as const;
  const displayed = projectMenuDisplayStatus(menu, parent.id, known);
  assert.equal(displayed.label, '顾客显示 2/2 处');
  assert.deepEqual(displayed.locations.map(row => [row.groupIndex, row.itemIndex]), [[0, 0], [1, 0]]);
  const hidden = structuredClone(menu);
  Object.assign(hidden[1].items[0], { isVisible: false });
  const partlyVisible = projectMenuDisplayStatus(hidden, parent.id, known);
  assert.equal(partlyVisible.label, '顾客显示 1/2 处', 'hidden linked locations remain in the total instead of being reported as absent');
  assert.deepEqual(partlyVisible.locations.map(row => [row.groupIndex, row.itemIndex]), [[0, 0], [1, 0]]);
  Object.assign(hidden[0].items[0], { isVisible: false });
  assert.equal(projectMenuDisplayStatus(hidden, parent.id, known).label, '顾客显示 0/2 处', 'a wholly hidden service is still linked in the confirmed menu');
  assert.equal(projectMenuDisplayStatus(menu, parent.id, known).label, '顾客显示 2/2 处', 'visibility inspection must not mutate the original full menu');
  assert.deepEqual(projectMenuDisplayStatus([], parent.id, known), { label: '尚未放入顾客价目', locations: [] });
  assert.deepEqual(projectMenuDisplayStatus(menu, '99', known), { label: '尚未放入顾客价目', locations: [] });
  assert.equal(projectMenuAvailabilityMessage(known), null);
});
