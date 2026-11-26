import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, api, client, createStaffingEditor, StaffingCountPanel, TechnicianCards, technicianProfilePayload;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('./', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  api = await server.ssrLoadModule('/src/api/staffCount.ts');
  client = (await server.ssrLoadModule('/src/api/client.ts')).default;
  ({ createStaffingEditor } = await server.ssrLoadModule('/src/utils/staffingEditor.ts'));
  ({ StaffingCountPanel, TechnicianCards, technicianProfilePayload } = await server.ssrLoadModule('/src/pages/technicians/index.tsx'));
});
after(async () => { await server?.close(); });

const shopId = '9007199254740997', staffId = '9007199254740999', actorId = '31';
const firstRevision = 'a'.repeat(64), nextRevision = 'b'.repeat(64);
const member = (id, name, patch = {}) => ({ id, shopId, name, avatarUrl: null, title: null, bio: null,
  yearsExp: 0, gender: null, isActive: true, scheduleMode: 'SHOP', sortOrder: 0, ...patch });
const custom = () => member(staffId, 'Saved personal name', { avatarUrl: 'https://example.invalid/portrait.webp', title: 'Saved title',
  bio: 'Saved personal introduction', yearsExp: 12, gender: 'FEMALE', scheduleMode: 'CUSTOM' });
const snapshot = (patch = {}) => ({ shopId, activeCount: 2, revision: firstRevision, serviceAccessMode: 'SHOP_ALL',
  canManageStaff: true, canManageExceptions: false, therapists: [custom(), member('9007199254741000', 'Therapist 2')], ...patch });
const expanded = () => snapshot({ activeCount: 4, revision: nextRevision,
  therapists: [...snapshot().therapists, member('9007199254741001', 'Therapist 3'), member('9007199254741002', 'Therapist 4')] });
const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function editorFixture() {
  let identity = { actorId, shopId }, canWrite = true;
  const editor = createStaffingEditor({ identity: () => identity, canWrite: () => canWrite, read: api.getStaffing, write: api.setStaffing });
  editor.syncIdentity();
  return { editor, identity: value => { identity = value; editor.dispose(); editor.syncIdentity(); }, permit: value => { canWrite = value; } };
}

test('staffing uses exact shop scope, cancellation, a single target-and-version PATCH and no per-person writes', async () => {
  const previous = client.defaults.adapter, calls = [], signal = new AbortController().signal;
  client.defaults.adapter = async config => { calls.push(config); return response(config, config.method === 'get' ? snapshot() : expanded()); };
  try {
    const raw = await api.getStaffing(shopId, signal);
    assert.equal(raw.shopId, shopId); assert.equal(calls[0].signal, signal); assert.equal(calls[0].headers['Cache-Control'], 'no-cache');
    const body = { targetActiveCount: 4, expectedRevision: firstRevision }, copy = structuredClone(body);
    await api.setStaffing(shopId, body);
    assert.deepEqual(body, copy); assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `/reservation-admin/shops/${shopId}/staffing`);
    assert.equal(calls[1].method, 'patch'); assert.equal(calls[1].url, calls[0].url); assert.deepEqual(JSON.parse(calls[1].data), copy);
    await assert.rejects(api.getStaffing('0')); await assert.rejects(api.setStaffing(shopId, { targetActiveCount: 2.5, expectedRevision: firstRevision }));
    assert.equal(calls.length, 2, 'invalid identity/count never reaches a transport');
  } finally { client.defaults.adapter = previous; }
});

test('a lost committed count reply freezes the original attempt; explicit read-back neither retries nor changes custom profiles', async () => {
  const previous = client.defaults.adapter, calls = [], f = editorFixture(); let saved = snapshot();
  client.defaults.adapter = async config => {
    calls.push({ method: config.method, body: config.data && JSON.parse(config.data) });
    if (config.method === 'patch') { saved = expanded(); throw new Error('Synthetic lost acknowledgement'); }
    return response(config, saved);
  };
  try {
    await f.editor.load(); f.editor.changeTarget(4); await f.editor.save();
    assert.equal(f.editor.getSnapshot().outcome, 'UNKNOWN');
    const original = f.editor.getSnapshot().attempt; assert.deepEqual(original, { targetActiveCount: 4, expectedRevision: firstRevision });
    f.editor.changeTarget(9); await f.editor.save(); assert.equal(f.editor.getSnapshot().target, 4);
    assert.equal(f.editor.acknowledgeReview(), false);
    await f.editor.load();
    assert.equal(f.editor.getSnapshot().outcome, 'UNKNOWN'); assert.equal(f.editor.getSnapshot().attempt, original);
    assert.equal(f.editor.getSnapshot().reviewed, true); assert.equal(f.editor.getSnapshot().snapshot.activeCount, 4);
    assert.deepEqual(f.editor.getSnapshot().snapshot.therapists[0], custom());
    await f.editor.save(); assert.equal(calls.filter(call => call.method === 'patch').length, 1);
    assert.equal(f.editor.acknowledgeReview(), true); await f.editor.save();
    assert.equal(calls.filter(call => call.method === 'patch').length, 1, 'acknowledgement is not another personnel command');
  } finally { f.editor.dispose(); client.defaults.adapter = previous; }
});

