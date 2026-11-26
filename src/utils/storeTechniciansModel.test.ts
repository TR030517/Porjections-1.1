import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scopedId, technicianRow, technicianPayload, verifyTechnicianReceipt, createTechnicianContextGuard, createTechnicianCreateFence, dispatchTechnicianEdit, type StoreIdentity, type TechnicianDraft, type TechnicianPayload, type TechnicianRow } from './storeTechniciansModel';

const draft = (): TechnicianDraft => ({ name: 'Synthetic technician', bio: 'Original note', status: 'INACTIVE' });
const row = (payload: TechnicianPayload, shopId = '5'): TechnicianRow => ({ ...payload, serviceIds: [], bio: payload.bio, id: '81', shopId });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { resolve, reject, promise }; }
function fence(create: (shop: string, body: TechnicianPayload) => Promise<unknown>) {
  let identity: StoreIdentity | null = { actorId: '1', shopId: '5' }; const calls: Array<{ shopId: string; payload: TechnicianPayload }> = [];
  const model = createTechnicianCreateFence({ currentIdentity: () => identity, create: (shopId, payload) => { calls.push({ shopId, payload }); return create(shopId, payload); }, verify: verifyTechnicianReceipt });
  model.syncIdentity(); return { model, calls, change: (next: StoreIdentity | null) => { identity = next; } };
}

test('resource IDs retain int64 strings and reject unsafe numeric aliases', () => {
  assert.equal(scopedId('9007199254740997'), '9007199254740997'); assert.equal(scopedId(81), '81'); assert.equal(scopedId('9223372036854775807'), '9223372036854775807');
  for (const value of [null, undefined, '', '01', '0', '-1', '1e2', '9223372036854775808', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1n]) assert.equal(scopedId(value), null);
});

test('rows require the exact parent shop and only project approved fields, preserving long original biographies', () => {
  const bio = ' Original '.repeat(700), input = { ...row(technicianPayload(draft(), '5', true)), id: 81, shopId: 5, bio, privateAccount: 'must-not-project' };
  const value = technicianRow(input, '5'); assert.equal(value.id, '81'); assert.equal(value.shopId, '5'); assert.equal(value.bio, bio); assert.equal(Object.hasOwn(value, 'privateAccount'), false);
  for (const patch of [{ shopId: '6' }, { id: '0' }, { name: ' ' }, { name: 'N'.repeat(101) }, { status: 'SUSPENDED' }, { bio: 1 }, { serviceIds: ['8', 8] }, { serviceIds: ['unsafe'] }]) assert.throws(() => technicianRow({ ...input, ...patch }, '5'));
  assert.equal(technicianRow({ ...input, bio: null }, '5').bio, null);
});

test('creating requires a selected shop, editing never sends a parent change, and write bounds never truncate', () => {
  const input = { ...draft(), name: ' Checked name ', bio: ' First line\r\nSecond line ' }, result = technicianPayload(input, 5, true);
  assert.deepEqual(result, { shopId: '5', name: 'Checked name', bio: 'First line\r\nSecond line', status: 'INACTIVE' });
  assert.equal(Object.hasOwn(technicianPayload(input, '5', false), 'shopId'), false);
  for (const shopId of [null, undefined, '', '0', 'foreign']) assert.throws(() => technicianPayload(input, shopId, true));
  assert.equal(technicianPayload({ ...draft(), bio: '中'.repeat(5000) }, '5', true).bio.length, 5000);
  for (const patch of [{ name: 'N'.repeat(101) }, { bio: '中'.repeat(5001) }, { bio: ' '.repeat(5001) }, { status: 'UNKNOWN' }]) assert.throws(() => technicianPayload({ ...draft(), ...patch } as TechnicianDraft, '5', true));
  const legacy = technicianRow({ ...row(result), bio: 'Full legacy '.repeat(500) }, '5'); assert.throws(() => technicianPayload({ ...legacy, bio: legacy.bio! }, '5', false));
  assert.equal(Object.hasOwn(technicianPayload({ ...draft(), serviceIds: ['legacy-id'] } as TechnicianDraft, '5', true), 'serviceIds'), false, 'legacy per-project fields never enter a new staff write');
});

