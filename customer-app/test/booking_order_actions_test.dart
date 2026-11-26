import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'booking_detail_boundary_test.dart' as boundary;
import 'booking_quote_fixture.dart';
import 'reschedule_test_fixture.dart';

Map<String, dynamic> discountedOrder() => {
  ...boundary.bookingJson(due: 6000),
  'priceCents': 8000,
  'discountCents': 2000,
  'totalCents': 6000,
  'platformFeeCents': 0,
  'tipCents': 0,
};

class OrderWire implements HttpClientAdapter {
  Map<String, dynamic> order = discountedOrder();
  Map<String, dynamic>? receipt;
  String slotTimezone = 'America/Los_Angeles';
  String? calendarTimezone;
  int? saveFailure;
  bool readFailure = false;
  int saves = 0, reads = 0;
  int reconciliations = 0;
  final requestKeys = <String>[];
  final reconciledKeys = <String>[];
  String reconcileOutcome = 'NOT_EXECUTED';
  Map<String, dynamic>? reconcileReceipt;
  bool reconcileFailure = false;
  Map<String, dynamic>? savedBody;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    final bytes = await stream?.expand((chunk) => chunk).toList() ?? <int>[];
    Object body;
    var status = 200;
    final operation = RegExp(r'^/bookings/42/operations/([^/]+)/reconcile$').firstMatch(options.path);
    if (operation != null) {
      reconciliations++;
      reconciledKeys.add(operation.group(1)!);
      if (reconcileFailure) {
        throw DioException(requestOptions: options, type: DioExceptionType.connectionError);
      }
      return ResponseBody.fromString(jsonEncode(reconcileReceipt ?? {
        'bookingId': '42', 'shopId': '7', 'requestKey': operation.group(1),
        'outcome': reconcileOutcome,
        'action': reconcileOutcome == 'COMMITTED' ? 'RESCHEDULE' : null,
      }), 200, headers: {Headers.contentTypeHeader: ['application/json']});
    }
    switch (options.path) {
      case '/auth/customer/password/login':
        body = {
          'accessToken': 'synthetic-order-customer',
          'refreshToken': 'synthetic-order-refresh',
          'user': {'id': '41', 'role': 'CUSTOMER'},
        };
      case '/bookings/42/reschedule-slots':
        body = {
          'date': options.queryParameters['date'],
          'timezone': slotTimezone,
          'bookingCalendar': {
            ...calendarFixture(),
            'timezone': calendarTimezone ?? slotTimezone,
          },
          'slots': [
            {'time': '11:00', 'available': true},
          ],
        };
      case '/bookings/42/reschedule':
        saves++;
        requestKeys.add(options.headers['Idempotency-Key'] as String);
        savedBody = Map<String, dynamic>.from(
          jsonDecode(utf8.decode(bytes)) as Map,
        );
        status = saveFailure ?? 200;
        body = saveFailure != null
            ? {'message': 'Synthetic conflict'}
            : receipt ??
                  {
                    ...order,
                    'localDate': savedBody!['date'],
                    'localStartTime': savedBody!['startTime'],
                    'localEndTime': '12:00',
                    'timezone': slotTimezone,
                    'startTime': '2031-05-01T18:00:00Z',
                    'endTime': '2031-05-01T19:00:00Z',
                  };
      case '/bookings/42':
        reads++;
        if (readFailure) {
          throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          );
        }
        body = order;
      case '/notifications/bookings/42/order-email':
        body = {
          'bookingId': '42',
          'channel': 'EMAIL',
          'status': 'NOT_REQUESTED',
        };
      default:
        throw StateError('Unexpected synthetic request ${options.path}');
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

class CancellationRepository extends BookingRepository {
  CancellationRepository() : super(ApiService());
  int writes = 0;
  int? rejection;
  @override
  Future<void> cancelBooking(String bookingId) async {
    writes++;
    final request = RequestOptions(path: '/bookings/$bookingId/cancel');
    throw DioException(
      requestOptions: request,
      type: rejection == null
          ? DioExceptionType.connectionError
          : DioExceptionType.badResponse,
      response: rejection == null
          ? null
          : Response(requestOptions: request, statusCode: rejection),
    );
  }

