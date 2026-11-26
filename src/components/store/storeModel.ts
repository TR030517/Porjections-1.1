import type { StoreDraft, StoreHours, StoreItem, StoreStatus } from './types';
import { MANAGED_MEDIA_PATH } from '../../utils/mediaDraft';
import { priceMenuFromShop, validatePriceMenu } from '../../utils/priceMenu';
import { shopBrandColor } from '../../utils/shopBranding';
import { shopButtonShape } from '../../utils/shopButtonShape';

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const STATUS: Record<StoreStatus, string> = { PENDING: '待审核', APPROVED: '已发布', REJECTED: '已拒绝', SUSPENDED: '已停用' };
export const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu'];

export function emptyHours(): Record<string, StoreHours> {
  return Object.fromEntries(WEEKDAYS.map(day => [day, { open: false, start: '', end: '' }]));
}

export function blankDraft(): StoreDraft {
  return {
    ownerId: '', name: '', shortName: '', subtitle: '', status: 'PENDING', reviewReason: '', timezone: '',
    phones: '', emails: '', businessHours: Object.fromEntries(WEEKDAYS.map(day => [day, { open: true, start: '09:00', end: '22:00' }])), address: '', city: '', state: '', zipCode: '',
    latitude: '', longitude: '', logo: '', logoUrl: '', bannerUrl: '', gallery: '', videoUrl: '', about: '',
    tags: '', priceMenu: [], onlineBooking: false, reviews: false, mapShareUrl: '',
    websiteUrl: '', instagramUrl: '', facebookUrl: '',
    brandColor: 'teal',
    buttonShape: 'rounded',
  };
}

export function draftFromStore(item: StoreItem | null): StoreDraft {
  if (!item) return blankDraft();
  const businessHours = emptyHours();
  for (const day of WEEKDAYS) {
    const hours = item.businessHours?.[day];
    if (hours) businessHours[day] = { ...hours, ...(hours.periods ? { periods: hours.periods.map(period => ({ ...period })) } : {}) };
  }
  const links = item.links ?? {};
  return {
    ownerId: String(item.ownerId), name: item.name ?? '', shortName: item.shortName ?? '', subtitle: item.subtitle ?? '',
    status: item.status, reviewReason: item.reviewComment ?? '', timezone: item.timezone ?? '',
    phones: (item.phones ?? []).join('\n'), emails: (item.emails ?? []).join('\n'), businessHours,
    address: item.address ?? '', city: item.city ?? '', state: item.state ?? '', zipCode: item.zipCode ?? '',
    latitude: item.latitude == null ? '' : String(item.latitude), longitude: item.longitude == null ? '' : String(item.longitude),
    logo: item.logo ?? '', logoUrl: item.logoUrl ?? '', bannerUrl: item.bannerUrl ?? '', gallery: (item.gallery ?? []).join('\n'),
    videoUrl: item.videoUrl ?? '', about: item.about ?? '', tags: (item.tags ?? []).join('\n'),
    priceMenu: priceMenuFromShop(item),
    onlineBooking: Boolean(item.features?.onlineBooking), reviews: Boolean(item.features?.reviews), mapShareUrl: item.mapShareUrl ?? '',
    websiteUrl: links.website ?? '', instagramUrl: links.instagram ?? '', facebookUrl: links.facebook ?? '',
    brandColor: shopBrandColor(item.brandColor),
    buttonShape: shopButtonShape(item.buttonShape),
  };
}

/** Compare draft values without depending on object insertion order or the clock. */
export function draftFingerprint(draft: StoreDraft): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
    return value;
  };
  return JSON.stringify(stable(draft));
}

function text(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(`${label}最多 ${max} 个字符。`);
  return value.trim();
}

function lines(value: string, label: string, maxItems: number, maxLength: number): string[] {
  const items = value.split('\n').map(item => item.trim()).filter(Boolean);
  if (items.length > maxItems) throw new Error(`${label}最多 ${maxItems} 条。`);
  return items.map(item => text(item, label, maxLength));
}

// Match Studio validation.url: HTTPS, no embedded credentials, at most 500 characters.
function mediaUrl(value: string, label: string): string {
  const input = text(value, label, 500);
  if (!input) return '';
  if(MANAGED_MEDIA_PATH.test(input))return input;
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Show the same actionable validation for malformed and unsafe URLs. */ }
  throw new Error(`${label}须为不含用户名或密码的 HTTPS 链接。`);
}

function externalUrl(value: string, label: string, allowedDomains?: string[]): string {
  const input = text(value, label, 500);
  if (!input) return '';
  try {
    const url = new URL(input), host = url.hostname.toLowerCase();
    const domainAllowed = !allowedDomains || allowedDomains.some(domain => host === domain || host.endsWith('.' + domain));
    if (url.protocol === 'https:' && !url.username && !url.password && host && domainAllowed) return url.href;
  } catch { /* Keep malformed links out of the public profile. */ }
  throw new Error(allowedDomains ? `${label}须为对应平台的 HTTPS 链接。` : `${label}须为不含用户名或密码的 HTTPS 链接。`);
}

