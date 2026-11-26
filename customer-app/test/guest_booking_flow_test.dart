import 'booking_quote_fixture.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/screens/shop_link_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

ShopDetail publicShop() => ShopDetail.fromJson({
  'id': '7',
  'name': 'Synthetic public studio',
  'latitude': 0,
  'longitude': 0,
  'timezone': 'America/New_York',
  'paymentPolicy': {'payAtStoreEnabled': true},
  'services': [
    {
      'id': '8',
      'name': 'Public fixed service',
      'durationMin': 60,
      'priceCents': 6011,
    },
  ],
});

Map<String, dynamic> createdBooking() => {
  'id': '42',
  'shopId': '7',
  'serviceId': '8',
  'bookingNo': 'SYNTHETIC',
  'paymentMode': 'PAY_AT_STORE',
  'status': 'PENDING',
  'paymentStatus': 'UNPAID',
  'currency': 'usd',
  'priceCents': 6011,
  'totalCents': 6011,
  'paidCents': 0,
  'refundedCents': 0,
  'amountDueCents': 6011,
  'localDate': '2031-05-01',
  'localStartTime': '10:00',
  'localEndTime': '11:00',
  'timezone': 'America/New_York',
  'shop': {'id': '7', 'name': 'Synthetic public studio'},
};

class GuestAuth extends AuthNotifier {
  GuestAuth() : super(ApiService());
  void customer(String? id) => state = id == null
      ? const AuthState()
      : AuthState(
          isLoggedIn: true,
          user: User(id: id, role: 'CUSTOMER', name: 'Signed-in test customer', phone: '+12065550123', email: 'guest-customer@example.invalid', emailVerified: true),
        );
  @override
  Future<void> passwordLogin(String email, String password) async =>
      customer('41');
}

class GuestShops extends ShopRepository {
  GuestShops() : super(ApiService());
  @override
  Future<ShopDetail> getShopDetail(String shopId) async => publicShop();
  @override
  Future<ShopDetail> resolveShop({String? shortName, String? legacyId}) async {
    throw DioException(
      requestOptions: RequestOptions(path: '/shops/resolve'),
      response: Response(
        requestOptions: RequestOptions(path: '/shops/resolve'),
        statusCode: 404,
      ),
      type: DioExceptionType.badResponse,
    );
  }
}

class GuestBookings extends BookingRepository {
  GuestBookings() : super(ApiService());
  int creates = 0;
  String? submittedDate;
  String? submittedTime;
  @override
  Future<SlotResponse> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) async => SlotResponse(
    date: date,
    slots: [TimeSlot(time: '10:00', available: true)],
  );
  BookingPriceQuote? accepted;
  @override
  Future<BookingPriceQuote> quote(Map<String,dynamic> request)async=>accepted=BookingPriceQuote.fromJson(timedQuoteJson(request,price:6011));
  @override
  Future<Booking> createBookingWithAddOns(Map<String,dynamic> request)async{
    creates++;submittedDate=request['date'] as String;submittedTime=request['startTime'] as String;
    return quotedBookingFixture(request,accepted!,extra:createdBooking());
  }

}

