import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../api/session';
import type { CopyInput, CopyPreview, CopyResult, CopyResolution } from '../api/storeCopy';
import { ADMIN_COPY_STORAGE_KEY, createAdminCopyStore, type AdminCopyStorage } from './adminCopyStore';

const admin = { id: '9007199254740997', role: 'ADMIN' };
const input: CopyInput = { sourceShopId: '9007199254740999', targetShopId: '9007199254741001', kind: 'PRICE_MENU' };
const key = 'admin-copy:synthetic-0001';
const now = () => Date.parse('2026-10-29T00:00:00.000Z');
function preview(): CopyPreview {
  return { previewHash: 'synthetic-signed.hash', expiresAt: '2026-10-29T00:05:00.000Z', summary: 'Synthetic display menu', changes: { priceMenu: { from: [], to: [{ category: 'Synthetic category', items: [{ name: 'Synthetic item detail never persisted', priceText: '$80 per package' }] }], omittedManagedImages: 0 } } };
}
function result(): CopyResult {
  return { ...input, status: 'APPLIED', operationId: 'a12400be-cf14-49ee-909e-4284a456ea93', created: 1, skipped: 0, groups: 1, omittedManagedImages: 0 };
}
function unresolved(status: 'UNKNOWN' | 'NOT_APPLIED' = 'UNKNOWN'): CopyResolution {
  return status === 'UNKNOWN'
    ? { ...input, idempotencyKey: key, status, reason: 'COPY_REQUEST_STILL_UNCONFIRMED' }
    : { ...input, idempotencyKey: key, status, reason: 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' };
}
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); }, removeItem: (name: string) => { values.delete(name); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('first apply durably records only identifiers before transport and blocks synchronous double clicks', async () => {
  const storage = memoryStorage(), pending = deferred<CopyResult>(); let calls = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async (pair, hash, requestKey) => {
    calls++;
    const marker = JSON.parse(storage.getItem(ADMIN_COPY_STORAGE_KEY)!);
    assert.deepEqual(marker, { v: 1, actorId: admin.id, input, key, previewHash: hash, expiresAt: preview().expiresAt });
    assert.equal(requestKey, key); assert.deepEqual(pair, input);
    assert.equal(JSON.stringify(marker).includes('Synthetic item detail'), false);
    return pending.promise;
  } });
  store.syncAdminCopySession(admin);
  const original = preview(), first = store.startAdminCopy(input, original);
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'IN_FLIGHT');
  await assert.rejects(store.startAdminCopy(input, preview()), /上一笔/);
  original.changes.priceMenu!.to[0].items[0].name = 'Changed outside store';
  assert.equal(store.getAdminCopySnapshot().operation?.preview.changes.priceMenu?.to[0].items[0].name, 'Synthetic item detail never persisted');
  assert.equal(Object.isFrozen(store.getAdminCopySnapshot().operation?.preview.changes.priceMenu?.to[0].items), true);
  assert.throws(() => store.finishAdminCopy(), /尚未确认/);
  pending.resolve(result()); await first;
  assert.equal(calls, 1); assert.equal(store.getAdminCopySnapshot().operation?.state, 'APPLIED');
  assert.equal(store.getAdminCopySnapshot().operation?.attempts, 1);
  assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  store.finishAdminCopy(); assert.equal(store.getAdminCopySnapshot().operation, null);
});

test('lost response plus later rejection remains unknown; retry keeps the signed pair/hash/key and check never applies', async () => {
  const storage = memoryStorage(), sent: unknown[] = []; let applyCalls = 0, resolveCalls = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key,
    apply: async (...args) => { sent.push(args); applyCalls++; if (applyCalls === 1) throw new Error('Synthetic lost response'); throw new ApiError('Denied retry', 403); },
    resolve: async (...args) => { sent.push(args); resolveCalls++; return unresolved(resolveCalls === 1 ? 'UNKNOWN' : 'NOT_APPLIED'); },
  });
  store.syncAdminCopySession(admin);
  await store.startAdminCopy(input, preview());
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  assert.throws(() => store.finishAdminCopy(), /尚未确认/);
  await store.retryAdminCopy();
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  assert.equal(store.getAdminCopySnapshot().operation?.attempts, 2);
  await store.checkAdminCopy();
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  await store.checkAdminCopy();
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'NOT_APPLIED');
  assert.equal(applyCalls, 2); assert.equal(resolveCalls, 2);
  assert.deepEqual(sent, Array.from({ length: 4 }, () => [input, preview().previewHash, key]));
  assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  store.finishAdminCopy(); assert.equal(store.getAdminCopySnapshot().operation, null);
});

