import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TechnicianTeam, StaffingCountPanel } from './StoreTechnicians';
import { navItems } from './Sidebar';
import type { StaffMember } from '../utils/shopStaffing';
import type { StaffingEditorState } from '../utils/staffingEditor';
const person: StaffMember = { id: '8', shopId: '5', name: 'Therapist 1', avatarUrl: null, title: null, bio: null, yearsExp: 0, gender: null, isActive: true, scheduleMode: 'SHOP', sortOrder: 1 };
const actions = { onEdit: () => {}, onReservations: () => {} };
test('technicians remain inside store editing without a global sidebar entry', () => {
  assert.equal(navItems.some(item => item.id === 'technicians' || item.id === 'services'), false);
  assert.ok(navItems.find(item => item.id === 'store-list')?.children?.some(item => item.id === 'store-list'));
});
test('primary staffing panel asks for a count without requiring individual profiles or service choices', () => {
  const state: StaffingEditorState = { snapshot: { shopId: '5', activeCount: 2, revision: 'a'.repeat(64), serviceAccessMode: 'SHOP_ALL', canManageStaff: true, canManageExceptions: true, therapists: [] }, target: 3, loading: false, saving: false, verified: true, reviewed: false, attempt: null, outcome: 'NONE', error: '' };
  const html = renderToStaticMarkup(<StaffingCountPanel state={state} disabled={false} onChange={() => {}} onRead={() => {}} onSave={() => {}} onReviewed={() => {}} />);
  for (const label of ['技师人数', '保存人数', '本店全部项目', '跟随门店营业时间', '两位技师']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /服务 ID|技师姓名|性别|工作年限|新增本店技师/);
});

test('zero staff explains the booking blocker without inventing an initial staff count', () => {
  const state: StaffingEditorState = { snapshot: { shopId: '5', activeCount: 0, revision: 'a'.repeat(64), serviceAccessMode: 'SHOP_ALL', canManageStaff: true, canManageExceptions: true, therapists: [] }, target: 0, loading: false, saving: false, verified: true, reviewed: false, attempt: null, outcome: 'NONE', error: '' };
  const html = renderToStaticMarkup(<StaffingCountPanel state={state} disabled={false} onChange={() => {}} onRead={() => {}} onSave={() => {}} onReviewed={() => {}} />);
  assert.match(html, /请输入门店实际人数并保存/); assert.match(html, /人数为 0 时顾客无法预约/);
  assert.match(html, /type="number"[^>]*value="0"/);
  assert.match(html, /系统不会推定人数/);
});
test('individual staff profiles start collapsed, preserve custom data and never expose a global reassignment field', () => {
  const html = renderToStaticMarkup(<TechnicianTeam storeName="A店" rows={[person, { ...person, id: '9', name: 'Alice', scheduleMode: 'CUSTOM', isActive: false }]} {...actions} />);
  assert.match(html, /<details/); assert.doesNotMatch(html, /<details[^>]*\bopen/);
  for (const label of ['可选', '1号技师', 'Alice', '历史资料保留', '个人特殊安排', '基本信息', '特殊安排']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /门店 ID|服务 ID|编辑资格|停用<\/button>/);
});
