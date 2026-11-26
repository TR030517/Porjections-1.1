import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

test('complete booking numbers travel as bookingNo alongside shop and pagination; legacy bookingId stays independent', async () => {
  const calls = [];
  axios.defaults.adapter = async config => {
    calls.push({ url: config.url, params: config.params });
    return { config, data: { items: [], total: 0, page: 1, pageSize: 25 }, status: 200, statusText: 'OK', headers: {} };
  };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { listCases } = await vite.ssrLoadModule('/src/api/afterSales.ts');
    const query = { page: 1, pageSize: 25, bookingNo: 'MJ0123456789abcdef012345678', status: 'OPEN' };
    await listCases('1336', query);
    await listCases('1336', { page: 1, pageSize: 25, bookingId: '16' });
    assert.deepEqual(calls, [
      { url: '/after-sales', params: { ...query, shopId: '1336' } },
      { url: '/after-sales', params: { page: 1, pageSize: 25, bookingId: '16', shopId: '1336' } },
    ]);
  } finally { await vite.close(); }
});

test('merchant case list directs account-backed and offline intake to the available workflows', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { default: AfterSalesPage } = await vite.ssrLoadModule('/src/pages/after-sales/index.tsx');
    const html = renderToStaticMarkup(React.createElement(
      MemoryRouter, { initialEntries: ['/after-sales'] }, React.createElement(AfterSalesPage),
    ));
    assert.match(html, /请顾客登录后在对应预约中提交售后申请。/);
    assert.match(html, /电话或到店反馈若无法通过顾客账号提交，请先线下留档。/);
    assert.match(html, /改期和到店付款退款请打开预约详情/);
    assert.match(html, /历史线上付款请在对应退款工单中核对原渠道退款/);
  } finally { await vite.close(); }
});
