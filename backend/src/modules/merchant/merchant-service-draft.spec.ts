import 'reflect-metadata';
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateShopServiceDto, SHOP_SERVICE_DESCRIPTION_MAX_BYTES } from './dto/merchant.dto';
import { MerchantService } from './merchant.service';

const input = () => ({ name: 'Synthetic service', category: 'MASSAGE', durationMin: 60, priceCents: 8000, description: 'Source description\nNo price or duration inferred.' });
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
const convert = (body: unknown): Promise<CreateShopServiceDto> => pipe.transform(body, { type: 'body', metatype: CreateShopServiceDto });

function fixture() {
  const account = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null });
  let state: any = {
    users: [account(1n, 'ADMIN'), account(2n), account(3n), account(4n, 'STAFF'), account(5n, 'USER'), account(9n)],
    shop: { id: 10n, ownerId: 9n, status: 'PENDING', deletedAt: null }, binding: { userId: 2n },
    grant: null, services: [], audits: [],
  };
  const events: string[] = [], creates: any[] = [];
  let auditFail = false, before: (() => void) | undefined;
  function client(data: any): any {
    return {
      $queryRaw: async (query: any) => {
        const sql = Array.isArray(query) ? query.join('?') : query.sql;
        events.push(sql.includes('users') ? 'lock-user' : sql.includes('FOR SHARE') ? 'lock-source' : 'lock-shop'); return [];
      },
      user: { findFirst: async ({ where }: any) => {
        events.push('check-actor'); return data.users.find((row: any) => row.id === where.id && row.role === where.role && row.status === where.status && !row.deletedAt) ?? null;
      } },
      shop: { findFirst: async ({ where }: any) => {
        events.push('check-shop');
        return where.id === data.shop.id && !data.shop.deletedAt ? { ...data.shop, owner: data.users.find((row: any) => row.id === data.shop.ownerId), loginBinding: { ...data.binding, user: data.users.find((row: any) => row.id === data.binding.userId) } } : null;
      } },
      shopAccountGrant: { findFirst: async ({ where, select }: any) => {
        const userId = where.sourceShop.loginBinding.is.userId;
        const grant = data.grant?.actorId === userId && data.grant.status === 'ACTIVE' ? data.grant : null;
        return grant && select ? { sourceShopId: grant.sourceShopId } : grant;
      } },
      shopService: {
        create: async ({ data: changes }: any) => {
          events.push('create-service'); creates.push(structuredClone(changes));
          const row = { id: BigInt(100 + data.services.length), isActive: true, ...changes };
          data.services.push(row); return row;
        },
        update: async () => { throw Error('Creating an inactive draft must never issue a follow-up update'); },
      },
      auditLog: { create: async ({ data: row }: any) => {
        events.push('audit'); if (auditFail) throw Error('Synthetic audit failure'); data.audits.push(row); return row;
      } },
    };
  }
  const db: any = { $transaction: async (work: any, options: any) => {
    expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
    before?.(); before = undefined;
    // A staged rollback substitute exercises the transaction boundary, not actual database locks.
    const staged = structuredClone(state), result = await work(client(staged)); state = staged; return result;
  } };
  return { service: new MerchantService(db, {} as any), state: () => state, events, creates, failAudit: () => { auditFail = true; }, before: (fn: () => void) => { before = fn; } };
}

describe('create service DTO with actual implicit-conversion settings', () => {
  test('keeps explicit false and true as booleans and allows omission without inventing a default', async () => {
    for (const isActive of [false, true]) expect((await convert({ ...input(), isActive })).isActive).toBe(isActive);
    expect((await convert(input())).isActive).toBeUndefined();
    expect((await convert({ ...input(), description: '' })).description).toBe('');
  });

  test.each([null, 'false', 'true', '', 0, 1, {}, []])('rejects a non-boolean isActive rather than coercing or treating null as omission: %p', async isActive => {
    await expect(convert({ ...input(), isActive })).rejects.toThrow(BadRequestException);
  });

  test.each(['', '   ', '\t', 'x'.repeat(201), 'x'.repeat(300), '<b>Service</b>', 'Name\u0000', 'Line\nname', 123, null])('rejects blank/oversized/injected/non-string names without truncation: %p', async name => {
    await expect(convert({ ...input(), name })).rejects.toThrow(BadRequestException);
  });

  test('checks UTF8 description bytes at the real TEXT boundary and preserves valid source text', async () => {
    const exact = '文'.repeat(SHOP_SERVICE_DESCRIPTION_MAX_BYTES / 3);
    expect((await convert({ ...input(), name: 'x'.repeat(200), description: exact })).description).toBe(exact);
    for (const description of [exact + '文', 'x'.repeat(SHOP_SERVICE_DESCRIPTION_MAX_BYTES + 1), '<img src=x>', 'Text\u0000', null, 123]) {
      await expect(convert({ ...input(), description })).rejects.toThrow(BadRequestException);
    }
    const description = 'Line one\r\nLine two\tTabbed note';
    expect((await convert({ ...input(), description })).description).toBe(description);
  });

  test('still rejects unexpected ownership/relations and invalid explicitly supplied booking terms', async () => {
    for (const changes of [{ shopId: '11' }, { variants: [] }, { ownerId: '3' }, { durationMin: 4 }, { durationMin: 120.5 }, { priceCents: -1 }, { priceCents: 1.5 }]) {
      await expect(convert({ ...input(), ...changes })).rejects.toThrow(BadRequestException);
    }
  });
});

