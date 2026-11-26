import 'money.dart';
import '../navigation/customer_routes.dart';
import 'media_url.dart';
import 'shop_price_menu_pricing.dart';
import 'booking_add_on.dart';
import 'service_duration.dart';
import 'shop_contacts.dart';
import 'booking_order_policy.dart';
import 'booking_calendar.dart';
export 'shop_price_menu_pricing.dart';

String? _publicShopPhone(Map<String, dynamic> json) {
  final phones = publicShopPhones(json);
  return phones.isEmpty ? null : phones.first;
}

String? safeShopMediaUrl(dynamic value) {
  return resolveCustomerMediaUrl(value);
}

class ShopMedia {
  final String? logoUrl;
  final String? coverUrl;
  final String? posterUrl;
  final List<String> galleryUrls;
  const ShopMedia({
    this.logoUrl,
    this.coverUrl,
    this.posterUrl,
    this.galleryUrls = const [],
  });
  factory ShopMedia.fromJson(Map<dynamic, dynamic> json) => ShopMedia(
    logoUrl: safeShopMediaUrl(json['logoUrl']),
    coverUrl: safeShopMediaUrl(json['coverUrl']),
    posterUrl: safeShopMediaUrl(json['posterUrl']),
    galleryUrls: (json['galleryUrls'] as List<dynamic>? ?? const [])
        .map(safeShopMediaUrl)
        .whereType<String>()
        .toSet()
        .toList(),
  );
  List<String> get photos =>
      <String>{?coverUrl, ...galleryUrls, ?posterUrl}.toList();
}

/// MJAPP — Shop model
class Shop {
  final bool listingDetailsIncomplete;
  final String id;
  final String name;
  final String? nameEn;
  final String? description;
  final String? phone;
  final String address;
  final String city;
  final String state;
  final String? zipCode;
  final double latitude;
  final double longitude;
  final String category;
  final String? shopType;
  final double avgRating;
  final int reviewCount;
  final int bookingCount;
  final double? distanceKm;
  final String? thumbnail;
  final String? canonicalShortName;
  final String? canonicalPath;
  final ShopMedia? media;

  Shop({
    this.listingDetailsIncomplete = false,
    required this.id,
    required this.name,
    this.nameEn,
    this.description,
    this.phone,
    required this.address,
    required this.city,
    required this.state,
    this.zipCode,
    required this.latitude,
    required this.longitude,
    required this.category,
    this.shopType,
    required this.avgRating,
    required this.reviewCount,
    required this.bookingCount,
    this.distanceKm,
    this.thumbnail,
    this.canonicalShortName,
    this.canonicalPath,
    this.media,
  });

  factory Shop.fromJson(Map<String, dynamic> json) {
    final media = json['media'] is Map
        ? ShopMedia.fromJson(json['media'] as Map)
        : null;
    return Shop(
      listingDetailsIncomplete: json['listingDetailsIncomplete'] == true,
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      nameEn: json['nameEn'],
      description: json['description'],
      phone: _publicShopPhone(json),
      address: json['address'] ?? '',
      city: json['city'] ?? '',
      state: json['state'] ?? '',
      zipCode: json['zipCode'],
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      category: json['category'] ?? '',
      shopType: json['shopType'],
      avgRating: (json['avgRating'] as num?)?.toDouble() ?? 0.0,
      reviewCount: json['reviewCount'] ?? 0,
      bookingCount: json['bookingCount'] ?? 0,
      distanceKm: (json['distanceKm'] as num?)?.toDouble(),
      thumbnail: media != null
          ? (media.photos.isEmpty ? null : media.photos.first)
          : safeShopMediaUrl(json['thumbnail']),
      canonicalShortName: json['canonicalShortName'] as String?,
      canonicalPath: safeCanonicalShopPath(json['canonicalPath'] as String?),
      media: media,
    );
  }

  String get categoryLabel {
    switch (category) {
      case 'TUINA':
        return 'Tui Na';
      case 'REFLEXOLOGY':
        return 'Foot Massage';
      case 'CUPPING':
        return 'Cupping';
      case 'SCRAPING':
        return 'Scraping';
      case 'MIXED':
        return 'Mixed';
      default:
        return category;
    }
  }

  String get formattedDistance {
    if (distanceKm == null) return '';
    if (distanceKm! < 1) {
      return '${(distanceKm! * 1000).round()}m';
    }
    return '${distanceKm!.toStringAsFixed(1)}km';
  }
}

