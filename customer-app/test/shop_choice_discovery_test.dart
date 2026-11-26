import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/shop_booking_choices.dart';
import 'package:mjapp_client/models/booking_order_policy.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';
import 'booking_quote_fixture.dart';
import 'booking_add_ons_test.dart' as priced;

const serviceId='9007199254740993',pausedId='9007199254740995',activeId='9007199254740997';
Map<String,dynamic> menuRow(String option,{bool enabled=true,bool available=true})=>{'id':'menu-$option','name':option==pausedId?'Paused sixty-minute price row':'Listed ninety-minute price row',
  'priceText':'USD 90','bookingEnabled':enabled,'bookingAvailable':available,'booking':{'serviceId':serviceId,'variantId':option}};
ShopDetail shop({List<Map<String,dynamic>>? menu,bool ninetyActive=true,bool sixtyActive=false,bool duplicateName=false})=>ShopDetail.fromJson({
  'id':'7','name':'Option discovery shop','latitude':0,'longitude':0,'timezone':'America/New_York','bookingCalendar':calendarFixture(),
  'orderOnly':true,'onlinePaymentEnabled':false,'pricingPolicy':'PER_ORDER',
  'services':[{'id':serviceId,'name':'Body massage','durationMin':15,'priceCents':0,'hasVariants':true,'variants':[
    {'id':pausedId,'name':'Sixty minutes','durationMin':60,'priceCents':8000,'isActive':sixtyActive},
    {'id':activeId,'name':'Ninety minutes','durationMin':90,'priceCents':9000,'isActive':ninetyActive},
  ]},if(duplicateName){'id':'9007199254741001','name':'Body massage','durationMin':30,'priceCents':4000}],
  'priceMenu':[{'category':'Prices','items':menu??[menuRow(pausedId,enabled:false,available:false)]}],
});
class ChoiceRepository extends ShopRepository {
  ChoiceRepository(this.current):super(ApiService());
  ShopDetail current;final reads=<String>[];
  @override Future<ShopDetail> getShopDetail(String id){reads.add(id);return Future.value(current);}
}
Widget localized(Widget child)=>MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:child);
Widget detail(ShopDetail value,ChoiceRepository repository)=>ProviderScope(overrides:[
  authProvider.overrideWith((ref)=>AuthNotifier(ApiService())),shopRepositoryProvider.overrideWithValue(repository),
  shopDetailProvider('7').overrideWith((ref)async=>value),shopReviewsProvider('7').overrideWith((ref)async=>[]),favoritesProvider.overrideWith((ref)=>FavoritesNotifier(ApiService())),
],child:localized(const ShopDetailScreen(shopId:'7',shopName:'Option discovery shop')));

