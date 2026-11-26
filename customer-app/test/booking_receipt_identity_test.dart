import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_quote_fixture.dart';
import 'booking_timed_recovery_test.dart' as timed;

class ReceiptRepository extends timed.TimedRepository {
  bool loseFirst = false;
  Map<String, dynamic> receiptChanges = {};

  @override
  Future<Booking> createBookingWithAddOns(
    Map<String, dynamic> selection,
  ) async {
    writes.add(
      Map<String, dynamic>.from(jsonDecode(jsonEncode(selection)) as Map),
    );
    if (loseFirst && writes.length == 1) throw timed.lost();
    return quotedBookingFixture(
      selection,
      accepted!,
      extra: {
        'userId': '41',
        'localDate': selection['date'],
        'localStartTime': selection['startTime'],
        ...receiptChanges,
      },
    );
  }
}

class PlanReceiptRepository extends timed.TimedPlanRepository {
  bool loseFirst = false;
  Map<String, dynamic> receiptChanges = {};

  @override
  Future<Booking> create(Map<String, dynamic> selection) async {
    writes.add(
      Map<String, dynamic>.from(jsonDecode(jsonEncode(selection)) as Map),
    );
    if (loseFirst && writes.length == 1) throw timed.lost();
    return quotedBookingFixture(
      selection,
      accepted!,
      extra: {
        'userId': '41',
        'localDate': selection['date'],
        'localStartTime': selection['startTime'],
        ...receiptChanges,
      },
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  for (final plan in [false, true]) {
    for (final retry in [false, true]) {
      final kind = plan ? 'PLAN' : 'STANDARD';
      final stage = retry ? 'original-request recovery' : 'initial submission';
      final mismatches = <String, Map<String, dynamic>>{
        'another day': {'localDate': '2031-05-02'},
        'another arrival time': {'localStartTime': '11:00'},
        'missing order identity': {'id': ''},
        'another reservation kind': {
          'reservationKind': plan ? 'STANDARD' : 'PLAN',
        },
      };
      for (final mismatch in mismatches.entries) {
        test(
          '$kind $stage rejects ${mismatch.key} and retains the original request until a matching receipt arrives',
          () async {
            final standardRepo = ReceiptRepository()..loseFirst = retry;
            final planRepo = PlanReceiptRepository()..loseFirst = retry;
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
            Future<Booking?> confirm() =>
                plan ? itinerary.confirm() : standard.confirmBooking();
            Future<Booking?> recover() => plan
                ? itinerary.retryOriginalRequest()
                : standard.retryOriginalRequest();
            if (retry) expect(await confirm(), isNull);
            standardRepo.receiptChanges = mismatch.value;
            planRepo.receiptChanges = mismatch.value;

            expect(
              await (retry ? recover() : confirm()),
              isNull,
              reason:
                  'A same-price receipt for a different visit is not proof that this request succeeded.',
            );
            final writes = plan ? planRepo.writes : standardRepo.writes;
            final original = jsonEncode(writes.first);
            expect(
              plan
                  ? itinerary.state.pendingAttempt
                  : standard.state.pendingAttempt,
              isNotNull,
            );
            expect(hasBookingRecoveryMarker(), isTrue);
            final previousWrites = writes.length;
            expect(await confirm(), isNull);
            expect(
              writes,
              hasLength(previousWrites),
              reason: 'An unknown result must not cause another submission.',
            );

            standardRepo.receiptChanges = {};
            planRepo.receiptChanges = {};
            final restored = await recover();
            expect(restored?.id, '42');
            expect(restored?.localDate, '2031-05-01');
            expect(restored?.localStartTime, '10:00');
            expect(
              writes.every((request) => jsonEncode(request) == original),
              isTrue,
              reason:
                  'Recovery must retain the exact date, time, signed quote and request key.',
            );
            expect(
              plan
                  ? itinerary.state.pendingAttempt
                  : standard.state.pendingAttempt,
              isNull,
            );
            expect(hasBookingRecoveryMarker(), isFalse);
            expect(await confirm(), same(restored));
            expect(writes, hasLength(previousWrites + 1));
          },
        );
      }
    }
  }
}
