import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/service_duration.dart';

Map<String,dynamic> calendarFixture()=>{'today':'2031-05-01','timezone':'America/New_York','serverNow':'2031-05-01T14:00:00.000Z','validUntil':'2031-05-02T04:00:00.000Z'};

Map<String,dynamic> timedQuoteJson(Map<String,dynamic> request,{required int price,int minutes=60,int participants=1,List<MainDuration>? main,int fee=0}) {
  final rows=main??(request['items'] is List
    ? [for(final row in request['items'] as List)MainDuration(participantIndex:row['participantIndex'] as int,sequence:row['sequence'] as int,serviceId:row['serviceId'] as String,variantId:row['variantId'] as String?,durationKind:'TIMED',reservedDurationMin:minutes)]
    : [for(var guest=1;guest<=participants;guest++)MainDuration(participantIndex:guest,sequence:1,serviceId:request['serviceId'] as String,variantId:request['variantId'] as String?,durationKind:'TIMED',reservedDurationMin:minutes)]);
  final tip=request['tipCents'] as int? ?? 0;
  return {'shopId':request['shopId'],'currency':'usd','mainSubtotalCents':price,'addOnSubtotalCents':0,'subtotalCents':price,'discountEligibleCents':price,'discountCents':0,
    'platformFeeCents':fee,'tipCents':tip,'totalCents':price+fee+tip,'durationMin':minutes,'durationKind':'TIMED','mainDurations':rows.map((row)=>row.toJson()).toList(),
    'addOns':[],'quoteHash':'a'*64,'quoteExpiresAt':DateTime.now().toUtc().add(const Duration(minutes:5)).toIso8601String()};
}
Map<String,dynamic> therapistRequestFixture(Map<String,dynamic> request) {
  final ids = List<String>.from(request['preferredTherapistIds'] as List? ?? [if (request['therapistId'] != null) request['therapistId'] as String]);
  return {'therapistSelectionMode':ids.isEmpty?'AUTO':'SPECIFIC','requestedTherapistIds':ids};
}

Map<String,dynamic> quotedBookingJson(Map<String,dynamic> request,BookingPriceQuote quote,{Map<String,dynamic> extra=const {},int? requiredStaffCount}) {
  final plan=request['items'] is List;
  final requestRows=plan?List<Map<String,dynamic>>.from((request['items'] as List).map((row)=>Map<String,dynamic>.from(row as Map))):<Map<String,dynamic>>[];
  final participants=quote.mainDurations.map((row)=>row.participantIndex).toSet().length;
  final staff=requiredStaffCount??participants;
  final aggregate=plan?{'preferredTherapistIds':requestRows.expand((row)=>(therapistRequestFixture(row)['requestedTherapistIds'] as List).cast<String>()).toSet().toList()}:request;
  return {
  if(request['contact'] is Map) 'contact':{'recorded':true,'version':1,...Map<String,dynamic>.from(request['contact'] as Map)},
  'id':'42','shopId':quote.shopId,'durationMin':quote.durationMin,'priceCents':quote.subtotalCents,'mainSubtotalCents':quote.mainSubtotalCents,'addOnSubtotalCents':0,
  'totalCents':quote.totalCents,'platformFeeCents':quote.platformFeeCents,'tipCents':quote.tipCents,'currency':quote.currency,'status':'PENDING','paymentStatus':'UNPAID',
  'paymentMode':request['paymentMode'],'reservationKind':plan?'PLAN':'SINGLE',
  ...therapistRequestFixture(aggregate),'participantCount':participants,'requiredStaffCount':plan?participants:staff,
  'localDate':request['date'],'localStartTime':request['startTime'],
  'items':[for(var index=0;index<quote.mainDurations.length;index++){'id':'${100+index}',...quote.mainDurations[index].toJson(),'durationMin':quote.mainDurations[index].reservedDurationMin,
    ...therapistRequestFixture(plan?requestRows.singleWhere((row)=>row['participantIndex']==quote.mainDurations[index].participantIndex&&row['sequence']==quote.mainDurations[index].sequence):request),
    'requiredStaffCount':plan||participants>1?1:staff,
    'assignedTherapistIds':['${20+index}',if(!plan&&participants==1&&staff==2)'30'],
    'serviceNameSnapshot':'Quoted fixed service','priceCentsSnapshot':quote.mainSubtotalCents~/quote.mainDurations.length}],...extra,
  };
}
Booking quotedBookingFixture(Map<String,dynamic> request,BookingPriceQuote quote,{Map<String,dynamic> extra=const {},int? requiredStaffCount})=>Booking.fromJson(quotedBookingJson(request,quote,extra:extra,requiredStaffCount:requiredStaffCount));
