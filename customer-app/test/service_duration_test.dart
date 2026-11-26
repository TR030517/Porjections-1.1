import 'booking_quote_fixture.dart';
import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/service_duration.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/screens/payment_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/payment_checkout_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/widgets/booking_add_ons.dart';

Map<String, dynamic> serviceJson(
  String kind, {
  bool variant = false,
  bool couple = false,
}) => {
  'id': '8',
  'name': 'Primary care',
  'durationKind': kind,
  'durationMin': 60,
  'reservedDurationMin': 60,
  'priceCents': 5000,
  'currency': 'usd',
  'priceBasis': 'PER_PERSON',
  'participantCount': couple ? 2 : 1,
  if (variant) 'hasVariants': true,
  if (variant)
    'variants': [
      {
        'id': '18',
        'name': 'Longer reserved option',
        'durationMin': 90,
        'reservedDurationMin': 90,
        'durationKind': kind,
        'priceCents': 6500,
        'currency': 'usd',
        'isActive': true,
        'priceBasis': 'PER_BOOKING',
      },
    ],
  'addOns': [
    {
      'id': '10',
      'serviceId': '8',
      'name': 'Oil',
      'priceCents': 1000,
      'currency': 'usd',
      'isActive': true,
    },
  ],
};
ShopDetail studio(String kind, {bool variant = false, bool couple = false}) =>
    ShopDetail.fromJson({
      'bookingCalendar': calendarFixture(),
      'id': '7',
      'name': 'Duration studio',
      'latitude': 0,
      'longitude': 0,
      'timezone': 'America/New_York',
      'onlinePaymentEnabled': true,
      'orderOnly': false,
      'pricingPolicy': 'LEGACY',
      'features': {'onlineBooking': true},
      'paymentPolicy': {'payAtStoreEnabled': true},
      'services': [serviceJson(kind, variant: variant, couple: couple)],
    });
Map<String, dynamic> lineJson(MainDuration row) => row.toJson();
Map<String, dynamic> quoteJson(
  List<MainDuration> main, {
  int? span,
  bool oil = false,
}) {
  final minutes = span ?? main.first.reservedDurationMin;
  final subtotal = main.length * 5000 + (oil ? 1000 : 0);
  return {
    'shopId': '7',
    'currency': 'usd',
    'durationMin': minutes,
    'reservedDurationMin': minutes,
    'durationKind': combinedDurationKind(main.map((row) => row.durationKind)),
    'mainDurations': main.map(lineJson).toList(),
    'mainSubtotalCents': main.length * 5000,
    'addOnSubtotalCents': oil ? 1000 : 0,
    'subtotalCents': subtotal,
    'discountEligibleCents': main.length * 5000,
    'discountCents': 0,
    'platformFeeCents': 0,
    'tipCents': 0,
    'totalCents': subtotal,
    'addOns': [
      if (oil)
        {
          'sourceAddOnId': '10',
          'participantIndex': 1,
          'sequence': 1,
          'name': 'Oil snapshot',
          'unitPriceCents': 1000,
          'quantity': 1,
          'lineTotalCents': 1000,
          'currency': 'usd',
        },
    ],
    'quoteHash': 'a' * 64,
    'quoteExpiresAt': DateTime.now()
        .toUtc()
        .add(const Duration(minutes: 5))
        .toIso8601String(),
  };
}

