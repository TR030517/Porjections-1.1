import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/app.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/banner_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/coupon_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/home_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'booking_receipt_intent_test.dart' as intent;
import 'customer_session_transient_test.dart' show TransientWire;
import 'widget_test.dart' show PublicShops;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final api = ApiService();
  testWidgets(
    'real app shell preserves the current booking route and unknown request while retry banner appears and disappears',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      clearBookingRecoveryMarker();
      final previous = api.dio.httpClientAdapter;
      final wire = TransientWire()..verified = true;
      api.dio.httpClientAdapter = wire;
      await tester.runAsync(api.logout);
      final auth = AuthNotifier(api);
      await tester.runAsync(
        () => auth.passwordLogin(wire.email, 'synthetic-password'),
      );
      final repo = intent.IntentRepository()..loseFirst = true;
      final container = ProviderContainer(
        overrides: [
          authProvider.overrideWith((ref) => auth),
          bookingRepositoryProvider.overrideWithValue(repo),
          shopRepositoryProvider.overrideWith((ref) => PublicShops()),
          bannersProvider.overrideWith((ref) async => []),
          myCouponsProvider.overrideWith((ref, status) async => []),
        ],
      );
      try {
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const MassajoyApp(),
          ),
        );
        await tester.pumpAndSettle();
        final shop = intent.intentShop();
        Navigator.of(tester.element(find.byType(HomeScreen))).push(
          MaterialPageRoute<void>(builder: (_) => BookingScreen(shop: shop)),
        );
        await tester.pumpAndSettle();
        final flow = container.read(bookingFlowProvider.notifier);
        await tester.runAsync(() => intent.selectStandard(flow, shop));
        flow.updateContact(name: 'Preserved visitor', phone: '+12065550123');
        await tester.pumpAndSettle();
        final primary = find.byKey(
          const ValueKey('booking-wizard-primary-action'),
        );
        for (var step = 0; step < 3; step++) {
          await tester.tap(primary);
          await tester.pumpAndSettle();
        }
        await tester.runAsync(flow.confirmBooking);
        await tester.pumpAndSettle();
        final routeState = tester.state(find.byType(BookingScreen)),
            quote = flow.state.priceQuote,
            attempt = flow.state.pendingAttempt,
            contact = flow.state.contact;
        expect(attempt, isNotNull);
        expect(repo.writes, hasLength(1));
        wire.profileOutcome = 503;
        await tester.runAsync(auth.checkSession);
        await tester.pumpAndSettle();
        expect(find.text('Retry verification'), findsOneWidget);
        expect(tester.state(find.byType(BookingScreen)), same(routeState));
        expect(flow.state.priceQuote, same(quote));
        expect(flow.state.pendingAttempt, same(attempt));
        expect(flow.state.contact, same(contact));
        wire.profileOutcome = 200;
        await tester.tap(find.text('Retry verification'));
        await tester.pumpAndSettle();
        expect(find.text('Retry verification'), findsNothing);
        expect(tester.state(find.byType(BookingScreen)), same(routeState));
        expect(flow.state.priceQuote, same(quote));
        expect(flow.state.pendingAttempt, same(attempt));
        expect(flow.state.pendingAttempt!.requestKey, attempt!.requestKey);
        expect(repo.writes, hasLength(1));
        expect(hasBookingRecoveryMarker(), isTrue);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        container.dispose();
        await tester.runAsync(api.logout);
        api.dio.httpClientAdapter = previous;
        clearBookingRecoveryMarker();
      }
    },
  );
}
