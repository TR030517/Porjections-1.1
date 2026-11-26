import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/navigation/customer_routes.dart';
import 'package:mjapp_client/navigation/public_information_routes.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/public_information_screen.dart';
import 'package:mjapp_client/screens/shop_link_screen.dart';
import 'package:mjapp_client/screens/support_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/support_service.dart';
import 'package:mjapp_client/widgets/public_information_links.dart';
import 'package:mjapp_client/widgets/shop_directory_notice.dart';

class _Support extends SupportService {
  final PublicSupport result;
  _Support(this.result) : super(Dio());
  @override
  Future<PublicSupport> load() async => result;
}

class _UnknownShop extends ShopRepository {
  final reads = <String>[];
  _UnknownShop() : super(ApiService());
  @override
  Future<ShopDetail> resolveShop({String? shortName, String? legacyId}) async {
    reads.add(shortName ?? legacyId!);
    throw DioException(
      requestOptions: RequestOptions(path: '/shops/resolve'),
      response: Response(
        requestOptions: RequestOptions(path: '/shops/resolve'),
        statusCode: 404,
      ),
    );
  }
}

Widget _app(
  Widget screen, {
  PublicSupport support = const PublicSupport(siteName: 'Synthetic platform'),
}) => ProviderScope(
  overrides: [supportServiceProvider.overrideWithValue(_Support(support))],
  child: MaterialApp(
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: screen,
  ),
);

