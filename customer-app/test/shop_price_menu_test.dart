import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

ShopDetail menuShop() => ShopDetail.fromJson({
  'id': '7',
  'name': 'Studio',
  'latitude': 0,
  'longitude': 0,
  'description': 'A quiet studio.',
  'features': {'onlineBooking': true},
  'priceMenu': [
    {
      'category': 'Body massage',
      'items': [
        {
          'name': 'Signature massage',
          'priceText': 'From \$80',
          'description': 'Ask about available options.',
          'imageUrl': 'javascript:alert(1)',
        },
      ],
    },
  ],
});

Widget app(Widget child) => MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

ShopDetail appointmentShop({required bool withMenu}) => ShopDetail.fromJson({
  'id': '7',
  'name': 'Studio',
  'latitude': 0,
  'longitude': 0,
  'features': {'onlineBooking': true},
  'priceMenu': [
    if (withMenu)
      {
        'category': 'Display menu',
        'items': [
          for (var index = 0; index < 30; index++)
            {
              'name': 'Menu item ${index + 1}',
              'priceText': 'From \$80',
              'description':
                  'Display wording only; confirm options with the studio.',
            },
        ],
      },
  ],
  'services': [
    {
      'id': '501',
      'name': 'Online appointment massage',
      'category': 'MASSAGE',
      'durationMin': 60,
      'priceCents': 9000,
      'currency': 'usd',
      'priceBasis': 'PER_PERSON',
    },
  ],
});

void main() {
  test('published prices stay literal and never become bookable services', () {
    final shop = menuShop();
    expect(shop.description, 'A quiet studio.');
    expect(shop.priceMenu.single.items.single.priceText, 'From \$80');
    expect(shop.priceMenu.single.items.single.imageUrl, isNull);
    expect(shop.services, isEmpty);
    expect(shop.canBookOnline, isFalse);
    expect(
      ShopPriceMenuGroup.parse([
        null,
        {'items': 'bad'},
        {
          'category': '',
          'items': [
            {},
            {'name': '', 'priceText': '10'},
          ],
        },
      ]),
      isEmpty,
    );
    expect(
      ShopPriceMenuGroup.parse([
        {'category': 'Special offer', 'items': []},
      ]),
      isEmpty,
    );
  });

  test('base service eligibility follows server positive USD amount rule', () {
    ShopService service(int cents, String currency) => ShopService(
      id: '1',
      name: 'Massage',
      category: 'MASSAGE',
      durationMin: 60,
      priceCents: cents,
      currency: currency,
    );
    expect(service(0, 'usd').canBook, isFalse);
    expect(service(-1, 'usd').canBook, isFalse);
    expect(service(8000, 'eur').canBook, isFalse);
    expect(service(8000, 'usd').canBook, isTrue);
  });

  testWidgets(
    'display menu is independent of About and has no fake booking panel',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            shopDetailProvider('7').overrideWith((ref) async => menuShop()),
            shopReviewsProvider('7').overrideWith((ref) async => []),
            favoritesProvider.overrideWith(
              (ref) => FavoritesNotifier(ApiService()),
            ),
          ],
          child: app(const ShopDetailScreen(shopId: '7', shopName: 'Studio')),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
      await tester.pumpAndSettle();
      expect(find.text('Services & prices'), findsOneWidget);
      expect(find.text('Signature massage'), findsOneWidget);
      expect(find.text('From \$80'), findsOneWidget);
      expect(find.text('A quiet studio.'), findsOneWidget);
      expect(find.text('Plan your visit'), findsNothing);
      expect(find.text('No services have been listed yet.'), findsNothing);
      expect(find.text('Book now'), findsNothing);
    },
  );

  testWidgets('direct booking route rejects a menu-only shop', (tester) async {
    await tester.pumpWidget(
      ProviderScope(child: app(BookingScreen(shop: menuShop()))),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('No online appointments are available at this time.'),
      findsOneWidget,
    );
    expect(find.byType(FilledButton), findsNothing);
  });

  for (final withMenu in [true, false]) {
    testWidgets(
      'View services reveals appointment choices ${withMenu ? 'below a long display menu' : 'without a display menu'}',
      (tester) async {
        tester.view.physicalSize = const Size(1200, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              shopDetailProvider('7').overrideWith(
                (ref) async => appointmentShop(withMenu: withMenu),
              ),
              shopReviewsProvider('7').overrideWith((ref) async => []),
              favoritesProvider.overrideWith(
                (ref) => FavoritesNotifier(ApiService()),
              ),
            ],
            child: app(const ShopDetailScreen(shopId: '7', shopName: 'Studio')),
          ),
        );
        await tester.pumpAndSettle();
        if (withMenu) {
          await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
          await tester.pumpAndSettle();
          // Exercise the original long-menu positioning case after the reader
          // explicitly expands all batches in the display-only menu.
          for (var batch = 0; batch < 4; batch++) {
            final more = find.text('Show more services');
            await tester.ensureVisible(more);
            await tester.tap(more);
            await tester.pumpAndSettle();
          }
          expect(find.text('Menu item 30'), findsOneWidget);
        }
        final action = find.text('View services');
        final heading = find.text('Appointment services');
        final appointment = find.text('Online appointment massage');
        final viewport = tester.getRect(find.byType(SingleChildScrollView));
        await tester.ensureVisible(action);
        await tester.pumpAndSettle();
        if (withMenu) {
          expect(tester.getRect(heading).top, greaterThan(viewport.bottom));
        }
        await tester.tap(action);
        await tester.pumpAndSettle();
        expect(tester.getRect(heading).top, greaterThanOrEqualTo(viewport.top));
        expect(
          tester.getRect(appointment).bottom,
          lessThanOrEqualTo(viewport.bottom),
        );
        if (withMenu) {
          expect(
            tester.getRect(find.text('Services & prices')).bottom,
            lessThan(viewport.top),
          );
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
}
