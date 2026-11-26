import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStoreTechnician, getStoreTechnicians, getTechnicianServices, getTechnicianStore, updateStoreTechnician } from './storeTechnicians';
import { technicianPayload, createTechnicianContextGuard, createTechnicianCreateFence, verifyTechnicianReceipt } from '../utils/storeTechniciansModel';

const draft = { name: 'Synthetic therapist', bio: 'Original note', status: 'ACTIVE' as const, serviceIds: ['9', '10'] };
const technician = (patch = {}) => ({ id: '8', shopId: '5', ...draft, ...patch });
const page = (items: unknown[], patch = {}) => ({ items, total: items.length, page: 1, pageSize: 25, ...patch });

test('missing or invalid current shop blocks store/technician/service reads and create before any request', async () => {
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No unscoped request permitted'); };
  try {
    for (const shop of [null, undefined, '', '0', '01', 9007199254740992]) {
      await assert.rejects(getTechnicianStore(shop)); await assert.rejects(getStoreTechnicians(shop, { page: 1 })); await assert.rejects(getTechnicianServices(shop));
      assert.throws(() => technicianPayload(draft, shop, true));
    }
    await assert.rejects(createStoreTechnician('5', { ...draft, shopId: '6' })); assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});

test('store verification requires the exact requested parent and never silently selects a different store', async () => {
  const old = globalThis.fetch; let wrong = false;
  globalThis.fetch = async url => { assert.match(String(url), /\/studio\/stores\?.*shopId=5.*pageSize=1|\/studio\/stores\?.*pageSize=1.*shopId=5/); return Response.json(page([{ id: wrong ? '6' : '5', name: 'A店' }], { pageSize: 1 })); };
  try { assert.deepEqual(await getTechnicianStore('5'), { id: '5', name: 'A店' }); wrong = true; await assert.rejects(getTechnicianStore('5'), /不会改为其它门店/); }
  finally { globalThis.fetch = old; }
});

test('technician pagination and directory reads carry only the selected shop and reject foreign rows', async () => {
  const old = globalThis.fetch, calls: string[] = []; let foreign = false;
  globalThis.fetch = async url => {
    calls.push(String(url));
    return Response.json(String(url).includes('/services?') ? page([{ id: '9', shopId: foreign ? '6' : '5', name: 'Body massage', durationMin: 60, isActive: true }], { pageSize: 100 }) : page([technician({ shopId: foreign ? '6' : '5' })]));
  };
  try {
    assert.equal((await getStoreTechnicians('5', { page: 1, search: 'Synthetic', status: 'ACTIVE' })).items[0].shopId, '5');
    assert.deepEqual(await getTechnicianServices('5'), [{ id: '9', name: 'Body massage', isActive: true }]);
    assert.ok(calls.every(url => new URL(url, 'http://localhost').searchParams.get('shopId') === '5'));
    foreign = true; await assert.rejects(getStoreTechnicians('5', { page: 1 }), /不属于当前门店/); await assert.rejects(getTechnicianServices('5'), /其它门店/);
  } finally { globalThis.fetch = old; }
});

test('create fixes parent once and edits never send a change of shop; receipts must preserve the exact service set and status', async () => {
  const old = globalThis.fetch, calls: Array<{ method: string; body: any }> = []; let wrong = false;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body)); calls.push({ method: options!.method!, body });
    return Response.json({ item: technician({ ...body, shopId: '5', serviceIds: ['10', '9'], name: wrong ? 'Unexpected renamed technician' : body.name }) });
  };
  try {
    const create = technicianPayload(draft, '5', true); await createStoreTechnician('5', create);
    const edit = technicianPayload(draft, '5', false); await updateStoreTechnician('5', '8', edit);
    assert.equal(calls[0].body.shopId, '5'); assert.equal(Object.hasOwn(calls[1].body, 'shopId'), false);
    assert.ok(calls.every(call => !Object.hasOwn(call.body, 'serviceIds')), 'staff writes do not configure per-project qualifications');
    wrong = true; await assert.rejects(createStoreTechnician('5', create), /回执/); await assert.rejects(updateStoreTechnician('5', '8', edit), /回执/);
  } finally { globalThis.fetch = old; }
});

test('a bad successful create enters UNKNOWN and reading an empty current-shop list cannot enable another create', async () => {
  const old = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = async (_url, options) => { calls.push(options?.method ?? 'GET'); return Response.json(options?.method === 'POST' ? { item: technician({ shopId: '6' }) } : page([])); };
  const model = createTechnicianCreateFence({ currentIdentity: () => ({ actorId: '1', shopId: '5' }), create: createStoreTechnician, verify: verifyTechnicianReceipt }); model.syncIdentity();
  try {
    const payload = technicianPayload(draft, '5', true); await model.submit(payload); assert.equal(model.getSnapshot().state, 'UNKNOWN');
    assert.equal((await getStoreTechnicians('5', { page: 1 })).items.length, 0); await model.submit(payload); assert.deepEqual(calls, ['POST', 'GET']); assert.equal(model.finish(), false);
  } finally { model.dispose(); globalThis.fetch = old; }
});

test('a store switch synchronously rejects a late old read even before React effect cleanup', async () => {
  let selected = '5', resolve!: (value: Response) => void;
  const old = globalThis.fetch; globalThis.fetch = () => new Promise<Response>(done => { resolve = done; });
  const guard = createTechnicianContextGuard(() => ({ actorId: '1', shopId: selected })); guard.sync(); const ticket = guard.capture()!;
  try {
    const request = getStoreTechnicians('5', { page: 1 }); selected = '6';
    resolve(Response.json(page([technician()]))); const result = await request;
    assert.equal(result.items[0].shopId, '5'); assert.equal(ticket.current(), false);
    const next = guard.capture()!; assert.equal(next.current(), true); ticket.finish(); assert.equal(next.current(), true);
  } finally { guard.dispose(); globalThis.fetch = old; }
});
