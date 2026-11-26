import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPublicIntake, checkedIntakeReceipt, parseIntakeFile, previewPublicIntake, publicIntakeResult, resolvePublicIntake, PUBLIC_INTAKE_MAX_BYTES, type IntakePreview, type IntakeReceipt } from './publicIntake';
import { clearPendingIntake, createIntakeTemplate, intakeFieldValue, readPendingIntake, savePendingIntake, type PendingIntake } from '../components/store/publicIntakeModel';

const packageDigest = 'a'.repeat(64), requestKey = 'synthetic-intake-key-0001';
const source = { schemaVersion: 1, sourceSystem: 'massajoy1', batchId: 'synthetic-2026', capturedAt: '2026-10-28T00:00:00.000Z', shops: [{ sourceEntity: 'merchant', sourceId: '3763', targetShopId: '9007199254740997', match: { name: 'Synthetic store', shortName: 'synthetic-store' }, sourceUrls: ['https://app.asianmassagebook.com/admin#/merchant/index'], description: 'Synthetic public introduction', rawCatalog: [{ currency: null, priceBasis: null }] }] };
const preview: IntakePreview = { packageDigest, previewToken: 'synthetic-preview-token', expiresAt: '2099-10-28T00:15:00.000Z', canApply: true, summary: { shops: 1, readyShops: 1, fillFields: 1, unchangedFields: 0, keptFields: 0, invalidShops: 0, rawCatalogItems: 1 }, shops: [{ sourceId: '3763', targetShopId: '9007199254740997', name: 'Synthetic store', shortName: 'synthetic-store', status: 'READY', issues: [{ code: 'CATALOG_NOT_IMPORTED', message: '仅保留原始价目' }], fields: [{ field: 'description', state: 'FILL', current: null, incoming: source.shops[0].description }], missing: [{ key: 'timezone', label: '门店时区' }], rawCatalogItems: 1 }] };
const receipt: IntakeReceipt = { operationId: 'synthetic-receipt-0001', appliedAt: '2026-10-28T00:01:00.000Z', requestKey, packageDigest, summary: { shops: 1, changedShops: 1, changedFields: 1, unchangedShops: 0 }, shops: [{ sourceId: '3763', targetShopId: '9007199254740997', changedFields: ['description'] }] };
const marker: PendingIntake = { actorId: '7', requestKey, packageDigest, createdAt: '2026-10-28T00:00:00.000Z' };
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('JSON intake enforces UTF-8 byte limits, supports a BOM and leaves business validation to server preview', () => {
  assert.deepEqual(parseIntakeFile('\uFEFF'+JSON.stringify(source)), source);
  assert.throws(() => parseIntakeFile('{invalid}'), /有效JSON/);
  for (const value of ['[]', 'null', '1', '"text"']) assert.throws(() => parseIntakeFile(value), /顶层/);
  assert.throws(() => parseIntakeFile(JSON.stringify({ text: '界'.repeat(Math.ceil(PUBLIC_INTAKE_MAX_BYTES / 3)) })), /60 KiB/);
  assert.deepEqual(parseIntakeFile('{"shops":[{"sourceId":""}]}'), { shops: [{ sourceId: '' }] });
});

test('preview and explicit apply preserve exact IDs, original package and raw catalog without a guessed currency', async () => {
  const original = globalThis.fetch, calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(String(url).endsWith('/preview') ? preview : { ...receipt, replayed: false });
  };
  try {
    const result = await previewPublicIntake(source);
    assert.equal(calls.length, 1); assert.equal(result.shops[0].targetShopId, source.shops[0].targetShopId);
    assert.equal((await applyPublicIntake(source, result, requestKey)).summary.changedFields, 1);
    assert.deepEqual(calls, [
      { url: '/api/v1/admin/public-intake/preview', method: 'POST', body: { package: source } },
      { url: '/api/v1/admin/public-intake/apply', method: 'POST', body: { package: source, previewToken: preview.previewToken, requestKey } },
    ]);
    assert.equal((calls[0].body as { package: typeof source }).package.shops[0].rawCatalog[0].currency, null);
  } finally { globalThis.fetch = original; }
});

