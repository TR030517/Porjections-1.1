import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_therapists.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';

// Representative serialized response, including a discount and platform fee.
Booking responseBooking() => Booking.fromJson(
  jsonDecode('''{
  "id":"42","shopId":"7","serviceId":"8","priceCents":6000,
  "discountCents":500,"platformFeeCents":235,"totalCents":5735,
  "paidCents":5735,"refundedCents":135,"currency":"usd",
  "status":"COMPLETED","paymentStatus":"PARTIALLY_REFUNDED","hasReview":true,
  "bookingDate":"2031-01-15T00:00:00.000Z",
  "startTime":"2031-01-15T15:00:00.000Z","endTime":"2031-01-15T16:00:00.000Z",
  "timezone":"America/New_York","localDate":"2031-01-15",
  "localStartTime":"10:00","localEndTime":"11:00"
}''')
      as Map<String, dynamic>,
);

void main() {
  test(
    'saved item assignments deduplicate calendars, preserve saved names, and never borrow an unassigned roster or top-level therapist',
    () {
      final booking = Booking.fromJson({
        'therapist': {'id': '99', 'name': 'Former primary'},
        'items': [
          {
            'assignedTherapistId': '11',
            'assignedTherapistIds': ['11', '12', '12'],
            'therapistNameSnapshot': 'Saved first',
          },
          {
            'assignedTherapistId': '12',
            'assignedTherapistIds': ['12'],
            'therapistNameSnapshot': 'Saved second',
          },
        ],
      });
      final assigned = assignedBookingTherapists(
        booking,
        rosterNames: {
          '11': 'Renamed first',
          '12': 'Renamed second',
          '13': 'Not assigned',
          '99': 'Former primary',
        },
      );
      expect(assigned.map((row) => (row.id, row.name)), [
        ('11', 'Saved first'),
        ('12', 'Saved second'),
      ]);
    },
  );

  for (final guests in [1, 2]) {
    testWidgets(
      '${guests == 1 ? 'four-hands' : 'couple'} order card shows both assigned therapist names without multiplying total or changing shop time',
      (tester) async {
        final booking = assignedBooking(guests: guests);
        await showBookings(tester, [booking], shop: assignedShop());
        expect(find.text('Therapist 1, Therapist 2'), findsOneWidget);
        expect(find.text('Total: USD 57.35'), findsOneWidget);
        expect(find.text('10:00 - 11:00 (America/New_York)'), findsOneWidget);
        expect(find.textContaining('USD 114.70'), findsNothing);
      },
    );
  }

  testWidgets('unavailable shop names never hide the second saved therapist', (
    tester,
  ) async {
    await showBookings(tester, [assignedBooking(guests: 1)]);
    expect(find.text('Therapist 1, Therapist #12'), findsOneWidget);
  });

  testWidgets(
    'ordinary named therapist stays unchanged and does not request the shop roster',
    (tester) async {
      final booking = assignedBooking(guests: 1, staff: 1);
      var reads = 0;
      await showBookings(tester, [booking], onShopRead: () => reads++);
      expect(find.text('Therapist 1'), findsOneWidget);
      expect(reads, 0);
    },
  );

  test(
    'booking parses server total, paid/refunded and shop-local times without replacing them with base price',
    () {
      final booking = responseBooking();
      expect(booking.platformFeeCents, 235);
      expect(booking.totalCents, 5735);
      expect(booking.paidCents, 5735);
      expect(booking.refundedCents, 135);
      expect(booking.formattedPrice, 'USD 57.35');
      expect(booking.formattedBasePrice, 'USD 60.00');
      expect(booking.formattedPaid, 'USD 57.35');
      expect(booking.formattedRefunded, 'USD 1.35');
      expect(booking.formattedTimeRange, '10:00 - 11:00 (America/New_York)');
      expect(booking.formattedDate, '2031-01-15');
      // Deliberately inconsistent totals must still display the server value.
      final authoritative = Booking.fromJson({
        'totalCents': 5735,
        'priceCents': 9000,
        'currency': 'cad',
      });
      expect(authoritative.formattedTotal, 'CAD 57.35');
      expect(
        Booking.fromJson({
          'priceCents': 6000,
          'currency': 'usd',
        }).formattedTotal,
        'Amount unavailable',
      );
    },
  );

  test(
    'service prices preserve cents and legacy appointment times are explicitly UTC',
    () {
      final service = ShopService.fromJson(
        jsonDecode('{"id":"8","priceCents":5735,"currency":"usd"}'),
      );
      expect(service.formattedPrice, 'USD 57.35');
      expect(
        ShopService.fromJson({
          'priceCents': 5001,
          'currency': 'cad',
        }).formattedPrice,
        'CAD 50.01',
      );
      final legacy = Booking.fromJson({
        'startTime': '2031-01-15T10:00:00-05:00',
        'endTime': '2031-01-15T11:00:00-05:00',
      });
      expect(legacy.formattedTimeRange, '15:00 - 16:00 (UTC)');
      expect(
        Booking.fromJson({
          'startTime': '10:00',
          'endTime': '11:00',
        }).formattedTimeRange,
        'Shop time unavailable',
      );
    },
  );

  testWidgets(
    'appointment list renders actual total, paid and refunded cents with shop timezone',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            bookingListProvider.overrideWith(
              (ref) async => [responseBooking()],
            ),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: BookingListScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Total: USD 57.35'), findsOneWidget);
      expect(find.text('Paid: USD 57.35'), findsOneWidget);
      expect(find.text('Refunded: USD 1.35'), findsOneWidget);
      expect(find.text('10:00 - 11:00 (America/New_York)'), findsOneWidget);
      expect(find.textContaining('USD 60.00'), findsNothing);
      expect(find.textContaining('15:00'), findsNothing);
    },
  );
}

