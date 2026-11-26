import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { compare, hashSync } from 'bcryptjs';
import { AccountAccessController } from './account-access.controller';
import { AccountAccessService } from './account-access.service';
import { BindShopLoginDto, CreateAndBindShopAccountDto, GrantShopAccountDto, ResetShopAccountPasswordDto, SaveShopCredentialsDto } from './account-access.dto';
import { ACCOUNT_PERMISSIONS, accountId, accountPassword, accountPermissions, accountReason } from './account-access.validation';
import { merchantCredentialVault } from './merchant-credential-vault';

// Unit tests must not write the administrator's real encrypted credential file.
// Preserve the vault's identity+password-fingerprint lookup behavior in memory;
// actual MySQL CHECK enforcement and encrypted persistence have separate tests.
jest.mock('./merchant-credential-vault', () => ({ merchantCredentialVault: {
  randomMerchantPassword: jest.fn(), readMerchantCredential: jest.fn(), writeMerchantCredential: jest.fn(),
  readMerchantCredentialReceipt: jest.fn(), writeMerchantCredentialReceipt: jest.fn(),
} }));

const admin = { id: '1', role: 'ADMIN' };
const reason = 'Synthetic company-approved account assignment';
const time = new Date('2026-10-28T00:00:00Z');
const syntheticHash = hashSync('Synthetic-fixture-pass', 4);
const vault = jest.mocked(merchantCredentialVault);
beforeEach(() => {
  jest.resetAllMocks();
  const credentials = new Map<string, { password: string; updatedAt: string; operationId: string | null }>();
  const receipts = new Map<string, { shopId: string; userId: string; version: string }>();
  const key = (input: { shopId: string; userId: string; passwordHash: string }) => JSON.stringify([input.shopId, input.userId, input.passwordHash]);
  vault.randomMerchantPassword.mockReturnValue('A7b2C9d4');
  vault.writeMerchantCredential.mockImplementation(input => {
    credentials.set(key(input), { password: input.password, updatedAt: time.toISOString(), operationId: input.operationId ?? null });
    return { updatedAt: time.toISOString() };
  });
  vault.readMerchantCredential.mockImplementation(input => credentials.get(key(input)) ?? null);
  vault.writeMerchantCredentialReceipt.mockImplementation(({ operationId, ...receipt }) => { receipts.set(operationId, receipt); });
  vault.readMerchantCredentialReceipt.mockImplementation(operationId => receipts.get(operationId) ?? null);
});
function fixture() {
  const user = (id: bigint, role = 'MERCHANT') => ({ id, role, status: 'ACTIVE', deletedAt: null, name: 'Synthetic account', loginName: role === 'MERCHANT' ? `synthetic-${id}` : null, email: role === 'MERCHANT' ? null : `synthetic-${id}@example.invalid`, phone: null, passwordHash: syntheticHash });
  let state: any = {
    users: [user(1n, 'ADMIN'), user(2n), user(3n), user(4n, 'STAFF'), user(5n, 'CUSTOMER'), user(6n), user(7n), user(8n)],
    shops: [10n, 20n, 30n, 40n].map(id => ({ id, ownerId: 6n, name: 'Synthetic shop', status: 'PENDING', deletedAt: null })),
    bindings: [10n, 20n].map((shopId, index) => ({ id: BigInt(index + 1), shopId, userId: BigInt(index + 2), createdById: 1n, reason, createdAt: time, updatedAt: time })),
    grants: [], operations: [], sessions: [{ userId: 2n, revokedAt: null }, { userId: 2n, revokedAt: null }, { userId: 3n, revokedAt: null }], audits: [],
  };
  // The historical ledger owner intentionally has no login credentials.
  state.users[5].loginName = null; state.users[5].passwordHash = null;
  const events: string[] = [];
  let tail = Promise.resolve(), auditFailure = false, operationFailure = false, commitFailure = false, beforeNextTransaction: (() => void) | undefined;
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: any) => key === 'OR' ? value.some((w: any) => matches(row, w)) : key === 'AND' ? value.every((w: any) => matches(row, w)) : value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value);
  function client(data: any): any {
    const withUser = (row: any) => row && { ...row, user: data.users.find((u: any) => u.id === row.userId) };
    const findBinding = (where: any) => data.bindings.find((row: any) => matches(row, where));
    const findGrant = (where: any) => data.grants.find((row: any) => where.id !== undefined ? row.id === where.id : row.sourceShopId === where.sourceShopId_targetShopId.sourceShopId && row.targetShopId === where.sourceShopId_targetShopId.targetShopId);
    return {
      $queryRaw: jest.fn(async (query: any) => { events.push(`lock-${query.sql.includes('shops') ? 'shop' : 'user'}:${query.values[0]}`); return []; }),
      user: {
        create: jest.fn(async ({ data: input }: any) => { if (data.users.some((row: any) => ['loginName','email','phone'].some(key => input[key] && row[key] === input[key]))) throw Object.assign(Error('Synthetic uniqueness conflict'), {code:'P2002'}); const row = { id: data.users.reduce((max: bigint, u: any) => u.id > max ? u.id : max, 0n) + 1n, deletedAt: null, ...input }; data.users.push(row); return row; }),
        findFirst: jest.fn(async ({ where }: any) => { events.push('read-user'); return data.users.find((row: any) => matches(row, where)) ?? null; }),
        findMany: jest.fn(async ({ where }: any) => data.users.filter((row: any) => matches(row, where)).map((row: any) => ({ ...row, shopLoginBinding: findBinding({ userId: row.id }) ?? null }))),
        update: jest.fn(async ({ where, data: change }: any) => { const row = data.users.find((u: any) => u.id === where.id); Object.assign(row, change); return row; }),
      },
      shop: {
        findUnique: jest.fn(async ({ where }: any) => data.shops.find((row: any) => matches(row, where)) ?? null),
        findFirst: jest.fn(async ({ where }: any) => data.shops.find((row: any) => matches(row, where)) ?? null),
        findMany: jest.fn(async ({ where }: any) => data.shops.filter((row: any) => matches(row, where)).map((row: any) => ({ ...row, loginBinding: withUser(findBinding({ shopId: row.id })) ?? null }))),
      },
      shopLoginBinding: {
        findMany: jest.fn(async ({ where }: any) => data.bindings.filter((row: any) => where.shopId.in.includes(row.shopId))),
        findUnique: jest.fn(async ({ where }: any) => withUser(findBinding(where)) ?? null),
        create: jest.fn(async ({ data: input }: any) => { const row = { id: BigInt(data.bindings.length + 1), createdAt: time, updatedAt: time, ...input }; data.bindings.push(row); return withUser(row); }),
      },
      shopAccountGrant: {
        findUnique: jest.fn(async ({ where }: any) => findGrant(where) ?? null),
        findMany: jest.fn(async ({ where }: any) => data.grants.filter((row: any) => where.sourceShopId === undefined || row.sourceShopId === where.sourceShopId && row.status === where.status)),
        upsert: jest.fn(async ({ where, create, update }: any) => { let row = findGrant(where); if (row) Object.assign(row, update); else { row = { id: BigInt(data.grants.length + 1), status: 'ACTIVE', createdAt: time, updatedAt: time, revokedAt: null, ...create }; data.grants.push(row); } return row; }),
        update: jest.fn(async ({ where, data: change }: any) => { const row = findGrant(where); Object.assign(row, change); return row; }),
      },
      accountProvisionOperation: {
        findUnique: jest.fn(async ({where}: any) => data.operations.find((row: any) => row.actorId === where.actorId_idempotencyKey.actorId && row.idempotencyKey === where.actorId_idempotencyKey.idempotencyKey) ?? null),
        create: jest.fn(async ({data: input}: any) => { if (operationFailure) throw Error('Synthetic operation persistence failure'); if (data.operations.some((row: any) => row.actorId === input.actorId && row.idempotencyKey === input.idempotencyKey)) throw Object.assign(Error('Synthetic operation uniqueness'),{code:'P2002'}); const row={createdAt:time,...input};data.operations.push(row);return row; }),
      },
      authSession: { updateMany: jest.fn(async ({ where, data: change }: any) => { const rows = data.sessions.filter((row: any) => matches(row, where)); rows.forEach((row: any) => Object.assign(row, change)); return { count: rows.length }; }) },
      auditLog: { create: jest.fn(async ({ data: entry }: any) => { if (auditFailure) { auditFailure = false; throw Error('Synthetic audit failure'); } data.audits.push(entry); return entry; }) },
    };
  }
  // A serialized staged transaction substitute tests rereads and rollback; it
  // does not claim actual MySQL locking, uniqueness or transaction isolation.
  function transaction(work: any, options: any) {
    expect([Prisma.TransactionIsolationLevel.ReadCommitted, Prisma.TransactionIsolationLevel.RepeatableRead]).toContain(options.isolationLevel);
    const result = tail.then(async () => { beforeNextTransaction?.(); beforeNextTransaction = undefined; const staged = structuredClone(state), value = await work(client(staged)); if (commitFailure) { commitFailure = false; throw Error('Synthetic transaction commit failure'); } state = staged; return value; });
    tail = result.then(() => undefined, () => undefined); return result;
  }
  const db: any = new Proxy({}, { get: (_, key) => key === '$transaction' ? transaction : client(state)[key] });
  return { service: new AccountAccessService(db), state: () => state, events, failAudit: () => { auditFailure = true; }, failOperation: () => { operationFailure = true; }, failNextCommit: () => { commitFailure = true; }, beforeTransaction: (work: () => void) => { beforeNextTransaction = work; } };
}
const provision = (change: Record<string, unknown> = {}): CreateAndBindShopAccountDto => ({ shopId:'30',loginName:'new-independent',email:'new-independent@example.test',name:'Synthetic new login',password:'Synthetic-new-pass-123',reason,idempotencyKey:'synthetic-provision-key-01',...change });
const grant = (sourceShopId = '10', targetShopId = '20', permissions: any = ['BOOKINGS_READ']) => ({ sourceShopId, targetShopId, permissions, reason });
const saveInput = (current: { userId: string | null; version: string }, changes: Partial<SaveShopCredentialsDto> = {}): SaveShopCredentialsDto => ({
  expectedUserId: current.userId, version: current.version, requestKey: 'synthetic-credential-key-01', reason, ...changes,
});

