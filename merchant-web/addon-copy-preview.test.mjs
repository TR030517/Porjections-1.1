import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let server, AddOnCopySummary;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  ({ AddOnCopySummary } = await server.ssrLoadModule('/src/components/CopyConfigPanel.tsx'));
});
after(async () => { await server?.close(); });
const text = value => value.replace(/<[^>]*>/g, '');
const row = index => ({ sourceId: String(index + 1), sourceServiceId: '101', sourceServiceName: 'Source primary',
  targetServiceId: '201', targetServiceName: 'Target primary', name: `Oil ${index}`, description: '原文说明',
  priceCents: index === 0 ? 0 : 1025, currency: 'usd', sortOrder: index, sourceActive: index % 2 === 0,
  action: 'CREATE', reasonCode: 'NEW', reason: '新建后须手动核对启用' });

test('merchant addon preview is bounded to a visible page but keeps the complete plan and precise target identities', () => {
  const rows = Array.from({ length: 25 }, (_, index) => row(index)), original = structuredClone(rows);
  const html = renderToStaticMarkup(createElement(AddOnCopySummary, { rows })), words = text(html);
  assert.ok(words.includes('共 25 条来源附加配置')); assert.ok(words.includes('拟新增 25 条'));
  assert.ok(words.includes('确认应用完整签名计划，包含所有页'));
  for (const value of ['Source primary', '#101', 'Target primary', '#201', 'USD 0.00', 'USD 10.25', '已启用', '已停用', 'Oil 19']) assert.ok(words.includes(value));
  assert.doesNotMatch(words, /Oil 20|Oil 24/);
  assert.equal((words.match(/新增独立副本（默认停用）/g) ?? []).length, 20);
  assert.deepEqual(rows, original); assert.equal(rows.length, 25);
});

test('merchant addon preview makes an empty source explicit and explains missing ambiguous and existing targets without inventing one', () => {
  const empty = text(renderToStaticMarkup(createElement(AddOnCopySummary, { rows: [] })));
  assert.ok(empty.includes('来源门店没有可复制的附加项目'));
  const rows = [
    { ...row(0), targetServiceId: null, targetServiceName: null, action: 'SKIP', reasonCode: 'MAIN_NOT_FOUND' },
    { ...row(1), sourceServiceId: '102', targetServiceId: null, targetServiceName: null, action: 'SKIP', reasonCode: 'AMBIGUOUS_MAIN' },
    { ...row(2), sourceServiceId: '103', action: 'SKIP', reasonCode: 'TARGET_NAME_EXISTS' },
  ];
  const words = text(renderToStaticMarkup(createElement(AddOnCopySummary, { rows })));
  for (const value of ['拟新增 0 条', '跳过 3 条', '未指定目标主服务', '请先复制项目与价目', '匹配不唯一', '保留原配置', '跳过，不改目标']) assert.ok(words.includes(value));
  assert.doesNotMatch(words, /新增独立副本（默认停用）/);
});