class ShopServiceVariant {
  final String id;
  final String name;
  final int durationMin;
  final int priceCents;
  final String currency;
  final bool isActive;
  final String priceBasis;
  final String durationKind;
  int get reservedDurationMin => durationMin;

  const ShopServiceVariant({
    required this.id,
    required this.name,
    required this.durationMin,
    required this.priceCents,
    this.currency = 'usd',
    this.isActive = true,
    this.priceBasis = 'PER_PERSON',
    this.durationKind = 'TIMED',
  });
  factory ShopServiceVariant.fromJson(Map<String, dynamic> json, {String parentKind = 'TIMED', bool perOrder = false}) {
    final kind = json.containsKey('durationKind') ? readDurationKind(json) : parentKind;
    if (kind != parentKind) throw const FormatException('Variant duration type conflicts with its parent');
    return ShopServiceVariant(
        id: json['id']?.toString() ?? '',
        name: json['name'] ?? '',
        durationMin: readReservedMinutes(json),
        durationKind: kind,
        priceCents: json['priceCents'] ?? 0,
        currency: (json['currency'] as String?)?.toLowerCase() ?? 'usd',
        isActive: json['isActive'] == true,
        priceBasis: perOrder || json['pricingPolicy'] == 'PER_ORDER' ? 'PER_BOOKING' : json['priceBasis'] as String? ?? 'PER_PERSON',
      );
  }
  String get formattedPrice => formatCents(priceCents, currency);
}

class ShopService {
  final String id;
  final String name;
  final String? nameEn;
  final String category;
  final int durationMin;
  final int priceCents;
  final String currency;
  final String? description;
  final int participantCount;
  final int requiredStaffCount;
  final List<ShopServiceVariant> variants;
  final bool variantsConfigured;
  final String priceBasis;
  final String durationKind;
  int get reservedDurationMin => durationMin;
  final List<ShopServiceAddOn> addOns;

  ShopService({
    required this.id,
    required this.name,
    this.nameEn,
    required this.category,
    required this.durationMin,
    required this.priceCents,
    this.currency = 'usd',
    this.description,
    this.participantCount = 1,
    int? requiredStaffCount,
    this.variants = const [],
    this.variantsConfigured = false,
    this.priceBasis = 'PER_PERSON',
    this.durationKind = 'TIMED',
    this.addOns = const [],
  }) : requiredStaffCount = requiredStaffCount ?? participantCount;

  factory ShopService.fromJson(Map<String, dynamic> json) {
    final kind = readDurationKind(json);
    return ShopService(
      id: (json['id'] ?? json['serviceId'])?.toString() ?? '',
      name: json['name'] ?? '',
      nameEn: json['nameEn'],
      category: json['category'] ?? '',
      durationMin: readReservedMinutes(json),
      durationKind: kind,
      priceCents: json['priceCents'] ?? 0,
      currency: (json['currency'] as String?)?.toLowerCase() ?? 'usd',
      description: json['description'],
      participantCount: json['participantCount'] ?? 1,
      requiredStaffCount: json['requiredStaffCount'],
      variants:
          (json['variants'] as List<dynamic>?)
              ?.map(
                (value) => ShopServiceVariant.fromJson(
                  Map<String, dynamic>.from(value as Map), parentKind: kind, perOrder: json['pricingPolicy'] == 'PER_ORDER',
                ),
              )
              .toList() ??
          const [],
      variantsConfigured: json['hasVariants'] == true,
      priceBasis: json['pricingPolicy'] == 'PER_ORDER' ? 'PER_BOOKING' : json['priceBasis'] as String? ?? 'PER_PERSON',
      addOns: ShopServiceAddOn.parseList(json['addOns'], (json['id'] ?? json['serviceId'])?.toString() ?? ''),
    );
  }

  List<ShopServiceVariant> get activeVariants => variants
      .where(
        (item) =>
            item.isActive && item.durationKind == durationKind &&
            item.durationMin >= 5 &&
            item.durationMin <= 240 &&
            item.priceCents > 0 &&
            const {'PER_PERSON', 'PER_BOOKING'}.contains(item.priceBasis) &&
            item.currency == 'usd',
      )
      .toList();
  bool get hasVariants => variantsConfigured || variants.isNotEmpty;
  bool get canBook =>
      serviceDurationKinds.contains(durationKind) && ((participantCount == 1 && (requiredStaffCount == 1 || requiredStaffCount == 2)) || (participantCount == 2 && requiredStaffCount == 2)) &&
      currency == 'usd' &&
      (hasVariants
          ? activeVariants.isNotEmpty
          : durationMin >= 5 &&
                durationMin <= 240 &&
                priceCents > 0 &&
                const {'PER_PERSON', 'PER_BOOKING'}.contains(priceBasis));
  int? get startingPriceCents {
    if (participantCount != 1 && participantCount != 2) return null;
    if (!hasVariants) {
      return const {'PER_PERSON', 'PER_BOOKING'}.contains(priceBasis)
          ? priceCents * (priceBasis == 'PER_BOOKING' ? 1 : participantCount)
          : null;
    }
    if (activeVariants.isEmpty) return null;
    return activeVariants
        .map(
          (item) =>
              item.priceCents *
              (item.priceBasis == 'PER_BOOKING' ? 1 : participantCount),
        )
        .reduce((a, b) => a < b ? a : b);
  }

