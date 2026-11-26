import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Vite dedupes shared components to merchant-web's React dispatcher; SSR must
// use this same installation instead of the root admin application's copy.

let server, workspace, navigation, setupEntry, catalog, api, client, StoreProjectInventory;
const shared = relative => '/@fs/' + fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/');
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('./', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  workspace = await server.ssrLoadModule('/src/utils/projectWorkspace.ts');
  navigation = await server.ssrLoadModule('/src/utils/entryNavigation.ts');
  setupEntry = await server.ssrLoadModule('/src/utils/bookingSetupEntry.ts');
  catalog = await server.ssrLoadModule(shared('../src/utils/projectCatalog.ts'));
  api = await server.ssrLoadModule('/src/api/projectCatalog.ts');
  client = (await server.ssrLoadModule('/src/api/client.ts')).default;
  ({ default: StoreProjectInventory } = await server.ssrLoadModule(shared('../src/components/store/StoreProjectInventory.tsx')));
});
after(async () => { await server?.close(); });

const shopId = '9007199254740993', serviceId = '9007199254740997';
const query = (patch = {}) => ({ search: '', status: 'all', page: 1, pageSize: 1, serviceId, ...patch });
const row = (patch = {}) => ({ id: serviceId, shopId, name: 'Legacy parent', nameEn: null, description: 'Saved original description', category: 'MASSAGE', isActive: false,
  durationKind: 'TIMED', durationMin: 15, priceCents: 0, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1, requiredRoomType: null,
  staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0, hasVariants: true, variantCount: 2, addOnCount: 1, selectionRevision: 'a'.repeat(64), preview: null,
  variants: [{ id: '11', serviceId, name: 'Active saved option', durationMin: 60, priceCents: 8000, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: true, sortOrder: 0, preview: null },
    { id: '12', serviceId, name: 'Inactive saved option', durationMin: 90, priceCents: 11000, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: false, sortOrder: 1, preview: null }],
  addOns: [{ id: '13', serviceId, name: 'Saved inactive add-on', description: 'Original add-on description', priceCents: 1000, currency: 'usd', isActive: false, sortOrder: 2, preview: null }], ...patch });
const page = (request = query(), patch = {}) => ({ shopId, ...request, search: request.search.trim(), total: 1, hasMore: false, canManageCatalog: true, canConfigurePolicy: false, items: [row()], ...patch });

test('unified project links retain exact shop and service identity while separating metadata from booking policy', () => {
  for (const pane of ['metadata', 'booking']) {
    const destination = new URL(workspace.projectWorkspaceHref(shopId, serviceId, pane), 'http://local.invalid');
    assert.equal(destination.pathname, '/price-menu');
    assert.deepEqual(Object.fromEntries(destination.searchParams), { shopId, pane, serviceId });
    assert.deepEqual(workspace.requestedProjectFocus('?view=inventory&' + destination.searchParams), { serviceId, variantId: null, itemId: null, invalid: false }, 'saved legacy links retain their exact service without restoring a second editor');
  }
  const unselected = new URL(workspace.projectWorkspaceHref(shopId), 'http://local.invalid');
  assert.equal(unselected.searchParams.has('serviceId'), false, 'an absent exact target cannot fabricate or select a different project');
  for (const bad of ['0', '-1', '', '9223372036854775808', 'https://foreign.invalid/8']) {
    assert.throws(() => workspace.projectWorkspaceHref(bad, serviceId));
    assert.throws(() => workspace.projectWorkspaceHref(shopId, bad));
  }
});

test('old service-rule entries open the same project pane while therapist scheduling keeps its own exact entry', () => {
  const project = new URL(navigation.reservationEntryHref(shopId, 'services', serviceId), 'http://local.invalid');
  assert.equal(project.pathname, '/price-menu'); assert.equal(project.searchParams.get('serviceId'), serviceId); assert.equal(project.searchParams.get('pane'), 'booking');
  const therapist = new URL(navigation.reservationEntryHref(shopId, 'therapists', '9007199254740999'), 'http://local.invalid');
  assert.equal(therapist.pathname, '/reservations'); assert.equal(therapist.searchParams.get('tab'), 'therapists');
  assert.equal(therapist.searchParams.get('shopId'), shopId); assert.equal(therapist.searchParams.get('therapistId'), '9007199254740999');
  assert.equal(navigation.selectEntryResource([{ id: '8' }], serviceId), undefined, 'a missing legacy target never silently selects the first project');
});

