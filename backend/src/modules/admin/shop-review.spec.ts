import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopReviewService } from './shop-review.service';

/** Transaction simulator: commits staged state only after the callback resolves.
 * This verifies service use of one transaction; it is not a MySQL rollback test. */
function transactionFixture(options: { shop?: Record<string, any>; owner?: any; loginAccount?: any; auditFailure?: boolean; updateFailure?: boolean; absent?: boolean } = {}) {
  let committedShop: Record<string, any> = {
    id: 7n, ownerId: 2n, status: 'PENDING', deletedAt: null,
    name: 'Synthetic studio', shortName: 'synthetic-studio', timezone: 'America/New_York',
    phone: '+12025550149', address: 'Synthetic address', city: 'Synthetic city', state: 'Synthetic state',
    latitude: 40.7, longitude: -73.9,
    businessHours: { monday: { open: '09:00', close: '18:00', closed: false } },
    ...options.shop,
  };
  let committedAudits: Record<string, any>[] = [];
  const events: string[] = [];
  const outsideAudit = { create: jest.fn(() => { throw new Error('Audit must use the active transaction'); }) };
  const outsideUpdate = jest.fn(() => { throw new Error('Update must use the active transaction'); });
  let tx: any;
  const prisma = {
    shop: { update: outsideUpdate },
    $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => {
      let stagedShop = structuredClone(committedShop);
      const stagedAudits = structuredClone(committedAudits);
      tx = {
        $queryRaw: jest.fn(async () => { events.push('lock'); return []; }),
        shop: {
          findFirst: jest.fn(async ({ where }: any) => {
            events.push('read-shop');
            return !options.absent && where.id === stagedShop.id && where.deletedAt === null && stagedShop.deletedAt === null ? structuredClone(stagedShop) : null;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            events.push('update');
            if (options.updateFailure) throw new Error('Synthetic update failure');
            if (where.id !== stagedShop.id) throw new Error('Incorrect update target');
            stagedShop = { ...stagedShop, ...data }; return structuredClone(stagedShop);
          }),
        },
        user: { findUnique: jest.fn(async ({ where }: any) => {
          events.push('read-owner');
          expect(where.id).toBe(stagedShop.ownerId);
          return options.owner === undefined ? { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null } : options.owner;
        }) },
        shopLoginBinding: { findUnique: jest.fn(async ({ where }: any) => {
          events.push('read-binding'); expect(where.shopId).toBe(stagedShop.id);
          return options.loginAccount === null ? null : { userId: 20n, user: options.loginAccount ?? { id:20n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName:'synthetic-merchant', email:null, phone:null, passwordHash:'$2b$12$'+'A'.repeat(53) } };
        }) },
        auditLog: { create: jest.fn(async ({ data }: any) => {
          events.push('audit');
          if (options.auditFailure) throw new Error('Synthetic audit failure');
          stagedAudits.push(structuredClone(data)); return { id: 1n, ...data };
        }) },
      };
      const result = await callback(tx);
      committedShop = stagedShop; committedAudits = stagedAudits; events.push('commit');
      return result;
    }),
  };
  return {
    service: new ShopReviewService(prisma as any, outsideAudit as any), prisma, outsideAudit, outsideUpdate, events,
    transaction: () => tx, state: () => ({ shop: structuredClone(committedShop), audits: structuredClone(committedAudits) }),
  };
}

