import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { requireShopAccess } from '../../common/shop-access';
import { storedStudioProfile } from '../../common/shop-studio-profile';
import { normalizePriceMenu, type PriceMenuGroup } from '../../common/shop-price-menu';
import { loadPriceMenuCatalog } from '../../common/shop-price-menu-catalog';
import { matchesPriceMenuRevision, priceMenuRevision, PRICE_MENU_CHANGED } from '../../common/shop-price-menu-revision';
import { catalogSelectionRevision, loadMenuCatalogParents, MENU_CATALOG_LIMITS } from '../../common/menu-catalog-snapshot';
import { menuCatalogPreview } from '../../common/menu-catalog-reader';
import { Actor, id } from './reservation-validation';
import { configurationAudit, withShopConfiguration } from './configuration-guard';
import { CatalogMutationReceipt, catalogMutationKey, parseCatalogMutation } from './catalog-actions.dto';

function requestHash(shopId: string, body: unknown) {
  return createHash('sha256').update('catalog-actions:v1:').update(JSON.stringify({ shopId, body }, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest('hex');
}
function menuCopy(profile: Record<string, any>): PriceMenuGroup[] {
  const raw = profile.priceMenu === undefined ? [] : profile.priceMenu;
  try { normalizePriceMenu(raw); return JSON.parse(JSON.stringify(raw)); }
  catch { throw new ConflictException({ code: 'PRICE_MENU_REPAIR_REQUIRED', message: '已保存的价目资料无效，请先整理；未创建任何服务或规格。' }); }
}

/** Append-only catalog commands. Existing full-menu editors keep their own API. */
@Injectable()
export class CatalogActionsService {
  constructor(private readonly prisma: PrismaService) {}

  async receipt(shopId: string, actor: Actor, requestKey: unknown): Promise<CatalogMutationReceipt> {
    const sid = id(shopId), key = catalogMutationKey(requestKey);
    if (!actor || !['ADMIN', 'MERCHANT'].includes(actor.role)) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx: any) => {
      await requireShopAccess(tx, sid, actor, 'CATALOG_MANAGE');
      const found = await tx.catalogMutationOperation.findUnique({ where: { actorId_idempotencyKey: { actorId: id(actor.id), idempotencyKey: key } } });
      if (!found || found.shopId !== sid) throw new NotFoundException({ code: 'CATALOG_OPERATION_NOT_FOUND', message: '暂未找到此操作结果，请稍后再次核对；这不表示在途保存已失败。' });
      return found.result as CatalogMutationReceipt;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async execute(shopId: string, actor: Actor, raw: unknown): Promise<CatalogMutationReceipt> {
    const sid = id(shopId), body = parseCatalogMutation(raw), hash = requestHash(shopId, body);
    return withShopConfiguration(this.prisma, sid, actor, async (tx, shop) => {
      const key = { actorId: id(actor.id), idempotencyKey: body.idempotencyKey };
      // Authorization was reread under the shared shop/account mutex before replay.
      const previous = await tx.catalogMutationOperation.findUnique({ where: { actorId_idempotencyKey: key } });
      if (previous) {
        if (previous.shopId !== sid || previous.requestHash !== hash) throw new ConflictException({ code: 'CATALOG_OPERATION_KEY_REUSED', message: '此请求编号已用于其他内容，请先核对原操作结果。' });
        return previous.result as CatalogMutationReceipt;
      }
      const profile = storedStudioProfile(shop.studioProfile), menu = menuCopy(profile);
      const beforeCatalog = await loadPriceMenuCatalog(tx, sid, menu);
      if (!matchesPriceMenuRevision(sid, profile, body.expectedPriceMenuRevision, beforeCatalog)) throw new ConflictException(PRICE_MENU_CHANGED);
      if (body.display && 'groupIndex' in body.display && !menu[body.display.groupIndex]) throw new BadRequestException('所选价目分组不存在，请重新加载');
      let parent: any, variant: any, changedMenu = false;
      if (body.action === 'CREATE_SERVICE') {
        parent = await tx.shopService.create({ data: { shopId: sid, ...body.service!, durationMin: body.variant!.durationMin,
          priceCents: body.variant!.priceCents, priceBasis: 'PER_BOOKING', participantCount: 1, requiredStaffCount: 1,
          requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0, sortOrder: 0 } });
      } else {
        parent = (await loadMenuCatalogParents(tx, sid, [BigInt(body.serviceId!)]))[0];
        if (!parent) throw new NotFoundException('服务不存在或不属于本店');
        if (catalogSelectionRevision(sid, parent) !== body.expectedSelectionRevision) throw new ConflictException({ code: 'CATALOG_SELECTION_CHANGED', message: '来源服务或规格已更新，请保留输入并重新加载。' });
      }
      if (body.action === 'LINK_EXISTING_VARIANT') {
        variant = parent.variants.find((row: any) => String(row.id) === body.variantId && row.serviceId === parent.id);
        if (!variant) throw new NotFoundException('规格不存在或不属于所选服务');
      } else {
        if (body.action === 'CREATE_VARIANT') {
          const needed = parent.variants.length ? 1 : 2;
          if (parent.variants.length + needed > MENU_CATALOG_LIMITS.variants) throw new BadRequestException('服务规格数量已达安全上限');
          if (!parent.variants.length) {
            // Introducing a first independent option must not erase the old base
            // choice. Preserve its amount/time and rebind only its exact rows.
            if (!Number.isSafeInteger(parent.durationMin) || parent.durationMin < 5 || parent.durationMin > 240
              || !Number.isSafeInteger(parent.priceCents) || parent.priceCents < 1 || parent.priceCents > 10000000
              || !['PER_PERSON', 'PER_BOOKING'].includes(parent.priceBasis)) throw new ConflictException('原基础服务缺少有效价格或占用时间，请先完善，未创建新规格');
            const base = await tx.shopServiceVariant.create({ data: { serviceId: parent.id, name: `${parent.durationMin} min`, durationMin: parent.durationMin,
              priceCents: parent.priceCents, priceBasis: parent.priceBasis, currency: 'usd', isActive: parent.isActive, sortOrder: 0 } });
            for (const group of menu) for (const item of group.items) {
              if (item.booking?.serviceId === String(parent.id) && !item.booking.variantId && !item.booking.addOnId) {
                item.booking = { serviceId: String(parent.id), variantId: String(base.id) }; changedMenu = true;
              }
            }
          }
        }
        variant = await tx.shopServiceVariant.create({ data: { serviceId: parent.id, ...body.variant! } });
      }
      parent = (await loadMenuCatalogParents(tx, sid, [parent.id]))[0];
      if (!parent) throw new ConflictException('保存后的目录无法完整读取，操作已取消');
      let displayStatus: CatalogMutationReceipt['displayStatus'] = 'NOT_REQUESTED', displayItemId: string | null = null;
      if (body.display) {
        const existing = menu.flatMap(group => group.items).find(item => item.booking?.serviceId === String(parent.id) && item.booking?.variantId === String(variant.id));
        if (existing) { displayStatus = 'ALREADY_LINKED'; displayItemId = existing.id ?? null; }
        else {
          const preview = menuCatalogPreview(parent, variant, 'variant', String(sid));
          if (!preview) throw new ConflictException('规格无法生成有效的顾客价目，整个操作已取消');
          const row = normalizePriceMenu([{ category: '', items: [{ ...preview, id: randomUUID() }] }])[0].items[0];
          if ('newGroupCategory' in body.display) menu.push({ category: body.display.newGroupCategory, items: [row] });
          else menu[body.display.groupIndex].items.push(row);
          changedMenu = true; displayStatus = 'ADDED'; displayItemId = row.id!;
        }
      }
      // Validate limits without normalizing or rewriting any unrelated saved row.
      try { normalizePriceMenu(menu); } catch { throw new BadRequestException('追加后价目超出限制或含无效数据，整个操作已取消'); }
      const afterProfile = changedMenu ? { ...profile, priceMenu: menu } : profile;
      if (changedMenu) await tx.shop.update({ where: { id: sid }, data: { studioProfile: afterProfile } });
      const afterCatalog = await loadPriceMenuCatalog(tx, sid, menu);
      const result: CatalogMutationReceipt = { operationId: randomUUID(), action: body.action, shopId: String(sid), serviceId: String(parent.id), variantId: String(variant.id),
        created: { service: body.action === 'CREATE_SERVICE', variant: body.action !== 'LINK_EXISTING_VARIANT', display: displayStatus === 'ADDED' }, displayStatus, displayItemId,
        priceMenuRevision: priceMenuRevision(sid, afterProfile, afterCatalog), selectionRevision: catalogSelectionRevision(sid, parent) };
      await configurationAudit(tx, actor, 'SHOP', sid, 'CATALOG_ACTION', [body.action, ...(changedMenu ? ['priceMenu'] : [])]);
      await tx.catalogMutationOperation.create({ data: { id: result.operationId, ...key, shopId: sid, action: body.action, requestHash: hash, result } });
      return result;
    });
  }
}
