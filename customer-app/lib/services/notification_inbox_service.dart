import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api_service.dart';

final notificationInboxProvider = Provider<NotificationInboxService>(
  (ref) => NotificationInboxService(ref.read(apiServiceProvider).dio),
);

class InboxMessage {
  final String id;
  final String topic;
  final String title;
  final String body;
  final String resourceType;
  final String? resourceId;
  final String? bookingId;
  final String createdAt;
  final String? readAt;
  InboxMessage.fromJson(Map<String, dynamic> json)
    : id = json['id'] as String,
      topic = json['topic'] as String,
      title = json['title'] as String,
      body = json['body'] as String,
      resourceType = json['resourceType'] as String,
      resourceId = json['resourceId']?.toString(),
      bookingId = json['bookingId']?.toString(),
      createdAt = json['createdAt'] as String,
      readAt = json['readAt'] as String?;
  bool get canOpenBooking =>
      bookingId != null && RegExp(r'^[1-9]\d{0,18}$').hasMatch(bookingId!);
}

class InboxPage {
  final List<InboxMessage> items;
  final int total;
  final int page;
  final int totalPages;
  final int unreadCount;
  InboxPage.fromJson(Map<String, dynamic> json)
    : items = (json['items'] as List)
          .map(
            (row) =>
                InboxMessage.fromJson(Map<String, dynamic>.from(row as Map)),
          )
          .toList(),
      total = json['total'] as int,
      page = json['page'] as int,
      totalPages = json['totalPages'] as int,
      unreadCount = json['unreadCount'] as int {
    if (total < 0 || page < 1 || totalPages < 0 || unreadCount < 0) {
      throw const FormatException('Invalid inbox page');
    }
  }
}

class NotificationInboxService {
  final Dio dio;
  NotificationInboxService(this.dio);
  Future<InboxPage> inbox(
    int page, {
    bool unreadOnly = false,
    CancelToken? cancelToken,
  }) async {
    final response = await dio.get(
      '/notifications/inbox',
      queryParameters: {
        'page': page,
        'pageSize': 25,
        if (unreadOnly) 'unreadOnly': 'true',
      },
      cancelToken: cancelToken,
    );
    return InboxPage.fromJson(Map<String, dynamic>.from(response.data as Map));
  }

  Future<InboxMessage> read(String id, {CancelToken? cancelToken}) async {
    final response = await dio.post(
      '/notifications/inbox/${Uri.encodeComponent(id)}/read',
      data: <String, dynamic>{},
      cancelToken: cancelToken,
    );
    final item = InboxMessage.fromJson(
      Map<String, dynamic>.from(response.data['item'] as Map),
    );
    if (item.id != id || item.readAt == null) {
      throw const FormatException('Unconfirmed read status');
    }
    return item;
  }

  Future<int> readAll({CancelToken? cancelToken}) async {
    final response = await dio.post(
      '/notifications/inbox/read-all',
      data: <String, dynamic>{},
      cancelToken: cancelToken,
    );
    final count = response.data['updatedCount'];
    if (count is! int || count < 0) {
      throw const FormatException('Invalid read count');
    }
    return count;
  }
}
