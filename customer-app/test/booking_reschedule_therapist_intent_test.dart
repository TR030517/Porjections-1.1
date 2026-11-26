import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'booking_order_actions_test.dart' as orders;

Map<String, dynamic> intentOrder({String kind = 'STANDARD', bool specific = false}) {
  final request = <String, dynamic>{
    'therapistSelectionMode': specific ? 'SPECIFIC' : 'AUTO',
    'requestedTherapistIds': specific ? ['11'] : <String>[],
  };
  return {
    ...orders.discountedOrder(),
    ...request,
    'reservationKind': kind,
    'therapistId': '11',
    'items': [
      {
        'id': '100', 'serviceId': '8', 'participantIndex': 1, 'sequence': 1,
        'serviceNameSnapshot': 'Synthetic massage', 'durationMin': 60,
        'priceCentsSnapshot': 8000, 'assignedTherapistId': '11',
        'assignedTherapistIds': ['11'], ...request,
      },
      if (kind == 'PLAN')
        {
          'id': '101', 'serviceId': '9', 'participantIndex': 1, 'sequence': 2,
          'serviceNameSnapshot': 'Synthetic second service', 'durationMin': 30,
          'priceCentsSnapshot': 0, 'assignedTherapistId': '12',
          'assignedTherapistIds': ['12'], 'therapistSelectionMode': 'AUTO',
          'requestedTherapistIds': <String>[],
        },
    ],
  };
}

Map<String, dynamic> moved(Map<String, dynamic> order) => {
  ...order, 'localStartTime': '11:00', 'localEndTime': '12:00',
  'timezone': 'America/Los_Angeles',
  'startTime': '2031-05-01T18:00:00Z', 'endTime': '2031-05-01T19:00:00Z',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  void viewport(WidgetTester tester) {
    tester.view.physicalSize = const Size(700, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets('automatic assignment may change after moving without changing the saved request or whole order price', (tester) async {
    viewport(tester);
    final wire = await orders.connect(tester);
    wire.order = intentOrder();
    wire.receipt = {
      ...moved(wire.order), 'therapistId': '12',
      'items': [
        {...(wire.order['items'] as List).first as Map<String, dynamic>,
          'assignedTherapistId': '12', 'assignedTherapistIds': ['12']},
      ],
    };
    await orders.openChangeTime(tester);
    expect(find.textContaining('Therapists are assigned automatically and may change'), findsOneWidget);
    await orders.selectAndSave(tester);
    expect(find.text('Booking time updated.'), findsOneWidget);
    expect(find.text('Therapist request: Automatic assignment'), findsOneWidget);
    expect(find.text('Assigned therapists: #12'), findsOneWidget);
    expect(wire.savedBody, {'date': '2031-05-01', 'startTime': '11:00'});
    expect(wire.saves, 1);
    expect(find.text('USD 60.00'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a requested therapist conflict clears availability and a read retry cannot resubmit the move', (tester) async {
    viewport(tester);
    final wire = await orders.connect(tester);
    wire.order = intentOrder(specific: true);
    wire.saveFailure = 409;
    await orders.openChangeTime(tester);
    expect(find.textContaining('Your requested therapist(s) will be kept'), findsOneWidget);
    await orders.selectAndSave(tester);
    expect(find.text('Booking time updated.'), findsNothing);
    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Save time'), findsNothing);
    expect(tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Check available times')).onPressed, isNull);
    await orders.checkOriginalChange(tester);
    expect(wire.reconciledKeys, wire.requestKeys);
    await tester.tap(find.text('Change booking time'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Check available times'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(ChoiceChip, '11:00'), findsOneWidget);
    expect(wire.saves, 1);
    expect(wire.order['requestedTherapistIds'], ['11']);
    expect(tester.takeException(), isNull);
  });

  for (final plan in [false, true]) {
    testWidgets('${plan ? 'per-segment PLAN' : 'standard'} therapist request changes cannot be accepted as a successful move', (tester) async {
      viewport(tester);
      final wire = await orders.connect(tester);
      wire.order = intentOrder(kind: plan ? 'PLAN' : 'STANDARD', specific: true);
      wire.receipt = {
        ...moved(wire.order),
        if (!plan) 'requestedTherapistIds': ['12'],
        if (plan) 'items': [
          {...(wire.order['items'] as List).first as Map<String, dynamic>, 'requestedTherapistIds': ['12']},
          (wire.order['items'] as List)[1],
        ],
      };
      await orders.openChangeTime(tester);
      await orders.selectAndSave(tester);
      expect(find.text('Booking time updated.'), findsNothing);
      expect(find.textContaining('The change could not be verified'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Save time'), findsNothing);
      wire.reconcileFailure = true;
      await orders.checkOriginalChange(tester);
      expect(find.text('Change booking time'), findsNothing);
      expect(wire.saves, 1);
      wire.reconcileFailure = false;
      await orders.checkOriginalChange(tester);
      expect(find.text('Change booking time'), findsOneWidget);
      expect(wire.saves, 1);
      expect(wire.reconciledKeys, [wire.requestKeys.single, wire.requestKeys.single]);
      expect(find.textContaining('Requested: #11'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  }
}
