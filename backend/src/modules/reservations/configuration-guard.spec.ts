import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MerchantService } from '../merchant/merchant.service';
import { StudioService } from '../studio/studio.service';
import { effectiveBookingWhere, resourceBookingWhere, ensureServiceConfiguration, ensureShopConfiguration, ensureTherapistConfiguration, withShopConfiguration } from './configuration-guard';

// Small general predicate evaluator for scalar/AND/OR query semantics; this is no DB test.
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([field, value]: [string, any]) => {
    if (field === 'OR') return value.some((part: any) => matches(row, part));
    if (field === 'AND') return value.every((part: any) => matches(row, part));
    if (value === null || typeof value !== 'object' || value instanceof Date) return row[field] === value;
    return Object.entries(value).every(([operator, operand]: [string, any]) => operator === 'in' ? operand.includes(row[field]) : operator === 'not' ? row[field] !== operand : operator === 'gt' ? row[field] !== null && row[field] > operand : false);
  });
}
const actor = { id: '2', role: 'MERCHANT' };
const activeLogin = (userId:bigint) => ({userId,user:{role:'MERCHANT',status:'ACTIVE',deletedAt:null}});
const operator = { findFirst:jest.fn(async ({where}:any)=> where.id === 2n && where.role === 'MERCHANT' ? {id:2n,role:'MERCHANT',status:'ACTIVE',deletedAt:null}:null) };
const instant = new Date('2040-10-24T12:00:00Z');
const futureWindow = { startTime: new Date('2040-10-24T13:00:00Z'), endTime: new Date('2040-10-24T14:00:00Z') };
const base = { paidCents: 0, status: 'PENDING', paymentStatus: 'UNPAID', deletedAt: null, holdExpiresAt: null };

