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
import 'reschedule_test_fixture.dart';

class TargetWire extends orders.OrderWire {
  Completer<void>? oldRead, oldSave;
  int reads43 = 0, startedReads42 = 0, startedSaves = 0, slotReads = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    if (options.path == '/bookings/43') {
      reads43++;
      return ResponseBody.fromString(
        jsonEncode({
          ...orders.discountedOrder(),
          'id': '43',
          'bookingNo': 'NEW-ORDER-43',
          'serviceId': '9',
          'items': [
            {
              'id': '200',
              'serviceId': '9',
              'participantIndex': 1,
              'sequence': 1,
              'serviceNameSnapshot': 'New order treatment',
              'durationMin': 60,
              'priceCentsSnapshot': 8000,
            },
          ],
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }
    if (options.path == '/notifications/bookings/43/order-email') {
      return ResponseBody.fromString(
        jsonEncode({
          'bookingId': '43',
          'channel': 'EMAIL',
          'status': 'NOT_REQUESTED',
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }
    if (options.path == '/bookings/42') {
      startedReads42++;
      await oldRead?.future;
    }
    if (options.path == '/bookings/42/reschedule-slots') slotReads++;
    if (options.path == '/bookings/42/reschedule') {
      startedSaves++;
      await oldSave?.future;
    }
    return super.fetch(options, stream, cancel);
  }
}

Future<({TargetWire wire, ValueNotifier<String> target, List<String> changed})>
openTarget(
  WidgetTester tester, {
  bool delayRead = false,
  bool delaySave = false,
}) async {
  await resetSyntheticReschedule(tester);
  tester.view.physicalSize = const Size(760, 1500);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = ApiService(), previous = ApiService().dio.httpClientAdapter;
  final wire = TargetWire();
  if (delayRead) wire.oldRead = Completer<void>();
  if (delaySave) wire.oldSave = Completer<void>();
  api.dio.httpClientAdapter = wire;
  addTearDown(() => api.dio.httpClientAdapter = previous);
  final target = ValueNotifier('42'), changed = <String>[];
  addTearDown(target.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
      ],
      child: orders.localized(
        ValueListenableBuilder<String>(
          valueListenable: target,
          builder: (_, id, child) => BookingDetailScreen(
            bookingId: id,
            onChanged: () => changed.add(id),
          ),
        ),
      ),
    ),
  );
  if (delayRead) {
    await tester.pump();
  } else {
    await boundary.pumpUntil(
      tester,
      () => find.text('Change booking time').evaluate().isNotEmpty,
      'The initial order must finish loading.',
    );
    await tester.pumpAndSettle();
  }
  return (wire: wire, target: target, changed: changed);
}

Future<void> openMove(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Change booking time'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Change booking time'));
  await tester.pumpAndSettle();
  await tester.tap(find.widgetWithText(ChoiceChip, '11:00'));
  await tester.pump();
}

void main() {
  testWidgets(
    'a reused detail state loads the new order and ignores a late old read',
    (tester) async {
      final test = await openTarget(tester, delayRead: true);
      test.target.value = '43';
      await tester.pump();
      test.wire.oldRead!.complete();
      await tester.pumpAndSettle();
      expect(test.wire.reads43, 1);
      expect(
        find.byWidgetPredicate(
          (widget) => widget is SelectableText && widget.data == 'NEW-ORDER-43',
        ),
        findsOneWidget,
      );
      expect(find.text('Original private treatment'), findsNothing);
      expect(test.changed, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a callback from a previous detail cannot open or write the old order after retargeting',
    (tester) async {
      final test = await openTarget(tester);
      final button = tester.widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Change booking time'),
      );
      final oldAction = button.onPressed!;
      test.target.value = '43';
      await tester.pumpAndSettle();
      oldAction();
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(test.wire.slotReads, 0);
      expect(test.wire.startedSaves, 0);
      expect(test.changed, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an in-flight old move cannot replace a different detail or invoke its change callback',
    (tester) async {
      final test = await openTarget(tester, delaySave: true);
      await openMove(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Save time'));
      await boundary.pumpUntil(
        tester,
        () => test.wire.startedSaves == 1,
        'The original move must reach the synthetic transport.',
      );
      test.target.value = '43';
      await tester.pump();
      test.wire.oldSave!.complete();
      await tester.pumpAndSettle();
      expect(test.changed, isEmpty);
      expect(find.text('Booking time updated.'), findsNothing);
      expect(test.wire.reads43, 1);
      expect(test.wire.startedSaves, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an old dialog save callback cannot write after the underlying order changes',
    (tester) async {
      final test = await openTarget(tester);
      await openMove(tester);
      final oldSave = tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save time'))
          .onPressed!;
      test.target.value = '43';
      await tester.pumpAndSettle();
      oldSave();
      await tester.pumpAndSettle();
      expect(test.wire.startedSaves, 0);
      expect(test.changed, isEmpty);
      expect(find.text('Booking changed'), findsOneWidget);
      expect(find.text('Booking time updated.'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an uncertain old move status reload cannot invoke a different order callback',
    (tester) async {
      final test = await openTarget(tester);
      test.wire.saveFailure = 500;
      await openMove(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Save time'));
      await tester.pumpAndSettle();
      expect(find.text('Save time'), findsNothing);
      test.wire.oldRead = Completer<void>();
      await orders.checkOriginalChange(tester);
      await boundary.pumpUntil(
        tester,
        () => test.wire.startedReads42 == 2,
        'The original order status reload must reach the synthetic transport.',
      );
      test.target.value = '43';
      await tester.pump();
      test.wire.oldRead!.complete();
      await tester.pumpAndSettle();
      expect(test.changed, isEmpty);
      expect(test.wire.reads43, 1);
      expect(test.wire.startedSaves, 1);
      expect(
        find.byWidgetPredicate(
          (widget) => widget is SelectableText && widget.data == 'NEW-ORDER-43',
        ),
        findsOneWidget,
      );
      expect(find.text('Booking time updated.'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
