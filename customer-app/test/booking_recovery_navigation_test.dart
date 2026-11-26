import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/banner_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/screens/home_screen.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_quote_fixture.dart';
import 'booking_detail_boundary_test.dart' show pumpUntil;
import 'booking_special_wizard_test.dart' as wizard;
import 'guest_booking_flow_test.dart' show GuestAuth;
import 'widget_test.dart' show PublicShops;

const recoveryLink = 'Previous submission unclear? Check my bookings';

Map<String, dynamic> recoveredBookingJson({String customer = '41'}) => {
  'id': '42', 'bookingNo': 'RECOVERY-SAVED', 'shopId': '7', 'userId': customer,
  'serviceId': '9', 'durationMin': 90, 'priceCents': 21000, 'totalCents': 21000,
  'status': 'PENDING', 'paymentStatus': 'UNPAID', 'paymentMode': 'PAY_AT_STORE',
  'currency': 'usd', 'shop': {'id': '7', 'name': 'Recovered Pacific appointment'},
  'localDate': '2031-05-04', 'localStartTime': '10:00', 'localEndTime': '11:30',
  'timezone': 'America/Los_Angeles',
};

ShopDetail planShop() => ShopDetail.fromJson({
  'id': '7', 'name': 'Pacific combined visit', 'latitude': 0, 'longitude': 0,
  'timezone': 'America/Los_Angeles', 'bookingCalendar': wizard.shopCalendar(),
  'orderOnly': true, 'onlinePaymentEnabled': false,
  'services': [{
    'id': '8', 'name': 'Individual relaxation massage',
    'durationMin': 60, 'priceCents': 12000, 'priceBasis': 'PER_BOOKING',
    'participantCount': 1, 'requiredStaffCount': 1,
    'variants': [{
      'id': '82', 'name': '90-minute visit', 'durationMin': 90,
      'priceCents': 18000, 'priceBasis': 'PER_BOOKING', 'isActive': true,
    }],
  }],
});

class NavigationPlanRepository extends BookingPlanRepository {
  NavigationPlanRepository() : super(ApiService());
  final reads = <Map<String, dynamic>>[];
  final quotes = <Map<String, dynamic>>[];
  int writes = 0;

  @override
  Future<BookingPlanQuote> slots(Map<String, dynamic> request) async {
    reads.add(Map.of(request));
    return BookingPlanQuote.fromJson({
      'date': request['date'], 'timezone': 'America/Los_Angeles',
      'bookingCalendar': wizard.shopCalendar(), 'durationMin': 90,
      'participantCount': 1, 'priceCents': 18000,
      'items': [{
        'participantIndex': 1, 'sequence': 1, 'serviceId': '8',
        'serviceName': 'Individual relaxation massage', 'variantId': '82',
        'variantName': '90-minute visit', 'durationMin': 90, 'offsetMin': 0,
        'preparationMin': 0, 'priceCents': 18000, 'currency': 'usd',
      }],
      'slots': [{'time': '10:00', 'available': true}],
    });
  }

  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> request) async {
    quotes.add(Map.of(request));
    return BookingPriceQuote.fromJson(timedQuoteJson(request, price: 18000, minutes: 90));
  }

  @override
  Future<Booking> create(Map<String, dynamic> request) async {
    writes++;
    throw StateError('Opening booking history must never submit a plan');
  }
}

mixin RecoveryPageFixture on BookingRepository {
  final pageReads = <Map<String, dynamic>>[];
  final pageCancels = <CancelToken?>[];
  bool committed = false;

  @override
  Future<BookingPage> getUserBookingPage(BookingListQuery query, {CancelToken? cancelToken}) async {
    final filters = query.toJson();
    pageReads.add(Map.of(filters));
    pageCancels.add(cancelToken);
    final visible = committed && query.view == 'ALL' && query.status.isEmpty &&
        query.search.isEmpty && query.startDate.isEmpty && query.endDate.isEmpty &&
        query.paymentStatus.isEmpty && query.paymentMode.isEmpty && query.page == 1;
    return BookingPage(items: visible ? [Booking.fromJson(recoveredBookingJson())] : [], total: visible ? 1 : 75, page: query.page,
      pageSize: query.pageSize, totalPages: visible ? 1 : 3);
  }
}

class RecoverySpecialRepository extends wizard.SpecialAvailability with RecoveryPageFixture {
  RecoverySpecialRepository() : super(1);
  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> selection) {
    committed = true;
    return super.createBookingWithAddOns(selection);
  }
}

