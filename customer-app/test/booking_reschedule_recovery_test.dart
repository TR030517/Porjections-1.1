import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/services/booking_reschedule_journal.dart';

import 'booking_order_actions_test.dart' as orders;

Map<String, dynamic> moved(orders.OrderWire wire) => {
  ...wire.order,
  'localStartTime': '11:00',
  'localEndTime': '12:00',
  'timezone': wire.slotTimezone,
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'restoring a durable original command preserves its key and rejects a changed target or another write',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      final journal = BookingRescheduleJournal();
      final attempt = await journal.begin(
        actor: '41',
        booking: Booking.fromJson(orders.discountedOrder()),
        date: '2031-05-02',
        startTime: '11:00',
        timezone: 'America/Los_Angeles',
      );
      final restored = BookingRescheduleJournal();
      await restored.prepare('41', '42');
      final pending = restored.status('41', '42').attempt!;
      expect(pending.marker, attempt.marker);
      expect(restored.status('41', '42').blocked, isTrue);
      await restored.guardWrite(
        '41',
        '42',
        requestKey: pending.requestKey,
        move: pending.payload,
      );
      await expectLater(
        restored.guardWrite('41', '42'),
        throwsA(isA<RescheduleJournalException>()),
      );
      await expectLater(
        restored.guardWrite(
          '41',
          '42',
          requestKey: pending.requestKey,
          move: {...pending.payload, 'startTime': '12:00'},
        ),
        throwsA(isA<RescheduleJournalException>()),
      );
      await expectLater(
        restored.begin(
          actor: '41',
          booking: Booking.fromJson(orders.discountedOrder()),
          date: '2031-05-03',
          startTime: '12:00',
          timezone: 'America/Los_Angeles',
        ),
        throwsA(isA<RescheduleJournalException>()),
      );
      await restored.prepare('42', '42');
      expect(restored.status('42', '42').blocked, isFalse);
    },
  );

  void viewport(WidgetTester tester) {
    tester.view.physicalSize = const Size(700, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets(
    'an ordinary GET cannot unlock an unknown move even if the current target matches; a matching original committed receipt can',
    (tester) async {
      viewport(tester);
      final wire = (await orders.connect(tester))..saveFailure = 503;
      await orders.openChangeTime(tester);
      await orders.selectAndSave(tester);
      wire.reconcileFailure = true;
      await orders.checkOriginalChange(tester);
      expect(find.text('Change booking time'), findsNothing);
      wire.order = moved(wire);
      await tester.tap(find.byTooltip('Reload'));
      await tester.pumpAndSettle();
      expect(find.text('11:00 - 12:00 (America/Los_Angeles)'), findsOneWidget);
      expect(find.text('Change booking time'), findsNothing);
      expect(
        bookingRescheduleJournal.status('41', '42').attempt!.requestKey,
        wire.requestKeys.single,
      );
      wire.reconcileFailure = false;
      wire.reconcileOutcome = 'COMMITTED';
      await orders.checkOriginalChange(tester);
      expect(
        find.textContaining('The original time change was verified'),
        findsOneWidget,
      );
      expect(find.text('Change booking time'), findsOneWidget);
      expect(wire.saves, 1);
      expect(wire.reconciledKeys, [
        wire.requestKeys.single,
        wire.requestKeys.single,
      ]);
      expect(bookingRescheduleJournal.status('41', '42').blocked, isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a receipt for a different operation cannot release the original lock; not-executed recovery keeps the original key',
    (tester) async {
      viewport(tester);
      final wire = (await orders.connect(tester))..saveFailure = 503;
      await orders.openChangeTime(tester);
      await orders.selectAndSave(tester);
      wire.reconcileReceipt = {
        'bookingId': '42',
        'shopId': '7',
        'requestKey': 'another-operation',
        'outcome': 'NOT_EXECUTED',
        'action': null,
      };
      await orders.checkOriginalChange(tester);
      expect(find.text('Change booking time'), findsNothing);
      expect(bookingRescheduleJournal.status('41', '42').blocked, isTrue);
      wire.reconcileReceipt = null;
      await orders.checkOriginalChange(tester);
      expect(
        find.textContaining('Its delayed request has been stopped'),
        findsOneWidget,
      );
      expect(find.text('Change booking time'), findsOneWidget);
      expect(wire.saves, 1);
      expect(wire.reconciledKeys, [
        wire.requestKeys.single,
        wire.requestKeys.single,
      ]);
      expect(bookingRescheduleJournal.status('41', '42').blocked, isFalse);
      expect(tester.takeException(), isNull);
    },
  );
}
