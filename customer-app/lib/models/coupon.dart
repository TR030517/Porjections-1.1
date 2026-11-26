/// Coupon model (from GET /coupons, admin/merchant CRUD)
class Coupon {
  final String id;
  final String? shopId;
  final Map<String, dynamic>? shop;
  final String title;
  final String? description;
  final String type; // FIXED_AMOUNT | PERCENT
  final int value;
  final int minSpendCents;
  final int totalQuantity;
  final int claimedCount;
  final int usedCount;
  final int perUserLimit;
  final DateTime? validFrom;
  final DateTime? validUntil;
  final String status; // DRAFT | ACTIVE | PAUSED | EXPIRED
  final bool claimedByMe;
  final bool exhausted;

  const Coupon({
    required this.id,
    this.shopId,
    this.shop,
    required this.title,
    this.description,
    required this.type,
    required this.value,
    required this.minSpendCents,
    required this.totalQuantity,
    required this.claimedCount,
    required this.usedCount,
    required this.perUserLimit,
    this.validFrom,
    this.validUntil,
    required this.status,
    this.claimedByMe = false,
    this.exhausted = false,
  });

  bool get isPercent => type == 'PERCENT';
  bool get isExpired =>
      validUntil != null && validUntil!.isBefore(DateTime.now());
  bool get isExhausted =>
      totalQuantity > 0 && claimedCount >= totalQuantity;
  bool get isActive => status == 'ACTIVE' && !isExpired;

  /// Discount label, e.g. "$10 OFF" or "20% OFF"
  String discountLabel({required bool compact}) {
    if (isPercent) return '$value% OFF';
    final d = _centsToDollar(value);
    return compact ? '\$$d' : '\$$d OFF';
  }

  /// Human-readable min spend label, e.g. "Min. spend $30"
  String minSpendLabel({required bool compact}) {
    if (minSpendCents <= 0) return '';
    final d = _centsToDollar(minSpendCents);
    return compact ? '\$$d' : 'Min. spend \$$d';
  }

  /// Value label with explicit $ prefix, e.g. "$10" (avoid brace lint)
  String valueLabel() => isPercent ? '$value%' : '\$${_centsToDollar(value)}';

  static String _centsToDollar(int cents) {
    final d = cents / 100;
    return d.toStringAsFixed(d % 1 == 0 ? 0 : 2);
  }

  factory Coupon.fromJson(Map<String, dynamic> json) {
    return Coupon(
      id: json['id']?.toString() ?? '',
      shopId: json['shopId']?.toString(),
      shop: json['shop'] as Map<String, dynamic>?,
      title: json['title']?.toString() ?? '',
      description: json['description']?.toString(),
      type: json['type']?.toString() ?? 'FIXED_AMOUNT',
      value: (json['value'] as num?)?.toInt() ?? 0,
      minSpendCents: (json['minSpendCents'] as num?)?.toInt() ?? 0,
      totalQuantity: (json['totalQuantity'] as num?)?.toInt() ?? 0,
      claimedCount: (json['claimedCount'] as num?)?.toInt() ?? 0,
      usedCount: (json['usedCount'] as num?)?.toInt() ?? 0,
      perUserLimit: (json['perUserLimit'] as num?)?.toInt() ?? 1,
      validFrom: json['validFrom'] != null ? DateTime.tryParse(json['validFrom'].toString()) : null,
      validUntil: json['validUntil'] != null ? DateTime.tryParse(json['validUntil'].toString()) : null,
      status: json['status']?.toString() ?? 'ACTIVE',
      claimedByMe: json['claimedByMe'] == true,
      exhausted: json['exhausted'] == true,
    );
  }
}

/// User-owned coupon (from GET /users/me/coupons)
class UserCoupon {
  final String id;
  final String status; // UNUSED | USED | EXPIRED
  final DateTime? claimedAt;
  final DateTime? usedAt;
  final String? bookingId;
  final Coupon coupon;

  const UserCoupon({
    required this.id,
    required this.status,
    this.claimedAt,
    this.usedAt,
    this.bookingId,
    required this.coupon,
  });

  bool get isUnused => status == 'UNUSED';

  factory UserCoupon.fromJson(Map<String, dynamic> json) {
    return UserCoupon(
      id: json['id']?.toString() ?? '',
      status: json['status']?.toString() ?? 'UNUSED',
      claimedAt: json['claimedAt'] != null ? DateTime.tryParse(json['claimedAt'].toString()) : null,
      usedAt: json['usedAt'] != null ? DateTime.tryParse(json['usedAt'].toString()) : null,
      bookingId: json['bookingId']?.toString(),
      coupon: Coupon.fromJson(json['coupon'] as Map<String, dynamic>? ?? {}),
    );
  }
}
