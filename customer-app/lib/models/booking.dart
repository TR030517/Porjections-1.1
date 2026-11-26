import 'booking_contact.dart';
import 'money.dart';
import 'booking_add_on.dart';
import 'service_duration.dart';
import 'booking_order_policy.dart';
import 'booking_calendar.dart';
import 'therapist_selection.dart';

/// MJAPP — Booking model
class Booking {
  final String id;
  final String bookingNo;
  final String userId;
  final String shopId;
  final String? therapistId;
  final TherapistSelection therapistSelection;
  final int? participantCount, requiredStaffCount;
  final String serviceId;
  final String bookingDate;
  final String startTime;
  final String endTime;
  final int durationMin;
  final int priceCents;
  final int discountCents;
  final int? platformFeeCents;
  final int? totalCents;
  final int? paidCents;
  final int? refundedCents;
  final String paymentMode;
  final bool orderOnly;
  final bool onlinePaymentEnabled;
  bool get isOfflineOrder => orderOnly && paymentMode == 'PAY_AT_STORE';
  final String reservationKind;
  final int? tipCents;
  final int? amountDueCents;
  final List<BookingItem> items;
  final List<BookingAddOnLine> addOns;
  final int? mainSubtotalCents;
  final int addOnSubtotalCents;
  final String? holdExpiresAt;
  final String? currency;
  final String? timezone;
  final String? localDate;
  final String? localStartTime;
  final String? localEndTime;
  final String status;
  final String paymentStatus;
  final String? cancelReason;
  final String? notes;
  final BookingContact? contact;
  final bool contactRecorded;
  final String? createdAt;
  final ShopInfo? shop;
  final ServiceInfo? service;
  final TherapistInfo? therapist;
  final bool hasReview;
  int get reservedDurationMin => durationMin;
  String get durationKind => combinedDurationKind(items.map((row) => row.durationKind));
  String get reservationLabel => reservedDurationLabel(durationKind, durationMin, span: reservationKind == 'PLAN');
  List<MainDuration> get mainDurations => [for (final row in items)
    if (row.serviceId != null && row.durationMin != null) MainDuration(participantIndex: row.participantIndex, sequence: row.sequence,
      serviceId: row.serviceId!, variantId: row.variantId, durationKind: row.durationKind, reservedDurationMin: row.durationMin!),
  ];
  List<BookingReceiptStaff> get staffItems => [for (final row in items)
    BookingReceiptStaff(participantIndex: row.participantIndex, sequence: row.sequence,
      requiredStaffCount: row.requiredStaffCount, therapistSelection: row.therapistSelection),
  ];

  Booking({
    required this.id,
    required this.bookingNo,
    required this.userId,
    required this.shopId,
    this.therapistId,
    this.therapistSelection = const TherapistSelection.legacy(),
    this.participantCount,
    this.requiredStaffCount,
    required this.serviceId,
    required this.bookingDate,
    required this.startTime,
    required this.endTime,
    required this.durationMin,
    required this.priceCents,
    this.discountCents = 0,
    this.platformFeeCents,
    this.totalCents,
    this.paidCents,
    this.refundedCents,
    this.paymentMode = 'ONLINE',
    this.orderOnly = true,
    this.onlinePaymentEnabled = false,
    this.reservationKind = 'STANDARD',
    this.tipCents,
    this.amountDueCents,
    this.items = const [],
    this.addOns = const [],
    this.mainSubtotalCents,
    this.addOnSubtotalCents = 0,
    this.holdExpiresAt,
    this.currency,
    this.timezone,
    this.localDate,
    this.localStartTime,
    this.localEndTime,
    required this.status,
    required this.paymentStatus,
    this.cancelReason,
    this.notes,
    this.contact,
    this.contactRecorded = false,
    this.createdAt,
    this.shop,
    this.service,
    this.therapist,
    this.hasReview = false,
  });

