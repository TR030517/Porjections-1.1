import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/services/announcement_service.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/support_service.dart';

/// Capture requests after the real ApiService/Dio auth interceptors have run.
/// No HTTP server, provider or database is contacted.
class AnnouncementTransport implements HttpClientAdapter {
  final calls = <RequestOptions>[];
  bool rejectAnnouncements = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    await requestStream?.drain<void>();
    calls.add(options);
    final Object response;
    var status = 200;
    switch (options.path) {
      case '/auth/customer/password/login':
        response = {
          'accessToken': 'synthetic-announcement-access',
          'refreshToken': 'synthetic-announcement-refresh',
          'user': {'id': '42', 'role': 'CUSTOMER'},
        };
        break;
      case '/announcements':
        if (rejectAnnouncements) {
          status = 401;
          response = {'message': 'Authentication required'};
        } else {
          response = [
            {
              'id': '1',
              'title': 'Synthetic published notice',
              'content': 'Synthetic text only',
              'type': 'INFO',
              'scope': 'USERS',
              'isActive': true,
              'startAt': '2031-05-01T10:00:00Z',
              'endAt': null,
              'createdAt': '2031-05-01T10:00:00Z',
              'updatedAt': '2031-05-01T10:00:00Z',
            },
          ];
        }
        break;
      case '/public/support':
        response = {'siteName': 'Synthetic', 'email': null, 'phone': null};
        break;
      case '/banners':
        response = [];
        break;
      case '/auth/customer/logout':
        response = {'ok': true};
        break;
      default:
        throw StateError('Unexpected synthetic request');
    }
    return ResponseBody.fromString(
      jsonEncode(response),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late ApiService api;
  late AnnouncementTransport transport;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    api = ApiService();
    transport = AnnouncementTransport();
    api.dio.httpClientAdapter = transport;
    await api.logout();
    transport.calls.clear();
  });

  Future<void> login() => api
      .passwordLogin('synthetic@example.invalid', 'synthetic-test-password')
      .then((_) {});

  test(
    'signed-in announcement request retains real in-memory authorization',
    () async {
      await login();
      final announcements = await AnnouncementService(
        api,
      ).getActiveAnnouncements();
      final request = transport.calls.last;
      expect(request.method, 'GET');
      expect(request.path, '/announcements');
      expect(request.extra['publicRead'], isNot(true));
      expect(
        request.headers['Authorization'],
        'Bearer synthetic-announcement-access',
      );
      expect(announcements.single.title, 'Synthetic published notice');
    },
  );

  test('banners and support stay anonymous while a session exists', () async {
    await login();
    await api.dio.get(
      '/banners',
      options: Options(headers: {'Authorization': 'Bearer stale-header'}),
    );
    final banner = transport.calls.last;
    expect(banner.extra['publicRead'], isTrue);
    expect(banner.headers.containsKey('Authorization'), isFalse);
    final support = await SupportService(api.dio).load();
    final contact = transport.calls.last;
    expect(contact.path, '/public/support');
    expect(contact.extra['publicRead'], isTrue);
    expect(contact.headers.containsKey('Authorization'), isFalse);
    expect(support.email, isNull);
    expect(await api.getAccessToken(), 'synthetic-announcement-access');
  });

  test(
    'logged-out announcements remain protected and cannot reuse an old token',
    () async {
      await login();
      await api.logout();
      expect(await api.getAccessToken(), isNull);
      transport.calls.clear();
      transport.rejectAnnouncements = true;
      await expectLater(
        AnnouncementService(api).getActiveAnnouncements(),
        throwsA(
          isA<DioException>().having(
            (error) => error.response?.statusCode,
            'status',
            401,
          ),
        ),
      );
      expect(transport.calls.length, 1);
      final request = transport.calls.single;
      expect(request.path, '/announcements');
      expect(request.extra['publicRead'], isNot(true));
      expect(request.headers.containsKey('Authorization'), isFalse);
      expect(await api.getAccessToken(), isNull);
    },
  );
}
