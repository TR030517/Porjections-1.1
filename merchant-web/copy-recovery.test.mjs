import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';

let server, createCopyRecoveryModel, storageKey, validators;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const core = await server.ssrLoadModule('/src/stores/copyRecoveryModel.ts');
  const api = await server.ssrLoadModule('/src/api/accountAccess.ts');
  createCopyRecoveryModel = core.createCopyRecoveryModel; storageKey = core.COPY_RECOVERY_STORAGE_KEY;
  validators = { input: api.checkedCopyInput, request: api.checkedCopyRequest, preview: api.checkedCopyPreview, result: api.checkedCopyResult, resolution: api.checkedCopyResolution };
});
after(async () => { await server?.close(); });
const actorId = '9007199254740997';
const session = (role = 'MERCHANT', id = actorId) => ({ initialized: true, authenticated: true, actor: { id, role }, explicitLogout: false });
const input = { sourceShopId: '9007199254740999', targetShopId: '9007199254741001', kind: 'PRICE_MENU' };
const key = 'copy-recovery:synthetic-001';
const now = () => Date.parse('2026-10-29T00:00:00.000Z');
const preview = () => ({ previewHash: 'synthetic.signed-hash', expiresAt: '2026-10-29T00:05:00.000Z', summary: 'Synthetic copy plan', changes: { priceMenu: { from: [], to: [{ category: 'Synthetic group', items: [{ name: 'Synthetic menu detail never persisted', priceText: '$80/package' }] }], omittedManagedImages: 0 } } });
const receipt = () => ({ ...input, operationId: 'a12400be-cf14-49ee-909e-4284a456ea93', status: 'APPLIED', created: 1, skipped: 0, groups: 1, omittedManagedImages: 0 });
const resolution = (status = 'UNKNOWN') => ({ ...input, idempotencyKey: key, status, reason: status === 'UNKNOWN' ? 'COPY_REQUEST_STILL_UNCONFIRMED' : 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' });
function memoryStorage() {
  const values = new Map();
  return { values, getItem: name => values.get(name) ?? null, setItem: (name, value) => { values.set(name, value); }, removeItem: name => { values.delete(name); } };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup(overrides = {}) {
  const storage = memoryStorage();
  const model = createCopyRecoveryModel({ storage: () => storage, validators, now, randomKey: () => key, apply: async () => receipt(), resolve: async () => resolution(), ...overrides });
  return { model, storage };
}
function savedMarker() { return { v: 1, actorId, input, key, previewHash: preview().previewHash, expiresAt: preview().expiresAt }; }

test('storage is verified before first transport; double click locks synchronously and menu drafts are detached/frozen', async () => {
  const storage = memoryStorage(), pending = deferred(); let calls = 0;
  const { model } = setup({ storage: () => storage, apply: async (...args) => {
    calls++; assert.deepEqual(args, [input, preview().previewHash, key]);
    assert.deepEqual(JSON.parse(storage.getItem(storageKey)), savedMarker()); return pending.promise;
  } });
  model.syncSession(session()); const plan = preview(), first = model.begin(input, plan);
  await assert.rejects(model.begin(input, preview()), /完成或核对/);
  assert.equal(model.getSnapshot().operation.state, 'IN_FLIGHT');
  plan.changes.priceMenu.to[0].items[0].name = 'External mutation';
  assert.equal(model.getSnapshot().operation.preview.changes.priceMenu.to[0].items[0].name, 'Synthetic menu detail never persisted');
  assert.equal(Object.isFrozen(model.getSnapshot().operation.input), true);
  assert.equal(storage.getItem(storageKey).includes('Synthetic menu detail'), false);
  assert.equal(storage.getItem(storageKey).includes('summary'), false);
  assert.throws(() => model.finish(), /结果仍未知/);
  pending.resolve(receipt()); await first;
  assert.equal(calls, 1); assert.equal(model.getSnapshot().operation.state, 'APPLIED');
  assert.equal(storage.getItem(storageKey), null); model.finish(); assert.equal(model.getSnapshot().operation, null);
});

test('null/throwing/quota/silent-drop session storage all refuse initial apply without a network request', async () => {
  for (const storage of [() => null, () => { throw new Error('Synthetic unavailable'); },
    () => ({ getItem: () => null, setItem: () => { throw new Error('Synthetic quota'); }, removeItem() {} }),
    () => ({ getItem: () => null, setItem() {}, removeItem() {} })]) {
    let calls = 0; const { model } = setup({ storage, apply: async () => { calls++; return receipt(); } });
    model.syncSession(session()); await assert.rejects(model.begin(input, preview()), /会话存储/);
    assert.equal(calls, 0); assert.equal(model.getSnapshot().operation, null); assert.match(model.getSnapshot().storageWarning, /不会提交复制/);
  }
});

test('lost response, later 403/409 and failed query remain UNKNOWN using exactly the original signed request', async () => {
  const sent = []; let applies = 0, checks = 0;
  const { model, storage } = setup({
    apply: async (...args) => { sent.push(args); applies++; if (applies === 1) throw new Error('Synthetic disconnect'); throw { response: { status: applies === 2 ? 403 : 409 } }; },
    resolve: async (...args) => { sent.push(args); checks++; if (checks === 1) throw { response: { status: 403 } }; return resolution('NOT_APPLIED'); },
  });
  model.syncSession(session()); const mutable = { ...input }; await model.begin(mutable, preview()); mutable.targetShopId = '7';
  await model.retry(); await model.retry(); await model.check();
  assert.equal(model.getSnapshot().operation.state, 'UNKNOWN'); assert.equal(model.getSnapshot().operation.attempts, 3);
  assert.throws(() => model.finish(), /结果仍未知/); assert.notEqual(storage.getItem(storageKey), null);
  await model.check(); assert.equal(model.getSnapshot().operation.state, 'NOT_APPLIED');
  assert.equal(applies, 3); assert.equal(checks, 2); assert.equal(storage.getItem(storageKey), null);
  assert.deepEqual(sent, Array.from({ length: 5 }, () => [input, preview().previewHash, key]));
});

test('definite first-request 4xx is REJECTED while no status/408/5xx is UNKNOWN', async () => {
  for (const status of [400, 403, 409, 422, 429, undefined, 408, 500, 503]) {
    const { model, storage } = setup({ apply: async () => { throw { response: { status } }; } });
    model.syncSession(session()); await model.begin(input, preview());
    const rejected = [400, 403, 409, 422, 429].includes(status);
    assert.equal(model.getSnapshot().operation.state, rejected ? 'REJECTED' : 'UNKNOWN');
    assert.equal(storage.getItem(storageKey) === null, rejected);
    if (rejected) model.finish(); else assert.throws(() => model.finish(), /结果仍未知/);
  }
});

test('malformed/mismatched apply or resolution data cannot establish success or clear pending recovery', async () => {
  const { model, storage } = setup({ apply: async () => ({ ...receipt(), targetShopId: '7' }), resolve: async () => ({ ...resolution('NOT_APPLIED'), idempotencyKey: 'another-request' }) });
  model.syncSession(session()); await model.begin(input, preview()); assert.equal(model.getSnapshot().operation.state, 'UNKNOWN');
  await model.check(); assert.equal(model.getSnapshot().operation.state, 'UNKNOWN'); assert.equal(model.getSnapshot().operation.result, null);
  assert.notEqual(storage.getItem(storageKey), null);
});

test('old-key marker survives boot and first unavailable refresh; verified same actor restores UNKNOWN without requests', async () => {
  const storage = memoryStorage(), raw = JSON.stringify(savedMarker()); let calls = 0;
  assert.equal(storageKey, 'massajoy.copy.pending.v1'); storage.setItem(storageKey, raw);
  const { model } = setup({ storage: () => storage, now: () => now() + 600_000, apply: async () => { calls++; return receipt(); }, resolve: async () => { calls++; return receipt(); } });
  model.syncSession({ initialized: false, authenticated: false, actor: null });
  model.syncSession({ initialized: true, authenticated: false, actor: null, explicitLogout: false });
  assert.equal(storage.getItem(storageKey), raw); assert.equal(model.getSnapshot().operation, null); assert.equal(calls, 0);
  model.syncSession(session()); const restored = model.getSnapshot();
  assert.equal(restored.operation.state, 'UNKNOWN'); assert.equal(restored.operation.restored, true);
  assert.deepEqual(restored.operation.preview.changes, {}); assert.equal(calls, 0);
  const stop = model.subscribe(() => {}); stop(); model.syncSession(session()); assert.equal(model.getSnapshot(), restored);
  await model.check(); assert.equal(calls, 1); assert.equal(model.getSnapshot().operation.state, 'APPLIED');
});

test('refresh restores only minimal IDs/hash/expiry/key, never raw preview or credentials', async () => {
  const { model, storage } = setup({ apply: async () => { throw new Error('Synthetic lost response'); } });
  model.syncSession(session()); await model.begin(input, preview());
  const marker = JSON.parse(storage.getItem(storageKey));
  assert.deepEqual(Object.keys(marker).sort(), ['actorId', 'expiresAt', 'input', 'key', 'previewHash', 'v']);
  assert.equal(storage.getItem(storageKey).includes('priceText'), false); assert.equal(storage.getItem(storageKey).includes('token'), false);
  const fresh = setup({ storage: () => storage }).model; fresh.syncSession(session('ADMIN'));
  assert.equal(fresh.getSnapshot().operation.state, 'UNKNOWN'); assert.deepEqual(fresh.getSnapshot().operation.preview.changes, {});
});

test('explicit logout while identity is initially unknown clears a saved marker; STAFF cannot restore or begin', async () => {
  for (const auth of [{ initialized: true, authenticated: false, actor: null, explicitLogout: true }, session('STAFF')]) {
    const storage = memoryStorage(); storage.setItem(storageKey, JSON.stringify(savedMarker()));
    const { model } = setup({ storage: () => storage }); model.syncSession(auth);
    assert.equal(storage.getItem(storageKey), null); assert.equal(model.getSnapshot().operation, null); assert.equal(model.getSnapshot().actorId, null);
    await assert.rejects(model.begin(input, preview()), /管理员或商家/);
  }
});

test('actor switches and role revocation clear prior recovery and late apply cannot overwrite a new actor operation', async () => {
  const pending = deferred(); let calls = 0;
  const { model, storage } = setup({ randomKey: () => `${key}-${calls}`, apply: async () => { calls++; return calls === 1 ? pending.promise : receipt(); } });
  model.syncSession(session()); const old = model.begin(input, preview());
  model.syncSession(session('ADMIN', '41')); assert.equal(storage.getItem(storageKey), null);
  await model.begin(input, preview()); const saved = model.getSnapshot();
  pending.resolve(receipt()); await old; assert.equal(model.getSnapshot(), saved); assert.equal(saved.operation.actorId, '41');
  model.syncSession(session('STAFF', '41')); assert.equal(model.getSnapshot().operation, null);
  assert.equal(storage.getItem(storageKey), null);
});

test('late query failure after logout cannot revive the old request', async () => {
  const pending = deferred(); const { model, storage } = setup({ apply: async () => { throw new Error('Lost'); }, resolve: () => pending.promise });
  model.syncSession(session()); await model.begin(input, preview()); const check = model.check();
  model.syncSession({ initialized: true, authenticated: false, actor: null, explicitLogout: true });
  pending.reject({ response: { status: 403 } }); await check;
  assert.equal(model.getSnapshot().operation, null); assert.equal(model.getSnapshot().actorId, null); assert.equal(storage.getItem(storageKey), null);
});

test('temporary refresh failure clears identity/memory and rejects late replies while preserving only the opaque original marker', async () => {
  const pending = deferred(); let calls = 0;
  const { model, storage } = setup({ apply: async () => { calls++; return pending.promise; } });
  model.syncSession(session()); const old = model.begin(input, preview()), raw = storage.getItem(storageKey);
  model.syncSession({ initialized: true, authenticated: false, actor: null, explicitLogout: false });
  assert.equal(model.getSnapshot().actorId, null); assert.equal(model.getSnapshot().operation, null); assert.equal(storage.getItem(storageKey), raw);
  await assert.rejects(model.retry(), /暂无可重试/); await assert.rejects(model.begin(input, preview()), /管理员或商家/);
  pending.resolve(receipt()); await old; assert.equal(model.getSnapshot().operation, null);
  model.syncSession(session()); assert.equal(calls, 1); assert.equal(model.getSnapshot().operation.state, 'UNKNOWN');
  assert.deepEqual(model.getSnapshot().operation.preview.changes, {});
});

test('a different verified identity after temporary refresh failure removes the old opaque marker', async () => {
  const { model, storage } = setup({ apply: async () => { throw new Error('Synthetic lost response'); } });
  model.syncSession(session()); await model.begin(input, preview());
  model.syncSession({ initialized: true, authenticated: false, actor: null, explicitLogout: false });
  assert.notEqual(storage.getItem(storageKey), null);
  model.syncSession(session('ADMIN', '42'));
  assert.equal(model.getSnapshot().actorId, '42'); assert.equal(model.getSnapshot().operation, null); assert.equal(storage.getItem(storageKey), null);
});

test('query and retry are mutually exclusive and no copy is retried by subscribing or session refresh', async () => {
  const pending = deferred(); let applies = 0, checks = 0;
  const { model } = setup({ apply: async () => { applies++; throw new Error('Lost'); }, resolve: () => { checks++; return pending.promise; } });
  model.syncSession(session()); await model.begin(input, preview());
  const stop = model.subscribe(() => {}); stop(); model.syncSession(session()); assert.equal(applies, 1);
  const check = model.check(); await assert.rejects(model.retry(), /暂无可重试/); await assert.rejects(model.check(), /暂无可查询/);
  pending.resolve(resolution()); await check; assert.equal(applies, 1); assert.equal(checks, 1);
});

test('expired first previews and malformed inputs are refused before marker writes or apply', async () => {
  let calls = 0; const { model, storage } = setup({ apply: async () => { calls++; return receipt(); } });
  model.syncSession(session()); await assert.rejects(model.begin(input, { ...preview(), expiresAt: '2000-01-01T00:00:00.000Z' }), /过期/);
  await assert.rejects(model.begin({ ...input, sourceShopId: '9223372036854775808' }, preview()));
  await assert.rejects(model.begin({ ...input, targetShopId: input.sourceShopId }, preview()));
  assert.equal(calls, 0); assert.equal(storage.values.size, 0);
});

test('terminal observer can finish/start the next request without old cleanup erasing its marker', async () => {
  const pending = deferred(); let calls = 0, keys = 0, advanced = false, second;
  const { model, storage } = setup({ randomKey: () => `${key}-${++keys}`, apply: async () => { calls++; return calls === 1 ? receipt() : pending.promise; } });
  model.syncSession(session()); const stop = model.subscribe(() => {
    if (!advanced && model.getSnapshot().operation?.state === 'APPLIED') { advanced = true; model.finish(); second = model.begin(input, preview()); }
  });
  await model.begin(input, preview());
  assert.equal(model.getSnapshot().operation.state, 'IN_FLIGHT'); assert.equal(JSON.parse(storage.getItem(storageKey)).key, `${key}-2`);
  pending.resolve(receipt()); await second; stop(); assert.equal(model.getSnapshot().operation.state, 'APPLIED');
});

test('failed terminal marker cleanup keeps authoritative receipt visible and finish blocked until cleanup succeeds', async () => {
  const memory = memoryStorage(); let deny = true;
  const storage = { ...memory, removeItem: name => { if (deny) throw new Error('Synthetic cleanup failure'); memory.removeItem(name); } };
  const { model } = setup({ storage: () => storage }); model.syncSession(session()); await model.begin(input, preview());
  assert.equal(model.getSnapshot().operation.state, 'APPLIED'); assert.equal(model.getSnapshot().operation.result.operationId, receipt().operationId);
  assert.match(model.getSnapshot().storageWarning, /会话存储/); assert.throws(() => model.finish(), /会话存储/);
  deny = false; model.finish(); assert.equal(model.getSnapshot().operation, null); assert.equal(memory.values.size, 0);
});

test('retry verifies/recreates the original marker and refuses conflicting or quota-failed persistence before sending', async () => {
  const storage = memoryStorage(); let calls = 0, quota = false;
  const controlled = { ...storage, setItem: (name, value) => { if (quota) throw new Error('Synthetic quota'); storage.setItem(name, value); } };
  const { model } = setup({ storage: () => controlled, apply: async () => { calls++; throw new Error('Lost'); } });
  model.syncSession(session()); await model.begin(input, preview()); const original = storage.getItem(storageKey);
  storage.removeItem(storageKey); await model.retry(); assert.equal(calls, 2); assert.equal(storage.getItem(storageKey), original);
  quota = true; await assert.rejects(model.retry(), /会话存储/); assert.equal(calls, 2);
  quota = false; storage.setItem(storageKey, JSON.stringify({ ...savedMarker(), key: 'synthetic:another-operation' }));
  await assert.rejects(model.retry(), /会话存储/); assert.equal(calls, 2); assert.equal(model.getSnapshot().operation.state, 'UNKNOWN');
});

test('malformed, extra-field or different-actor legacy markers never restore private content or send requests', () => {
  for (const raw of ['{bad-json', JSON.stringify({ ...savedMarker(), rawMenu: 'never expose' }), JSON.stringify({ ...savedMarker(), actorId: '77' }), JSON.stringify({ ...savedMarker(), input: { ...input, token: 'never expose' } })]) {
    const storage = memoryStorage(); storage.setItem(storageKey, raw);
    const { model } = setup({ storage: () => storage }); model.syncSession(session());
    assert.equal(model.getSnapshot().operation, null); assert.equal(storage.values.size, 0); assert.equal(JSON.stringify(model.getSnapshot()).includes('never expose'), false);
  }
});

test('auth publication occurs after marker cleanup and identity verification, preventing subscriber recovery races', async () => {
  const storage = memoryStorage(); storage.setItem(storageKey, JSON.stringify(savedMarker()));
  const pending = deferred(); let calls = 0, request;
  const { model } = setup({ storage: () => storage, apply: () => { calls++; return pending.promise; } });
  const stop = model.subscribe(() => {
    if (model.getSnapshot().actorId && !model.getSnapshot().operation && !request) request = model.begin(input, preview());
  });
  model.syncSession(session()); assert.equal(calls, 0); assert.equal(model.getSnapshot().operation.state, 'UNKNOWN');
  model.syncSession(session('ADMIN', '42')); assert.equal(calls, 1); assert.equal(JSON.parse(storage.getItem(storageKey)).actorId, '42');
  pending.resolve(receipt()); await request; stop(); assert.equal(model.getSnapshot().operation.actorId, '42');
});

test('logout at in-flight publication prevents transport and removes the unsent marker', async () => {
  let calls = 0; const { model, storage } = setup({ apply: async () => { calls++; return receipt(); } });
  model.syncSession(session()); const stop = model.subscribe(() => { if (model.getSnapshot().operation?.state === 'IN_FLIGHT') model.syncSession({ initialized: true, authenticated: false, actor: null, explicitLogout: true }); });
  await model.begin(input, preview()); stop(); assert.equal(calls, 0); assert.equal(model.getSnapshot().operation, null); assert.equal(storage.values.size, 0);
});


const addonInput = { ...input, kind: 'ADD_ONS' };
const addonPreview = () => ({ previewHash: 'synthetic.addon-signature', expiresAt: preview().expiresAt, summary: 'Create inactive add-ons only', changes: { addOns: [
  { sourceId: '11', sourceServiceId: '101', sourceServiceName: 'Massage', targetServiceId: '201', targetServiceName: 'Massage', name: 'Add-on details must never persist', description: 'Original note', priceCents: 1025, currency: 'usd', sortOrder: 0, sourceActive: true, action: 'CREATE', reasonCode: 'NEW', reason: 'New inactive draft' },
] } });
const addonReceipt = () => ({ ...addonInput, operationId: receipt().operationId, status: 'APPLIED', created: 1, skipped: 0 });

test('ADD_ONS recovery preserves opaque kind pair signature key after expiry and applies the full original plan only on explicit retry', async () => {
  let clock = now(), requests = 0;
  const sent = [], storage = memoryStorage();
  const first = setup({ storage: () => storage, now: () => clock, apply: async (...args) => { sent.push(args); throw new Error('Lost'); } }).model;
  first.syncSession(session()); const mutable = addonPreview(); await first.begin(addonInput, mutable);
  mutable.changes.addOns[0].name = 'External mutation';
  assert.equal(first.getSnapshot().operation.preview.changes.addOns[0].name, 'Add-on details must never persist');
  assert.equal(Object.isFrozen(first.getSnapshot().operation.preview.changes.addOns[0]), true);
  assert.equal(JSON.parse(storage.getItem(storageKey)).input.kind, 'ADD_ONS');
  assert.equal(storage.getItem(storageKey).includes('priceCents'), false); assert.equal(storage.getItem(storageKey).includes('Add-on details'), false);
  clock += 600000;
  const restored = setup({ storage: () => storage, now: () => clock,
    apply: async (...args) => { requests++; sent.push(args); return addonReceipt(); },
    resolve: async (...args) => { requests++; sent.push(args); return { ...addonInput, idempotencyKey: key, status: 'UNKNOWN', reason: 'COPY_REQUEST_STILL_UNCONFIRMED' }; },
  }).model;
  restored.syncSession(session()); assert.equal(requests, 0); assert.equal(restored.getSnapshot().operation.input.kind, 'ADD_ONS');
  assert.deepEqual(restored.getSnapshot().operation.preview.changes, {});
  await restored.check(); assert.equal(restored.getSnapshot().operation.state, 'UNKNOWN');
  assert.throws(() => restored.finish(), /结果仍未知/);
  await restored.retry(); assert.equal(restored.getSnapshot().operation.state, 'APPLIED');
  assert.deepEqual(sent, Array.from({ length: 3 }, () => [addonInput, addonPreview().previewHash, key]));
  assert.equal(requests, 2); assert.equal(storage.getItem(storageKey), null);
  restored.finish(); assert.equal(restored.getSnapshot().operation, null);
});

test('ADD_ONS temporary identity refresh never sends automatically and a different verified actor cannot revive or resend the old plan', async () => {
  const pending = deferred(), storage = memoryStorage(); let applies = 0;
  const { model } = setup({ storage: () => storage, apply: async () => { applies++; return pending.promise; }, resolve: async () => addonReceipt() });
  model.syncSession(session()); const active = model.begin(addonInput, addonPreview()), marker = storage.getItem(storageKey);
  model.syncSession({ initialized: true, authenticated: false, actor: null, explicitLogout: false });
  assert.equal(model.getSnapshot().operation, null); assert.equal(storage.getItem(storageKey), marker);
  await assert.rejects(model.retry(), /暂无可重试/); assert.equal(applies, 1);
  pending.resolve(addonReceipt()); await active; assert.equal(model.getSnapshot().operation, null);
  model.syncSession(session()); assert.equal(model.getSnapshot().operation.state, 'UNKNOWN'); assert.equal(applies, 1);
  model.syncSession(session('MERCHANT', '42')); assert.equal(model.getSnapshot().operation, null); assert.equal(storage.getItem(storageKey), null);
  await assert.rejects(model.check(), /暂无可查询/); assert.equal(applies, 1);
});