test('an empty shop can establish its first team by saving only a count and version, without individual profile fields', async () => {
  const previous = client.defaults.adapter, writes = [], f = editorFixture();
  client.defaults.adapter = async config => {
    if (config.method === 'get') return response(config, snapshot({ activeCount: 0, therapists: [] }));
    writes.push(JSON.parse(config.data));
    return response(config, snapshot({ revision: nextRevision, therapists: [member(staffId, 'Therapist 1'), member('9007199254741000', 'Therapist 2')], createdIds: [staffId, '9007199254741000'], deactivatedIds: [] }));
  };
  try {
    await f.editor.load(); assert.equal(f.editor.getSnapshot().target, 0);
    f.editor.changeTarget(2); await f.editor.save();
    assert.deepEqual(writes, [{ targetActiveCount: 2, expectedRevision: firstRevision }]);
    assert.equal(f.editor.getSnapshot().outcome, 'SAVED'); assert.equal(f.editor.getSnapshot().snapshot.activeCount, 2);
    assert.deepEqual(f.editor.getSnapshot().snapshot.therapists.map(person => [person.name, person.scheduleMode]), [['Therapist 1', 'SHOP'], ['Therapist 2', 'SHOP']]);
  } finally { f.editor.dispose(); client.defaults.adapter = previous; }
});

test('collection CAS conflict preserves the target and needs explicit read plus acknowledgement before using a fresh version', async () => {
  const previous = client.defaults.adapter, calls = [], f = editorFixture(); let changed = false;
  const fresh = snapshot({ revision: nextRevision });
  client.defaults.adapter = async config => {
    if (config.method === 'get') return response(config, changed ? fresh : snapshot());
    const body = JSON.parse(config.data); calls.push(body);
    if (!changed) { changed = true; throw { response: { status: 409, data: { code: 'STAFFING_CHANGED', message: '人员已变更' } } }; }
    return response(config, { ...expanded(), revision: 'c'.repeat(64) });
  };
  try {
    await f.editor.load(); f.editor.changeTarget(4); await f.editor.save();
    assert.equal(f.editor.getSnapshot().outcome, 'CONFLICT'); await f.editor.load();
    assert.equal(f.editor.getSnapshot().target, 4); assert.equal(f.editor.getSnapshot().snapshot.revision, nextRevision);
    await f.editor.save(); assert.equal(calls.length, 1);
    assert.equal(f.editor.acknowledgeReview(), true); await f.editor.save();
    assert.deepEqual(calls, [{ targetActiveCount: 4, expectedRevision: firstRevision }, { targetActiveCount: 4, expectedRevision: nextRevision }]);
    assert.equal(f.editor.getSnapshot().outcome, 'SAVED');
    assert.equal(f.editor.getSnapshot().snapshot.revision, 'c'.repeat(64));
  } finally { f.editor.dispose(); client.defaults.adapter = previous; }
});

test('a busy reduction is a definite rejection and does not locally deactivate, rename or reset anybody', async () => {
  const previous = client.defaults.adapter, writes = [], f = editorFixture(), original = snapshot();
  client.defaults.adapter = async config => {
    if (config.method === 'get') return response(config, original);
    writes.push(JSON.parse(config.data));
    throw { response: { status: 409, data: { code: 'STAFFING_BUSY', message: 'Saved personal name仍有有效预约，本次整批未改', fields: { [staffId]: '仍有有效预约' } } } };
  };
  try {
    await f.editor.load(); f.editor.changeTarget(1); await f.editor.save();
    assert.equal(f.editor.getSnapshot().outcome, 'NONE'); assert.match(f.editor.getSnapshot().error, /有效预约/);
    assert.deepEqual(f.editor.getSnapshot().snapshot, original); assert.equal(f.editor.getSnapshot().target, 1);
    assert.deepEqual(writes, [{ targetActiveCount: 1, expectedRevision: firstRevision }]);
  } finally { f.editor.dispose(); client.defaults.adapter = previous; }
});

test('one synchronous save fence blocks duplicate clicks and temporary permission loss cannot rotate its command', async () => {
  const previous = client.defaults.adapter, waiting = deferred(), calls = [], f = editorFixture();
  client.defaults.adapter = async config => {
    if (config.method === 'get') return response(config, snapshot());
    calls.push(JSON.parse(config.data)); return response(config, await waiting.promise);
  };
  try {
    await f.editor.load(); f.editor.changeTarget(4);
    const first = f.editor.save(); await f.editor.save(); f.permit(false); f.editor.syncIdentity(); await f.editor.save();
    assert.equal(f.editor.getSnapshot().saving, true); waiting.resolve(expanded()); await first;
    assert.equal(calls.length, 1); assert.equal(f.editor.getSnapshot().outcome, 'SAVED');
    f.editor.changeTarget(5); await f.editor.save(); assert.equal(calls.length, 1);
  } finally { f.editor.dispose(); client.defaults.adapter = previous; }
});