function openingTime(value: string, day: string): string {
  const input = typeof value === 'string' ? value.trim() : '';
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input)) return input;
  // Existing Studio data accepts this legacy representation and normalizes it to HH:mm.
  const match = /^(0?[1-9]|1[0-2]):([0-5]\d) (AM|PM)$/.exec(input);
  if (match) return `${String(Number(match[1]) % 12 + (match[3] === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}`;
  throw new Error(`${day}的营业时间须为有效时间。`);
}

function checkedHours(value: StoreDraft['businessHours']): Record<string, StoreHours> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请设置有效的营业时间。');
  const result = emptyHours();
  for (const day of WEEKDAYS) {
    const hours = value[day];
    if (!hours) continue;
    if (typeof hours !== 'object' || Array.isArray(hours) || typeof hours.open !== 'boolean') throw new Error(`${day}的营业设置无效。`);
    if (!hours.open) { result[day] = { open: false, start: hours.start ?? '', end: hours.end ?? '' }; continue; }
    const periods = hours.periods ?? [{ start: hours.start, end: hours.end }];
    if (!Array.isArray(periods) || periods.length < 1 || periods.length > 4) throw new Error(`${day}须设置1–4段营业时间。`);
    const checked = periods.map(period => {
      if (!period.start || !period.end) throw new Error(`${day}的营业时间须完整，结束时间须晚于开始时间。`);
      const start = openingTime(period.start, day), end = openingTime(period.end, day);
      if (start >= end) throw new Error(`${day}的营业时间须完整，结束时间须晚于开始时间。`);
      return { start, end };
    }).sort((a, b) => a.start.localeCompare(b.start));
    if (checked.some((period, index) => index > 0 && period.start < checked[index - 1].end)) throw new Error(`${day}的营业时段不能重叠。`);
    result[day] = { open: true, ...checked[0], ...(checked.length > 1 ? { periods: checked } : {}) };
  }
  return result;
}

/** Copy only explicitly selected days, using the same validation as a real save. */
export function copyStoreHours(value: StoreDraft['businessHours'], source: string, targets: string[]): StoreDraft['businessHours'] {
  if (!WEEKDAYS.includes(source) || !value[source] || !Array.isArray(targets) || targets.some(day => !WEEKDAYS.includes(day))) throw new Error('请选择有效的来源日与目标日。');
  const selected = [...new Set(targets)].filter(day => day !== source);
  if (!selected.length) throw new Error('请至少选择一个不同的目标日。');
  const checked = checkedHours({ ...emptyHours(), [source]: value[source] })[source];
  const copied = checked.open ? checked : { open: false, start: '', end: '' };
  const next = structuredClone(value);
  for (const day of selected) next[day] = structuredClone(copied);
  return next;
}

export function buildStorePayload(draft: StoreDraft, { isStoreManager, editing }: { isStoreManager: boolean; editing: StoreItem | null }): Record<string, unknown> {
  if (!draft.name.trim() || !draft.shortName.trim()) throw new Error('请填写门店名称与唯一短链。');
  if (!editing && isStoreManager) throw new Error('新增门店须由平台管理员操作。');
  const ownerId = draft.ownerId.trim();
  if (!editing && !ownerId) throw new Error('请选择实际商家账户作为门店所有者。');
  if (!editing && (!/^[1-9]\d{0,18}$/.test(ownerId) || BigInt(ownerId) > 9223372036854775807n)) throw new Error('请选择有效的商家账户。');
  if (!isStoreManager && !Object.hasOwn(STATUS, draft.status)) throw new Error('请选择有效的发布状态。');
  const reviewReason = !isStoreManager && draft.status === 'REJECTED' ? text(draft.reviewReason, '拒绝原因', 2000) : '';
  if (!isStoreManager && draft.status === 'REJECTED' && editing?.status !== 'REJECTED' && !reviewReason) throw new Error('请填写拒绝原因。');
  const phones = lines(draft.phones, '联系电话', 5, 20); const emails = lines(draft.emails, '联系邮箱', 5, 255);
  if (emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('请填写有效的联系邮箱。');
  const businessHours = checkedHours(draft.businessHours);
  const timezone = text(draft.timezone, 'IANA 时区', 100);
  if (timezone) { try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw new Error('请填写有效的 IANA 时区。'); } }
  if (!isStoreManager && draft.status === 'APPROVED') {
    const basic = [
      !timezone && '门店时区',
      !phones.length && '联系电话',
      !draft.address.trim() && '详细地址',
      !draft.city.trim() && '城市',
      !draft.state.trim() && '州',
    ].filter(Boolean);
    const steps = [
      basic.length && '在「基本资料」补充' + basic.join('、'),
      !Object.values(businessHours).some(hours => hours.open) && '在「营业设置」添加至少一天营业时间',
    ].filter(Boolean);
    if (steps.length) throw new Error('发布前请' + steps.join('，再') + '。');
  }
  if (typeof draft.onlineBooking !== 'boolean' || typeof draft.reviews !== 'boolean') throw new Error('请选择有效的线上业务设置。');
  return {
    name: text(draft.name, '门店名称', 200), shortName: text(draft.shortName, '唯一短链', 100), subtitle: text(draft.subtitle, '副标题', 500),
    ...(!editing && !isStoreManager ? { ownerId } : {}),
    ...(!isStoreManager ? { status: draft.status, ...(draft.status === 'REJECTED' ? { reviewReason } : {}) } : {}),
    phones, emails, timezone, businessHours,
    address: text(draft.address, '详细地址', 500), city: text(draft.city, '城市', 100), state: text(draft.state, '州 / 省', 50), zipCode: text(draft.zipCode, '邮政编码', 10),
    // Hidden historical coordinates and text logos are not resent by the editor.
    logoUrl: mediaUrl(draft.logoUrl, 'Logo 图片链接'), bannerUrl: mediaUrl(draft.bannerUrl, '横幅图片链接'),
    gallery: lines(draft.gallery, '相册图片链接', 20, 500).map(value => mediaUrl(value, '相册图片链接')), videoUrl: mediaUrl(draft.videoUrl, '视频链接'),
    about: text(draft.about, '门店介绍', 20000), ...menuPatch(draft, editing), tags: lines(draft.tags, '标签', 10, 100),
    features: { onlineBooking: draft.onlineBooking, reviews: draft.reviews }, mapShareUrl: mediaUrl(draft.mapShareUrl, '地图分享链接'),
    links: { website: externalUrl(draft.websiteUrl, '官网链接'), instagram: externalUrl(draft.instagramUrl, 'Instagram 链接', ['instagram.com']), facebook: externalUrl(draft.facebookUrl, 'Facebook 链接', ['facebook.com', 'fb.com']) },
    brandColor: shopBrandColor(draft.brandColor),
    buttonShape: shopButtonShape(draft.buttonShape),
  };
}

