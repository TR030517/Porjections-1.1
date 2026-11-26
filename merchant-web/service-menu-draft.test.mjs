import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

let server, helper;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  helper = await server.ssrLoadModule('/src/utils/serviceMenuDraft.ts');
});
after(async () => { await server?.close(); });

test('editing variant service metadata cannot resubmit an unused invalid base price or duration', () => {
  const result = helper.serviceMetadataPayload({ name: 'Four hands', category: 'MASSAGE', description: 'Same store team', isActive: false, durationMin: 15, price: NaN, durationKind: 'TIMED' });
  assert.deepEqual(result, { name: 'Four hands', category: 'MASSAGE', description: 'Same store team', isActive: false });
  assert.equal(Object.hasOwn(result, 'durationMin'), false);
  assert.equal(Object.hasOwn(result, 'priceCents'), false);
  assert.throws(() => helper.serviceMetadataPayload({ name: 'Four hands', category: 'MASSAGE', isActive: 'yes' }), /是否启用/);
});

const menu = [
  { category: 'Promotions only', items: [] },
  { category: 'Foot care', items: Array.from({ length: 43 }, (_, at) => ({ name: `Foot service ${at}`, priceText: `From $${80 + at} / ask the store`, description: `Original note ${at}`, imageUrl: 'https://example.test/image.jpg' })) },
  { category: 'Body massage', items: [{ name: 'Foot service 25', priceText: 'Call for price', description: 'Different original item' }] },
];
const values = { name: 'Manually checked service', description: 'Original wording', category: 'OTHER', durationMin: 60, price: 88.5 };

test('saved-menu search and bounded pages retain original coordinates without dropping or changing hidden items', () => {
  const before = structuredClone(menu);
  const page = helper.serviceMenuPage(menu, 1, '', 1);
  assert.equal(page.total, 43); assert.equal(page.pages, 3); assert.equal(page.items.length, 20);
  assert.deepEqual(page.items.map(item => [item.groupIndex, item.itemIndex]), Array.from({ length: 20 }, (_, at) => [1, at + 20]));
  const searched = helper.serviceMenuPage(menu, null, 'Foot service 25', 999);
  assert.equal(searched.page, 0);
  assert.deepEqual(searched.items.map(item => [item.groupIndex, item.itemIndex]), [[1, 25], [2, 0]]);
  const draft = helper.serviceDraftFromMenu(menu, searched.items[1].groupIndex, searched.items[1].itemIndex);
  assert.equal(draft.description, 'Different original item');
  assert.equal(helper.serviceMenuPage(menu, 0, '', 0).total, 0, 'empty promotional groups remain selectable without inventing services');
  assert.deepEqual(menu, before);
});

test('carrying a saved item copies only wording and explicitly clears manual classification, price and duration', () => {
  const original = structuredClone(menu);
  const draft = helper.serviceDraftFromMenu(menu, 1, 25);
  assert.deepEqual(draft, { name: 'Foot service 25', description: 'Original note 25', durationKind: 'TIMED', category: undefined, price: null, durationMin: null, isActive: false });
  for (const field of ['priceText', 'imageUrl', 'participantCount', 'capacity', 'variants', 'serviceId', 'priceBasis']) assert.equal(Object.hasOwn(draft, field), false);
  assert.throws(() => helper.serviceSavePayload(draft, 'MENU'), /分类/);
  assert.throws(() => helper.serviceSavePayload({ ...draft, category: 'OTHER' }, 'MENU'), /时长/);
  assert.throws(() => helper.serviceSavePayload({ ...draft, category: 'OTHER', durationMin: 60 }, 'MENU'), /价格/);
  assert.deepEqual(menu, original);
});

test('invalid or stale source coordinates never fall back to a different item', () => {
  for (const pair of [[-1, 0], [1, -1], [1.5, 0], [99, 0], [0, 0], [1, 99]]) assert.throws(() => helper.serviceDraftFromMenu(menu, ...pair), /不可用/);
});

