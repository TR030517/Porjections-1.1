export function requestedShopId(search: string): string | null {
  const value = new URLSearchParams(search).get('shopId');
  return value === null ? null : /^[1-9]\d{0,19}$/.test(value) ? value : '';
}
export function resolveShopSelection(shops: Array<{ id: string; homeShopId?: string | null; accessType?: string }>, requested: string | null, previous: string | null) {
  if (requested !== null) return shops.some(shop => shop.id === requested)
    ? { selectedId: requested, error: null }
    : { selectedId: null, error: '所请求门店不可用或当前账号未获授权，请明确选择已授权门店。' };
  if (previous && shops.some(shop => shop.id === previous)) return { selectedId: previous, error: null };
  const home = shops.find(shop => shop.accessType === 'OWN' || shop.homeShopId === shop.id);
  return { selectedId: home?.id ?? shops[0]?.id ?? null, error: shops.length ? null : '当前账号尚未分配授权门店，请联系公司管理员绑定本店独立账号。' };
}
