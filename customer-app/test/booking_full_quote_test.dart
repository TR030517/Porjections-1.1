import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'booking_quote_fixture.dart';

class PriceWire implements HttpClientAdapter {
  int price=10000,commits=0;
  final commands=<Map<String,dynamic>>[],quotes=<Map<String,dynamic>>[];
  Map<String,dynamic>? committed;
  @override Future<ResponseBody> fetch(RequestOptions options,Stream<Uint8List>? stream,Future<void>? cancelFuture)async{
    final bytes=await stream?.expand((chunk)=>chunk).toList()??<int>[];
    final body=bytes.isEmpty?<String,dynamic>{}:Map<String,dynamic>.from(jsonDecode(utf8.decode(bytes)) as Map);
    Object result;var status=200;
    if(options.path=='/auth/customer/password/login'){
      result={'accessToken':'current-price-customer','refreshToken':'current-price-refresh','user':{'id':'41','role':'CUSTOMER'}};
    }else if(options.path=='/bookings/slots'){
      result={'date':options.queryParameters['date'],'priceCents':price,'durationMin':60,'durationKind':'TIMED','timezone':'America/New_York','slots':[{'time':'10:00','available':true}]};
    }else if(options.path=='/bookings/quote'){
      final quote={...timedQuoteJson(body,price:price),'quoteHash':price.toString().padLeft(64,'0')};quotes.add(quote);result=quote;
    }else if(options.path=='/bookings'){
      commands.add(body);
      if(committed!=null&&committed!['requestKey']==body['requestKey']){result=committed!;}
      else if(body['quoteHash']!=price.toString().padLeft(64,'0')){status=409;result={'message':'The current order total changed. Review it again.'};}
      else{
        final quote=BookingPriceQuote.fromJson(quotes.last);
        commits++;final saved=quotedBookingJson(body,quote,extra:{'userId':'41','requestKey':body['requestKey']});
        committed=saved;result=saved;
      }
    }else{throw StateError('Unexpected price path ${options.path}');}
    return ResponseBody.fromString(jsonEncode(result),status,headers:{Headers.contentTypeHeader:['application/json']});
  }
  @override void close({bool force=false}){}
}
void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  test('plain TIMED reviews the current total and a later price change rejects creation until the customer explicitly rereviews',()async{
    FlutterSecureStorage.setMockInitialValues({});clearBookingRecoveryMarker();
    final api=ApiService(),previous=ApiService().dio.httpClientAdapter,wire=PriceWire();api.dio.httpClientAdapter=wire;addTearDown(()=>api.dio.httpClientAdapter=previous);addTearDown(clearBookingRecoveryMarker);
    await api.passwordLogin('customer@example.invalid','synthetic-password');
    final shop=ShopDetail.fromJson({'id':'7','name':'Old 80 dollar view','latitude':0,'longitude':0,'timezone':'America/New_York','services':[{'id':'8','name':'Current price service','durationMin':60,'priceCents':8000}]});
    final flow=BookingFlowNotifier(BookingRepository(api),currentCustomerId:()=>'41', currentCustomerEmail: () => 'customer@example.invalid', currentCustomerName: () => 'Test customer', currentCustomerPhone: () => '+12065550123');addTearDown(flow.dispose);
    flow.initFlow(shop);flow.selectService(shop.services.single);flow.selectDate(DateTime(2031,5,1));
    for(var tick=0;tick<100&&flow.state.isLoadingSlots;tick++){await Future<void>.delayed(Duration.zero);}
    expect(flow.state.isLoadingSlots,isFalse);expect(flow.state.error,isNull);flow.toggleTimeSlot('10:00');
    expect(flow.state.canConfirm,isFalse);expect(await flow.confirmBooking(),isNull);expect(wire.commands,isEmpty);
    await flow.refreshPriceQuote();expect(flow.state.priceQuote!.totalCents,10000);expect(flow.state.canConfirm,isTrue);
    wire.price=12000;expect(await flow.confirmBooking(),isNull);expect(wire.commits,0);expect(flow.state.canConfirm,isFalse);expect(wire.quotes,hasLength(1));expect(flow.state.pendingAttempt,isNull);
    final originalKey=wire.commands.single['requestKey'];await flow.confirmBooking();expect(wire.commands,hasLength(1));
    await flow.refreshPriceQuote();expect(flow.state.priceQuote!.totalCents,12000);expect(flow.state.canConfirm,isTrue);
    final saved=await flow.confirmBooking();expect(saved!.totalCents,12000);expect(wire.commits,1);expect(wire.commands,hasLength(2));expect(wire.quotes,hasLength(2));
    expect(wire.commands.last['requestKey'],originalKey);expect(wire.commands.last['quoteHash'],wire.quotes.last['quoteHash']);expect(wire.commands.last['quoteExpiresAt'],wire.quotes.last['quoteExpiresAt']);
    expect(wire.commands.last['durationMin'],60);expect(wire.commands.last.containsKey('priceCents'),isFalse);expect(wire.commands.last.containsKey('totalCents'),isFalse);
  });
}
