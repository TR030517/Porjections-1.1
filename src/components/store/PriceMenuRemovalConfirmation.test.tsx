import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import PriceMenuRemovalConfirmation from './PriceMenuRemovalConfirmation';
import { preparePriceMenuRemoval } from '../../utils/priceMenuEditingImpact';
import type { PriceMenuGroup } from '../../utils/priceMenu';
function render(menu: PriceMenuGroup[], itemIndex?: number) {
  return renderToStaticMarkup(<PriceMenuRemovalConfirmation request={preparePriceMenuRemoval(menu, 0, itemIndex)!} disabled={false} onCancel={() => {}} onConfirm={() => {}} />);
}
test('removal review explains booking consequences, siblings and future-order protection without executing a write', () => {
  let operations = 0;
  const request = preparePriceMenuRemoval([{ category: 'Body <unsafe>', items: [
    { name: 'Body 60 minutes', priceText: '', booking: { serviceId: '1', variantId: '2' } },
    { name: 'Aroma Oil', priceText: '', booking: { serviceId: '1', addOnId: '3' } },
  ] }], 0)!;
  const html = renderToStaticMarkup(<PriceMenuRemovalConfirmation request={request} disabled={false} onCancel={() => { operations++; }} onConfirm={() => { operations++; }} />);
  for (const text of ['alertdialog', 'Body 60 minutes', 'Aroma Oil', '此规格会停用', '此附加项会停用', '不能再预约此规格', '不能加入新的预约', '历史订单及其项目、价格和技师快照保留', '有效预约', '尚未保存', '不是仅从顾客页面隐藏', '保留项目', '确认移除草稿']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/移除后剩余 0 条绑定/g) || []).length, 2);
  assert.match(html, /Body &lt;unsafe&gt;/); assert.equal(operations, 0); assert.doesNotMatch(html, /<form/);
});
test('retained placement shows its remaining count and never claims that it will deactivate', () => {
  const item = { name: 'Body 60', priceText: '', booking: { serviceId: '1', variantId: '2' } };
  const html = render([{ category: 'Remove', items: [item] }, { category: 'Keep', items: [structuredClone(item), structuredClone(item)] }]);
  for (const text of ['移除后剩余 2 条绑定', '本次移除不会停用此对象', '原启停状态不变']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /此规格会停用|不能再预约此规格/);
});
test('paused parent warning does not promise that retained bindings become bookable', () => {
  const item = { name: 'Body 60', priceText: '', booking: { serviceId: '1', variantId: '2' }, bookingUnavailableReason: 'PARENT_PAUSED' as const };
  const html = render([{ category: 'Remove', items: [item] }, { category: 'Keep', items: [structuredClone(item)] }]);
  assert.ok(html.includes('当前主项目已暂停')); assert.ok(html.includes('不会恢复主项目或使其重新可约'));
});
test('base-service confirmation distinguishes known variants and unlisted catalog variants', () => {
  const base = { name: 'Body Massage', priceText: '', booking: { serviceId: '1' } };
  const known = render([{ category: 'Remove', items: [base, { name: 'Body 60', priceText: '', booking: { serviceId: '1', variantId: '2' } }] }], 0);
  assert.ok(known.includes('该主项目已有规格，不会因此整组暂停')); assert.doesNotMatch(known, /独立主项目会停用/);
  const unknown = render([{ category: 'Remove', items: [base] }]);
  for (const text of ['若目录中没有规格', '独立主项目会停用并停止新预约', '包括未列入价目的规格', '主项目不会因此暂停']) assert.ok(unknown.includes(text), text);
});
test('unlinked draft removal promises no deactivation of saved objects', () => {
  const html = render([{ category: 'Drafts', items: [{ name: 'Draft treatment', priceText: '$50' }] }]);
  assert.ok(html.includes('展示行：Draft treatment')); assert.ok(html.includes('不会停用已有服务、规格或附加项'));
  assert.doesNotMatch(html, /此规格会停用|此附加项会停用|独立主项目会停用/);
});
