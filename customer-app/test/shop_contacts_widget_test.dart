import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/screens/shop_link_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/shop_contacts.dart';

ShopDetail publicContactShop({bool empty = false}) => ShopDetail.fromJson({
  'id': '7', 'name': 'Synthetic contact studio', 'latitude': 0, 'longitude': 0,
  'address': empty ? '' : '12 Main Street', 'city': 'Test Harbor', 'state': 'NY',
  'zipCode': '10002', 'phone': '+19995550999',
  'phones': empty ? [] : ['+1 (999) 555-0102', '999-555-0103'],
  'emails': empty ? [] : ['front.desk+booking@example.test', 'hello@example.test'],
  'owner': {'email': 'hidden-owner@example.test'},
  'features': {'onlineBooking': false},
});

Widget localized(Widget child) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

class ContactShops extends ShopRepository {
  ContactShops() : super(ApiService());
  int resolves = 0;
  @override
  Future<ShopDetail> resolveShop({String? shortName, String? legacyId}) async {
    expect(shortName, 'synthetic-contact');
    resolves++;
    return publicContactShop();
  }
}

void main() {
  testWidgets('multiple public contacts render narrowly and launch only after the matching click', (tester) async {
    tester.view.physicalSize = const Size(320, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final opened = <Uri>[];
    await tester.pumpWidget(localized(Scaffold(body: SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: ShopContacts(shop: publicContactShop(), openLink: (uri) async {
        opened.add(uri);
        return true;
      }),
    ))));
    await tester.pumpAndSettle();
    expect(opened, isEmpty);
    for (final text in ['+1 (999) 555-0102', '999-555-0103',
      'front.desk+booking@example.test', 'hello@example.test',
      '12 Main Street, Test Harbor, NY, 10002']) {
      expect(find.text(text), findsOneWidget);
    }
    expect(find.textContaining('hidden-owner'), findsNothing);
    expect(find.text('+19995550999'), findsNothing);
    await tester.tap(find.byTooltip('Call +1 (999) 555-0102'));
    await tester.pumpAndSettle();
    expect(opened.single.toString(), 'tel:+19995550102');
    await tester.ensureVisible(find.byTooltip('Email hello@example.test'));
    await tester.tap(find.byTooltip('Email hello@example.test'));
    await tester.pumpAndSettle();
    expect(opened.last.toString(), 'mailto:hello@example.test');
    await tester.ensureVisible(find.byTooltip('Open in Google Maps'));
    await tester.tap(find.byTooltip('Open in Google Maps'));
    await tester.pumpAndSettle();
    expect(opened.last.host, 'www.google.com');
    expect(opened.last.queryParameters['query'],
        '12 Main Street, Test Harbor, NY, 10002');
    expect(opened, hasLength(3));
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty contacts do not revive old data and locality alone offers no shop map', (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(localized(Scaffold(body: ShopContacts(
      shop: publicContactShop(empty: true),
      openLink: (uri) async { opened.add(uri); return true; },
    ))));
    await tester.pumpAndSettle();
    expect(find.text('Phone details have not been added.'), findsOneWidget);
    expect(find.text('Email'), findsNothing);
    expect(find.byTooltip('Open in Google Maps'), findsNothing);
    expect(find.textContaining('+1999'), findsNothing);
    expect(find.byIcon(Icons.call_outlined), findsOneWidget,
        reason: 'only the noninteractive section icon remains');
    expect(opened, isEmpty);
  });

  testWidgets('failed launch keeps selectable values and shows brief feedback without retrying', (tester) async {
    var calls = 0;
    await tester.pumpWidget(localized(Scaffold(body: SingleChildScrollView(
      child: ShopContacts(
        shop: publicContactShop(),
        openLink: (_) async { calls++; return false; },
      ),
    ))));
    await tester.pumpAndSettle();
    expect(calls, 0);
    await tester.ensureVisible(find.byTooltip('Call +1 (999) 555-0102'));
    await tester.tap(find.byTooltip('Call +1 (999) 555-0102'));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('Unable to open this contact. You can copy the details.'), findsOneWidget);
    expect(find.widgetWithText(SelectableText, '+1 (999) 555-0102'), findsOneWidget);
    expect(find.byTooltip('Copy phone +1 (999) 555-0102'), findsOneWidget);
  });

  for (final shortLink in [false, true]) {
    testWidgets('shared public contacts on ${shortLink ? 'short-link' : 'current-ID'} detail', (tester) async {
      tester.view.physicalSize = const Size(900, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = ContactShops();
      await tester.pumpWidget(ProviderScope(
        overrides: [
          shopRepositoryProvider.overrideWith((ref) => repository),
          shopDetailProvider('7').overrideWith((ref) async => publicContactShop()),
          shopReviewsProvider('7').overrideWith((ref) async => []),
          favoritesProvider.overrideWith((ref) => FavoritesNotifier(ApiService())),
        ],
        child: localized(shortLink
            ? ShopLinkScreen(uri: Uri.parse('/s/synthetic-contact'))
            : const ShopDetailScreen(shopId: '7', shopName: 'Synthetic contact studio')),
      ));
      await tester.pumpAndSettle();
      expect(find.byType(ShopContacts), findsOneWidget);
      expect(find.text('hello@example.test'), findsOneWidget);
      expect(find.text('999-555-0103'), findsOneWidget);
      expect(find.byTooltip('Open in Google Maps'), findsOneWidget);
      expect(find.text('Directions'), findsOneWidget);
      expect(repository.resolves, shortLink ? 1 : 0);
      expect(tester.takeException(), isNull);
    });
  }
}
