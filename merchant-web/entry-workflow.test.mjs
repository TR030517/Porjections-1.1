import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const viteServer = () => createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const response = (config, data) => ({ config, data, headers: {}, status: 200, statusText: 'OK' });

test('hours reuse copies only explicit targets, preserves split periods and does not share mutable rows', async () => {
  const vite = await viteServer();
  try {
    const { hoursDraft, copyHoursDays, hoursPayload } = await vite.ssrLoadModule('/src/utils/reservationHours.ts');
    const source = hoursDraft({ monday: [{ open: '09:00', close: '12:00' }, { open: '13:00', close: '20:00' }], thursday: { open: '10:00', close: '16:00' } });
    const before = structuredClone(source), next = copyHoursDays(source, 'monday', ['tuesday', 'wednesday']);
    assert.deepEqual(source, before, 'copying creates an unsaved draft and never mutates the current form');
    assert.deepEqual(next.tuesday, source.monday);
    assert.deepEqual(next.wednesday, source.monday);
    assert.deepEqual(next.thursday, before.thursday);
    assert.deepEqual(next.friday, [], 'unselected days are not inferred from the source');
    next.tuesday[0].open = '09:30';
    assert.equal(next.monday[0].open, '09:00');
    assert.equal(next.wednesday[0].open, '09:00');
    assert.equal(source.monday[0].open, '09:00');
    assert.deepEqual(hoursPayload(next).tuesday, [{ open: '09:30', close: '12:00' }, { open: '13:00', close: '20:00' }]);
  } finally { await vite.close(); }
});

test('copying a closed source only closes selected days; empty, duplicate or implicit targets are rejected', async () => {
  const vite = await viteServer();
  try {
    const { hoursDraft, copyHoursDays, hoursPayload } = await vite.ssrLoadModule('/src/utils/reservationHours.ts');
    const input = hoursDraft({ monday: { closed: true }, tuesday: { open: '09:00', close: '18:00' }, friday: { open: '10:00', close: '16:00' } });
    const copied = copyHoursDays(input, 'monday', ['tuesday']);
    assert.deepEqual(hoursPayload(copied).tuesday, { closed: true });
    assert.deepEqual(copied.friday, input.friday);
    for (const targets of [[], ['monday'], ['tuesday', 'tuesday'], ['everyday'], ['__proto__']]) {
      assert.throws(() => copyHoursDays(input, 'monday', targets), /目标日期/);
    }
    assert.throws(() => copyHoursDays(input, 'not-a-day', ['tuesday']), /有效星期/);
  } finally { await vite.close(); }
});

test('hours drafts reject unsupported midnight, incomplete or overlapping periods before copying or saving', async () => {
  const vite = await viteServer();
  try {
    const { hoursDraft, copyHoursDays, hoursPayload } = await vite.ssrLoadModule('/src/utils/reservationHours.ts');
    for (const periods of [
      [{ open: '', close: '18:00' }], [{ open: '09:00', close: '24:00' }],
      [{ open: '18:00', close: '09:00' }], [{ open: '09:00', close: '09:00' }],
      [{ open: '09:00', close: '13:00' }, { open: '12:00', close: '17:00' }],
      Array.from({ length: 5 }, () => ({ open: '09:00', close: '10:00' })),
    ]) {
      assert.throws(() => hoursDraft({ monday: periods }), /营业时间/);
      const draft = { ...hoursDraft({}), monday: periods };
      assert.throws(() => hoursPayload(draft));
      assert.throws(() => copyHoursDays(draft, 'monday', ['tuesday']));
    }
    const adjacent = hoursPayload(hoursDraft({ monday: [{ open: '12:00', close: '23:59' }, { open: '00:00', close: '12:00' }] }));
    assert.deepEqual(adjacent.monday, [{ open: '00:00', close: '12:00' }, { open: '12:00', close: '23:59' }]);
  } finally { await vite.close(); }
});

