import 'booking_quote_fixture.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mjapp_client/models/coupon.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/widgets/booking_add_ons.dart';

ShopDetail studio() => ShopDetail.fromJson({
  'id':'7','name':'Timed studio','latitude':0,'longitude':0,'timezone':'America/New_York',
  'paymentPolicy':{'payAtStoreEnabled':true},
  'services':[{'id':'8','name':'Fixed massage','durationMin':60,'priceCents':8000,'priceBasis':'PER_BOOKING','participantCount':1,'requiredStaffCount':1}],
});

DioException lost([int? status]) => DioException(requestOptions:RequestOptions(path:'/bookings'),
  response:status==null?null:Response(requestOptions:RequestOptions(path:'/bookings'),statusCode:status),
  type:status==null?DioExceptionType.receiveTimeout:DioExceptionType.badResponse);

Map<String,dynamic> savedJson(Map<String,dynamic> request,{bool plan=false}) {
  final rows=plan?List<Map<String,dynamic>>.from((request['items'] as List).map((row)=>Map<String,dynamic>.from(row as Map)))
    :[{'participantIndex':1,'sequence':1,'serviceId':request['serviceId'],'variantId':request['variantId']}];
  final metadata=quotedBookingJson(request,BookingPriceQuote.fromJson(timedQuoteJson(request,price:rows.length*8000)));
  return {...metadata,'id':'42','shopId':request['shopId'],'userId':'41','serviceId':'8',
    'reservationKind':plan?'PLAN':'SINGLE','durationMin':60,'priceCents':rows.length*8000,'totalCents':rows.length*8000-(request['couponId']==null?0:1000),
    'currency':'usd','paymentMode':request['paymentMode'],'tipCents':request['tipCents']??0,
    'status':'PENDING','paymentStatus':'UNPAID','localDate':request['date'],'localStartTime':request['startTime'],
    'items':[for(var i=0;i<rows.length;i++){...(metadata['items'] as List)[i], 'id':'${100+i}',...rows[i],'serviceNameSnapshot':'Fixed massage','durationMin':60,'priceCentsSnapshot':8000}],
  };
}
Booking saved(Map<String,dynamic> request,{bool plan=false})=>Booking.fromJson(savedJson(request,plan:plan));

class TimedRepository extends BookingRepository {
  TimedRepository():super(ApiService());
  final writes=<Map<String,dynamic>>[];
  int? rejectedStatus;
  bool persistFirst=true;
  Booking? committed;
  @override
  Future<SlotResponse> getSlots({required String shopId,required String serviceId,String? therapistId,String? variantId,List<String>? preferredTherapistIds,required String date}) async =>
    SlotResponse(date:date,slots:[TimeSlot(time:'10:00',available:true)]);
  @override
  Future<Booking> createBooking({required String shopId,required String serviceId,String? therapistId,String? variantId,List<String>? preferredTherapistIds,String? requestKey,
    required String date,required String startTime,int? durationMin,String? notes,String? couponId,String paymentMode='ONLINE',Map<String,dynamic>? contact,}) async {
    final request=<String,dynamic>{'shopId':shopId,'serviceId':serviceId,'date':date,'startTime':startTime,'paymentMode':paymentMode,
      'contact':?contact,'variantId':?variantId,'preferredTherapistIds':?preferredTherapistIds,
      'requestKey':?requestKey,'durationMin':?durationMin,'couponId':?couponId};
    writes.add(Map<String,dynamic>.from(jsonDecode(jsonEncode(request)) as Map));
    if(writes.length==1){if(persistFirst)committed=saved(request);throw lost(rejectedStatus);}
    return committed??saved(request);
  }
  BookingPriceQuote? accepted;
  @override
  Future<Booking> createBookingWithAddOns(Map<String,dynamic> selection)async{
    writes.add(Map<String,dynamic>.from(jsonDecode(jsonEncode(selection)) as Map));
    if(writes.length==1){if(persistFirst)committed=quotedBookingFixture(selection,accepted!);throw lost(rejectedStatus);}
    return committed??quotedBookingFixture(selection,accepted!);
  }
  @override
  Future<BookingPriceQuote> quote(Map<String,dynamic> selection)async=>accepted=BookingPriceQuote.fromJson(timedQuoteJson(selection,price:8000));
}

