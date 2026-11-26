import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/services/api_service.dart';

// The real ApiService refresh creates its own Dio. Intercept HttpClient in a
// local zone so that this test covers that actual path without opening a socket.
class StubHeaders extends Fake implements HttpHeaders {
  final values = <String, List<String>>{};
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) =>
      values[name.toLowerCase()] = [value.toString()];
  @override
  void forEach(void Function(String, List<String>) action) =>
      values.forEach(action);
}

class StubResponse extends Stream<List<int>> implements HttpClientResponse {
  final Map<String, dynamic> body;
  StubResponse(this.body);
  @override
  final headers = StubHeaders()..set('content-type', 'application/json');
  @override
  int get statusCode => 200;
  @override
  bool get isRedirect => false;
  @override
  List<RedirectInfo> get redirects => [];
  @override
  String get reasonPhrase => 'OK';
  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => Stream.value(utf8.encode(jsonEncode(body))).listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class SessionWire implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  final refreshRequests = <({String method, Uri uri, dynamic body})>[];
  Completer<void> started = Completer<void>();
  Completer<void> release = Completer<void>();
  String refreshRole = 'CUSTOMER';
  String loginCustomerId = '41', refreshCustomerId = '41';
  Completer<void>? privateStarted, privateRelease;
  int privateStatus = 401;
  Completer<void>? logoutStarted, logoutRelease;
  Completer<void>? profileStarted, profileRelease, loginStarted, loginRelease;
  int? profileStatus;
  String? delayedLoginEmail;
  int delayedLoginStatus = 400;
  int loginCount = 0;
  bool protect = true;

