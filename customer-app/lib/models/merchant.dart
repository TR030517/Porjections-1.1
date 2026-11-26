/// MJAPP — Merchant & Related Data Models
library;

import 'dart:convert';

/// Merchant application status
class MerchantApplication {
  final String id;
  final String userId;
  final String shopName;
  final String? shopNameEn;
  final String shopPhone;
  final String address;
  final String city;
  final String state;
  final String zipCode;
  final double latitude;
  final double longitude;
  final String category;
  final String? description;
  final String? licenseUrl;
  final String? businessLicenseUrl;
  final String status; // 'PENDING' | 'APPROVED' | 'REJECTED'
  final String? rejectionReason;
  final String? createdAt;
  final String? updatedAt;

  MerchantApplication({
    required this.id,
    required this.userId,
    required this.shopName,
    this.shopNameEn,
    required this.shopPhone,
    required this.address,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.latitude,
    required this.longitude,
    required this.category,
    this.description,
    this.licenseUrl,
    this.businessLicenseUrl,
    required this.status,
    this.rejectionReason,
    this.createdAt,
    this.updatedAt,
  });

  factory MerchantApplication.fromJson(Map<String, dynamic> json) {
    return MerchantApplication(
      id: json['id']?.toString() ?? '',
      userId: json['userId']?.toString() ?? '',
      shopName: json['shopName'] ?? '',
      shopNameEn: json['shopNameEn'],
      shopPhone: json['shopPhone'] ?? '',
      address: json['address'] ?? '',
      city: json['city'] ?? '',
      state: json['state'] ?? '',
      zipCode: json['zipCode'] ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0.0,
      category: json['category'] ?? '',
      description: json['description'],
      licenseUrl: json['licenseUrl'],
      businessLicenseUrl: json['businessLicenseUrl'],
      status: json['status'] ?? 'PENDING',
      rejectionReason: json['rejectionReason'],
      createdAt: json['createdAt'],
      updatedAt: json['updatedAt'],
    );
  }

  String get statusLabel {
    switch (status) {
      case 'PENDING': return 'Pending Review';
      case 'APPROVED': return 'Approved';
      case 'REJECTED': return 'Rejected';
      default: return status;
    }
  }
}

/// Business hours entry for a single day
class BusinessHours {
  final String dayOfWeek; // 'MONDAY' | 'TUESDAY' | ...
  final String? openTime; // e.g. "09:00"
  final String? closeTime; // e.g. "18:00"
  final bool isClosed;

  BusinessHours({
    required this.dayOfWeek,
    this.openTime,
    this.closeTime,
    this.isClosed = false,
  });

  factory BusinessHours.fromJson(Map<String, dynamic> json) {
    return BusinessHours(
      dayOfWeek: json['dayOfWeek'] ?? '',
      openTime: json['openTime'],
      closeTime: json['closeTime'],
      isClosed: json['isClosed'] ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
    'dayOfWeek': dayOfWeek,
    'openTime': openTime,
    'closeTime': closeTime,
    'isClosed': isClosed,
  };

  String get displayTime {
    if (isClosed) return 'Closed';
    if (openTime == null || closeTime == null) return '--';
    return '$openTime - $closeTime';
  }

  String get dayLabel {
    final map = {
      'MONDAY': 'Mon', 'TUESDAY': 'Tue', 'WEDNESDAY': 'Wed',
      'THURSDAY': 'Thu', 'FRIDAY': 'Fri', 'SATURDAY': 'Sat', 'SUNDAY': 'Sun',
    };
    return map[dayOfWeek] ?? dayOfWeek;
  }
}

/// Shop image
class ShopImage {
  final String id;
  final String url;
  final String? altText;

  ShopImage({required this.id, required this.url, this.altText});

  factory ShopImage.fromJson(Map<String, dynamic> json) {
    return ShopImage(
      id: json['id']?.toString() ?? '',
      url: json['url'] ?? json['imageUrl'] ?? '',
      altText: json['altText'] ?? json['alt'],
    );
  }
}

/// Dashboard statistics
class MerchantDashboard {
  final double totalRevenueCents;
  final double netRevenueCents;
  final int totalBookings;
  final int pendingBookings;
  final int confirmedBookings;
  final int completedBookings;
  final int cancelledBookings;
  final double avgRating;
  final double platformFeeCents;
  final List<DailyRevenue>? dailyRevenue;
  final int balanceCents;
  final int pendingCents;
  final int totalEarnedCents;
  final List<MerchantTransaction> recentTransactions;

  MerchantDashboard({
    required this.totalRevenueCents,
    required this.netRevenueCents,
    required this.totalBookings,
    required this.pendingBookings,
    required this.confirmedBookings,
    required this.completedBookings,
    required this.cancelledBookings,
    required this.avgRating,
    required this.platformFeeCents,
    this.dailyRevenue,
    this.balanceCents = 0,
    this.pendingCents = 0,
    this.totalEarnedCents = 0,
    this.recentTransactions = const [],
  });

