import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PriceMenuGroup } from '../../utils/priceMenu';
import { formatPriceMenuTitle } from '../../utils/priceMenuPricing';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StorePriceMenuEditor } = await import('./StorePriceMenuEditor');
const render = (menu: PriceMenuGroup[], canManage = true) => renderToStaticMarkup(<StorePriceMenuEditor value={menu} onChange={() => true} catalogSelectionAllowed={canManage} onEditService={() => {}} />);
const summaries = (html: string) => [...html.matchAll(/<section class="price-menu-wide price-menu-source-summary"[^>]*>([\s\S]*?)<\/section>/g)].map(match => match[1]);

test('three linked display rows show their own read-only variant values rather than a common service base price', () => {
  const menu: PriceMenuGroup[] = [{ category: 'Massage', items: [[30, 4000], [60, 6000], [90, 10025]].map(([durationMin, priceCents], index) => {
    const pricing = { kind: 'TIMED', baseName: 'Massage', durationMin, priceCents, titleMode: 'AUTO' } as const;
    return { id: `row-${index}`, name: formatPriceMenuTitle(pricing), priceText: '', pricing, booking: { serviceId: '21', variantId: String(31 + index) }, bookingEnabled: true };
  }) }];
  const html = render(menu), sourceRows = summaries(html);
  assert.match(html, /1 个展示分组 · 3 条展示行/); assert.equal(sourceRows.length, 3);
  for (const [index, [minutes, money]] of [[30, '40'], [60, '60'], [90, '100.25']].entries()) {
    assert.match(sourceRows[index], new RegExp(`规格 #${31 + index}`));
    assert.match(sourceRows[index], new RegExp(`USD ${String(money).replace('.', '\\.')}</dd>`));
    assert.match(sourceRows[index], new RegExp(`${minutes} 分钟`));
    assert.doesNotMatch(sourceRows[index], /<input|<select|<textarea/);
  }
  assert.doesNotMatch(sourceRows[1], /USD 40/); assert.doesNotMatch(sourceRows[2], /USD 40/);
  assert.doesNotMatch(html, /名称、价格与时长在这里统一维护|aria-label="本组第 \d+ 项(?:基础名称|价格美元|时长分钟)"/);
  assert.match(html, /维护此服务与规格/); assert.match(html, /自定义展示标题/);
  assert.equal((html.match(/<summary>旧数据与关联修复<\/summary>/g) ?? []).length, 3);
});

test('unbound conversion is separately collapsed and permission gated while display wording stays editable', () => {
  const menu: PriceMenuGroup[] = [{ category: 'Legacy', items: [{ id: 'legacy-row', name: 'Original wording', priceText: 'From $40' }] }];
  const html = render(menu), repair = html.match(/<details class="price-menu-wide price-menu-repair"([^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(repair); assert.doesNotMatch(repair[1], /open=/);
  assert.match(repair[2], /设置项目类型、时长和价格/); assert.match(repair[2], /关联本店已有预约项目/);
  assert.match(html, /aria-label="本组第 1 项展示标题"/);
  const readonly = render(menu, false);
  assert.doesNotMatch(readonly, /<summary>旧数据与关联修复|设置项目类型、时长和价格|关联本店已有预约项目/);
  assert.match(readonly, /需要本店目录维护权限/); assert.match(readonly, /aria-label="本组第 1 项展示标题"/);
  assert.equal(menu[0].items[0].priceText, 'From $40');
});

test('missing linked catalog values are explicit unknowns and legacy displayed price never becomes a catalog quote', () => {
  const menu: PriceMenuGroup[] = [{ category: 'Legacy', items: [{ id: 'unknown-row', name: 'Legacy title', priceText: '$40', booking: { serviceId: '21', variantId: '31' } }] }];
  const html = render(menu), [summary] = summaries(html);
  assert.match(summary, /目录名称待核对/); assert.match(summary, /目录金额待核对/); assert.match(summary, /目录时长待核对/); assert.match(summary, /启用状态待核对/);
  assert.doesNotMatch(summary, /USD 40|已停用|已启用/);
  assert.match(html, /保留的展示价文字：\$40/);
});

test('linked add-on source remains read-only and states its price does not add appointment minutes', () => {
  const pricing = { kind: 'ADD_ON', baseName: 'Aromatherapy', durationMin: null, priceCents: 25, titleMode: 'CUSTOM' } as const;
  const html = render([{ category: 'Extras', items: [{ id: 'add-on-row', name: 'A scented finish', priceText: '', pricing, booking: { serviceId: '21', addOnId: '41' } }] }]);
  const [summary] = summaries(html);
  assert.match(summary, /附加项 #41/); assert.match(summary, /USD 0\.25/); assert.match(summary, /不增加预约时长/); assert.match(summary, /维护所属服务/);
  assert.doesNotMatch(summary, /<input|<select|<textarea/); assert.match(html, /aria-label="本组第 1 项展示标题"/);
});