test('reservation links preserve exact shop/resource IDs; missing explicit resources never select another row', async () => {
  const vite = await viteServer();
  try {
    const { requestedEntryId, selectEntryResource, reservationEntryHref } = await vite.ssrLoadModule('/src/utils/entryNavigation.ts');
    const shopId = '9007199254740993', resourceId = '9007199254740997';
    for (const [tab, key] of [['services', 'serviceId'], ['therapists', 'therapistId']]) {
      const href = reservationEntryHref(shopId, tab, resourceId), query = href.slice(href.indexOf('?'));
      const target = new URL(href, 'http://local.invalid');
      assert.equal(target.pathname, tab === 'services' ? '/price-menu' : '/reservations');
      if (tab === 'services') { assert.equal(target.searchParams.has('view'), false, 'current single-page links do not revive the removed inventory view'); assert.equal(target.searchParams.get('pane'), 'booking'); }
      else assert.equal(target.searchParams.get('tab'), 'therapists');
      assert.equal(new URLSearchParams(query).get('shopId'), shopId);
      assert.equal(requestedEntryId(query, key), resourceId);
    }
    const items = [{ id: '8' }, { id: resourceId }];
    assert.equal(selectEntryResource(items, resourceId), items[1]);
    assert.equal(selectEntryResource(items, '9'), undefined);
    assert.equal(selectEntryResource(items, ''), undefined);
    assert.equal(selectEntryResource(items, null), items[0], 'only an absent explicit ID retains the normal default');
    for (const query of ['?serviceId=', '?serviceId=0', '?serviceId=-1', '?serviceId=1&serviceId=2', '?serviceId=9223372036854775808', '?serviceId=https://invalid.example']) {
      assert.equal(requestedEntryId(query, 'serviceId'), '');
    }
    assert.throws(() => reservationEntryHref('0', 'services', resourceId));
  } finally { await vite.close(); }
});

test('copy entry resolves only the explicitly authorized source and never grants access or falls back to a different shop', async () => {
  const vite = await viteServer();
  try {
    const { resolveCopyEntry, requestedEntryId } = await vite.ssrLoadModule('/src/utils/entryNavigation.ts');
    const shops = [
      { id: '1', permissions: ['COPY_CONFIG', 'SHOP_SETTINGS_MANAGE'] },
      { id: '2', permissions: ['COPY_CONFIG', 'CATALOG_MANAGE'] },
      { id: '3', permissions: ['SHOP_SETTINGS_MANAGE'] },
    ];
    assert.deepEqual(resolveCopyEntry(shops, requestedEntryId('?sourceShopId=2', 'sourceShopId'), '1'), { sourceId: '2', kind: 'HOURS', error: '' });
    assert.deepEqual(resolveCopyEntry(shops, null, '1'), { sourceId: '1', kind: 'HOURS', error: '' });
    for (const id of ['', '3', '9']) {
      const result = resolveCopyEntry(shops, id, '1');
      assert.equal(result.sourceId, ''); assert.match(result.error, /所请求来源门店/);
    }
    assert.equal(resolveCopyEntry([], '2', '1').sourceId, '');
    assert.equal(resolveCopyEntry(shops, null, '9').sourceId, '', 'does not choose the first unrelated shop');
    assert.deepEqual(resolveCopyEntry([{ id: '4', permissions: ['COPY_CONFIG'] }], '4', '1'), { sourceId: '4', kind: 'HOURS', error: '' });
    assert.equal(requestedEntryId('?sourceShopId=1&sourceShopId=2', 'sourceShopId'), '');
  } finally { await vite.close(); }
});
test('hours alone needs copy permission; unified price menu requires catalog and reservation permissions', async () => {
  const vite=await viteServer();
  try{
    const {canCopyKind,copyKindSelection,copyKindPermissionMessage}=await vite.ssrLoadModule('/src/utils/entryNavigation.ts');
    const own={id:'1',accessType:'OWN',permissions:['COPY_CONFIG','CATALOG_MANAGE','SHOP_SETTINGS_MANAGE']},catalog={id:'2',accessType:'ASSOCIATED',permissions:['COPY_CONFIG','CATALOG_MANAGE']},settings={id:'3',accessType:'ASSOCIATED',permissions:['COPY_CONFIG','SHOP_SETTINGS_MANAGE']},copyOnly={id:'4',accessType:'ASSOCIATED',permissions:['COPY_CONFIG']},noCopy={id:'5',permissions:['CATALOG_MANAGE']};
    for(const kind of ['HOURS']){
      assert.equal(canCopyKind(copyOnly,kind),true);assert.equal(canCopyKind(settings,kind),true);assert.equal(canCopyKind(noCopy,kind),false);
      assert.deepEqual(copyKindSelection([own,catalog,settings,noCopy],'1','2',kind),{sourceId:'1',targetId:'2'});
      assert.deepEqual(copyKindSelection([own,catalog,settings,noCopy],'2','1',kind),{sourceId:'2',targetId:'1'});
      assert.deepEqual(copyKindSelection([own,catalog,settings,copyOnly,noCopy],'4','1',kind),{sourceId:'4',targetId:'1'});
      assert.deepEqual(copyKindSelection([own,catalog,settings,copyOnly,noCopy],'1','4',kind),{sourceId:'1',targetId:'4'});
      assert.match(copyKindPermissionMessage(kind),/快捷复制权限/);
    }
    assert.equal(canCopyKind(catalog,'CATALOG'),true);assert.equal(canCopyKind(copyOnly,'CATALOG'),false);
    assert.equal(canCopyKind(settings,'CATALOG'),false);assert.equal(canCopyKind(noCopy,'CATALOG'),false);
    assert.equal(canCopyKind(catalog,'ADD_ONS'),false);assert.equal(canCopyKind({...catalog,permissions:[...catalog.permissions,'RESERVATION_CONFIG']},'ADD_ONS'),true);
    assert.match(copyKindPermissionMessage('ADD_ONS'),/目录管理和预约配置/);
    for (const shop of [copyOnly, catalog, settings, own, noCopy]) assert.equal(canCopyKind(shop, 'PRICE_MENU'), false);
    const complete = {...catalog, permissions: [...catalog.permissions, 'RESERVATION_CONFIG']};
    assert.equal(canCopyKind(complete, 'PRICE_MENU'), true);
    assert.deepEqual(copyKindSelection([complete, copyOnly], complete.id, copyOnly.id, 'PRICE_MENU'), {sourceId: complete.id, targetId: ''});
    assert.match(copyKindPermissionMessage('PRICE_MENU'), /统一复制并保留预约关联/);
  }finally{await vite.close();}
});

