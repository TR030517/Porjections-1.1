import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_quote_fixture.dart';
import 'booking_timed_recovery_test.dart' as timed;

typedef ChangeReceipt = void Function(Map<String, dynamic> receipt);

ShopDetail intentShop({int guests = 1, int staff = 1}) {
  final service = {
    'id': '8', 'name': 'Massage', 'durationMin': 60, 'priceCents': 8000,
    'priceBasis': 'PER_BOOKING', 'participantCount': guests,
    'requiredStaffCount': staff,
  };
  return ShopDetail.fromJson({
    'id': '7', 'name': 'Intent studio', 'latitude': 0, 'longitude': 0,
    'timezone': 'America/New_York', 'services': [service],
    'paymentPolicy': {'payAtStoreEnabled': true},
    'therapists': [for (final id in ['20', '21']) {'id': id, 'name': 'Staff $id', 'services': [service]}],
  });
}

class IntentRepository extends timed.TimedRepository {
  final int guests, staff;
  bool loseFirst = false;
  ChangeReceipt? mutate;
  IntentRepository({this.guests = 1, this.staff = 1});

  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> selection) async =>
      accepted = BookingPriceQuote.fromJson(timedQuoteJson(selection, price: 8000, participants: guests));

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> selection) async {
    writes.add(Map<String, dynamic>.from(jsonDecode(jsonEncode(selection)) as Map));
    if (loseFirst && writes.length == 1) throw timed.lost();
    final json = quotedBookingJson(selection, accepted!, requiredStaffCount: staff, extra: {'userId': '41'});
    mutate?.call(json);
    return Booking.fromJson(json);
  }
}

class IntentPlanRepository extends timed.TimedPlanRepository {
  bool loseFirst = false;
  ChangeReceipt? mutate;
  @override
  Future<Booking> create(Map<String, dynamic> selection) async {
    writes.add(Map<String, dynamic>.from(jsonDecode(jsonEncode(selection)) as Map));
    if (loseFirst && writes.length == 1) throw timed.lost();
    final json = quotedBookingJson(selection, accepted!, extra: {'userId': '41'});
    mutate?.call(json);
    return Booking.fromJson(json);
  }
}

Future<void> selectStandard(BookingFlowNotifier flow, ShopDetail shop, {bool specific = false}) async {
  flow.initFlow(shop);
  flow.selectService(shop.services.single);
  if (specific) flow.selectTherapist(shop.therapists.first);
  flow.selectDate(DateTime(2031, 5, 1));
  await timed.waitForTimedSlots(flow);
  flow.toggleTimeSlot('10:00');
  flow.selectPaymentMode('PAY_AT_STORE');
  await flow.refreshPriceQuote();
}

Future<void> selectPlan(BookingPlanNotifier flow) async {
  flow.selectService(0, 0, '8');
  flow.addParticipant();
  flow.selectService(1, 0, '8');
  flow.selectTherapist(0, 0, '20');
  flow.selectTherapist(1, 0, '21');
  flow.selectDate('2031-05-01');
  await flow.loadSlots();
  flow.selectTime('10:00');
  flow.setPaymentMode('PAY_AT_STORE');
  await flow.refreshPriceQuote();
}