class TimedPlanRepository extends BookingPlanRepository {
  TimedPlanRepository():super(ApiService());
  final writes=<Map<String,dynamic>>[];
  Booking? committed;
  BookingPriceQuote? accepted;
  @override
  Future<BookingPlanQuote> slots(Map<String,dynamic> selection) async => BookingPlanQuote.fromJson({
    'date':selection['date'],'timezone':'America/New_York','participantCount':(selection['items'] as List).length,'durationMin':60,
    'priceCents':(selection['items'] as List).length*8000,
    'items':[for(final raw in selection['items'] as List){...Map<String,dynamic>.from(raw as Map),'serviceName':'Fixed massage','durationMin':60,'offsetMin':0,'preparationMin':0,'priceCents':8000,'currency':'usd'}],
    'slots':[{'time':'10:00','available':true}],
  });
  @override
  Future<Booking> create(Map<String,dynamic> selection) async {
    writes.add(Map<String,dynamic>.from(jsonDecode(jsonEncode(selection)) as Map));
    if(writes.length==1){committed=quotedBookingFixture(selection,accepted!);throw lost(503);}
    return committed!;
  }
  @override
  Future<BookingPriceQuote> priceQuote(Map<String,dynamic> selection)async=>accepted=BookingPriceQuote.fromJson(timedQuoteJson(selection,price:(selection['items'] as List).length*8000));
}

class TimedWire implements HttpClientAdapter {
  final paths=<String>[],standardBodies=<Map<String,dynamic>>[],planBodies=<Map<String,dynamic>>[];
  final committed=<String,Map<String,dynamic>>{};
  @override
  Future<ResponseBody> fetch(RequestOptions options,Stream<Uint8List>? requestStream,Future<void>? cancelFuture) async {
    final bytes=<int>[];
    if(requestStream!=null){await for(final chunk in requestStream){bytes.addAll(chunk);}}
    final body=bytes.isEmpty?<String,dynamic>{}:Map<String,dynamic>.from(jsonDecode(utf8.decode(bytes)) as Map);
    paths.add(options.path);
    Object response;
    switch(options.path){
      case '/auth/customer/logout':response={'ok':true};
      case '/auth/customer/password/login':response={'accessToken':'synthetic-customer','refreshToken':'synthetic-refresh','user':{'id':'41','role':'CUSTOMER'}};
      case '/bookings/slots':response={'date':options.queryParameters['date'],'durationKind':'TIMED','durationMin':60,
        'variantId':?options.queryParameters['variantId'],'participantCount':1,'requiredStaffCount':1,
        'slots':[{'time':'10:00','available':true}]};
      case '/bookings/plan-slots':
        response={'date':body['date'],'timezone':'America/New_York','participantCount':(body['items'] as List).length,'durationMin':60,'priceCents':(body['items'] as List).length*8000,
          'items':[for(final raw in body['items'] as List){...Map<String,dynamic>.from(raw as Map),'serviceName':'Fixed massage','durationMin':60,'offsetMin':0,'preparationMin':0,'priceCents':8000,'currency':'usd'}],
          'slots':[{'time':'10:00','available':true}]};
      case '/bookings/quote':
      case '/bookings/plan-quote':
        final items=options.path.endsWith('/plan-quote')?List<Map<String,dynamic>>.from((body['items'] as List).map((row)=>Map<String,dynamic>.from(row as Map)))
          :[{'participantIndex':1,'sequence':1,'serviceId':body['serviceId'],'variantId':body['variantId']}];
        final main=items.length*8000,discount=body['couponId']==null?0:1000;
        response={'shopId':'7','currency':'usd','mainSubtotalCents':main,'addOnSubtotalCents':0,'subtotalCents':main,'discountEligibleCents':main,
          'discountCents':discount,'platformFeeCents':0,'tipCents':0,'totalCents':main-discount,'durationMin':60,'durationKind':'TIMED','addOns':[],
          'mainDurations':[for(final row in items){...row,'variantId':row['variantId'],'durationKind':'TIMED','reservedDurationMin':60}],
          'quoteHash':'a'*64,'quoteExpiresAt':DateTime.now().toUtc().add(const Duration(minutes:5)).toIso8601String()};
      case '/bookings':
      case '/bookings/plan':
        final plan=options.path.endsWith('/plan'),writes=plan?planBodies:standardBodies;
        writes.add(body);committed.putIfAbsent(options.path,()=>savedJson(body,plan:plan));
        if(writes.length==1)throw DioException(requestOptions:options,type:DioExceptionType.receiveTimeout);
        response=committed[options.path]!;
      default:throw StateError('Unexpected request: ${options.path}');
    }
    return ResponseBody.fromString(jsonEncode(response),200,headers:{Headers.contentTypeHeader:['application/json']});
  }
  @override
  void close({bool force=false}){}
}

