import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';

let vite, api, createModel, client;
before(async () => { vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' }); api = await vite.ssrLoadModule('/src/api/calendarActions.ts'); createModel = (await vite.ssrLoadModule('/src/pages/bookings/calendarActionModel.ts')).createCalendarActionModel; client = (await vite.ssrLoadModule('/src/api/client.ts')).default; });
after(async () => { await vite?.close(); });
const command = (extra = {}) => ({ requestKey: '11111111-1111-4111-8111-111111111111', action: 'CREATE', expectedTimezone: 'America/Los_Angeles', purpose: 'TIME_BLOCK', scope: 'SHOP', startLocal: '2035-11-10T14:00', endLocal: '2035-11-10T16:00', reason: 'Synthetic internal use', ...extra });
const receipt = (input, extra = {}) => ({ shopId: '7', requestKey: input.requestKey, action: input.action, outcome: 'COMMITTED', result: ['CLOSE_DAY', 'REOPEN_DAY'].includes(input.action) ? { blockId: null, version: null, closedDate: input.date } : { blockId: input.blockId ?? '91', version: input.expectedVersion ? input.expectedVersion + 1 : 1, closedDate: null }, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
function storage() { const entries = new Map(); return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }; }

test('strict commands accept real shop resources, cross-midnight intervals and reject DST gaps/repeats without browser-time interpretation', () => {
  assert.equal(api.validateCalendarCommand(command()).scope, 'SHOP');
  assert.equal(api.validateCalendarCommand(command({ scope: 'THERAPIST', resourceId: '12', startLocal: '2035-11-10T23:30', endLocal: '2035-11-11T00:30' })).resourceId, '12');
  for (const patch of [{ scope: 'ROOM' }, { resourceId: '12' }, { endLocal: '2035-11-10T13:00' }, { reason: '' }, { requestKey: 'wrong' }, { startLocal: '2026-03-08T02:30', endLocal: '2026-03-08T04:00' }, { startLocal: '2026-11-01T01:30', endLocal: '2026-11-01T04:00' }]) assert.throws(() => api.validateCalendarCommand(command(patch)));
});

test('reopen uses a dated CAS command and only accepts a matching processed-day receipt', () => {
  const input = { requestKey: crypto.randomUUID(), action: 'REOPEN_DAY', expectedTimezone: 'America/Los_Angeles', date: '2035-11-10', expectedSettingsHash: 'a'.repeat(64) };
  assert.equal(api.validateCalendarCommand(input).action, 'REOPEN_DAY');
  for (const patch of [{ date: '2035-02-30' }, { expectedSettingsHash: '' }]) assert.throws(() => api.validateCalendarCommand({ ...input, ...patch }));
  assert.equal(api.requireCalendarOperation(receipt(input), '7', input, true).result.closedDate, input.date);
  assert.throws(() => api.requireCalendarOperation(receipt(input, { action: 'CLOSE_DAY' }), '7', input, true));
  assert.throws(() => api.requireCalendarOperation(receipt(input, { result: { blockId: null, version: null, closedDate: '2035-11-11' } }), '7', input, true));
});

test('reopen context must identify the temporary range containing the selected day', () => {
  const input = { shopId: '7', date: '2035-11-10', timezone: 'America/Los_Angeles', settingsHash: 'a'.repeat(64), closed: true, resources: [], temporaryClosure: { startDate: '2035-11-09', endDate: '2035-11-11' } };
  assert.deepEqual(api.requireActionOptions(input, '7', input.date).temporaryClosure, input.temporaryClosure);
  for (const patch of [{ temporaryClosure: null }, { temporaryClosure: { startDate: '2035-11-11', endDate: '2035-11-12' } }, { closed: false }]) assert.throws(() => api.requireActionOptions({ ...input, ...patch }, '7', input.date));
});

test('unknown reopen survives remount and needs a matching durable receipt to unlock', async () => {
  const saved = storage(), input = { requestKey: crypto.randomUUID(), action: 'REOPEN_DAY', expectedTimezone: 'America/Los_Angeles', date: '2035-11-10', expectedSettingsHash: 'a'.repeat(64) };
  const model = createModel('1', '7', () => true, { storage: saved, submit: async () => { throw new Error('lost response'); } });
  await model.execute(input); assert.deepEqual(model.getSnapshot().pending.command, input); model.dispose();
  const resumed = createModel('1', '7', () => true, { storage: saved, reconcile: async () => receipt(input) });
  await resumed.reconcile(); assert.equal(resumed.getSnapshot().pending, null); assert.equal(resumed.getSnapshot().receipt.action, 'REOPEN_DAY'); assert.equal(saved.entries.size, 0);
});
test('operation receipt must match actor-scoped shop, key, action, target and exact CAS successor', () => {
  const input = command({ action: 'UPDATE', blockId: '91', expectedVersion: 4 });
  assert.equal(api.requireCalendarOperation(receipt(input), '7', input, true).result.version, 5);
  for (const patch of [{ shopId: '8' }, { requestKey: crypto.randomUUID() }, { action: 'RELEASE' }, { result: { blockId: '92', version: 5, closedDate: null } }, { result: { blockId: '91', version: 4, closedDate: null } }]) assert.throws(() => api.requireCalendarOperation(receipt(input, patch), '7', input, true));
  assert.equal(api.requireCalendarOperation({ shopId: '7', requestKey: input.requestKey, outcome: 'NOT_FOUND' }, '7', input, false).outcome, 'NOT_FOUND');
  assert.throws(() => api.requireCalendarOperation({ shopId: '7', requestKey: input.requestKey, outcome: 'NOT_FOUND' }, '7', input, true));
  assert.equal(api.requireCalendarOperation({ shopId: '7', requestKey: input.requestKey, outcome: 'NOT_EXECUTED' }, '7', input, false).outcome, 'NOT_EXECUTED');
});
test('private options/block parsing explicitly allowlists fields and rejects foreign target/resource shape', () => {
  const options = { shopId: '7', date: '2035-11-10', timezone: 'America/Los_Angeles', settingsHash: 'a'.repeat(64), closed: false, resources: [{ type: 'ROOM', id: '5', name: 'Synthetic room' }], customerEmail: 'hidden@example.test' };
  assert.equal('customerEmail' in api.requireActionOptions(options, '7', options.date), false);
  const block = { id: '91', shopId: '7', scope: 'SHOP', resourceId: null, purpose: 'TIME_BLOCK', startAt: '2035-11-10T22:00Z', endAt: '2035-11-11T00:00Z', timezone: options.timezone, reason: 'Synthetic reason', status: 'ACTIVE', version: 1, operator: { id: '1', name: 'Synthetic operator', email: 'hidden@example.test' }, customerEmail: 'hidden@example.test' };
  assert.equal('email' in api.requireCalendarBlock(block, '7', '91').operator, false);
  assert.equal(api.requireCalendarBlock({ ...block, operator: { id: '1', name: null } }, '7', '91').operator.name, '工作人员');
  assert.throws(() => api.requireCalendarBlock({ ...block, resourceId: '5' }, '7', '91'));
  assert.throws(() => api.requireCalendarBlock(block, '8', '91'));
});
test('actual API paths preserve request body and reconcile only through POST with empty body', async () => {
  const previous = client.defaults.adapter, calls = [], input = command();
  client.defaults.adapter = async config => { calls.push(config); return { config, status: 200, statusText: 'OK', headers: {}, data: config.url.includes('reconcile') ? { shopId: '7', requestKey: input.requestKey, outcome: 'NOT_EXECUTED' } : receipt(input) }; };
  try { await api.submitCalendarAction('7', input); await api.reconcileCalendarAction('7', input); assert.deepEqual(JSON.parse(calls[0].data), input); assert.equal(calls[1].method, 'post'); assert.equal(calls[1].url, '/reservation-admin/shops/7/calendar-actions/operations/' + input.requestKey + '/reconcile'); assert.deepEqual(JSON.parse(calls[1].data), {}); } finally { client.defaults.adapter = previous; }
});
test('double save freezes one command before network, transport failure persists across remount, definitive receipt refreshes once', async () => {
  const saved = storage(), gate = deferred(), writes = [], input = command();
  let model = createModel('1', '7', () => true, { storage: saved, submit: async (shopId, request) => { writes.push(request); return gate.promise; } });
  const write = model.execute(input); await model.execute(command({ requestKey: crypto.randomUUID() }));
  assert.equal(writes.length, 1); assert.deepEqual(writes[0], input); assert.equal(saved.entries.size, 1);
  gate.reject(new Error('lost response')); await write; assert.ok(model.getSnapshot().pending); model.dispose();
  model = createModel('1', '7', () => true, { storage: saved, reconcile: async (_shopId, request) => receipt(request) });
  assert.deepEqual(model.getSnapshot().pending.command, input); await model.reconcile();
  assert.equal(model.getSnapshot().pending, null); assert.equal(model.getSnapshot().receipt.result.blockId, '91'); assert.equal(saved.entries.size, 0);
});
test('unknown cannot be discarded or retried; NOT_EXECUTED fence permits explicit original-parameter new-key submission', async () => {
  const saved = storage(), writes = [];
  const model = createModel('1', '7', () => true, { storage: saved, submit: async (_shopId, input) => { writes.push(input); if (writes.length === 1) throw new Error('timeout'); return receipt(input); }, reconcile: async (_shopId, input) => ({ shopId: '7', requestKey: input.requestKey, outcome: 'NOT_EXECUTED' }) });
  await model.execute(command()); assert.equal(model.discard(), false); await model.retry(); assert.equal(writes.length, 1);
  await model.reconcile(); assert.equal(model.getSnapshot().pending.notExecuted, true); await model.retry();
  assert.equal(writes.length, 2); assert.notEqual(writes[1].requestKey, writes[0].requestKey); assert.deepEqual({ ...writes[1], requestKey: writes[0].requestKey }, writes[0]); assert.equal(saved.entries.size, 0);
});
test('incorrect receipt cannot release a pending command; permission/session scope changes ignore late success', async () => {
  const saved = storage(), gate = deferred(); let current = true;
  const model = createModel('1', '7', () => current, { storage: saved, submit: async () => gate.promise, reconcile: async (_shopId, input) => receipt(input, { shopId: '8' }) });
  const write = model.execute(command()); current = false; gate.resolve(receipt(command())); await write;
  assert.equal(saved.entries.size, 1); assert.ok(model.getSnapshot().pending);
  assert.equal(model.getSnapshot().busy, false, 'revoked authority keeps the unknown request while releasing the completed network lock for later authorized reconciliation');
  current = true; model.dispose();
  const resumed = createModel('1', '7', () => true, { storage: saved, reconcile: async (_shopId, input) => receipt(input, { action: 'RELEASE' }) });
  await resumed.reconcile(); assert.ok(resumed.getSnapshot().pending); assert.equal(saved.entries.size, 1);
});
test('unmounted writes retain recovery marker and corrupt saved commands fail closed instead of silently permitting a second operation', async () => {
  const saved = storage(), gate = deferred(), writes = [];
  const model = createModel('1', '7', () => true, { storage: saved, submit: async (_shopId, input) => { writes.push(input); return gate.promise; } });
  const write = model.execute(command()); model.dispose(); gate.resolve(receipt(command())); await write; assert.equal(saved.entries.size, 1);
  saved.setItem('massajoy2:calendar-action:1:7', '{broken');
  const corrupt = createModel('1', '7', () => true, { storage: saved, submit: async (_shopId, input) => { writes.push(input); return receipt(input); } });
  await corrupt.execute(command()); assert.equal(corrupt.getSnapshot().corrupt, true); assert.equal(writes.length, 1);
});
test('failure to persist prevents sending, and separate actor/shop storage never adopts another pending command', async () => {
  const saved = storage(), writes = [];
  const broken = createModel('1', '7', () => true, { storage: { ...saved, setItem() { throw new Error('blocked'); } }, submit: async (_shopId, input) => { writes.push(input); return receipt(input); } });
  await broken.execute(command()); assert.equal(writes.length, 0);
  saved.setItem('massajoy2:calendar-action:1:7', JSON.stringify({ actorId: '1', shopId: '7', command: command(), notExecuted: false }));
  assert.equal(createModel('2', '7', () => true, { storage: saved }).getSnapshot().pending, null);
  assert.equal(createModel('1', '8', () => true, { storage: saved }).getSnapshot().pending, null);
});
