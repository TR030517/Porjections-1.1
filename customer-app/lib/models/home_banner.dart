import 'media_url.dart';

/// Home banner model (from GET /banners)
class HomeBanner {
  final String id;
  final String title;
  final String imageUrl;
  final String targetType; // NONE | SHOP_DETAIL | CATEGORY | COUPON_CENTER | EXTERNAL_URL
  final String? targetValue;
  final int sortOrder;
  final int clickCount;

  const HomeBanner({
    required this.id,
    required this.title,
    required this.imageUrl,
    required this.targetType,
    this.targetValue,
    required this.sortOrder,
    this.clickCount = 0,
  });

  factory HomeBanner.fromJson(
    Map<String, dynamic> json, {
    String? apiBaseUrl,
    Uri? pageUri,
  }) {
    return HomeBanner(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      imageUrl:
          resolveCustomerMediaUrl(
            json['imageUrl'],
            apiBaseUrl: apiBaseUrl,
            pageUri: pageUri,
          ) ??
          '',
      targetType: json['targetType']?.toString() ?? 'NONE',
      targetValue: json['targetValue']?.toString(),
      sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
      clickCount: (json['clickCount'] as num?)?.toInt() ?? 0,
    );
  }
}
