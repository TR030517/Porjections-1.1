import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_detail_boundary_test.dart' as boundary;
import 'booking_order_actions_test.dart' as orders;
import 'booking_quote_fixture.dart';
import 'booking_timed_recovery_test.dart' as timed;
import 'reschedule_test_fixture.dart';

class DeferredStandardRepository extends timed.TimedRepository {
  final reply = Completer<Booking>();
  Duration quoteLifetime = const Duration(minutes: 5);

  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> selection) async =>
      accepted = BookingPriceQuote.fromJson({
        ...timedQuoteJson(selection, price: 8000),
        'quoteExpiresAt': DateTime.now()
            .toUtc()
            .add(quoteLifetime)
            .toIso8601String(),
      });

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> selection) {
    writes.add(
      Map<String, dynamic>.from(jsonDecode(jsonEncode(selection)) as Map),
    );
    return reply.future;
  }
}

class DeferredPlanRepository extends timed.TimedPlanRepository {
  final reply = Completer<Booking>();
  Duration quoteLifetime = const Duration(minutes: 5);

  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> selection) async =>
      accepted = BookingPriceQuote.fromJson({
        ...timedQuoteJson(
          selection,
          price: (selection['items'] as List).length * 8000,
        ),
        'quoteExpiresAt': DateTime.now()
            .toUtc()
            .add(quoteLifetime)
            .toIso8601String(),
      });

  @override
  Future<Booking> create(Map<String, dynamic> selection) {
    writes.add(
      Map<String, dynamic>.from(jsonDecode(jsonEncode(selection)) as Map),
    );
    return reply.future;
  }
}

