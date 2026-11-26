import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReservationSettings from './ReservationSettings';
import { AuthProvider } from '../stores/authStore';

test('focused rule entry requires explicit project/shop and never offers global store selection or payment policy', () => {
  const html = renderToStaticMarkup(<AuthProvider><ReservationSettings serviceOnly initialServiceId="5" onBack={() => {}} onManageQualifications={() => {}} beforeWrite={() => { throw Error('SSR must not gate writes'); }} /></AuthProvider>);
  assert.match(html, /规格与价格/); assert.match(html, /请明确选择本店项目/);
  assert.doesNotMatch(html, /选择门店|到店付款政策|选择服务|空间与维护/);
});
test('serviceOnly and resourcesOnly rendering stay independent', () => {
  const focused = renderToStaticMarkup(<AuthProvider><ReservationSettings serviceOnly resourcesOnly explicitShopId="2" initialServiceId="5" initialTab="rooms" onBack={() => {}} onManageQualifications={() => {}} /></AuthProvider>);
  assert.match(focused, /规格与价格/); assert.doesNotMatch(focused, /到店付款政策|预约设置分区/);
});
