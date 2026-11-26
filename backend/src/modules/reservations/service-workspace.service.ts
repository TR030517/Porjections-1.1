import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { requireShopAccess } from '../../common/shop-access';
import { storedStudioProfile } from '../../common/shop-studio-profile';
import { normalizePriceMenu, type PriceMenuGroup, type PriceMenuItem } from '../../common/shop-price-menu';
import { isLegacyStructuredPriceRow, storedPriceMenuProjection } from '../../common/stored-price-menu';
import { resolvePriceMenu, loadPriceMenuCatalog } from '../../common/shop-price-menu-catalog';
import { matchesPriceMenuRevision, priceMenuRevision, PRICE_MENU_CHANGED } from '../../common/shop-price-menu-revision';
import { catalogSelectionRevision, loadMenuCatalogParents, MENU_CATALOG_LIMITS } from '../../common/menu-catalog-snapshot';
import { projectRow } from '../../common/project-catalog-reader';
import { menuCatalogPreview } from '../../common/menu-catalog-reader';
import { shopMediaUrls, syncShopMedia } from '../../common/managed-media';
import { isRetryableTransactionError } from '../../common/transaction-retry';
import { effectiveBookingWhere, ensureServiceConfiguration, configurationAudit } from './configuration-guard';
import { Actor, id, policyInput, variantInput } from './reservation-validation';
import { serviceAddOnInput } from './service-addons';
import { catalogMutationKey } from './catalog-actions.dto';
import { parseWorkspaceCommand, workspaceInteger, workspaceText } from './service-workspace.dto';
import type { SaveServiceWorkspace, SaveMenuLayout, SaveLegacyDisplay, RemoveMenuDisplay, WorkspaceAction, WorkspaceGroupRef, WorkspacePermission, WorkspaceReceipt, WorkspaceSnapshot, WorkspaceTarget } from './service-workspace.contract';

const ACTIONS: WorkspaceAction[] = ['SAVE_SERVICE_WORKSPACE', 'SAVE_MENU_LAYOUT', 'SAVE_LEGACY_DISPLAY', 'REMOVE_MENU_DISPLAY'];
const DEFAULT_POLICY = { participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0 };
const canonical = (value: unknown) => JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? String(entry) : entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const diff = (previous: any, changes: Record<string, any>): Record<string, any> => Object.fromEntries(Object.entries(changes).filter(([key, value]) => previous?.[key] !== value));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function menuCopy(profile: Record<string, any>): PriceMenuGroup[] {
  const value = profile.priceMenu === undefined ? [] : profile.priceMenu;
  try { storedPriceMenuProjection(value); return clone(value); }
  catch { throw new ConflictException({ code: 'PRICE_MENU_REPAIR_REQUIRED', message: '保存的价目资料无效，请先整理；不会部分保存服务。' }); }
}
/** Read-time identity only; tied to raw menu revision, original coordinates and
 * content. Never persist the token, guess by name or generate IDs on a GET. */
