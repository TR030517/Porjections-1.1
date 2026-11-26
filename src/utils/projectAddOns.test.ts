import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectAddOnAttempt, buildProjectAddOnPayload, projectAddOnDraft, projectAddOnPath, verifyProjectAddOnReceipt } from './projectAddOns';
import { ApiError } from '../api/session';

const draft = () => ({ name: 'Synthetic oil', description: 'Synthetic extra', price: '10.25', sortOrder: '0', isActive: true });
const payload = () => buildProjectAddOnPayload(draft());
test('add-on payload accepts explicit zero USD and preserves independent enable/sort without resource or collection fields', () => {
  assert.deepEqual(buildProjectAddOnPayload({ ...draft(), price: '0', isActive: false, description: '' }), { name: 'Synthetic oil', description: null, priceCents: 0, currency: 'usd', sortOrder: 0, isActive: false });
  for (const price of ['', '-1', '1e2', '1.001', '1,00', '100000.01']) assert.throws(() => buildProjectAddOnPayload({ ...draft(), price }));
  assert.throws(() => buildProjectAddOnPayload({ ...draft(), name: '<b>Oil</b>' }));
  assert.throws(() => buildProjectAddOnPayload({ ...draft(), sortOrder: '1.5' }));
  assert.equal(projectAddOnDraft().isActive, false, 'creating an extra never implicitly starts offering it');
});
test('add-on paths retain exact large IDs; successful receipts must acknowledge parent/ID and every submitted field', () => {
  assert.equal(projectAddOnPath('9007199254740993', '9007199254740995', '9007199254740997'), '/reservation-admin/shops/9007199254740993/add-ons/9007199254740997');
  assert.throws(() => projectAddOnPath(9007199254740992, '5'));
  const saved = { item: { id: '8', serviceId: '5', ...payload() } };
  assert.equal(verifyProjectAddOnReceipt(saved, '5', payload(), '8').id, '8');
  for (const item of [{ ...saved.item, id: '9' }, { ...saved.item, serviceId: '6' }, { ...saved.item, priceCents: 1 }, { ...saved.item, isActive: false }, { ...saved.item, currency: 'eur' }]) assert.throws(() => verifyProjectAddOnReceipt({ item }, '5', payload(), '8'));
});
test('beforeWrite false or an expired scope never dispatches a POST even with a valid own draft', async () => {
  const attempt = new ProjectAddOnAttempt(); let requests = 0;
  const send = async () => { requests++; return {}; };
  assert.equal(await attempt.save({ shopId: '2', serviceId: '5', payload: payload(), current: () => true, beforeWrite: () => false, send }), null);
  assert.equal(await attempt.save({ shopId: '2', serviceId: '5', payload: payload(), current: () => false, beforeWrite: () => true, send }), null);
  assert.equal(requests, 0); assert.equal(attempt.state, 'IDLE');
});
test('a pending dispatch cannot be duplicated, and only an exact acknowledgment returns to editable idle state', async () => {
  const attempt = new ProjectAddOnAttempt(); let resolve!: (value: unknown) => void, requests = 0;
  const input = { shopId: '2', serviceId: '5', payload: payload(), current: () => true, beforeWrite: () => true, send: async () => { requests++; return new Promise(done => { resolve = done; }); } };
  const pending = attempt.save(input); assert.equal(attempt.state, 'BUSY');
  await assert.rejects(attempt.save(input), /不能重复/); assert.equal(requests, 1);
  resolve({ item: { id: '8', serviceId: '5', ...payload() } });
  assert.equal((await pending)?.id, '8'); assert.equal(attempt.state, 'IDLE');
});
test('mismatched acknowledgment, network loss and server errors become unknown and permanently block repeat create attempts', async () => {
  for (const send of [async () => ({ item: { id: '8', serviceId: 'other', ...payload() } }), async () => { throw new ApiError('Lost response'); }, async () => { throw new ApiError('Server failed', 500); }]) {
    const attempt = new ProjectAddOnAttempt(); let requests = 0;
    const input = { shopId: '2', serviceId: '5', payload: payload(), current: () => true, beforeWrite: () => true, send: async () => { requests++; return send(); } };
    await assert.rejects(attempt.save(input)); assert.equal(attempt.state, 'UNKNOWN');
    await assert.rejects(attempt.save(input), /不能重复/); assert.equal(requests, 1);
  }
});
test('explicit server conflict remains correctable while a late response from an old actor/project is never applied', async () => {
  const rejected = new ProjectAddOnAttempt();
  await assert.rejects(rejected.save({ shopId: '2', serviceId: '5', payload: payload(), current: () => true, beforeWrite: () => true, send: async () => { throw new ApiError('Future conflict', 409); } }));
  assert.equal(rejected.state, 'IDLE');
  const late = new ProjectAddOnAttempt(); let current = true;
  const result = await late.save({ shopId: '2', serviceId: '5', payload: payload(), current: () => current, beforeWrite: () => true, send: async () => { current = false; return { item: { id: '8', serviceId: '5', ...payload() } }; } });
  assert.equal(result, null); assert.equal(late.state, 'UNKNOWN');
});
