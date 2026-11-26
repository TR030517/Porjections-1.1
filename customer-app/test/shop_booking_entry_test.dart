import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'booking_quote_fixture.dart';
import 'guest_booking_flow_test.dart' as guest;

ShopDetail catalog({
  String linkedService = '8',
  String linkedVariant = '81',
  bool available = true,
  bool variantActive = true,
  bool includeMenu = true,
  bool online = true,
  String id = '7',
}) => ShopDetail.fromJson({
  'id': id,
  'name': 'Booking entry studio',
  'latitude': 0,
  'longitude': 0,
  'timezone': 'America/New_York',
  'bookingCalendar': calendarFixture(),
  'features': {'onlineBooking': online},
  'services': [
    for (final row in [
      ('8', '81', 'Single massage', 1, 1, 5000),
      ('9', '91', 'Couple massage', 2, 2, 10000),
      ('10', '101', 'Four hands', 1, 2, 12000),
    ])
      {
        'id': row.$1,
        'name': row.$3,
        'durationMin': 60,
        'priceCents': row.$6,
        'participantCount': row.$4,
        'requiredStaffCount': row.$5,
        'hasVariants': true,
        'variants': [
          {
            'id': row.$2,
            'name': '60 minutes',
            'durationMin': 60,
            'priceCents': row.$6,
            'isActive': row.$1 != linkedService || variantActive,
          },
        ],
      },
  ],
  'priceMenu': [
    if (includeMenu)
      {
        'category': 'Massage menu',
        'items': [
          {
            'id': 'menu-1',
            'name': 'Chosen massage option',
            'priceText': 'USD 50',
            'bookingEnabled': true,
            'bookingAvailable': available,
            'booking': {'serviceId': linkedService, 'variantId': linkedVariant},
          },
        ],
      },
  ],
});

class EntryShops extends ShopRepository {
  EntryShops(this.current) : super(ApiService());
  ShopDetail current;
  final reads = <String>[];
  Completer<ShopDetail>? pending;
  @override
  Future<ShopDetail> getShopDetail(String id) {
    reads.add(id);
    return pending?.future ?? Future.value(current);
  }
}

class EntryBookings extends BookingRepository {
  EntryBookings() : super(ApiService());
  final writes = <Map<String, dynamic>>[];
  BookingPriceQuote? accepted;
  @override
  Future<SlotResponse> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) async => SlotResponse(
    date: date,
    timezone: 'America/New_York',
    durationMin: 60,
    variantId: variantId,
    participantCount: serviceId == '9' ? 2 : 1,
    requiredStaffCount: serviceId == '8' ? 1 : 2,
    slots: [TimeSlot(time: '10:00', available: true)],
  );
  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> request) async =>
      accepted = BookingPriceQuote.fromJson(
        timedQuoteJson(
          request,
          price: request['serviceId'] == '8'
              ? 5000
              : request['serviceId'] == '9'
              ? 10000
              : 12000,
          participants: request['serviceId'] == '9' ? 2 : 1,
        ),
      );
  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> request) async {
    writes.add(request);
    return quotedBookingFixture(
      request,
      accepted!,
      requiredStaffCount: request['serviceId'] == '8' ? 1 : 2,
    );
  }
}

Widget detail(
  ShopDetail initial,
  EntryShops shops, {
  EntryBookings? bookings,
  Widget? home,
}) => ProviderScope(
  overrides: [
    authProvider.overrideWith((ref) => guest.GuestAuth()),
    if (bookings != null) bookingRepositoryProvider.overrideWithValue(bookings),
    favoritesProvider.overrideWith((ref) => FavoritesNotifier(ApiService())),
    shopRepositoryProvider.overrideWithValue(shops),
    shopDetailProvider('7').overrideWith((ref) async => initial),
    shopDetailProvider('12').overrideWith((ref) async => catalog(id: '12')),
    shopReviewsProvider('7').overrideWith((ref) async => []),
    shopReviewsProvider('12').overrideWith((ref) async => []),
  ],
  child: guest.localized(
    home ?? ShopDetailScreen(shopId: initial.id, shopName: initial.name),
  ),
);

Future<void> openMenu(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(const ValueKey('price-menu-book-0-0')));
}

