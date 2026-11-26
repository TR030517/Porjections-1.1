import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/services/api_service.dart';

import 'booking_detail_boundary_test.dart' as boundary;
import 'booking_order_actions_test.dart' as orders;
import 'booking_quote_fixture.dart';

class DraftEventWire extends orders.OrderWire {
  final dates = <String>[];
  Completer<void>? saveRelease;
  int writesStarted = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    if (options.path == '/bookings/42/reschedule-slots') {
      final date = options.queryParameters['date'] as String;
      dates.add(date);
      return ResponseBody.fromString(
        jsonEncode({
          'date': date,
          'timezone': slotTimezone,
          'bookingCalendar': {...calendarFixture(), 'timezone': slotTimezone},
          'slots': [
            {'time': '11:00', 'available': true},
            {'time': '11:30', 'available': true},
          ],
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }
    if (options.path == '/bookings/42/reschedule') {
      writesStarted++;
      await saveRelease?.future;
    }
    return super.fetch(options, stream, cancel);
  }
}

Finder get dialog => find.byType(AlertDialog);
Finder slot(String time) => find.widgetWithText(ChoiceChip, time);
Finder get save => find.widgetWithText(FilledButton, 'Save time');
Finder get dateField =>
    find.descendant(of: dialog, matching: find.byType(TextFormField));
Finder get checkTimes =>
    find.widgetWithText(OutlinedButton, 'Check available times');
Finder get cancel => find.descendant(
  of: dialog,
  matching: find.widgetWithText(TextButton, 'Cancel'),
);

Future<DraftEventWire> open(WidgetTester tester, {bool plan = false}) async {
  tester.view.physicalSize = const Size(700, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = ApiService(), previous = api.dio.httpClientAdapter;
  final wire = DraftEventWire();
  if (plan) wire.order = {...wire.order, 'reservationKind': 'PLAN'};
  api.dio.httpClientAdapter = wire;
  addTearDown(() => api.dio.httpClientAdapter = previous);
  await orders.openChangeTime(tester);
  expect(slot('11:00'), findsOneWidget);
  expect(slot('11:30'), findsOneWidget);
  return wire;
}

Future<void> choose(WidgetTester tester, String time) async {
  await tester.ensureVisible(slot(time));
  await tester.tap(slot(time));
  await tester.pump();
  expect(tester.widget<ChoiceChip>(slot(time)).selected, isTrue);
}

Future<void> newDate(WidgetTester tester) async {
  await tester.enterText(dateField, '2031-05-02');
  await tester.pump();
  await tester.tap(checkTimes);
  await tester.pumpAndSettle();
}

Future<void> finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

void main() {
  for (final plan in [false, true]) {
    final name = plan ? 'PLAN' : 'ordinary';
    testWidgets(
      '$name reschedule stale slot cannot replace a new choice in the same list',
      (tester) async {
        final wire = await open(tester, plan: plan);
        final stale = tester.widget<ChoiceChip>(slot('11:00')).onSelected!;
        await choose(tester, '11:30');
        stale(true);
        await tester.pump();
        expect(tester.widget<ChoiceChip>(slot('11:30')).selected, isTrue);
        expect(tester.widget<ChoiceChip>(slot('11:00')).selected, isFalse);
        expect(wire.dates, ['2031-05-01']);
        expect(wire.saves, 0);
        await choose(tester, '11:00');
        await tester.tap(save);
        await tester.pumpAndSettle();
        expect(wire.savedBody, {'date': '2031-05-01', 'startTime': '11:00'});
        expect(wire.saves, 1);
        expect(find.text('Booking time updated.'), findsOneWidget);
        await finish(tester);
      },
    );

    testWidgets(
      '$name reschedule stale slot cannot replace a new date choice',
      (tester) async {
        final wire = await open(tester, plan: plan);
        final stale = tester.widget<ChoiceChip>(slot('11:00')).onSelected!;
        await newDate(tester);
        await choose(tester, '11:30');
        stale(true);
        await tester.pump();
        expect(tester.widget<ChoiceChip>(slot('11:30')).selected, isTrue);
        expect(tester.widget<ChoiceChip>(slot('11:00')).selected, isFalse);
        expect(wire.saves, 0);
        await tester.tap(save);
        await tester.pumpAndSettle();
        expect(wire.savedBody, {'date': '2031-05-02', 'startTime': '11:30'});
        expect(find.text('Booking time updated.'), findsOneWidget);
        await finish(tester);
      },
    );

    testWidgets(
      '$name reschedule stale save cannot submit a newer date draft',
      (tester) async {
        final wire = await open(tester, plan: plan);
        await choose(tester, '11:00');
        final stale = tester.widget<FilledButton>(save).onPressed!;
        await newDate(tester);
        await choose(tester, '11:30');
        stale();
        await tester.pumpAndSettle();
        expect(wire.saves, 0);
        expect(dialog, findsOneWidget);
        await tester.tap(save);
        await tester.pumpAndSettle();
        expect(wire.saves, 1);
        expect(wire.savedBody, {'date': '2031-05-02', 'startTime': '11:30'});
        await finish(tester);
      },
    );
  }

  testWidgets(
    'an old input for a returned date cannot clear the new reschedule choice',
    (tester) async {
      final wire = await open(tester);
      final stale = tester.widget<TextFormField>(dateField).onChanged!;
      await newDate(tester);
      await tester.enterText(dateField, '2031-05-01');
      await tester.pump();
      await tester.tap(checkTimes);
      await tester.pumpAndSettle();
      await choose(tester, '11:30');
      stale('2031-05-01');
      await tester.pump();
      expect(slot('11:30'), findsOneWidget);
      expect(tester.widget<ChoiceChip>(slot('11:30')).selected, isTrue);
      expect(wire.dates, ['2031-05-01', '2031-05-02', '2031-05-01']);
      expect(wire.saves, 0);
      await tester.enterText(dateField, '2031-05-03');
      await tester.pump();
      expect(slot('11:30'), findsNothing);
      await tester.tap(checkTimes);
      await tester.pumpAndSettle();
      await choose(tester, '11:00');
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(wire.savedBody, {'date': '2031-05-03', 'startTime': '11:00'});
      expect(wire.saves, 1);
      expect(find.text('Booking time updated.'), findsOneWidget);
      await finish(tester);
    },
  );

  testWidgets(
    'queued reschedule cancel cannot abandon a save with unknown outcome',
    (tester) async {
      final wire = await open(tester);
      final stale = tester.widget<TextButton>(cancel).onPressed!;
      wire.saveRelease = Completer<void>();
      wire.saveFailure = 503;
      await choose(tester, '11:00');
      await tester.tap(save);
      await boundary.pumpUntil(
        tester,
        () => wire.writesStarted == 1,
        'The in-memory save must be pending.',
      );
      stale();
      await tester.pump(const Duration(milliseconds: 300));
      expect(dialog, findsOneWidget);
      wire.saveRelease!.complete();
      await tester.pumpAndSettle();
      expect(
        find.textContaining('The change could not be verified'),
        findsOneWidget,
      );
      expect(save, findsNothing);
      expect(wire.saves, 1);
      await orders.checkOriginalChange(tester);
      expect(wire.reads, 2);
      expect(wire.reconciledKeys, wire.requestKeys);
      expect(find.textContaining('Its delayed request has been stopped'), findsOneWidget);
      expect(wire.saves, 1);
      await finish(tester);
    },
  );

  testWidgets(
    'queued date input cannot clear the reschedule draft during save',
    (tester) async {
      final wire = await open(tester);
      final stale = tester.widget<TextFormField>(dateField).onChanged!;
      wire.saveRelease = Completer<void>();
      wire.saveFailure = 503;
      await choose(tester, '11:00');
      await tester.tap(save);
      await boundary.pumpUntil(
        tester,
        () => wire.writesStarted == 1,
        'The in-memory save must be pending.',
      );
      stale('2031-05-03');
      await tester.pump();
      expect(slot('11:00'), findsOneWidget);
      expect(tester.widget<ChoiceChip>(slot('11:00')).selected, isTrue);
      wire.saveRelease!.complete();
      await tester.pumpAndSettle();
      expect(
        find.textContaining('The change could not be verified'),
        findsOneWidget,
      );
      expect(wire.savedBody, {'date': '2031-05-01', 'startTime': '11:00'});
      expect(wire.saves, 1);
      await finish(tester);
    },
  );
}
