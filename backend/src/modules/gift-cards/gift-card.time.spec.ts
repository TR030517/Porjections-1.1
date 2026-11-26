jest.mock('../../common/shop-access', () => ({ requireShopAccess: jest.fn(async () => ({ shop: { id: 7n } })) }));
import { GiftCardsService } from './gift-cards.service';
import { giftLocalTimestamp, giftTimezone } from './gift-card.time';

const rightId = '7e031cfa-6a7a-4cf9-9627-ad480b9eb87f';
const merchant = { id: '2', role: 'MERCHANT' };
function fixture(zone: string | null = 'America/New_York') {
  const shop = { id: 7n, name: 'Synthetic store', timezone: zone };
  const order = { id: 9n, orderNo: 'SYNTHETIC', userId: 3n, shopId: 7n, productId: 8n, amountCents: 2000, paidCents: 2000, refundedCents: 0,
    status: 'PAID', paymentMethod: 'PAY_AT_STORE', currency: 'usd', createdAt: new Date('2026-11-01T05:30:00Z'), updatedAt: new Date('2026-11-01T06:30:00Z'),
    rights: [], saleEntries: [{ id: 'receipt', kind: 'RECEIPT', amountCents: 2000, method: 'CASH', reason: 'Recorded at store', operatorId: 2n, createdAt: new Date('2026-11-01T06:30:00Z') }] };
  const right = { id: rightId, userId: 3n, shopId: 7n, productId: 8n, orderId: 9n, source: 'PURCHASE', totalUses: 2, remainingUses: 2,
    expiresAt: new Date('2027-01-01T02:30:00Z'), status: 'ACTIVE', createdAt: order.createdAt, tokenHash: 'PRIVATE_NOT_FOR_CUSTOMERS' };
  const redemption = { id: 'redemption', entitlementId: rightId, shopId: 7n, operatorId: 2n, usedUses: 1, createdAt: order.updatedAt };
  const withShop = (row: any, args: any) => ({ ...row, ...(args.include?.shop ? { shop } : {}) });
  const db: any = {
    giftCardOrder: { findMany: jest.fn(async (args: any) => [withShop(order, args)]), findFirst: jest.fn(async (args: any) => withShop(order, args)), count: jest.fn(async () => 1) },
    giftCardEntitlement: { findMany: jest.fn(async (args: any) => [withShop(right, args)]), findFirst: jest.fn(async (args: any) => withShop(right, args)), count: jest.fn(async () => 1) },
    giftCardRedemption: { findMany: jest.fn(async (args: any) => [{ ...redemption, ...(args.include?.entitlement?.select?.shop ? { entitlement: { shop } } : {}) }]), count: jest.fn(async () => 1) },
  };
  return { service: new GiftCardsService(db), db, order, right };
}

describe('gift store-local time contract', () => {
  test('DST offsets and store dates are independent of the server or customer device zone', () => {
    const original = process.env.TZ;
    try {
      for (const device of ['UTC', 'Asia/Shanghai', 'Pacific/Honolulu']) {
        process.env.TZ = device;
        expect(giftLocalTimestamp('2026-11-01T05:30:00Z', 'America/New_York')).toBe('2026-11-01 01:30 GMT-4');
        expect(giftLocalTimestamp('2026-11-01T06:30:00Z', 'America/New_York')).toBe('2026-11-01 01:30 GMT-5');
        expect(giftLocalTimestamp('2026-03-08T09:59:00Z', 'America/Los_Angeles')).toBe('2026-03-08 01:59 GMT-8');
        expect(giftLocalTimestamp('2026-03-08T10:00:00Z', 'America/Los_Angeles')).toBe('2026-03-08 03:00 GMT-7');
        expect(giftLocalTimestamp('2027-01-01T02:30:00Z', 'America/New_York')).toBe('2026-12-31 21:30 GMT-5');
      }
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
    for (const zone of [undefined, null, '', 'Bad/Zone', ' UTC ']) expect(giftTimezone(zone)).toBeNull();
    expect(giftLocalTimestamp('2026-11-01T01:30:00', 'America/New_York')).toBeNull();
    expect(giftLocalTimestamp('2026-11-01T05:30:00Z', null)).toBeNull();
  });

  test('customer and merchant order views project the same store zone for creation and sale evidence', async () => {
    const { service, db, order } = fixture();
    const views = [(await service.orders('3')).items[0], (await service.order('3', '9')).item,
      (await service.adminOrders(merchant, '7')).items[0], (await service.adminOrder(merchant, '7', '9')).item];
    for (const view of views) {
      expect(view).toMatchObject({ timezone: 'America/New_York', createdAtLocal: '2026-11-01 01:30 GMT-4', updatedAtLocal: '2026-11-01 01:30 GMT-5' });
      expect(view.receipts[0].createdAtLocal).toBe('2026-11-01 01:30 GMT-5');
      expect(view.createdAt).toBe(order.createdAt);
    }
    expect(db.giftCardOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9n, userId: 3n }, include: expect.objectContaining({ shop: expect.any(Object) }) }));
    expect(order.createdAt.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  test('benefit expiry and customer/merchant redemption history carry their owning store zone without credentials', async () => {
    const { service, db } = fixture();
    for (const view of [(await service.entitlements('3')).items[0], (await service.adminEntitlements(merchant, '7')).items[0]]) {
      expect(view).toMatchObject({ timezone: 'America/New_York', expiresAtLocal: '2026-12-31 21:30 GMT-5' });
      expect(view).not.toHaveProperty('tokenHash');
    }
    for (const view of [(await service.ownRedemptions('3', rightId)).items[0], (await service.redemptions(merchant, '7')).items[0]]) {
      expect(view).toMatchObject({ timezone: 'America/New_York', createdAtLocal: '2026-11-01 01:30 GMT-5' });
      expect(view).not.toHaveProperty('entitlement');
    }
    expect(db.giftCardRedemption.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entitlementId: rightId, entitlement: { userId: 3n } } }));
  });

  test('unconfigured or invalid store zones remain explicit null projections', async () => {
    for (const zone of [null, '', 'Invalid/Zone']) {
      const { service } = fixture(zone);
      const order = (await service.order('3', '9')).item;
      expect(order.timezone).toBeNull(); expect(order.createdAtLocal).toBeNull(); expect(order.receipts[0].createdAtLocal).toBeNull();
      expect((await service.entitlements('3')).items[0].expiresAtLocal).toBeNull();
      expect((await service.ownRedemptions('3', rightId)).items[0].createdAtLocal).toBeNull();
    }
  });
});