test('a definite first-request denial may finish, while transport/timeouts/5xx remain pending', async () => {
  for (const status of [400, 403, 409, 422]) {
    const storage = memoryStorage(), store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { throw new ApiError('Denied', status); } });
    store.syncAdminCopySession(admin); await store.startAdminCopy(input, preview());
    assert.equal(store.getAdminCopySnapshot().operation?.state, 'REJECTED');
    assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null); store.finishAdminCopy();
  }
  for (const error of [new ApiError('Lost', 0), new ApiError('Timeout', 408), new ApiError('Unavailable', 503), new DOMException('Aborted', 'AbortError')]) {
    const storage = memoryStorage(), store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { throw error; } });
    store.syncAdminCopySession(admin); await store.startAdminCopy(input, preview());
    assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
    assert.notEqual(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  }
});

test('a malformed or different-shop success is uncertain rather than a false applied result', async () => {
  const storage = memoryStorage(), store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key,
    apply: async () => ({ ...result(), targetShopId: '17' }), resolve: async () => ({ ...unresolved(), idempotencyKey: 'wrong-request' }),
  });
  store.syncAdminCopySession(admin); await store.startAdminCopy(input, preview());
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  assert.equal(store.getAdminCopySnapshot().operation?.result, null);
  await store.checkAdminCopy();
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
});

test('refresh restores a minimal unknown request without menu data, requests or implicit retry, even after expiry', async () => {
  const storage = memoryStorage(); let calls = 0;
  const first = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { throw new Error('Synthetic disconnect'); } });
  first.syncAdminCopySession(admin); await first.startAdminCopy(input, preview());
  const persisted = storage.getItem(ADMIN_COPY_STORAGE_KEY)!;
  assert.equal(persisted.includes('priceText'), false); assert.equal(persisted.includes('summary'), false); assert.equal(persisted.includes('accessToken'), false);
  const restored = createAdminCopyStore({ storage: () => storage, now: () => now() + 600_000,
    apply: async () => { calls++; return result(); }, resolve: async (pair, hash, requestKey) => { calls++; assert.deepEqual([pair, hash, requestKey], [input, preview().previewHash, key]); return result(); },
  });
  restored.syncAdminCopySession(admin);
  assert.equal(calls, 0); assert.equal(restored.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  assert.equal(restored.getAdminCopySnapshot().operation?.restored, true);
  assert.deepEqual(restored.getAdminCopySnapshot().operation?.preview.changes, {});
  const unsubscribe = restored.subscribeAdminCopy(() => {}); unsubscribe();
  restored.syncAdminCopySession({ ...admin, name: 'Updated profile' });
  assert.equal(calls, 0); assert.notEqual(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  await restored.checkAdminCopy(); assert.equal(calls, 1);
  assert.equal(restored.getAdminCopySnapshot().operation?.state, 'APPLIED');
});

test('unknown restored requests stay unknown after a retry denial and preserve the same marker', async () => {
  const storage = memoryStorage();
  storage.setItem(ADMIN_COPY_STORAGE_KEY, JSON.stringify({ v: 1, actorId: admin.id, input, key, previewHash: preview().previewHash, expiresAt: preview().expiresAt }));
  const before = storage.getItem(ADMIN_COPY_STORAGE_KEY);
  const store = createAdminCopyStore({ storage: () => storage, apply: async () => { throw new ApiError('Expired', 400); } });
  store.syncAdminCopySession(admin); await store.retryAdminCopy();
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), before);
});

test('an initially unavailable session preserves the opaque marker until the same admin identity is verified', () => {
  const storage = memoryStorage(); let calls = 0;
  const marker = JSON.stringify({ v: 1, actorId: admin.id, input, key, previewHash: preview().previewHash, expiresAt: preview().expiresAt });
  storage.setItem(ADMIN_COPY_STORAGE_KEY, marker);
  const store = createAdminCopyStore({ storage: () => storage, apply: async () => { calls++; return result(); }, resolve: async () => { calls++; return result(); } });
  store.syncAdminCopySession(null); store.syncAdminCopySession(null);
  assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), marker);
  assert.equal(store.getAdminCopySnapshot().operation, null); assert.equal(calls, 0);
  store.syncAdminCopySession(admin);
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  assert.equal(store.getAdminCopySnapshot().operation?.restored, true); assert.equal(calls, 0);
  store.syncAdminCopySession(null);
  assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  assert.equal(store.getAdminCopySnapshot().actorId, null);
});