test('long source names remain complete and cannot be saved until manually corrected', () => {
  const long = 'Source '.repeat(40);
  const draft = helper.serviceDraftFromMenu([{ category: 'Original', items: [{ name: long, priceText: '$90' }] }], 0, 0);
  assert.equal(draft.name, long);
  assert.throws(() => helper.serviceSavePayload({ ...values, ...draft, category: 'OTHER', price: 88.5, durationMin: 60 }, 'MENU'), /200 字/);
  const payload = helper.serviceSavePayload({ ...values, name: 'A'.repeat(200), isActive: true, priceText: '$999 original', variants: [{ durationMin: 90 }] }, 'MENU');
  assert.equal(payload.name.length, 200); assert.equal(payload.priceCents, 8850); assert.equal(payload.isActive, false);
  assert.deepEqual(Object.keys(payload).sort(), ['category', 'description', 'durationKind', 'durationMin', 'isActive', 'name', 'priceCents']);
});

test('money conversion is exact and invalid manual values are never rounded or filled from source wording', () => {
  for (const [amount, cents] of [[0, 0], [0.01, 1], [19.99, 1999], [88.5, 8850], [999999.99, 99999999]]) assert.equal(helper.servicePriceCents(amount), cents);
  for (const bad of [undefined, null, '', '88.50', 'From $80', -1, 0.001, 1.005, 1000000, NaN, Infinity]) assert.throws(() => helper.servicePriceCents(bad), /价格/);
  for (const durationMin of [5,15,29,240]) assert.equal(helper.serviceSavePayload({ ...values, durationMin }, 'MENU').durationMin, durationMin);
  for (const bad of [undefined, null, '60', 0, 4, 120.5, 241]) assert.throws(() => helper.serviceSavePayload({ ...values, durationMin: bad }, 'MENU'), /时长/);
  assert.equal(helper.serviceSavePayload(values, 'NEW').isActive, true, 'ordinary manual creates keep their existing active default');
  assert.equal(helper.serviceSavePayload({ ...values, isActive: false }, 'EDIT').isActive, false);
});

test('name and description rules preserve plain wording while enforcing their actual storage boundaries', () => {
  assert.equal(helper.serviceName('  Manually checked  '), 'Manually checked');
  for (const bad of ['', '   ', 'A'.repeat(201), 'Name\nnext', '<b>Name</b>']) assert.throws(() => helper.serviceName(bad));
  assert.equal(helper.serviceDescription('Original\r\nMultiline\tnote'), 'Original\nMultiline\tnote');
  assert.equal(new TextEncoder().encode(helper.serviceDescription('中'.repeat(21845))).byteLength, 65535);
  assert.throws(() => helper.serviceDescription('中'.repeat(21846)), /65535/);
  for (const bad of [null, 1, 'Text\u0000', '<b>Text</b>']) assert.throws(() => helper.serviceDescription(bad));
});

test('disabled-create receipts require this exact shop and false rather than a truthy or missing status', () => {
  const shopId = '9007199254740997';
  helper.assertMenuServiceReceipt({ shopId, isActive: false, durationMin: 60 }, shopId);
  for (const bad of [{ shopId, isActive: true }, { shopId, isActive: 'false' }, { shopId }, { isActive: false }, { shopId: '9007199254740999', isActive: false }]) assert.throws(() => helper.assertMenuServiceReceipt(bad, shopId), /无法核对/);
});

test('creating a carried item sends one disabled POST with manually entered amounts and no SKU or source metadata', async () => {
  const shopId = '9007199254740997', calls = [], oldAdapter = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    const body = JSON.parse(config.data); calls.push({ method: config.method, url: config.url, body });
    return { config, data: { ...body, id: '9007199254740999', shopId }, headers: {}, status: 201, statusText: 'Created' };
  };
  try {
    const { createService } = await server.ssrLoadModule('/src/api/merchant.ts');
    const draft = helper.serviceDraftFromMenu(menu, 1, 25);
    const payload = helper.serviceSavePayload({ ...draft, category: 'OTHER', price: 88.5, durationMin: 60 }, 'MENU');
    const saved = await createService(shopId, payload);
    helper.assertMenuServiceReceipt(saved, shopId);
    assert.deepEqual(calls, [{ method: 'post', url: `/merchant/shops/${shopId}/services`, body: { name: 'Foot service 25', description: 'Original note 25', category: 'OTHER', durationKind: 'TIMED', durationMin: 60, priceCents: 8850, isActive: false } }]);
    assert.equal(saved.isActive, false);
  } finally { axios.defaults.adapter = oldAdapter; }
});

