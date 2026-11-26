import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException, ValidationPipe, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MerchantCouponController } from './merchant-coupon.controller';
import { MerchantCouponService, MerchantCouponStatusDto } from './merchant-coupon.service';

function fixture() {
  const account = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null });
  let state: any = {
    users: [account(1n, 'ADMIN'), account(2n), account(3n), account(9n)],
    shop: { id: 10n, ownerId: 9n, status: 'PENDING', deletedAt: null }, binding: { userId: 2n },
    coupon: { id: 100n, shopId: 10n, title: 'Synthetic coupon', description: null, type: 'FIXED_AMOUNT', value: 100, minSpendCents: 0, totalQuantity: 0, claimedCount: 0, usedCount: 0, perUserLimit: 1, validFrom: new Date('2026-01-01'), validUntil: null, status: 'ACTIVE', deletedAt: null }, audits: [],
  };
  const events: string[] = []; let auditFail = false, beforeTransaction: (() => void) | undefined;
  function client(data: any): any {
    return {
      $queryRaw: async (query: any) => { const sql = Array.isArray(query) ? query.join('?') : query.sql; events.push(sql.includes('shops') ? 'lock-shop' : sql.includes('users') ? 'lock-user' : 'lock-coupon'); return []; },
      user: { findFirst: async ({ where }: any) => data.users.find((u: any) => u.id === where.id && u.role === where.role && u.status === where.status && !u.deletedAt) ?? null },
      shop: { findFirst: async ({ where }: any) => where.id === data.shop.id && !data.shop.deletedAt ? { ...data.shop, owner: data.users.find((u: any) => u.id === data.shop.ownerId), loginBinding: { ...data.binding, user: data.users.find((u: any) => u.id === data.binding.userId) } } : null },
      shopAccountGrant: { findFirst: async () => null },
      coupon: {
        findMany: async () => data.coupon.deletedAt ? [] : [data.coupon],
        findFirst: async ({ where }: any) => where.id === data.coupon.id && (where.shopId === undefined || where.shopId === data.coupon.shopId) && !data.coupon.deletedAt ? data.coupon : null,
        create: async ({ data: input }: any) => { events.push('create'); data.coupon = { id: 101n, ...input }; return data.coupon; },
        update: async ({ data: changes }: any) => { events.push('update'); Object.assign(data.coupon, changes); return data.coupon; },
      },
      userCoupon: { count: async () => data.coupon.claimedCount },
      auditLog: { create: async ({ data: input }: any) => { if (auditFail) throw Error('Synthetic audit failure'); data.audits.push(input); return input; } },
    };
  }
  const db: any = new Proxy({}, { get: (_, key) => key === '$transaction' ? async (work: any, options: any) => {
    expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
    beforeTransaction?.(); beforeTransaction = undefined;
    // Staged rollback substitute only; this is not actual database locking.
    const staged = structuredClone(state), result = await work(client(staged)); state = staged; return result;
  } : client(state)[key] });
  return { service: new MerchantCouponService(db), state: () => state, events, failAudit: () => { auditFail = true; }, before: (fn: () => void) => { beforeTransaction = fn; } };
}

describe('merchant coupon independent-login authorization', () => {
  test('ADMIN routes and independent home login work without changing historical financial ownership', async () => {
    expect(Reflect.getMetadata('roles', MerchantCouponController)).toEqual(['ADMIN', 'MERCHANT']);
    const f = fixture(); f.state().users[3].status = 'SUSPENDED';
    expect(await f.service.list('2', '10')).toHaveLength(1);
    await f.service.updateStatus('1', '10', '100', 'PAUSED', 'ADMIN');
    expect(f.state().coupon.status).toBe('PAUSED'); expect(f.state().shop.ownerId).toBe(9n);
    expect(f.state().audits[0].operatorId).toBe(1n); expect(f.events.filter(event => event !== 'lock-user')).toEqual(['lock-shop', 'lock-coupon', 'update']);
  });
  test('historical owner, associated login and STAFF cannot manage home-only coupons', async () => {
    for (const [id, role] of [['9', 'MERCHANT'], ['3', 'MERCHANT'], ['2', 'STAFF']]) {
      const f = fixture();
      await expect(f.service.list(id, '10', role)).rejects.toThrow(ForbiddenException);
      await expect(f.service.create(id, '10', { title: 'New', type: 'FIXED_AMOUNT', value: 10 }, role)).rejects.toThrow(ForbiddenException);
      await expect(f.service.remove(id, '10', '100', role)).rejects.toThrow(ForbiddenException);
      expect(f.state().audits).toEqual([]); expect(f.state().coupon.deletedAt).toBeNull();
    }
  });
  test('create rechecks account inside the shop transaction and rolls mutation back when audit fails', async () => {
    const disabled = fixture(); disabled.before(() => { disabled.state().users[1].status = 'SUSPENDED'; });
    await expect(disabled.service.create('2', '10', { title: 'New', type: 'FIXED_AMOUNT', value: 10 })).rejects.toThrow(ForbiddenException);
    expect(disabled.events).toEqual(['lock-shop']);
    const f = fixture(); f.failAudit();
    await expect(f.service.create('2', '10', { title: 'New', type: 'FIXED_AMOUNT', value: 10 })).rejects.toThrow('Synthetic audit failure');
    expect(f.state().coupon.id).toBe(100n); expect(f.state().audits).toEqual([]);
  });
  test('claimed coupon terms still use the shared policy and reject changed prices before mutation', async () => {
    const f = fixture(); f.state().coupon.claimedCount = 1;
    await expect(f.service.update('2', '10', '100', { value: 200 })).rejects.toThrow(ConflictException);
    expect(f.events.filter(event => event !== 'lock-user')).toEqual(['lock-shop', 'lock-coupon']); expect(f.state().coupon.value).toBe(100);
    await f.service.update('2', '10', '100', { status: 'PAUSED' }); expect(f.state().coupon.status).toBe('PAUSED');
  });
  test('delete locks coupon after shop, preserves claims and rejects a different shop coupon', async () => {
    const f = fixture(); f.state().coupon.claimedCount = 2;
    await f.service.remove('2', '10', '100');
    expect(f.events.filter(event => event !== 'lock-user')).toEqual(['lock-shop', 'lock-coupon', 'update']); expect(f.state().coupon.claimedCount).toBe(2); expect(f.state().coupon.status).toBe('PAUSED');
    const other = fixture(); other.state().coupon.shopId = 20n;
    await expect(other.service.remove('2', '10', '100')).rejects.toThrow(NotFoundException); expect(other.state().coupon.deletedAt).toBeNull();
  });
  test('status endpoint has an actual whitelist DTO and rejects ownership or extra terms', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const body of [{ status: 'ACTIVE', shopId: '20' }, { status: 'ACTIVE', value: 1 }, { status: 'UNKNOWN' }]) await expect(pipe.transform(body, { type: 'body', metatype: MerchantCouponStatusDto })).rejects.toThrow(BadRequestException);
  });
});