Future<void> selectTimed(BookingFlowNotifier flow) async {
  final shop=studio();flow.initFlow(shop);flow.selectService(shop.services.single);flow.selectDate(DateTime(2031,5,1));
  await waitForTimedSlots(flow);flow.toggleTimeSlot('10:00');flow.selectPaymentMode('PAY_AT_STORE');await flow.refreshPriceQuote();
}
Future<void> waitForTimedSlots(BookingFlowNotifier flow)async{
  expect(flow.state.hasServiceSelection,isTrue);
  final ready=Completer<void>();
  final remove=flow.addListener((state){
    if(!state.isLoadingSlots&&!ready.isCompleted){ready.complete();}
  });
  try{
    await ready.future.timeout(const Duration(seconds:5));
  }finally{remove();}
  expect(flow.state.error,isNull);
  expect(flow.state.isLoadingSlots,isFalse);
  expect(flow.state.availableSlots,contains(isA<TimeSlot>().having((slot)=>slot.time,'arrival time','10:00').having((slot)=>slot.available,'available',isTrue)));
}
Future<void> selectTimedPlan(BookingPlanNotifier flow,{bool review=true}) async {
  flow.selectService(0,0,'8');flow.addParticipant();flow.selectService(1,0,'8');flow.selectDate('2031-05-01');
  await flow.loadSlots();
  expect(flow.state.error,isNull);expect(flow.state.loading,isFalse);expect(flow.state.quote,isNotNull);
  expect(flow.state.quote!.slots,contains(isA<TimeSlot>().having((slot)=>slot.time,'arrival time','10:00').having((slot)=>slot.available,'available',isTrue)));
  flow.selectTime('10:00');flow.setPaymentMode('PAY_AT_STORE');if(review)await flow.refreshPriceQuote();
}

