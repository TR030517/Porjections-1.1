import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';
let vite, helper, client, api, createServiceCreateFence;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  helper = await vite.ssrLoadModule('/src/utils/serviceMenuDraft.ts');
  client = (await vite.ssrLoadModule('/src/api/client.ts')).default;
  api = await vite.ssrLoadModule('/src/api/merchant.ts');
  ({ createServiceCreateFence } = await vite.ssrLoadModule('/src/utils/serviceCreateFence.ts'));
});
after(async () => { await vite?.close(); });
const item = (kind = 'TIMED', priceCents = 8850, durationMin = 60) => ({ name: 'Complete manually checked title', priceText: '', description: 'Original exact wording', pricing: { kind, baseName: 'Original base', priceCents, durationMin: kind === 'TIMED' ? durationMin : null, titleMode: 'CUSTOM' } });
const menu = value => [{ category: 'MASSAGE', items: [value] }];
const savedPayload = { name: 'Checked name', category: 'OTHER', description: 'Exact description', durationKind: 'PER_SESSION', durationMin: 90, priceCents: 8000, isActive: false };
const receipt = () => ({ ...savedPayload, id: '9007199254740993', shopId: '5', reservedDurationMin: 90 });

test('explicit cents including zero and both integer booking duration boundaries are reused without guessing or changing source', () => {
  for (const cents of [0, 1, 1999, 8850, 99999999]) for (const durationMin of [5, 29, 240]) {
    const source = menu(item('TIMED', cents, durationMin)), before = structuredClone(source), plan = helper.planServiceDraftFromMenu(source, 0, 0);
    assert.equal(helper.servicePriceCents(plan.draft.price), cents); assert.equal(plan.draft.durationMin, durationMin); assert.equal(plan.draft.category, undefined); assert.equal(plan.draft.isActive, false);
    assert.equal(plan.review.reusedPrice, true); assert.equal(plan.review.reusedDuration, true); assert.deepEqual(source, before);
    assert.equal(plan.review.notices.some(value => value.includes('基础零价目前不能直接预约')), cents === 0);
  }
});

test('valid display-only minutes outside booking bounds stay blank while explicit money is retained; session and variable never invent blocks', () => {
  for (const durationMin of [1, 4, 241, 1440]) {
    const plan = helper.planServiceDraftFromMenu(menu(item('TIMED', 8100, durationMin)), 0, 0);
    assert.equal(plan.draft.durationMin, null); assert.equal(plan.draft.price, 81); assert.equal(plan.review.sourceDurationMin, durationMin); assert.match(plan.review.notices.join(' '), new RegExp(String(durationMin))); assert.equal(plan.review.reusedDuration, false);
  }
  for (const kind of ['PER_SESSION', 'VARIABLE']) {
    const plan = helper.planServiceDraftFromMenu(menu(item(kind, 0)), 0, 0);
    assert.equal(plan.draft.durationKind, kind); assert.equal(plan.draft.durationMin, null); assert.equal(plan.draft.price, 0); assert.match(plan.review.notices.join(' '), /预留分钟/);
  }
});

test('legacy wording stays textual, dependent extras and invalid metadata reject atomically, and complete long names are never truncated', () => {
  const legacy = helper.planServiceDraftFromMenu(menu({ name: '60min $80', description: 'Original', priceText: '$80 / 60 min' }), 0, 0);
  assert.equal(legacy.draft.price, null); assert.equal(legacy.draft.durationMin, null); assert.equal(legacy.review.structured, false);
  assert.throws(() => helper.planServiceDraftFromMenu(menu(item('ADD_ON')), 0, 0), /不能独立/);
  for (const patch of [{ priceCents: null }, { priceCents: 1.5 }, { priceCents: 100000000 }, { durationMin: 0 }, { durationMin: 1441 }, { kind: 'UNKNOWN' }, { account: 'unexpected' }]) {
    const value = item(); Object.assign(value.pricing, patch); assert.throws(() => helper.planServiceDraftFromMenu(menu(value), 0, 0), /未替换当前草稿/);
  }
  const long = item(); long.name = 'Long '.repeat(60);
  const plan = helper.planServiceDraftFromMenu(menu(long), 0, 0); assert.equal(plan.draft.name, long.name);
  assert.throws(() => helper.serviceSavePayload({ ...plan.draft, category: 'OTHER' }, 'MENU'), /200 字/);
});

test('declining dirty replacement or losing identity preserves the prior draft, and changing saved source during confirmation rejects it', async () => {
  let current = menu(item()), confirmations = 0;
  const previous = { name: 'Keep my draft', price: 25 }, options = { dirty: true, confirmReplace: async () => { confirmations++; return false; }, currentMenu: () => current, current: () => true };
  const declined = await helper.prepareServiceMenuCarry(current, 0, 0, options); assert.equal(declined, null); assert.equal(confirmations, 1); assert.deepEqual(previous, { name: 'Keep my draft', price: 25 });
  assert.equal(await helper.prepareServiceMenuCarry(current, 0, 0, { ...options, dirty: false, current: () => false }), null);
  const initial = current;
  await assert.rejects(helper.prepareServiceMenuCarry(initial, 0, 0, { ...options, confirmReplace: async () => { current = menu(item('TIMED', 9000)); return true; } }), /价目.*变化/);
  assert.deepEqual(previous, { name: 'Keep my draft', price: 25 });
});

