import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/customer_access.dart';

import 'customer_session_transient_test.dart' show TransientWire;

class NavigationWire extends TransientWire {
  Completer<void>? loginEntered, loginRelease;
  @override
  Future<ResponseBody> fetch(
    RequestOptions request,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    if (request.path == '/auth/customer/config') {
      await stream?.drain<void>();
      paths.add(request.path);
      return response({
        'passwordEnabled': true,
        'emailOtp': {'enabled': false},
        'google': {'enabled': false},
        'apple': {'enabled': false},
      });
    }
    if (request.path == '/auth/customer/password/login') {
      final reply = await super.fetch(request, stream, cancelFuture);
      if (loginEntered?.isCompleted == false) loginEntered!.complete();
      await loginRelease?.future;
      return reply;
    }
    return super.fetch(request, stream, cancelFuture);
  }
}

class AccessHarness extends ConsumerWidget {
  final void Function() resumedAction;
  const AccessHarness({super.key, required this.resumedAction});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    body: TextButton(
      onPressed: () async {
        if (await requireCustomerSignIn(context, ref) && context.mounted) {
          resumedAction();
        }
      },
      child: const Text('Save shop probe'),
    ),
  );
}

class NavigationObserver extends NavigatorObserver {
  void Function(Route<dynamic>)? onPop;
  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    onPop?.call(route);
  }
}

class NavigationCase {
  final NavigationWire wire;
  final AuthNotifier auth;
  final NavigationObserver observer = NavigationObserver();
  int resumed = 0;
  NavigationCase(this.wire, this.auth);
}

Future<void> withNavigationCase(
  WidgetTester tester,
  ApiService api,
  Future<void> Function(NavigationCase fixture) action,
) async {
  FlutterSecureStorage.setMockInitialValues({});
  final previous = api.dio.httpClientAdapter;
  final wire = NavigationWire()..verified = true;
  api.dio.httpClientAdapter = wire;
  await tester.runAsync(api.logout);
  final fixture = NavigationCase(wire, AuthNotifier(api));
  try {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authProvider.overrideWith((_) => fixture.auth)],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          navigatorObservers: [fixture.observer],
          home: AccessHarness(resumedAction: () => fixture.resumed++),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await action(fixture);
    expect(tester.takeException(), isNull);
  } finally {
    fixture.observer.onPop = null;
    await tester.pumpWidget(const SizedBox.shrink());
    if (fixture.auth.mounted) fixture.auth.dispose();
    wire.profileRelease = null;
    wire.loginRelease = null;
    await tester.runAsync(api.logout);
    api.dio.httpClientAdapter = previous;
  }
}

