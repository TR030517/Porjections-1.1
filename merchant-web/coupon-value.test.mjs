import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('coupon form rejects fractional percentages and saves whole percentages or dollar cents without changing their value', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { couponValueForApi } = await vite.ssrLoadModule('/src/utils/couponValue.ts');
    const { merchantCouponsApi } = await vite.ssrLoadModule('/src/api/coupons.ts');
    const { default: client } = await vite.ssrLoadModule('/src/api/client.ts');
    const requests = [], previous = client.defaults.adapter;
    client.defaults.adapter = async config => {
      requests.push({ url: config.url, method: config.method, data: JSON.parse(config.data) });
      return { config, data: { id: '8' }, status: 200, statusText: 'OK', headers: {} };
    };
    try {
      assert.throws(() => couponValueForApi('PERCENT', 12.5), /整数/);
      for (const value of [0, 0.01, 101]) assert.throws(() => couponValueForApi('PERCENT', value), /整数/);
      const shared = { title: 'Synthetic coupon', status: 'ACTIVE', perUserLimit: 1, totalQuantity: 0 };
      await merchantCouponsApi.create('5', { ...shared, type: 'PERCENT', value: couponValueForApi('PERCENT', 20) });
      await merchantCouponsApi.create('5', { ...shared, type: 'FIXED_AMOUNT', value: couponValueForApi('FIXED_AMOUNT', 12.5) });
      assert.deepEqual(requests.map(request => [request.url, request.method, request.data.type, request.data.value]), [
        ['/merchant/shops/5/coupons', 'post', 'PERCENT', 20],
        ['/merchant/shops/5/coupons', 'post', 'FIXED_AMOUNT', 1250],
      ]);
      assert.equal(couponValueForApi('FIXED_AMOUNT', 0.29), 29);
      assert.throws(() => couponValueForApi('FIXED_AMOUNT', 12.501), /两位小数/);
    } finally { client.defaults.adapter = previous; }
  } finally { await vite.close(); }
});

test('coupon minimum spend accepts exact USD at API bounds, reopens unchanged and excludes claimed terms', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { couponEditableTerms, couponMinSpendDraft } = await vite.ssrLoadModule('/src/utils/couponValue.ts');
    const { merchantCouponsApi } = await vite.ssrLoadModule('/src/api/coupons.ts');
    const { default: client } = await vite.ssrLoadModule('/src/api/client.ts');
    const previous = client.defaults.adapter, writes = [];
    client.defaults.adapter = async config => {
      const body = JSON.parse(config.data); writes.push(body);
      return { config, data: { id: '8', ...body }, status: 200, statusText: 'OK', headers: {} };
    };
    try {
      for (const [minSpendUsd, cents] of [[0, 0], [0.01, 1], [0.29, 29], [40, 4000], [100.25, 10025], [21474836.47, 2147483647]]) {
        const terms = couponEditableTerms({ type: 'PERCENT', value: 20, minSpendUsd }, false);
        await merchantCouponsApi.create('5', { title: 'Synthetic coupon', ...terms });
        assert.equal(writes.at(-1).minSpendCents, cents); assert.equal(writes.at(-1).value, 20);
        const reopened = couponMinSpendDraft(cents);
        await merchantCouponsApi.update('5', '8', couponEditableTerms({ type: 'FIXED_AMOUNT', value: 0.29, minSpendUsd: reopened }, false));
        assert.equal(writes.at(-1).minSpendCents, cents); assert.equal(writes.at(-1).value, 29);
        assert.equal(Object.hasOwn(writes.at(-1), 'minSpendUsd'), false);
      }
      for (const minSpendUsd of [-0.01, 0.001, 40.001, 21474836.48, NaN, Infinity]) assert.throws(() => couponEditableTerms({ type: 'PERCENT', value: 20, minSpendUsd }, false));
      const shared = { title: 'Only editable metadata', description: '', status: 'PAUSED', totalQuantity: 3 };
      await merchantCouponsApi.update('5', '8', { ...shared, ...couponEditableTerms({ type: 'PERCENT', value: 12.5, minSpendUsd: -1 }, true) });
      assert.deepEqual(writes.at(-1), shared, 'claimed coupon updates must not resend historical money/percentage terms');
    } finally { client.defaults.adapter = previous; }
  } finally { await vite.close(); }
});
