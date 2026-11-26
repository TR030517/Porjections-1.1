import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PriceMenuItem } from './priceMenu';
import { cloneNextPriceMenuItem, firstPriceMenuItem, DEFAULT_PRICE_MENU_STEPS, PRICE_MENU_QUICK_LIMITS } from './priceMenuQuickEntry';

const steps = { minutes: 30, priceCents: 1000 };

test('explicit starting values seed item one and subsequent clones increment the previous values',()=>{
  const first=firstPriceMenuItem('Body Massage',{minutes:30,priceCents:5000});
  assert.equal(first.item.name,'30 min Body Massage $50');
  const second=cloneNextPriceMenuItem({...first.item,description:'Retain',imageUrl:'/service-gallery/v1/swedish-massage.webp'},{minutes:30,priceCents:3000});
  assert.equal(second.item.name,'60 min Body Massage $80');assert.equal(second.item.description,'Retain');assert.equal(second.item.imageUrl,'/service-gallery/v1/swedish-massage.webp');
  assert.equal(first.item.pricing?.durationMin,30);assert.equal(first.item.pricing?.priceCents,5000);
  assert.equal(firstPriceMenuItem('Free service',{minutes:15,priceCents:0}).item.pricing?.priceCents,0);
  for(const kind of ['PER_SESSION','VARIABLE','ADD_ON'] as const){const special=firstPriceMenuItem('Essential Oil',{minutes:0,priceCents:1000},kind);assert.equal(special.item.pricing?.durationMin,null);assert.equal(special.item.pricing?.kind,kind);}
  for(const values of [{minutes:0,priceCents:1000},{minutes:-1,priceCents:1000},{minutes:1441,priceCents:1000},{minutes:30,priceCents:1.5}])assert.throws(()=>firstPriceMenuItem('Body Massage',values));
});

test('default USD and minute steps are explicit, bounded and immutable', () => {
  assert.deepEqual(DEFAULT_PRICE_MENU_STEPS, {minutes:30,priceCents:3000});
  assert.deepEqual(PRICE_MENU_QUICK_LIMITS, { minutes: 1440, priceCents: 99999999 });
  assert.ok(Object.isFrozen(DEFAULT_PRICE_MENU_STEPS)); assert.ok(Object.isFrozen(PRICE_MENU_QUICK_LIMITS));
});

test('the first item is a blank template without an invented amount, time or image', () => {
  const result = cloneNextPriceMenuItem(undefined, steps);
  assert.deepEqual(result.item, { name: '', priceText: '' }); assert.equal(result.incremented, false);
  assert.match(result.notice, /首项.*未推测/);
});

test('a full preceding item is cloned without shared identity or source metadata, including description and image', () => {
  const original = Object.freeze({ name: '30 Min Body Massage $50', priceText: '30 mins · $50', description: 'Original\r\nDescription', imageUrl: 'https://example.test/generic-massage.jpg', ownerId: 'never-copy' });
  const before = { ...original }, result = cloneNextPriceMenuItem(original, steps);
  assert.deepEqual(result.item, { name: '60 Min Body Massage $60', priceText: '60 mins · $60', description: original.description, imageUrl: original.imageUrl });
  assert.equal(result.incremented, true); assert.notEqual(result.item, original);
  const editable: PriceMenuItem = result.item;
  editable.description = 'Edited clone'; editable.imageUrl = '';
  assert.deepEqual(original, before); assert.equal(Object.hasOwn(result.item, 'ownerId'), false);
});

test('plain service labels stay unchanged while a single price/time template advances in either order', () => {
  const source = { name: 'Body Massage', priceText: '$80 / 60 min' };
  assert.deepEqual(cloneNextPriceMenuItem(source, steps).item, { name: 'Body Massage', priceText: '$90 / 90 min' });
  assert.deepEqual(cloneNextPriceMenuItem({ name: 'Deep-Tissue Massage', priceText: '60 minutes USD 80.00' }, steps).item, { name: 'Deep-Tissue Massage', priceText: '90 minutes USD 90.00' });
  assert.deepEqual(source, { name: 'Body Massage', priceText: '$80 / 60 min' });
});

test('decimal arithmetic uses integer cents and preserves necessary precision and surrounding USD wording', () => {
  const cases = [
    ['$19.99 / 60 min', 1, '$20.00 / 90 min'], ['$0.1', 20, '$0.3'], ['$0', 1, '$0.01'],
    ['USD 50.00', 1000, 'USD 60.00'], ['50.0 USD', 1, '50.01 USD'], ['  $ 50.00 / 60 MIN  ', 1000, '  $ 60.00 / 90 MIN  '],
  ] as const;
  for (const [priceText, priceCents, expected] of cases) assert.equal(cloneNextPriceMenuItem({ name: 'Massage', priceText }, { minutes: 30, priceCents }).item.priceText, expected);
});

