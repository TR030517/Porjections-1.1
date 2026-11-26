/** Framework-free public projection, also used by Studio's customer preview.
 * No spread of a database row or arbitrary Studio JSON is allowed here. */
import { safePublicMediaUrl } from './public-media-url';
import { resolvePriceMenu } from './shop-price-menu-catalog-view';
import { managedPriceMenu } from './shop-price-menu';
import { publicDurationMeta, publicReservedBlockValid } from './service-duration-public-meta';
import { BOOKING_PRICE_BASIS, bookingOrderPolicy } from './order-mode';
import { bookingCalendar } from './booking-calendar';
import { readShopBookingSettings } from './shop-booking-settings';
import { publicShopExternalLinks } from './shop-external-links';
import { publicShopBrandColor } from './shop-branding-colors';
import { publicShopButtonShape } from './shop-button-shape';
import { listingDetailsIncomplete } from './shop-directory-policy';
export { safePublicMediaUrl } from './public-media-url';

function record(value: unknown): Record<string, any> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function text(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function texts(value: unknown, count: number, max: number): string[] { return Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => text(item, max)).filter(Boolean).slice(0, count) : []; }
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function publicShopProfile(shop: any, legacyImages: readonly any[] = [], options: { includePriceMenu?: boolean; includeHiddenPriceMenu?: boolean; includeBookingCalendar?: boolean; activeStaffCount?: number; hasConfiguredBookingSchedule?: boolean } = {}) {
  const profile = record(shop?.studioProfile ?? shop?.studio_profile);
  const imageId = (image: any) => /^\d+$/.test(String(image.id ?? '')) ? BigInt(image.id) : 0n;
  const orderedImages = [...legacyImages].filter(image => String(image.imageType ?? image.image_type).toUpperCase() !== 'CERTIFICATE').sort((a, b) => Number(a.sortOrder ?? a.sort_order ?? 0) - Number(b.sortOrder ?? b.sort_order ?? 0)
    || (imageId(a) < imageId(b) ? -1 : imageId(a) > imageId(b) ? 1 : 0));
  const legacyUrls = orderedImages.map(image => safePublicMediaUrl(image.imageUrl ?? image.image_url)).filter((value): value is string => !!value);
  // Presence matters: []/'' clears the Studio value and never resurrects old rows.
  const galleryInput = has(profile, 'gallery') ? Array.isArray(profile.gallery) ? profile.gallery : [] : legacyUrls;
  const galleryUrls = [...new Set(galleryInput.map(safePublicMediaUrl).filter((value): value is string => !!value))].slice(0, 20);
  const legacyCover = has(profile, 'gallery') ? undefined : orderedImages.find(image => ['COVER', 'BANNER'].includes(String(image.imageType ?? image.image_type).toUpperCase()));
  const coverUrl = has(profile, 'bannerUrl') ? safePublicMediaUrl(profile.bannerUrl)
    : safePublicMediaUrl(legacyCover?.imageUrl ?? legacyCover?.image_url) ?? galleryUrls[0] ?? null;
  const logoUrl = safePublicMediaUrl(profile.logoUrl);
  const bookingSettings = readShopBookingSettings(profile);
  const links = publicShopExternalLinks(profile.links);
  const media = { logoUrl, coverUrl, galleryUrls, posterUrl: null as string | null };
  const phones = has(profile, 'phones') ? texts(profile.phones, 5, 20) : texts([shop?.phone], 1, 20);
  const priceMenu = options.includePriceMenu === false ? undefined
    : resolvePriceMenu(profile.priceMenu, shop?.shopServices ?? [], shop?.id, { ...options, includeHidden: options.includeHiddenPriceMenu === true });
  return {
    listingDetailsIncomplete: listingDetailsIncomplete(shop),
    ...bookingOrderPolicy(), ...(options.includeBookingCalendar === false ? {} : { bookingCalendar: bookingCalendar(shop?.timezone) }),
    bookingSettings, brandColor: publicShopBrandColor(profile.brandColor), buttonShape: publicShopButtonShape(profile.buttonShape),
    subtitle: text(profile.subtitle, 500), about: text(shop?.description, 20000),
    ...(priceMenu === undefined ? {} : {
      priceMenu: options.includeHiddenPriceMenu ? priceMenu : priceMenu.map(group => ({ ...group, items: group.items.map(item => {
        if (!item.pricing?.legacySource) return item;
        const { legacySource: _legacySource, ...pricing } = item.pricing;
        return { ...item, pricing };
      }) })),
      // Prevent the canonical fallback list from displaying a deliberately
      // hidden menu option again. This changes discovery, never authorization
      // or slot/quote eligibility for a direct booking URL.
      hiddenPriceMenuOptions: managedPriceMenu(profile.priceMenu).flatMap(group => group.items.flatMap(item =>
        item.isVisible === false && item.booking && !item.booking.addOnId ? [{ ...item.booking }] : [])),
    }),
    logo: text(profile.logo, 30), phones, emails: texts(profile.emails, 5, 255), tags: texts(profile.tags, 10, 100), links,
    videoUrl: typeof profile.videoUrl === 'string' && profile.videoUrl.startsWith('https://') ? safePublicMediaUrl(profile.videoUrl) : null, mapShareUrl: typeof profile.mapShareUrl === 'string' && profile.mapShareUrl.startsWith('https://') ? safePublicMediaUrl(profile.mapShareUrl) : null,
    media, thumbnail: coverUrl ?? galleryUrls[0] ?? logoUrl,
    images: galleryUrls.map((imageUrl, index) => ({ id: `public-${index}`, imageUrl, imageType: 'GALLERY', sortOrder: index })),
  };
}

