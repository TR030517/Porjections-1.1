import 'booking_quote_fixture.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

ShopDetail fixture() => ShopDetail.fromJson({
  'id': '7',
  'timezone': 'America/New_York',
  'bookingCalendar': calendarFixture(),
  'name': 'Shop',
  'latitude': 0,
  'longitude': 0,
  'services': [
    {'id': '8', 'name': 'Service A', 'durationMin': 60, 'priceCents': 6000},
    {'id': '9', 'name': 'Service B', 'durationMin': 60, 'priceCents': 6000},
    {'id': '10', 'name': 'Service C', 'durationMin': 60, 'priceCents': 6000},
  ],
  'therapists': [
    {
      'id': '11',
      'name': 'Therapist A',
      'yearsExp': 1,
      'services': [
        {'serviceId': '8'},
      ],
    },
    {
      'id': '12',
      'name': 'Therapist B',
      'services': [
        {'id': '9'},
      ],
    },
    {'id': '13', 'name': 'Unlinked therapist', 'services': []},
  ],
});

class SlotsRepository extends BookingRepository {
  final pending =
      <
        ({
          String serviceId,
          String? therapistId,
          Completer<SlotResponse> result,
        })
      >[];
  bool holdRequests = false;
  String? bookedTherapist;
  SlotsRepository() : super(ApiService());
  @override
  Future<SlotResponse> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) {
    if (!holdRequests) {
      return Future.value(
        SlotResponse(
          date: date,
          slots: [TimeSlot(time: '10:00', available: true)],
        ),
      );
    }
    final result = Completer<SlotResponse>();
    pending.add((
      serviceId: serviceId,
      therapistId:
          therapistId ??
          (preferredTherapistIds?.isNotEmpty == true
              ? preferredTherapistIds!.first
              : null),
      result: result,
    ));
    return result.future;
  }

  BookingPriceQuote? accepted;
  @override
  Future<BookingPriceQuote> quote(Map<String,dynamic> request)async=>accepted=BookingPriceQuote.fromJson(timedQuoteJson(request,price:6000));
  @override
  Future<Booking> createBookingWithAddOns(Map<String,dynamic> request)async{
    final preferences=request['preferredTherapistIds'] as List;
    bookedTherapist=preferences.isEmpty?null:preferences.first as String;
    return quotedBookingFixture(request,accepted!);
  }

}