test('receipts compare fixed shop, ID aliases and all edited text/status without treating legacy links as a qualification', () => {
  const payload = technicianPayload(draft(), '5', true), raw = { ...row(payload), id: 81, name: ' Synthetic technician ', bio: ' Original note ', serviceIds: ['9', '8'] };
  assert.equal(verifyTechnicianReceipt(raw, '5', payload, '81').id, '81');
  for (const patch of [{ id: '82' }, { shopId: '6' }, { name: 'Changed' }, { bio: 'Changed' }, { status: 'ACTIVE' }, { serviceIds: ['8', '8'] }]) assert.throws(() => verifyTechnicianReceipt({ ...raw, ...patch }, '5', payload, 81));
  assert.equal(verifyTechnicianReceipt({ ...raw, serviceIds: [] }, '5', payload, 81).id, '81');
  assert.throws(() => verifyTechnicianReceipt(raw, '5', { ...payload, shopId: '6' }));
  const empty = technicianPayload({ ...draft(), bio: '' }, '5', true); assert.equal(verifyTechnicianReceipt({ ...row(empty), bio: null }, '5', empty).bio, null);
});

test('context tickets synchronously invalidate after actor or parent changes and after confirmation completion', () => {
  let identity: StoreIdentity | null = { actorId: '1', shopId: '5' }; const scope = createTechnicianContextGuard(() => identity);
  scope.sync(); const before = scope.capture()!; assert.equal(before.current(), true);
  identity = { actorId: '2', shopId: '5' }; assert.equal(before.current(), false);
  const actor = scope.capture()!; identity = { actorId: '2', shopId: '6' }; assert.equal(actor.current(), false);
  const shop = scope.capture()!; scope.invalidate(); assert.equal(shop.current(), false);
  const finished = scope.capture()!; finished.finish(); assert.equal(finished.current(), false);
  const waiting = scope.capture()!; identity = null; assert.equal(waiting.current(), false); assert.equal(scope.capture(), null);
  scope.dispose(); identity = { actorId: '3', shopId: '5' }; assert.equal(scope.capture(), null); scope.sync(); assert.equal(scope.capture()!.current(), true);
});

test('the actual edit dispatch blocks a switched parent, null ticket, replaced editor or foreign row before invoking the mutation', async () => {
  let selected = '5', version = 1, calls = 0;
  const scope = createTechnicianContextGuard(() => selected === '5' ? { actorId: '1', shopId: selected } : null); scope.sync();
  const row = { shopId: '5' }, invoke = () => { calls++; return Promise.resolve('saved'); }, same = () => selected === '5';
  const old = scope.capture()!; selected = '6';
  assert.equal(await dispatchTechnicianEdit(old, row, '5', 1, () => version, same, invoke), null); assert.equal(calls, 0);
  assert.equal(await dispatchTechnicianEdit(scope.capture(), row, '5', 1, () => version, same, invoke), null); assert.equal(calls, 0);
  selected = '5'; const current = scope.capture()!; version = 2;
  assert.equal(await dispatchTechnicianEdit(current, row, '5', 1, () => version, same, invoke), null);
  assert.equal(await dispatchTechnicianEdit(current, { shopId: '6' }, '5', 2, () => version, same, invoke), null); assert.equal(calls, 0);
  assert.equal(await dispatchTechnicianEdit(current, row, '5', 2, () => version, same, invoke), 'saved'); assert.equal(calls, 1);
  scope.dispose();
});

test('a missing shop or a foreign create parent sends no request and retains no foreign payload', async () => {
  const f = fence(async (_shop, payload) => row(payload)); f.change(null); f.model.syncIdentity(); await f.model.submit(technicianPayload(draft(), '5', true)); assert.equal(f.calls.length, 0);
  f.change({ actorId: '1', shopId: '5' }); f.model.syncIdentity(); await f.model.submit(technicianPayload(draft(), '6', true)); assert.equal(f.calls.length, 0); assert.equal(f.model.getSnapshot().state, 'REJECTED');
});

test('synchronous creation fencing allows one POST through double clicks and subscriber re-entry', async () => {
  const waiting = deferred<unknown>(), f = fence(() => waiting.promise), payload = technicianPayload(draft(), '5', true);
  f.model.subscribe(() => { if (f.model.getSnapshot().state === 'IN_FLIGHT') void f.model.submit(payload); });
  const pending = f.model.submit(payload); await f.model.submit(payload); assert.equal(f.calls.length, 1); assert.equal(f.model.getSnapshot().state, 'IN_FLIGHT'); assert.equal(f.model.finish(), false);
  waiting.resolve(row(payload)); await pending; assert.equal(f.model.getSnapshot().state, 'APPLIED'); await f.model.submit(payload); assert.equal(f.calls.length, 1);
});

