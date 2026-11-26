import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  previewCopy, applyCopy, resolveCopy, getCopyHistory, checkedCopyInput, checkedCopyPreview,
  checkedCopyResult, checkedCopyResolution, type CopyAddOnChange, type CopyInput, type CopyPreview, type CopyResult,
} from './storeCopy';

const input: CopyInput = { sourceShopId: '9007199254740997', targetShopId: '9007199254740999', kind: 'PRICE_MENU' };
const key = 'admin-copy:synthetic-0001';

test('unified menu preview preserves exact target mapping, rejects contradictions and never sends a client plan', async () => {
  const links = [
    { resource: 'SERVICE', sourceId: '100', sourceServiceId: '100', targetId: '200', targetServiceId: '200', name: 'Couples Massage', action: 'REUSE' },
    { resource: 'VARIANT', sourceId: '101', sourceServiceId: '100', targetId: null, targetServiceId: '200', name: '90 minutes', action: 'CREATE' },
  ];
  const raw: any = preview(); raw.changes.priceMenu.catalogLinks = links.map(row => ({ ...row, password: 'never-project' }));
  const safe = checkedCopyPreview(raw, input); assert.deepEqual(safe.changes.priceMenu!.catalogLinks, links); assert.equal(JSON.stringify(safe).includes('never-project'), false);
  for (const bad of [
    [{ ...links[0], targetId: null }], [links[1]], [links[0], { ...links[1], targetServiceId: '999' }],
    [links[0], { ...links[1], action: 'REUSE' }], [links[0], links[0]], [{ ...links[0], resource: 'USER' }],
  ]) assert.throws(() => checkedCopyPreview({ ...raw, changes: { priceMenu: { ...raw.changes.priceMenu, catalogLinks: bad } } }, input), /格式无效/);
});
function preview(): CopyPreview {
  return { previewHash: 'synthetic-signed.hash', expiresAt: '2099-10-29T01:00:00.000Z', summary: '仅复制展示文字，不创建预约项目。', changes: { priceMenu: { from: [], to: [{ category: '原始展示目录', items: [{ name: 'Synthetic service', priceText: '$80 / package', description: '原文保留，不推测人数或时长。' }] }], omittedManagedImages: 0 } } };
}
function result(): CopyResult {
  return { ...input, operationId: 'a12400be-cf14-49ee-909e-4284a456ea93', status: 'APPLIED', created: 1, skipped: 0, groups: 1, omittedManagedImages: 0 };
}

test('admin copy uses exact endpoints, string int64 IDs and request-only apply/resolve bodies', async () => {
  const original = globalThis.fetch, calls: Array<{ url: string; method: string; body: unknown; credentials?: RequestCredentials }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, credentials: init?.credentials });
    return Response.json(String(url).endsWith('/preview') ? preview() : result());
  };
  try {
    const plan = await previewCopy({ ...input, privateToken: 'do-not-send' } as CopyInput);
    const applied = await applyCopy(input, plan.previewHash, key);
    const resolved = await resolveCopy(input, plan.previewHash, key);
    assert.equal(applied.targetShopId, input.targetShopId);
    assert.equal(resolved.status, 'APPLIED');
    assert.deepEqual(calls, [
      { url: '/api/v1/account-access/copy/preview', method: 'POST', body: input, credentials: 'include' },
      { url: '/api/v1/account-access/copy/apply', method: 'POST', body: { ...input, previewHash: plan.previewHash, idempotencyKey: key }, credentials: 'include' },
      { url: '/api/v1/account-access/copy/resolve', method: 'POST', body: { ...input, previewHash: plan.previewHash, idempotencyKey: key }, credentials: 'include' },
    ]);
  } finally { globalThis.fetch = original; }
});

