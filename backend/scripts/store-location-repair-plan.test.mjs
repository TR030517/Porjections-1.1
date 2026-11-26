import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRepairUrl, timezoneBackfillPlan, confirmedLocationRepairPlan, planDigest, applyLocationPlan } from './store-location-repair-plan.mjs';

const shop = (extra = {}) => ({ id: 1n, address: '123 Example St', city: 'Seattle', state: 'Washington', zipCode: '98144', timezone: null,
  updatedAt: new Date('2026-11-06T00:00:00Z'), studioProfile: {}, ...extra });
const migrated = (extra = {}) => shop({ id: 943n, city: 'Fort Wayne', state: 'Illinois', zipCode: '46815', timezone: 'America/Chicago',
  studioProfile: { legacyImport: { source: 'Massajoy1.0', sourceShopId: '1310' } }, ...extra });

test('default backfill fills only blank timezones and keeps a manual exception', () => {
  const rows = [shop(), shop({ id: 2n, timezone: '' }), shop({ id: 3n, timezone: 'Pacific/Honolulu' }), shop({ id: 4n, timezone: 'America/Los_Angeles' })];
  const result = timezoneBackfillPlan(rows);
  assert.equal(result.changes.length, 2);
  assert.ok(result.changes.every(change => change.data.timezone === 'America/Los_Angeles'));
  assert.equal(result.preserved, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(timezoneBackfillPlan(rows, { overwriteExisting: true }).changes.length, 3);
});

test('backfill skips unresolved and contradictory addresses even when explicitly overwriting', () => {
  const result = timezoneBackfillPlan([shop({ id: 2n, city: '', state: '', zipCode: '' }), shop({ id: 3n, zipCode: '79901' })], { overwriteExisting: true });
  assert.deepEqual(result.unresolved, ['2']);
  assert.deepEqual(result.conflicts, ['3']);
  assert.deepEqual(result.changes, []);
});

test('a completed backfill is idempotent and its digest covers the address preimage', () => {
  const row = shop();
  const plan = timezoneBackfillPlan([row]);
  assert.equal(timezoneBackfillPlan([{ ...row, ...plan.changes[0].data }]).changes.length, 0);
  assert.notEqual(planDigest(plan.changes), planDigest([{ ...plan.changes[0], before: { ...row, zipCode: '98101' } }]));
});

test('confirmed state repair requires the source identity and exact city/state/ZIP preimage', () => {
  const first = confirmedLocationRepairPlan([migrated()]);
  assert.deepEqual(first.changes[0].data, { state: 'Indiana' });
  assert.deepEqual(first.preservedTimezones, [{ id: '943', current: 'America/Chicago', suggested: 'America/New_York' }]);
  assert.equal(confirmedLocationRepairPlan([migrated({ state: 'Indiana' })]).changes.length, 0);
  assert.equal(confirmedLocationRepairPlan([migrated({ zipCode: '46221' })]).changes.length, 0);
  assert.equal(confirmedLocationRepairPlan([migrated({ studioProfile: {} })]).changes.length, 0);
  const ambiguous = shop({ id: 1085n, city: 'Jacksonville', state: 'Florida', zipCode: '46902' });
  const result = confirmedLocationRepairPlan([ambiguous]);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.conflicts, ['1085']);
});

test('explicit known migration timezone repair still preserves unrelated manual values', () => {
  const options = { repairKnownTimezones: true };
  assert.deepEqual(confirmedLocationRepairPlan([migrated()], options).changes[0].data, { state: 'Indiana', timezone: 'America/New_York' });
  assert.deepEqual(confirmedLocationRepairPlan([migrated({ timezone: 'Pacific/Honolulu' })], options).changes[0].data, { state: 'Indiana' });
  const plan = confirmedLocationRepairPlan([migrated()], options);
  assert.equal(confirmedLocationRepairPlan([{ ...migrated(), ...plan.changes[0].data }], options).changes.length, 0);
});

function fixture({ count = 1, bookings = 0, locks = 0 } = {}) {
  const writes = [], events = [];
  const tx = { $queryRaw: async () => { events.push('lock-shop'); return []; }, booking: { count: async () => bookings }, bookingResourceLock: { count: async () => locks },
    shop: { updateMany: async input => { events.push('update'); writes.push(input); return { count }; } } };
  return { writes, events, db: { $transaction: async callback => callback(tx) } };
}

test('repair locks the shop then uses a compare-and-set update and never writes publication or booking snapshots', async () => {
  const f = fixture(); const row = migrated();
  await applyLocationPlan(f.db, [{ before: row, data: { state: 'Indiana', timezone: 'America/New_York' } }]);
  assert.deepEqual(f.events, ['lock-shop', 'update']);
  assert.equal(f.writes[0].where.updatedAt, row.updatedAt);
  assert.equal(f.writes[0].where.state, 'Illinois');
  assert.equal(f.writes[0].where.timezone, 'America/Chicago');
  assert.deepEqual(Object.keys(f.writes[0].data).sort(), ['state', 'timezone']);
});

test('future reservations or resource locks prevent any timezone writes', async () => {
  for (const options of [{ bookings: 1 }, { locks: 1 }]) {
    const f = fixture(options);
    await assert.rejects(applyLocationPlan(f.db, [{ before: migrated(), data: { timezone: 'America/New_York' } }]), /future reservations/);
    assert.equal(f.writes.length, 0);
  }
});

test('a concurrent address edit aborts the transaction rather than overwriting the new record', async () => {
  const f = fixture({ count: 0 });
  await assert.rejects(applyLocationPlan(f.db, [{ before: migrated(), data: { state: 'Indiana' } }]), /changed after planning/);
});

test('the repair executor refuses publication changes before starting a transaction', async () => {
  let opened = false;
  await assert.rejects(applyLocationPlan({ $transaction: async () => { opened = true; } }, [{ before: migrated(), data: { status: 'SUSPENDED' } }]), /only state and timezone/);
  assert.equal(opened, false);
});

test('repair cannot target production, a remote host, a different port or database', () => {
  const valid = 'mysql://test:example@127.0.0.1:33090/mj2_store_migration_84cec1e6';
  assert.equal(localRepairUrl(valid, 'development'), valid);
  assert.throws(() => localRepairUrl(valid, 'production'), /local-only/);
  assert.throws(() => localRepairUrl(valid.replace('127.0.0.1', 'db.example.com')), /restricted/);
  assert.throws(() => localRepairUrl(valid.replace('33090', '3306')), /restricted/);
  assert.throws(() => localRepairUrl(valid.replace('84cec1e6', '00000000')), /restricted/);
});