test('catalog writes lock synchronously before form validation and release after validation or API failure', async () => {
  const vite = await viteServer();
  try {
    const { createCatalogScope } = await vite.ssrLoadModule('/src/utils/catalogScope.ts');
    const scope = createCatalogScope(() => true);
    assert.equal(scope.beginWrite(), null);
    scope.activate();
    const first = scope.beginWrite();
    assert.ok(first);
    assert.equal(scope.beginWrite(), null, 'a second click cannot enter while the first form validation awaits');
    try { await Promise.reject(new Error('Synthetic validation failure')); } catch { first.finish(); }
    const retry = scope.beginWrite();
    assert.ok(retry); retry.finish();
    assert.ok(scope.beginWrite());
    scope.dispose();
  } finally { await vite.close(); }
});

test('catalog late callbacks cannot show success or update another shop after a switch or unmount', async () => {
  const vite = await viteServer();
  try {
    const { createCatalogScope } = await vite.ssrLoadModule('/src/utils/catalogScope.ts');
    let selected = true, resolve;
    const scope = createCatalogScope(() => selected); scope.activate();
    const task = scope.beginWrite(), events = [];
    const request = new Promise(done => { resolve = done; }).then(() => { if (task.current()) events.push('success'); task.finish(); });
    selected = false;
    assert.equal(scope.beginWrite(), null);
    resolve(); await request;
    assert.deepEqual(events, []);
    selected = true;
    const last = scope.beginWrite(); assert.ok(last);
    scope.dispose();
    assert.equal(last.current(), false);
    assert.equal(scope.current(), false);
  } finally { await vite.close(); }
});

test('latest catalog reads win and a disposed lifetime cannot unlock a new page lifetime', async () => {
  const vite = await viteServer();
  try {
    const { createCatalogScope } = await vite.ssrLoadModule('/src/utils/catalogScope.ts');
    const scope = createCatalogScope(() => true); scope.activate();
    const oldRead = scope.read(), newest = scope.read();
    assert.equal(oldRead(), false); assert.equal(newest(), true);
    const oldWrite = scope.beginWrite();
    scope.dispose(); scope.activate();
    const newWrite = scope.beginWrite(); assert.ok(newWrite);
    oldWrite.finish();
    assert.equal(scope.beginWrite(), null, 'a late old finally does not release the newer request lock');
    assert.equal(oldWrite.current(), false); assert.equal(newest(), false);
    newWrite.finish(); assert.ok(scope.beginWrite()); scope.dispose();
  } finally { await vite.close(); }
});

test('booking-link captures do not cancel catalog reads and cannot revive after a shop or account round trip', async () => {
  const vite = await viteServer();
  try {
    const { createCatalogScope } = await vite.ssrLoadModule('/src/utils/catalogScope.ts');
    let selected = true;
    const scope = createCatalogScope(() => selected); scope.activate();
    const catalogRead = scope.read(), oldLink = scope.capture();
    assert.equal(catalogRead(), true, 'opening the link picker must not supersede a catalog fetch');
    assert.equal(oldLink(), true);
    scope.read();
    assert.equal(oldLink(), true, 'an independent catalog refresh does not cancel the link lifecycle');
    selected = false; assert.equal(oldLink(), false);
    scope.dispose(); scope.activate(); selected = true;
    assert.equal(oldLink(), false, 'returning to the same shop ID cannot revive its old picker request');
    const newLink = scope.capture(); assert.equal(newLink(), true);
    scope.dispose(); scope.activate();
    assert.equal(newLink(), false, 'changing accounts at the same shop also discards old requests');
    assert.equal(scope.capture()(), true); scope.dispose();
  } finally { await vite.close(); }
});

