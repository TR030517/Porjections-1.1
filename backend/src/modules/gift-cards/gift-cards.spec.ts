// Domain-unit isolation: real outbox atomicity is verified in phase3-business-recovery.cjs.
jest.mock('../../common/notification-outbox', () => ({ enqueueNotification: jest.fn(async () => {}), syncBookingReminder: jest.fn(async () => {}) }));
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CreateGiftOrderDto, EmptyGiftDto, RedeemGiftDto } from './gift-card.dto';
import { GiftCardsService } from './gift-cards.service';
import { giftId, giftPage, hash, scopedKey } from './gift-card.validation';

const merchant = { id: '2', role: 'MERCHANT' }, customer = { id: '3', role: 'CUSTOMER' }, admin = { id: '1', role: 'ADMIN' };
const RIGHT = '7e031cfa-6a7a-4cf9-9627-ad480b9eb87f';
const NOW = new Date('2026-10-28T12:00:00.000Z');
const syntheticPasswordHash = '$2b$10$' + 'a'.repeat(53);
type Store = Record<string, any[]>;

/** Commit/rollback and serial-shop-mutex substitute. It checks transaction
 * composition and state transitions, not actual MySQL locking or concurrency. */
function fixture(options: { auditFailure?: boolean; entitlement?: Record<string, any> } = {}) {
  let committed: Store = {
    user: [
      { id: 1n, role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      { id: 2n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: syntheticPasswordHash },
      { id: 3n, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null },
      { id: 4n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant-2', passwordHash: syntheticPasswordHash },
    ],
    shop: [{ id: 10n, ownerId: 2n, name: 'Synthetic shop', timezone: 'America/New_York', status: 'APPROVED', deletedAt: null },
      { id: 20n, ownerId: 4n, name: 'Other synthetic shop', status: 'APPROVED', deletedAt: null }],
    shopLoginBinding: [{ id: 1n, shopId: 10n, userId: 2n }, { id: 2n, shopId: 20n, userId: 4n }],
    shopAccountGrant: [],
    giftCardProduct: [{ id: 11n, shopId: 10n, title: 'Synthetic three uses', description: 'Fixture only', priceCents: 5735, useTimes: 3, expireDays: 30, status: 'ACTIVE', createdAt: NOW }],
    shopGiftSalesPolicy: [{ shopId: 10n, payAtStoreEnabled: true }],
    giftCardOrder: [], giftCardRedemption: [], auditLog: [],
    giftCardEntitlement: [{ id: RIGHT, userId: 3n, shopId: 10n, productId: 11n, orderId: null, tokenHash: hash('unusable fixture'), totalUses: 3, remainingUses: 3,
      expiresAt: new Date('2026-11-28T12:00:00Z'), status: 'ACTIVE', source: 'PROMOTIONAL', productTitleSnapshot: 'Frozen title', grantReason: 'Private synthetic reason',
      grantedById: 2n, grantKey: null, grantHash: null, voucherExpiresAt: null, voucherUses: null, createdAt: NOW, ...options.entitlement }],
  };
  const events: string[] = [];
  const calls: Array<{ model: string; method: string; args: any }> = [];
  function matches(model: string, row: any, where: any, data: Store): boolean {
    if (!row) return false;
    return Object.entries(where || {}).every(([key, expected]: [string, any]) => {
      if (expected === undefined) return true;
      if (key === 'OR') return expected.some((part: any) => matches(model, row, part, data));
      if (key === 'userId_requestKey') return row.userId === expected.userId && row.requestKey === expected.requestKey;
      if (key === 'shop') return matches('shop', data.shop.find(s => s.id === row.shopId), expected, data);
      if (key === 'owner') return matches('user', data.user.find(u => u.id === row.ownerId), expected, data);
      if (key === 'loginBinding') return matches('shopLoginBinding', data.shopLoginBinding.find(binding => binding.shopId === row.id), expected.is ?? expected, data);
      if (key === 'user') return matches('user', data.user.find(user => user.id === row.userId), expected, data);
      if (key === 'entitlement') return matches('giftCardEntitlement', data.giftCardEntitlement.find(e => e.id === row.entitlementId), expected, data);
      if (!row) return false;
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        return Object.entries(expected).every(([op, v]: [string, any]) => op === 'gt' ? row[key] > v : op === 'gte' ? row[key] >= v : op === 'lte' ? row[key] <= v
          : op === 'in' ? v.includes(row[key]) : op === 'not' ? row[key] !== v : op === 'startsWith' ? typeof row[key] === 'string' && row[key].startsWith(v) : false);
      }
      return row[key] === expected;
    });
  }
  function attach(model: string, row: any, args: any, data: Store) {
    if (!row) return null;
    const value = structuredClone(row);
    if (args.include?.shop) value.shop = structuredClone(data.shop.find(s => s.id === row.shopId));
    if (args.include?.owner) value.owner = structuredClone(data.user.find(u => u.id === row.ownerId));
    if (args.include?.loginBinding) value.loginBinding = attach('shopLoginBinding', data.shopLoginBinding.find(binding => binding.shopId === row.id), args.include.loginBinding, data);
    if (args.include?.user) value.user = structuredClone(data.user.find(user => user.id === row.userId));
    return value;
  }
  function delegates(data: () => Store) {
    const result: any = {};
    for (const model of Object.keys(committed)) {
      const record = (method: string, args: any) => calls.push({ model, method, args });
      result[model] = {
        findFirst: jest.fn(async (args: any) => { record('findFirst', args); return attach(model, data()[model].find(row => matches(model, row, args.where, data())), args, data()); }),
        findUnique: jest.fn(async (args: any) => { record('findUnique', args); return attach(model, data()[model].find(row => matches(model, row, args.where, data())), args, data()); }),
        findMany: jest.fn(async (args: any) => { record('findMany', args); return data()[model].filter(row => matches(model, row, args.where, data())).slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 10000)).map(row => attach(model, row, args, data())); }),
        count: jest.fn(async (args: any) => { record('count', args); return data()[model].filter(row => matches(model, row, args.where, data())).length; }),
        create: jest.fn(async ({ data: input }: any) => {
          record('create', { data: input }); events.push(`write-${model}`);
          if (model === 'auditLog' && options.auditFailure) throw new Error('Synthetic audit unavailable');
          const row = { id: ['giftCardEntitlement', 'giftCardRedemption'].includes(model) ? randomUUID() : BigInt(100 + data()[model].length), createdAt: NOW, updatedAt: NOW, ...input };
          data()[model].push(row); return structuredClone(row);
        }),
        update: jest.fn(async (args: any) => {
          record('update', args); events.push(`write-${model}`);
          const row = data()[model].find(row => matches(model, row, args.where, data()));
          if (!row) throw new Error('Synthetic missing row');
          Object.assign(row, args.data); return structuredClone(row);
        }),
        updateMany: jest.fn(async (args: any) => {
          record('updateMany', args); events.push(`write-${model}`); let count = 0;
          for (const row of data()[model].filter(row => matches(model, row, args.where, data()))) {
            for (const [key, value] of Object.entries(args.data) as [string, any][]) row[key] = value && typeof value === 'object' && 'decrement' in value ? row[key] - value.decrement : value;
            count++;
          }
          return { count };
        }),
      };
    }
    return result;
  }
  let tail = Promise.resolve();
  const prisma: any = { ...delegates(() => committed), $queryRaw: jest.fn(async () => [{ id: 10n }]), $transaction: jest.fn((callback: any, config: any) => {
    const run = tail.then(async () => {
      expect(config.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
      const staged = structuredClone(committed);
      const tx = { ...delegates(() => staged), $queryRaw: jest.fn(async (sql: any) => { events.push(sql.strings.join('').includes('gift_card_entitlements') ? 'lock-entitlement' : sql.strings.join('').includes('gift_card_orders') ? 'lock-order' : sql.strings.join('').includes('users') ? 'lock-user' : 'lock-shop'); return []; }) };
      const result = await callback(tx); committed = staged; events.push('commit'); return result;
    });
    tail = run.then(() => undefined, () => undefined); return run;
  }) };
  return { service: new GiftCardsService(prisma), prisma, events, calls, state: () => structuredClone(committed), mutate: (fn: (data: Store) => void) => fn(committed) };
}

