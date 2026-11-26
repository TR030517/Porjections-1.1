import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStaffingEditor } from './staffingEditor';
import type { StaffingSnapshot } from './shopStaffing';

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
function snapshot(count = 2, revision = a, shopId = '5', custom = false): StaffingSnapshot {
  return { shopId, activeCount: count, revision, serviceAccessMode: 'SHOP_ALL', canManageStaff: true, canManageExceptions: true,
    therapists: Array.from({ length: count }, (_, index) => ({ id: String(80 + index), shopId, name: index ? 'Therapist ' + (index + 1) : 'Retained personal name', avatarUrl: null, title: null,
      bio: index ? null : 'Existing profile', yearsExp: 12, gender: null, isActive: true, scheduleMode: custom && index === 0 ? 'CUSTOM' : 'SHOP', sortOrder: index })) };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let identity: { actorId: string; shopId: string } | null = { actorId: '1', shopId: '5' };
  let value: unknown = snapshot(), canWrite = true;
  let read: (shopId: string) => Promise<unknown> = async () => value;
  let write: (shopId: string, payload: { targetActiveCount: number; expectedRevision: string }) => Promise<unknown> = async (shopId, payload) => snapshot(payload.targetActiveCount, c, shopId);
  const reads: string[] = [], writes: Array<{ shopId: string; targetActiveCount: number; expectedRevision: string }> = [];
  const editor = createStaffingEditor({ identity: () => identity, canWrite: () => canWrite,
    read: async shopId => { reads.push(shopId); return read(shopId); },
    write: async (shopId, payload) => { writes.push({ shopId, ...payload }); return write(shopId, payload); } });
  editor.syncIdentity();
  return { editor, reads, writes, server: (next: unknown) => { value = next; },
    reader: (next: typeof read) => { read = next; }, writer: (next: typeof write) => { write = next; },
    identity: (next: typeof identity) => { identity = next; editor.syncIdentity(); }, permit: (next: boolean) => { canWrite = next; } };
}

test('a saved personal exception refreshes the retained model and supplies its new revision to the next count command', async () => {
  const f = fixture(); await f.editor.load(); f.server(snapshot(2, b, '5', true));
  assert.equal(await f.editor.refresh(), true);
  assert.equal(f.editor.getSnapshot().snapshot?.therapists[0].scheduleMode, 'CUSTOM');
  assert.equal(f.editor.getSnapshot().snapshot?.therapists[0].bio, 'Existing profile');
  assert.equal(f.editor.getSnapshot().target, 2); assert.equal(f.writes.length, 0);
  f.editor.changeTarget(3); await f.editor.save();
  assert.deepEqual(f.writes, [{ shopId: '5', targetActiveCount: 3, expectedRevision: b }]);
});

test('background refresh preserves an unsaved count target while a clean target follows the actual latest count', async () => {
  const dirty = fixture(); await dirty.editor.load(); dirty.editor.changeTarget(4); dirty.server(snapshot(3, b));
  await dirty.editor.refresh();
  assert.equal(dirty.editor.getSnapshot().target, 4); assert.equal(dirty.editor.getSnapshot().snapshot?.activeCount, 3);
  assert.equal(dirty.editor.getSnapshot().outcome, 'NONE'); assert.equal(dirty.writes.length, 0);
  await dirty.editor.save(); assert.equal(dirty.writes[0].expectedRevision, b);
  const clean = fixture(); await clean.editor.load(); clean.server(snapshot(3, b)); await clean.editor.refresh();
  assert.equal(clean.editor.getSnapshot().target, 3); assert.equal(clean.writes.length, 0);
});