class RecoveryPages extends BookingRepository with RecoveryPageFixture {
  RecoveryPages() : super(ApiService());
}

class RecoveryPlanRepository extends NavigationPlanRepository {
  final RecoveryPages pages;
  RecoveryPlanRepository(this.pages);
  @override
  Future<Booking> create(Map<String, dynamic> request) {
    pages.committed = true;
    return super.create(request);
  }
}

class SuccessSpecialRepository extends RecoverySpecialRepository {
  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> selection) async {
    writes++;
    committed = true;
    return quotedBookingFixture(selection, BookingPriceQuote.fromJson(
      timedQuoteJson(selection, price: 21000, minutes: 90)),
      extra: {'userId': '41'}, requiredStaffCount: 2);
  }
}

class SuccessPlanRepository extends NavigationPlanRepository {
  final RecoveryPages pages;
  SuccessPlanRepository(this.pages);
  @override
  Future<Booking> create(Map<String, dynamic> selection) async {
    writes++;
    pages.committed = true;
    return quotedBookingFixture(selection, BookingPriceQuote.fromJson(
      timedQuoteJson(selection, price: 18000, minutes: 90)),
      extra: {'userId': '41'});
  }
}

class RecoveryDetailWire implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async =>
      ResponseBody.fromString(jsonEncode(options.path == '/bookings/42' ? recoveredBookingJson() : {'message': 'Synthetic email unavailable'}),
        options.path == '/bookings/42' ? 200 : 503,
        headers: {Headers.contentTypeHeader: ['application/json']});
  @override
  void close({bool force = false}) {}
}

class LateRecoveryPages extends BookingRepository {
  LateRecoveryPages() : super(ApiService());
  final pending = <Completer<BookingPage>>[];
  final cancels = <CancelToken?>[];
  @override
  Future<BookingPage> getUserBookingPage(BookingListQuery query, {CancelToken? cancelToken}) {
    cancels.add(cancelToken);
    final read = Completer<BookingPage>();
    pending.add(read);
    return read.future;
  }
}

Future<void> prepareQuotedFlow(WidgetTester tester, ProviderContainer container, ShopDetail shop, bool plan) async {
  if (plan) {
    final flow = container.read(bookingPlanProvider(shop).notifier);
    flow.selectService(0, 0, '8');
    flow.selectVariant(0, 0, '82');
    flow.selectDate('2031-05-04');
    await tester.pumpAndSettle();
    flow.selectTime('10:00');
    flow.setNotes('Do not lose this uncertain request');
    for (var step = 0; step < 3; step++) {
      await wizard.click(tester, find.byKey(const ValueKey('booking-plan-primary-action')));
    }
    await wizard.click(tester, find.widgetWithText(OutlinedButton, 'Review current total'));
  } else {
    await wizard.openSummary(tester, shop);
    await wizard.click(tester, find.byKey(const ValueKey('booking-wizard-primary-action')));
  }
}

