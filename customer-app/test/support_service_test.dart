import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/services/support_service.dart';

void main() {
  test('missing published contacts remain empty without invented values', () {
    final result = PublicSupport.fromJson({
      'siteName': 'Synthetic',
      'email': null,
      'phone': null,
    });
    expect(result.email, isNull);
    expect(result.phone, isNull);
  });
  test('malformed or executable contact values are rejected', () {
    for (final input in [
      {'siteName': 'Synthetic', 'email': 'javascript:alert(1)', 'phone': null},
      {'siteName': 'Synthetic', 'email': null, 'phone': '123'},
      {'siteName': 123, 'email': null, 'phone': null},
    ]) {
      expect(() => PublicSupport.fromJson(input), throwsFormatException);
    }
  });
  test(
    'contact service uses one public whitelist endpoint without an account-dependent request',
    () async {
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            expect(options.path, '/public/support');
            expect(options.extra['publicRead'], isTrue);
            handler.resolve(
              Response(
                requestOptions: options,
                data: {
                  'siteName': 'Synthetic',
                  'email': 'help@example.invalid',
                  'phone': '+1 (212) 555-0100',
                },
              ),
            );
          },
        ),
      );
      final result = await SupportService(dio).load();
      expect(result.email, 'help@example.invalid');
      dio.close();
    },
  );
}
