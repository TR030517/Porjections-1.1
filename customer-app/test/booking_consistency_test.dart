import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/service_duration.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_plan_test.dart' as plan;
import 'booking_quote_fixture.dart';
import 'booking_special_wizard_test.dart' as special;

Map<String, dynamic> planJson(BookingPlanQuote quote) => {
  'date': quote.date,
  'timezone': quote.timezone,
  'durationMin': quote.durationMin,
  'participantCount': quote.participantCount,
  'priceCents': quote.priceCents,
  'items': [
    for (final item in quote.items)
      {
        'participantIndex': item.participantIndex,
        'sequence': item.sequence,
        'serviceId': item.serviceId,
        'serviceName': item.serviceName,
        'variantId': item.variantId,
        'variantName': item.variantName,
        'durationMin': item.durationMin,
        'durationKind': item.durationKind,
        'offsetMin': item.offsetMin,
        'preparationMin': item.preparationMin,
        'priceCents': item.priceCents,
        'currency': item.currency,
      },
  ],
  'slots': [
    for (final slot in quote.slots)
      {'time': slot.time, 'available': slot.available},
  ],
};

class ConsistentPlanRepository extends plan.PlanRepository {
  void Function(Map<String, dynamic>)? alter;
  bool deferPrices = false;
  final priceRequests = <Map<String, dynamic>>[];
  final priceReplies = <Completer<BookingPriceQuote>>[];

  BookingPlanQuote available(Map<String, dynamic> request) {
    final json = planJson(plan.quoteFor(request));
    alter?.call(json);
    return BookingPlanQuote.fromJson(json);
  }

  @override
  Future<BookingPlanQuote> slots(Map<String, dynamic> request) {
    if (hold) return super.slots(request);
    reads.add(request);
    return Future.value(available(request));
  }

  BookingPriceQuote total(Map<String, dynamic> request) {
    final itinerary = available(request);
    return BookingPriceQuote.fromJson(
      timedQuoteJson(
        request,
        price: itinerary.priceCents,
        minutes: itinerary.durationMin,
        main: [
          for (final item in itinerary.items)
            MainDuration(
              participantIndex: item.participantIndex,
              sequence: item.sequence,
              serviceId: item.serviceId,
              variantId: item.variantId,
              durationKind: item.durationKind,
              reservedDurationMin: item.durationMin,
            ),
        ],
      ),
    );
  }

  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> request) {
    priceRequests.add(Map.of(request));
    if (deferPrices) {
      final reply = Completer<BookingPriceQuote>();
      priceReplies.add(reply);
      return reply.future;
    }
    return Future.value(accepted = total(request));
  }
}

class DelayedSpecialRepository extends special.SpecialAvailability {
  DelayedSpecialRepository(super.guests);
  final replies = <Completer<SlotResponse>>[];

  SlotResponse reply(int index) {
    final request = reads[index];
    return SlotResponse.fromJson({
      'date': request['date'],
      'timezone': 'America/Los_Angeles',
      'bookingCalendar': special.shopCalendar(),
      'durationMin': request['variantId'] == '92' ? 90 : 60,
      'durationKind': 'TIMED',
      'priceCents': request['variantId'] == '92' ? 21000 : 15000,
      'priceBasis': 'PER_BOOKING',
      'variantId': request['variantId'],
      'participantCount': guests,
      'requiredStaffCount': 2,
      'slots': [
        {'time': '10:00', 'available': true},
      ],
    });
  }

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
      'date': date,
    });
    final reply = Completer<SlotResponse>();
    replies.add(reply);
    return reply.future;
  }
}

