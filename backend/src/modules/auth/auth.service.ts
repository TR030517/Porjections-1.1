import { Injectable, UnauthorizedException, ServiceUnavailableException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { emailReauthProof } from './reauth-proof';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const safeUser = (user: any) => ({ id: user.id.toString(), phone: user.phone, email: user.email, emailVerified: !!user.emailVerifiedAt, name: user.name, avatarUrl: user.avatarUrl ?? null, role: user.role });
type LoginRequiredRole = 'CUSTOMER' | 'MERCHANT' | 'STAFF' | 'ADMIN';
@Injectable()
export class AuthService {
  private otpStore = new Map<string, { hash: string; expires: number; sent: number; attempts: number }>();
  constructor(private readonly prisma: PrismaService, private readonly jwtService: JwtService) {}
  async passwordLogin(identifier: string, password: string, requiredRole?: LoginRequiredRole) {
    if (Buffer.byteLength(password, 'utf8') > 72) throw new UnauthorizedException('Invalid credentials');
    const login = identifier.trim();
    // Choose one namespace instead of trusting the first match across unrelated
    // unique columns. Only legacy numeric phones share the username namespace;
    // two different matching accounts must authenticate through another identifier.
    const where: Prisma.UserWhereInput = login.includes('@') ? { email: login.toLowerCase() }
      : /^\+[1-9]\d{1,14}$/.test(login) ? { phone: login }
      : /^\d+$/.test(login) ? { OR: [{ loginName: login }, { phone: login }] }
      : { loginName: login.toLowerCase() };
    const candidates = await this.prisma.user.findMany({ where, take: 2 });
    const user = candidates.length === 1 ? candidates[0] : null;
    if (!user?.passwordHash || user.status !== 'ACTIVE' || (requiredRole && user.role !== requiredRole) || !(await compare(password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
    return this.createSession(user, requiredRole);
  }
  private requireLocalOtp() {
    if (process.env.NODE_ENV === 'production' || process.env.AUTH_LOCAL_OTP !== 'true') throw new ServiceUnavailableException('SMS login is not configured');
  }
  async sendOtp(phone: string): Promise<{ message: string; devCode?: string }> {
    this.requireLocalOtp();
    const previous = this.otpStore.get(phone);
    if (previous && Date.now() - previous.sent < 60000) throw new BadRequestException('Please wait before requesting another code');
    if (this.otpStore.size > 1000) this.otpStore.clear();
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    this.otpStore.set(phone, { hash: hashToken(code), expires: Date.now() + 300000, sent: Date.now(), attempts: 0 });
    return { message: 'Local test verification only', devCode: code };
  }
  async verifyOtp(phone: string, code: string) {
    this.requireLocalOtp();
    const record = this.otpStore.get(phone);
    if (!record || record.expires < Date.now() || ++record.attempts > 5 || !timingSafeEqual(Buffer.from(record.hash), Buffer.from(hashToken(code)))) {
      if (record && (record.expires < Date.now() || record.attempts >= 5)) this.otpStore.delete(phone);
      throw new UnauthorizedException('Invalid verification code');
    }
    this.otpStore.delete(phone);
    const user = await this.prisma.user.upsert({ where: { phone }, create: { phone, role: 'CUSTOMER' }, update: {} });
    if (user.status !== 'ACTIVE' || user.role !== 'CUSTOMER') throw new UnauthorizedException('Customer account unavailable');
    return this.createSession(user, 'CUSTOMER');
  }
  async appleLogin(_token: string, _email?: string, _name?: string): Promise<any> { throw new ServiceUnavailableException('Apple identity verification is not configured'); }
  async googleLogin(_token: string, _email?: string, _name?: string): Promise<any> { throw new ServiceUnavailableException('Google identity verification is not configured'); }
  createCustomerSession(user: any, verifiedEmail = false) { return this.createSession(user, 'CUSTOMER', verifiedEmail); }
  private async createSession(user: any, requiredRole?: LoginRequiredRole, verifiedEmail = false) {
    const refreshToken = randomBytes(48).toString('base64url');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`);
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || current.status !== 'ACTIVE' || current.passwordHash !== user.passwordHash || (requiredRole && current.role !== requiredRole)) throw new UnauthorizedException('Account unavailable');
      const session = await tx.authSession.create({ data: { id: randomUUID(), userId: current.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      return { ...this.response(current, session.id, refreshToken), ...(verifiedEmail ? { reauthToken: emailReauthProof(current.id.toString(),session.id) } : {}) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  private response(user: any, sid: string, refreshToken: string) {
    return { accessToken: this.jwtService.sign({ sub: user.id.toString(), sid, role: user.role }, { expiresIn: '15m' }), refreshToken, user: safeUser(user), expiresIn: 900 };
  }
  async refreshToken(token: string, requiredRole?: 'CUSTOMER' | 'ADMIN') {
    if (!token || token.length > 200) throw new UnauthorizedException('Invalid refresh token');
    const replacement = randomBytes(48).toString('base64url');
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
      if (!old || old.revokedAt || old.expiresAt <= new Date()) throw new UnauthorizedException('Invalid refresh token');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${old.userId} FOR UPDATE`);
      const current = await tx.user.findUnique({ where: { id: old.userId } });
      if (!current || current.status !== 'ACTIVE' || (requiredRole && current.role !== requiredRole)) throw new UnauthorizedException('Invalid refresh token');
      const nextId = randomUUID();
      const claimed = await tx.authSession.updateMany({ where: { id: old.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date(), rotatedTo: nextId } });
      if (claimed.count !== 1) throw new UnauthorizedException('Refresh token already used');
      await tx.authSession.create({ data: { id: nextId, userId: old.userId, tokenHash: hashToken(replacement), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      // Keep only devices still owned by this exact session; reassigned tokens stay with their new owner.
      await tx.pushDevice.updateMany({ where: { authSessionId: old.id, userId: old.userId }, data: { authSessionId: nextId, bindingVersion: randomUUID() } });
      return this.response(current, nextId, replacement);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async logout(token: string, requiredRole?: 'CUSTOMER') {
    if (token && token.length <= 200) await this.prisma.$transaction(async tx => {
      const session = await tx.authSession.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!session) return;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${session.userId} FOR UPDATE`);
      if (requiredRole) {
        const current = await tx.user.findUnique({ where: { id: session.userId } });
        if (!current || current.role !== requiredRole) throw new UnauthorizedException('Invalid refresh token');
      }
      await tx.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.pushDevice.deleteMany({ where: { authSessionId: session.id, userId: session.userId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return { success: true };
  }
  async me(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account unavailable');
    return safeUser(user);
  }
}
