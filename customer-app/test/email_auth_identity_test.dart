import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'guest_booking_flow_test.dart' show publicShop;

class EmailIdentityWire implements HttpClientAdapter {
  final paths = <String>[];
  String email = 'original@example.invalid', name = 'Original customer';
  String customer = '41';
  bool verified = false;
  Completer<void>? verifyEntered, verifyRelease, logoutEntered, logoutRelease;
  Map<String, dynamic> profile() => {
    'id': customer,
    'role': 'CUSTOMER',
    'status': 'ACTIVE',
    'name': name,
    'phone': null,
    'email': email,
    'emailVerified': verified,
    'avatarUrl': null,
  };
  @override
  Future<ResponseBody> fetch(
    RequestOptions request,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    await stream?.drain<void>();
    paths.add(request.path);
    Object body;
    if (request.path == '/auth/customer/email/verify') {
      final receipt = {...profile(), 'emailVerified': true};
      verifyEntered?.complete();
      await verifyRelease?.future;
      body = {'accessToken': 'synthetic-email-$customer', 'user': receipt};
    } else if (request.path == '/auth/customer/password/login') {
      body = {'accessToken': 'synthetic-password-$customer', 'user': profile()};
    } else if (request.path == '/auth/customer/email/verify-current') {
      verifyEntered?.complete();
      await verifyRelease?.future;
      body = {'verified': true};
    } else if (request.path == '/auth/customer/logout') {
      if (logoutEntered?.isCompleted == false) logoutEntered!.complete();
      await logoutRelease?.future;
      body = {'ok': true};
    } else if (request.path == '/auth/me') {
      body = profile();
    } else if (request.path == '/users/$customer' &&
        request.method == 'PATCH') {
      final data = request.data as Map;
      email = (data['email'] ?? email) as String;
      name = (data['name'] ?? name) as String;
      if (data['email'] != null) verified = false;
      body = profile();
    } else {
      throw StateError('Unexpected identity endpoint ${request.path}');
    }
    return ResponseBody.fromString(
      jsonEncode(body),
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
  late HttpClientAdapter previous;
  late EmailIdentityWire wire;
  late AuthNotifier auth;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    api = ApiService();
    previous = api.dio.httpClientAdapter;
    wire = EmailIdentityWire();
    api.dio.httpClientAdapter = wire;
    await api.logout();
    wire.paths.clear();
    auth = AuthNotifier(api);
  });
  tearDown(() async {
    auth.dispose();
    await api.logout();
    api.dio.httpClientAdapter = previous;
  });
  test(
    'email verification adopts its verified CUSTOMER receipt without another profile request',
    () async {
      final user = await auth.verifyEmailLogin('challenge-one', '123456');
      expect(user.id, '41');
      expect(user.emailVerified, isTrue);
      expect(auth.state.user?.email, 'original@example.invalid');
      expect(auth.state.isLoggedIn, isTrue);
      expect(wire.paths, ['/auth/customer/email/verify']);
      expect(await api.getAccessToken(), 'synthetic-email-41');
    },
  );
  test(
    'logout prevents a late email-login receipt from restoring customer identity',
    () async {
      wire.verifyEntered = Completer<void>();
      wire.verifyRelease = Completer<void>();
      final rejected = expectLater(
        auth.verifyEmailLogin('challenge-old', '123456'),
        throwsA(isA<DioException>()),
      );
      await wire.verifyEntered!.future;
      await auth.logout();
      wire.verifyRelease!.complete();
      await rejected;
      expect(auth.state.isLoggedIn, isFalse);
      expect(auth.state.user, isNull);
      expect(await api.getAccessToken(), isNull);
      expect(wire.paths.where((p) => p == '/auth/me'), isEmpty);
    },
  );
  test(
    'a late verify-current receipt cannot replace a newer saved email or name',
    () async {
      await auth.passwordLogin(
        'original@example.invalid',
        'synthetic-password',
      );
      wire.verifyEntered = Completer<void>();
      wire.verifyRelease = Completer<void>();
      final rejected = expectLater(
        auth.verifyCurrentEmail('old-challenge', '123456'),
        throwsStateError,
      );
      await wire.verifyEntered!.future;
      await auth.updateProfile(
        name: 'New customer name',
        email: 'new@example.invalid',
      );
      wire.verifyRelease!.complete();
      await rejected;
      expect(auth.state.user?.name, 'New customer name');
      expect(auth.state.user?.email, 'new@example.invalid');
      expect(auth.state.user?.emailVerified, isFalse);
    },
  );
  test(
    'a late verify-current receipt cannot undo a newer read-back for the same email',
    () async {
      await auth.passwordLogin(
        'original@example.invalid',
        'synthetic-password',
      );
      wire.verifyEntered = Completer<void>();
      wire.verifyRelease = Completer<void>();
      final rejected = expectLater(
        auth.verifyCurrentEmail('old-challenge', '123456'),
        throwsStateError,
      );
      await wire.verifyEntered!.future;
      wire.name = 'Read-back name';
      wire.verified = true;
      await auth.reloadProfile();
      wire.verifyRelease!.complete();
      await rejected;
      expect(auth.state.user?.name, 'Read-back name');
      expect(auth.state.user?.email, 'original@example.invalid');
      expect(auth.state.user?.emailVerified, isTrue);
    },
  );
  test(
    'logout immediately hides identity and clears its booking draft while the server is pending',
    () async {
      await auth.passwordLogin(
        'original@example.invalid',
        'synthetic-password',
      );
      final container = ProviderContainer(
        overrides: [authProvider.overrideWith((_) => auth)],
      );
      final flow = container.read(bookingFlowProvider.notifier);
      final shop = publicShop();
      flow.initFlow(shop);
      flow.selectService(shop.services.single);
      wire.logoutEntered = Completer<void>();
      wire.logoutRelease = Completer<void>();
      final logout = auth.logout();
      expect(auth.state.isLoggedIn, isFalse);
      expect(auth.state.user, isNull);
      expect(container.read(bookingFlowProvider).shop, isNull);
      await wire.logoutEntered!.future;
      wire.logoutRelease!.complete();
      await logout;
      // This scope owns auth; let tearDown dispose the replacement instead.
      container.dispose();
      auth = AuthNotifier(api);
    },
  );
}