/** Omit an unchanged menu: editing contact details must not resend a stale menu snapshot. */
function menuPatch(draft: StoreDraft, editing: StoreItem | null): Record<string, unknown> {
  const priceMenu = validatePriceMenu(draft.priceMenu);
  if (!editing) return { priceMenu };
  if (JSON.stringify(draft.priceMenu) === JSON.stringify(draftFromStore(editing).priceMenu)) return {};
  if (!/^[a-f0-9]{64}$/.test(editing.priceMenuRevision ?? '')) throw new Error('展示价目表版本缺失，请关闭后重新打开门店，再修改价目。');
  return { priceMenu, expectedPriceMenuRevision: editing.priceMenuRevision };
}

/** Validate the draft, but never resend unrelated fields from an older store snapshot. */
export function buildStoreSavePayload(draft: StoreDraft, options: { isStoreManager: boolean; editing: StoreItem | null }): Record<string, unknown> {
  if (options.editing) {
    const original = draftFromStore(options.editing);
    const withoutMenu = (value: StoreDraft) => draftFingerprint({ ...value, priceMenu: [] });
    if (draftFingerprint(draft) === draftFingerprint(original)) throw new Error('没有需要保存的修改。');
    if (withoutMenu(draft) === withoutMenu(original)) return menuPatch(draft, options.editing);
    const full = buildStorePayload(draft, options), patch: Record<string, unknown> = {};
    const fields = ['name', 'shortName', 'subtitle', 'timezone', 'phones', 'emails', 'businessHours', 'address', 'city', 'state', 'zipCode', 'logoUrl', 'bannerUrl', 'gallery', 'videoUrl', 'about', 'tags', 'mapShareUrl', 'brandColor', 'buttonShape'] as const;
    for (const field of fields) if (JSON.stringify(draft[field]) !== JSON.stringify(original[field])) patch[field] = full[field];
    // Location-only patches otherwise trigger server inference and can silently
    // replace a confirmed/manual timezone with a different one.
    if (['city', 'state', 'zipCode'].some(field => draft[field as keyof StoreDraft] !== original[field as keyof StoreDraft])) patch.timezone = full.timezone;
    // The server merges feature keys individually. Links are an atomic profile group.
    const features: Record<string, boolean> = {};
    if (draft.onlineBooking !== original.onlineBooking) features.onlineBooking = draft.onlineBooking;
    if (draft.reviews !== original.reviews) features.reviews = draft.reviews;
    if (Object.keys(features).length) patch.features = features;
    if (['websiteUrl', 'instagramUrl', 'facebookUrl'].some(field => draft[field as keyof StoreDraft] !== original[field as keyof StoreDraft])) patch.links = full.links;
    if (!options.isStoreManager && (draft.status !== original.status || draft.status === 'REJECTED' && draft.reviewReason !== original.reviewReason)) {
      patch.status = full.status;
      if (Object.hasOwn(full, 'reviewReason')) patch.reviewReason = full.reviewReason;
    }
    if (Object.hasOwn(full, 'priceMenu')) { patch.priceMenu = full.priceMenu; patch.expectedPriceMenuRevision = full.expectedPriceMenuRevision; }
    if (!Object.keys(patch).length) throw new Error('没有需要保存的修改。');
    return patch;
  }
  return buildStorePayload(draft, options);
}