test('account switch clears the old marker and ignores a delayed old apply response', async () => {
  const storage = memoryStorage(), pending = deferred<CopyResult>(); let calls = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { calls++; return pending.promise; } });
  store.syncAdminCopySession(admin); const request = store.startAdminCopy(input, preview());
  store.syncAdminCopySession({ id: '9007199254741011', role: 'ADMIN' });
  assert.equal(store.getAdminCopySnapshot().actorId, '9007199254741011');
  assert.equal(store.getAdminCopySnapshot().operation, null); assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  pending.resolve(result()); await request;
  assert.equal(calls, 1); assert.equal(store.getAdminCopySnapshot().operation, null);
});

test('logout/non-admin session clears pending state and stale checking failures cannot restore it', async () => {
  const storage = memoryStorage(), pending = deferred<CopyResolution>();
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { throw new Error('Lost'); }, resolve: () => pending.promise });
  store.syncAdminCopySession(admin); await store.startAdminCopy(input, preview());
  const checking = store.checkAdminCopy();
  store.syncAdminCopySession({ id: admin.id, role: 'MERCHANT' });
  pending.reject(new ApiError('Denied after logout', 403)); await checking;
  assert.equal(store.getAdminCopySnapshot().actorId, null); assert.equal(store.getAdminCopySnapshot().operation, null);
  assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  await assert.rejects(store.startAdminCopy(input, preview()), /管理员/);
  store.syncAdminCopySession({ id: 9007199254740997, role: 'ADMIN' });
  assert.equal(store.getAdminCopySnapshot().actorId, null);
});

test('check/retry share a synchronous lock, and changing UI input cannot change the active request', async () => {
  const storage = memoryStorage(), pending = deferred<CopyResolution>(); let applies = 0, checks = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key,
    apply: async () => { applies++; throw new Error('Lost'); }, resolve: () => { checks++; return pending.promise; },
  });
  store.syncAdminCopySession(admin); const mutableInput = { ...input }; await store.startAdminCopy(mutableInput, preview());
  mutableInput.targetShopId = '19';
  const first = store.checkAdminCopy();
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'CHECKING');
  await assert.rejects(store.retryAdminCopy(), /仅可重试/);
  await assert.rejects(store.checkAdminCopy(), /仅可查询/);
  pending.resolve(unresolved('NOT_APPLIED')); await first;
  assert.equal(applies, 1); assert.equal(checks, 1);
  assert.equal(store.getAdminCopySnapshot().operation?.input.targetShopId, input.targetShopId);
});

test('unavailable, throwing and silently dropping storage prevent transport and show a readable warning', async () => {
  const stores: Array<() => AdminCopyStorage | null> = [
    () => null,
    () => { throw new Error('Synthetic denied access'); },
    () => ({ getItem: () => null, setItem: () => { throw new Error('Synthetic quota'); }, removeItem: () => {} }),
    () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
  ];
  for (const storage of stores) {
    let calls = 0;
    const store = createAdminCopyStore({ storage, now, randomKey: () => key, apply: async () => { calls++; return result(); } });
    store.syncAdminCopySession(admin);
    await assert.rejects(store.startAdminCopy(input, preview()), /会话存储/);
    assert.equal(calls, 0); assert.equal(store.getAdminCopySnapshot().operation, null);
    assert.match(store.getAdminCopySnapshot().storageWarning, /会话存储/);
  }
});

test('failed terminal marker removal keeps the visible receipt and blocks finish until cleanup succeeds', async () => {
  const memory = memoryStorage(); let denyRemoval = true;
  const storage = { ...memory, removeItem: (name: string) => { if (denyRemoval) throw new Error('Synthetic denied cleanup'); memory.removeItem(name); } };
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => result() });
  store.syncAdminCopySession(admin); await store.startAdminCopy(input, preview());
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'APPLIED');
  assert.notEqual(memory.getItem(ADMIN_COPY_STORAGE_KEY), null);
  assert.throws(() => store.finishAdminCopy(), /会话存储/);
  assert.equal(store.getAdminCopySnapshot().operation?.result?.operationId, result().operationId);
  denyRemoval = false; store.finishAdminCopy();
  assert.equal(store.getAdminCopySnapshot().operation, null); assert.equal(memory.getItem(ADMIN_COPY_STORAGE_KEY), null);
});