test('only the time or amount actually present is incremented; zero independently preserves either value', () => {
  assert.equal(cloneNextPriceMenuItem({ name: '30 Min Body Massage', priceText: '' }, steps).item.name, '60 Min Body Massage');
  assert.equal(cloneNextPriceMenuItem({ name: 'Body Massage', priceText: '$80' }, steps).item.priceText, '$90');
  assert.equal(cloneNextPriceMenuItem({ name: 'Body Massage', priceText: '60 min' }, steps).item.priceText, '90 min');
  assert.equal(cloneNextPriceMenuItem({ name: 'Body Massage', priceText: '$80 / 60 min' }, { minutes: 0, priceCents: 1000 }).item.priceText, '$90 / 60 min');
  assert.equal(cloneNextPriceMenuItem({ name: 'Body Massage', priceText: '$80 / 60 min' }, { minutes: 30, priceCents: 0 }).item.priceText, '$80 / 90 min');
  const original = { name: 'Body Massage', priceText: '$80', description: '', imageUrl: '' };
  const zero = cloneNextPriceMenuItem(original, { minutes: 0, priceCents: 0 });
  assert.deepEqual(zero.item, original); assert.equal(zero.incremented, false); assert.match(zero.notice, /均为 0/);
});

test('ranges, multiple amounts or times, promotions, packages and participant bases preserve the entire item', () => {
  const texts = ['From $80 / 60 min', '$80–$100 / 60 min', '$80-$100', '30–60 min / $80', '60 min / $80 or $100', '30 min / 60 min / $80', '$80 per person', '$80 for two', 'Couples $160 / 60 min', 'Package $300 / 60 min', 'Buy 5 get 1 free $300', '$80 / 60 min and up'];
  for (const priceText of texts) {
    const source = { name: '30 Min Body Massage $50', priceText, description: 'Unchanged note', imageUrl: 'https://example.test/generic.jpg' }, result = cloneNextPriceMenuItem(source, steps);
    assert.deepEqual(result.item, source, priceText); assert.equal(result.incremented, false, priceText); assert.match(result.notice, /保持不变/);
  }
  for (const patch of [{ name: 'Couples Massage' }, { name: '双人按摩' }, { description: 'Package of 5 visits' }]) {
    const source = { name: '30 Min Body Massage $50', priceText: '30 min / $50', ...patch };
    assert.deepEqual(cloneNextPriceMenuItem(source, steps).item, source);
  }
});

test('other currencies, malformed amounts and non-minute units are never interpreted as USD or minutes', () => {
  for (const priceText of ['CAD $80 / 60 min', 'AUD 80', '€80 / 60 min', '80 EUR', '$80 USD', 'US$80', '$1,000', '$080', '$80.005', '$8e1', '-$80', '$80+', '$80 / 1 hr', '$80 / 1.5 hours', 'Call for price']) {
    const source = { name: 'Massage', priceText }, result = cloneNextPriceMenuItem(source, steps);
    assert.deepEqual(result.item, source, priceText); assert.equal(result.incremented, false, priceText); assert.ok(result.notice);
  }
});

test('numbers in technique names are not treated as durations or silently rewritten', () => {
  for (const name of ['4 Hands Massage', '3D Body Massage', 'Technique 30', '30 Stone Massage', 'Body Massage 60 min', '30 Min Body Massage 2']) {
    const source = { name, priceText: '$80 / 60 min' }, result = cloneNextPriceMenuItem(source, steps);
    assert.deepEqual(result.item, source, name); assert.equal(result.incremented, false, name);
  }
});

test('contradictory duplicate terms across name and price text are kept unchanged rather than amplified', () => {
  for (const priceText of ['$80 / 30 min', '$50 / 60 min']) {
    const source = { name: '30 Min Body Massage $50', priceText }, result = cloneNextPriceMenuItem(source, steps);
    assert.deepEqual(result.item, source); assert.equal(result.incremented, false); assert.match(result.notice, /不一致/);
  }
});