Booking assignedBooking({required int guests, int staff = 2}) =>
    Booking.fromJson({
      'id': '42',
      'userId': '41',
      'shopId': '7',
      'serviceId': '8',
      'priceCents': 5735,
      'totalCents': 5735,
      'currency': 'usd',
      'paidCents': 0,
      'refundedCents': 0,
      'amountDueCents': 5735,
      'status': 'COMPLETED',
      'paymentStatus': 'UNPAID',
      'paymentMode': 'PAY_AT_STORE',
      'hasReview': true,
      'therapistId': '11',
      'therapist': {'id': '11', 'name': 'Therapist 1'},
      'bookingDate': '2031-01-15',
      'startTime': '2031-01-15T15:00:00Z',
      'endTime': '2031-01-15T16:00:00Z',
      'timezone': 'America/New_York',
      'localDate': '2031-01-15',
      'localStartTime': '10:00',
      'localEndTime': '11:00',
      'durationMin': 60,
      'items': [
        for (var index = 0; index < guests; index++)
          {
            'id': '${100 + index}',
            'participantIndex': index + 1,
            'serviceId': '8',
            'durationMin': 60,
            'assignedTherapistId': '${11 + index}',
            'assignedTherapistIds': guests == 1
                ? [for (var i = 0; i < staff; i++) '${11 + i}']
                : ['${11 + index}'],
            'requiredStaffCount': guests == 1 ? staff : 1,
          },
      ],
    });

ShopDetail assignedShop() => ShopDetail.fromJson({
  'id': '7',
  'name': 'Synthetic studio',
  'latitude': 0,
  'longitude': 0,
  'therapists': [
    {'id': '11', 'name': 'Therapist 1'},
    {'id': '12', 'name': 'Therapist 2'},
  ],
});

Future<void> showBookings(
  WidgetTester tester,
  List<Booking> bookings, {
  ShopDetail? shop,
  VoidCallback? onShopRead,
}) async {
  tester.view.physicalSize = const Size(1000, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        bookingListProvider.overrideWith((ref) async => bookings),
        shopDetailProvider('7').overrideWith((ref) async {
          onShopRead?.call();
          if (shop == null) {
            throw StateError('Synthetic unavailable shop roster');
          }
          return shop;
        }),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: BookingListScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}
