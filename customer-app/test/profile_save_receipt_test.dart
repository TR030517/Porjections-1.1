import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking_order_policy.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/edit_profile_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

class ProfileWire implements HttpClientAdapter {
  String customer='41';
  bool emailVerified=false;
  int emailChallenges=0;
  String currentEmail='';
  Map<String,dynamic>? overrideReceipt;
  Completer<void>? patchEntered,patchRelease;
  final paths=<String>[];
  final writes=<Map<String,dynamic>>[];
  Map<String,dynamic> profile(String id)=>{'id':id,'role':'CUSTOMER','status':'ACTIVE','name':'Original customer','phone':null,'email':currentEmail.isEmpty?null:currentEmail,'emailVerified':emailVerified,'avatarUrl':null};
  @override
  Future<ResponseBody> fetch(RequestOptions options,Stream<Uint8List>? stream,Future<void>? cancelFuture)async{
    final bytes=await stream?.expand((chunk)=>chunk).toList()??<int>[];
    final body=bytes.isEmpty?<String,dynamic>{}:Map<String,dynamic>.from(jsonDecode(utf8.decode(bytes)) as Map);
    paths.add(options.path);Object result;
    if(options.path=='/auth/customer/password/login'){
      result={'accessToken':'profile-$customer','refreshToken':'profile-refresh-$customer','user':profile(customer)};
    }else if(options.path=='/auth/customer/config'){
      result={'passwordEnabled':true,'passwordRegistrationEnabled':false,'emailOtp':{'enabled':true,'devOnly':true},'google':{'enabled':false,'webEnabled':false},'apple':{'enabled':false,'webEnabled':false},'nativeSocialEnabled':false};
    }else if(options.path=='/auth/customer/email/request'){
      result={'challengeId':'profile-email-challenge-${++emailChallenges}','expiresIn':600,'resendAfter':60,'devCode':'123456'};
    }else if(options.path=='/auth/customer/email/verify-current'){
      currentEmail='saved@example.invalid';emailVerified=true;result={'verified':true};
    }else if(options.path=='/auth/customer/logout'){
      result={'ok':true};
    }else if(options.path=='/auth/me'){
      throw DioException(requestOptions:options,response:Response(requestOptions:options,statusCode:503),type:DioExceptionType.badResponse);
    }else if(options.path.startsWith('/users/')&&options.method=='PATCH'){
      writes.add(body);final owner=options.path.split('/').last;
      if(patchEntered?.isCompleted==false)patchEntered!.complete();
      await patchRelease?.future;
      currentEmail=(body['email']??currentEmail) as String;
      if(body['email']!=null)emailVerified=false;
      result=overrideReceipt??{'id':owner,'role':'CUSTOMER','phone':null,'email':currentEmail.isEmpty?null:currentEmail,'emailVerified':emailVerified,'name':body['name']??'Original customer','avatarUrl':null};
    }else{throw StateError('Unexpected profile path ${options.path}');}
    return ResponseBody.fromString(jsonEncode(result),200,headers:{Headers.contentTypeHeader:['application/json']});
  }
  @override void close({bool force=false}){}
}
class AccountSummary extends ConsumerWidget {
  const AccountSummary({super.key});
  @override Widget build(BuildContext context,WidgetRef ref)=>Scaffold(body:Column(children:[
    Text('Current email: ${ref.watch(authProvider).user?.email??'missing'}'),
    Text('Verified: ${ref.watch(authProvider).user?.emailVerified??false}'),
    FilledButton(onPressed:()=>Navigator.push<void>(context,MaterialPageRoute(builder:(_)=>const EditProfileScreen())),child:const Text('Edit account')),
  ]));
}
void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(()=>FlutterSecureStorage.setMockInitialValues({}));
  test('a saved email stays blocked for orders until its current account verifies it',()async{
    final api=ApiService(),previous=ApiService().dio.httpClientAdapter,wire=ProfileWire();api.dio.httpClientAdapter=wire;
    final auth=AuthNotifier(api);addTearDown(auth.dispose);addTearDown(()=>api.dio.httpClientAdapter=previous);
    await auth.passwordLogin('profile@example.invalid','synthetic-password');
    final saved=await auth.updateProfile(name:'Saved customer',email:'saved@example.invalid');
    expect(wire.writes,[{'name':'Saved customer','email':'saved@example.invalid'}]);
    expect(saved.id,'41');expect(auth.state.user?.email,'saved@example.invalid');expect(auth.state.user?.emailVerified,false);expect(auth.state.user?.status,'ACTIVE');
    expect(bookingAccountEmail(auth.state.user),isNull);expect(wire.paths.where((path)=>path=='/auth/me'),isEmpty);
    final challenge=await api.requestEmailLogin('saved@example.invalid');
    await auth.verifyCurrentEmail(challenge['challengeId'] as String,'123456');
    expect(auth.state.user?.emailVerified,true);expect(bookingAccountEmail(auth.state.user),'saved@example.invalid');
    await auth.refreshProfile();expect(auth.state.isLoggedIn,isTrue);expect(auth.state.user?.email,'saved@example.invalid');
    expect(wire.writes,hasLength(1));expect(wire.paths.where((path)=>path=='/auth/me'),hasLength(1));
  });
  test('an A profile save that finishes after B logs in cannot change B identity or email',()async{
    final api=ApiService(),previous=ApiService().dio.httpClientAdapter,wire=ProfileWire()..patchEntered=Completer<void>()..patchRelease=Completer<void>();api.dio.httpClientAdapter=wire;
    final auth=AuthNotifier(api);addTearDown(auth.dispose);addTearDown(()=>api.dio.httpClientAdapter=previous);
    await auth.passwordLogin('first@example.invalid','synthetic-password');
    final rejected=expectLater(auth.updateProfile(email:'first@example.invalid'),throwsA(isA<DioException>().having((error)=>error.type,'type',DioExceptionType.cancel)));
    await wire.patchEntered!.future;wire.customer='42';await auth.passwordLogin('second@example.invalid','synthetic-password');
    wire.patchRelease!.complete();await rejected;
    expect(auth.state.user?.id,'42');expect(auth.state.user?.email,isNull);expect(await api.getAccessToken(),'profile-42');expect(wire.writes,hasLength(1));
  });
  test('wrong-account, partial, wrong-role and mismatched save receipts cannot become an authenticated account profile',()async{
    final api=ApiService(),previous=ApiService().dio.httpClientAdapter,wire=ProfileWire();api.dio.httpClientAdapter=wire;
    final auth=AuthNotifier(api);addTearDown(auth.dispose);addTearDown(()=>api.dio.httpClientAdapter=previous);
    await auth.passwordLogin('profile@example.invalid','synthetic-password');
    for(final patch in [<String,dynamic>{'id':'42'},<String,dynamic>{'role':'MERCHANT'},<String,dynamic>{'email':'different@example.invalid'}]){
      wire.overrideReceipt={...wire.profile('41'),'email':'saved@example.invalid',...patch};
      await expectLater(auth.updateProfile(email:'saved@example.invalid'),throwsA(isA<ProfileSaveUnverified>()));
      expect(auth.state.user?.id,'41');expect(auth.state.user?.email,isNull);expect(auth.state.user?.role,'CUSTOMER');
    }
    wire.overrideReceipt={'id':'41','role':'CUSTOMER','email':'saved@example.invalid'};
    await expectLater(auth.updateProfile(email:'saved@example.invalid'),throwsA(isA<ProfileSaveUnverified>()));
    expect(auth.state.user?.email,isNull);expect(wire.paths.where((path)=>path=='/auth/me'),isEmpty);
  });
  test('disposing the authentication owner while saving prevents its late receipt from committing state',()async{
    final api=ApiService(),previous=ApiService().dio.httpClientAdapter,wire=ProfileWire()..patchEntered=Completer<void>()..patchRelease=Completer<void>();api.dio.httpClientAdapter=wire;addTearDown(()=>api.dio.httpClientAdapter=previous);
    final auth=AuthNotifier(api);await auth.passwordLogin('profile@example.invalid','synthetic-password');
    final rejected=expectLater(auth.updateProfile(email:'saved@example.invalid'),throwsStateError);
    await wire.patchEntered!.future;auth.dispose();wire.patchRelease!.complete();await rejected;expect(wire.writes,hasLength(1));
  });
  testWidgets('profile UI requires and completes email verification before enabling order contact',(tester)async{
    final api=ApiService(),previous=ApiService().dio.httpClientAdapter,wire=ProfileWire();api.dio.httpClientAdapter=wire;addTearDown(()=>api.dio.httpClientAdapter=previous);
    final auth=AuthNotifier(api);var scopeOwnsAuth=false;
    addTearDown(() { if(!scopeOwnsAuth)auth.dispose(); });
    // Earlier ordinary tests initialized this singleton's storage queue in a
    // real async zone. Start and await login in that zone, before UI pumping.
    await tester.runAsync(() async { await auth.passwordLogin('profile@example.invalid','synthetic-password'); });
    expect(auth.state.isLoggedIn,isTrue);expect(auth.state.user?.id,'41');
    expect(wire.paths.where((path)=>path=='/auth/customer/password/login'),hasLength(1));
    await tester.pumpWidget(ProviderScope(overrides:[authProvider.overrideWith((ref){scopeOwnsAuth=true;return auth;})],child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:const AccountSummary())));
    await tester.tap(find.text('Edit account'));await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).last,'saved@example.invalid');await tester.tap(find.widgetWithText(FilledButton,'Save'));await tester.pumpAndSettle();
    expect(find.byType(EditProfileScreen),findsOneWidget);expect(find.text('Booking orders require a verified account email.'),findsOneWidget);expect(wire.writes,hasLength(1));expect(wire.paths.where((path)=>path=='/auth/me'),isEmpty);
    await tester.tap(find.text('Send email verification code'));await tester.pumpAndSettle();
    expect(find.text('Local development code: 123456 (no email sent)'),findsOneWidget);
    await tester.enterText(find.byType(TextFormField).last,'111111');
    await tester.pump(const Duration(seconds:60));await tester.pumpAndSettle();
    await tester.tap(find.text('Send email verification code'));await tester.pumpAndSettle();
    expect(wire.emailChallenges,2);
    expect(tester.widget<TextFormField>(find.byType(TextFormField).last).controller?.text,isEmpty);
    await tester.enterText(find.byType(TextFormField).last,'123456');
    await tester.tap(find.text('Verify email'));await tester.pumpAndSettle();
    expect(auth.state.user?.emailVerified,true);expect(find.text('Email verified. You can now submit booking orders.'),findsOneWidget);
    await tester.pageBack();await tester.pumpAndSettle();
    expect(find.text('Current email: saved@example.invalid'),findsOneWidget);expect(find.text('Verified: true'),findsOneWidget);
    expect(wire.writes,hasLength(1));expect(wire.paths.where((path)=>path=='/auth/me'),isEmpty);
    await tester.tap(find.text('Edit account'));await tester.pumpAndSettle();
    wire.overrideReceipt={'id':'42','role':'CUSTOMER','phone':null,'email':'wrong@example.invalid','name':'Original customer','avatarUrl':null};
    await tester.enterText(find.byType(TextFormField).last,'next@example.invalid');await tester.tap(find.widgetWithText(FilledButton,'Save'));await tester.pumpAndSettle();
    expect(find.byType(EditProfileScreen),findsOneWidget);expect(find.textContaining('save response was received'),findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);expect(auth.state.user?.id,'41');expect(auth.state.user?.email,'saved@example.invalid');
    await tester.tap(find.text('Reload account details'));await tester.pumpAndSettle();
    expect(find.textContaining('Account details could not be reloaded'),findsOneWidget);expect(wire.writes,hasLength(2));expect(wire.paths.where((path)=>path=='/auth/me'),hasLength(1));
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);expect(tester.takeException(),isNull);
  });
}
