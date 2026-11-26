import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/payment_quote.dart';
import 'package:mjapp_client/models/coupon.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/booking_add_ons.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'booking_quote_fixture.dart';

ShopDetail shop({bool couple = false}) => ShopDetail.fromJson({
  'id': '7', 'name': 'Studio', 'latitude': 0, 'longitude': 0,
  'onlinePaymentEnabled': true, 'orderOnly': false, 'pricingPolicy': 'LEGACY',
  'features': {'onlineBooking': true}, 'paymentPolicy': {'payAtStoreEnabled': true},
  'services': [
    {'id': '8', 'name': 'Massage', 'durationMin': 60, 'priceCents': 5000,
      'participantCount': couple ? 2 : 1, 'addOns': [
        {'id': '10', 'serviceId': '8', 'name': 'Oil', 'description': 'Only with massage', 'priceCents': 1000, 'currency': 'usd', 'isActive': true},
        {'id': '12', 'serviceId': '8', 'name': 'Included towel', 'priceCents': 0, 'currency': 'usd', 'isActive': true},
      ]},
    {'id': '9', 'name': 'Foot care', 'durationMin': 30, 'priceCents': 4000, 'addOns': [
      {'id': '11', 'serviceId': '9', 'name': 'Scrub', 'priceCents': 500, 'currency': 'usd', 'isActive': true},
    ]},
  ],
});

BookingPlanQuote planSlots(Map<String,dynamic> request) {
  final offsets = <int,int>{}, rows = <Map<String,dynamic>>[];
  for (final value in request['items'] as List) {
    final row = Map<String,dynamic>.from(value as Map), p = row['participantIndex'] as int;
    final duration = row['serviceId'] == '8' ? 60 : 30;
    rows.add({...row, 'serviceName': row['serviceId'] == '8' ? 'Massage' : 'Foot care',
      'durationMin': duration, 'offsetMin': offsets[p] ?? 0, 'preparationMin': 0,
      'priceCents': row['serviceId'] == '8' ? 5000 : 4000, 'currency': 'usd'});
    offsets[p] = (offsets[p] ?? 0) + duration;
  }
  return BookingPlanQuote.fromJson({'date': request['date'], 'timezone': 'America/New_York',
    'durationMin': offsets.values.reduce((a,b) => a > b ? a : b), 'participantCount': offsets.length,
    'priceCents': rows.fold<int>(0,(sum,row) => sum + (row['priceCents'] as int)),
    'items': rows, 'slots': [{'time': '10:00', 'available': true}]});
}

Map<String,dynamic> quoteJson(Map<String,dynamic> request, {bool plan = false, bool couple = false, bool expired = false}) {
  final lines = <Map<String,dynamic>>[];
  for (final row in request['addOnSelections'] as List? ?? const []) {
    for (final id in row['addOnIds'] as List) {
      final cents = id == '11' ? 500 : id == '12' ? 0 : 1000;
      lines.add({'sourceAddOnId': id, 'participantIndex': row['participantIndex'], 'sequence': row['sequence'],
        'name': id == '11' ? 'Scrub snapshot' : id == '12' ? 'Towel snapshot' : 'Oil snapshot',
        'unitPriceCents': cents, 'quantity': 1, 'lineTotalCents': cents, 'currency': 'usd'});
    }
  }
  final slot = plan ? planSlots(request) : null;
  final main = slot?.priceCents ?? (couple ? 10000 : 5000), extra = lines.fold<int>(0, (sum,row) => sum + (row['lineTotalCents'] as int));
  final tip = request['tipCents'] as int? ?? 0, discount = request['couponId'] == null ? 0 : 2000;
  final primary = plan ? [for (final row in slot!.items) {'participantIndex':row.participantIndex,'sequence':row.sequence,'serviceId':row.serviceId,'variantId':row.variantId,'durationKind':row.durationKind,'reservedDurationMin':row.durationMin}]
    : [for(var guest=1;guest<=(couple?2:1);guest++) {'participantIndex':guest,'sequence':1,'serviceId':request['serviceId']??'8','variantId':request['variantId'],'durationKind':'TIMED','reservedDurationMin':60}];
  return {'shopId': '7', 'currency': 'usd', 'mainSubtotalCents': main, 'addOnSubtotalCents': extra,
    'subtotalCents': main + extra, 'discountEligibleCents': main, 'discountCents': discount, 'platformFeeCents': 0,
    'tipCents': tip, 'totalCents': main + extra + tip - discount, 'durationMin': slot?.durationMin ?? 60,
    'addOns': lines, 'durationKind':'TIMED','reservedDurationMin':slot?.durationMin??60,'mainDurations':primary, 'quoteHash': 'a' * 64,
    'quoteExpiresAt': DateTime.now().toUtc().add(Duration(minutes: expired ? -1 : 5)).toIso8601String()};
}