test('invalid steps reject the entire action even for an empty first item, without mutating the source', () => {
  const source = Object.freeze({ name: '30 Min Body Massage $50', priceText: '$50 / 30 min' });
  for (const bad of [null, {}, { minutes: -1, priceCents: 1000 }, { minutes: 1.5, priceCents: 1000 }, { minutes: '30', priceCents: 1000 }, { minutes: NaN, priceCents: 1000 }, { minutes: 30, priceCents: Infinity }, { minutes: 30, priceCents: 0.1 }, { minutes: 30, priceCents: -1 }, { minutes: 1441, priceCents: 1 }, { minutes: 1, priceCents: 100000000 }]) {
    assert.throws(() => cloneNextPriceMenuItem(source, bad as never), /新增未执行/);
    assert.throws(() => cloneNextPriceMenuItem(undefined, bad as never), /新增未执行/);
  }
  assert.deepEqual(source, { name: '30 Min Body Massage $50', priceText: '$50 / 30 min' });
});

test('result limits fail atomically and preserve original wording, including prices with fractional cents unsupported', () => {
  for (const source of [
    { name: 'Massage', priceText: '$999999.99 / 60 min' },
    { name: '1440 Min Massage $50', priceText: '$50 / 1440 min' },
    { name: 'Massage', priceText: '$1000000' },
    { name: 'Massage', priceText: '1441 min' },
    { name: '30 Min ' + 'A'.repeat(289) + ' $99', priceText: '$99 / 30 min' },
  ]) {
    const result = cloneNextPriceMenuItem(source, steps);
    assert.deepEqual(result.item, source); assert.equal(result.incremented, false); assert.match(result.notice, /保持不变/);
  }
  const boundary = cloneNextPriceMenuItem({ name: 'Massage', priceText: '$999999.98 / 1410 min' }, { minutes: 30, priceCents: 1 });
  assert.equal(boundary.item.priceText, '$999999.99 / 1440 min'); assert.equal(boundary.incremented, true);
});

test('incomplete draft wording and optional empty fields copy verbatim with no automatic fallback photo', () => {
  const source: PriceMenuItem = { name: '', priceText: '', description: '', imageUrl: '/api/v1/upload/media/00000000-0000-0000-0000-000000000000/file' };
  const result = cloneNextPriceMenuItem(source, steps);
  assert.deepEqual(result.item, source); assert.equal(result.incremented, false); assert.notEqual(result.item, source);
  assert.throws(() => cloneNextPriceMenuItem({ name: 'Massage', priceText: null } as unknown as PriceMenuItem, steps), /上一项格式/);
});
test('structured titles advance to the current format while literal titles keep their existing style',()=>{
  const original:PriceMenuItem={name:'30Mins Body Massage $50',priceText:'',description:'Keep',imageUrl:'/service-gallery/v1/swedish-massage.webp',pricing:{kind:'TIMED',baseName:'Body Massage',durationMin:30,priceCents:5000,titleMode:'AUTO'}};
  const next=cloneNextPriceMenuItem(original,{minutes:30,priceCents:3000});
  assert.equal(next.item.name,'60 min Body Massage $80');assert.equal(next.item.pricing?.durationMin,60);assert.equal(next.item.pricing?.priceCents,8000);
  assert.equal(next.item.description,'Keep');assert.equal(next.item.imageUrl,original.imageUrl);assert.notEqual(next.item.pricing,original.pricing);assert.equal(original.pricing?.durationMin,30);
  assert.equal(cloneNextPriceMenuItem({name:'30Mins Body Massage $50',priceText:''},{minutes:30,priceCents:3000}).item.name,'60Mins Body Massage $80');
  assert.equal(cloneNextPriceMenuItem({name:'Massage',priceText:'$80 / 60min'},{minutes:30,priceCents:1000}).item.priceText,'$90 / 90min');
});
test('session variable and add-on copy prices without inventing or incrementing duration',()=>{
  for(const kind of ['PER_SESSION','VARIABLE','ADD_ON'] as const){
    const original:PriceMenuItem={name:'Custom title',priceText:'',pricing:{kind,baseName:'Essential Oil',durationMin:null,priceCents:1000,titleMode:'CUSTOM'}};
    const next=cloneNextPriceMenuItem(original,{minutes:30,priceCents:125});assert.equal(next.item.pricing?.durationMin,null);assert.equal(next.item.pricing?.priceCents,1125);assert.equal(next.item.pricing?.titleMode,'AUTO');assert.match(next.item.name,/11\.25/);
    const same=cloneNextPriceMenuItem(original,{minutes:0,priceCents:0});assert.equal(same.item.pricing?.titleMode,'AUTO');assert.equal(same.item.pricing?.priceCents,1000);assert.notEqual(same.item.name,'Custom title');
  }
});
