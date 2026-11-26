import { requireShopAccess } from '../../common/shop-access';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { enqueueNotification } from '../../common/notification-outbox';
import { publicShopIds, publicShopWhere, requirePublicShop } from '../../common/shop-eligibility';
import { PrismaService } from '../../prisma/prisma.service';
import { CUSTOMER_ENTITLEMENT_STATUSES, entitlementId, GiftActor, giftExpiry, giftId, giftInteger, giftObject, giftPage, giftReason, hash, newVoucher, requestKey, scopedKey, unusableVoucherHash, voucherHash } from './gift-card.validation';
import { giftLocalTimestamp, giftTimezone } from './gift-card.time';

const SHOP = { select: { id: true, name: true, timezone: true } };
const SALES_REASON = '线上收款尚未开放；支持已启用门店的到店付款，实际收款后发放权益。';
const ORDER = { shop: SHOP, rights: { select: { id: true, source: true, totalUses: true, remainingUses: true, status: true } }, saleEntries: { orderBy: { createdAt: 'asc' as const } } };
const REDEMPTION = { entitlement: { select: { shop: SHOP } } };

/** Gift-card sales deliberately do not call booking-only PaymentService. A quote
 * is never a payment and promotional grants never write a sales/merchant ledger. */
@Injectable()
export class GiftCardsService {
  constructor(private readonly prisma: PrismaService) {}
  config() { return { salesEnabled: true, onlinePaymentEnabled: false, paymentMethods: ['PAY_AT_STORE'], currency: 'usd', reason: SALES_REASON, promotionalEntitlementsEnabled: true, credentialTtlSeconds: 300 }; }