test('actor, shop and logout changes ignore the old count result and cannot put old staff into a fresh context', async () => {
  const previous = client.defaults.adapter;
  try {
    for (const identity of [{ actorId: '32', shopId }, { actorId, shopId: '8' }, null]) {
      const waiting = deferred(), entered = deferred(), f = editorFixture();
      const observed = [], unsubscribe = f.editor.subscribe(() => observed.push(f.editor.getSnapshot()));
      client.defaults.adapter = async config => {
        if (config.method === 'get') return response(config, snapshot());
        entered.resolve(); return response(config, await waiting.promise);
      };
      await f.editor.load(); f.editor.changeTarget(4); const pending = f.editor.save(); await entered.promise;
      f.identity(identity); waiting.resolve(expanded()); await pending;
      assert.equal(f.editor.getSnapshot().snapshot, null); assert.equal(f.editor.getSnapshot().attempt, null); assert.equal(f.editor.getSnapshot().target, null);
      assert.equal(observed.at(-1).snapshot, null, 'a mounted page remains subscribed through context cleanup and receives the cleared new context');
      unsubscribe(); f.editor.dispose();
    }
  } finally { client.defaults.adapter = previous; }
});

test('foreign or malformed successful receipts stay unknown, and RES-only read capability never grants count writes', async () => {
  const previous = client.defaults.adapter;
  try {
    for (const bad of [expanded => ({ ...expanded, shopId: '8' }), expanded => ({ ...expanded, activeCount: 3 }), () => null]) {
      let writes = 0; const f = editorFixture();
      client.defaults.adapter = async config => { if (config.method === 'get') return response(config, snapshot()); writes++; return response(config, bad(expanded())); };
      await f.editor.load(); f.editor.changeTarget(4); await f.editor.save();
      assert.equal(f.editor.getSnapshot().outcome, 'UNKNOWN'); await f.editor.save(); assert.equal(writes, 1); f.editor.dispose();
    }
    let writes = 0; const f = editorFixture();
    client.defaults.adapter = async config => { if (config.method !== 'get') writes++; return response(config, snapshot({ canManageStaff: false, canManageExceptions: true })); };
    await f.editor.load(); f.editor.changeTarget(4); await f.editor.save();
    assert.equal(writes, 0); assert.equal(f.editor.getSnapshot().snapshot.canManageExceptions, true); f.editor.dispose();
  } finally { client.defaults.adapter = previous; }
});

test('default count UI needs one number, and optional person cards show names and preserved custom mode without IDs', () => {
  const state = { snapshot: snapshot(), target: 4, loading: false, saving: false, verified: true, outcome: 'NONE', reviewed: false, attempt: null, error: '' };
  const panel = renderToStaticMarkup(createElement(StaffingCountPanel, { state, disabled: false, onChange() {}, onSave() {}, onRead() {}, onReviewed() {} }));
  assert.match(panel, /在岗人数/); assert.match(panel, /保存人数/); assert.match(panel, /跟随门店营业时间/);
  assert.doesNotMatch(panel, /姓名|头像地址|serviceIds|排班与请假|900719925474/);
  assert.doesNotMatch(panel, />新增技师<\//);
  const cards = renderToStaticMarkup(createElement(TechnicianCards, { staff: snapshot().therapists, disabled: false, onEdit() {} }));
  assert.match(cards, /Saved personal name/); assert.match(cards, /2号技师/); assert.match(cards, /保留个人工作时间/);
  assert.doesNotMatch(cards, /900719925474|<table|资格|服务编号/);
  const readOnly = renderToStaticMarkup(createElement(StaffingCountPanel, { state: { ...state, snapshot: snapshot({ canManageStaff: false, canManageExceptions: true }) }, disabled: false, onChange() {}, onSave() {}, onRead() {}, onReviewed() {} }));
  assert.doesNotMatch(readOnly, /保存人数/); assert.match(readOnly, /可查看人员/);
});

test('editing only a name does not send hidden existing profile fields, schedule mode, status or service links', () => {
  const person = custom(), original = structuredClone(person);
  assert.deepEqual(technicianProfilePayload(person, { name: 'Explicitly changed name' }), { name: 'Explicitly changed name' });
  assert.deepEqual(technicianProfilePayload(person, { name: person.name, title: person.title, bio: person.bio, avatar: person.avatarUrl,
    gender: person.gender, yearsExp: person.yearsExp, isActive: person.isActive }), { name: person.name });
  assert.deepEqual(technicianProfilePayload(person, { name: person.name, isActive: false, bio: 'Explicit new intro' }), { name: person.name, bio: 'Explicit new intro', isActive: false });
  assert.deepEqual(person, original);
});