describe('company account bindings and directed permissions (no database)', () => {
  test('controller is ADMIN only and every service path rejects merchant/staff role claims', async () => {
    expect(Reflect.getMetadata('roles', AccountAccessController)).toEqual(['ADMIN']);
    for (const role of ['MERCHANT', 'STAFF', 'CUSTOMER']) {
      const f = fixture(), actor = { id: '2', role };
      await expect(f.service.overview(actor)).rejects.toThrow(ForbiddenException);
      await expect(f.service.bind(actor, { shopId: '30', userId: '7', reason })).rejects.toThrow(ForbiddenException);
      await expect(f.service.createAndBind(actor, provision())).rejects.toThrow(ForbiddenException);
      await expect(f.service.grant(actor, grant())).rejects.toThrow(ForbiddenException);
      await expect(f.service.revoke(actor, '1', { reason })).rejects.toThrow(ForbiddenException);
      await expect(f.service.resetPassword(actor, '3', { password: 'Synthetic-password', reason })).rejects.toThrow(ForbiddenException);
      expect(f.state().audits).toHaveLength(0);
    }
  });
  test('bind links one unused login account without changing legacy owner or emitting credentials/reason', async () => {
    const f = fixture(), originalOwners = f.state().shops.map((s: any) => s.ownerId);
    const result = await f.service.bind(admin, { shopId: '30', userId: '7', reason });
    expect(result.binding).toMatchObject({ shopId: '30', userId: '7', loginName: 'synthetic-7', email: null, accountStatus: 'ACTIVE', reasonRecorded: true });
    expect(f.state().shops.map((s: any) => s.ownerId)).toEqual(originalOwners);
    expect(JSON.stringify(result)).not.toMatch(/password|never-project|Synthetic company-approved/);
    expect(f.state().audits[0].detail).toMatchObject({ fields: ['loginBinding'], reasonRecorded: true });
    expect(f.events.slice(0, 3)).toEqual(['lock-shop:30', 'lock-user:1', 'lock-user:7']);
  });
  test('neither a bound shop nor a bound user can be overwritten, and non-MERCHANT accounts cannot be converted', async () => {
    for (const [shopId, userId, type] of [['10', '7', ConflictException], ['30', '2', ConflictException], ['30', '4', NotFoundException], ['30', '5', NotFoundException]] as const) {
      const f = fixture(); await expect(f.service.bind(admin, { shopId, userId, reason })).rejects.toThrow(type); expect(f.state().bindings).toHaveLength(2);
    }
  });
  test('two queued binds of the same account produce one binding; no inferred legacy-owner mapping exists', async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.service.bind(admin, { shopId: '30', userId: '7', reason }), f.service.bind(admin, { shopId: '40', userId: '7', reason })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(f.state().bindings.filter((b: any) => b.userId === 7n)).toHaveLength(1);
    expect(f.state().bindings.some((b: any) => b.userId === 6n)).toBe(false);
  });
  test('grants use canonical nine permissions but reject owner powers, duplicates and inconsistent writes', () => {
    expect(ACCOUNT_PERMISSIONS).toHaveLength(9);
    expect(accountPermissions(['FINANCE_READ'])).toEqual(['FINANCE_READ']);
    for (const p of [[], ['OWNER_ONLY'], ['GIFT_GRANT'], ['BOOKINGS_READ', 'BOOKINGS_READ'], ['BOOKINGS_MANAGE'], ['REFUNDS_MANAGE'], ['SETTLEMENT_RECORD']]) expect(() => accountPermissions(p)).toThrow(BadRequestException);
    expect(accountPermissions(['COPY_CONFIG'])).toEqual(['COPY_CONFIG']);
    expect(accountPermissions(['COPY_CONFIG', 'CATALOG_MANAGE'])).toEqual(['CATALOG_MANAGE', 'COPY_CONFIG']);
  });
  test('source/target bindings must both be active independent MERCHANT logins, never an owner fallback', async () => {
    const f = fixture(); await expect(f.service.grant(admin, grant('10', '10'))).rejects.toThrow(BadRequestException);
    await expect(f.service.grant(admin, grant('10', '30'))).rejects.toThrow(ConflictException);
    for (const change of [(u: any) => u.status = 'SUSPENDED', (u: any) => u.deletedAt = time, (u: any) => u.role = 'STAFF']) {
      const x = fixture(); change(x.state().users[2]); await expect(x.service.grant(admin, grant())).rejects.toThrow(ConflictException); expect(x.state().grants).toHaveLength(0);
    }
    const legacyOwner = fixture(); legacyOwner.state().users[5].status = 'SUSPENDED';
    expect((await legacyOwner.service.grant(admin, grant())).grant.status).toBe('ACTIVE');
  });
  test('grant locks both shops then all users in ascending order and preserves the actual admin', async () => {
    const f = fixture(); const result = await f.service.grant(admin, grant('20', '10', ['BOOKINGS_READ', 'BOOKINGS_MANAGE']));
    expect(f.events.filter(x => x.startsWith('lock-'))).toEqual(['lock-shop:10', 'lock-shop:20', 'lock-user:1', 'lock-user:2', 'lock-user:3']);
    expect(result.grant).toMatchObject({ sourceShopId: '20', targetShopId: '10', createdById: '1', updatedById: '1' });
    expect(f.state().audits[0].operatorId).toBe(1n);
  });
  test('updating/restoring a directed pair reuses its row, revocation clears access without deleting history', async () => {
    const f = fixture(); const first = await f.service.grant(admin, grant());
    await f.service.grant(admin, grant('10', '20', ['FINANCE_READ'])); expect(f.state().grants).toHaveLength(1);
    const revoked = await f.service.revoke(admin, first.grant.id, { reason: 'Synthetic reversal' });
    expect(revoked.grant).toMatchObject({ status: 'REVOKED', permissions: [] }); expect(f.state().grants[0].revokedById).toBe(1n);
    const restored = await f.service.grant(admin, grant()); expect(restored.grant.id).toBe(first.grant.id); expect(restored.grant.status).toBe('ACTIVE'); expect(f.state().grants[0].revokedReason).toBeNull();
    expect(f.state().grants.some((g: any) => g.sourceShopId === 20n)).toBe(false);
  });
  test('administrator status is reread inside locks and failed audit rolls back bind/grant changes', async () => {
    const f = fixture(); f.beforeTransaction(() => { f.state().users[0].status = 'SUSPENDED'; });
    await expect(f.service.bind(admin, { shopId: '30', userId: '7', reason })).rejects.toThrow(ForbiddenException); expect(f.state().bindings).toHaveLength(2);
    const bindFailure = fixture(); bindFailure.failAudit(); await expect(bindFailure.service.bind(admin, { shopId: '30', userId: '7', reason })).rejects.toThrow('Synthetic audit failure'); expect(bindFailure.state().bindings).toHaveLength(2);
    const grantFailure = fixture(); grantFailure.failAudit(); await expect(grantFailure.service.grant(admin, grant())).rejects.toThrow('Synthetic audit failure'); expect(grantFailure.state().grants).toHaveLength(0);
  });
  test('overview is an explicit safe projection and does not infer a home for unbound legacy owners', async () => {
    const f = fixture(); await f.service.grant(admin, grant()); const result = await f.service.overview(admin);
    expect(result.accounts.find((u: any) => u.id === '6')).toMatchObject({ boundShopId: null, loginName: null, email: null, loginReady: false });
    expect(result.shops.find((s: any) => s.id === '30')).toMatchObject({ binding: null, ownerId: '6' });
    expect(JSON.stringify(result)).not.toMatch(/password|never-project|Synthetic company-approved|phone|revokedReason/);
    expect(Object.keys(result.grants[0]).sort()).toEqual(['id', 'sourceShopId', 'targetShopId', 'permissions', 'status', 'createdById', 'updatedById', 'createdAt', 'updatedAt', 'revokedAt', 'reasonRecorded'].sort());
  });
  test('credentialless or malformed legacy accounts are marked unusable and cannot become login bindings', async () => {
    for (const change of [
      (u: any) => u.passwordHash = null,
      (u: any) => u.passwordHash = 'legacy-placeholder',
      (u: any) => { u.loginName = null; u.email = null; u.phone = null; },
      (u: any) => { u.loginName = 'invalid/name'; u.email = null; },
    ]) {
      const f = fixture(); change(f.state().users[6]);
      expect((await f.service.overview(admin)).accounts.find((u: any) => u.id === '7')?.loginReady).toBe(false);
      await expect(f.service.bind(admin, { shopId:'30',userId:'7',reason })).rejects.toThrow(ConflictException);
      expect(f.state().bindings).toHaveLength(2); expect(f.state().audits).toHaveLength(0);
    }
    const ambiguous = fixture(); ambiguous.state().users[6].loginName = '12345'; ambiguous.state().users[7].phone = '12345';
    await expect(ambiguous.service.bind(admin, {shopId:'30',userId:'7',reason})).rejects.toThrow(ConflictException);
    ambiguous.state().users[6].email = 'synthetic-7@example.invalid';
    expect((await ambiguous.service.bind(admin,{shopId:'30',userId:'7',reason})).binding.loginReady).toBe(true);
  });
  test('atomic provisioning creates one bcrypt12 login, binding, operation and audit without touching historical owners', async () => {
    const f = fixture(), before = structuredClone(f.state().shops), result = await f.service.createAndBind(admin, provision());
    expect(result).toMatchObject({status:'APPLIED',replayed:false,binding:{shopId:'30',loginName:null,email:'new-independent@example.test',accountStatus:'SUSPENDED',loginReady:false,reasonRecorded:true}});
    expect(result.operationId).toMatch(/^[a-f0-9-]{36}$/);
    const user = f.state().users.find((u: any) => String(u.id) === result.binding.userId);
    expect(user).toMatchObject({role:'MERCHANT',loginName:null,email:'new-independent@example.test',status:'SUSPENDED'}); expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(await compare(provision().password,user.passwordHash)).toBe(true);
    expect(f.state().shops).toEqual(before); expect(f.state().operations).toHaveLength(1);
    expect(f.state().operations[0]).toMatchObject({actorId:1n,shopId:30n,userId:user.id,status:'APPLIED'});
    expect(f.state().operations[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.state().audits[0]).toMatchObject({operatorId:1n,targetId:30n,action:'SHOP_LOGIN_CREATED_AND_BOUND',detail:{reason}});
    expect(JSON.stringify(result)).not.toMatch(/password|Synthetic-new|Synthetic company-approved|requestHash|phone/);
    expect(Object.keys(f.state().operations[0]).sort()).toEqual(['id','actorId','shopId','userId','idempotencyKey','requestHash','status','createdAt'].sort());
    expect(f.events.filter(x => x.startsWith('lock-'))).toEqual(['lock-shop:30','lock-user:1']);
  });
  test('same normalized provisioning request replays exactly once; changed password or reason conflicts', async () => {
    const f = fixture(), first = await f.service.createAndBind(admin,provision());
    const replay = await f.service.createAndBind(admin,provision({loginName:' NEW-INDEPENDENT ',name:' Synthetic new login ',email:' NEW-INDEPENDENT@EXAMPLE.TEST ',phone:''}));
    expect(replay).toMatchObject({operationId:first.operationId,replayed:true,binding:{userId:first.binding.userId}});
    expect(f.state().users).toHaveLength(9); expect(f.state().bindings).toHaveLength(3); expect(f.state().audits).toHaveLength(1);
    for (const changed of [{password:'Synthetic-other-pass-123'},{email:'different-independent@example.test'},{reason:'Different synthetic purpose'},{shopId:'40'}]) await expect(f.service.createAndBind(admin,provision(changed))).rejects.toThrow(ConflictException);
    expect(f.state().operations).toHaveLength(1);
  });
  test('serialized competing provisioning requests keep a single immutable result, with no orphan on audit or uniqueness failure', async () => {
    const f = fixture(), values = await Promise.all([f.service.createAndBind(admin,provision()),f.service.createAndBind(admin,provision())]);
    expect(values.map(v => v.replayed).sort()).toEqual([false,true]); expect(f.state().users).toHaveLength(9);
    const failed = fixture(); failed.failAudit();
    await expect(failed.service.createAndBind(admin,provision())).rejects.toThrow('Synthetic audit failure');
    expect(failed.state().users).toHaveLength(8); expect(failed.state().bindings).toHaveLength(2); expect(failed.state().operations).toHaveLength(0);
    for (const input of [provision({shopId:'10'}),provision({email:'existing-independent@example.test'})]) {
      const x = fixture(); x.state().users[1].email = 'existing-independent@example.test';
      await expect(x.service.createAndBind(admin,input)).rejects.toThrow(ConflictException);
      expect(x.state().users).toHaveLength(8); expect(x.state().bindings).toHaveLength(2); expect(x.state().operations).toHaveLength(0);
    }
  });
  test('provisioning rereads administrator state after its shop/user locks and strictly validates internal callers', async () => {
    const f = fixture(); f.beforeTransaction(() => f.state().users[0].status = 'SUSPENDED');
    await expect(f.service.createAndBind(admin,provision())).rejects.toThrow(ForbiddenException); expect(f.state().users).toHaveLength(8);
    for (const change of [{idempotencyKey:'short'},{loginName:'path/invalid'},{phone:'not-a-phone'},{password:' short '},{name:''}]) await expect(fixture().service.createAndBind(admin,provision(change))).rejects.toThrow(BadRequestException);
  });
  test('password reset hashes bcrypt12, revokes only that login account sessions, and audit reveals no secret', async () => {
    const f = fixture(); await f.service.grant(admin, grant()); f.events.length = 0;
    const password = 'Synthetic-new-pass-123'; const result = await f.service.resetPassword(admin, '2', { password, reason });
    expect(result).toEqual({ userId: '2', reset: true, revokedSessions: 2 });
    expect(f.state().users[1].passwordHash).toMatch(/^\$2[aby]\$12\$/); expect(await compare(password, f.state().users[1].passwordHash)).toBe(true);
    expect(f.state().sessions[2].revokedAt).toBeNull();
    expect(f.events.filter(x => x.startsWith('lock-'))).toEqual(['lock-shop:10', 'lock-shop:20', 'lock-user:1', 'lock-user:2', 'lock-user:3']);
    expect(f.state().audits.at(-1).detail.reason).toBe(reason);
    expect(JSON.stringify({ result, audit: f.state().audits }, (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toMatch(/Synthetic-new|\$2[aby]\$|passwordHash/);
  });
  test('password reset fails closed if binding/grant scope changes before its locks, or audit fails', async () => {
    const f = fixture(); f.beforeTransaction(() => { f.state().grants.push({ id: 1n, sourceShopId: 10n, targetShopId: 20n, permissions: ['BOOKINGS_READ'], status: 'ACTIVE' }); });
    await expect(f.service.resetPassword(admin, '2', { password: 'Synthetic-password', reason })).rejects.toThrow(ConflictException); expect(f.state().users[1].passwordHash).toBe(syntheticHash); expect(f.state().sessions[0].revokedAt).toBeNull();
    const x = fixture(); x.failAudit(); await expect(x.service.resetPassword(admin, '2', { password: 'Synthetic-password', reason })).rejects.toThrow('Synthetic audit failure'); expect(x.state().users[1].passwordHash).toBe(syntheticHash); expect(x.state().sessions[0].revokedAt).toBeNull();
  });
  test('strict IDs, reasons and UTF8 bcrypt limits reject dangerous or ambiguous inputs', async () => {
    for (const value of ['0', '-1', '01', '1e2', '9223372036854775808', 1]) expect(() => accountId(value)).toThrow(BadRequestException);
    for (const value of ['', '  ', '\u0000', 'x'.repeat(1001)]) expect(() => accountReason(value)).toThrow(BadRequestException);
    expect(accountPassword('密'.repeat(4))).toBe('密'.repeat(4)); expect(() => accountPassword('密'.repeat(25))).toThrow(BadRequestException);
    const f = fixture(); await expect(f.service.resetPassword(admin, '1', { password: 'Synthetic-password', reason })).rejects.toThrow(BadRequestException);
    await expect(f.service.resetPassword(admin, '4', { password: 'Synthetic-password', reason })).rejects.toThrow(NotFoundException);
  });
  test('real ValidationPipe rejects unexpected owner/status/payment and extra password fields', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const [metatype, body] of [[BindShopLoginDto, { shopId: '30', userId: '7', reason, ownerId: '2' }], [CreateAndBindShopAccountDto, {...provision(),role:'ADMIN'}], [CreateAndBindShopAccountDto, {...provision(),idempotencyKey:'short'}], [GrantShopAccountDto, { ...grant(), status: 'ACTIVE' }], [ResetShopAccountPasswordDto, { password: 'Synthetic-password', reason, role: 'ADMIN' }]]) {
      await expect(pipe.transform(body, { type: 'body', metatype: metatype as any })).rejects.toThrow(BadRequestException);
    }
  });
});

describe('administrator credential saves and operation receipts (no database)', () => {
  test('each sensitive read persists a masked audit without storing the password, hash or contact', async () => {
    const f = fixture();
    vault.writeMerchantCredential({ shopId: '10', userId: '2', password: 'Synthetic-fixture-pass', passwordHash: syntheticHash });
    const before = structuredClone(f.state());
    const result = await f.service.credentials(admin, '10');
    expect(result.password).toBe('Synthetic-fixture-pass');
    expect(f.state().audits).toEqual([{ operatorId: 1n, action: 'SHOP_LOGIN_CREDENTIALS_READ', targetType: 'SHOP_ACCOUNT', targetId: 10n, detail: { fields: ['loginBinding'] } }]);
    const { audits: _beforeAudits, ...beforeBusiness } = before;
    const { audits: _afterAudits, ...afterBusiness } = f.state();
    expect(afterBusiness).toEqual(beforeBusiness);
    const audit = JSON.stringify(f.state().audits, (_key, value) => typeof value === 'bigint' ? String(value) : value);
    expect(audit).not.toContain('Synthetic-fixture-pass'); expect(audit).not.toContain(syntheticHash);
    expect(audit).not.toMatch(/passwordHash|@example|synthetic-2/);
  });

  test('sensitive reads fail closed before decrypting credentials when audit persistence fails', async () => {
    const f = fixture(), before = structuredClone(f.state()); f.failAudit();
    await expect(f.service.credentials(admin, '10')).rejects.toThrow('Synthetic audit failure');
    expect(f.state()).toEqual(before); expect(vault.readMerchantCredential).not.toHaveBeenCalled();
  });

  const credentialFixture = () => {
    const f = fixture();
    for (const binding of f.state().bindings) f.state().users.find((row: any) => row.id === binding.userId).email = `synthetic-${binding.userId}@example.test`;
    return f;
  };
  test('new credential save binds one suspended email account and replays its generated password without another write', async () => {
    const f = credentialFixture(), before = structuredClone(f.state().shops), current = await f.service.credentials(admin, '30');
    const body = saveInput(current, { email: ' NEW-CREDENTIALS@EXAMPLE.TEST ', generatePassword: true });
    const saved = await f.service.saveCredentials(admin, '30', body);
    expect(saved).toMatchObject({ shopId: '30', email: 'new-credentials@example.test', password: 'A7b2C9d4', accountStatus: 'SUSPENDED', loginReady: false, replayed: false });
    const user = f.state().users.find((row: any) => String(row.id) === saved.userId);
    expect(user).toMatchObject({ role: 'MERCHANT', loginName: null, status: 'SUSPENDED' });
    expect(await compare(saved.password!, user.passwordHash)).toBe(true);
    expect(f.state().operations).toHaveLength(1);
    expect(f.state().operations[0]).toMatchObject({ actorId: 1n, shopId: 30n, userId: user.id, status: 'CREDENTIALS_APPLIED', idempotencyKey: body.requestKey });
    expect(f.state().shops).toEqual(before);
    const committed = structuredClone(f.state()), writeCount = vault.writeMerchantCredential.mock.calls.length;
    const replay = await f.service.saveCredentials(admin, '30', body);
    expect(replay).toEqual({ ...saved, replayed: true });
    expect(f.state()).toEqual(committed);
    expect(vault.writeMerchantCredential).toHaveBeenCalledTimes(writeCount);
    expect(vault.writeMerchantCredentialReceipt).toHaveBeenCalledTimes(1);
  });

  test('manual six-digit password and email changes preserve suspension and publication while revoking only that account sessions', async () => {
    const f = credentialFixture(); f.state().users[1].status = 'SUSPENDED';
    f.state().shops[0].status = 'APPROVED';
    const shops = structuredClone(f.state().shops), current = await f.service.credentials(admin, '10');
    const result = await f.service.saveCredentials(admin, '10', saveInput(current, { email: 'changed@example.test', password: '246810' }));
    expect(result).toMatchObject({ userId: '2', email: 'changed@example.test', password: '246810', accountStatus: 'SUSPENDED', loginReady: false, replayed: false });
    expect(result.version).not.toBe(current.version);
    expect(await compare('246810', f.state().users[1].passwordHash)).toBe(true);
    expect(f.state().users[1].loginName).toBeNull();
    expect(f.state().sessions.filter((row: any) => row.userId === 2n).every((row: any) => row.revokedAt instanceof Date)).toBe(true);
    expect(f.state().sessions[2].revokedAt).toBeNull();
    expect(f.state().shops).toEqual(shops);
    const { replayed: _replayed, ...visible } = result;
    expect(await f.service.credentials(admin, '10')).toEqual(visible);
    expect(JSON.stringify(f.state().audits, (_key, value) => typeof value === 'bigint' ? String(value) : value)).not.toMatch(/246810|passwordHash|changed@example/);
  });

  test('legacy provisioning and credential saves cannot reuse each other operation keys in either direction', async () => {
    const old = fixture(); await old.service.createAndBind(admin, provision());
    const oldCurrent = await old.service.credentials(admin, '30'), oldState = structuredClone(old.state());
    await expect(old.service.saveCredentials(admin, '30', saveInput(oldCurrent, { password: '246810', requestKey: provision().idempotencyKey })))
      .rejects.toMatchObject({ response: { code: 'SHOP_CREDENTIALS_REQUEST_KEY_REUSED' } });
    expect(old.state()).toEqual(oldState);
    expect(old.state().operations[0].status).toBe('APPLIED');

    const fresh = fixture(), current = await fresh.service.credentials(admin, '30');
    const body = saveInput(current, { email: 'credential@example.test', generatePassword: true });
    await fresh.service.saveCredentials(admin, '30', body);
    const committed = structuredClone(fresh.state());
    await expect(fresh.service.createAndBind(admin, provision({ shopId: '40', idempotencyKey: body.requestKey }))).rejects.toThrow(ConflictException);
    expect(fresh.state()).toEqual(committed);
    expect(fresh.state().operations[0].status).toBe('CREDENTIALS_APPLIED');
  });

  test('a reused credential key with changed content is rejected before any second credential or session write', async () => {
    const f = credentialFixture(), current = await f.service.credentials(admin, '10');
    const body = saveInput(current, { email: 'credential@example.test', password: '246810' });
    await f.service.saveCredentials(admin, '10', body);
    const committed = structuredClone(f.state()), writes = vault.writeMerchantCredential.mock.calls.length;
    for (const change of [{ password: '135790' }, { email: 'other@example.test' }, { reason: 'Changed synthetic reason' }]) {
      await expect(f.service.saveCredentials(admin, '10', { ...body, ...change })).rejects.toMatchObject({ response: { code: 'SHOP_CREDENTIALS_REQUEST_KEY_REUSED' } });
    }
    expect(f.state()).toEqual(committed);
    expect(vault.writeMerchantCredential).toHaveBeenCalledTimes(writes);
  });

  test.each(['vault', 'receipt', 'operation', 'audit', 'commit'] as const)('%s failure rolls back credential fingerprint sessions binding and receipt row; orphaned ciphertext is never shown as current', async stage => {
    const f = credentialFixture(), password = 'Synthetic-fixture-pass';
    vault.writeMerchantCredential({ shopId: '10', userId: '2', password, passwordHash: syntheticHash });
    const current = await f.service.credentials(admin, '10'), before = structuredClone(f.state());
    if (stage === 'vault') vault.writeMerchantCredential.mockImplementationOnce(() => { throw Error('Synthetic vault failure'); });
    if (stage === 'receipt') vault.writeMerchantCredentialReceipt.mockImplementationOnce(() => { throw Error('Synthetic receipt failure'); });
    if (stage === 'operation') f.failOperation();
    if (stage === 'audit') f.failAudit();
    if (stage === 'commit') f.failNextCommit();
    await expect(f.service.saveCredentials(admin, '10', saveInput(current, { email: 'uncommitted@example.test', password: '246810' })))
      .rejects.toThrow(stage === 'vault' || stage === 'receipt' ? ServiceUnavailableException : /Synthetic .*failure/);
    expect(f.state()).toEqual(before);
    const visible = await f.service.credentials(admin, '10');
    expect(visible).toEqual(current);
    expect(visible.password).toBe(password);
    expect(f.state().operations).toHaveLength(0);
    expect(f.state().bindings).toHaveLength(2);
    expect(f.state().sessions[0].revokedAt).toBeNull();
    expect(await compare(password, f.state().users[1].passwordHash)).toBe(true);
    expect(await compare('246810', f.state().users[1].passwordHash)).toBe(false);
  });

  test.each(['vault', 'receipt', 'operation'] as const)('%s failure during unbound account creation leaves no user binding operation or visible password', async stage => {
    const f = credentialFixture(); f.state().shops[2].status = 'APPROVED';
    const current = await f.service.credentials(admin, '30'), before = structuredClone(f.state());
    if (stage === 'vault') vault.writeMerchantCredential.mockImplementationOnce(() => { throw Error('Synthetic vault failure'); });
    if (stage === 'receipt') vault.writeMerchantCredentialReceipt.mockImplementationOnce(() => { throw Error('Synthetic receipt failure'); });
    if (stage === 'operation') f.failOperation();
    await expect(f.service.saveCredentials(admin, '30', saveInput(current, { email: 'uncommitted-new@example.test', generatePassword: true })))
      .rejects.toThrow(stage === 'vault' || stage === 'receipt' ? ServiceUnavailableException : /Synthetic .*failure/);
    expect(f.state()).toEqual(before);
    expect(f.state().users).toHaveLength(8);
    expect(f.state().bindings).toHaveLength(2);
    expect(f.state().operations).toHaveLength(0);
    expect(f.state().shops[2]).toMatchObject({ ownerId: 6n, status: 'APPROVED' });
    const visible = await f.service.credentials(admin, '30');
    expect(visible).toEqual(current);
    expect(visible.userId).toBeNull();
    expect(visible.password).toBeNull();
  });

  test('missing saved receipt fails closed without replaying a completed password update', async () => {
    const f = credentialFixture(), current = await f.service.credentials(admin, '10');
    const body = saveInput(current, { password: '246810' });
    await f.service.saveCredentials(admin, '10', body);
    const before = structuredClone(f.state()), writes = vault.writeMerchantCredential.mock.calls.length;
    vault.readMerchantCredentialReceipt.mockReturnValueOnce(null);
    await expect(f.service.saveCredentials(admin, '10', body)).rejects.toMatchObject({ response: { code: 'SHOP_CREDENTIALS_RECEIPT_UNAVAILABLE' } });
    expect(f.state()).toEqual(before);
    expect(vault.writeMerchantCredential).toHaveBeenCalledTimes(writes);
  });

  test('stale versions and older completed receipts cannot overwrite or claim a later password edit', async () => {
    const f = credentialFixture(), initial = await f.service.credentials(admin, '10');
    const firstBody = saveInput(initial, { password: '246810' });
    const first = await f.service.saveCredentials(admin, '10', firstBody);
    const second = await f.service.saveCredentials(admin, '10', saveInput(first, { password: '135790', requestKey: 'synthetic-credential-key-02' }));
    const committed = structuredClone(f.state()), writes = vault.writeMerchantCredential.mock.calls.length;
    await expect(f.service.saveCredentials(admin, '10', saveInput(initial, { password: '999999', requestKey: 'synthetic-credential-key-03' })))
      .rejects.toMatchObject({ response: { code: 'SHOP_CREDENTIALS_STALE' } });
    await expect(f.service.saveCredentials(admin, '10', firstBody)).rejects.toMatchObject({ response: { code: 'SHOP_CREDENTIALS_REPLAY_CHANGED' } });
    expect(f.state()).toEqual(committed);
    expect(vault.writeMerchantCredential).toHaveBeenCalledTimes(writes);
    expect((await f.service.credentials(admin, '10')).password).toBe(second.password);
    expect(await compare('135790', f.state().users[1].passwordHash)).toBe(true);
  });

  test.each([null, '', 'invalid-email'])('password-only save rejects an unusable existing email %p before any credential session or database write', async existingEmail => {
    const f = credentialFixture(); f.state().users[1].email = existingEmail;
    const current = await f.service.credentials(admin, '10'), before = structuredClone(f.state());
    await expect(f.service.saveCredentials(admin, '10', saveInput(current, { password: '246810' })))
      .rejects.toThrow(new BadRequestException('请先填写有效的门店登录邮箱，再保存账号密码'));
    expect(f.state()).toEqual(before);
    expect(f.state().users[1].loginName).toBe('synthetic-2');
    expect(f.state().users[1].passwordHash).toBe(syntheticHash);
    expect(f.state().sessions[0].revokedAt).toBeNull();
    expect(vault.writeMerchantCredential).not.toHaveBeenCalled();
    expect(vault.writeMerchantCredentialReceipt).not.toHaveBeenCalled();
  });

  test.each([null, '', 'invalid-email'])('an explicit valid email safely migrates legacy login identity %p during password save', async existingEmail => {
    const f = credentialFixture(); f.state().users[1].email = existingEmail;
    const current = await f.service.credentials(admin, '10'), shops = structuredClone(f.state().shops);
    const result = await f.service.saveCredentials(admin, '10', saveInput(current, { email: ' MIGRATED@EXAMPLE.TEST ', password: '246810' }));
    expect(result).toMatchObject({ userId: '2', email: 'migrated@example.test', password: '246810', accountStatus: 'ACTIVE', loginReady: true });
    expect(f.state().users[1]).toMatchObject({ loginName: null, email: 'migrated@example.test', status: 'ACTIVE' });
    expect(await compare('246810', f.state().users[1].passwordHash)).toBe(true);
    expect(f.state().operations).toHaveLength(1);
    expect(f.state().operations[0].status).toBe('CREDENTIALS_APPLIED');
    expect(f.state().shops).toEqual(shops);
  });

  test('both administrator credential routes reject non-admin identities without accessing the vault', async () => {
    for (const role of ['MERCHANT', 'STAFF', 'CUSTOMER']) {
      const f = fixture(), actor = { id: '2', role };
      await expect(f.service.credentials(actor, '10')).rejects.toThrow(ForbiddenException);
      await expect(f.service.saveCredentials(actor, '10', saveInput({ userId: '2', version: 'a'.repeat(64) }, { password: '246810' }))).rejects.toThrow(ForbiddenException);
      expect(f.state().audits).toHaveLength(0);
      expect(f.state().operations).toHaveLength(0);
    }
    expect(vault.readMerchantCredential).not.toHaveBeenCalled();
    expect(vault.writeMerchantCredential).not.toHaveBeenCalled();
  });
});