  Map<String, dynamic> session(String token, [String role = 'CUSTOMER', String id = '41']) => {
    'accessToken': token,
    'refreshToken': id=='41'?'synthetic-native-refresh':'synthetic-native-refresh-$id',
    'user': {'id': id, 'role': role},
  };
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    await requestStream?.drain<void>();
    requests.add(options);
    Object body;
    var status = 200;
    switch (options.path) {
      case '/auth/customer/password/login':
        final loginToken = 'synthetic-login-${++loginCount}', loginCustomer = loginCustomerId;
        if (delayedLoginEmail != null && (options.data as Map)['email'] == delayedLoginEmail) {
          if (loginStarted?.isCompleted == false) loginStarted!.complete();
          await loginRelease?.future;
          status = delayedLoginStatus;
        }
        body = status == 200 ? session(loginToken, 'CUSTOMER', loginCustomer) : {'message':'Synthetic login rejected'};
      case '/auth/customer/logout':
        if(logoutStarted?.isCompleted==false)logoutStarted!.complete();
        await logoutRelease?.future;
        body = {'ok': true};
      case '/auth/customer/providers/google/link':
        body = {'ok': true};
      case '/auth/me':
        final token = options.headers['Authorization'], customer = loginCustomerId;
        if (profileStarted?.isCompleted == false) profileStarted!.complete();
        await profileRelease?.future;
        if (profileStatus != null || protect && token != 'Bearer synthetic-refreshed') {
          status = profileStatus ?? 401;
          body = {'message': 'Synthetic expired access'};
        } else {
          body = {'id': customer, 'role': 'CUSTOMER', 'phone': null,
            'email': null, 'emailVerified': false, 'name': null, 'avatarUrl': null};
        }
      case '/bookings':
      case '/bookings/42':
        if (privateStarted?.isCompleted == false) privateStarted!.complete();
        await privateRelease?.future;
        status = privateStatus;
        body = status == 200 ? {'id':'42','shopId':'7','userId':'41','durationMin':60} : {'message':'Synthetic expired booking request'};
      default:
        throw StateError(
          'Customer must never call management session endpoints',
        );
    }
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class StubRequest extends Fake implements HttpClientRequest {
  final SessionWire wire;
  @override
  final String method;
  @override
  final Uri uri;
  final bytes = <int>[];
  StubRequest(this.wire, this.method, this.uri);
  @override
  final headers = StubHeaders();
  @override
  set followRedirects(bool value) {}
  @override
  set maxRedirects(int value) {}
  @override
  set persistentConnection(bool value) {}
  @override
  Future<void> addStream(Stream<List<int>> stream) async {
    await for (final chunk in stream) {
      bytes.addAll(chunk);
    }
  }

  @override
  Future<HttpClientResponse> close() async {
    wire.refreshRequests.add((
      method: method,
      uri: uri,
      body: bytes.isEmpty ? null : jsonDecode(utf8.decode(bytes)),
    ));
    if (!wire.started.isCompleted) wire.started.complete();
    await wire.release.future;
    return StubResponse(wire.session('synthetic-refreshed', wire.refreshRole, wire.refreshCustomerId));
  }
}

class StubClient extends Fake implements HttpClient {
  final SessionWire wire;
  StubClient(this.wire);
  @override
  set idleTimeout(Duration value) {}
  @override
  set connectionTimeout(Duration? value) {}
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      StubRequest(wire, method, url);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late ApiService api;
  late SessionWire wire;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    api = ApiService();
    wire = SessionWire();
    api.dio.httpClientAdapter = wire;
    await api.logout();
    wire.requests.clear();
    await api.passwordLogin('synthetic@example.invalid', 'synthetic-password');
  });
  tearDown(() async {
    await api.logout();
  });

  Future<void> withRefresh(Future<void> Function() run) =>
      HttpOverrides.runZoned(run, createHttpClient: (_) => StubClient(wire));

  test(
    'concurrent customer 401s share the customer-only refresh route and native token body',
    () => withRefresh(() async {
      final first = api.getMyProfile();
      final second = api.getMyProfile();
      await wire.started.future;
      wire.release.complete();
      expect((await first).role, 'CUSTOMER');
      expect((await second).role, 'CUSTOMER');
      expect(wire.refreshRequests.length, 1);
      final refresh = wire.refreshRequests.single;
      expect(refresh.method, 'POST');
      expect(refresh.uri.path, '/api/v1/auth/customer/refresh');
      expect(refresh.body, {'refreshToken': 'synthetic-native-refresh'});
      expect(await api.getAccessToken(), 'synthetic-refreshed');
      expect(
        wire.requests.any(
          (request) =>
              request.path == '/auth/refresh' || request.path == '/auth/logout',
        ),
        isFalse,
      );
    }),
  );

  test(
    'customer logout uses only its own endpoint and clears native storage',
    () async {
      await api.logout();
      final request = wire.requests.last;
      expect(request.path, '/auth/customer/logout');
      expect(request.data, {'refreshToken': 'synthetic-native-refresh'});
      expect(await api.getAccessToken(), isNull);
      expect(
        await const FlutterSecureStorage().read(key: 'refresh_token'),
        isNull,
      );
    },
  );

  test(
    'management-role refresh response is rejected without a generic endpoint fallback',
    () => withRefresh(() async {
      wire.refreshRole = 'MERCHANT';
      var expired = 0;
      final subscription = api.sessionExpired.listen((_) => expired++);
      addTearDown(subscription.cancel);
      final result = expectLater(
        api.getMyProfile(),
        throwsA(isA<DioException>()),
      );
      await wire.started.future;
      wire.release.complete();
      await result;
      await Future<void>.delayed(Duration.zero);
      expect(await api.getAccessToken(), isNull);
      expect(
        wire.refreshRequests.single.uri.path,
        '/api/v1/auth/customer/refresh',
      );
      expect(expired, 1);
    }),
  );

  test(
    'logout invalidates a refresh already in flight and it cannot restore the old session',
    () => withRefresh(() async {
      final result = expectLater(
        api.getMyProfile(),
        throwsA(isA<DioException>()),
      );
      await wire.started.future;
      await api.logout();
      wire.release.complete();
      await result;
      expect(await api.getAccessToken(), isNull);
      expect(
        await const FlutterSecureStorage().read(key: 'refresh_token'),
        isNull,
      );
      expect(wire.requests.last.path, '/auth/customer/logout');
    }),
  );

  test(
    'late refresh from a previous epoch cannot replace a newer customer login',
    () => withRefresh(() async {
      final result = expectLater(
        api.getMyProfile(),
        throwsA(isA<DioException>()),
      );
      await wire.started.future;
      await api.passwordLogin(
        'synthetic@example.invalid',
        'synthetic-password',
      );
      wire.release.complete();
      await result;
      expect(await api.getAccessToken(), 'synthetic-login-2');
    }),
  );
  test('a late booking 401 cannot refresh or replay the old POST as a newly signed-in customer', () => withRefresh(() async {
    wire.privateStarted=Completer<void>();wire.privateRelease=Completer<void>();wire.release.complete();
    final outcome=expectLater(api.createBooking(shopId:'7',serviceId:'8',date:'2031-05-01',startTime:'10:00',requestKey:'original-key-123'),throwsA(isA<DioException>()));
    await wire.privateStarted!.future;
    wire.loginCustomerId='42';await api.passwordLogin('second@example.invalid','synthetic-password');
    wire.privateRelease!.complete();await outcome;
    expect(wire.requests.where((row)=>row.path=='/bookings'),hasLength(1));
    expect(wire.refreshRequests,isEmpty);
    expect(await api.getAccessToken(),'synthetic-login-2');
    expect(await const FlutterSecureStorage().read(key:'refresh_token'),'synthetic-native-refresh-42');
  }));

  test('a queued old booking command cannot take the next customer identity before its first dispatch', () async {
    final outcome=expectLater(api.createBooking(shopId:'7',serviceId:'8',date:'2031-05-01',startTime:'10:00',requestKey:'original-key-123'),throwsA(isA<DioException>()));
    wire.loginCustomerId='42';await api.passwordLogin('second@example.invalid','synthetic-password');await outcome;
    expect(wire.requests.where((row)=>row.path=='/bookings'),isEmpty);
    expect(wire.refreshRequests,isEmpty);expect(await api.getAccessToken(),'synthetic-login-2');
  });

  test('a successful private response from the previous customer is rejected after a new login', () async {
    wire.privateStarted=Completer<void>();wire.privateRelease=Completer<void>();wire.privateStatus=200;
    final outcome=expectLater(api.getBooking('42'),throwsA(isA<DioException>()));
    await wire.privateStarted!.future;
    wire.loginCustomerId='42';await api.passwordLogin('second@example.invalid','synthetic-password');
    wire.privateRelease!.complete();await outcome;
    expect(wire.requests.where((row)=>row.path=='/bookings/42'),hasLength(1));
    expect(await api.getAccessToken(),'synthetic-login-2');
  });

  test('a different customer returned by a shared refresh cookie is not adopted and cannot replay a booking POST', () => withRefresh(() async {
    wire.refreshCustomerId='42';wire.privateStatus=401;
    final outcome=expectLater(api.createBooking(shopId:'7',serviceId:'8',date:'2031-05-01',startTime:'10:00',requestKey:'original-key-123'),throwsA(isA<DioException>()));
    await wire.started.future;wire.release.complete();await outcome;
    expect(wire.requests.where((row)=>row.path=='/bookings'),hasLength(1));
    expect(wire.refreshRequests,hasLength(1));
    expect(await api.getAccessToken(),isNull);
    expect(await const FlutterSecureStorage().read(key:'refresh_token'),isNull);
  }));

  test('an old logout reply cannot erase the next customer token or secure storage',()async{
    wire.logoutStarted=Completer<void>();wire.logoutRelease=Completer<void>();
    final outcome=expectLater(api.logout(),throwsA(isA<DioException>()));await wire.logoutStarted!.future;
    wire.loginCustomerId='42';await api.passwordLogin('second@example.invalid','synthetic-password');
    wire.logoutRelease!.complete();await outcome;wire.logoutRelease=null;
    expect(await api.getAccessToken(),'synthetic-login-2');expect(await const FlutterSecureStorage().read(key:'refresh_token'),'synthetic-native-refresh-42');
  });

  test('a cancelled startup profile from A cannot log out or erase B after B signs in',()async{
    wire.protect=false;wire.profileStarted=Completer<void>();wire.profileRelease=Completer<void>();
    final auth=AuthNotifier(api);addTearDown(auth.dispose);
    final startup=auth.checkSession();await wire.profileStarted!.future;
    expect(wire.requests.where((request)=>request.path=='/auth/me'),hasLength(1));
    wire.loginCustomerId='42';await auth.passwordLogin('second@example.invalid','synthetic-password');
    expect(auth.state.user?.id,'42');expect(auth.state.isLoggedIn,isTrue);
    wire.profileRelease!.complete();await startup;
    expect(auth.state.user?.id,'42');expect(auth.state.isLoggedIn,isTrue);expect(auth.state.error,isNull);
    expect(await api.getAccessToken(),'synthetic-login-2');
    expect(await const FlutterSecureStorage().read(key:'refresh_token'),'synthetic-native-refresh-42');
    expect(wire.requests.where((request)=>request.path=='/auth/customer/logout'),isEmpty);
  });

  test('a late rejected login A cannot clear successful login B in AuthNotifier',()async{
    wire.delayedLoginEmail='first@example.invalid';wire.loginStarted=Completer<void>();wire.loginRelease=Completer<void>();
    final auth=AuthNotifier(api);addTearDown(auth.dispose);
    final rejected=expectLater(auth.passwordLogin('first@example.invalid','synthetic-password'),
      throwsA(isA<DioException>().having((error)=>error.type,'type',DioExceptionType.cancel)));
    await wire.loginStarted!.future;
    wire.loginCustomerId='42';await auth.passwordLogin('second@example.invalid','synthetic-password');
    wire.loginRelease!.complete();await rejected;
    expect(auth.state.isLoggedIn,isTrue);expect(auth.state.user?.id,'42');expect(auth.state.isLoading,isFalse);expect(auth.state.error,isNull);
    expect(await api.getAccessToken(),'synthetic-login-3');
    expect(await const FlutterSecureStorage().read(key:'refresh_token'),'synthetic-native-refresh-42');
    expect(wire.requests.where((request)=>request.path=='/auth/customer/logout'),isEmpty);
  });

  test('a profile 403 does not establish an invalid customer credential and blocks writes until verification',()async{
    wire.profileStatus=403;
    final auth=AuthNotifier(api);addTearDown(auth.dispose);
    await auth.checkSession();
    expect(wire.requests.where((request)=>request.path=='/auth/me'),hasLength(1));
    expect(wire.requests.where((request)=>request.path=='/auth/customer/logout'),isEmpty);
    expect(auth.state.sessionUnavailable,isTrue);expect(auth.state.isLoading,isFalse);
    expect(auth.state.error,isNotNull);expect(api.sessionNeedsVerification,isTrue);
    expect(await api.getAccessToken(),'synthetic-login-1');expect(await const FlutterSecureStorage().read(key:'refresh_token'),'synthetic-native-refresh');
    await expectLater(api.dio.post('/bookings',data:{'requestKey':'original-unconfirmed'}),throwsA(isA<DioException>()));
    expect(wire.requests.where((request)=>request.path=='/bookings'),isEmpty);
  });

  test('a queued old expiry event cannot invalidate a login started before AuthNotifier receives it',()=>withRefresh(()async{
    final newLogin=Completer<void>();
    final loggedIn=expectLater(newLogin.future,completes);
    final expiredGenerations=<int>[];
    late AuthNotifier auth;
    final earlierListener=api.sessionExpired.listen((generation){
      expiredGenerations.add(generation);wire.loginCustomerId='42';
      auth.passwordLogin('second@example.invalid','synthetic-password').then(
        (_) => newLogin.complete(),
        onError:(Object error,StackTrace stack)=>newLogin.completeError(error,stack),
      );
    });
    addTearDown(earlierListener.cancel);
    auth=AuthNotifier(api);addTearDown(auth.dispose);
    wire.refreshRole='MERCHANT';
    final rejected=expectLater(api.getMyProfile(),throwsA(isA<DioException>()));
    await wire.started.future;wire.release.complete();await rejected;await loggedIn;
    expect(expiredGenerations,hasLength(1));expect(expiredGenerations.single,lessThan(api.sessionGeneration));
    expect(auth.state.isLoggedIn,isTrue);expect(auth.state.user?.id,'42');expect(auth.state.error,isNull);
    expect(await api.getAccessToken(),'synthetic-login-2');
    expect(wire.requests.where((request)=>request.path=='/auth/customer/logout'),isEmpty);
  }));

  test('a current single-customer startup refresh still restores AuthState',()=>withRefresh(()async{
    final auth=AuthNotifier(api);addTearDown(auth.dispose);
    final startup=auth.checkSession();await wire.started.future;wire.release.complete();await startup;
    expect(auth.state.isLoggedIn,isTrue);expect(auth.state.user?.id,'41');expect(auth.state.isLoading,isFalse);expect(auth.state.error,isNull);
    expect(await api.getAccessToken(),'synthetic-refreshed');expect(wire.refreshRequests,hasLength(1));
    expect(wire.requests.where((request)=>request.path=='/auth/customer/logout'),isEmpty);
  }));

  test('private commands born while B signs in cannot dispatch with B credentials after that login completes',()async{
    wire.loginCustomerId='42';wire.delayedLoginEmail='second@example.invalid';
    wire.delayedLoginStatus=200;wire.loginStarted=Completer<void>();wire.loginRelease=Completer<void>();
    final protectedEntered=Completer<void>(),releaseProtected=Completer<void>();
    final gatedPaths=<String>[];
    const linkPath='/auth/customer/providers/google/link';
    final gate=InterceptorsWrapper(onRequest:(options,handler)async{
      if(options.path=='/bookings'||options.path==linkPath){
        gatedPaths.add(options.path);
        if(gatedPaths.length==2)protectedEntered.complete();
        await releaseProtected.future;
      }
      handler.next(options);
    });
    api.dio.interceptors.insert(0,gate);
    addTearDown((){
      if(!wire.loginRelease!.isCompleted)wire.loginRelease!.complete();
      if(!releaseProtected.isCompleted)releaseProtected.complete();
      api.dio.interceptors.remove(gate);
    });
    final signedIn=expectLater(api.passwordLogin('second@example.invalid','synthetic-password'),
      completion(isA<User>().having((user)=>user.id,'customer','42')));
    await wire.loginStarted!.future.timeout(const Duration(seconds:5));
    expect(await api.getAccessToken(),isNull);
    final cancelled=isA<DioException>().having((error)=>error.type,'type',DioExceptionType.cancel);
    final booking=expectLater(api.createBooking(shopId:'7',serviceId:'8',date:'2031-05-01',startTime:'10:00',requestKey:'born-during-login-key'),throwsA(cancelled));
    final link=expectLater(api.linkCustomerProvider('google','synthetic-id-token','synthetic-challenge','synthetic-password'),throwsA(cancelled));
    await protectedEntered.future.timeout(const Duration(seconds:5));
    expect(gatedPaths,containsAll(['/bookings',linkPath]));
    wire.loginRelease!.complete();await signedIn;
    expect(await api.getAccessToken(),'synthetic-login-2');
    releaseProtected.complete();await booking;await link;
    expect(wire.requests.where((request)=>request.path=='/bookings'||request.path==linkPath),isEmpty);
    expect(wire.refreshRequests,isEmpty);
    expect(await api.getAccessToken(),'synthetic-login-2');
    expect(await const FlutterSecureStorage().read(key:'refresh_token'),'synthetic-native-refresh-42');
  });

}
