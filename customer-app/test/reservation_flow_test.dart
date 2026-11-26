import 'booking_quote_fixture.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/theme/customer_theme.dart';

ShopDetail reservationFixture({
  bool allDisabled = false,
  bool legacy = false,
}) => ShopDetail.fromJson({
  'id': '7',
  'onlinePaymentEnabled': true, 'orderOnly': false, 'pricingPolicy': 'LEGACY',
  'name': 'Synthetic studio',
  'latitude': 0,
  'longitude': 0,
  'services': [
    {
      'id': '8',
      'name': 'Actual service',
      'durationMin': 60,
      'priceCents': 6000,
      'participantCount': legacy ? 1 : 2,
      'requiredStaffCount': legacy ? 1 : 2,
      'hasVariants': !legacy,
      'variants': legacy || allDisabled
          ? []
          : [
              {
                'id': '9007199254740993',
                'name': '90 minutes',
                'durationMin': 90,
                'priceCents': 10025,
                'currency': 'usd',
                'isActive': true,
              },
              {
                'id': '9007199254740994',
                'name': '120 minutes',
                'durationMin': 120,
                'priceCents': 15000,
                'currency': 'usd',
                'isActive': true,
              },
            ],
    },
  ],
  'therapists': [
    {
      'id': '11',
      'name': 'Qualified therapist',
      'services': [
        {'id': '8'},
      ],
    },
  ],
});

class ReservationRepository extends BookingRepository {
  ReservationRepository() : super(ApiService());
  final writes = <Map<String, dynamic>>[];
  final reads = <Map<String, dynamic>>[];
  final pending = <Completer<SlotResponse>>[];
  bool holdSlots = false;
  bool failNext = false;
  Completer<Booking>? pendingBooking;
  @override
  Future<SlotResponse> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) {
    reads.add({
      'shopId': shopId,
      'serviceId': serviceId,
      'variantId': variantId,
      'preferredTherapistIds': preferredTherapistIds,
    });
    if (holdSlots) {
      final result = Completer<SlotResponse>();
      pending.add(result);
      return result.future;
    }
    return Future.value(
      SlotResponse(
        date: date,
        slots: [
          TimeSlot(time: '10:00', available: true),
          TimeSlot(time: '10:30', available: true),
          TimeSlot(time: '11:00', available: false),
        ],
      ),
    );
  }

  BookingPriceQuote? accepted;
  @override
  Future<BookingPriceQuote> quote(Map<String,dynamic> request) async => accepted=BookingPriceQuote.fromJson(timedQuoteJson(request,
    price:request['variantId']==null?6000:request['variantId']=='9007199254740993'?20050:30000,
    minutes:request['variantId']==null?60:request['variantId']=='9007199254740993'?90:120,participants:request['variantId']==null?1:2));
  @override
  Future<Booking> createBookingWithAddOns(Map<String,dynamic> request) async {
    writes.add({'variantId':null,...request});
    if(failNext){failNext=false;throw DioException(requestOptions:RequestOptions(path:'/bookings'),response:Response(requestOptions:RequestOptions(path:'/bookings'),statusCode:400),type:DioExceptionType.badResponse);}
    if(pendingBooking!=null)return pendingBooking!.future;
    return quotedBookingFixture(request,accepted!);
  }

}

Future<void> choose(BookingFlowNotifier flow, ShopDetail shop) async {
  flow.initFlow(shop);
  flow.selectService(shop.services.single);
  if (shop.services.single.activeVariants.isNotEmpty) {
    flow.selectVariant(shop.services.single.activeVariants.first);
  }
  flow.selectDate(DateTime(2031, 1, 15));
  await Future<void>.delayed(Duration.zero);
  flow.toggleTimeSlot('10:00');
  if(flow.state.hasSelection)await flow.refreshPriceQuote();
}