Booking saved(Map<String,dynamic> request, {bool plan = false, bool couple = false}) {
  final q = quoteJson(request, plan: plan, couple: couple),primary=q['mainDurations'] as List;
  final metadata=quotedBookingJson(request,BookingPriceQuote.fromJson(q));
  final items=[for(var i=0;i<primary.length;i++) {...(metadata['items'] as List)[i], 'id':'${60+i}',...primary[i],
    'durationMin':primary[i]['reservedDurationMin'],'durationKindSnapshot':primary[i]['durationKind'],
    'serviceNameSnapshot':'Saved main service','priceCentsSnapshot':plan&&primary[i]['serviceId']=='9'?4000:5000}];
  return Booking.fromJson({...metadata,'id': '42', 'shopId': '7', 'reservationKind': plan ? 'PLAN' : 'STANDARD',
    'localDate':request['date'],'localStartTime':request['startTime'],
    'priceCents': q['subtotalCents'], 'mainSubtotalCents': q['mainSubtotalCents'], 'addOnSubtotalCents': q['addOnSubtotalCents'],
    'totalCents': q['totalCents'], 'currency': 'usd', 'durationMin': q['durationMin'],
    'durationKind':q['durationKind'],'reservedDurationMin':q['reservedDurationMin'],'items':items,
    'addOns': [for (var i=0;i<(q['addOns'] as List).length;i++) {...(q['addOns'] as List)[i], 'id': '${50+i}',
      'bookingItemId':'${60+primary.indexWhere((row)=>row['participantIndex']==(q['addOns'] as List)[i]['participantIndex']&&row['sequence']==(q['addOns'] as List)[i]['sequence'])}'}]});
}

class StandardRepository extends BookingRepository {
  StandardRepository({this.couple = false}) : super(ApiService());
  final bool couple;
  final quotes = <Map<String,dynamic>>[], writes = <Map<String,dynamic>>[];
  final pending = <Completer<BookingPriceQuote>>[];
  bool hold = false, failNext = false, conflict = false;
  @override
  Future<SlotResponse> getSlots({required String shopId,required String serviceId,String? therapistId,String? variantId,List<String>? preferredTherapistIds,required String date}) async =>
    SlotResponse(date: date, slots: [TimeSlot(time: '10:00', available: true)]);
  @override
  Future<BookingPriceQuote> quote(Map<String,dynamic> selection) async {
    quotes.add(selection);
    if (hold) { final task = Completer<BookingPriceQuote>(); pending.add(task); return task.future; }
    return BookingPriceQuote.fromJson(quoteJson(selection, couple: couple));
  }
  @override
  Future<Booking> createBookingWithAddOns(Map<String,dynamic> selection) async {
    writes.add(selection);
    if (failNext || conflict) {
      final status = conflict ? 409 : null; failNext = false;
      throw DioException(requestOptions: RequestOptions(path: '/bookings'),
        response: status == null ? null : Response(requestOptions: RequestOptions(path: '/bookings'), statusCode: status),
        type: status == null ? DioExceptionType.connectionTimeout : DioExceptionType.badResponse);
    }
    return saved(selection, couple: couple);
  }
}