void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);tearDown(clearBookingRecoveryMarker);
  test('the first lost timed STANDARD reply locks selection and explicitly replays the same original request with its original signed quote',()async{
    final repo=TimedRepository(),flow=BookingFlowNotifier(repo,currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    await selectTimed(flow);expect(flow.state.requiresServerQuote,isTrue);
    expect(await flow.confirmBooking(),isNull);final original=jsonEncode(repo.writes.single),attempt=flow.state.pendingAttempt!;
    expect(attempt.quote,isNotNull);expect(hasBookingRecoveryMarker(),isTrue);expect(flow.state.canConfirm,isFalse);
    flow.invalidateCalendarSelection();flow.selectDate(DateTime(2031,5,2));flow.selectPaymentMode('ONLINE');flow.initFlow(studio());await flow.confirmBooking();
    expect(repo.writes,hasLength(1));expect(flow.state.selectedDate,DateTime(2031,5,1));
    final copy=attempt.payload;(copy['preferredTherapistIds'] as List).add('99');expect(attempt.payload['preferredTherapistIds'],isEmpty);
    final result=await flow.retryOriginalRequest();expect(result!.id,'42');expect(jsonEncode(repo.writes.last),original);
    expect(repo.writes.last['quoteHash'],'a'*64);expect(repo.writes.last['quoteExpiresAt'],attempt.quote!.quoteExpiresAt);
    expect(flow.state.pendingAttempt,isNull);expect(hasBookingRecoveryMarker(),isFalse);
  });
  test('a two-participant timed PLAN retains its exact people, services and request key after the first lost reply',()async{
    final repo=TimedPlanRepository(),flow=BookingPlanNotifier(studio(),repo,currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    await selectTimedPlan(flow);expect(flow.state.requiresServerQuote,isTrue);
    expect(await flow.confirm(),isNull);final original=jsonEncode(repo.writes.single);
    expect(flow.state.pendingAttempt!.quote,isNotNull);expect(hasBookingRecoveryMarker(),isTrue);
    flow.invalidateCalendarSelection();flow.selectDate('2031-05-02');flow.setTipCents(200);flow.removeParticipant(1);await flow.confirm();
    expect(repo.writes,hasLength(1));expect(flow.state.participants,hasLength(2));
    final result=await flow.retryOriginalRequest();expect(result!.items,hasLength(2));expect(jsonEncode(repo.writes.last),original);
    expect(repo.writes.last['quoteHash'],'a'*64);expect(flow.state.pendingAttempt,isNull);expect(hasBookingRecoveryMarker(),isFalse);
  });
  test('changing customer discards in-memory timed requests and cannot replay them as the next actor',()async{
    var actor='41';final repo=TimedRepository(),flow=BookingFlowNotifier(repo,currentCustomerId: () => actor, currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    await selectTimed(flow);await flow.confirmBooking();actor='42';flow.onCustomerChanged('41','42');
    expect(flow.state.pendingAttempt,isNull);expect(flow.state.recoveryReminder,isTrue);expect(await flow.retryOriginalRequest(),isNull);expect(repo.writes,hasLength(1));
    final planRepo=TimedPlanRepository(),plan=BookingPlanNotifier(studio(),planRepo,currentCustomerId: () => actor, currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(plan.dispose);
    plan.abandonRecovery(acknowledged:true);actor='41';await selectTimedPlan(plan);await plan.confirm();actor='42';plan.onCustomerChanged('41','42');
    expect(plan.state.pendingAttempt,isNull);expect(plan.state.recoveryReminder,isTrue);expect(await plan.retryOriginalRequest(),isNull);expect(planRepo.writes,hasLength(1));
  });
  test('a definitive timed authentication rejection ends that attempt without automatic retry',()async{
    final repo=TimedRepository()..persistFirst=false..rejectedStatus=401;
    final flow=BookingFlowNotifier(repo,currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);await selectTimed(flow);
    await flow.confirmBooking();expect(flow.state.pendingAttempt,isNull);expect(hasBookingRecoveryMarker(),isFalse);expect(repo.writes,hasLength(1));
    flow.selectDate(DateTime(2031,5,2));expect(flow.state.selectedDate,DateTime(2031,5,2));expect(repo.writes,hasLength(1));
  });
  test('unavailable recovery reminder storage prevents the first STANDARD and PLAN write',()async{
    final repo=TimedRepository(),flow=BookingFlowNotifier(repo,currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123',rememberRequest:(key,shop)=>false);addTearDown(flow.dispose);
    await selectTimed(flow);expect(await flow.confirmBooking(),isNull);expect(repo.writes,isEmpty);expect(flow.state.error,contains('No request was sent'));expect(hasBookingRecoveryMarker(),isFalse);
    final planRepo=TimedPlanRepository(),plan=BookingPlanNotifier(studio(),planRepo,currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123',rememberRequest:(key,shop)=>false);addTearDown(plan.dispose);
    await selectTimedPlan(plan);expect(await plan.confirm(),isNull);expect(planRepo.writes,isEmpty);expect(plan.state.error,contains('No request was sent'));expect(hasBookingRecoveryMarker(),isFalse);
  });
  test('real STANDARD and PLAN transports replay the complete original JSON including duration, optionals and zero tip',()async{
    FlutterSecureStorage.setMockInitialValues({});
    final api=ApiService(),previousAdapter=ApiService().dio.httpClientAdapter,wire=TimedWire();api.dio.httpClientAdapter=wire;
    try{
      await api.logout();await api.passwordLogin('synthetic@example.invalid','synthetic-password');
      final shop=ShopDetail.fromJson({'id':'7','name':'Timed options','latitude':0,'longitude':0,'paymentPolicy':{'payAtStoreEnabled':true},
        'services':[{'id':'8','name':'Fixed massage','durationMin':60,'priceCents':8000,'hasVariants':true,'variants':[{'id':'9','name':'60 minutes','durationMin':60,'priceCents':8000,'isActive':true}]}],
        'therapists':[{'id':'11','name':'Preferred person','services':[{'id':'8'}]}]});
      final coupon=UserCoupon.fromJson({'id':'20','coupon':{'id':'21','shopId':'7','title':'Saved coupon'}});
      final flow=BookingFlowNotifier(BookingRepository(api),currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
      flow.initFlow(shop);flow.selectService(shop.services.single);flow.selectVariant(shop.services.single.activeVariants.single);flow.selectTherapist(shop.therapists.single);flow.selectDate(DateTime(2031,5,1));
      await waitForTimedSlots(flow);flow.toggleTimeSlot('10:00');flow.selectPaymentMode('PAY_AT_STORE');
      expect(flow.state.requiresServerQuote,isTrue);expect(flow.state.canConfirm,isFalse);expect(wire.paths.where((path)=>path.contains('quote')),isEmpty);
      flow.selectCoupon(coupon);expect(flow.state.canConfirm,isFalse);await flow.refreshPriceQuote();
      expect(flow.state.selectedStartTime,'10:00');expect(flow.state.canConfirm,isTrue,reason:flow.state.error);
      expect(wire.paths,contains('/bookings/slots'));expect(wire.standardBodies,isEmpty);
      expect(await flow.confirmBooking(),isNull);expect(wire.standardBodies,hasLength(1));expect(flow.state.pendingAttempt,isNotNull);
      expect(await flow.retryOriginalRequest(),isNotNull);
      expect(wire.standardBodies,hasLength(2));expect(wire.standardBodies.last,wire.standardBodies.first);
      expect(wire.standardBodies.first,{'shopId':'7','serviceId':'8','date':'2031-05-01','startTime':'10:00','paymentMode':'PAY_AT_STORE','variantId':'9','preferredTherapistIds':['11'],
        'contact':{'name':'Test customer','phone':'+12065550123','email':'customer@example.invalid'},
        'requestKey':wire.standardBodies.first['requestKey'],'durationMin':60,'couponId':'20','quoteHash':'a'*64,'quoteExpiresAt':wire.standardBodies.first['quoteExpiresAt']});
      expect(wire.standardBodies.first['requestKey'],matches(RegExp(r'^[a-f0-9]{32}$')));expect(wire.standardBodies.first.containsKey('tipCents'),isFalse);
      final plan=BookingPlanNotifier(studio(),BookingPlanRepository(api),currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(plan.dispose);
      await selectTimedPlan(plan,review:false);plan.setNotes('  Original team visit  ');
      expect(plan.state.requiresServerQuote,isTrue);expect(plan.state.canConfirm,isFalse);
      plan.selectCoupon(coupon);expect(plan.state.canConfirm,isFalse);await plan.refreshPriceQuote();
      expect(plan.state.startTime,'10:00');expect(plan.state.canConfirm,isTrue,reason:plan.state.error);
      expect(wire.paths,contains('/bookings/plan-slots'));expect(wire.planBodies,isEmpty);
      expect(await plan.confirm(),isNull);expect(wire.planBodies,hasLength(1));expect(plan.state.pendingAttempt,isNotNull);
      expect(await plan.retryOriginalRequest(),isNotNull);
      expect(wire.planBodies,hasLength(2));expect(wire.planBodies.last,wire.planBodies.first);
      expect(wire.planBodies.first,{'shopId':'7','date':'2031-05-01','items':[{'participantIndex':1,'sequence':1,'serviceId':'8'},{'participantIndex':2,'sequence':1,'serviceId':'8'}],
        'contact':{'name':'Test customer','phone':'+12065550123','email':'customer@example.invalid'},
        'startTime':'10:00','requestKey':wire.planBodies.first['requestKey'],'paymentMode':'PAY_AT_STORE','tipCents':0,'notes':'Original team visit','couponId':'20','quoteHash':'a'*64,'quoteExpiresAt':wire.planBodies.first['quoteExpiresAt']});
      expect(wire.paths.where((path)=>path=='/bookings/quote'),hasLength(1));expect(wire.paths.where((path)=>path=='/bookings/plan-quote'),hasLength(1));expect(hasBookingRecoveryMarker(),isFalse);
    }finally{await api.logout();api.dio.httpClientAdapter=previousAdapter;}
  });
  testWidgets('timed recovery shows an honest original visit summary rather than a fabricated accepted total',(tester)async{
    final attempt=BookingRecoveryAttempt(actorId:'41',payload:{'shopId':'7','requestKey':'original-key','date':'2031-05-01','startTime':'10:00'},reservedDurationMin:60);
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:BookingRecoveryPanel(attempt:attempt,reminder:true,busy:false,onCheck:(){},onRetry:(){},onAbandon:(){})))));
    expect(find.text('Original visit: 2031-05-01 at 10:00'),findsOneWidget);expect(find.textContaining('Original accepted total:'),findsNothing);
    expect(find.textContaining('final amount'),findsWidgets);expect(find.text('Retry original request'),findsOneWidget);expect(tester.takeException(),isNull);
  });
}