function rowToken(item: PriceMenuItem, group: number, position: number, revision: string) {
  return item.id ?? `legacy:${group}:${position}:${digest({ revision, group, position, item }).slice(0, 16)}`;
}
function positions(menu: PriceMenuGroup[], revision: string) {
  const result = new Map<string, { item: PriceMenuItem; group: PriceMenuGroup }>();
  menu.forEach((group, groupIndex) => group.items.forEach((item, index) => {
    const token = rowToken(item, groupIndex, index, revision);
    if (result.has(token)) throw new ConflictException('展示位置编号重复，请先整理');
    result.set(token, { item, group });
  }));
  return result;
}
function groupResolver(menu: PriceMenuGroup[]) {
  const baseline = [...menu], temporary = new Map<string, PriceMenuGroup>();
  return {
    create(key: string, category: string) { if (temporary.has(key)) throw new BadRequestException('新分组临时编号重复'); const group = { category, items: [] as PriceMenuItem[] }; temporary.set(key, group); menu.push(group); return group; },
    get(reference: WorkspaceGroupRef) { const group = 'index' in reference ? baseline[reference.index] : temporary.get(reference.tempKey); if (!group || !menu.includes(group)) throw new ConflictException('所选分组已不存在，请重新加载'); return group; },
  };
}
function assignId(item: PriceMenuItem, token: string, result: WorkspaceReceipt) {
  if (!item.id) { item.id = randomUUID(); result.idMap.displays[token] = item.id; }
  return item.id;
}
function move(menu: PriceMenuGroup[], item: PriceMenuItem, destination: PriceMenuGroup, position: number) {
  const source = menu.find(group => group.items.includes(item));
  if (source) source.items.splice(source.items.indexOf(item), 1);
  if (position > destination.items.length) throw new BadRequestException('展示顺序超出完整分组范围，请重新加载');
  destination.items.splice(position, 0, item);
}
function serviceChanges(raw: Record<string, any>, previous: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'name') result[key] = workspaceText(value, 200);
    else if (key === 'description') result[key] = value === null ? null : workspaceText(value, 10000, true, true);
    else if (key === 'category') { if (!['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'].includes(value)) throw new BadRequestException('服务类别无效'); result[key] = value; }
    else if (key === 'durationKind') { if (!['TIMED', 'PER_SESSION', 'VARIABLE'].includes(value)) throw new BadRequestException('服务时长类型无效'); result[key] = value; }
    else if (key === 'isActive') { if (typeof value !== 'boolean') throw new BadRequestException('服务启用状态须为布尔值'); result[key] = value; }
    else result[key] = workspaceInteger(value, key === 'priceCents' ? 1 : key === 'durationMin' ? 5 : 0, key === 'priceCents' ? 10000000 : key === 'durationMin' ? 240 : 10000);
  }
  return diff(previous, result);
}
function displayChanges(item: PriceMenuItem, changes: Record<string, any>, preview?: PriceMenuItem): PriceMenuItem {
  if (changes.titleMode === 'AUTO' && changes.name !== undefined) throw new BadRequestException('自动标题不能同时提交自定义文字');
  const next = { ...item };
  // Only an explicitly edited migrated row is normalized. Unrelated raw rows
  // and the complete historical source wording are never rewritten by a read.
  if (isLegacyStructuredPriceRow(item)) next.priceText = '';
  const pricingSource = () => preview?.pricing ? { ...preview.pricing, ...(next.pricing?.legacySource ? { legacySource: next.pricing.legacySource } : {}) } : next.pricing;
  for (const [field, value] of Object.entries(changes).sort(([left], [right]) => left === 'titleMode' ? 1 : right === 'titleMode' ? -1 : 0)) {
    if (field === 'isVisible') { if (typeof value !== 'boolean') throw new BadRequestException('展示状态须为布尔值'); next.isVisible = value; }
    else if (field === 'titleMode') {
      if (!['AUTO', 'CUSTOM'].includes(value)) throw new BadRequestException('标题模式无效');
      const pricing = pricingSource();
      if (!pricing) throw new BadRequestException('展示标题缺少明确来源');
      next.pricing = { ...pricing, titleMode: value };
      next.priceText = '';
      if (value === 'AUTO') { if (!preview) throw new BadRequestException('此旧展示缺少有效来源，不能生成自动标题'); next.name = preview.name; }
    } else if (field === 'name') {
      next.name = workspaceText(value, 300);
      const pricing = pricingSource();
      if (pricing) { next.pricing = { ...pricing, titleMode: 'CUSTOM' }; next.priceText = ''; }
    } else if (field === 'priceText') next.priceText = workspaceText(value, 300, true);
    else if (field === 'description') { const text = workspaceText(value, 2000, true, true); if (text) next.description = text; else delete next.description; }
    else if (field === 'imageUrl') { if (typeof value !== 'string') throw new BadRequestException('图片引用无效'); if (value) next.imageUrl = value; else delete next.imageUrl; }
  }
  // Normalize just the changed row; strict media validation runs here. The
  // owning media reference itself is checked in the transaction before commit.
  try { return normalizePriceMenu([{ category: '', items: [next] }])[0].items[0]; }
  catch { throw new BadRequestException('请核对展示标题、图片、说明与价格格式'); }
}
/** Compare only explicitly editable intent with the authoritative read model.
 * A read projection's regenerated prices/status must never become a write. */
function displayDiff(item: PriceMenuItem, changes: Record<string, any>, preview?: PriceMenuItem) {
  const baseline = preview ? { ...item, ...preview, name: item.pricing?.titleMode === 'CUSTOM' ? item.name : preview.name,
    description: item.description, imageUrl: item.imageUrl, isVisible: item.isVisible !== false,
    pricing: { ...preview.pricing!, titleMode: item.pricing?.titleMode ?? 'AUTO' } } : item;
  // Validate explicit intent against its effective read baseline. Legacy bound
  // rows may still carry plain priceText; a read-only AUTO no-op must not force
  // a conversion or fail because the effective projection has structured pricing.
  const validated = displayChanges(baseline, changes, preview);
  return Object.fromEntries(Object.entries(changes).filter(([field, value]) => {
    const before = field === 'titleMode' ? baseline.pricing?.titleMode ?? 'AUTO' : field === 'isVisible' ? item.isVisible !== false
      : field === 'description' || field === 'imageUrl' ? item[field] ?? '' : (baseline as any)[field];
    const after = field === 'titleMode' ? validated.pricing?.titleMode : field === 'description' || field === 'imageUrl' ? validated[field] ?? '' : (validated as any)[field];
    return before !== after;
  }));
}
function childChanges(changes: Record<string, any>, addOn: boolean) {
  const result: Record<string, any> = {};
  for (const [field, value] of Object.entries(changes)) {
    if (field === 'name') result[field] = workspaceText(value, 100);
    else if (field === 'description') result[field] = value === null ? null : workspaceText(value, 1000, true, true) || null;
    else if (field === 'isActive') { if (typeof value !== 'boolean') throw new BadRequestException('启用状态须为布尔值'); result[field] = value; }
    else result[field] = workspaceInteger(value, field === 'durationMin' ? 5 : field === 'priceCents' && !addOn ? 1 : 0, field === 'durationMin' ? 240 : field === 'priceCents' ? 10000000 : 10000);
  }
  return result;
}

