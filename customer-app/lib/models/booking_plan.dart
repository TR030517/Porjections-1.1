import 'booking.dart';
import 'service_duration.dart';
import 'booking_calendar.dart';

/// A participant's ordered service selection. Prices and offsets are never sent.
class PlanServiceSelection {
  final String? serviceId;
  final String? variantId;
  final String? therapistId;
  final List<String> addOnIds;
  const PlanServiceSelection({
    this.serviceId,
    this.variantId,
    this.therapistId,
    this.addOnIds = const [],
  });

  Map<String, dynamic> toJson(int participantIndex, int sequence) => {
    'participantIndex': participantIndex,
    'sequence': sequence,
    'serviceId': serviceId,
    if (variantId != null) 'variantId': variantId,
    if (therapistId != null) 'therapistId': therapistId,
  };
}

class PlanQuoteItem {
  final int participantIndex;
  final int sequence;
  final String serviceId;
  final String serviceName;
  final String? variantId;
  final String? variantName;
  final int durationMin;
  final int offsetMin;
  final int preparationMin;
  final int priceCents;
  final String currency;
  final String durationKind;
  int get reservedDurationMin => durationMin;
  String get reservationLabel => reservedDurationLabel(durationKind, durationMin);

  PlanQuoteItem.fromJson(Map<String, dynamic> json)
    : participantIndex = (json['participantIndex'] as num).toInt(),
      sequence = (json['sequence'] as num).toInt(),
      serviceId = json['serviceId'].toString(),
      serviceName = json['serviceName'] as String,
      variantId = json['variantId']?.toString(),
      variantName = json['variantName'] as String?,
      durationMin = readReservedMinutes(json),
      durationKind = readDurationKind(json),
      offsetMin = (json['offsetMin'] as num).toInt(),
      preparationMin = (json['preparationMin'] as num).toInt(),
      priceCents = (json['priceCents'] as num).toInt(),
      currency = (json['currency'] as String).toLowerCase();
}

class BookingPlanQuote {
  final BookingCalendar? bookingCalendar;
  final String date;
  final String timezone;
  final int durationMin;
  final int participantCount;
  final int priceCents;
  final List<PlanQuoteItem> items;
  final List<TimeSlot> slots;
  int get reservedDurationMin => durationMin;
  String get durationKind => combinedDurationKind(items.map((row) => row.durationKind));
  BookingPlanQuote.fromJson(Map<String, dynamic> json)
    : bookingCalendar = BookingCalendar.parse(json['bookingCalendar'],timezone:json['timezone'] as String?),
      date = json['date'] as String,
      timezone = json['timezone'] as String,
      durationMin = readReservedMinutes(json),
      participantCount = (json['participantCount'] as num).toInt(),
      priceCents = (json['priceCents'] as num).toInt(),
      items = (json['items'] as List)
          .map(
            (row) =>
                PlanQuoteItem.fromJson(Map<String, dynamic>.from(row as Map)),
          )
          .toList(growable: false),
      slots = (json['slots'] as List)
          .map(
            (row) => TimeSlot.fromJson(Map<String, dynamic>.from(row as Map)),
          )
          .toList(growable: false) {
    if (json.containsKey('durationKind') && readDurationKind(json, allowMixed: true) != durationKind) throw const FormatException('Plan duration type needs review');
  }

  String? get currency {
    if (items.isEmpty) return null;
    final value = items.first.currency;
    return RegExp(r'^[a-z]{3}$').hasMatch(value) &&
            items.every((item) => item.currency == value)
        ? value
        : null;
  }
}

/// Parse a typed amount without floating point rounding. Empty means no tip.
int? parseTipCents(String text) {
  final value = text.trim();
  if (value.isEmpty) return 0;
  if (!RegExp(r'^\d{1,5}(?:\.\d{0,2})?$').hasMatch(value)) return null;
  final parts = value.split('.');
  final cents =
      int.parse(parts.first) * 100 +
      int.parse(parts.length == 1 ? '0' : parts[1].padRight(2, '0'));
  return cents <= 9999999 ? cents : null;
}

String planClockTime(String startTime, int offsetMin) {
  final parts = startTime.split(':');
  if (parts.length != 2) return '—';
  final hour = int.tryParse(parts[0]);
  final minute = int.tryParse(parts[1]);
  if (hour == null || minute == null || hour > 23 || minute > 59) return '—';
  final value = hour * 60 + minute + offsetMin;
  final day = value ~/ 1440;
  final clock =
      '${((value % 1440) ~/ 60).toString().padLeft(2, '0')}:${(value % 60).toString().padLeft(2, '0')}';
  return day == 0 ? clock : '$clock (+$day)';
}

class BookingListQuery {
  final String shopId;
  final String view;
  final int page;
  final int pageSize;
  final String status;
  final String paymentStatus;
  final String paymentMode;
  final String search;
  final String startDate;
  final String endDate;
  const BookingListQuery({
    this.shopId = '',
    this.view = 'ALL',
    this.page = 1,
    this.pageSize = 25,
    this.status = '',
    this.paymentStatus = '',
    this.paymentMode = '',
    this.search = '',
    this.startDate = '',
    this.endDate = '',
  });

  Map<String, dynamic> toJson() => {
    if (shopId.isNotEmpty) 'shopId': shopId,
    if (view != 'ALL') 'view': view,
    'page': page,
    'pageSize': pageSize,
    if (status.isNotEmpty) 'status': status,
    if (paymentStatus.isNotEmpty) 'paymentStatus': paymentStatus,
    if (paymentMode.isNotEmpty) 'paymentMode': paymentMode,
    if (search.trim().isNotEmpty) 'search': search.trim(),
    if (startDate.isNotEmpty) 'startDate': startDate,
    if (endDate.isNotEmpty) 'endDate': endDate,
  };

  BookingListQuery atPage(int value) => BookingListQuery(
    shopId: shopId,
    view: view,
    page: value,
    pageSize: pageSize,
    status: status,
    paymentStatus: paymentStatus,
    paymentMode: paymentMode,
    search: search,
    startDate: startDate,
    endDate: endDate,
  );

  BookingListQuery withView(String value) => value == view ? this : BookingListQuery(
    shopId: shopId,
    view: value,
    pageSize: pageSize,
    paymentStatus: paymentStatus,
    paymentMode: paymentMode,
    search: search,
    startDate: startDate,
    endDate: endDate,
  );
}

class BookingPage {
  final List<Booking> items;
  final int total;
  final int page;
  final int pageSize;
  final int totalPages;
  const BookingPage({
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
    required this.totalPages,
  });
  factory BookingPage.fromJson(Map<String, dynamic> json) => BookingPage(
    items: (json['items'] as List)
        .map((row) => Booking.fromJson(Map<String, dynamic>.from(row as Map)))
        .toList(),
    total: (json['total'] as num).toInt(),
    page: (json['page'] as num).toInt(),
    pageSize: (json['pageSize'] as num).toInt(),
    totalPages: (json['totalPages'] as num).toInt(),
  );
}