void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  test('coverage is exact effective service/variant identity and never suppresses an active sibling or another same-name parent',(){
    final value=shop(duplicateName:true),choices=uncoveredShopBookingChoices(value);
    expect(choices.map((choice)=>choice.identity),[(serviceId,activeId),('9007199254741001',null)]);
    expect(choices.first.label,'Body massage · Ninety minutes');expect(choices.first.price,'USD 90.00');
    expect(uncoveredShopBookingChoices(shop(menu:[menuRow(activeId)])).isEmpty,isTrue);
    expect(uncoveredShopBookingChoices(shop(menu:[menuRow(activeId),menuRow(activeId)])).isEmpty,isTrue);
    expect(uncoveredShopBookingChoices(shop(menu:[menuRow(activeId,available:false)])).single.variant?.id,activeId);
    expect(uncoveredShopBookingChoices(shop(menu:[{'id':'extra','name':'Oil','priceText':'USD 10','bookingEnabled':true,'bookingAvailable':true,'booking':{'serviceId':serviceId,'addOnId':'99'}}])).single.variant?.id,activeId);
    expect(uncoveredShopBookingChoices(shop(menu:[{'id':'bad-base','name':'Old base','priceText':'USD 0','bookingEnabled':true,'bookingAvailable':true,'booking':{'serviceId':serviceId}}])).single.variant?.id,activeId);
    expect(uncoveredShopBookingChoices(shop(ninetyActive:false)),isEmpty);
  });
  testWidgets('the actual guest shop exposes an unlisted active sibling and starts its exact service/variant after a fresh same-shop read',(tester)async{
    tester.view.physicalSize=const Size(1000,1600);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final value=shop(),repository=ChoiceRepository(value);await tester.pumpWidget(detail(value,repository));await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));await tester.pumpAndSettle();
    final optionCard=find.byKey(const ValueKey('booking-choice:$serviceId:$activeId'));
    expect(find.text('Paused sixty-minute price row'),findsOneWidget);expect(find.text('Body massage · Ninety minutes'),findsOneWidget);expect(find.descendant(of:optionCard,matching:find.text('USD 90.00')),findsOneWidget);
    expect(find.text('Choose this service →'),findsNothing);expect(find.byType(BookingScreen),findsNothing);
    final book=find.descendant(of:optionCard,matching:find.byType(ShopServiceSelectionCard));
    expect(tester.widget<ShopServiceSelectionCard>(book).onSelected,isNotNull);
    await tester.ensureVisible(book);await tester.tap(book);await tester.pumpAndSettle();
    expect(repository.reads,['7']);expect(find.byType(BookingScreen),findsOneWidget);
    final state=ProviderScope.containerOf(tester.element(find.byType(BookingScreen))).read(bookingFlowProvider);
    expect(state.shop?.id,'7');expect(state.selectedService?.id,serviceId);expect(state.selectedVariant?.id,activeId);expect(state.selectedDuration,90);expect(state.selectedPriceCents,9000);
    expect(state.selectedService!.activeVariants.any((option)=>option.id==pausedId),isFalse);expect(state.hasValidPriceQuote,isFalse);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('a menu-covered active choice is shown once, and a vanished unlisted option never falls back to another variant',(tester)async{
    tester.view.physicalSize=const Size(1000,1600);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final covered=shop(menu:[menuRow(activeId)]),coveredRepository=ChoiceRepository(covered);
    await tester.pumpWidget(detail(covered,coveredRepository));await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));await tester.pumpAndSettle();
    expect(find.text('Listed ninety-minute price row'),findsOneWidget);expect(find.text('Body massage · Ninety minutes'),findsNothing);expect(find.text('Choose this service →'),findsNothing);
    expect(tester.widget<ShopServiceSelectionCard>(find.byKey(const ValueKey('price-menu-book-0-0'))).onSelected,isNotNull);
    await tester.pumpWidget(const SizedBox.shrink());
    final visible=shop(),repository=ChoiceRepository(shop(ninetyActive:false,sixtyActive:true));
    await tester.pumpWidget(detail(visible,repository));await tester.pumpAndSettle();
    final book=find.descendant(of:find.byKey(const ValueKey('booking-choice:$serviceId:$activeId')),matching:find.byType(ShopServiceSelectionCard));
    expect(tester.widget<ShopServiceSelectionCard>(book).onSelected,isNotNull);
    await tester.ensureVisible(book);await tester.tap(book);await tester.pumpAndSettle();
    expect(repository.reads,['7']);expect(find.byType(BookingScreen),findsNothing);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  test('authoritative ARB and generated English guidance agree on review-before-confirmation and offline handling',(){
    final arb=jsonDecode(File('lib/l10n/intl_en.arb').readAsStringSync()) as Map<String,dynamic>;
    final text=lookupAppLocalizations(const Locale('en')).reviewTotalBeforeConfirming;
    expect(arb['reviewTotalBeforeConfirming'],text);expect(arb.containsKey('finalPriceAfterBooking'),isFalse);
    expect(text,contains('before confirming'));expect(text,contains('offline'));expect(text,contains('does not record a payment'));expect(text,isNot(contains('after booking')));
    expect(bookingOrderExplanation,contains('Check email status'));expect(bookingOrderExplanation,isNot(contains('will be sent')));
  });
  testWidgets('the actual STANDARD and PLAN pre-submit summaries show the same accurate localized review instruction',(tester)async{
    tester.view.physicalSize=const Size(1000,1600);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final catalog=ShopDetail.fromJson({'id':'7','name':'Summary shop','latitude':0,'longitude':0,'timezone':'America/New_York','bookingCalendar':calendarFixture(),
      'services':[{'id':'8','name':'Fixed summary service','durationMin':60,'priceCents':5000}]});
    final text=lookupAppLocalizations(const Locale('en')).reviewTotalBeforeConfirming;
    await tester.pumpWidget(ProviderScope(overrides:[bookingRepositoryProvider.overrideWithValue(priced.StandardRepository())],child:localized(BookingScreen(shop:catalog))));await tester.pumpAndSettle();
    final flow=ProviderScope.containerOf(tester.element(find.byType(BookingScreen))).read(bookingFlowProvider.notifier);
    flow.selectService(catalog.services.single);flow.selectDate(DateTime(2031,5,1));await tester.pumpAndSettle();flow.toggleTimeSlot('10:00');await tester.pumpAndSettle();
    for(var step=0;step<3;step++){await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();}
    expect(find.text(text),findsWidgets);expect(find.textContaining('after booking'),findsNothing);expect(find.textContaining('will be sent'),findsNothing);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(ProviderScope(overrides:[bookingPlanRepositoryProvider.overrideWithValue(priced.PlanRepository())],child:localized(BookingPlanScreen(shop:catalog))));await tester.pumpAndSettle();
    final plan=ProviderScope.containerOf(tester.element(find.byType(BookingPlanScreen))).read(bookingPlanProvider(catalog).notifier);
    plan.selectService(0,0,'8');plan.selectDate('2031-05-01');await tester.pumpAndSettle();plan.selectTime('10:00');await tester.pumpAndSettle();
    for(var step=0;step<3;step++){await tester.tap(find.byType(FilledButton).last);await tester.pumpAndSettle();}
    expect(find.text(text),findsOneWidget);expect(find.textContaining('after booking'),findsNothing);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
