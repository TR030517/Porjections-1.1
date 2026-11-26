import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

const input = { sourceShopId: '9007199254740997', targetShopId: '9007199254740999', kind: 'PRICE_MENU' };
const operationId = '976fdf54-95d8-4aa6-a360-e76056f9ad98';
const key = 'merchant-copy:synthetic-0001';
const hash = 'synthetic-signed.hash';
const expiresAt = '2099-10-29T01:00:00.000Z';
const menu = [{ category: 'Promotion', items: [] }, { category: '', items: [{ name: 'Original wording', priceText: '$0.00 / package', description: 'No inferred booking amount.' }] }];
const preview = () => ({ previewHash: hash, expiresAt, summary: 'Only display wording', changes: { priceMenu: { from: [], to: structuredClone(menu), omittedManagedImages: 0 } } });
const result = () => ({ ...input, operationId, status: 'APPLIED', created: 1, skipped: 0, groups: 2, omittedManagedImages: 0 });
const reply = (config, data) => ({ config, data, headers: {}, status: 200, statusText: 'OK' });
async function context(adapter, work) {
  const previous = axios.defaults.adapter;
  axios.defaults.adapter = adapter;
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try { await work(await server.ssrLoadModule('/src/api/accountAccess.ts')); }
  finally { await server.close(); axios.defaults.adapter = previous; }
}

test('merchant copy transport sends only the exact pair, signed preview and original request key', async () => {
  const calls = [];
  await context(async config => {
    calls.push({ url: config.url, body: JSON.parse(config.data) });
    return reply(config, config.url.endsWith('/preview') ? preview() : result());
  }, async api => {
    const plan = await api.previewCopy({ ...input, ownerId: 'must-not-send' });
    await api.applyCopy(input, plan.previewHash, key);
    await api.resolveCopy(input, plan.previewHash, key);
    assert.deepEqual(calls, [
      { url: '/account-access/copy/preview', body: input },
      { url: '/account-access/copy/apply', body: { ...input, previewHash: hash, idempotencyKey: key } },
      { url: '/account-access/copy/resolve', body: { ...input, previewHash: hash, idempotencyKey: key } },
    ]);
  });
});

test('unsafe IDs, same-shop pairs and invalid signed request fields never reach transport', async () => {
  let calls = 0;
  await context(async () => { calls++; throw new Error('Unexpected transport'); }, async api => {
    for (const sourceShopId of [0, 9007199254740997, '01', '0', '9223372036854775808', '1e4', 'https://example.invalid']) {
      await assert.rejects(api.previewCopy({ ...input, sourceShopId }), /无法核对/);
    }
    await assert.rejects(api.previewCopy({ ...input, targetShopId: input.sourceShopId }), /无法核对/);
    await assert.rejects(api.previewCopy({ ...input, kind: 'PAYMENT' }), /无法核对/);
    await assert.rejects(api.applyCopy(input, hash, 'short'), /无法核对/);
    await assert.rejects(api.resolveCopy(input, 'bad hash', key), /无法核对/);
    assert.equal(calls, 0);
  });
});

test('full display menus preserve 1000 literal rows and empty promotions while dropping unrelated response fields', async () => {
  await context(async () => { throw new Error('Unexpected transport'); }, async api => {
    const raw = preview();
    raw.changes.priceMenu.to[1].items = Array.from({ length: 1000 }, (_, i) => ({ name: `Original ${i}`, priceText: i % 2 ? 'Call for price' : '$0.00 / package', account: 'drop-this-field' }));
    raw.changes.services = [{ sourceId: '9', name: 'Wrong kind', action: 'CREATE' }];
    raw.privateProfile = 'drop-this-field';
    const safe = api.checkedCopyPreview(raw, input);
    assert.deepEqual(Object.keys(safe.changes), ['priceMenu']);
    assert.deepEqual(safe.changes.priceMenu.to[0], { category: 'Promotion', items: [] });
    assert.equal(safe.changes.priceMenu.to[1].items.length, 1000);
    assert.equal(safe.changes.priceMenu.to[1].items[999].name, 'Original 999');
    assert.equal(safe.changes.priceMenu.to[1].items[0].priceText, '$0.00 / package');
    assert.equal(safe.changes.priceMenu.to[1].items[1].priceText, 'Call for price');
    assert.equal(JSON.stringify(safe).includes('drop-this-field'), false);
    raw.changes.priceMenu.to[1].items.push({ name: 'Over limit', priceText: '' });
    assert.throws(() => api.checkedCopyPreview(raw, input), /无法核对/);
    const badImage = preview(); badImage.changes.priceMenu.to[1].items[0].imageUrl = 'https://user:password@example.invalid/image.jpg';
    assert.throws(() => api.checkedCopyPreview(badImage, input), /无法核对/);
  });
});