test('network/timeout/unproven status and wrong successful receipts remain UNKNOWN without list-based proof or retry', async () => {
  const payload = technicianPayload(draft(), '5', true);
  for (const failure of [null, { response: { status: 408 } }, { response: { status: 409 } }, { response: { status: 422 } }, { response: { status: 503 } }, { response: { status: '400' } }, { status: 408 }, { status: 409 }, { status: 503 }, { status: '400' }]) {
    const f = fence(async () => { throw failure; }); await f.model.submit(payload); const original = f.model.getSnapshot();
    assert.equal(original.state, 'UNKNOWN'); await f.model.submit(payload); assert.equal(f.calls.length, 1); assert.equal(f.model.finish(), false); assert.equal(f.model.finishUnknown(false), false); assert.equal(f.model.getSnapshot(), original);
    assert.equal(f.model.finishUnknown(true), true); assert.equal(f.model.getSnapshot().state, 'IDLE'); assert.equal(f.calls.length, 1);
  }
  const wrong = fence(async (_shop, body) => row(body, '6')); await wrong.model.submit(payload); assert.equal(wrong.model.getSnapshot().state, 'UNKNOWN');
});

test('only known rejection statuses permit a corrected explicit submission', async () => {
  for (const status of [400, 401, 403, 404, 429]) for (const failure of [{ status }, { response: { status } }]) {
    let rejected = true; const f = fence(async (_shop, body) => { if (rejected) throw failure; return row(body); });
    await f.model.submit(technicianPayload(draft(), '5', true)); assert.equal(f.model.getSnapshot().state, 'REJECTED'); rejected = false;
    await f.model.submit(technicianPayload({ ...draft(), name: 'Corrected technician' }, '5', true)); assert.equal(f.model.getSnapshot().state, 'APPLIED'); assert.equal(f.calls.length, 2); assert.equal(f.model.finish(), true);
  }
});

test('late create replies cannot mutate a new actor operation or a different selected shop', async () => {
  for (const next of [{ actorId: '2', shopId: '5' }, { actorId: '1', shopId: '6' }]) {
    const old = deferred<unknown>(), fresh = deferred<unknown>(); let sequence = 0;
    const f = fence(() => sequence++ === 0 ? old.promise : fresh.promise), payload = technicianPayload(draft(), '5', true), pending = f.model.submit(payload);
    f.change(next); f.model.syncIdentity(); assert.equal(f.model.getSnapshot().payload, null);
    const freshPayload = technicianPayload({ ...draft(), name: 'New scoped technician' }, next.shopId, true), current = f.model.submit(freshPayload), expected = f.model.getSnapshot();
    old.resolve(row(payload)); await pending; assert.equal(f.model.getSnapshot(), expected);
    fresh.resolve(row(freshPayload, next.shopId)); await current; assert.equal(f.model.getSnapshot().result!.name, freshPayload.name);
  }
});

test('exact request and receipt values are immutable and same-identity refresh does not clear APPLIED', async () => {
  const waiting = deferred<unknown>(), f = fence(() => waiting.promise), payload = technicianPayload(draft(), '5', true), original = structuredClone(payload), pending = f.model.submit(payload);
  payload.name = 'Changed after click'; payload.bio = 'Changed note'; assert.deepEqual(f.calls[0].payload, original); assert.ok(Object.isFrozen(f.calls[0].payload));
  const result = row(original); waiting.resolve(result); await pending; result.serviceIds.push('99'); assert.deepEqual(f.model.getSnapshot().result!.serviceIds, []);
  const applied = f.model.getSnapshot(); f.change({ actorId: '1', shopId: '5' }); f.model.syncIdentity(); assert.equal(f.model.getSnapshot(), applied); assert.ok(Object.isFrozen(applied.result));
});

test('dispose clears private state without notifying the old page, and an explicit sync can reactivate safely', async () => {
  const waiting = deferred<unknown>(), f = fence(() => waiting.promise), payload = technicianPayload(draft(), '5', true); let notifications = 0;
  f.model.subscribe(() => { notifications++; }); const pending = f.model.submit(payload), before = notifications; f.model.dispose(); assert.equal(notifications, before); assert.equal(f.model.getSnapshot().payload, null);
  waiting.resolve(row(payload)); await pending; assert.equal(notifications, before); assert.equal(f.model.getSnapshot().state, 'IDLE'); f.model.syncIdentity(); assert.equal(f.model.getSnapshot().state, 'IDLE');
});
