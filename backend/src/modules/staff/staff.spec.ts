import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { requireShopAccess, shopAccessWhere, staffPermissions } from '../../common/shop-access';
import { ReservationsService } from '../reservations/reservations.service';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './staff.dto';

const owner = { id: '2', role: 'MERCHANT' }, staff = { id: '3', role: 'STAFF' }, admin = { id: '1', role: 'ADMIN' };
const passwordMatrix: { name: string; value: string; bytes: number; accepted: boolean }[] = require('../../../test/staff-password-policy.matrix.cjs');
function fixture() {
  const account = (id: bigint, role: string) => ({ id, role, status: 'ACTIVE', deletedAt: null, name: 'Synthetic staff', email: `${id}@example.invalid`, phone: `+1202555000${id}` });
  let state: any = { users: [account(1n, 'ADMIN'), account(2n, 'MERCHANT'), account(3n, 'STAFF'), account(4n, 'CUSTOMER'), account(9n, 'MERCHANT')], grants: [{ id: 10n, shopId: 71n, userId: 3n, createdById: 2n, status: 'ACTIVE', permissions: ['BOOKINGS_READ'], createdAt: new Date(), updatedAt: new Date(), revokedAt: null }], audits: [] };
  const events: string[] = []; let auditFailure = false, tail = Promise.resolve();
  const safeUser = (user: any) => user && Object.fromEntries(['id','name','email','phone','role','status'].map(key => [key, user[key]]));
  const shop = (data: any) => ({ id: 71n, ownerId: 9n, deletedAt: null, status: 'APPROVED', studioProfile: {}, owner: data.users.find((user: any) => user.id === 9n), loginBinding: { userId: 2n, user: data.users.find((user: any) => user.id === 2n) } });
  function client(data: any): any {
    const grant = (where: any) => data.grants.find((row: any) => where.id !== undefined ? row.id === where.id : row.shopId === where.shopId_userId.shopId && row.userId === where.shopId_userId.userId);
    const withUser = (row: any) => ({ ...row, user: safeUser(data.users.find((user: any) => user.id === row.userId)) });
    return {
      $queryRaw: jest.fn(async (query: any) => { const sql = query.sql ?? query.join(''); events.push(sql.includes('shops') ? 'lock-shop' : 'lock-user'); return []; }),
      user: {
        findFirst: jest.fn(async ({ where }: any) => { events.push('read-account'); return data.users.find((user: any) => Object.entries(where).every(([key,value]) => user[key] === value)) ?? null; }),
        create: jest.fn(async ({ data: input }: any) => { const row = { id: 5n, deletedAt: null, ...input }; data.users.push(row); return safeUser(row); }),
      },
      shop: { findFirst: jest.fn(async ({where}: any) => { events.push('read-shop'); return where.id === 71n ? shop(data) : null; }), update: jest.fn() },
      shopAccountGrant: { findFirst: jest.fn(async () => null) },
      shopStaffGrant: {
        findUnique: jest.fn(async ({ where }: any) => { events.push('read-grant'); return grant(where) ?? null; }),
        create: jest.fn(async ({ data: input }: any) => { const row = { id: 20n, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), revokedAt: null, ...input }; data.grants.push(row); return withUser(row); }),
        upsert: jest.fn(async ({ where, create, update }: any) => { let row = grant(where); if (row) Object.assign(row, update); else { row = { id: 20n, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), revokedAt: null, ...create }; data.grants.push(row); } return withUser(row); }),
        update: jest.fn(async ({ where, data: input }: any) => { const row = grant(where); Object.assign(row, input); return withUser(row); }),
        findMany: jest.fn(async ({where,skip,take}: any) => data.grants.filter((row: any) => row.shopId === where.shopId).slice(skip,skip+take).map(withUser)),
        count: jest.fn(async ({where}: any) => data.grants.filter((row: any) => row.shopId === where.shopId).length),
      },
      auditLog: { create: jest.fn(async ({data: input}: any) => { if (auditFailure) throw new Error('Synthetic audit failure'); data.audits.push(input); return input; }) },
    };
  }
  const db: any = new Proxy({}, { get: (_, key) => key === '$transaction' ? transaction : client(state)[key] });
  // Staged transactions plus a queue model the shared shop mutex contract only;
  // these tests do not claim to exercise MySQL locks or database rollback.
  function transaction(work: any, options: any) {
    expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
    const result = tail.then(async () => { const staged = structuredClone(state); const value = await work(client(staged)); state = staged; return value; });
    tail = result.then(() => undefined, () => undefined); return result;
  }
  return { db, service: new StaffService(db), events, state: () => state, failAudit: () => { auditFailure = true; } };
}

