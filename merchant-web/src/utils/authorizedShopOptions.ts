import type { MyShop } from '../api/merchant';

const statusLabels: Record<string, string> = { PENDING: '待审核', APPROVED: '已发布', REJECTED: '已拒绝', SUSPENDED: '已停用' };
const accessLabels: Record<string, string> = { OWN: '本店', ASSOCIATED: '关联门店', STAFF: '员工权限', ADMIN: '公司管理员' };
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();

/** Build search data exclusively from the already authorized shop collection. */
export function authorizedShopOptions(shops: MyShop[]) {
  return shops.map(shop => ({
    value: shop.id,
    label: `${shop.name} · #${shop.id} · ${accessLabels[shop.accessType] ?? '已授权'} · ${statusLabels[shop.status] ?? shop.status}`,
    searchText: normalize([shop.id, '#' + shop.id, shop.name, shop.nameEn, shop.shortName, shop.city, shop.state].filter(Boolean).join(' ')),
  }));
}

export function matchesAuthorizedShop(input: string, option?: { searchText?: string }) {
  const terms = normalize(input).split(/\s+/).filter(Boolean);
  return terms.every(term => (option?.searchText ?? '').includes(term));
}