Booking saved(
  BookingPriceQuote quote, {
  Map<String, dynamic>? request,
  String? currentKind,
}) {
  final payload =
      request ??
      {
        'shopId': '7',
        'serviceId': '8',
        'date': '2031-05-01',
        'startTime': '10:00',
        'paymentMode': 'ONLINE',
      };
  final receipt = quotedBookingJson(payload, quote);
  final start = (payload['startTime'] as String)
      .split(':')
      .map(int.parse)
      .toList();
  final end = start[0] * 60 + start[1] + quote.durationMin;
  return Booking.fromJson({
    ...receipt,
    'onlinePaymentEnabled': true,
    'orderOnly': false,
    'id': '42',
    'shopId': '7',
    'serviceId': '8',
    'durationMin': quote.durationMin,
    'reservedDurationMin': quote.durationMin,
    'durationKind': quote.durationKind,
    'priceCents': quote.subtotalCents,
    'mainSubtotalCents': quote.mainSubtotalCents,
    'addOnSubtotalCents': quote.addOnSubtotalCents,
    'totalCents': quote.totalCents,
    'currency': 'usd',
    'timezone': 'America/New_York',
    'localEndTime':
        '${(end ~/ 60).toString().padLeft(2, '0')}:${(end % 60).toString().padLeft(2, '0')}',
    'service': {
      'id': '8',
      'name': 'Live renamed parent',
      'durationKind': currentKind ?? 'TIMED',
      'durationMin': 120,
    },
    'items': [
      for (var i = 0; i < quote.mainDurations.length; i++)
        {
          ...((receipt['items'] as List)[i] as Map<String, dynamic>),
          'id': '${60 + i}',
          ...quote.mainDurations[i].toJson(),
          'durationMin': quote.mainDurations[i].reservedDurationMin,
          'durationKindSnapshot': quote.mainDurations[i].durationKind,
          'serviceNameSnapshot': 'Historical main service',
          'priceCentsSnapshot': 5000,
        },
    ],
    'addOns': [
      for (var i = 0; i < quote.addOns.length; i++)
        {
          'id': '${80 + i}',
          'bookingItemId': '60',
          'sourceAddOnId': quote.addOns[i].sourceAddOnId,
          'participantIndex': quote.addOns[i].participantIndex,
          'sequence': quote.addOns[i].sequence,
          'name': quote.addOns[i].name,
          'unitPriceCents': quote.addOns[i].unitPriceCents,
          'quantity': 1,
          'lineTotalCents': quote.addOns[i].lineTotalCents,
          'currency': 'usd',
        },
    ],
  });
}

class DurationRepository extends BookingRepository {
  DurationRepository(this.catalog) : super(ApiService());
  ShopDetail catalog;
  SlotResponse? slotOverride;
  BookingPriceQuote? responseOverride, lastQuote;
  Completer<SlotResponse>? heldSlot;
  Completer<BookingPriceQuote>? heldQuote;
  bool lose = false, disabled = false, rejectReplay = false;
  Duration quoteTtl = const Duration(minutes: 5);
  Booking? original;
  final writes = <Map<String, dynamic>>[];
  int quoteReads = 0, legacyCreates = 0;
  @override
  Future<SlotResponse> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) async {
    if (heldSlot != null) return heldSlot!.future;
    if (slotOverride != null) return slotOverride!;
    final service = catalog.services.first,
        variants = service.activeVariants.where((row) => row.id == variantId);
    final minutes = variants.isEmpty
        ? service.durationMin
        : variants.first.durationMin;
    return SlotResponse.fromJson({
      'date': date,
      'durationMin': minutes,
      'reservedDurationMin': minutes,
      'durationKind': service.durationKind,
      'participantCount': service.participantCount,
      'variantId': variantId,
      'timezone': 'America/New_York',
      'slots': [
        {'time': '10:00', 'available': true},
      ],
    });
  }

  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> request) async {
    quoteReads++;
    if (disabled) throw StateError('Current catalog unavailable');
    if (heldQuote != null) return heldQuote!.future;
    if (responseOverride != null) return responseOverride!;
    final service = catalog.services.first,
        variants = service.activeVariants.where(
          (row) => row.id == request['variantId'],
        );
    final minutes = variants.isEmpty
        ? service.durationMin
        : variants.first.durationMin;
    final vector = [
      for (var g = 1; g <= service.participantCount; g++)
        MainDuration(
          participantIndex: g,
          sequence: 1,
          serviceId: '8',
          variantId: request['variantId'] as String?,
          durationKind: service.durationKind,
          reservedDurationMin: minutes,
        ),
    ];
    return lastQuote = BookingPriceQuote.fromJson({
      ...quoteJson(vector, oil: request.containsKey('addOnSelections')),
      'quoteExpiresAt': DateTime.now().toUtc().add(quoteTtl).toIso8601String(),
    });
  }

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> request) async {
    writes.add(request);
    if (original != null) return original!;
    if (rejectReplay) {
      throw DioException(
        requestOptions: RequestOptions(path: '/bookings'),
        response: Response(
          requestOptions: RequestOptions(path: '/bookings'),
          statusCode: 409,
        ),
      );
    }
    original = saved(
      lastQuote!,
      request: request,
      currentKind: catalog.services.first.durationKind,
    );
    if (lose) {
      lose = false;
      throw DioException(
        requestOptions: RequestOptions(path: '/bookings'),
        type: DioExceptionType.connectionTimeout,
      );
    }
    return original!;
  }

  @override
  Future<Booking> createBooking({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    String? requestKey,
    required String date,
    required String startTime,
    int? durationMin,
    String? notes,
    String? couponId,
    String paymentMode = 'ONLINE',
    Map<String, dynamic>? contact,
  }) async {
    legacyCreates++;
    return Booking.fromJson({
      'id': '42',
      'shopId': '7',
      'priceCents': 5000,
      'durationMin': durationMin,
      if (contact != null)
        'contact': {'recorded': true, 'version': 1, ...contact},
    });
  }
}