class GuestTransport implements HttpClientAdapter {
  final calls = <RequestOptions>[];
  bool rejectSlots = false;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    await requestStream?.drain<void>();
    calls.add(options);
    final Object body;
    var status = 200;
    switch (options.path) {
      case '/auth/customer/config':
        body = {
          'passwordEnabled': true,
          'passwordRegistrationEnabled': false,
          'emailOtp': {'enabled': false},
          'google': {'enabled': false},
          'apple': {'enabled': false},
        };
      case '/auth/customer/password/login':
        body = {
          'accessToken': 'synthetic-access',
          'user': {'id': '41', 'role': 'CUSTOMER'},
        };
      case '/auth/customer/logout':
        body = {'ok': true};
      case '/bookings/slots':
      case '/bookings/plan-slots':
        status = rejectSlots ? 401 : 200;
        body = rejectSlots
            ? {'message': 'Synthetic rejection'}
            : {'date': '2031-05-01', 'slots': []};
      case '/bookings/42':
        body = createdBooking();
      default:
        throw StateError('Unexpected synthetic transport route');
    }
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Widget localized(Widget child) => MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late GuestTransport transport;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    transport = GuestTransport();
    ApiService().dio.httpClientAdapter = transport;
    await ApiService().logout();
    transport.calls.clear();
  });

  test(
    'availability stays anonymous even with a session; public 401 never refreshes or expires it',
    () async {
      final api = ApiService();
      await api.passwordLogin(
        'synthetic@example.invalid',
        'synthetic-password',
      );
      transport.calls.clear();
      var expired = 0;
      final subscription = api.sessionExpired.listen((_) => expired++);
      addTearDown(subscription.cancel);
      transport.rejectSlots = true;
      await expectLater(
        api.getSlots(shopId: '7', serviceId: '8', date: '2031-05-01'),
        throwsA(isA<DioException>()),
      );
      await expectLater(
        api.getBookingPlanSlots({
          'shopId': '7',
          'date': '2031-05-01',
          'items': [],
        }),
        throwsA(isA<DioException>()),
      );
      expect(transport.calls.map((call) => call.path), [
        '/bookings/slots',
        '/bookings/plan-slots',
      ]);
      for (final request in transport.calls) {
        expect(request.extra['publicRead'], isTrue);
        expect(request.headers.containsKey('Authorization'), isFalse);
      }
      await api.dio.get('/bookings/42');
      expect(
        transport.calls.last.headers['Authorization'],
        'Bearer synthetic-access',
      );
      expect(expired, 0);
    },
  );

  test(
    'guest sign-in preserves both drafts but switching or leaving a customer clears them',
    () async {
      final auth = GuestAuth();
      final container = ProviderContainer(
        overrides: [authProvider.overrideWith((ref) => auth)],
      );
      addTearDown(container.dispose);
      final shop = publicShop();
      final planProvider = bookingPlanProvider(shop);
      final listener = container.listen(planProvider, (_, _) {});
      addTearDown(listener.close);
      final single = container.read(bookingFlowProvider.notifier);
      single.initFlow(shop);
      single.selectService(shop.services.single);
      final plan = container.read(planProvider.notifier);
      plan.selectService(0, 0, '8');
      plan.setNotes('Synthetic private note');
      auth.customer('41');
      expect(
        identical(container.read(bookingFlowProvider.notifier), single),
        isTrue,
      );
      expect(container.read(bookingFlowProvider).selectedService?.id, '8');
      expect(identical(container.read(planProvider.notifier), plan), isTrue);
      expect(
        container.read(planProvider).participants.single.single.serviceId,
        '8',
      );
      auth.customer('43');
      expect(container.read(bookingFlowProvider).shop, isNull);
      expect(
        container.read(planProvider).participants.single.single.serviceId,
        isNull,
      );
      expect(container.read(planProvider).notes, isEmpty);
      single.initFlow(shop);
      single.selectService(shop.services.single);
      auth.customer(null);
      expect(container.read(bookingFlowProvider).shop, isNull);
    },
  );

  testWidgets(
    'guest can enter a service wizard without any sign-in or order request',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => GuestAuth()),
            shopRepositoryProvider.overrideWith((ref) => GuestShops()),
            shopReviewsProvider('7').overrideWith((ref) async => []),
          ],
          child: localized(const ShopDetailScreen(shopId: '7', shopName: '')),
        ),
      );
      await tester.pumpAndSettle();
      final serviceCard = find.descendant(
        of: find.byKey(const ValueKey('booking-choice:8:base')),
        matching: find.byType(ShopServiceSelectionCard),
      );
      expect(tester.widget<ShopServiceSelectionCard>(serviceCard).onSelected, isNotNull);
      await tester.ensureVisible(serviceCard);
      await tester.tap(serviceCard);
      await tester.pumpAndSettle();
      expect(find.byType(BookingScreen), findsOneWidget);
      expect(tester.widget<BookingScreen>(find.byType(BookingScreen)).initialService?.id, '8');
      expect(find.byType(LoginScreen), findsNothing);
      expect(
        transport.calls.where((call) => call.path == '/bookings'),
        isEmpty,
      );
    },
  );

  testWidgets(
    'review requires sign-in; cancelling keeps the draft and successful return submits it once',
    (tester) async {
      final auth = GuestAuth();
      final bookings = GuestBookings();
      final container = ProviderContainer(
        overrides: [
          authProvider.overrideWith((ref) => auth),
          bookingRepositoryProvider.overrideWith((ref) => bookings),
        ],
      );
      try {
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: localized(BookingScreen(shop: publicShop())),
        ),
      );
      await tester.pumpAndSettle();
      final flow = container.read(bookingFlowProvider.notifier);
      flow.selectService(
        container.read(bookingFlowProvider).shop!.services.single,
      );
      flow.selectDate(DateTime(2031, 5, 1));
      await tester.pumpAndSettle();
      flow.toggleTimeSlot('10:00');
      flow.selectPaymentMode('PAY_AT_STORE');
      await tester.pumpAndSettle();
      for (var step = 0; step < 3; step++) {
        await tester.tap(find.byType(FilledButton).last);
        await tester.pumpAndSettle();
      }
      final signInToReview = find.widgetWithText(OutlinedButton, 'Sign in to review total');
      expect(find.widgetWithText(FilledButton, 'Sign in to review total'), findsOneWidget);
      expect(find.text('Order total pending review. A current total is required before you can submit.'), findsOneWidget);
      expect(find.text('Contact & confirm'), findsOneWidget);
      await tester.ensureVisible(signInToReview);
      await tester.tap(signInToReview);
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(bookings.creates, 0);
      await tester.tap(find.byTooltip('Back').last);
      await tester.pumpAndSettle();
      expect(container.read(bookingFlowProvider).selectedStartTime, '10:00');
      expect(bookings.creates, 0);
      await tester.tap(signInToReview);
      await tester.pumpAndSettle();
      // Complete the actual sign-in route so its verified customer/generation
      // receipt reaches requireCustomerSignIn. A bare pop(true) is not proof.
      final loginFields = find.descendant(
        of: find.byType(LoginScreen),
        matching: find.byType(TextFormField),
      );
      await tester.enterText(loginFields.at(0), 'guest-customer@example.invalid');
      await tester.enterText(loginFields.at(1), 'synthetic-password');
      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await tester.pumpAndSettle();
      expect(bookings.creates,0);expect(container.read(bookingFlowProvider).hasValidPriceQuote,isTrue);
      await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();
      expect(find.byType(BookingDetailScreen), findsOneWidget);
      expect(bookings.creates, 1);
      expect(bookings.submittedDate, '2031-05-01');
      expect(bookings.submittedTime, '10:00');
      expect(container.read(bookingFlowProvider).paymentMode, 'PAY_AT_STORE');
      } finally {
        try { await tester.pumpWidget(const SizedBox.shrink()); }
        finally { container.dispose(); }
      }
    },
  );

  testWidgets(
    'unavailable short link shows a public error without substituting another shop',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            shopRepositoryProvider.overrideWith((ref) => GuestShops()),
          ],
          child: localized(ShopLinkScreen(uri: Uri.parse('/s/missing-studio'))),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Shop unavailable'), findsOneWidget);
      expect(find.byType(ShopDetailScreen), findsNothing);
      expect(find.byType(LoginScreen), findsNothing);
      expect(find.text('Browse public shops'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
