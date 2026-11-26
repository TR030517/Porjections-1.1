import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountReasonDto, BindShopLoginDto, CreateAndBindShopAccountDto, GrantShopAccountDto, ResetShopAccountPasswordDto, SaveShopCredentialsDto } from './account-access.dto';
import { ACCOUNT_PERMISSIONS, AccountActor, accountId, accountPassword, accountPermissions, accountReason } from './account-access.validation';
import { merchantAccountInput, merchantRoutedLoginReady } from '../../common/merchant-account';
import { publicShopProfile } from '../../common/shop-public-profile';
import { jwtSecret } from '../auth/security';
import { merchantCredentialVault } from './merchant-credential-vault';

// Secrets and phone are used only for eligibility; views below explicitly omit them.
const LOGIN_USER = { id: true, loginName: true, email: true, phone: true, passwordHash: true, name: true, role: true, status: true, deletedAt: true };
const GRANT_SELECT = { id: true, sourceShopId: true, targetShopId: true, permissions: true, status: true, createdById: true, updatedById: true, reason: true, createdAt: true, updatedAt: true, revokedAt: true };
const sortedIds = (values: bigint[]) => [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

/** Company-controlled login bindings and directed grants only. Reversible
 * credentials are restricted to the separate ADMIN credential endpoints. */
@Injectable()
export class AccountAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private role(actor: AccountActor) {
    if (!actor || actor.role !== 'ADMIN') throw new ForbiddenException('仅公司管理员可管理门店账号关联');
    return accountId(actor.id);
  }
  private async administrator(db: any, actor: AccountActor) {
    const id = this.role(actor);
    const operator = await db.user.findFirst({ where: { id, role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!operator) throw new ForbiddenException('管理员账户不可用');
    return id;
  }
  private async loginReady(db: any, user: any) {
    return merchantRoutedLoginReady(db, user);
  }
  private bindingView(row: any, loginReady: boolean) {
    return { id: String(row.id), shopId: String(row.shopId), userId: String(row.userId), loginName: row.user?.loginName ?? null, email: row.user?.email ?? null, name: row.user?.name ?? '', accountStatus: row.user?.status ?? 'UNAVAILABLE', loginReady, createdAt: row.createdAt, updatedAt: row.updatedAt, reasonRecorded: typeof row.reason === 'string' && !!row.reason.trim() };
  }
  private grantView(row: any) {
    // Invalid stored grants are never presented as effective access.
    let permissions: string[] = [];
    try { if (row.status === 'ACTIVE') permissions = accountPermissions(row.permissions); } catch { /* Fail closed. */ }
    return { id: String(row.id), sourceShopId: String(row.sourceShopId), targetShopId: String(row.targetShopId), permissions, status: row.status, createdById: String(row.createdById), updatedById: String(row.updatedById), createdAt: row.createdAt, updatedAt: row.updatedAt, revokedAt: row.revokedAt ?? null, reasonRecorded: typeof row.reason === 'string' && !!row.reason.trim() };
  }
  private async audit(tx: any, actor: AccountActor, action: string, targetId: bigint, detail: Record<string, unknown>) {
    // Reasons live on a controlled record or this immutable event (password
    // recovery has no separate reason record). Queries expose only presence.
    // No password/hash, contact details or arbitrary DTO are logged.
    await tx.auditLog.create({ data: { operatorId: accountId(actor.id), action, targetType: 'SHOP_ACCOUNT', targetId, detail: { ...detail, reasonRecorded: true } } });
  }
  private async bindingUserIds(tx: any, shopIds: bigint[]) {
    const rows = await tx.shopLoginBinding.findMany({ where: { shopId: { in: shopIds } }, select: { userId: true } });
    return rows.map((row: { userId: bigint }) => row.userId);
  }
  private async write<T>(shopIds: bigint[], actor: AccountActor, users: bigint[], work: (tx: any) => Promise<T>): Promise<T> {
    const operatorId = this.role(actor), shops = sortedIds(shopIds);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          // Grant issue/revocation and ordinary business writes all share the
          // target shop mutex. Multi-shop operations lock in ascending order.
          for (const sid of shops) await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${sid} FOR UPDATE`);
          const ids = sortedIds([operatorId, ...users, ...await this.bindingUserIds(tx, shops)]);
          for (const uid of ids) await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${uid} FOR UPDATE`);
          await this.administrator(tx, actor);
          return work(tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if ((error as any)?.code === 'P2002') throw new ConflictException('登录名、邮箱或电话已占用，或门店/账号已绑定；不会覆盖现有数据');
        if ((error as any)?.code !== 'P2034') throw error;
        if (attempt === 2) throw new ServiceUnavailableException('账号配置写入冲突，请稍后重试');
      }
    }
    throw new ServiceUnavailableException('请稍后重试');
  }
  private async shop(tx: any, id: bigint) {
    const shop = await tx.shop.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!shop) throw new NotFoundException('门店不存在');
    return shop;
  }
  private async validBinding(tx: any, shopId: bigint) {
    await this.shop(tx, shopId);
    const row = await tx.shopLoginBinding.findUnique({ where: { shopId }, include: { user: { select: LOGIN_USER } } });
    if (!row || !await this.loginReady(tx, row.user)) throw new ConflictException('来源和目标门店均须先绑定独立、有效且可登录的商家账号');
    return row;
  }

  async overview(actor: AccountActor) {
    await this.administrator(this.prisma, actor);
    const db = this.prisma as any;
    const [shops, accounts, grants] = await Promise.all([
      db.shop.findMany({ where: { deletedAt: null }, select: { id: true, name: true, status: true, ownerId: true, studioProfile: true, loginBinding: { include: { user: { select: LOGIN_USER } } } }, orderBy: { id: 'asc' } }),
      db.user.findMany({ where: { role: 'MERCHANT', deletedAt: null, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { ...LOGIN_USER, shopLoginBinding: { select: { shopId: true } } }, orderBy: { id: 'asc' } }),
      db.shopAccountGrant.findMany({ where: { sourceShop: { deletedAt: null }, targetShop: { deletedAt: null } }, select: GRANT_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    return {
      shops: await Promise.all(shops.map(async (shop: any) => ({ id: String(shop.id), name: shop.name, status: shop.status, ownerId: String(shop.ownerId), email: publicShopProfile({ studioProfile: shop.studioProfile }).emails[0] ?? null, binding: shop.loginBinding ? this.bindingView(shop.loginBinding, await this.loginReady(db, shop.loginBinding.user)) : null }))),
      accounts: await Promise.all(accounts.map(async (user: any) => ({ id: String(user.id), name: user.name ?? '', loginName: user.loginName ?? null, email: user.email ?? null, role: user.role, status: user.status, loginReady: await this.loginReady(db, user), boundShopId: user.shopLoginBinding ? String(user.shopLoginBinding.shopId) : null }))),
      grants: grants.map((row: any) => this.grantView(row)), permissions: [...ACCOUNT_PERMISSIONS],
    };
  }

  private credentialVersion(shopId: bigint, binding: any) {
    return createHmac('sha256', jwtSecret()).update('massajoy:shop-credentials-version:v1\0').update(JSON.stringify({
      shopId: String(shopId), bindingId: binding ? String(binding.id) : null,
      userId: binding ? String(binding.userId) : null, email: binding?.user?.email ?? null,
      loginName: binding?.user?.loginName ?? null, accountStatus: binding?.user?.status ?? null,
      role: binding?.user?.role ?? null, deleted: !!binding?.user?.deletedAt, passwordHash: binding?.user?.passwordHash ?? null,
    })).digest('hex');
  }
  private vault<T>(work: () => T): T {
    try { return work(); } catch {
      throw new ServiceUnavailableException({ code: 'SHOP_CREDENTIALS_VAULT_UNAVAILABLE', message: '管理员密码保管服务不可用，未返回任何密码，请稍后重试' });
    }
  }
  private async credentialView(db: any, shopId: bigint, binding: any) {
    if (binding && (!binding.user || binding.user.role !== 'MERCHANT' || binding.user.deletedAt || !['ACTIVE', 'SUSPENDED'].includes(binding.user.status))) throw new ConflictException('门店绑定账号不可用，请联系管理员处理');
    const saved = binding?.user?.passwordHash ? this.vault(() => merchantCredentialVault.readMerchantCredential({
      shopId: String(shopId), userId: String(binding.userId), passwordHash: binding.user.passwordHash,
    })) : null;
    return { shopId: String(shopId), userId: binding ? String(binding.userId) : null, email: binding?.user?.email ?? null,
      accountStatus: binding?.user?.status ?? null, loginReady: binding ? await this.loginReady(db, binding.user) : false,
      password: saved?.password ?? null, credentialUpdatedAt: saved?.updatedAt ?? null, version: this.credentialVersion(shopId, binding) };
  }
  async credentials(actor: AccountActor, value: string) {
    this.role(actor);
    const sid = accountId(value);
    return this.prisma.$transaction(async tx => {
      await this.administrator(tx, actor);
      await this.shop(tx, sid);
      const binding = await tx.shopLoginBinding.findUnique({ where: { shopId: sid }, include: { user: { select: LOGIN_USER } } });
      // Fail closed if the sensitive-read audit cannot be persisted. The
      // event records who accessed which store, never the credential itself.
      await tx.auditLog.create({ data: { operatorId: accountId(actor.id), action: 'SHOP_LOGIN_CREDENTIALS_READ', targetType: 'SHOP_ACCOUNT', targetId: sid,
        detail: { fields: ['loginBinding'] } } });
      return this.credentialView(tx, sid, binding);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async saveCredentials(actor: AccountActor, value: string, body: SaveShopCredentialsDto) {
    const operatorId = await this.administrator(this.prisma, actor), sid = accountId(value), reason = accountReason(body.reason);
    if (!Object.prototype.hasOwnProperty.call(body, 'expectedUserId') || body.expectedUserId !== null && typeof body.expectedUserId !== 'string' ||
        typeof body.version !== 'string' || !/^[a-f0-9]{64}$/.test(body.version) || typeof body.requestKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/.test(body.requestKey)) throw new BadRequestException('账号保存信息不完整，请重新载入后操作');
    const expectedUserId = body.expectedUserId === null ? null : accountId(body.expectedUserId);
    if (expectedUserId === operatorId) throw new BadRequestException('请通过本人密码设置修改自己的密码');
    const email = body.email === undefined ? undefined : typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email !== undefined && (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BadRequestException('请输入有效的门店登录邮箱');
    if (body.generatePassword !== undefined && typeof body.generatePassword !== 'boolean' || body.generatePassword && body.password !== undefined) throw new BadRequestException('请仅选择手动密码或随机生成密码');
    const suppliedPassword = body.password === undefined ? undefined : accountPassword(body.password);
    if (expectedUserId === null && !email) throw new BadRequestException('创建门店账号需要登录邮箱');
    if (expectedUserId !== null && email === undefined && suppliedPassword === undefined && !body.generatePassword) throw new BadRequestException('请修改邮箱或密码后保存');
    const requestHash = createHmac('sha256', jwtSecret()).update('massajoy:shop-credentials-save:v1\0').update(JSON.stringify({ actorId: String(operatorId), shopId: String(sid), expectedUserId: body.expectedUserId,
      version: body.version, email: email ?? null, password: suppliedPassword ?? null, generatePassword: body.generatePassword === true, reason })).digest('hex');
    const password = suppliedPassword ?? (body.generatePassword || expectedUserId === null ? merchantCredentialVault.randomMerchantPassword() : undefined);
    const passwordHash = password === undefined ? undefined : await hash(password, 12);
    const knownShops = expectedUserId === null ? [] : await this.accountShopIds(this.prisma, expectedUserId);
    return this.write(sortedIds([sid, ...knownShops]), actor, expectedUserId === null ? [] : [expectedUserId], async tx => {
      const operation = await tx.accountProvisionOperation.findUnique({ where: { actorId_idempotencyKey: { actorId: operatorId, idempotencyKey: body.requestKey } } });
      const binding = await tx.shopLoginBinding.findUnique({ where: { shopId: sid }, include: { user: { select: LOGIN_USER } } });
      // A known request is resolved before comparing its old precondition token.
      // Later account edits are never presented as the original save receipt.
      if (operation) {
        if (operation.requestHash !== requestHash || operation.shopId !== sid || operation.status !== 'CREDENTIALS_APPLIED') throw new ConflictException({ code: 'SHOP_CREDENTIALS_REQUEST_KEY_REUSED', message: '该请求键已用于不同操作，请核对原保存结果' });
        const receipt = this.vault(() => merchantCredentialVault.readMerchantCredentialReceipt(operation.id));
        if (!receipt) throw new ServiceUnavailableException({ code: 'SHOP_CREDENTIALS_RECEIPT_UNAVAILABLE', message: '原保存回执暂不可读取，请稍后核对，请勿重复创建账号' });
        if (!binding || binding.userId !== operation.userId || receipt.shopId !== String(sid) || receipt.userId !== String(operation.userId) || receipt.version !== this.credentialVersion(sid, binding)) throw new ConflictException({ code: 'SHOP_CREDENTIALS_REPLAY_CHANGED', message: '原保存已完成，但账号之后又有变更，请重新载入当前状态核对' });
        return { ...await this.credentialView(tx, sid, binding), replayed: true };
      }
      await this.shop(tx, sid);
      if ((binding ? String(binding.userId) : null) !== body.expectedUserId || this.credentialVersion(sid, binding) !== body.version) throw new ConflictException({ code: 'SHOP_CREDENTIALS_STALE', message: '门店账号已变更，本次未保存，请重新载入后操作' });
      if (expectedUserId !== null) {
        const currentShops = await this.accountShopIds(tx, expectedUserId);
        if (knownShops.length !== currentShops.length || knownShops.some((id, index) => id !== currentShops[index])) throw new ConflictException({ code: 'SHOP_CREDENTIALS_STALE', message: '账号关联范围已变更，本次未保存，请重新载入' });
        if (!binding?.user || binding.user.role !== 'MERCHANT' || binding.user.deletedAt || !['ACTIVE', 'SUSPENDED'].includes(binding.user.status)) throw new ConflictException('门店绑定账号不可用，请联系管理员处理');
        // This endpoint removes legacy loginName when saving credentials. Require
        // the replacement email identity before any vault/session/database write.
        const finalEmail = email ?? binding.user.email;
        if (typeof finalEmail !== 'string' || finalEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) throw new BadRequestException('请先填写有效的门店登录邮箱，再保存账号密码');
      }
      const operationId = randomUUID();
      let savedBinding;
      if (binding) {
        if (password !== undefined && passwordHash !== undefined) this.vault(() => merchantCredentialVault.writeMerchantCredential({ shopId: String(sid), userId: String(binding.userId), password, passwordHash, operationId }));
        await tx.user.update({ where: { id: binding.userId }, data: { loginName: null,
          ...(email === undefined ? {} : { email, ...(email !== binding.user.email ? { emailVerifiedAt: null } : {}) }),
          ...(passwordHash === undefined ? {} : { passwordHash }) }, select: { id: true } });
        // Changing a login credential invalidates existing management sessions;
        // account status is deliberately not part of this update.
        await tx.authSession.updateMany({ where: { userId: binding.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        savedBinding = await tx.shopLoginBinding.findUnique({ where: { shopId: sid }, include: { user: { select: LOGIN_USER } } });
      } else {
        const shop = await tx.shop.findUnique({ where: { id: sid }, select: { name: true } });
        const user = await tx.user.create({ data: { email, loginName: null, name: shop?.name || `Store ${sid}`, passwordHash, role: 'MERCHANT', status: 'SUSPENDED' }, select: LOGIN_USER });
        this.vault(() => merchantCredentialVault.writeMerchantCredential({ shopId: String(sid), userId: String(user.id), password: password!, passwordHash: passwordHash!, operationId }));
        savedBinding = await tx.shopLoginBinding.create({ data: { shopId: sid, userId: user.id, createdById: operatorId, reason }, include: { user: { select: LOGIN_USER } } });
      }
      const result = await this.credentialView(tx, sid, savedBinding);
      this.vault(() => merchantCredentialVault.writeMerchantCredentialReceipt({ operationId, shopId: String(sid), userId: result.userId!, version: result.version }));
      await tx.accountProvisionOperation.create({ data: { id: operationId, actorId: operatorId, shopId: sid, userId: BigInt(result.userId!), idempotencyKey: body.requestKey, requestHash, status: 'CREDENTIALS_APPLIED' } });
      await this.audit(tx, actor, binding ? 'SHOP_LOGIN_CREDENTIALS_UPDATED' : 'SHOP_LOGIN_CREATED_AND_BOUND', sid, { fields: [binding ? 'loginCredentials' : 'loginBinding'], loginUserId: result.userId, operationId });
      return { ...result, replayed: false };
    });
  }
  async bind(actor: AccountActor, body: BindShopLoginDto) {
    this.role(actor);
    const sid = accountId(body.shopId), uid = accountId(body.userId), reason = accountReason(body.reason);
    return this.write([sid], actor, [uid], async tx => {
      await this.shop(tx, sid);
      const user = await tx.user.findFirst({ where: { id: uid, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null }, select: LOGIN_USER });
      if (!user) throw new NotFoundException('有效商家登录账号不存在');
      if (!await this.loginReady(tx, user)) throw new ConflictException('该账号尚无可用登录标识或有效密码，请创建独立门店账号后再绑定');
      const [existingShop, existingUser] = await Promise.all([
        tx.shopLoginBinding.findUnique({ where: { shopId: sid }, select: { id: true } }),
        tx.shopLoginBinding.findUnique({ where: { userId: uid }, select: { id: true } }),
      ]);
      if (existingShop || existingUser) throw new ConflictException('此门店或账号已绑定，不允许覆盖或改绑；请联系公司处理历史绑定');
      const row = await tx.shopLoginBinding.create({ data: { shopId: sid, userId: uid, createdById: accountId(actor.id), reason }, include: { user: { select: LOGIN_USER } } });
      await this.audit(tx, actor, 'SHOP_LOGIN_BOUND', sid, { fields: ['loginBinding'], loginUserId: String(uid) });
      return { binding: this.bindingView(row, true) };
    });
  }
  async createAndBind(actor: AccountActor, body: CreateAndBindShopAccountDto) {
    const operatorId = await this.administrator(this.prisma, actor), sid = accountId(body.shopId), reason = accountReason(body.reason);
    if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/.test(body.idempotencyKey)) throw new BadRequestException('创建请求键须为16–100位字母、数字或安全分隔符');
    const account = merchantAccountInput(body as unknown as Record<string, unknown>);
    // Including the password in a domain-separated keyed digest binds retries
    // without storing a raw password or an offline password-verification hash.
    const requestHash = createHmac('sha256', jwtSecret()).update('massajoy:account-provision:v1\0').update(JSON.stringify({ actorId: String(operatorId), shopId: String(sid), ...account, reason })).digest('hex');
    const passwordHash = await hash(account.password, 12);
    return this.write([sid], actor, [], async tx => {
      const previous = await tx.accountProvisionOperation.findUnique({ where: { actorId_idempotencyKey: { actorId: operatorId, idempotencyKey: body.idempotencyKey } } });
      if (previous) {
        if (previous.requestHash !== requestHash || previous.shopId !== sid || previous.status !== 'APPLIED') throw new ConflictException('该请求键已用于另一份账号创建内容，请核对原操作');
        const binding = await tx.shopLoginBinding.findUnique({ where: { shopId: sid }, include: { user: { select: LOGIN_USER } } });
        if (!binding || binding.userId !== previous.userId) throw new ConflictException('原操作的绑定记录已变更，请联系公司管理员核对');
        return { operationId: previous.id, status: 'APPLIED' as const, binding: this.bindingView(binding, await this.loginReady(tx, binding.user)), replayed: true };
      }
      await this.shop(tx, sid);
      if (await tx.shopLoginBinding.findUnique({ where: { shopId: sid }, select: { id: true } })) throw new ConflictException('门店已有独立账号，不允许覆盖或改绑');
      const { name, email, phone } = account;
      // The legacy request still accepts loginName, but independent shops use
      // their email identity and provisioning never grants login permission.
      const identity = { loginName: null, name, email, phone };
      const user = await tx.user.create({ data: { ...identity, passwordHash, role: 'MERCHANT', status: 'SUSPENDED' }, select: LOGIN_USER });
      const binding = await tx.shopLoginBinding.create({ data: { shopId: sid, userId: user.id, createdById: operatorId, reason }, include: { user: { select: LOGIN_USER } } });
      this.vault(() => merchantCredentialVault.writeMerchantCredential({ shopId: String(sid), userId: String(user.id), password: account.password, passwordHash }));
      const operation = await tx.accountProvisionOperation.create({ data: { id: randomUUID(), actorId: operatorId, shopId: sid, userId: user.id, idempotencyKey: body.idempotencyKey, requestHash, status: 'APPLIED' } });
      await this.audit(tx, actor, 'SHOP_LOGIN_CREATED_AND_BOUND', sid, { fields: ['loginName', 'loginBinding'], loginUserId: String(user.id), operationId: operation.id, reason });
      return { operationId: operation.id, status: 'APPLIED' as const, binding: this.bindingView(binding, false), replayed: false };
    });
  }
  async grant(actor: AccountActor, body: GrantShopAccountDto) {
    const operatorId = this.role(actor), sourceShopId = accountId(body.sourceShopId), targetShopId = accountId(body.targetShopId), reason = accountReason(body.reason), permissions = accountPermissions(body.permissions);
    if (sourceShopId === targetShopId) throw new BadRequestException('同一门店无需关联授权');
    return this.write([sourceShopId, targetShopId], actor, [], async tx => {
      await this.validBinding(tx, sourceShopId); await this.validBinding(tx, targetShopId);
      const row = await tx.shopAccountGrant.upsert({ where: { sourceShopId_targetShopId: { sourceShopId, targetShopId } },
        create: { sourceShopId, targetShopId, permissions, createdById: operatorId, updatedById: operatorId, reason },
        update: { permissions, status: 'ACTIVE', updatedById: operatorId, reason, revokedById: null, revokedReason: null, revokedAt: null }, select: GRANT_SELECT });
      await this.audit(tx, actor, 'SHOP_ACCOUNT_GRANTED', targetShopId, { fields: ['linkedAccountAccess'], sourceShopId: String(sourceShopId), permissions });
      return { grant: this.grantView(row) };
    });
  }
  async revoke(actor: AccountActor, value: string, body: AccountReasonDto) {
    const operatorId = await this.administrator(this.prisma, actor), id = accountId(value), reason = accountReason(body.reason), db = this.prisma as any;
    const discovery = await db.shopAccountGrant.findUnique({ where: { id }, select: { sourceShopId: true, targetShopId: true } });
    if (!discovery) throw new NotFoundException('关联授权不存在');
    return this.write([discovery.sourceShopId, discovery.targetShopId], actor, [], async tx => {
      const row = await tx.shopAccountGrant.findUnique({ where: { id }, select: GRANT_SELECT });
      if (!row || row.sourceShopId !== discovery.sourceShopId || row.targetShopId !== discovery.targetShopId) throw new ConflictException('关联记录已变更，请刷新后重试');
      if (row.status === 'REVOKED') return { grant: this.grantView(row) };
      const updated = await tx.shopAccountGrant.update({ where: { id }, data: { status: 'REVOKED', permissions: [], updatedById: operatorId, revokedById: operatorId, revokedReason: reason, revokedAt: new Date() }, select: GRANT_SELECT });
      await this.audit(tx, actor, 'SHOP_ACCOUNT_REVOKED', row.targetShopId, { fields: ['linkedAccountAccess'], sourceShopId: String(row.sourceShopId) });
      return { grant: this.grantView(updated) };
    });
  }

  private async accountShopIds(db: any, userId: bigint): Promise<bigint[]> {
    const binding = await db.shopLoginBinding.findUnique({ where: { userId }, select: { shopId: true } });
    if (!binding) return [];
    const grants = await db.shopAccountGrant.findMany({ where: { sourceShopId: binding.shopId, status: 'ACTIVE' }, select: { targetShopId: true } });
    return sortedIds([binding.shopId, ...grants.map((row: { targetShopId: bigint }) => row.targetShopId)]);
  }
  async resetPassword(actor: AccountActor, value: string, body: ResetShopAccountPasswordDto) {
    const operatorId = await this.administrator(this.prisma, actor), uid = accountId(value), reason = accountReason(body.reason), password = accountPassword(body.password);
    if (uid === operatorId) throw new BadRequestException('请通过本人密码设置修改自己的密码');
    const db = this.prisma as any;
    const candidate = await db.user.findFirst({ where: { id: uid, role: 'MERCHANT', deletedAt: null, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true } });
    if (!candidate) throw new NotFoundException('商家账户不存在');
    // Expensive hashing is outside locks. This endpoint still returns no secret;
    // a bound account's password can be read through the ADMIN vault endpoint.
    const passwordHash = await hash(password, 12), shops = await this.accountShopIds(db, uid);
    return this.write(shops, actor, [uid], async tx => {
      const currentShops = await this.accountShopIds(tx, uid);
      if (shops.length !== currentShops.length || shops.some((sid, index) => sid !== currentShops[index])) throw new ConflictException('账号关联范围已变更，请刷新后重试；未重置密码');
      const user = await tx.user.findFirst({ where: { id: uid, role: 'MERCHANT', deletedAt: null, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true } });
      if (!user) throw new NotFoundException('商家账户不存在');
      const binding = await tx.shopLoginBinding.findUnique({ where: { userId: uid }, select: { shopId: true } });
      if (binding) this.vault(() => merchantCredentialVault.writeMerchantCredential({ shopId: String(binding.shopId), userId: String(uid), password, passwordHash }));
      await tx.user.update({ where: { id: uid }, data: { passwordHash }, select: { id: true } });
      const revoked = await tx.authSession.updateMany({ where: { userId: uid, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, 'SHOP_LOGIN_PASSWORD_RESET', uid, { fields: ['passwordReset'], revokedSessions: revoked.count, reason });
      return { userId: value, reset: true, revokedSessions: revoked.count };
    });
  }
}
