import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/review_form_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

ShopDetail shop({Map<String, dynamic>? features}) => ShopDetail.fromJson({
  'id': '7',
  'name': 'Test shop',
  'latitude': 0,
  'longitude': 0,
  'features': features,
  'services': [
    {
      'id': '8',
      'name': 'Browseable service',
      'durationMin': 60,
      'priceCents': 10000,
    },
  ],
});

Widget app(Widget screen) => MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: screen,
);

void main() {
  test('only an explicit false closes a legacy shop feature', () {
    expect(shop().onlineBookingEnabled, isTrue);
    expect(shop().reviewsEnabled, isTrue);
    expect(
      shop(features: {'onlineBooking': false}).onlineBookingEnabled,
      isFalse,
    );
    expect(shop(features: {'onlineBooking': false}).reviewsEnabled, isTrue);
    expect(shop(features: {'reviews': false}).reviewsEnabled, isFalse);
  });

  testWidgets(
    'closed booking keeps services visible with disabled entry points',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            shopDetailProvider('7').overrideWith(
              (ref) async =>
                  shop(features: {'onlineBooking': false, 'reviews': false}),
            ),
            shopReviewsProvider('7').overrideWith((ref) async => []),
            favoritesProvider.overrideWith(
              (ref) => FavoritesNotifier(ApiService()),
            ),
          ],
          child: app(
            const ShopDetailScreen(shopId: '7', shopName: 'Test shop'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Browseable service'), findsOneWidget);
      final fixedButton = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Online booking unavailable'),
      );
      expect(fixedButton.onPressed, isNull);
      final serviceCard = find.descendant(
        of: find.byKey(const ValueKey('booking-choice:8:base')),
        matching: find.byType(ShopServiceSelectionCard),
      );
      expect(tester.widget<ShopServiceSelectionCard>(serviceCard).onSelected, isNull);
      await tester.ensureVisible(serviceCard);
      await tester.tap(serviceCard);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('not accepting new or updated reviews'),
        findsOneWidget,
      );
      expect(find.byType(BookingScreen), findsNothing);
    },
  );

  testWidgets('direct booking entry cannot start a closed shop wizard', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        child: app(
          BookingScreen(shop: shop(features: {'onlineBooking': false})),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('This shop has not opened online booking.'),
      findsOneWidget,
    );
    expect(find.byType(FilledButton), findsNothing);
    expect(find.text('Confirm'), findsNothing);
  });

  testWidgets(
    'review form waits for availability and rejects a closed shop even when editing',
    (tester) async {
      final result = Completer<ShopDetail>();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            shopDetailProvider('7').overrideWith((ref) => result.future),
          ],
          child: app(
            const ReviewFormScreen(
              bookingId: '42',
              shopId: '7',
              editReviewId: '10',
              editRating: 5,
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
      result.complete(shop(features: {'reviews': false}));
      await tester.pumpAndSettle();
      expect(
        find.text('This shop is not accepting new or updated reviews.'),
        findsOneWidget,
      );
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byType(TextField), findsNothing);
    },
  );
}
