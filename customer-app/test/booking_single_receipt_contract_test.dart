import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_quote_fixture.dart';

/// Mirrors the SINGLE response serialized by BookingService, including the
/// parent AUTO preference projected onto ordinary-order items. The database
/// item's LEGACY_UNKNOWN default is not the public preference contract.
Map<String, dynamic> singleReceipt(Map<String, dynamic> request) => {
  'id': '7',
  'bookingNo': 'synthetic-single-7',
  'userId': '3',
  'contact': {
    'recorded': true,
    'version': 1,
    ...Map<String, dynamic>.from(request['contact'] as Map),
  },
  'shopId': '2',
  'serviceId': '11',
  'therapistId': '3',
  'reservationKind': 'SINGLE',
  'bookingDate': '${request['date']}T00:00:00.000Z',
  'startTime': '${request['date']}T17:00:00.000Z',
  'endTime': '${request['date']}T17:45:00.000Z',
  'timezone': 'America/Los_Angeles',
  'localDate': request['date'],
  'localStartTime': request['startTime'],
  'localEndTime': '09:45',
  'durationMin': 45,
  'reservedDurationMin': 45,
  'durationKind': 'TIMED',
  'priceCents': 6525,
  'mainSubtotalCents': 6525,
  'addOnSubtotalCents': 0,
  'totalCents': 6525,
  'discountCents': 0,
  'platformFeeCents': 0,
  'tipCents': 0,
  'paidCents': 0,
  'refundedCents': 0,
  'amountDueCents': 6525,
  'currency': 'usd',
  'status': 'PENDING',
  'paymentStatus': 'UNPAID',
  'paymentMode': 'PAY_AT_STORE',
  'orderOnly': true,
  'onlinePaymentEnabled': false,
  'participantCount': 1,
  'requiredStaffCount': 1,
  'therapistSelectionMode': 'AUTO',
  'requestedTherapistIds': <String>[],
  'addOns': <dynamic>[],
  'items': [
    {
      'id': '9',
      'bookingId': '7',
      'serviceId': '11',
      'variantId': '12',
      'participantIndex': 1,
      'sequence': 1,
      'offsetMin': 0,
      'serviceNameSnapshot': 'EGO complete relaxation',
      'variantNameSnapshot': '45 min',
      'durationKindSnapshot': 'TIMED',
      'durationKind': 'TIMED',
      'durationMin': 45,
      'reservedDurationMin': 45,
      'priceBasisSnapshot': 'PER_BOOKING',
      'priceCentsSnapshot': 6525,
      'quotedUnitPriceCents': 6525,
      'requiredStaffCountSnapshot': 1,
      'requiredStaffCount': 1,
      'assignedTherapistId': '3',
      'assignedTherapistIds': ['3'],
      'therapistSelectionMode': 'AUTO',
      'requestedTherapistIds': <String>[],
      'startAtUtc': '${request['date']}T17:00:00.000Z',
      'endAtUtc': '${request['date']}T17:45:00.000Z',
      'currency': 'usd',
    },
  ],
};

