import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const serverOptions = { server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' };

test('merchant notice control displays persisted 720 minutes as 12 hours and previews the actual closure date/phone', async () => {
  const server = await createServer(serverOptions);
  try {
    const { ShopBookingSettingsPanel } = await server.ssrLoadModule('/src/pages/reservations/ShopBookingSettingsPanel.tsx');
    let writes = 0;
    const props = { settings: { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2026-11-11', endDate: '2026-11-20' }] }, timezone: 'America/Los_Angeles', phone: '202-555-0144', disabled: false, dirty: false, onChange: () => writes++, onSave: () => writes++ };
    const html = renderToStaticMarkup(React.createElement(ShopBookingSettingsPanel, props));
    assert.match(html, /aria-label="最短提前预约时间"[^>]*value="12(?:\.0+)?"/);
    assert.doesNotMatch(html, /aria-label="最短提前预约时间"[^>]*value="720"/);
    assert.match(html, /Closed from Nov 11, 2026 to Nov 20, 2026/);
    assert.match(html, /202-555-0144/); assert.match(html, /保存预约规则后生效/);
    assert.equal(writes, 0, 'reading settings and previewing announcements never saves or changes the policy');
    const missingTimezone = renderToStaticMarkup(React.createElement(ShopBookingSettingsPanel, { ...props, timezone: null }));
    assert.match(missingTimezone, /设置门店时区/);
    const add = missingTimezone.match(/<button[^>]*disabled=""[^>]*>[\s\S]*?<span>添加闭店日期<\/span><\/button>/);
    assert.ok(add, 'missing timezone cannot add a UTC-derived closure');
  } finally { await server.close(); }
});

test('merchant booking rule adapter validates before submission and confirms same-shop exact notice/date round trips', async () => {
  const server = await createServer(serverOptions);
  const original = axios.defaults.adapter;
  const calls = [];
  let receiptShopId = '5';
  const settings = { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2026-12-31', endDate: '2027-01-02' }, { startDate: '2026-11-11', endDate: '2026-11-20' }] };
  axios.defaults.adapter = async config => {
    const requestBody = config.data ? JSON.parse(config.data) : undefined;
    if (requestBody) assert.equal(requestBody.expectedSettingsHash, 'a'.repeat(64));
    const body = requestBody ? { minimumNoticeMinutes: requestBody.minimumNoticeMinutes, closedPeriods: requestBody.closedPeriods } : { ...settings, closedPeriods: [...settings.closedPeriods].reverse() };
    calls.push({ method: config.method, url: config.url, body });
    return { config, data: config.method === 'patch' ? { item: { shopId: receiptShopId, bookingSettings: body, bookingSettingsHash: 'a'.repeat(64) } } : { shopId: receiptShopId, bookingSettings: body, bookingSettingsHash: 'a'.repeat(64) }, status: 200, statusText: 'OK', headers: {} };
  };
  try {
    const { saveShopBookingSettings, getShopBookingSettings } = await server.ssrLoadModule('/src/api/reservations.ts');
    const receipt = await saveShopBookingSettings('5', settings, 'a'.repeat(64));
    const saved = receipt.bookingSettings;
    assert.equal(receipt.bookingSettingsHash, 'a'.repeat(64)); assert.equal('bookingSettingsHash' in saved, false);
    assert.equal(saved.minimumNoticeMinutes, 720); assert.equal(saved.closedPeriods[0].startDate, '2026-11-11');
    assert.deepEqual(await getShopBookingSettings('5'), saved);
    for (const bad of [
      { ...settings, minimumNoticeMinutes: NaN },
      { ...settings, closedPeriods: [{ startDate: '2026-02-30', endDate: '2026-03-01' }] },
      { ...settings, closedPeriods: [settings.closedPeriods[0], settings.closedPeriods[0]] },
    ]) await assert.rejects(saveShopBookingSettings('5', bad, 'a'.repeat(64)));
    await assert.rejects(saveShopBookingSettings('5', settings, ''), /版本缺失/);
    assert.equal(calls.filter(call => call.method === 'patch').length, 1);
    receiptShopId = '6';
    await assert.rejects(saveShopBookingSettings('5', settings, 'a'.repeat(64)), /无法确认/);
  } finally { axios.defaults.adapter = original; await server.close(); }
});