test('review distinguishes the current reused values from manual edits and never injects review or source metadata into API fields', () => {
  const plan = helper.planServiceDraftFromMenu(menu(item()), 0, 0);
  const original = helper.serviceMenuReuseSummary(plan.review, plan.draft).join(' '); assert.match(original, /金额已复用.*88.50/); assert.match(original, /固定分钟已复用.*60/); assert.match(original, /分类待人工/);
  const edited = helper.serviceMenuReuseSummary(plan.review, { ...plan.draft, price: 90, durationMin: 120, category: 'OTHER' }).join(' '); assert.match(edited, /金额或类型已人工修改/); assert.match(edited, /分钟或类型已人工修改/); assert.doesNotMatch(edited, /金额已复用|固定分钟已复用/);
  const payload = helper.serviceSavePayload({ ...plan.draft, category: 'OTHER', review: plan.review, pricing: item().pricing }, 'MENU');
  assert.equal(payload.priceCents, 8850); assert.equal(payload.durationMin, 60); assert.equal(payload.isActive, false);
  assert.deepEqual(Object.keys(payload).sort(), ['category', 'description', 'durationKind', 'durationMin', 'isActive', 'name', 'priceCents']);
});

test('a trusted creation receipt must match every submitted core field and permits only empty-description null normalization', () => {
  helper.assertServiceCreateReceipt(receipt(), '5', savedPayload);
  for (const patch of [{ id: 51 }, { id: '0' }, { id: '9223372036854775808' }, { shopId: '6' }, { name: 'Other name' }, { category: 'MASSAGE' }, { description: 'Exact description ' }, { priceCents: 8001 }, { isActive: true }, { durationKind: 'TIMED' }, { durationMin: 60 }, { reservedDurationMin: 60 }]) {
    assert.throws(() => helper.assertServiceCreateReceipt({ ...receipt(), ...patch }, '5', savedPayload));
  }
  for (const description of [null, undefined, '']) helper.assertServiceCreateReceipt({ ...receipt(), description }, '5', { ...savedPayload, description: '' });
});

test('real create transport keeps reused cents exact with one disabled POST and cannot launder a numeric response ID into a trusted string', async () => {
  const old = client.defaults.adapter, calls = []; let numericId = false;
  client.defaults.adapter = async config => {
    const body = JSON.parse(config.data); calls.push({ method: config.method, body });
    return { config, data: { ...body, id: numericId ? 51 : '51', shopId: '5', reservedDurationMin: body.durationMin }, status: 201, statusText: 'Created', headers: {} };
  };
  try {
    const draft = helper.serviceDraftFromMenu(menu(item('TIMED', 1, 30)), 0, 0), payload = helper.serviceSavePayload({ ...draft, category: 'OTHER' }, 'MENU');
    const saved = await api.createService('5', payload); helper.assertServiceCreateReceipt(saved, '5', payload);
    assert.equal(calls[0].body.priceCents, 1); assert.equal(calls[0].body.isActive, false); assert.equal(calls[0].method, 'post');
    numericId = true; await assert.rejects(api.createService('5', payload), /结果未知/); assert.equal(calls.length, 2);
  } finally { client.defaults.adapter = old; }
});

test('a real successful response with the wrong amount becomes UNKNOWN and an empty read-only list cannot unlock another POST', async () => {
  const old = client.defaults.adapter, calls = [];
  client.defaults.adapter = async config => {
    calls.push(config.method);
    const data = config.method === 'get' ? [] : { ...JSON.parse(config.data), id: '51', shopId: '5', priceCents: 8001, reservedDurationMin: 90 };
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  const model = createServiceCreateFence({ currentIdentity: () => ({ actorId: '1', shopId: '5' }), create: api.createService, verify: helper.assertServiceCreateReceipt });
  model.syncIdentity();
  try {
    await model.submit(savedPayload); assert.equal(model.getSnapshot().state, 'UNKNOWN');
    assert.deepEqual(await api.getShopServices('5'), []); assert.equal(model.getSnapshot().state, 'UNKNOWN');
    await model.submit({ ...savedPayload, priceCents: 9000 }); assert.deepEqual(calls, ['post', 'get']);
    assert.equal(model.getSnapshot().payload.priceCents, 8000); assert.equal(model.finish(), false);
  } finally { model.dispose(); client.defaults.adapter = old; }
});

test('a new TIMED success must carry its raw type explicitly before legacy read normalization and stays UNKNOWN without resubmission when it is missing', async () => {
  const old = client.defaults.adapter;
  const payload = { ...savedPayload, durationKind: 'TIMED' };
  const missing = { ...receipt(), durationKind: 'TIMED' }; delete missing.durationKind;
  assert.throws(() => helper.assertServiceCreateReceipt(missing, '5', payload), /结果未知/);
  let calls = 0;
  client.defaults.adapter = async config => {
    calls++; const body = JSON.parse(config.data), raw = { ...body, id: '51', shopId: '5', reservedDurationMin: body.durationMin }; delete raw.durationKind;
    return { config, data: raw, status: 201, statusText: 'Created', headers: {} };
  };
  const model = createServiceCreateFence({ currentIdentity: () => ({ actorId: '1', shopId: '5' }), create: api.createService, verify: helper.assertServiceCreateReceipt });
  model.syncIdentity();
  try {
    await model.submit(payload); assert.equal(model.getSnapshot().state, 'UNKNOWN');
    await model.submit(payload); assert.equal(calls, 1); assert.equal(model.finish(), false);
  } finally { model.dispose(); client.defaults.adapter = old; }
});
