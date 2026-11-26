import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/theme/customer_theme.dart';
import 'booking_add_ons_test.dart' as fixture;
import 'booking_calendar_test.dart' as calendar_fixture;
import 'reservation_flow_test.dart' as standard_fixture;

class RefreshPlanRepository extends fixture.PlanRepository {
  final reads = <Map<String, dynamic>>[];
  Completer<BookingPriceQuote>? pendingPrice;
  Completer<Booking>? pendingCreate;
  bool rejectNext = false;

  @override
  Future<BookingPlanQuote> slots(Map<String, dynamic> request) async {
    reads.add(request);
    return fixture.planSlots(request);
  }

  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> request) async {
    if (pendingPrice != null) return pendingPrice!.future;
    return super.priceQuote(request);
  }

  @override
  Future<Booking> create(Map<String, dynamic> request) async {
    writes.add(request);
    if (rejectNext) {
      rejectNext = false;
      throw fixture.lostResponse('/bookings/plan', 400);
    }
    return pendingCreate?.future ?? Future.value(fixture.saved(request, plan: true));
  }
}

Future<void> choosePlan(BookingPlanNotifier flow) async {
  flow.onCustomerChanged(null, '41');
  flow.selectService(0, 0, '8');
  flow.selectDate('2031-05-01');
  await Future<void>.delayed(Duration.zero);
  flow.selectTime('10:00');
  await flow.refreshPriceQuote();
}

ShopDetail revisedShop({bool online = true, bool variants = false, bool keepOriginalVariant = true}) => ShopDetail.fromJson({
  'id': '7', 'name': 'Updated studio', 'latitude': 0, 'longitude': 0,
  'timezone': 'America/New_York', 'bookingCalendar': calendar_fixture.calendar('2031-05-01', 'America/New_York', '2031-05-01T12:00:00Z', '2031-05-02T04:00:00Z'),
  'features': {'onlineBooking': online}, 'bookingSettings': {'minimumNoticeMinutes': 720},
  'services': [
    {'id': '8', 'name': 'Updated service', 'durationMin': 60, 'priceCents': 9000,
      'hasVariants': variants,
      'variants': variants ? [
        if (keepOriginalVariant) {'id': '20', 'name': 'Original option', 'durationMin': 60, 'priceCents': 5000, 'isActive': true},
        {'id': '21', 'name': 'Remaining option', 'durationMin': 90, 'priceCents': 9000, 'isActive': true},
      ] : [],
    },
  ],
});