test('readiness repairs retain their destination permission instead of granting catalog editing to policy-only staff', () => {
  const issue = { key: 'saved-project', serviceId, serviceName: 'Selected project', message: '', action: '' };
  const metadata = setupEntry.bookingSetupEntry(shopId, { ...issue, kind: 'activation' });
  const policy = setupEntry.bookingSetupEntry(shopId, { ...issue, kind: 'service' });
  assert.equal(metadata.permission, 'CATALOG_MANAGE'); assert.equal(policy.permission, 'RESERVATION_CONFIG');
  assert.equal(new URL(metadata.href, 'http://local.invalid').searchParams.get('pane'), 'metadata');
  assert.equal(new URL(policy.href, 'http://local.invalid').searchParams.get('pane'), 'booking');
  for (const kind of ['activation', 'service']) {
    const missing = setupEntry.bookingSetupEntry(shopId, { ...issue, kind, serviceId: '9223372036854775808' });
    assert.equal(missing.href, undefined); assert.ok(missing.message);
  }
});

test('price-menu drafts, writes, conflicts and another editor each independently prevent a child write without discarding input', () => {
  const menu = { dirty: false, busy: false, conflict: false }, other = { dirty: false, busy: false, unknown: false };
  assert.equal(workspace.projectWriteAllowed(menu, other), true);
  for (const key of ['dirty', 'busy', 'conflict']) assert.equal(workspace.projectWriteAllowed({ ...menu, [key]: true }, other), false, key);
  for (const key of ['dirty', 'busy', 'unknown']) assert.equal(workspace.projectWriteAllowed(menu, { ...other, [key]: true }), false, key);
  assert.deepEqual(menu, { dirty: false, busy: false, conflict: false });
  assert.deepEqual(other, { dirty: false, busy: false, unknown: false });
});

test('the exact inventory reader preserves inactive children and unusable legacy base values without making a replacement preview', () => {
  const raw = page(), original = structuredClone(raw), parsed = catalog.readProjectCatalogPage(raw, shopId, query());
  assert.equal(parsed.items[0].durationMin, 15); assert.equal(parsed.items[0].priceCents, 0); assert.equal(parsed.items[0].preview, null);
  assert.equal(parsed.items[0].hasVariants, true);
  assert.deepEqual(parsed.items[0].variants.map(item => [item.id, item.isActive, item.durationMin, item.priceCents]), [['11', true, 60, 8000], ['12', false, 90, 11000]]);
  assert.equal(parsed.items[0].addOns[0].description, 'Original add-on description'); assert.equal(parsed.items[0].addOns[0].isActive, false);
  assert.equal(parsed.canManageCatalog, true); assert.equal(parsed.canConfigurePolicy, false);
  assert.deepEqual(raw, original, 'reading all project metadata cannot normalize or activate any saved item');
  const reservationOnly = catalog.readProjectCatalogPage(page(query(), { canManageCatalog: false, canConfigurePolicy: true }), shopId, query());
  assert.equal(reservationOnly.canManageCatalog, false); assert.equal(reservationOnly.canConfigurePolicy, true);
});

test('foreign, mismatched focus, incomplete children and inconsistent pagination are rejected instead of falling back', () => {
  const request = query();
  for (const raw of [
    page(request, { shopId: '2' }), page(request, { serviceId: '8' }), page(request, { items: [row({ shopId: '2' })] }),
    page(request, { items: [row({ id: '8' })] }), page(request, { items: [row({ variantCount: 1 })] }),
    page(request, { items: [row({ variants: [row().variants[0], { ...row().variants[1], serviceId: '8' }] })] }),
    page(request, { hasMore: true }), page(request, { total: 2 }),
  ]) assert.throws(() => catalog.readProjectCatalogPage(raw, shopId, request), /范围不符|格式/);
  const missing = catalog.readProjectCatalogPage(page(request, { total: 0, items: [] }), shopId, request);
  assert.deepEqual(missing.items, []); assert.equal(missing.total, 0);
});

