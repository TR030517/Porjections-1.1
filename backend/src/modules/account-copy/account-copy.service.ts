import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requireShopAccess, ShopActor, shopAccessId, shopAccessWhere } from '../../common/shop-access';
import { jwtSecret } from '../auth/security';
import { normalizeHours } from '../booking/hours';
import { ensureShopConfiguration } from '../reservations/configuration-guard';
import type { CopyApplyDto, CopyHistoryQueryDto, CopyPreviewDto } from './account-copy.controller';
import { storedStudioProfile } from '../../common/shop-studio-profile';
import { shopMediaUrls, syncShopMedia } from '../../common/managed-media';
import { loadAddOnCopyPlan, type AddOnCopyPlanRow } from './addon-copy-plan';
import { serviceAddOnInput } from '../reservations/service-addons';
import { readDurationKind } from '../../common/service-duration';
import { resolvePriceMenu } from '../../common/shop-price-menu-catalog';
import { isRetryableTransactionError } from '../../common/transaction-retry';
import { applyMenuCopyPlan, loadMenuCopyCatalog, planMenuCopy } from './menu-copy-plan';

const SERVICE_FIELDS = ['name', 'nameEn', 'category', 'durationMin', 'durationKind', 'priceCents', 'priceBasis', 'participantCount', 'requiredStaffCount', 'requiredRoomType', 'staffBufferMin', 'roomBufferMin', 'description', 'sortOrder'] as const;
const VARIANT_FIELDS = ['name', 'durationMin', 'priceCents', 'priceBasis', 'currency', 'sortOrder'] as const;
function pick(row: any, keys: readonly string[]) { return Object.fromEntries(keys.map(key => [key, row[key]])); }
function stable(value: any): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function digest(value: any) { return createHash('sha256').update(stable(value)).digest('hex'); }
function serviceKey(row: any) { return stable([row.name.normalize('NFKC').trim().toLowerCase(), row.category, row.priceBasis, row.participantCount, readDurationKind(row.durationKind)]); }