  factory Booking.fromJson(Map<String, dynamic> json) {
    final parsedItems = (json['items'] as List<dynamic>? ?? const []).map((row) => BookingItem.fromJson(Map<String,dynamic>.from(row as Map))).toList(growable: false);
    final kind = combinedDurationKind(parsedItems.map((row) => row.durationKind));
    if (json.containsKey('durationKind') && readDurationKind(json, allowMixed: true) != kind) throw const FormatException('Booking duration type conflicts with saved items');
    final addOns = BookingAddOnLine.parseList(json['addOns']);
    final extra = json['addOnSubtotalCents'] == null ? 0 : addOnInteger(json['addOnSubtotalCents'], 'saved add-on subtotal');
    final main = json['mainSubtotalCents'] == null ? (json['priceCents'] as num?)?.toInt() : addOnInteger(json['mainSubtotalCents'], 'saved main subtotal');
    if (addOns.any((row) => row.id == null || row.bookingItemId == null) ||
        addOns.fold<int>(0, (sum, row) => sum + row.lineTotalCents) != extra ||
        addOns.isNotEmpty && (main == null || main + extra != json['priceCents'])) {
      throw const FormatException('Invalid saved add-on breakdown');
    }
    return Booking(
      contact: json['contact'] is Map && json['contact']['recorded'] == true ? BookingContact.fromJson(json['contact']) : null,
      contactRecorded: json['contact'] is Map && json['contact']['recorded'] == true,
      id: json['id']?.toString() ?? '',
      bookingNo: json['bookingNo'] ?? '',
      userId: json['userId']?.toString() ?? '',
      shopId: json['shopId']?.toString() ?? '',
      therapistId: json['therapistId']?.toString(),
      therapistSelection: TherapistSelection.fromJson(json),
      participantCount: json['participantCount'] as int?,
      requiredStaffCount: json['requiredStaffCount'] as int?,
      serviceId: json['serviceId']?.toString() ?? '',
      bookingDate: json['bookingDate'] ?? '',
      startTime: json['startTime'] ?? '',
      endTime: json['endTime'] ?? '',
      durationMin: readReservedMinutes(json),
      priceCents: json['priceCents'] ?? 0,
      mainSubtotalCents: main,
      addOnSubtotalCents: extra,
      addOns: addOns,
      discountCents: json['discountCents'] ?? 0,
      platformFeeCents: (json['platformFeeCents'] as num?)?.toInt(),
      totalCents: (json['totalCents'] as num?)?.toInt(),
      paidCents: json['paidCents'] is int ? json['paidCents'] as int : null,
      refundedCents: json['refundedCents'] is int ? json['refundedCents'] as int : null,
      paymentMode: json['paymentMode'] as String? ?? 'ONLINE',
      orderOnly: !bookingOnlinePaymentEnabled(json),
      onlinePaymentEnabled: bookingOnlinePaymentEnabled(json),
      reservationKind: json['reservationKind'] as String? ?? 'STANDARD',
      tipCents: (json['tipCents'] as num?)?.toInt(),
      amountDueCents: (json['amountDueCents'] as num?)?.toInt(),
      holdExpiresAt: json['holdExpiresAt'] as String?,
      items: parsedItems,
      currency: (json['currency'] as String?)?.toLowerCase(),
      timezone: json['timezone'] as String?,
      localDate: json['localDate'] as String?,
      localStartTime: json['localStartTime'] as String?,
      localEndTime: json['localEndTime'] as String?,
      status: json['status'] ?? 'PENDING',
      paymentStatus: json['paymentStatus'] ?? 'UNPAID',
      cancelReason: (json['cancelReason'] as String?)?.trim(),
      notes: json['notes'],
      createdAt: json['createdAt'],
      shop: json['shop'] != null ? ShopInfo.fromJson(json['shop']) : null,
      service: json['service'] != null
          ? ServiceInfo.fromJson(json['service'])
          : null,
      therapist: json['therapist'] != null
          ? TherapistInfo.fromJson(json['therapist'])
          : null,
      hasReview: json['hasReview'] == true,
    );
  }

  String _amount(int? value) =>
      value == null || currency == null || currency!.isEmpty
      ? 'Amount unavailable'
      : formatCents(value, currency!);
  String get formattedTotal => _amount(totalCents);
  String get formattedPaid => _amount(paidCents);
  String get formattedRefunded => _amount(refundedCents);
  String get formattedDue => _amount(amountDueCents);
  bool get hasRefundableBalance => (paidCents ?? 0) > (refundedCents ?? 0);
  /// Cancellation releases the reservation; it does not refund collected money.
  /// Missing settlement amounts cannot establish that nothing remains collected.
  bool get canCancel =>
      const {'PENDING', 'CONFIRMED'}.contains(status) &&
      paidCents != null &&
      refundedCents != null &&
      paidCents! >= 0 &&
      refundedCents! >= 0 &&
      paidCents == refundedCents;
  bool get canOpenCheckout =>
      onlinePaymentEnabled && !orderOnly &&
      paymentMode == 'ONLINE' &&
      paymentStatus == 'UNPAID' &&
      status == 'PENDING' &&
      (amountDueCents ?? 0) > 0 &&
      (holdExpiresAt == null ||
          DateTime.tryParse(holdExpiresAt!)?.isAfter(DateTime.now()) == true);
  bool get canReschedule {
    final start = RegExp(r'(?:Z|[+-]\d{2}:?\d{2})$').hasMatch(startTime)
        ? DateTime.tryParse(startTime)
        : null;
    if (items.isEmpty ||
        start == null ||
        !start.isAfter(DateTime.now()) ||
        (refundedCents ?? 0) != 0) {
      return false;
    }
    if (status == 'PENDING' && paymentStatus == 'UNPAID') {
      return holdExpiresAt == null ||
          DateTime.tryParse(holdExpiresAt!)?.isAfter(DateTime.now()) == true;
    }
    return status == 'CONFIRMED' &&
        (paymentMode == 'PAY_AT_STORE' ||
            paymentStatus == 'PAID' &&
                paidCents != null &&
                totalCents != null &&
                paidCents! >= totalCents!);
  }

