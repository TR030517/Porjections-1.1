import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

test('gift API and rendered timestamps keep store dates and DST offsets on different device zones', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const oldTimezone = process.env.TZ, oldAdapter = axios.defaults.adapter;
  const order = { id: '9', shopId: '7', userId: '3', currency: 'usd', status: 'PAID', amountCents: 2000, paidCents: 2000, refundedCents: 0,
    createdAt: '2026-11-01T05:30:00Z', timezone: 'America/New_York', createdAtLocal: '2026-11-01 01:30 GMT-4', receipts: [], refunds: [], allowedActions: { cancel: false, recordReceipt: false, recordRefund: true } };
  axios.defaults.adapter = async config => ({ config, data: { item: order }, status: 200, statusText: 'OK', headers: {} });
  try {
    const { giftTimestamp } = await vite.ssrLoadModule('/src/utils/giftTime.ts');
    const { getGiftOrder } = await vite.ssrLoadModule('/src/api/gifts.ts');
    const row = await getGiftOrder('7', '9');
    assert.equal(row.timezone, 'America/New_York');
    for (const device of ['UTC', 'Asia/Shanghai', 'Pacific/Honolulu']) {
      process.env.TZ = device;
      assert.equal(giftTimestamp(row.createdAt, row.timezone), '2026-11-01 01:30:00 GMT-4 · America/New_York');
      assert.equal(giftTimestamp('2026-11-01T06:30:00Z', row.timezone), '2026-11-01 01:30:00 GMT-5 · America/New_York');
      assert.equal(giftTimestamp('2027-01-01T02:30:00Z', row.timezone), '2026-12-31 21:30:00 GMT-5 · America/New_York');
      assert.equal(giftTimestamp('2026-03-08T10:00:00Z', 'America/Los_Angeles'), '2026-03-08 03:00:00 GMT-7 · America/Los_Angeles');
    }
    for (const zone of [undefined, null, '', 'Invalid/Zone']) assert.equal(giftTimestamp(row.createdAt, zone), '门店时区未配置');
    assert.equal(giftTimestamp('2026-11-01T01:30:00', row.timezone), '— · America/New_York');
    assert.equal(row.createdAt, '2026-11-01T05:30:00Z');
  } finally {
    axios.defaults.adapter = oldAdapter;
    if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone;
    await vite.close();
  }
});
