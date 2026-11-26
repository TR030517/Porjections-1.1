import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api_service.dart';
import '../models/gift_time.dart';

final giftOrderServiceProvider = Provider<GiftOrderService>(
  (ref) => GiftOrderService(ref.read(apiServiceProvider).dio),
);

int _amount(dynamic value) {
  if (value is! int || value < 0) {
    throw const FormatException('Invalid gift amount');
  }
  return value;
}

List<Map<String, dynamic>> _evidence(dynamic value) {
  final rows = (value as List? ?? const [])
      .map((row) => Map<String, dynamic>.from(row as Map))
      .toList();
  for (final row in rows) {
    _amount(row['amountCents']);
    if (row['method'] is! String ||
        row['reason'] is! String ||
        row['createdAt'] is! String) {
      throw const FormatException('Invalid gift evidence');
    }
  }
  return rows;
}

class GiftPurchaseOrder {
  final String id;
  final String orderNo;
  final String userId;
  final String shopId;
  final String productId;
  final String title;
  final int? uses;
  final int? expireDays;
  final int amountCents;
  final int paidCents;
  final int refundedCents;
  final String currency;
  final String status;
  final String paymentMethod;
  final String? entitlementId;
  final String? createdAt;
  final String? timezone;
  final String? createdAtLocal;
  String get createdAtLabel => giftShopTimestamp(createdAtLocal, timezone);
  final bool canCancel;
  final List<Map<String, dynamic>> receipts;
  final List<Map<String, dynamic>> refunds;
  GiftPurchaseOrder.fromJson(Map<String, dynamic> json)
    : id = json['id'] as String,
      orderNo = json['orderNo'] as String,
      userId = json['userId'] as String,
      shopId = json['shopId'] as String,
      productId = json['productId'] as String,
      title = json['productTitleSnapshot'] as String? ?? '',
      uses = json['useTimesSnapshot'] as int?,
      expireDays = json['expireDaysSnapshot'] as int?,
      amountCents = _amount(json['amountCents']),
      paidCents = _amount(json['paidCents']),
      refundedCents = _amount(json['refundedCents'] ?? 0),
      currency = json['currency'] as String,
      status = json['status'] as String,
      paymentMethod = json['paymentMethod'] as String? ?? 'LEGACY',
      entitlementId = json['entitlementId'] as String?,
      createdAt = json['createdAt'] as String?,
      timezone = json['timezone'] as String?,
      createdAtLocal = json['createdAtLocal'] as String?,
      canCancel =
          json['allowedActions'] is Map &&
          json['allowedActions']['cancel'] == true,
      receipts = _evidence(json['receipts']),
      refunds = _evidence(json['refunds']) {
    if (refundedCents > paidCents ||
        paidCents > amountCents ||
        currency.isEmpty) {
      throw const FormatException('Inconsistent gift amounts');
    }
  }
}

class GiftOrderPage {
  final List<GiftPurchaseOrder> items;
  final int total;
  final int page;
  final int totalPages;
  GiftOrderPage.fromJson(Map<String, dynamic> json)
    : items = (json['items'] as List)
          .map(
            (row) => GiftPurchaseOrder.fromJson(
              Map<String, dynamic>.from(row as Map),
            ),
          )
          .toList(),
      total = _amount(json['total']),
      page = _amount(json['page']),
      totalPages = _amount(json['totalPages']);
}

class GiftProductPage {
  final List<Map<String, dynamic>> items;
  final int total;
  final int totalPages;
  GiftProductPage.fromJson(Map<String, dynamic> json)
    : items = (json['items'] as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList(),
      total = _amount(json['total']),
      totalPages = _amount(json['totalPages']);
}

class GiftOrderService {
  final Dio dio;
  GiftOrderService(this.dio);
  Future<Map<String, dynamic>> config({CancelToken? cancelToken}) async {
    final response = await dio.get(
      '/gift-cards/config',
      options: ApiService.publicReadOptions,
      cancelToken: cancelToken,
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<GiftProductPage> products(
    String shopId,
    int page, {
    CancelToken? cancelToken,
  }) async {
    final response = await dio.get(
      '/gift-cards/products',
      queryParameters: {'shopId': shopId, 'page': page, 'pageSize': 20},
      options: ApiService.publicReadOptions,
      cancelToken: cancelToken,
    );
    final value = GiftProductPage.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
    if (value.items.any((row) => row['shopId'] != shopId)) {
      throw const FormatException('Invalid product shop');
    }
    return value;
  }

  Future<GiftPurchaseOrder> create(
    String productId,
    String requestKey, {
    CancelToken? cancelToken,
  }) async {
    final response = await dio.post(
      '/gift-cards/orders',
      data: {
        'productId': productId,
        'requestKey': requestKey,
        'paymentMethod': 'PAY_AT_STORE',
      },
      cancelToken: cancelToken,
    );
    final item = GiftPurchaseOrder.fromJson(
      Map<String, dynamic>.from(response.data['item'] as Map),
    );
    if (item.productId != productId || item.paymentMethod != 'PAY_AT_STORE') {
      throw const FormatException('Invalid gift order');
    }
    return item;
  }

  Future<GiftOrderPage> orders(
    int page, {
    String? status,
    CancelToken? cancelToken,
  }) async {
    final response = await dio.get(
      '/gift-cards/orders',
      queryParameters: {
        'page': page,
        'pageSize': 20,
        if (status != null && status.isNotEmpty) 'status': status,
      },
      cancelToken: cancelToken,
    );
    return GiftOrderPage.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  Future<GiftPurchaseOrder> order(String id, {CancelToken? cancelToken}) async {
    final response = await dio.get(
      '/gift-cards/orders/${Uri.encodeComponent(id)}',
      cancelToken: cancelToken,
    );
    final item = GiftPurchaseOrder.fromJson(
      Map<String, dynamic>.from(response.data['item'] as Map),
    );
    if (item.id != id) throw const FormatException('Invalid gift order');
    return item;
  }

  Future<GiftPurchaseOrder> cancel(
    String id, {
    CancelToken? cancelToken,
  }) async {
    final response = await dio.post(
      '/gift-cards/orders/${Uri.encodeComponent(id)}/cancel',
      data: <String, dynamic>{},
      cancelToken: cancelToken,
    );
    final item = GiftPurchaseOrder.fromJson(
      Map<String, dynamic>.from(response.data['item'] as Map),
    );
    if (item.id != id || item.status != 'CANCELLED') {
      throw const FormatException('Unconfirmed gift cancellation');
    }
    return item;
  }
}
