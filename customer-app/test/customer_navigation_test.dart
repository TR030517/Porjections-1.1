import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mjapp_client/navigation/customer_navigation.dart';

void main() {
  testWidgets(
    'View my bookings dismisses a native detail when the URI is already the bookings tab',
    (tester) async {
      final router = _router(initialLocation: '/?tab=1');
      addTearDown(router.dispose);
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open booking detail'));
      await tester.pumpAndSettle();
      expect(find.text('Booking detail'), findsOneWidget);

      await tester.tap(find.text('View my bookings'));
      await tester.pumpAndSettle();

      expect(find.text('Booking detail'), findsNothing);
      expect(find.text('Booking list'), findsOneWidget);
      expect(router.routeInformationProvider.value.uri.toString(), '/?tab=1');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'View my bookings dismisses native layers and changes a shop URI to the bookings tab',
    (tester) async {
      final router = _router(initialLocation: '/s/seattle-wellness');
      addTearDown(router.dispose);
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open booking detail'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open another detail'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('View my bookings'));
      await tester.pumpAndSettle();

      expect(find.text('Booking detail'), findsNothing);
      expect(find.text('Booking list'), findsOneWidget);
      expect(router.routeInformationProvider.value.uri.toString(), '/?tab=1');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

GoRouter _router({required String initialLocation}) => GoRouter(
  initialLocation: initialLocation,
  overridePlatformDefaultLocation: true,
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => _list(context, 'Booking list'),
    ),
    GoRoute(
      path: '/s/:shortName',
      builder: (context, state) => _list(context, 'Shop page'),
    ),
  ],
);

Widget _list(BuildContext context, String title) => Scaffold(
  body: Column(
    children: [
      Text(title),
      TextButton(
        onPressed: () => _pushDetail(context),
        child: const Text('Open booking detail'),
      ),
    ],
  ),
);

void _pushDetail(BuildContext context) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (context) => Scaffold(
        body: Column(
          children: [
            const Text('Booking detail'),
            TextButton(
              onPressed: () => _pushDetail(context),
              child: const Text('Open another detail'),
            ),
            TextButton(
              onPressed: () => openCustomerHome(context, initialTab: 1),
              child: const Text('View my bookings'),
            ),
          ],
        ),
      ),
    ),
  );
}