  private async authorize(db: any, shopId: bigint, actor: GiftActor, requirePublished = false, write = false) {
    if (!actor || !['ADMIN', 'MERCHANT'].includes(actor.role)) throw new ForbiddenException('仅管理员或本店商家可操作权益');
    const { shop } = await requireShopAccess(db, shopId, actor, 'OWNER_ONLY', {write});
    if (requirePublished) await requirePublicShop(db, shopId, { lockOwner: true });
    return shop;
  }
  private async write<T>(shopId: bigint, work: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx: any) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE`);
          return work(tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });
      } catch (error) {
        const e = error as any;
        const retryable = e.code === 'P2034' || e.code === 'P2010' && ['1205', '1213'].includes(String(e.meta?.code));
        if (!retryable) throw error;
        if (attempt === 2) throw new ServiceUnavailableException('权益操作繁忙，请使用相同请求键稍后重试');
      }
    }
    throw new ServiceUnavailableException('权益操作繁忙');
  }
  private async audit(tx: any, actor: GiftActor, shopId: bigint, action: string, data: { entitlementId?: string; orderId?: string; reasonRecorded?: boolean; usedUses?: number } = {}) {
    // Audit target IDs are BigInt; use the shop target and safe UUID/ID metadata.
    // Raw reasons and bearer credentials are deliberately never recorded here.
    await tx.auditLog.create({ data: { operatorId: giftId(actor.id), targetType: 'GIFT_CARD_SHOP', targetId: shopId, action,
      detail: { ...data, ...(data.reasonRecorded ? { reason: 'recorded' } : {}) } } });
  }
  private page(items: any[], total: number, query: ReturnType<typeof giftPage>) {
    return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) };
  }
  private productView(row: any) {
    return { id: row.id.toString(), shopId: row.shopId.toString(), title: row.title, description: row.description,
      priceCents: row.priceCents, currency: 'usd', useTimes: row.useTimes, expireDays: row.expireDays, status: row.status,
      shop: row.shop ? { id: row.shop.id.toString(), name: row.shop.name, timezone: row.shop.timezone } : undefined,
      salesEnabled: row.shop?.giftSalesPolicy?.payAtStoreEnabled === true, onlinePaymentEnabled: false, paymentMethods: row.shop?.giftSalesPolicy?.payAtStoreEnabled === true ? ['PAY_AT_STORE'] : [] };
  }
  private orderView(row: any, operator = false) {
    const timezone = giftTimezone(row.shop?.timezone);
    const right = row.rights?.length === 1 ? row.rights[0] : null;
    const eligible = row.paymentMethod === 'PAY_AT_STORE';
    const unspent = right?.source === 'PURCHASE' && right.totalUses === right.remainingUses && ['ACTIVE', 'EXPIRED'].includes(right.status);
    const pending = row.status === 'PENDING' && row.paidCents === 0 && !row.providerPaymentId && !row.rights?.length;
    const entry = (value: any) => ({ id: value.id, amountCents: value.amountCents, method: value.method, reference: value.reference,
      reason: value.reason, createdAt: value.createdAt, createdAtLocal: giftLocalTimestamp(value.createdAt, timezone), operatorId: value.operatorId.toString() });
    return { id: row.id.toString(), orderNo: row.orderNo, userId: row.userId.toString(), shopId: row.shopId.toString(), productId: row.productId.toString(),
      productTitleSnapshot: row.productTitleSnapshot ?? null, useTimesSnapshot: row.useTimesSnapshot ?? null, expireDaysSnapshot: row.expireDaysSnapshot ?? null,
      amountCents: row.amountCents, paidCents: row.paidCents, refundedCents: row.refundedCents ?? 0, paymentMethod: row.paymentMethod ?? 'LEGACY',
      currency: row.currency ?? 'usd', status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, entitlementId: right?.id ?? null,
      timezone, createdAtLocal: giftLocalTimestamp(row.createdAt, timezone), updatedAtLocal: giftLocalTimestamp(row.updatedAt, timezone),
      receipts: (row.saleEntries ?? []).filter((e: any) => e.kind === 'RECEIPT').map(entry), refunds: (row.saleEntries ?? []).filter((e: any) => e.kind === 'REFUND').map(entry),
      legacySnapshotIncomplete: !row.productTitleSnapshot || row.useTimesSnapshot == null || row.expireDaysSnapshot == null,
      allowedActions: { cancel: !operator && pending, recordReceipt: operator && eligible && pending,
        recordRefund: operator && eligible && row.status === 'PAID' && row.paidCents === row.amountCents && row.refundedCents === 0 && !!unspent },
      salesEnabled: eligible, onlinePaymentEnabled: false, paymentDisabledReason: eligible ? null : SALES_REASON };
  }
  private entitlementView(row: any, now = new Date()) {
    const timezone = giftTimezone(row.shop?.timezone);
    const status = row.status === 'ACTIVE' && row.expiresAt <= now ? 'EXPIRED' : row.status;
    return { id: row.id, userId: row.userId.toString(), shopId: row.shopId.toString(), productId: row.productId.toString(), orderId: row.orderId?.toString() ?? null,
      productTitleSnapshot: row.productTitleSnapshot ?? null, source: row.source ?? 'LEGACY', totalUses: row.totalUses, remainingUses: row.remainingUses,
      expiresAt: row.expiresAt, timezone, expiresAtLocal: giftLocalTimestamp(row.expiresAt, timezone), status, grantReasonRecorded: !!row.grantReason, voidReasonRecorded: !!row.voidReason,
      grantedById: row.grantedById?.toString() ?? null, voidedAt: row.voidedAt ?? null, createdAt: row.createdAt,
      createdAtLocal: giftLocalTimestamp(row.createdAt, timezone), voidedAtLocal: giftLocalTimestamp(row.voidedAt, timezone),
      shop: row.shop ? { id: row.shop.id.toString(), name: row.shop.name, timezone: row.shop.timezone } : undefined };
  }
  private redemptionView(row: any) {
    const timezone = giftTimezone(row.entitlement?.shop?.timezone);
    return { id: row.id, entitlementId: row.entitlementId, shopId: row.shopId?.toString() ?? null, operatorId: row.operatorId.toString(), usedUses: row.usedUses, createdAt: row.createdAt,
      timezone, createdAtLocal: giftLocalTimestamp(row.createdAt, timezone) };
  }
  private activeEntitlement(row: any, now: Date) {
    if (row.status !== 'ACTIVE' || row.expiresAt <= now || row.remainingUses <= 0) throw new ConflictException('权益已到期、作废或次数已用尽');
  }
  private filterStatus(query: Record<string, unknown>, statuses: readonly string[], now = new Date()) {
    if (query.status === undefined) return {};
    if (typeof query.status !== 'string' || !statuses.includes(query.status)) throw new BadRequestException('无效的状态');
    if (query.status === 'EXPIRED') return { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lte: now } }] };
    if (query.status === 'ACTIVE') return { status: 'ACTIVE', expiresAt: { gt: now } };
    return { status: query.status };
  }

  async products(input: Record<string, unknown> = {}) {
    const query = giftObject(input, ['shopId', 'page', 'pageSize']); const page = giftPage(query);
    const db = this.prisma as any;
    const strictShopIds = await publicShopIds(db, query.shopId === undefined ? undefined : [giftId(query.shopId, 'shopId')]);
    const where = { status: 'ACTIVE', shopId: { in: strictShopIds }, shop: publicShopWhere() };
    const [rows, total] = await Promise.all([db.giftCardProduct.findMany({ where, include: { shop: { select: { ...SHOP.select, giftSalesPolicy: true } } }, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.giftCardProduct.count({ where })]);
    return { ...this.page(rows.map((row: any) => this.productView(row)), total, page), salesEnabled: true };
  }
  async product(id: string) {
    const row = await this.prisma.giftCardProduct.findFirst({ where: { id: giftId(id), status: 'ACTIVE', shop: publicShopWhere() }, include: { shop: { select: { ...SHOP.select, giftSalesPolicy: true } } } });
    if (!row || !(await publicShopIds(this.prisma, [row.shopId])).length) throw new NotFoundException('产品不存在或未启用');
    return { item: this.productView(row), salesEnabled: true };
  }
  async orders(user: string, input: Record<string, unknown> = {}) {
    const query = giftObject(input, ['status', 'page', 'pageSize']); const page = giftPage(query);
    const where = { userId: giftId(user), ...this.filterStatus(query, ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED']) };
    const db = this.prisma as any;
    const [rows, total] = await Promise.all([db.giftCardOrder.findMany({ where, include: ORDER, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.giftCardOrder.count({ where })]);
    return { ...this.page(rows.map((row: any) => this.orderView(row)), total, page), salesEnabled: true };
  }
  async order(user: string, order: string) {
    const row = await this.prisma.giftCardOrder.findFirst({ where: { id: giftId(order), userId: giftId(user) }, include: ORDER });
    if (!row) throw new NotFoundException('订单不存在');
    return { item: this.orderView(row), salesEnabled: true };
  }
  async createOrder(actor: GiftActor, input: Record<string, unknown>) {
    const body = giftObject(input, ['productId', 'requestKey', 'paymentMethod']);
    const productId = giftId(body.productId, 'productId'), userId = giftId(actor.id), key = requestKey(body.requestKey);
    if (body.paymentMethod !== undefined && body.paymentMethod !== 'PAY_AT_STORE') throw new BadRequestException('当前仅支持到店付款');
    const requestHash = scopedKey('order-request', productId.toString());
    const discovery = await this.prisma.giftCardProduct.findUnique({ where: { id: productId }, select: { shopId: true } });
    if (!discovery) throw new NotFoundException('产品不存在');
    try { return await this.write(discovery.shopId, async tx => {
      const previous = await tx.giftCardOrder.findUnique({ where: { userId_requestKey: { userId, requestKey: key } }, include: ORDER });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException('请求键已用于不同的产品');
        return { item: this.orderView(previous), salesEnabled: true };
      }
      const user = await tx.user.findFirst({ where: { id: userId, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!user) throw new ForbiddenException('账号不可用');
      await requirePublicShop(tx, discovery.shopId, { lockOwner: true });
      const policy = await tx.shopGiftSalesPolicy.findUnique({ where: { shopId: discovery.shopId } });
      if (!policy?.payAtStoreEnabled) throw new ConflictException('本店尚未开启礼品卡到店销售');
      const product = await tx.giftCardProduct.findFirst({ where: { id: productId, shopId: discovery.shopId, status: 'ACTIVE', shop: publicShopWhere() } });
      if (!product) throw new NotFoundException('产品不存在或未启用');
      giftInteger(product.priceCents, 1, 100000000, '产品价格'); giftInteger(product.useTimes, 1, 10000, '总次数'); giftInteger(product.expireDays, 1, 3650, '有效天数');
      const row = await tx.giftCardOrder.create({ data: { orderNo: `GC${randomUUID().replace(/-/g, '')}`, userId, shopId: product.shopId, productId,
        amountCents: product.priceCents, paidCents: 0, currency: 'usd', status: 'PENDING', paymentMethod: 'PAY_AT_STORE', requestKey: key, requestHash,
        productTitleSnapshot: product.title, useTimesSnapshot: product.useTimes, expireDaysSnapshot: product.expireDays }, include: ORDER });
      await this.audit(tx, actor, product.shopId, 'GIFT_ORDER_CREATE', { orderId: row.id.toString() });
      return { item: this.orderView(row), salesEnabled: true };
    }); } catch (error) {
      // Different shops have different mutex rows, but a user's request key is
      // global across shops. The unique index resolves that concurrent race.
      if ((error as any)?.code !== 'P2002') throw error;
      const previous = await (this.prisma as any).giftCardOrder.findUnique({ where: { userId_requestKey: { userId, requestKey: key } }, include: ORDER });
      if (!previous) throw error;
      if (previous.requestHash !== requestHash) throw new ConflictException('请求键已用于不同的产品');
      return { item: this.orderView(previous), salesEnabled: true };
    }
  }
  async cancelOrder(actor: GiftActor, id: string) {
    const oid = giftId(id), uid = giftId(actor.id);
    const discovery = await this.prisma.giftCardOrder.findFirst({ where: { id: oid, userId: uid }, select: { shopId: true } });
    if (!discovery) throw new NotFoundException('订单不存在');
    return this.write(discovery.shopId, async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM gift_card_orders WHERE id = ${oid} AND shop_id = ${discovery.shopId} FOR UPDATE`);
      const row = await tx.giftCardOrder.findFirst({ where: { id: oid, userId: uid }, include: ORDER });
      if (!row) throw new NotFoundException('订单不存在');
      if (row.status === 'CANCELLED' && row.paidCents === 0) return { item: this.orderView(row), salesEnabled: true };
      if (row.status !== 'PENDING' || row.paidCents !== 0 || row.providerPaymentId || await tx.giftCardEntitlement.count({ where: { orderId: oid } })) {
        throw new ConflictException('只能取消尚未付款且未发放权益的订单');
      }
      const updated = await tx.giftCardOrder.update({ where: { id: oid }, data: { status: 'CANCELLED' }, include: ORDER });
      await this.audit(tx, actor, row.shopId, 'GIFT_ORDER_CANCEL', { orderId: row.id.toString() });
      return { item: this.orderView(updated), salesEnabled: true };
    });
  }
  async checkout(user: string, id: string) {
    const result = await this.order(user, id);
    if (result.item.paymentMethod !== 'PAY_AT_STORE' || result.item.status !== 'PENDING') throw new ConflictException('当前订单不能办理到店付款');
    return { ...result, paymentMethod: 'PAY_AT_STORE', paymentRequiredAtStore: true, onlinePaymentEnabled: false, instruction: '请到门店实际付款，商家登记后权益才会到账。' };
  }

  async salesPolicy(actor: GiftActor, shop: string) {
    const sid = giftId(shop); await this.authorize(this.prisma, sid, actor);
    return this.policyView(sid, await this.prisma.shopGiftSalesPolicy.findUnique({ where: { shopId: sid } }));
  }
  private policyView(sid: bigint, row: any) {
    return { shopId: sid.toString(), payAtStoreEnabled: row?.payAtStoreEnabled === true, onlinePaymentEnabled: false,
      paymentMethods: row?.payAtStoreEnabled === true ? ['PAY_AT_STORE'] : [] };
  }
  async setSalesPolicy(actor: GiftActor, shop: string, input: Record<string, unknown>) {
    const sid = giftId(shop), body = giftObject(input, ['payAtStoreEnabled']);
    if (typeof body.payAtStoreEnabled !== 'boolean') throw new BadRequestException('销售开关必须为布尔值');
    const enabled = body.payAtStoreEnabled;
    return this.write(sid, async tx => {
      await this.authorize(tx, sid, actor, enabled, true);
      const row = await tx.shopGiftSalesPolicy.upsert({ where: { shopId: sid }, create: { shopId: sid, payAtStoreEnabled: enabled }, update: { payAtStoreEnabled: enabled } });
      await this.audit(tx, actor, sid, enabled ? 'GIFT_SALES_ENABLE' : 'GIFT_SALES_DISABLE');
      return this.policyView(sid, row);
    });
  }
  async adminOrders(actor: GiftActor, shop: string, input: Record<string, unknown> = {}) {
    const sid = giftId(shop), query = giftObject(input, ['status', 'userId', 'page', 'pageSize']), page = giftPage(query);
    await this.authorize(this.prisma, sid, actor);
    const where = { shopId: sid, ...(query.userId === undefined ? {} : { userId: giftId(query.userId, 'userId') }),
      ...this.filterStatus(query, ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED']) };
    const [rows, total] = await Promise.all([this.prisma.giftCardOrder.findMany({ where, include: ORDER, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), this.prisma.giftCardOrder.count({ where })]);
    return this.page(rows.map(row => this.orderView(row, true)), total, page);
  }
  async adminOrder(actor: GiftActor, shop: string, id: string) {
    const sid = giftId(shop); await this.authorize(this.prisma, sid, actor);
    const row = await this.prisma.giftCardOrder.findFirst({ where: { id: giftId(id), shopId: sid }, include: ORDER });
    if (!row) throw new NotFoundException('本店礼品订单不存在');
    return { item: this.orderView(row, true) };
  }
  private saleInput(input: Record<string, unknown>) {
    const body = giftObject(input, ['amountCents', 'method', 'reference', 'reason', 'requestKey']);
    const amountCents = giftInteger(body.amountCents, 1, 100000000, '实收或实退金额');
    if (typeof body.method !== 'string' || !['CASH', 'EXTERNAL_CARD', 'OTHER'].includes(body.method)) throw new BadRequestException('请选择实际发生的收退款方式');
    if (body.reference !== undefined && (typeof body.reference !== 'string' || body.reference.trim().length > 100)) throw new BadRequestException('参考号最多100字');
    return { amountCents, method: body.method, reference: typeof body.reference === 'string' && body.reference.trim() ? body.reference.trim() : null,
      reason: giftReason(body.reason), key: requestKey(body.requestKey) };
  }
  async recordReceipt(actor: GiftActor, shop: string, id: string, input: Record<string, unknown>) {
    return this.recordSale(actor, shop, id, input, 'RECEIPT');
  }
  async recordRefund(actor: GiftActor, shop: string, id: string, input: Record<string, unknown>) {
    return this.recordSale(actor, shop, id, input, 'REFUND');
  }
  private async recordSale(actor: GiftActor, shop: string, id: string, input: Record<string, unknown>, kind: 'RECEIPT' | 'REFUND') {
    const sid = giftId(shop), oid = giftId(id), body = this.saleInput(input);
    const key = scopedKey('gift-sale-entry', shop, actor.id, kind, body.key);
    const requestHash = scopedKey('gift-sale-content', id, String(body.amountCents), body.method, body.reference ?? '', body.reason);
    return this.write(sid, async tx => {
      await this.authorize(tx, sid, actor, false, true);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM gift_card_orders WHERE id = ${oid} AND shop_id = ${sid} FOR UPDATE`);
      const row = await tx.giftCardOrder.findFirst({ where: { id: oid, shopId: sid }, include: ORDER });
      if (!row) throw new NotFoundException('本店礼品订单不存在');
      const previous = await tx.giftCardSaleEntry.findUnique({ where: { requestKey: key } });
      if (previous) {
        if (previous.orderId !== oid || previous.requestHash !== requestHash) throw new ConflictException('收退款请求键已用于不同内容');
        return { item: this.orderView(row, true), replayed: true };
      }
      if (row.paymentMethod !== 'PAY_AT_STORE' || row.providerPaymentId || row.currency !== 'usd') throw new ConflictException('当前订单不能登记线下收退款；旧报价请重新下单');
      if (body.amountCents !== row.amountCents) throw new ConflictException('礼品订单仅支持一次全额实收或完全未使用时的全额实退');
      if (kind === 'RECEIPT') {
        if (row.status !== 'PENDING' || row.paidCents !== 0 || row.refundedCents !== 0 || row.rights.length || row.saleEntries.length) throw new ConflictException('当前订单已经办理或不能收款');
        if (!row.productTitleSnapshot) throw new ConflictException('历史订单缺少成交快照，请重新下单');
        const totalUses = giftInteger(row.useTimesSnapshot, 1, 10000, '成交次数');
        const now = new Date();
        const right = await tx.giftCardEntitlement.create({ data: { userId: row.userId, shopId: sid, productId: row.productId, orderId: oid,
          purchaseKey: scopedKey('gift-purchase', id), source: 'PURCHASE', productTitleSnapshot: row.productTitleSnapshot,
          totalUses, remainingUses: totalUses, expiresAt: giftExpiry(now, row.expireDaysSnapshot), tokenHash: unusableVoucherHash() } });
        await tx.giftCardOrder.update({ where: { id: oid }, data: { status: 'PAID', paidCents: row.amountCents } });
        await enqueueNotification(tx, { eventKey: `gift-order:${id}:paid`, userId: row.userId, topic: 'GIFT_PURCHASED', resourceType: 'GIFT_ORDER', resourceId: id, data: { amountCents: row.amountCents, currency: row.currency } });
        await this.audit(tx, actor, sid, 'GIFT_SALE_RECEIPT', { orderId: id, entitlementId: right.id, reasonRecorded: true });
      } else {
        if (row.status !== 'PAID' || row.paidCents !== row.amountCents || row.refundedCents !== 0 || row.rights.length !== 1
          || !row.saleEntries.some((e: any) => e.kind === 'RECEIPT' && e.amountCents === row.amountCents)) throw new ConflictException('当前订单不能退款');
        const eid = row.rights[0].id;
        await tx.$queryRaw(Prisma.sql`SELECT id FROM gift_card_entitlements WHERE id = ${eid} AND shop_id = ${sid} FOR UPDATE`);
        const right = await tx.giftCardEntitlement.findUnique({ where: { id: eid } });
        if (!right || right.orderId !== oid || right.source !== 'PURCHASE' || right.purchaseKey !== scopedKey('gift-purchase', id)
          || right.remainingUses !== right.totalUses || !['ACTIVE', 'EXPIRED'].includes(right.status)
          || await tx.giftCardRedemption.count({ where: { entitlementId: eid } })) throw new ConflictException('权益已使用或状态异常，不能整笔退款');
        await tx.giftCardEntitlement.update({ where: { id: eid }, data: { status: 'VOIDED', voidedAt: new Date(), voidedById: giftId(actor.id), voidReason: body.reason,
          tokenHash: unusableVoucherHash(), voucherExpiresAt: null, voucherUses: null } });
        await tx.giftCardOrder.update({ where: { id: oid }, data: { status: 'REFUNDED', refundedCents: row.amountCents } });
        await enqueueNotification(tx, { eventKey: `gift-order:${id}:refunded`, userId: row.userId, topic: 'GIFT_REFUNDED', resourceType: 'GIFT_ORDER', resourceId: id, data: { amountCents: row.amountCents, currency: row.currency } });
        await this.audit(tx, actor, sid, 'GIFT_SALE_REFUND', { orderId: id, entitlementId: eid, reasonRecorded: true });
      }
      await tx.giftCardSaleEntry.create({ data: { orderId: oid, operatorId: giftId(actor.id), kind, amountCents: body.amountCents,
        method: body.method, reference: body.reference, reason: body.reason, requestKey: key, requestHash } });
      const result = await tx.giftCardOrder.findUniqueOrThrow({ where: { id: oid }, include: ORDER });
      return { item: this.orderView(result, true), replayed: false };
    });
  }

  async entitlements(user: string, input: Record<string, unknown> = {}) {
    const query = giftObject(input, ['status', 'page', 'pageSize']); const page = giftPage(query);
    const where = { userId: giftId(user), ...this.filterStatus(query, CUSTOMER_ENTITLEMENT_STATUSES) };
    const db = this.prisma as any;
    const [rows, total] = await Promise.all([db.giftCardEntitlement.findMany({ where, include: { shop: { select: { ...SHOP.select, giftSalesPolicy: true } } }, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.giftCardEntitlement.count({ where })]);
    return this.page(rows.map((row: any) => this.entitlementView(row)), total, page);
  }
  async entitlement(user: string, id: string) {
    const row = await this.prisma.giftCardEntitlement.findFirst({ where: { id: entitlementId(id), userId: giftId(user) }, include: { shop: { select: { ...SHOP.select, giftSalesPolicy: true } } } });
    if (!row) throw new NotFoundException('权益不存在');
    return { item: this.entitlementView(row) };
  }
  async credential(actor: GiftActor, entitlement: string, input: Record<string, unknown>) {
    const body = giftObject(input, ['usedUses']), eid = entitlementId(entitlement), uid = giftId(actor.id);
    const usedUses = giftInteger(body.usedUses, 1, 10000, '本次使用次数');
    const discovery = await this.prisma.giftCardEntitlement.findFirst({ where: { id: eid, userId: uid }, select: { shopId: true } });
    if (!discovery) throw new NotFoundException('权益不存在');
    return this.write(discovery.shopId, async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM gift_card_entitlements WHERE id = ${eid} AND shop_id = ${discovery.shopId} FOR UPDATE`);
      const row = await tx.giftCardEntitlement.findFirst({ where: { id: eid, userId: uid } });
      if (!row) throw new NotFoundException('权益不存在');
      const now = new Date(); this.activeEntitlement(row, now);
      if (usedUses > row.remainingUses) throw new ConflictException('本次次数超过剩余次数');
      const token = newVoucher(), expiresAt = new Date(Math.min(now.getTime() + 300000, row.expiresAt.getTime()));
      await tx.giftCardEntitlement.update({ where: { id: eid }, data: { tokenHash: hash(token), voucherExpiresAt: expiresAt, voucherUses: usedUses } });
      // This is the only response containing the bearer credential. Creating a new
      // credential invalidates the previous one; list/detail never serialize it.
      return { entitlementId: eid, shopId: row.shopId.toString(), token, usedUses, expiresAt };
    });
  }
  async ownRedemptions(user: string, entitlement: string, input: Record<string, unknown> = {}) {
    const uid = giftId(user), eid = entitlementId(entitlement), query = giftObject(input, ['page', 'pageSize']); const page = giftPage(query);
    const db = this.prisma as any;
    const right = await db.giftCardEntitlement.findFirst({ where: { id: eid, userId: uid }, select: { id: true } });
    if (!right) throw new NotFoundException('权益不存在');
    const where = { entitlementId: eid, entitlement: { userId: uid } };
    const [rows, total] = await Promise.all([db.giftCardRedemption.findMany({ where, include: REDEMPTION, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.giftCardRedemption.count({ where })]);
    return this.page(rows.map((row: any) => this.redemptionView(row)), total, page);
  }
  async adminEntitlements(actor: GiftActor, shop: string, input: Record<string, unknown> = {}) {
    const sid = giftId(shop), query = giftObject(input, ['userId', 'status', 'entitlementId', 'page', 'pageSize']); const page = giftPage(query);
    await this.authorize(this.prisma, sid, actor);
    const where = { shopId: sid, ...(query.userId === undefined ? {} : { userId: giftId(query.userId, 'userId') }),
      ...(query.entitlementId === undefined ? {} : { id: entitlementId(query.entitlementId) }), ...this.filterStatus(query, CUSTOMER_ENTITLEMENT_STATUSES) };
    const db = this.prisma as any;
    const [rows, total] = await Promise.all([db.giftCardEntitlement.findMany({ where, include: { shop: SHOP }, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.giftCardEntitlement.count({ where })]);
    return { ...this.page(rows.map((row: any) => this.entitlementView(row)), total, page), shopId: shop, salesEnabled: true };
  }
  async redemptions(actor: GiftActor, shop: string, input: Record<string, unknown> = {}) {
    const sid = giftId(shop), query = giftObject(input, ['userId', 'entitlementId', 'page', 'pageSize']); const page = giftPage(query);
    await this.authorize(this.prisma, sid, actor);
    const where = { entitlement: { shopId: sid, ...(query.userId === undefined ? {} : { userId: giftId(query.userId, 'userId') }) },
      ...(query.entitlementId === undefined ? {} : { entitlementId: entitlementId(query.entitlementId) }) };
    const db = this.prisma as any;
    const [rows, total] = await Promise.all([db.giftCardRedemption.findMany({ where, include: REDEMPTION, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.giftCardRedemption.count({ where })]);
    return { ...this.page(rows.map((row: any) => this.redemptionView(row)), total, page), shopId: shop };
  }
  async grant(actor: GiftActor, shop: string, input: Record<string, unknown>) {
    const sid = giftId(shop), body = giftObject(input, ['productId', 'userId', 'reason', 'requestKey']);
    const pid = giftId(body.productId, 'productId'), uid = giftId(body.userId, 'userId'), reason = giftReason(body.reason), key = requestKey(body.requestKey);
    const grantKey = scopedKey('gift-grant-key', shop, actor.id, key), grantHash = scopedKey('gift-grant-request', pid.toString(), uid.toString(), reason);
    return this.write(sid, async tx => {
      await this.authorize(tx, sid, actor, true, true);
      const previous = await tx.giftCardEntitlement.findUnique({ where: { grantKey }, include: { shop: SHOP } });
      if (previous) {
        if (previous.grantHash !== grantHash || previous.shopId !== sid) throw new ConflictException('赠送请求键已用于不同内容');
        return { item: this.entitlementView(previous), promotional: true, saleRecorded: false };
      }
      const product = await tx.giftCardProduct.findFirst({ where: { id: pid, shopId: sid, status: 'ACTIVE' } });
      if (!product) throw new NotFoundException('本店产品不存在或未启用');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${uid} FOR UPDATE`);
      const recipient = await tx.user.findFirst({ where: { id: uid, role: 'CUSTOMER', status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!recipient) throw new BadRequestException('赠送对象必须为有效客户账号');
      const now = new Date(), totalUses = giftInteger(product.useTimes, 1, 10000, '总次数');
      const row = await tx.giftCardEntitlement.create({ data: { userId: uid, shopId: sid, productId: pid, orderId: null, source: 'PROMOTIONAL',
        productTitleSnapshot: product.title, totalUses, remainingUses: totalUses, expiresAt: giftExpiry(now, product.expireDays), status: 'ACTIVE',
        grantReason: reason, grantedById: giftId(actor.id), grantKey, grantHash, tokenHash: unusableVoucherHash() }, include: { shop: SHOP } });
      await this.audit(tx, actor, sid, 'GIFT_PROMOTIONAL_GRANT', { entitlementId: row.id, reasonRecorded: true });
      await enqueueNotification(tx, { eventKey: `gift:${row.id}:granted`, userId: uid, topic: 'GIFT_GRANTED', resourceType: 'GIFT_ENTITLEMENT', resourceId: row.id });
      return { item: this.entitlementView(row), promotional: true, saleRecorded: false };
    });
  }
  async redeem(actor: GiftActor, shop: string, input: Record<string, unknown>) {
    const sid = giftId(shop), body = giftObject(input, ['token', 'usedUses', 'requestKey']);
    const tokenHash = voucherHash(body.token), usedUses = giftInteger(body.usedUses, 1, 10000, '本次使用次数'), key = requestKey(body.requestKey);
    const idempotencyKey = scopedKey('gift-redeem-key', shop, actor.id, key), requestHash = scopedKey('gift-redeem-request', tokenHash, String(usedUses));
    return this.write(sid, async tx => {
      // Existing issued rights are fulfillment, not a new sale/grant. Authorized
      // active operators may redeem after publication is paused; ownership,
      // credential, expiry and exact-use checks remain authoritative below.
      await this.authorize(tx, sid, actor, false, true);
      const previous = await tx.giftCardRedemption.findUnique({ where: { idempotencyKey }, include: REDEMPTION });
      if (previous) {
        if (previous.requestHash !== requestHash || previous.shopId !== sid || previous.operatorId !== giftId(actor.id)) throw new ConflictException('核销请求键已用于不同内容');
        return { item: this.redemptionView(previous), replayed: true };
      }
      // Discovery is constrained to this authorized shop. The UUID row is then
      // locked and reread, so credential replacement cannot race consumption.
      const discovery = await tx.giftCardEntitlement.findFirst({ where: { shopId: sid, tokenHash }, select: { id: true } });
      if (!discovery) throw new NotFoundException('凭证无效、已使用或不属于本店');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM gift_card_entitlements WHERE id = ${discovery.id} AND shop_id = ${sid} FOR UPDATE`);
      const row = await tx.giftCardEntitlement.findFirst({ where: { id: discovery.id, shopId: sid, tokenHash } });
      if (!row) throw new ConflictException('凭证已更新，请客户重新出示');
      const now = new Date(); this.activeEntitlement(row, now);
      if (!row.voucherExpiresAt || row.voucherExpiresAt <= now || row.voucherUses !== usedUses) throw new ConflictException('凭证已过期或本次次数与客户确认不一致');
      if (usedUses > row.remainingUses) throw new ConflictException('剩余次数不足');
      const consumed = await tx.giftCardEntitlement.updateMany({ where: { id: row.id, shopId: sid, status: 'ACTIVE', tokenHash, voucherExpiresAt: { gt: now }, voucherUses: usedUses, remainingUses: { gte: usedUses }, expiresAt: { gt: now } },
        data: { remainingUses: { decrement: usedUses }, status: row.remainingUses === usedUses ? 'EXHAUSTED' : 'ACTIVE', tokenHash: unusableVoucherHash(), voucherExpiresAt: null, voucherUses: null } });
      if (consumed.count !== 1) throw new ConflictException('权益状态已变化，请重新核对');
      const redemption = await tx.giftCardRedemption.create({ data: { entitlementId: row.id, shopId: sid, operatorId: giftId(actor.id), idempotencyKey, requestHash, usedUses }, include: REDEMPTION });
      await this.audit(tx, actor, sid, 'GIFT_REDEEM', { entitlementId: row.id, usedUses });
      await enqueueNotification(tx, { eventKey: `gift-redemption:${redemption.id}`, userId: row.userId, topic: 'GIFT_REDEEMED', resourceType: 'GIFT_ENTITLEMENT', resourceId: row.id });
      return { item: this.redemptionView(redemption), replayed: false, remainingUses: row.remainingUses - usedUses };
    });
  }
  async void(actor: GiftActor, shop: string, entitlement: string, input: Record<string, unknown>) {
    const sid = giftId(shop), eid = entitlementId(entitlement), body = giftObject(input, ['reason']), reason = giftReason(body.reason);
    return this.write(sid, async tx => {
      await this.authorize(tx, sid, actor, false, true);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM gift_card_entitlements WHERE id = ${eid} AND shop_id = ${sid} FOR UPDATE`);
      const row = await tx.giftCardEntitlement.findFirst({ where: { id: eid, shopId: sid }, include: { shop: SHOP } });
      if (!row) throw new NotFoundException('本店权益不存在');
      if (row.source !== 'PROMOTIONAL' || row.orderId) throw new ConflictException('只能作废免费赠送权益，已售权益须走退款流程');
      if (row.status === 'VOIDED') {
        if (row.voidReason !== reason) throw new ConflictException('权益已作废，不能修改原因');
        return { item: this.entitlementView(row) };
      }
      if (row.remainingUses !== row.totalUses || await tx.giftCardRedemption.count({ where: { entitlementId: eid } })) throw new ConflictException('已经使用的权益不可作废');
      if (!['ACTIVE', 'EXPIRED'].includes(row.status)) throw new ConflictException('当前权益不能作废');
      const updated = await tx.giftCardEntitlement.update({ where: { id: eid }, data: { status: 'VOIDED', voidReason: reason, voidedById: giftId(actor.id), voidedAt: new Date(), tokenHash: unusableVoucherHash(), voucherExpiresAt: null, voucherUses: null }, include: { shop: SHOP } });
      await this.audit(tx, actor, sid, 'GIFT_PROMOTIONAL_VOID', { entitlementId: eid, reasonRecorded: true });
      await enqueueNotification(tx, { eventKey: `gift:${eid}:voided`, userId: row.userId, topic: 'GIFT_VOIDED', resourceType: 'GIFT_ENTITLEMENT', resourceId: eid });
      return { item: this.entitlementView(updated) };
    });
  }
}
