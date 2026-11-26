import 'reflect-metadata';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { couponData, updateCouponInTransaction } from './coupon-policy';
import { COUPON_ALREADY_CLAIMED, CouponsService } from './coupons.service';
import { MerchantCouponDto, MerchantCouponService } from '../merchant/merchant-coupon.service';
import { StudioService } from '../studio/studio.service';

const existing = (patch: Record<string, unknown> = {}): any => ({ id: 70n, shopId: null, title: 'Synthetic coupon', description: null, type: 'FIXED_AMOUNT', value: 100,
  minSpendCents: 0, totalQuantity: 0, claimedCount: 1, usedCount: 0, perUserLimit: 2,
  validFrom: new Date('2020-01-01T00:00:00Z'), validUntil: null, status: 'ACTIVE', deletedAt: null, ...patch });

describe('one wallet row per customer/coupon is an explicit business contract', () => {
  test('new coupons default to one and both DTO/shared service reject pretending multiple vouchers are supported', async () => {
    const input = { title: 'New', type: 'FIXED_AMOUNT', value: 100 };
    expect(couponData(input).perUserLimit).toBe(1);
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const value of [0, 2, 5, '2', null]) {
      expect(() => couponData({ ...input, perUserLimit: value })).toThrow(BadRequestException);
    }
    for (const perUserLimit of [0,2,5]) await expect(pipe.transform({ ...input, perUserLimit }, { type: 'body', metatype: MerchantCouponDto })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ ...input, perUserLimit: 1 }, { type: 'body', metatype: MerchantCouponDto })).resolves.toMatchObject({ perUserLimit: 1 });
  });

  test('issued historical limit two remains unchanged for title/pause edits and all claimed monetary/validity terms stay frozen', async () => {
    const row = existing(), wallet = [{ id: 90n, userId: 2n, couponId: 70n, status: 'UNUSED' }], walletBefore = structuredClone(wallet);
    const update = jest.fn(async ({ data }: any) => ({ ...row, ...data }));
    const tx: any = { $queryRaw: jest.fn(async () => []), coupon: { findFirst: jest.fn(async () => row), update }, userCoupon: { count: jest.fn(async () => wallet.length) } };
    const result = await updateCouponInTransaction(tx, 70n, { title: 'Clearer issued name', status: 'PAUSED' });
    expect(result).toMatchObject({ title: 'Clearer issued name', status: 'PAUSED', perUserLimit: 2, value: 100, claimedCount: 1 });
    expect(wallet).toEqual(walletBefore);
    await expect(updateCouponInTransaction(tx, 70n, { value: 101 })).rejects.toThrow(ConflictException);
    await expect(updateCouponInTransaction(tx, 70n, { perUserLimit: 1 })).rejects.toThrow(ConflictException);
    await expect(updateCouponInTransaction(tx, 70n, { perUserLimit: 2 })).rejects.toThrow(BadRequestException);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('unissued historical coupons are normalized to the supported single-claim setting without deleting anything', async () => {
    const row = existing({ claimedCount: 0 });
    const update = jest.fn(async ({ data }: any) => ({ ...row, ...data }));
    const tx: any = { $queryRaw: async () => [], coupon: { findFirst: async () => row, update }, userCoupon: { count: async () => 0 } };
    expect(await updateCouponInTransaction(tx, 70n, { title: 'Draft edited' })).toMatchObject({ perUserLimit: 1, claimedCount: 0, title: 'Draft edited' });
  });

  test('platform omitted rule stays omitted for issued edits, explicit unsupported limit is rejected and responses label actual versus configured limit', async () => {
    const service: any = new StudioService({} as any), row = existing({ createdAt: new Date(), updatedAt: new Date() });
    const changed = await service.data({}, 'coupons', { name: 'Renamed' }, row, { id: '1', role: 'ADMIN' });
    expect(changed).not.toHaveProperty('perUserLimit');
    await expect(service.data({}, 'coupons', { perUserLimit: 2 }, row, { id: '1', role: 'ADMIN' })).rejects.toThrow(BadRequestException);
    expect(service.map('coupons', row)).toMatchObject({ perUserLimit: 1, configuredPerUserLimit: 2 });
    expect((new MerchantCouponService({} as any) as any).serialize(row)).toMatchObject({ perUserLimit: 1, configuredPerUserLimit: 2 });
  });

  test('a historical >1 setting never increments counters or attempts a second wallet write, even after the first voucher was used', async () => {
    const row = existing({ perUserLimit: 5 }), increment = jest.fn(), create = jest.fn();
    const tx: any = { $queryRaw: async () => [], coupon: { findUnique: async () => row, update: increment, updateMany: increment }, userCoupon: { count: async () => 1, create } };
    const db: any = { coupon: { findUnique: async () => ({ shopId: null }) }, $transaction: async (work: any) => work(tx) };
    await expect(new CouponsService(db).claim('2', '70')).rejects.toThrow(COUPON_ALREADY_CLAIMED);
    expect(increment).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  test('claimable listing reports effective one with the historical setting visible and reuses its batched wallet lookup', async () => {
    const count = jest.fn();
    const db: any = { $queryRaw: async () => [], coupon: { findMany: async () => [existing()] }, userCoupon: { findMany: async () => [{ couponId: 70n }], count } };
    const result = await new CouponsService(db).listClaimable('2');
    expect(result).toEqual([expect.objectContaining({ perUserLimit: 1, configuredPerUserLimit: 2, claimedByMe: true, userClaimCount: 1 })]);
    expect(count).not.toHaveBeenCalled();
  });
});
