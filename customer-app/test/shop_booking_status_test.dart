import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/shop_booking_status.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

Map<String, dynamic> service({
  int guests = 1,
  int staff = 1,
  int minutes = 60,
  int price = 8000,
  bool hasVariants = false,
  List<Map<String, dynamic>> variants = const [],
}) => {
  'id': '8',
  'name': 'Public service',
  'durationMin': minutes,
  'priceCents': price,
  'priceBasis': 'PER_BOOKING',
  'participantCount': guests,
  'requiredStaffCount': staff,
  'hasVariants': hasVariants,
  'variants': variants,
};

ShopDetail publicShop({
  bool online = true,
  bool? hasConfiguredBookingSchedule,
  List<Map<String, dynamic>> services = const [],
  List<Map<String, dynamic>> therapists = const [],
  List<Map<String, dynamic>>? menuItems,
  int menuCount = 13,
  String? phone,
}) => ShopDetail.fromJson({
  'id': '7',
  'name': 'Public price menu studio',
  'latitude': 0,
  'longitude': 0,
  'features': {'onlineBooking': online},
  'hasConfiguredBookingSchedule': ?hasConfiguredBookingSchedule,
  'phone': phone,
  'priceMenu': [
    {
      'category': 'Massage',
      'items': menuItems ?? List.generate(
        menuCount,
        (index) => {'name': 'Display project ${index + 1}', 'priceText': r'$80'},
      ),
    },
  ],
  'services': services,
  'therapists': therapists,
});

Widget app(Widget child) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: child),
);