test('actual merchant preview transport retains typed pricing for every display kind without changing signed request bodies', async () => {
  const raw = { ...preview(), changes: { priceMenu: { from: [], omittedManagedImages: 0, to: [{ category: 'Display only', items: [
    { name: '30Mins Body Massage $50', priceText: '', pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO', legacySource: { name: '  Original title  ', priceText: 'From $45; call to confirm' } }, imageUrl: '/service-gallery/v1/swedish-massage.webp', privateAccount: 'never-project' },
    { name: 'Body Scrub $20 / session', priceText: '', pricing: { kind: 'PER_SESSION', baseName: 'Body Scrub', durationMin: null, priceCents: 2000, titleMode: 'AUTO' } },
    { name: 'Custom complete title', priceText: '', pricing: { kind: 'VARIABLE', baseName: 'Consultation', durationMin: null, priceCents: 0, titleMode: 'CUSTOM' } },
    { name: 'Essential Oil +$10.25 · Add-on', priceText: '', pricing: { kind: 'ADD_ON', baseName: 'Essential Oil', durationMin: null, priceCents: 1025, titleMode: 'AUTO' } },
  ] }] } } }, calls = [];
  await context(async config => { calls.push({ url: config.url, body: JSON.parse(config.data) }); return reply(config, raw); }, async api => {
    const safe = await api.previewCopy(input), items = safe.changes.priceMenu.to[0].items;
    assert.deepEqual(items.map(item => item.pricing.kind), ['TIMED', 'PER_SESSION', 'VARIABLE', 'ADD_ON']);
    assert.deepEqual(items.map(item => item.pricing), raw.changes.priceMenu.to[0].items.map(item => item.pricing));
    assert.equal(items[0].imageUrl, '/service-gallery/v1/swedish-massage.webp'); assert.equal(JSON.stringify(safe).includes('never-project'), false);
    items[0].pricing.legacySource.name = 'Local edit';
    assert.equal(raw.changes.priceMenu.to[0].items[0].pricing.legacySource.name, '  Original title  ');
    assert.deepEqual(calls, [{ url: '/account-access/copy/preview', body: input }]);
  });
});

test('actual merchant preview transport rejects invalid pricing, unknown nested fields and inconsistent complete titles', async () => {
  const base = () => ({ name: '30Mins Body Massage $50', priceText: '', pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO', legacySource: { name: 'Original', priceText: 'From $50' } } });
  const changes = [
    item => { item.pricing = null; }, item => { item.pricing.kind = 'BOOKABLE_ADD_ON'; },
    item => { item.pricing.priceCents = null; }, item => { item.pricing.priceCents = '5000'; }, item => { item.pricing.priceCents = 0.5; },
    item => { item.pricing.durationMin = 0; }, item => { item.pricing.durationMin = 1441; },
    item => { item.pricing.kind = 'ADD_ON'; }, item => { item.pricing.baseName = ''; },
    item => { item.pricing.accountId = 'unexpected-private-field'; }, item => { item.pricing.legacySource.password = 'unexpected-private-field'; },
    item => { item.priceText = '$50'; }, item => { item.name = 'Wrong auto title'; },
  ];
  let raw;
  await context(async config => reply(config, raw), async api => {
    for (const change of changes) {
      const item = base(); change(item);
      raw = { ...preview(), changes: { priceMenu: { from: [], to: [{ category: 'Display', items: [item] }], omittedManagedImages: 0 } } };
      await assert.rejects(api.previewCopy(input), /无法核对/);
    }
  });
});

test('hours and catalog plans require their own valid public fields and bounded original service IDs', async () => {
  await context(async () => { throw new Error('Unexpected transport'); }, async api => {
    const hours = { ...input, kind: 'HOURS' };
    const plan = { previewHash: hash, expiresAt, summary: 'Saved hours', changes: { hours: { from: null, to: { monday: [{ open: '09:00', close: '12:00', account: 'omit' }, { open: '14:00', close: '18:00' }], private: 'omit' } } } };
    assert.deepEqual(api.checkedCopyPreview(plan, hours).changes.hours, { from: null, to: { monday: [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '18:00' }] } });
    plan.changes.hours.to.monday[0].close = '25:00';
    assert.throws(() => api.checkedCopyPreview(plan, hours), /无法核对/);
    assert.throws(() => api.checkedCopyPreview(preview(), hours), /无法核对/);
    const catalog = { ...input, kind: 'CATALOG' }, row = { sourceId: '9007199254741000', name: 'Saved service', action: 'CREATE', reason: 'Inactive copy', account: 'omit' };
    const catalogPlan = { previewHash: hash, expiresAt, summary: 'Disabled copies', changes: { services: [row] } };
    assert.deepEqual(api.checkedCopyPreview(catalogPlan, catalog).changes.services, [{ sourceId: row.sourceId, name: row.name, durationKind: 'TIMED', action: row.action, reason: row.reason }]);
    for (const services of [[row, row], [{ ...row, action: 'DELETE' }], [{ ...row, sourceId: 9007199254741000 }], Array.from({ length: 501 }, (_, i) => ({ ...row, sourceId: String(i + 1) }))]) {
      assert.throws(() => api.checkedCopyPreview({ ...catalogPlan, changes: { services } }, catalog), /无法核对/);
    }
  });
});

test('malformed successful replies and impossible counters are rejected rather than marked APPLIED', async () => {
  let answer = result();
  await context(async config => reply(config, answer), async api => {
    const mutations = [
      r => { r.sourceShopId = '4'; }, r => { r.targetShopId = '5'; }, r => { r.kind = 'HOURS'; },
      r => { r.operationId = 'non-empty-but-not-a-receipt-uuid'; }, r => { r.created = 0.5; },
      r => { r.created = 1001; }, r => { r.skipped = 1; }, r => { r.groups = 101; }, r => { r.omittedManagedImages = 2; },
    ];
    for (const mutate of mutations) { answer = result(); mutate(answer); await assert.rejects(api.applyCopy(input, hash, key), /无法核对/); }
    answer = { ...result(), privateProfile: 'omit' };
    assert.deepEqual(await api.applyCopy(input, hash, key), result());
    const hours = { ...input, kind: 'HOURS' };
    assert.deepEqual(api.checkedCopyResult({ ...hours, operationId, status: 'APPLIED', created: 0, skipped: 0 }, hours), { ...hours, operationId, status: 'APPLIED', created: 0, skipped: 0 });
    assert.throws(() => api.checkedCopyResult({ ...result(), kind: 'HOURS' }, hours), /无法核对/);
    const catalog = { ...input, kind: 'CATALOG' };
    assert.throws(() => api.checkedCopyResult({ ...result(), kind: 'CATALOG', created: 500, skipped: 1 }, catalog), /无法核对/);
  });
});

test('resolve retains uncertainty unless the exact original key, pair, kind and reason agree', async () => {
  const unknown = { ...input, idempotencyKey: key, status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED' };
  let answer = unknown;
  await context(async config => reply(config, answer), async api => {
    assert.deepEqual(await api.resolveCopy(input, hash, key), unknown);
    for (const change of [{ idempotencyKey: 'other-request-key' }, { sourceShopId: '4' }, { kind: 'HOURS' }, { status: 'NOT_APPLIED' }, { reason: 'FAILED' }]) {
      answer = { ...unknown, ...change }; await assert.rejects(api.resolveCopy(input, hash, key), /无法核对/);
    }
    answer = { ...unknown, status: 'NOT_APPLIED', reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION', privateProfile: 'omit' };
    assert.deepEqual(await api.resolveCopy(input, hash, key), { ...unknown, status: 'NOT_APPLIED', reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' });
    answer = { ...result(), operationId: 'malformed' };
    await assert.rejects(api.resolveCopy(input, hash, key), /无法核对/);
  });
});

test('history rejects duplicate receipts and oversized pages and projects only public record fields', async () => {
  const privateValue = 'SYNTHETIC_TRANSPORT_ONLY_ACCOUNT_DATA';
  const row = { ...result(), createdAt: expiresAt, sourceShopName: 'Synthetic source', targetShopName: 'Synthetic target', privateProfile: privateValue };
  let answer = { items: [row], total: 1, page: 1, limit: 1, account: privateValue };
  await context(async config => reply(config, answer), async api => {
    const safe = await api.getCopyHistory(1, 1);
    assert.equal(safe.items[0].sourceShopId, input.sourceShopId);
    assert.equal(JSON.stringify(safe).includes(privateValue), false);
    assert.equal(Object.hasOwn(safe, 'account'), false);
    assert.equal(Object.hasOwn(safe.items[0], 'privateProfile'), false);
    answer = { ...answer, items: [row, row], total: 2 };
    await assert.rejects(api.getCopyHistory(1, 1), /无法核对/);
    answer = { ...answer, limit: 20 };
    await assert.rejects(api.getCopyHistory(1, 20), /无法核对/);
    answer = { ...answer, items: [{ ...row, targetShopId: 9007199254740999 }] };
    await assert.rejects(api.getCopyHistory(1, 20), /无法核对/);
    await assert.rejects(api.getCopyHistory(0, 20), /分页无效/);
  });
});


const addonInput = { ...input, kind: 'ADD_ONS' };
const addonRow = (patch = {}) => ({ sourceId: '11', sourceServiceId: '101', sourceServiceName: 'Body Massage', targetServiceId: '201', targetServiceName: 'Body Massage', name: 'Oil', description: 'Original note\nPlease confirm.', priceCents: 1025, currency: 'usd', sortOrder: 0, sourceActive: true, action: 'CREATE', reasonCode: 'NEW', reason: '新增独立停用副本', ...patch });
const addonPreview = rows => ({ previewHash: hash, expiresAt, summary: 'Only explicit add-on settings', changes: { addOns: rows } });
const addonReceipt = (created = 1, skipped = 0) => ({ ...addonInput, operationId, status: 'APPLIED', created, skipped });

test('ADD_ONS transport projects every reason and full signed plan while requests contain only pair kind hash and key', async () => {
  const rows = [addonRow(),
    addonRow({ sourceId: '12', sourceServiceId: '102', sourceServiceName: 'Foot', targetServiceId: null, targetServiceName: null, action: 'SKIP', reasonCode: 'MAIN_NOT_FOUND' }),
    addonRow({ sourceId: '13', sourceServiceId: '103', sourceServiceName: 'Ambiguous', targetServiceId: null, targetServiceName: null, action: 'SKIP', reasonCode: 'AMBIGUOUS_MAIN' }),
    addonRow({ sourceId: '14', sourceServiceId: '104', sourceServiceName: 'Other', targetServiceId: '204', targetServiceName: 'Other', action: 'SKIP', reasonCode: 'DUPLICATE_SOURCE_NAME' }),
    addonRow({ sourceId: '15', sourceServiceId: '104', sourceServiceName: 'Other', targetServiceId: '204', targetServiceName: 'Other', name: 'Ｏｉｌ', action: 'SKIP', reasonCode: 'DUPLICATE_SOURCE_NAME' }),
    addonRow({ sourceId: '16', sourceServiceId: '105', sourceServiceName: 'Facial', targetServiceId: '205', targetServiceName: 'Facial', action: 'SKIP', reasonCode: 'TARGET_NAME_EXISTS', sourceActive: false }),
    addonRow({ sourceId: '17', sourceServiceId: '106', sourceServiceName: 'Full', targetServiceId: '206', targetServiceName: 'Full', action: 'SKIP', reasonCode: 'TARGET_LIMIT', priceCents: 0 }),
  ], raw = addonPreview(rows), calls = [];
  raw.account = 'NEVER_PROJECT'; raw.changes.services = []; raw.changes.addOns[0].credentials = 'NEVER_PROJECT';
  await context(async config => { calls.push({ url: config.url, body: JSON.parse(config.data) }); return reply(config, config.url.endsWith('/preview') ? raw : addonReceipt(1, 6)); }, async api => {
    const plan = await api.previewCopy({ ...addonInput, clientAction: 'must-not-send' });
    assert.deepEqual(Object.keys(plan.changes), ['addOns']); assert.equal(plan.changes.addOns.length, 7);
    assert.deepEqual(plan.changes.addOns.map(row => row.reasonCode), ['NEW','MAIN_NOT_FOUND','AMBIGUOUS_MAIN','DUPLICATE_SOURCE_NAME','DUPLICATE_SOURCE_NAME','TARGET_NAME_EXISTS','TARGET_LIMIT']);
    assert.equal(plan.changes.addOns[0].priceCents, 1025); assert.equal(plan.changes.addOns[5].sourceActive, false); assert.equal(plan.changes.addOns[6].priceCents, 0);
    assert.equal(Object.keys(plan.changes.addOns[0]).length, 16); assert.equal(JSON.stringify(plan).includes('NEVER_PROJECT'), false);
    raw.changes.addOns[0].description = 'External mutation'; assert.notEqual(plan.changes.addOns[0].description, raw.changes.addOns[0].description);
    await api.applyCopy(addonInput, plan.previewHash, key); await api.resolveCopy(addonInput, plan.previewHash, key);
    assert.deepEqual(calls, [{ url: '/account-access/copy/preview', body: addonInput },
      { url: '/account-access/copy/apply', body: { ...addonInput, previewHash: hash, idempotencyKey: key } },
      { url: '/account-access/copy/resolve', body: { ...addonInput, previewHash: hash, idempotencyKey: key } }]);
  });
});

test('ADD_ONS rejects unsafe or duplicate identities, malformed prices and impossible action reason target combinations', async () => {
  let answer;
  await context(async config => reply(config, answer), async api => {
    const bad = [
      { sourceId: 11 }, { sourceServiceId: '0' }, { targetServiceId: '9223372036854775808' }, { targetServiceId: '101' },
      { currency: 'USD' }, { currency: 'eur' }, { priceCents: '1025' }, { priceCents: -1 }, { priceCents: 0.5 }, { priceCents: 10000001 },
      { sourceActive: 'false' }, { sourceActive: null }, { sortOrder: 10001 }, { sortOrder: 0.5 },
      { name: 'x\nY' }, { name: '<b>Oil</b>' }, { description: { url: 'https://example.invalid' } },
      { action: 'DELETE' }, { reasonCode: 'UNRECOGNIZED' }, { action: 'SKIP', reasonCode: 'NEW' },
      { action: 'CREATE', reasonCode: 'TARGET_LIMIT' }, { targetServiceId: null, targetServiceName: null },
      { targetServiceId: '201', targetServiceName: null }, { targetServiceId: null, targetServiceName: 'Body Massage' },
      { action: 'SKIP', reasonCode: 'MAIN_NOT_FOUND' }, { action: 'SKIP', reasonCode: 'AMBIGUOUS_MAIN' },
      { action: 'SKIP', reasonCode: 'DUPLICATE_SOURCE_NAME', targetServiceId: null, targetServiceName: null },
      { action: 'SKIP', reasonCode: 'TARGET_NAME_EXISTS', targetServiceId: null, targetServiceName: null },
      { action: 'SKIP', reasonCode: 'TARGET_LIMIT', targetServiceId: null, targetServiceName: null },
    ];
    for (const patch of bad) { answer = addonPreview([addonRow(patch)]); await assert.rejects(api.previewCopy(addonInput), /无法核对/); }
    for (const rows of [[addonRow(), addonRow()],
      [addonRow(), addonRow({ sourceId: '12', name: ' ＯＩＬ ' })],
      [addonRow(), addonRow({ sourceId: '12', sourceServiceId: '102', sourceServiceName: 'Different source' })],
      [addonRow(), addonRow({ sourceId: '12', sourceServiceName: 'Conflicting same-ID name', name: 'Towel' })],
      [addonRow(), addonRow({ sourceId: '12', targetServiceName: 'Conflicting same-ID name', name: 'Towel' })]]) {
      answer = addonPreview(rows); await assert.rejects(api.previewCopy(addonInput), /无法核对/);
    }
    answer = { ...addonPreview([]), changes: {} }; await assert.rejects(api.previewCopy(addonInput), /无法核对/);
  });
});

test('ADD_ONS preserves an explicit empty plan and the complete bounded 500 rows, not one preview page', async () => {
  let answer = addonPreview([]);
  await context(async config => reply(config, answer), async api => {
    assert.deepEqual((await api.previewCopy(addonInput)).changes, { addOns: [] });
    const rows = Array.from({ length: 500 }, (_, i) => { const parent = Math.floor(i / 50); return addonRow({ sourceId: String(i + 1), sourceServiceId: String(101 + parent), sourceServiceName: `Source ${parent}`, targetServiceId: String(201 + parent), targetServiceName: `Target ${parent}`, name: `Add-on ${i % 50}` }); });
    answer = addonPreview(rows); const plan = await api.previewCopy(addonInput);
    assert.equal(plan.changes.addOns.length, 500); assert.equal(plan.changes.addOns[499].sourceId, '500');
    answer = addonPreview([...rows, addonRow({ sourceId: '501' })]); await assert.rejects(api.previewCopy(addonInput), /无法核对/);
  });
});

test('ADD_ONS apply resolve and history require bounded addon counters and keep old result extensions out', async () => {
  let answer = addonReceipt(400, 100);
  await context(async config => reply(config, answer), async api => {
    assert.deepEqual(await api.applyCopy(addonInput, hash, key), addonReceipt(400, 100));
    for (const patch of [{ created: 501 }, { skipped: 501 }, { created: 400, skipped: 101 }, { created: 0.5 }, { kind: 'CATALOG' }]) {
      answer = { ...addonReceipt(), ...patch }; await assert.rejects(api.applyCopy(addonInput, hash, key), /无法核对/);
    }
    answer = { ...addonInput, idempotencyKey: key, status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED', privateData: 'never-project' };
    const pending = await api.resolveCopy(addonInput, hash, key); assert.equal(pending.kind, 'ADD_ONS'); assert.equal(Object.hasOwn(pending, 'privateData'), false);
    answer = { ...addonInput, idempotencyKey: key, status: 'NOT_APPLIED', reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' };
    assert.equal((await api.resolveCopy(addonInput, hash, key)).status, 'NOT_APPLIED');
    answer = { ...addonReceipt(), groups: 99, omittedManagedImages: 99, privateData: 'never-project' };
    assert.deepEqual(await api.resolveCopy(addonInput, hash, key), addonReceipt());
    const row = { ...addonReceipt(), createdAt: expiresAt, sourceShopName: 'Source', targetShopName: 'Target', privateData: 'never-project' };
    answer = { items: [row], page: 1, limit: 20, total: 1 };
    const history = await api.getCopyHistory(); assert.equal(history.items[0].kind, 'ADD_ONS'); assert.equal(JSON.stringify(history).includes('never-project'), false);
    answer = { ...answer, items: [{ ...row, created: 500, skipped: 1 }] }; await assert.rejects(api.getCopyHistory(), /无法核对/);
  });
});


test('unified menu maps source service and variant to exact target identities without transporting the plan on apply', async () => {
  const links = [
    { resource: 'SERVICE', sourceId: '100', sourceServiceId: '100', targetId: '200', targetServiceId: '200', name: 'Couples Massage', action: 'REUSE' },
    { resource: 'VARIANT', sourceId: '101', sourceServiceId: '100', targetId: null, targetServiceId: '200', name: '90 minutes', action: 'CREATE' },
  ];
  const calls = [];
  await context(async config => { calls.push(JSON.parse(config.data)); return reply(config, result()); }, async api => {
    const raw = preview(); raw.changes.priceMenu.catalogLinks = links.map(row => ({ ...row, secret: 'do-not-expose' }));
    const safe = api.checkedCopyPreview(raw, input); assert.deepEqual(safe.changes.priceMenu.catalogLinks, links); assert.equal(JSON.stringify(safe).includes('do-not-expose'), false);
    for (const bad of [[links[1]], [links[0], { ...links[1], targetServiceId: '999' }], [{ ...links[0], targetId: null }], [links[0], { ...links[1], action: 'REUSE' }], [links[0], links[0]]]) {
      assert.throws(() => api.checkedCopyPreview({ ...raw, changes: { priceMenu: { ...raw.changes.priceMenu, catalogLinks: bad } } }, input), /格式无效/);
    }
    await api.applyCopy(input, hash, key);
    assert.deepEqual(calls, [{ ...input, previewHash: hash, idempotencyKey: key }]);
  });
});
