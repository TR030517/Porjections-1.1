import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';

let vite, createServiceCreateFence;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  ({ createServiceCreateFence } = await vite.ssrLoadModule('/src/utils/serviceCreateFence.ts'));
});
after(async () => { await vite?.close(); });
const payload = () => ({ name: 'Synthetic session', category: 'OTHER', durationKind: 'PER_SESSION', durationMin: 60, priceCents: 8000, description: 'Manually confirmed', isActive: false });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const receipt = (body, shopId = '5', id = '81') => ({ ...body, shopId, id });
function setup(create, verify = (value, shopId, body) => {
  assert.equal(value.shopId, shopId); assert.equal(value.name, body.name); assert.equal(value.durationMin, body.durationMin); assert.equal(value.durationKind, body.durationKind); assert.equal(value.priceCents, body.priceCents); assert.equal(value.isActive, body.isActive);
}) {
  let identity = { actorId: '9007199254740997', shopId: '5' };
  const calls = [], model = createServiceCreateFence({ currentIdentity: () => identity, create: (shopId, body) => { calls.push({ shopId, body }); return create(shopId, body); }, verify });
  model.syncIdentity();
  return { model, calls, change: value => { identity = value; }, identity: () => identity };
}

test('one synchronous in-flight fence blocks a double click and subscriber re-entry before any create settles', async () => {
  const waiting = deferred(), f = setup(() => waiting.promise);
  f.model.subscribe(() => { if (f.model.getSnapshot().state === 'IN_FLIGHT') void f.model.submit({ ...payload(), name: 'Subscriber duplicate' }); });
  const first = f.model.submit(payload());
  assert.equal(f.model.getSnapshot().state, 'IN_FLIGHT'); assert.equal(f.calls.length, 1);
  await f.model.submit({ ...payload(), name: 'Double click' });
  assert.equal(f.model.finish(), false); assert.equal(f.calls.length, 1);
  waiting.resolve(receipt(f.calls[0].body)); await first;
  assert.equal(f.model.getSnapshot().state, 'APPLIED'); assert.equal(f.calls.length, 1);
});

test('lost reply remains UNKNOWN and prevents resubmission until an explicit acknowledgement clears only local state', async () => {
  const f = setup(async () => { throw new Error('Connection disappeared'); });
  await f.model.submit(payload());
  const original = f.model.getSnapshot(); assert.equal(original.state, 'UNKNOWN'); assert.equal(original.result, null);
  await f.model.submit({ ...payload(), name: 'Accidental retry' });
  assert.equal(f.model.getSnapshot(), original); assert.equal(f.calls.length, 1);
  assert.equal(f.model.finish(), false); assert.equal(f.model.getSnapshot(), original);
  assert.equal(f.model.finish(true), true); assert.deepEqual(f.model.getSnapshot(), { state: 'IDLE', payload: null, result: null, error: '' });
  assert.equal(f.calls.length, 1, 'acknowledgement sends neither a retry nor a cancellation');
});

test('an untrusted successful receipt becomes UNKNOWN even if verification throws an allowlisted HTTP status', async () => {
  for (const malformed of [body => receipt(body, '6'), body => ({ ...receipt(body), durationMin: 90 }), () => null]) {
    const f = setup(async (_shop, body) => malformed(body));
    await f.model.submit(payload()); assert.equal(f.model.getSnapshot().state, 'UNKNOWN'); assert.equal(f.model.getSnapshot().result, null);
    await f.model.submit(payload()); assert.equal(f.calls.length, 1);
  }
  const statusFromVerifier = setup(async (_shop, body) => receipt(body), () => { throw { response: { status: 400 } }; });
  await statusFromVerifier.model.submit(payload()); assert.equal(statusFromVerifier.model.getSnapshot().state, 'UNKNOWN');
});

test('only explicitly allowlisted rejection statuses permit a revised request', async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    let denied = true;
    const f = setup(async (_shop, body) => { if (denied) throw { response: { status } }; return receipt(body); });
    await f.model.submit(payload()); assert.equal(f.model.getSnapshot().state, 'REJECTED');
    denied = false; const changed = { ...payload(), name: 'Explicitly corrected service' };
    await f.model.submit(changed); assert.equal(f.model.getSnapshot().state, 'APPLIED'); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.name, changed.name);
  }
});

test('unproven 4xx, timeouts, server errors and malformed status evidence are UNKNOWN rather than a safe retry', async () => {
  const errors = [new Error('Offline'), null, {}, { status: 400 }, ...[408, 409, 422, 499, 500, 503, 200, 0, 700, '400', 400.5, NaN, Infinity].map(status => ({ response: { status } }))];
  for (const error of errors) {
    const f = setup(async () => { throw error; });
    await f.model.submit(payload()); assert.equal(f.model.getSnapshot().state, 'UNKNOWN');
    await f.model.submit(payload()); assert.equal(f.calls.length, 1); assert.equal(f.model.finish(), false);
  }
});