void main() {
  testWidgets(
    'phone and desktop require an explicit specification and explain two-person assignment',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      for (final width in [375.0, 1280.0]) {
        tester.view.physicalSize = Size(width, 1000);
        final flow = BookingFlowNotifier(ReservationRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        await tester.pumpWidget(
          ProviderScope(
            key: UniqueKey(),
            overrides: [bookingFlowProvider.overrideWith((ref) => flow)],
            child: MaterialApp(
              theme: buildCustomerTheme(),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: BookingScreen(shop: reservationFixture()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Actual service'));
        await tester.pumpAndSettle();
        expect(find.text('Choose a specification'), findsOneWidget);
        expect(
          tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
          isNull,
        );
        await tester.ensureVisible(find.text('90 minutes'));
        await tester.tap(find.text('90 minutes'));
        await tester.pumpAndSettle();
        expect(flow.state.selectedPriceCents, 20050);
        expect(
          tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
          isNotNull,
        );
        expect(find.textContaining('USD 200.50'), findsWidgets);
        await tester.tap(find.text('Choose Therapist →'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining(
            'A second therapist is assigned automatically; both must be available for the same time.',
          ),
          findsOneWidget,
        );
        await tester.tap(find.text('Reset'));
        await tester.pumpAndSettle();
        expect(flow.state.shop?.id, '7');
        expect(flow.state.selectedService, isNull);
        await tester.tap(find.text('Actual service'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('90 minutes'));
        await tester.tap(find.text('90 minutes'));
        await tester.pumpAndSettle();
        expect(flow.state.hasServiceSelection, isTrue);
        expect(tester.takeException(), isNull);
      }
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
  test(
    'public hasVariants marker prevents fallback when every specification is disabled',
    () async {
      final shop = reservationFixture(allDisabled: true);
      final service = shop.services.single;
      expect(service.hasVariants, isTrue);
      expect(service.canBook, isFalse);
      expect(service.startingPriceCents, isNull);
      expect(service.formattedPrice, '—');
      final repository = ReservationRepository();
      final flow = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await choose(flow, shop);
      expect(flow.state.hasSelection, isFalse);
      expect(repository.reads, isEmpty);
      expect(await flow.confirmBooking(), isNull);
      expect(repository.writes, isEmpty);
    },
  );
  test(
    'explicit specification fixes duration and per-person price; adjacent starts replace instead of extending',
    () async {
      final shop = reservationFixture();
      final repository = ReservationRepository();
      final flow = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.initFlow(shop);
      flow.selectService(shop.services.single);
      expect(flow.state.hasServiceSelection, isFalse);
      flow.selectVariant(shop.services.single.activeVariants.first);
      flow.selectTherapist(shop.therapists.single);
      flow.selectDate(DateTime(2031, 1, 15));
      await Future<void>.delayed(Duration.zero);
      flow.toggleTimeSlot('10:00');
      flow.toggleTimeSlot('10:30');
      expect(flow.state.selectedSlots, ['10:30']);
      expect(flow.state.selectedDuration, 90);
      expect(flow.state.selectedEndTime, '12:00');
      expect(flow.state.selectedPriceCents, 20050);
      flow.toggleTimeSlot('11:00');
      expect(flow.state.selectedSlots, ['10:30']);
      await flow.refreshPriceQuote();
      expect(await flow.confirmBooking(), isNotNull);
      expect(repository.writes.single['variantId'], '9007199254740993');
      expect(repository.writes.single['preferredTherapistIds'], ['11']);
      expect(repository.writes.single['durationMin'], 90);
      expect(repository.writes.single['startTime'], '10:30');
      expect(
        repository.writes.single['requestKey'],
        matches(RegExp(r'^[a-f0-9]{32}$')),
      );
    },
  );
  test(
    'legacy service uses its exact default duration and price for one selected start',
    () async {
      final repository = ReservationRepository();
      final flow = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await choose(flow, reservationFixture(legacy: true));
      expect(flow.state.selectedDuration, 60);
      expect(flow.state.selectedEndTime, '11:00');
      expect(flow.state.selectedPriceCents, 6000);
      await flow.confirmBooking();
      expect(repository.writes.single['variantId'], isNull);
      expect(repository.writes.single['durationMin'], 60);
      expect(repository.writes.single['preferredTherapistIds'], isEmpty);
    },
  );
  test(
    'explicitly rejected unchanged submit reuses request key; successful repeat is cached; changed selection gets a new key',
    () async {
      final repository = ReservationRepository()..failNext = true;
      final flow = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await choose(flow, reservationFixture());
      expect(await flow.confirmBooking(), isNull);
      final firstKey = repository.writes.single['requestKey'];
      await flow.refreshPriceQuote();
      expect(await flow.confirmBooking(), isNotNull);
      expect(repository.writes.last['requestKey'], firstKey);
      await flow.refreshPriceQuote();
      expect(await flow.confirmBooking(), isNotNull);
      expect(repository.writes.length, 2);
      flow.toggleTimeSlot('10:30');
      await flow.refreshPriceQuote();
      await flow.confirmBooking();
      expect(repository.writes.length, 3);
      expect(repository.writes.last['requestKey'], isNot(firstKey));
    },
  );
  test(
    'two confirm clicks share one in-flight API call and freeze selections until it resolves',
    () async {
      final repository = ReservationRepository()
        ..pendingBooking = Completer<Booking>();
      final flow = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await choose(flow, reservationFixture());
      final first = flow.confirmBooking();
      final second = flow.confirmBooking();
      expect(identical(first, second), isTrue);
      expect(repository.writes.length, 1);
      flow.toggleTimeSlot('10:30');
      expect(flow.state.selectedStartTime, '10:00');
      repository.pendingBooking!.complete(quotedBookingFixture(repository.writes.single,repository.accepted!));
      expect((await first)?.id, '42');
      expect((await second)?.id, '42');
      expect(flow.state.isCreating, isFalse);
    },
  );
  test(
    'specification changes discard older slot responses and clear the start selection',
    () async {
      final shop = reservationFixture();
      final repository = ReservationRepository()..holdSlots = true;
      final flow = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.initFlow(shop);
      flow.selectService(shop.services.single);
      flow.selectVariant(shop.services.single.activeVariants.first);
      flow.selectDate(DateTime(2031, 1, 15));
      flow.selectVariant(shop.services.single.activeVariants.last);
      expect(repository.reads.map((item) => item['variantId']), [
        '9007199254740993',
        '9007199254740994',
      ]);
      repository.pending.last.complete(
        SlotResponse(
          date: '2031-01-15',
          slots: [TimeSlot(time: '14:00', available: true)],
        ),
      );
      await Future<void>.delayed(Duration.zero);
      repository.pending.first.complete(
        SlotResponse(
          date: '2031-01-15',
          slots: [TimeSlot(time: '10:00', available: true)],
        ),
      );
      await Future<void>.delayed(Duration.zero);
      expect(flow.state.availableSlots!.single.time, '14:00');
      expect(flow.state.selectedSlots, isEmpty);
      flow.toggleTimeSlot('10:00');
      expect(flow.state.hasSelection, isFalse);
      flow.toggleTimeSlot('14:00');
      expect(flow.state.selectedEndTime, '16:00');
    },
  );
}