export function publicServiceView(service: any) {
  const duration = publicDurationMeta(service);
  const addOns = service.isActive === true && Array.isArray(service.addOns) ? service.addOns.filter((row: any) => row?.isActive === true && String(row.serviceId) === String(service.id)
    && /^[1-9]\d{0,18}$/.test(String(row.id)) && typeof row.name === 'string' && !!row.name.trim() && row.name.length <= 100 && !/[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(row.name)
    && Number.isInteger(row.priceCents) && row.priceCents >= 0 && row.priceCents <= 10000000 && row.currency === 'usd')
    .slice(0,50).map((row: any) => ({ id:String(row.id), serviceId:String(row.serviceId), name:row.name.trim(),
      description: typeof row.description === 'string' && row.description.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(row.description) ? row.description.trim() : null,
      priceCents:row.priceCents,currency:'usd',isActive:true,sortOrder:Number.isInteger(row.sortOrder)?row.sortOrder:0 })) : [];
  return { id: String(service.id), shopId: String(service.shopId), name: service.name, nameEn: service.nameEn ?? null,
    category: service.category, description: service.description ?? null, durationMin: service.durationMin, ...duration, isActive: service.isActive, sortOrder: service.sortOrder,
    ...bookingOrderPolicy(), priceCents: service.priceCents, priceBasis: BOOKING_PRICE_BASIS, priceDollars: service.priceCents / 100, currency: 'usd',
    participantCount: service.participantCount, requiredStaffCount: service.requiredStaffCount,
    requiredRoomType: service.requiredRoomType ?? null, staffBufferMin: service.staffBufferMin, roomBufferMin: service.roomBufferMin,
    hasVariants: (service._count?.variants ?? service.variants?.length ?? 0) > 0, addOns,
    variants: (service.variants ?? []).filter((variant: any) => publicReservedBlockValid(variant.durationMin)).map((variant: any) => ({ id: String(variant.id), serviceId: String(variant.serviceId), name: variant.name,
      durationMin: variant.durationMin, ...publicDurationMeta({ ...variant, durationKind: duration.durationKind }), priceCents: variant.priceCents, priceBasis: BOOKING_PRICE_BASIS, currency: variant.currency, isActive: variant.isActive, sortOrder: variant.sortOrder })) };
}