  String get formattedBasePrice => _amount(priceCents);
  // Legacy displays use the authoritative total as well.
  String get formattedPrice => formattedTotal;

  /// Date formatted as YYYY-MM-DD
  String get formattedDate {
    if (localDate != null &&
        RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(localDate!)) {
      return localDate!;
    }
    if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(bookingDate)) {
      return bookingDate;
    }
    try {
      final dt = DateTime.parse(bookingDate).toUtc();
      return '${dt.year.toString().padLeft(4, '0')}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
    } catch (_) {
      return bookingDate;
    }
  }

  /// Time range formatted as HH:MM - HH:MM
  String get formattedTimeRange {
    if (timezone != null &&
        timezone!.isNotEmpty &&
        localStartTime != null &&
        RegExp(r'^\d{2}:\d{2}$').hasMatch(localStartTime!) &&
        localEndTime != null &&
        RegExp(r'^\d{2}:\d{2}$').hasMatch(localEndTime!)) {
      return '$localStartTime - $localEndTime ($timezone)';
    }
    try {
      // Legacy ISO strings are shown explicitly in UTC, never the device timezone.
      if (!RegExp(r'(?:Z|[+-]\d{2}:?\d{2})$').hasMatch(startTime) ||
          !RegExp(r'(?:Z|[+-]\d{2}:?\d{2})$').hasMatch(endTime)) {
        return 'Shop time unavailable';
      }
      final st = DateTime.parse(startTime).toUtc();
      final et = DateTime.parse(endTime).toUtc();
      String fmt(DateTime t) =>
          '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
      return '${fmt(st)} - ${fmt(et)} (UTC)';
    } catch (_) {
      return 'Shop time unavailable';
    }
  }

  String get statusLabel {
    switch (status) {
      case 'PENDING':
        return 'Pending';
      case 'CONFIRMED':
        return 'Confirmed';
      case 'COMPLETED':
        return 'Completed';
      case 'CANCELLED':
        return 'Cancelled';
      case 'REFUNDING':
        return 'Refunding';
      case 'REFUNDED':
        return 'Refunded';
      default:
        return status;
    }
  }
}

class BookingItem {
  final String id;
  final String? serviceId, variantId;
  final String durationKind;
  int? get reservedDurationMin => durationMin;
  String get reservationLabel => durationMin == null ? durationKindLabel(durationKind) : reservedDurationLabel(durationKind, durationMin!);
  final String serviceName;
  final String? variantName;
  final String? therapistId;
  final List<String> assignedTherapistIds;
  final TherapistSelection therapistSelection;
  final int? participantCount, requiredStaffCount;
  final int participantIndex;
  final int sequence;
  final int offsetMin;
  final int? preparationMin;
  final String? startTime;
  final String? endTime;
  final String? localStartTime;
  final String? localEndTime;
  final String? therapistName;
  final String? priceBasis;
  final int? priceCents;
  final int? durationMin;
  BookingItem.fromJson(Map<String, dynamic> json)
    : id = json['id']?.toString() ?? '',
      serviceId = json['serviceId']?.toString(), variantId = json['variantId']?.toString(),
      durationKind = readItemDurationKind(json),
      serviceName =
          (json['serviceNameSnapshot'] ?? json['serviceName']) as String? ?? '',
      variantName =
          (json['variantNameSnapshot'] ?? json['variantName']) as String?,
      therapistId = (json['assignedTherapistId'] ?? json['therapistId'])?.toString(),
      assignedTherapistIds = (json['assignedTherapistIds'] is List ? (json['assignedTherapistIds'] as List).map((id) => id.toString()).toSet().toList(growable: false) : [if ((json['assignedTherapistId'] ?? json['therapistId']) != null) (json['assignedTherapistId'] ?? json['therapistId']).toString()]),
      therapistSelection = TherapistSelection.fromJson(json),
      participantCount = (json['participantCount'] ?? json['participantCountSnapshot']) as int?,
      requiredStaffCount = (json['requiredStaffCount'] ?? json['requiredStaffCountSnapshot']) as int?,
      participantIndex = (json['participantIndex'] as num?)?.toInt() ?? 1,
      sequence = (json['sequence'] as num?)?.toInt() ?? 1,
      offsetMin = (json['offsetMin'] as num?)?.toInt() ?? 0,
      preparationMin = (json['preparationMin'] as num?)?.toInt(),
      startTime = (json['startAtUtc'] ?? json['startTime']) as String?,
      endTime = (json['endAtUtc'] ?? json['endTime']) as String?,
      localStartTime = json['localStartTime'] as String?,
      localEndTime = json['localEndTime'] as String?,
      therapistName =
          (json['therapistNameSnapshot'] ??
                  (json['therapist'] is Map ? json['therapist']['name'] : null))
              as String?,
      priceBasis = json['priceBasisSnapshot'] as String?,
      priceCents = (json['priceCentsSnapshot'] as num?)?.toInt(),
      durationMin = json.containsKey('durationMin') ? readReservedMinutes(json) : null {
    if (json.containsKey('reservedDurationMin') && !json.containsKey('durationMin') || durationKind != 'TIMED' && (durationMin == null || !validReservedMinutes(durationMin!))) throw const FormatException('Saved reservation block needs review');
  }
}

