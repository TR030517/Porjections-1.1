import { createHash } from 'node:crypto';

export const PRICE_MENU_CHANGED = Object.freeze({
  code: 'PRICE_MENU_CHANGED',
  message: '展示价目已更新或缺少编辑版本。请保留当前草稿，重新加载价目并核对后再保存。',
});

/** Internal editing token only. Hash raw stored menu, never its lossy public
 * projection, and bind it to the shop. Unrelated private/profile fields do not
 * invalidate an editor. Reads remain possible for malformed legacy profiles;
 * the separate storedStudioProfile guard still prevents unsafe write merges. */
export function priceMenuRevision(shopId: bigint | string | number, studioProfile: unknown, catalog: readonly any[] = []): string {
  let profile = studioProfile;
  if (typeof profile === 'string') {
    try { profile = JSON.parse(profile); } catch { profile = null; }
  }
  const record = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile as Record<string, unknown> : null;
  const present = !!record && Object.prototype.hasOwnProperty.call(record, 'priceMenu');
  const ids = new Set(Array.isArray(record?.priceMenu) ? record!.priceMenu.flatMap((group: any) => Array.isArray(group?.items) ? group.items.flatMap((item: any) => typeof (item?.booking?.serviceId ?? item?.newVariantOf) === 'string' ? [item.booking?.serviceId ?? item.newVariantOf] : []) : []) : []);
  const byId = (a: any, b: any) => String(a.id).localeCompare(String(b.id));
  const linked = catalog.filter(row => ids.has(String(row.id)) && String(row.shopId) === String(shopId)).map(row => ({ ...row,
    ...(Array.isArray(row.variants) ? { variants: [...row.variants].sort(byId) } : {}), ...(Array.isArray(row.addOns) ? { addOns: [...row.addOns].sort(byId) } : {}) })).sort(byId);
  const value = { shopId: String(shopId), present, priceMenu: present ? record!.priceMenu : null, ...(ids.size ? { catalog: linked } : {}) };
  const stable = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  // v3 prices are whole-order amounts, including stored legacy PER_PERSON rows.
  // Reload old editor projections before allowing a price write.
  return createHash('sha256').update('massajoy-price-menu:v3:').update(stable).digest('hex');
}

/** Call only after the shop row lock and fresh read, before any write/media side effect. */
export function matchesPriceMenuRevision(shopId: bigint | string | number, studioProfile: unknown, expected: unknown, catalog: readonly any[] = []): boolean {
  return typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected) && expected === priceMenuRevision(shopId, studioProfile, catalog);
}
