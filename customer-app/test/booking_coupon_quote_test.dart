import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/coupon.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'booking_add_ons_test.dart' as fixture;

UserCoupon coupon()=>UserCoupon.fromJson({'id':'20','coupon':{'id':'21','title':'Saved discount','shopId':'7'}});
ShopDetail shop()=>ShopDetail.fromJson({'id':'7','name':'Coupon order shop','latitude':0,'longitude':0,'orderOnly':true,'onlinePaymentEnabled':false,
  'services':[{'id':'8','name':'Fixed service','durationMin':60,'priceCents':5000,'priceBasis':'PER_BOOKING'}]});
class CouponCustomer extends AuthNotifier {
  CouponCustomer():super(ApiService()){state=AuthState(isLoggedIn:true,user:User(id:'41',role:'CUSTOMER',name:'Coupon customer',phone:'+12065550123',email:'customer@example.invalid',emailVerified:true));}
}
Widget localized(Widget child)=>MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:child);
Future<void> select(BookingFlowNotifier flow)async{
  final catalog=shop();flow.initFlow(catalog);flow.selectService(catalog.services.single);flow.selectDate(DateTime(2031,5,1));
  await Future<void>.delayed(Duration.zero);flow.toggleTimeSlot('10:00');
}
Future<void> selectPlan(BookingPlanNotifier flow)async{
  flow.selectService(0,0,'8');flow.selectDate('2031-05-01');await flow.loadSlots();flow.selectTime('10:00');
}
void main(){
  TestWidgetsFlutterBinding.ensureInitialized();setUp(clearBookingRecoveryMarker);tearDown(clearBookingRecoveryMarker);
  test('TIMED coupon selection requires its discounted quote and removing the coupon invalidates its quote and requires reviewing the undiscounted total',()async{
    final repo=fixture.StandardRepository(),flow=BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);await select(flow);
    expect(flow.state.requiresServerQuote,isTrue);expect(flow.state.canConfirm,isFalse);expect(repo.quotes,isEmpty);
    flow.selectCoupon(coupon());expect(flow.state.requiresServerQuote,isTrue);expect(flow.state.canConfirm,isFalse);
    expect(await flow.confirmBooking(),isNull);expect(repo.writes,isEmpty);
    await flow.refreshPriceQuote();expect(flow.state.priceQuote!.discountCents,2000);expect(flow.state.priceQuote!.totalCents,3000);expect(flow.state.canConfirm,isTrue);
    flow.selectCoupon(null);expect(flow.state.requiresServerQuote,isTrue);expect(flow.state.priceQuote,isNull);expect(flow.state.canConfirm,isFalse);
    expect(repo.quotes,hasLength(1));expect(repo.writes,isEmpty);
  });
  test('a failed coupon quote cannot create; a late quote for the removed coupon cannot become the current confirmed price',()async{
    final repo=fixture.StandardRepository()..hold=true,flow=BookingFlowNotifier(repo, currentCustomerId: () => '41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);await select(flow);flow.selectCoupon(coupon());
    final failed=flow.refreshPriceQuote();repo.pending.single.completeError(StateError('Synthetic quote unavailable'));await failed;
    expect(flow.state.canConfirm,isFalse);expect(await flow.confirmBooking(),isNull);expect(repo.writes,isEmpty);
    final old=flow.refreshPriceQuote();final request=Map<String,dynamic>.from(repo.quotes.last);flow.selectCoupon(null);
    repo.pending.last.complete(BookingPriceQuote.fromJson(fixture.quoteJson(request)));await old;
    expect(flow.state.selectedCoupon,isNull);expect(flow.state.priceQuote,isNull);expect(flow.state.requiresServerQuote,isTrue);expect(repo.writes,isEmpty);
  });
  test('unknown coupon STANDARD and PLAN results freeze the exact original discounted quote and command without requoting',()async{
    final repo=fixture.RecoveryStandardRepository(),flow=BookingFlowNotifier(repo,currentCustomerId:()=>'41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);await select(flow);flow.selectCoupon(coupon());await flow.refreshPriceQuote();
    expect(await flow.confirmBooking(),isNull);final body=jsonEncode(repo.writes.single),accepted=flow.state.pendingAttempt!.quote!;
    expect(accepted.totalCents,3000);repo.disabled=true;flow.selectCoupon(null);await flow.refreshPriceQuote();await flow.confirmBooking();
    final restored=await flow.retryOriginalRequest();expect(restored!.totalCents,3000);expect(jsonEncode(repo.writes.last),body);expect(repo.quotes,hasLength(1));expect(repo.writes,hasLength(2));expect(hasBookingRecoveryMarker(),isFalse);
    final planRepo=fixture.RecoveryPlanRepository(),plan=BookingPlanNotifier(shop(),planRepo,currentCustomerId:()=>'41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(plan.dispose);await selectPlan(plan);plan.selectCoupon(coupon());await plan.refreshPriceQuote();
    expect(await plan.confirm(),isNull);final planBody=jsonEncode(planRepo.writes.single);expect(plan.state.pendingAttempt!.quote!.totalCents,3000);
    planRepo.disabled=true;plan.selectCoupon(null);await plan.refreshPriceQuote();await plan.confirm();
    expect((await plan.retryOriginalRequest())!.totalCents,3000);expect(jsonEncode(planRepo.writes.last),planBody);expect(planRepo.quotes,hasLength(1));expect(planRepo.writes,hasLength(2));expect(hasBookingRecoveryMarker(),isFalse);
  });
  testWidgets('STANDARD and PLAN confirmation show the coupon-discounted server total and prevent confirmation until it is read',(tester)async{
    tester.view.physicalSize=const Size(1000,1600);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final catalog=shop(),repo=fixture.StandardRepository(),customer=CouponCustomer();
    final container=ProviderContainer(overrides:[authProvider.overrideWith((ref)=>customer),bookingRepositoryProvider.overrideWithValue(repo)]);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:localized(BookingScreen(shop:catalog))));await tester.pumpAndSettle();
    final flow=container.read(bookingFlowProvider.notifier);flow.selectService(catalog.services.single);flow.selectDate(DateTime(2031,5,1));await tester.pumpAndSettle();flow.toggleTimeSlot('10:00');flow.selectCoupon(coupon());await tester.pumpAndSettle();
    for(var step=0;step<3;step++){await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();}
    final primary = find.byKey(const ValueKey('booking-wizard-primary-action'));
    expect(flow.state.canConfirm,isFalse);
    expect(tester.widget<FilledButton>(primary).onPressed,isNotNull);
    expect(find.descendant(of:primary,matching:find.text('Review current total')),findsOneWidget);
    expect(repo.writes,isEmpty);
    expect(find.text('Current total review'),findsOneWidget);
    var quoted=false;final read=flow.refreshPriceQuote().whenComplete(()=>quoted=true);for(var count=0;count<100&&!quoted;count++){await tester.pump(const Duration(milliseconds:10));}expect(quoted,isTrue);await read;await tester.pumpAndSettle();
    expect(find.textContaining('30.00'),findsWidgets);expect(find.textContaining('Submit booking request'),findsOneWidget);expect(tester.widget<FilledButton>(find.byType(FilledButton).last).onPressed,isNotNull);expect(repo.writes,isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());container.dispose();
    final planRepo=fixture.PlanRepository(),plan=BookingPlanNotifier(catalog,planRepo,currentCustomerId:()=>'41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');
    final planContainer=ProviderContainer(overrides:[authProvider.overrideWith((ref)=>CouponCustomer()),bookingPlanProvider(catalog).overrideWith((ref)=>plan)]);
    await tester.pumpWidget(UncontrolledProviderScope(container:planContainer,child:localized(BookingPlanScreen(shop:catalog))));await tester.pumpAndSettle();
    plan.selectService(0,0,'8');plan.selectDate('2031-05-01');await tester.pumpAndSettle();plan.selectTime('10:00');plan.selectCoupon(coupon());await tester.pumpAndSettle();
    for(var step=0;step<3;step++){await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();}
    final planPrimary=find.byKey(const ValueKey('booking-plan-primary-action'));
    expect(plan.state.canConfirm,isFalse);
    expect(tester.widget<FilledButton>(planPrimary).onPressed,isNotNull);
    expect(find.descendant(of:planPrimary,matching:find.text('Review current total')),findsOneWidget);
    expect(find.text('Estimated service price'),findsOneWidget);
    await tester.tap(planPrimary);await tester.pumpAndSettle();
    expect(planRepo.quotes,hasLength(1));expect(plan.state.canConfirm,isTrue);
    expect(find.textContaining('Submit booking request'),findsOneWidget);expect(find.textContaining('30.00'),findsWidgets);expect(planRepo.writes,isEmpty);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());planContainer.dispose();
  });
}
