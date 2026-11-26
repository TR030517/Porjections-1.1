import 'booking_quote_fixture.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/service_duration.dart';
import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/theme/customer_theme.dart';

ShopDetail fixture() => ShopDetail.fromJson({
  'id': '7',
  'onlinePaymentEnabled': true, 'orderOnly': false, 'pricingPolicy': 'LEGACY',
  'name': 'Synthetic plan studio',
  'latitude': 0,
  'longitude': 0,
  'timezone': 'America/Los_Angeles',
  'paymentPolicy': {'payAtStoreEnabled': true},
  'services': [
    {
      'id': '8',
      'name': 'Massage',
      'durationMin': 60,
      'priceCents': 6000,
      'participantCount': 1,
      'hasVariants': true,
      'variants': [
        {
          'id': '9007199254740993',
          'name': '60 minute specification',
          'durationMin': 60,
          'priceCents': 6011,
          'currency': 'usd',
          'isActive': true,
        },
      ],
    },
    {
      'id': '9',
      'name': 'Foot care',
      'durationMin': 30,
      'priceCents': 4001,
      'participantCount': 1,
    },
    {
      'id': '10',
      'name': 'Couple package',
      'durationMin': 60,
      'priceCents': 12025,
      'participantCount': 2,
      'priceBasis': 'PER_BOOKING',
      'hasVariants': true,
      'variants': [
        {
          'id': 'v10',
          'name': 'Couple fixed',
          'durationMin': 60,
          'priceCents': 11025,
          'priceBasis': 'PER_BOOKING',
          'currency': 'usd',
          'isActive': true,
        },
      ],
    },
    {
      'id': '14',
      'name': 'Disabled specifications',
      'durationMin': 60,
      'priceCents': 1000,
      'participantCount': 1,
      'hasVariants': true,
      'variants': [],
    },
  ],
  'therapists': [
    {
      'id': '11',
      'name': 'Massage specialist',
      'services': [
        {'id': '8'},
      ],
    },
    {
      'id': '12',
      'name': 'Foot specialist',
      'services': [
        {'id': '9'},
      ],
    },
  ],
});

BookingPlanQuote quoteFor(Map<String, dynamic> request, {int extraPrice = 0}) {
  final endByPerson = <int, int>{};
  final rows = <Map<String, dynamic>>[];
  for (final value in request['items'] as List) {
    final row = Map<String, dynamic>.from(value as Map);
    final person = row['participantIndex'] as int;
    final sequence = row['sequence'] as int;
    final massage = row['serviceId'] == '8';
    final offset = (endByPerson[person] ?? -10) + 10;
    final duration = massage ? 60 : 30;
    rows.add({
      ...row,
      'serviceName': massage ? 'Massage' : 'Foot care',
      'variantName': massage ? '60 minute specification' : null,
      'durationMin': duration,
      'offsetMin': offset,
      'preparationMin': sequence == 1 ? 0 : 10,
      'priceCents': massage ? 6011 : 4001,
      'currency': 'usd',
    });
    endByPerson[person] = offset + duration;
  }
  return BookingPlanQuote.fromJson({
    'date': request['date'],
    'timezone': 'America/Los_Angeles',
    'participantCount': endByPerson.length,
    'durationMin': endByPerson.values.reduce((a, b) => a > b ? a : b),
    'priceCents': rows.fold<int>(
      extraPrice,
      (sum, row) => sum + (row['priceCents'] as int),
    ),
    'items': rows,
    'slots': [
      {'time': '10:00', 'available': true},
      {'time': '10:30', 'available': false},
    ],
  });
}

class PlanRepository extends BookingPlanRepository {
  PlanRepository() : super(ApiService());
  final reads = <Map<String, dynamic>>[];
  final writes = <Map<String, dynamic>>[];
  final pending = <Completer<BookingPlanQuote>>[];
  bool hold = false;
  bool failNext = false;
  Completer<Booking>? pendingCreate;
  @override
  Future<BookingPlanQuote> slots(Map<String, dynamic> selection) {
    reads.add(selection);
    if (hold) {
      final future = Completer<BookingPlanQuote>();
      pending.add(future);
      return future.future;
    }
    return Future.value(quoteFor(selection));
  }

