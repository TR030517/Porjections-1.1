import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mjapp_client/models/media_url.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/upload_service.dart';

const id = '00000000-0000-4000-8000-000000000001';
const fileUrl = '/api/v1/upload/media/$id/file';
final png = Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
Map<String, dynamic> item({String status = 'STAGED'}) => {
  'id': id,
  'fileUrl': fileUrl,
  'scope': 'AVATAR',
  'shopId': null,
  'purpose': 'avatar',
  'status': status,
  'mimeType': 'image/webp',
  'width': 1,
  'height': 1,
  'sizeBytes': 10,
  'expiresAt': '2031-01-01T00:00:00Z',
};
ResponseBody jsonBody(Object data, [int status = 200]) =>
    ResponseBody.fromString(
      jsonEncode(data),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );

class LocalAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions, List<int>) handler;
  LocalAdapter(this.handler);
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => handler(
    options,
    await requestStream?.expand((part) => part).toList() ?? [],
  );
  @override
  void close({bool force = false}) {}
}

String field(List<int> bytes, String name) => RegExp(
  'name="$name"\r\n\r\n([^\r]+)',
).firstMatch(utf8.decode(bytes, allowMalformed: true))!.group(1)!;
Future<ApiService> signedIn() async {
  final api = ApiService();
  api.dio.httpClientAdapter = LocalAdapter(
    (options, bytes) async => jsonBody({
      'accessToken': 'local-test-access',
      'refreshToken': 'local-test-refresh',
      'user': {'id': '42', 'role': 'CUSTOMER'},
    }),
  );
  await api.passwordLogin(
    'upload-test@example.invalid',
    'unit-test-only-password',
  );
  return api;
}

