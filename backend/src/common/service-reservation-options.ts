import { validReservedDurationMin } from './service-duration';
import { priceBasis, servicePrice } from '../modules/booking/booking-plan';
import { BOOKING_PRICE_BASIS } from './order-mode';

/** Count every configured variant, including disabled rows omitted by public queries. */
export function hasServiceVariants(service: any): boolean {
  return service?.hasVariants === true || Number(service?._count?.variants ?? 0) > 0 || Array.isArray(service?.variants) && service.variants.length > 0;
}

/** Same selected duration/amount/currency boundary as booking.context and its quote. */
export function validReservationOption(service: any, option: any, variant = false): boolean {
  if (!service || !option || !validReservedDurationMin(service.durationKind, option.durationMin)
    || !Number.isSafeInteger(option.priceCents) || option.priceCents < 1) return false;
  const count = service.participantCount;
  if (count !== 1 && count !== 2 || (variant ? option.currency ?? 'usd' : 'usd') !== 'usd') return false;
  try { priceBasis(option.priceBasis ?? service.priceBasis); return servicePrice(option.priceCents, count, BOOKING_PRICE_BASIS) > 0; }
  catch { return false; }
}

export function activeReservationOptions(service: any): any[] {
  if (hasServiceVariants(service)) return (service.variants ?? []).filter((variant: any) => variant.isActive === true && validReservationOption(service, variant, true));
  return validReservationOption(service, service) ? [service] : [];
}

export function hasPublicReservationOptions(service: any): boolean {
  return service?.isActive === true && activeReservationOptions(service).length > 0;
}

/** Read metadata may borrow a real configured option's positive duration when
 * the unused base cannot be serialized. This never writes or validates a base. */
export function serviceDisplaySource(service: any): any {
  if (!hasServiceVariants(service)) return service;
  const baseReadable = Number.isSafeInteger(service.durationMin) && service.durationMin > 0;
  if (baseReadable) return service;
  const configured = service.variants ?? [];
  const selected = activeReservationOptions(service)[0] ?? configured.find((variant: any) => Number.isSafeInteger(variant.durationMin) && variant.durationMin > 0);
  return selected ? { ...service, durationMin: selected.durationMin, reservedDurationMin: selected.durationMin } : service;
}

export function publicReservationSource(service: any): any {
  if (!hasServiceVariants(service)) return service;
  return serviceDisplaySource({ ...service, variants: activeReservationOptions(service),
    _count: { ...service._count, variants: Math.max(Number(service._count?.variants ?? 0), service.variants?.length ?? 0) } });
}

