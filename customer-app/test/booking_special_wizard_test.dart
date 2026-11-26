import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/locale_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/theme/customer_theme.dart';
import 'package:mjapp_client/widgets/booking_calendar_picker.dart';
import 'package:mjapp_client/widgets/shop_closure_notice.dart';

import 'booking_quote_fixture.dart';
import 'guest_booking_flow_test.dart' show GuestAuth;

Map<String, dynamic> shopCalendar() => {
  'today': '2031-05-01',
  'timezone': 'America/Los_Angeles',
  // The server UTC date is already May 2; this is May 1, 7 PM at the shop.
  'serverNow': '2031-05-02T02:00:00Z',
  'validUntil': '2031-05-02T07:00:00Z',
};

ShopDetail specialShop({int guests = 2, int notice = 720}) =>
    ShopDetail.fromJson({
      'id': '7',
      'name': 'Pacific studio',
      'latitude': 0,
      'longitude': 0,
      'phone': '206-555-0123',
      'timezone': 'America/Los_Angeles',
      'pricingPolicy': 'PER_ORDER',
      'bookingCalendar': shopCalendar(),
      'bookingSettings': {
        'minimumNoticeMinutes': notice,
        'closedPeriods': [
          {'startDate': '2031-04-29', 'endDate': '2031-04-30'},
          {'startDate': '2031-05-02', 'endDate': '2031-05-03'},
        ],
      },
      'services': [
        {
          'id': '9',
          'name': guests == 2
              ? 'Couple relaxation massage'
              : 'Four hands relaxation massage',
          'durationMin': 60,
          'priceCents': 15000,
          'priceBasis':
              'PER_PERSON', // Historical basis must normalize to per order.
          'participantCount': guests,
          'requiredStaffCount': 2,
          'variants': [
            for (final row in [('91', 60, 15000), ('92', 90, 21000)])
              {
                'id': row.$1,
                'name': '${row.$2}-minute visit',
                'durationMin': row.$2,
                'priceCents': row.$3,
                'priceBasis': 'PER_PERSON',
                'isActive': true,
              },
          ],
        },
      ],
    });

class SpecialAvailability extends BookingRepository {
  final int guests;
  final reads = <Map<String, dynamic>>[];
  final quotes = <Map<String, dynamic>>[];
  Completer<BookingPriceQuote>? deferredQuote;
  int writes = 0;
  SpecialAvailability(this.guests) : super(ApiService());

  @override
  Future<SlotResponse> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) async {
    reads.add({
      'shopId': shopId,
      'serviceId': serviceId,
      'variantId': variantId,
      'date': date,
    });
    return SlotResponse.fromJson({
      'date': date,
      'timezone': 'America/Los_Angeles',
      'bookingCalendar': shopCalendar(),
      'durationKind': 'TIMED',
      'durationMin': variantId == '92' ? 90 : 60,
      'priceCents': variantId == '92' ? 21000 : 15000,
      'priceBasis': 'PER_BOOKING',
      'variantId': variantId,
      'participantCount': guests,
      'requiredStaffCount': 2,
      'slots': [
        {'time': '10:00', 'available': date == '2031-05-04'},
        {'time': '10:30', 'available': false},
      ],
    });
  }

  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> selection) async {
    quotes.add(Map.of(selection));
    if (deferredQuote != null) return deferredQuote!.future;
    return BookingPriceQuote.fromJson(
      timedQuoteJson(
        selection,
        price: selection['variantId'] == '92' ? 21000 : 15000,
        minutes: selection['variantId'] == '92' ? 90 : 60,
        participants: guests,
      ),
    );
  }

  @override
  Future<Booking> createBookingWithAddOns(
    Map<String, dynamic> selection,
  ) async {
    writes++;
    throw StateError('This read/selection test does not submit orders');
  }
}

class UpdatedSchedule extends ShopRepository {
  final ShopDetail updated;
  UpdatedSchedule(this.updated) : super(ApiService());
  @override
  Future<ShopDetail> getShopDetail(String shopId) async => updated;
}

