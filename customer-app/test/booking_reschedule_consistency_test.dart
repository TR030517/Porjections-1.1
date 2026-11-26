import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

import 'booking_detail_boundary_test.dart' as boundary;
import 'booking_order_actions_test.dart' as orders;
import 'booking_quote_fixture.dart';
import 'reschedule_test_fixture.dart';

class DelayedRescheduleWire extends orders.OrderWire {
  final dates = <String>[];
  final slotReplies = <Completer<ResponseBody>>[];

  void complete(int index, {String time = '11:00'}) {
    slotReplies[index].complete(
      ResponseBody.fromString(
        jsonEncode({
          'date': dates[index],
          'timezone': 'America/Los_Angeles',
          'bookingCalendar': {
            ...calendarFixture(),
            'timezone': 'America/Los_Angeles',
          },
          'slots': [
            {'time': time, 'available': true},
          ],
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      ),
    );
  }

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) {
    if (options.path != '/bookings/42/reschedule-slots') {
      return super.fetch(options, stream, cancel);
    }
    dates.add(options.queryParameters['date'] as String);
    final reply = Completer<ResponseBody>();
    slotReplies.add(reply);
    return reply.future;
  }
}

Future<DelayedRescheduleWire> openPending(WidgetTester tester) async {
  await resetSyntheticReschedule(tester);
  tester.view.physicalSize = const Size(700, 1300);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = ApiService(), original = ApiService().dio.httpClientAdapter;
  final wire = DelayedRescheduleWire();
  api.dio.httpClientAdapter = wire;
  addTearDown(() => api.dio.httpClientAdapter = original);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
      ],
      child: orders.localized(const BookingDetailScreen(bookingId: '42')),
    ),
  );
  await boundary.pumpUntil(
    tester,
    () => find.text('Change booking time').evaluate().isNotEmpty,
    'The synthetic saved order must load.',
  );
  await tester.ensureVisible(find.text('Change booking time'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Change booking time'));
  await boundary.pumpUntil(
    tester,
    () => wire.slotReplies.isNotEmpty,
    'Opening the dialog must request current availability.',
  );
  // This route contains a pending spinner, so wait only for its animation.
  await tester.pump(const Duration(milliseconds: 300));
  return wire;
}

void main() {
  testWidgets(
    'reschedule ignores a late old date and saves only the explicitly selected current shop time',
    (tester) async {
      final wire = await openPending(tester);
      final dialog = find.byType(AlertDialog);
      final date = find.descendant(
        of: dialog,
        matching: find.byType(TextFormField),
      );
      await tester.enterText(date, '2031-05-02');
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Save time'),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(
        find.widgetWithText(OutlinedButton, 'Check available times'),
      );
      await boundary.pumpUntil(
        tester,
        () => wire.slotReplies.length == 2,
        'The edited date must have its own availability request.',
      );
      expect(wire.dates, ['2031-05-01', '2031-05-02']);
      wire.complete(1);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ChoiceChip, '11:00'));
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Save time'),
            )
            .onPressed,
        isNotNull,
      );
      wire.complete(0, time: '12:30');
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ChoiceChip, '12:30'), findsNothing);
      expect(find.widgetWithText(ChoiceChip, '11:00'), findsOneWidget);
      expect(
        find.text('Available times are in America/Los_Angeles (shop time).'),
        findsOneWidget,
      );
      expect(wire.saves, 0);
      await tester.tap(find.widgetWithText(FilledButton, 'Save time'));
      await tester.pumpAndSettle();
      expect(wire.savedBody, {'date': '2031-05-02', 'startTime': '11:00'});
      expect(wire.saves, 1);
      expect(find.text('Booking time updated.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'closing and reopening a reschedule dialog cannot reuse the abandoned slot request',
    (tester) async {
      final wire = await openPending(tester);
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.widgetWithText(TextButton, 'Cancel'),
        ),
      );
      await tester.pumpAndSettle();
      wire.complete(0, time: '12:30');
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Change booking time'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Change booking time'));
      await boundary.pumpUntil(
        tester,
        () => wire.slotReplies.length == 2,
        'Reopening must request fresh availability.',
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(ChoiceChip), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Save time'),
            )
            .onPressed,
        isNull,
      );
      wire.complete(1);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ChoiceChip, '11:00'), findsOneWidget);
      expect(find.widgetWithText(ChoiceChip, '12:30'), findsNothing);
      expect(wire.saves, 0);
      expect(tester.takeException(), isNull);
    },
  );
}