test('catalog list transports propagate cancellation and retain response-only legacy technician links', async () => {
  const requests = [];
  axios.defaults.adapter = async config => {
    requests.push(config);
    return response(config, [{ id: '8', name: 'Synthetic resource', durationMin: 60, serviceIds: ['9'], isActive: true }]);
  };
  const vite = await viteServer();
  try {
    const api = await vite.ssrLoadModule('/src/api/merchant.ts'), controller = new AbortController();
    await api.getShopServices('7', controller.signal);
    const [technician] = await api.getShopTherapists('7', controller.signal);
    assert.deepEqual(technician.serviceIds, ['9']);
    assert.deepEqual(requests.map(item => [item.url, item.signal === controller.signal]), [['/merchant/shops/7/services', true], ['/merchant/shops/7/therapists', true]]);
  } finally { await vite.close(); }
});

test('catalog saves reject mismatched resource/shop responses and preserve exact IDs for valid writes', async () => {
  let mode = 'wrong-shop';
  axios.defaults.adapter = async config => response(config, mode === 'wrong-shop' ? { id: '8', shopId: '99', durationKind: 'TIMED' } : mode === 'wrong-id' ? { id: '9' } : { id: '9007199254740997', shopId: '7', durationMin: 60, durationKind: 'TIMED' });
  const vite = await viteServer();
  try {
    const api = await vite.ssrLoadModule('/src/api/merchant.ts');
    const dto = { name: 'Synthetic service', category: 'MASSAGE', durationMin: 60, priceCents: 10025 };
    await assert.rejects(api.createService('7', dto), /无法核对保存结果/);
    await assert.rejects(api.createTechnician('7', { name: 'Synthetic technician' }), /无法核对保存结果/);
    mode = 'wrong-id';
    await assert.rejects(api.updateService('8', { isActive: false }), /无法核对保存结果/);
    await assert.rejects(api.updateTechnician('8', { name: 'Updated technician' }), /无法核对保存结果/);
    mode = 'valid';
    assert.equal((await api.createService('7', dto)).id, '9007199254740997');
  } finally { await vite.close(); }
});


test('ADD_ONS kind selection requires all three permissions on each exact side and clears only invalid choices', async () => {
  const vite = await viteServer();
  try {
    const { canCopyKind, copyKindSelection, resolveCopyEntry } = await vite.ssrLoadModule('/src/utils/entryNavigation.ts');
    const shops = [
      { id: '1', permissions: ['COPY_CONFIG', 'SHOP_SETTINGS_MANAGE'] },
      { id: '2', permissions: ['COPY_CONFIG', 'CATALOG_MANAGE'] },
      { id: '3', permissions: ['COPY_CONFIG', 'CATALOG_MANAGE', 'RESERVATION_CONFIG'] },
      { id: '4', permissions: ['COPY_CONFIG', 'CATALOG_MANAGE', 'RESERVATION_CONFIG'] },
      { id: '5', permissions: ['CATALOG_MANAGE', 'RESERVATION_CONFIG'] },
      { id: '6', permissions: ['COPY_CONFIG', 'RESERVATION_CONFIG'] },
    ];
    assert.deepEqual(shops.filter(row => canCopyKind(row, 'ADD_ONS')).map(row => row.id), ['3','4']);
    assert.deepEqual(copyKindSelection(shops, '3', '4', 'ADD_ONS'), { sourceId: '3', targetId: '4' });
    assert.deepEqual(copyKindSelection(shops, '2', '4', 'ADD_ONS'), { sourceId: '', targetId: '4' });
    assert.deepEqual(copyKindSelection(shops, '3', '1', 'ADD_ONS'), { sourceId: '3', targetId: '' });
    assert.deepEqual(copyKindSelection(shops, '3', '3', 'ADD_ONS'), { sourceId: '3', targetId: '' });
    assert.deepEqual(copyKindSelection(shops, '5', '6', 'ADD_ONS'), { sourceId: '', targetId: '' });
    assert.deepEqual(resolveCopyEntry(shops, '2', '1'), { sourceId: '2', kind: 'HOURS', error: '' });
    assert.deepEqual(resolveCopyEntry(shops, '3', '1'), { sourceId: '3', kind: 'PRICE_MENU', error: '' });
    assert.equal(canCopyKind(shops[1], 'ADD_ONS'), false, 'a catalog fallback must not grant reservation configuration');
    const revoked = shops.map(row => row.id === '4' ? { ...row, permissions: ['COPY_CONFIG', 'CATALOG_MANAGE'] } : row);
    assert.deepEqual(copyKindSelection(revoked, '3', '4', 'ADD_ONS'), { sourceId: '3', targetId: '' });
  } finally { await vite.close(); }
});
