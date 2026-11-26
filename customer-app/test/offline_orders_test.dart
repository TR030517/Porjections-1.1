import 'booking_quote_fixture.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_order_email.dart';
import 'package:mjapp_client/models/booking_order_policy.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/screens/edit_profile_screen.dart';
import 'package:mjapp_client/screens/payment_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/services/payment_checkout_service.dart';

ShopDetail orderShop({int guests=1,int staff=1,bool variant=false})=>ShopDetail.fromJson({
  'id':'7','name':'Order studio','latitude':0,'longitude':0,'onlinePaymentEnabled':false,'orderOnly':true,'pricingPolicy':'PER_ORDER',
  'services':[{'id':'8','name':'Whole visit','participantCount':guests,'requiredStaffCount':staff,'durationMin':60,'priceCents':12345,'priceBasis':'PER_PERSON',
    if(variant)'hasVariants':true,
    if(variant)'variants':[{'id':'9','name':'One full visit option','durationMin':60,'priceCents':14567,'priceBasis':'PER_PERSON','currency':'usd','isActive':true}]}],
});
class OrderCustomer extends AuthNotifier {
  OrderCustomer({String? email}):super(ApiService()){customer('41',email);}
  void customer(String id,String? email)=>state=AuthState(isLoggedIn:true,user:User(id:id,role:'CUSTOMER',email:email,emailVerified:email!=null));
}
class OrderRepository extends BookingRepository {
  OrderRepository():super(ApiService());
  final writes=<Map<String,dynamic>>[];
  @override
  Future<SlotResponse> getSlots({required String shopId,required String serviceId,String? therapistId,String? variantId,List<String>? preferredTherapistIds,required String date}) async=>SlotResponse(date:date,slots:[TimeSlot(time:'10:00',available:true)]);
  BookingPriceQuote? accepted;
  @override
  Future<BookingPriceQuote> quote(Map<String,dynamic> request)async=>accepted=BookingPriceQuote.fromJson(timedQuoteJson(request,price:12345));
  @override
  Future<Booking> createBookingWithAddOns(Map<String,dynamic> request)async{writes.add(request);return quotedBookingFixture(request,accepted!,extra:{'userId':'41','orderOnly':true,'onlinePaymentEnabled':false});}

}
class OrderPlanRepository extends BookingPlanRepository {
  OrderPlanRepository():super(ApiService());
  final writes=<Map<String,dynamic>>[];
  @override
  Future<BookingPlanQuote> slots(Map<String,dynamic> request)async=>BookingPlanQuote.fromJson({
    'date':request['date'],'timezone':'America/New_York','participantCount':(request['items'] as List).length,'durationMin':60,
    'priceCents':(request['items'] as List).length*12345,
    'items':[for(final row in request['items'] as List){...Map<String,dynamic>.from(row as Map),'serviceName':'Whole visit','durationMin':60,'offsetMin':0,'preparationMin':0,'priceCents':12345,'currency':'usd'}],
    'slots':[{'time':'10:00','available':true}],
  });
  BookingPriceQuote? accepted;
  @override
  Future<BookingPriceQuote> priceQuote(Map<String,dynamic> request)async=>accepted=BookingPriceQuote.fromJson(timedQuoteJson(request,price:(request['items'] as List).length*12345));
  @override
  Future<Booking> create(Map<String,dynamic> request)async{
    writes.add(request);
    return quotedBookingFixture(request,accepted!,extra:{'userId':'41','orderOnly':true,'onlinePaymentEnabled':false});
  }
}
class NoCheckout implements PaymentCheckoutApi {
  int calls=0;
  @override Future<Map<String,dynamic>> config()async{calls++;return {'orderOnly':true,'onlinePaymentEnabled':false};}
  @override Future<Map<String,dynamic>> quote(String id)async{calls++;throw StateError('No payment quote authorized');}
  @override Future<Map<String,dynamic>> booking(String id)async{calls++;throw StateError('No payment booking read authorized');}
  @override Future<Map<String,dynamic>> create(String id)async{calls++;throw StateError('No checkout authorized');}
}
Widget localized(Widget child)=>MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:child);