describe('gift-card promotion, credentials and redemption', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => jest.useRealTimers());

  test('online sales remain closed; a real server-priced order stays unpaid and is idempotent', async () => {
    const f = fixture();
    expect(f.service.config()).toMatchObject({ salesEnabled: true, onlinePaymentEnabled: false, currency: 'usd' });
    const a = await f.service.createOrder(customer, { productId: '11', requestKey: 'quote-1' });
    f.mutate(data => { data.giftCardProduct[0].priceCents = 9999; data.giftCardProduct[0].title = 'Changed later'; });
    const b = await f.service.createOrder(customer, { productId: '11', requestKey: 'quote-1' });
    expect(b.item.id).toBe(a.item.id);
    expect(b.item).toMatchObject({ amountCents: 5735, paidCents: 0, status: 'PENDING', useTimesSnapshot: 3, expireDaysSnapshot: 30, productTitleSnapshot: 'Synthetic three uses', currency: 'usd', salesEnabled: true, onlinePaymentEnabled: false });
    expect(f.state().giftCardOrder).toHaveLength(1);
    expect(f.state().giftCardEntitlement).toHaveLength(1); // No purchase right issued.
    await expect(f.service.checkout(customer.id, a.item.id)).resolves.toMatchObject({ paymentMethod: 'PAY_AT_STORE', paymentRequiredAtStore: true, item: { status: 'PENDING', paidCents: 0 } });
    expect(f.state().giftCardOrder[0].paidCents).toBe(0);
  });
  test('order body cannot set price, status, provider payment or granted uses', async () => {
    const f = fixture();
    for (const injection of [{ amountCents: 1 }, { status: 'PAID' }, { providerPaymentId: 'fake' }, { useTimes: 1000 }]) {
      await expect(f.service.createOrder(customer, { productId: '11', requestKey: 'bad', ...injection })).rejects.toThrow(BadRequestException);
    }
    expect(f.state().giftCardOrder).toHaveLength(0);
  });
  test('PENDING order can be cancelled once; paid/issued orders cannot be cancelled as unpaid', async () => {
    const f = fixture(); const order = await f.service.createOrder(customer, { productId: '11', requestKey: 'cancel' });
    await expect(f.service.cancelOrder(merchant, order.item.id)).rejects.toThrow(NotFoundException);
    const cancelled = await f.service.cancelOrder(customer, order.item.id);
    expect(cancelled.item.status).toBe('CANCELLED');
    await f.service.cancelOrder(customer, order.item.id);
    expect(f.state().auditLog.filter(a => a.action === 'GIFT_ORDER_CANCEL')).toHaveLength(1);
    f.mutate(data => { Object.assign(data.giftCardOrder[0], { status: 'PENDING', paidCents: 5735 }); });
    await expect(f.service.cancelOrder(customer, order.item.id)).rejects.toThrow(ConflictException);
  });
  test('promotion snapshots real product uses/expiry, records reason but never sales income or bearer secret', async () => {
    const f = fixture();
    const result = await f.service.grant(merchant, '10', { productId: '11', userId: '3', reason: 'Synthetic promotion only', requestKey: 'grant-A' });
    expect(result).toMatchObject({ promotional: true, saleRecorded: false, item: { source: 'PROMOTIONAL', totalUses: 3, remainingUses: 3, orderId: null, grantReasonRecorded: true } });
    expect(new Date(result.item.expiresAt).getTime()).toBe(NOW.getTime() + 30 * 86400000);
    expect(f.state().giftCardOrder).toHaveLength(0);
    const saved = f.state().giftCardEntitlement.find(e => e.id === result.item.id)!;
    expect(saved.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/tokenHash|grantKey|grantHash|Synthetic promotion only/);
    expect(JSON.stringify(f.state().auditLog[0].detail)).not.toContain('Synthetic promotion only');
    expect(f.events[0]).toBe('lock-shop');
  });
  test('same grant key replays original even product changes, while changed recipient/reason conflicts', async () => {
    const f = fixture(); const body = { productId: '11', userId: '3', reason: 'Promotion', requestKey: 'grant-A' };
    const first = await f.service.grant(merchant, '10', body);
    f.mutate(data => { data.giftCardProduct[0].useTimes = 9; });
    const again = await f.service.grant(merchant, '10', body);
    expect(again.item.id).toBe(first.item.id); expect(again.item.totalUses).toBe(3);
    await expect(f.service.grant(merchant, '10', { ...body, reason: 'Different' })).rejects.toThrow(ConflictException);
    expect(f.state().giftCardEntitlement).toHaveLength(2);
  });
  test('grant rejects foreign product/shop, invalid customer and blank reasons', async () => {
    const f = fixture();
    await expect(f.service.grant(merchant, '20', { productId: '11', userId: '3', reason: 'x', requestKey: 'x' })).rejects.toThrow(ForbiddenException);
    await expect(f.service.grant(admin, '20', { productId: '11', userId: '3', reason: 'x', requestKey: 'x' })).rejects.toThrow(NotFoundException);
    await expect(f.service.grant(merchant, '10', { productId: '11', userId: '2', reason: 'x', requestKey: 'x' })).rejects.toThrow(BadRequestException);
    await expect(f.service.grant(merchant, '10', { productId: '11', userId: '3', reason: ' ', requestKey: 'x' })).rejects.toThrow(BadRequestException);
  });
  test('the explicit active login binding authorizes promotion without changing historical ownership', async () => {
    const f = fixture();
    f.mutate(data => { data.shop[0].ownerId = 4n; });
    const result = await f.service.grant(merchant, '10', { productId: '11', userId: '3', reason: 'Synthetic binding fixture', requestKey: 'binding-authority' });
    expect(result.item.shopId).toBe('10');
    expect(f.state().shop[0].ownerId).toBe(4n);
    await expect(f.service.grant({ id: '4', role: 'MERCHANT' }, '10', { productId: '11', userId: '3', reason: 'Not the bound login', requestKey: 'old-owner' })).rejects.toThrow(ForbiddenException);
    f.mutate(data => { data.user.find(user => user.id === 2n)!.status = 'SUSPENDED'; });
    await expect(f.service.grant(merchant, '10', { productId: '11', userId: '3', reason: 'Disabled login', requestKey: 'disabled-binding' })).rejects.toThrow(ForbiddenException);
    expect(f.state().giftCardEntitlement).toHaveLength(2);
    expect(f.state().auditLog).toHaveLength(1);
  });
  test('credential is own-only, 5 minutes maximum, binds exact uses and is never in lists/detail', async () => {
    const f = fixture();
    await expect(f.service.credential(merchant, RIGHT, { usedUses: 1 })).rejects.toThrow(NotFoundException);
    const credential = await f.service.credential(customer, RIGHT, { usedUses: 2 });
    expect(credential.token).toMatch(/^gc1_[A-Za-z0-9_-]{43}$/);
    expect(credential.usedUses).toBe(2); expect(+new Date(credential.expiresAt)).toBe(+NOW + 300000);
    const row = f.state().giftCardEntitlement[0]; expect(row.tokenHash).toBe(hash(credential.token));
    expect(row).not.toHaveProperty('token');
    for (const result of [await f.service.entitlements('3'), await f.service.entitlement('3', RIGHT), await f.service.adminEntitlements(merchant, '10')]) {
      expect(JSON.stringify(result)).not.toContain(credential.token);
      expect(JSON.stringify(result)).not.toMatch(/tokenHash|voucherExpiresAt|voucherUses|grantReason":/);
    }
    expect(f.events.slice(0, 2)).toEqual(['lock-shop', 'lock-entitlement']);
  });
  test('issuing a replacement invalidates old credential and cannot outlive entitlement expiry', async () => {
    const f = fixture({ entitlement: { expiresAt: new Date(+NOW + 90000) } });
    const first = await f.service.credential(customer, RIGHT, { usedUses: 1 });
    const second = await f.service.credential(customer, RIGHT, { usedUses: 1 });
    expect(first.token).not.toBe(second.token); expect(+new Date(second.expiresAt)).toBe(+NOW + 90000);
    await expect(f.service.redeem(merchant, '10', { token: first.token, usedUses: 1, requestKey: 'old-token' })).rejects.toThrow(NotFoundException);
  });
  test('redemption rejects exact-use mismatch without consuming right or voucher', async () => {
    const f = fixture(); const c = await f.service.credential(customer, RIGHT, { usedUses: 2 });
    await expect(f.service.redeem(merchant, '10', { token: c.token, usedUses: 1, requestKey: 'count-mismatch' })).rejects.toThrow(ConflictException);
    expect(f.state().giftCardEntitlement[0].remainingUses).toBe(3);
    expect(f.state().giftCardEntitlement[0].tokenHash).toBe(hash(c.token));
  });
  test('one-time redemption is atomic and key replay does not consume again; changed body conflicts', async () => {
    const f = fixture(); const c = await f.service.credential(customer, RIGHT, { usedUses: 2 });
    const body = { token: c.token, usedUses: 2, requestKey: 'redemption-A' };
    const result = await f.service.redeem(merchant, '10', body);
    expect(result).toMatchObject({ replayed: false, remainingUses: 1, item: { usedUses: 2, entitlementId: RIGHT, shopId: '10' } });
    const replay = await f.service.redeem(merchant, '10', body);
    expect(replay.item.id).toBe(result.item.id); expect(replay.replayed).toBe(true);
    expect(f.state().giftCardEntitlement[0].remainingUses).toBe(1); expect(f.state().giftCardRedemption).toHaveLength(1);
    await expect(f.service.redeem(merchant, '10', { ...body, usedUses: 1 })).rejects.toThrow(ConflictException);
    await expect(f.service.redeem(merchant, '10', { ...body, requestKey: 'second-consumption' })).rejects.toThrow(NotFoundException);
    expect(f.state().giftCardEntitlement[0].voucherExpiresAt).toBeNull();
  });
  test('serial transaction substitute permits only one of two distinct-key consumptions', async () => {
    const f = fixture(); const c = await f.service.credential(customer, RIGHT, { usedUses: 3 });
    const results = await Promise.allSettled(['race1', 'race2'].map(key => f.service.redeem(merchant, '10', { token: c.token, usedUses: 3, requestKey: key })));
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(f.state().giftCardEntitlement[0]).toMatchObject({ remainingUses: 0, status: 'EXHAUSTED' });
    expect(f.state().giftCardRedemption).toHaveLength(1);
  });
  test('expired credential/entitlement and cross-shop credential cannot be redeemed', async () => {
    const f = fixture(); const c = await f.service.credential(customer, RIGHT, { usedUses: 1 });
    await expect(f.service.redeem({ id: '4', role: 'MERCHANT' }, '20', { token: c.token, usedUses: 1, requestKey: 'foreign' })).rejects.toThrow(NotFoundException);
    jest.setSystemTime(+NOW + 300000);
    await expect(f.service.redeem(merchant, '10', { token: c.token, usedUses: 1, requestKey: 'expired' })).rejects.toThrow(ConflictException);
    f.mutate(data => { data.giftCardEntitlement[0].expiresAt = new Date(+NOW - 1); });
    await expect(f.service.credential(customer, RIGHT, { usedUses: 1 })).rejects.toThrow(ConflictException);
    expect(f.state().giftCardRedemption).toHaveLength(0);
  });
  test('audit failure rolls back consumption and the voucher can be retried (transaction substitute)', async () => {
    const f = fixture({ auditFailure: true }); const c = await f.service.credential(customer, RIGHT, { usedUses: 1 });
    await expect(f.service.redeem(merchant, '10', { token: c.token, usedUses: 1, requestKey: 'audit-failure' })).rejects.toThrow('Synthetic audit unavailable');
    expect(f.state().giftCardEntitlement[0]).toMatchObject({ remainingUses: 3, tokenHash: hash(c.token) });
    expect(f.state().giftCardRedemption).toHaveLength(0); expect(f.state().auditLog).toHaveLength(0);
  });
  test('unused promotion void invalidates outstanding voucher; reason required and immutable', async () => {
    const f = fixture(); const c = await f.service.credential(customer, RIGHT, { usedUses: 1 });
    await expect(f.service.void(merchant, '10', RIGHT, { reason: '' })).rejects.toThrow(BadRequestException);
    const result = await f.service.void(merchant, '10', RIGHT, { reason: 'Synthetic revoked promotion' });
    expect(result.item.status).toBe('VOIDED'); expect(result.item.voidReasonRecorded).toBe(true);
    await expect(f.service.redeem(merchant, '10', { token: c.token, usedUses: 1, requestKey: 'revoked' })).rejects.toThrow(NotFoundException);
    await f.service.void(merchant, '10', RIGHT, { reason: 'Synthetic revoked promotion' });
    expect(f.state().auditLog).toHaveLength(1);
    await expect(f.service.void(merchant, '10', RIGHT, { reason: 'Different' })).rejects.toThrow(ConflictException);
  });
  test.each([{ source: 'PURCHASED', orderId: 99n }, { source: 'LEGACY' }, { remainingUses: 2 }])('sold, legacy or used entitlement cannot be voided: %p', async entitlement => {
    const f = fixture({ entitlement });
    await expect(f.service.void(merchant, '10', RIGHT, { reason: 'Cannot erase history' })).rejects.toThrow(ConflictException);
    expect(f.state().giftCardEntitlement[0].status).toBe('ACTIVE');
  });
  test('existing redemption prevents void even if remaining count is inconsistent', async () => {
    const f = fixture(); f.mutate(data => { data.giftCardRedemption.push({ id: randomUUID(), entitlementId: RIGHT, operatorId: 2n, shopId: 10n, usedUses: 1 }); });
    await expect(f.service.void(merchant, '10', RIGHT, { reason: 'Already used' })).rejects.toThrow(ConflictException);
  });
  test('own redemption ledger never exposes request key/hash and other users cannot read it', async () => {
    const f = fixture(); const c = await f.service.credential(customer, RIGHT, { usedUses: 1 });
    await f.service.redeem(merchant, '10', { token: c.token, usedUses: 1, requestKey: 'private-request-key' });
    const own = await f.service.ownRedemptions('3', RIGHT, { page: '1', pageSize: '1' });
    expect(own.total).toBe(1); expect(own.items[0].usedUses).toBe(1);
    expect(JSON.stringify(own)).not.toMatch(/requestHash|idempotencyKey|private-request-key/);
    await expect(f.service.ownRedemptions('2', RIGHT)).rejects.toThrow(NotFoundException);
  });
  test('expired list includes both lazy expiry and explicitly stored expired records', async () => {
    const f = fixture({ entitlement: { expiresAt: new Date(+NOW - 1) } });
    f.mutate(data => data.giftCardEntitlement.push({ ...structuredClone(data.giftCardEntitlement[0]), id: randomUUID(), status: 'EXPIRED' }));
    const expired = await f.service.entitlements('3', { status: 'EXPIRED' });
    expect(expired.total).toBe(2); expect(expired.items.every(item => item.status === 'EXPIRED')).toBe(true);
    const active = await f.service.entitlements('3', { status: 'ACTIVE' });
    expect(active.total).toBe(0);
  });
  test('case-sensitive request keys remain distinct in the service contract', () => {
    expect(scopedKey('gift-grant-key', '10', '2', 'Case')).not.toBe(scopedKey('gift-grant-key', '10', '2', 'case'));
    expect(() => giftId(9007199254740992)).toThrow(BadRequestException);
    expect(giftId('9223372036854775807')).toBe(9223372036854775807n);
    expect(() => giftPage({ pageSize: '101' })).toThrow(BadRequestException);
  });
  test('wire whitelist rejects payment fields and keeps non-string IDs / noninteger counts uncoerced', async () => {
    const f = fixture(), pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    await expect(pipe.transform({ productId: '11', requestKey: 'wire', paidCents: 5735 }, { type: 'body', metatype: CreateGiftOrderDto })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ providerPaymentId: 'fake' }, { type: 'body', metatype: EmptyGiftDto })).rejects.toThrow(BadRequestException);
    const unsafe = await pipe.transform({ productId: 11, requestKey: 'numeric' }, { type: 'body', metatype: CreateGiftOrderDto });
    await expect(f.service.createOrder(customer, unsafe)).rejects.toThrow(BadRequestException);
    const count = await pipe.transform({ token: 'gc1_' + 'a'.repeat(43), usedUses: '1', requestKey: 'wrong-wire' }, { type: 'body', metatype: RedeemGiftDto });
    await expect(f.service.redeem(merchant, '10', count)).rejects.toThrow(BadRequestException);
  });
});
