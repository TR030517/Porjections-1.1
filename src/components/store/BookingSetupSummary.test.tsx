import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BookingSetupIssue } from '../../utils/bookingSetup';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('/BookingSetupSummary.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { BookingSetupFindings } = await import('./BookingSetupSummary');

test('weekly findings identify the relevant therapist and do not display a ready message', () => {
  const issue: BookingSetupIssue = { key: '9:schedule', serviceId: '9', serviceName: 'Four hands', kind: 'schedule', therapistId: '20', message: '需要两位技师同时覆盖服务与缓冲；请核对 Alice 与 Bob 的共同班次。', action: '核对共同班次' };
  let calls = 0;
  const html = renderToStaticMarkup(<BookingSetupFindings issues={[issue]} onConfigure={() => { calls++; }} />);
  assert.match(html, /Four hands/); assert.match(html, /Alice 与 Bob/); assert.match(html, /核对共同班次/);
  assert.doesNotMatch(html, /配置已齐备/); assert.equal(calls, 0, 'rendering never navigates or writes configuration');
});
test('a passing weekly template does not claim a date-specific appointment is available', () => {
  const html = renderToStaticMarkup(<BookingSetupFindings issues={[]} onConfigure={() => { throw Error('Unexpected action'); }} />);
  assert.match(html, /每周基础配置已齐备/); assert.match(html, /具体日期仍须查询可用时段/);
});
