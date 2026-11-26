import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking_calendar.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/widgets/booking_calendar_picker.dart';
import 'booking_add_ons_test.dart' as fixture;

Map<String,dynamic> calendar(String today,String zone,String now,String until)=>{'today':today,'timezone':zone,'serverNow':now,'validUntil':until};
ShopDetail calendarShop(Map<String,dynamic>? value,{String id='7',String? zone,List<Map<String,String>> closedPeriods=const []})=>ShopDetail.fromJson({'id':id,'name':'Shop calendar','latitude':0,'longitude':0,
  'timezone':zone??value?['timezone'],'bookingCalendar':value,'bookingSettings':{'minimumNoticeMinutes':0,'closedPeriods':closedPeriods},'services':[{'id':'8','name':'Fixed service','durationMin':60,'priceCents':5000}]});
class CalendarRepository extends ShopRepository {
  CalendarRepository(this.next):super(ApiService());
  ShopDetail next;final reads=<String>[];
  @override Future<ShopDetail> getShopDetail(String id)async{reads.add(id);return next;}
}
Widget picker(ShopDetail shop,{bool compact=false,ValueChanged<DateTime>? select,VoidCallback? invalidated})=>ProviderScope(child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:Scaffold(body:BookingCalendarPicker(
  shop:shop,selectedDate:null,compact:compact,onSelected:select??(_){},onInvalidated:invalidated??(){},
))));

