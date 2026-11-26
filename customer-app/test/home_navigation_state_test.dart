import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/banner_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/screens/home_screen.dart';
import 'package:mjapp_client/screens/profile_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/support_service.dart';
import 'package:mjapp_client/screens/support_screen.dart';
import 'booking_detail_boundary_test.dart' as boundary;
import 'widget_test.dart' show PublicShops;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('real home returns from profile history detail to bookings and keeps its query', (tester) async {
    tester.view.physicalSize = const Size(1200, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = ApiService(), oldAdapter = ApiService().dio.httpClientAdapter;
    final wire = boundary.DetailWire();
    api.dio.httpClientAdapter = wire;
    addTearDown(() => api.dio.httpClientAdapter = oldAdapter);
    await boundary.signInBoundary(tester, api);
    final auth = boundary.BoundaryCustomer();
    final booking = Booking.fromJson(boundary.bookingJson());
    final container = ProviderContainer(overrides: [
      authProvider.overrideWith((ref) => auth),
      shopRepositoryProvider.overrideWith((ref) => PublicShops()),
      bannersProvider.overrideWith((ref) async => []),
      favoriteShopsProvider.overrideWith((ref) async => []),
      bookingPageProvider.overrideWith((ref) async => BookingPage(
        items: [booking], total: 1, page: 1, pageSize: 25, totalPages: 1,
      )),
    ]);
    final router = GoRouter(initialLocation: '/?tab=1', routes: [
      GoRoute(path: '/', builder: (_, state) => HomeScreen(
        initialTab: int.tryParse(state.uri.queryParameters['tab'] ?? '') ?? 0,
      )),
    ]);
    addTearDown(router.dispose);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    ));
    await tester.pumpAndSettle();
    final originalHome = tester.state(find.byType(HomeScreen));
    container.read(bookingQueryProvider.notifier).state = const BookingListQuery(search: 'kept-query');
    await tester.tap(find.widgetWithText(TextButton, 'Profile'));
    await tester.pumpAndSettle();
    expect(find.byType(ProfileScreen), findsOneWidget);
    await tester.ensureVisible(find.text('Name and email'));
    expect(find.text('Name and email'), findsOneWidget);
    expect(find.text('Name, phone, email'), findsNothing);
    expect(router.routeInformationProvider.value.uri.toString(), '/?tab=3');
    await tester.ensureVisible(find.text('Booking History'));
    await tester.tap(find.text('Booking History'));
    await tester.pumpAndSettle();
    expect(container.read(bookingQueryProvider).view, 'HISTORY');
    expect(find.widgetWithText(ChoiceChip, 'Booking history'), findsOneWidget);
    await tester.ensureVisible(find.text('Booking details').last);
    await tester.tap(find.text('Booking details').last);
    await boundary.pumpUntil(tester,
      () => find.text('View my bookings').evaluate().isNotEmpty,
      'The real booking detail must load before returning.');
    expect(find.byType(BookingDetailScreen), findsOneWidget);
    await tester.ensureVisible(find.text('View my bookings'));
    await tester.tap(find.text('View my bookings'));
    await tester.pumpAndSettle();
    expect(find.byType(BookingDetailScreen), findsNothing);
    expect(find.byType(ProfileScreen), findsNothing);
    expect(find.text('Find a booking'), findsOneWidget);
    expect(router.routeInformationProvider.value.uri.toString(), '/?tab=1');
    expect(tester.state(find.byType(HomeScreen)), same(originalHome));
    expect(container.read(bookingQueryProvider).search, 'kept-query');
    expect(container.read(bookingQueryProvider).view, 'HISTORY');
    await tester.tap(find.widgetWithText(ChoiceChip, 'All bookings'));
    await tester.pumpAndSettle();
    expect(container.read(bookingQueryProvider).view, 'ALL');
    expect(container.read(bookingQueryProvider).search, 'kept-query');
    // A browser back/forward destination must also update the live home state.
    router.go('/?tab=3');
    await tester.pumpAndSettle();
    expect(find.byType(ProfileScreen), findsOneWidget);
    router.go('/?tab=1');
    await tester.pumpAndSettle();
    expect(find.byType(ProfileScreen), findsNothing);
    expect(find.text('Find a booking'), findsOneWidget);
    expect(container.read(bookingQueryProvider).search, 'kept-query');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });

  testWidgets('booking support remains reachable when platform contacts fail', (tester) async {
    tester.view.physicalSize = const Size(1200, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final container = ProviderContainer(overrides: [
      authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
      shopRepositoryProvider.overrideWith((ref) => PublicShops()),
      bannersProvider.overrideWith((ref) async => []),
      favoriteShopsProvider.overrideWith((ref) async => []),
      supportServiceProvider.overrideWithValue(_UnavailableSupport()),
      bookingPageProvider.overrideWith((ref) async => const BookingPage(
        items: [], total: 0, page: 1, pageSize: 25, totalPages: 0)),
    ]);
    final router = GoRouter(initialLocation: '/?tab=3', routes: [
      GoRoute(path: '/', builder: (_, state) => HomeScreen(
        initialTab: int.tryParse(state.uri.queryParameters['tab'] ?? '') ?? 0)),
    ]);
    addTearDown(router.dispose);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container: container,
      child: MaterialApp.router(locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales, routerConfig: router)));
    await tester.pumpAndSettle();
    container.read(bookingQueryProvider.notifier).state = const BookingListQuery(view: 'HISTORY', search: 'keep-support-context');
    await tester.ensureVisible(find.text('Contact support'));
    await tester.tap(find.text('Contact support'));
    await tester.pumpAndSettle();
    expect(find.byType(SupportScreen), findsOneWidget);
    expect(find.text('Support details are unavailable.'), findsOneWidget);
    await tester.tap(find.text('Help with a booking'));
    await tester.pumpAndSettle();
    expect(find.byType(SupportScreen), findsNothing);
    expect(find.text('Find a booking'), findsOneWidget);
    expect(router.routeInformationProvider.value.uri.toString(), '/?tab=1');
    expect(container.read(bookingQueryProvider).view, 'ALL');
    expect(container.read(bookingQueryProvider).search, 'keep-support-context');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
  for (final view in ['HISTORY', 'ALL']) {
    for (final entry in ['selected chip', 'profile shortcut']) {
      testWidgets(
        '$view $entry preserves applied filters and page; a different view resets only status and page',
        (tester) async {
          tester.view.physicalSize = const Size(1200, 1600);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final container = ProviderContainer(overrides: [
            authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
            shopRepositoryProvider.overrideWith((ref) => PublicShops()),
            bannersProvider.overrideWith((ref) async => []),
            favoriteShopsProvider.overrideWith((ref) async => []),
            bookingPageProvider.overrideWith((ref) async {
              final query = ref.watch(bookingQueryProvider);
              return BookingPage(
                items: [], total: 150, page: query.page,
                pageSize: query.pageSize, totalPages: 3,
              );
            }),
          ]);
          final router = GoRouter(initialLocation: '/?tab=1', routes: [
            GoRoute(path: '/', builder: (_, state) => HomeScreen(
              initialTab: int.tryParse(state.uri.queryParameters['tab'] ?? '') ?? 0,
            )),
          ]);
          addTearDown(router.dispose);
          addTearDown(container.dispose);
          await tester.pumpWidget(UncontrolledProviderScope(
            container: container,
            child: MaterialApp.router(
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              routerConfig: router,
            ),
          ));
          await tester.pumpAndSettle();
          final applied = BookingListQuery(
            view: view, page: 3, pageSize: 50, status: 'COMPLETED',
            paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE',
            search: 'Wellness Moon Spa',
            startDate: '2031-05-01', endDate: '2031-05-31',
          );
          container.read(bookingQueryProvider.notifier).state = applied;
          await tester.pumpAndSettle();

          Future<void> selectView(String target) async {
            if (entry == 'selected chip') {
              await tester.tap(find.widgetWithText(
                ChoiceChip, target == 'HISTORY' ? 'Booking history' : 'All bookings',
              ));
            } else {
              await tester.tap(find.widgetWithText(TextButton, 'Profile'));
              await tester.pumpAndSettle();
              final shortcut = find.text(target == 'HISTORY' ? 'Booking History' : 'My bookings');
              await tester.ensureVisible(shortcut);
              await tester.tap(shortcut);
            }
            await tester.pumpAndSettle();
          }

          await selectView(view);
          expect(container.read(bookingQueryProvider).toJson(), applied.toJson());
          expect(find.text('150 bookings · page 3/3'), findsOneWidget);
          expect(router.routeInformationProvider.value.uri.toString(), '/?tab=1');

          final differentView = view == 'HISTORY' ? 'ALL' : 'HISTORY';
          await selectView(differentView);
          expect(container.read(bookingQueryProvider).toJson(), {
            if (differentView != 'ALL') 'view': differentView,
            'page': 1, 'pageSize': 50,
            'paymentStatus': 'UNPAID', 'paymentMode': 'PAY_AT_STORE',
            'search': 'Wellness Moon Spa',
            'startDate': '2031-05-01', 'endDate': '2031-05-31',
          });
          expect(find.text('150 bookings · page 1/3'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pumpAndSettle();
        },
      );
    }
  }
}

class _UnavailableSupport extends SupportService {
  _UnavailableSupport() : super(ApiService().dio);
  @override
  Future<PublicSupport> load() async => throw StateError('offline contacts');
}
