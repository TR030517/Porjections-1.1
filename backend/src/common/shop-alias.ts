import { BadRequestException, ConflictException } from '@nestjs/common';

const RESERVED = new Set(['admin', 'merchant', 'api', 'auth', 'login', 'signin', 'signup', 'register', 'logout', 's', 'store', 'shops', 'shop', 'h5', 'assets', 'icons', 'canvaskit', 'pages', 'static', 'health', 'favicon', 'robots', 'sitemap', 'payments', 'bookings', 'account', 'profile', 'home', 'search', 'about', 'support', 'feedback', 'terms', 'privacy']);
export function normalizeShopShortName(value: unknown): string {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (slug.length < 3 || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || RESERVED.has(slug) || /^store-\d+$/.test(slug)) {
    throw new BadRequestException('门店短名须为 3–100 个小写英文字母或数字，可用单个横线分隔，且不能使用系统保留路径');
  }
  return slug;
}
export function canonicalShopLink(shortName: unknown) {
  try { const canonicalShortName = normalizeShopShortName(shortName); return { canonicalShortName, canonicalPath: '/s/' + canonicalShortName }; }
  catch { return { canonicalShortName: null, canonicalPath: null }; }
}

/** Called in the same Studio transaction as the Shop write. Never delete old
 * aliases: a renamed shop keeps its historical entry and names cannot be stolen. */
export async function reserveShopAlias(tx: any, shopId: bigint, shortName: unknown) {
  const value = normalizeShopShortName(shortName);
  const conflictingShop = await tx.shop.findFirst({ where: { shortName: value, id: { not: shopId } }, select: { id: true } });
  if (conflictingShop) throw new ConflictException('门店短链已被使用，请更换');
  const where = { kind_source_value: { kind: 'SHORT_NAME', source: 'massajoy', value } };
  const previous = await tx.shopAlias.findUnique({ where });
  if (previous && previous.shopId !== shopId) throw new ConflictException('该短链已为其他门店保留，不能重新分配');
  if (previous) { if (!previous.isActive) await tx.shopAlias.update({ where: { id: previous.id }, data: { isActive: true } }); return value; }
  await tx.shopAlias.create({ data: { shopId, kind: 'SHORT_NAME', source: 'massajoy', value } });
  return value;
}