Future<BookingFlowNotifier> standard(StandardRepository repository) async {
  final flow = BookingFlowNotifier(repository, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123'), s = shop(couple: repository.couple);
  flow.onCustomerChanged(null,'41');flow.initFlow(s);flow.selectService(s.services.first);flow.selectDate(DateTime(2031,5,1));
  await Future<void>.delayed(Duration.zero);flow.toggleTimeSlot('10:00');return flow;
}

class PlanRepository extends BookingPlanRepository {
  PlanRepository() : super(ApiService());
  final quotes = <Map<String,dynamic>>[], writes = <Map<String,dynamic>>[];
  @override
  Future<BookingPlanQuote> slots(Map<String,dynamic> request) async => planSlots(request);
  @override
  Future<BookingPriceQuote> priceQuote(Map<String,dynamic> request) async { quotes.add(request);return BookingPriceQuote.fromJson(quoteJson(request,plan:true)); }
  @override
  Future<Booking> create(Map<String,dynamic> request) async {writes.add(request);return saved(request,plan:true);}
}

DioException lostResponse(String path, [int? status]) => DioException(requestOptions:RequestOptions(path:path),
  response:status==null?null:Response(requestOptions:RequestOptions(path:path),statusCode:status),
  type:status==null?DioExceptionType.connectionTimeout:DioExceptionType.badResponse);
class RecoveryStandardRepository extends StandardRepository {
  RecoveryStandardRepository({this.persistFirst=true});
  final bool persistFirst;
  bool disabled=false;
  Booking? originalBooking;
  @override
  Future<BookingPriceQuote> quote(Map<String,dynamic> request) async {
    quotes.add(request);if(disabled)throw StateError('Configuration disabled');
    return BookingPriceQuote.fromJson({...quoteJson(request),'quoteExpiresAt':DateTime.now().toUtc().add(const Duration(milliseconds:300)).toIso8601String()});
  }
  @override
  Future<Booking> createBookingWithAddOns(Map<String,dynamic> request) async {
    writes.add(request);
    if(writes.length==1){if(persistFirst)originalBooking=saved(request);throw lostResponse('/bookings');}
    if(originalBooking!=null)return originalBooking!;
    throw lostResponse('/bookings',409);
  }
}
class RecoveryPlanRepository extends PlanRepository {
  RecoveryPlanRepository({this.persistFirst=true});
  final bool persistFirst;
  bool disabled=false;
  Booking? originalBooking;
  @override
  Future<BookingPriceQuote> priceQuote(Map<String,dynamic> request) async {
    quotes.add(request);if(disabled)throw StateError('Configuration disabled');
    return BookingPriceQuote.fromJson({...quoteJson(request,plan:true),'quoteExpiresAt':DateTime.now().toUtc().add(const Duration(milliseconds:300)).toIso8601String()});
  }
  @override
  Future<Booking> create(Map<String,dynamic> request) async {
    writes.add(request);
    if(writes.length==1){if(persistFirst)originalBooking=saved(request,plan:true);throw lostResponse('/bookings/plan',503);}
    if(originalBooking!=null)return originalBooking!;
    throw lostResponse('/bookings/plan',409);
  }
}
Future<void> preparePlan(BookingPlanNotifier flow) async {
  flow.onCustomerChanged(null,'41');flow.selectService(0,0,'8');flow.toggleAddOn(0,0,'10',true);
  flow.selectDate('2031-05-01');await Future<void>.delayed(Duration.zero);flow.selectTime('10:00');await flow.refreshPriceQuote();
}

class QuoteTransport implements HttpClientAdapter {
  final calls = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options,Stream<Uint8List>? stream,Future<void>? cancelFuture) async {
    await stream?.drain<void>();calls.add(options);
    return ResponseBody.fromString(jsonEncode(options.path == '/bookings' ? {'id':'42'} : quoteJson(Map<String,dynamic>.from(options.data as Map))),200,
      headers:{Headers.contentTypeHeader:['application/json']});
  }
  @override
  void close({bool force = false}) {}
}

