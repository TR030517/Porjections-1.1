import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/customer_password_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'customer_session_transient_test.dart' show TransientWire;

class PasswordWire extends TransientWire {
  int changeStatus = 200;
  bool recoveryEnabled = true;
  String? errorCode;
  final passwordRequests = <RequestOptions>[];
  Completer<void>? entered, release;
  @override
  Future<ResponseBody> fetch(
    RequestOptions request,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    if (request.path == '/auth/customer/config') {
      await stream?.drain<void>();
      return response({'passwordRecoveryEnabled': recoveryEnabled});
    }
    if (request.path.startsWith('/auth/customer/password/') &&
        !request.path.endsWith('/login')) {
      await stream?.drain<void>();
      passwordRequests.add(request);
      if (request.path.endsWith('/request')) {
        return response({
          'challengeId': 'synthetic-recovery-proof',
          'resendAfter': 60,
        });
      }
      if (entered?.isCompleted == false) entered!.complete();
      await release?.future;
      return response(
        errorCode == null
            ? {
                'changed': true,
                'reauthenticationRequired': true,
                'revokedSessions': 2,
              }
            : {'code': errorCode},
        changeStatus,
      );
    }
    return super.fetch(request, stream, cancelFuture);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late ApiService api;
  late PasswordWire wire;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    api = ApiService();
    wire = PasswordWire();
    api.dio.httpClientAdapter = wire;
    await api.logout().catchError((_) {});
    wire.paths.clear();
  });
  tearDown(() async {
    await api.logout().catchError((_) {});
  });

  test(
    'customer policy measures UTF-8 bytes, keeps spaces and rejects controls',
    () {
      expect(customerPasswordError('12345'), isNotNull);
      expect(customerPasswordError('密码'), isNull);
      expect(customerPasswordError('密' * 24), isNull);
      expect(customerPasswordError('密' * 25), isNotNull);
      expect(customerPasswordError(' abcde'), isNull);
      expect(customerPasswordError('abc\n123'), isNotNull);
      expect(customerPasswordError('abc\u0000123'), isNotNull);
    },
  );

  test(
    'confirmed change clears customer access and stored refresh without logging out another role',
    () async {
      await api.passwordLogin(
        'customer@example.test',
        'old-synthetic-password',
      );
      final generation = api.sessionGeneration;
      await api.changeCustomerPassword(
        'old-synthetic-password',
        'new-synthetic-password',
      );
      expect(api.sessionGeneration, generation + 1);
      expect(await api.getAccessToken(), isNull);
      expect(
        await const FlutterSecureStorage().read(key: 'refresh_token'),
        isNull,
      );
      expect(
        wire.passwordRequests.single.path,
        '/auth/customer/password/change',
      );
      expect(wire.paths.where((path) => path == '/auth/logout'), isEmpty);
    },
  );

  test(
    'invalid current password is not refreshed or replayed and retains current identity',
    () async {
      await api.passwordLogin(
        'customer@example.test',
        'old-synthetic-password',
      );
      final generation = api.sessionGeneration;
      wire.changeStatus = 401;
      await expectLater(
        api.changeCustomerPassword('wrong', 'new-synthetic-password'),
        throwsA(isA<DioException>()),
      );
      expect(api.sessionGeneration, generation);
      expect(await api.getAccessToken(), isNotNull);
      expect(wire.passwordRequests, hasLength(1));
      expect(wire.paths.where((path) => path.contains('/refresh')), isEmpty);
    },
  );

  test(
    'late successful password receipt does not clear a newer sign-in',
    () async {
      await api.passwordLogin(
        'customer@example.test',
        'old-synthetic-password',
      );
      wire.entered = Completer<void>();
      wire.release = Completer<void>();
      final change = api.changeCustomerPassword(
        'old-synthetic-password',
        'new-synthetic-password',
      );
      final assertion = expectLater(change, throwsA(anything));
      await wire.entered!.future;
      wire.customer = '99';
      await api.passwordLogin('other@example.test', 'other-synthetic-password');
      final generation = api.sessionGeneration;
      wire.release!.complete();
      await assertion;
      expect(api.sessionGeneration, generation);
      expect(await api.getAccessToken(), isNotNull);
    },
  );

  testWidgets(
    'recovery requests a separate proof and invalidates it on email edit',
    (tester) async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            home: CustomerPasswordScreen(
              recovery: true,
              initialEmail: 'customer@example.test',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send recovery code'));
      await tester.pumpAndSettle();
      expect(
        wire.passwordRequests.single.path,
        '/auth/customer/password/recovery/request',
      );
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'other@example.test',
      );
      await tester.enterText(find.byType(TextFormField).at(1), '123456');
      await tester.enterText(
        find.byType(TextFormField).at(2),
        'new-synthetic-password',
      );
      await tester.enterText(
        find.byType(TextFormField).at(3),
        'new-synthetic-password',
      );
      await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Reset password'),
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Reset password'));
      await tester.pumpAndSettle();
      expect(wire.passwordRequests, hasLength(1));
      expect(
        find.text('Request and enter the 6-digit recovery code.'),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('disabled recovery exposes no enabled send or reset action', (
    tester,
  ) async {
    wire.recoveryEnabled = false;
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: CustomerPasswordScreen(recovery: true)),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Send recovery code'),
          )
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Reset password'),
          )
          .onPressed,
      isNull,
    );
    expect(wire.passwordRequests, isEmpty);
  });

  testWidgets(
    'duplicate change click sends one request and ambiguous failure freezes resubmit',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await tester.runAsync(
        () => container
            .read(authProvider.notifier)
            .passwordLogin('customer@example.test', 'old-synthetic-password'),
      );
      expect(container.read(authProvider).isLoggedIn, isTrue);
      expect(container.read(authProvider).sessionUnavailable, isFalse);
      wire.changeStatus = 503;
      await tester.runAsync(() async {
        wire.entered = Completer<void>();
        wire.release = Completer<void>();
      });
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: CustomerPasswordScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).at(0),
        'old-synthetic-password',
      );
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'new-synthetic-password',
      );
      await tester.enterText(
        find.byType(TextFormField).at(2),
        'new-synthetic-password',
      );
      await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Change password'),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.widgetWithText(FilledButton, 'Change password'));
        await tester.tap(find.widgetWithText(FilledButton, 'Change password'));
        await wire.entered!.future.timeout(const Duration(seconds: 5));
      });
      await tester.pump();
      expect(wire.passwordRequests, hasLength(1));
      await tester.runAsync(() async {
        wire.release!.complete();
        await Future<void>.delayed(Duration.zero);
      });
      // The Dio request was started in the real async zone. Pumping frames
      // alone cannot wait for its interceptor/error queue to finish.
      for (
        var attempt = 0;
        attempt < 100 &&
            find.textContaining('It may have completed.').evaluate().isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
        await tester.pump();
      }
      expect(find.textContaining('It may have completed.'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Change password'),
            )
            .onPressed,
        isNull,
      );
      expect(wire.passwordRequests, hasLength(1));
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'unchanged-password response retains recovery proof and asks for a different password',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      wire.changeStatus = 400;
      wire.errorCode = 'PASSWORD_UNCHANGED';
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: CustomerPasswordScreen(
              recovery: true,
              initialEmail: 'customer@example.test',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send recovery code'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(1), '123456');
      await tester.enterText(
        find.byType(TextFormField).at(2),
        'old-synthetic-password',
      );
      await tester.enterText(
        find.byType(TextFormField).at(3),
        'old-synthetic-password',
      );
      await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Reset password'),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Reset password'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Your recovery code can still be used.'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Reset password'),
            )
            .onPressed,
        isNotNull,
      );
      expect(
        wire.passwordRequests.last.data['challengeId'],
        'synthetic-recovery-proof',
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
}