  @override
  Future<BookingPage> getUserBookingPage(
    BookingListQuery query, {
    CancelToken? cancelToken,
  }) async {
    throw StateError('Synthetic list refresh is unavailable');
  }
}

Widget localized(Widget child) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

Future<OrderWire> connect(WidgetTester tester) async {
  final api = ApiService(), original = ApiService().dio.httpClientAdapter;
  final wire = OrderWire();
  api.dio.httpClientAdapter = wire;
  addTearDown(() => api.dio.httpClientAdapter = original);
  // Authentication is overridden by BoundaryCustomer. Keep these UI transport
  // tests independent of the singleton's serialized secure-storage writes.
  return wire;
}

Future<void> openChangeTime(WidgetTester tester) async {
  await resetSyntheticReschedule(tester);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
      ],
      child: localized(const BookingDetailScreen(bookingId: '42')),
    ),
  );
  await boundary.pumpUntil(
    tester,
    () => find.text('Change booking time').evaluate().isNotEmpty,
    'The saved order must load.',
  );
  await tester.ensureVisible(find.text('Change booking time'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Change booking time'));
  await tester.pumpAndSettle();
}

Future<void> checkOriginalChange(WidgetTester tester) async {
  final dialog = find.byType(AlertDialog);
  final check = find.widgetWithText(TextButton, 'Check original time change');
  final target = dialog.evaluate().isNotEmpty ? find.descendant(of: dialog, matching: check) : check;
  if (dialog.evaluate().isEmpty) {
    // A recovery banner can be inserted above the retained order scroll position.
    // Bring its action inside the viewport, clear of the fixed app bar.
    await Scrollable.ensureVisible(tester.element(target), alignment: 0.5);
    await tester.pumpAndSettle();
  }
  expect(target.hitTestable(), findsOneWidget);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> selectAndSave(WidgetTester tester) async {
  final time = find.widgetWithText(ChoiceChip, '11:00');
  await tester.ensureVisible(time);
  await tester.pumpAndSettle();
  await tester.tap(time);
  await tester.pump();
  final save = find.widgetWithText(FilledButton, 'Save time');
  expect(tester.widget<FilledButton>(save).onPressed, isNotNull);
  await tester.tap(save);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets(
    'customer booking details show a saved reason only on cancelled orders',
    (tester) async {
      await resetSyntheticReschedule(tester);
      final wire = await connect(tester);
      const reason = 'The shop is unexpectedly closed.';
      wire.order = {
        ...discountedOrder(),
        'status': 'CANCELLED',
        'amountDueCents': 0,
        'cancelReason': '  $reason  ',
      };
      final listSnapshot = Booking.fromJson({
        ...discountedOrder(),
        'status': 'CANCELLED',
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
            bookingListProvider.overrideWith((ref) async => [listSnapshot]),
          ],
          child: localized(const Scaffold(body: BookingListScreen())),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Booking details'));
      await tester.pumpAndSettle();
      expect(wire.reads, 1);
      expect(find.text('Cancellation reason'), findsOneWidget);
      expect(find.text(reason), findsOneWidget);

      wire.order.remove('cancelReason');
      await tester.tap(find.byTooltip('Reload'));
      await tester.pumpAndSettle();
      expect(wire.reads, 2);
      expect(find.text('Cancelled'), findsOneWidget);
      expect(find.text('Cancellation reason'), findsNothing);

      wire.order = {
        ...discountedOrder(),
        'cancelReason': reason,
      };
      await tester.tap(find.byTooltip('Reload'));
      await tester.pumpAndSettle();
      expect(wire.reads, 3);
      expect(find.text('Cancellation reason'), findsNothing);
      expect(find.text(reason), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final status in ['CANCELLED', 'CONFIRMED']) {
    testWidgets(
      'uncertain cancellation survives a rebuilt card and requires a verified $status status before another write',
      (tester) async {
        tester.view.physicalSize = const Size(700, 1300);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final wire = await connect(tester), repo = CancellationRepository();
        final original = Booking.fromJson(discountedOrder());
        final container = ProviderContainer(
          overrides: [
            authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
            bookingRepositoryProvider.overrideWithValue(repo),
            bookingListProvider.overrideWith((ref) async => [original]),
          ],
        );
        addTearDown(container.dispose);
        Widget list() => UncontrolledProviderScope(
          container: container,
          child: localized(const Scaffold(body: BookingListScreen())),
        );
        await tester.pumpWidget(list());
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, 'Cancel Booking'));
        await tester.pumpAndSettle();
        expect(repo.writes, 1);
        expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsNothing);
        expect(
          find.widgetWithText(OutlinedButton, 'Check booking status'),
          findsOneWidget,
        );

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        await tester.pumpWidget(list());
        await tester.pumpAndSettle();
        expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsNothing);
        wire.readFailure = true;
        await tester.tap(
          find.widgetWithText(OutlinedButton, 'Check booking status'),
        );
        await tester.pumpAndSettle();
        expect(
          find.widgetWithText(OutlinedButton, 'Check booking status'),
          findsOneWidget,
        );
        expect(
          repo.writes,
          1,
          reason: 'A read failure cannot retry the uncertain cancellation.',
        );

        wire.readFailure = false;
        wire.order = {
          ...discountedOrder(),
          'status': status,
          'amountDueCents': status == 'CANCELLED' ? 0 : 6000,
        };
        await tester.tap(
          find.widgetWithText(OutlinedButton, 'Check booking status'),
        );
        await tester.pumpAndSettle();
        expect(
          find.widgetWithText(OutlinedButton, 'Check booking status'),
          findsNothing,
        );
        expect(
          find.widgetWithText(OutlinedButton, 'Cancel'),
          status == 'CONFIRMED' ? findsOneWidget : findsNothing,
        );
        expect(
          find.text(status == 'CANCELLED' ? 'Cancelled' : 'Confirmed'),
          findsOneWidget,
        );
        expect(repo.writes, 1);
        expect(wire.reads, 2);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      },
    );
  }

  testWidgets(
    'an explicit cancellation rejection remains retryable and is not classified as an unknown outcome',
    (tester) async {
      final repo = CancellationRepository()..rejection = 409;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
            bookingRepositoryProvider.overrideWithValue(repo),
            bookingListProvider.overrideWith(
              (ref) async => [Booking.fromJson(discountedOrder())],
            ),
          ],
          child: localized(const Scaffold(body: BookingListScreen())),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Cancel Booking'));
      await tester.pumpAndSettle();
      expect(repo.writes, 1);
      expect(
        find.widgetWithText(OutlinedButton, 'Check booking status'),
        findsNothing,
      );
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Cancel'),
            )
            .onPressed,
        isNotNull,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a corrected shop timezone is shown before rescheduling and the discounted order total stays unchanged',
    (tester) async {
      tester.view.physicalSize = const Size(360, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final wire = await connect(tester);
      await openChangeTime(tester);
      final dialog = find.byType(AlertDialog);
      expect(
        find.descendant(
          of: dialog,
          matching: find.text(
            'Available times are in America/Los_Angeles (shop time).',
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: dialog,
          matching: find.textContaining('The shop time zone has been updated'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: dialog, matching: find.text('America/New_York')),
        findsNothing,
      );
      await selectAndSave(tester);
      expect(wire.savedBody, {'date': '2031-05-01', 'startTime': '11:00'});
      expect(wire.saves, 1);
      expect(find.text('Booking time updated.'), findsOneWidget);
      expect(find.text('11:00 - 12:00 (America/Los_Angeles)'), findsOneWidget);
      expect(
        find.text('USD 60.00'),
        findsNWidgets(2),
        reason:
            'Saved total and outstanding amount use the same discounted total.',
      );
      await tester.ensureVisible(find.text('Coupon discount included'));
      expect(find.text('USD 20.00'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  for (final changed in ['arrival', 'total', 'discount']) {
    testWidgets(
      'a reschedule receipt with a different $changed cannot claim success or allow a second save',
      (tester) async {
        tester.view.physicalSize = const Size(700, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final wire = await connect(tester);
        wire.receipt = {
          ...discountedOrder(),
          'timezone': wire.slotTimezone,
          'localStartTime': changed == 'arrival' ? '10:00' : '11:00',
          if (changed == 'total') 'totalCents': 7000,
          if (changed == 'discount') 'discountCents': 1000,
        };
        wire.reconcileOutcome = 'COMMITTED';
        await openChangeTime(tester);
        await selectAndSave(tester);
        expect(wire.saves, 1);
        expect(find.text('Booking time updated.'), findsNothing);
        expect(
          find.textContaining('The change could not be verified'),
          findsOneWidget,
        );
        expect(find.widgetWithText(FilledButton, 'Save time'), findsNothing);
        await checkOriginalChange(tester);
        expect(wire.saves, 1);
        expect(wire.reconciliations, 1);
        expect(wire.reconciledKeys, wire.requestKeys);
        expect(wire.reads, 2);
        expect(find.text('10:00 - 11:00 (America/New_York)'), findsOneWidget);
        expect(find.textContaining('This booking remains read-only'), findsOneWidget);
        expect(find.text('Change booking time'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'mismatched availability and calendar timezones cannot offer a save',
    (tester) async {
      final wire = await connect(tester);
      wire.calendarTimezone = 'America/New_York';
      await openChangeTime(tester);
      expect(
        find.textContaining('Available times could not be verified'),
        findsOneWidget,
      );
      expect(find.byType(ChoiceChip), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Save time'),
            )
            .onPressed,
        isNull,
      );
      expect(wire.saves, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an explicit reschedule rejection stays locked until its original key is sealed not executed',
    (tester) async {
      tester.view.physicalSize = const Size(700, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final wire = await connect(tester);
      wire.saveFailure = 409;
      await openChangeTime(tester);
      await selectAndSave(tester);
      expect(find.textContaining('The change could not be verified'), findsOneWidget);
      expect(find.byType(ChoiceChip), findsNothing);
      expect(find.widgetWithText(FilledButton, 'Save time'), findsNothing);
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Check available times'),
            )
            .onPressed,
        isNull,
      );
      expect(wire.saves, 1);
      await checkOriginalChange(tester);
      expect(wire.reconciledKeys, wire.requestKeys);
      expect(find.textContaining('Its delayed request has been stopped'), findsOneWidget);
      expect(find.text('Change booking time'), findsOneWidget);
      await tester.tap(find.text('Change booking time'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ChoiceChip, '11:00'), findsOneWidget);
      wire.saveFailure = null;
      await selectAndSave(tester);
      expect(wire.saves, 2);
      expect(wire.requestKeys.toSet(), hasLength(2));
      expect(wire.requestKeys.every((key) => RegExp(r'^[a-f0-9]{32}$').hasMatch(key)), isTrue);
      expect(find.text('Booking time updated.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'service item timestamps without a zone never borrow the customer device timezone',
    (tester) async {
      final wire = await connect(tester);
      wire.order = {
        ...discountedOrder(),
        'items': [
          {
            'id': '100',
            'serviceId': '8',
            'participantIndex': 1,
            'sequence': 1,
            'serviceNameSnapshot': 'Legacy service',
            'durationMin': 60,
            'priceCentsSnapshot': 8000,
            'startAtUtc': '2031-05-01T10:00:00',
            'endAtUtc': '2031-05-01T11:00:00',
          },
        ],
      };
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => boundary.BoundaryCustomer()),
          ],
          child: localized(const BookingDetailScreen(bookingId: '42')),
        ),
      );
      await boundary.pumpUntil(
        tester,
        () => find.text('Reserved services').evaluate().isNotEmpty,
        'The legacy service snapshot must load.',
      );
      await tester.ensureVisible(find.text('Shop time unavailable'));
      await tester.pumpAndSettle();
      expect(find.text('Shop time unavailable'), findsOneWidget);
      expect(find.textContaining('(UTC)'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
