import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider } from '../../stores/authStore';
import StoreProjectMetadata from './StoreProjectMetadata';
import type { ProjectCatalogItem } from '../../utils/projectCatalog';

const project = { id: '9', shopId: '5', name: 'Body Massage', category: 'MASSAGE', description: 'Saved project details', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 8000, hasVariants: false, variantCount: 0 } as ProjectCatalogItem;
const render = (item: ProjectCatalogItem, disabled = false) => renderToStaticMarkup(<AuthProvider><StoreProjectMetadata project={item} disabled={disabled} beforeWrite={() => { throw Error('SSR must never request a write'); }} onLifecycleChange={() => {}} onSaved={() => { throw Error('SSR must never save'); }} /></AuthProvider>);

test('a non-variant project editor exposes explicit metadata and amount/time values without create or resource reassignment', () => {
  const html = render(project);
  assert.match(html, /项目名称/); assert.match(html, /项目类别/); assert.match(html, /项目说明/); assert.match(html, /项目时长类型/);
  assert.match(html, /固定服务时长（分钟）/); assert.match(html, /项目价格（美元）/); assert.match(html, /value="80.00"/); assert.match(html, /value="60"/);
  assert.match(html, /保存本服务共同资料/); assert.match(html, /历史订单快照保留/);
  assert.doesNotMatch(html, /新增项目|创建项目|所属门店|服务编号/);
  assert.equal((html.match(/<form\b/g) ?? []).length, 1);
});

test('variant families omit editable unused base inputs while keeping shared parent consequences explicit', () => {
  const html = render({ ...project, hasVariants: true, variantCount: 2, durationKind: null, durationMin: 15, priceCents: 0 } as ProjectCatalogItem);
  assert.match(html, /本项目有 2 个规格/); assert.match(html, /整组共用/); assert.match(html, /各规格价格和时长在下方“规格与价格”维护/);
  assert.doesNotMatch(html, /项目时长类型|项目价格（美元）|type="number"|value="15"|value="0.00"/);
  assert.match(html, /暂停会阻止本项目及全部规格接受新预约/);
});

test('read-only legacy project metadata is rendered without inventing booking values or enabling save', () => {
  const html = render({ ...project, category: null, durationKind: null, durationMin: null, priceCents: null } as ProjectCatalogItem, true);
  assert.match(html, /<fieldset[^>]*disabled/); assert.match(html, /请选择时长类型/); assert.match(html, /服务时长／预约预留（分钟）/);
  assert.doesNotMatch(html, /value="15"|value="0.00"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
});
