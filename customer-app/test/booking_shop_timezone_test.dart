import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_quote_fixture.dart';

ShopDetail shopFixture({int guests = 1, int staff = 1}) => ShopDetail.fromJson({
  'id': '7',
  'name': 'Pacific shop',
  'latitude': 0,
  'longitude': 0,
  'timezone': 'America/Los_Angeles',
  'services': [
    {
      'id': '8',
      'name': 'Whole visit',
      'participantCount': guests,
      'requiredStaffCount': staff,
      'durationMin': 60,
      'priceCents': 12345,
    },
  ],
});

class ShopTimeRepository extends BookingRepository {
  final int guests, staff;
  String timezone = 'America/Los_Angeles';
  final writes = <Map<String, dynamic>>[];
  BookingPriceQuote? accepted;

  ShopTimeRepository({this.guests = 1, this.staff = 1}) : super(ApiService());

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
    timezone: timezone,
    durationMin: 60,
    hasDurationMetadata: true,
    participantCount: guests,
    requiredStaffCount: staff,
    slots: [TimeSlot(time: '10:00', available: true)],
  );

  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> request) async =>
      accepted = BookingPriceQuote.fromJson(
        timedQuoteJson(request, price: 12345, participants: guests),
      );

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> request) async {
    writes.add(request);
    return quotedBookingFixture(request, accepted!, requiredStaffCount: staff);
  }
}

class ShopTimePlanRepository extends BookingPlanRepository {
  String timezone = 'America/Los_Angeles';
  ShopTimePlanRepository() : super(ApiService());

  @override
  Future<BookingPlanQuote> slots(Map<String, dynamic> request) async =>
      BookingPlanQuote.fromJson({
        'date': request['date'],
        'timezone': timezone,
        'participantCount': 1,
        'durationMin': 60,
        'priceCents': 12345,
        'items': [
          {
            ...Map<String, dynamic>.from((request['items'] as List).single),
            'serviceName': 'Whole visit',
            'durationMin': 60,
            'offsetMin': 0,
            'preparationMin': 0,
            'priceCents': 12345,
            'currency': 'usd',
          },
        ],
        'slots': [
          {'time': '10:00', 'available': true},
        ],
      });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  test(
    'single service rejects availability in a changed shop timezone',
    () async {
      final shop = shopFixture();
      final repo = ShopTimeRepository()..timezone = 'America/New_York';
      final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.initFlow(shop);
      flow.selectService(shop.services.single);
      flow.selectDate(DateTime(2031, 5, 1));
      await Future<void>.delayed(Duration.zero);

      expect(flow.state.availableSlots, isNull);
      expect(flow.state.error, isNotNull);
      flow.toggleTimeSlot('10:00');
      expect(flow.state.hasSelection, isFalse);
      expect(repo.writes, isEmpty);
    },
  );

  test('itinerary rejects availability in a changed shop timezone', () async {
    final repo = ShopTimePlanRepository()..timezone = 'America/New_York';
    final plan = BookingPlanNotifier(shopFixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(plan.dispose);
    plan.selectService(0, 0, '8');
    plan.selectDate('2031-05-01');
    await plan.loadSlots();

    expect(plan.state.quote, isNull);
    expect(plan.state.error, isNotNull);
    plan.selectTime('10:00');
    expect(plan.state.startTime, isNull);
    expect(plan.state.canConfirm, isFalse);
  });

  test(
    'single, couple and four-hands use one shop-local time and whole-visit total',
    () async {
      for (final counts in [(1, 1), (2, 2), (1, 2)]) {
        final shop = shopFixture(guests: counts.$1, staff: counts.$2);
        final repo = ShopTimeRepository(guests: counts.$1, staff: counts.$2);
        final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        addTearDown(flow.dispose);
        flow.initFlow(shop);
        flow.selectService(shop.services.single);
        flow.selectDate(DateTime(2031, 5, 1));
        await Future<void>.delayed(Duration.zero);
        flow.toggleTimeSlot('10:00');
        expect(
          flow.state.selectedReservationWindow,
          contains('America/Los_Angeles'),
        );
        expect(flow.state.selectedPriceCents, 12345);
        await flow.refreshPriceQuote();
        expect(await flow.confirmBooking(), isNotNull);
        expect(repo.writes.single['date'], '2031-05-01');
        expect(repo.writes.single['startTime'], '10:00');
        expect(repo.writes.single['paymentMode'], 'PAY_AT_STORE');
        expect(repo.writes.single.containsKey('timezone'), isFalse);
        expect(repo.writes.single.containsKey('priceCents'), isFalse);
        expect(repo.writes.single.containsKey('requiredStaffCount'), isFalse);
      }
    },
  );
}