test('immutable exact payload and receipt copies survive mutable caller and transport objects', async () => {
  const waiting = deferred(), original = { ...payload(), nameEn: undefined, extra: { synthetic: ['keep-original'] } }, expected = structuredClone(original);
  const f = setup(() => waiting.promise), pending = f.model.submit(original);
  original.name = 'Edited after click'; original.extra.synthetic.push('Changed');
  assert.deepEqual(f.calls[0].body, expected); assert.deepEqual(f.model.getSnapshot().payload, expected);
  assert.ok(Object.isFrozen(f.calls[0].body)); assert.ok(Object.isFrozen(f.calls[0].body.extra.synthetic));
  assert.equal(Object.hasOwn(f.model.getSnapshot().payload, 'nameEn'), true);
  const raw = receipt(expected); waiting.resolve(raw); await pending;
  raw.name = 'Transport changed after settlement'; raw.extra.synthetic.push('Changed after settlement');
  assert.equal(f.model.getSnapshot().result.name, expected.name); assert.deepEqual(f.model.getSnapshot().result.extra.synthetic, ['keep-original']);
  assert.ok(Object.isFrozen(f.model.getSnapshot())); assert.ok(Object.isFrozen(f.model.getSnapshot().result));
});

test('same actor and shop metadata refresh does not unlock a pending or confirmed request when permissions are temporarily loading', async () => {
  const waiting = deferred(), f = setup(() => waiting.promise), pending = f.model.submit(payload());
  const inFlight = f.model.getSnapshot();
  f.change({ ...f.identity(), permissionsLoading: true }); f.model.syncIdentity();
  assert.equal(f.model.getSnapshot(), inFlight); await f.model.submit(payload()); assert.equal(f.calls.length, 1);
  waiting.resolve(receipt(f.calls[0].body)); await pending;
  const applied = f.model.getSnapshot(); assert.equal(applied.state, 'APPLIED');
  f.change({ ...f.identity(), permissionsLoading: false }); f.model.syncIdentity();
  assert.equal(f.model.getSnapshot(), applied); await f.model.submit(payload()); assert.equal(f.calls.length, 1);
});

test('actor changes clear prior private state and an old late reply cannot overwrite the new actor operation', async () => {
  const old = deferred(), fresh = deferred(); let sequence = 0;
  const f = setup(() => sequence++ === 0 ? old.promise : fresh.promise), oldSubmit = f.model.submit(payload());
  f.change({ actorId: '9007199254740999', shopId: '5' }); f.model.syncIdentity();
  assert.deepEqual(f.model.getSnapshot(), { state: 'IDLE', payload: null, result: null, error: '' });
  const newPayload = { ...payload(), name: 'New actor service' }, newSubmit = f.model.submit(newPayload), newState = f.model.getSnapshot();
  old.resolve(receipt(f.calls[0].body)); await oldSubmit;
  assert.equal(f.model.getSnapshot(), newState); assert.equal(f.model.getSnapshot().state, 'IN_FLIGHT');
  fresh.resolve(receipt(newPayload)); await newSubmit;
  assert.equal(f.model.getSnapshot().state, 'APPLIED'); assert.equal(f.model.getSnapshot().result.name, newPayload.name);
});

test('shop change or logout detected after await clears the old request even without an explicit sync call', async () => {
  for (const changed of [{ actorId: '9007199254740997', shopId: '6' }, null]) {
    const waiting = deferred(), f = setup(() => waiting.promise), pending = f.model.submit(payload());
    f.change(changed); waiting.resolve(receipt(f.calls[0].body)); await pending;
    assert.deepEqual(f.model.getSnapshot(), { state: 'IDLE', payload: null, result: null, error: '' });
  }
});

test('invalid or absent positive int64 identity never sends or retains another actor payload', async () => {
  for (const identity of [null, { actorId: '0', shopId: '5' }, { actorId: '1', shopId: '01' }, { actorId: 1, shopId: '5' }, { actorId: '9223372036854775808', shopId: '5' }]) {
    const f = setup(async (_shop, body) => receipt(body)); f.change(identity); f.model.syncIdentity();
    await f.model.submit(payload()); assert.equal(f.calls.length, 0); assert.equal(f.model.getSnapshot().payload, null);
  }
});

test('APPLIED and UNKNOWN survive same-identity refresh and only explicit finish clears the appropriate outcome', async () => {
  const f = setup(async (_shop, body) => receipt(body));
  assert.equal(f.model.finish(), false); await f.model.submit(payload());
  const applied = f.model.getSnapshot(); await f.model.submit({ ...payload(), priceCents: 9000 });
  assert.equal(f.model.getSnapshot(), applied); assert.equal(f.calls.length, 1);
  assert.equal(f.model.finish(), true); assert.equal(f.model.getSnapshot().state, 'IDLE');
  const rejected = setup(async () => { throw { response: { status: 403 } }; }); await rejected.model.submit(payload());
  assert.equal(rejected.model.finish(), true); assert.equal(rejected.model.getSnapshot().payload, null);
});

test('dispose invalidates late work without notifying a dead page and explicit sync can reactivate a StrictMode remount', async () => {
  const old = deferred(), fresh = deferred(); let sequence = 0;
  const f = setup(() => sequence++ === 0 ? old.promise : fresh.promise); let notices = 0;
  f.model.subscribe(() => { notices++; }); const oldSubmit = f.model.submit(payload()), before = notices;
  f.model.dispose(); assert.equal(notices, before); assert.equal(f.model.getSnapshot().payload, null);
  await f.model.submit(payload()); assert.equal(f.calls.length, 1, 'submit alone cannot revive disposal');
  old.resolve(receipt(f.calls[0].body)); await oldSubmit; assert.equal(notices, before); assert.equal(f.model.getSnapshot().state, 'IDLE');
  f.model.subscribe(() => { notices++; }); f.model.syncIdentity();
  const newSubmit = f.model.submit(payload()); fresh.resolve(receipt(f.calls[1].body)); await newSubmit;
  assert.equal(f.model.getSnapshot().state, 'APPLIED'); assert.ok(notices > before);
});
