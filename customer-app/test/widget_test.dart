import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/app.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/locale_provider.dart';
import 'package:mjapp_client/providers/banner_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/screens/home_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

class DisabledQuickAuthAdapter implements HttpClientAdapter {
  final calls = <String>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options.path);
    if (options.path != '/auth/customer/config') {
      throw StateError('Disabled authentication must not issue a request');
    }
    return ResponseBody.fromString(
      jsonEncode({
        'passwordEnabled': true,
        'passwordRegistrationEnabled': false,
        'emailOtp': {'enabled': false},
        'google': {'enabled': false, 'webEnabled': false},
        'apple': {'enabled': false, 'webEnabled': false},
        'nativeSocialEnabled': false,
      }),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class AnonymousAuth extends AuthNotifier {
  AnonymousAuth() : super(ApiService());
  @override
  Future<void> checkSession() async {
    state = const AuthState();
  }
}

class PublicShops extends ShopRepository {
  PublicShops() : super(ApiService());
  @override
  Future<ShopListResponse> listShops({
    double? lat,
    double? lng,
    double? radius,
    String? category,
    String? keyword,
    String? city,
    int page = 1,
    int limit = 20,
  }) async => ShopListResponse.fromJson({
    'items': [
      {'id': '7', 'name': 'Public fixture shop', 'latitude': 0, 'longitude': 0},
    ],
    'total': 1,
  });
}

void main() {
  Future<void> renderLogin(WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: LoginScreen())),
    );
  }

  testWidgets(
    'login exposes password auth and disables unconfigured quick auth',
    (tester) async {
      final api = ApiService();
      final previousAdapter = api.dio.httpClientAdapter;
      final adapter = DisabledQuickAuthAdapter();
      api.dio.httpClientAdapter = adapter;
      addTearDown(() => api.dio.httpClientAdapter = previousAdapter);
      await renderLogin(tester);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextFormField, 'Email'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Password'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Sign in'))
            .onPressed,
        isNotNull,
      );
      for (final label in ['Continue with Google', 'Continue with Apple']) {
        final button = find.ancestor(
          of: find.text(label),
          matching: find.byWidgetPredicate(
            (widget) => widget is OutlinedButton,
          ),
        );
        expect(button, findsOneWidget);
        expect(tester.widget<OutlinedButton>(button).onPressed, isNull);
        await tester.ensureVisible(button);
        await tester.tap(button);
        await tester.pumpAndSettle();
      }
      final emailCode = find.widgetWithText(TextButton, 'Use email code or create account');
      expect(tester.widget<TextButton>(emailCode).onPressed, isNull);
      await tester.ensureVisible(emailCode);
      await tester.tap(emailCode);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextFormField, 'Email code'), findsNothing);
      expect(find.text('Send email code'), findsNothing);
      expect(
        find.textContaining('Unavailable methods are not enabled'),
        findsOneWidget,
      );
      expect(adapter.calls, ['/auth/customer/config']);
    },
  );
  testWidgets('new account access is disabled until email verification is configured', (
    tester,
  ) async {
    await renderLogin(tester);
    await tester.pumpAndSettle();
    final emailCode = find.widgetWithText(TextButton, 'Use email code or create account');
    expect(emailCode, findsOneWidget);
    expect(tester.widget<TextButton>(emailCode).onPressed, isNull);
    expect(find.text('Use an email code'), findsNothing);
    expect(find.text('Send email code'), findsNothing);
  });
  testWidgets(
    'customer app stays English on Chinese devices and still gates private tabs',
    (tester) async {
      tester.binding.platformDispatcher.localeTestValue = const Locale('zh', 'CN');
      addTearDown(tester.binding.platformDispatcher.clearLocaleTestValue);
      var privateLoads = 0;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => AnonymousAuth()),
            shopRepositoryProvider.overrideWith((ref) => PublicShops()),
            bannersProvider.overrideWith((ref) async => []),
            bookingListProvider.overrideWith((ref) async {
              privateLoads++;
              return [];
            }),
            favoriteShopsProvider.overrideWith((ref) async {
              privateLoads++;
              return [];
            }),
          ],
          child: const MassajoyApp(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(HomeScreen), findsOneWidget);
      final container = ProviderScope.containerOf(
        tester.element(find.byType(HomeScreen)),
      );
      final locale = container.read(localeProvider.notifier);
      expect(locale.detectLocale(const Locale('zh', 'CN')), customerLocale);
      locale.setLocale(const Locale('zh'));
      await tester.pumpAndSettle();
      expect(container.read(localeProvider), customerLocale);
      expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).locale,
          customerLocale);
      expect(Localizations.localeOf(tester.element(find.byType(HomeScreen))),
          customerLocale);
      expect(supportedLocales, [customerLocale]);
      expect(find.byType(LoginScreen), findsNothing);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
      await tester.pumpAndSettle();
      expect(find.text('Public fixture shop'), findsOneWidget);
      expect(privateLoads, 0);
      await tester.tap(find.byIcon(Icons.calendar_today_outlined));
      await tester.pumpAndSettle();
      expect(find.text('Sign in to continue'), findsOneWidget);
      expect(find.byType(BookingListScreen), findsNothing);
      expect(privateLoads, 0);
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsNothing);
      expect(find.text('Sign in to continue'), findsOneWidget);
      expect(privateLoads, 0);
      await tester.tap(find.byIcon(Icons.storefront_outlined).last);
      await tester.pumpAndSettle();
      expect(find.text('Public fixture shop'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
}
