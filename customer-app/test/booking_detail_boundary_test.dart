import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'booking_quote_fixture.dart';
import 'reschedule_test_fixture.dart';

Map<String,dynamic> bookingJson({String status='CONFIRMED',int due=8000})=>{
  'id':'42','userId':'41','shopId':'7','serviceId':'8','bookingNo':'PRIVATE-ORIGINAL-CUSTOMER',
  'durationMin':60,'priceCents':8000,'totalCents':8000,'paidCents':0,'refundedCents':0,'amountDueCents':due,
  'currency':'usd','status':status,'paymentStatus':'UNPAID','paymentMode':'PAY_AT_STORE',
  'startTime':'2031-05-01T14:00:00Z','endTime':'2031-05-01T15:00:00Z','localDate':'2031-05-01',
  'localStartTime':'10:00','localEndTime':'11:00','timezone':'America/New_York',
  'items':[{'id':'100','serviceId':'8','participantIndex':1,'sequence':1,'serviceNameSnapshot':'Original private treatment','durationMin':60,'priceCentsSnapshot':8000}],
};

class BoundaryCustomer extends AuthNotifier {
  BoundaryCustomer():super(ApiService()){customer('41');}
  void customer(String? id)=>state=id==null?const AuthState():AuthState(isLoggedIn:true,user:User(id:id,role:'CUSTOMER'));
}
class DetailWire implements HttpClientAdapter {
  Completer<void>? readRelease,saveRelease;
  final paths=<String>[];
  Map<String,dynamic>? savedBody;
  @override
  Future<ResponseBody> fetch(RequestOptions options,Stream<Uint8List>? requestStream,Future<void>? cancelFuture)async{
    final bytes=await requestStream?.expand((chunk)=>chunk).toList()??<int>[];
    paths.add(options.path);
    Object body;
    if(options.path=='/auth/customer/password/login'){
      body={'accessToken':'boundary-customer','refreshToken':'boundary-refresh','user':{'id':'41','role':'CUSTOMER'}};
    }else if(options.path=='/bookings/42/reschedule-slots'){
      body={'date':options.queryParameters['date'],'timezone':'America/New_York','bookingCalendar':calendarFixture(),'slots':[{'time':'11:00','available':true}]};
    }else if(options.path=='/bookings/42/reschedule'){
      savedBody=Map<String,dynamic>.from(jsonDecode(utf8.decode(bytes)) as Map);
      await saveRelease?.future;body=bookingJson();
    }else if(options.path=='/bookings/42'){
      await readRelease?.future;body=bookingJson();
    }else{throw StateError('Unexpected request ${options.path}');}
    return ResponseBody.fromString(jsonEncode(body),200,headers:{Headers.contentTypeHeader:['application/json']});
  }
  @override
  void close({bool force=false}){}
}

Widget detail(BoundaryCustomer auth,{VoidCallback? onChanged})=>ProviderScope(
  overrides:[authProvider.overrideWith((ref)=>auth)],
  child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
    home:BookingDetailScreen(bookingId:'42',onChanged:onChanged)),
);

Future<void> pumpUntil(WidgetTester tester,bool Function() ready,String reason)async{
  for(var i=0;i<100&&!ready();i++){
    await tester.pump(const Duration(milliseconds:10));
  }
  expect(ready(),isTrue,reason:reason);
}

Future<void> signInBoundary(WidgetTester tester,ApiService api)async{
  var completed=false;
  final outcome=expectLater(
    api.passwordLogin('boundary@example.invalid','synthetic-password').whenComplete(()=>completed=true),
    completion(isA<User>().having((user)=>user.id,'customer','41')),
  );
  await pumpUntil(tester,()=>completed,'The synthetic customer login must finish before opening the private booking.');
  await outcome;
}