class ShopInfo {
  final String id;
  final String name;
  final String? address;
  final String? phone;

  ShopInfo({required this.id, required this.name, this.address, this.phone});

  factory ShopInfo.fromJson(Map<String, dynamic> json) => ShopInfo(
    id: json['id']?.toString() ?? '',
    name: json['name'] ?? '',
    address: json['address'],
    phone: json['phone'],
  );
}

class ServiceInfo {
  final String id;
  final String name;
  final int? durationMin;
  final int? priceCents;

  ServiceInfo({
    required this.id,
    required this.name,
    this.durationMin,
    this.priceCents,
  });

  factory ServiceInfo.fromJson(Map<String, dynamic> json) => ServiceInfo(
    id: json['id']?.toString() ?? '',
    name: json['name'] ?? '',
    durationMin: json['durationMin'],
    priceCents: json['priceCents'],
  );
}

class TherapistInfo {
  final String id;
  final String name;

  TherapistInfo({required this.id, required this.name});

  factory TherapistInfo.fromJson(Map<String, dynamic> json) =>
      TherapistInfo(id: json['id']?.toString() ?? '', name: json['name'] ?? '');
}

/// Time slot model
class TimeSlot {
  final String time;
  final bool available;

  TimeSlot({required this.time, required this.available});

  factory TimeSlot.fromJson(Map<String, dynamic> json) =>
      TimeSlot(time: json['time'] ?? '', available: json['available'] ?? false);

  String get displayTime {
    final parts = time.split(':');
    if (parts.length != 2) return time;
    final h = int.parse(parts[0]);
    final m = parts[1];
    final ampm = h >= 12 ? 'PM' : 'AM';
    final hour = h == 0 ? 12 : (h > 12 ? h - 12 : h);
    return '${hour.toString().padLeft(2, '0')}:$m $ampm';
  }
}

/// Slot response
class SlotResponse {
  final BookingCalendar? bookingCalendar;
  final String date;
  final List<TimeSlot> slots;
  final String? message;
  final int? durationMin;
  final int? priceCents;
  final int? participantCount;
  final int? requiredStaffCount;
  final String? variantId;
  final String? timezone;
  final String durationKind;
  final bool hasDurationMetadata;
  int? get reservedDurationMin => durationMin;

  SlotResponse({
    this.bookingCalendar,
    required this.date,
    required this.slots,
    this.message,
    this.durationMin,
    this.priceCents,
    this.participantCount,
    this.requiredStaffCount,
    this.variantId,
    this.timezone,
    this.durationKind = 'TIMED',
    this.hasDurationMetadata = false,
  });

  factory SlotResponse.fromJson(Map<String, dynamic> json) {
    if (json.containsKey('reservedDurationMin') && !json.containsKey('durationMin')) throw const FormatException('Missing reservation duration');
    return SlotResponse(
    bookingCalendar: BookingCalendar.parse(json['bookingCalendar'],timezone:json['timezone'] as String?),
    date: json['date'] ?? '',
    slots:
        (json['slots'] as List<dynamic>?)
            ?.map((s) => TimeSlot.fromJson(s as Map<String, dynamic>))
            .toList() ??
        [],
    message: json['message'],
    durationMin: json.containsKey('durationMin') ? readReservedMinutes(json) : null,
    durationKind: readDurationKind(json),
    hasDurationMetadata: json.containsKey('durationKind') || json.containsKey('reservedDurationMin'),
    priceCents: json['priceCents'],
    participantCount: json['participantCount'],
    requiredStaffCount: json['requiredStaffCount'],
    variantId: json['variantId']?.toString(),
    timezone: json['timezone'],
  );
  }
}
