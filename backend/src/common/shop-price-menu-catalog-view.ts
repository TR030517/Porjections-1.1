import { managedPriceMenu, publicPriceMenu, type PriceMenuGroup, type PriceMenuUnavailableReason } from './shop-price-menu';
import { formatPriceMenuTitle, type PriceMenuPricing } from './shop-price-menu-pricing';

function validMainChoice(row: any): boolean {
  return Number.isSafeInteger(row?.durationMin) && row.durationMin >= 5 && row.durationMin <= 240
    && Number.isSafeInteger(row.priceCents) && row.priceCents > 0 && row.priceCents <= 10_000_000
    && (row.currency === undefined || row.currency === 'usd') && ['PER_PERSON', 'PER_BOOKING'].includes(row.priceBasis ?? 'PER_PERSON');
}

/** Keep the public/editor values authoritative even when a service is inactive. */
export function resolvePriceMenu(value: unknown, catalog: readonly any[] = [], shopId?: unknown, options: { activeStaffCount?: number; hasConfiguredBookingSchedule?: boolean; includeHidden?: boolean } = {}): PriceMenuGroup[] {
  const menu = options.includeHidden === false ? publicPriceMenu(value) : managedPriceMenu(value);
  return menu.map(group => ({ ...group, items: group.items.map(item => {
    if (!item.booking) return item;
    const link = item.booking, service = catalog.find(row => String(row.id) === link.serviceId && (shopId === undefined || String(row.shopId) === String(shopId)));
    const selected = link.addOnId ? service?.addOns?.find((row: any) => String(row.id) === link.addOnId && String(row.serviceId) === link.serviceId)
      : link.variantId ? service?.variants?.find((row: any) => String(row.id) === link.variantId && String(row.serviceId) === link.serviceId) : service;
    if (!service || !selected) return { ...item, bookingEnabled: false, bookingAvailable: false, bookingUnavailableReason: 'CONFIGURATION_REQUIRED' as const };
    const kind = link.addOnId ? 'ADD_ON' : service.durationKind ?? 'TIMED';
    if (!['TIMED', 'PER_SESSION', 'VARIABLE', 'ADD_ON'].includes(kind) || !Number.isInteger(selected.priceCents)) return { ...item, bookingEnabled: selected.isActive === true, bookingAvailable: false, bookingUnavailableReason: 'CONFIGURATION_REQUIRED' as const };
    const pricing: PriceMenuPricing = { kind, baseName: link.addOnId ? selected.name : service.name, durationMin: kind === 'TIMED' ? selected.durationMin : null,
      priceCents: selected.priceCents, titleMode: item.pricing?.titleMode === 'CUSTOM' ? 'CUSTOM' : 'AUTO', ...(item.pricing?.legacySource ? { legacySource: item.pricing.legacySource } : {}) };
    const validMode = service.participantCount === 1 && (service.requiredStaffCount === 1 || service.requiredStaffCount === 2) || service.participantCount === 2 && service.requiredStaffCount === 2;
    const enabled = selected.isActive === true;
    const parentHasVariants = Array.isArray(service.variants) && service.variants.length > 0;
    const parentChoiceAvailable = parentHasVariants ? service.variants.some((row: any) => row.isActive === true && validMainChoice(row)) : validMainChoice(service);
    const parentAvailable = service.isActive === true && validMode && ['TIMED', 'PER_SESSION', 'VARIABLE'].includes(service.durationKind ?? 'TIMED')
      && parentChoiceAvailable;
    // Live slots still check the full service window, time off and reservation locks.
    const staffAvailable = options.activeStaffCount === undefined || options.activeStaffCount >= service.requiredStaffCount;
    const available = parentAvailable && staffAvailable && enabled && (kind === 'ADD_ON'
      ? Number.isSafeInteger(selected.priceCents) && selected.priceCents >= 0 && selected.priceCents <= 10_000_000 && selected.currency === 'usd'
      : validMainChoice(selected) && (!!link.variantId || !parentHasVariants));
    const reason: PriceMenuUnavailableReason | undefined = (link.variantId || link.addOnId) && service.isActive !== true ? 'PARENT_PAUSED'
      : !enabled ? 'ITEM_PAUSED'
      : !available ? 'CONFIGURATION_REQUIRED'
      : options.hasConfiguredBookingSchedule === false ? 'NO_SCHEDULE' : undefined;
    const bookingMode = service.participantCount === 2 && service.requiredStaffCount === 2 ? 'COUPLE' as const : service.participantCount === 1 && service.requiredStaffCount === 2 ? 'FOUR_HANDS' as const : 'SINGLE' as const;
    return { ...item, name: pricing.titleMode === 'CUSTOM' ? item.name : formatPriceMenuTitle(pricing), priceText: '', pricing, bookingEnabled: enabled, bookingAvailable: available && options.hasConfiguredBookingSchedule !== false, ...(reason ? { bookingUnavailableReason: reason } : {}), ...(kind !== 'ADD_ON' ? { bookingMode } : {}),
      ...(kind !== 'ADD_ON' ? { reservedDurationMin: selected.durationMin } : {}) };
  }) }));
}