test('invalid, expanded or other-actor markers never auto-execute or expose private saved content', () => {
  const valid = { v: 1, actorId: admin.id, input, key, previewHash: preview().previewHash, expiresAt: preview().expiresAt };
  for (const marker of [
    '{bad-json', JSON.stringify({ ...valid, menu: 'Synthetic private marker content' }),
    JSON.stringify({ ...valid, input: { ...input, accessToken: 'Synthetic private marker content' } }),
    JSON.stringify({ ...valid, actorId: '17' }), JSON.stringify({ ...valid, input: { ...input, sourceShopId: '9223372036854775808' } }),
  ]) {
    const storage = memoryStorage(); storage.setItem(ADMIN_COPY_STORAGE_KEY, marker);
    const store = createAdminCopyStore({ storage: () => storage, apply: async () => { throw new Error('Must not auto-apply'); } });
    store.syncAdminCopySession(admin);
    assert.equal(store.getAdminCopySnapshot().operation, null);
    assert.equal(JSON.stringify(store.getAdminCopySnapshot()).includes('Synthetic private marker content'), false);
    assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  }
});

test('expired previews and mismatched inputs fail before saving or sending; subscribers can unmount without cancelling state', async () => {
  const storage = memoryStorage(); let calls = 0, notifications = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { calls++; throw new Error('Lost'); } });
  store.syncAdminCopySession(admin);
  await assert.rejects(store.startAdminCopy(input, { ...preview(), expiresAt: '2000-01-01T00:00:00.000Z' }), /过期/);
  await assert.rejects(store.startAdminCopy({ ...input, targetShopId: input.sourceShopId }, preview()), /格式无效/);
  assert.equal(calls, 0); assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  const stop = store.subscribeAdminCopy(() => { notifications++; });
  await store.startAdminCopy(input, preview()); stop();
  const snapshot = store.getAdminCopySnapshot();
  assert.equal(snapshot, store.getAdminCopySnapshot()); assert.ok(notifications >= 2);
  store.syncAdminCopySession({ ...admin, name: 'Updated same user' });
  assert.equal(store.getAdminCopySnapshot(), snapshot);
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
});

test('session changes triggered at state publication prevent even the old transport from starting', async () => {
  const storage = memoryStorage(); let calls = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { calls++; return result(); } });
  store.syncAdminCopySession(admin);
  const stop = store.subscribeAdminCopy(() => { if (store.getAdminCopySnapshot().operation?.state === 'IN_FLIGHT') store.syncAdminCopySession(null); });
  await store.startAdminCopy(input, preview()); stop();
  assert.equal(calls, 0); assert.equal(store.getAdminCopySnapshot().actorId, null);
  assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
});

test('a terminal subscriber can finish and start the next operation without old cleanup deleting the new marker', async () => {
  const storage = memoryStorage(), pending = deferred<CopyResult>(); let calls = 0, keys = 0, advanced = false;
  let second: Promise<void> | undefined;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => `${key}-${++keys}`, apply: async () => { calls++; return calls === 1 ? result() : pending.promise; } });
  store.syncAdminCopySession(admin);
  const stop = store.subscribeAdminCopy(() => {
    if (!advanced && store.getAdminCopySnapshot().operation?.state === 'APPLIED') {
      advanced = true; store.finishAdminCopy(); second = store.startAdminCopy(input, preview());
    }
  });
  await store.startAdminCopy(input, preview());
  assert.equal(calls, 2); assert.equal(store.getAdminCopySnapshot().operation?.state, 'IN_FLIGHT');
  assert.equal(JSON.parse(storage.getItem(ADMIN_COPY_STORAGE_KEY)!).key, `${key}-2`);
  pending.resolve(result()); await second; stop();
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'APPLIED');
});

test('retry re-persists the same minimal marker if it was removed, but refuses a conflicting saved operation', async () => {
  const storage = memoryStorage(); let calls = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { calls++; throw new Error('Lost'); } });
  store.syncAdminCopySession(admin); await store.startAdminCopy(input, preview());
  const original = storage.getItem(ADMIN_COPY_STORAGE_KEY)!;
  storage.removeItem(ADMIN_COPY_STORAGE_KEY); await store.retryAdminCopy();
  assert.equal(calls, 2); assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), original);
  storage.setItem(ADMIN_COPY_STORAGE_KEY, JSON.stringify({ ...JSON.parse(original), key: 'admin-copy:different-operation' }));
  await assert.rejects(store.retryAdminCopy(), /会话存储/);
  assert.equal(calls, 2); assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
});

