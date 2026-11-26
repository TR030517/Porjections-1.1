import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { jwtSecret } from '../auth/security';
import type { CatalogActor, CatalogPreview, CatalogPreviewGroup, CatalogReceipt, CatalogResult, CatalogTerminal, ParsedCatalog } from './catalog-import.contract';
import { catalogDigest, catalogError, catalogId, catalogKey, catalogRecord, catalogRequestKey, catalogStable, parseCatalog } from './catalog-import.parser';
import { readDurationKind } from '../../common/service-duration';

const ACTION = 'CATALOG_IMPORT_APPLY', TARGET = 'CATALOG_IMPORT';
const PREVIEW_DOMAIN = 'catalog-import-preview:v1:', REQUEST_DOMAIN = 'catalog-import-request:v1:';
const PREVIEW_TTL = 15 * 60000;
interface PreviewClaim { version: 1; actor: string; shopId: string; packageDigest: string; snapshotDigest: string; expires: number; }
const conflict = (code: string, message: string): never => { throw new ConflictException({ message, catalogImportCode: code }); };
const digestValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validName = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
const unavailable = (): never => { throw new ServiceUnavailableException('价目导入收据暂不可用，请保留请求键并由公司核对'); };

/** Only append new disabled services with disabled variants. Existing service
 * groups, resources, historical bookings, shop identity and money are untouched. */
@Injectable()
export class CatalogImportService {
  constructor(private readonly prisma: PrismaService) {}

