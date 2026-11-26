import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_reschedule_journal.dart';
import 'package:mjapp_client/models/booking.dart';

/// Validates the serialized HTTP body after Dio's request transformation.
/// These allowlists are the backend DTO contract with forbidNonWhitelisted.
class ContractTransport implements HttpClientAdapter {
  final calls = <({String method, String path, dynamic body})>[];
  final queries = <Map<String, dynamic>>[];
  final headers = <Map<String, dynamic>>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final bytes =
        await requestStream?.expand((chunk) => chunk).toList() ?? <int>[];
    final body = bytes.isEmpty ? null : jsonDecode(utf8.decode(bytes));
    calls.add((method: options.method, path: options.path, body: body));
    queries.add(Map<String, dynamic>.from(options.queryParameters));
    headers.add(Map<String, dynamic>.from(options.headers));
    final fields = <String, Set<String>>{
      '/auth/customer/password/login': {'email', 'password'},
      '/payments/quote': {'bookingId'},
      '/payments/create-intent': {'bookingId'},
      '/bookings': {
        'shopId',
        'serviceId',
        'date',
        'startTime',
        'therapistId',
        'durationMin',
        'notes',
        'couponId',
        'variantId',
        'preferredTherapistIds',
        'requestKey',
        'paymentMode',
      },
    };
    if (options.method != 'GET' && fields.containsKey(options.path)) {
      if (body is! Map ||
          body.keys.any((key) => !fields[options.path]!.contains(key))) {
        return ResponseBody.fromString(
          '{"message":"Unexpected DTO fields"}',
          400,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        );
      }
    }
    final response = options.path.startsWith('/auth/')
        ? {
            'accessToken': 'unit-test-memory-access',
            'refreshToken': 'unit-test-native-refresh',
            'user': {'id': '42', 'role': 'CUSTOMER'},
          }
        : options.path == '/payments/create-intent'
        ? {
            'provider': 'square',
            'mock': false,
            'providerOrderId': 'order_test',
            'paymentRecordId': 'record_test',
            'checkoutUrl': 'https://sandbox.square.link/u/test',
            'paymentIntentId': null,
          }
        : {'id': '42', 'paymentStatus': 'UNPAID'};
    return ResponseBody.fromString(
      jsonEncode(response),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'real Dio requests match auth, booking and payment DTOs without client identity or financial fields',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      final api = ApiService();
      final transport = ContractTransport();
      api.dio.httpClientAdapter = transport;
      await api.passwordLogin(
        'wire-test@example.invalid',
        'unit-test-password-only',
      );
      expect(transport.calls.last.body, {
        'email': 'wire-test@example.invalid',
        'password': 'unit-test-password-only',
      });
      await api.getPaymentQuote('42');
      expect(transport.calls.last.method, 'POST');
      expect(transport.calls.last.path, '/payments/quote');
      expect(transport.calls.last.body, {'bookingId': '42'});
      final checkout = await api.createPaymentIntent('42');
      expect(transport.calls.last.path, '/payments/create-intent');
      expect(transport.calls.last.body, {'bookingId': '42'});
      expect(checkout['paymentIntentId'], isNull);
      expect(checkout['providerOrderId'], 'order_test');
      await api.getBooking('42');
      expect(transport.calls.last.method, 'GET');
      expect(transport.calls.last.path, '/bookings/42');
      expect(transport.calls.last.body, isNull);
      await api.getSlots(
        shopId: '7',
        serviceId: '8',
        variantId: '9007199254740993',
        preferredTherapistIds: ['9', '11'],
        date: '2031-01-15',
      );
      expect(transport.calls.last.path, '/bookings/slots');
      expect(transport.queries.last, {
        'shopId': '7',
        'serviceId': '8',
        'variantId': '9007199254740993',
        'preferredTherapistIds': '9,11',
        'date': '2031-01-15',
      });
      await api.createBooking(
        shopId: '7',
        serviceId: '8',
        date: '2031-01-15',
        startTime: '10:00',
        therapistId: '9',
        durationMin: 60,
        notes: 'Test',
        couponId: '10',
        variantId: '9007199254740993',
        preferredTherapistIds: ['9'],
        requestKey: 'retry-stable-key',
      );
      expect(transport.calls.last.path, '/bookings');
      expect(transport.calls.last.body, {
        'shopId': '7',
        'serviceId': '8',
        'date': '2031-01-15',
        'startTime': '10:00',
        'therapistId': '9',
        'durationMin': 60,
        'notes': 'Test',
        'couponId': '10',
        'variantId': '9007199254740993',
        'preferredTherapistIds': ['9'],
        'requestKey': 'retry-stable-key',
        'paymentMode': 'PAY_AT_STORE',
      });
      expect(
        transport.calls.every(
          (call) =>
              call.body is! Map || !(call.body as Map).containsKey('userId'),
        ),
        isTrue,
      );
      expect(
        transport.calls
            .where((call) => call.path.startsWith('/payments/'))
            .every((call) => (call.body as Map).keys.length == 1),
        isTrue,
      );
      expect(
        transport.calls.every((call) => call.path != '/payments/confirm'),
        isTrue,
      );
      await api.createBooking(
        shopId: '7',
        serviceId: '8',
        date: '2031-01-15',
        startTime: '10:00',
      );
      expect(
        (transport.calls.last.body as Map).containsKey('therapistId'),
        isFalse,
      );
    },
  );
  test(
    'combined booking HTTP carries selections and a retry key, while snapshot reschedule and pagination use their dedicated endpoints',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      final api = ApiService();
      final transport = ContractTransport();
      api.dio.httpClientAdapter = transport;
      final selection = <String, dynamic>{
        'shopId': '7',
        'date': '2031-01-15',
        'items': [
          {
            'participantIndex': 1,
            'sequence': 1,
            'serviceId': '8',
            'variantId': '9007199254740993',
            'therapistId': '11',
          },
          {'participantIndex': 2, 'sequence': 1, 'serviceId': '9'},
        ],
      };
      await api.getBookingPlanSlots(selection);
      expect(transport.calls.last.method, 'POST');
      expect(transport.calls.last.path, '/bookings/plan-slots');
      expect(transport.calls.last.body, selection);
      await api.createBookingPlan({
        ...selection,
        'startTime': '10:00',
        'requestKey': 'stable-key',
        'paymentMode': 'PAY_AT_STORE',
        'tipCents': 125,
      });
      expect(transport.calls.last.path, '/bookings/plan');
      expect(transport.calls.last.body, {
        ...selection,
        'startTime': '10:00',
        'requestKey': 'stable-key',
        'paymentMode': 'PAY_AT_STORE',
        'tipCents': 125,
      });
      await api.getRescheduleSlots('9007199254740993', date: '2031-01-16');
      expect(
        transport.calls.last.path,
        '/bookings/9007199254740993/reschedule-slots',
      );
      expect(transport.queries.last, {'date': '2031-01-16'});
      final attempt = await bookingRescheduleJournal.begin(actor: '42',
        booking: Booking.fromJson({'id': '9007199254740993', 'shopId': '7',
          'userId': '42', 'priceCents': 8000, 'discountCents': 0}),
        date: '2031-01-16', startTime: '12:00', timezone: 'America/New_York');
      addTearDown(() => bookingRescheduleJournal.finish(attempt, () => true));
      await api.rescheduleBooking(
        '9007199254740993',
        date: '2031-01-16',
        startTime: '12:00',
        requestKey: attempt.requestKey,
      );
      expect(transport.calls.last.body, {
        'date': '2031-01-16',
        'startTime': '12:00',
      });
      expect(transport.headers.last['Idempotency-Key'], attempt.requestKey);
      final dispatched = transport.calls.length;
      await expectLater(api.rescheduleBooking('9007199254740993',
        date: '2031-01-16', startTime: '12:00'), throwsA(isA<RescheduleJournalException>()));
      expect(transport.calls.length, dispatched);
      await api.reconcileBookingReschedule('9007199254740993', attempt.requestKey);
      expect(transport.calls.last.method, 'POST');
      expect(transport.calls.last.path, '/bookings/9007199254740993/operations/${attempt.requestKey}/reconcile');
      expect(transport.calls.last.body, isEmpty);
      await api.getUserBookingPage({
        'page': 2,
        'pageSize': 25,
        'paymentMode': 'PAY_AT_STORE',
        'startDate': '2031-01-15',
        'endDate': '2031-01-15',
      });
      expect(transport.calls.last.method, 'GET');
      expect(transport.calls.last.path, '/bookings');
      expect(transport.queries.last, {
        'page': 2,
        'pageSize': 25,
        'paymentMode': 'PAY_AT_STORE',
        'startDate': '2031-01-15',
        'endDate': '2031-01-15',
      });
      expect(
        transport.calls
            .where((row) => row.body is Map)
            .every(
              (row) =>
                  !(row.body as Map).containsKey('priceCents') &&
                  !(row.body as Map).containsKey('totalCents'),
            ),
        true,
      );
    },
  );
}
