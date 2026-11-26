import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';

Booking cancellationBooking({String status = 'CONFIRMED', int? paid = 0, int? refunded = 0}) => Booking.fromJson({
  'id': '77', 'bookingNo': 'Synthetic cancellation', 'userId': '2',
  'shopId': '7', 'serviceId': '8', 'priceCents': 8000,
  'totalCents': 8000, 'paidCents': paid, 'refundedCents': refunded,
  'amountDueCents': paid == null ? null : 8000 - paid,
  'currency': 'usd', 'paymentMode': 'PAY_AT_STORE',
  'status': status, 'paymentStatus': 'UNPAID',
  'bookingDate': '2031-01-15',
  'startTime': '2031-01-15T15:00:00.000Z',
  'endTime': '2031-01-15T16:00:00.000Z',
  'hasReview': true,
});

void main() {
  test('uncollected active reservations can cancel while collected money requires the refund flow', () {
    expect(cancellationBooking(status: 'PENDING').canCancel, isTrue);
    expect(cancellationBooking().canCancel, isTrue);
    expect(cancellationBooking(paid: 2000).canCancel, isFalse);
    expect(cancellationBooking(paid: 2000, refunded: 1000).canCancel, isFalse);
    expect(cancellationBooking(paid: 2000, refunded: 2000).canCancel, isTrue,
        reason: 'zero remaining collection permits cancellation, without recording another refund');
  });

  test('terminal reservations and unknown or inconsistent money are never advertised as cancellable', () {
    for (final status in ['CANCELLED', 'COMPLETED', 'REFUNDING', 'REFUNDED']) {
      expect(cancellationBooking(status: status).canCancel, isFalse);
    }
    for (final booking in [
      cancellationBooking(paid: null), cancellationBooking(refunded: null),
      cancellationBooking(paid: -1, refunded: -1),
      cancellationBooking(paid: 1000, refunded: 2000),
    ]) {
      expect(booking.canCancel, isFalse);
    }
    final malformed = Booking.fromJson({
      'id': '78', 'status': 'CONFIRMED', 'paymentStatus': 'UNPAID',
      'paidCents': 0.5, 'refundedCents': 0,
    });
    expect(malformed.paidCents, isNull,
        reason: 'fractional cents must not be truncated into zero collection');
    expect(malformed.canCancel, isFalse);
  });

  for (final paid in [0, 2000]) {
    testWidgets('customer list cancellation follows actual collection: $paid cents', (tester) async {
      await tester.pumpWidget(ProviderScope(
        overrides: [bookingListProvider.overrideWith((ref) async => [cancellationBooking(paid: paid)])],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: BookingListScreen()),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(OutlinedButton, 'Cancel'), paid == 0 ? findsOneWidget : findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