Future<BookingFlowNotifier> select(DurationRepository repo) async {
  final flow = BookingFlowNotifier(
    repo,
    currentCustomerId: () => '41',
    currentCustomerEmail: () => 'customer-41@example.invalid',
    currentCustomerName: () => 'Test customer',
    currentCustomerPhone: () => '+12065550123',
  );
  flow.onCustomerChanged(null, '41');
  flow.initFlow(repo.catalog);
  flow.selectService(repo.catalog.services.first);
  if (repo.catalog.services.first.hasVariants) {
    flow.selectVariant(repo.catalog.services.first.activeVariants.first);
  }
  flow.selectDate(DateTime(2031, 5, 1));
  await Future<void>.delayed(Duration.zero);
  flow.toggleTimeSlot('10:00');
  return flow;
}

class MixedRepository extends BookingPlanRepository {
  MixedRepository(this.catalog) : super(ApiService());
  final ShopDetail catalog;
  bool wrong = false;
  BookingPriceQuote? accepted;
  final writes = <Map<String, dynamic>>[];
  List<MainDuration> vector(Map<String, dynamic> request) => [
    for (final raw in request['items'] as List)
      MainDuration(
        participantIndex: raw['participantIndex'] as int,
        sequence: raw['sequence'] as int,
        serviceId: raw['serviceId'] as String,
        variantId: raw['variantId'] as String?,
        durationKind: catalog.services
            .firstWhere((row) => row.id == raw['serviceId'])
            .durationKind,
        reservedDurationMin: catalog.services
            .firstWhere((row) => row.id == raw['serviceId'])
            .durationMin,
      ),
  ];
  @override
  Future<BookingPlanQuote> slots(Map<String, dynamic> request) async {
    final rows = vector(request),
        offsets = <int, int>{},
        items = <Map<String, dynamic>>[];
    for (final row in rows) {
      final offset =
          (offsets[row.participantIndex] ?? 0) + (row.sequence > 1 ? 10 : 0);
      items.add({
        ...row.toJson(),
        'durationMin': row.reservedDurationMin,
        'durationKind': wrong ? 'TIMED' : row.durationKind,
        'serviceName': 'Service ${row.serviceId}',
        'offsetMin': offset,
        'preparationMin': row.sequence > 1 ? 10 : 0,
        'priceCents': 5000,
        'currency': 'usd',
      });
      offsets[row.participantIndex] = offset + row.reservedDurationMin;
    }
    final span = offsets.values.reduce((a, b) => a > b ? a : b);
    return BookingPlanQuote.fromJson({
      'date': request['date'],
      'timezone': 'America/New_York',
      'durationMin': span,
      'reservedDurationMin': span,
      'items': items,
      'participantCount': offsets.length,
      'priceCents': rows.length * 5000,
      'slots': [
        {'time': '10:00', 'available': true},
      ],
    });
  }

  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> request) async {
    final availability = await slots(request);
    return accepted = BookingPriceQuote.fromJson(
      quoteJson(vector(request), span: availability.durationMin),
    );
  }

  @override
  Future<Booking> create(Map<String, dynamic> request) async {
    writes.add(request);
    return saved(accepted!, request: request);
  }
}