test('runtime input guards reject unsafe numeric IDs, invalid pairs/kinds and keys before transport', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected transport'); };
  try {
    for (const id of ['0', '01', '9223372036854775808', '1e3', 9007199254740997]) {
      await assert.rejects(previewCopy({ ...input, sourceShopId: id as string }), /格式无效/);
    }
    for (const value of [null, [], { ...input, targetShopId: input.sourceShopId }, { ...input, kind: 'SERVICES' }, { ...input, kind: { toString: () => 'HOURS' } }]) assert.throws(() => checkedCopyInput(value), /格式无效/);
    await assert.rejects(applyCopy(input, 'hash', 'short'), /格式无效/);
    await assert.rejects(resolveCopy(input, 'bad hash', key), /格式无效/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('preview projects only the selected kind and safe public fields without guessing display prices', () => {
  const raw = preview() as CopyPreview & { credentials: string };
  raw.credentials = 'secret-value';
  Object.assign(raw.changes, { services: [{ sourceId: '5', name: 'extra', action: 'CREATE', private: 'secret-value' }] });
  Object.assign(raw.changes.priceMenu!.to[0].items[0], { sourceAccount: 'secret-value' });
  const safe = checkedCopyPreview(raw, input);
  assert.deepEqual(Object.keys(safe), ['previewHash', 'expiresAt', 'summary', 'changes']);
  assert.deepEqual(Object.keys(safe.changes), ['priceMenu']);
  assert.equal(safe.changes.priceMenu!.to[0].items[0].priceText, '$80 / package');
  assert.equal(JSON.stringify(safe).includes('secret-value'), false);
  const hours = checkedCopyPreview({ ...preview(), changes: { hours: { from: { monday: { open: '09:00', close: '17:00', private: 'secret-value' }, private: 'secret-value' }, to: { monday: { closed: true } } } } }, { ...input, kind: 'HOURS' });
  assert.deepEqual(hours.changes.hours, { from: { monday: { open: '09:00', close: '17:00' } }, to: { monday: { closed: true } } });
  assert.equal(JSON.stringify(hours).includes('secret-value'), false);
});

test('preview bounds display groups/items and rejects unsafe images and malformed service plans', () => {
  const cases: CopyPreview[] = [];
  const tooManyGroups = preview(); tooManyGroups.changes.priceMenu!.to = Array.from({ length: 101 }, () => ({ category: '', items: [] })); cases.push(tooManyGroups);
  const tooManyItems = preview(); tooManyItems.changes.priceMenu!.to[0].items = Array.from({ length: 1001 }, () => ({ name: 'Synthetic', priceText: '' })); cases.push(tooManyItems);
  const badImage = preview(); badImage.changes.priceMenu!.to[0].items[0].imageUrl = 'https://user:password@example.test/private.jpg'; cases.push(badImage);
  const badCount = preview(); badCount.changes.priceMenu!.omittedManagedImages = 2; cases.push(badCount);
  for (const value of cases) assert.throws(() => checkedCopyPreview(value, input), /格式无效/);
  const catalogInput: CopyInput = { ...input, kind: 'CATALOG' };
  const catalog = { ...preview(), changes: { services: [{ sourceId: '9007199254741000', name: 'Synthetic', action: 'CREATE', reason: '新增为停用草稿', priceCents: 8000 }] } };
  const safe = checkedCopyPreview(catalog, catalogInput);
  assert.deepEqual(safe.changes.services, [{ sourceId: '9007199254741000', name: 'Synthetic', durationKind: 'TIMED', action: 'CREATE', reason: '新增为停用草稿' }]);
  assert.throws(() => checkedCopyPreview({ ...catalog, changes: { services: [catalog.changes.services[0], catalog.changes.services[0]] } }, catalogInput), /格式无效/);
  assert.throws(() => checkedCopyPreview({ ...catalog, changes: { services: [{ ...catalog.changes.services[0], action: 'DELETE' }] } }, catalogInput), /格式无效/);
});

test('receipts reject cross-pair/kind, malformed operation IDs and impossible counters', () => {
  const mutations: Array<(data: CopyResult) => void> = [
    data => { data.sourceShopId = '2'; }, data => { data.targetShopId = '3'; }, data => { data.kind = 'HOURS'; },
    data => { data.operationId = 'invalid'; }, data => { data.created = 1001; }, data => { data.skipped = 1; },
    data => { data.groups = 101; }, data => { data.omittedManagedImages = 2; }, data => { data.created = 0.5; },
  ];
  for (const change of mutations) { const data = result(); change(data); assert.throws(() => checkedCopyResult(data, input), /格式无效/); }
  const projected = checkedCopyResult({ ...result(), token: 'secret-value' }, input);
  assert.equal(JSON.stringify(projected).includes('secret-value'), false);
  assert.throws(() => checkedCopyResult({ ...result(), kind: 'HOURS' }, { ...input, kind: 'HOURS' }), /格式无效/);
  assert.throws(() => checkedCopyResult({ ...result(), kind: 'CATALOG', created: 500, skipped: 1 }, { ...input, kind: 'CATALOG' }), /格式无效/);
});

test('resolution accepts only a matching original request and paired terminal reason', () => {
  const unknown = { ...input, idempotencyKey: key, status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED', private: 'secret-value' };
  assert.deepEqual(checkedCopyResolution(unknown, input, key), { ...input, idempotencyKey: key, status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED' });
  assert.throws(() => checkedCopyResolution({ ...unknown, idempotencyKey: 'other-request' }, input, key), /格式无效/);
  assert.throws(() => checkedCopyResolution({ ...unknown, status: 'NOT_APPLIED' }, input, key), /格式无效/);
  assert.throws(() => checkedCopyResolution({ ...unknown, sourceShopId: '5' }, input, key), /格式无效/);
  assert.equal(checkedCopyResolution({ ...unknown, status: 'NOT_APPLIED', reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' }, input, key).status, 'NOT_APPLIED');
});

test('history validates pagination, projects receipts and never returns unknown account fields', async () => {
  const original = globalThis.fetch; let calls = 0;
  const row = { ...result(), createdAt: '2026-10-29T01:00:00.000Z', sourceShopName: 'Synthetic source', targetShopName: 'Synthetic target', login: 'secret-value' };
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(String(url), '/api/v1/account-access/copy/history?page=2&limit=1'); assert.equal(init?.method, undefined);
    return Response.json({ items: [row], total: 2, page: 2, limit: 1, credentials: 'secret-value' });
  };
  try {
    const history = await getCopyHistory(2, 1);
    assert.equal(history.items[0].sourceShopId, input.sourceShopId);
    assert.equal(JSON.stringify(history).includes('secret-value'), false);
    await assert.rejects(getCopyHistory(0, 1), /格式无效/);
    await assert.rejects(getCopyHistory(1, 51), /格式无效/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ items: [row, row], total: 2, page: 1, limit: 20 });
    await assert.rejects(getCopyHistory(), /格式无效/);
    globalThis.fetch = async () => Response.json({ items: [{ ...row, sourceShopId: 9007199254740997 }], total: 1, page: 1, limit: 20 });
    await assert.rejects(getCopyHistory(), /格式无效/);
  } finally { globalThis.fetch = original; }
});

test('actual admin preview transport preserves all four pricing kinds and exact legacy source wording', async () => {
  const original = globalThis.fetch, calls: unknown[] = [];
  const raw = {
    ...preview(), changes: { priceMenu: { from: [], omittedManagedImages: 0, to: [{ category: 'Display only', items: [
      { name: '30Mins Body Massage $50', priceText: '', pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO', legacySource: { name: '  Original title  ', priceText: 'From $45; call to confirm' } }, imageUrl: '/service-gallery/v1/swedish-massage.webp', privateAccount: 'never-project' },
      { name: 'Body Scrub $20 / session', priceText: '', pricing: { kind: 'PER_SESSION', baseName: 'Body Scrub', durationMin: null, priceCents: 2000, titleMode: 'AUTO' } },
      { name: 'Custom complete title', priceText: '', pricing: { kind: 'VARIABLE', baseName: 'Consultation', durationMin: null, priceCents: 0, titleMode: 'CUSTOM' } },
      { name: 'Essential Oil +$10.25 · Add-on', priceText: '', pricing: { kind: 'ADD_ON', baseName: 'Essential Oil', durationMin: null, priceCents: 1025, titleMode: 'AUTO' } },
    ] }] } },
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/v1/account-access/copy/preview'); calls.push(JSON.parse(String(init?.body)));
    return Response.json(raw);
  };
  try {
    const safe = await previewCopy(input), items = safe.changes.priceMenu!.to[0].items;
    assert.equal(items.length, 4); assert.deepEqual(items.map(item => item.pricing!.kind), ['TIMED', 'PER_SESSION', 'VARIABLE', 'ADD_ON']);
    assert.deepEqual(items.map(item => item.pricing), raw.changes.priceMenu.to[0].items.map(item => item.pricing));
    assert.equal(items[0].imageUrl, '/service-gallery/v1/swedish-massage.webp'); assert.equal(JSON.stringify(safe).includes('never-project'), false);
    items[0].pricing!.legacySource!.name = 'Edited local copy';
    assert.equal(raw.changes.priceMenu.to[0].items[0].pricing.legacySource!.name, '  Original title  ');
    assert.deepEqual(calls, [input], 'pricing remains response content; signed pair requests stay unchanged');
  } finally { globalThis.fetch = original; }
});

test('actual admin preview transport rejects malformed structured pricing rather than dropping its constraints', async () => {
  const original = globalThis.fetch;
  const base = () => ({ name: '30Mins Body Massage $50', priceText: '', pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO', legacySource: { name: 'Original', priceText: 'From $50' } } });
  const changes: Array<(item: any) => void> = [
    item => { item.pricing = null; }, item => { item.pricing.kind = 'BOOKABLE_ADD_ON'; },
    item => { item.pricing.priceCents = null; }, item => { item.pricing.priceCents = '5000'; }, item => { item.pricing.priceCents = 0.5; },
    item => { item.pricing.durationMin = 0; }, item => { item.pricing.durationMin = 1441; },
    item => { item.pricing.kind = 'ADD_ON'; }, item => { item.pricing.baseName = ''; },
    item => { item.pricing.accountId = 'unexpected-private-field'; }, item => { item.pricing.legacySource.password = 'unexpected-private-field'; },
    item => { item.priceText = '$50'; }, item => { item.name = 'Wrong auto title'; },
  ];
  try {
    for (const change of changes) {
      const item = base(); change(item);
      globalThis.fetch = async () => Response.json({ ...preview(), changes: { priceMenu: { from: [], to: [{ category: 'Display', items: [item] }], omittedManagedImages: 0 } } });
      await assert.rejects(previewCopy(input), /格式无效/);
    }
  } finally { globalThis.fetch = original; }
});

const addOnInput: CopyInput = { ...input, kind: 'ADD_ONS' };
function addOnRow(patch: Partial<CopyAddOnChange> = {}): CopyAddOnChange {
  return { sourceId: '9007199254741002', sourceServiceId: '41', sourceServiceName: 'Synthetic source primary', targetServiceId: '51', targetServiceName: 'Synthetic target primary',
    name: 'Synthetic optional extra', description: 'Original wording\nSecond line', priceCents: 1000, currency: 'usd', sortOrder: 0,
    sourceActive: false, action: 'CREATE', reasonCode: 'NEW', reason: '新建为停用附加配置', ...patch };
}
function addOnPreview(rows: CopyAddOnChange[] = [addOnRow()]): CopyPreview {
  return { previewHash: 'signed-addons-preview', expiresAt: '2099-10-29T01:00:00.000Z', summary: '只新建停用附加配置', changes: { addOns: rows } };
}

test('ADD_ONS strict preview preserves six final reason combinations and sixteen approved fields only', () => {
  const codes = ['NEW', 'MAIN_NOT_FOUND', 'AMBIGUOUS_MAIN', 'DUPLICATE_SOURCE_NAME', 'TARGET_NAME_EXISTS', 'TARGET_LIMIT'] as const;
  const rows = codes.map((reasonCode, at) => addOnRow({ sourceId: String(101 + at), sourceServiceId: String(201 + at), targetServiceId: at === 1 || at === 2 ? null : String(301 + at), targetServiceName: at === 1 || at === 2 ? null : 'Target ' + at, action: at === 0 ? 'CREATE' : 'SKIP', reasonCode, priceCents: at === 0 ? 0 : 1000, sortOrder: at === 5 ? 10000 : 0 }));
  const raw = addOnPreview(rows); Object.assign(raw, { privateProfile: 'never-project' }); Object.assign(rows[0], { password: 'never-project', isActive: true });
  Object.assign(raw.changes, { services: [{ sourceId: '1', name: 'Wrong kind', action: 'CREATE' }] });
  const safe = checkedCopyPreview(raw, addOnInput), fields = ['sourceId','sourceServiceId','sourceServiceName','sourceDurationKind','targetServiceId','targetServiceName','targetDurationKind','name','description','priceCents','currency','sortOrder','sourceActive','action','reasonCode','reason'].sort();
  assert.deepEqual(Object.keys(safe.changes), ['addOns']); assert.deepEqual(safe.changes.addOns!.map(row => row.reasonCode), [...codes]);
  assert.deepEqual(Object.keys(safe.changes.addOns![0]).sort(), fields); assert.equal(safe.changes.addOns![0].sourceActive, false);
  assert.equal(safe.changes.addOns![0].priceCents, 0); assert.equal(safe.changes.addOns![5].sortOrder, 10000); assert.equal(JSON.stringify(safe).includes('never-project'), false);
  safe.changes.addOns![0].name = 'Changed local view'; assert.equal(rows[0].name, 'Synthetic optional extra');
});

test('copy previews expose strict duration kinds while legacy missing metadata remains timed', () => {
  const raw = addOnPreview([addOnRow({ sourceDurationKind: 'VARIABLE', targetDurationKind: 'VARIABLE' })]);
  const safe = checkedCopyPreview(raw, addOnInput);
  assert.equal(safe.changes.addOns![0].sourceDurationKind, 'VARIABLE');
  assert.equal(safe.changes.addOns![0].targetDurationKind, 'VARIABLE');
  for (const patch of [{ sourceDurationKind: null }, { sourceDurationKind: 'UNKNOWN' }, { targetDurationKind: 'TIMED' }, { targetDurationKind: null }]) {
    assert.throws(() => checkedCopyPreview(addOnPreview([addOnRow({ sourceDurationKind: 'VARIABLE', targetDurationKind: 'VARIABLE', ...patch } as any)]), addOnInput), /格式无效/);
  }
  const old = checkedCopyPreview(addOnPreview(), addOnInput).changes.addOns![0];
  assert.equal(old.sourceDurationKind, 'TIMED'); assert.equal(old.targetDurationKind, 'TIMED');
  const skipped = addOnRow({ sourceDurationKind: 'PER_SESSION', targetDurationKind: null, targetServiceId: null, targetServiceName: null, action: 'SKIP', reasonCode: 'MAIN_NOT_FOUND' });
  assert.equal(checkedCopyPreview(addOnPreview([skipped]), addOnInput).changes.addOns![0].targetDurationKind, null);
  assert.throws(() => checkedCopyPreview(addOnPreview([{ ...skipped, targetDurationKind: 'PER_SESSION' }]), addOnInput));
  const catalog = { ...preview(), changes: { services: [{ sourceId: '8', name: 'Synthetic session', action: 'CREATE', durationKind: 'PER_SESSION', privateField: 'not-copied' }] } };
  const result = checkedCopyPreview(catalog, { ...input, kind: 'CATALOG' });
  assert.equal(result.changes.services![0].durationKind, 'PER_SESSION'); assert.equal(JSON.stringify(result).includes('not-copied'), false);
  for (const durationKind of [null, 'MIXED', 'ADD_ON']) assert.throws(() => checkedCopyPreview({ ...catalog, changes: { services: [{ ...catalog.changes.services[0], durationKind }] } }, { ...input, kind: 'CATALOG' }));
});

test('ADD_ONS preview retains five hundred complete rows and int64 strings and enforces field boundaries', () => {
  const rows = Array.from({ length: 500 }, (_, at) => addOnRow({ sourceId: (9007199254741002n + BigInt(at)).toString(), name: 'Extra ' + at }));
  const safe = checkedCopyPreview(addOnPreview(rows), addOnInput);
  assert.equal(safe.changes.addOns!.length, 500); assert.equal(safe.changes.addOns![499].sourceId, '9007199254741501');
  assert.throws(() => checkedCopyPreview(addOnPreview([...rows, addOnRow({ sourceId: '6' })]), addOnInput), /格式无效/);
  assert.deepEqual(checkedCopyPreview(addOnPreview([]), addOnInput).changes.addOns, []);
  const boundary = checkedCopyPreview(addOnPreview([addOnRow({ name: 'a'.repeat(100), description: 'b'.repeat(1000), priceCents: 10000000, sortOrder: 10000 })]), addOnInput);
  assert.equal(boundary.changes.addOns![0].description!.length, 1000);
});

test('ADD_ONS rejects invalid values and action reason target combinations, duplicate IDs and contradictory parent mappings', () => {
  const changes: Array<(row: any) => void> = [
    row => { row.sourceId = 9007199254741002; }, row => { row.sourceServiceId = '0'; }, row => { row.sourceServiceName = ''; },
    row => { row.targetServiceId = null; }, row => { row.targetServiceName = null; }, row => { delete row.targetServiceName; }, row => { row.targetServiceId = row.sourceServiceId; },
    row => { row.sourceActive = 'false'; }, row => { row.currency = 'USD'; }, row => { row.priceCents = '1000'; }, row => { row.priceCents = -1; }, row => { row.priceCents = 0.5; }, row => { row.priceCents = 10000001; },
    row => { row.sortOrder = 10001; }, row => { row.sortOrder = -1; }, row => { row.sortOrder = 0.5; }, row => { row.name = ' '; }, row => { row.name = 'x'.repeat(101); }, row => { row.name = '<b>Extra</b>'; }, row => { row.name = 'Extra\n'; },
    row => { row.description = 'x'.repeat(1001); }, row => { delete row.description; }, row => { row.description = '<script>unsafe</script>'; }, row => { row.action = 'UPDATE'; }, row => { row.action = 'SKIP'; }, row => { row.reasonCode = 'TARGET_NAME_EXISTS'; },
    row => { row.action = 'SKIP'; row.reasonCode = 'MAIN_NOT_FOUND'; }, row => { row.action = 'SKIP'; row.reasonCode = 'AMBIGUOUS_MAIN'; },
    row => { row.action = 'SKIP'; row.reasonCode = 'DUPLICATE_SOURCE_NAME'; row.targetServiceId = null; row.targetServiceName = null; }, row => { row.reasonCode = 'UNKNOWN_REASON'; }, row => { row.reason = ''; }, row => { row.reason = 'bad\u0000'; },
  ];
  for (const change of changes) { const row = addOnRow(); change(row); assert.throws(() => checkedCopyPreview(addOnPreview([row]), addOnInput), /格式无效/); }
  const row = addOnRow();
  for (const rows of [[row, { ...row }], [row, addOnRow({ sourceId: '2', sourceServiceName: 'Different source name' })], [row, addOnRow({ sourceId: '2', targetServiceName: 'Different target name' })], [row, addOnRow({ sourceId: '2', sourceServiceId: '42' })]]) assert.throws(() => checkedCopyPreview(addOnPreview(rows), addOnInput), /格式无效/);
});

test('actual ADD_ONS transport uses existing preview apply resolve history endpoints and sends no client plan', async () => {
  const original = globalThis.fetch, calls: Array<{ url: string; body: unknown }> = [];
  const receipt = { ...result(), ...addOnInput, created: 1, skipped: 0, groups: 99, omittedManagedImages: 99 };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith('/preview')) return Response.json(addOnPreview());
    if (String(url).includes('/history?')) return Response.json({ items: [{ ...receipt, createdAt: '2026-10-30T00:00:00.000Z', sourceShopName: 'Synthetic source', targetShopName: 'Synthetic target', password: 'never-project' }], page: 1, limit: 20, total: 1 });
    return Response.json(receipt);
  };
  try {
    const plan = await previewCopy(addOnInput), applied = await applyCopy(addOnInput, plan.previewHash, key), resolved = await resolveCopy(addOnInput, plan.previewHash, key), history = await getCopyHistory();
    assert.equal(plan.changes.addOns![0].sourceId, '9007199254741002'); assert.equal(applied.kind, 'ADD_ONS'); assert.equal(resolved.status, 'APPLIED');
    assert.equal(Object.hasOwn(applied, 'groups'), false); assert.equal(Object.hasOwn(applied, 'omittedManagedImages'), false); assert.equal(history.items[0].kind, 'ADD_ONS'); assert.equal(JSON.stringify(history).includes('never-project'), false);
    assert.deepEqual(calls.slice(0, 3), [
      { url: '/api/v1/account-access/copy/preview', body: addOnInput },
      { url: '/api/v1/account-access/copy/apply', body: { ...addOnInput, previewHash: plan.previewHash, idempotencyKey: key } },
      { url: '/api/v1/account-access/copy/resolve', body: { ...addOnInput, previewHash: plan.previewHash, idempotencyKey: key } },
    ]);
  } finally { globalThis.fetch = original; }
});

test('ADD_ONS receipts and resolution reject impossible totals and another copy kind', () => {
  const receipt = { ...result(), ...addOnInput, created: 499, skipped: 1 };
  assert.equal(checkedCopyResult(receipt, addOnInput).created, 499);
  assert.throws(() => checkedCopyResult({ ...receipt, skipped: 2 }, addOnInput), /格式无效/);
  assert.throws(() => checkedCopyResult({ ...receipt, created: 0.5 }, addOnInput), /格式无效/);
  assert.throws(() => checkedCopyResult({ ...receipt, kind: 'CATALOG' }, addOnInput), /格式无效/);
  assert.deepEqual(checkedCopyResolution({ ...addOnInput, idempotencyKey: key, status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED', password: 'never-project' }, addOnInput, key), { ...addOnInput, idempotencyKey: key, status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED' });
});
