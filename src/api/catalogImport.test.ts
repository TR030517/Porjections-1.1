import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCatalogImport, catalogImportResult, checkCatalogText, checkedCatalogPreview, checkedCatalogReceipt, previewCatalogImport, resolveCatalogImport, CATALOG_MAX_BYTES, type CatalogPreview, type CatalogReceipt } from './catalogImport';
import { clearPendingCatalog, readPendingCatalog, savePendingCatalog, type PendingCatalogImport } from '../utils/catalogImportModel';

const shopId = '9007199254740997', packageDigest = 'a'.repeat(64), requestKey = 'catalog-import:synthetic-0001';
const raw = '\uFEFFname\tcategory\tduration_minutes\tprice_usd\tdescription\r\n"Synthetic, Body Massage"\t按摩\t60\t65.00\t"Line one\nLine two"\r\n"Synthetic, Body Massage"\t按摩\t90\t95.00\t"Line one\nLine two"\r\n"Synthetic, Body Massage"\t按摩\t60\t65.00\t"Line one\nLine two"\r\nSynthetic Existing Foot Massage\t足疗\t30\t30.00\t';
function preview(): CatalogPreview {
  return { shop: { id: shopId, name: 'Synthetic store' }, currency: 'USD', packageDigest, canApply: true, previewToken: 'synthetic-preview-token', expiresAt: '2099-10-29T01:00:00.000Z', summary: { inputRows: 4, groups: 2, newServices: 1, newVariants: 2, skippedServices: 1, duplicateRows: 1 }, groups: [
    { key: 'MASSAGE:synthetic', name: 'Synthetic, Body Massage', category: 'MASSAGE', description: 'Line one\nLine two', action: 'CREATE', reason: '新增项目', sourceRows: [2, 3, 4], existingIds: [], variants: [{ name: '60 min', durationMin: 60, priceCents: 6500, sourceRows: [2, 4] }, { name: '90 min', durationMin: 90, priceCents: 9500, sourceRows: [3] }] },
    { key: 'REFLEXOLOGY:old', name: 'Synthetic Existing Foot Massage', category: 'REFLEXOLOGY', description: null, action: 'SKIP', reason: '已有同名同类项目，整组保留', sourceRows: [5], existingIds: ['22', '23'], variants: [{ name: '30 min', durationMin: 30, priceCents: 3000, sourceRows: [5] }] },
  ] };
}
function receipt(): CatalogReceipt {
  return { operationId: 'synthetic-operation-0001', requestKey, packageDigest, shopId, appliedAt: '2026-10-29T00:01:00.000Z', summary: { createdServices: 1, createdVariants: 2, skippedServices: 1 }, created: [{ serviceId: '9007199254740999', name: 'Synthetic, Body Massage', variantIds: ['9007199254741000', '9007199254741001'] }], skipped: [{ name: 'Synthetic Existing Foot Massage', existingIds: ['22', '23'] }] };
}
const marker: PendingCatalogImport = { actorId: '7', shopId, requestKey, packageDigest, createdAt: '2026-10-29T00:00:00.000Z' };
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('catalog preserves exact TSV, quoted newlines and int64 IDs across preview and explicit apply', async () => {
  const original = globalThis.fetch, calls: Array<{ url: string; method: string; credentials?: RequestCredentials; body: unknown }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init?.method ?? 'GET', credentials: init?.credentials, body: init?.body ? JSON.parse(String(init.body)) : null }); return Response.json(String(url).endsWith('/preview') ? preview() : receipt()); };
  try {
    const result = await previewCatalogImport(shopId, raw);
    assert.equal(result.groups[0].variants[0].sourceRows.length, 2);
    const saved = await applyCatalogImport(shopId, raw, result, requestKey);
    assert.equal(saved.created[0].variantIds[1], '9007199254741001');
    assert.deepEqual(calls, [
      { url: '/api/v1/admin/catalog-import/preview', method: 'POST', credentials: 'include', body: { shopId, text: raw } },
      { url: '/api/v1/admin/catalog-import/apply', method: 'POST', credentials: 'include', body: { shopId, text: raw, previewToken: result.previewToken, requestKey } },
    ]);
  } finally { globalThis.fetch = original; }
});

