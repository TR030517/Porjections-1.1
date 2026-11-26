/** Database-backed private-device delivery. No public topics or mock successes. */
import { BadRequestException, Injectable, Logger, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaService } from '../../prisma/prisma.service';

const permanentTokenErrors = new Set(['messaging/invalid-registration-token', 'messaging/registration-token-not-registered']);
export const pushTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const MAX_DEVICES = 10;

@Injectable()
export class FcmService implements OnModuleDestroy {
  private readonly logger = new Logger(FcmService.name);
  private isConfigured = false;
  private admin: any = null;
  private firebaseApp: any = null;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.FCM_ENABLED !== 'true' || !process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      this.logger.warn('Push notifications disabled: Firebase is not configured.');
      return;
    }
    try {
      const admin = require('firebase-admin');
      const account = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
      this.firebaseApp = admin.initializeApp({ credential: admin.credential.cert(account) }, `massajoy2-push-${randomUUID()}`);
      this.admin = admin;
      this.isConfigured = true;
    } catch {
      this.logger.warn('Push notifications disabled: Firebase initialization failed.');
    }
  }
  async onModuleDestroy() { if (this.firebaseApp) await this.firebaseApp.delete(); }
  config() { return this.isConfigured ? { enabled: true, provider: 'fcm' } : { enabled: false, provider: 'fcm', reason: 'PUSH_NOT_CONFIGURED' }; }

  private identity(userId: string | number, sessionId?: string) {
    if ((typeof userId === 'number' && !Number.isSafeInteger(userId)) || !/^[1-9]\d*$/.test(String(userId)) || BigInt(userId) > 9223372036854775807n) throw new UnauthorizedException('Invalid user identity');
    if (sessionId !== undefined && !/^[a-f0-9-]{36}$/i.test(sessionId)) throw new UnauthorizedException('A valid login session is required');
    return BigInt(userId);
  }
  private validateToken(token: string) {
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) throw new BadRequestException('Invalid device token');
  }
  private async session(tx: Prisma.TransactionClient, userId: bigint, sessionId: string) {
    if (!sessionId) throw new UnauthorizedException('A valid login session is required');
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    const active = await tx.authSession.findFirst({ where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE', deletedAt: null } } });
    if (!active) throw new UnauthorizedException('A valid login session is required');
  }
  async registerToken(userId: string | number, sessionId: string, token: string) {
    const owner = this.identity(userId, sessionId); this.validateToken(token);
    // A unique-token race or InnoDB deadlock can be retried without changing the binding contract.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.$transaction(async tx => {
          await this.session(tx, owner, sessionId);
          const data = { userId: owner, authSessionId: sessionId, token, bindingVersion: randomUUID() };
          await tx.pushDevice.upsert({ where: { tokenHash: pushTokenHash(token) }, create: { ...data, tokenHash: pushTokenHash(token) }, update: data });
          const excess = await tx.pushDevice.findMany({ where: { userId: owner, tokenHash: { not: pushTokenHash(token) } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: MAX_DEVICES - 1, select: { id: true, bindingVersion: true } });
          for (const device of excess) await tx.pushDevice.deleteMany({ where: { ...device, userId: owner } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        break;
      } catch (error) { if (attempt >= 2 || !['P2002', 'P2034'].includes((error as any)?.code)) throw error; }
    }
    const config = this.config();
    return { registered: true, status: config.enabled ? 'registered' : 'disabled', deliveryEnabled: config.enabled, ...(!config.enabled ? { reason: 'PUSH_NOT_CONFIGURED' } : {}) };
  }
  async unregisterToken(userId: string | number, sessionId: string, token: string) {
    const owner = this.identity(userId, sessionId); this.validateToken(token);
    await this.prisma.$transaction(async tx => {
      await this.session(tx, owner, sessionId);
      await tx.pushDevice.deleteMany({ where: { tokenHash: pushTokenHash(token), userId: owner, authSessionId: sessionId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    // Idempotent and deliberately does not reveal whether a token belongs to another account.
    return { unregistered: true };
  }
  async sendToUser(userId: string | number, title: string, body: string, data?: Record<string, string>, signal?: AbortSignal): Promise<{ sent?: number; failed?: number; removed?: number; error?: string }> {
    const owner = this.identity(userId);
    if (!this.isConfigured) return { error: 'PUSH_NOT_CONFIGURED' };
    const eligible = () => ({ userId: owner, user: { status: 'ACTIVE' as const, deletedAt: null }, authSession: { userId: owner, revokedAt: null, expiresAt: { gt: new Date() } } });
    const devices = await this.prisma.pushDevice.findMany({ where: eligible(), take: MAX_DEVICES });
    if (!devices.length) return { error: 'NO_REGISTERED_DEVICE' };
    let sent = 0, failed = 0, removed = 0;
    for (const device of devices) {
      if (signal?.aborted) break;
      // Recheck ownership/session immediately before dispatch; never reuse a stale in-memory owner map.
      const current = await this.prisma.pushDevice.findFirst({ where: { id: device.id, bindingVersion: device.bindingVersion, ...eligible() } });
      if (!current || signal?.aborted) continue;
      try {
        await this.admin.messaging(this.firebaseApp || undefined).send({ notification: { title, body }, data: { ...(data || {}), timestamp: String(Date.now()) }, token: current.token });
        sent++;
      } catch (error) {
        failed++;
        if (permanentTokenErrors.has((error as any)?.code)) {
          const result = await this.prisma.pushDevice.deleteMany({ where: { id: current.id, userId: owner, authSessionId: current.authSessionId, bindingVersion: current.bindingVersion } });
          removed += result.count;
        }
      }
    }
    this.logger.debug(`Push dispatch completed: sent=${sent}, failed=${failed}, removed=${removed}`);
    return { sent, failed, removed, ...(sent ? {} : { error: failed ? 'PUSH_DELIVERY_FAILED' : 'NO_REGISTERED_DEVICE' }) };
  }
}
