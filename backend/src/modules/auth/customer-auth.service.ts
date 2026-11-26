import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { compare } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService, hashToken } from './auth.service';
import { EmailLoginDelivery, emailLoginConfig } from './email-login-delivery';
import { IdentityProvider, IdentityVerifier, identityConfig } from './identity-verifier';
import { jwtSecret } from './security';
import { validEmailReauthProof } from './reauth-proof';
import { customerOrderEmail } from '../../common/booking-order-email';
const OPTIONS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
const activeCustomer = (user: any) => !!user && user.role === 'CUSTOMER' && user.status === 'ACTIVE' && !user.deletedAt;
export const emailCodeHash = (id: string, email: string, code: string) => createHmac('sha256', jwtSecret()).update('customer-email-login\0' + id + '\0' + email + '\0' + code).digest('hex');
@Injectable()
export class CustomerAuthService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  onModuleInit() { if (process.env.NODE_ENV !== 'test') { this.cleanupTimer = setInterval(() => { void this.cleanupChallenges().catch(() => {}); }, 3600000); this.cleanupTimer.unref(); } }
  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }
  async cleanupChallenges() {
    const cutoff = new Date(Date.now() - 86400000);
    for (const delegate of [this.prisma.socialLoginChallenge, this.prisma.emailLoginChallenge] as any[]) {
      const rows = await delegate.findMany({ where: { expiresAt: { lt: cutoff } }, take: 500, select: { id: true } });
      if (rows.length) await delegate.deleteMany({ where: { id: { in: rows.map((row: { id: string }) => row.id) }, expiresAt: { lt: cutoff } } });
    }
    const stale = new Date(Date.now() - 7 * 86400000);
    const throttles = await this.prisma.emailLoginThrottle.findMany({ where: { lastSentAt: { lt: stale } }, take: 500, select: { email: true } });
    if (throttles.length) await this.prisma.emailLoginThrottle.deleteMany({ where: { email: { in: throttles.map(row => row.email) }, lastSentAt: { lt: stale } } });
  }
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly identities: IdentityVerifier, private readonly delivery: EmailLoginDelivery) {}
  config() { return { passwordEnabled: true, passwordRegistrationEnabled: false, passwordRecoveryEnabled: emailLoginConfig().enabled, emailOtp: emailLoginConfig(), google: identityConfig('GOOGLE'), apple: identityConfig('APPLE'), nativeSocialEnabled: false }; }
  async socialChallenge(provider: IdentityProvider) {
    if (!identityConfig(provider).enabled) throw new ServiceUnavailableException('Identity provider is not configured');
    const nonce = randomBytes(32).toString('base64url'), id = randomUUID();
    await this.prisma.socialLoginChallenge.create({ data: { id, provider, nonceHash: hashToken(nonce), expiresAt: new Date(Date.now() + 300000) } });
    return { challengeId: id, nonce, expiresIn: 300 };
  }
  private async consumeSocial(tx: any, id: string, provider: IdentityProvider, nonce: string) {
    const consumed = await tx.socialLoginChallenge.updateMany({ where: { id, provider, nonceHash: hashToken(nonce), consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new UnauthorizedException('Identity challenge expired or already used');
  }
  async socialLogin(provider: IdentityProvider, input: { idToken: string; challengeId: string }) {
    const identity = await this.identities.verify(provider, input.idToken);
    try {
      const user = await this.prisma.$transaction(async tx => {
        await this.consumeSocial(tx, input.challengeId, provider, identity.nonce);
        const linked = await tx.authProviderIdentity.findUnique({ where: { provider_subject: { provider, subject: identity.subject } }, include: { user: true } });
        if (linked) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${linked.userId} FOR UPDATE`);
          const current = await tx.user.findUnique({ where: { id: linked.userId } });
          if (!activeCustomer(current)) throw new UnauthorizedException('Customer account unavailable');
          return current;
        }
        if (identity.email && await tx.user.findUnique({ where: { email: identity.email } })) throw new ConflictException('CUSTOMER_ACCOUNT_LINK_REQUIRED');
        const created = await tx.user.create({ data: { email: identity.email ?? null, emailVerifiedAt: identity.emailVerified ? new Date() : null, name: identity.name || null, role: 'CUSTOMER', status: 'ACTIVE', phone: null } });
        await tx.authProviderIdentity.create({ data: { provider, subject: identity.subject, userId: created.id } });
        return created;
      }, OPTIONS);
      return this.auth.createCustomerSession(user);
    } catch (error) { if ((error as any).code === 'P2002') throw new ConflictException('Identity already registered; retry sign-in'); throw error; }
  }
  async linkProvider(userId: string, provider: IdentityProvider, input: { idToken: string; challengeId: string; password?: string; reauthToken?: string }, sessionId = '') {
    if (!['GOOGLE','APPLE'].includes(provider)) throw new BadRequestException('Unsupported identity provider');
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(userId) } });
    const passwordVerified = !!input.password && !!user?.passwordHash && Buffer.byteLength(input.password,'utf8') <= 72 && await compare(input.password,user.passwordHash);
    const emailVerified = !!sessionId && !!input.reauthToken && validEmailReauthProof(input.reauthToken,userId,sessionId);
    if (!activeCustomer(user) || !passwordVerified && !emailVerified) throw new UnauthorizedException('Customer reauthentication required');
    const identity = await this.identities.verify(provider, input.idToken);
    try { return await this.prisma.$transaction(async tx => {
      await this.consumeSocial(tx, input.challengeId, provider, identity.nonce);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${user!.id} FOR UPDATE`);
      const current = await tx.user.findUnique({ where: { id: user!.id } });
      if (!activeCustomer(current) || current!.passwordHash !== user!.passwordHash) throw new UnauthorizedException('Customer account unavailable');
      const existing = await tx.authProviderIdentity.findUnique({ where: { provider_subject: { provider, subject: identity.subject } } });
      if (existing && existing.userId !== user!.id) throw new ConflictException('Identity belongs to another account');
      if (!existing) await tx.authProviderIdentity.create({ data: { provider, subject: identity.subject, userId: user!.id } });
      return { linked: true, provider };
    }, OPTIONS); } catch (error) { if ((error as any).code === 'P2002') throw new ConflictException('Identity already linked'); throw error; }
  }
  async requestEmail(emailInput: string) {
    const config = emailLoginConfig(); if (!config.enabled) throw new ServiceUnavailableException('Email login is not configured');
    const email = emailInput.trim().toLowerCase(), now = new Date(), id = randomUUID(), code = randomInt(0, 1000000).toString().padStart(6,'0');
    // No provider call while holding database locks. Persist an unusable PENDING challenge first.
    await this.prisma.$transaction(async tx => {
      await tx.emailLoginThrottle.upsert({ where: { email }, create: { email, lastSentAt: new Date(0), windowStart: now, sendCount: 0 }, update: {} });
      await tx.$queryRaw(Prisma.sql`SELECT email FROM email_login_throttles WHERE email = ${email} FOR UPDATE`);
      const throttle = await tx.emailLoginThrottle.findUniqueOrThrow({ where: { email } });
      const recent = now.getTime() - throttle.windowStart.getTime() < 3600000;
      if (now.getTime() - throttle.lastSentAt.getTime() < 60000 || recent && throttle.sendCount >= 5) throw new BadRequestException('EMAIL_LOGIN_RATE_LIMITED');
      const user = await tx.user.findUnique({ where: { email } });
      if (user && !activeCustomer(user)) throw new UnauthorizedException('Customer sign-in unavailable');
      await tx.emailLoginThrottle.update({ where: { email }, data: { lastSentAt: now, windowStart: recent ? throttle.windowStart : now, sendCount: recent ? throttle.sendCount + 1 : 1 } });
      await tx.emailLoginChallenge.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: now } });
      await tx.emailLoginChallenge.create({ data: { id, email, codeHash: emailCodeHash(id,email,code), expiresAt: new Date(now.getTime()+600000) } });
    }, OPTIONS);
    try { await this.delivery.send(email,code,id); }
    catch { await this.prisma.emailLoginChallenge.updateMany({ where: { id, deliveryState: 'PENDING' }, data: { deliveryState: 'FAILED', consumedAt: new Date() } }); throw new ServiceUnavailableException('Email delivery is temporarily unavailable'); }
    const sent = await this.prisma.emailLoginChallenge.updateMany({ where: { id, deliveryState: 'PENDING', consumedAt: null, expiresAt: { gt: new Date() } }, data: { deliveryState: 'SENT' } });
    if (sent.count !== 1) throw new ServiceUnavailableException('Email challenge expired; request a new code');
    return { challengeId: id, expiresIn: 600, resendAfter: 60, ...(config.devOnly ? { devCode: code } : {}) };
  }
  async verifyEmail(id: string, code: string) {
    if (!emailLoginConfig().enabled) throw new ServiceUnavailableException('Email login is not configured');
    const first = await this.prisma.emailLoginChallenge.findUnique({ where: { id } }); if (!first) throw new UnauthorizedException('Invalid email code');
    let result;
    try { result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT email FROM email_login_throttles WHERE email = ${first.email} FOR UPDATE`);
      const row = await tx.emailLoginChallenge.findUnique({ where: { id } });
      if (!row || row.consumedAt || row.deliveryState !== 'SENT' || row.expiresAt <= new Date() || row.attempts >= 5) return { error: true };
      const valid = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(emailCodeHash(id,row.email,code)));
      await tx.emailLoginChallenge.update({ where: { id }, data: { attempts: { increment: 1 }, ...(!valid && row.attempts >= 4 ? { consumedAt: new Date() } : {}) } });
      if (!valid) return { error: true };
      let user = await tx.user.findUnique({ where: { email: row.email } });
      if (user) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`);
        user = await tx.user.findUnique({ where: { id: user.id } });
        if (!activeCustomer(user) || user!.email !== row.email) return { error: true };
        user = await tx.user.update({ where: { id: user!.id }, data: { emailVerifiedAt: new Date() } });
      } else user = await tx.user.create({ data: { email: row.email, emailVerifiedAt: new Date(), role: 'CUSTOMER', status: 'ACTIVE', phone: null } });
      const claimed = await tx.emailLoginChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) return { error: true };
      return { user };
    }, OPTIONS); } catch (error) {
      if (['P2002','P2034'].includes((error as any).code)) throw new ConflictException('Email sign-in changed; request a new code');
      throw error;
    }
    if ('error' in result || !result.user) throw new UnauthorizedException('Invalid email code');
    return this.auth.createCustomerSession(result.user, true);
  }
  async verifyCurrentEmail(userId: string, id: string, code: string) {
    if (!emailLoginConfig().enabled) throw new ServiceUnavailableException('Email login is not configured');
    const owner = BigInt(userId), first = await this.prisma.emailLoginChallenge.findUnique({ where: { id } });
    if (!first) throw new UnauthorizedException('Invalid email code');
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT email FROM email_login_throttles WHERE email=${first.email} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${owner} FOR UPDATE`);
      const [row, user] = await Promise.all([
        tx.emailLoginChallenge.findUnique({ where: { id } }),
        tx.user.findUnique({ where: { id: owner } }),
      ]);
      if (!activeCustomer(user) || !row || row.consumedAt || row.deliveryState !== 'SENT' || row.expiresAt <= new Date() || row.attempts >= 5) return false;
      const valid = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(emailCodeHash(id,row.email,code)));
      const attempt = await tx.emailLoginChallenge.update({ where: { id }, data: {
        attempts: { increment: 1 }, ...(!valid && row.attempts >= 4 ? { consumedAt: new Date() } : {}),
      } });
      if (!valid) return false;
      if (user!.email !== row.email || !customerOrderEmail(row.email)) return false;
      const claimed = await tx.emailLoginChallenge.updateMany({ where: { id, consumedAt: null, deliveryState: 'SENT', expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) return false;
      await tx.user.update({ where: { id: owner }, data: { emailVerifiedAt: new Date() } });
      return !!attempt;
    }, OPTIONS);
    if (!result) throw new UnauthorizedException('Invalid email code');
    return { verified: true };
  }
}