class DurationPaymentApi implements PaymentCheckoutApi {
  final BookingPriceQuote accepted;
  final Map<String, dynamic> snapshot;
  DurationPaymentApi(this.accepted, this.snapshot);
  @override
  Future<Map<String, dynamic>> config() async => {
    'enabled': false,
    'provider': 'disabled',
    'onlinePaymentEnabled': true,
    'orderOnly': false,
  };
  @override
  Future<Map<String, dynamic>> quote(String id) async => {
    'subtotalCents': accepted.subtotalCents,
    'mainSubtotalCents': accepted.mainSubtotalCents,
    'addOnSubtotalCents': 0,
    'addOns': [],
    'discountCents': 0,
    'platformFeeCents': 0,
    'tipCents': 0,
    'totalCents': accepted.totalCents,
    'currency': 'usd',
    'paymentEnabled': false,
  };
  @override
  Future<Map<String, dynamic>> booking(String id) async => snapshot;
  @override
  Future<Map<String, dynamic>> create(String id) async =>
      throw StateError('No payment operation authorized');
}

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);
  test(
    'legacy missing type remains TIMED while explicit null unknown or conflicting reserved alias fails closed',
    () {
      final legacy = Map<String, dynamic>.from(serviceJson('TIMED'))
        ..remove('durationKind')
        ..remove('reservedDurationMin');
      expect(ShopService.fromJson(legacy).durationKind, 'TIMED');
      expect(ShopService.fromJson(legacy).canBook, isTrue);
      for (final patch in [
        {'durationKind': null},
        {'durationKind': 'MIXED'},
        {'durationKind': 'UNKNOWN'},
        {'reservedDurationMin': 30},
        {'reservedDurationMin': null},
      ]) {
        expect(
          () => ShopService.fromJson({...serviceJson('PER_SESSION'), ...patch}),
          throwsFormatException,
        );
      }
      for (final minutes in [0, 4, 241]) {
        final service = ShopService.fromJson({
          ...serviceJson('VARIABLE'),
          'durationMin': minutes,
          'reservedDurationMin': minutes,
        });
        expect(service.canBook, isFalse);
      }
      for (final kind in ['PER_SESSION', 'VARIABLE']) {
        final service = ShopService.fromJson(serviceJson(kind));
        expect(service.formattedDuration, durationKindLabel(kind));
        expect(service.formattedDuration, isNot(contains('60')));
      }
    },
  );
  test(
    'short treatments and variants reserve five through 240 minutes while out-of-range legacy rows stay display-only',
    () {
      for (final kind in ['TIMED', 'PER_SESSION', 'VARIABLE']) {
        for (final minutes in [5, 15, 20, 29, 30, 240]) {
          final raw = {
            ...serviceJson(kind),
            'durationMin': minutes,
            'reservedDurationMin': minutes,
          };
          expect(
            ShopService.fromJson(raw).canBook,
            isTrue,
            reason: '$kind $minutes',
          );
          expect(validReservedMinutes(minutes), isTrue);
          final vector = {
            'participantIndex': 1,
            'sequence': 1,
            'serviceId': '8',
            'variantId': null,
            'durationKind': kind,
            'reservedDurationMin': minutes,
          };
          expect(MainDuration.fromJson(vector).reservedDurationMin, minutes);
          final withVariant = serviceJson(kind, variant: true);
          final variant = Map<String, dynamic>.from(
            (withVariant['variants'] as List).single as Map,
          );
          withVariant['variants'] = [
            {
              ...variant,
              'durationMin': minutes,
              'reservedDurationMin': minutes,
            },
          ];
          expect(
            ShopService.fromJson(withVariant).activeVariants.single.durationMin,
            minutes,
          );
        }
        for (final minutes in [0, 4, 241]) {
          final raw = {
            ...serviceJson(kind),
            'durationMin': minutes,
            'reservedDurationMin': minutes,
          };
          expect(ShopService.fromJson(raw).canBook, isFalse);
          expect(validReservedMinutes(minutes), isFalse);
          expect(
            () => MainDuration.fromJson({
              'participantIndex': 1,
              'sequence': 1,
              'serviceId': '8',
              'variantId': null,
              'durationKind': kind,
              'reservedDurationMin': minutes,
            }),
            throwsFormatException,
          );
          final withVariant = serviceJson(kind, variant: true);
          final variant = Map<String, dynamic>.from(
            (withVariant['variants'] as List).single as Map,
          );
          withVariant['variants'] = [
            {
              ...variant,
              'durationMin': minutes,
              'reservedDurationMin': minutes,
            },
          ];
          expect(ShopService.fromJson(withVariant).canBook, isFalse);
        }
      }
    },
  );
  test(
    'variant inherits its parent type but reserves its own explicit block and price basis remains independent',
    () {
      final service = ShopService.fromJson(
        serviceJson('PER_SESSION', variant: true, couple: true),
      );
      expect(service.activeVariants.single.durationKind, 'PER_SESSION');
      expect(service.activeVariants.single.durationMin, 90);
      expect(service.activeVariants.single.priceBasis, 'PER_BOOKING');
      expect(service.startingPriceCents, 6500);
      final bad = serviceJson('VARIABLE', variant: true);
      (bad['variants'] as List).single['durationKind'] = 'TIMED';
      expect(() => ShopService.fromJson(bad), throwsFormatException);
      expect(
        () => SlotResponse.fromJson({
          'date': '2031-05-01',
          'durationMin': 60,
          'reservedDurationMin': 30,
          'durationKind': 'PER_SESSION',
          'slots': [],
        }),
        throwsFormatException,
      );
      expect(
        () => SlotResponse.fromJson({
          'date': '2031-05-01',
          'durationMin': 60,
          'durationKind': null,
          'slots': [],
        }),
        throwsFormatException,
      );
    },
  );
  test(
    'non-TIMED slot metadata must match selected kind block variant and old late responses cannot supply times',
    () async {
      final repo = DurationRepository(studio('PER_SESSION'))
        ..slotOverride = SlotResponse(
          date: '2031-05-01',
          durationMin: 60,
          durationKind: 'TIMED',
          hasDurationMetadata: true,
          slots: [TimeSlot(time: '10:00', available: true)],
        );
      final flow = await select(repo);
      addTearDown(flow.dispose);
      expect(flow.state.hasSelection, isFalse);
      expect(flow.state.availableSlots, isNull);
      expect(repo.writes, isEmpty);
      repo.slotOverride = null;
      repo.heldSlot = Completer<SlotResponse>();
      flow.selectDate(DateTime(2031, 5, 2));
      flow.selectService(repo.catalog.services.first);
      repo.heldSlot!.complete(
        SlotResponse(
          date: '2031-05-01',
          durationMin: 60,
          durationKind: 'PER_SESSION',
          hasDurationMetadata: true,
          slots: [TimeSlot(time: '10:00', available: true)],
        ),
      );
      await Future<void>.delayed(Duration.zero);
      expect(flow.state.availableSlots, isNull);
      expect(flow.state.hasSelection, isFalse);
    },
  );
  for (final kind in ['PER_SESSION', 'VARIABLE']) {
    test(
      '$kind without add-ons requires explicit full-vector server quote and stable-key create',
      () async {
        final repo = DurationRepository(studio(kind)),
            flow = await select(repo);
        addTearDown(flow.dispose);
        expect(flow.state.hasAddOns, isFalse);
        expect(flow.state.requiresServerQuote, isTrue);
        expect(flow.state.selectedDuration, 60);
        expect(flow.state.selectedEndTime, '11:00');
        expect(await flow.confirmBooking(), isNull);
        expect(repo.writes, isEmpty);
        await flow.refreshPriceQuote();
        expect(flow.state.canConfirm, isTrue);
        final booking = await flow.confirmBooking();
        expect(booking, isNotNull, reason: flow.state.error);
        expect(booking!.durationKind, kind);
        expect(booking.items.single.durationKind, kind);
        final payload = repo.writes.single;
        expect((payload['requestKey'] as String).length, 32);
        expect(payload['quoteHash'], 'a' * 64);
        expect(payload.containsKey('addOnSelections'), isFalse);
        expect(payload.containsKey('durationKind'), isFalse);
        expect(payload.containsKey('reservedDurationMin'), isFalse);
        expect(repo.legacyCreates, 0);
      },
    );
  }
  test(
    'TIMED without add-ons reviews one signed quote before creation',
    () async {
      final repo = DurationRepository(studio('TIMED')),
          flow = await select(repo);
      addTearDown(flow.dispose);
      expect(flow.state.requiresServerQuote, isTrue);
      expect(await flow.confirmBooking(), isNull);
      expect(repo.legacyCreates, 0);
      expect(repo.quoteReads, 0);
      await flow.refreshPriceQuote();
      expect(await flow.confirmBooking(), isNotNull);
      expect(repo.legacyCreates, 0);
      expect(repo.quoteReads, 1);
    },
  );
  test(
    'quote vector rejects missing wrong guest service variant kind block and duplicate coordinates',
    () async {
      final repo = DurationRepository(studio('VARIABLE')),
          flow = await select(repo);
      addTearDown(flow.dispose);
      final expected = flow.state.mainDurations;
      final raw = quoteJson(expected);
      for (final patch in [
        {'mainDurations': []},
        {'mainDurations': null},
        {
          'mainDurations': [expected.single.toJson(), expected.single.toJson()],
        },
        {
          'mainDurations': [
            {...expected.single.toJson(), 'durationKind': null},
          ],
        },
        {'reservedDurationMin': 30},
      ]) {
        expect(
          () => BookingPriceQuote.fromJson({...raw, ...patch}),
          throwsFormatException,
        );
      }
      for (final patch in [
        {'participantIndex': 2},
        {'serviceId': '9'},
        {'variantId': '18'},
        {'durationKind': 'PER_SESSION'},
        {'reservedDurationMin': 30},
      ]) {
        final row = {...expected.single.toJson(), ...patch},
            bad = {
              ...raw,
              'mainDurations': [row],
              'durationKind': row['durationKind'],
            };
        repo.responseOverride = BookingPriceQuote.fromJson(bad);
        await flow.refreshPriceQuote();
        expect(flow.state.priceQuote, isNull);
        expect(flow.state.canConfirm, isFalse);
      }
      expect(repo.writes, isEmpty);
    },
  );
  test(
    'late price quote after date or type selection changes cannot authorize the next selection',
    () async {
      final repo = DurationRepository(studio('VARIABLE')),
          flow = await select(repo);
      addTearDown(flow.dispose);
      repo.heldQuote = Completer<BookingPriceQuote>();
      final old = flow.refreshPriceQuote();
      await Future<void>.delayed(Duration.zero);
      final oldVector = flow.state.mainDurations;
      flow.selectDate(DateTime(2031, 5, 2));
      repo.heldQuote!.complete(
        BookingPriceQuote.fromJson(quoteJson(oldVector)),
      );
      await old;
      expect(flow.state.priceQuote, isNull);
      expect(repo.writes, isEmpty);
    },
  );
  test(
    'couple non-TIMED reserves one block not two and add-on still attaches only to Guest 1',
    () async {
      final repo = DurationRepository(studio('PER_SESSION', couple: true)),
          flow = await select(repo);
      addTearDown(flow.dispose);
      flow.toggleAddOn(1, '10', true);
      await flow.refreshPriceQuote();
      expect(flow.state.priceQuote!.durationMin, 60);
      expect(flow.state.priceQuote!.mainDurations, hasLength(2));
      final booking = await flow.confirmBooking();
      expect(booking!.durationMin, 60);
      expect(booking.addOns.single.participantIndex, 1);
      expect(booking.priceCents, 11000);
    },
  );
  test(
    'mixed PLAN validates all primary types preserves parallel span and preparation rather than sum',
    () async {
      final raw = {
        'id': '7',
        'name': 'Mixed studio',
        'latitude': 0,
        'longitude': 0,
        'features': {'onlineBooking': true},
        'services': [
          serviceJson('PER_SESSION'),
          {
            ...serviceJson('VARIABLE'),
            'id': '9',
            'name': 'Foot care',
            'durationMin': 30,
            'reservedDurationMin': 30,
            'addOns': [],
          },
          {
            ...serviceJson('TIMED'),
            'id': '10',
            'name': 'Timed care',
            'durationMin': 60,
            'reservedDurationMin': 60,
            'addOns': [],
          },
        ],
      };
      final shop = ShopDetail.fromJson(raw),
          repo = MixedRepository(ShopDetail.fromJson(raw)),
          flow = BookingPlanNotifier(
            shop,
            repo,
            currentCustomerId: () => '41',
            currentCustomerEmail: () => 'customer-41@example.invalid',
            currentCustomerName: () => 'Test customer',
            currentCustomerPhone: () => '+12065550123',
          );
      addTearDown(flow.dispose);
      flow.onCustomerChanged(null, '41');
      flow.selectService(0, 0, '8');
      flow.addStage(0);
      flow.selectService(0, 1, '9');
      flow.addParticipant();
      flow.selectService(1, 0, '10');
      flow.selectDate('2031-05-01');
      await Future<void>.delayed(Duration.zero);
      flow.selectTime('10:00');
      expect(flow.state.quote!.durationKind, 'MIXED');
      expect(flow.state.quote!.durationMin, 100);
      expect(
        flow.state.mainDurations.fold<int>(
          0,
          (sum, row) => sum + row.reservedDurationMin,
        ),
        150,
      );
      expect(await flow.confirm(), isNull);
      await flow.refreshPriceQuote();
      final booking = await flow.confirm();
      expect(booking, isNotNull, reason: flow.state.error);
      expect(booking!.durationKind, 'MIXED');
      expect(booking.durationMin, 100);
      expect(booking.items.map((row) => row.durationKind), [
        'PER_SESSION',
        'VARIABLE',
        'TIMED',
      ]);
      expect(repo.writes.single.containsKey('addOnSelections'), isFalse);
    },
  );
  test(
    'PLAN availability with an explicit wrong primary kind cannot authorize a non-TIMED segment',
    () async {
      final shop = studio('VARIABLE'),
          repo = MixedRepository(studio('VARIABLE'))..wrong = true,
          flow = BookingPlanNotifier(
            shop,
            repo,
            currentCustomerId: () => '41',
            currentCustomerEmail: () => 'customer-41@example.invalid',
            currentCustomerName: () => 'Test customer',
            currentCustomerPhone: () => '+12065550123',
          );
      addTearDown(flow.dispose);
      flow.onCustomerChanged(null, '41');
      flow.selectService(0, 0, '8');
      flow.selectDate('2031-05-01');
      await Future<void>.delayed(Duration.zero);
      expect(flow.state.quote, isNull);
      expect(flow.state.canConfirm, isFalse);
      expect(repo.writes, isEmpty);
    },
  );
  test(
    'historic kind is derived from saved items and current parent kind cannot rewrite it',
    () {
      final vector = [
        const MainDuration(
          participantIndex: 1,
          sequence: 1,
          serviceId: '8',
          variantId: null,
          durationKind: 'VARIABLE',
          reservedDurationMin: 60,
        ),
      ];
      final booking = saved(
        BookingPriceQuote.fromJson(quoteJson(vector)),
        currentKind: 'TIMED',
      );
      expect(booking.durationKind, 'VARIABLE');
      expect(booking.reservationLabel, 'Duration varies · Reserved 60 min');
      expect(
        Booking.fromJson({
          'id': '1',
          'durationMin': 60,
          'service': {'durationKind': 'VARIABLE'},
        }).durationKind,
        'TIMED',
      );
      expect(
        () => Booking.fromJson({
          'id': '1',
          'durationMin': 60,
          'durationKind': 'VARIABLE',
          'items': [],
        }),
        throwsFormatException,
      );
      expect(
        () => BookingItem.fromJson({
          'id': '1',
          'durationMin': 60,
          'reservedDurationMin': 60,
          'durationKindSnapshot': 'VARIABLE',
          'durationKind': 'TIMED',
        }),
        throwsFormatException,
      );
      expect(
        () => BookingItem.fromJson({
          'id': '1',
          'durationMin': 60,
          'reservedDurationMin': 30,
          'durationKind': 'VARIABLE',
        }),
        throwsFormatException,
      );
    },
  );
  test(
    'unknown non-TIMED request replays original accepted type block and key after expiry and current kind change',
    () async {
      final repo = DurationRepository(studio('VARIABLE'))
            ..lose = true
            ..quoteTtl = const Duration(milliseconds: 300),
          flow = await select(repo);
      addTearDown(flow.dispose);
      await flow.refreshPriceQuote();
      expect(await flow.confirmBooking(), isNull);
      final payload = jsonEncode(repo.writes.single),
          original = flow.state.pendingAttempt!;
      repo.catalog = studio('TIMED');
      repo.disabled = true;
      flow.initFlow(repo.catalog);
      expect(flow.state.selectedDurationKind, 'VARIABLE');
      await Future<void>.delayed(const Duration(milliseconds: 350));
      expect(flow.state.priceQuote, isNull);
      final booking = await flow.retryOriginalRequest();
      expect(booking!.durationKind, 'VARIABLE');
      expect(jsonEncode(repo.writes.last), payload);
      expect(booking.durationMin, original.quote!.durationMin);
      expect(repo.quoteReads, 1);
    },
  );
  testWidgets(
    'catalog and wizard expose type and Reserved blocks without pretending the treatment has a fixed duration',
    (tester) async {
      final shop = studio('PER_SESSION');
      Widget app(Widget child) => MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: child,
      );
      Future<void> tapVisible(Finder finder) async {
        await tester.ensureVisible(finder);
        await tester.pumpAndSettle();
        expect(finder.hitTestable(), findsOneWidget);
        await tester.tap(finder);
        await tester.pumpAndSettle();
      }

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            shopDetailProvider('7').overrideWith((ref) async => shop),
            shopReviewsProvider('7').overrideWith((ref) async => []),
            favoritesProvider.overrideWith(
              (ref) => FavoritesNotifier(ApiService()),
            ),
          ],
          child: app(const ShopDetailScreen(shopId: '7', shopName: 'Studio')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Per session'), findsOneWidget);
      expect(find.text('60 min'), findsNothing);
      final repo = DurationRepository(shop);
      await tester.pumpWidget(
        ProviderScope(
          key: const ValueKey('duration-booking-scope'),
          overrides: [bookingRepositoryProvider.overrideWithValue(repo)],
          child: app(BookingScreen(shop: shop)),
        ),
      );
      await tester.pumpAndSettle();
      final flow = ProviderScope.containerOf(
        tester.element(find.byType(BookingScreen)),
      ).read(bookingFlowProvider.notifier);
      await tapVisible(find.text('Primary care').first);
      expect(flow.state.selectedService?.id, '8');
      expect(find.text('Per session'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tapVisible(
        find.widgetWithText(FilledButton, 'Choose Therapist \u2192'),
      );
      await tapVisible(
        find.widgetWithText(FilledButton, 'Choose Date & Time \u2192'),
      );
      await tapVisible(find.text('Today'));
      expect(flow.state.selectedDate, isNotNull);
      await tapVisible(find.byType(ChoiceChip).first);
      expect(flow.state.selectedStartTime, '10:00');
      expect(flow.state.hasSelection, isTrue);
      expect(flow.state.selectedDuration, 60);
      expect(find.text('Per session \u00b7 Reserved 60 min'), findsWidgets);
      expect(find.text(flow.state.selectedReservationWindow), findsWidgets);
      await tapVisible(
        find.widgetWithText(FilledButton, 'Contact & confirm \u2192'),
      );
      expect(find.text('Per session \u00b7 Reserved 60 min'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'quote panel separates mixed reserved span and individual type blocks on a narrow screen',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final vector = [
        const MainDuration(
          participantIndex: 1,
          sequence: 1,
          serviceId: '8',
          variantId: null,
          durationKind: 'PER_SESSION',
          reservedDurationMin: 60,
        ),
        const MainDuration(
          participantIndex: 2,
          sequence: 1,
          serviceId: '9',
          variantId: null,
          durationKind: 'VARIABLE',
          reservedDurationMin: 30,
        ),
      ];
      final q = BookingPriceQuote.fromJson(quoteJson(vector, span: 60));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: BookingPriceQuotePanel(
                quote: q,
                loading: false,
                onRefresh: () {},
              ),
            ),
          ),
        ),
      );
      expect(
        find.text('Mixed services · Reserved visit span 60 min'),
        findsOneWidget,
      );
      expect(
        find.textContaining(
          'Guest 1 · Service 1: Per session · Reserved 60 min',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining(
          'Guest 2 · Service 1: Duration varies · Reserved 30 min',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'payment uses saved reservation type and shop-time window rather than the current parent type',
    (tester) async {
      final vector = [
        const MainDuration(
          participantIndex: 1,
          sequence: 1,
          serviceId: '8',
          variantId: null,
          durationKind: 'VARIABLE',
          reservedDurationMin: 60,
        ),
      ];
      final quote = BookingPriceQuote.fromJson(quoteJson(vector)),
          booking = saved(
            BookingPriceQuote.fromJson(quoteJson(vector)),
            currentKind: 'TIMED',
          );
      final snapshot = {
        'id': '42',
        'shopId': '7',
        'priceCents': 5000,
        'mainSubtotalCents': 5000,
        'addOnSubtotalCents': 0,
        'addOns': [],
        'onlinePaymentEnabled': true,
        'orderOnly': false,
        'durationMin': 60,
        'reservedDurationMin': 60,
        'durationKind': 'VARIABLE',
        'currency': 'usd',
        'status': 'PENDING',
        'paymentStatus': 'UNPAID',
        'timezone': 'America/New_York',
        'localStartTime': '10:00',
        'localEndTime': '11:00',
        'service': {'id': '8', 'durationKind': 'TIMED', 'durationMin': 120},
        'items': [
          {
            'id': '60',
            ...vector.single.toJson(),
            'durationMin': 60,
            'durationKindSnapshot': 'VARIABLE',
            'serviceNameSnapshot': 'Historical service',
          },
        ],
      };
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            paymentCheckoutApiProvider.overrideWithValue(
              DurationPaymentApi(quote, snapshot),
            ),
          ],
          child: MaterialApp(
            home: PaymentScreen(booking: booking, shop: studio('TIMED')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Duration varies · Reserved 60 min'), findsOneWidget);
      expect(
        find.text('Reservation window: 10:00 - 11:00 (America/New_York)'),
        findsOneWidget,
      );
      expect(
        find.text('Guest 1 · Service 1: Duration varies · Reserved 60 min'),
        findsOneWidget,
      );
      expect(find.textContaining('120 min'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
