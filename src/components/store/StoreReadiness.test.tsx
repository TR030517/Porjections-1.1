import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ShopReadiness } from '../../api/shopReadiness';
import { BookingConfigurationLinks, ReadinessStatusCards } from './StoreReadiness';

function snapshot(): ShopReadiness {
  return {
    schemaVersion: 1, checkedAt: '2026-11-06T00:00:00.000Z', shop: { id: '5', name: 'Synthetic', status: 'APPROVED' },
    publication: { ready: true, publicVisible: true, checks: [] },
    access: { loginReady: false, checks: [{ key: 'loginReady', label: '账号暂停', state: 'ATTENTION', detail: '管理员暂未开放登录。', action: { kind: 'accounts' } }] },
    booking: { enabled: true, payAtStoreEnabled: false, checks: [] }, presentation: { checks: [] },
    services: [], summary: { activeServices: 0, disabledServices: 0, activeServicesWithFindings: 0 }, limitations: [],
  };
}

test('missing hours and staff expose one direct setup action each without claiming a published store can take bookings', () => {
  const data = snapshot();
  data.publication.checks.push({ key: 'hours', label: '营业时间', state: 'ATTENTION', detail: '本店暂无可靠营业时段。' });
  data.services = ['7', '8'].map(id => ({ id, name: 'Service ' + id, isActive: true, mode: 'LEGACY', checks: [{ key: 'staff', label: '本店启用技师', state: 'ATTENTION', detail: '0人', action: { kind: 'technicians' } }] }));
  let calls = 0;
  const html = renderToStaticMarkup(<BookingConfigurationLinks data={data} onAction={() => { calls++; }} />);
  assert.match(html, /设置营业时间/); assert.match(html, /设置技师人数/); assert.match(html, /2 个启用项目的技师人数不足/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.doesNotMatch(html, /配置账号|账号暂停|已可预约/);
  assert.equal(calls, 0, 'reading a configuration summary never mutates or navigates');
});

test('an intentionally disabled account alone does not create a booking setup warning', () => {
  const html = renderToStaticMarkup(<BookingConfigurationLinks data={snapshot()} onAction={() => { throw new Error('Unexpected navigation'); }} />);
  assert.equal(html, '');
});


test('published, intentionally disabled login and incomplete booking remain three independent saved states', () => {
  const data=snapshot(), before=structuredClone(data);
  const html=renderToStaticMarkup(<ReadinessStatusCards data={data} />);
  assert.match(html,/顾客展示/); assert.match(html,/已发布/);
  assert.match(html,/商家登录/); assert.match(html,/尚未开放登录/);
  assert.match(html,/线上预约/); assert.match(html,/开关已开启 · 配置待完善/);
  assert.doesNotMatch(html,/已可预约|<button|<input/);
  assert.deepEqual(data,before,'snapshot rendering neither enables nor changes any state');
  data.access.loginReady=true;data.booking.enabled=false;
  const other=renderToStaticMarkup(<ReadinessStatusCards data={data} />);
  assert.match(other,/具备登录条件/);assert.match(other,/预约开关已关闭/);assert.match(other,/已发布/);
});

test('passing saved configuration still distinguishes available slots from the booking toggle', () => {
  const data=snapshot();data.summary.activeServices=1;
  const html=renderToStaticMarkup(<ReadinessStatusCards data={data} />);
  assert.match(html,/开关已开启 · 配置检查通过/);
  assert.match(html,/实际可约时间仍按营业时间、技师和已有占用计算/);
  data.summary.activeServicesWithFindings=1;
  assert.match(renderToStaticMarkup(<ReadinessStatusCards data={data} />),/配置待完善/);
});
