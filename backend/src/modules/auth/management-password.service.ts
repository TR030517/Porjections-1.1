import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { accountId, accountReason } from '../account-access/account-access.validation';
import { merchantCredentialVault } from '../account-access/merchant-credential-vault';
import { ChangeManagementPasswordDto, RecoverManagementPasswordDto } from './dto/management-password.dto';
import { requireRolePassword } from '../../common/validated-password';

export type ManagementPasswordActor = { id: string; role: string; sessionId: string };
const managementRoles = ['ADMIN', 'MERCHANT', 'STAFF'];

export function managementPassword(value: unknown, role: string): string {
  // Customer password operations retain their independent proof/session workflow.
  return requireRolePassword(value, managementRoles.includes(role) ? role : '');
}

@Injectable()
export class ManagementPasswordService {
  constructor(private readonly prisma: PrismaService) {}

  private actorId(actor: ManagementPasswordActor, adminOnly = false) {
    if (!actor || !(adminOnly ? actor.role === 'ADMIN' : managementRoles.includes(actor.role))) throw new ForbiddenException('当前身份不可执行此密码操作');
    if (typeof actor.sessionId !== 'string' || !actor.sessionId) throw new UnauthorizedException('Session unavailable');
    return accountId(actor.id);
  }

  private async current(db: any, actor: ManagementPasswordActor, id: bigint) {
    const user = await db.user.findUnique({ where: { id } });
    const session = await db.authSession.findUnique({ where: { id: actor.sessionId } });
    if (!user || user.role !== actor.role || user.status !== 'ACTIVE' || user.deletedAt || !user.passwordHash ||
        !session || session.userId !== id || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session unavailable');
    }
    return user;
  }

  private async verifyPassword(password: unknown, passwordHash: string) {
    if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72 || !(await compare(password, passwordHash))) {
      throw new UnauthorizedException({ code: 'CURRENT_PASSWORD_INVALID', message: '当前密码不正确，请重新输入' });
    }
  }

  private async revoke(tx: any, id: bigint) {
    const result = await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.pushDevice.deleteMany({ where: { userId: id } });
    return result.count;
  }

  async change(actor: ManagementPasswordActor, body: ChangeManagementPasswordDto) {
    const id = this.actorId(actor);
    const original = await this.current(this.prisma, actor, id);
    await this.verifyPassword(body.currentPassword, original.passwordHash);
    const password = managementPassword(body.newPassword, original.role);
    if (password === body.currentPassword) throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: '新密码须与当前密码不同' });
    const binding = original.role === 'MERCHANT'
      ? await this.prisma.shopLoginBinding.findUnique({ where: { userId: id }, select: { shopId: true } }) : null;
    const passwordHash = await hash(password, 12);
    return this.prisma.$transaction(async tx => {
      // Company account mutations lock shops before users. Follow that order,
      // then recheck the binding so a concurrent rebind cannot stale the vault.
      if (binding) await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${binding.shopId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${id} FOR UPDATE`);
      const user = await this.current(tx, actor, id);
      if (user.passwordHash !== original.passwordHash) throw new UnauthorizedException('Credentials changed; sign in again');
      const currentBinding = user.role === 'MERCHANT'
        ? await tx.shopLoginBinding.findUnique({ where: { userId: id }, select: { shopId: true } }) : null;
      if ((binding?.shopId ?? null) !== (currentBinding?.shopId ?? null)) throw new ConflictException({ code: 'PASSWORD_BINDING_CHANGED', message: '门店账号绑定已变更，请重新载入后重试' });
      if (currentBinding) {
        try {
          // Immutable vault records are keyed by the new bcrypt fingerprint.
          // A rolled back SQL transaction cannot reveal orphaned ciphertext.
          merchantCredentialVault.writeMerchantCredential({ shopId: String(currentBinding.shopId), userId: String(id), password, passwordHash });
        } catch {
          throw new ServiceUnavailableException({ code: 'SHOP_CREDENTIALS_VAULT_UNAVAILABLE', message: '密码保管服务不可用，密码未修改，请稍后重试' });
        }
      }
      await tx.user.update({ where: { id }, data: { passwordHash }, select: { id: true } });
      const revokedSessions = await this.revoke(tx, id);
      await tx.auditLog.create({ data: { operatorId: id, action: 'MANAGEMENT_PASSWORD_CHANGED', targetType: 'USER', targetId: id,
        detail: { fields: ['passwordReset'], revokedSessions } } });
      return { changed: true, reauthenticationRequired: true, revokedSessions };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async recover(actor: ManagementPasswordActor, target: string, body: RecoverManagementPasswordDto) {
    const id = this.actorId(actor, true), targetId = accountId(target);
    if (id === targetId) throw new BadRequestException('请通过本人修改密码功能修改自己的密码');
    accountReason(body.reason);
    if (typeof body.verificationReference !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{5,79}$/.test(body.verificationReference)) throw new BadRequestException('请填写人工身份核验记录编号');
    const original = await this.current(this.prisma, actor, id);
    // Reauthentication occurs in this request; a generic existing login or a
    // customer/provider proof cannot authorize recovery of another account.
    await this.verifyPassword(body.currentPassword, original.passwordHash);
    const password = managementPassword(body.newPassword, 'ADMIN');
    const passwordHash = await hash(password, 12);
    const verificationReferenceHash = createHash('sha256').update(body.verificationReference).digest('hex');
    return this.prisma.$transaction(async tx => {
      for (const uid of [id, targetId].sort((a, b) => a < b ? -1 : 1)) await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${uid} FOR UPDATE`);
      const operator = await this.current(tx, actor, id);
      if (operator.passwordHash !== original.passwordHash) throw new UnauthorizedException('Credentials changed; sign in again');
      const user = await tx.user.findUnique({ where: { id: targetId } });
      if (!user || !['ADMIN', 'STAFF'].includes(user.role) || user.deletedAt || !['ACTIVE', 'SUSPENDED'].includes(user.status)) throw new NotFoundException('可恢复的管理员或员工账号不存在');
      await tx.user.update({ where: { id: targetId }, data: { passwordHash }, select: { id: true } });
      const revokedSessions = await this.revoke(tx, targetId);
      await tx.auditLog.create({ data: { operatorId: id, action: 'MANAGEMENT_PASSWORD_RECOVERED', targetType: 'USER', targetId,
        // Do not persist free-text reason, passwords, contacts or ID evidence.
        detail: { fields: ['passwordReset'], revokedSessions, reasonRecorded: true, verificationRecorded: true, verificationReferenceHash } } });
      return { userId: target, recovered: true, reauthenticationRequired: true, revokedSessions };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
