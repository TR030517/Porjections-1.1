import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/payment_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_reschedule_journal.dart';
import 'package:mjapp_client/services/payment_checkout_service.dart';

class PaymentCustomer extends AuthNotifier {
  PaymentCustomer(super.api) {
    state = AuthState(
      isLoggedIn: true,
      user: User(id: '41', role: 'CUSTOMER'),
    );
  }
}

class FakePaymentApi implements PaymentCheckoutApi {
  bool enabled = false;
  String provider = 'square';
  String paymentStatus = 'UNPAID';
  int creates = 0;
  int bookingReads = 0;
  String checkoutUrl = 'https://sandbox.square.link/u/test';
  @override
  Future<Map<String, dynamic>> config() async => {
    'onlinePaymentEnabled': true,
    'orderOnly': false,
    'enabled': enabled,
    'provider': provider,
    'environment': 'sandbox',
    'currency': 'usd',
    'reason': enabled ? null : 'Payments are not configured.',
  };
  @override
  Future<Map<String, dynamic>> quote(String bookingId) async => {
    'subtotalCents': 10000,
    'discountCents': 0,
    'platformFeeCents': 0,
    'totalCents': 10000,
    'currency': 'usd',
    'paymentEnabled': enabled,
  };
  @override
  Future<Map<String, dynamic>> booking(String bookingId) async {
    bookingReads++;
    return {
      'paymentStatus': paymentStatus,
      'status': paymentStatus == 'PAID' ? 'CONFIRMED' : 'PENDING',
    };
  }

  @override
  Future<Map<String, dynamic>> create(String bookingId) async {
    creates++;
    return {
      'provider': provider,
      'mock': false,
      'checkoutUrl': checkoutUrl,
      'providerOrderId': 'order_test',
      'paymentRecordId': 'record_test',
      'paymentIntentId': null,
    };
  }
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  final booking = Booking.fromJson({
    'id': '42',
    'status': 'PENDING',
    'paymentStatus': 'UNPAID',
    'onlinePaymentEnabled': true,
    'orderOnly': false,
  });
  final shop = ShopDetail.fromJson({
    'id': '7',
    'name': 'Test shop',
    'latitude': 0,
    'longitude': 0,
    'onlinePaymentEnabled': true,
    'orderOnly': false,
  });

  Future<void> render(
    WidgetTester tester,
    FakePaymentApi api,
    List<Uri> launched,
  ) async {
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final apiSession = ApiService();
    final journal = BookingRescheduleJournal();
    await tester.runAsync(() => journal.prepare('41', booking.id));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiServiceProvider.overrideWithValue(apiSession),
          authProvider.overrideWith((ref) => PaymentCustomer(apiSession)),
          bookingRescheduleJournalProvider.overrideWithValue(journal),
          paymentCheckoutApiProvider.overrideWithValue(api),
          checkoutLauncherProvider.overrideWithValue((url) async {
            launched.add(url);
            return true;
          }),
        ],
        child: MaterialApp(
          home: PaymentScreen(booking: booking, shop: shop),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, String label) async {
    final finder = find.widgetWithText(FilledButton, label);
    await tester.ensureVisible(finder);
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  testWidgets('default disabled payments do not prepare or launch a checkout', (
    tester,
  ) async {
    final api = FakePaymentApi();
    final launched = <Uri>[];
    await render(tester, api, launched);
    expect(find.text('Payments are not configured.'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Online payment unavailable'),
          )
          .onPressed,
      isNull,
    );
    expect(api.creates, 0);
    expect(launched, isEmpty);
  });

  testWidgets('Stripe and mock providers have no enabled payment UI', (
    tester,
  ) async {
    final api = FakePaymentApi()
      ..enabled = true
      ..provider = 'stripe';
    final launched = <Uri>[];
    await render(tester, api, launched);
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Online payment unavailable'),
          )
          .onPressed,
      isNull,
    );
    expect(api.creates, 0);
    expect(launched, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    api.provider = 'local_mock';
    await render(tester, api, launched);
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Online payment unavailable'),
          )
          .onPressed,
      isNull,
    );
    expect(api.creates, 0);
    expect(launched, isEmpty);
  });

  testWidgets(
    'opening Square never marks paid; polling requires a server PAID status',
    (tester) async {
      final api = FakePaymentApi()..enabled = true;
      final launched = <Uri>[];
      await render(tester, api, launched);
      await tap(tester, 'Prepare Square checkout');
      expect(api.creates, 1);
      expect(launched, isEmpty);
      await tap(tester, 'Continue to Square');
      expect(launched.single.toString(), api.checkoutUrl);
      expect(find.text('UNPAID'), findsOneWidget);
      expect(find.text('Payment verified by the server.'), findsNothing);
      api.paymentStatus = 'PAID';
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
      expect(find.text('PAID'), findsOneWidget);
      expect(find.text('Payment verified by the server.'), findsOneWidget);
      expect(api.creates, 1);
      final reads = api.bookingReads;
      await tester.pump(const Duration(seconds: 8));
      expect(api.bookingReads, reads);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'an unsafe checkout response never exposes an open action or marks success',
    (tester) async {
      final api = FakePaymentApi()
        ..enabled = true
        ..checkoutUrl = 'http://square.link/u/test';
      final launched = <Uri>[];
      await render(tester, api, launched);
      await tap(tester, 'Prepare Square checkout');
      expect(
        find.textContaining('Unable to prepare secure checkout.'),
        findsOneWidget,
      );
      expect(find.text('Continue to Square'), findsNothing);
      expect(find.text('UNPAID'), findsOneWidget);
      expect(launched, isEmpty);
    },
  );
}