describe('shared reservation configuration guards (no database)', () => {
  test('expired and exactly-expiring unpaid holds stop blocking, while paid/confirmed/legacy reservations remain', () => {
    const where = effectiveBookingWhere(instant);
    expect(matches({ ...base, holdExpiresAt: new Date(instant.getTime() - 1) }, where)).toBe(false);
    expect(matches({ ...base, holdExpiresAt: instant }, where)).toBe(false);
    expect(matches({ ...base, holdExpiresAt: new Date(instant.getTime() + 1) }, where)).toBe(true);
    expect(matches(base, where)).toBe(true);
    expect(matches({ ...base, paymentStatus: 'PAID', holdExpiresAt: instant }, where)).toBe(true);
    expect(matches({ ...base, status: 'CONFIRMED', holdExpiresAt: instant }, where)).toBe(true);
    expect(matches({ ...base, status: 'CANCELLED' }, where)).toBe(false);
    expect(matches({ ...base, deletedAt: instant }, where)).toBe(false);
  });
  test('completed cleanup and inconsistent terminal ACTIVE windows stay protected, but expired wholly unpaid holds do not', () => {
    const where = resourceBookingWhere(instant);
    expect(matches({ ...base, status: 'COMPLETED' }, where)).toBe(true);
    expect(matches({ ...base, status: 'CANCELLED' }, where)).toBe(true);
    expect(matches({ ...base, status: 'REFUNDED', deletedAt: instant }, where)).toBe(true);
    expect(matches({ ...base, holdExpiresAt: instant }, where)).toBe(false);
    expect(matches({ ...base, holdExpiresAt: instant, paidCents: 1 }, where)).toBe(true);
  });
  test('actual staff guard rejects deactivation during completed cleanup without using service end as its occupation end', async () => {
    const booking = { ...base, status: 'COMPLETED', startTime: new Date('2000-01-01T09:00:00Z'), endTime: new Date('2000-01-01T10:00:00Z'), serviceId: 7n };
    const tx: any = { booking: { findMany: jest.fn(async () => []) }, bookingResourceLock: { findMany: jest.fn(async ({ where }: any) => {
      // Execute the actual guard-generated booking predicate on a completed row.
      expect(where.endAtUtc.gt).toBeInstanceOf(Date);
      expect(where.booking.endTime).toBeUndefined();
      return matches(booking, where.booking) ? [{ bookingItem: { serviceId: 7n }, booking }] : [];
    }) } };
    await expect(ensureTherapistConfiguration(tx, { id: 8n, shopId: 1n, isActive: true }, { isActive: false })).rejects.toThrow(ConflictException);
  });
  test('foreign Studio store save/remove remain hidden as 404 without entering a write transaction', async () => {
    const prisma: any = { shop: { findFirst: jest.fn(async () => null) }, $transaction: jest.fn() };
    const studio = new StudioService(prisma);
    await expect(studio.save('stores','1',{ name: 'Synthetic' },actor)).rejects.toThrow(NotFoundException);
    await expect(studio.remove('stores','1',actor)).rejects.toThrow(NotFoundException);
    expect(prisma.shop.findFirst.mock.calls[0][0]).toEqual({ where: { deletedAt: null, ownerId: 2n, id: 1n }, select: { id: true } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('service rename and price changes are allowed without querying or rewriting existing snapshots', async () => {
    const tx = { booking: { findFirst: jest.fn(async () => ({ id: 1n })) } };
    await expect(ensureServiceConfiguration(tx, { id: 7n, shopId: 1n, isActive: true }, { name: 'Updated', priceCents: 6000 })).resolves.toBeUndefined();
    expect(tx.booking.findFirst).not.toHaveBeenCalled();
    await expect(ensureServiceConfiguration(tx, { id: 7n, shopId: 1n, isActive: true }, { isActive: false })).rejects.toThrow(ConflictException);
  });
  test('legacy service mappings never restrict the shop pool; deactivating occupied staff remains rejected', async () => {
    const tx: any = { therapistService: { findMany: jest.fn(async () => [{ serviceId: 7n }, { serviceId: 9n }]) },
      bookingResourceLock: { findMany: jest.fn(async () => [{ bookingItem: { serviceId: 7n }, booking: { serviceId: 7n } }]) }, booking: { findMany: jest.fn(async () => []) } };
    const therapist = { id: 8n, shopId: 1n, isActive: true };
    await expect(ensureTherapistConfiguration(tx, therapist, {}, [7n])).resolves.toBeUndefined();
    await expect(ensureTherapistConfiguration(tx, therapist, {}, [7n, 9n, 10n])).resolves.toBeUndefined();
    await expect(ensureTherapistConfiguration(tx, therapist, {}, [9n])).resolves.toBeUndefined();
    await expect(ensureTherapistConfiguration(tx, therapist, {}, [])).resolves.toBeUndefined();
    expect(tx.therapistService.findMany).not.toHaveBeenCalled();
    expect(tx.bookingResourceLock.findMany).not.toHaveBeenCalled();
    await expect(ensureTherapistConfiguration(tx, therapist, { isActive: false })).rejects.toThrow(ConflictException);
  });
  test('unassigned legacy bookings protect deactivation but do not block irrelevant legacy mapping changes', async () => {
    const tx: any = { therapistService: { findMany: jest.fn(async () => [{ serviceId: 7n }]) },
      bookingResourceLock: { findMany: jest.fn(async () => []) }, booking: { findMany: jest.fn(async () => [{ serviceId: 7n }]) } };
    await expect(ensureTherapistConfiguration(tx, { id: 8n, shopId: 1n, isActive: true }, {}, [])).resolves.toBeUndefined();
    expect(tx.booking.findMany).not.toHaveBeenCalled();
    await expect(ensureTherapistConfiguration(tx, { id: 8n, shopId: 1n, isActive: true }, { isActive: false }, [])).rejects.toThrow(ConflictException);
    expect(tx.booking.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [{ therapistId: 8n }, { therapistId: null }] }]);
  });
  test('hours can expand or keep multi-period reservations, but cannot introduce a gap through one', async () => {
    const tx: any = { shopCalendarBlock: { findFirst: jest.fn(async () => null) }, booking: { findMany: jest.fn(async () => [futureWindow]) }, bookingResourceLock: { findMany: jest.fn(async () => []) } };
    const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date('2040-10-24T12:00:00Z').getUTCDay()];
    const shop = { id: 1n, timezone: 'America/New_York', businessHours: { [day]: { open: '09:00', close: '18:00' } } };
    const multi = { [day]: [{ open: '08:00', close: '12:00' }, { open: '13:00', close: '20:00' }] };
    await expect(ensureShopConfiguration(tx, shop, { businessHours: multi })).resolves.toBeUndefined();
    await expect(ensureShopConfiguration(tx, shop, { businessHours: { [day]: [{ open: '08:00', close: '09:30' }, { open: '10:30', close: '20:00' }] } })).rejects.toThrow(ConflictException);
    await expect(ensureShopConfiguration(tx, shop, { timezone: 'America/Chicago' })).rejects.toThrow(ConflictException);
  });
  test('shop hours and timezone protect resource cleanup even when the booking itself has ended', async () => {
    const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date('2040-10-24T12:00:00Z').getUTCDay()];
    const shop = { id:1n, timezone:'America/New_York', businessHours:{[day]:{open:'09:00',close:'18:00'}} };
    const tx:any = { shopCalendarBlock:{findFirst:jest.fn(async()=>null)}, booking:{findMany:jest.fn(async()=>[])}, bookingResourceLock:{findMany:jest.fn(async()=>[{startAtUtc:new Date('2040-10-24T13:00:00Z'),endAtUtc:new Date('2040-10-24T14:10:00Z')}])} };
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{[day]:{open:'09:00',close:'10:00'}}})).rejects.toThrow(ConflictException);
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{[day]:{open:'08:00',close:'10:10'}}})).resolves.toBeUndefined();
    await expect(ensureShopConfiguration(tx,shop,{timezone:'America/Chicago'})).rejects.toThrow(ConflictException);
    expect(tx.bookingResourceLock.findMany.mock.calls[0][0].where.booking.endTime).toBeUndefined();
  });
  test.each(['ROOM','CUSTOM'])('opening expansion and safe shortening do not reinterpret independent%s cleanup as store hours',async resource=>{
    const shop={id:1n,timezone:'UTC',businessHours:{monday:{open:'09:00',close:'18:00'}}};
    const lock={resourceType:resource==='ROOM'?'ROOM':'THERAPIST',resourceId:8n,startAtUtc:new Date('2040-10-29T17:00:00Z'),endAtUtc:new Date('2040-10-29T18:15:00Z')};
    const tx:any={booking:{findMany:jest.fn(async()=>[{startTime:new Date('2040-10-29T17:00:00Z'),endTime:new Date('2040-10-29T18:00:00Z')}])},bookingResourceLock:{findMany:jest.fn(async()=>[lock])},therapist:{findMany:jest.fn(async()=>[{id:8n,scheduleMode:'CUSTOM'}])}};
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{monday:{open:'08:00',close:'18:00'}}})).resolves.toBeUndefined();
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{monday:{open:'10:00',close:'18:00'}}})).resolves.toBeUndefined();
    expect(lock.endAtUtc.toISOString()).toBe('2040-10-29T18:15:00.000Z');
  });
  test('SHOP staff full cleanup remains protected on narrowing and even on expansion of an inconsistent old window',async()=>{
    const shop={id:1n,timezone:'UTC',businessHours:{monday:{open:'09:00',close:'20:00'}}};
    const lock={resourceType:'THERAPIST',resourceId:8n,startAtUtc:new Date('2040-10-29T17:00:00Z'),endAtUtc:new Date('2040-10-29T18:15:00Z')};
    const tx:any={booking:{findMany:jest.fn(async()=>[{startTime:lock.startAtUtc,endTime:new Date('2040-10-29T18:00:00Z')}])},bookingResourceLock:{findMany:jest.fn(async()=>[lock])},therapist:{findMany:jest.fn(async()=>[{id:8n,scheduleMode:'SHOP'}])}};
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{monday:{open:'09:00',close:'18:00'}}})).rejects.toThrow('收尾缓冲');
    shop.businessHours.monday.close='18:00';
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{monday:{open:'08:00',close:'18:00'}}})).rejects.toThrow('收尾缓冲');
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{monday:{open:'08:00',close:'18:15'}}})).resolves.toBeUndefined();
  });
  test('narrowing still protects real service time for personal staff and preserves unknown staff conservatively',async()=>{
    const shop={id:1n,timezone:'UTC',businessHours:{monday:{open:'09:00',close:'20:00'}}};
    const lock={resourceType:'THERAPIST',resourceId:8n,startAtUtc:new Date('2040-10-29T17:00:00Z'),endAtUtc:new Date('2040-10-29T19:10:00Z')};
    const tx:any={booking:{findMany:jest.fn(async()=>[{startTime:lock.startAtUtc,endTime:new Date('2040-10-29T19:00:00Z')}])},bookingResourceLock:{findMany:jest.fn(async()=>[lock])},therapist:{findMany:jest.fn(async()=>[{id:8n,scheduleMode:'CUSTOM'}])}};
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{monday:{open:'09:00',close:'18:00'}}})).rejects.toThrow('已有预约');
    tx.booking.findMany.mockResolvedValue([]);tx.therapist.findMany.mockResolvedValue([]);
    await expect(ensureShopConfiguration(tx,shop,{businessHours:{monday:{open:'09:00',close:'18:00'}}})).rejects.toThrow('收尾缓冲');
  });
  test('independent login binding is rechecked after the shop lock; historical ownership cannot authorize a foreign login', async () => {
    const events: string[] = [];
    const tx = { user:operator,shopAccountGrant:{findFirst:async()=>null}, $queryRaw: jest.fn(async () => { events.push('lock'); return []; }), shop: { findFirst: jest.fn(async () => { events.push('read'); return { id: 1n, ownerId: 2n, loginBinding:activeLogin(99n) }; }) } };
    const prisma: any = { $transaction: jest.fn(async (callback: any) => callback(tx)) };
    const callback = jest.fn();
    await expect(withShopConfiguration(prisma, 1n, actor, callback)).rejects.toThrow(ForbiddenException);
    expect(events[0]).toBe('lock'); expect(events).toContain('read'); expect(callback).not.toHaveBeenCalled();
  });
  test('merchant service update discovers only parent ID then locks/reloads and audits in one transaction', async () => {
    const events: string[] = [];
    const previousService = { id: 7n, shopId: 1n, isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 5000 };
    const tx: any = { user:operator,shopAccountGrant:{findFirst:async()=>null}, $queryRaw: jest.fn(async () => { events.push('lock'); return []; }), shop: { findFirst: jest.fn(async () => { events.push('shop'); return { id: 1n, ownerId: 99n, loginBinding:activeLogin(2n) }; }) },
      shopService: { findFirst: jest.fn(async () => { events.push('service'); return previousService; }), update: jest.fn(async ({ data }: any) => { events.push('write'); return { ...previousService, ...data }; }) },
      auditLog: { create: jest.fn(async () => { events.push('audit'); return {}; }) } };
    const prisma: any = { shopService: { findUnique: jest.fn(async () => ({ shopId: 1n })) }, $transaction: jest.fn(async (callback: any) => callback(tx)) };
    const service = new MerchantService(prisma, {} as any);
    await service.updateShopService('2','7',{ priceCents: 5735 });
    expect(prisma.shopService.findUnique.mock.calls[0][0]).toEqual({ where: { id: 7n }, select: { shopId: true } });
    expect(events[0]).toBe('lock'); expect(events.lastIndexOf('shop')).toBeLessThan(events.indexOf('service'));
    expect(events.indexOf('service')).toBeLessThan(events.indexOf('write')); expect(events.indexOf('write')).toBeLessThan(events.indexOf('audit'));
  });
  test('Studio technician changes lock the shop first and refuse occupied deactivation before mutation', async () => {
    const events: string[] = [];
    const previous = { id: 8n, shopId: 1n, name: 'Synthetic therapist', bio: '', isActive: true };
    const tx: any = { user:operator,shopAccountGrant:{findFirst:async()=>null}, $queryRaw: jest.fn(async () => { events.push('lock'); return []; }), shop: { findFirst: jest.fn(async () => { events.push('shop'); return { id: 1n, ownerId: 99n, loginBinding:activeLogin(2n) }; }) },
      therapist: { findFirst: jest.fn(async () => previous), update: jest.fn() }, therapistService: { findMany: jest.fn(async () => [{ serviceId: 7n }]) },
      bookingResourceLock: { findMany: jest.fn(async () => [{ bookingItem: { serviceId: 7n }, booking: { serviceId: 7n } }]) }, booking: { findMany: jest.fn(async () => []) }, auditLog: { create: jest.fn() } };
    const prisma: any = { therapist: { findFirst: jest.fn(async () => ({ shopId: 1n })) }, $transaction: jest.fn(async (callback: any) => callback(tx)) };
    const service = new StudioService(prisma);
    await expect(service.save('technicians', '8', { status: 'INACTIVE' }, actor)).rejects.toThrow(ConflictException);
    expect(events[0]).toBe('lock');
    expect(tx.therapist.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