test('invalid and unchanged previews remain reviewable with no submit token; malformed previews fail closed', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of ['INVALID', 'UNCHANGED'] as const) {
      const result = { ...preview, canApply: false, previewToken: null, expiresAt: null, summary: { ...preview.summary, readyShops: 0, fillFields: 0, invalidShops: status === 'INVALID' ? 1 : 0 }, shops: [{ ...preview.shops[0], status, fields: [] }] };
      globalThis.fetch = async () => Response.json(result);
      assert.equal((await previewPublicIntake(source)).shops[0].status, status);
      await assert.rejects(applyPublicIntake(source, result, requestKey), /先生成/);
    }
    for (const patch of [{ packageDigest: 'bad' }, { shops: [null] }, { shops: [{ ...preview.shops[0], fields: [null] }] }, { summary: { ...preview.summary, shops: 2 } }, { previewToken: null }, { shops: [{ ...preview.shops[0], missing: [null] }] }]) {
      globalThis.fetch = async () => Response.json({ ...preview, ...patch });
      await assert.rejects(previewPublicIntake(source), /格式无效/);
    }
  } finally { globalThis.fetch = original; }
});

test('preview accepts validated source links and current destination, rejecting an unsafe link response', async () => {
  const original = globalThis.fetch;
  const evidence = {
    sourceUrls: ['https://app.asianmassagebook.com/admin/#/merchants/3763'],
    currentTarget: { name: 'Current synthetic store', shortName: 'current-synthetic-store', address: 'Synthetic current address' },
  };
  try {
    globalThis.fetch = async () => Response.json({ ...preview, shops: [{ ...preview.shops[0], ...evidence }] });
    assert.deepEqual((await previewPublicIntake(source)).shops[0], { ...preview.shops[0], ...evidence });
    for (const unsafeUrl of ['javascript:alert(1)', 'http://app.asianmassagebook.com/admin#/merchant/index', 'https://example.invalid/admin#/merchant/index']) {
      globalThis.fetch = async () => Response.json({ ...preview, shops: [{ ...preview.shops[0], ...evidence, sourceUrls: [unsafeUrl] }] });
      await assert.rejects(previewPublicIntake(source), /格式无效/);
    }
  } finally { globalThis.fetch = original; }
});

test('lost apply response recovers from identifiers only, GET not-found remains unknown, explicit resolve closes without a second apply', async () => {
  const original = globalThis.fetch, storage = memoryStorage(), calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith('/apply')) throw new Error('Synthetic lost response');
    if (String(url).endsWith('/resolve')) return Response.json({ found: true, state: 'NOT_APPLIED', requestKey, packageDigest, resolvedAt: '2026-10-28T00:02:00.000Z' });
    return Response.json({ found: false });
  };
  try {
    savePendingIntake(storage, marker);
    await assert.rejects(applyPublicIntake(source, preview, requestKey));
    const restored = readPendingIntake(storage, marker.actorId)!;
    assert.deepEqual(restored, marker);
    assert.deepEqual(await publicIntakeResult(restored), { found: false });
    assert.deepEqual(readPendingIntake(storage, marker.actorId), marker);
    const closed = await resolvePublicIntake(restored);
    assert.equal(closed.state, 'NOT_APPLIED'); clearPendingIntake(storage, restored);
    assert.equal(readPendingIntake(storage, marker.actorId), null);
    assert.equal(calls.filter(call => call.url.endsWith('/apply')).length, 1);
    assert.deepEqual(calls.slice(1), [
      { url: `/api/v1/admin/public-intake/result/${requestKey}`, method: 'GET', body: null },
      { url: '/api/v1/admin/public-intake/resolve', method: 'POST', body: { requestKey, packageDigest } },
    ]);
    assert.equal(Object.hasOwn(calls[2].body as object, 'package'), false);
  } finally { globalThis.fetch = original; }
});

test('read-only recovery and resolve accept an authoritative applied receipt and reject mismatched or nonterminal answers', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ found: true, state: 'APPLIED', receipt });
    assert.deepEqual(await publicIntakeResult(marker), { found: true, state: 'APPLIED', receipt });
    assert.equal((await resolvePublicIntake(marker)).state, 'APPLIED');
    for (const invalid of [
      { found: false }, { found: true, state: 'NOT_APPLIED', requestKey: 'different-key', packageDigest, resolvedAt: marker.createdAt },
      { found: true, state: 'NOT_APPLIED', requestKey, packageDigest: 'b'.repeat(64), resolvedAt: marker.createdAt },
      { found: true, state: 'APPLIED', receipt: { ...receipt, requestKey: 'different-key' } },
      { found: true, state: 'APPLIED', receipt: { ...receipt, packageDigest: 'b'.repeat(64) } },
    ]) {
      globalThis.fetch = async () => Response.json(invalid);
      await assert.rejects(resolvePublicIntake(marker), /格式无效/);
      if (invalid.found) await assert.rejects(publicIntakeResult(marker), /格式无效/);
    }
  } finally { globalThis.fetch = original; }
});

