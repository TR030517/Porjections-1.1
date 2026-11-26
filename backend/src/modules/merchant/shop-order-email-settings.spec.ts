import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopOrderEmailSettingsService } from './shop-order-email-settings.service';
import { ShopOrderEmailSettingsController } from './shop-order-email-settings.controller';
import { ShopOrderEmailRevisionDto, ShopOrderEmailVerificationRequestDto, ShopOrderEmailVerifyDto } from './shop-order-email-settings.dto';
const actor = { id: '2', role: 'MERCHANT' }, admin = { id: '1', role: 'ADMIN' };
const requestId = (n = 1) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const request = (expectedRevision = 0, n = 1) => ({ email: 'Private+ORDERS@Example.test', expectedRevision, requestId: requestId(n) });
const envKeys = ['NODE_ENV', 'NOTIFICATION_WORKER_ENABLED'];
let previous: Record<string, string | undefined>;
beforeEach(() => { previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]])); process.env.NODE_ENV = 'test'; delete process.env.NOTIFICATION_WORKER_ENABLED; });
afterEach(() => { for (const key of envKeys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });

/** Transaction staging models rollback, not SQL contention; the real-MySQL suite covers locks. */
function fixture() {
  const clone = (value: any): any => value instanceof Date ? new Date(value.getTime()) : Array.isArray(value) ? value.map(clone)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const user = (id: bigint, role: string) => ({ id, role, status: 'ACTIVE', deletedAt: null });
  let state: any = { users: [user(1n, 'ADMIN'), user(2n, 'MERCHANT'), user(3n, 'MERCHANT'), user(4n, 'STAFF'), user(9n, 'MERCHANT')],
    shop: { id: 10n, ownerId: 9n, status: 'APPROVED', deletedAt: null, studioProfile: { emails: ['public@example.test'] } },
    setting: null, audits: [], grant: null };
  const events: string[] = []; let activeTransaction = false, auditFail = false;
  let before: (() => void) | null = null;
  const apply = (row: any, data: any) => { for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] ?? 0) + (value as any).increment : value; return { ...row }; };
  function client(data: any): any {
    return {
      $queryRaw: async (query: any) => { const sql = Array.isArray(query) ? query.join('?') : query.sql; events.push(sql.includes('shops') ? 'lock-shop' : 'lock-user'); return []; },
      user: { findFirst: async ({ where }: any) => data.users.find((u: any) => u.id === where.id && u.role === where.role && u.status === where.status && !u.deletedAt) ?? null },
      shop: { findFirst: async ({ where }: any) => where.id === 10n && !data.shop.deletedAt ? { ...data.shop, owner: data.users.find((u: any) => u.id === 9n),
        loginBinding: { userId: 2n, user: data.users.find((u: any) => u.id === 2n) } } : null },
      shopAccountGrant: { findFirst: async () => data.grant }, shopStaffGrant: { findUnique: async () => ({ status: 'ACTIVE', permissions: ['BOOKINGS_READ'] }) },
      shopOrderEmailSetting: {
        findUnique: async ({ where }: any) => where.shopId === 10n ? data.setting && { ...data.setting } : null,
        upsert: async ({ create, update }: any) => { data.setting = data.setting ? apply(data.setting, update) : { enabled: true, recipientEmail: null, recipientVerifiedAt: null, ...create }; return { ...data.setting }; },
        update: async ({ data: changes }: any) => apply(data.setting, changes),
        updateMany: async ({ where, data: changes }: any) => { if (!data.setting || Object.entries(where).some(([key, value]) => data.setting[key] !== value)) return { count: 0 };
          apply(data.setting, changes); return { count: 1 }; },
      },
      auditLog: { create: async ({ data: input }: any) => { if (auditFail) throw Error('Synthetic audit failure'); data.audits.push(input); return input; } },
    };
  }
  const db: any = new Proxy({}, { get: (_, key) => key === '$transaction' ? async (work: any, options: any) => {
    expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.ReadCommitted);
    before?.(); before = null; activeTransaction = true;
    const staged = clone(state);
    try { const result = await work(client(staged)); state = staged; return result; } finally { activeTransaction = false; }
  } : client(state)[key] });
  let configured = true, status: 'SENT' | 'FAILED' | 'UNKNOWN' = 'SENT', duringSend: (() => void | Promise<void>) | null = null;
  const delivery = { config: () => ({ enabled: configured, deliveryMode: configured ? 'LOCAL_CAPTURE' : null }),
    send: jest.fn(async (_email: string, _code: string, _id: string) => { expect(activeTransaction).toBe(false); await duringSend?.(); return status; }) };
  return { service: new ShopOrderEmailSettingsService(db, delivery as any), state: () => state, delivery, events,
    configure: (enabled: boolean) => { configured = enabled; }, deliveryStatus: (value: typeof status) => { status = value; },
    onSend: (fn: () => void | Promise<void>) => { duringSend = fn; }, before: (fn: () => void) => { before = fn; }, failAudit: () => { auditFail = true; },
    code: () => delivery.send.mock.calls.at(-1)![1] };
}