  BookingPriceQuote? accepted;
  @override
  Future<BookingPriceQuote> priceQuote(Map<String,dynamic> request)async{
    final available=quoteFor(request);
    return accepted=BookingPriceQuote.fromJson(timedQuoteJson(request,price:available.priceCents,minutes:available.durationMin,fee:request['paymentMode']=='PAY_AT_STORE'?0:86,
      main:[for(final row in available.items)MainDuration(participantIndex:row.participantIndex,sequence:row.sequence,serviceId:row.serviceId,variantId:row.variantId,durationKind:row.durationKind,reservedDurationMin:row.durationMin)]));
  }
  @override
  Future<Booking> create(Map<String, dynamic> selection) async {
    writes.add(selection);
    if (failNext) {
      failNext = false;
      throw DioException(requestOptions:RequestOptions(path:'/bookings/plan'),response:Response(requestOptions:RequestOptions(path:'/bookings/plan'),statusCode:400),type:DioExceptionType.badResponse);
    }
    if (pendingCreate != null) return pendingCreate!.future;
    return quotedBookingFixture(selection,accepted!);
  }
}

class PageCustomer extends AuthNotifier {
  PageCustomer() : super(ApiService()) {
    state = AuthState(
      isLoggedIn: true,
      user: User(id: '42', role: 'CUSTOMER', name: 'Plan customer', phone: '+12065550123', email: 'plan-customer@example.invalid', emailVerified: true),
    );
  }
}

class PageRepository extends BookingRepository {
  PageRepository() : super(ApiService());
  final queries = <BookingListQuery>[];
  final cancellations = <CancelToken?>[];
  final pending = <Completer<BookingPage>>[];
  bool immediate = false;
  @override
  Future<BookingPage> getUserBookingPage(
    BookingListQuery query, {
    CancelToken? cancelToken,
  }) {
    queries.add(query);
    cancellations.add(cancelToken);
    if (immediate) {
      return Future.value(
        BookingPage(
          items: const [],
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: 0,
        ),
      );
    }
    final value = Completer<BookingPage>();
    pending.add(value);
    return value.future;
  }
}

Future<void> selected(BookingPlanNotifier flow) async {
  flow.selectService(0, 0, '8');
  flow.selectVariant(0, 0, '9007199254740993');
  flow.addStage(0);
  flow.selectService(0, 1, '9');
  flow.addParticipant();
  flow.selectService(1, 0, '9');
  flow.selectDate('2031-01-15');
  await Future<void>.delayed(Duration.zero);
  flow.selectTime('10:00');
  await flow.refreshPriceQuote();
}

