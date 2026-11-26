import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { register } from 'node:module';
import type { PriceMenuItem } from '../../utils/priceMenu';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('/MenuCatalogPicker.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: PriceMenuBookingFields } = await import('./PriceMenuBookingFields');

test('a paused parent keeps its configured variant and add-on visibly checked with an explicit parent settings action', () => {
  for (const addOn of [false, true]) {
    const item: PriceMenuItem = { name: 'Configured option', priceText: '', bookingEnabled: true, bookingAvailable: false, bookingUnavailableReason: 'PARENT_PAUSED',
      booking: { serviceId: '20', ...(addOn ? { addOnId: '40' } : { variantId: '30' }) },
      pricing: { kind: addOn ? 'ADD_ON' : 'TIMED', baseName: 'Body Massage', durationMin: addOn ? null : 60, priceCents: 8000, titleMode: 'CUSTOM' } };
    const html = renderToStaticMarkup(<PriceMenuBookingFields item={item} menu={[]} disabled={false} onChange={() => {}} onConfigureService={() => {}} />);
    assert.match(html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '', /checked/);
    assert.match(html, /主项目已暂停/); assert.match(html, /启用配置已保留/); assert.match(html, /主项目预约设置/);
    assert.match(html, addOn ? /启用此附加选项/ : /启用此规格/);
  }
});

test('an option paused by its own switch remains unchecked', () => {
  const item: PriceMenuItem = { name: 'Paused option', priceText: '', bookingEnabled: false, bookingAvailable: false, bookingUnavailableReason: 'ITEM_PAUSED', booking: { serviceId: '20', variantId: '30' } };
  const html = renderToStaticMarkup(<PriceMenuBookingFields item={item} menu={[]} disabled={false} onChange={() => {}} />);
  assert.doesNotMatch(html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '', /checked/);
  assert.doesNotMatch(html, /主项目已暂停/);
});

test('catalog binding uses named selection actions and no service, variant or add-on ID inputs', () => {
  const item: PriceMenuItem = { name: 'Oil', priceText: '', pricing: { kind: 'ADD_ON', baseName: 'Oil', durationMin: null, priceCents: 1000, titleMode: 'CUSTOM' } };
  const html = renderToStaticMarkup(<PriceMenuBookingFields item={item} menu={[]} disabled={false} onChange={() => {}} onCatalogSelect={() => {}} />);
  assert.match(html, /为新增附加项选择主项目/); assert.match(html, /关联本店已有附加项/);
  assert.doesNotMatch(html, /服务编号|规格编号|附加项目编号|inputMode="numeric"/);
});

test('catalog-only permission preserves an existing couple selection while disabling policy edits', () => {
  const item: PriceMenuItem = { name: 'Couple', priceText: '', booking: { serviceId: '20', variantId: '30' }, bookingMode: 'COUPLE',
    pricing: { kind: 'TIMED', baseName: 'Couple', durationMin: 60, priceCents: 15000, titleMode: 'CUSTOM' } };
  const html = renderToStaticMarkup(<PriceMenuBookingFields item={item} menu={[]} disabled={false} policyEditable={false} onChange={() => {}} onCatalogSelect={() => {}} />);
  assert.match(html, /<select[^>]*disabled/); assert.match(html, /value="COUPLE" selected/);
  assert.match(html, /已有项目保留原预约方式/);
  const changeCatalogButton = html.match(/<button[^>]*>更换关联项目<\/button>/)?.[0];
  assert.ok(changeCatalogButton, 'catalog selection remains available to catalog-only users');
  assert.doesNotMatch(changeCatalogButton, /disabled/);
});

test('a pending new variant can reconfirm its catalog parent without replacing its own price and minutes', () => {
  const item: PriceMenuItem = { id: 'new', name: '90Mins Body Massage $110', priceText: '', newVariantOf: '20',
    pricing: { kind: 'TIMED', baseName: 'Body Massage', durationMin: 90, priceCents: 11000, titleMode: 'AUTO' } };
  const html = renderToStaticMarkup(<PriceMenuBookingFields item={item} menu={[{ category: '', items: [item] }]} disabled={false} onChange={() => {}} onCatalogSelect={() => {}} />);
  assert.match(html, /重新确认新规格主项目/); assert.match(html, /价格和时长单独设置/);
  assert.doesNotMatch(html, /服务编号|规格编号/);
});

test('an unpersisted shop cannot activate booking but an accidental checked draft can still be unchecked', () => {
  const base: PriceMenuItem = { name: 'Massage', priceText: '', pricing: { kind: 'TIMED', baseName: 'Massage', durationMin: 60, priceCents: 8000, titleMode: 'CUSTOM' } };
  const html = (enabled: boolean) => renderToStaticMarkup(<PriceMenuBookingFields item={{ ...base, bookingEnabled: enabled }} menu={[]} disabled={false} bookingActivationAllowed={false} onChange={() => {}} onCatalogSelect={() => {}} />);
  const notChecked = html(false), checked = html(true);
  assert.match(notChecked, /先创建门店，再启用预约；价目可先保存为草稿/);
  assert.match(notChecked.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '', /disabled/);
  assert.doesNotMatch(checked.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '', /disabled/);
  assert.match(checked.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '', /checked/);
});

test('mode help describes effective customer and therapist counts while keeping order price independent', () => {
  const base: PriceMenuItem = { name: 'Synthetic service', priceText: '', pricing: { kind: 'TIMED', baseName: 'Synthetic service', durationMin: 60, priceCents: 10025, titleMode: 'CUSTOM' } };
  for (const [mode, expected] of [['SINGLE', '1位客人／1位技师'], ['COUPLE', '2位客人／2位不同技师'], ['FOUR_HANDS', '1位客人／2位不同技师']] as const) {
    const item = { ...base, bookingMode: mode }, before = structuredClone(item);
    const html = renderToStaticMarkup(<PriceMenuBookingFields item={item} menu={[]} disabled={false} onChange={() => { throw Error('Help must not change policy'); }} />);
    const help = html.match(/<small>当前选择：[\s\S]*?<\/small>/)?.[0] ?? '';
    assert.ok(help.includes(expected));
    if (mode === 'SINGLE') assert.doesNotMatch(help, /两位|2位/);
    assert.match(html, /价格为整次订单总价，不按顾客或技师人数重复计算；预约分钟独立设置/);
    assert.deepEqual(item, before);
  }
});

test('inherited draft and persisted variant modes show only known parent counts, explicit choice takes precedence', () => {
  const main: PriceMenuItem = { id: 'main', name: 'Parent', priceText: '', booking: { serviceId: '20' }, bookingMode: 'COUPLE' };
  const pricing = { kind: 'TIMED' as const, baseName: 'Parent', durationMin: 60, priceCents: 10025, titleMode: 'CUSTOM' as const };
  for (const ref of [{ newVariantOf: 'item:main' }, { newVariantOf: '20' }, { booking: { serviceId: '20', variantId: '30' } }]) {
    const child: PriceMenuItem = { id: 'child', name: 'Variant', priceText: '', pricing, ...ref };
    const html = renderToStaticMarkup(<PriceMenuBookingFields item={child} menu={[{ category: '', items: [main, child] }]} disabled={false} onChange={() => {}} />);
    assert.match(html, /<small>沿用主项目预约方式：情侣按摩：2位客人／2位不同技师/);
    const override = renderToStaticMarkup(<PriceMenuBookingFields item={{ ...child, bookingMode: 'FOUR_HANDS' }} menu={[{ category: '', items: [main, child] }]} disabled={false} onChange={() => {}} />);
    assert.match(override, /<small>当前选择：四手按摩：1位客人／2位不同技师/);
    assert.doesNotMatch(override, /<small>沿用主项目预约方式：/);
  }
  const unresolved: PriceMenuItem = { name: 'Unknown', priceText: '', pricing, newVariantOf: '99' };
  const html = renderToStaticMarkup(<PriceMenuBookingFields item={unresolved} menu={[{ category: '', items: [main] }]} disabled={false} onChange={() => {}} />);
  assert.match(html, /主项目人数尚未读取/);
  assert.doesNotMatch(html, /<small>[^<]*1位客人／1位技师/);
  const defaulted = renderToStaticMarkup(<PriceMenuBookingFields item={{ name: 'New', priceText: '', pricing }} menu={[]} disabled={false} policyEditable={false} onChange={() => {}} />);
  assert.match(defaulted, /新建独立项目默认：单人服务：1位客人／1位技师/);
});