void main() {
  test(
    'omitted state fields remain selected while explicit null clears therapist and cached slots',
    () {
      final shop = fixture();
      final state = BookingFlowState(
        shop: shop,
        selectedService: shop.services.first,
        selectedTherapist: shop.therapists.first,
        availableSlots: [TimeSlot(time: '10:00', available: true)],
        error: 'Old error',
      );
      expect(state.copyWith(isCreating: true).selectedTherapist?.id, '11');
      final cleared = state.copyWith(
        selectedTherapist: null,
        availableSlots: null,
        error: null,
      );
      expect(cleared.selectedTherapist, isNull);
      expect(cleared.availableSlots, isNull);
      expect(cleared.error, isNull);
      expect(cleared.selectedService?.id, '8');
      expect(state.eligibleTherapists.map((item) => item.id), ['11']);
    },
  );

  test(
    'switching service clears therapist and slots; stale responses and unlinked therapists cannot restore an invalid booking',
    () async {
      final shop = fixture();
      final repository = SlotsRepository()..holdRequests = true;
      final notifier = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(notifier.dispose);
      notifier.initFlow(shop);
      notifier.selectService(shop.services.first);
      notifier.selectDate(DateTime(2031, 1, 15));
      notifier.selectTherapist(shop.therapists.first);
      notifier.toggleTimeSlot('10:00');
      notifier.selectService(shop.services[1]);
      expect(notifier.state.selectedTherapist, isNull);
      expect(notifier.state.selectedSlots, isEmpty);
      expect(notifier.state.availableSlots, isNull);
      expect(repository.pending.last.serviceId, '9');
      expect(repository.pending.last.therapistId, isNull);
      final latest = repository.pending.last;
      latest.result.complete(
        SlotResponse(
          date: '2031-01-15',
          slots: [TimeSlot(time: '14:00', available: true)],
        ),
      );
      await Future<void>.delayed(Duration.zero);
      for (final request in repository.pending.where(
        (item) => item != latest,
      )) {
        request.result.complete(
          SlotResponse(
            date: '2031-01-15',
            slots: [TimeSlot(time: '10:00', available: true)],
          ),
        );
      }
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.availableSlots!.single.time, '14:00');
      final requests = repository.pending.length;
      notifier.selectTherapist(shop.therapists.first);
      notifier.selectTherapist(shop.therapists.last);
      expect(notifier.state.selectedTherapist, isNull);
      expect(repository.pending.length, requests);
      repository.holdRequests = false;
      notifier.selectTherapist(shop.therapists[1]);
      expect(notifier.state.selectedTherapist?.id, '12');
      notifier.selectTherapist(null);
      expect(notifier.state.selectedTherapist, isNull);
      await Future<void>.delayed(Duration.zero);
      notifier.toggleTimeSlot('10:00');
      await notifier.refreshPriceQuote();
      expect(await notifier.confirmBooking(), isNotNull);
      expect(repository.bookedTherapist, isNull);
    },
  );

  testWidgets(
    'wizard filters actual public service associations and keeps no preference usable after changing service',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final notifier = BookingFlowNotifier(SlotsRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      await tester.pumpWidget(
        ProviderScope(
          overrides: [bookingFlowProvider.overrideWith((ref) => notifier)],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: BookingScreen(shop: fixture()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Service A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose Therapist →'));
      await tester.pumpAndSettle();
      expect(find.text('Therapist A'), findsOneWidget);
      expect(find.text('1 year of experience'), findsOneWidget);
      expect(find.text('1 years'), findsNothing);
      expect(find.text('Therapist B'), findsNothing);
      expect(find.text('Unlinked therapist'), findsNothing);
      await tester.tap(find.text('Therapist A'));
      await tester.pumpAndSettle();
      expect(notifier.state.selectedTherapist?.id, '11');
      await tester.tap(find.text('No preference'));
      await tester.pumpAndSettle();
      expect(notifier.state.selectedTherapist, isNull);
      await tester.tap(find.text('Therapist A'));
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Service B'));
      await tester.pumpAndSettle();
      expect(notifier.state.selectedTherapist, isNull);
      await tester.tap(find.text('Choose Therapist →'));
      await tester.pumpAndSettle();
      expect(find.text('Therapist A'), findsNothing);
      expect(find.text('Therapist B'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Service C'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose Therapist →'));
      await tester.pumpAndSettle();
      expect(find.text('Therapist A'), findsNothing);
      expect(find.text('Therapist B'), findsNothing);
      expect(find.text('Unlinked therapist'), findsNothing);
      expect(
        find.descendant(
          of: find.byType(ListView).first,
          matching: find.text('No preference'),
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('No therapist is listed for this service'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Choose Date & Time →'),
            )
            .onPressed,
        isNotNull,
      );

      // Switching locale updates the actual wizard, including optional choices
      // and the date action, without changing the selected booking service.
      await tester.pumpWidget(
        ProviderScope(
          overrides: [bookingFlowProvider.overrideWith((ref) => notifier)],
          child: MaterialApp(
            locale: const Locale('zh'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: BookingScreen(shop: fixture()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('选择技师（可选）'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(ListView).first,
          matching: find.text('不指定技师'),
        ),
        findsOneWidget,
      );
      expect(find.text('由门店安排技师'), findsOneWidget);
      expect(
        tester
            .widgetList<Semantics>(
              find.ancestor(
                of: find.text('由门店安排技师'),
                matching: find.byType(Semantics),
              ),
            )
            .any((widget) => widget.properties.selected == true),
        isTrue,
      );
      expect(notifier.state.selectedService?.id, '10');
      await tester.tap(find.text('选择日期与时间 →'));
      await tester.pumpAndSettle();
      expect(find.text('请先选择日期'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget);
      expect(find.textContaining('& Time'), findsNothing);
      await tester.tap(find.text('Today'));
      await tester.pumpAndSettle();
      expect(notifier.state.selectedDate?.toIso8601String().substring(0,10),'2031-05-01');
      expect(find.text('上午'), findsOneWidget);
      expect(find.text('选择一个可约开始时间，时长由服务规格决定'), findsOneWidget);
      await tester.tap(find.byType(ChoiceChip).first);
      await tester.pumpAndSettle();
      expect(find.text('Reserved 60 min'), findsWidgets);
      expect(find.text(notifier.state.selectedReservationWindow), findsWidgets);
      await tester.tap(find.text('Contact & confirm →'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Sign in to review total'), findsWidgets);
      expect(notifier.state.hasValidPriceQuote,isFalse);
      expect(notifier.state.canConfirm,isFalse);
      final primary = find.byKey(const ValueKey('booking-wizard-primary-action'));
      expect(tester.widget<FilledButton>(primary).onPressed,isNotNull);
      expect(find.descendant(of:primary,matching:find.text('Sign in to review total')),findsOneWidget);
      expect(find.text('优惠券'), findsOneWidget);
      expect(find.text('选择'), findsOneWidget);
    },
  );
}