describe('merchant private booking-email setting lifecycle', () => {
  test('reads legacy email as unverified, without disclosing challenge secrets', async () => {
    const f = fixture();
    expect(await f.service.get(actor, '10')).toMatchObject({ state: 'LEGACY_UNVERIFIED', revision: 0, legacyCandidate: 'public@example.test', recipient: null });
    const view = await f.service.requestVerification(actor, '10', request());
    expect(view).toMatchObject({ revision: 1, state: 'LEGACY_UNVERIFIED', recipient: null, pending: { email: 'private+orders@example.test', deliveryState: 'SENT', attemptsRemaining: 5 } });
    expect(JSON.stringify(view)).not.toMatch(/codeHash|devCode|code":/);
    expect(f.state().setting.codeHash).toMatch(/^[a-f0-9]{64}$/); expect(f.state().setting.codeHash).not.toBe(f.code()); expect(f.state().shop.studioProfile.emails).toEqual(['public@example.test']);
    expect(f.events[0]).toBe('lock-shop');
  });
  test('correct receipt proof alone activates private email for new events and preserves public login ownership', async () => {
    const f = fixture(); const pending = await f.service.requestVerification(actor, '10', request());
    const verified = await f.service.verify(actor, '10', { challengeId: pending.pending!.challengeId, code: f.code(), expectedRevision: pending.revision });
    expect(verified).toMatchObject({ revision: 2, state: 'VERIFIED', recipient: 'private+orders@example.test', pending: null });
    expect(Number.isFinite(Date.parse(verified.verifiedAt!))).toBe(true); expect(f.state().shop.ownerId).toBe(9n);
    expect(f.state().shop.studioProfile.emails).toEqual(['public@example.test']);
    const audit = JSON.stringify(f.state().audits, (_, value) => typeof value === 'bigint' ? String(value) : value);
    expect(audit).not.toContain('private+orders'); expect(audit).not.toContain(f.code());
  });
  test('changing recipient leaves old verified recipient active until new proof, then rejects stale CAS', async () => {
    const f = fixture(); await f.service.requestVerification(actor, '10', request());
    await f.service.verify(actor, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 1 });
    f.state().setting.lastRequestedAt = new Date(Date.now() - 61000);
    const pending = await f.service.requestVerification(actor, '10', { ...request(2, 2), email: 'next@example.test' });
    expect(pending).toMatchObject({ revision: 3, state: 'VERIFIED', recipient: 'private+orders@example.test', pending: { email: 'next@example.test' } });
    await expect(f.service.disable(admin, '10', { expectedRevision: 2 })).rejects.toThrow(ConflictException);
    expect((await f.service.verify(admin, '10', { challengeId: requestId(2), code: f.code(), expectedRevision: 3 })).recipient).toBe('next@example.test');
  });
  test('five wrong attempts commit permanently, correct code cannot reactivate exhausted proof', async () => {
    const f = fixture(); await f.service.requestVerification(actor, '10', request());
    const correct = f.code(), wrong = correct === '000000' ? '000001' : '000000';
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: wrong, expectedRevision: 1 })).rejects.toThrow(BadRequestException);
      expect(f.state().setting.attempts).toBe(attempt);
    }
    await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: correct, expectedRevision: 1 })).rejects.toThrow(BadRequestException);
    expect((await f.service.get(actor, '10')).pending).toBeNull(); expect(f.state().setting.recipientEmail).toBeNull();
  });
  test('expired or failed-send challenge cannot activate and never changes existing recipient', async () => {
    for (const state of ['expiry', 'failed'] as const) {
      const f = fixture(); if (state === 'failed') f.deliveryStatus('FAILED');
      await f.service.requestVerification(actor, '10', request());
      if (state === 'expiry') f.state().setting.pendingExpiresAt = new Date(Date.now() - 1);
      await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 1 })).rejects.toThrow(BadRequestException);
      expect(f.state().setting.recipientEmail).toBeNull();
    }
  });
  test('unknown send is not automatically repeated; actually received code can prove receipt', async () => {
    const f = fixture(); f.deliveryStatus('UNKNOWN');
    const first = await f.service.requestVerification(actor, '10', request());
    const replay = await f.service.requestVerification(actor, '10', request());
    expect(replay).toEqual(first); expect(f.delivery.send).toHaveBeenCalledTimes(1);
    expect(first.pending?.deliveryState).toBe('UNKNOWN');
    await expect(f.service.requestVerification(actor, '10', { ...request(), email: 'redirect@example.test' })).rejects.toThrow(ConflictException);
    expect((await f.service.verify(actor, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 1 })).state).toBe('VERIFIED');
    await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 1 })).rejects.toThrow(ConflictException);
  });
  test('actual receipt can prove SENDING challenge before provider response; late finalization never resurrects pending', async () => {
    const f = fixture(); let begin!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    f.onSend(() => { begin(); return gate; });
    const requestPending = f.service.requestVerification(actor, '10', request()); await started;
    const current = await f.service.get(actor, '10'); expect(current.pending?.deliveryState).toBe('SENDING');
    const correct = f.code(), wrong = correct === '000000' ? '000001' : '000000';
    await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: wrong, expectedRevision: 1 })).rejects.toThrow(BadRequestException);
    expect(f.state().setting.attempts).toBe(1);
    const verified = await f.service.verify(actor, '10', { challengeId: requestId(), code: correct, expectedRevision: 1 });
    expect(verified).toMatchObject({ state: 'VERIFIED', revision: 2, pending: null, recipient: 'private+orders@example.test' });
    release(); expect(await requestPending).toEqual(verified);
    expect(f.state().setting.recipientEmail).toBe('private+orders@example.test'); expect(f.delivery.send).toHaveBeenCalledTimes(1);
  });
  test('disable while provider response is pending stays disabled after its late finalization', async () => {
    const f = fixture(); let begin!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    f.onSend(() => { begin(); return gate; });
    const pending = f.service.requestVerification(actor, '10', request()); await started;
    const disabled = await f.service.disable(actor, '10', { expectedRevision: 1 }); release();
    expect(await pending).toEqual(disabled); expect((await f.service.get(actor, '10')).state).toBe('DISABLED');
    await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 2 })).rejects.toThrow(BadRequestException);
  });
  test.each([{ pendingExpiresAt: new Date(NaN) }, { attempts: -1 }, { attempts: 0.5 }])('corrupt proof bounds fail closed %#', async corruption => {
    const f = fixture(); await f.service.requestVerification(actor, '10', request()); Object.assign(f.state().setting, corruption);
    await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 1 })).rejects.toThrow(BadRequestException);
    expect(f.state().setting.recipientEmail).toBeNull();
  });
  test('disabling cancels pending proof, does not reset throttling or public contacts', async () => {
    const f = fixture(); await f.service.requestVerification(actor, '10', request());
    expect(await f.service.disable(actor, '10', { expectedRevision: 1 })).toMatchObject({ state: 'DISABLED', revision: 2, recipient: null, pending: null });
    await expect(f.service.verify(actor, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 2 })).rejects.toThrow(BadRequestException);
    await expect(f.service.requestVerification(actor, '10', request(2, 2))).rejects.toThrow(BadRequestException);
    expect(f.state().setting.sendCount).toBe(1); expect(f.state().shop.studioProfile.emails).toEqual(['public@example.test']);
  });
  test('60-second and five-per-hour limits survive repeated challenge IDs and disable', async () => {
    const f = fixture(); await f.service.requestVerification(actor, '10', request());
    await expect(f.service.requestVerification(actor, '10', request(1, 2))).rejects.toThrow(BadRequestException);
    for (let count = 2; count <= 5; count++) {
      f.state().setting.lastRequestedAt = new Date(Date.now() - 61000);
      await f.service.requestVerification(actor, '10', request(count - 1, count));
    }
    f.state().setting.lastRequestedAt = new Date(Date.now() - 61000);
    await expect(f.service.requestVerification(actor, '10', request(5, 6))).rejects.toThrow(BadRequestException);
    expect(f.delivery.send).toHaveBeenCalledTimes(5);
  });
  test('unconfigured provider prevents challenge creation but never deletes orders or changes public email', async () => {
    const f = fixture(); f.configure(false);
    expect(await f.service.get(actor, '10')).toMatchObject({ delivery: { configured: false, reasonCode: 'ORDER_EMAIL_NOT_CONFIGURED' } });
    await expect(f.service.requestVerification(actor, '10', request())).rejects.toThrow(ServiceUnavailableException);
    expect(f.state().setting).toBeNull(); expect(f.delivery.send).not.toHaveBeenCalled();
  });
  test('owner history, no-grant merchant, staff and inactive operator cannot read or mutate private destination', async () => {
    for (const other of [{ id: '9', role: 'MERCHANT' }, { id: '3', role: 'MERCHANT' }, { id: '4', role: 'STAFF' }, { id: '2', role: 'CUSTOMER' }]) {
      const f = fixture(); await expect(f.service.get(other, '10')).rejects.toThrow(ForbiddenException);
      await expect(f.service.requestVerification(other, '10', request())).rejects.toThrow(ForbiddenException);
      expect(f.state().setting).toBeNull(); expect(f.delivery.send).not.toHaveBeenCalled();
    }
    const f = fixture(); f.state().users[1].status = 'SUSPENDED'; await expect(f.service.get(actor, '10')).rejects.toThrow(ForbiddenException);
  });
  test('explicit associated settings permission works and is rechecked after sending', async () => {
    const f = fixture(); f.state().grant = { sourceShopId: 20n, permissions: ['SHOP_SETTINGS_MANAGE'] };
    const associated = { id: '3', role: 'MERCHANT' };
    f.onSend(() => { f.state().grant = null; });
    await expect(f.service.requestVerification(associated, '10', request())).rejects.toThrow(ForbiddenException);
    expect(f.state().setting.deliveryState).toBe('SENDING'); expect(f.state().setting.recipientEmail).toBeNull();
    await expect(f.service.verify(associated, '10', { challengeId: requestId(), code: f.code(), expectedRevision: 1 })).rejects.toThrow(ForbiddenException);
  });
  test('operator is rechecked under shop-first lock; audit failure rolls back before sending', async () => {
    const revoked = fixture(); revoked.before(() => { revoked.state().users[1].status = 'SUSPENDED'; });
    await expect(revoked.service.requestVerification(actor, '10', request())).rejects.toThrow(ForbiddenException);
    expect(revoked.state().setting).toBeNull(); expect(revoked.delivery.send).not.toHaveBeenCalled();
    const f = fixture(); f.failAudit(); await expect(f.service.requestVerification(admin, '10', request())).rejects.toThrow('Synthetic audit failure');
    expect(f.state().setting).toBeNull(); expect(f.delivery.send).not.toHaveBeenCalled();
  });
  test('DTOs and service reject unknown fields, coercions, arbitrary redirects and malformed request IDs', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const [metatype, value] of [[ShopOrderEmailVerificationRequestDto, { ...request(), shopId: '20' }], [ShopOrderEmailRevisionDto, { expectedRevision: '0' }],
      [ShopOrderEmailVerifyDto, { expectedRevision: 0, challengeId: requestId(), code: '12345' }]] as const)
      await expect(pipe.transform(value, { type: 'body', metatype })).rejects.toThrow(BadRequestException);
    for (const value of [{ ...request(), requestId: [requestId()] }, { ...request(), email: 'x\r\n@example.test' }, { ...request(), recipientEmail: 'bypass@example.test' }, { ...request(), expectedRevision: -1 }]) {
      const f = fixture(); await expect(f.service.requestVerification(actor, '10', value as any)).rejects.toThrow(BadRequestException); expect(f.delivery.send).not.toHaveBeenCalled();
    }
    expect(Reflect.getMetadata('roles', ShopOrderEmailSettingsController)).toEqual(['ADMIN', 'MERCHANT']);
  });
});