void main() {
  testWidgets('refresh from the date step returns to current service options when the chosen specification was removed', (tester) async {
    tester.view.physicalSize = const Size(1280, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final original = revisedShop(variants: true);
    final updated = revisedShop(variants: true, keepOriginalVariant: false);
    final flow = BookingFlowNotifier(fixture.StandardRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    final repo = calendar_fixture.CalendarRepository(updated);
    await tester.pumpWidget(ProviderScope(overrides: [
      bookingFlowProvider.overrideWith((ref) => flow),
      shopRepositoryProvider.overrideWithValue(repo),
    ], child: MaterialApp(theme: buildCustomerTheme(),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: BookingScreen(shop: original, initialService: original.services.single, initialVariantId: '20'))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose Therapist →'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose Date & Time →'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Refresh shop calendar'));
    await tester.tap(find.text('Refresh shop calendar'));
    await tester.pumpAndSettle();
    expect(identical(flow.state.shop, updated), isTrue);
    expect(flow.state.selectedVariant, isNull);
    expect(find.text('Remaining option'), findsOneWidget);
    expect(find.text('Original option'), findsNothing);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  test('standard shop refresh uses the current catalog and notice, clears arrival and ignores an older price response', () async {
    final repo = fixture.StandardRepository();
    final flow = await fixture.standard(repo);
    addTearDown(flow.dispose);
    final oldService = flow.state.selectedService!;
    flow.toggleAddOn(1, '10', true);
    final request = flow.state.quoteRequest;
    repo.hold = true;
    final pricing = flow.refreshPriceQuote();
    final updated = revisedShop();
    flow.refreshShopDetails(updated);
    expect(identical(flow.state.shop, updated), isTrue);
    expect(flow.state.shop!.bookingSettings.minimumNoticeMinutes, 720);
    expect(flow.state.selectedService!.name, 'Updated service');
    expect(flow.state.selectedPriceCents, 9000);
    expect(flow.state.selectedDate, isNull);
    expect(flow.state.selectedStartTime, isNull);
    expect(flow.state.addOnSelections.every((row) => row.addOnIds.isEmpty), isTrue);
    repo.pending.single.complete(BookingPriceQuote.fromJson(fixture.quoteJson(request)));
    await pricing;
    expect(flow.state.isLoadingQuote, isFalse);
    expect(flow.state.priceQuote, isNull);
    flow.selectService(oldService);
    expect(identical(flow.state.selectedService, updated.services.single), isTrue);
    expect(flow.state.selectedPriceCents, 9000);
  });

  test('plan shop refresh drops removed options and preferences before allowing another arrival selection', () async {
    final repo = RefreshPlanRepository();
    final flow = BookingPlanNotifier(revisedShop(variants: true), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    flow.selectService(0, 0, '8');
    flow.selectVariant(0, 0, '20');
    flow.selectDate('2031-05-01');
    await Future<void>.delayed(Duration.zero);
    flow.selectTime('10:00');
    expect(flow.state.validPlan, isTrue);
    final updated = revisedShop(variants: true, keepOriginalVariant: false);
    flow.refreshShopDetails(updated);
    expect(identical(flow.state.shop, updated), isTrue);
    expect(flow.state.participants.single.single.serviceId, '8');
    expect(flow.state.participants.single.single.variantId, isNull);
    expect(flow.state.date, isNull);
    expect(flow.state.startTime, isNull);
    expect(flow.state.quote, isNull);
    expect(flow.state.validPlan, isFalse);
    flow.selectVariant(0, 0, '21');
    expect(flow.state.validPlan, isTrue);
    expect(flow.state.mainDurations.single.reservedDurationMin, 90);
  });

  test('a newly disabled shop blocks standard and plan booking after refresh', () async {
    final standard = await fixture.standard(fixture.StandardRepository());
    final plan = BookingPlanNotifier(fixture.shop(), RefreshPlanRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(standard.dispose);
    addTearDown(plan.dispose);
    await choosePlan(plan);
    final disabled = revisedShop(online: false);
    standard.refreshShopDetails(disabled);
    plan.refreshShopDetails(disabled);
    expect(standard.state.hasServiceSelection, isFalse);
    expect(standard.state.canConfirm, isFalse);
    expect(plan.state.validPlan, isFalse);
    expect(plan.state.canConfirm, isFalse);
    expect(await standard.confirmBooking(), isNull);
    expect(await plan.confirm(), isNull);
  });

  test('refreshing plan availability cancels an in-flight old price quote', () async {
    final repo = RefreshPlanRepository();
    final flow = BookingPlanNotifier(fixture.shop(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    await choosePlan(flow);
    final request = flow.state.pricingRequest;
    repo.pendingPrice = Completer<BookingPriceQuote>();
    final pricing = flow.refreshPriceQuote();
    expect(flow.state.loadingPriceQuote, isTrue);
    await flow.loadSlots();
    expect(flow.state.startTime, isNull);
    expect(flow.state.priceQuote, isNull);
    expect(flow.state.loadingPriceQuote, isFalse);
    repo.pendingPrice!.complete(BookingPriceQuote.fromJson(fixture.quoteJson(request, plan: true)));
    await pricing;
    expect(flow.state.loadingPriceQuote, isFalse);
    expect(flow.state.priceQuote, isNull);
    expect(flow.state.canConfirm, isFalse);
  });

  test('plan availability cannot refresh or mutate selection during an order submission', () async {
    final repo = RefreshPlanRepository()..pendingCreate = Completer<Booking>();
    final flow = BookingPlanNotifier(fixture.shop(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    await choosePlan(flow);
    final before = flow.state.quote;
    final readCount = repo.reads.length;
    final submitting = flow.confirm();
    expect(flow.state.submitting, isTrue);
    await flow.loadSlots();
    expect(flow.state.startTime, '10:00');
    expect(identical(flow.state.quote, before), isTrue);
    expect(repo.reads.length, readCount);
    repo.pendingCreate!.complete(fixture.saved(repo.writes.single, plan: true));
    expect(await submitting, isNotNull);
  });

  test('a definite standard order rejection discards its old quote before an unchanged retry', () async {
    final repo = standard_fixture.ReservationRepository()..failNext = true;
    final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    await standard_fixture.choose(flow, standard_fixture.reservationFixture());
    expect(await flow.confirmBooking(), isNull);
    expect(flow.state.priceQuote, isNull);
    expect(flow.state.canConfirm, isFalse);
    expect(await flow.confirmBooking(), isNull);
    expect(repo.writes.length, 1);
    final originalKey = repo.writes.single['requestKey'];
    await flow.refreshPriceQuote();
    expect(await flow.confirmBooking(), isNotNull);
    expect(repo.writes.length, 2);
    expect(repo.writes.last['requestKey'], originalKey);
  });

  test('a completed standard order stays cached when its quote is refreshed', () async {
    final repo = standard_fixture.ReservationRepository();
    final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    await standard_fixture.choose(flow, standard_fixture.reservationFixture());
    final booking = await flow.confirmBooking();
    expect(booking, isNotNull);
    final writes = repo.writes.length;
    await flow.refreshPriceQuote();
    expect(flow.completedBooking, same(booking));
    expect(await flow.confirmBooking(), same(booking));
    expect(repo.writes, hasLength(writes));
  });

  test('a definite plan order rejection requires reviewing a fresh quote and keeps the unchanged request key', () async {
    final repo = RefreshPlanRepository()..rejectNext = true;
    final flow = BookingPlanNotifier(fixture.shop(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    await choosePlan(flow);
    expect(await flow.confirm(), isNull);
    expect(flow.state.priceQuote, isNull);
    expect(flow.state.canConfirm, isFalse);
    expect(await flow.confirm(), isNull);
    expect(repo.writes.length, 1);
    final originalKey = repo.writes.single['requestKey'];
    await flow.refreshPriceQuote();
    expect(await flow.confirm(), isNotNull);
    expect(repo.writes.length, 2);
    expect(repo.writes.last['requestKey'], originalKey);
  });
}
