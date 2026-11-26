import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: BookingOrderEmailStatus } = await import('./BookingOrderEmailStatus');
test('mail summary is read-only and initial rendering cannot send or claim receipt', () => {
  let calls = 0;
  const html = renderToStaticMarkup(<BookingOrderEmailStatus bookingId="42" scopeKey="actor:shop" apiRequest={async () => { calls++; throw Error('SSR must not request'); }} />);
  assert.equal(calls, 0); assert.match(html, /订单邮件通知|正在读取邮件状态/); assert.match(html, /重新读取邮件状态/);
  assert.doesNotMatch(html, /已送达|已发送|重新发送|mailto:|<form|<input/);
  assert.match(html, /booking-order-email-status__refresh/); assert.doesNotMatch(html, /text-teal-700|border-slate/);
});
