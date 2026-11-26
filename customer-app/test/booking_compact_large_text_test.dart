import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/widgets/booking_calendar_picker.dart';

import 'booking_special_wizard_test.dart' as wizard;
import 'guest_booking_flow_test.dart' show GuestAuth;

const actionKey = ValueKey('booking-wizard-primary-action');

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  for (final scale in [1.5, 2.0]) {
    for (final guests in [1, 2]) {
      testWidgets(
        '390 x 844 ${scale}x text completes $guests guest choices and recovers a failed quote review',
        (tester) async {
          wizard.viewport(tester, 390);
          tester.view.physicalSize = const Size(390, 844);
          final repo = wizard.SpecialAvailability(guests);
          final container = ProviderContainer(
            overrides: [
              authProvider.overrideWith((ref) => GuestAuth()..customer('41')),
              bookingRepositoryProvider.overrideWithValue(repo),
            ],
          );
          final shop = wizard.specialShop(guests: guests);
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: wizard.app(BookingScreen(shop: shop), textScale: scale),
            ),
          );
          await tester.pumpAndSettle();

          void usable() {
            final action = find.byKey(actionKey);
            expect(action.hitTestable(), findsOneWidget);
            expect(tester.getRect(action).bottom, lessThanOrEqualTo(844));
            expect(tester.takeException(), isNull);
          }

          usable();
          await wizard.click(tester, find.text(shop.services.single.name));
          await wizard.click(tester, find.text('90-minute visit'));
          expect(container.read(bookingFlowProvider).selectedVariant?.id, '92');
          usable();
          await wizard.click(tester, find.byKey(actionKey));
          expect(find.text('2/4'), findsOneWidget);
          await Scrollable.ensureVisible(
            tester.element(
              find.text('Two qualified therapists will be assigned'),
            ),
            alignment: 0.5,
          );
          await tester.pumpAndSettle();
          expect(
            find
                .text('Two qualified therapists will be assigned')
                .hitTestable(),
            findsOneWidget,
          );
          usable();
          await wizard.click(tester, find.byKey(actionKey));
          expect(find.text('3/4'), findsOneWidget);
          usable();
          await wizard.click(tester, find.text('Today'));
          await tester.scrollUntilVisible(
            find.text('5/4'),
            150,
            scrollable: find.descendant(
              of: find.byType(BookingCalendarPicker),
              matching: find.byType(Scrollable),
            ),
          );
          await wizard.click(tester, find.text('5/4'));
          await wizard.click(tester, find.text('10:00 AM'));
          expect(container.read(bookingFlowProvider).selectedSlots, ['10:00']);
          usable();
          await wizard.click(tester, find.byKey(actionKey));
          expect(find.text('4/4'), findsOneWidget);
          usable();
          expect(find.text('Review current total'), findsWidgets);
          repo.deferredQuote = Completer<BookingPriceQuote>();
          await tester.tap(find.byKey(actionKey));
          await tester.pump();
          expect(container.read(bookingFlowProvider).isLoadingQuote, isTrue);
          expect(
            tester.widget<FilledButton>(find.byKey(actionKey)).onPressed,
            isNull,
          );
          repo.deferredQuote!.completeError(
            StateError('Synthetic quote outage'),
          );
          await tester.pumpAndSettle();
          final quoteError = find.text(
            'Unable to verify the current price. Get a new quote before confirming.',
          );
          await Scrollable.ensureVisible(
            tester.element(quoteError),
            alignment: 0.5,
          );
          await tester.pumpAndSettle();
          expect(quoteError.hitTestable(), findsOneWidget);
          expect(container.read(bookingFlowProvider).canConfirm, isFalse);
          expect(repo.writes, 0);
          repo.deferredQuote = null;
          await wizard.click(tester, find.byKey(actionKey));
          expect(container.read(bookingFlowProvider).canConfirm, isTrue);
          expect(repo.quotes, hasLength(2));
          expect(container.read(bookingFlowProvider).selectedVariant?.id, '92');
          expect(container.read(bookingFlowProvider).selectedSlots, ['10:00']);
          expect(
            tester.getSize(find.text('Main services')).width,
            greaterThan(100),
          );
          usable();
          expect(
            tester.widget<FilledButton>(find.byKey(actionKey)).onPressed,
            isNotNull,
          );
          final recovery = find.text(
            'Previous submission unclear? Check my bookings',
          );
          await tester.ensureVisible(recovery);
          await tester.pumpAndSettle();
          expect(recovery.hitTestable(), findsOneWidget);
          expect(repo.writes, 0);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
          container.dispose();
          await tester.pump();
        },
      );
    }
  }

  testWidgets(
    '390 x 844 2x text keeps uncertain request recovery reachable and a new order blocked',
    (tester) async {
      wizard.viewport(tester, 390);
      tester.view.physicalSize = const Size(390, 844);
      writeBookingRecoveryMarker('synthetic-large-text-uncertainty', '7');
      final repo = wizard.SpecialAvailability(1);
      final container = ProviderContainer(
        overrides: [
          authProvider.overrideWith((ref) => GuestAuth()..customer('41')),
          bookingRepositoryProvider.overrideWithValue(repo),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: wizard.app(
            BookingScreen(shop: wizard.specialShop(guests: 1)),
            textScale: 2,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(container.read(bookingFlowProvider).recoveryReminder, isTrue);
      expect(
        tester.widget<FilledButton>(find.byKey(actionKey)).onPressed,
        isNull,
      );
      for (final label in [
        'Check the original booking request',
        'Check my bookings',
      ]) {
        await Scrollable.ensureVisible(
          tester.element(find.text(label)),
          alignment: 0.5,
        );
        await tester.pumpAndSettle();
        expect(find.text(label).hitTestable(), findsOneWidget);
      }
      expect(repo.writes, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      await tester.pump();
    },
  );
}