Future<void> openHistoryAndReturn(WidgetTester tester) async {
  await wizard.click(tester, find.text(recoveryLink));
  expect(find.byType(BookingHistoryScreen), findsOneWidget);
  expect(find.text('My bookings'), findsOneWidget);
  expect(find.text('Find a booking'), findsOneWidget);
  expect(find.ancestor(of: find.byType(BookingListScreen), matching: find.byType(Scaffold)), findsOneWidget);
  expect(tester.takeException(), isNull);
  // This renders ExpansionTile's filter controls inside the new page's
  // Material, covering the missing ancestor that caused the release grey page.
  await wizard.click(tester, find.text('Find a booking'));
  expect(find.text('Booking status'), findsOneWidget);
  expect(find.text('Payment status'), findsOneWidget);
  expect(tester.takeException(), isNull);
  await wizard.click(tester, find.byTooltip('Back'));
  expect(find.byType(BookingHistoryScreen), findsNothing);
  expect(find.text(recoveryLink), findsOneWidget);
  expect(tester.takeException(), isNull);
}

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  testWidgets('recovery filters, reset, view changes and pagination keep the shop scope local', (tester) async {
    wizard.viewport(tester, 1200);
    final pages = RecoveryPages()..committed = true;
    final container = ProviderContainer(overrides: [
      authProvider.overrideWith((ref) => GuestAuth()..customer('41')),
      bookingRepositoryProvider.overrideWithValue(pages),
    ]);
    const original = BookingListQuery(view: 'HISTORY', page: 3, search: 'original');
    container.read(bookingQueryProvider.notifier).state = original;
    await tester.pumpWidget(UncontrolledProviderScope(container: container,
      child: wizard.app(const BookingHistoryScreen(recoveryShopId: '7'))));
    await tester.pumpAndSettle();
    await wizard.click(tester, find.widgetWithText(ChoiceChip, 'Booking history'));
    await wizard.click(tester, find.byTooltip('Next page'));
    expect(pages.pageReads.last, {'page': 2, 'pageSize': 25, 'shopId': '7', 'view': 'HISTORY'});
    await wizard.click(tester, find.widgetWithText(ChoiceChip, 'All bookings'));
    await wizard.click(tester, find.text('Find a booking'));
    await tester.enterText(find.widgetWithText(TextFormField, 'Booking number, service, or shop'), 'another service');
    final searchAction = find.widgetWithText(FilledButton, 'Search');
    await Scrollable.ensureVisible(tester.element(searchAction), alignment: 0.5);
    await tester.pumpAndSettle();
    await tester.tap(searchAction);
    await tester.pumpAndSettle();
    expect(pages.pageReads.last, {'page': 1, 'pageSize': 25, 'shopId': '7', 'search': 'another service'});
    await wizard.click(tester, find.widgetWithText(TextButton, 'Reset'));
    expect(pages.pageReads.last, {'page': 1, 'pageSize': 25, 'shopId': '7'});
    expect(container.read(bookingQueryProvider), same(original));
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('recovery scope cancels an old-account read and never displays its late result', (tester) async {
    wizard.viewport(tester, 375);
    final pages = LateRecoveryPages(), auth = GuestAuth()..customer('41');
    final container = ProviderContainer(overrides: [
      authProvider.overrideWith((ref) => auth),
      bookingRepositoryProvider.overrideWithValue(pages),
    ]);
    await tester.pumpWidget(UncontrolledProviderScope(container: container,
      child: wizard.app(const BookingHistoryScreen(recoveryShopId: '7'))));
    await tester.pump();
    expect(pages.pending, hasLength(1));
    auth.customer('43');
    await tester.pump();
    expect(pages.pending, hasLength(2));
    expect(pages.cancels.first?.isCancelled, isTrue);
    pages.pending.last.complete(BookingPage(items: [Booking.fromJson({
      ...recoveredBookingJson(customer: '43'),
      'shop': {'id': '7', 'name': 'Current customer appointment'},
    })], total: 1, page: 1, pageSize: 25, totalPages: 1));
    await tester.pumpAndSettle();
    expect(find.text('Current customer appointment'), findsOneWidget);
    pages.pending.first.complete(BookingPage(items: [Booking.fromJson(recoveredBookingJson())], total: 1, page: 1, pageSize: 25, totalPages: 1));
    await tester.pumpAndSettle();
    expect(find.text('Recovered Pacific appointment'), findsNothing);
    expect(find.text('Current customer appointment'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  for (final plan in [false, true]) {
    testWidgets('${plan ? 'PLAN' : 'ordinary'} unknown submission checks a fresh shop list without inherited history or changing its draft', (tester) async {
      wizard.viewport(tester, 375);
      final shop = plan ? planShop() : wizard.specialShop(guests: 1);
      final ordinary = RecoverySpecialRepository();
      final pages = RecoveryPages();
      final planRepo = RecoveryPlanRepository(pages);
      final RecoveryPageFixture pageRepo = plan ? pages : ordinary;
      final auth = GuestAuth()..customer('41');
      final container = ProviderContainer(overrides: [
        authProvider.overrideWith((ref) => auth),
        bookingRepositoryProvider.overrideWithValue(plan ? pages : ordinary),
        bookingPlanRepositoryProvider.overrideWithValue(planRepo),
      ]);
      const original = BookingListQuery(view: 'HISTORY', page: 3, pageSize: 50,
        status: 'COMPLETED', paymentStatus: 'PAID', paymentMode: 'ONLINE',
        search: 'Another shop', startDate: '2030-01-01', endDate: '2030-01-31');
      container.read(bookingQueryProvider.notifier).state = original;
      final cached = await container.read(bookingPageProvider.future);
      expect(pageRepo.pageReads, hasLength(1));
      await tester.pumpWidget(UncontrolledProviderScope(container: container,
        child: wizard.app(plan ? BookingPlanScreen(shop: shop) : BookingScreen(shop: shop))));
      await tester.pumpAndSettle();
      await prepareQuotedFlow(tester, container, shop, plan);
      await wizard.click(tester, find.byKey(ValueKey(plan ? 'booking-plan-primary-action' : 'booking-wizard-primary-action')));
      final pending = plan ? container.read(bookingPlanProvider(shop)).pendingAttempt
          : container.read(bookingFlowProvider).pendingAttempt;
      expect(pending, isNotNull);
      expect(pageRepo.committed, isTrue);
      for (var visit = 0; visit < 2; visit++) {
        await wizard.click(tester, find.widgetWithText(OutlinedButton, 'Check my bookings'));
        expect(pageRepo.pageReads, hasLength(2 + visit), reason: 'Every recovery entry must perform a new read, even with a cached center page.');
        expect(pageRepo.pageReads.last, {'page': 1, 'pageSize': 25, 'shopId': '7'});
        expect(find.text('Recovered Pacific appointment'), findsOneWidget);
        expect(container.read(bookingQueryProvider), same(original));
        expect(await container.read(bookingPageProvider.future), same(cached));
        await wizard.click(tester, find.byTooltip('Back'));
        expect(pageRepo.pageCancels.last?.isCancelled, isTrue);
        expect(plan ? container.read(bookingPlanProvider(shop)).pendingAttempt
            : container.read(bookingFlowProvider).pendingAttempt, same(pending));
        expect(find.text('Stop recovery after checking'), findsOneWidget);
      }
      expect(plan ? planRepo.writes : ordinary.writes, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    });

    testWidgets('${plan ? 'PLAN' : 'ordinary'} successful creation refreshes the center on the real detail-return path without changing filters', (tester) async {
      wizard.viewport(tester, 375);
      final api = ApiService(), previousAdapter = ApiService().dio.httpClientAdapter;
      api.dio.httpClientAdapter = RecoveryDetailWire();
      addTearDown(() => api.dio.httpClientAdapter = previousAdapter);
      final shop = plan ? planShop() : wizard.specialShop(guests: 1);
      final ordinary = SuccessSpecialRepository(), pages = RecoveryPages();
      final planRepo = SuccessPlanRepository(pages);
      final RecoveryPageFixture pageRepo = plan ? pages : ordinary;
      final container = ProviderContainer(overrides: [
        authProvider.overrideWith((ref) => GuestAuth()..customer('41')),
        bookingRepositoryProvider.overrideWithValue(plan ? pages : ordinary),
        bookingPlanRepositoryProvider.overrideWithValue(planRepo),
        shopRepositoryProvider.overrideWith((ref) => PublicShops()),
        bannersProvider.overrideWith((ref) async => []),
        favoriteShopsProvider.overrideWith((ref) async => []),
      ]);
      const original = BookingListQuery(view: 'HISTORY', page: 3, search: 'kept-center-context');
      container.read(bookingQueryProvider.notifier).state = original;
      final cached = await container.read(bookingPageProvider.future);
      await tester.pumpWidget(UncontrolledProviderScope(container: container,
        child: wizard.app(plan ? BookingPlanScreen(shop: shop) : BookingScreen(shop: shop))));
      await tester.pumpAndSettle();
      await prepareQuotedFlow(tester, container, shop, plan);
      await wizard.click(tester, find.byKey(ValueKey(plan ? 'booking-plan-primary-action' : 'booking-wizard-primary-action')));
      if (plan) await wizard.click(tester, find.widgetWithText(FilledButton, 'View booking'));
      expect(find.byType(BookingDetailScreen), findsOneWidget);
      await pumpUntil(tester, () => find.text('Recovered Pacific appointment').evaluate().isNotEmpty,
        'The saved booking detail must load before returning to the center.');
      await tester.scrollUntilVisible(find.text('View my bookings'), 200,
        scrollable: find.descendant(of: find.byType(BookingDetailScreen), matching: find.byType(Scrollable)).first);
      await wizard.click(tester, find.text('View my bookings'));
      expect(find.byType(HomeScreen), findsOneWidget);
      expect(find.byType(BookingDetailScreen), findsNothing);
      expect(container.read(bookingQueryProvider), same(original));
      expect(await container.read(bookingPageProvider.future), isNot(same(cached)));
      expect(pageRepo.pageReads, hasLength(2));
      expect(pageRepo.pageReads.last, original.toJson());
      expect(plan ? planRepo.writes : ordinary.writes, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
    });
  }

  testWidgets('four-hands quoted wizard opens a complete history page and returns to the exact draft without creating an order', (tester) async {
    wizard.viewport(tester, 375);
    final shop = wizard.specialShop(guests: 1);
    final repo = RecoverySpecialRepository();
    final auth = GuestAuth()..customer('41');
    final container = ProviderContainer(overrides: [
      authProvider.overrideWith((ref) => auth),
      bookingRepositoryProvider.overrideWithValue(repo),
    ]);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container, child: wizard.app(BookingScreen(shop: shop)),
    ));
    await tester.pumpAndSettle();
    await wizard.openSummary(tester, shop);
    await wizard.click(tester, find.byKey(const ValueKey('booking-wizard-primary-action')));
    final before = container.read(bookingFlowProvider);
    expect(before.selectedService?.requiredStaffCount, 2);
    expect(before.selectedService?.participantCount, 1);
    expect(before.selectedVariant?.id, '92');
    expect(before.selectedDuration, 90);
    expect(before.selectedStartTime, '10:00');
    expect(before.priceQuote?.totalCents, 21000);
    expect(before.canConfirm, isTrue);
    expect(repo.quotes, hasLength(1));
    await openHistoryAndReturn(tester);
    final after = container.read(bookingFlowProvider);
    expect(after, same(before));
    expect(after.priceQuote, same(before.priceQuote));
    expect(after.selectedVariant, same(before.selectedVariant));
    expect(find.textContaining('Submit booking request'), findsOneWidget);
    expect(repo.pageReads, hasLength(1));
    expect(repo.quotes, hasLength(1));
    expect(repo.writes, 0);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });

  testWidgets('PLAN sign-in and recovery return to the same selected specification without creating an order', (tester) async {
    wizard.viewport(tester, 375);
    final shop = planShop(), repo = NavigationPlanRepository();
    final pages = RecoveryPages();
    final auth = GuestAuth();
    final container = ProviderContainer(overrides: [
      authProvider.overrideWith((ref) => auth),
      bookingPlanRepositoryProvider.overrideWithValue(repo),
      bookingRepositoryProvider.overrideWithValue(pages),
    ]);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container, child: wizard.app(BookingPlanScreen(shop: shop)),
    ));
    await tester.pumpAndSettle();
    final flow = container.read(bookingPlanProvider(shop).notifier);
    flow.selectService(0, 0, '8');
    flow.selectVariant(0, 0, '82');
    flow.selectDate('2031-05-04');
    await tester.pumpAndSettle();
    flow.selectTime('10:00');
    flow.setNotes('Retain my unsubmitted visit');
    await tester.pumpAndSettle();
    for (var step = 0; step < 3; step++) {
      await wizard.click(tester, find.byType(FilledButton).last);
    }
    expect(find.text('Estimated service price'), findsOneWidget);
    expect(find.text('Order total pending review. A current total is required before you can submit.'), findsOneWidget);
    expect(find.text('Contact & confirm'), findsNothing);
    final guestReview = find.widgetWithText(FilledButton, 'Sign in to review total');
    expect(find.widgetWithText(OutlinedButton, 'Sign in to review total'), findsOneWidget);
    await wizard.click(tester, guestReview);
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(repo.quotes, isEmpty);
    await wizard.click(tester, find.byType(BackButton).last);
    expect(flow.state.startTime, '10:00');
    expect(repo.quotes, isEmpty);
    await wizard.click(tester, guestReview);
    await tester.enterText(find.byType(TextFormField).at(0), 'guest-customer@example.invalid');
    await tester.enterText(find.byType(TextFormField).at(1), 'synthetic-password');
    await wizard.click(tester, find.widgetWithText(FilledButton, 'Sign in'));
    expect(find.byType(LoginScreen), findsNothing);
    expect(find.text('Reviewed total'), findsOneWidget);
    final before = container.read(bookingPlanProvider(shop));
    expect(before.participants.single.single.serviceId, '8');
    expect(before.participants.single.single.variantId, '82');
    expect(before.date, '2031-05-04');
    expect(before.startTime, '10:00');
    expect(before.priceQuote?.totalCents, 18000);
    expect(before.canConfirm, isTrue);
    expect(repo.quotes, hasLength(1));
    await openHistoryAndReturn(tester);
    final after = container.read(bookingPlanProvider(shop));
    expect(after, same(before));
    expect(after.priceQuote, same(before.priceQuote));
    expect(after.quote, same(before.quote));
    expect(after.notes, 'Retain my unsubmitted visit');
    expect(find.textContaining('Submit booking request'), findsOneWidget);
    expect(pages.pageReads, hasLength(1));
    expect(repo.quotes, hasLength(1));
    expect(repo.writes, 0);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
  });
}