  String get formattedPrice => startingPriceCents == null
      ? '—'
      : formatCents(startingPriceCents!, currency);
  String get durationRange {
    if (!hasVariants) return '$durationMin';
    final durations = activeVariants.map((item) => item.durationMin).toList()
      ..sort();
    if (durations.isEmpty) return '—';
    return durations.first == durations.last
        ? '${durations.first}'
        : '${durations.first}–${durations.last}';
  }

  String get formattedDuration => durationKind == 'TIMED' ? '$durationRange min' : durationKindLabel(durationKind);
  String reservationLabel(int minutes) => reservedDurationLabel(durationKind, minutes);
  String get categoryLabel {
    switch (category) {
      case 'MASSAGE':
        return 'Massage';
      case 'REFLEXOLOGY':
        return 'Reflexology';
      case 'CUPPING':
        return 'Cupping';
      case 'SCRAPING':
        return 'Scraping';
      case 'HEAD_THERAPY':
        return 'Head Therapy';
      case 'OTHER':
        return 'Other';
      default:
        return category;
    }
  }
}

class ShopPriceMenuBooking {
  final String serviceId;
  final String? variantId, addOnId;
  const ShopPriceMenuBooking({required this.serviceId, this.variantId, this.addOnId});
  static ShopPriceMenuBooking? parse(dynamic value) {
    bool id(dynamic raw) => raw is String && RegExp(r'^[1-9]\d{0,18}$').hasMatch(raw) && BigInt.parse(raw) <= BigInt.parse('9223372036854775807');
    if (value is! Map || !id(value['serviceId']) || value['variantId'] != null && !id(value['variantId']) ||
        value['addOnId'] != null && !id(value['addOnId']) || value['variantId'] != null && value['addOnId'] != null) {
      return null;
    }
    return ShopPriceMenuBooking(serviceId: value['serviceId'], variantId: value['variantId'], addOnId: value['addOnId']);
  }
}

/// Only explicit same-shop links returned by the server can start a booking.
class ShopPriceMenuItem {
  final String? id;
  final String name;
  final String priceText;
  final String description;
  final String? imageUrl;
  final ShopPriceMenuPricing? pricing;
  final bool isVisible;
  final bool bookingEnabled;
  final bool? bookingAvailable;
  final String? bookingUnavailableReason;
  final ShopPriceMenuBooking? booking;
  final int? reservedDurationMin;
  final String? bookingMode;
  const ShopPriceMenuItem({required this.name, this.priceText = '',
    this.description = '', this.imageUrl, this.pricing, this.id, this.isVisible = true, this.bookingEnabled = false, this.bookingAvailable, this.bookingUnavailableReason, this.booking, this.reservedDurationMin, this.bookingMode});
  bool get canStartBooking => isVisible && bookingEnabled && (bookingAvailable ?? bookingEnabled) && booking != null && booking!.addOnId == null && pricing?.kind != 'ADD_ON';
  ShopPriceMenuPricing? get displayPricing {
    final value = pricing;
    return value != null && priceText == '' && name.trim().isNotEmpty &&
        (value.titleMode == 'CUSTOM' || value.matchesAutomaticTitle(name))
        ? value : null;
  }
  String get displayName {
    final value = displayPricing;
    return value?.titleMode == 'AUTO' ? value!.automaticTitle : name;
  }
  static ShopPriceMenuItem? parse(dynamic value) {
    if (value is! Map || value['name'] is! String ||
        value['priceText'] is! String ||
        value.containsKey('isVisible') && value['isVisible'] is! bool) {
      return null;
    }
    final name = (value['name'] as String).trim();
    if (name.isEmpty) return null;
    var pricing = ShopPriceMenuPricing.parse(value['pricing']);
    if (pricing != null &&
        (value['priceText'] != '' ||
            pricing.titleMode == 'AUTO' &&
                !pricing.matchesAutomaticTitle(value['name']))) {
      pricing = null;
    }
    return ShopPriceMenuItem(name: pricing?.titleMode == 'AUTO' ? pricing!.automaticTitle : name,
      priceText: value['priceText'] as String,
      isVisible: value['isVisible'] != false,
      id: value['id'] is String ? value['id'] : null,
      booking: ShopPriceMenuBooking.parse(value['booking']), bookingEnabled: value['bookingEnabled'] == true,
      bookingAvailable: value.containsKey('bookingAvailable') ? value['bookingAvailable'] == true : null,
      bookingUnavailableReason: value['bookingUnavailableReason'] is String
          ? value['bookingUnavailableReason'] as String : null,
      reservedDurationMin: value['reservedDurationMin'] is int ? value['reservedDurationMin'] : null,
      bookingMode: value['bookingMode'] is String ? value['bookingMode'] : null,
      description: value['description'] is String ? value['description'] as String : '',
      imageUrl: resolveCustomerMediaUrl(value['imageUrl'], allowServiceGallery: true),
      pricing: pricing);
  }
}

