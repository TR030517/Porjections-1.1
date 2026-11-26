import 'package:dio/dio.dart';
import 'api_service.dart';

/// Announcement model
class Announcement {
  final int id;
  final String title;
  final String content;
  final String type; // INFO | IMPORTANT | URGENT
  final String scope;
  final bool isActive;
  final DateTime startAt;
  final DateTime? endAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  Announcement({
    required this.id,
    required this.title,
    required this.content,
    required this.type,
    required this.scope,
    required this.isActive,
    required this.startAt,
    this.endAt,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Announcement.fromJson(Map<String, dynamic> json) {
    return Announcement(
      id: json['id'] is int ? json['id'] : int.parse(json['id'].toString()),
      title: json['title'] as String,
      content: json['content'] as String,
      type: json['type'] as String,
      scope: json['scope'] as String,
      isActive: json['isActive'] as bool,
      startAt: DateTime.parse(json['startAt'] as String),
      endAt: json['endAt'] != null ? DateTime.parse(json['endAt'] as String) : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}

/// Announcement API Service
class AnnouncementService {
  final ApiService _api;

  AnnouncementService(this._api);

  Dio get _dio => _api.dio;

  /// Fetch active announcements for the current user
  Future<List<Announcement>> getActiveAnnouncements() async {
    final response = await _dio.get('/announcements');
    final list = response.data as List<dynamic>;
    return list
        .map((e) => Announcement.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
