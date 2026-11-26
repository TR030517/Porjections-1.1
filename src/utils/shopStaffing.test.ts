import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readStaffingSnapshot, buildStaffingPayload, staffingDisplayName } from './shopStaffing';
const person = { id: '9007199254740993', shopId: '5', name: 'Alice', avatarUrl: null, title: 'Original', bio: 'Keep', yearsExp: 12, gender: null, isActive: true, scheduleMode: 'CUSTOM', sortOrder: 9 };
const snapshot = () => ({ shopId: '5', activeCount: 1, revision: 'a'.repeat(64), serviceAccessMode: 'SHOP_ALL', canManageStaff: true, canManageExceptions: true, therapists: [structuredClone(person)] });
test('staffing reads preserve exact IDs and existing custom profiles without inventing service qualifications', () => {
  const data = snapshot(), copy = structuredClone(data), value = readStaffingSnapshot(data, '5');
  assert.deepEqual(value.therapists[0], person); assert.deepEqual(data, copy);
  assert.equal(staffingDisplayName('Therapist 2'), '2号技师'); assert.equal(staffingDisplayName('Alice'), 'Alice');
});
test('wrong shop, inconsistent active count and partial or foreign change receipts cannot be accepted', () => {
  for (const patch of [{ shopId: '6' }, { activeCount: 2 }, { therapists: [person, person] }, { createdIds: [person.id] }, { createdIds: [], deactivatedIds: ['99'] }, { createdIds: [], deactivatedIds: [person.id] }]) assert.throws(() => readStaffingSnapshot({ ...snapshot(), ...patch }, '5'));
  assert.throws(() => readStaffingSnapshot({ ...snapshot(), therapists: [{ ...person, shopId: '6' }] }, '5'));
});
test('count commands contain only an explicit bounded target and the original revision', () => {
  assert.deepEqual(buildStaffingPayload('2', 'a'.repeat(64)), { targetActiveCount: 2, expectedRevision: 'a'.repeat(64) });
  for (const value of ['', null, -1, 101, 2.2, '2e1', '2.0']) assert.throws(() => buildStaffingPayload(value, 'a'.repeat(64)));
  assert.throws(() => buildStaffingPayload(2, ''));
});
