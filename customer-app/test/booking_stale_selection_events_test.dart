import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_quote_fixture.dart';
import 'booking_special_wizard_test.dart' as widgets;
import 'booking_add_ons_test.dart' as fixture;
import 'guest_booking_flow_test.dart' show GuestAuth;

ShopDetail eventShop({String zone = 'America/New_York'}) =>
    ShopDetail.fromJson({
      'id': '7',
      'name': 'Event isolation studio',
      'latitude': 0,
      'longitude': 0,
      'timezone': zone,
      'orderOnly': true,
      'bookingCalendar': {
        'today': '2031-05-01',
        'timezone': zone,
        'serverNow': '2031-05-01T12:00:00Z',
        'validUntil': '2031-05-02T04:00:00Z',
      },
      'services': [
        {'id': '8', 'name': 'Massage', 'durationMin': 60, 'priceCents': 5000},
        {'id': '9', 'name': 'Foot care', 'durationMin': 30, 'priceCents': 4000},
      ],
    });

class EventStandardRepository extends fixture.StandardRepository {
  String zone = 'America/New_York';
  Completer<BookingPriceQuote>? pendingPrice;
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
    timezone: zone,
    slots: [
      TimeSlot(time: '10:00', available: true),
      TimeSlot(time: '10:30', available: true),
    ],
  );
  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> request) async {
    quotes.add(Map.of(request));
    if (pendingPrice != null) return pendingPrice!.future;
    return quoteFor(request);
  }

  BookingPriceQuote quoteFor(Map<String, dynamic> request) =>
      BookingPriceQuote.fromJson(
        timedQuoteJson(
          request,
          price: request['serviceId'] == '9' ? 4000 : 5000,
          minutes: request['serviceId'] == '9' ? 30 : 60,
        ),
      );

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> request) async {
    writes.add(Map.of(request));
    throw fixture.lostResponse('/bookings', 400);
  }
}

class EventPlanRepository extends fixture.PlanRepository {
  String zone = 'America/New_York';
  Completer<BookingPriceQuote>? pendingPrice;
  @override
  Future<BookingPlanQuote> slots(Map<String, dynamic> request) async {
    final row = Map<String, dynamic>.from(
      (request['items'] as List).single as Map,
    );
    final minutes = row['serviceId'] == '9' ? 30 : 60;
    final cents = row['serviceId'] == '9' ? 4000 : 5000;
    return BookingPlanQuote.fromJson({
      'date': request['date'],
      'timezone': zone,
      'participantCount': 1,
      'durationMin': minutes,
      'priceCents': cents,
      'items': [
        {
          ...row,
          'serviceName': 'Current service',
          'durationMin': minutes,
          'offsetMin': 0,
          'preparationMin': 0,
          'priceCents': cents,
          'currency': 'usd',
        },
      ],
      'slots': [
        {'time': '10:00', 'available': true},
        {'time': '10:30', 'available': true},
      ],
    });
  }

  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> request) async {
    quotes.add(Map.of(request));
    if (pendingPrice != null) return pendingPrice!.future;
    return quoteFor(request);
  }

  BookingPriceQuote quoteFor(Map<String, dynamic> request) =>
      BookingPriceQuote.fromJson(
        timedQuoteJson(
          request,
          price: ((request['items'] as List).single as Map)['serviceId'] == '9'
              ? 4000
              : 5000,
          minutes:
              ((request['items'] as List).single as Map)['serviceId'] == '9'
              ? 30
              : 60,
        ),
      );

  @override
  Future<Booking> create(Map<String, dynamic> request) async {
    writes.add(Map.of(request));
    throw fixture.lostResponse('/bookings/plan', 400);
  }
}

class EventHarness {
  final bool plan;
  final ShopDetail shop = eventShop();
  final standardRepo = EventStandardRepository();
  final planRepo = EventPlanRepository();
  late final BookingFlowNotifier ordinary = BookingFlowNotifier(standardRepo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
  late final BookingPlanNotifier itinerary = BookingPlanNotifier(
    shop,
    planRepo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
  late ProviderContainer container;
  EventHarness(this.plan);

  Future<void> mount(WidgetTester tester) async {
    widgets.viewport(tester, 1280);
    container = ProviderContainer(
      overrides: [
        authProvider.overrideWith((ref) => GuestAuth()..customer('41')),
        if (plan)
          bookingPlanProvider(shop).overrideWith((ref) => itinerary)
        else
          bookingFlowProvider.overrideWith((ref) => ordinary),
      ],
    );
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: widgets.app(
          plan ? BookingPlanScreen(shop: shop) : BookingScreen(shop: shop),
        ),
      ),
    );
    await tester.pumpAndSettle();
    if (plan) {
      itinerary.selectService(0, 0, '8');
    } else {
      ordinary.selectService(shop.services.first);
    }
    await tester.pumpAndSettle();
    await widgets.click(tester, find.byKey(primary));
    await widgets.click(tester, find.byKey(primary));
    selectDate('2031-05-01');
    await tester.pumpAndSettle();
    expect(find.byType(ChoiceChip), findsWidgets);
  }

