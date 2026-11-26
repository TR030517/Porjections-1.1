import 'money.dart';
import 'shop.dart';

class ShopBookingChoice {
  final ShopService service;
  final ShopServiceVariant? variant;
  const ShopBookingChoice(this.service,[this.variant]);
  (String,String?) get identity => (service.id,variant?.id);
  String get label => variant == null ? service.name : '${service.name} · ${variant!.name}';
  String get duration => variant == null ? service.formattedDuration : service.reservationLabel(variant!.durationMin);
  String get price {
    if(variant==null){return service.formattedPrice;}
    final option=variant!;
    return formatCents(option.priceCents*(option.priceBasis=='PER_BOOKING'?1:service.participantCount),option.currency);
  }
}

/// A menu row covers only its own effective canonical option. An inactive row,
/// add-on, stale link or another variant never hides a sibling booking choice.
List<ShopBookingChoice> uncoveredShopBookingChoices(ShopDetail shop) {
  final canonical=<ShopBookingChoice>[
    for(final service in shop.services)if(service.canBook)
      if(service.hasVariants)...[for(final variant in service.activeVariants)ShopBookingChoice(service,variant)]
      else ShopBookingChoice(service),
  ];
  final known=canonical.map((choice)=>choice.identity).toSet(),covered=<(String,String?)>{};
  // Hidden is independent of active: suppress public fallback cards without
  // changing the canonical service used by a direct booking/quote request.
  covered.addAll(shop.hiddenPriceMenuOptions
      .map((option) => (option.serviceId, option.variantId)).where(known.contains));
  for(final group in shop.priceMenu){
    for(final item in group.items){
      final link=item.booking;
      // A configured row also represents its service when the whole shop is
      // missing a schedule. Avoid duplicating it as an inactive fallback card.
      final coversWithoutSchedule = shop.hasConfiguredBookingSchedule == false &&
          item.bookingEnabled && item.bookingUnavailableReason == 'NO_SCHEDULE';
      if ((!item.canStartBooking && !coversWithoutSchedule) ||
          link == null || link.addOnId != null) {
        continue;
      }
      final identity=(link.serviceId,link.variantId);
      if(known.contains(identity)){covered.add(identity);}
    }
  }
  return canonical.where((choice)=>!covered.contains(choice.identity)).toList(growable:false);
}
