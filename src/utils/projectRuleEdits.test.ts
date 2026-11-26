import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmProjectWrite, focusedReservationService, projectWriteAllowed, reservationRulesTab } from './projectRuleEdits';
import type { ReservationService } from '../types/reservations';

test('single-project rules require exact project and shop and never fall back to the first row', () => {
  const services = [{ id: '9007199254740993', shopId: '5', name: 'First' }, { id: '9007199254740995', shopId: '5', name: 'Selected' }] as ReservationService[];
  assert.equal(focusedReservationService(services, '5', '9007199254740995')?.name, 'Selected');
  for (const [shop, service] of [['6', '9007199254740995'], ['5', undefined], ['5', '404'], ['5', 9007199254740992], [undefined, '9007199254740993']]) assert.equal(focusedReservationService(services, shop, service), undefined);
});
test('focused and resource-only modes expose disjoint tabs even when an old deep link asks for services', () => {
  assert.equal(reservationRulesTab('rooms', true, true), 'services');
  assert.equal(reservationRulesTab('services', false, true), 'therapists');
  assert.equal(reservationRulesTab(undefined, false, true), 'therapists');
  assert.equal(reservationRulesTab('rooms', false, true), 'rooms');
  assert.equal(reservationRulesTab('services'), 'services');
});
test('fresh parent write gate can reject external menu edits without treating this own editor draft as a denial', () => {
  let menuDirty = false, current = true, calls = 0;
  const gate = () => { calls++; return !menuDirty; };
  assert.equal(projectWriteAllowed(() => current, gate), true);
  menuDirty = true; assert.equal(projectWriteAllowed(() => current, gate), false);
  current = false; assert.equal(projectWriteAllowed(() => current, gate), false); assert.equal(calls, 2);
});
test('a menu change or scope switch during confirmation prevents dispatch; cancellation does not dispatch either', async () => {
  let dirty = false, alive = true, writes = 0;
  assert.equal(await confirmProjectWrite(() => alive, () => !dirty, async () => { dirty = true; return true; }, async () => { writes++; }), false);
  dirty = false;
  assert.equal(await confirmProjectWrite(() => alive, () => !dirty, async () => { alive = false; return true; }, async () => { writes++; }), false);
  alive = true;
  assert.equal(await confirmProjectWrite(() => alive, () => true, async () => false, async () => { writes++; }), false);
  assert.equal(writes, 0);
  assert.equal(await confirmProjectWrite(() => alive, () => true, async () => true, async () => { writes++; }), true); assert.equal(writes, 1);
});
