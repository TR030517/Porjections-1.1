import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StoreProjectAddOns from './StoreProjectAddOns';
import type { ProjectCatalogAddOn } from '../../utils/projectCatalog';
import { AuthProvider } from '../../stores/authStore';
const items: ProjectCatalogAddOn[] = [{ id: '8', serviceId: '5', name: 'Synthetic oil', description: 'Synthetic only', priceCents: 0, currency: 'usd', sortOrder: 0, isActive: false, preview: null }];
const render = (rows = items, disabled = false) => renderToStaticMarkup(<AuthProvider><StoreProjectAddOns shopId="2" serviceId="5" items={rows} disabled={disabled} beforeWrite={() => { throw Error('SSR must not request writes'); }} onLifecycleChange={() => {}} onSaved={() => { throw Error('SSR must not save'); }} /></AuthProvider>);
test('add-on section shows exact own state and zero price without a store form or payment controls', () => {
  const html = render(); assert.match(html, /Synthetic oil/); assert.match(html, /0\.00 USD/); assert.match(html, /附加项已停用/);
  assert.match(html, /不增加预约分钟/); assert.doesNotMatch(html, /<form|登记收款|房间清理|服务人数/);
});
test('foreign-parent rows are not displayed as this project and cannot open editing', () => {
  const html = render([{ ...items[0], serviceId: '6', name: 'Foreign hidden' }]);
  assert.match(html, /当前门店项目不匹配/); assert.doesNotMatch(html, /Foreign hidden/); assert.match(html, /disabled/);
});
