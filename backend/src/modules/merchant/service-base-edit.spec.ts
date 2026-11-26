import 'reflect-metadata';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { ReservationsService } from '../reservations/reservations.service';
import { StudioService } from '../studio/studio.service';
import { UpdateShopServiceDto } from './dto/merchant.dto';

const admin = { id: '1', role: 'ADMIN' };
function fixture(variantCount = 1, future = false, unusedBaseDuration = 15) {
  let current: any = { id: 20n, shopId: 10n, name: 'Synthetic variant service', description: 'Synthetic', category: 'MASSAGE', durationKind: 'TIMED',
    durationMin: variantCount ? unusedBaseDuration : 60, priceCents: variantCount ? 0 : 5000, isActive: true };
  const events: string[] = [], include = { _count: { select: { variants: true } }, variants: { select: { durationMin: true, priceCents: true, priceBasis: true, currency: true, isActive: true } } };
  const loaded = () => ({ ...current, _count: { variants: variantCount }, variants: variantCount ? [{ id:30n,serviceId:20n,name:'60 minutes',durationMin:60,priceCents:13057,priceBasis:'PER_BOOKING',currency:'usd',isActive:true }] : [] });
  const shop = { id: 10n, ownerId: 9n, deletedAt: null };
  const tx: any = {
    $queryRaw: jest.fn(async () => { events.push('lock'); return []; }),
    user: { findFirst: jest.fn(async () => ({ id: 1n, role: 'ADMIN', status: 'ACTIVE', deletedAt: null })) },
    shop: { findFirst: jest.fn(async () => shop), findUnique: jest.fn(async () => shop) },
    shopService: {
      findFirst: jest.fn(async ({ select }: any) => select?.shopId ? { shopId: 10n } : loaded()),
      findUnique: jest.fn(async ({ select }: any) => select?.shopId ? { shopId: 10n } : loaded()),
      findMany: jest.fn(async () => [loaded()]), count: jest.fn(async () => 1),
      update: jest.fn(async ({ data }: any) => { events.push('write'); current = { ...current, ...data }; return { ...current }; }),
    },
    therapist: { findMany: jest.fn(async () => []) }, shopRoom: { findMany: jest.fn(async () => []) },
    booking: { findFirst: jest.fn(async () => future ? { id: 100n } : null) },
    auditLog: { create: jest.fn(async () => { events.push('audit'); return {}; }) },
  };
  const db: any = { ...tx, $transaction: jest.fn(async (work: any) => {
    const before = structuredClone(current);
    try { return await work(tx); } catch (error) { current = before; throw error; }
  }) };
  return { db, tx, events, include, state: () => structuredClone(current), merchant: new MerchantService(db, {} as any), studio: new StudioService(db) };
}