Future<void> tick() => Future<void>.delayed(Duration.zero);

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  for (final fault in ['overlap', 'staggered arrival', 'padded window']) {
    test(
      'a plan rejects $fault even when project identities and cents match',
      () async {
        final repo = ConsistentPlanRepository()
          ..alter = (json) {
            final items = json['items'] as List;
            if (fault == 'overlap') {
              items[1]['offsetMin'] = 0;
              json['durationMin'] = 60;
            } else if (fault == 'staggered arrival') {
              items[2]['offsetMin'] = 15;
            } else {
              json['durationMin'] = 130;
            }
          };
        final flow = BookingPlanNotifier(plan.fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        addTearDown(flow.dispose);
        await plan.selected(flow);
        expect(flow.state.quote, isNull);
        expect(flow.state.startTime, isNull);
        expect(flow.state.canConfirm, isFalse);
        expect(flow.state.error, isNotNull);
        expect(repo.priceRequests, isEmpty);
        expect(repo.writes, isEmpty);
      },
    );
  }

  test(
    'plan edits retain only the latest ordered itinerary and current total',
    () async {
      final repo = ConsistentPlanRepository();
      final flow = BookingPlanNotifier(plan.fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await plan.selected(flow);
      repo.reads.clear();
      repo.hold = true;
      flow.moveStage(0, 0, 1);
      flow.removeParticipant(1);
      flow.selectDate('2031-01-16');
      expect(flow.state.quote, isNull);
      expect(flow.state.startTime, isNull);
      expect(flow.state.canConfirm, isFalse);
      repo.pending.last.complete(plan.quoteFor(repo.reads.last));
      await tick();
      flow.selectTime('10:00');
      await flow.refreshPriceQuote();
      expect(flow.state.canConfirm, isTrue);
      expect(flow.state.priceQuote!.totalCents, 10012);
      expect(flow.state.quote!.items.map((row) => row.serviceId), ['9', '8']);
      expect(flow.state.quote!.items.map((row) => row.offsetMin), [0, 40]);
      for (var index = 0; index < repo.pending.length - 1; index++) {
        repo.pending[index].complete(plan.quoteFor(repo.reads[index]));
      }
      await tick();
      expect(flow.state.date, '2031-01-16');
      expect(flow.state.quote!.participantCount, 1);
      expect(flow.state.quote!.items.map((row) => row.serviceId), ['9', '8']);
      expect(flow.state.startTime, '10:00');
      expect(flow.state.priceQuote!.totalCents, 10012);
      expect(repo.writes, isEmpty);
    },
  );

  test(
    'a late old price cannot restore the amount from removed participants',
    () async {
      final repo = ConsistentPlanRepository();
      final flow = BookingPlanNotifier(plan.fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await plan.selected(flow);
      repo.deferPrices = true;
      flow.setNotes('New note');
      final old = flow.refreshPriceQuote();
      flow.removeParticipant(1);
      await tick();
      flow.selectTime('10:00');
      final current = flow.refreshPriceQuote();
      repo.priceReplies.last.complete(repo.total(repo.priceRequests.last));
      await current;
      expect(flow.state.priceQuote!.totalCents, 10012);
      repo.priceReplies.first.complete(repo.total(repo.priceRequests[1]));
      await old;
      expect(flow.state.priceQuote!.totalCents, 10012);
      expect(flow.state.canConfirm, isTrue);
      expect(repo.writes, isEmpty);
    },
  );

  for (final guests in [1, 2]) {
    test(
      'late four-hands/couple slots cannot undo variant/date edits ($guests guests)',
      () async {
        final shop = special.specialShop(guests: guests);
        final repo = DelayedSpecialRepository(guests);
        final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        addTearDown(flow.dispose);
        flow.initFlow(shop);
        flow.selectService(shop.services.single);
        flow.selectVariant(shop.services.single.activeVariants.last);
        flow.selectDate(DateTime(2031, 5, 4));
        flow.selectVariant(shop.services.single.activeVariants.first);
        flow.selectDate(DateTime(2031, 5, 5));
        expect(flow.state.selectedSlots, isEmpty);
        expect(flow.state.canConfirm, isFalse);
        repo.replies.last.complete(repo.reply(repo.replies.length - 1));
        await tick();
        flow.toggleTimeSlot('10:00');
        await flow.refreshPriceQuote();
        expect(flow.state.priceQuote!.totalCents, 15000);
        for (var index = 0; index < repo.replies.length - 1; index++) {
          repo.replies[index].complete(repo.reply(index));
        }
        await tick();
        expect(flow.state.selectedDate, DateTime(2031, 5, 5));
        expect(flow.state.selectedVariant!.id, '91');
        expect(flow.state.availability!.durationMin, 60);
        expect(flow.state.availability!.participantCount, guests);
        expect(flow.state.availability!.requiredStaffCount, 2);
        expect(flow.state.selectedStartTime, '10:00');
        expect(flow.state.priceQuote!.totalCents, 15000);
        expect(flow.state.canConfirm, isTrue);
        expect(repo.writes, 0);
      },
    );
  }

  test(
    'failed slot reads show local English without leaking the transport exception',
    () async {
      final shop = special.specialShop();
      final repo = DelayedSpecialRepository(2);
      final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.initFlow(shop);
      flow.selectService(shop.services.single);
      flow.selectVariant(shop.services.single.activeVariants.first);
      flow.selectDate(DateTime(2031, 5, 4));
      final request = RequestOptions(path: '/private-slots?session=synthetic');
      repo.replies.single.completeError(
        DioException(
          requestOptions: request,
          type: DioExceptionType.badResponse,
          message: '内部错误 synthetic-secret',
          response: Response(
            requestOptions: request,
            statusCode: 400,
            data: {'message': '<html>预约失败 synthetic-secret</html>'},
          ),
        ),
      );
      await tick();
      expect(
        flow.state.error,
        'Unable to load available times. Choose another date or refresh availability.',
      );
      expect(flow.state.availableSlots, isNull);
      expect(flow.state.canConfirm, isFalse);
      expect(repo.writes, 0);
    },
  );

  test(
    'leaving the plan and regular flows cannot adopt delayed slot replies',
    () async {
      final repo = ConsistentPlanRepository()..hold = true;
      final planFlow = BookingPlanNotifier(plan.fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      planFlow.selectService(0, 0, '9');
      planFlow.selectDate('2031-01-15');
      planFlow.dispose();
      repo.pending.single.complete(plan.quoteFor(repo.reads.single));

      final shop = special.specialShop();
      final regular = DelayedSpecialRepository(2);
      final flow = BookingFlowNotifier(regular, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      flow.initFlow(shop);
      flow.selectService(shop.services.single);
      flow.selectVariant(shop.services.single.activeVariants.first);
      flow.selectDate(DateTime(2031, 5, 4));
      flow.dispose();
      regular.replies.single.complete(regular.reply(0));
      await tick();
      expect(repo.writes, isEmpty);
      expect(regular.writes, 0);
    },
  );

  testWidgets(
    'a 390px plan footer reviews the edited total without submitting or losing itinerary',
    (tester) async {
      special.viewport(tester, 390);
      final shop = plan.fixture();
      final repo = ConsistentPlanRepository();
      final flow = BookingPlanNotifier(shop, repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      await tester.runAsync(() => plan.selected(flow));
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => plan.PageCustomer()),
            bookingPlanProvider(shop).overrideWith((ref) => flow),
          ],
          child: special.app(BookingPlanScreen(shop: shop)),
        ),
      );
      await tester.pumpAndSettle();
      for (var step = 0; step < 3; step++) {
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
      }
      expect(find.text('America/Los_Angeles'), findsOneWidget);
      expect(find.textContaining('11:10 – 11:40'), findsOneWidget);
      flow.setNotes('Updated arrival instructions');
      await tester.pumpAndSettle();
      final primary = find.byKey(const ValueKey('booking-plan-primary-action'));
      expect(
        find.descendant(
          of: primary,
          matching: find.text('Review current total'),
        ),
        findsOneWidget,
      );
      expect(tester.widget<FilledButton>(primary).onPressed, isNotNull);
      repo.deferPrices = true;
      await tester.tap(primary);
      await tester.pump();
      expect(
        find.descendant(
          of: primary,
          matching: find.text('Checking current total…'),
        ),
        findsOneWidget,
      );
      expect(tester.widget<FilledButton>(primary).onPressed, isNull);
      expect(repo.priceReplies, hasLength(1));
      expect(repo.writes, isEmpty);
      repo.priceReplies.single.complete(repo.total(repo.priceRequests.last));
      await tester.pumpAndSettle();
      expect(flow.state.hasValidPriceQuote, isTrue);
      expect(
        find.descendant(of: primary, matching: find.text('Submit booking request')),
        findsOneWidget,
      );
      expect(tester.widget<FilledButton>(primary).onPressed, isNotNull);
      expect(flow.state.priceQuote!.totalCents, 14013);
      expect(flow.state.notes, 'Updated arrival instructions');
      expect(
        repo.writes,
        isEmpty,
        reason: 'Reviewing a total must not submit an order.',
      );
      final summaryText = tester
          .widgetList<Text>(find.byType(Text))
          .map((widget) => widget.data ?? widget.textSpan?.toPlainText() ?? '')
          .join('\n');
      expect(summaryText, isNot(matches(RegExp(r'[\u4e00-\u9fff]'))));
      flow.setNotes('A second edit');
      await tester.pump();
      await tester.tap(primary);
      await tester.pump();
      repo.priceReplies.last.completeError(
        StateError('Synthetic unavailable quote'),
      );
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Unable to verify the current price. Get a new quote before confirming.',
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: primary,
          matching: find.text('Review current total'),
        ),
        findsOneWidget,
      );
      expect(tester.widget<FilledButton>(primary).onPressed, isNotNull);
      expect(flow.state.canConfirm, isFalse);
      expect(repo.writes, isEmpty);
      await tester.tap(find.widgetWithText(TextButton, 'Back'));
      await tester.pumpAndSettle();
      expect(flow.state.date, '2031-01-15');
      expect(flow.state.startTime, '10:00');
      expect(flow.state.quote!.items.map((row) => row.offsetMin), [0, 70, 0]);
      expect(tester.takeException(), isNull);
    },
  );
}