test('dependent add-on display items cannot be carried as standalone primary services or issue a create', async () => {
  const previousAdapter = axios.defaults.adapter, calls = [];
  axios.defaults.adapter = async config => { calls.push(config); throw new Error('Special display items must not reach transport'); };
  try {
    const { createService } = await server.ssrLoadModule('/src/api/merchant.ts');
    for (const kind of ['ADD_ON']) {
      const item = { name: 'Manual complete title', priceText: '', description: 'Original wording', pricing: { kind, baseName: 'Display project', durationMin: null, priceCents: 2000, titleMode: 'CUSTOM' } };
      const original = structuredClone(item), currentDraft = { name: 'Keep my existing draft', category: 'OTHER', price: 75, durationMin: 60 };
      await assert.rejects(async () => {
        const carried = helper.serviceDraftFromMenu([{ category: 'Display only', items: [item] }], 0, 0);
        Object.assign(currentDraft, carried);
        await createService('9007199254740997', helper.serviceSavePayload(currentDraft, 'MENU'));
      }, /附加项目不能独立带入主服务.*当前草稿已保留/);
      assert.deepEqual(item, original);
      assert.deepEqual(currentDraft, { name: 'Keep my existing draft', category: 'OTHER', price: 75, durationMin: 60 });
    }
    assert.equal(calls.length, 0);
  } finally { axios.defaults.adapter = previousAdapter; }
});

test('a structured timed display item reuses explicit price and valid minutes but carries no source metadata into the service payload', () => {
  const item = { name: '30Mins Body Massage $50', priceText: '', description: 'Display text only', imageUrl: '/service-gallery/v1/swedish-massage.webp', pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO', legacySource: { name: 'Body Massage', priceText: '$50 / 30 min' } } };
  const original = structuredClone(item), draft = helper.serviceDraftFromMenu([{ category: 'Body Massage', items: [item] }], 0, 0);
  assert.deepEqual(draft, { name: '30Mins Body Massage $50', description: 'Display text only', durationKind: 'TIMED', category: undefined, price: 50, durationMin: 30, isActive: false });
  assert.throws(() => helper.serviceSavePayload(draft, 'MENU'), /分类/);
  assert.throws(() => helper.serviceSavePayload({ ...draft, category: 'OTHER', durationMin: null }, 'MENU'), /时长/);
  assert.throws(() => helper.serviceSavePayload({ ...draft, category: 'OTHER', durationMin: 60, price: null }, 'MENU'), /价格/);
  const payload = helper.serviceSavePayload({ ...draft, category: 'OTHER', durationMin: 90, price: 85 }, 'MENU');
  assert.equal(payload.priceCents, 8500); assert.equal(payload.durationMin, 90); assert.equal(payload.isActive, false);
  for (const key of ['pricing', 'legacySource', 'imageUrl', 'variantId', 'serviceId', 'priceBasis']) assert.equal(Object.hasOwn(payload, key), false);
  assert.deepEqual(item, original);
});

test('invalid structured display data is rejected before the previous booking draft can be replaced', () => {
  const base = () => ({ name: '30Mins Body Massage $50', priceText: '', pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO' } });
  for (const change of [
    item => { item.pricing = null; }, item => { item.pricing.kind = 'UNSUPPORTED'; },
    item => { item.pricing.durationMin = null; }, item => { item.pricing.priceCents = null; },
    item => { item.pricing.accountId = 'not-allowed'; }, item => { item.name = 'Incorrect auto title'; }, item => { item.priceText = '$50'; },
  ]) {
    const item = base(); change(item);
    assert.throws(() => helper.serviceDraftFromMenu([{ category: 'Display', items: [item] }], 0, 0), /结构化类型或完整标题无效.*未替换当前草稿/);
  }
});