void main() {
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);
  test('public add-ons require the exact main service active USD integers and never make an independent bookable service', () {
    final service = shop().services.first;
    expect(service.addOns.map((row) => row.id), ['10','12']);
    expect(shop().services.length,2);expect(service.durationMin,60);
    for (final bad in [
      {'id':'10','serviceId':'9','name':'Oil','currency':'usd','priceCents':100},
      {'id':'10','serviceId':'8','name':'Oil','currency':'eur','priceCents':100},
      {'id':'10','serviceId':'8','name':'Oil','currency':'usd','priceCents':1.5},
      {'id':'10','serviceId':'8','name':'Oil','currency':'usd','priceCents':'100'},
    ]) { expect(ShopServiceAddOn.parseList([bad],'8'),isEmpty); }
    expect(ShopServiceAddOn.parseList([{'id':'10','serviceId':'8','name':'Oil','currency':'usd','priceCents':100,'isActive':false}],'8'),isEmpty);
  });

  test('quote validation binds coordinates main-only discount basis integer totals and quantity one', () {
    final request={'addOnSelections':[{'participantIndex':2,'sequence':1,'addOnIds':['10']}]};
    final json=quoteJson(request,couple:true),q=BookingPriceQuote.fromJson(json);
    expect(q.totalCents,11000);expect(q.durationMin,60);expect(q.discountEligibleCents,10000);
    expect(q.matches('7',60,[const BookingAddOnSelection(participantIndex:2,sequence:1,addOnIds:['10'])]),isTrue);
    expect(q.matches('7',60,[const BookingAddOnSelection(participantIndex:1,sequence:1,addOnIds:['10'])]),isFalse);
    expect(q.matches('9',60,[const BookingAddOnSelection(participantIndex:2,sequence:1,addOnIds:['10'])]),isFalse);
    for (final patch in [
      {'discountEligibleCents':11000},{'subtotalCents':11001},{'totalCents':11001},
      {'mainSubtotalCents':10000.5},{'currency':'eur'},{'quoteHash':'x'},
      {'addOns':[{...(json['addOns'] as List).single,'quantity':2}]},
      {'addOns':[{...(json['addOns'] as List).single,'unitPriceCents':999}]},
    ]) { expect(() => BookingPriceQuote.fromJson({...json,...patch}),throwsFormatException); }
    final discounted=BookingPriceQuote.fromJson({...json,'discountCents':10000,'totalCents':1000});
    expect(discounted.totalCents,1000,reason:'the add-on remains payable even when the whole main service is discounted');
    expect(BookingPriceQuote.fromJson(quoteJson(request,couple:true,expired:true)).expired,isTrue);
  });

  test('couple selections attach to one guest only, keep main duration and require explicit signed quote before one create', () async {
    final repo=StandardRepository(couple:true),flow=await standard(repo);addTearDown(flow.dispose);
    flow.toggleAddOn(2,'10',true);expect(flow.state.selectedDuration,60);expect(flow.state.selectedEndTime,'11:00');
    expect(await flow.confirmBooking(),isNull);expect(repo.writes,isEmpty);
    await flow.refreshPriceQuote();expect(flow.state.canConfirm,isTrue);expect(flow.state.priceQuote!.totalCents,11000);
    final result=await flow.confirmBooking();expect(result!.addOns.single.participantIndex,2);expect(result.addOns.single.name,'Oil snapshot');
    expect(repo.writes,hasLength(1));final request=repo.writes.single;
    expect(request['addOnSelections'],[{'participantIndex':2,'sequence':1,'addOnIds':['10']}]);
    expect(request['quoteHash'],'a'*64);expect((request['requestKey'] as String).length,32);
    expect(request.containsKey('quantity'),isFalse);expect(request.containsKey('priceCents'),isFalse);
    await flow.confirmBooking();expect(repo.writes,hasLength(1));
  });

  test('late quote is ignored after selection changes and removing an add-on clears the quote without changing time', () async {
    final repo=StandardRepository()..hold=true,flow=await standard(repo);addTearDown(flow.dispose);
    flow.toggleAddOn(1,'10',true);final request=flow.refreshPriceQuote();await Future<void>.delayed(Duration.zero);
    flow.toggleAddOn(1,'10',false);repo.pending.single.complete(BookingPriceQuote.fromJson(quoteJson(repo.quotes.single)));await request;
    expect(flow.state.priceQuote,isNull);expect(flow.state.hasAddOns,isFalse);expect(flow.state.selectedStartTime,'10:00');expect(repo.writes,isEmpty);
  });

  test('network uncertainty retains request key while a changed selection replaces it and 409 never auto retries', () async {
    final repo=StandardRepository()..failNext=true,flow=await standard(repo);addTearDown(flow.dispose);
    flow.toggleAddOn(1,'10',true);await flow.refreshPriceQuote();expect(await flow.confirmBooking(),isNull);
    final original=repo.writes.single['requestKey'];await flow.retryOriginalRequest();
    expect(repo.writes[1]['requestKey'],original);expect(repo.writes,hasLength(2));
    flow.toggleAddOn(1,'12',true);await flow.refreshPriceQuote();repo.conflict=true;expect(await flow.confirmBooking(),isNull);
    expect(repo.writes[2]['requestKey'],isNot(original));expect(flow.state.priceQuote,isNull);expect(flow.state.error,contains('no automatic retry'));
    await flow.confirmBooking();expect(repo.writes,hasLength(3));
  });

  test('date payment and customer changes clear price quote and do not silently recalculate or submit', () async {
    final repo=StandardRepository(),flow=await standard(repo);addTearDown(flow.dispose);
    flow.toggleAddOn(1,'10',true);await flow.refreshPriceQuote();flow.selectPaymentMode('PAY_AT_STORE');expect(flow.state.priceQuote,isNull);
    await flow.refreshPriceQuote();flow.selectDate(DateTime(2031,5,2));expect(flow.state.priceQuote,isNull);expect(flow.state.selectedStartTime,isNull);
    await Future<void>.delayed(Duration.zero);flow.toggleTimeSlot('10:00');await flow.refreshPriceQuote();flow.onCustomerChanged(null,'40');expect(flow.state.priceQuote,isNull);
    expect(flow.state.addOnIdsFor(1),['10']);expect(repo.writes,isEmpty);
  });

  test('coupon changes discard old signed totals while keeping add-ons outside coupon eligibility', () async {
    final repo=StandardRepository(),flow=await standard(repo);addTearDown(flow.dispose);
    flow.toggleAddOn(1,'10',true);await flow.refreshPriceQuote();
    flow.selectCoupon(UserCoupon.fromJson({'id':'20','coupon':{'title':'Main services coupon'}}));
    expect(flow.state.priceQuote,isNull);expect(flow.state.canConfirm,isFalse);
    expect(repo.writes,isEmpty);await flow.refreshPriceQuote();
    expect(repo.quotes.last['couponId'],'20');expect(flow.state.priceQuote!.discountEligibleCents,5000);
    expect(flow.state.priceQuote!.subtotalCents,6000);flow.selectCoupon(null);expect(flow.state.priceQuote,isNull);
  });

  testWidgets('quote expiry invalidates confirmation and never starts an automatic booking or quote refresh', (tester) async {
    final repo=StandardRepository(),flow=BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123'),s=shop();
    flow.initFlow(s);flow.selectService(s.services.first);flow.selectDate(DateTime(2031,5,1));
    await tester.pump();flow.toggleTimeSlot('10:00');flow.toggleAddOn(1,'10',true);
    await flow.refreshPriceQuote();expect(flow.state.canConfirm,isTrue);
    await tester.pump(const Duration(minutes:6));
    expect(flow.state.priceQuote,isNull);expect(flow.state.canConfirm,isFalse);expect(flow.state.error,contains('expired'));
    expect(repo.quotes,hasLength(1));expect(repo.writes,isEmpty);expect(await flow.confirmBooking(),isNull);
    flow.dispose();
  });

  test('PLAN add-ons follow the correct guest and primary segment through a reorder and never enter resource items', () async {
    final repo=PlanRepository(),flow=BookingPlanNotifier(shop(),repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    flow.onCustomerChanged(null,'41');
    flow.selectService(0,0,'8');flow.addStage(0);flow.selectService(0,1,'9');flow.addParticipant();flow.selectService(1,0,'8');
    flow.toggleAddOn(0,1,'11',true);flow.toggleAddOn(1,0,'10',true);
    flow.moveStage(0,1,-1);expect(flow.state.addOnSelections.first.sequence,1);expect(flow.state.addOnSelections.first.addOnIds,['11']);
    flow.selectDate('2031-05-01');await Future<void>.delayed(Duration.zero);flow.selectTime('10:00');
    expect(flow.state.quote!.durationMin,90);expect(await flow.confirm(),isNull);expect(repo.writes,isEmpty);
    await flow.refreshPriceQuote();expect(flow.state.priceQuote!.mainSubtotalCents,14000);expect(flow.state.priceQuote!.addOnSubtotalCents,1500);
    final booking=await flow.confirm();expect(booking,isNotNull,reason:flow.state.error);expect(booking!.addOns,hasLength(2));
    final request=repo.writes.single;expect(request['addOnSelections'],[
      {'participantIndex':1,'sequence':1,'addOnIds':['11']},{'participantIndex':2,'sequence':1,'addOnIds':['10']},
    ]);
    expect((request['items'] as List).every((row) => !row.containsKey('addOnIds') && !row.containsKey('priceCents')),isTrue);
    expect(flow.state.quote!.durationMin,90);expect(booking.durationMin,90);
  });

  test('PLAN tip and payment changes invalidate quote and stage removal cannot orphan attachments', () async {
    final repo=PlanRepository(),flow=BookingPlanNotifier(shop(),repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    flow.selectService(0,0,'8');flow.addStage(0);flow.selectService(0,1,'9');flow.toggleAddOn(0,1,'11',true);
    flow.selectDate('2031-05-01');await Future<void>.delayed(Duration.zero);flow.selectTime('10:00');await flow.refreshPriceQuote();
    flow.setTipCents(123);expect(flow.state.priceQuote,isNull);await flow.refreshPriceQuote();expect(flow.state.priceQuote!.tipCents,123);
    flow.setPaymentMode('PAY_AT_STORE');expect(flow.state.priceQuote,isNull);await flow.refreshPriceQuote();
    flow.removeStage(0,1);expect(flow.state.hasAddOns,isFalse);expect(flow.state.priceQuote,isNull);expect(repo.writes,isEmpty);
  });

  test('saved snapshots and payment breakdown retain historical wording and never use a current catalog price', () {
    final request={'addOnSelections':[{'participantIndex':1,'sequence':1,'addOnIds':['10']}]};
    final booking=saved(request);expect(booking.addOns.single.name,'Oil snapshot');expect(booking.mainSubtotalCents,5000);expect(booking.addOnSubtotalCents,1000);
    final q=quoteJson(request);final payment=PaymentQuote.fromJson({...q,'paymentEnabled':false});expect(payment.addOns.single.name,'Oil snapshot');expect(payment.mainSubtotalCents,5000);expect(payment.addOnSubtotalCents,1000);
    expect(Booking.fromJson({'id':'1','priceCents':5000}).addOns,isEmpty);expect(PaymentQuote.fromJson({'subtotalCents':5000,'discountCents':0,'platformFeeCents':0,'totalCents':5000,'currency':'usd'}).addOns,isEmpty);
  });

  test('real API transport uses authenticated quote endpoints and does not emit client amounts or quantity in selection', () async {
    final api=ApiService(),transport=QuoteTransport(),original=ApiService().dio.httpClientAdapter;
    addTearDown(() => api.dio.httpClientAdapter=original);api.dio.httpClientAdapter=transport;
    final selection={'shopId':'7','serviceId':'8','date':'2031-05-01','startTime':'10:00','paymentMode':'ONLINE',
      'addOnSelections':[{'participantIndex':1,'sequence':1,'addOnIds':['10']}]};
    await api.getBookingQuote(selection);await api.getBookingQuote({'shopId':'7','date':'2031-05-01','startTime':'10:00','items':[{'participantIndex':1,'sequence':1,'serviceId':'8'}],'addOnSelections':selection['addOnSelections']},plan:true);await api.createQuotedBooking({...selection,'requestKey':'a'*32,'quoteHash':'b'*64,'quoteExpiresAt':DateTime.now().toUtc().add(const Duration(minutes:5)).toIso8601String()});
    expect(transport.calls.map((row) => row.path),['/bookings/quote','/bookings/plan-quote','/bookings']);
    expect(transport.calls.every((row) => row.extra['publicRead'] != true),isTrue);
    final attachment=((transport.calls.last.data as Map)['addOnSelections'] as List).single as Map;
    expect(attachment.keys.toSet(),{'participantIndex','sequence','addOnIds'});
  });

  testWidgets('picker identifies guest and segment and saved quote is readable without a booking CTA', (tester) async {
    final selected=<String>[];
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:Column(children:[
      BookingAddOnPicker(available:shop().services.first.addOns,selected:const[],guest:2,segment:1,onChanged:(id,checked){if(checked)selected.add(id);}),
      BookingAddOnSummary(addOns:saved({'addOnSelections':[{'participantIndex':2,'sequence':1,'addOnIds':['10']}]}).addOns,saved:true),
    ])))));
    expect(find.text('Optional add-ons · Guest 2 · Service 1'),findsOneWidget);await tester.tap(find.byKey(const ValueKey('addon-2-1-10')));await tester.pump();expect(selected,['10']);
    expect(find.text('Guest 2 · Service 1: Oil snapshot'),findsOneWidget);expect(find.text('Book now'),findsNothing);expect(tester.takeException(),isNull);
  });
  test('STANDARD lost response survives expiry and disabled config through explicit identical original replay', () async {
    final repo=RecoveryStandardRepository(),flow=await standard(repo);addTearDown(flow.dispose);
    flow.toggleAddOn(1,'10',true);await flow.refreshPriceQuote();expect(await flow.confirmBooking(),isNull);
    final original=jsonEncode(repo.writes.single),attempt=flow.state.pendingAttempt!;
    final copy=attempt.payload;((copy['addOnSelections'] as List).single['addOnIds'] as List).clear();
    expect((attempt.payload['addOnSelections'] as List).single['addOnIds'],['10']);
    flow.toggleAddOn(1,'12',true);flow.reset();flow.initFlow(shop(couple:true));expect(flow.state.selectedService!.participantCount,1);
    expect(flow.state.addOnIdsFor(1),['10']);repo.disabled=true;
    await Future<void>.delayed(const Duration(milliseconds:350));expect(flow.state.priceQuote,isNull);
    await flow.refreshPriceQuote();expect(repo.quotes,hasLength(1));expect(await flow.confirmBooking(),isNull);
    expect(repo.writes,hasLength(1));final recovered=await flow.retryOriginalRequest();
    expect(recovered!.id,'42');expect(jsonEncode(repo.writes.last),original);expect(repo.writes,hasLength(2));
    expect(flow.state.pendingAttempt,isNull);expect(hasBookingRecoveryMarker(),isFalse);
  });

  test('STANDARD original replay with no saved booking and expired quote stops on 409 and rejects a changed actor', () async {
    final repo=RecoveryStandardRepository(persistFirst:false);var actor='41';
    final flow=BookingFlowNotifier(repo,currentCustomerId:()=>actor, currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    final s=shop();flow.initFlow(s);flow.selectService(s.services.first);flow.selectDate(DateTime(2031,5,1));await Future<void>.delayed(Duration.zero);flow.toggleTimeSlot('10:00');flow.toggleAddOn(1,'10',true);
    await flow.refreshPriceQuote();await flow.confirmBooking();final original=jsonEncode(repo.writes.single);
    await Future<void>.delayed(const Duration(milliseconds:350));repo.disabled=true;
    expect(await flow.retryOriginalRequest(),isNull);expect(repo.writes,hasLength(2));expect(jsonEncode(repo.writes.last),original);
    expect(flow.state.pendingAttempt,isNotNull);expect(flow.state.error,contains('no automatic retry'));
    actor='99';expect(await flow.retryOriginalRequest(),isNull);expect(repo.writes,hasLength(2));
    flow.onCustomerChanged('41','99');expect(flow.state.pendingAttempt,isNull);expect(flow.state.recoveryReminder,isTrue);
  });

  test('PLAN lost response preserves original coordinates quote and nonce after expiry without new quote or resources', () async {
    final repo=RecoveryPlanRepository(),flow=BookingPlanNotifier(shop(),repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    await preparePlan(flow);await flow.confirm();final original=jsonEncode(repo.writes.single);
    flow.addStage(0);flow.setTipCents(999);flow.toggleAddOn(0,0,'10',false);
    expect(flow.state.itemCount,1);expect(flow.state.tipCents,0);expect(flow.state.hasAddOns,isTrue);
    repo.disabled=true;await Future<void>.delayed(const Duration(milliseconds:350));await flow.refreshPriceQuote();
    expect(repo.quotes,hasLength(1));expect(await flow.confirm(),isNull);
    final booking=await flow.retryOriginalRequest();expect(booking!.id,'42');expect(jsonEncode(repo.writes.last),original);
    expect(repo.writes,hasLength(2));expect(flow.state.pendingAttempt,isNull);expect(hasBookingRecoveryMarker(),isFalse);
  });

  test('PLAN missing original booking returns 409 without replacing the attempt or allowing another actor to replay', () async {
    final repo=RecoveryPlanRepository(persistFirst:false);var actor='41';
    final flow=BookingPlanNotifier(shop(),repo,currentCustomerId:()=>actor, currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    await preparePlan(flow);await flow.confirm();final original=jsonEncode(repo.writes.single);
    repo.disabled=true;await Future<void>.delayed(const Duration(milliseconds:350));
    expect(await flow.retryOriginalRequest(),isNull);expect(jsonEncode(repo.writes.last),original);expect(repo.writes,hasLength(2));
    expect(flow.state.pendingAttempt,isNotNull);expect(flow.state.recoveryReminder,isTrue);expect(await flow.confirm(),isNull);
    actor='99';expect(await flow.retryOriginalRequest(),isNull);expect(repo.writes,hasLength(2));
  });

  test('a fresh flow sees only a list-check reminder and never automatically restores or submits an old payload', () async {
    writeBookingRecoveryMarker('a'*32,'7');final repo=StandardRepository(),flow=BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    expect(flow.state.recoveryReminder,isTrue);expect(flow.state.pendingAttempt,isNull);
    expect(await flow.retryOriginalRequest(),isNull);expect(repo.writes,isEmpty);
    flow.abandonRecovery(acknowledged:false);expect(hasBookingRecoveryMarker(),isTrue);
    flow.abandonRecovery(acknowledged:true);expect(flow.state.recoveryReminder,isFalse);expect(hasBookingRecoveryMarker(),isFalse);
  });

  testWidgets('recovery UI explains original retry may create and requires explicit acknowledgement before abandoning', (tester) async {
    var checks=0,retries=0,abandoned=0;
    final request={'shopId':'7','requestKey':'a'*32,'addOnSelections':[{'participantIndex':1,'sequence':1,'addOnIds':['10']}]};
    final attempt=BookingRecoveryAttempt(actorId:'41',quote:BookingPriceQuote.fromJson(quoteJson(request)),payload:request);
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:BookingRecoveryPanel(
      attempt:attempt,reminder:true,busy:false,onCheck:()=>checks++,onRetry:()=>retries++,onAbandon:()=>abandoned++)))));
    expect(retries,0);expect(abandoned,0);expect(find.textContaining('may finish that original reservation'),findsOneWidget);
    await tester.tap(find.text('Check my bookings'));await tester.pump();expect(checks,1);
    await tester.ensureVisible(find.text('Retry original request'));await tester.tap(find.text('Retry original request'));await tester.pump();expect(retries,1);
    await tester.ensureVisible(find.text('Stop recovery after checking'));await tester.tap(find.text('Stop recovery after checking'));await tester.pumpAndSettle();expect(abandoned,0);
    expect(find.textContaining('does not cancel an appointment'),findsOneWidget);
    await tester.tap(find.text('I checked; stop recovery'));await tester.pumpAndSettle();expect(abandoned,1);
  });

}