class ShopPriceMenuGroup {
  final String category;
  final List<ShopPriceMenuItem> items;
  const ShopPriceMenuGroup({required this.category, required this.items});
  static List<ShopPriceMenuGroup> parse(dynamic value) {
    if (value is! List) return const [];
    return value.whereType<Map>().where((g) => g['items'] is List).map((g) =>
      ShopPriceMenuGroup(category: g['category'] is String ? g['category'] as String : '',
        items: (g['items'] as List).map(ShopPriceMenuItem.parse)
          .whereType<ShopPriceMenuItem>().where((item) => item.isVisible).toList()))
      .where((g) => g.items.isNotEmpty).toList();
  }
}

class Therapist {
  final String id;
  final String name;
  final String? avatarUrl;
  final String? title;
  final String? bio;
  final int yearsExp;
  final String? gender;
  final List<ShopService> services;

  /// Translate only the known system default; custom merchant copy is retained.
  String? get publicTitle => title?.trim() == '按摩技师' ? 'Massage therapist' : title;

  Therapist({
    required this.id,
    required this.name,
    this.avatarUrl,
    this.title,
    this.bio,
    required this.yearsExp,
    this.gender,
    required this.services,
  });

  factory Therapist.fromJson(Map<String, dynamic> json) {
    return Therapist(
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      avatarUrl: resolveCustomerMediaUrl(json['avatarUrl']),
      title: json['title'],
      bio: json['bio'],
      yearsExp: json['yearsExp'] ?? 0,
      gender: json['gender'],
      services:
          (json['services'] as List<dynamic>?)
              ?.map((s) => ShopService.fromJson(s as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class CustomerClosedPeriod {
  final String startDate;
  final String endDate;
  const CustomerClosedPeriod({required this.startDate, required this.endDate});
  static CustomerClosedPeriod? parse(dynamic value) {
    if (value is! Map) return null;
    final start = value['startDate'], end = value['endDate'];
    bool valid(dynamic input) {
      if (input is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(input)) return false;
      final date = DateTime.tryParse('${input}T00:00:00Z');
      return date != null && date.toIso8601String().substring(0, 10) == input;
    }
    if (!valid(start) || !valid(end) || start.compareTo(end) > 0) return null;
    return CustomerClosedPeriod(startDate: start, endDate: end);
  }
}

class CustomerBookingSettings {
  final int minimumNoticeMinutes;
  final List<CustomerClosedPeriod> closedPeriods;
  const CustomerBookingSettings({this.minimumNoticeMinutes = 0, this.closedPeriods = const []});
  static CustomerBookingSettings parse(dynamic value) {
    if (value is! Map) return const CustomerBookingSettings();
    final raw = value['minimumNoticeMinutes'];
    final notice = raw is int && raw >= 0 && raw <= 10080 ? raw : 0;
    final periods = value['closedPeriods'];
    return CustomerBookingSettings(minimumNoticeMinutes: notice,
      closedPeriods: periods is List ? periods.map(CustomerClosedPeriod.parse).whereType<CustomerClosedPeriod>().toList() : const []);
  }
}

class ShopDetail {
  final bool listingDetailsIncomplete;
  final String id;
  final String name;
  final String? nameEn;
  final String? description;
  final String? phone;
  final List<String> phones;
  final List<String> emails;
  final Map<String, String> externalLinks;
  final String? mapShareUrl;
  final String address;
  final String city;
  final String state;
  final String zipCode;
  final double latitude;
  final double longitude;
  final String category;
  final double avgRating;
  final int reviewCount;
  final int bookingCount;
  final List<ShopImage> images;
  final List<ShopService> services;
  final List<Therapist> therapists;
  final bool onlineBookingEnabled;
  final bool? hasConfiguredBookingSchedule;
  final bool reviewsEnabled;
  final bool payAtStoreEnabled;
  final bool onlinePaymentEnabled;
  final bool orderOnly;
  final String pricingPolicy;
  final bool requiresCustomerEmail;
  final BookingCalendar? bookingCalendar;
  final CustomerBookingSettings bookingSettings;
  final String brandColor;
  final String buttonShape;
  bool get usesOrderPricing => pricingPolicy == 'PER_ORDER';
  final String? canonicalShortName;
  final String? canonicalPath;
  final ShopMedia? media;
  final String? subtitle;
  final String? timezone;
  final List<String> tags;
  final Map<String, dynamic> businessHours;
  final List<ShopPriceMenuGroup> priceMenu;
  final List<ShopPriceMenuBooking> hiddenPriceMenuOptions;
  bool get hasBookableServices => services.any((service) => service.canBook);
  bool get hasBookablePriceMenuItems => priceMenu.any((group) => group.items.any((item) {
    if (!item.canStartBooking) return false;
    final link = item.booking;
    final service = services.where((candidate) => candidate.id == link?.serviceId && candidate.canBook);
    if (service.isEmpty) return false;
    final variantId = link?.variantId;
    return variantId == null || service.first.activeVariants.any((variant) => variant.id == variantId);
  }));
  bool get hasBookableOptions => hasBookableServices || hasBookablePriceMenuItems;
  bool get canBookOnline => !listingDetailsIncomplete && onlineBookingEnabled &&
      hasConfiguredBookingSchedule != false && hasBookableOptions;

  ShopDetail({
    this.listingDetailsIncomplete = false,
    required this.id,
    required this.name,
    this.nameEn,
    this.description,
    this.phone,
    this.phones = const [],
    this.emails = const [],
    this.externalLinks = const {},
    this.mapShareUrl,
    required this.address,
    required this.city,
    required this.state,
    this.zipCode = '',
    required this.latitude,
    required this.longitude,
    required this.category,
    required this.avgRating,
    required this.reviewCount,
    required this.bookingCount,
    required this.images,
    required this.services,
    required this.therapists,
    this.onlineBookingEnabled = true,
    this.hasConfiguredBookingSchedule,
    this.reviewsEnabled = true,
    this.payAtStoreEnabled = false,
    this.onlinePaymentEnabled = false,
    this.orderOnly = true,
    this.pricingPolicy = 'PER_ORDER',
    this.requiresCustomerEmail = true,
    this.bookingCalendar,
    this.bookingSettings = const CustomerBookingSettings(),
    this.brandColor = 'teal',
    this.buttonShape = 'rounded',
    this.canonicalShortName,
    this.canonicalPath,
    this.media,
    this.subtitle,
    this.timezone,
    this.tags = const [],
    this.businessHours = const {},
    this.priceMenu = const [],
    this.hiddenPriceMenuOptions = const [],
  });

  factory ShopDetail.fromJson(Map<String, dynamic> json) {
    final features = json['features'];
    final paymentEnabled = bookingOnlinePaymentEnabled(json);
    final pricingPolicy = json['pricingPolicy'] as String? ?? 'PER_ORDER';
    final media = json['media'] is Map
        ? ShopMedia.fromJson(json['media'] as Map)
        : null;
    return ShopDetail(
      listingDetailsIncomplete: json['listingDetailsIncomplete'] == true,
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      nameEn: json['nameEn'],
      description: json.containsKey('about')
          ? json['about']
          : json['description'],
      phone: _publicShopPhone(json),
      phones: publicShopPhones(json),
      emails: publicShopEmails(json),
      externalLinks: publicShopExternalLinks(json['links']),
      mapShareUrl: publicContactText(json['mapShareUrl'], 4096),
      address: publicContactText(json['address'], 500) ?? '',
      city: publicContactText(json['city'], 500) ?? '',
      state: publicContactText(json['state'], 500) ?? '',
      zipCode: publicContactText(json['zipCode'], 500) ?? '',
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      category: json['category'] ?? '',
      avgRating: (json['avgRating'] as num?)?.toDouble() ?? 0.0,
      reviewCount: json['reviewCount'] ?? 0,
      bookingCount: json['bookingCount'] ?? 0,
      onlineBookingEnabled:
          features is! Map || features['onlineBooking'] != false,
      hasConfiguredBookingSchedule: json['hasConfiguredBookingSchedule'] is bool
          ? json['hasConfiguredBookingSchedule'] as bool : null,
      reviewsEnabled: features is! Map || features['reviews'] != false,
      payAtStoreEnabled:
          json['paymentPolicy'] is Map &&
          (json['paymentPolicy'] as Map)['payAtStoreEnabled'] == true,
      onlinePaymentEnabled: paymentEnabled,
      orderOnly: !paymentEnabled,
      pricingPolicy: pricingPolicy,
      requiresCustomerEmail: json['requiresCustomerEmail'] != false,
      bookingCalendar: BookingCalendar.parse(json['bookingCalendar'],timezone:json['timezone'] as String?),
      bookingSettings: CustomerBookingSettings.parse(json['bookingSettings']),
      brandColor: const {'teal', 'forest', 'blue', 'rose', 'slate'}.contains(json['brandColor']) ? json['brandColor'] as String : 'teal',
      buttonShape: const {'rounded', 'pill', 'square'}.contains(json['buttonShape']) ? json['buttonShape'] as String : 'rounded',
      canonicalShortName: json['canonicalShortName'] as String?,
      canonicalPath: safeCanonicalShopPath(json['canonicalPath'] as String?),
      media: media,
      subtitle: json['subtitle'] as String?,
      timezone: json['timezone'] as String?,
      tags: (json['tags'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .map((tag) => tag.trim())
          .where((tag) => tag.isNotEmpty)
          .toList(),
      businessHours: json['businessHours'] is Map
          ? Map<String, dynamic>.from(json['businessHours'] as Map)
          : const {},
      priceMenu: ShopPriceMenuGroup.parse(json['priceMenu']),
      hiddenPriceMenuOptions: (json['hiddenPriceMenuOptions'] is List
              ? json['hiddenPriceMenuOptions'] as List : const [])
          .map(ShopPriceMenuBooking.parse).whereType<ShopPriceMenuBooking>()
          .where((option) => option.addOnId == null).toList(),
      images: media != null
          ? media.photos
                .asMap()
                .entries
                .map(
                  (entry) => ShopImage(
                    id: 'media-${entry.key}',
                    imageUrl: entry.value,
                    imageType: entry.key == 0 ? 'COVER' : 'GALLERY',
                    sortOrder: entry.key,
                  ),
                )
                .toList()
          : (json['images'] as List<dynamic>?)
                    ?.map((i) => ShopImage.fromJson(i as Map<String, dynamic>))
                    .where((image) => image.imageUrl.isNotEmpty)
                    .toList() ??
                [],
      services:
          (json['services'] as List<dynamic>?)
              ?.map((s) => ShopService.fromJson({...Map<String,dynamic>.from(s as Map), 'pricingPolicy': pricingPolicy}))
              .toList() ??
          [],
      therapists:
          (json['therapists'] as List<dynamic>?)
              ?.map((t) => Therapist.fromJson(t as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class ShopImage {
  final String id;
  final String imageUrl;
  final String imageType;
  final int sortOrder;

  ShopImage({
    required this.id,
    required this.imageUrl,
    required this.imageType,
    required this.sortOrder,
  });

  factory ShopImage.fromJson(Map<String, dynamic> json) {
    return ShopImage(
      id: json['id']?.toString() ?? '',
      imageUrl: safeShopMediaUrl(json['imageUrl']) ?? '',
      imageType: json['imageType'] ?? '',
      sortOrder: json['sortOrder'] ?? 0,
    );
  }
}

class ShopListResponse {
  final List<Shop> items;
  final int total;
  final int page;
  final int limit;
  final int totalPages;

  ShopListResponse({
    required this.items,
    required this.total,
    required this.page,
    required this.limit,
    required this.totalPages,
  });

  factory ShopListResponse.fromJson(Map<String, dynamic> json) {
    return ShopListResponse(
      items:
          (json['items'] as List<dynamic>?)
              ?.map((s) => Shop.fromJson(s as Map<String, dynamic>))
              .toList() ??
          [],
      total: json['total'] ?? 0,
      page: json['page'] ?? 1,
      limit: json['limit'] ?? 20,
      totalPages: json['totalPages'] ?? 0,
    );
  }
}
