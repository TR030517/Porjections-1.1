import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/models/money.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'offline_orders_test.dart' as fixture;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);
  for (final plan in [false, true]) {
    testWidgets(
      '${plan ? 'PLAN' : 'STANDARD'} final contact CTA stays above 300px keyboard at 390x844',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetViewInsets);
        final shop = fixture.orderShop();
        final repo = fixture.OrderRepository(),
            planRepo = fixture.OrderPlanRepository();
        final container = ProviderContainer(
          overrides: [
            authProvider.overrideWith(
              (ref) => fixture.OrderCustomer(email: 'synthetic@example.test'),
            ),
            bookingRepositoryProvider.overrideWithValue(repo),
            bookingPlanRepositoryProvider.overrideWithValue(planRepo),
          ],
        );
        try {
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: fixture.localized(
                plan
                    ? BookingPlanScreen(shop: shop)
                    : BookingScreen(shop: shop),
              ),
            ),
          );
          await tester.pumpAndSettle();
          if (plan) {
            final flow = container.read(bookingPlanProvider(shop).notifier);
            flow.selectService(0, 0, '8');
            flow.selectDate('2031-05-01');
            await flow.loadSlots();
            flow.selectTime('10:00');
            await flow.refreshPriceQuote();
            flow.updateContact(
              name: 'Synthetic visitor',
              phone: '+12025550125',
            );
          } else {
            final flow = container.read(bookingFlowProvider.notifier);
            flow.selectService(shop.services.single);
            flow.selectDate(DateTime(2031, 5, 1));
            await tester.pumpAndSettle();
            flow.toggleTimeSlot('10:00');
            final quote = flow.refreshPriceQuote();
            await tester.pump();
            await quote;
            flow.updateContact(
              name: 'Synthetic visitor',
              phone: '+12025550125',
            );
          }
          await tester.pumpAndSettle();
          final action = find.byKey(
            ValueKey(
              plan
                  ? 'booking-plan-primary-action'
                  : 'booking-wizard-primary-action',
            ),
          );
          for (var step = 0; step < 3; step++) {
            await tester.tap(action);
            await tester.pumpAndSettle();
          }
          expect(
            find.byKey(const ValueKey('booking-contact-phone')),
            findsOneWidget,
          );
          tester.view.viewInsets = const FakeViewPadding(bottom: 300);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          final rect = tester.getRect(action);
          debugPrint(
            'KEYBOARD_PROBE ${plan ? 'PLAN' : 'STANDARD'} CTA=$rect usableBottom=544',
          );
          expect(
            rect.bottom,
            lessThanOrEqualTo(544),
            reason:
                'The software keyboard covers y544–844; final action must remain reachable.',
          );
          expect(repo.writes, isEmpty);
          expect(planRepo.writes, isEmpty);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          container.dispose();
        }
      },
    );
  }
  test(
    'exact customer saved amount display preserves USD 0.01, 40.00, 100.25',
    () {
      for (final pair in [
        (1, 'USD 0.01'),
        (4000, 'USD 40.00'),
        (10025, 'USD 100.25'),
      ]) {
        final booking = Booking.fromJson({
          'id': 'synthetic',
          'durationMin': 30,
          'priceCents': pair.$1,
          'totalCents': pair.$1,
          'paidCents': 0,
          'refundedCents': 0,
          'amountDueCents': pair.$1,
          'currency': 'usd',
          'paymentMode': 'PAY_AT_STORE',
          'status': 'PENDING',
          'paymentStatus': 'UNPAID',
          'orderOnly': true,
          'onlinePaymentEnabled': false,
        });
        expect(formatCents(pair.$1, 'usd'), pair.$2);
        expect(booking.formattedTotal, pair.$2);
        expect(booking.formattedDue, pair.$2);
        expect(booking.canOpenCheckout, isFalse);
      }
    },
  );
}