  private actorId(actor: CatalogActor) {
    if (!actor || actor.role !== 'ADMIN' || !catalogId(actor.id)) throw new ForbiddenException('仅公司管理员可批量录入价目');
    return BigInt(actor.id);
  }
  private async authorize(db: any, actor: CatalogActor) {
    const id = this.actorId(actor);
    if (!await db.user.findFirst({ where: { id, role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, select: { id: true } })) {
      throw new ForbiddenException('管理员账户不可用');
    }
    return id;
  }
  private shopId(value: unknown): string {
    if (!catalogId(value)) catalogError('SHOP_ID_INVALID', '请选择有效门店');
    return value;
  }
  /** Retry only database-aborted transactions, never ambiguous transport or
   * timeout errors where committing a second request could duplicate changes. */
  private async transaction<T>(work: (tx: any) => Promise<T>, readOnly = false): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: readOnly ? Prisma.TransactionIsolationLevel.RepeatableRead : Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10000, timeout: 30000,
        });
      } catch (error: any) {
        const retryable = error?.code === 'P2034' || error?.code === 'P2010' && ['1213', '1205'].includes(String(error?.meta?.code));
        if (!retryable) throw error;
        if (attempt === 2) throw new ServiceUnavailableException('价目配置写入冲突，请保留原请求键并先核对结果');
      }
    }
    throw new ServiceUnavailableException('价目导入暂不可用，请保留原请求键');
  }
  private async snapshot(db: any, shopId: string) {
    const shop = await db.shop.findUnique({ where: { id: BigInt(shopId) }, select: { id: true, name: true, shortName: true, status: true, deletedAt: true } });
    if (!shop || shop.deletedAt) throw new NotFoundException('门店不存在或已删除');
    const baseServices = await db.shopService.findMany({ where: { shopId: BigInt(shopId) }, orderBy: { id: 'asc' }, take: 501 });
    if (baseServices.length > 500) catalogError('CATALOG_TOO_LARGE', '现有价目超过500项服务，请先由公司整理后再导入');
    const variants = await db.shopServiceVariant.findMany({ where: { service: { shopId: BigInt(shopId) } }, orderBy: { id: 'asc' }, take: 2001 });
    if (variants.length > 2000) {
      catalogError('CATALOG_TOO_LARGE', '现有价目超过500项服务或2000项规格，请先由公司整理后再导入');
    }
    const services = baseServices.map((service: any) => ({ ...service, variants: variants.filter((variant: any) => variant.serviceId === service.id) }));
    // Entire service/variant rows include inactive configurations, prices,
    // currencies, policy and names; no bookings/authentication enter the digest.
    return { shop, services, digest: catalogDigest({ shop, services }) };
  }
  private groups(parsed: ParsedCatalog, services: any[]): CatalogPreviewGroup[] {
    const existing = new Map<string, string[]>();
    for (const service of services) {
      if (readDurationKind(service.durationKind) !== 'TIMED') continue;
      const key = catalogKey(service.name, service.category), ids = existing.get(key) ?? [];
      ids.push(String(service.id)); existing.set(key, ids);
    }
    return parsed.groups.map(group => {
      const existingIds = existing.get(group.key) ?? [];
      return { ...group, action: existingIds.length ? 'SKIP' : 'CREATE', existingIds,
        reason: existingIds.length ? '门店已有同名同类项目，整组保留，不追加或覆盖任何规格' : '新增服务及全部时长规格，保持停用，启用前请核对并配置技师' };
    });
  }
  private sign(value: PreviewClaim) {
    const payload = Buffer.from(catalogStable(value)).toString('base64url');
    return payload + '.' + createHmac('sha256', jwtSecret()).update(PREVIEW_DOMAIN + payload).digest('base64url');
  }
  private verify(token: unknown, actor: CatalogActor, parsed: ParsedCatalog): PreviewClaim {
    if (typeof token !== 'string' || token.length > 4096 || !/^[\w-]+\.[\w-]+$/.test(token)) catalogError('PREVIEW_INVALID', '请先生成有效的价目预览');
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', jwtSecret()).update(PREVIEW_DOMAIN + payload).digest(), actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) catalogError('PREVIEW_INVALID', '价目预览校验失败，请重新预览');
    let claim: any;
    try { claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { catalogError('PREVIEW_INVALID', '价目预览无效'); }
    if (!catalogRecord(claim) || claim.version !== 1 || claim.actor !== actor.id || claim.shopId !== parsed.shopId
      || claim.packageDigest !== parsed.packageDigest || !digestValid(claim.snapshotDigest) || !Number.isSafeInteger(claim.expires)
      || claim.expires > Date.now() + PREVIEW_TTL + 1000) catalogError('PREVIEW_MISMATCH', '预览与当前账号、门店或价目资料不匹配');
    return claim as PreviewClaim;
  }
  async preview(actor: CatalogActor, shopId: unknown, input: unknown): Promise<CatalogPreview> {
    this.actorId(actor);
    const parsed = parseCatalog(shopId, input);
    return this.transaction(async tx => {
      await this.authorize(tx, actor);
      const snapshot = await this.snapshot(tx, parsed.shopId), groups = this.groups(parsed, snapshot.services);
      const fresh = groups.filter(group => group.action === 'CREATE'), canApply = fresh.length > 0, expires = Date.now() + PREVIEW_TTL;
      return { shop: { id: parsed.shopId, name: snapshot.shop.name }, currency: 'USD', packageDigest: parsed.packageDigest, canApply,
        previewToken: canApply ? this.sign({ version: 1, actor: actor.id, shopId: parsed.shopId, packageDigest: parsed.packageDigest, snapshotDigest: snapshot.digest, expires }) : null,
        expiresAt: canApply ? new Date(expires).toISOString() : null,
        summary: { inputRows: parsed.inputRows, groups: groups.length, newServices: fresh.length,
          newVariants: fresh.reduce((sum, group) => sum + group.variants.length, 0), skippedServices: groups.length - fresh.length, duplicateRows: parsed.duplicateRows }, groups };
    }, true);
  }
  private requestHash(actor: CatalogActor, key: unknown) {
    if (!catalogRequestKey(key)) catalogError('REQUEST_KEY_INVALID', '请保留8至100位有效请求键');
    return createHmac('sha256', jwtSecret()).update(REQUEST_DOMAIN + actor.id + ':' + key).digest('hex');
  }
  private async prior(db: any, actor: CatalogActor, hash: string) {
    const rows = await db.auditLog.findMany({ where: { operatorId: this.actorId(actor), action: ACTION, targetType: TARGET, targetId: this.actorId(actor),
      detail: { path: '$.requestKeyHash', equals: hash } }, orderBy: { id: 'desc' }, take: 2, select: { detail: true } });
    if (rows.length > 1) unavailable();
    return rows[0]?.detail ?? null;
  }
  private receipt(detail: any, key: string): CatalogReceipt {
    const r = detail?.receipt;
    if (!catalogRecord(r) || r.status !== 'APPLIED' || typeof r.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.operationId)
      || !validDate(r.appliedAt) || !digestValid(r.packageDigest) || !catalogId(r.shopId) || !catalogRecord(r.summary)
      || !Array.isArray(r.created) || !r.created.length || r.created.length > 50 || !Array.isArray(r.skipped) || r.created.length + r.skipped.length > 50
      || !['createdServices', 'createdVariants', 'skippedServices'].every(k => Number.isSafeInteger(r.summary[k]) && r.summary[k] >= 0 && r.summary[k] <= 100)
      || r.created.some((row: any) => !catalogRecord(row) || !catalogId(row.serviceId) || !validName(row.name) || !Array.isArray(row.variantIds)
        || !row.variantIds.length || row.variantIds.length > 10 || row.variantIds.some((id: any) => !catalogId(id)) || new Set(row.variantIds).size !== row.variantIds.length)
      || r.skipped.some((row: any) => !catalogRecord(row) || !validName(row.name) || !Array.isArray(row.existingIds) || !row.existingIds.length
        || row.existingIds.length > 500 || row.existingIds.some((id: any) => !catalogId(id)) || new Set(row.existingIds).size !== row.existingIds.length)
      || new Set(r.created.map((row: any) => row.serviceId)).size !== r.created.length
      || new Set(r.created.flatMap((row: any) => row.variantIds)).size !== r.created.reduce((sum: number, row: any) => sum + row.variantIds.length, 0)
      || r.summary.createdServices !== r.created.length || r.summary.skippedServices !== r.skipped.length
      || r.summary.createdVariants !== r.created.reduce((sum: number, row: any) => sum + row.variantIds.length, 0)
      || detail.version !== 1 || detail.shopId !== r.shopId || detail.packageDigest !== r.packageDigest) unavailable();
    return { operationId: r.operationId, requestKey: key, packageDigest: r.packageDigest, shopId: r.shopId, appliedAt: r.appliedAt,
      summary: { createdServices: r.summary.createdServices, createdVariants: r.summary.createdVariants, skippedServices: r.summary.skippedServices },
      created: r.created.map((row: any) => ({ serviceId: row.serviceId, name: row.name, variantIds: [...row.variantIds] })),
      skipped: r.skipped.map((row: any) => ({ name: row.name, existingIds: [...row.existingIds] })) };
  }
  private terminal(detail: any, key: string): CatalogTerminal {
    if (detail?.state === 'NOT_APPLIED') {
      if (detail.version !== 1 || !digestValid(detail.packageDigest) || !catalogId(detail.shopId) || !validDate(detail.resolvedAt)) unavailable();
      return { found: true, state: 'NOT_APPLIED', requestKey: key, packageDigest: detail.packageDigest, shopId: detail.shopId, resolvedAt: detail.resolvedAt };
    }
    return { found: true, state: 'APPLIED', receipt: this.receipt(detail, key) };
  }
  private sameRequest(terminal: CatalogTerminal, shopId: string, digest: string) {
    const saved = terminal.state === 'APPLIED' ? terminal.receipt : terminal;
    if (saved.shopId !== shopId || saved.packageDigest !== digest) conflict('REQUEST_KEY_REUSED', '该请求键已用于不同门店或价目资料，请先核对原结果');
  }
  async result(actor: CatalogActor, key: string): Promise<CatalogResult> {
    this.actorId(actor);
    const hash = this.requestHash(actor, key);
    await this.authorize(this.prisma, actor);
    const previous = await this.prior(this.prisma, actor, hash);
    return previous ? this.terminal(previous, key) : { found: false };
  }
  async resolve(actor: CatalogActor, shop: unknown, key: string, digest: string): Promise<CatalogTerminal> {
    const actorId = this.actorId(actor), shopId = this.shopId(shop), hash = this.requestHash(actor, key);
    if (!digestValid(digest)) catalogError('PACKAGE_DIGEST_INVALID', '请保留原请求的价目摘要');
    return this.transaction(async tx => {
      // Actor-only fencing never waits for a shop: apply uses shop -> actor,
      // matching other catalog writers and observes this fence before mutation.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`);
      await this.authorize(tx, actor);
      const previous = await this.prior(tx, actor, hash);
      if (previous) { const terminal = this.terminal(previous, key); this.sameRequest(terminal, shopId, digest); return terminal; }
      const resolvedAt = new Date().toISOString();
      await tx.auditLog.create({ data: { operatorId: actorId, action: ACTION, targetType: TARGET, targetId: actorId,
        detail: { version: 1, requestKeyHash: hash, state: 'NOT_APPLIED', shopId, packageDigest: digest, resolvedAt } } });
      return { found: true, state: 'NOT_APPLIED', requestKey: key, packageDigest: digest, shopId, resolvedAt };
    });
  }
  async apply(actor: CatalogActor, shop: unknown, input: unknown, previewToken: unknown, key: string): Promise<CatalogReceipt> {
    const actorId = this.actorId(actor), parsed = parseCatalog(shop, input), hash = this.requestHash(actor, key);
    return this.transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${BigInt(parsed.shopId)} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`);
      await this.authorize(tx, actor);
      const previous = await this.prior(tx, actor, hash);
      if (previous) {
        const terminal = this.terminal(previous, key); this.sameRequest(terminal, parsed.shopId, parsed.packageDigest);
        if (terminal.state === 'APPLIED') return { ...terminal.receipt, replayed: true };
        return conflict('REQUEST_CLOSED', '本次请求已核对为未导入并关闭，请重新预览后使用新请求键');
      }
      const claim = this.verify(previewToken, actor, parsed);
      if (claim.expires <= Date.now()) conflict('PREVIEW_EXPIRED', '价目预览已过期，请重新预览；曾提交的请求须先核对结果');
      const snapshot = await this.snapshot(tx, parsed.shopId);
      if (snapshot.digest !== claim.snapshotDigest) conflict('TARGET_CHANGED', '门店或价目已在预览后变化，本次未导入，请重新预览');
      const groups = this.groups(parsed, snapshot.services), fresh = groups.filter(group => group.action === 'CREATE');
      if (!fresh.length) conflict('NOTHING_TO_IMPORT', '没有可新增的价目项目，请核对已有资料');
      const created: CatalogReceipt['created'] = [];
      for (const group of fresh) {
        const base = group.variants[0];
        const data = { shopId: BigInt(parsed.shopId), name: group.name, nameEn: group.name, category: group.category, description: group.description,
          durationMin: base.durationMin, durationKind: 'TIMED', priceCents: base.priceCents, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1,
          requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, isActive: false, sortOrder: 0 };
        const saved = await tx.shopService.create({ data });
        if (!catalogId(String(saved.id)) || Object.entries(data).some(([field, value]) => catalogStable(saved[field]) !== catalogStable(value))) {
          throw new ServiceUnavailableException('服务保存核对失败，本次未导入');
        }
        const variantIds: string[] = [];
        for (const [sortOrder, variant] of group.variants.entries()) {
          const variantData = { serviceId: saved.id, name: variant.name, durationMin: variant.durationMin, priceCents: variant.priceCents,
            priceBasis: 'PER_BOOKING', currency: 'usd', isActive: false, sortOrder };
          const result = await tx.shopServiceVariant.create({ data: variantData });
          if (!catalogId(String(result.id)) || Object.entries(variantData).some(([field, value]) => catalogStable(result[field]) !== catalogStable(value))) {
            throw new ServiceUnavailableException('规格保存核对失败，本次未导入');
          }
          variantIds.push(String(result.id));
        }
        created.push({ serviceId: String(saved.id), name: group.name, variantIds });
      }
      const skipped = groups.filter(group => group.action === 'SKIP').map(group => ({ name: group.name, existingIds: group.existingIds }));
      const receipt: CatalogReceipt = { operationId: randomUUID(), requestKey: key, packageDigest: parsed.packageDigest, shopId: parsed.shopId,
        appliedAt: new Date().toISOString(), summary: { createdServices: created.length, createdVariants: created.reduce((sum, group) => sum + group.variantIds.length, 0), skippedServices: skipped.length }, created, skipped };
      const { requestKey: _notStored, ...safeReceipt } = receipt;
      const detail = { version: 1, requestKeyHash: hash, shopId: parsed.shopId, packageDigest: parsed.packageDigest, receipt: { ...safeReceipt, status: 'APPLIED' } };
      this.receipt(detail, key);
      await tx.auditLog.create({ data: { operatorId: actorId, action: ACTION, targetType: TARGET, targetId: actorId, detail } });
      return { ...receipt, replayed: false };
    });
  }
}