void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(()=>FlutterSecureStorage.setMockInitialValues({}));
  test('terminal pay-at-store guidance reports history without asking cancelled or refunded customers to pay',(){
    for(final status in ['CANCELLED','REFUNDED','REFUNDING','COMPLETED']){
      final text=bookingPaymentGuidance(Booking.fromJson(bookingJson(status:status,due:0)));
      expect(text,isNot(contains('Pay the outstanding')));expect(text,isNot(contains('Waiting for the shop to accept')));
    }
    final corrected=bookingPaymentGuidance(Booking.fromJson({...bookingJson(status:'COMPLETED',due:7000),'orderOnly':false,'onlinePaymentEnabled':true}));
    expect(corrected,contains('completed'));expect(corrected,contains('outstanding balance'));expect(corrected,isNot(contains('settled')));
    final pending=bookingPaymentGuidance(Booking.fromJson(bookingJson(status:'PENDING')));
    expect(pending,contains('confirm and handle it offline'));expect(pending,isNot(contains('Pay the outstanding')));
    final confirmed=bookingPaymentGuidance(Booking.fromJson(bookingJson()));
    expect(confirmed,contains('handles this booking order offline'));expect(confirmed,isNot(contains('will confirm')));expect(confirmed,isNot(contains('Pay the outstanding')));
    expect(bookingPaymentGuidance(Booking.fromJson({...bookingJson(),'onlinePaymentEnabled':true,'orderOnly':false})),contains('Pay the outstanding amount at the store'));
  });

  testWidgets('late detail and reschedule replies cannot update the next customer',(tester)async{
    await resetSyntheticReschedule(tester);
    // Keep this singleton's serialized storage futures in one fake-clock zone.
    // Each scenario still opens a fresh provider scope and a real Dio adapter.
    tester.view.physicalSize=const Size(800,1400);tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    final api=ApiService(),previousAdapter=ApiService().dio.httpClientAdapter;
    addTearDown(()=>api.dio.httpClientAdapter=previousAdapter);
    {
    final wire=DetailWire()..readRelease=Completer<void>();api.dio.httpClientAdapter=wire;
    await signInBoundary(tester,api);
    final auth=BoundaryCustomer();await tester.pumpWidget(detail(auth));
    await pumpUntil(tester,()=>wire.paths.contains('/bookings/42'),'The original customer detail request must reach the transport before the account changes.');
    expect(wire.paths,contains('/bookings/42'));auth.customer('42');await tester.pump();
    expect(find.textContaining('The customer session changed'),findsOneWidget);
    wire.readRelease!.complete();await tester.pumpAndSettle();
    expect(find.text('PRIVATE-ORIGINAL-CUSTOMER'),findsNothing);expect(find.text('Original private treatment'),findsNothing);
    final reload=find.byWidgetPredicate((widget)=>widget is IconButton&&widget.tooltip=='Reload');
    expect(reload,findsOneWidget);expect(tester.widget<IconButton>(reload).onPressed,isNull);
    expect(wire.paths.where((path)=>path=='/bookings/42'),hasLength(1));expect(tester.takeException(),isNull);
    }
    await tester.pumpWidget(const SizedBox.shrink());await tester.pumpAndSettle();
    {
    final wire=DetailWire()..saveRelease=Completer<void>();api.dio.httpClientAdapter=wire;
    await signInBoundary(tester,api);
    final auth=BoundaryCustomer();var changed=0;await tester.pumpWidget(detail(auth,onChanged:()=>changed++));
    await pumpUntil(tester,()=>find.text('Change booking time').evaluate().isNotEmpty,'The original booking must finish loading before opening its reschedule dialog.');
    expect(find.byWidgetPredicate((widget)=>widget is SelectableText&&widget.data=='PRIVATE-ORIGINAL-CUSTOMER'),findsOneWidget);
    await tester.ensureVisible(find.text('Change booking time'));await tester.tap(find.text('Change booking time'));
    final nextTime=find.widgetWithText(ChoiceChip,'11:00');
    await pumpUntil(tester,()=>nextTime.evaluate().isNotEmpty,'The changed arrival time must come from the completed availability response.');
    await tester.pumpAndSettle();await tester.tap(nextTime);await tester.pump();
    expect(tester.widget<ChoiceChip>(nextTime).selected,isTrue);
    final save=find.widgetWithText(FilledButton,'Save time');
    expect(tester.widget<FilledButton>(save).onPressed,isNotNull);
    await tester.tap(save);
    await pumpUntil(tester,()=>wire.paths.contains('/bookings/42/reschedule'),'The reschedule command must reach the transport before the account changes.');
    expect(wire.savedBody,{'date':'2031-05-01','startTime':'11:00'});
    expect(wire.paths,contains('/bookings/42/reschedule'));
    auth.customer('42');await tester.pump();wire.saveRelease!.complete();await tester.pumpAndSettle();
    expect(changed,0);expect(find.text('Booking time updated.'),findsNothing);expect(find.text('Customer session changed'),findsOneWidget);
    expect(wire.paths.where((path)=>path=='/bookings/42/reschedule'),hasLength(1));expect(tester.takeException(),isNull);
    }
  });
}
