import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/social_auth_platform_stub.dart';

class CustomerAuthTransport implements HttpClientAdapter {
  final calls = <({String path, dynamic body})>[];
  String role = 'CUSTOMER';
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final bytes =
        await requestStream?.expand((chunk) => chunk).toList() ?? <int>[];
    calls.add((
      path: options.path,
      body: bytes.isEmpty ? null : jsonDecode(utf8.decode(bytes)),
    ));
    final Object value;
    switch (options.path) {
      case '/auth/customer/config':
        value = {
          'passwordEnabled': true,
          'passwordRegistrationEnabled': false,
          'emailOtp': {'enabled': false},
          'google': {'enabled': false},
          'apple': {'enabled': false},
        };
      case '/auth/customer/email/request':
        value = {
          'challengeId': 'challenge-unit',
          'expiresIn': 600,
          'resendAfter': 60,
        };
      case '/auth/customer/social/challenge':
        value = {'challengeId': 'social-unit', 'nonce': 'n' * 43};
      case '/auth/customer/providers/GOOGLE/link':
        value = {'linked': true, 'provider': 'GOOGLE'};
      case '/auth/customer/logout':
        value = {'success': true};
      default:
        value = {
          'accessToken': 'synthetic-access',
          'refreshToken': 'synthetic-refresh',
          'user': {'id': '42', 'role': role, 'phone': null},
          if (options.path == '/auth/customer/email/verify')
            'reauthToken': 'synthetic-link-proof',
        };
    }
    return ResponseBody.fromString(
      jsonEncode(value),
      200,
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
  late CustomerAuthTransport transport;
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    api = ApiService();
    transport = CustomerAuthTransport();
    api.dio.httpClientAdapter = transport;
  });
  tearDown(() async {
    await api.logout();
  });
  test(
    'customer password uses a separate endpoint and accepts a customer without a phone',
    () async {
      final user = await api.passwordLogin(
        'customer@example.invalid',
        'synthetic-password',
      );
      expect(user.role, 'CUSTOMER');
      expect(user.phone, isNull);
      expect(transport.calls.single.path, '/auth/customer/password/login');
      expect(transport.calls.single.body, {
        'email': 'customer@example.invalid',
        'password': 'synthetic-password',
      });
    },
  );
  test(
    'management role cannot become a customer session through a response',
    () async {
      transport.role = 'ADMIN';
      await expectLater(
        api.passwordLogin('manager@example.invalid', 'synthetic-password'),
        throwsStateError,
      );
      expect(await api.getAccessToken(), isNull);
    },
  );
  test(
    'email code sends only challenge and code for single-use server verification',
    () async {
      final result = await api.requestEmailLogin(' customer@example.invalid ');
      expect(result['resendAfter'], 60);
      await api.verifyEmailLogin(result['challengeId'] as String, '123456');
      expect(transport.calls[0].body, {'email': 'customer@example.invalid'});
      expect(transport.calls[1].body, {
        'challengeId': 'challenge-unit',
        'code': '123456',
      });
    },
  );
  test(
    'identity login carries server challenge and never adds a role or trusted email',
    () async {
      await api.socialChallenge('GOOGLE');
      await api.socialLogin(
        provider: 'google',
        idToken: 'synthetic-id-token',
        challengeId: 'social-unit',
      );
      expect(transport.calls[0].body, {'provider': 'GOOGLE'});
      expect(transport.calls[1].body, {
        'idToken': 'synthetic-id-token',
        'challengeId': 'social-unit',
      });
      await api.linkCustomerProvider(
        'GOOGLE',
        'synthetic-id-token',
        'social-unit',
        'synthetic-password',
      );
      expect(transport.calls.last.body, {
        'idToken': 'synthetic-id-token',
        'challengeId': 'social-unit',
        'password': 'synthetic-password',
      });
    },
  );
  test(
    'missing configuration is reported and native social authentication stays unavailable',
    () async {
      expect((await api.customerAuthConfig())['emailOtp'], {'enabled': false});
      expect((await api.customerAuthConfig())['passwordRegistrationEnabled'], false);
      expect(socialWebSupported, isFalse);
      await expectLater(
        obtainIdentityToken(
          provider: 'GOOGLE',
          clientId: 'unused',
          nonce: 'unused',
        ),
        throwsUnsupportedError,
      );
    },
  );
  test(
    'fresh email verification can explicitly link without inventing a password',
    () async {
      await api.verifyEmailLogin('challenge-unit', '123456');
      await api.linkCustomerProvider(
        'GOOGLE',
        'synthetic-id-token',
        'social-unit',
        '',
      );
      expect(transport.calls.last.body, {
        'idToken': 'synthetic-id-token',
        'challengeId': 'social-unit',
        'reauthToken': 'synthetic-link-proof',
      });
      expect(
        (transport.calls.last.body as Map).containsKey('password'),
        isFalse,
      );
    },
  );
}