void setIntent(Map<String, dynamic> row, List<String> ids) {
  row['therapistSelectionMode'] = ids.isEmpty ? 'AUTO' : 'SPECIFIC';
  row['requestedTherapistIds'] = ids;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  for (final retry in [false, true]) {
    for (final caseInfo in [
      (name: 'AUTO replaced by SPECIFIC', guests: 1, staff: 1, specific: false, change: (Map<String,dynamic> json) => setIntent(json, ['20'])),
      (name: 'requested therapist replaced', guests: 1, staff: 1, specific: true, change: (Map<String,dynamic> json) => setIntent(json, ['21'])),
      (name: 'missing original selection evidence', guests: 1, staff: 1, specific: false, change: (Map<String,dynamic> json) {json.remove('therapistSelectionMode'); json.remove('requestedTherapistIds');}),
      (name: 'STANDARD row selection changed', guests: 1, staff: 1, specific: true, change: (Map<String,dynamic> json) => setIntent((json['items'] as List).first as Map<String,dynamic>, [])),
      (name: 'couples guest count changed', guests: 2, staff: 2, specific: false, change: (Map<String,dynamic> json) {json['participantCount'] = 1;}),
      (name: 'four hands staff count changed', guests: 1, staff: 2, specific: false, change: (Map<String,dynamic> json) {json['requiredStaffCount'] = 1;}),
      (name: 'four hands row staff count changed', guests: 1, staff: 2, specific: false, change: (Map<String,dynamic> json) {((json['items'] as List).first as Map)['requiredStaffCount'] = 1;}),
    ]) {
      test('STANDARD ${retry ? 'recovery' : 'creation'} rejects ${caseInfo.name}', () async {
        final repo = IntentRepository(guests: caseInfo.guests, staff: caseInfo.staff)..loseFirst = retry;
        final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        addTearDown(flow.dispose);
        await selectStandard(flow, intentShop(guests: caseInfo.guests, staff: caseInfo.staff), specific: caseInfo.specific);
        if (retry) expect(await flow.confirmBooking(), isNull);
        repo.mutate = caseInfo.change;
        expect(await (retry ? flow.retryOriginalRequest() : flow.confirmBooking()), isNull);
        expect(flow.state.pendingAttempt, isNotNull);
        expect(hasBookingRecoveryMarker(), isTrue);
        final previous = repo.writes.length;
        expect(await flow.confirmBooking(), isNull);
        expect(repo.writes, hasLength(previous));
        repo.mutate = null;
        expect((await flow.retryOriginalRequest())?.id, '42');
        expect(repo.writes.every((row) => jsonEncode(row) == jsonEncode(repo.writes.first)), isTrue);
        expect(flow.state.pendingAttempt, isNull);
        expect(hasBookingRecoveryMarker(), isFalse);
      });
    }

    for (final mismatch in <String,ChangeReceipt>{
      'same aggregate but switched guest therapists': (json) {
        final items = json['items'] as List;
        setIntent(items[0] as Map<String,dynamic>, ['21']);
        setIntent(items[1] as Map<String,dynamic>, ['20']);
      },
      'specific row changed to AUTO': (json) => setIntent((json['items'] as List).first as Map<String,dynamic>, []),
      'incorrect total staff count': (json) {json['requiredStaffCount'] = 1;},
      'incorrect PLAN row staff count': (json) {((json['items'] as List).first as Map)['requiredStaffCount'] = 2;},
    }.entries) {
      test('PLAN ${retry ? 'recovery' : 'creation'} rejects ${mismatch.key}', () async {
        final repo = IntentPlanRepository()..loseFirst = retry;
        final flow = BookingPlanNotifier(intentShop(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
        addTearDown(flow.dispose);
        await selectPlan(flow);
        if (retry) expect(await flow.confirm(), isNull);
        repo.mutate = mismatch.value;
        expect(await (retry ? flow.retryOriginalRequest() : flow.confirm()), isNull);
        expect(flow.state.pendingAttempt, isNotNull);
        expect(hasBookingRecoveryMarker(), isTrue);
        final previous = repo.writes.length;
        expect(await flow.confirm(), isNull);
        expect(repo.writes, hasLength(previous));
        repo.mutate = null;
        expect((await flow.retryOriginalRequest())?.id, '42');
        expect(repo.writes.every((row) => jsonEncode(row) == jsonEncode(repo.writes.first)), isTrue);
        expect(flow.state.pendingAttempt, isNull);
        expect(hasBookingRecoveryMarker(), isFalse);
      });
    }
  }

  test('AUTO receipt may assign any eligible staff and FOUR_HANDS still records one guest', () async {
    final repo = IntentRepository(staff: 2)..mutate = (json) {
      ((json['items'] as List).first as Map)['assignedTherapistIds'] = ['21', '20'];
    };
    final flow = BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    await selectStandard(flow, intentShop(staff: 2));
    final result = await flow.confirmBooking();
    expect(result?.id, '42');
    expect(result?.items.single.assignedTherapistIds, ['21', '20']);
  });

  test('PLAN aggregate therapist set and receipt row order are order independent', () async {
    final repo = IntentPlanRepository()..mutate = (json) {
      json['requestedTherapistIds'] = ['21', '20'];
      json['items'] = (json['items'] as List).reversed.toList();
    };
    final flow = BookingPlanNotifier(intentShop(), repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    addTearDown(flow.dispose);
    await selectPlan(flow);
    expect((await flow.confirm())?.id, '42');
  });
}