class SingleReceiptWire implements HttpClientAdapter {
  bool loseFirst = false;
  void Function(Map<String, dynamic>)? mutate;
  final writes = <Map<String, dynamic>>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final bytes = await requestStream?.expand((chunk) => chunk).toList() ?? [];
    final request = bytes.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(utf8.decode(bytes)) as Map);
    Object response;
    var status = 200;
    switch (options.path) {
      case '/auth/customer/password/login':
        response = {
          'accessToken': 'synthetic-single',
          'refreshToken': 'synthetic-single-refresh',
          'user': {
            'id': '3',
            'role': 'CUSTOMER',
            'email': 'synthetic-single@example.invalid',
            'emailVerified': true,
            'name': 'Test customer',
            'phone': '+12065550123',
          },
        };
      case '/bookings/slots':
        response = {
          'date': options.queryParameters['date'],
          'timezone': 'America/Los_Angeles',
          'variantId': '12',
          'durationKind': 'TIMED',
          'durationMin': 45,
          'participantCount': 1,
          'requiredStaffCount': 1,
          'slots': [
            {'time': '09:00', 'available': true},
          ],
        };
      case '/bookings/quote':
        response = timedQuoteJson(request, price: 6525, minutes: 45);
      case '/bookings':
        writes.add(request);
        if (loseFirst && writes.length == 1) {
          throw DioException(
            requestOptions: options,
            type: DioExceptionType.receiveTimeout,
          );
        }
        final saved = singleReceipt(request);
        mutate?.call(saved);
        response = saved;
        status = 201;
      default:
        throw StateError('Unexpected synthetic request: ${options.path}');
    }
    return ResponseBody.fromString(
      jsonEncode(response),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Future<BookingFlowNotifier> preparedFlow(SingleReceiptWire wire) async {
  final api = ApiService();
  api.dio.httpClientAdapter = wire;
  await api.passwordLogin(
    'synthetic-single@example.invalid',
    'synthetic-local',
  );
  final flow = BookingFlowNotifier(
    BookingRepository(api),
    currentCustomerId: () => '3',
    currentCustomerEmail: () => 'synthetic-single@example.invalid',
    currentCustomerName: () => 'Test customer',
    currentCustomerPhone: () => '+12065550123',
  );
  final shop = ShopDetail.fromJson({
    'id': '2',
    'name': 'Synthetic single receipt',
    'latitude': 0,
    'longitude': 0,
    'timezone': 'America/Los_Angeles',
    'requiresCustomerEmail': false,
    'paymentPolicy': {'payAtStoreEnabled': true},
    'services': [
      {
        'id': '11',
        'name': 'EGO complete relaxation',
        'durationMin': 45,
        'priceCents': 6525,
        'participantCount': 1,
        'requiredStaffCount': 1,
        'hasVariants': true,
        'variants': [
          {
            'id': '12',
            'name': '45 min',
            'durationMin': 45,
            'priceCents': 6525,
            'isActive': true,
          },
        ],
      },
    ],
  });
  flow.initFlow(shop);
  flow.selectService(shop.services.single);
  flow.selectVariant(shop.services.single.activeVariants.single);
  flow.selectDate(DateTime(2031, 11, 20));
  for (var tick = 0; tick < 50 && flow.state.availableSlots == null; tick++) {
    await Future<void>.delayed(const Duration(milliseconds: 2));
  }
  expect(flow.state.availableSlots?.single.time, '09:00');
  flow.toggleTimeSlot('09:00');
  flow.selectPaymentMode('PAY_AT_STORE');
  await flow.refreshPriceQuote();
  expect(flow.state.hasValidPriceQuote, isTrue);
  return flow;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    clearBookingRecoveryMarker();
  });
  tearDown(clearBookingRecoveryMarker);

  for (final recover in [false, true]) {
    test(
      'canonical SINGLE 201 ${recover ? 'original-key recovery' : 'creation'} completes a 45-minute variant exactly once',
      () async {
        final wire = SingleReceiptWire()..loseFirst = recover;
        final flow = await preparedFlow(wire);
        addTearDown(flow.dispose);
        if (recover) {
          expect(await flow.confirmBooking(), isNull);
          expect(flow.state.pendingAttempt, isNotNull);
          expect(hasBookingRecoveryMarker(), isTrue);
        }
        final booking = await (recover
            ? flow.retryOriginalRequest()
            : flow.confirmBooking());
        expect(booking?.id, '7');
        expect(booking?.reservationKind, 'SINGLE');
        expect(booking?.items.single.variantId, '12');
        expect(booking?.durationMin, 45);
        expect(booking?.totalCents, 6525);
        expect(flow.state.pendingAttempt, isNull);
        expect(hasBookingRecoveryMarker(), isFalse);
        final writes = wire.writes.length;
        expect(flow.completedBooking, same(booking));
        await flow.refreshPriceQuote();
        expect(flow.completedBooking, same(booking));
        expect(await flow.confirmBooking(), same(booking));
        expect(wire.writes, hasLength(writes));
        expect(
          wire.writes.every(
            (request) => jsonEncode(request) == jsonEncode(wire.writes.first),
          ),
          isTrue,
        );
      },
    );
  }

  test('legacy STANDARD ordinary-order receipts remain compatible', () async {
    final wire = SingleReceiptWire()
      ..mutate = (saved) {
        saved['reservationKind'] = 'STANDARD';
      };
    final flow = await preparedFlow(wire);
    addTearDown(flow.dispose);
    expect((await flow.confirmBooking())?.id, '7');
    expect(hasBookingRecoveryMarker(), isFalse);
  });

  for (final mutation in <String, void Function(Map<String, dynamic>)>{
    'PLAN kind': (saved) {
      saved['reservationKind'] = 'PLAN';
    },
    'unknown kind': (saved) {
      saved['reservationKind'] = 'UNKNOWN';
    },
    'another variant': (saved) {
      (saved['items'] as List).single['variantId'] = '13';
    },
    'unprojected legacy item preference': (saved) {
      (saved['items'] as List).single['therapistSelectionMode'] =
          'LEGACY_UNKNOWN';
      (saved['items'] as List).single['requestedTherapistIds'] = null;
    },
  }.entries) {
    test(
      'canonical SINGLE still rejects ${mutation.key} without another create',
      () async {
        final wire = SingleReceiptWire()..mutate = mutation.value;
        final flow = await preparedFlow(wire);
        addTearDown(flow.dispose);
        expect(await flow.confirmBooking(), isNull);
        expect(flow.state.pendingAttempt, isNotNull);
        expect(hasBookingRecoveryMarker(), isTrue);
        expect(await flow.confirmBooking(), isNull);
        expect(wire.writes, hasLength(1));
      },
    );
  }
}