Future<void> enterPasswordLogin(
  WidgetTester tester,
  NavigationCase fixture, {
  bool waitForResult = true,
}) async {
  await tester.enterText(find.byType(TextFormField).at(0), fixture.wire.email);
  await tester.enterText(
    find.byType(TextFormField).at(1),
    'synthetic-password',
  );
  final button = find.widgetWithText(FilledButton, 'Sign in');
  await tester.ensureVisible(button);
  // Run the real form callback outside fake-async: secure storage and the Dio
  // adapter are asynchronous even though this transport never uses a network.
  await tester.runAsync(() async {
    final completed = Completer<void>();
    final removeListener = fixture.auth.addListener((state) {
      if (!state.isLoading && !completed.isCompleted) {
        completed.complete();
      }
    }, fireImmediately: false);
    try {
      tester.widget<FilledButton>(button).onPressed!();
      if (waitForResult) {
        await completed.future.timeout(const Duration(seconds: 10));
      } else {
        await fixture.wire.loginEntered!.future;
      }
    } finally {
      removeListener();
    }
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Construct outside the widget fake-async zone; ApiService initializes
  // persisted credentials asynchronously.
  final api = ApiService();

  testWidgets(
    'cold profile503 stays on the shop; retry never replays the action',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final wire = NavigationWire()..verified = true;
      final previous = api.dio.httpClientAdapter;
      api.dio.httpClientAdapter = wire;
      await tester.runAsync(api.logout);
      final first = AuthNotifier(api);
      await tester.runAsync(
        () => first.passwordLogin(wire.email, 'synthetic-password'),
      );
      final token = await tester.runAsync(api.getAccessToken);
      first.dispose();
      final cold = AuthNotifier(api);
      var resumed = 0;
      try {
        wire.paths.clear();
        wire.profileOutcome = 503;
        await tester.runAsync(cold.checkSession);
        expect(cold.state.sessionUnavailable, isTrue);
        expect(cold.state.isLoggedIn, isFalse);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [authProvider.overrideWith((_) => cold)],
            child: MaterialApp(
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: AccessHarness(resumedAction: () => resumed++),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Save shop probe'));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsNothing);
        expect(resumed, 0);
        expect(wire.paths, ['/auth/me']);
        expect(await tester.runAsync(api.getAccessToken), token);

        wire.profileOutcome = 200;
        await tester.runAsync(cold.checkSession);
        await tester.pumpAndSettle();
        expect(cold.state.user?.id, '41');
        expect(cold.state.sessionUnavailable, isFalse);
        expect(find.byType(LoginScreen), findsNothing);
        expect(resumed, 0);
        expect(await tester.runAsync(api.getAccessToken), token);
        await tester.tap(find.text('Save shop probe'));
        await tester.pumpAndSettle();
        expect(resumed, 1);
        expect(wire.paths, ['/auth/me', '/auth/me']);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        if (cold.mounted) cold.dispose();
        wire.profileOutcome = 200;
        await tester.runAsync(api.logout);
        api.dio.httpClientAdapter = previous;
      }
    },
  );

  testWidgets('anonymous login returns once to the original protected action', (
    tester,
  ) async {
    await withNavigationCase(tester, api, (fixture) async {
      await tester.tap(find.text('Save shop probe'));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      await enterPasswordLogin(tester, fixture);
      await tester.runAsync(
        () async => await Future<void>.delayed(Duration.zero),
      );
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsNothing);
      expect(fixture.auth.state.user?.id, '41');
      expect(fixture.resumed, 1);
      expect(
        fixture.wire.paths.where((path) => path.endsWith('/password/login')),
        hasLength(1),
      );
    });
  });

  testWidgets(
    'repeated anonymous taps share one layer and external restore returns false',
    (tester) async {
      await withNavigationCase(tester, api, (fixture) async {
        final button = tester.widget<TextButton>(
          find.widgetWithText(TextButton, 'Save shop probe'),
        );
        button.onPressed!();
        button.onPressed!();
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsOneWidget);
        expect(
          fixture.wire.paths.where((path) => path == '/auth/customer/config'),
          hasLength(1),
        );
        // A saved identity may be verified outside this login layer.
        await tester.runAsync(
          () => fixture.auth.passwordLogin(
            fixture.wire.email,
            'synthetic-password',
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Return to previous page'), findsOneWidget);
        expect(fixture.resumed, 0);
        await tester.tap(find.text('Return to previous page'));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsNothing);
        expect(fixture.resumed, 0);
        await tester.tap(find.text('Save shop probe'));
        await tester.pumpAndSettle();
        expect(fixture.resumed, 1);
      });
    },
  );

  for (final oldOutcome in [200, 503]) {
    testWidgets(
      'verification in progress and late $oldOutcome cannot replay across accounts',
      (tester) async {
        await withNavigationCase(tester, api, (fixture) async {
          await tester.runAsync(
            () => fixture.auth.passwordLogin(
              fixture.wire.email,
              'synthetic-password',
            ),
          );
          fixture.wire.profileOutcome = oldOutcome;
          late Future<void> verification;
          await tester.runAsync(() async {
            fixture.wire.profileEntered = Completer<void>();
            fixture.wire.profileRelease = Completer<void>();
            verification = fixture.auth.checkSession();
            await fixture.wire.profileEntered!.future;
          });
          expect(fixture.auth.state.isLoading, isTrue);
          await tester.tap(find.text('Save shop probe'));
          await tester.tap(find.text('Save shop probe'));
          await tester.pumpAndSettle();
          expect(find.byType(LoginScreen), findsNothing);
          expect(fixture.resumed, 0);
          fixture.wire.customer = '42';
          fixture.wire.token = 'new-account-token';
          await tester.runAsync(
            () => fixture.auth.passwordLogin(
              fixture.wire.email,
              'synthetic-password',
            ),
          );
          fixture.wire.profileRelease!.complete();
          await tester.runAsync(() => verification);
          await tester.pumpAndSettle();
          expect(fixture.auth.state.user?.id, '42');
          expect(fixture.auth.state.sessionUnavailable, isFalse);
          expect(fixture.resumed, 0);
          expect(find.byType(LoginScreen), findsNothing);
          await tester.tap(find.text('Save shop probe'));
          await tester.pumpAndSettle();
          expect(fixture.resumed, 1);
        });
      },
    );
  }

  testWidgets(
    'late login receipt never closes a newer route or resumes the old action',
    (tester) async {
      await withNavigationCase(tester, api, (fixture) async {
        await tester.tap(find.text('Save shop probe'));
        await tester.pumpAndSettle();
        await tester.runAsync(() async {
          fixture.wire.loginEntered = Completer<void>();
          fixture.wire.loginRelease = Completer<void>();
        });
        await enterPasswordLogin(tester, fixture, waitForResult: false);
        await tester.runAsync(() => fixture.wire.loginEntered!.future);
        final navigator = tester.state<NavigatorState>(find.byType(Navigator));
        unawaited(
          navigator.push<void>(
            MaterialPageRoute<void>(
              builder: (_) => const Scaffold(body: Text('Newer route')),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.runAsync(() async {
          final completed = Completer<void>();
          final removeListener = fixture.auth.addListener((state) {
            if (!state.isLoading && !completed.isCompleted) {
              completed.complete();
            }
          }, fireImmediately: false);
          try {
            fixture.wire.loginRelease!.complete();
            await completed.future.timeout(const Duration(seconds: 10));
          } finally {
            removeListener();
          }
        });
        await tester.pumpAndSettle();
        expect(find.text('Newer route'), findsOneWidget);
        expect(fixture.resumed, 0);
        navigator.pop();
        await tester.pumpAndSettle();
        expect(find.text('Return to previous page'), findsOneWidget);
        await tester.tap(find.text('Return to previous page'));
        await tester.pumpAndSettle();
        expect(fixture.resumed, 0);
      });
    },
  );

  testWidgets(
    'account generation changed during login return cannot authorize its previous caller',
    (tester) async {
      await withNavigationCase(tester, api, (fixture) async {
        await tester.tap(find.text('Save shop probe'));
        await tester.pumpAndSettle();
        Future<void>? switched;
        fixture.observer.onPop = (_) {
          fixture.observer.onPop = null;
          fixture.wire.customer = '42';
          fixture.wire.token = 'new-account-token';
          switched = fixture.auth.passwordLogin(
            fixture.wire.email,
            'synthetic-password',
          );
        };
        await enterPasswordLogin(tester, fixture);
        await tester.runAsync(
          () async => await Future<void>.delayed(Duration.zero),
        );
        await tester.pumpAndSettle();
        await tester.runAsync(() async => await switched);
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsNothing);
        expect(fixture.auth.state.user?.id, '42');
        expect(fixture.resumed, 0);
      });
    },
  );
}
