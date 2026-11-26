import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { customerOrderEmail } from '../../common/booking-order-email';
import { requireShopAccess, shopAccessId, type ShopActor } from '../../common/shop-access';
import { shopOrderEmailSettingsView } from '../../common/shop-order-email-settings';
import { configurationAudit, withShopConfiguration } from '../reservations/configuration-guard';
import { jwtSecret } from '../auth/security';
import { ShopOrderEmailVerificationDelivery } from './shop-order-email-settings.delivery';
import { ShopOrderEmailRevisionDto, ShopOrderEmailVerificationRequestDto, ShopOrderEmailVerifyDto } from './shop-order-email-settings.dto';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalid = () => new BadRequestException('预约通知邮箱请求格式无效');
const changed = () => new ConflictException('预约通知邮箱设置已变化，请重新读取后操作');
const hashCode = (shopId: bigint, challengeId: string, email: string, code: string) => createHmac('sha256', jwtSecret())
  .update('shop-order-email-verification\0' + shopId + '\0' + challengeId + '\0' + email + '\0' + code).digest('hex');
function body(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw invalid();
}
function revision(value: unknown) { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 2147483645) throw invalid(); }

@Injectable()
export class ShopOrderEmailSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly delivery: ShopOrderEmailVerificationDelivery) {}
  private view(row: any, shop: any) {
    const config = this.delivery.config(), workerEnabled = process.env.NOTIFICATION_WORKER_ENABLED !== 'false';
    return shopOrderEmailSettingsView(row, shop.studioProfile, shop.id, { configured: config.enabled,
      mode: config.deliveryMode as 'LOCAL_CAPTURE' | 'PROVIDER' | null, workerEnabled,
      reasonCode: !config.enabled ? 'ORDER_EMAIL_NOT_CONFIGURED' : !workerEnabled ? 'ORDER_EMAIL_WORKER_DISABLED' : null });
  }
  async get(actor: ShopActor, shopIdInput: string) {
    const shopId = shopAccessId(shopIdInput);
    const { shop } = await requireShopAccess(this.prisma, shopId, actor, 'SHOP_SETTINGS_MANAGE');
    const row = await this.prisma.shopOrderEmailSetting.findUnique({ where: { shopId } });
    return this.view(row, shop);
  }
  async requestVerification(actor: ShopActor, shopIdInput: string, input: ShopOrderEmailVerificationRequestDto) {
    const shopId = shopAccessId(shopIdInput);
    body(input, ['email', 'expectedRevision', 'requestId']); revision(input.expectedRevision);
    const email = typeof input.email === 'string' ? customerOrderEmail(input.email.trim())?.toLowerCase() : null;
    if (!email || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw invalid();
    const challengeId = input.requestId.toLowerCase(), code = randomInt(0, 1000000).toString().padStart(6, '0');
    const prepared = await withShopConfiguration(this.prisma, shopId, actor, async (tx, shop) => {
      const row = await tx.shopOrderEmailSetting.findUnique({ where: { shopId } });
      // An uncertain response is recovered with this stable request, never another send.
      if (row?.challengeId === challengeId) {
        if (row.pendingEmail !== email) throw changed();
        return { send: false, view: this.view(row, shop) };
      }
      if ((row?.revision ?? 0) !== input.expectedRevision) throw changed();
      if (!this.delivery.config().enabled) throw new ServiceUnavailableException('预约通知邮件服务尚未配置；订单仍保存在后台，但门店收单邮件无法发送');
      const now = new Date(), recent = row?.windowStart instanceof Date && now.getTime() - row.windowStart.getTime() < 3600000;
      if (row?.lastRequestedAt && now.getTime() - row.lastRequestedAt.getTime() < 60000 || recent && row.sendCount >= 5)
        throw new BadRequestException('验证邮件请求过于频繁，请稍后再试');
      const data = { revision: (row?.revision ?? 0) + 1, challengeId, pendingEmail: email,
        codeHash: hashCode(shopId, challengeId, email, code), pendingExpiresAt: new Date(now.getTime() + 600000), attempts: 0,
        deliveryState: 'SENDING', consumedAt: null, lastRequestedAt: now, windowStart: recent ? row.windowStart : now,
        sendCount: recent ? row.sendCount + 1 : 1 };
      const saved = await tx.shopOrderEmailSetting.upsert({ where: { shopId }, create: { shopId, ...data }, update: data });
      await configurationAudit(tx, actor, 'SHOP_ORDER_EMAIL_SETTINGS', shopId, 'REQUEST_VERIFICATION', ['pendingEmail']);
      return { send: true, view: this.view(saved, shop) };
    }, 'SHOP_SETTINGS_MANAGE');
    if (!prepared.send) return prepared.view;
    // No external delivery while the common shop/user locks are held.
    let deliveryState: 'SENT' | 'FAILED' | 'UNKNOWN';
    try { deliveryState = await this.delivery.send(email, code, challengeId); }
    catch { deliveryState = 'UNKNOWN'; }
    return withShopConfiguration(this.prisma, shopId, actor, async (tx, shop) => {
      await tx.shopOrderEmailSetting.updateMany({ where: { shopId, challengeId, deliveryState: 'SENDING' }, data: { deliveryState } });
      return this.view(await tx.shopOrderEmailSetting.findUnique({ where: { shopId } }), shop);
    }, 'SHOP_SETTINGS_MANAGE');
  }
  async verify(actor: ShopActor, shopIdInput: string, input: ShopOrderEmailVerifyDto) {
    const shopId = shopAccessId(shopIdInput);
    body(input, ['challengeId', 'code', 'expectedRevision']); revision(input.expectedRevision);
    if (typeof input.challengeId !== 'string' || !UUID.test(input.challengeId) || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw invalid();
    const result = await withShopConfiguration(this.prisma, shopId, actor, async (tx, shop) => {
      const row = await tx.shopOrderEmailSetting.findUnique({ where: { shopId } });
      if (!row || row.revision !== input.expectedRevision || row.challengeId !== input.challengeId.toLowerCase()) throw changed();
      const now = new Date(), email = customerOrderEmail(row.pendingEmail);
      if (row.consumedAt || !email || !(row.pendingExpiresAt instanceof Date) || !Number.isFinite(row.pendingExpiresAt.getTime())
        || row.pendingExpiresAt <= now || !Number.isInteger(row.attempts) || row.attempts < 0 || row.attempts >= 5
        || !['SENDING', 'SENT', 'UNKNOWN'].includes(row.deliveryState) || typeof row.codeHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.codeHash))
        return { invalid: true } as const;
      const valid = timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(hashCode(shopId, row.challengeId, email, input.code), 'hex'));
      if (!valid) {
        await tx.shopOrderEmailSetting.update({ where: { shopId }, data: { attempts: { increment: 1 }, ...(row.attempts >= 4 ? { consumedAt: now } : {}) } });
        return { invalid: true } as const;
      }
      const saved = await tx.shopOrderEmailSetting.update({ where: { shopId }, data: { recipientEmail: email.toLowerCase(), recipientVerifiedAt: now,
        enabled: true, consumedAt: now, revision: { increment: 1 } } });
      await configurationAudit(tx, actor, 'SHOP_ORDER_EMAIL_SETTINGS', shopId, 'VERIFY_RECIPIENT', ['recipientEmail', 'recipientVerifiedAt']);
      return { view: this.view(saved, shop) };
    }, 'SHOP_SETTINGS_MANAGE');
    // Wrong attempts must commit before returning an error; never roll the counter back.
    if ('invalid' in result) throw new BadRequestException('验证码无效、已使用或已过期，请核对邮箱或重新申请');
    return result.view;
  }
  async disable(actor: ShopActor, shopIdInput: string, input: ShopOrderEmailRevisionDto) {
    const shopId = shopAccessId(shopIdInput);
    body(input, ['expectedRevision']); revision(input.expectedRevision);
    return withShopConfiguration(this.prisma, shopId, actor, async (tx, shop) => {
      const row = await tx.shopOrderEmailSetting.findUnique({ where: { shopId } });
      if ((row?.revision ?? 0) !== input.expectedRevision) throw changed();
      const data = { revision: (row?.revision ?? 0) + 1, enabled: false, recipientEmail: null, recipientVerifiedAt: null, consumedAt: new Date() };
      const saved = await tx.shopOrderEmailSetting.upsert({ where: { shopId }, create: { shopId, ...data }, update: data });
      await configurationAudit(tx, actor, 'SHOP_ORDER_EMAIL_SETTINGS', shopId, 'DISABLE_RECIPIENT', ['enabled']);
      return this.view(saved, shop);
    }, 'SHOP_SETTINGS_MANAGE');
  }
}