void main() {
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    ApiService().dio.httpClientAdapter = guest.GuestTransport();
    await ApiService().logout();
  });
  testWidgets('an old Book Now activation is ignored after leaving the shop', (
    tester,
  ) async {
    final initial = catalog(), shops = EntryShops(catalog());
    await tester.pumpWidget(detail(initial, shops));
    await tester.pumpAndSettle();
    final activate = tester
        .widget<FilledButton>(find.widgetWithText(FilledButton, 'Book Now').last)
        .onPressed!;
    await tester.pumpWidget(const SizedBox.shrink());

    activate();
    await tester.pump();
    expect(shops.reads, isEmpty);
    expect(tester.takeException(), isNull);
  });

  for (final entry in ['Book Now', 'linked menu', 'service card']) {
    testWidgets('the $entry entry cannot bypass a freshly closed shop', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final initial = catalog(), shops = EntryShops(catalog(online: false));
      await tester.pumpWidget(detail(initial, shops));
      await tester.pumpAndSettle();
      if (entry == 'linked menu') {
        await openMenu(tester);
        await tester.tap(find.byKey(const ValueKey('price-menu-book-0-0')));
      } else if (entry == 'service card') {
        final card = find.byKey(const ValueKey('booking-choice:9:91'));
        await tester.ensureVisible(card);
        await tester.tap(card);
      } else {
        await tester.tap(find.widgetWithText(FilledButton, 'Book Now').last);
      }
      await tester.pumpAndSettle();
      expect(shops.reads, ['7']);
      expect(find.byType(BookingScreen), findsNothing);
      expect(find.byType(SnackBar), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets('a price row cannot book another service specification', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final initial = catalog(linkedVariant: '91'), shops = EntryShops(
      catalog(linkedVariant: '91'),
    );
    await tester.pumpWidget(detail(initial, shops));
    await openMenu(tester);
    await tester.tap(find.byKey(const ValueKey('price-menu-book-0-0')));
    await tester.pumpAndSettle();
    expect(find.byType(BookingScreen), findsNothing);
    expect(find.textContaining('option changed'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'double clicking one menu option opens only one wizard and back returns to the shop',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final initial = catalog(),
          shops = EntryShops(catalog())..pending = Completer<ShopDetail>();
      await tester.pumpWidget(detail(initial, shops));
      await openMenu(tester);
      final book = find.byKey(const ValueKey('price-menu-book-0-0'));
      await tester.tap(book);
      await tester.tap(book);
      shops.pending!.complete(shops.current);
      await tester.pumpAndSettle();
      expect(shops.reads, ['7']);
      expect(find.byType(BookingScreen), findsOneWidget);
      await tester.tap(find.byType(BackButton).last);
      await tester.pumpAndSettle();
      expect(find.byType(BookingScreen), findsNothing);
      expect(find.byType(ShopDetailScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'a menu item rebound during the fresh read cannot silently choose another service',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final initial = catalog(),
          shops = EntryShops(
            catalog(linkedService: '10', linkedVariant: '101'),
          );
      await tester.pumpWidget(detail(initial, shops));
      await openMenu(tester);
      await tester.tap(find.byKey(const ValueKey('price-menu-book-0-0')));
      await tester.pumpAndSettle();
      expect(find.byType(BookingScreen), findsNothing);
      expect(find.textContaining('option changed'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'an older shop read cannot open its wizard after the visible shop has changed',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final initial = catalog(),
          shops = EntryShops(catalog())..pending = Completer<ShopDetail>();
      final selectedShop = ValueNotifier('7');
      addTearDown(selectedShop.dispose);
      await tester.pumpWidget(
        detail(
          initial,
          shops,
          home: ValueListenableBuilder<String>(
            valueListenable: selectedShop,
            builder: (_, id, _) =>
                ShopDetailScreen(shopId: id, shopName: 'Booking entry studio'),
          ),
        ),
      );
      await openMenu(tester);
      await tester.tap(find.byKey(const ValueKey('price-menu-book-0-0')));
      selectedShop.value = '12';
      await tester.pumpAndSettle();
      shops.pending!.complete(shops.current);
      await tester.pumpAndSettle();
      expect(
        tester.widget<ShopDetailScreen>(find.byType(ShopDetailScreen)).shopId,
        '12',
      );
      expect(find.byType(BookingScreen), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final update in [
    ('stops accepting online bookings', catalog(available: false)),
    ('removes the clicked menu row', catalog(includeMenu: false)),
    ('retires the selected specification', catalog(variantActive: false)),
  ]) {
    testWidgets(
      'a fresh menu that ${update.$1} cannot fall back to a different choice',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final initial = catalog(), shops = EntryShops(update.$2);
        await tester.pumpWidget(detail(initial, shops));
        await openMenu(tester);
        await tester.tap(find.byKey(const ValueKey('price-menu-book-0-0')));
        await tester.pumpAndSettle();
        expect(find.byType(BookingScreen), findsNothing);
        expect(find.textContaining('option changed'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'an unavailable shop read releases the entry lock so an explicit retry can succeed',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final initial = catalog(),
          shops = EntryShops(catalog())..pending = Completer<ShopDetail>();
      await tester.pumpWidget(detail(initial, shops));
      await openMenu(tester);
      final book = find.byKey(const ValueKey('price-menu-book-0-0'));
      await tester.tap(book);
      shops.pending!.completeError(StateError('Read unavailable'));
      await tester.pumpAndSettle();
      expect(find.byType(BookingScreen), findsNothing);
      expect(find.textContaining('currently unavailable'), findsOneWidget);
      shops.pending = null;
      await tester.tap(book);
      await tester.pumpAndSettle();
      expect(shops.reads, ['7', '7']);
      expect(find.byType(BookingScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final selection in [
    ('8', '81', 1, 1, 5000),
    ('9', '91', 2, 2, 10000),
    ('10', '101', 1, 2, 12000),
  ]) {
    testWidgets(
      'menu ${selection.$1} keeps its exact option through login cancellation, password return and one order submit',
      (tester) async {
        tester.view.physicalSize = const Size(1280, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final initial = catalog(
          linkedService: selection.$1,
          linkedVariant: selection.$2,
        );
        final shops = EntryShops(initial), bookings = EntryBookings();
        await tester.pumpWidget(detail(initial, shops, bookings: bookings));
        await openMenu(tester);
        await tester.tap(find.byKey(const ValueKey('price-menu-book-0-0')));
        await tester.pumpAndSettle();
        final container = ProviderScope.containerOf(
          tester.element(find.byType(BookingScreen)),
        );
        var state = container.read(bookingFlowProvider);
        expect(state.selectedService?.id, selection.$1);
        expect(state.selectedVariant?.id, selection.$2);
        expect(state.selectedService?.participantCount, selection.$3);
        expect(state.selectedService?.requiredStaffCount, selection.$4);
        expect(state.selectedPriceCents, selection.$5);
        await tester.tap(find.byType(FilledButton).last);
        await tester.pumpAndSettle();
        await tester.tap(find.byType(FilledButton).last);
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Today'));
        await tester.tap(find.text('Today'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('10:00 AM'));
        await tester.tap(find.text('10:00 AM'));
        await tester.pumpAndSettle();
        await tester.tap(find.byType(FilledButton).last);
        await tester.pumpAndSettle();
        final review = find.widgetWithText(
          OutlinedButton,
          'Sign in to review total',
        );
        await tester.ensureVisible(review);
        await tester.tap(review);
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsOneWidget);
        await tester.tap(find.byType(BackButton).last);
        await tester.pumpAndSettle();
        expect(
          container.read(bookingFlowProvider).selectedVariant?.id,
          selection.$2,
        );
        expect(container.read(bookingFlowProvider).selectedStartTime, '10:00');
        expect(bookings.writes, isEmpty);
        await tester.tap(review);
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byType(TextFormField).at(0),
          'guest-customer@example.invalid',
        );
        await tester.enterText(
          find.byType(TextFormField).at(1),
          'local-test-password',
        );
        await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsNothing);
        state = container.read(bookingFlowProvider);
        expect(state.selectedService?.id, selection.$1);
        expect(state.selectedVariant?.id, selection.$2);
        expect(state.selectedStartTime, '10:00');
        expect(state.hasValidPriceQuote, isTrue);
        expect(state.priceQuote?.totalCents, selection.$5);
        await tester.tap(find.byType(FilledButton).last);
        await tester.pumpAndSettle();
        expect(bookings.writes.length, 1);
        expect(bookings.writes.single['serviceId'], selection.$1);
        expect(bookings.writes.single['variantId'], selection.$2);
        expect(bookings.writes.single['date'], '2031-05-01');
        expect(bookings.writes.single['startTime'], '10:00');
        expect(bookings.writes.single['paymentMode'], 'PAY_AT_STORE');
        expect(find.byType(BookingDetailScreen), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