void main(){
  testWidgets('ordinary booking can choose the first reopening date beyond the fourteen-day quick list',(tester)async{
    final shop=calendarShop(calendar('2031-05-01','UTC','2031-05-01T12:00:00Z','2031-05-02T00:00:00Z'),
      closedPeriods:[{'startDate':'2031-05-01','endDate':'2031-05-20'}]);
    DateTime? chosen;await tester.pumpWidget(picker(shop,select:(date)=>chosen=date));
    await tester.tap(find.text('Choose another date'));await tester.pumpAndSettle();
    final dialog=tester.widget<DatePickerDialog>(find.byType(DatePickerDialog));
    expect(dialog.initialDate,DateTime(2031,5,21));
    expect(dialog.selectableDayPredicate!(DateTime(2031,5,20)),isFalse);
    expect(dialog.selectableDayPredicate!(DateTime(2031,5,21)),isTrue);
    await tester.tap(find.text('OK'));await tester.pumpAndSettle();
    expect(chosen,DateTime.utc(2031,5,21));await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('calendar refresh applies new closure rules to quick buttons and the full date dialog',(tester)async{
    final value=calendar('2031-05-01','UTC','2031-05-01T12:00:00Z','2031-05-02T00:00:00Z');
    final original=calendarShop(value,closedPeriods:[{'startDate':'2031-05-01','endDate':'2031-05-01'}]);
    final repo=CalendarRepository(calendarShop(value,closedPeriods:[{'startDate':'2031-05-02','endDate':'2031-05-03'}]));
    final flow=BookingFlowNotifier(fixture.StandardRepository());flow.initFlow(original);flow.selectService(original.services.single);flow.selectDate(DateTime.utc(2031,5,2));
    var invalidated=0;await tester.pumpWidget(ProviderScope(overrides:[shopRepositoryProvider.overrideWithValue(repo)],
      child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:Scaffold(body:BookingCalendarPicker(shop:original,selectedDate:null,onSelected:(_){},
        onInvalidated:(){invalidated++;flow.invalidateCalendarSelection();},onShopRefreshed:flow.refreshShopDetails)))));
    OutlinedButton day(String label)=>tester.widget<OutlinedButton>(find.ancestor(of:find.text(label),matching:find.byType(OutlinedButton)));
    expect(day('5/1').onPressed,isNull);expect(day('5/2').onPressed,isNotNull);
    await tester.tap(find.text('Refresh shop calendar'));await tester.pumpAndSettle();
    expect(invalidated,1);expect(repo.reads,['7']);expect(day('5/1').onPressed,isNotNull);expect(day('5/2').onPressed,isNull);
    expect(identical(flow.state.shop,repo.next),isTrue);expect(flow.state.shop!.bookingSettings.closedPeriods.single.startDate,'2031-05-02');
    expect(flow.state.selectedDate,isNull);expect(flow.state.priceQuote,isNull);
    await tester.tap(find.text('Choose another date'));await tester.pumpAndSettle();
    final dialog=tester.widget<DatePickerDialog>(find.byType(DatePickerDialog));
    expect(dialog.selectableDayPredicate!(DateTime(2031,5,1)),isTrue);expect(dialog.selectableDayPredicate!(DateTime(2031,5,2)),isFalse);
    await tester.tap(find.text('Cancel'));await tester.pumpAndSettle();await tester.pumpWidget(const SizedBox.shrink());flow.dispose();
  });
  test('calendar dates and expiry use the server day and actual DST midnight interval, never the device absolute date',(){
    for(final value in [calendar('2031-03-09','America/New_York','2031-03-09T05:00:00Z','2031-03-10T04:00:00Z'),
      calendar('2031-11-02','America/New_York','2031-11-02T04:00:00Z','2031-11-03T05:00:00Z')]){
      final parsed=BookingCalendar.parse(value,timezone:'America/New_York')!;
      expect(parsed.today.toIso8601String().substring(0,10),value['today']);expect(parsed.isCurrent,isTrue);
      expect(parsed.validUntil.difference(parsed.serverNow).inHours,value['today']=='2031-03-09'?23:25);
    }
    expect(BookingCalendar.parse(null),isNull);expect(BookingCalendar.parse({...calendar('2031-05-01','UTC','2031-05-01T12:00:00Z','2031-05-02T00:00:00Z'),'today':'2031-02-30'}),isNull);
    expect(BookingCalendar.parse(calendar('2031-05-01','UTC','2031-05-01T12:00:00Z','2031-05-02T00:00:00Z'),timezone:'America/New_York'),isNull);
  });
  testWidgets('the same UTC instant exposes each shops own today, including an island already on the next date',(tester)async{
    tester.view.physicalSize=const Size(900,700);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final cases=[calendar('2031-05-01','America/New_York','2031-05-01T11:00:00Z','2031-05-02T04:00:00Z'),
      calendar('2031-05-02','Pacific/Kiritimati','2031-05-01T11:00:00Z','2031-05-02T10:00:00Z')];
    for(final value in cases){
      DateTime? chosen;await tester.pumpWidget(picker(calendarShop(value),select:(date)=>chosen=date));await tester.pumpAndSettle();
      expect(find.text('Today'),findsOneWidget);await tester.tap(find.text('Today'));await tester.pump();
      expect(chosen?.toIso8601String().substring(0,10),value['today']);expect(find.text('Shop-local date · ${value['timezone']}'),findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    }
    expect(tester.takeException(),isNull);
  });
  testWidgets('PLAN date dialog begins on the shop day through both DST transition days',(tester)async{
    for(final value in [calendar('2031-03-09','America/New_York','2031-03-09T05:00:00Z','2031-03-10T04:00:00Z'),
      calendar('2031-11-02','America/New_York','2031-11-02T04:00:00Z','2031-11-03T05:00:00Z')]){
      await tester.pumpWidget(picker(calendarShop(value),compact:true));await tester.tap(find.text('Choose date'));await tester.pumpAndSettle();
      final dialog=tester.widget<DatePickerDialog>(find.byType(DatePickerDialog));
      final expected=DateTime.parse(value['today'] as String);expect(dialog.firstDate.year,expected.year);expect(dialog.firstDate.month,expected.month);expect(dialog.firstDate.day,expected.day);
      expect(dialog.initialDate,DateUtils.dateOnly(expected));
      await tester.tap(find.text('Cancel'));await tester.pumpAndSettle();await tester.pumpWidget(const SizedBox.shrink());
    }
    expect(tester.takeException(),isNull);
  });
  testWidgets('missing calendar fails closed and explicit refresh reads only the requested shop before enabling dates',(tester)async{
    final good=calendarShop(calendar('2031-05-02','Pacific/Kiritimati','2031-05-01T11:00:00Z','2031-05-02T10:00:00Z'));
    final repo=CalendarRepository(good);var invalidated=0;
    await tester.pumpWidget(ProviderScope(overrides:[shopRepositoryProvider.overrideWithValue(repo)],child:MaterialApp(home:Scaffold(body:BookingCalendarPicker(
      shop:calendarShop(null,zone:'Pacific/Kiritimati'),selectedDate:null,onSelected:(_){},onInvalidated:()=>invalidated++,
    )))));await tester.pumpAndSettle();
    expect(find.text('Today'),findsNothing);await tester.tap(find.text('Refresh shop calendar'));await tester.pumpAndSettle();
    expect(repo.reads,['7']);expect(invalidated,1);expect(find.text('Today'),findsOneWidget);expect(find.text('5/2'),findsOneWidget);
    repo.next=calendarShop(calendar('2031-05-02','Pacific/Kiritimati','2031-05-01T11:00:00Z','2031-05-02T10:00:00Z'),id:'8');
    await tester.tap(find.text('Refresh shop calendar'));await tester.pumpAndSettle();
    expect(repo.reads,['7','7']);expect(find.text('Today'),findsNothing);expect(find.textContaining('calendar is unavailable'),findsOneWidget);expect(tester.takeException(),isNull);
  });
  testWidgets('shop-midnight expiry clears a not-yet-submitted date, arrival and quote while leaving service selection intact',(tester)async{
    final value=calendar('2031-05-01','America/New_York','2031-05-02T03:59:00Z','2031-05-02T04:00:00Z'),shop=calendarShop(value);
    final flow=BookingFlowNotifier(fixture.StandardRepository());flow.initFlow(shop);flow.selectService(shop.services.single);flow.selectDate(DateTime(2031,5,1));
    await tester.pumpWidget(picker(shop,invalidated:flow.invalidateCalendarSelection));await tester.pumpAndSettle();flow.toggleTimeSlot('10:00');
    var priced=false;final request=flow.refreshPriceQuote().whenComplete(()=>priced=true);for(var step=0;step<100&&!priced;step++){await tester.pump(const Duration(milliseconds:10));}expect(priced,isTrue);await request;
    expect(flow.state.hasValidPriceQuote,isTrue);await tester.pump(const Duration(minutes:1));await tester.pump();
    expect(flow.state.selectedDate,isNull);expect(flow.state.selectedStartTime,isNull);expect(flow.state.priceQuote,isNull);expect(flow.state.selectedService?.id,'8');expect(find.text('Today'),findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());flow.dispose();expect(tester.takeException(),isNull);
  });
}