Future<ValueNotifier<bool>> openDetailsAboveList(WidgetTester tester) async {
  await resetSyntheticReschedule(tester);
  tester.view.physicalSize = const Size(700, 1300);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final visible = ValueNotifier(true);
  addTearDown(visible.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
        bookingListProvider.overrideWith(
          (ref) async => [Booking.fromJson(orders.discountedOrder())],
        ),
      ],
      child: orders.localized(
        Scaffold(
          body: ValueListenableBuilder<bool>(
            valueListenable: visible,
            builder: (_, show, _) => show
                ? const BookingListScreen()
                : const Center(child: Text('The list was refreshed elsewhere')),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  final details = find.widgetWithText(TextButton, 'Booking details');
  await tester.ensureVisible(details);
  await tester.pumpAndSettle();
  await tester.tap(details);
  await tester.pumpAndSettle();
  expect(find.text('Booking order'), findsOneWidget);
  return visible;
}

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);
  for (final value in [
    '2031-05-01T14:00:00',
    '2031-05-01',
    '',
    'invalid',
    '2020-05-01T14:00:00Z',
    '2020-05-01T14:00:00-07:00',
  ]) {
    test(
      'an order without a verified future instant is not reschedulable: $value',
      () {
        final booking = Booking.fromJson({
          ...boundary.bookingJson(),
          'startTime': value,
        });
        expect(booking.canReschedule, isFalse);
      },
    );
  }

  for (final value in ['2031-05-01T14:00:00Z', '2031-05-01T14:00:00-07:00']) {
    test(
      'a future order retains rescheduling for a timestamp with an explicit offset: $value',
      () {
        final booking = Booking.fromJson({
          ...boundary.bookingJson(),
          'startTime': value,
        });
        expect(booking.canReschedule, isTrue);
      },
    );
  }

  test(
    'past unpaid active orders retain the existing cancellation policy, but cannot be rescheduled',
    () {
      final booking = Booking.fromJson({
        ...boundary.bookingJson(),
        'startTime': '2020-05-01T14:00:00Z',
      });
      expect(booking.canCancel, isTrue);
      expect(booking.canReschedule, isFalse);
    },
  );

  for (final plan in [false, true]) {
    final kind = plan ? 'PLAN' : 'STANDARD';
    test(
      '$kind accepts an already-sent matching receipt after quote expiry without starting a second order',
      () async {
        final standardRepo = DeferredStandardRepository()
          ..quoteLifetime = const Duration(milliseconds: 120);
        final planRepo = DeferredPlanRepository()
          ..quoteLifetime = const Duration(milliseconds: 120);
        final standard = BookingFlowNotifier(
          standardRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => 'customer-41@example.invalid',
          currentCustomerName: () => 'Test customer',
          currentCustomerPhone: () => '+12065550123',
        );
        final itinerary = BookingPlanNotifier(
          timed.studio(),
          planRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => 'customer-41@example.invalid',
          currentCustomerName: () => 'Test customer',
          currentCustomerPhone: () => '+12065550123',
        );
        addTearDown(standard.dispose);
        addTearDown(itinerary.dispose);
        if (plan) {
          await timed.selectTimedPlan(itinerary);
        } else {
          await timed.selectTimed(standard);
        }
        final result = plan ? itinerary.confirm() : standard.confirmBooking();
        final writes = plan ? planRepo.writes : standardRepo.writes;
        final quote = plan ? planRepo.accepted! : standardRepo.accepted!;
        expect(writes, hasLength(1));
        expect(hasBookingRecoveryMarker(), isTrue);
        await Future<void>.delayed(const Duration(milliseconds: 180));
        expect(quote.expired, isTrue);
        expect(
          plan ? itinerary.state.submitting : standard.state.isCreating,
          isTrue,
        );
        final duplicateClick = plan
            ? itinerary.confirm()
            : standard.confirmBooking();
        expect(identical(result, duplicateClick), isTrue);
        final saved = quotedBookingFixture(
          writes.single,
          quote,
          extra: {'userId': '41'},
        );
        (plan ? planRepo.reply : standardRepo.reply).complete(saved);
        expect(await result, same(saved));
        expect(await duplicateClick, same(saved));
        expect(
          plan ? itinerary.state.pendingAttempt : standard.state.pendingAttempt,
          isNull,
        );
        expect(hasBookingRecoveryMarker(), isFalse);
        expect(writes, hasLength(1));
      },
    );

    test(
      '$kind account change during submission hides the old receipt and retains a read-only recovery reminder',
      () async {
        var actor = '41';
        final standardRepo = DeferredStandardRepository();
        final planRepo = DeferredPlanRepository();
        final standard = BookingFlowNotifier(
          standardRepo,
          currentCustomerId: () => actor,
          currentCustomerEmail: () => 'customer-$actor@example.invalid',
          currentCustomerName: () => 'Test customer $actor',
          currentCustomerPhone: () => '+12065550123',
        );
        final itinerary = BookingPlanNotifier(
          timed.studio(),
          planRepo,
          currentCustomerId: () => actor,
          currentCustomerEmail: () => 'customer-$actor@example.invalid',
          currentCustomerName: () => 'Test customer $actor',
          currentCustomerPhone: () => '+12065550123',
        );
        addTearDown(standard.dispose);
        addTearDown(itinerary.dispose);
        if (plan) {
          await timed.selectTimedPlan(itinerary);
        } else {
          await timed.selectTimed(standard);
        }
        final result = plan ? itinerary.confirm() : standard.confirmBooking();
        final writes = plan ? planRepo.writes : standardRepo.writes;
        final quote = plan ? planRepo.accepted! : standardRepo.accepted!;
        actor = '42';
        if (plan) {
          itinerary.onCustomerChanged('41', '42');
        } else {
          standard.onCustomerChanged('41', '42');
        }
        expect(
          plan
              ? itinerary.state.recoveryReminder
              : standard.state.recoveryReminder,
          isTrue,
        );
        expect(
          plan ? itinerary.state.canConfirm : standard.state.canConfirm,
          isFalse,
        );
        (plan ? planRepo.reply : standardRepo.reply).complete(
          quotedBookingFixture(writes.single, quote, extra: {'userId': '41'}),
        );
        expect(await result, isNull);
        expect(
          await (plan
              ? itinerary.retryOriginalRequest()
              : standard.retryOriginalRequest()),
          isNull,
        );
        expect(hasBookingRecoveryMarker(), isTrue);
        expect(writes, hasLength(1));
      },
    );

    test(
      '$kind disposal during an unknown submission cannot silently start a replacement order',
      () async {
        final standardRepo = DeferredStandardRepository();
        final planRepo = DeferredPlanRepository();
        final standard = BookingFlowNotifier(
          standardRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => 'customer-41@example.invalid',
          currentCustomerName: () => 'Test customer',
          currentCustomerPhone: () => '+12065550123',
        );
        final itinerary = BookingPlanNotifier(
          timed.studio(),
          planRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => 'customer-41@example.invalid',
          currentCustomerName: () => 'Test customer',
          currentCustomerPhone: () => '+12065550123',
        );
        if (plan) {
          await timed.selectTimedPlan(itinerary);
        } else {
          await timed.selectTimed(standard);
        }
        final result = plan ? itinerary.confirm() : standard.confirmBooking();
        standard.dispose();
        itinerary.dispose();
        (plan ? planRepo.reply : standardRepo.reply).completeError(
          timed.lost(),
        );
        expect(await result, isNull);
        expect(hasBookingRecoveryMarker(), isTrue);

        final replacementRepo = timed.TimedRepository();
        final replacement = BookingFlowNotifier(
          replacementRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => 'customer-41@example.invalid',
          currentCustomerName: () => 'Test customer',
          currentCustomerPhone: () => '+12065550123',
        );
        addTearDown(replacement.dispose);
        expect(replacement.state.recoveryReminder, isTrue);
        await timed.selectTimed(replacement);
        expect(await replacement.confirmBooking(), isNull);
        expect(replacementRepo.writes, isEmpty);
        expect(plan ? planRepo.writes : standardRepo.writes, hasLength(1));
      },
    );
  }

  testWidgets(
    'returning from order details after the source list disappears does not use its disposed ref',
    (tester) async {
      await orders.connect(tester);
      final visible = await openDetailsAboveList(tester);
      visible.value = false;
      await tester.pump();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('The list was refreshed elsewhere'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a saved reschedule remains visible if the source order card was removed',
    (tester) async {
      final wire = await orders.connect(tester);
      final visible = await openDetailsAboveList(tester);
      visible.value = false;
      await tester.pump();
      final change = find.text('Change booking time');
      await tester.ensureVisible(change);
      await tester.pumpAndSettle();
      await tester.tap(change);
      await tester.pumpAndSettle();
      await orders.selectAndSave(tester);
      expect(wire.saves, 1);
      expect(find.text('Booking time updated.'), findsOneWidget);
      expect(find.text('11:00 - 12:00 (America/Los_Angeles)'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
