import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/widgets/booking_calendar_picker.dart';
import 'package:mjapp_client/widgets/booking_compact_step_header.dart';

import 'booking_quote_fixture.dart';
import 'booking_special_wizard_test.dart' as wizard;
import 'guest_booking_flow_test.dart' show GuestAuth;

const primaryKey = ValueKey('booking-wizard-primary-action');
const recoveryLink = 'Previous submission unclear? Check my bookings';

void phone(WidgetTester tester) {
  wizard.viewport(tester, 390);
  tester.view.physicalSize = const Size(390, 844);
}

void fixedActionIsReachable(WidgetTester tester) {
  final action = find.byKey(primaryKey);
  expect(action.hitTestable(), findsOneWidget);
  expect(tester.getRect(action).bottom, lessThanOrEqualTo(844));
  expect(tester.getRect(find.byType(BookingCompactStepHeader)).height, lessThanOrEqualTo(76));
  expect(tester.takeException(), isNull);
}

void fixedRecoveryIsReachable(WidgetTester tester) {
  final recovery = find.text(recoveryLink);
  expect(recovery, findsOneWidget);
  expect(recovery.hitTestable(), findsOneWidget);
  final bounds = tester.getRect(recovery);
  expect(bounds.top, greaterThanOrEqualTo(tester.getRect(find.byKey(primaryKey)).bottom));
  expect(bounds.bottom, lessThanOrEqualTo(844));
  expect(bounds.left, greaterThanOrEqualTo(0));
  expect(bounds.right, lessThanOrEqualTo(390));
}

Future<ProviderContainer> mount(WidgetTester tester,
    {double textScale = 1, wizard.SpecialAvailability? repository}) async {
  final container = ProviderContainer(overrides: [
    authProvider.overrideWith((ref) => GuestAuth()..customer('41')),
    bookingRepositoryProvider.overrideWithValue(repository ?? wizard.SpecialAvailability(1)),
  ]);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: wizard.app(BookingScreen(shop: wizard.specialShop(guests: 1)), textScale: textScale),
  ));
  await tester.pumpAndSettle();
  return container;
}

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  testWidgets('390 x 844 keeps four step choices and total actions usable without bypassing quote review', (tester) async {
    phone(tester);
    final repository = wizard.SpecialAvailability(1);
    final container = await mount(tester, repository: repository);
    final primary = find.byKey(primaryKey);

    expect(find.text('1/4'), findsOneWidget);
    expect(find.text('Choose the service that fits your visit.'), findsNothing);
    expect(find.text('Four hands relaxation massage').hitTestable(), findsOneWidget);
    expect(tester.widget<FilledButton>(primary).onPressed, isNull);
    fixedActionIsReachable(tester);
    await wizard.click(tester, find.byTooltip('Show step help'));
    expect(find.text('Choose the service that fits your visit.'), findsOneWidget);
    await wizard.click(tester, find.text('Four hands relaxation massage'));
    await wizard.click(tester, find.text('90-minute visit'));
    await wizard.click(tester, primary);

    expect(find.text('2/4'), findsOneWidget);
    expect(find.text('Choose the service that fits your visit.'), findsNothing);
    expect(find.byTooltip('Show step help'), findsOneWidget);
    expect(find.text('Two qualified therapists will be assigned').hitTestable(), findsOneWidget);
    fixedActionIsReachable(tester);
    await wizard.click(tester, primary);

    expect(find.text('3/4'), findsOneWidget);
    expect(find.byType(BookingCalendarPicker).hitTestable(), findsOneWidget);
    fixedActionIsReachable(tester);
    await wizard.click(tester, find.text('Today'));
    await tester.scrollUntilVisible(find.text('5/4'), 150,
      scrollable: find.descendant(of: find.byType(BookingCalendarPicker), matching: find.byType(Scrollable)));
    await wizard.click(tester, find.text('5/4'));
    await wizard.click(tester, find.text('10:00 AM'));
    await wizard.click(tester, primary);

    expect(find.text('4/4'), findsOneWidget);
    expect(find.text('Estimated service price').hitTestable(), findsOneWidget);
    expect(find.text('Review current total'), findsWidgets);
    expect(find.textContaining('Submit booking request'), findsNothing);
    fixedActionIsReachable(tester);
    repository.deferredQuote = Completer<BookingPriceQuote>();
    await tester.tap(primary);
    await tester.pump();
    expect(tester.widget<FilledButton>(primary).onPressed, isNull);
    expect(find.text('Checking current total…'), findsOneWidget);
    expect(repository.writes, 0);
    repository.deferredQuote!.complete(BookingPriceQuote.fromJson(
      timedQuoteJson(container.read(bookingFlowProvider).quoteRequest, price: 21000, minutes: 90),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Reviewed total').hitTestable(), findsOneWidget);
    expect(find.textContaining('Submit booking request').hitTestable(), findsOneWidget);
    expect(tester.widget<FilledButton>(primary).onPressed, isNotNull);
    expect(find.text(recoveryLink).hitTestable(), findsOneWidget);
    fixedRecoveryIsReachable(tester);
    expect(container.read(bookingFlowProvider).canConfirm, isTrue);
    expect(repository.quotes, hasLength(1));
    expect(repository.writes, 0);
    fixedActionIsReachable(tester);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('larger phone text keeps help and normal recovery reachable without overflow', (tester) async {
    phone(tester);
    final container = await mount(tester, textScale: 1.6);
    expect(find.byKey(primaryKey).hitTestable(), findsOneWidget);
    expect(find.text(recoveryLink).hitTestable(), findsOneWidget);
    await wizard.click(tester, find.byTooltip('Show step help'));
    expect(find.text('Choose the service that fits your visit.'), findsOneWidget);
    expect(find.byKey(primaryKey).hitTestable(), findsOneWidget);
    await wizard.click(tester, find.byTooltip('Hide step help'));
    expect(find.text('Choose the service that fits your visit.'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('a real persisted uncertainty reminder retains the prominent recovery panel and blocks a new order', (tester) async {
    phone(tester);
    writeBookingRecoveryMarker('synthetic-uncertain-request', '7');
    final container = await mount(tester);
    expect(container.read(bookingFlowProvider).recoveryReminder, isTrue);
    expect(find.text('Check the original booking request').hitTestable(), findsOneWidget);
    expect(find.text('Check my bookings').hitTestable(), findsOneWidget);
    expect(find.text(recoveryLink), findsNothing);
    expect(find.text('Four hands relaxation massage'), findsNothing);
    expect(tester.widget<FilledButton>(find.byKey(primaryKey)).onPressed, isNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('desktop keeps the labelled step overview and visible step guidance', (tester) async {
    wizard.viewport(tester, 1180);
    final container = await mount(tester);
    expect(find.byType(BookingCompactStepHeader), findsNothing);
    expect(find.text('Choose the service that fits your visit.'), findsOneWidget);
    expect(find.text('Services'), findsWidgets);
    expect(find.text('Therapists'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });
}
