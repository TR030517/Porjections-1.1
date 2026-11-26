import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { passwordPolicyError } from '../../common/password-policy';
import { accountId } from '../account-access/account-access.validation';
import { hashToken } from './auth.service';
import { EmailLoginDelivery, emailLoginConfig } from './email-login-delivery';
import { jwtSecret } from './security';
import { ChangeCustomerPasswordDto, CompleteCustomerPasswordRecoveryDto } from './dto/customer-password.dto';

export type CustomerPasswordActor = { id: string; role: string; sessionId: string };
const options = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
const activeCustomer = (user: any) => !!user && user.role === 'CUSTOMER' && user.status === 'ACTIVE' && !user.deletedAt;
const credentialHash = (user: any) => hashToken(user.passwordHash ?? '');
export const recoveryCodeHash = (id: string, email: string, code: string) => createHmac('sha256', jwtSecret())
  .update('customer-password-recovery\0' + id + '\0' + email + '\0' + code).digest('hex');
const invalidProof = () => new UnauthorizedException({ code: 'PASSWORD_RECOVERY_INVALID', message: 'The recovery code is invalid, expired or already used. Request a new code.' });

@Injectable()
export class CustomerPasswordService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  constructor(private readonly prisma: PrismaService, private readonly delivery: EmailLoginDelivery) {}
  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      this.cleanupTimer = setInterval(() => { void this.cleanupChallenges().catch(() => {}); }, 3600000);
      this.cleanupTimer.unref();
    }
  }
  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }
  async cleanupChallenges() {
    const cutoff = new Date(Date.now() - 86400000);
    const rows = await this.prisma.emailPasswordRecoveryChallenge.findMany({ where: { expiresAt: { lt: cutoff } }, take: 500, select: { id: true } });
    if (rows.length) await this.prisma.emailPasswordRecoveryChallenge.deleteMany({ where: { id: { in: rows.map(row => row.id) }, expiresAt: { lt: cutoff } } });
  }
  private password(value: unknown): string {
    const error = passwordPolicyError(value, 'CUSTOMER');
    if (error) throw new BadRequestException({ code: 'PASSWORD_POLICY', message: 'Use a password of 6–72 UTF-8 bytes without null characters or line breaks.' });
    return value as string;
  }
  private async current(tx: any, actor: CustomerPasswordActor) {
    if (!actor || actor.role !== 'CUSTOMER' || typeof actor.sessionId !== 'string' || !actor.sessionId) throw new UnauthorizedException('Customer session unavailable');
    const id = accountId(actor.id);
    const user = await tx.user.findUnique({ where: { id } });
    const session = await tx.authSession.findUnique({ where: { id: actor.sessionId } });
    if (!activeCustomer(user) || !session || session.userId !== id || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Customer session unavailable');
    return user;
  }
  private async complete(tx: any, user: any, passwordHash: string, action: string) {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    const revoked = await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.pushDevice.deleteMany({ where: { userId: user.id } });
    await tx.emailPasswordRecoveryChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
    // A proof issued before this credential rotation must not mint a session afterwards.
    if (user.email) await tx.emailLoginChallenge.updateMany({ where: { email: user.email, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.auditLog.create({ data: { operatorId: user.id, action, targetType: 'USER', targetId: user.id,
      detail: { fields: ['passwordReset'], revokedSessions: revoked.count } } });
    return { changed: true, reauthenticationRequired: true, revokedSessions: revoked.count };
  }
  async change(actor: CustomerPasswordActor, body: ChangeCustomerPasswordDto) {
    const password = this.password(body.newPassword);
    const original = await this.current(this.prisma, actor);
    if (typeof body.currentPassword !== 'string' || Buffer.byteLength(body.currentPassword, 'utf8') > 72 ||
        !original.passwordHash || !await compare(body.currentPassword, original.passwordHash)) {
      throw new UnauthorizedException({ code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is incorrect.' });
    }
    if (password === body.currentPassword) throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: 'Choose a password different from your current password.' });
    const passwordHash = await hash(password, 12);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${original.id} FOR UPDATE`);
      const user = await this.current(tx, actor);
      if (user.passwordHash !== original.passwordHash) throw new UnauthorizedException('Credentials changed; sign in again');
      return this.complete(tx, user, passwordHash, 'CUSTOMER_PASSWORD_CHANGED');
    }, options);
  }
  async requestRecovery(emailInput: string) {
    const config = emailLoginConfig();
    if (!config.enabled) throw new ServiceUnavailableException('Email password recovery is not configured');
    const email = emailInput.trim().toLowerCase(), now = new Date(), id = randomUUID();
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const deliver = await this.prisma.$transaction(async tx => {
      await tx.emailLoginThrottle.upsert({ where: { email }, create: { email, lastSentAt: new Date(0), windowStart: now, sendCount: 0 }, update: {} });
      await tx.$queryRaw(Prisma.sql`SELECT email FROM email_login_throttles WHERE email = ${email} FOR UPDATE`);
      const throttle = await tx.emailLoginThrottle.findUniqueOrThrow({ where: { email } });
      const recent = now.getTime() - throttle.windowStart.getTime() < 3600000;
      if (now.getTime() - throttle.lastSentAt.getTime() < 60000 || recent && throttle.sendCount >= 5) throw new BadRequestException({ code: 'EMAIL_LOGIN_RATE_LIMITED', message: 'Please wait before requesting another code.' });
      await tx.emailLoginThrottle.update({ where: { email }, data: { lastSentAt: now, windowStart: recent ? throttle.windowStart : now, sendCount: recent ? throttle.sendCount + 1 : 1 } });
      const first = await tx.user.findUnique({ where: { email } });
      if (!activeCustomer(first)) return false;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${first!.id} FOR UPDATE`);
      const user = await tx.user.findUnique({ where: { id: first!.id } });
      if (!activeCustomer(user) || user!.email !== email) return false;
      await tx.emailPasswordRecoveryChallenge.updateMany({ where: { userId: user!.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.emailPasswordRecoveryChallenge.create({ data: {
        id, userId: user!.id, email, credentialHash: credentialHash(user), codeHash: recoveryCodeHash(id, email, code), expiresAt: new Date(now.getTime() + 600000),
      } });
      return true;
    }, options);
    if (deliver) {
      try { await this.delivery.sendPasswordRecovery(email, code, id); }
      catch {
        await this.prisma.emailPasswordRecoveryChallenge.updateMany({ where: { id, deliveryState: 'PENDING' }, data: { deliveryState: 'FAILED', consumedAt: new Date() } });
      }
      await this.prisma.emailPasswordRecoveryChallenge.updateMany({ where: { id, deliveryState: 'PENDING', consumedAt: null, expiresAt: { gt: new Date() } }, data: { deliveryState: 'SENT' } });
    }
    // The public response does not reveal whether an email belongs to an account.
    return { challengeId: id, expiresIn: 600, resendAfter: 60, ...(config.devOnly ? { devCode: code } : {}) };
  }
  async recover(body: CompleteCustomerPasswordRecoveryDto) {
    if (!emailLoginConfig().enabled) throw new ServiceUnavailableException('Email password recovery is not configured');
    const password = this.password(body.newPassword);
    const first = await this.prisma.emailPasswordRecoveryChallenge.findUnique({ where: { id: body.challengeId } });
    if (!first) throw invalidProof();
    const passwordHash = await hash(password, 12);
    const result = await this.prisma.$transaction(async tx => {
      // Ordinary OTP uses the same throttle->user lock order; the recovery proof
      // itself lives in a separate table with a different hash purpose.
      await tx.$queryRaw(Prisma.sql`SELECT email FROM email_login_throttles WHERE email = ${first.email} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${first.userId} FOR UPDATE`);
      const row = await tx.emailPasswordRecoveryChallenge.findUnique({ where: { id: body.challengeId } });
      const user = await tx.user.findUnique({ where: { id: first.userId } });
      if (!row || row.consumedAt || row.deliveryState !== 'SENT' || row.expiresAt <= new Date() || row.attempts >= 5 ||
          !activeCustomer(user) || user!.email !== row.email || credentialHash(user) !== row.credentialHash) return { error: 'INVALID' as const };
      const expected = Buffer.from(recoveryCodeHash(row.id, row.email, body.code));
      const actual = Buffer.from(row.codeHash);
      const valid = /^\d{6}$/.test(body.code) && actual.length === expected.length && timingSafeEqual(actual, expected);
      await tx.emailPasswordRecoveryChallenge.update({ where: { id: row.id }, data: {
        attempts: { increment: 1 }, ...(!valid && row.attempts >= 4 ? { consumedAt: new Date() } : {}),
      } });
      if (!valid) return { error: 'INVALID' as const };
      if (user!.passwordHash && await compare(password, user!.passwordHash)) return { error: 'UNCHANGED' as const };
      const claimed = await tx.emailPasswordRecoveryChallenge.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) return { error: 'INVALID' as const };
      return { result: await this.complete(tx, user, passwordHash, 'CUSTOMER_PASSWORD_RECOVERED') };
    }, options);
    if ('error' in result) {
      if (result.error === 'UNCHANGED') throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: 'Choose a password different from your current password.' });
      throw invalidProof();
    }
    return result.result;
  }
}