ShopDetail _shop({bool incomplete = true}) => ShopDetail.fromJson({
  'id': '7',
  'name': 'Synthetic directory shop',
  'latitude': 0,
  'longitude': 0,
  'listingDetailsIncomplete': incomplete,
  'features': {'onlineBooking': true},
  'services': [
    {'id': '8', 'name': 'Massage', 'durationMin': 60, 'priceCents': 8000},
  ],
});

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  for (final route in ['/privacy', '/terms', '/support', '/feedback']) {
    testWidgets(
      '$route is an anonymous public route ahead of the shop wildcard',
      (tester) async {
        final shops = _UnknownShop();
        final router = GoRouter(
          initialLocation: route,
          overridePlatformDefaultLocation: true,
          routes: [
            GoRoute(
              path: '/',
              builder: (_, _) => const Scaffold(body: Text('Directory')),
            ),
            ...publicInformationRoutes(),
            GoRoute(
              path: '/:rootName',
              builder: (_, state) => ShopLinkScreen(uri: state.uri),
            ),
          ],
        );
        addTearDown(router.dispose);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              supportServiceProvider.overrideWithValue(
                _Support(const PublicSupport(siteName: 'Synthetic platform')),
              ),
              shopRepositoryProvider.overrideWithValue(shops),
            ],
            child: MaterialApp.router(routerConfig: router),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(ShopLinkScreen), findsNothing);
        expect(shops.reads, isEmpty);
        if (route == '/privacy' || route == '/terms') {
          expect(find.byType(PublicInformationScreen), findsOneWidget);
          expect(
            find.textContaining('operator approval pending'),
            findsOneWidget,
          );
        } else {
          expect(find.byType(SupportScreen), findsOneWidget);
          expect(find.textContaining('Nothing has been sent'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'unknown shop routes remain unavailable and select no alternate shop',
    (tester) async {
      final shops = _UnknownShop();
      final router = GoRouter(
        initialLocation: '/unknown-directory-shop',
        overridePlatformDefaultLocation: true,
        routes: [
          ...publicInformationRoutes(),
          GoRoute(
            path: '/:rootName',
            builder: (_, state) => ShopLinkScreen(uri: state.uri),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [shopRepositoryProvider.overrideWithValue(shops)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Shop unavailable'), findsOneWidget);
      expect(
        find.textContaining('No other shop has been selected'),
        findsOneWidget,
      );
      expect(shops.reads, ['unknown-directory-shop']);
      expect(find.byType(PublicInformationScreen), findsNothing);
    },
  );

  testWidgets(
    'public links work without a router and drafts remain readable at phone width',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final entry in [
        ('Privacy', PublicInformationPage.privacy),
        ('Terms', PublicInformationPage.terms),
      ]) {
        await tester.pumpWidget(
          _app(const Scaffold(body: PublicInformationLinks())),
        );
        await tester.tap(find.text(entry.$1));
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<PublicInformationScreen>(
                find.byType(PublicInformationScreen),
              )
              .page,
          entry.$2,
        );
        expect(find.textContaining('not a final legal policy'), findsOneWidget);
        await tester.scrollUntilVisible(
          find.text('Operator review still required'),
          500,
        );
        expect(find.text('Operator review still required'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }
    },
  );

  test(
    'feedback context accepts only bounded shop IDs and supported request topics',
    () {
      for (final query in [
        {'shopId': '0', 'topic': 'claim'},
        {'shopId': '7', 'topic': 'https://evil.invalid'},
        {'shopId': '7', 'topic': 'claim', 'shopName': 'bad\nname'},
        {'shopId': '7', 'topic': 'correction', 'shopName': 'x' * 201},
      ]) {
        expect(ShopSupportContext.fromQuery(query), isNull);
      }
      expect(
        ShopSupportContext.fromQuery({
          'shopId': '7',
          'topic': 'correction',
          'shopName': 'Synthetic shop',
        })?.shopId,
        '7',
      );
      expect(CustomerShopEntry.fromUri(Uri.parse('/feedback')), isNull);
    },
  );

  testWidgets(
    'directory correction and claim retain shop context without pretending to submit',
    (tester) async {
      final shop = _shop();
      expect(shop.onlineBookingEnabled, isTrue);
      expect(shop.hasBookableOptions, isTrue);
      expect(shop.canBookOnline, isFalse);
      expect(
        Shop.fromJson({
          'id': '7',
          'latitude': 0,
          'longitude': 0,
          'listingDetailsIncomplete': true,
        }).listingDetailsIncomplete,
        isTrue,
      );
      for (final topic in ['Suggest a correction', 'Claim this shop']) {
        await tester.pumpWidget(
          _app(Scaffold(body: ShopDirectoryNotice(shop: shop))),
        );
        expect(find.text('Details awaiting verification'), findsOneWidget);
        await tester.tap(find.text(topic));
        await tester.pumpAndSettle();
        expect(find.byType(SupportScreen), findsOneWidget);
        expect(find.textContaining('Shop ID: 7'), findsOneWidget);
        expect(find.textContaining('Synthetic directory shop'), findsOneWidget);
        await tester.scrollUntilVisible(find.textContaining('Nothing has been sent'), 250, scrollable: find.byType(Scrollable).last);
        expect(find.textContaining('Nothing has been sent'), findsOneWidget);
        expect(find.text('Email support'), findsNothing);
        expect(find.text('Call support'), findsNothing);
        expect(find.byType(BookingScreen), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
      }
      expect(_shop(incomplete: false).canBookOnline, isTrue);
    },
  );

  testWidgets(
    'only published contacts launch and failed handlers leave copyable details',
    (tester) async {
      Uri? opened;
      final report = const ShopSupportContext(
        shopId: '7',
        shopName: 'Synthetic & shop',
        topic: 'correction',
      );
      await tester.pumpWidget(
        _app(
          SupportScreen(
            shopContext: report,
            openLink: (uri) async {
              opened = uri;
              return false;
            },
          ),
          support: const PublicSupport(
            siteName: 'Synthetic platform',
            email: 'help@example.invalid',
            phone: '+1 (212) 555-0100',
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Email support'), 250, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Email support'));
      await tester.pumpAndSettle();
      expect(opened?.scheme, 'mailto');
      expect(opened?.path, 'help@example.invalid');
      expect(opened?.queryParameters['body'], report.report);
      expect(find.textContaining('Unable to open this app'), findsOneWidget);
      expect(find.text('help@example.invalid'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Call support'), 250, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Call support'));
      await tester.pumpAndSettle();
      expect(opened?.scheme, 'tel');
      expect(opened?.path, '+12125550100');
    },
  );

  testWidgets('incomplete directory record blocks direct booking wizard', (
    tester,
  ) async {
    await tester.pumpWidget(_app(BookingScreen(shop: _shop())));
    await tester.pumpAndSettle();
    expect(
      find.text('No online appointments are available at this time.'),
      findsOneWidget,
    );
    expect(find.text('Confirm booking'), findsNothing);
  });
}