Widget app(Widget child, {double textScale = 1}) => MaterialApp(
  theme: buildCustomerTheme(),
  // Use the same fixed customer locale as the production app.
  locale: customerLocale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: child,
);

void viewport(WidgetTester tester, double width) {
  tester.view.physicalSize = Size(width, 1000);
  tester.view.devicePixelRatio = 1;
  tester.platformDispatcher.localeTestValue = const Locale('zh');
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.platformDispatcher.clearLocaleTestValue);
}

Future<void> click(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> openSummary(WidgetTester tester, ShopDetail shop) async {
  await click(tester, find.text(shop.services.single.name));
  await click(tester, find.text('90-minute visit'));
  await click(tester, find.byType(FilledButton).last);
  await click(tester, find.byType(FilledButton).last);
  await click(tester, find.text('Today'));
  await tester.scrollUntilVisible(
    find.text('5/4'),
    150,
    scrollable: find.descendant(
      of: find.byType(BookingCalendarPicker),
      matching: find.byType(Scrollable),
    ),
  );
  await click(tester, find.text('5/4'));
  await click(tester, find.text('10:00 AM'));
  await click(tester, find.byType(FilledButton).last);
}

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  test('only the legacy default therapist title is translated', () {
    for (final title in ['按摩技师', ' 按摩技师 ']) {
      final therapist = Therapist.fromJson({
        'id': '1',
        'name': '王师傅',
        'title': title,
        'bio': '定制介绍',
      });
      expect(therapist.publicTitle, 'Massage therapist');
      expect(therapist.name, '王师傅');
      expect(therapist.bio, '定制介绍');
    }
    for (final title in ['中医理疗师', 'Licensed massage specialist', null]) {
      expect(
        Therapist.fromJson({'id': '1', 'title': title}).publicTitle,
        title,
      );
    }
  });

  testWidgets(
    'shop displays English for the known default role and retains custom copy',
    (tester) async {
      viewport(tester, 375);
      final shop = ShopDetail.fromJson({
        'id': '7',
        'name': 'Public studio',
        'latitude': 0,
        'longitude': 0,
        'therapists': [
          {'id': '1', 'name': 'Alex', 'title': '按摩技师'},
          {'id': '2', 'name': 'Jordan', 'title': 'Licensed specialist'},
        ],
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => GuestAuth()),
            shopDetailProvider('7').overrideWith((ref) async => shop),
            shopReviewsProvider('7').overrideWith((ref) async => []),
            favoritesProvider.overrideWith(
              (ref) => FavoritesNotifier(ApiService()),
            ),
          ],
          child: app(
            const ShopDetailScreen(shopId: '7', shopName: 'Public studio'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Massage therapist'));
      expect(find.text('按摩技师'), findsNothing);
      expect(find.text('Massage therapist'), findsOneWidget);
      expect(find.text('Licensed specialist'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final counts in [(2, 'Couple'), (1, 'Four hands')]) {
    testWidgets(
      '${counts.$2} narrow wizard keeps total, shared 90-minute block, guest/staff counts and shop-local date',
      (tester) async {
        viewport(tester, 320);
        final shop = specialShop(guests: counts.$1),
            repo = SpecialAvailability(counts.$1);
        final container = ProviderContainer(
          overrides: [
            authProvider.overrideWith((ref) => GuestAuth()),
            bookingRepositoryProvider.overrideWithValue(repo),
          ],
        );
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: app(BookingScreen(shop: shop), textScale: 1.3),
          ),
        );
        await tester.pumpAndSettle();
        await click(tester, find.text(shop.services.single.name));
        await click(tester, find.text('90-minute visit'));
        var state = container.read(bookingFlowProvider);
        expect(state.selectedService?.participantCount, counts.$1);
        expect(state.selectedService?.requiredStaffCount, 2);
        expect(state.selectedDuration, 90);
        expect(state.selectedPriceCents, 21000);
        expect(find.textContaining('USD 420.00'), findsNothing);
        expect(
          find.textContaining(
            '${counts.$1} ${counts.$1 == 1 ? 'guest' : 'guests'} · 2 therapists',
          ),
          findsWidgets,
        );
        await click(tester, find.byType(FilledButton).last);
        expect(
          find.text('Two qualified therapists will be assigned'),
          findsOneWidget,
        );
        await click(tester, find.byType(FilledButton).last);
        expect(find.byType(BookingCalendarPicker), findsOneWidget);
        expect(find.byType(ShopClosureNotice), findsOneWidget);
        expect(find.textContaining('12 hours'), findsOneWidget);
        expect(find.textContaining('May 2–3'), findsOneWidget);
        expect(find.textContaining('Apr 29'), findsNothing);
        expect(
          find.text('Shop-local date · America/Los_Angeles'),
          findsOneWidget,
        );
        expect(find.byType(DropdownButtonFormField<String>), findsNothing);
        final closedDate = tester.widget<OutlinedButton>(
          find.ancestor(
            of: find.text('5/2'),
            matching: find.byType(OutlinedButton),
          ),
        );
        expect(closedDate.onPressed, isNull);
        await click(tester, find.text('Today'));
        expect(repo.reads.single['date'], '2031-05-01');
        expect(find.text('No available slots for this date'), findsOneWidget);
        expect(container.read(bookingFlowProvider).hasSelection, isFalse);
        await tester.scrollUntilVisible(
          find.text('5/4'),
          150,
          scrollable: find.descendant(
            of: find.byType(BookingCalendarPicker),
            matching: find.byType(Scrollable),
          ),
        );
        await click(tester, find.text('5/4'));
        expect(repo.reads.last, {
          'shopId': '7',
          'serviceId': '9',
          'variantId': '92',
          'date': '2031-05-04',
        });
        await click(tester, find.text('10:00 AM'));
        await click(tester, find.byType(FilledButton).last);
        expect(
          find.textContaining('10:00 – 11:30 (America/Los_Angeles)'),
          findsOneWidget,
        );
        expect(
          find.text(
            '${counts.$1} ${counts.$1 == 1 ? 'guest' : 'guests'} · 2 therapists',
          ),
          findsOneWidget,
        );
        await click(
          tester,
          find.byKey(const ValueKey('booking-wizard-primary-action')),
        );
        expect(find.byType(LoginScreen), findsOneWidget);
        expect(repo.quotes, isEmpty);
        await tester.enterText(
          find.byType(TextFormField).at(0),
          'guest-customer@example.invalid',
        );
        await tester.enterText(
          find.byType(TextFormField).at(1),
          'synthetic-test-password',
        );
        await click(tester, find.widgetWithText(FilledButton, 'Sign in'));
        expect(find.byType(LoginScreen), findsNothing);
        state = container.read(bookingFlowProvider);
        expect(state.canConfirm, isTrue);
        expect(find.textContaining('Submit booking request'), findsOneWidget);
        expect(state.priceQuote!.totalCents, 21000);
        expect(state.priceQuote!.mainDurations.length, counts.$1);
        expect(
          state.priceQuote!.mainDurations.every(
            (row) => row.reservedDurationMin == 90,
          ),
          isTrue,
        );
        expect(repo.quotes.single['date'], '2031-05-04');
        expect(repo.quotes.single['startTime'], '10:00');
        expect(repo.quotes.single['durationMin'], 90);
        expect(repo.quotes.single.keys, isNot(contains('timezone')));
        expect(repo.writes, 0);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        container.dispose();
      },
    );
  }

  testWidgets(
    'visible primary review action handles loading and retry without submitting an order',
    (tester) async {
      viewport(tester, 320);
      final shop = specialShop(), repo = SpecialAvailability(2);
      final auth = GuestAuth()..customer('41');
      final container = ProviderContainer(
        overrides: [
          authProvider.overrideWith((ref) => auth),
          bookingRepositoryProvider.overrideWithValue(repo),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: app(BookingScreen(shop: shop), textScale: 1.3),
        ),
      );
      await tester.pumpAndSettle();
      await openSummary(tester, shop);
      final action = find.byKey(
        const ValueKey('booking-wizard-primary-action'),
      );
      expect(tester.widget<FilledButton>(action).onPressed, isNotNull);
      expect(
        find.descendant(
          of: action,
          matching: find.text('Review current total'),
        ),
        findsOneWidget,
      );
      expect(repo.quotes, isEmpty);
      repo.deferredQuote = Completer<BookingPriceQuote>();
      await tester.tap(action);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('Checking current total…'), findsOneWidget);
      expect(tester.widget<FilledButton>(action).onPressed, isNull);
      expect(repo.quotes.length, 1);
      expect(repo.writes, 0);
      repo.deferredQuote!.completeError(
        StateError('Synthetic quote unavailable'),
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Unable to verify the current price. Get a new quote before confirming.',
        ),
        findsOneWidget,
      );
      expect(tester.widget<FilledButton>(action).onPressed, isNotNull);
      expect(
        find.descendant(
          of: action,
          matching: find.text('Review current total'),
        ),
        findsOneWidget,
      );
      expect(container.read(bookingFlowProvider).canConfirm, isFalse);
      repo.deferredQuote = null;
      await click(tester, action);
      expect(repo.quotes.length, 2);
      expect(container.read(bookingFlowProvider).canConfirm, isTrue);
      expect(find.textContaining('Submit booking request'), findsOneWidget);
      expect(repo.writes, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    },
  );

  testWidgets(
    'calendar always shows exact advance notice and closure dates with an accessible contact action',
    (tester) async {
      viewport(tester, 375);
      final shop = specialShop(notice: 75);
      await tester.pumpWidget(
        ProviderScope(
          child: app(
            Scaffold(
              body: SingleChildScrollView(
                child: BookingCalendarPicker(
                  shop: shop,
                  selectedDate: null,
                  onSelected: (_) {},
                  onInvalidated: () {},
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('1 hour 15 minutes'), findsOneWidget);
      expect(find.textContaining('1.3 hours'), findsNothing);
      expect(
        find.textContaining('This shop will be closed from May 2–3'),
        findsOneWidget,
      );
      final phone = find.widgetWithText(TextButton, '206-555-0123');
      expect(phone, findsOneWidget);
      expect(tester.getSize(phone).height, greaterThanOrEqualTo(48));
      final semantics = tester.ensureSemantics();
      expect(
        tester.getSemantics(phone),
        matchesSemantics(
          isButton: true,
          hasEnabledState: true,
          isEnabled: true,
          isFocusable: true,
          hasFocusAction: true,
          hasTapAction: true,
          label: 'Call the shop: 206-555-0123',
        ),
      );
      semantics.dispose();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'calendar refresh replaces visible closure announcement and advance notice together',
    (tester) async {
      viewport(tester, 375);
      final original = specialShop(notice: 75);
      final updated = ShopDetail.fromJson({
        'id': '7',
        'name': original.name,
        'latitude': 0,
        'longitude': 0,
        'phone': '206-555-0124',
        'timezone': 'America/Los_Angeles',
        'bookingCalendar': shopCalendar(),
        'bookingSettings': {
          'minimumNoticeMinutes': 30,
          'closedPeriods': [
            {'startDate': '2031-05-05', 'endDate': '2031-05-06'},
          ],
        },
      });
      var invalidations = 0;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            shopRepositoryProvider.overrideWithValue(UpdatedSchedule(updated)),
          ],
          child: app(
            Scaffold(
              body: SingleChildScrollView(
                child: BookingCalendarPicker(
                  shop: original,
                  selectedDate: null,
                  onSelected: (_) {},
                  onInvalidated: () => invalidations++,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('1 hour 15 minutes'), findsOneWidget);
      expect(find.textContaining('May 2–3'), findsOneWidget);
      await click(tester, find.text('Refresh shop calendar'));
      expect(invalidations, 1);
      expect(find.textContaining('30 minutes'), findsOneWidget);
      expect(find.textContaining('1 hour 15 minutes'), findsNothing);
      expect(find.textContaining('May 5–6'), findsOneWidget);
      expect(find.textContaining('May 2–3'), findsNothing);
      expect(find.text('206-555-0124'), findsOneWidget);
      expect(find.text('206-555-0123'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