test('merchant inventory transport forwards the exact validated query and cancellation without writes or cache reuse', async () => {
  const originalAdapter = client.defaults.adapter, requests = [], controller = new AbortController();
  const request = query({ search: '  Saved option  ', status: 'inactive' }), raw = page({ ...request, search: request.search.trim() });
  client.defaults.adapter = async config => { requests.push(config); return { config, data: raw, status: 200, statusText: 'OK', headers: {} }; };
  try {
    const value = await api.getProjectCatalog(shopId, request, controller.signal);
    assert.deepEqual(value, raw); assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'get'); assert.equal(requests[0].signal, controller.signal); assert.equal(requests[0].data, undefined);
    assert.equal(requests[0].headers.get('Cache-Control'), 'no-cache');
    const url = new URL(requests[0].url, 'http://local.invalid');
    assert.equal(url.pathname, `/reservation-admin/shops/${shopId}/project-catalog`);
    assert.deepEqual(Object.fromEntries(url.searchParams), { search: 'Saved option', status: 'inactive', page: '1', pageSize: '1', serviceId });
    for (const bad of [query({ serviceId: '0' }), query({ pageSize: 51 }), query({ status: 'unknown' }), query({ search: '\u0000' })]) await assert.rejects(api.getProjectCatalog(shopId, bad));
    assert.equal(requests.length, 1, 'invalid input cannot cause another request, fallback read or write');
  } finally { client.defaults.adapter = originalAdapter; }
});

test('the unified inventory maps menu-only projects without creating catalog records while loading', () => {
  const menu = [{ category: 'Visible menu', items: [{ id: 'draft-only', name: 'Original display-only treatment', priceText: '$80' }] }];
  const original = structuredClone(menu), calls = [];
  const pending = catalog.menuOnlyProjectRows(menu);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].item.name, 'Original display-only treatment');
  assert.equal(catalog.projectMenuDisplayStatus(menu, serviceId, { status: 'known' }).label, '尚未放入顾客价目');
  const html = renderToStaticMarkup(createElement(StoreProjectInventory, { shopId, scopeKey: `actor:${shopId}`, menu, menuAvailability: { status: 'known' }, revision: 'saved',
    load: async () => { calls.push('read'); return page(); }, onSelect: id => calls.push(['select', id]), onLocateMenu: (...location) => calls.push(['locate', ...location]) }));
  assert.match(html, /正在读取本店项目目录/); assert.doesNotMatch(html, /Original display-only treatment|<form|type="submit"/);
  assert.deepEqual(calls, [], 'rendering pending projects cannot create, enable, select or write any project');
  assert.deepEqual(menu, original);
});

test('RES-only inventory does not treat an unread menu as empty or expose cached menu-only rows', () => {
  const menu = [{ category: 'Cached menu', items: [{ name: 'Previously visible private draft', priceText: '$80' }] }];
  const before = structuredClone(menu), calls = [];
  const html = renderToStaticMarkup(createElement(StoreProjectInventory, { shopId, scopeKey: `res-only:${shopId}`, menu,
    menuAvailability: { status: 'unavailable', reason: 'permission' }, revision: 'saved',
    load: async () => { calls.push('read'); return page(query(), { canManageCatalog: false, canConfigurePolicy: true }); },
    onSelect: id => calls.push(['select', id]), onLocateMenu: (...location) => calls.push(['locate', ...location]) }));
  assert.match(html, /顾客价目展示状态待核对（当前账号无目录权限）/);
  assert.doesNotMatch(html, /尚未放入顾客价目|已在价目中展示|价目待设置|Previously visible private draft|定位价目/);
  assert.deepEqual(calls, [], 'lack of menu permission must not trigger a profile read, location or write');
  assert.deepEqual(menu, before);
});

test('loading and failed menu reads remain distinguishable from a complete empty customer menu', () => {
  const calls = [];
  const render = menuAvailability => renderToStaticMarkup(createElement(StoreProjectInventory, { shopId, scopeKey: `catalog:${shopId}`, menu: [], menuAvailability, revision: 'saved',
    load: async () => { calls.push('read'); return page(); }, onSelect: id => calls.push(id), onLocateMenu: (...location) => calls.push(location) }));
  assert.match(render({ status: 'unavailable', reason: 'loading' }), /价目正在读取/);
  assert.match(render({ status: 'unavailable', reason: 'error' }), /价目读取失败/);
  assert.match(render({ status: 'unavailable', reason: 'unread' }), /请先载入完整价目/);
  assert.doesNotMatch(render({ status: 'known' }), /顾客价目展示状态待核对/);
  assert.deepEqual(catalog.projectMenuDisplayStatus([], serviceId, { status: 'known' }), { label: '尚未放入顾客价目', locations: [] });
  assert.deepEqual(calls, []);
});