test('receipt validation cannot accept mismatched totals, repeated targets or forbidden changed fields as success', () => {
  for (const patch of [
    { summary: { ...receipt.summary, changedFields: 2 } }, { summary: { ...receipt.summary, unchangedShops: 1 } },
    { shops: [{ ...receipt.shops[0], changedFields: ['timezone'] }] }, { shops: [null] },
    { shops: [{ ...receipt.shops[0], changedFields: ['description', 'description'] }] },
  ]) assert.throws(() => checkedIntakeReceipt({ ...receipt, ...patch } as IntakeReceipt, marker), /格式无效/);
  assert.throws(() => checkedIntakeReceipt(receipt, { ...marker, requestKey: 'different-key' }), /格式无效/);
});

test('recovery storage contains only whitelisted identifiers, survives actor switching and cannot clear a newer request', () => {
  const storage = memoryStorage();
  savePendingIntake(storage, { ...marker, password: 'Never persist', package: source } as PendingIntake);
  const saved = [...storage.values.values()][0];
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['actorId', 'createdAt', 'packageDigest', 'requestKey']);
  assert.equal(saved.includes('Synthetic'), false); assert.equal(saved.includes('Never persist'), false);
  assert.equal(readPendingIntake(storage, '8'), null);
  const other = { ...marker, actorId: '8', requestKey: 'other-actor-request' }; savePendingIntake(storage, other);
  assert.deepEqual(readPendingIntake(storage, '7'), marker);
  const newer = { ...marker, requestKey: 'newer-request-key' }; savePendingIntake(storage, newer);
  clearPendingIntake(storage, marker);
  assert.deepEqual(readPendingIntake(storage, '7'), newer);
  clearPendingIntake(storage, newer);
  assert.equal(readPendingIntake(storage, '7'), null); assert.deepEqual(readPendingIntake(storage, '8'), other);
  const key = [...storage.values.keys()][0]; storage.setItem(key, '{malformed}');
  assert.equal(readPendingIntake(storage, '8'), null);
  assert.throws(() => savePendingIntake({ ...storage, setItem: () => { throw new Error('Denied storage'); } }, marker), /Denied storage/);
});

test('download template uses at most 20 current exact identities, with no invented source IDs or existing business values', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: String(9000+i), name: `Synthetic ${i}`, shortName: `synthetic-${i}`, about: 'Existing introduction must not become a source', businessHours: { mon: [] } }));
  const template = createIntakeTemplate(items, marker.createdAt, 'synthetic');
  assert.equal(template.shops.length, 20); assert.equal(template.sourceSystem, 'massajoy1');
  assert.deepEqual(template.shops[0], { sourceEntity: 'merchant', sourceId: '', targetShopId: items[0].id, match: { name: items[0].name, shortName: items[0].shortName }, sourceUrls: [], description: '', rawCatalog: [] });
  assert.equal(JSON.stringify(template).includes('Existing introduction'), false);
  assert.equal(Object.hasOwn(template.shops[0], 'businessHours'), false);
  assert.equal(Object.hasOwn(template.shops[0], 'currency'), false);
});

test('preview hours show multiple periods and closed days without manufacturing missing hours', () => {
  assert.equal(intakeFieldValue({ monday: [{ open: '09:00', close: '12:00', closed: false }, { open: '13:00', close: '18:00', closed: false }], tuesday: { closed: true }, wednesday: [] }), '周一 09:00–12:00 / 13:00–18:00\n周二 休息\n周三 休息');
  assert.equal(intakeFieldValue({ monday: { open: false, start: '', end: '' } }), '周一 休息');
  assert.equal(intakeFieldValue(null), '未填写');
  assert.equal(intakeFieldValue('Synthetic plain text <script>'), 'Synthetic plain text <script>');
});

test('preview hours order MySQL weekday keys, short source keys and Chinese keys Monday to Sunday, retaining unknown keys last', () => {
  const period = { open: '09:00', close: '18:00', closed: false };
  const expected = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(day => `${day} 09:00–18:00`).join('\n');
  for (const keys of [
    ['friday', 'monday', 'saturday', 'sunday', 'thursday', 'tuesday', 'wednesday'],
    ['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed'],
    ['周日', '周六', '周五', '周四', '周三', '周二', '周一'],
  ]) {
    const value = Object.fromEntries([['unknown-b', { closed: true }], ...keys.map(day => [day, period]), ['unknown-a', { closed: true }]]);
    assert.equal(intakeFieldValue(value), `${expected}\nunknown-b 休息\nunknown-a 休息`);
  }
});