const addOnInput: CopyInput = { ...input, kind: 'ADD_ONS' };
function addOnPreview(): CopyPreview {
  return { previewHash: 'signed-addons-preview', expiresAt: preview().expiresAt, summary: 'Synthetic extra copy', changes: { addOns: [{ sourceId: '401', sourceServiceId: '41', sourceServiceName: 'Synthetic source primary', targetServiceId: '51', targetServiceName: 'Synthetic target primary', name: 'Extra detail never persisted', description: null, priceCents: 1000, currency: 'usd', sortOrder: 0, sourceActive: false, action: 'CREATE', reasonCode: 'NEW', reason: '新建停用附加配置' }] } };
}
const addOnResult = (): CopyResult => ({ ...addOnInput, status: 'APPLIED', operationId: result().operationId, created: 1, skipped: 0 });

test('ADD_ONS loss and later403 stay UNKNOWN while retry and query retain original signed pair and key', async () => {
  const storage = memoryStorage(), sent: unknown[] = []; let calls = 0;
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key,
    apply: async (...args) => { sent.push(args); if (++calls === 1) throw new Error('Synthetic lost response'); throw new ApiError('Denied later retry', 403); },
    resolve: async (...args) => { sent.push(args); return addOnResult(); },
  });
  store.syncAdminCopySession(admin); await store.startAdminCopy(addOnInput, addOnPreview());
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  const marker = storage.getItem(ADMIN_COPY_STORAGE_KEY)!;
  assert.equal(marker.includes('Extra detail'), false); assert.deepEqual(JSON.parse(marker).input, addOnInput); assert.throws(() => store.finishAdminCopy(), /尚未确认/);
  await store.retryAdminCopy(); assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN');
  await store.checkAdminCopy(); assert.equal(store.getAdminCopySnapshot().operation?.state, 'APPLIED');
  assert.deepEqual(sent, Array.from({ length: 3 }, () => [addOnInput, addOnPreview().previewHash, key]));
  assert.equal(store.getAdminCopySnapshot().operation?.result?.kind, 'ADD_ONS'); assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
});

test('ADD_ONS refresh restores UNKNOWN identifiers only and never auto-applies even after preview expiry', async () => {
  const storage = memoryStorage();
  const first = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => { throw new Error('Synthetic network loss'); } });
  first.syncAdminCopySession(admin); await first.startAdminCopy(addOnInput, addOnPreview());
  let applyCalls = 0, resolveCalls = 0;
  const restored = createAdminCopyStore({ storage: () => storage, now: () => now() + 600000,
    apply: async () => { applyCalls++; return addOnResult(); },
    resolve: async (pair, hash, originalKey) => { resolveCalls++; assert.deepEqual(pair, addOnInput); assert.equal(hash, addOnPreview().previewHash); assert.equal(originalKey, key); return addOnResult(); },
  });
  restored.syncAdminCopySession(null); assert.notEqual(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
  restored.syncAdminCopySession(admin);
  assert.equal(restored.getAdminCopySnapshot().operation?.state, 'UNKNOWN'); assert.equal(restored.getAdminCopySnapshot().operation?.restored, true);
  assert.deepEqual(restored.getAdminCopySnapshot().operation?.preview.changes, {}); assert.equal(applyCalls, 0); assert.equal(resolveCalls, 0);
  await restored.checkAdminCopy(); assert.equal(resolveCalls, 1); assert.equal(applyCalls, 0); assert.equal(restored.getAdminCopySnapshot().operation?.state, 'APPLIED');
});

test('ADD_ONS stale actor completion cannot populate another administrator or revive the old operation', async () => {
  const storage = memoryStorage(), pending = deferred<CopyResult>();
  const store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => pending.promise });
  store.syncAdminCopySession(admin); const request = store.startAdminCopy(addOnInput, addOnPreview());
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'IN_FLIGHT');
  store.syncAdminCopySession({ id: '42', role: 'ADMIN' }); pending.resolve(addOnResult()); await request;
  assert.equal(store.getAdminCopySnapshot().actorId, '42'); assert.equal(store.getAdminCopySnapshot().operation, null); assert.equal(storage.getItem(ADMIN_COPY_STORAGE_KEY), null);
});

test('a malformed ADD_ONS success stays UNKNOWN rather than accepting impossible created skipped counters', async () => {
  const storage = memoryStorage(), store = createAdminCopyStore({ storage: () => storage, now, randomKey: () => key, apply: async () => ({ ...addOnResult(), created: 500, skipped: 1 }) });
  store.syncAdminCopySession(admin); await store.startAdminCopy(addOnInput, addOnPreview());
  assert.equal(store.getAdminCopySnapshot().operation?.state, 'UNKNOWN'); assert.equal(store.getAdminCopySnapshot().operation?.result, null);
  assert.notEqual(storage.getItem(ADMIN_COPY_STORAGE_KEY), null); assert.throws(() => store.finishAdminCopy(), /尚未确认/);
});