test('input gate uses UTF8 byte size, rejects invalid shop IDs and prevents expired or all-skipped apply before transport', async () => {
  assert.equal(checkCatalogText(raw), raw);
  assert.throws(() => checkCatalogText('界'.repeat(Math.floor(CATALOG_MAX_BYTES / 3) + 1)), /60 KiB/);
  assert.throws(() => checkCatalogText(' \r\n\t'), /粘贴/);
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected transport'); };
  try {
    for (const id of ['01', '0', '9223372036854775808', '1e3']) await assert.rejects(previewCatalogImport(id, raw), /有效门店/);
    await assert.rejects(applyCatalogImport(shopId, raw, { ...preview(), expiresAt: '2000-01-01T00:00:00.000Z' }, requestKey), /有效.*预览/);
    const skipped = preview(); skipped.groups[0].action = 'SKIP'; skipped.groups[0].existingIds = ['24']; skipped.canApply = false; skipped.previewToken = null; skipped.expiresAt = null; skipped.summary.newServices = 0; skipped.summary.newVariants = 0; skipped.summary.skippedServices = 2;
    assert.equal(checkedCatalogPreview(skipped, shopId).canApply, false);
    await assert.rejects(applyCatalogImport(shopId, raw, skipped, requestKey), /有效.*预览/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('preview rejects mismatched target, unsafe variants, duplicate source rows and inconsistent summaries', () => {
  for (const durationMin of [5, 15, 29, 121, 180, 240]) {
    const data = preview(); Object.assign(data.groups[0].variants[0], { durationMin, name: `${durationMin} min` });
    assert.equal(checkedCatalogPreview(data, shopId).groups[0].variants[0].durationMin, durationMin);
  }
  for (const durationMin of [0, 4, 241]) {
    const data = preview(); Object.assign(data.groups[0].variants[0], { durationMin, name: `${durationMin} min` });
    assert.throws(() => checkedCatalogPreview(data, shopId), /格式无效/);
  }
  const mutations: Array<(data: CatalogPreview) => void> = [
    data => { data.shop.id = '8'; }, data => { data.currency = 'CAD' as 'USD'; },
    data => { data.groups[0].variants[0].priceCents = 65.5; },
    data => { data.groups[0].variants[0].durationMin = 241; },
    data => { data.groups[0].variants[0].name = 'Different duration'; },
    data => { data.groups[0].variants[0].sourceRows = [2, 2]; },
    data => { data.groups[0].variants[0].sourceRows = [2, 5]; },
    data => { data.groups[0].variants[1].sourceRows = [2]; },
    data => { data.groups[0].existingIds = ['22']; },
    data => { data.groups[1].existingIds = []; },
    data => { data.summary.newVariants++; }, data => { data.summary.duplicateRows = 0; },
    data => { data.previewToken = null; }, data => { data.groups[0].category = 'UNKNOWN'; },
  ];
  for (const mutate of mutations) { const data = preview(); mutate(data); assert.throws(() => checkedCatalogPreview(data, shopId), /格式无效/); }
});

test('receipt validation rejects cross-shop/key/digest results, lossy IDs and duplicated created identities', () => {
  assert.equal(checkedCatalogReceipt(receipt(), marker).created[0].serviceId, '9007199254740999');
  const mutations: Array<(data: CatalogReceipt) => void> = [
    data => { data.shopId = '8'; }, data => { data.requestKey = 'other-request-key'; }, data => { data.packageDigest = 'b'.repeat(64); },
    data => { data.created[0].serviceId = 9007199254740999 as unknown as string; },
    data => { data.created[0].variantIds[1] = data.created[0].variantIds[0]; },
    data => { data.summary.createdVariants = 1; }, data => { data.summary.createdServices = 2; },
    data => { data.skipped[0].existingIds = []; }, data => { data.appliedAt = 'invalid'; },
  ];
  for (const mutate of mutations) { const data = receipt(); mutate(data); assert.throws(() => checkedCatalogReceipt(data, marker), /格式无效/); }
});

test('apply verifies created names and counts against preview rather than showing a mismatched success', async () => {
  const original = globalThis.fetch;
  try {
    const wrong = receipt(); wrong.created[0].name = 'Different service';
    globalThis.fetch = async () => Response.json(wrong);
    await assert.rejects(applyCatalogImport(shopId, raw, preview(), requestKey), /格式无效/);
    wrong.created[0].name = receipt().created[0].name; wrong.skipped[0].existingIds = ['99'];
    await assert.rejects(applyCatalogImport(shopId, raw, preview(), requestKey), /格式无效/);
  } finally { globalThis.fetch = original; }
});

test('lost apply response recovers by identifiers alone; absent result stays unknown until explicit terminal resolve', async () => {
  const original = globalThis.fetch, storage = memoryStorage(), calls: Array<{ url: string; method: string; body: unknown }> = [];
  savePendingCatalog(storage, marker);
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith('/apply')) throw new Error('Synthetic lost response');
    if (String(url).endsWith('/resolve')) return Response.json({ found: true, state: 'NOT_APPLIED', shopId, requestKey, packageDigest, resolvedAt: '2026-10-29T00:02:00.000Z' });
    return Response.json({ found: false });
  };
  try {
    await assert.rejects(applyCatalogImport(shopId, raw, preview(), requestKey), /无法连接/);
    const restored = readPendingCatalog(storage, '7')!;
    assert.deepEqual(restored, marker);
    assert.deepEqual(await catalogImportResult(restored), { found: false });
    assert.deepEqual(readPendingCatalog(storage, '7'), marker);
    const resolved = await resolveCatalogImport(restored);
    assert.equal(resolved.state, 'NOT_APPLIED');
    assert.equal(clearPendingCatalog(storage, restored), true);
    assert.equal(readPendingCatalog(storage, '7'), null);
    assert.equal(calls.filter(call => call.url.endsWith('/apply')).length, 1);
    assert.deepEqual(calls.at(-1)?.body, { shopId, requestKey, packageDigest });
  } finally { globalThis.fetch = original; }
});

test('saved receipt can be restored without source text or preview token, malformed resolution preserves pending marker', async () => {
  const original = globalThis.fetch, storage = memoryStorage(); savePendingCatalog(storage, marker);
  try {
    globalThis.fetch = async () => Response.json({ found: true, state: 'APPLIED', receipt: { ...receipt(), replayed: true } });
    const restored = await catalogImportResult(readPendingCatalog(storage, '7')!);
    assert.equal(restored.found && restored.state, 'APPLIED');
    for (const data of [{ found: false }, { found: true, state: 'NOT_APPLIED', ...marker, shopId: '8', resolvedAt: '2026-10-29T00:03:00.000Z' }, { found: true, state: 'APPLIED', receipt: { ...receipt(), packageDigest: 'b'.repeat(64) } }]) {
      globalThis.fetch = async () => Response.json(data);
      await assert.rejects(resolveCatalogImport(marker), /格式无效/);
      assert.deepEqual(readPendingCatalog(storage, '7'), marker);
    }
  } finally { globalThis.fetch = original; }
});

test('pending storage whitelists metadata, isolates actors and forbids overwriting an unresolved request', () => {
  const storage = memoryStorage();
  savePendingCatalog(storage, { ...marker, text: raw, previewToken: 'secret-token' } as PendingCatalogImport);
  assert.deepEqual(JSON.parse([...storage.values.values()][0]), marker);
  assert.equal([...storage.values.values()][0].includes('secret-token'), false);
  assert.equal(readPendingCatalog(storage, '8'), null);
  assert.throws(() => savePendingCatalog(storage, { ...marker, shopId: '8', requestKey: 'catalog-import:synthetic-0002' }), /尚待核对/);
  savePendingCatalog(storage, { ...marker, actorId: '8', shopId: '8' });
  assert.deepEqual(readPendingCatalog(storage, '7'), marker);
  assert.equal(clearPendingCatalog(storage, { ...marker, actorId: '8' }), false);
  assert.equal(readPendingCatalog(storage, '8')?.shopId, '8');
});

test('a late result cannot clear a newer pending request even after the prior request was explicitly ended', async () => {
  const storage = memoryStorage(); savePendingCatalog(storage, marker);
  let respond!: () => void;
  const response = new Promise<void>(resolve => { respond = resolve; });
  const late = response.then(() => clearPendingCatalog(storage, marker));
  assert.equal(clearPendingCatalog(storage, marker), true);
  const newer = { ...marker, requestKey: 'catalog-import:synthetic-0002', packageDigest: 'b'.repeat(64) };
  savePendingCatalog(storage, newer); respond();
  assert.equal(await late, false);
  assert.deepEqual(readPendingCatalog(storage, '7'), newer);
});

test('malformed or cross-actor storage is removed; denied persistence prevents any metadata write', () => {
  const storage = memoryStorage(); savePendingCatalog(storage, marker); const key = [...storage.values.keys()][0];
  storage.values.set(key, JSON.stringify({ ...marker, actorId: '8' }));
  assert.equal(readPendingCatalog(storage, '7'), null); assert.equal(storage.values.size, 0);
  storage.values.set(key, '{broken'); assert.equal(readPendingCatalog(storage, '7'), null);
  assert.throws(() => savePendingCatalog({ ...storage, setItem: () => { throw new Error('Synthetic denied storage'); } }, marker), /denied storage/);
  assert.equal(storage.values.size, 0);
});