@Injectable()
export class ServiceWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}
  private async access(tx: any, sid: bigint, actor: Actor, write = false) {
    if (!actor || !['ADMIN', 'MERCHANT', 'STAFF'].includes(actor.role)) throw new ForbiddenException();
    try { return await requireShopAccess(tx, sid, actor, 'CATALOG_MANAGE', { write }); }
    catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
    return requireShopAccess(tx, sid, actor, 'RESERVATION_CONFIG', { write });
  }
  private async permissions(tx: any, sid: bigint, actor: Actor, permissions: WorkspacePermission[]) {
    for (const permission of permissions) await requireShopAccess(tx, sid, actor, permission, { write: true });
  }
  private async locked<T>(sid: bigint, actor: Actor, work: (tx: any, shop: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id=${sid} FOR UPDATE`);
        const { shop } = await this.access(tx, sid, actor, true);
        return work(tx, shop);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 }); }
      catch (error) { if (!isRetryableTransactionError(error)) throw error; if (attempt === 2) throw new ServiceUnavailableException('配置写入繁忙，请保留草稿并核对原操作'); }
    }
    throw new ServiceUnavailableException('请保留草稿并稍后核对');
  }
  private known(row: any, sid: bigint): WorkspaceReceipt {
    const result = row?.result as WorkspaceReceipt;
    if (!row || row.shopId !== sid || !result || result.shopId !== String(sid) || !['COMMITTED', 'NOT_EXECUTED'].includes(result.outcome)
      || result.outcome === 'COMMITTED' && !ACTIONS.includes(result.action!)
      || !Array.isArray(result.requiredPermissions) || result.requiredPermissions.some(value => !['CATALOG_MANAGE', 'RESERVATION_CONFIG'].includes(value))) throw new NotFoundException('暂未找到此服务操作回执；这不代表在途请求已失败');
    return result;
  }
  async snapshot(shopId: string, actor: Actor, serviceId?: string): Promise<WorkspaceSnapshot> {
    const sid = id(shopId); if (serviceId !== undefined) id(serviceId);
    return this.prisma.$transaction(async (tx: any) => {
      const access = await this.access(tx, sid, actor), profile = storedStudioProfile(access.shop.studioProfile), raw = menuCopy(profile);
      const catalog = await loadPriceMenuCatalog(tx, sid, raw), revision = priceMenuRevision(sid, profile, catalog);
      const parent = serviceId === undefined ? null : (await loadMenuCatalogParents(tx, sid, [id(serviceId)]))[0];
      if (serviceId !== undefined && !parent) throw new NotFoundException('服务不存在或不属于当前门店');
      const menu = resolvePriceMenu(storedPriceMenuProjection(raw), catalog, sid);
      menu.forEach((group, groupIndex) => group.items.forEach((item, index) => { item.id = rowToken(raw[groupIndex].items[index], groupIndex, index, revision); item.isVisible = item.isVisible !== false; }));
      return { shopId: String(sid), service: parent ? projectRow(parent, String(sid)) : null, priceMenu: menu, priceMenuRevision: revision,
        selectionRevision: parent ? catalogSelectionRevision(sid, parent) : null, canManageCatalog: access.permissions.includes('CATALOG_MANAGE'), canConfigurePolicy: access.permissions.includes('RESERVATION_CONFIG') };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
  async receipt(shopId: string, actor: Actor, requestKey: string) {
    const sid = id(shopId), key = catalogMutationKey(requestKey);
    return this.locked(sid, actor, async tx => {
      const row = await tx.catalogMutationOperation.findUnique({ where: { actorId_idempotencyKey: { actorId: id(actor.id), idempotencyKey: key } } });
      const result = this.known(row, sid); await this.permissions(tx, sid, actor, result.requiredPermissions); return result;
    });
  }
  async reconcile(shopId: string, actor: Actor, requestKey: string) {
    const sid = id(shopId), key = catalogMutationKey(requestKey);
    return this.locked(sid, actor, async (tx, shop) => {
      const where = { actorId_idempotencyKey: { actorId: id(actor.id), idempotencyKey: key } };
      const previous = await tx.catalogMutationOperation.findUnique({ where });
      if (previous) { const result = this.known(previous, sid); await this.permissions(tx, sid, actor, result.requiredPermissions); return result; }
      const profile = storedStudioProfile(shop.studioProfile), catalog = await loadPriceMenuCatalog(tx, sid, profile.priceMenu);
      const result = this.empty(sid, key, null, priceMenuRevision(sid, profile, catalog)); result.outcome = 'NOT_EXECUTED';
      await tx.catalogMutationOperation.create({ data: { id: result.operationId, actorId: id(actor.id), shopId: sid, action: 'WORKSPACE_NOT_EXECUTED', idempotencyKey: key,
        requestHash: digest({ closed: true, actor: actor.id, shopId }), result } });
      return result;
    });
  }
  private empty(sid: bigint, key: string, action: WorkspaceAction | null, revision: string): WorkspaceReceipt {
    return { operationId: randomUUID(), action, shopId: String(sid), idempotencyKey: key, outcome: 'COMMITTED', serviceId: null,
      idMap: { variants: {}, addOns: {}, displays: {} }, priceMenuRevision: revision, selectionRevision: null, requiredPermissions: [],
      changes: { serviceFields: [], policyFields: [], variantIds: [], addOnIds: [], displayIds: [], layout: false }, warnings: [] };
  }
  async execute(shopId: string, actor: Actor, input: unknown): Promise<WorkspaceReceipt> {
    const sid = id(shopId), body = parseWorkspaceCommand(input), hash = digest({ protocol: 'service-workspace:v1', shopId: String(sid), body });
    return this.locked(sid, actor, async (tx, shop) => {
      const previous = await tx.catalogMutationOperation.findUnique({ where: { actorId_idempotencyKey: { actorId: id(actor.id), idempotencyKey: body.idempotencyKey } } });
      if (previous) {
        const result = this.known(previous, sid); await this.permissions(tx, sid, actor, result.requiredPermissions);
        if (result.outcome === 'NOT_EXECUTED') throw new ConflictException({ code: 'SERVICE_WORKSPACE_OPERATION_SEALED', message: '原操作已核对为未执行，请加载最新资料后使用新操作编号。' });
        if (previous.requestHash !== hash) throw new ConflictException({ code: 'CATALOG_OPERATION_KEY_REUSED', message: '此操作编号已用于其他内容，请先核对原回执。' });
        return result;
      }
      const profile = storedStudioProfile(shop.studioProfile), menu = menuCopy(profile), beforeCatalog = await loadPriceMenuCatalog(tx, sid, menu);
      if (!matchesPriceMenuRevision(sid, profile, body.expectedPriceMenuRevision, beforeCatalog)) throw new ConflictException(PRICE_MENU_CHANGED);
      const result = this.empty(sid, body.idempotencyKey, body.action, body.expectedPriceMenuRevision);
      if (body.action === 'SAVE_SERVICE_WORKSPACE') await this.saveService(tx, shop, actor, body, menu, result);
      else {
        await this.permissions(tx, sid, actor, ['CATALOG_MANAGE']); result.requiredPermissions = ['CATALOG_MANAGE'];
        if (body.action === 'SAVE_MENU_LAYOUT') this.saveLayout(body, menu, result);
        else if (body.action === 'SAVE_LEGACY_DISPLAY') this.saveLegacy(body, menu, result);
        else await this.removeDisplay(tx, shop, body, menu, result);
      }
      // This writer NEVER calls savePriceMenuCatalog: display data cannot write
      // a service price or infer a pause from a missing/hidden binding.
      try { storedPriceMenuProjection(menu, profile.priceMenu ?? []); } catch { throw new BadRequestException('保存后的价目超出限制或包含无效资料，整个操作已取消'); }
      let afterProfile = profile;
      if (canonical(profile.priceMenu ?? []) !== canonical(menu)) {
        const next = { ...profile, priceMenu: menu };
        const oldMedia = shopMediaUrls(profile), newMedia = shopMediaUrls(next);
        if (canonical([...oldMedia].sort()) !== canonical([...newMedia].sort())) await syncShopMedia(tx, { shopId: sid, actor, purpose: 'MENU', previousProfile: profile, nextProfile: next, previousUrls: oldMedia, nextUrls: newMedia });
        await tx.shop.update({ where: { id: sid }, data: { studioProfile: next } });
        afterProfile = next;
      }
      const afterCatalog = await loadPriceMenuCatalog(tx, sid, menu);
      result.priceMenuRevision = priceMenuRevision(sid, afterProfile, afterCatalog);
      for (const field of ['variantIds', 'addOnIds', 'displayIds'] as const) result.changes[field] = [...new Set(result.changes[field])];
      if (result.serviceId) { const parent = (await loadMenuCatalogParents(tx, sid, [id(result.serviceId)]))[0]; if (!parent) throw new ConflictException('保存后的服务无法完整读取'); result.selectionRevision = catalogSelectionRevision(sid, parent); }
      await configurationAudit(tx, actor, 'SHOP', sid, body.action, [...result.changes.serviceFields, ...result.changes.policyFields, ...(result.changes.variantIds.length ? ['variants'] : []), ...(result.changes.addOnIds.length ? ['addOns'] : []), ...(result.changes.displayIds.length || result.changes.layout ? ['priceMenu'] : [])]);
      await tx.catalogMutationOperation.create({ data: { id: result.operationId, actorId: id(actor.id), shopId: sid, action: body.action, idempotencyKey: body.idempotencyKey, requestHash: hash, result } });
      return result;
    });
  }

  private async saveService(tx: any, shop: any, actor: Actor, body: SaveServiceWorkspace, menu: PriceMenuGroup[], result: WorkspaceReceipt) {
    const parent = body.serviceId ? (await loadMenuCatalogParents(tx, shop.id, [id(body.serviceId)]))[0] : null;
    if (body.serviceId && !parent) throw new NotFoundException('服务不存在或不属于当前门店');
    if (parent && catalogSelectionRevision(shop.id, parent) !== body.expectedSelectionRevision) throw new ConflictException({ code: 'CATALOG_SELECTION_CHANGED', message: '此服务、规格或附加项已更新，请保留草稿并重新加载。' });
    const metadata = serviceChanges(body.service ?? {}, parent);
    const basePolicy = parent ?? DEFAULT_POLICY;
    const desiredPolicy = body.policy === undefined ? {} : policyInput({ ...basePolicy, ...body.policy });
    const policy = diff(basePolicy, desiredPolicy);
    if (!parent && !metadata.name) throw new BadRequestException('创建服务须填写服务名称');
    const variants = (body.variants ?? []).map(row => {
      const old = 'id' in row ? parent?.variants.find((entry: any) => String(entry.id) === row.id) : null;
      if ('id' in row && !old) throw new NotFoundException('规格不存在或不属于当前服务');
      const validated = childChanges(row.changes, false);
      const data = old ? { ...old, ...validated } : variantInput({ isActive: true, sortOrder: 0, ...validated, priceBasis: 'PER_BOOKING', currency: 'usd' });
      // No-op existing rows retain legacy basis/currency; a real price edit is
      // explicitly whole-order USD, never multiplied by people or staff.
      const changed = old ? diff(old, { ...validated, ...(validated.priceCents !== undefined && validated.priceCents !== old.priceCents ? { priceBasis: 'PER_BOOKING', currency: 'usd' } : {}) }) : data;
      return { row, old, data, changed };
    });
    const extras = (body.addOns ?? []).map(row => {
      const old = 'id' in row ? parent?.addOns.find((entry: any) => String(entry.id) === row.id) : null;
      if ('id' in row && !old) throw new NotFoundException('附加项不存在或不属于当前服务');
      const validated = childChanges(row.changes, true);
      const data = old ? { ...old, ...validated } : serviceAddOnInput({ description: null, isActive: true, sortOrder: 0, ...validated, currency: 'usd' });
      const changed = old ? diff(old, { ...validated, ...(validated.priceCents !== undefined && validated.priceCents !== old.priceCents ? { currency: 'usd' } : {}) }) : data;
      return { row, old, data, changed };
    });
    const newVariants = variants.filter(row => !row.old), newExtras = extras.filter(row => !row.old);
    if (!parent && !newVariants.length) throw new BadRequestException('新服务须填写首个规格的明确名称、时长及美元价格');
    if ((parent?.variants.length ?? 0) + newVariants.length + (parent && !parent.variants.length && newVariants.length ? 1 : 0) > MENU_CATALOG_LIMITS.variants
      || (parent?.addOns.length ?? 0) + newExtras.length > MENU_CATALOG_LIMITS.addOns) throw new BadRequestException('服务规格或附加项超过完整读取安全上限');
    if (parent?.variants.length && ['priceCents', 'durationMin'].some(field => Object.prototype.hasOwnProperty.call(metadata, field))) throw new BadRequestException('该服务按所选规格计价，请修改规格价格或占用时间');
    const slots = positions(menu, body.expectedPriceMenuRevision);
    let hasDisplayDiff = false;
    const editableDisplays = new Map<string, Record<string, any>>();
    for (const row of body.displays ?? []) {
      if ('tempKey' in row) { hasDisplayDiff = true; continue; }
      const saved = slots.get(row.id); if (!saved) throw new NotFoundException('展示位置已不存在');
      const binding = saved.item.booking;
      if (!binding) {
        if (!row.target || saved.item.newVariantOf || saved.item.bookingEnabled === true) throw new BadRequestException('只有无关联的纯展示资料可显式转换；请选择明确来源');
        hasDisplayDiff = true; continue;
      }
      if (binding.serviceId !== String(parent?.id)) throw new NotFoundException('展示位置不属于当前服务');
      if (row.target) {
        const existing = saved.item.booking!;
        const matches = row.target.kind === 'SERVICE' ? !existing.variantId && !existing.addOnId : 'id' in row.target && (row.target.kind === 'VARIANT' ? existing.variantId : existing.addOnId) === row.target.id;
        if (!matches) throw new BadRequestException('已保存展示位置不能在服务保存中改绑来源');
      }
      const kind = binding.addOnId ? 'addOn' : binding.variantId ? 'variant' : 'service';
      const selected = binding.addOnId ? parent.addOns.find((entry: any) => String(entry.id) === binding.addOnId) : binding.variantId ? parent.variants.find((entry: any) => String(entry.id) === binding.variantId) : parent;
      const preview = menuCatalogPreview(parent, selected, kind, String(shop.id)) ?? undefined;
      const changes = displayDiff(saved.item, row.changes, preview); editableDisplays.set(row.id, changes);
      if (Object.keys(changes).length
        || row.group && ('tempKey' in row.group || menu[row.group.index] !== saved.group)
        || row.position !== undefined && saved.group.items.indexOf(saved.item) !== row.position) hasDisplayDiff = true;
    }
    const catalogChanged = !parent || Object.keys(metadata).length > 0 || variants.some(row => Object.keys(row.changed).length) || extras.some(row => Object.keys(row.changed).length) || !!body.newGroups?.length || hasDisplayDiff;
    result.requiredPermissions = [...(catalogChanged ? ['CATALOG_MANAGE' as const] : []), ...(Object.keys(policy).length ? ['RESERVATION_CONFIG' as const] : [])];
    await this.permissions(tx, shop.id, actor, result.requiredPermissions);
    if (parent) {
      await ensureServiceConfiguration(tx, parent, metadata);
      const guarded = Object.keys(policy).length || !parent.variants.length && metadata.durationMin !== undefined;
      if (guarded && await this.futureService(tx, shop.id, parent.id)) throw new ConflictException('服务仍有有效未来预约，不能修改占用时间、人数、技师、空间或缓冲');
      for (const row of variants) if (row.old && (row.changed.durationMin !== undefined || row.changed.isActive === false) && await tx.bookingItem.findFirst({ where: { variantId: row.old.id, booking: { shopId: shop.id, ...effectiveBookingWhere(), endTime: { gt: new Date() } } }, select: { id: true } })) throw new ConflictException('规格仍有未来预约，不能停用或修改占用时间；请保留原规格');
    }
    // All authorization, both baseline versions, ownership and future-booking
    // guards above precede the first write. Later validation also rolls back the
    // entire DB transaction, including local new groups, media and the receipt.
    let saved = parent;
    if (!saved) {
      saved = await tx.shopService.create({ data: { shopId: shop.id, name: metadata.name, category: 'OTHER', description: null, durationKind: 'TIMED', isActive: true,
        durationMin: newVariants[0].data.durationMin, priceCents: newVariants[0].data.priceCents, priceBasis: 'PER_BOOKING', sortOrder: 0, ...DEFAULT_POLICY, ...metadata, ...policy } });
    } else if (Object.keys(metadata).length || Object.keys(policy).length) {
      saved = await tx.shopService.update({ where: { id: parent.id }, data: { ...metadata, ...(metadata.priceCents !== undefined ? { priceBasis: 'PER_BOOKING' } : {}), ...policy } });
    }
    result.serviceId = String(saved.id); result.changes.serviceFields = Object.keys(metadata); result.changes.policyFields = Object.keys(policy);
    let keptBaseVariantId: string | undefined;
    if (parent && !parent.variants.length && newVariants.length) {
      // Preserve the old base option with this draft's explicitly edited values.
      // Historic orders keep their snapshots and the service ID never changes.
      const base = variantInput({ name: `${saved.durationMin} min`, durationMin: saved.durationMin, priceCents: saved.priceCents, priceBasis: 'PER_BOOKING', currency: 'usd', isActive: saved.isActive, sortOrder: 0 });
      const kept = await tx.shopServiceVariant.create({ data: { ...base, priceBasis: saved.priceBasis ?? 'PER_PERSON', serviceId: saved.id } });
      keptBaseVariantId = String(kept.id);
      result.changes.variantIds.push(keptBaseVariantId);
      for (const [token, source] of slots) if (source.item.booking?.serviceId === String(saved.id) && !source.item.booking.variantId && !source.item.booking.addOnId) {
        source.item.booking = { serviceId: String(saved.id), variantId: String(kept.id) };
        if (isLegacyStructuredPriceRow(source.item)) source.item.priceText = '';
        result.changes.displayIds.push(assignId(source.item, token, result));
      }
    }
    for (const row of variants) {
      if (!Object.keys(row.changed).length) continue;
      const savedRow = row.old ? await tx.shopServiceVariant.update({ where: { id: row.old.id }, data: row.changed }) : await tx.shopServiceVariant.create({ data: { ...row.data, serviceId: saved.id } });
      result.changes.variantIds.push(String(savedRow.id)); if ('tempKey' in row.row) result.idMap.variants[row.row.tempKey] = String(savedRow.id);
    }
    for (const row of extras) {
      if (!Object.keys(row.changed).length) continue;
      const savedRow = row.old ? await tx.shopServiceAddOn.update({ where: { id: row.old.id }, data: row.changed }) : await tx.shopServiceAddOn.create({ data: { ...row.data, serviceId: saved.id } });
      result.changes.addOnIds.push(String(savedRow.id)); if ('tempKey' in row.row) result.idMap.addOns[row.row.tempKey] = String(savedRow.id);
    }
    const latest = (await loadMenuCatalogParents(tx, shop.id, [saved.id]))[0]; if (!latest) throw new ConflictException('保存后的完整服务无法读取');
    const groups = groupResolver(menu);
    for (const group of body.newGroups ?? []) { groups.create(group.tempKey, workspaceText(group.category, 200, true)); result.changes.layout = true; }
    for (const row of body.displays ?? []) {
      const existingId = 'id' in row ? row.id : undefined;
      const prior = existingId === undefined ? null : slots.get(existingId)!;
      let target = prior?.item.booking;
      // A SERVICE target from the pre-upgrade draft refers only to the base
      // option preserved by this transaction. Other variant services still
      // require an explicit variant and cannot use this compatibility mapping.
      if (!target) target = keptBaseVariantId && row.target?.kind === 'SERVICE'
        ? { serviceId: String(saved.id), variantId: keptBaseVariantId }
        : this.target(row.target!, result, latest);
      const kind = target.addOnId ? 'addOn' : target.variantId ? 'variant' : 'service';
      const selected = target.addOnId ? latest.addOns.find((entry: any) => String(entry.id) === target!.addOnId) : target.variantId ? latest.variants.find((entry: any) => String(entry.id) === target!.variantId) : latest;
      const preview = menuCatalogPreview(latest, selected, kind, String(shop.id));
      if (!preview && !prior?.item.booking) throw new BadRequestException('展示来源缺少有效的服务价格或占用时间，请先完善');
      const original: PriceMenuItem = prior?.item ?? { ...preview!, id: randomUUID(), isVisible: true };
      const converting = !!prior && !original.booking;
      const starting: PriceMenuItem = converting ? { ...original, ...preview!, id: original.id, name: original.name, priceText: '',
        pricing: {
          ...preview!.pricing!,
          titleMode: 'CUSTOM',
          legacySource: original.pricing?.legacySource ?? { name: original.name, priceText: original.priceText },
        },
        description: original.description, imageUrl: original.imageUrl, isVisible: original.isVisible,
      } : original;
      const changes = prior && !converting ? editableDisplays.get(existingId!)! : row.changes;
      const next = Object.keys(changes).length || converting || !prior ? displayChanges(starting, changes, preview ?? undefined) : starting;
      if (prior) {
        const actualChanged = canonical(next) !== canonical(prior.item);
        const positionChanged = row.group !== undefined && groups.get(row.group) !== prior.group || row.position !== undefined && prior.group.items.indexOf(prior.item) !== row.position;
        if (!actualChanged && !positionChanged) continue;
        assignId(next, existingId!, result);
        const index = prior.group.items.indexOf(prior.item); prior.group.items[index] = next; prior.item = next;
        if (positionChanged) move(menu, next, row.group ? groups.get(row.group) : prior.group, row.position ?? (row.group ? groups.get(row.group).items.length : prior.group.items.indexOf(next)));
      } else {
        result.idMap.displays[(row as any).tempKey] = next.id!;
        const group = groups.get(row.group!); if (row.position === undefined) group.items.push(next); else move(menu, next, group, row.position);
      }
      result.changes.displayIds.push(next.id!);
    }
    // Authoritative names/prices/status are regenerated on reads; never persist
    // that projection over positions the user did not explicitly change.
    for (const group of menu) for (const item of group.items) {
      if (item.booking?.serviceId !== String(saved.id)) continue;
      if (item.pricing?.titleMode === 'CUSTOM' && /\d/.test(item.name) && (result.changes.variantIds.length || metadata.priceCents !== undefined || metadata.durationMin !== undefined)) result.warnings.push('已保留自定义标题；其中可能含旧价格或分钟，请核对。');
    }
    result.warnings = [...new Set(result.warnings)];
  }
  private futureService(tx: any, shopId: bigint, serviceId: bigint) {
    return tx.booking.findFirst({ where: { shopId, ...effectiveBookingWhere(), endTime: { gt: new Date() }, AND: [{ OR: [{ serviceId }, { items: { some: { serviceId } } }] }] }, select: { id: true } });
  }
  private target(target: WorkspaceTarget, result: WorkspaceReceipt, service: any) {
    if (target.kind === 'SERVICE') { if (service.variants.length) throw new BadRequestException('已有规格的服务须选择明确规格'); return { serviceId: String(service.id) }; }
    const childId = 'id' in target ? target.id : (target.kind === 'VARIANT' ? result.idMap.variants : result.idMap.addOns)[target.tempKey];
    const found = (target.kind === 'VARIANT' ? service.variants : service.addOns).find((row: any) => String(row.id) === childId && row.serviceId === service.id);
    if (!found) throw new BadRequestException('展示引用不属于当前服务，或临时子项未在本次保存中创建');
    return { serviceId: String(service.id), ...(target.kind === 'VARIANT' ? { variantId: childId } : { addOnId: childId }) };
  }
  private saveLayout(body: SaveMenuLayout, menu: PriceMenuGroup[], result: WorkspaceReceipt) {
    const sources = positions(menu, body.expectedPriceMenuRevision), groups = groupResolver(menu), changedGroups = new Set<string>(), moved = new Set<string>();
    for (const input of body.groups ?? []) {
      const key = 'index' in input ? 'index:' + input.index : 'new:' + input.tempKey;
      if (changedGroups.has(key)) throw new BadRequestException('分组不能重复修改'); changedGroups.add(key);
      if ('index' in input) groups.get({ index: input.index }).category = workspaceText(input.category, 200, true);
      else groups.create(input.tempKey, workspaceText(input.category, 200, true));
    }
    for (const input of body.moves ?? []) {
      if (moved.has(input.itemId)) throw new BadRequestException('展示位置不能重复移动'); moved.add(input.itemId);
      const source = sources.get(input.itemId); if (!source) throw new NotFoundException('展示位置已不存在');
      const target = groups.get(input.group);
      if (target === source.group && source.group.items.indexOf(source.item) === input.position) continue;
      assignId(source.item, input.itemId, result); move(menu, source.item, target, input.position); result.changes.displayIds.push(source.item.id!);
    }
    const removed = new Set<PriceMenuGroup>();
    for (const input of body.removeGroups ?? []) {
      const source = groups.get({ index: input.index }), destination = groups.get(input.moveTo);
      if (removed.has(source) || source === destination || removed.has(destination)) throw new BadRequestException('删除分组须选择有效的其他目标分组');
      destination.items.push(...source.items); source.items = []; removed.add(source);
    }
    for (const group of removed) menu.splice(menu.indexOf(group), 1);
    if (body.groupOrder) {
      const order = body.groupOrder.map(reference => groups.get(reference));
      if (new Set(order).size !== order.length || order.length !== menu.length || menu.some(group => !order.includes(group))) throw new BadRequestException('分组顺序必须覆盖完整最新布局，不能使用搜索或分页结果替换');
      menu.splice(0, menu.length, ...order);
    }
    result.changes.layout = true;
  }
  private saveLegacy(body: SaveLegacyDisplay, menu: PriceMenuGroup[], result: WorkspaceReceipt) {
    const source = positions(menu, body.expectedPriceMenuRevision).get(body.itemId);
    if (!source) throw new NotFoundException('旧展示文字已不存在，请重新加载');
    if (source.item.booking || source.item.newVariantOf || source.item.bookingEnabled === true) throw new BadRequestException('此位置已有服务归属，请使用对应服务编辑区；不能用旧文字工具修改预约对象');
    const raw = { ...source.item };
    if (body.changes.name !== undefined && raw.pricing) raw.pricing = { ...raw.pricing, titleMode: 'CUSTOM' };
    const next = displayChanges(raw, body.changes);
    if (canonical(next) !== canonical(source.item)) {
      assignId(next, body.itemId, result); source.group.items[source.group.items.indexOf(source.item)] = next; result.changes.displayIds.push(next.id!);
    }
  }
  /** Deliberate permanent removal only. Hidden positions remain in this exact
   * binding count, so a visibility change never pauses the underlying option. */
  private async removeDisplay(tx: any, shop: any, body: RemoveMenuDisplay, menu: PriceMenuGroup[], result: WorkspaceReceipt) {
    const source = positions(menu, body.expectedPriceMenuRevision).get(body.itemId);
    if (!source) throw new NotFoundException('展示位置已不存在，请重新加载后确认移除');
    const link = source.item.booking;
    if (link) {
      const remaining = menu.flatMap(group => group.items).filter(item => item !== source.item);
      const hasBinding = remaining.some(item => item.booking?.serviceId === link.serviceId && item.booking.variantId === link.variantId && item.booking.addOnId === link.addOnId);
      if (!hasBinding) {
        const service = (await loadMenuCatalogParents(tx, shop.id, [id(link.serviceId)]))[0];
        if (!service) throw new ConflictException('原关联来源已不存在，请先整理关联，不能推断移除影响');
        result.serviceId = String(service.id);
        if (link.variantId) {
          const variant = service.variants.find((row: any) => String(row.id) === link.variantId);
          if (!variant) throw new ConflictException('原规格已不存在，请先整理关联');
          if (variant.isActive) {
            if (await tx.bookingItem.findFirst({ where: { variantId: variant.id, booking: { shopId: shop.id, ...effectiveBookingWhere(), endTime: { gt: new Date() } } }, select: { id: true } })) throw new ConflictException('规格仍有未来预约，不能移除最后展示位置；隐藏不影响既有预约');
            await tx.shopServiceVariant.update({ where: { id: variant.id }, data: { isActive: false } });
            result.changes.variantIds.push(String(variant.id)); result.warnings.push('已移除该规格最后的展示位置，并按原移除规则暂停该规格预约。');
          }
        } else if (link.addOnId) {
          const extra = service.addOns.find((row: any) => String(row.id) === link.addOnId);
          if (!extra) throw new ConflictException('原附加项目已不存在，请先整理关联');
          if (extra.isActive) { await tx.shopServiceAddOn.update({ where: { id: extra.id }, data: { isActive: false } }); result.changes.addOnIds.push(String(extra.id)); result.warnings.push('已移除最后展示位置，并暂停该附加项目；历史订单快照保留。'); }
        } else if (!service.variants.length && service.isActive) {
          await ensureServiceConfiguration(tx, service, { isActive: false });
          await tx.shopService.update({ where: { id: service.id }, data: { isActive: false } }); result.changes.serviceFields.push('isActive');
          result.warnings.push('已移除旧基础服务最后的展示位置，并按原移除规则暂停预约。');
        }
      }
    }
    source.group.items.splice(source.group.items.indexOf(source.item), 1);
    result.changes.displayIds.push(body.itemId);
  }
}