@Injectable()
export class AccountCopyService {
  constructor(private readonly prisma: PrismaService) {}
  private ids(body: CopyPreviewDto) {
    const source = shopAccessId(body.sourceShopId), target = shopAccessId(body.targetShopId);
    if (source === target || !['HOURS', 'CATALOG', 'PRICE_MENU', 'ADD_ONS'].includes(body.kind)) throw new BadRequestException('请选择不同的来源与目标门店，以及允许复制的配置');
    return { source, target };
  }
  private sign(value: any) {
    const payload = Buffer.from(stable(value)).toString('base64url');
    return payload + '.' + createHmac('sha256', jwtSecret()).update('shop-config-copy:' + payload).digest('base64url');
  }
  private verify(token: string, actor: ShopActor, body: CopyPreviewDto): any {
    if (typeof token !== 'string' || token.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(token)) throw new BadRequestException('无效的复制预览');
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', jwtSecret()).update('shop-config-copy:' + payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new BadRequestException('复制预览校验失败');
    let value: any;
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new BadRequestException('无效的复制预览'); }
    if (value.actor !== actor.id || value.source !== body.sourceShopId || value.target !== body.targetShopId || value.kind !== body.kind || !Number.isSafeInteger(value.expires) || typeof value.digest !== 'string') throw new BadRequestException('预览与当前账号或门店不匹配');
    return value;
  }
  private async transaction<T>(body: CopyPreviewDto, work: (tx: any) => Promise<T>): Promise<T> {
    const { source, target } = this.ids(body);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          for (const id of [source, target].sort((a, b) => a < b ? -1 : 1)) await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${id} FOR UPDATE`);
          return work(tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
      } catch (error) {
        if (!isRetryableTransactionError(error)) throw error;
        if (attempt === 2) throw new ServiceUnavailableException('复制配置发生并发冲突，请保留请求键稍后重试');
      }
    }
    throw new ServiceUnavailableException('请稍后重试');
  }

  private async authorize(tx: any, actor: ShopActor, body: CopyPreviewDto, write = true) {
    const { source, target } = this.ids(body);
    if (body.kind === 'ADD_ONS' || body.kind === 'PRICE_MENU') {
      let a: any, b: any;
      for (const [label, shopId] of [['source', source], ['target', target]] as const) {
        await requireShopAccess(tx, shopId, actor, 'COPY_CONFIG', { write });
        await requireShopAccess(tx, shopId, actor, 'CATALOG_MANAGE', { write });
        const result = await requireShopAccess(tx, shopId, actor, 'RESERVATION_CONFIG', { write });
        if (label === 'source') a = result; else b = result;
      }
      return { source: a.shop, target: b.shop };
    }
    const permission = body.kind === 'CATALOG' ? 'CATALOG_MANAGE' : body.kind === 'HOURS' ? null : 'SHOP_SETTINGS_MANAGE';
    // A unified menu writes catalog/resource rules as well as presentation.
    await requireShopAccess(tx, source, actor, 'COPY_CONFIG', { write });
    const a = permission ? await requireShopAccess(tx, source, actor, permission, { write }) : await requireShopAccess(tx, source, actor, 'COPY_CONFIG', { write });
    await requireShopAccess(tx, target, actor, 'COPY_CONFIG', { write });
    const b = permission ? await requireShopAccess(tx, target, actor, permission, { write }) : await requireShopAccess(tx, target, actor, 'COPY_CONFIG', { write });
    return { source: a.shop, target: b.shop };
  }
  private async snapshot(tx: any, actor: ShopActor, body: CopyPreviewDto): Promise<any> {
    const shops = await this.authorize(tx, actor, body);
    if (body.kind === 'ADD_ONS') {
      const { rows, ...snapshot } = await loadAddOnCopyPlan(tx, shops.source.id, shops.target.id);
      return { ...shops, changes: { addOns: rows }, fingerprint: digest({ kind: 'ADD_ONS', ...snapshot }),
        summary: '仅向精确匹配的目标主服务新增停用附加项目；歧义、重复和容量冲突跳过。原配置、主服务、规格、营业资料、账户、预约快照与资金保持。' };
    }
    if (body.kind === 'HOURS') {
      const hours = normalizeHours(shops.source.businessHours);
      return { ...shops, hours, fingerprint: digest({ kind: body.kind, source: [shops.source.timezone, shops.source.businessHours], target: [shops.target.timezone, shops.target.businessHours] }),
        summary: '仅覆盖目标店营业时段，按目标店本地时间解释；地址、电话和时区保持目标店原值。', changes: { hours: { from: shops.target.businessHours, to: hours } } };
    }
    if (body.kind === 'PRICE_MENU') {
      let sourceProfile: Record<string, any>, targetProfile: Record<string, any>;
      try { sourceProfile = storedStudioProfile(shops.source.studioProfile); targetProfile = storedStudioProfile(shops.target.studioProfile); }
      catch { throw new ConflictException('门店扩展资料格式异常，请由公司修复后再复制'); }
      const sourceCatalog = await loadMenuCopyCatalog(tx, shops.source.id), targetCatalog = await loadMenuCopyCatalog(tx, shops.target.id);
      const menuPlan = planMenuCopy(sourceProfile.priceMenu, sourceCatalog, targetCatalog, shops.source.id, shops.target.id);
      // Preview uses explicit mapping rows. Source IDs never masquerade as target booking links.
      const priceMenu = menuPlan.menu.map(group => ({ ...group, items: group.items.map(item => {
        const { booking: _booking, bookingEnabled: _enabled, bookingMode: _mode, reservedDurationMin: _duration, ...wording } = item; return wording;
      }) }));
      return { ...shops, targetProfile, priceMenu, menuPlan, omittedManagedImages: menuPlan.omittedManagedImages,
        fingerprint: digest({ version: 2, kind: body.kind, source: sourceProfile.priceMenu ?? null, target: targetProfile.priceMenu ?? null, sourceCatalog, targetCatalog }),
        summary: '统一复制项目与价目，并建立目标服务、规格与附加项目关联；完全匹配的目标配置复用，新建配置全部停用。名称歧义或价格、资源规则冲突须先整理。目标原项目与订单保留，不开启在线预约或账号；来源专属图片须重新上传。',
        changes: { priceMenu: { from: resolvePriceMenu(targetProfile.priceMenu, targetCatalog, shops.target.id), to: priceMenu, omittedManagedImages: menuPlan.omittedManagedImages, catalogLinks: menuPlan.links } } };
    }
    const serviceSelect = Object.fromEntries(['id', 'isActive', ...SERVICE_FIELDS].map(key => [key, true]));
    const variantSelect = Object.fromEntries(['id', 'isActive', ...VARIANT_FIELDS].map(key => [key, true]));
    const load = (shopId: bigint) => tx.shopService.findMany({ where: { shopId }, orderBy: { id: 'asc' }, take: 501,
      select: { ...serviceSelect, variants: { orderBy: { id: 'asc' }, take: 101, select: variantSelect } } });
    const normalize = (rows: any[]) => rows.map(row => ({ ...row, durationKind: readDurationKind(row.durationKind) }));
    const sourceRows: any[] = normalize(await load(shops.source.id)), targetRows: any[] = normalize(await load(shops.target.id));
    if (sourceRows.length > 500 || targetRows.length > 500 || [...sourceRows, ...targetRows].some(row => row.variants.length > 100) || [...sourceRows, ...targetRows].reduce((n, row) => n + row.variants.length, 0) > 2000) throw new BadRequestException('单次复制目录过大，请联系公司分批处理');
    if (sourceRows.some(row => row.variants.some((v: any) => v.currency !== 'usd'))) throw new BadRequestException('当前价目复制仅支持USD，不自动换汇');
    const existing = new Set(targetRows.map(serviceKey));
    const changes = sourceRows.map((row: any) => {
      const key = serviceKey(row), skip = existing.has(key); existing.add(key);
      return { sourceId: row.id.toString(), name: row.name, durationKind: row.durationKind, action: skip ? 'SKIP' : 'CREATE', reason: skip ? '目标已有同名、类型、类别及人数口径的服务，保留目标配置' : '新建同类型停用服务与规格，核对本店技师和资源后再启用' };
    });
    return { ...shops, sourceRows, changes: { services: changes }, fingerprint: digest({ kind: body.kind, sourceRows, targetRows }),
      summary: '新增服务与规格均为停用配置，同名冲突跳过；先复制主目录，再单独使用附加项目复制，不复用其编号；不复制技师、房间、排班、媒体、地址、电话、支付或订单。' };
  }
  preview(actor: ShopActor, body: CopyPreviewDto) {
    return this.transaction(body, async tx => {
      const data = await this.snapshot(tx, actor, body), expires = Date.now() + 5 * 60 * 1000;
      return { previewHash: this.sign({ actor: actor.id, source: body.sourceShopId, target: body.targetShopId, kind: body.kind, digest: data.fingerprint, expires }), expiresAt: new Date(expires).toISOString(), summary: data.summary, changes: data.changes };
    });
  }
  private request(actor: ShopActor, body: CopyApplyDto) {
    if (!/^[A-Za-z0-9:_-]{8,100}$/.test(body.idempotencyKey)) throw new BadRequestException('无效的请求键');
    const signed = this.verify(body.previewHash, actor, body);
    const requestHash = digest({ source: body.sourceShopId, target: body.targetShopId, kind: body.kind, previewDigest: signed.digest });
    return { signed, requestHash };
  }
  private receipt(row: any) {
    const value = row.result;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.operationId !== row.id || value.status !== 'APPLIED' || value.kind !== row.kind
      || !['HOURS','CATALOG','PRICE_MENU','ADD_ONS'].includes(row.kind) || value.sourceShopId !== String(row.sourceShopId) || value.targetShopId !== String(row.targetShopId)
      || !Number.isSafeInteger(value.created) || value.created < 0 || value.created > (row.kind === 'PRICE_MENU' ? 1000 : 500)
      || !Number.isSafeInteger(value.skipped) || value.skipped < 0 || value.skipped > 500) throw new ServiceUnavailableException('复制记录需由公司核对，暂不展示未经核实的结果');
    if (row.kind === 'PRICE_MENU' && (!Number.isSafeInteger(value.groups) || value.groups < 0 || value.groups > 100
      || !Number.isSafeInteger(value.omittedManagedImages) || value.omittedManagedImages < 0 || value.omittedManagedImages > value.created || value.skipped !== 0)) throw new ServiceUnavailableException('展示价目复制记录需由公司核对');
    if (row.kind === 'ADD_ONS' && (value.created + value.skipped > 500 || Object.keys(value).length !== 7
      || Object.keys(value).some(key => !['operationId','status','kind','created','skipped','sourceShopId','targetShopId'].includes(key)))) throw new ServiceUnavailableException('附加项目复制记录需由公司核对');
    return { operationId: row.id, status: 'APPLIED' as const, kind: row.kind as 'HOURS'|'CATALOG'|'PRICE_MENU'|'ADD_ONS', created: value.created,
      skipped: value.skipped, sourceShopId: String(row.sourceShopId), targetShopId: String(row.targetShopId),
      ...(row.kind === 'PRICE_MENU' ? { groups: value.groups, omittedManagedImages: value.omittedManagedImages } : {}) };
  }
  resolve(actor: ShopActor, body: CopyApplyDto) {
    const { signed, requestHash } = this.request(actor, body);
    return this.transaction(body, async tx => {
      await this.authorize(tx, actor, body);
      const previous = await tx.copyConfigOperation.findUnique({ where: { actorId_idempotencyKey: { actorId: shopAccessId(actor.id), idempotencyKey: body.idempotencyKey } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException('请求键已用于另一份复制配置');
        return this.receipt(previous);
      }
      if (signed.expires > Date.now() + 5 * 60 * 1000) throw new BadRequestException('复制预览时效不正确');
      // These are the same shop mutexes used by apply. An earlier admitted copy
      // must commit/roll back before this read. A later use of this exact signed
      // preview must check its expiry after acquiring these locks, so once it is
      // expired and absent it cannot subsequently execute. Absence before expiry
      // deliberately remains UNKNOWN rather than asserting a failed operation.
      const expired = signed.expires < Date.now();
      return { status: expired ? 'NOT_APPLIED' as const : 'UNKNOWN' as const, sourceShopId: body.sourceShopId,
        targetShopId: body.targetShopId, kind: body.kind, idempotencyKey: body.idempotencyKey,
        reason: expired ? 'COPY_PREVIEW_EXPIRED_WITHOUT_EXECUTION' : 'COPY_REQUEST_STILL_UNCONFIRMED' };
    });
  }
  async history(actor: ShopActor, query: CopyHistoryQueryDto = {}) {
    const positive = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value) || Number(value) > max) throw new BadRequestException('复制记录分页参数无效');
      return Number(value);
    };
    const page = positive(query.page, 1, 9999), limit = positive(query.limit, 20, 50), actorId = shopAccessId(actor?.id);
    if (!actor || !['ADMIN','MERCHANT'].includes(actor.role)) throw new ForbiddenException('没有复制记录访问权限');
    return this.prisma.$transaction(async (tx: any) => {
      const operator = await tx.user.findFirst({ where: { id: actorId, role: actor.role, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!operator) throw new ForbiddenException('操作账户不可用');
      const scoped = async (permission: 'SHOP_SETTINGS_MANAGE'|'CATALOG_MANAGE'|null) => tx.shop.findMany({
        where: permission ? { AND: [shopAccessWhere(actor, 'COPY_CONFIG'), shopAccessWhere(actor, permission)] } : shopAccessWhere(actor, 'COPY_CONFIG'), select: { id: true, name: true } });
      const hours: any[] = await scoped(null), catalog: any[] = await scoped('CATALOG_MANAGE');
      const addOns: any[] = await tx.shop.findMany({ where: { AND: [shopAccessWhere(actor, 'COPY_CONFIG'), shopAccessWhere(actor, 'CATALOG_MANAGE'), shopAccessWhere(actor, 'RESERVATION_CONFIG')] }, select: { id: true, name: true } });
      const ids = (shops: any[]) => shops.map(shop => shop.id);
      const where = { actorId, OR: [
        { kind: 'HOURS', sourceShopId: { in: ids(hours) }, targetShopId: { in: ids(hours) } },
        { kind: 'PRICE_MENU', sourceShopId: { in: ids(addOns) }, targetShopId: { in: ids(addOns) } },
        { kind: 'CATALOG', sourceShopId: { in: ids(catalog) }, targetShopId: { in: ids(catalog) } },
        { kind: 'ADD_ONS', sourceShopId: { in: ids(addOns) }, targetShopId: { in: ids(addOns) } },
      ] };
      const total: number = await tx.copyConfigOperation.count({ where });
      const rows: any[] = await tx.copyConfigOperation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit, take: limit, select: { id: true, sourceShopId: true, targetShopId: true, kind: true, createdAt: true, result: true } });
      const names = new Map([...hours, ...catalog, ...addOns].map(shop => [String(shop.id), shop.name]));
      const items = [];
      for (const row of rows) {
        // Recheck actual permissions before any receipt is returned, including
        // malformed grants that a JSON read predicate alone cannot authorize.
        await this.authorize(tx, actor, { sourceShopId: String(row.sourceShopId), targetShopId: String(row.targetShopId), kind: row.kind }, false);
        items.push({ ...this.receipt(row), createdAt: row.createdAt.toISOString(),
          sourceShopName: names.get(String(row.sourceShopId)) ?? '', targetShopName: names.get(String(row.targetShopId)) ?? '' });
      }
      return { items, total, page, limit };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 });
  }
  apply(actor: ShopActor, body: CopyApplyDto) {
    const { signed, requestHash } = this.request(actor, body);
    return this.transaction(body, async tx => {
      await this.authorize(tx, actor, body);
      const previous = await tx.copyConfigOperation.findUnique({ where: { actorId_idempotencyKey: { actorId: shopAccessId(actor.id), idempotencyKey: body.idempotencyKey } } });
      if (previous) { if (previous.requestHash !== requestHash) throw new ConflictException('请求键已用于另一份复制配置'); return this.receipt(previous); }
      if (signed.expires < Date.now() || signed.expires > Date.now() + 5 * 60 * 1000) throw new ConflictException('预览已过期，请重新预览');
      let data: any;
      try { data = await this.snapshot(tx, actor, body); }
      catch (error) {
        if ((body.kind === 'ADD_ONS' || body.kind === 'PRICE_MENU') && error instanceof BadRequestException) throw new ConflictException('来源或目标配置已变化或超出边界，请重新整理并预览');
        throw error;
      }
      if (data.fingerprint !== signed.digest) throw new ConflictException('来源或目标配置已变化，请重新预览');
      let created = 0, skipped = 0;
      if (body.kind === 'HOURS') {
        await ensureShopConfiguration(tx, data.target, { businessHours: data.hours });
        await tx.shop.update({ where: { id: data.target.id }, data: { businessHours: data.hours } });
      } else if (body.kind === 'PRICE_MENU') {
        const priceMenu = await applyMenuCopyPlan(tx, data.target.id, data.menuPlan);
        const studioProfile = { ...data.targetProfile, priceMenu };
        await syncShopMedia(tx, { shopId: data.target.id, actor, previousUrls: shopMediaUrls(data.targetProfile), nextUrls: shopMediaUrls(studioProfile), purpose: 'MENU', copyWorkflow: true, previousProfile: data.targetProfile, nextProfile: studioProfile });
        await tx.shop.update({ where: { id: data.target.id }, data: { studioProfile } });
        created = data.priceMenu.reduce((count: number, group: any) => count + group.items.length, 0);
      } else if (body.kind === 'ADD_ONS') {
        for (const row of data.changes.addOns as AddOnCopyPlanRow[]) {
          if (row.action === 'SKIP') { skipped++; continue; }
          const values = serviceAddOnInput({ name: row.name, description: row.description, priceCents: row.priceCents, currency: row.currency, sortOrder: row.sortOrder, isActive: false });
          await tx.shopServiceAddOn.create({ data: { ...values, serviceId: shopAccessId(row.targetServiceId!) } }); created++;
        }
      } else {
        const rows = data.sourceRows!;
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          if (data.changes.services![index].action === 'SKIP') { skipped++; continue; }
          const service = await tx.shopService.create({ data: { ...pick(row, SERVICE_FIELDS), shopId: data.target.id, isActive: false } });
          for (const variant of row.variants) await tx.shopServiceVariant.create({ data: { ...pick(variant, VARIANT_FIELDS), serviceId: service.id, isActive: false } });
          created++;
        }
      }
      const operationId = randomUUID(), result = { operationId, status: 'APPLIED', kind: body.kind, created, skipped, sourceShopId: body.sourceShopId, targetShopId: body.targetShopId,
        ...(body.kind === 'PRICE_MENU' ? { groups: data.priceMenu.length, omittedManagedImages: data.omittedManagedImages } : {}) };
      await tx.copyConfigOperation.create({ data: { id: operationId, actorId: shopAccessId(actor.id), sourceShopId: data.source.id, targetShopId: data.target.id, kind: body.kind, idempotencyKey: body.idempotencyKey, requestHash, result } });
      await tx.auditLog.create({ data: { operatorId: shopAccessId(actor.id), action: 'SHOP_CONFIG_COPIED', targetType: 'SHOP', targetId: data.target.id,
        detail: { operationId, sourceShopId: body.sourceShopId, kind: body.kind, fields: body.kind === 'HOURS' ? ['businessHours'] : body.kind === 'PRICE_MENU' ? ['priceMenu', 'services', 'variants', 'addOns'] : body.kind === 'ADD_ONS' ? ['addOns'] : ['services', 'variants'], created, skipped } } });
      return result;
    });
  }
}