test('an unknown count attempt survives sibling refresh and only an explicit read can enable acknowledgement', async () => {
  const f = fixture(); await f.editor.load(); f.editor.changeTarget(3);
  f.writer(async () => { throw Error('Synthetic lost reply'); }); await f.editor.save();
  const attempt = f.editor.getSnapshot().attempt, error = f.editor.getSnapshot().error;
  f.server(snapshot(3, b, '5', true)); await f.editor.refresh();
  assert.equal(f.editor.getSnapshot().outcome, 'UNKNOWN'); assert.equal(f.editor.getSnapshot().target, 3);
  assert.deepEqual(f.editor.getSnapshot().attempt, attempt); assert.equal(f.editor.getSnapshot().error, error);
  assert.equal(f.editor.getSnapshot().reviewed, false); assert.equal(f.editor.acknowledgeReview(), false);
  await f.editor.save(); assert.equal(f.writes.length, 1);
  await f.editor.load(); assert.equal(f.editor.getSnapshot().reviewed, true);
  f.server(snapshot(3, c)); await f.editor.refresh();
  assert.equal(f.editor.getSnapshot().outcome, 'UNKNOWN'); assert.equal(f.editor.getSnapshot().reviewed, false, 'a new revision invalidates the old explicit review');
  assert.deepEqual(f.editor.getSnapshot().attempt, attempt); assert.equal(f.editor.acknowledgeReview(), false);
  await f.editor.load(); assert.equal(f.editor.acknowledgeReview(), true); assert.equal(f.writes.length, 1);
});

test('a rejected collection CAS retains its original target and conflict after external read-back', async () => {
  const f = fixture(); await f.editor.load(); f.editor.changeTarget(4);
  f.writer(async () => { throw { status: 409, code: 'STAFFING_CHANGED' }; }); await f.editor.save();
  const attempt = f.editor.getSnapshot().attempt;
  f.server(snapshot(3, b)); await f.editor.refresh();
  assert.equal(f.editor.getSnapshot().outcome, 'CONFLICT'); assert.equal(f.editor.getSnapshot().target, 4);
  assert.deepEqual(f.editor.getSnapshot().attempt, attempt); assert.equal(f.editor.getSnapshot().reviewed, false);
  await f.editor.save(); assert.equal(f.writes.length, 1);
});

test('failed or foreign read-back keeps the draft and prevents saving with an unverified old revision', async () => {
  const f = fixture(); await f.editor.load(); f.editor.changeTarget(4); f.server(snapshot(3, b, '6'));
  assert.equal(await f.editor.refresh(), false);
  assert.equal(f.editor.getSnapshot().target, 4); assert.equal(f.editor.getSnapshot().snapshot?.revision, a);
  assert.equal(f.editor.getSnapshot().verified, false); assert.equal(f.editor.getSnapshot().loading, false);
  await f.editor.save(); assert.equal(f.writes.length, 0);
  f.server(snapshot(2, b)); await f.editor.refresh(); await f.editor.save();
  assert.equal(f.writes[0].expectedRevision, b);
});

test('late personal-schedule read-back cannot cross an actor, shop or disposed component boundary', async t => {
  for (const next of [{ actorId: '2', shopId: '5' }, { actorId: '1', shopId: '6' }, null]) {
    await t.test(next ? next.actorId + ':' + next.shopId : 'logout', async () => {
      const f = fixture(); await f.editor.load(); const pending = deferred(); f.reader(async () => pending.promise);
      const request = f.editor.refresh(); f.identity(next); f.reader(async shopId => snapshot(1, c, shopId));
      if (next) await f.editor.load();
      pending.resolve(snapshot(2, b, '5', true)); assert.equal(await request, false);
      assert.equal(f.editor.getSnapshot().snapshot?.shopId ?? null, next?.shopId ?? null);
      assert.equal(f.editor.getSnapshot().snapshot?.revision ?? null, next ? c : null); assert.equal(f.writes.length, 0);
    });
  }
  const f = fixture(); await f.editor.load(); const pending = deferred(); f.reader(async () => pending.promise);
  const request = f.editor.refresh(); f.editor.dispose(); pending.resolve(snapshot(2, b));
  assert.equal(await request, false); assert.equal(f.editor.getSnapshot().snapshot, null);
});

test('background reads cannot interrupt a count write or turn a read-only identity into a writer', async () => {
  const f = fixture(); await f.editor.load(); f.editor.changeTarget(3); const pending = deferred(); f.writer(async () => pending.promise);
  const saving = f.editor.save(), reads = f.reads.length;
  assert.equal(await f.editor.refresh(), false); assert.equal(f.reads.length, reads); assert.equal(f.editor.getSnapshot().saving, true);
  pending.resolve(snapshot(3, b)); await saving;
  f.server({ ...snapshot(3, c), canManageStaff: false }); await f.editor.refresh(); f.editor.changeTarget(4); await f.editor.save();
  assert.equal(f.writes.length, 1); assert.equal(f.editor.getSnapshot().snapshot?.canManageStaff, false);
});