void main() {
  test(
    'plans keep participants parallel and each person sequential using server offsets and cents',
    () async {
      final repo = PlanRepository();
      final flow = BookingPlanNotifier(fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await selected(flow);
      expect(flow.state.validPlan, true);
      expect(flow.state.canConfirm, true);
      expect(flow.state.quote!.items.map((row) => row.offsetMin), [0, 70, 0]);
      expect(flow.state.quote!.durationMin, 100);
      expect(flow.state.quote!.priceCents, 14013);
      expect(
        flow.state.requestItems.map(
          (row) => [row['participantIndex'], row['sequence']],
        ),
        [
          [1, 1],
          [1, 2],
          [2, 1],
        ],
      );
      expect(
        flow.state.requestItems.every(
          (row) =>
              !row.containsKey('priceCents') && !row.containsKey('offsetMin'),
        ),
        true,
      );
    },
  );

  test(
    'couple and all-disabled specifications cannot be silently added or fall back in plans',
    () {
      final flow = BookingPlanNotifier(fixture(), PlanRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.selectService(0, 0, '10');
      expect(flow.state.participants[0][0].serviceId, null);
      flow.selectService(0, 0, '14');
      expect(flow.state.participants[0][0].serviceId, null);
      flow.selectService(0, 0, '8');
      expect(flow.state.validPlan, false);
      flow.selectVariant(0, 0, 'unknown');
      expect(flow.state.validPlan, false);
      flow.selectVariant(0, 0, '9007199254740993');
      expect(flow.state.validPlan, true);
    },
  );

  test(
    'participant and segment limits, removals, and ordering keep contiguous indexes',
    () {
      final flow = BookingPlanNotifier(fixture(), PlanRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      for (var i = 0; i < 10; i++) {
        flow.addParticipant();
      }
      expect(flow.state.participants.length, 6);
      for (var p = 0; p < 6; p++) {
        for (var s = 0; s < 5; s++) {
          flow.addStage(p);
        }
      }
      expect(flow.state.itemCount, 12);
      expect(flow.state.participants.every((row) => row.length <= 4), true);
      flow.removeParticipant(0);
      expect(flow.state.requestItems.first['participantIndex'], 1);
      flow.selectService(0, 0, '8');
      flow.selectService(0, 1, '9');
      flow.moveStage(0, 1, -1);
      expect(flow.state.participants[0].first.serviceId, '9');
      expect(
        flow.state.requestItems
            .where((row) => row['participantIndex'] == 1)
            .map((row) => row['sequence']),
        [1, 2, 3, 4],
      );
    },
  );

  test(
    'qualification is checked per service and changing it clears stale variant, therapist and time',
    () async {
      final flow = BookingPlanNotifier(fixture(), PlanRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await selected(flow);
      flow.selectTherapist(0, 0, '12');
      expect(flow.state.participants[0][0].therapistId, null);
      flow.selectTherapist(0, 0, '11');
      expect(flow.state.participants[0][0].therapistId, '11');
      flow.selectService(0, 0, '9');
      expect(flow.state.participants[0][0].variantId, null);
      expect(flow.state.participants[0][0].therapistId, null);
      expect(flow.state.startTime, null);
    },
  );

  test(
    'a stale plan-slot response cannot overwrite a newer preference or restore selection',
    () async {
      final repo = PlanRepository()..hold = true;
      final flow = BookingPlanNotifier(fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.selectService(0, 0, '9');
      flow.selectDate('2031-01-15');
      flow.selectTherapist(0, 0, '12');
      repo.pending[1].complete(quoteFor(repo.reads[1]));
      await Future<void>.delayed(Duration.zero);
      final newest = flow.state.quote;
      flow.selectTime('10:00');
      repo.pending[0].complete(quoteFor(repo.reads[0]));
      await Future<void>.delayed(Duration.zero);
      expect(identical(flow.state.quote, newest), true);
      expect(flow.state.startTime, '10:00');
    },
  );

  test(
    'inconsistent server quote fails closed instead of confirming a different amount',
    () async {
      final repo = PlanRepository()..hold = true;
      final flow = BookingPlanNotifier(fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.selectService(0, 0, '9');
      flow.selectDate('2031-01-15');
      repo.pending.single.complete(quoteFor(repo.reads.single, extraPrice: 1));
      await Future<void>.delayed(Duration.zero);
      expect(flow.state.quote, null);
      expect(flow.state.error, isNotNull);
      expect(flow.state.canConfirm, false);
    },
  );

  test(
    'an explicitly rejected unchanged plan retries one idempotency key; changed tip and mode use new keys',
    () async {
      final repo = PlanRepository()..failNext = true;
      final flow = BookingPlanNotifier(fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await selected(flow);
      expect(await flow.confirm(), null);
      expect(flow.state.priceQuote, isNull);
      expect(flow.state.canConfirm, isFalse);
      await flow.refreshPriceQuote();
      await flow.confirm();
      expect(repo.writes[0]['requestKey'], repo.writes[1]['requestKey']);
      final oldKey = repo.writes.last['requestKey'];
      flow.setTipCents(125);
      await flow.refreshPriceQuote();
      await flow.confirm();
      expect(repo.writes.last['requestKey'], isNot(oldKey));
      expect(repo.writes.last['tipCents'], 125);
      final tipKey = repo.writes.last['requestKey'];
      flow.setPaymentMode('PAY_AT_STORE');
      await flow.refreshPriceQuote();
      await flow.confirm();
      expect(repo.writes.last['requestKey'], isNot(tipKey));
      expect(repo.writes.last['paymentMode'], 'PAY_AT_STORE');
      expect(repo.writes.last.containsKey('priceCents'), false);
      expect(repo.writes.last.containsKey('totalCents'), false);
      expect(
        (repo.writes.last['items'] as List).every(
          (row) => !(row as Map).containsKey('priceCents'),
        ),
        true,
      );
    },
  );

  test(
    'duplicate confirmation shares one request and the server final total remains authoritative',
    () async {
      final repo = PlanRepository()..pendingCreate = Completer<Booking>();
      final flow = BookingPlanNotifier(fixture(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      await selected(flow);
      final first = flow.confirm();
      final second = flow.confirm();
      expect(identical(first, second), true);
      expect(repo.writes.length, 1);
      flow.setTipCents(200);
      expect(flow.state.tipCents, 0);
      repo.pendingCreate!.complete(quotedBookingFixture(repo.writes.single,repo.accepted!));
      final result = await first;
      expect(result!.totalCents, 14099);
      expect(flow.state.quote!.priceCents, 14013);
    },
  );

  test(
    'fixed booking prices use the variant basis independently and never multiply by two',
    () {
      final shop = fixture();
      final flow = BookingFlowNotifier(BookingRepository(ApiService()), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
      addTearDown(flow.dispose);
      flow.initFlow(shop);
      flow.selectService(shop.services[2]);
      flow.selectVariant(shop.services[2].activeVariants.single);
      expect(flow.state.selectedPriceCents, 11025);
      expect(flow.state.selectedDuration, 60);
      final row = ShopService.fromJson({
        'id': '20',
        'durationMin': 60,
        'priceCents': 10501,
        'participantCount': 2,
        'priceBasis': 'PER_BOOKING',
      });
      expect(row.startingPriceCents, 10501);
      final perPerson = ShopService.fromJson({
        'id': '21',
        'durationMin': 60,
        'priceCents': 10501,
        'participantCount': 2,
      });
      expect(perPerson.startingPriceCents, 21002);
    },
  );

  test(
    'tip parsing preserves cents, rejects precision, negatives, overflow, and does not infer a percentage',
    () {
      expect(parseTipCents(''), 0);
      expect(parseTipCents('12.05'), 1205);
      expect(parseTipCents('0.01'), 1);
      expect(parseTipCents('99999.99'), 9999999);
      for (final value in ['1.001', '-1', '100000', '1e2', 'NaN']) {
        expect(parseTipCents(value), null);
      }
    },
  );

  test(
    'booking plan snapshots parse sequence, actual per-segment price, UTC/local time, and server tip',
    () {
      final row = Booking.fromJson({
        'id': '42',
        'reservationKind': 'PLAN',
        'tipCents': 123,
        'items': [
          {
            'id': '9007199254740993',
            'participantIndex': 2,
            'sequence': 3,
            'offsetMin': 100,
            'preparationMin': 10,
            'serviceNameSnapshot': 'Historical service',
            'priceCentsSnapshot': 5001,
            'priceBasisSnapshot': 'PER_BOOKING',
            'startAtUtc': '2031-01-15T20:00:00.000Z',
            'endAtUtc': '2031-01-15T21:00:00.000Z',
            'localStartTime': '2031-01-15T12:00',
            'localEndTime': '2031-01-15T13:00',
          },
        ],
      });
      expect(row.tipCents, 123);
      expect(row.items.single.id, '9007199254740993');
      expect(row.items.single.sequence, 3);
      expect(row.items.single.offsetMin, 100);
      expect(row.items.single.priceCents, 5001);
      expect(row.items.single.startTime, '2031-01-15T20:00:00.000Z');
      expect(row.items.single.localStartTime, '2031-01-15T12:00');
    },
  );

  test(
    'pagination and filters are sent to the server and a new filter resets to page one',
    () {
      const query = BookingListQuery(
        page: 3,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        paymentMode: 'PAY_AT_STORE',
        search: ' Studio ',
        startDate: '2031-01-15',
        endDate: '2031-01-15',
      );
      expect(query.toJson(), {
        'page': 3,
        'pageSize': 25,
        'status': 'CONFIRMED',
        'paymentStatus': 'UNPAID',
        'paymentMode': 'PAY_AT_STORE',
        'search': 'Studio',
        'startDate': '2031-01-15',
        'endDate': '2031-01-15',
      });
      expect(query.atPage(4).toJson()['status'], 'CONFIRMED');
      expect(const BookingListQuery(status: 'PENDING').page, 1);
    },
  );

  test(
    'changing an applied booking filter cancels the old server request and ignores its late page',
    () async {
      final repo = PageRepository();
      final container = ProviderContainer(
        overrides: [
          authProvider.overrideWith((ref) => PageCustomer()),
          bookingRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(bookingPageProvider, (_, _) {});
      addTearDown(subscription.close);
      await Future<void>.delayed(Duration.zero);
      expect(repo.queries.single.page, 1);
      container.read(bookingQueryProvider.notifier).state =
          const BookingListQuery(page: 2);
      await Future<void>.delayed(Duration.zero);
      expect(repo.cancellations.first!.isCancelled, true);
      container
          .read(bookingQueryProvider.notifier)
          .state = const BookingListQuery(
        status: 'CONFIRMED',
        startDate: '2031-01-15',
        endDate: '2031-01-15',
      );
      await Future<void>.delayed(Duration.zero);
      expect(repo.queries.last.page, 1);
      expect(repo.queries.last.status, 'CONFIRMED');
      repo.pending.last.complete(
        const BookingPage(
          items: [],
          total: 0,
          page: 1,
          pageSize: 25,
          totalPages: 0,
        ),
      );
      await container.read(bookingPageProvider.future);
      repo.pending[0].complete(
        const BookingPage(
          items: [],
          total: 100,
          page: 1,
          pageSize: 25,
          totalPages: 4,
        ),
      );
      repo.pending[1].complete(
        const BookingPage(
          items: [],
          total: 100,
          page: 2,
          pageSize: 25,
          totalPages: 4,
        ),
      );
      await Future<void>.delayed(Duration.zero);
      expect(container.read(bookingPageProvider).value!.total, 0);
      expect(container.read(bookingPageProvider).value!.page, 1);
    },
  );

  testWidgets(
    'booking filters only apply on search and reset clears typed drafts after rebuilding on a narrow screen',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      final repo = PageRepository()..immediate = true;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => PageCustomer()),
            bookingRepositoryProvider.overrideWithValue(repo),
          ],
          child: MaterialApp(
            theme: buildCustomerTheme(),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: BookingListScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(repo.queries.length, 1);
      await tester.tap(find.text('Find a booking'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).first,
        'Synthetic visit',
      );
      await tester.ensureVisible(
        find.byType(DropdownButtonFormField<String>).first,
      );
      await tester.tap(find.byType(DropdownButtonFormField<String>).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirmed').last);
      await tester.pumpAndSettle();
      expect(repo.queries.length, 1);
      await tester.ensureVisible(find.text('Search'));
      await tester.tap(find.text('Search'));
      await tester.pumpAndSettle();
      expect(repo.queries.last.search, 'Synthetic visit');
      expect(repo.queries.last.status, 'CONFIRMED');
      await tester.ensureVisible(find.text('Reset'));
      await tester.tap(find.text('Reset'));
      await tester.pumpAndSettle();
      expect(repo.queries.last.search, '');
      expect(repo.queries.last.status, '');
      expect(repo.queries.last.page, 1);
      expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).first)
            .controller!
            .text,
        '',
      );
      expect(tester.takeException(), null);
    },
  );

  testWidgets(
    'phone plan notes keep the action above the keyboard at normal and large text sizes',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetViewInsets);

      for (final textScale in [1.0, 1.5, 2.0]) {
        tester.view.resetViewInsets();
        final shop = fixture();
        final repo = PlanRepository();
        final flow = BookingPlanNotifier(shop, repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        await tester.runAsync(() => selected(flow));
        await tester.pumpWidget(
          ProviderScope(
            overrides: [bookingPlanProvider(shop).overrideWith((ref) => flow)],
            child: MaterialApp(
              theme: buildCustomerTheme(),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(textScale),
                ),
                child: child!,
              ),
              home: BookingPlanScreen(shop: shop),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final action = find.byKey(const ValueKey('booking-plan-primary-action'));
        for (var step = 0; step < 3; step++) {
          await tester.tap(action);
          await tester.pumpAndSettle();
        }

        final notes = find.widgetWithText(TextField, 'Notes (optional)');
        await tester.ensureVisible(notes);
        await tester.showKeyboard(notes);
        tester.view.viewInsets = const FakeViewPadding(bottom: 320);
        await tester.pumpAndSettle();
        await tester.ensureVisible(notes);
        await tester.pumpAndSettle();

        const keyboardTop = 844.0 - 320.0;
        expect(tester.getBottomLeft(action).dy, lessThanOrEqualTo(keyboardTop),
          reason: 'The $textScale× action must stay above the keyboard.');
        expect(action.hitTestable(), findsOneWidget);
        expect(notes.hitTestable(), findsOneWidget);
        expect(tester.getBottomLeft(notes).dy,
          lessThanOrEqualTo(tester.getTopLeft(action).dy));
        await tester.enterText(notes, 'Please allow extra arrival time.');
        await tester.pumpAndSettle();
        expect(flow.state.notes, 'Please allow extra arrival time.');
        expect(tester.widget<FilledButton>(action).onPressed, isNotNull);
        expect(action.hitTestable(), findsOneWidget);
        expect(repo.writes, isEmpty);
        expect(tester.takeException(), isNull,
          reason: 'The $textScale× keyboard layout must not overflow.');
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      }
    },
  );

  testWidgets(
    'phone and desktop plan confirmation show ordered itineraries and require the current total review',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      for (final width in [390.0, 1280.0]) {
        final shop = fixture();
        final flow = BookingPlanNotifier(shop, PlanRepository(), currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        await tester.runAsync(() => selected(flow));
        tester.view.physicalSize = Size(width, 900);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authProvider.overrideWith((ref) => PageCustomer()),
              bookingPlanProvider(shop).overrideWith((ref) => flow),
            ],
            child: MaterialApp(
              theme: buildCustomerTheme(),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: BookingPlanScreen(shop: shop),
            ),
          ),
        );
        await tester.pumpAndSettle();
        void checkLayout(String step) {
          final error = tester.takeException();
          if (error != null) {
            fail(
              '$width / $step: ${error is FlutterError ? error.diagnostics.map((node) => node.toStringDeep()).join('\n') : error}',
            );
          }
        }

        checkLayout('people');
        for (var step = 0; step < 3; step++) {
          await tester.tap(find.text('Continue'));
          await tester.pumpAndSettle();
          checkLayout('step ${step + 1}');
        }
        expect(find.text('USD 140.13'), findsOneWidget);
        expect(find.text('Participant 1'), findsOneWidget);
        expect(find.text('Participant 2'), findsOneWidget);
        expect(find.textContaining('11:10 – 11:40'), findsOneWidget);
        expect(find.text('Reviewed total'), findsOneWidget);
        expect(find.textContaining('An online booking is held briefly while you complete payment.'), findsOneWidget);
        final confirm = find.widgetWithText(FilledButton, 'Submit booking request');
        expect(flow.state.hasValidPriceQuote, isTrue);
        expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
        flow.setNotes('Changed itinerary note requires a new total review');
        await tester.pumpAndSettle();
        expect(flow.state.hasValidPriceQuote, isFalse);
        expect(find.widgetWithText(FilledButton, 'Submit booking request'), findsNothing);
        expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Review current total')).onPressed, isNotNull);
        expect(tester.takeException(), null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      }
    },
  );
}
