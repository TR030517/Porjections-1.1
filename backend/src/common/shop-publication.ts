import { BadRequestException } from '@nestjs/common';
import { openingIntervals } from '../modules/booking/hours';

export interface PublicationCheck { key: string; label: string; complete: boolean; }

/** One policy for every publishing entry point and the operator's checklist. */
export function shopPublication(shop: any, _owner = shop.owner, _loginReady = true) {
  const present = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  let timezone = false;
  if (present(shop.timezone)) {
    try { new Intl.DateTimeFormat('en', { timeZone: shop.timezone }).format(); timezone = true; } catch { /* Incomplete legacy data remains unpublished. */ }
  }
  const hours = shop.businessHours;
  let hasHours = false;
  try { hasHours = Object.values(openingIntervals(hours)).some(periods => periods.length > 0); } catch { /* Incomplete or overlapping hours cannot publish. */ }
  const publicationChecklist: PublicationCheck[] = [
    { key: 'name', label: '门店名称与唯一短链', complete: present(shop.name) && present(shop.shortName) },
    { key: 'timezone', label: '有效的门店时区', complete: timezone },
    { key: 'contact', label: '联系电话', complete: present(shop.phone) },
    { key: 'address', label: '地址、城市与州', complete: present(shop.address) && present(shop.city) && present(shop.state) },
    { key: 'hours', label: '至少一天有效营业时间', complete: hasHours },
  ];
  return { publicationChecklist, publicationReady: publicationChecklist.every(check => check.complete) };
}

export function requireShopPublication(shop: any, _owner = shop.owner, _loginReady = true) {
  const policy = shopPublication(shop);
  if (!policy.publicationReady) {
    const missing = policy.publicationChecklist.filter(check => !check.complete);
    throw new BadRequestException({ message: '发布前请补充：' + missing.map(check => check.label).join('、'), missingFields: missing.map(check => check.key) });
  }
}