  factory MerchantDashboard.fromJson(Map<String, dynamic> json) {
    return MerchantDashboard(
      totalRevenueCents: (json['overview']?['totalRevenue'] as num?)?.toDouble() ?? 0.0,
      netRevenueCents: (json['overview']?['netRevenue'] as num?)?.toDouble() ?? 0.0,
      totalBookings: json['overview']?['totalBookings'] ?? 0,
      pendingBookings: json['pendingBookings'] ?? 0,
      confirmedBookings: json['confirmedBookings'] ?? 0,
      completedBookings: json['completedBookings'] ?? 0,
      cancelledBookings: json['cancelledBookings'] ?? 0,
      avgRating: (json['overview']?['avgRating'] as num?)?.toDouble() ?? 0.0,
      platformFeeCents: (json['overview']?['totalFees'] as num?)?.toDouble() ?? 0.0,
      dailyRevenue: (json['dailyRevenue'] as List<dynamic>?)
          ?.map((e) => DailyRevenue.fromJson(e as Map<String, dynamic>))
          .toList(),
      balanceCents: json['balanceCents'] ?? 0,
      pendingCents: json['pendingCents'] ?? 0,
      totalEarnedCents: json['totalEarnedCents'] ?? 0,
      recentTransactions: (json['recentTransactions'] as List<dynamic>?)
              ?.map((e) => MerchantTransaction.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  String get formattedBalance => '\$${(balanceCents / 100).toStringAsFixed(2)}';
  String get formattedPending => '\$${(pendingCents / 100).toStringAsFixed(2)}';
  String get formattedTotalEarned => '\$${(totalEarnedCents / 100).toStringAsFixed(2)}';
  String get formattedTotalRevenue => '\$${(totalRevenueCents / 100).toStringAsFixed(2)}';
  String get formattedNetRevenue => '\$${(netRevenueCents / 100).toStringAsFixed(2)}';
  String get formattedPlatformFee => '\$${(platformFeeCents / 100).toStringAsFixed(2)}';
}

/// Daily revenue data point for chart
class DailyRevenue {
  final String date;
  final double revenueCents;

  DailyRevenue({required this.date, required this.revenueCents});

  factory DailyRevenue.fromJson(Map<String, dynamic> json) {
    return DailyRevenue(
      date: json['date'] ?? '',
      revenueCents: (json['revenueCents'] as num?)?.toDouble() ?? 0.0,
    );
  }

  String get formattedRevenue => '\$${(revenueCents / 100).toStringAsFixed(0)}';
}

/// Merchant shop model — extended version for merchant portal
class MerchantShop {
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
  final double avgRating;
  final int reviewCount;
  final int bookingCount;
  final List<BusinessHours>? businessHours;
  final List<ShopImage>? images;
  final String? createdAt;
  final String? updatedAt;

  MerchantShop({
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
    required this.avgRating,
    required this.reviewCount,
    required this.bookingCount,
    this.businessHours,
    this.images,
    this.createdAt,
    this.updatedAt,
  });

  static List<BusinessHours>? _parseBusinessHours(dynamic raw) {
    if (raw == null) return null;
    if (raw is List) {
      return raw
          .map((e) => BusinessHours.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    if (raw is String && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is List) {
          return decoded
              .map((e) => BusinessHours.fromJson(e as Map<String, dynamic>))
              .toList();
        }
        if (decoded is Map<String, dynamic>) {
          // {"monday":{"open":"09:00","close":"21:00"}, ...}
          final days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
          return days
              .where(decoded.containsKey)
              .map((day) {
                final v = decoded[day];
                if (v is! Map<String, dynamic>) {
                  return BusinessHours(
                    dayOfWeek: day.toUpperCase(),
                    openTime: null,
                    closeTime: null,
                    isClosed: true,
                  );
                }
                final open = v['open'] as String?;
                final close = v['close'] as String?;
                return BusinessHours(
                  dayOfWeek: day.toUpperCase(),
                  openTime: open,
                  closeTime: close,
                  isClosed: (open == null && close == null) || v['isClosed'] == true,
                );
              })
              .toList();
        }
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  factory MerchantShop.fromJson(Map<String, dynamic> json) {
    return MerchantShop(
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      nameEn: json['nameEn'],
      description: json['description'],
      phone: json['phone'],
      address: json['address'] ?? '',
      city: json['city'] ?? '',
      state: json['state'] ?? '',
      zipCode: json['zipCode'],
      latitude: (json['latitude'] is num)
          ? (json['latitude'] as num).toDouble()
          : double.tryParse(json['latitude']?.toString() ?? '') ?? 0,
      longitude: (json['longitude'] is num)
          ? (json['longitude'] as num).toDouble()
          : double.tryParse(json['longitude']?.toString() ?? '') ?? 0,
      category: json['category'] ?? '',
      avgRating: (json['avgRating'] is num)
          ? (json['avgRating'] as num).toDouble()
          : double.tryParse(json['avgRating']?.toString() ?? '') ?? 0.0,
      reviewCount: json['reviewCount'] ?? 0,
      bookingCount: json['bookingCount'] ?? 0,
      // Backend returns businessHours as a JSON-encoded string in some
      // endpoints and as an array in others; tolerate both.
      businessHours: _parseBusinessHours(json['businessHours']),
      // Backend returns the shop images under `shopImages`.
      images: (json['shopImages'] as List<dynamic>?)
          ?.map((e) => ShopImage.fromJson(e as Map<String, dynamic>))
          .toList(),
      createdAt: json['createdAt'],
      updatedAt: json['updatedAt'],
    );
  }
}

/// Merchant transaction (payment, payout, or refund)
class MerchantTransaction {
  final String id;
  final String? bookingId;
  final String type; // PAYMENT | PAYOUT | REFUND
  final int amount;
  final int fee;
  final int net;
  final String status; // COMPLETED | PENDING | FAILED
  final String createdAt;
  final String description;

  MerchantTransaction({
    required this.id,
    this.bookingId,
    required this.type,
    required this.amount,
    required this.fee,
    required this.net,
    required this.status,
    required this.createdAt,
    required this.description,
  });

  factory MerchantTransaction.fromJson(Map<String, dynamic> json) {
    return MerchantTransaction(
      id: json['id']?.toString() ?? '',
      bookingId: json['bookingId']?.toString(),
      type: json['type'] ?? 'PAYMENT',
      amount: json['amount'] ?? 0,
      fee: json['fee'] ?? 0,
      net: json['net'] ?? 0,
      status: json['status'] ?? 'COMPLETED',
      createdAt: json['createdAt'] ?? '',
      description: json['description'] ?? '',
    );
  }

  bool get isCredit => amount > 0;
  bool get isDebit => amount < 0;
  bool get isPayment => type == 'PAYMENT';
  bool get isPayout => type == 'PAYOUT';
  bool get isRefund => type == 'REFUND';

  String get formattedAmount => isDebit
      ? '-\$${((-amount) / 100).toStringAsFixed(2)}'
      : '\$${(amount / 100).toStringAsFixed(2)}';

  String get formattedNet => isDebit
      ? '-\$${((-net) / 100).toStringAsFixed(2)}'
      : '\$${(net / 100).toStringAsFixed(2)}';

  String get formattedDate {
    if (createdAt.isEmpty) return '';
    try {
      final dt = DateTime.parse(createdAt);
      return '${dt.month}/${dt.day}/${dt.year}';
    } catch (_) {
      return createdAt;
    }
  }

  String get typeLabel {
    switch (type) {
      case 'PAYMENT':
        return 'Payment';
      case 'PAYOUT':
        return 'Withdrawal';
      case 'REFUND':
        return 'Refund';
      default:
        return type;
    }
  }
}

/// Paginated transaction list response
class PaginatedTransactions {
  final List<MerchantTransaction> items;
  final int total;
  final int page;
  final int pageSize;
  final int totalPages;

  PaginatedTransactions({
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
    required this.totalPages,
  });

  factory PaginatedTransactions.fromJson(Map<String, dynamic> json) {
    return PaginatedTransactions(
      items: (json['items'] as List<dynamic>)
          .map((e) => MerchantTransaction.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: json['total'] ?? 0,
      page: json['page'] ?? 1,
      pageSize: json['pageSize'] ?? 10,
      totalPages: json['totalPages'] ?? 0,
    );
  }

  bool get hasMore => page < totalPages;
}

/// Annual tax report summary
class TaxReport {
  final int totalGross;
  final int totalPlatformFees;
  final int totalNet;
  final int totalRefunds;
  final int totalPayouts;
  final int netEarnings;

  TaxReport({
    required this.totalGross,
    required this.totalPlatformFees,
    required this.totalNet,
    required this.totalRefunds,
    required this.totalPayouts,
    required this.netEarnings,
  });

  factory TaxReport.fromJson(Map<String, dynamic> json) {
    return TaxReport(
      totalGross: json['total_gross'] ?? 0,
      totalPlatformFees: json['total_platform_fees'] ?? 0,
      totalNet: json['total_net'] ?? 0,
      totalRefunds: json['total_refunds'] ?? 0,
      totalPayouts: json['total_payouts'] ?? 0,
      netEarnings: json['net_earnings'] ?? 0,
    );
  }

  String get formattedGross => '\$${(totalGross / 100).toStringAsFixed(2)}';
  String get formattedFees => '\$${(totalPlatformFees / 100).toStringAsFixed(2)}';
  String get formattedNet => '\$${(totalNet / 100).toStringAsFixed(2)}';
  String get formattedRefunds => '\$${(totalRefunds / 100).toStringAsFixed(2)}';
  String get formattedPayouts => '\$${(totalPayouts / 100).toStringAsFixed(2)}';
  String get formattedEarnings => '\$${(netEarnings / 100).toStringAsFixed(2)}';
}