describe('shop staff access (synthetic, no database)', () => {
  test('a read grant never authorizes booking writes, finance, configuration or owner powers', async () => {
    const f = fixture();
    await expect(requireShopAccess(f.db, 71n, staff, 'BOOKINGS_READ')).resolves.toMatchObject({ isOwner: false, permissions: ['BOOKINGS_READ'] });
    for (const permission of ['BOOKINGS_MANAGE','FINANCE_READ','RESERVATION_CONFIG','OWNER_ONLY'] as const) await expect(requireShopAccess(f.db, 71n, staff, permission)).rejects.toThrow(ForbiddenException);
  });
  test('membership in another shop cannot authorize this shop', async () => {
    const f = fixture(); f.state().grants[0].shopId = 72n;
    await expect(requireShopAccess(f.db, 71n, staff, 'BOOKINGS_READ')).rejects.toThrow(ForbiddenException);
  });
  test.each(['REVOKED','INVALID'])('a %s grant fails closed without trusting session metadata', async status => {
    const f = fixture(); f.state().grants[0].status = status;
    await expect(requireShopAccess(f.db, 71n, staff, 'BOOKINGS_READ')).rejects.toThrow(ForbiddenException);
  });
  test.each(['staff-disabled','login-disabled','login-deleted','login-role'])('current account qualification is reread: %s', async mode => {
    const f = fixture(); const user = f.state().users.find((row: any) => row.id === (mode === 'staff-disabled' ? 3n : 2n));
    if (mode === 'login-deleted') user.deletedAt = new Date(); else if (mode === 'login-role') user.role = 'CUSTOMER'; else user.status = 'SUSPENDED';
    await expect(requireShopAccess(f.db, 71n, staff, 'BOOKINGS_READ')).rejects.toThrow(ForbiddenException);
  });
  test('the independent home login retains powers and ADMIN can handle a disabled login account', async () => {
    const f = fixture(); await expect(requireShopAccess(f.db, 71n, owner, 'OWNER_ONLY')).resolves.toMatchObject({ isOwner: true });
    f.state().users[1].status = 'SUSPENDED'; await expect(requireShopAccess(f.db, 71n, admin, 'OWNER_ONLY')).resolves.toMatchObject({ isOwner: true });
  });
  test('a disabled historical financial owner does not revoke the independent login or its staff', async () => {
    const f = fixture(); f.state().users.find((row: any) => row.id === 9n).status = 'SUSPENDED';
    await expect(requireShopAccess(f.db, 71n, owner, 'OWNER_ONLY')).resolves.toMatchObject({ isOwner: true, accessType: 'OWN' });
    await expect(requireShopAccess(f.db, 71n, staff, 'BOOKINGS_READ')).resolves.toMatchObject({ isOwner: false, accessType: 'STAFF' });
    await expect(requireShopAccess(f.db, 71n, { id: '9', role: 'MERCHANT' }, 'OWNER_ONLY')).rejects.toThrow(ForbiddenException);
  });
  test('claiming a merchant role does not convert a STAFF account into its owner', async () => {
    const f = fixture(); await expect(requireShopAccess(f.db, 71n, { id: '3', role: 'MERCHANT' }, 'OWNER_ONLY')).rejects.toThrow(ForbiddenException);
  });
  test('only supported permissions are accepted and booking writes require read access', () => {
    for (const value of [['GIFT_GRANT'],['BOOKINGS_READ','BOOKINGS_READ'],['BOOKINGS_MANAGE'],['SETTLEMENT_RECORD'],['REFUNDS_MANAGE']]) expect(() => staffPermissions(value)).toThrow(BadRequestException);
    expect(staffPermissions(['REFUNDS_MANAGE','BOOKINGS_READ'])).toEqual(['BOOKINGS_READ','REFUNDS_MANAGE']);
    expect(staffPermissions(['FINANCE_READ'])).toEqual(['FINANCE_READ']);
  });
  test('staff read scope includes its own active grant and exact function, never changes financial ownership', () => {
    expect(shopAccessWhere(staff,'FINANCE_READ')).toMatchObject({ loginBinding: { is: { user: { role:'MERCHANT',status:'ACTIVE',deletedAt:null } } }, staffGrants:{some:{userId:3n,status:'ACTIVE',permissions:{array_contains:'FINANCE_READ'},user:{role:'STAFF',status:'ACTIVE',deletedAt:null}}} });
    expect(shopAccessWhere(staff,'FINANCE_READ')).not.toHaveProperty('owner');
  });
  test('new STAFF passwords are bcrypt12 and neither responses nor audits expose credentials', async () => {
    const f = fixture(), password = 'Synthetic-secret-123';
    const result = await f.service.create('71', owner, { name:'New staff',email:'new@example.invalid',phone:'+12025550123',password,permissions:['BOOKINGS_READ'] });
    const created = f.state().users.find((row: any) => row.id === 5n);
    expect(created.role).toBe('STAFF'); expect(created.passwordHash).toMatch(/^\$2[aby]\$12\$/); expect(await compare(password, created.passwordHash)).toBe(true);
    expect(JSON.stringify({result,audits:f.state().audits},(_,value)=>typeof value==='bigint'?value.toString():value)).not.toMatch(/Synthetic-secret|passwordHash|\$2[aby]\$/);
    expect(f.events).toContain('lock-shop');
  });
  test.each(passwordMatrix)('create applies the shared STAFF byte contract: $name', async ({ value, accepted }) => {
    const f = fixture(), before = structuredClone(f.state());
    const input: CreateStaffDto = { name: 'Synthetic policy staff', email: 'policy@example.invalid', phone: '+12025550124', password: value, permissions: ['BOOKINGS_READ'] };
    if (!accepted) {
      await expect(f.service.create('71', owner, input)).rejects.toMatchObject({ response: { code: 'PASSWORD_POLICY' } });
      expect(f.state()).toEqual(before);
      expect(f.events).toEqual([]);
      return;
    }
    const result = await f.service.create('71', owner, input);
    const created = f.state().users.find((row: any) => row.id === 5n);
    expect(created.role).toBe('STAFF');
    expect(created.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(await compare(value, created.passwordHash)).toBe(true);
    if (value !== value.trim()) expect(await compare(value.trim(), created.passwordHash)).toBe(false);
    expect(result).toMatchObject({ shopId: '71', userId: '5', permissions: ['BOOKINGS_READ'] });
    expect(f.state().audits).toHaveLength(1);
    expect(f.state().audits[0].action).toBe('STAFF_CREATED');
    expect(f.events).toContain('lock-shop');
  });
  test('granting an existing CUSTOMER never converts or overwrites it', async () => {
    const f = fixture(); await expect(f.service.grant('71',owner,{userId:'4',permissions:['BOOKINGS_READ']})).rejects.toThrow(NotFoundException);
    expect(f.state().users.find((row:any)=>row.id===4n).role).toBe('CUSTOMER'); expect(f.state().grants).toHaveLength(1);
    expect(f.events.indexOf('lock-shop')).toBeLessThan(f.events.indexOf('lock-user'));
  });
  test('staff cannot create accounts, grant itself extra powers or revoke a colleague', async () => {
    const f = fixture();
    await expect(f.service.grant('71',staff,{userId:'3',permissions:['BOOKINGS_READ','FINANCE_READ']})).rejects.toThrow(ForbiddenException);
    await expect(f.service.revoke('71','3',staff)).rejects.toThrow(ForbiddenException);
    expect(f.state().grants[0].permissions).toEqual(['BOOKINGS_READ']); expect(f.state().audits).toEqual([]);
  });
  test('a queued write rechecks the grant after revocation (mutex substitute, not MySQL)', async () => {
    const f = fixture(); await requireShopAccess(f.db,71n,staff,'BOOKINGS_READ');
    const revocation = f.service.revoke('71','3',owner);
    const laterWrite = f.db.$transaction(async (tx:any)=>{ await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${71n} FOR UPDATE`); await requireShopAccess(tx,71n,staff,'BOOKINGS_READ'); throw new Error('Must not reach the write'); },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    await revocation; await expect(laterWrite).rejects.toThrow(ForbiddenException);
    expect(f.state().grants[0].status).toBe('REVOKED'); expect(f.state().grants[0].permissions).toEqual([]);
  });
  test('a failed audit rolls back the grant in a staged transaction substitute', async () => {
    const f=fixture();f.failAudit();await expect(f.service.update('71','3',owner,{permissions:['BOOKINGS_READ','FINANCE_READ']})).rejects.toThrow('Synthetic audit failure');
    expect(f.state().grants[0].permissions).toEqual(['BOOKINGS_READ']);expect(f.state().audits).toEqual([]);
  });
  test('configuration permission cannot change the owner-only payment policy', async () => {
    const f=fixture();f.state().grants[0].permissions=['RESERVATION_CONFIG'];
    const service=new ReservationsService(f.db); await expect(service.paymentPolicy('71',staff,{payAtStoreEnabled:true})).rejects.toThrow(ForbiddenException);
    expect(f.state().audits).toEqual([]);
  });
});