void main() {
  testWidgets('thirteen display projects do not imply that online appointments are open', (tester) async {
    final shop = publicShop();
    expect(shop.priceMenu.single.items.length, 13);
    expect(shop.services, isEmpty);
    expect(shop.canBookOnline, isFalse);
    // No ProviderScope: this public explanation cannot depend on authentication.
    await tester.pumpWidget(app(ShopBookingStatus(shop: shop)));
    expect(find.text('Online booking is not set up yet'), findsOneWidget);
    expect(find.textContaining('has not linked any appointment services'), findsOneWidget);
    expect(find.text('Online booking is paused'), findsNothing);
    expect(find.byType(FilledButton), findsNothing);
    expect(find.byType(TextButton), findsNothing);
    expect(find.byType(LoginScreen), findsNothing);
    expect(shop.priceMenu.single.items.every((item) => !item.bookingEnabled), isTrue);
  });

  testWidgets('a paused shop stays paused even when its service has a valid option', (tester) async {
    final shop = publicShop(online: false, services: [service()], phone: '+1 212 555 0199');
    expect(shop.hasBookableServices, isTrue);
    expect(shop.canBookOnline, isFalse);
    Uri? opened;
    await tester.pumpWidget(app(ShopBookingStatus(shop: shop,
      openLink: (uri) async { opened = uri; return true; })));
    expect(find.text('Online booking is paused'), findsOneWidget);
    expect(find.textContaining('not accepting online bookings'), findsOneWidget);
    expect(find.textContaining('Phone: +1 212 555 0199'), findsOneWidget);
    expect(find.text('Online booking available'), findsNothing);
    expect(find.byType(FilledButton), findsNothing);
    expect(find.byType(LoginScreen), findsNothing);
    await tester.tap(find.text('Call the shop to book'));
    await tester.pumpAndSettle();
    expect(opened?.scheme, 'tel');
    expect(opened?.path, '+12125550199');
  });

  testWidgets('single, couple and four-hands options use existing model eligibility without promising a slot', (tester) async {
    for (final counts in [(1, 1), (2, 2), (1, 2)]) {
      final shop = publicShop(services: [service(guests: counts.$1, staff: counts.$2)]);
      expect(shop.canBookOnline, isTrue);
      await tester.pumpWidget(app(ShopBookingStatus(shop: shop)));
      expect(find.text('Online booking available'), findsOneWidget);
      expect(find.textContaining('check current dates and times'), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byType(LoginScreen), findsNothing);
    }
  });

  testWidgets('a valid active variant controls status even when the unused base has no usable price or minutes', (tester) async {
    final shop = publicShop(services: [
      service(minutes: 15, price: 0, hasVariants: true, variants: [
        {'id': '9', 'name': 'Saved 60 minutes', 'durationMin': 60, 'priceCents': 8000, 'priceBasis': 'PER_BOOKING', 'currency': 'usd', 'isActive': true},
      ]),
    ]);
    expect(shop.services.single.activeVariants.length, 1);
    expect(shop.canBookOnline, isTrue);
    await tester.pumpWidget(app(ShopBookingStatus(shop: shop)));
    expect(find.text('Online booking available'), findsOneWidget);
  });

  testWidgets('an exact active price-menu service link exposes online booking', (tester) async {
    final linked = publicShop(
      services: [service(hasVariants: true, variants: [
        {'id': '9', 'name': '60 minute option', 'durationMin': 60, 'priceCents': 8000, 'priceBasis': 'PER_BOOKING', 'currency': 'usd', 'isActive': true},
      ])],
      menuItems: [
        {'id': 'menu-1', 'name': '60 minute massage', 'priceText': r'$80', 'bookingEnabled': true, 'bookingAvailable': true,
          'booking': {'serviceId': '8', 'variantId': '9'}},
      ],
    );
    expect(linked.hasBookableServices, isTrue);
    expect(linked.hasBookablePriceMenuItems, isTrue);
    expect(linked.canBookOnline, isTrue);
    await tester.pumpWidget(app(ShopBookingStatus(shop: linked)));
    expect(find.text('Online booking available'), findsOneWidget);
  });

  test('menu booking links do not manufacture availability when their target is missing, inactive or mismatched', () {
    final inactive = publicShop(services: [service(price: 0, hasVariants: true)], menuItems: [
      {'id': 'menu-1', 'name': 'Inactive target', 'priceText': r'$80', 'bookingEnabled': true, 'bookingAvailable': true,
        'booking': {'serviceId': '8', 'variantId': 'missing'}},
    ]);
    final noService = publicShop(menuItems: [
      {'id': 'menu-1', 'name': 'Missing target', 'priceText': r'$80', 'bookingEnabled': true, 'bookingAvailable': true,
        'booking': {'serviceId': '404', 'variantId': '9'}},
    ]);
    expect(inactive.canBookOnline, isFalse);
    expect(noService.canBookOnline, isFalse);
  });

  testWidgets('inactive variants and invalid guest-staff counts do not manufacture a booking entry', (tester) async {
    final examples = [
      service(hasVariants: true),
      service(hasVariants: true, variants: [
        {'id': '9', 'name': 'Inactive option', 'durationMin': 60, 'priceCents': 8000, 'isActive': false},
      ]),
      service(guests: 2, staff: 1),
      service(price: 0),
    ];
    for (final row in examples) {
      final shop = publicShop(services: [row]);
      expect(shop.canBookOnline, isFalse);
      await tester.pumpWidget(app(ShopBookingStatus(shop: shop)));
      expect(find.text('Online booking is not set up yet'), findsOneWidget);
      expect(find.text('Online booking available'), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
    }
  });

  testWidgets('missing optional data remains an explicit unopened status and a refreshed shop replaces it', (tester) async {
    final missing = ShopDetail.fromJson({'id': '7', 'name': 'Legacy public shop', 'latitude': 0, 'longitude': 0});
    expect(missing.services, isEmpty);
    expect(missing.hasBookableServices, isFalse);
    await tester.pumpWidget(app(ShopBookingStatus(shop: missing)));
    expect(find.text('Online booking is not set up yet'), findsOneWidget);
    expect(find.textContaining('Phone:'), findsNothing);
    await tester.pumpWidget(app(ShopBookingStatus(shop: publicShop(services: [service()]))));
    expect(find.text('Online booking available'), findsOneWidget);
    expect(find.text('Online booking is not set up yet'), findsNothing);
    await tester.pumpWidget(app(ShopBookingStatus(shop: publicShop(online: false))));
    expect(find.text('Online booking is paused'), findsOneWidget);
    expect(find.text('Online booking available'), findsNothing);
  });

  testWidgets('a guest sees shop status before an entirely display-only menu on the actual detail screen', (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) => AuthNotifier(ApiService())),
        shopDetailProvider('7').overrideWith((ref) async => publicShop()),
        shopReviewsProvider('7').overrideWith((ref) async => []),
        favoritesProvider.overrideWith((ref) => FavoritesNotifier(ApiService())),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ShopDetailScreen(shopId: '7', shopName: 'Public price menu studio'),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Online booking is not set up yet'), findsOneWidget);
    expect(find.text('Display project 1'), findsNothing, reason: 'menu group is a compact collapsed row');
    expect(find.text('Massage'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Online booking is not set up yet')).dy,
        lessThan(tester.getTopLeft(find.text('Massage')).dy));
    expect(find.byType(LoginScreen), findsNothing);
    expect(find.byType(BookingScreen), findsNothing);
    expect(find.text('Book this service'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Book Now'), findsNothing);
    final browse = find.widgetWithText(FilledButton, 'View services & prices');
    expect(tester.widget<FilledButton>(browse).onPressed, isNotNull);
    await tester.ensureVisible(browse);
    await tester.tap(browse);
    await tester.pumpAndSettle();
    final group = find.byKey(const ValueKey('price-menu-group-toggle-0'));
    await tester.ensureVisible(group);
    await tester.tap(group);
    await tester.pumpAndSettle();
    final row = find.byKey(const ValueKey('price-menu-book-0-0'));
    expect(tester.widget<ShopServiceSelectionCard>(row).onSelected, isNull);
    expect(find.text('For display only · No online booking'), findsWidgets);
    await tester.ensureVisible(row);
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsNothing);
    expect(find.byType(BookingScreen), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no recurring schedule leaves prices visible and disables all shop booking entry points', (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final shop = publicShop(
      hasConfiguredBookingSchedule: false,
      services: [service()],
      menuItems: [
        {'id': 'menu-1', 'name': 'Public menu massage', 'priceText': r'$80',
          'bookingEnabled': true, 'bookingAvailable': false,
          'bookingUnavailableReason': 'NO_SCHEDULE', 'booking': {'serviceId': '8'}},
      ],
    );
    expect(shop.hasBookableServices, isTrue);
    expect(shop.canBookOnline, isFalse);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) => AuthNotifier(ApiService())),
        shopDetailProvider('7').overrideWith((ref) async => shop),
        shopReviewsProvider('7').overrideWith((ref) async => []),
        favoritesProvider.overrideWith((ref) => FavoritesNotifier(ApiService())),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ShopDetailScreen(
          shopId: '7', shopName: 'Public price menu studio', initialServiceId: '8',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('No appointment times are currently available'), findsOneWidget);
    expect(find.byType(BookingScreen), findsNothing);
    expect(find.text('Appointment services'), findsNothing);
    final group = find.byKey(const ValueKey('price-menu-group-toggle-0'));
    await tester.ensureVisible(group);
    await tester.tap(group);
    await tester.pumpAndSettle();
    final row = find.byKey(const ValueKey('price-menu-book-0-0'));
    expect(find.text('Public menu massage'), findsOneWidget);
    expect(find.text(r'$80'), findsOneWidget);
    expect(find.text('No appointment times are currently available'), findsNWidgets(2));
    expect(tester.widget<ShopServiceSelectionCard>(row).onSelected, isNull);
    expect(find.byType(LoginScreen), findsNothing);
  });

  testWidgets(
    'desktop booking and therapist guidance follows effective online availability',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      for (final (online, configured, status) in [
        (false, true, 'Online booking is paused'),
        (true, false, 'No appointment times are currently available'),
        (true, true, 'Online booking available'),
      ]) {
        final shop = publicShop(
          online: online,
          hasConfiguredBookingSchedule: configured,
          services: [service()],
          therapists: [
            {'id': '11', 'name': 'Test therapist'},
          ],
          phone: '+1 212 555 0199',
        );
        await tester.pumpWidget(ProviderScope(
          key: ValueKey(status),
          overrides: [
            authProvider.overrideWith((ref) => AuthNotifier(ApiService())),
            shopDetailProvider('7').overrideWith((ref) async => shop),
            shopReviewsProvider('7').overrideWith((ref) async => []),
            favoritesProvider.overrideWith((ref) => FavoritesNotifier(ApiService())),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const ShopDetailScreen(
              shopId: '7', shopName: 'Public price menu studio',
            ),
          ),
        ));
        await tester.pumpAndSettle();

        expect(find.text(status), findsOneWidget);
        expect(find.text('Test therapist'), findsOneWidget);
        expect(find.byType(ShopPriceMenu), findsOneWidget);
        final available = online && configured;
        final bookingGuidance = available ? findsOneWidget : findsNothing;
        final browsingGuidance = available ? findsNothing : findsOneWidget;
        expect(
          find.text('Choose your service, therapist and available time in the next steps.'),
          bookingGuidance,
        );
        expect(find.text('Choose your therapist when booking.'), bookingGuidance);
        expect(find.text('Browse services and prices for this shop.'), browsingGuidance);
        expect(find.text('Call the shop to book'), browsingGuidance);
        final book = find.widgetWithText(
          FilledButton,
          available ? 'Book Now' : 'Online booking unavailable',
        );
        expect(tester.widget<FilledButton>(book).onPressed != null, available);
        expect(tester.takeException(), isNull);
      }
    },
  );

  testWidgets('linked menu booking action opens the exact service and variant in the wizard', (tester) async {
    tester.view.physicalSize = const Size(430, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final linked = publicShop(
      menuItems: [
        {'id': 'menu-1', 'name': '60 minute massage', 'priceText': r'$80', 'bookingEnabled': true, 'bookingAvailable': true,
          'booking': {'serviceId': '8', 'variantId': '9'}},
      ],
      services: [service(hasVariants: true, variants: [
        {'id': '9', 'name': '60 minute option', 'durationMin': 60, 'priceCents': 8000, 'priceBasis': 'PER_BOOKING', 'currency': 'usd', 'isActive': true},
      ])],
    );
    final repository = _StaticShopRepository(linked);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) => AuthNotifier(ApiService())),
        shopDetailProvider('7').overrideWith((ref) async => linked),
        shopReviewsProvider('7').overrideWith((ref) async => []),
        favoritesProvider.overrideWith((ref) => FavoritesNotifier(ApiService())),
        shopRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ShopDetailScreen(shopId: '7', shopName: 'Public price menu studio'),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Book Now'), findsOneWidget, reason: 'global booking entry is available on mobile');
    final group = find.byKey(const ValueKey('price-menu-group-toggle-0'));
    await tester.ensureVisible(group);
    await tester.tap(group);
    await tester.pumpAndSettle();
    expect(find.text('60 minute massage'), findsOneWidget);
    final row = find.byKey(const ValueKey('price-menu-book-0-0'));
    await tester.ensureVisible(row);
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(find.byType(BookingScreen), findsOneWidget);
    final wizard = tester.widget<BookingScreen>(find.byType(BookingScreen));
    expect(wizard.initialService?.id, '8');
    expect(wizard.initialVariantId, '9');
    expect(tester.takeException(), isNull);
  });
}

class _StaticShopRepository extends ShopRepository {
  final ShopDetail shop;
  _StaticShopRepository(this.shop) : super(ApiService());
  @override
  Future<ShopDetail> getShopDetail(String shopId) async => shop;
}