describe('legacy service CRUD cannot pretend to edit variant price or duration', () => {
  test.each([{ priceCents: 6000 }, { durationMin: 60 }])('merchant rejects changed unused base fields before update or audit (%p)', async change => {
    const f = fixture(), before = f.state();
    await expect(f.merchant.updateShopService('1', '20', change, 'ADMIN')).rejects.toThrow(ConflictException);
    await expect(f.merchant.updateShopService('1', '20', change, 'ADMIN')).rejects.toThrow('修改规格');
    expect(f.state()).toEqual(before); expect(f.tx.shopService.update).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.tx.shopService.findFirst.mock.calls[0][0].include).toEqual(f.include);
  });
  test.each([{ priceCents: 6000 }, { durationMinutes: 60 }, { durationMin: 60 }])('Studio rejects every effective base edit with the same direction to specifications (%p)', async change => {
    const f = fixture(), before = f.state();
    await expect(f.studio.save('services', '20', change, admin)).rejects.toThrow('修改规格');
    expect(f.state()).toEqual(before); expect(f.tx.shopService.update).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  test('unchanged legacy15-minute/zero-cent base can be echoed while editing a name, with hasVariants in both receipts', async () => {
    const merchant = fixture();
    const a = await merchant.merchant.updateShopService('1', '20', { name: 'Renamed', durationMin: 15, priceCents: 0 }, 'ADMIN');
    expect(a).toMatchObject({ name: 'Renamed', hasVariants: true, durationMin: 15, priceCents: 0 });
    const studio = fixture();
    const b: any = await studio.studio.save('services', '20', { name: 'Renamed', durationMinutes: 15, priceCents: 0 }, admin);
    expect(b.item).toMatchObject({ name: 'Renamed', hasVariants: true, durationMinutes: 15, priceCents: 0 });
    expect(b.item).not.toHaveProperty('_count');
  });
  test('hasVariants is present on Studio list and merchant catalog list without exposing count internals', async () => {
    for (const count of [0, 1]) {
      const f = fixture(count), company: any = await f.studio.list('services', { shopId: '10' }, admin);
      const merchant = await f.merchant.getShopServices('1', '10', 'ADMIN');
      expect(company.items[0].hasVariants).toBe(count > 0); expect(merchant[0].hasVariants).toBe(count > 0);
      expect(company.items[0]).not.toHaveProperty('_count'); expect(merchant[0]).not.toHaveProperty('_count');
      expect(f.tx.shopService.findMany.mock.calls[0][0].include).toEqual(f.include);
    }
  });
  test('unreadable base0 projects a real60-minute option in company, merchant and reservation config without changing the stored base', async () => {
    const f=fixture(1,false,0);
    const company:any=await f.studio.list('services',{shopId:'10'},admin),merchant=await f.merchant.getShopServices('1','10','ADMIN');
    const config=await new ReservationsService(f.db).config('10',admin);
    for(const row of [company.items[0],merchant[0],config.services[0]])expect(row).toMatchObject({hasVariants:true,durationMin:60,reservedDurationMin:60});
    const saved=await f.merchant.updateShopService('1','20',{name:'Only label'},'ADMIN');
    expect(saved).toMatchObject({hasVariants:true,durationMin:60,reservedDurationMin:60});expect(f.state().durationMin).toBe(0);
    const companySaved:any=await f.studio.save('services','20',{name:'Second label'},admin);
    expect(companySaved.item).toMatchObject({hasVariants:true,durationMin:60,reservedDurationMin:60});expect(f.state().durationMin).toBe(0);
  });
  test('without variants, base edits take effect within 5–240 minutes and reject a four-minute block', async () => {
    const f = fixture(0);
    expect(await f.merchant.updateShopService('1', '20', { priceCents: 6000, durationMin: 90 }, 'ADMIN')).toMatchObject({ hasVariants: false, priceCents: 6000, durationMin: 90 });
    expect(await f.merchant.updateShopService('1','20',{durationMin:15},'ADMIN')).toMatchObject({durationMin:15});
    await expect(f.merchant.updateShopService('1', '20', { durationMin: 4 }, 'ADMIN')).rejects.toThrow(BadRequestException);
    const company = fixture(0);
    const changed: any = await company.studio.save('services', '20', { durationMinutes: 90, priceCents: 6000 }, admin);
    expect(changed.item).toMatchObject({ hasVariants: false, durationMinutes: 90, priceCents: 6000 });
  });
  test('actual DTO allows a numeric unchanged legacy base to reach the locked guard but rejects null/string coercion', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
    expect(await pipe.transform({ durationMin: 15, priceCents: 0 }, { type: 'body', metatype: UpdateShopServiceDto })).toMatchObject({ durationMin: 15, priceCents: 0 });
    for (const durationMin of [null, '15']) await expect(pipe.transform({ durationMin }, { type: 'body', metatype: UpdateShopServiceDto })).rejects.toThrow(BadRequestException);
  });
  test('kind conversion with future appointments is rejected in both old edit entries; an unchanged kind and label remain editable', async () => {
    const merchant = fixture(1, true), before = merchant.state();
    await expect(merchant.merchant.updateShopService('1', '20', { durationKind: 'VARIABLE' }, 'ADMIN')).rejects.toThrow('不能转换服务类型');
    expect(merchant.state()).toEqual(before); expect(merchant.tx.shopService.update).not.toHaveBeenCalled();
    expect(merchant.tx.booking.findFirst.mock.calls[0][0].where.AND).toEqual([{ OR: [{ serviceId: 20n }, { items: { some: { serviceId: 20n } } }] }]);
    const company = fixture(1, true);
    await expect(company.studio.save('services', '20', { durationKind: 'VARIABLE' }, admin)).rejects.toThrow('不能转换服务类型');
    expect(company.tx.shopService.update).not.toHaveBeenCalled();
    expect(await merchant.merchant.updateShopService('1', '20', { durationKind: 'TIMED', name: 'Only a label' }, 'ADMIN')).toMatchObject({ name: 'Only a label', hasVariants: true });
  });
  test('a permitted type conversion never rewrites unused base or historical booking snapshots', async () => {
    const f = fixture(1);
    expect(await f.merchant.updateShopService('1', '20', { durationKind: 'VARIABLE' }, 'ADMIN')).toMatchObject({ durationKind: 'VARIABLE', hasVariants: true, durationMin: 15, priceCents: 0 });
    expect(f.tx.shopService.update.mock.calls[0][0].data).toEqual({ durationKind: 'VARIABLE' });
    expect(f.tx.booking.findFirst).toHaveBeenCalledTimes(1);
  });
});

