import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api_service.dart';

final businessWorkflowProvider = Provider<BusinessWorkflowService>(
  (ref) => BusinessWorkflowService(ref.read(apiServiceProvider).dio),
);

const _businessErrorMessages = <String, String>{
  'ORDER_EMAIL_REQUIRED':
      'Add a valid email to your customer account before placing an order.',
  'ORDER_EMAIL_VERIFICATION_REQUIRED':
      'Verify your account email before placing an order.',
  'ORDER_TIP_NOT_SUPPORTED':
      'Tips are handled directly with the shop. Submit the order without an online tip.',
  'CATALOG_SELECTION_CHANGED':
      'The selected service changed. Refresh the shop and select it again.',
  'PRICE_MENU_CHANGED':
      'The price menu changed. Refresh the shop and review the current price.',
  'STAFFING_CHANGED':
      'The shop availability changed. Refresh and choose an available time.',
  'STAFFING_BUSY':
      'The selected staff are no longer available. Choose another time.',
  'MENU_CATALOG_TOO_LARGE':
      'The shop service menu is unavailable. Please contact the shop.',
  'MENU_CATALOG_INCOMPLETE':
      'The complete service menu could not be loaded. Refresh the shop before continuing.',
};

String businessError(
  Object error, {
  String fallback =
      'Unable to complete this request. Refresh the page to see its current status.',
}) {
  if (error is! DioException) return fallback;

  final status = error.response?.statusCode;
  // A transport or server error does not prove that a write was rejected.
  if (status == null || status == 408 || status >= 500) {
    return 'Unable to verify this request. Check its current status before submitting it again.';
  }

  final data = error.response?.data;
  if (data is Map) {
    final nested = data['error'];
    final payload = nested is Map ? nested : data;
    final code = payload['code'] ?? data['code'];
    if (code != null) return _businessErrorMessages[code] ?? fallback;
  }

  // Use local copy only. Server messages can contain another language, HTML,
  // validation internals, or credentials even when they look like plain text.
  switch (status) {
    case 401:
      return 'Your session has expired. Sign in again to continue.';
    case 403:
      return 'This action is not available for your account.';
    case 404:
      return 'This information is no longer available. Refresh the page.';
    case 409:
      return 'The current details changed. Refresh and review them before continuing.';
    case 429:
      return 'Too many requests. Please wait a moment before continuing.';
    default:
      return fallback;
  }
}

class WorkflowPage {
  final List<Map<String, dynamic>> items;
  final int total;
  final int page;
  final int pageSize;
  WorkflowPage.fromJson(Map<String, dynamic> json)
    : items = (json['items'] as List)
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList(),
      total = (json['total'] as num).toInt(),
      page = (json['page'] as num).toInt(),
      pageSize = (json['pageSize'] as num).toInt();
  bool get hasNext => page * pageSize < total;
}

/// Uses the existing authenticated transport. No payment identifiers or credentials are cached.
class BusinessWorkflowService {
  final Dio _dio;
  BusinessWorkflowService(this._dio);
  Future<WorkflowPage> cases({
    int page = 1,
    String? status,
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.get(
      '/after-sales',
      queryParameters: {
        'page': page,
        'pageSize': 20,
        if (status != null && status.isNotEmpty) 'status': status,
      },
      cancelToken: cancelToken,
    );
    return WorkflowPage.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  Future<Map<String, dynamic>> caseDetail(
    String id, {
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.get(
      '/after-sales/${Uri.encodeComponent(id)}',
      cancelToken: cancelToken,
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<WorkflowPage> caseEvents(
    String id,
    int page, {
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.get(
      '/after-sales/${Uri.encodeComponent(id)}/events',
      queryParameters: {'page': page, 'pageSize': 30},
      cancelToken: cancelToken,
    );
    return WorkflowPage.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  Future<Map<String, dynamic>> createCase({
    required String bookingId,
    required String type,
    required String reason,
    int? requestedAmountCents,
  }) async {
    final response = await _dio.post(
      '/after-sales',
      data: {
        'bookingId': bookingId,
        'type': type,
        'reason': reason,
        'requestedAmountCents': ?requestedAmountCents,
      },
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> reply(
    Map<String, dynamic> item,
    String content,
  ) async {
    final response = await _dio.post(
      '/after-sales/${Uri.encodeComponent(item['id'].toString())}/notes',
      data: {
        'version': item['version'],
        'content': content,
        'visibility': 'PUBLIC',
      },
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> withdraw(
    Map<String, dynamic> item,
    String reason,
  ) async {
    final response = await _dio.post(
      '/after-sales/${Uri.encodeComponent(item['id'].toString())}/transition',
      data: {
        'version': item['version'],
        'action': 'WITHDRAW',
        'reason': reason,
      },
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<WorkflowPage> giftRights({
    int page = 1,
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.get(
      '/gift-cards/entitlements',
      queryParameters: {'page': page, 'pageSize': 20},
      cancelToken: cancelToken,
    );
    return WorkflowPage.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  Future<Map<String, dynamic>> giftCredential(String id, int uses) async {
    final response = await _dio.post(
      '/gift-cards/entitlements/${Uri.encodeComponent(id)}/credential',
      data: {'usedUses': uses},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<WorkflowPage> giftHistory(
    String id,
    int page, {
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.get(
      '/gift-cards/entitlements/${Uri.encodeComponent(id)}/redemptions',
      queryParameters: {'page': page, 'pageSize': 20},
      cancelToken: cancelToken,
    );
    return WorkflowPage.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }
}