describe('Shop review authorization inputs and atomic decision/audit contract (transaction simulation)', () => {
  test('approval locks the shop and commits decision plus audit independently of merchant login', async () => {
    const fixture = transactionFixture();
    const result = await fixture.service.review('7', { action: 'APPROVE', reason: '  Synthetic decision  ' }, '3');
    expect(result).toMatchObject({ id: '7', status: 'APPROVED', reviewComment: 'Synthetic decision', reviewedBy: '3' });
    expect(fixture.events).toEqual(['lock', 'read-shop', 'update', 'audit', 'commit']);
    expect(fixture.state().audits).toEqual([{
      action: 'APPROVE', targetType: 'SHOP', targetId: 7n, operatorId: 3n,
      detail: { reason: 'Synthetic decision', previousStatus: 'PENDING', newStatus: 'APPROVED' },
    }]);
    expect(fixture.transaction().$queryRaw.mock.calls[0][0].values).toEqual([7n]);
    expect(fixture.transaction().$queryRaw).toHaveBeenCalledTimes(1);
    expect(fixture.transaction().shopLoginBinding.findUnique).not.toHaveBeenCalled();
    expect(fixture.transaction().user.findUnique).not.toHaveBeenCalled();
    expect(fixture.outsideAudit.create).not.toHaveBeenCalled(); expect(fixture.outsideUpdate).not.toHaveBeenCalled();
  });
  test('an audit failure rolls staged approval back rather than reporting success', async () => {
    const fixture = transactionFixture({ auditFailure: true });
    const before = fixture.state();
    await expect(fixture.service.review('7', { action: 'APPROVE' }, '3')).rejects.toThrow('Synthetic audit failure');
    expect(fixture.events).toEqual(['lock', 'read-shop', 'update', 'audit']);
    expect(fixture.transaction().shop.update).toHaveBeenCalled();
    expect(fixture.state()).toEqual(before);
  });
  test('an update failure cannot commit an audit for a decision that did not occur', async () => {
    const fixture = transactionFixture({ updateFailure: true }); const before = fixture.state();
    await expect(fixture.service.review('7', { action: 'APPROVE' }, '3')).rejects.toThrow('Synthetic update failure');
    expect(fixture.transaction().auditLog.create).not.toHaveBeenCalled(); expect(fixture.state()).toEqual(before);
  });
  test.each([
    { shop: { timezone: null } },
    { shop: { businessHours: { monday: { open: '18:00', close: '09:00', closed: false } } } },
  ])('ineligible approval %# commits neither decision nor audit', async options => {
    const fixture = transactionFixture(options); const before = fixture.state();
    await expect(fixture.service.review('7', { action: 'APPROVE' }, '3')).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.transaction().shop.update).not.toHaveBeenCalled(); expect(fixture.transaction().auditLog.create).not.toHaveBeenCalled();
    expect(fixture.state()).toEqual(before);
  });
  test.each([null,{role:'USER',status:'ACTIVE',deletedAt:null},{role:'MERCHANT',status:'SUSPENDED',deletedAt:null},{role:'MERCHANT',status:'ACTIVE',deletedAt:new Date('2026-10-27T00:00:00Z')}])('login state %# stays independent of approval and audit',async loginAccount=>{
    const fixture=transactionFixture({loginAccount});
    await expect(fixture.service.review('7',{action:'APPROVE'},'3')).resolves.toMatchObject({status:'APPROVED'});
    expect(fixture.state().audits).toHaveLength(1);
    expect(fixture.transaction().shopLoginBinding.findUnique).not.toHaveBeenCalled();
  });
  test('missing geocoordinates no longer block an otherwise complete approval', async () => {
    const fixture=transactionFixture({shop:{latitude:null,longitude:null}});
    await expect(fixture.service.review('7',{action:'APPROVE'},'3')).resolves.toMatchObject({status:'APPROVED'});
    expect(fixture.state().audits).toHaveLength(1);
  });
  test('historical owner suspension cannot block publishing when the independent login is valid', async () => {
    const fixture = transactionFixture({ owner: { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: new Date('2026-10-27T00:00:00Z') } });
    await expect(fixture.service.review('7', { action: 'APPROVE' }, '3')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(fixture.state().shop.ownerId).toBe(2n); expect(fixture.state().audits).toHaveLength(1);
  });
  test.each(['REJECT', 'REQUEST_INFO'])('%s records a trimmed reason even for an incomplete shop', async action => {
    const fixture = transactionFixture({ shop: { timezone: null }, owner: null });
    const result = await fixture.service.review('7', { action, reason: '  Synthetic missing-document reason  ' }, '3');
    expect(result).toMatchObject({ status: action === 'REJECT' ? 'REJECTED' : 'PENDING', reviewComment: 'Synthetic missing-document reason' });
    expect(fixture.state().audits[0].detail.reason).toBe('Synthetic missing-document reason');
    expect(fixture.transaction().user.findUnique).not.toHaveBeenCalled();
  });
  test.each([undefined, null, '', '  ', '\t\n'])('reject reason %# is mandatory before opening a transaction', async reason => {
    const fixture = transactionFixture();
    await expect(fixture.service.review('7', { action: 'REJECT', reason: reason as any }, '3')).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });
  test.each(['0', '-1', '01', '1.5', '1e2', '7abc', ' 7', '9223372036854775808'])('malformed target/operator ID %s is rejected before transaction access', async invalid => {
    const fixture = transactionFixture();
    await expect(fixture.service.review(invalid, { action: 'APPROVE' }, '3')).rejects.toBeInstanceOf(BadRequestException);
    await expect(fixture.service.review('7', { action: 'APPROVE' }, invalid)).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });
  test('large valid IDs preserve BigInt precision in both update and audit', async () => {
    const targetId = '9007199254740993', operatorId = '9223372036854775807';
    const fixture = transactionFixture({ shop: { id: BigInt(targetId) } });
    const result = await fixture.service.review(targetId, { action: 'APPROVE' }, operatorId);
    expect(result.id).toBe(targetId); expect(result.reviewedBy).toBe(operatorId);
    expect(fixture.state().audits[0]).toMatchObject({ targetId: BigInt(targetId), operatorId: BigInt(operatorId) });
  });
  test.each([{ action: 'DELETE' }, { action: 'REJECT', reason: 'x'.repeat(2001) }, { action: 'REJECT', reason: 5 }])('invalid decision input %# fails before transaction access', async dto => {
    const fixture = transactionFixture();
    await expect(fixture.service.review('7', dto as any, '3')).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });
  test.each([{ absent: true }, { shop: { deletedAt: new Date('2026-10-27T00:00:00Z') } }])('missing or deleted shop %# cannot be approved or audited', async options => {
    const fixture = transactionFixture(options);
    await expect(fixture.service.review('7', { action: 'APPROVE' }, '3')).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.transaction().shop.update).not.toHaveBeenCalled(); expect(fixture.transaction().auditLog.create).not.toHaveBeenCalled();
  });
});