describe('atomic inactive service creation', () => {
  test('writes false in exactly one create under the shop lock and records one transaction audit', async () => {
    const f = fixture(), data = await convert({ ...input(), isActive: false });
    const result = await f.service.createShopService('2', '10', data);
    expect(result.isActive).toBe(false); expect(f.creates).toEqual([{ ...input(), isActive: false, shopId: 10n, priceBasis: 'PER_BOOKING' }]);
    expect(f.state().services).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
    expect(f.events[0]).toBe('lock-shop'); expect(f.events.filter(value => value === 'check-actor')).toHaveLength(2);
    expect(f.events.indexOf('create-service')).toBeGreaterThan(f.events.lastIndexOf('check-shop'));
    expect(f.events.slice(-2)).toEqual(['create-service', 'audit']);
    expect(f.state().audits[0]).toMatchObject({ operatorId: 2n, targetType: 'SERVICE', targetId: result.id, action: 'CREATE' });
    expect(f.state().audits[0].detail.fields).toContain('isActive');
    expect(f.state().shop.ownerId).toBe(9n); expect(f.state().binding.userId).toBe(2n);
  });

  test('omission keeps the previous database default, while explicit true remains supported', async () => {
    const omitted = fixture(), result = await omitted.service.createShopService('2', '10', input());
    expect(result.isActive).toBe(true); expect(omitted.creates[0]).not.toHaveProperty('isActive');
    expect(omitted.state().audits[0].detail.fields).not.toContain('isActive');
    const active = fixture(); expect((await active.service.createShopService('2', '10', { ...input(), isActive: true })).isActive).toBe(true);
    expect(active.creates[0].isActive).toBe(true);
  });

  test('explicit false remains available to company ADMIN and an explicitly authorized associated merchant', async () => {
    const admin = fixture(); expect((await admin.service.createShopService('1', '10', { ...input(), isActive: false }, 'ADMIN')).isActive).toBe(false);
    const associated = fixture(); associated.state().grant = { actorId: 3n, sourceShopId: 20n, status: 'ACTIVE', permissions: ['CATALOG_MANAGE'] };
    expect((await associated.service.createShopService('3', '10', { ...input(), isActive: false })).isActive).toBe(false);
    expect(associated.events).toContain('lock-source'); expect(associated.state().audits[0].operatorId).toBe(3n);
  });

  test('historical financial owner, unauthorized merchant and STAFF/USER cannot create inactive services', async () => {
    for (const [actorId, role] of [['9', 'MERCHANT'], ['3', 'MERCHANT'], ['4', 'STAFF'], ['5', 'USER']]) {
      const f = fixture(); await expect(f.service.createShopService(actorId, '10', { ...input(), isActive: false }, role)).rejects.toThrow(ForbiddenException);
      expect(f.creates).toEqual([]); expect(f.state().services).toEqual([]); expect(f.state().audits).toEqual([]);
    }
  });

  test('account/binding permissions are reread inside the transaction before any create', async () => {
    const suspended = fixture(); suspended.before(() => { suspended.state().users[1].status = 'SUSPENDED'; });
    await expect(suspended.service.createShopService('2', '10', { ...input(), isActive: false })).rejects.toThrow(ForbiddenException);
    expect(suspended.creates).toEqual([]);
    const rebound = fixture(); rebound.before(() => { rebound.state().binding.userId = 3n; });
    await expect(rebound.service.createShopService('2', '10', { ...input(), isActive: false })).rejects.toThrow(ForbiddenException);
    expect(rebound.creates).toEqual([]);
  });

  test('an audit failure rolls back the newly created inactive row', async () => {
    const f = fixture(); f.failAudit();
    await expect(f.service.createShopService('2', '10', { ...input(), isActive: false })).rejects.toThrow('Synthetic audit failure');
    expect(f.creates).toHaveLength(1); expect(f.creates[0].isActive).toBe(false);
    expect(f.state().services).toEqual([]); expect(f.state().audits).toEqual([]);
  });

  test('service entry guards reject invalid raw flags/text before opening a transaction', async () => {
    for (const changes of [{ isActive: null }, { isActive: 'false' }, { name: ' ' }, { name: 'x'.repeat(300) }, { name: '<b>Unsafe</b>' }, { description: '文'.repeat(21846) }, { description: null }]) {
      const f = fixture(); await expect(f.service.createShopService('2', '10', { ...input(), ...changes } as any)).rejects.toThrow(BadRequestException);
      expect(f.events).toEqual([]); expect(f.creates).toEqual([]);
    }
    const f = fixture(); const created = await f.service.createShopService('2', '10', { ...input(), name: '  Explicitly edited name  ', isActive: false });
    expect(created.name).toBe('Explicitly edited name');
  });
});
