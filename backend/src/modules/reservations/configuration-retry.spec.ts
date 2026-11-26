import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { withShopConfiguration } from './configuration-guard';
import { ReservationsService } from './reservations.service';

const actor = { id: '2', role: 'MERCHANT' };
const payload = { name: 'Synthetic room', roomType: 'SINGLE', capacity: 1 };
const rawConflict = (code: string | number) => Object.assign(new Error('Synthetic structured transaction conflict'), { code: 'P2010', meta: { code } });
function fixture(error: unknown, failures = 1, phase: 'source-lock' | 'audit' = 'source-lock', permissions = ['CATALOG_MANAGE', 'RESERVATION_CONFIG']) {
  let remaining = failures, committed: any = { rooms: [], audits: [] };
  const events: string[] = [], reads: any[] = [];
  const db: any = { $transaction: jest.fn(async (work: any, options: any) => {
    expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
    const staged = structuredClone(committed), tx: any = {
      $queryRaw: jest.fn(async (sql: any) => {
        const query = sql.sql ?? sql.join('?');
        if (query.includes('FOR SHARE')) {
          events.push('lock-source'); if (phase === 'source-lock' && remaining-- > 0) throw error;
        } else events.push(query.includes('shops') ? 'lock-target' : 'lock-user');
        return [];
      }),
      user: { findFirst: jest.fn(async ({ where }: any) => { events.push('check-actor'); return where.id === 2n && where.role === 'MERCHANT' ? { id: 2n } : null; }) },
      shop: { findFirst: jest.fn(async ({ where }: any) => { events.push('read-shop'); return where.id === 10n ? { id: 10n, status: 'APPROVED', deletedAt: null,
        loginBinding: { userId: 3n, user: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } } } : null; }) },
      shopAccountGrant: { findFirst: jest.fn(async ({ where }: any) => {
        reads.push(where); return where.targetShopId === 10n && where.sourceShop.loginBinding.is.userId === 2n
          ? { sourceShopId: 20n, status: 'ACTIVE', permissions } : null;
      }) },
      shopRoom: { create: jest.fn(async ({ data }: any) => { events.push('write'); const room = { id: 30n, ...data }; staged.rooms.push(room); return room; }) },
      auditLog: { create: jest.fn(async ({ data }: any) => {
        events.push('audit'); if (phase === 'audit' && remaining-- > 0) throw error; staged.audits.push(data); return data;
      }) },
    };
    const result = await work(tx); committed = staged; events.push('commit'); return result;
  }) };
  const run = (kind: 'resource' | 'common', shopId = '10') => kind === 'resource'
    ? new ReservationsService(db).mutate(shopId, actor, 'rooms', payload)
    : withShopConfiguration(db, BigInt(shopId), actor, async (tx, shop) => {
      const row = await tx.shopRoom.create({ data: { ...payload, shopId: shop.id } });
      await tx.auditLog.create({ data: { action: 'SYNTHETIC_CONFIG', targetId: row.id } }); return row;
    });
  return { db, run, events, reads, state: () => committed };
}

describe('configuration writers retry the original transaction without changing authority or scope', () => {
  test.each(['resource', 'common'] as const)('%s retries raw FOR SHARE deadlock with shop first and current associated grant rechecked', async kind => {
    const f = fixture(rawConflict('1213')), original = structuredClone(payload);
    await f.run(kind);
    expect(f.db.$transaction).toHaveBeenCalledTimes(2); expect(f.state().rooms).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
    expect(f.events[0]).toBe('lock-target'); expect(f.events.indexOf('lock-source')).toBeGreaterThan(f.events.indexOf('lock-target'));
    expect(f.events.filter(event => event === 'lock-target')).toHaveLength(2); expect(f.events.filter(event => event === 'lock-source')).toHaveLength(2);
    expect(f.events.filter(event => event === 'commit')).toHaveLength(1); expect(f.reads.every(where => where.targetShopId === 10n && where.sourceShop.loginBinding.is.userId === 2n)).toBe(true);
    expect(payload).toEqual(original); expect(f.state().rooms[0].shopId).toBe(10n);
  });
  test.each(['resource', 'common'] as const)('%s rolls back partial staged writes before retrying a raw lock timeout', async kind => {
    const f = fixture(rawConflict(1205), 1, 'audit'); await f.run(kind);
    expect(f.db.$transaction).toHaveBeenCalledTimes(2); expect(f.events.filter(event => event === 'write')).toHaveLength(2);
    expect(f.state().rooms).toHaveLength(1); expect(f.state().audits).toHaveLength(1); expect(f.events.filter(event => event === 'commit')).toHaveLength(1);
  });
  test.each(['resource', 'common'] as const)('%s limits raw and ORM retries to three attempts; other SQL failures retain the original error', async kind => {
    for (const error of [rawConflict('1213'), rawConflict('1205'), Object.assign(new Error('Synthetic ORM conflict'), { code: 'P2034' })]) {
      const f = fixture(error, 5); await expect(f.run(kind)).rejects.toThrow(ServiceUnavailableException); expect(f.db.$transaction).toHaveBeenCalledTimes(3);
      expect(f.state().rooms).toEqual([]); expect(f.state().audits).toEqual([]);
    }
    const other = rawConflict('1062'), f = fixture(other); await expect(f.run(kind)).rejects.toBe(other); expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });
  test.each(['resource', 'common'] as const)('%s does not retry or widen permissions after a grant denial or foreign target', async kind => {
    const denied = fixture(undefined, 0, 'source-lock', []); await expect(denied.run(kind)).rejects.toThrow(ForbiddenException);
    expect(denied.db.$transaction).toHaveBeenCalledTimes(1); expect(denied.events).not.toContain('write');
    const foreign = fixture(undefined, 0); await expect(foreign.run(kind, '11')).rejects.toThrow(NotFoundException);
    expect(foreign.db.$transaction).toHaveBeenCalledTimes(1); expect(foreign.events).not.toContain('write');
  });
});