void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);tearDown(clearBookingRecoveryMarker);
  test('per-order single, couple, four-hands and variant prices are never multiplied by customer or staff count',(){
    for(final counts in [(1,1),(2,2),(1,2)]){
      for(final variant in [false,true]){
        final shop=orderShop(guests:counts.$1,staff:counts.$2,variant:variant),service=orderShop(guests:counts.$1,staff:counts.$2,variant:variant).services.single;
        final flow=BookingFlowNotifier(OrderRepository());addTearDown(flow.dispose);flow.initFlow(shop);flow.selectService(service);
        if(variant)flow.selectVariant(service.activeVariants.single);
        expect(service.startingPriceCents,variant?14567:12345);expect(flow.state.selectedPriceCents,variant?14567:12345);
        expect(flow.state.paymentMode,'PAY_AT_STORE');flow.selectPaymentMode('ONLINE');expect(flow.state.paymentMode,'PAY_AT_STORE');
      }
    }
    final enabled=ShopDetail.fromJson({'id':'7','name':'Future enabled payments','latitude':0,'longitude':0,'onlinePaymentEnabled':true,'orderOnly':false,'pricingPolicy':'PER_ORDER',
      'services':[{'id':'8','name':'Couple','participantCount':2,'requiredStaffCount':2,'durationMin':60,'priceCents':12345,'priceBasis':'PER_PERSON'}]});
    expect(enabled.services.single.startingPriceCents,12345);
  });
  test('offline policy hides checkout without rewriting historical collected, refunded, tip or zero-total order facts',(){
    for(final mode in ['ONLINE','ZERO','PAY_AT_STORE']){
      final row=Booking.fromJson({'id':'42','paymentMode':mode,'durationMin':60,'priceCents':12345,'totalCents':12468,'tipCents':123,'paidCents':12000,'refundedCents':1000,'amountDueCents':1468,
        'status':'CONFIRMED','paymentStatus':'PAID','onlinePaymentEnabled':false,'orderOnly':true});
      expect(row.totalCents,12468);expect(row.paidCents,12000);expect(row.refundedCents,1000);expect(row.tipCents,123);expect(row.paymentStatus,'PAID');expect(row.canOpenCheckout,isFalse);
    }
    final zero=Booking.fromJson({'id':'42','durationMin':60,'priceCents':0,'totalCents':0,'paymentMode':'PAY_AT_STORE','status':'PENDING','paymentStatus':'UNPAID','orderOnly':true,'onlinePaymentEnabled':false});
    expect(zero.status,'PENDING');expect(zero.paymentStatus,'UNPAID');expect(zero.canOpenCheckout,isFalse);
  });
  test('email delivery labels describe actual queue and provider acceptance, and reject a different booking status response',(){
    for(final status in ['QUEUED','PROCESSING','ACCEPTED','NOT_CONFIGURED','FAILED','ACCEPTANCE_UNKNOWN','CANCELLED','NOT_REQUESTED']){
      final value=BookingOrderEmail.fromJson({'bookingId':'42','channel':'EMAIL','status':status},'42');
      expect(value.status,status);expect(value.message,isNot(contains('has been delivered')));
    }
    expect(BookingOrderEmail('ACCEPTED').message,contains('does not confirm delivery'));
    expect(BookingOrderEmail('NOT_CONFIGURED').message,contains('not configured'));
    final local=BookingOrderEmail.fromJson({'bookingId':'42','channel':'EMAIL','status':'ACCEPTED',
      'configuration':{'provider':'local','deliveryMode':'LOCAL_CAPTURE'}},'42');
    expect(local.localCapture,isTrue);expect(local.message,contains('captured locally'));expect(local.message,contains('No email was sent'));
    expect(()=>BookingOrderEmail.fromJson({'bookingId':'43','channel':'EMAIL','status':'ACCEPTED'},'42'),throwsFormatException);
    expect(bookingAccountEmail(User(id:'41',role:'CUSTOMER',email:' customer@example.invalid ',emailVerified:true)),'customer@example.invalid');
    expect(bookingAccountEmail(User(id:'41',role:'CUSTOMER',email:'customer@example.invalid')),isNull);
    expect(bookingAccountEmail(User(id:'41',role:'CUSTOMER',email:'other@example.invalid\r\nInjected: yes')),isNull);
  });
  test('both real booking notifiers reject missing account email before a command and never put a recipient in the order body',()async{
    String? email;final repo=OrderRepository(),shop=orderShop();
    final flow=BookingFlowNotifier(repo,currentCustomerId:()=>'41',currentCustomerEmail:()=>email,currentCustomerName:()=>'Test contact',currentCustomerPhone:()=>'+12065550123');addTearDown(flow.dispose);
    flow.initFlow(shop);flow.selectService(shop.services.single);flow.selectDate(DateTime(2031,5,1));await Future<void>.delayed(Duration.zero);flow.toggleTimeSlot('10:00');await flow.refreshPriceQuote();
    expect(flow.state.hasSelection,isTrue);expect(await flow.confirmBooking(),isNull);expect(repo.writes,isEmpty);expect(hasBookingRecoveryMarker(),isFalse);
    email='customer@example.invalid';flow.syncAccountEmail();expect(await flow.confirmBooking(),isNotNull);expect(repo.writes.single['paymentMode'],'PAY_AT_STORE');
    expect(repo.writes.single.keys, isNot(contains('email')));expect(repo.writes.single.keys,isNot(contains('to')));
    email=null;final planRepo=OrderPlanRepository(),plan=BookingPlanNotifier(shop,planRepo,currentCustomerId:()=>'41',currentCustomerEmail:()=>email,currentCustomerName:()=>'Test contact',currentCustomerPhone:()=>'+12065550123');addTearDown(plan.dispose);
    plan.selectService(0,0,'8');plan.addParticipant();plan.selectService(1,0,'8');plan.selectDate('2031-05-01');await plan.loadSlots();plan.selectTime('10:00');plan.setTipCents(999);await plan.refreshPriceQuote();
    expect(plan.state.tipCents,0);expect(await plan.confirm(),isNull);expect(planRepo.writes,isEmpty);
    email='customer@example.invalid';plan.syncAccountEmail();expect(await plan.confirm(),isNotNull);expect(planRepo.writes.single['paymentMode'],'PAY_AT_STORE');expect(planRepo.writes.single['tipCents'],0);
    expect(planRepo.writes.single.keys,isNot(contains('email')));expect(planRepo.writes.single.keys,isNot(contains('to')));
  });
  testWidgets('confirmation displays one order total, no payment choice, and missing email blocks submission with an explicit account action',(tester)async{
    tester.view.physicalSize=const Size(1000,1400);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final repo=OrderRepository(),auth=OrderCustomer(),shop=orderShop();
    final container=ProviderContainer(overrides:[authProvider.overrideWith((ref)=>auth),bookingRepositoryProvider.overrideWithValue(repo)]);
    try {
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:localized(BookingScreen(shop:shop))));await tester.pumpAndSettle();
    final flow=container.read(bookingFlowProvider.notifier);flow.selectService(shop.services.single);flow.selectDate(DateTime(2031,5,1));await tester.pumpAndSettle();flow.toggleTimeSlot('10:00');await tester.pumpAndSettle();var priced=false;final pricing=flow.refreshPriceQuote().whenComplete(()=>priced=true);for(var tick=0;tick<100&&!priced;tick++){await tester.pump(const Duration(milliseconds:10));}expect(priced,isTrue);await pricing;await tester.pumpAndSettle();
    for(var i=0;i<3;i++){await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();}
    expect(find.text('Booking order · handled offline'),findsOneWidget);expect(find.text('Add account email'),findsOneWidget);expect(find.text('Online payment'),findsNothing);expect(find.byType(DropdownButtonFormField<String>),findsNothing);
    expect(find.textContaining('123.45'),findsWidgets);
    await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();
    expect(find.text('Add your account email'),findsOneWidget);expect(find.text('Edit account details'),findsOneWidget);expect(repo.writes,isEmpty);expect(tester.takeException(),isNull);
    } finally {
      try { await tester.pumpWidget(const SizedBox.shrink()); }
      finally { container.dispose(); }
    }
  });
  testWidgets('PLAN confirmation hides tip and payment controls and preserves one summed itinerary order total',(tester)async{
    tester.view.physicalSize=const Size(1000,1600);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final shop=orderShop(),repo=OrderPlanRepository(),auth=OrderCustomer(email:'customer@example.invalid');
    final container=ProviderContainer(overrides:[authProvider.overrideWith((ref)=>auth),bookingPlanRepositoryProvider.overrideWithValue(repo)]);
    try {
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:localized(BookingPlanScreen(shop:shop))));await tester.pumpAndSettle();
    final plan=container.read(bookingPlanProvider(shop).notifier);plan.selectService(0,0,'8');plan.addParticipant();plan.selectService(1,0,'8');plan.selectDate('2031-05-01');await plan.loadSlots();plan.selectTime('10:00');await tester.pumpAndSettle();var priced=false;final pricing=plan.refreshPriceQuote().whenComplete(()=>priced=true);for(var tick=0;tick<100&&!priced;tick++){await tester.pump(const Duration(milliseconds:10));}expect(priced,isTrue);await pricing;await tester.pumpAndSettle();
    for(var i=0;i<3;i++){await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();}
    expect(find.text('Booking order · handled offline'),findsOneWidget);expect(find.textContaining('246.90'),findsWidgets);expect(find.textContaining('Optional tip'),findsNothing);expect(find.text('Online payment'),findsNothing);expect(find.byType(DropdownButtonFormField<String>),findsNothing);expect(repo.writes,isEmpty);expect(tester.takeException(),isNull);
    } finally {
      try { await tester.pumpWidget(const SizedBox.shrink()); }
      finally { container.dispose(); }
    }
  });
  testWidgets('direct payment screen entry under offline policy performs zero payment reads or writes and offers only order details',(tester)async{
    final api=NoCheckout(),booking=Booking.fromJson({'id':'42','durationMin':60,'priceCents':12345,'totalCents':12345,'paymentMode':'ONLINE','status':'PENDING','paymentStatus':'UNPAID'});
    await tester.pumpWidget(ProviderScope(overrides:[paymentCheckoutApiProvider.overrideWithValue(api)],child:localized(PaymentScreen(booking:booking,shop:orderShop()))));await tester.pumpAndSettle();
    expect(find.text('View booking order'),findsOneWidget);expect(find.textContaining('Online payment is unavailable'),findsOneWidget);expect(find.text('Prepare Square checkout'),findsNothing);expect(api.calls,0);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    final historical=Booking.fromJson({'id':'42','durationMin':60,'priceCents':12345,'totalCents':12345,'paymentMode':'ONLINE','status':'PENDING','paymentStatus':'UNPAID','onlinePaymentEnabled':true,'orderOnly':false});
    final oldShop=ShopDetail.fromJson({'id':'7','name':'Old online view','latitude':0,'longitude':0,'onlinePaymentEnabled':true,'orderOnly':false});
    await tester.pumpWidget(ProviderScope(overrides:[paymentCheckoutApiProvider.overrideWithValue(api)],child:localized(PaymentScreen(booking:historical,shop:oldShop))));await tester.pumpAndSettle();
    expect(api.calls,1,reason:'A stale online view checks current config once and must stop before requesting any payment quote, booking poll or checkout.');
    expect(find.text('View booking order'),findsOneWidget);expect(tester.takeException(),isNull);
  });
  testWidgets('account email form opened by A cannot expose or save its draft after the current customer changes to B',(tester)async{
    final auth=OrderCustomer(email:'original@example.invalid');
    await tester.pumpWidget(ProviderScope(overrides:[authProvider.overrideWith((ref)=>auth)],child:localized(const EditProfileScreen())));await tester.pumpAndSettle();
    expect(find.text('original@example.invalid'),findsOneWidget);auth.customer('42','second@example.invalid');await tester.pumpAndSettle();
    expect(find.text('original@example.invalid'),findsNothing);expect(find.byType(TextFormField),findsNothing);expect(find.textContaining('customer session changed'),findsOneWidget);expect(tester.takeException(),isNull);
  });
}
