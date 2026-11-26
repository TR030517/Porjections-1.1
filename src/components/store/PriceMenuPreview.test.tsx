import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { register } from 'node:module';
import type { PriceMenuGroup, PriceMenuItem } from '../../utils/priceMenu';
import { formatPriceMenuTitle, type PriceMenuPricing } from '../../utils/priceMenuPricing';

// Node verifies the rendered content; stylesheet layout is checked in the browser.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('/PriceMenuPreview.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: PriceMenuPreview } = await import('./PriceMenuPreview');

test('large read-only previews retain the full source but build only the initial visible items and images', () => {
  const menu: PriceMenuGroup[] = Array.from({ length: 10 }, (_, group) => ({ category: `Group ${group}`, items: Array.from({ length: 100 }, (_, item) => ({ name: `Service ${group}-${item}`, priceText: `From USD ${item}; confirm in store`, imageUrl: `https://example.test/image-${group}-${item}.jpg` })) }));
  const before = structuredClone(menu);
  const html = renderToStaticMarkup(<PriceMenuPreview value={menu} />);
  assert.match(html, /1000 services in 10 groups/);
  assert.match(html, /Service 0-5/);
  assert.doesNotMatch(html, /Service 0-6|image-0-6|Service 3-0|image-3-0/);
  assert.equal((html.match(/<img /g) ?? []).length, 18);
  assert.match(html, /Show more services/); assert.match(html, /Show more groups/);
  assert.deepEqual(menu, before);
});

test('copy previews use Chinese controls, preserve promotional empty groups, and create no images', () => {
  const menu: PriceMenuGroup[] = [{ category: 'Pay for five, get one free', items: [] }, { category: 'Massage', items: [{ name: 'Original name', priceText: 'Call for price / 30–60 min', imageUrl: 'https://example.test/photo.jpg' }] }];
  const html = renderToStaticMarkup(<PriceMenuPreview value={menu} language="zh" showImages={false} />);
  assert.match(html, /2 个分组 · 1 个项目/); assert.match(html, /Pay for five, get one free/);
  assert.match(html, /Call for price \/ 30–60 min/); assert.doesNotMatch(html, /<img |example.test/);
  assert.doesNotMatch(html, /预约|Book now|bookingId/);
});

function priced(pricing: PriceMenuPricing, name = formatPriceMenuTitle(pricing)): PriceMenuItem {
  return { name, priceText: '', pricing };
}
const timed: PriceMenuPricing = { kind: 'TIMED', baseName: 'Body massage', durationMin: 60, priceCents: 8000, titleMode: 'AUTO' };

test('new price titles render once with kind labels and no missing-price placeholder or booking action', () => {
  const items = [
    priced(timed),
    priced({ ...timed, kind: 'PER_SESSION', durationMin: null, baseName: 'Facial', priceCents: 5500 }),
    priced({ ...timed, kind: 'VARIABLE', durationMin: null, baseName: 'Custom care', priceCents: 9000 }),
    priced({ ...timed, kind: 'ADD_ON', durationMin: null, baseName: 'Essential oil', priceCents: 1050 }),
  ];
  const original = structuredClone(items);
  const html = renderToStaticMarkup(<PriceMenuPreview value={[{ category: 'Services', items }]} />);
  assert.match(html, /60 min Body massage \$80/);
  assert.equal(html.split('$80').length - 1, 1);
  for (const label of ['Fixed duration', 'Per session', 'Duration varies', 'Add-on', 'Requires a main service · Adds no appointment time']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /Price not provided|价格待填写|Book now|bookingId|<button/);
  assert.deepEqual(items, original);
});

test('custom titles retain explicit numeric facts in a compact label and zero cents are valid', () => {
  const html = renderToStaticMarkup(<PriceMenuPreview value={[{ category: '', items: [
    priced({ ...timed, titleMode: 'CUSTOM', priceCents: 8850 }, 'Signature treatment'),
    priced({ ...timed, kind: 'ADD_ON', durationMin: null, titleMode: 'CUSTOM', priceCents: 0 }, 'Included extra'),
  ] }]} />);
  assert.match(html, /Signature treatment/); assert.match(html, /60 min · \$88\.5/);
  assert.match(html, /Included extra/); assert.match(html, /Add-on · \+\$0/);
  assert.doesNotMatch(html, /Price not provided|NaN|undefined/);
});

test('Chinese workspace previews localize pricing badges and the add-on condition', () => {
  const html = renderToStaticMarkup(<PriceMenuPreview language="zh" value={[{ category: '服务', items: [
    priced(timed), priced({ ...timed, kind: 'PER_SESSION', durationMin: null }),
    priced({ ...timed, kind: 'VARIABLE', durationMin: null }),
    priced({ ...timed, kind: 'ADD_ON', durationMin: null }),
    priced({ ...timed, titleMode: 'CUSTOM' }, '手动标题'),
  ] }]} />);
  for (const label of ['固定时长', '按次', '非固定时长', '附加项目', '60 分钟 · $80', '须搭配主项目 · 不增加预约时长']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /Price not provided|价格待填写|Requires a main service/);
});

test('invalid metadata, hidden URLs and conflicting legacy price text fall back without rewriting original wording', () => {
  const literal = ' From $75 / ask the store; 30–60 min ';
  const bad = [
    { ...timed, priceCents: null }, { ...timed, priceCents: '8000' },
    { ...timed, durationMin: 60.5 }, { ...timed, kind: 'PER_SESSION', durationMin: 60 },
    { ...timed, imageUrl: 'https://metadata.invalid/image.jpg' },
    { ...timed, legacySource: { name: 'Original', priceText: '$70', url: 'https://metadata.invalid' } },
  ];
  const items: PriceMenuItem[] = bad.map(pricing => ({ name: 'Original wording', priceText: literal, pricing: pricing as unknown as PriceMenuPricing }));
  items.push({ name: 'Original wording', priceText: literal, pricing: timed });
  items.push({ name: 'Manually mismatched auto title', priceText: '', pricing: timed });
  const html = renderToStaticMarkup(<PriceMenuPreview value={[{ category: 'Legacy', items: items.slice(0, 4) }, { category: 'More legacy', items: items.slice(4) }]} />);
  assert.equal(html.split(literal).length - 1, 7);
  assert.match(html, /Manually mismatched auto title/);
  assert.doesNotMatch(html, /Fixed duration|metadata.invalid|<img /);
  assert.ok(items.every((item, index) => index === 7 || item.priceText === literal));
});

test('converted legacy source is preserved as provenance and never treated as another title, price or image', () => {
  const item = priced({ ...timed, legacySource: { name: '  Original item  ', priceText: 'Call for price / 30–60 min' } }, '60Mins Body massage $80');
  const before = structuredClone(item);
  const html = renderToStaticMarkup(<PriceMenuPreview value={[{ category: 'Converted', items: [item] }]} />);
  assert.match(html, /60 min Body massage \$80/);
  assert.doesNotMatch(html, /60Mins|Original item|Call for price|Price not provided/);
  assert.deepEqual(item, before);
});