  Key get primary => ValueKey(
    plan ? 'booking-plan-primary-action' : 'booking-wizard-primary-action',
  );
  Finder slot(String time) => find.widgetWithText(
    ChoiceChip,
    plan
        ? time
        : time == '10:00'
        ? '10:00 AM'
        : '10:30 AM',
  );
  ValueChanged<bool> oldSlot(WidgetTester tester) =>
      tester.widget<ChoiceChip>(slot('10:00')).onSelected!;
  Object? get availability =>
      plan ? itinerary.state.quote : ordinary.state.availability;
  BookingPriceQuote? get price =>
      plan ? itinerary.state.priceQuote : ordinary.state.priceQuote;
  String? get time =>
      plan ? itinerary.state.startTime : ordinary.state.selectedStartTime;
  bool get validPrice => plan
      ? itinerary.state.hasValidPriceQuote
      : ordinary.state.hasValidPriceQuote;
  List<Map<String, dynamic>> get writes =>
      plan ? planRepo.writes : standardRepo.writes;
  Map<String, dynamic> get request =>
      plan ? itinerary.state.pricingRequest : ordinary.state.quoteRequest;
  void selectDate(String value) {
    if (plan) {
      itinerary.selectDate(value);
    } else {
      ordinary.selectDate(DateTime.parse('${value}T00:00:00Z'));
    }
  }

  void selectTime(String value) {
    if (plan) {
      itinerary.selectTime(value);
    } else {
      ordinary.toggleTimeSlot(value);
    }
  }

  Future<void> review() =>
      plan ? itinerary.refreshPriceQuote() : ordinary.refreshPriceQuote();

  Future<void> change(WidgetTester tester, String kind) async {
    switch (kind) {
      case 'date':
        selectDate('2031-05-02');
      case 'calendar refresh':
        if (plan) {
          itinerary.invalidateCalendarSelection();
          itinerary.refreshShopDetails(eventShop());
        } else {
          ordinary.invalidateCalendarSelection();
          ordinary.refreshShopDetails(eventShop());
        }
        selectDate('2031-05-01');
      case 'service':
        if (plan) {
          itinerary.selectService(0, 0, '9');
        } else {
          ordinary.selectService(shop.services.last);
        }
      case 'timezone':
        standardRepo.zone = planRepo.zone = 'America/Los_Angeles';
        if (plan) {
          itinerary.refreshShopDetails(eventShop(zone: planRepo.zone));
        } else {
          ordinary.refreshShopDetails(eventShop(zone: standardRepo.zone));
        }
        selectDate('2031-05-01');
    }
    await tester.pumpAndSettle();
  }

  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  }
}

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);
  for (final plan in [false, true]) {
    final name = plan ? 'PLAN' : 'ordinary';
    for (final change in ['date', 'calendar refresh', 'service', 'timezone']) {
      testWidgets(
        '$name stale slot cannot replace the current reviewed selection after $change',
        (tester) async {
          final h = EventHarness(plan);
          await h.mount(tester);
          final stale = h.oldSlot(tester), oldAvailability = h.availability;
          await h.change(tester, change);
          expect(identical(h.availability, oldAvailability), isFalse);
          await widgets.click(tester, h.slot('10:30'));
          await h.review();
          await tester.pumpAndSettle();
          final currentPrice = h.price;
          expect(h.time, '10:30');
          expect(h.validPrice, isTrue);
          stale(true);
          await tester.pumpAndSettle();
          expect(h.time, '10:30');
          expect(identical(h.price, currentPrice), isTrue);
          expect(h.validPrice, isTrue);
          expect(h.writes, isEmpty);
          expect(tester.takeException(), isNull);
          await h.dispose(tester);
        },
      );
    }

    testWidgets(
      '$name stale confirm cannot submit a newly reviewed date and total',
      (tester) async {
        final h = EventHarness(plan);
        await h.mount(tester);
        await widgets.click(tester, h.slot('10:00'));
        await widgets.click(tester, find.byKey(h.primary));
        await h.review();
        await tester.pumpAndSettle();
        expect(h.validPrice, isTrue);
        final stale = tester
            .widget<FilledButton>(find.byKey(h.primary))
            .onPressed!;
        await h.change(tester, 'date');
        h.selectTime('10:30');
        await h.review();
        await tester.pumpAndSettle();
        expect(h.validPrice, isTrue);
        stale();
        await tester.pumpAndSettle();
        expect(h.writes, isEmpty);
        expect(h.time, '10:30');
        expect(h.validPrice, isTrue);
        // A fresh click still submits exactly the current reviewed request.
        // The in-memory repository rejects it before any receipt navigation.
        await widgets.click(tester, find.byKey(h.primary));
        expect(h.writes, hasLength(1));
        expect(h.writes.single['date'], '2031-05-02');
        expect(h.writes.single['startTime'], '10:30');
        expect(tester.takeException(), isNull);
        await h.dispose(tester);
      },
    );

    testWidgets(
      '$name old pending quote cannot return after the date changes',
      (tester) async {
        final h = EventHarness(plan);
        await h.mount(tester);
        await widgets.click(tester, h.slot('10:00'));
        final oldRequest = Map<String, dynamic>.of(h.request);
        final pending = Completer<BookingPriceQuote>();
        if (plan) {
          h.planRepo.pendingPrice = pending;
        } else {
          h.standardRepo.pendingPrice = pending;
        }
        final pricing = h.review();
        await h.change(tester, 'date');
        pending.complete(
          plan
              ? h.planRepo.quoteFor(oldRequest)
              : h.standardRepo.quoteFor(oldRequest),
        );
        await pricing;
        await tester.pumpAndSettle();
        expect(h.price, isNull);
        expect(h.validPrice, isFalse);
        expect(h.time, isNull);
        expect(h.writes, isEmpty);
        expect(tester.takeException(), isNull);
        await h.dispose(tester);
      },
    );
  }
}