XFile picture() =>
    XFile.fromData(png, mimeType: 'image/png', name: 'misleading-avatar.jpg');
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  test(
    'avatar uploads actual multipart bytes, confirms STAGED and commits once before returning a resolved display URL',
    () async {
      final api = await signedIn(), calls = <String>[];
      api.dio.httpClientAdapter = LocalAdapter((options, bytes) async {
        calls.add(options.path);
        expect(options.headers['Authorization'], 'Bearer local-test-access');
        if (options.path == '/upload/media') {
          expect(options.contentType, contains('multipart/form-data'));
          expect(field(bytes, 'scope'), 'AVATAR');
          expect(field(bytes, 'purpose'), 'avatar');
          expect(
            RegExp(r'^[a-f0-9]{32}$').hasMatch(field(bytes, 'requestKey')),
            true,
          );
          final raw = utf8.decode(bytes, allowMalformed: true);
          expect(raw.toLowerCase(), contains('content-type: image/png'));
          expect(raw, contains('filename="avatar.png"'));
          expect(raw, contains(utf8.decode(png, allowMalformed: true)));
          expect(raw, isNot(contains('shopId')));
          return jsonBody({'item': item(), 'replayed': false});
        }
        expect(jsonDecode(utf8.decode(bytes)), <String, dynamic>{});
        if (options.path.endsWith('/confirm')) {
          return jsonBody({'item': item()});
        }
        expect(options.path, '/upload/media/$id/commit-avatar');
        return jsonBody({'item': item(status: 'BOUND'), 'avatarUrl': fileUrl});
      });
      expect(
        await UploadService(api, picker: () async => picture()).uploadAvatar(),
        resolveCustomerMediaUrl(fileUrl),
      );
      expect(calls, [
        '/upload/media',
        '/upload/media/$id/confirm',
        '/upload/media/$id/commit-avatar',
      ]);
    },
  );
  test(
    'cancelled, invalid and oversized selections never upload or commit',
    () async {
      final api = await signedIn();
      var count = 0;
      api.dio.httpClientAdapter = LocalAdapter((options, bytes) async {
        count++;
        return jsonBody({});
      });
      expect(
        await UploadService(api, picker: () async => null).uploadAvatar(),
        isNull,
      );
      for (final selected in [
        XFile.fromData(Uint8List.fromList([1, 2, 3]), mimeType: 'image/png'),
        XFile.fromData(
          Uint8List(UploadService.maxAvatarBytes + 1),
          mimeType: 'image/png',
        ),
      ]) {
        await expectLater(
          UploadService(api, picker: () async => selected).uploadAvatar(),
          throwsFormatException,
        );
      }
      expect(count, 0);
    },
  );
  test(
    'disabled storage is an explicit failure and never confirms or commits',
    () async {
      final api = await signedIn(), paths = <String>[];
      api.dio.httpClientAdapter = LocalAdapter((options, bytes) async {
        paths.add(options.path);
        return jsonBody({'message': 'MEDIA_STORAGE_NOT_CONFIGURED'}, 503);
      });
      await expectLater(
        UploadService(api, picker: () async => picture()).uploadAvatar(),
        throwsA(isA<DioException>()),
      );
      expect(paths, ['/upload/media']);
    },
  );
  test(
    'unchanged uncertain upload retries reuse the same request key without marking failure as success',
    () async {
      final api = await signedIn(), keys = <String>[];
      var fail = true;
      api.dio.httpClientAdapter = LocalAdapter((options, bytes) async {
        if (options.path == '/upload/media') {
          keys.add(field(bytes, 'requestKey'));
          if (fail) {
            fail = false;
            throw DioException(
              requestOptions: options,
              type: DioExceptionType.connectionTimeout,
            );
          }
          return jsonBody({'item': item(), 'replayed': true});
        }
        return jsonBody(
          options.path.endsWith('/confirm')
              ? {'item': item()}
              : {'item': item(status: 'BOUND'), 'avatarUrl': fileUrl},
        );
      });
      final service = UploadService(api, picker: () async => picture());
      await expectLater(service.uploadAvatar(), throwsA(isA<DioException>()));
      expect(await service.uploadAvatar(), resolveCustomerMediaUrl(fileUrl));
      expect(keys.length, 2);
      expect(keys.first, keys.last);
    },
  );
  test(
    'an uncertain avatar commit retries the original media identity instead of uploading another object',
    () async {
      final api = await signedIn(), paths = <String>[];
      var fail = true;
      api.dio.httpClientAdapter = LocalAdapter((options, bytes) async {
        paths.add(options.path);
        if (options.path == '/upload/media') return jsonBody({'item': item()});
        if (options.path.endsWith('/confirm')) {
          return jsonBody({'item': item()});
        }
        if (fail) {
          fail = false;
          throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionTimeout,
          );
        }
        return jsonBody({'item': item(status: 'BOUND'), 'avatarUrl': fileUrl});
      });
      final service = UploadService(api, picker: () async => picture());
      await expectLater(service.uploadAvatar(), throwsA(isA<DioException>()));
      await service.uploadAvatar();
      expect(paths.where((path) => path == '/upload/media').length, 1);
      expect(paths.where((path) => path.endsWith('/commit-avatar')).length, 2);
    },
  );
  test(
    'session changes while an upload finishes never confirm or commit the previous account image',
    () async {
      final api = await signedIn(),
          waiting = Completer<ResponseBody>(),
          entered = Completer<void>(),
          paths = <String>[];
      api.dio.httpClientAdapter = LocalAdapter((options, bytes) async {
        paths.add(options.path);
        if (options.path == '/auth/customer/password/login') {
          return jsonBody({
            'accessToken': 'other-test-access',
            'refreshToken': 'other-test-refresh',
            'user': {'id': '43', 'role': 'CUSTOMER'},
          });
        }
        if (options.path == '/upload/media') {
          entered.complete();
          return waiting.future;
        }
        fail('No confirm/commit from the previous account is allowed.');
      });
      final service = UploadService(api, picker: () async => picture()),
          future = service.uploadAvatar();
      final rejected = expectLater(
        future,
        throwsA(
          isA<DioException>()
              .having((error) => error.type, 'type', DioExceptionType.cancel)
              .having(
                (error) => error.error,
                'session cancellation reason',
                isA<StateError>().having(
                  (error) => error.message,
                  'message',
                  'The customer session changed. The original request was not replayed.',
                ),
              ),
        ),
      );
      await entered.future;
      await api.passwordLogin(
        'other-test@example.invalid',
        'unit-test-only-password',
      );
      waiting.complete(jsonBody({'item': item()}));
      await rejected;
      expect(
        paths.any(
          (path) =>
              path.contains('/confirm') || path.contains('/commit-avatar'),
        ),
        false,
      );
    },
  );
  test(
    'a consumed multipart retry body preserves the original file bytes and request key',
    () async {
      final original = FormData.fromMap({
        'scope': 'AVATAR',
        'purpose': 'avatar',
        'requestKey': 'stable-retry-key',
        'file': MultipartFile.fromBytes(
          png,
          filename: 'avatar.png',
          contentType: DioMediaType.parse('image/png'),
        ),
      });
      final first = await original.finalize().expand((chunk) => chunk).toList();
      expect(original.isFinalized, true);
      final cloned = ApiService.cloneRetryBody(original) as FormData;
      expect(identical(cloned, original), false);
      expect(cloned.isFinalized, false);
      final second = await cloned.finalize().expand((chunk) => chunk).toList();
      expect(field(first, 'requestKey'), 'stable-retry-key');
      expect(field(second, 'requestKey'), 'stable-retry-key');
      expect(
        utf8.decode(second, allowMalformed: true),
        contains(utf8.decode(png, allowMalformed: true)),
      );
    },
  );
}
