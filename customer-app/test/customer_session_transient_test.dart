import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'email_auth_identity_test.dart' show EmailIdentityWire;
import 'customer_session_isolation_test.dart' show StubHeaders;
import 'booking_receipt_intent_test.dart' as intent;

class TransientWire extends EmailIdentityWire {
  Object profileOutcome = 200;
  Completer<void>? profileEntered, profileRelease;
  int refreshStatus = 200, refreshCalls = 0;
  Object? refreshOverride;
  Completer<void>? refreshEntered, refreshRelease;
  int businessStatus = 200;
  String token = 'original-token';
  @override
  Future<ResponseBody> fetch(
    RequestOptions request,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    if (request.path == '/auth/customer/password/login') {
      await stream?.drain<void>();
      paths.add(request.path);
      return response({
        'accessToken': token,
        'refreshToken': 'retained-refresh',
        'user': profile(),
      });
    }
    if (request.path == '/auth/me') {
      await stream?.drain<void>();
      paths.add(request.path);
      final outcome = profileOutcome, snapshot = profile();
      final gate = profileRelease;
      if (profileEntered?.isCompleted == false) profileEntered!.complete();
      await gate?.future;
      if (outcome is DioExceptionType) {
        throw DioException(requestOptions: request, type: outcome);
      }
      if (outcome == 'malformed') return response({'id': customer});
      if (outcome == 'wrong-role') {
        return response({...snapshot, 'role': 'MERCHANT'});
      }
      if (outcome == 'wrong-id') return response({...snapshot, 'id': '99'});
      if (outcome == 'refresh-once' &&
          request.headers['Authorization'] != 'Bearer refreshed-token') {
        return response({'message': 'Synthetic access expired'}, 401);
      }
      if (outcome is int && outcome != 200) {
        return response({'message': 'synthetic failure'}, outcome);
      }
      return response(snapshot);
    }
    if (!request.path.startsWith('/auth/')) {
      await stream?.drain<void>();
      paths.add(request.path);
      return response({'ok': true}, businessStatus);
    }
    return super.fetch(request, stream, cancelFuture);
  }

  ResponseBody response(Object body, [int status = 200]) =>
      ResponseBody.fromString(
        jsonEncode(body),
        status,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
}

class RefreshReply extends Stream<List<int>> implements HttpClientResponse {
  final Object body;
  @override
  final int statusCode;
  RefreshReply(this.body, this.statusCode);
  @override
  final headers = StubHeaders()..set('content-type', 'application/json');
  @override
  bool get isRedirect => false;
  @override
  List<RedirectInfo> get redirects => [];
  @override
  String get reasonPhrase => 'Synthetic response';
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

class RefreshRequest extends Fake implements HttpClientRequest {
  final TransientWire wire;
  RefreshRequest(this.wire);
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
    await stream.drain<void>();
  }

  @override
  Future<HttpClientResponse> close() async {
    wire.refreshCalls++;
    final status = wire.refreshStatus,
        override = wire.refreshOverride,
        snapshot = wire.profile();
    if (wire.refreshEntered?.isCompleted == false) {
      wire.refreshEntered!.complete();
    }
    await wire.refreshRelease?.future;
    if (override == 'network') {
      throw const SocketException('Synthetic network failure');
    }
    return RefreshReply(
      override ??
          {
            'accessToken': 'refreshed-token',
            'refreshToken': 'refreshed-refresh',
            'user': snapshot,
          },
      status,
    );
  }
}

class RefreshClient extends Fake implements HttpClient {
  final TransientWire wire;
  RefreshClient(this.wire);
  @override
  set idleTimeout(Duration value) {}
  @override
  set connectionTimeout(Duration? value) {}
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      RefreshRequest(wire);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late ApiService api;
  late TransientWire wire;
  late AuthNotifier auth;
  late HttpClientAdapter previous;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    api = ApiService();
    previous = api.dio.httpClientAdapter;
    wire = TransientWire();
    api.dio.httpClientAdapter = wire;
    await api.logout();
    auth = AuthNotifier(api);
    await auth.passwordLogin(wire.email, 'synthetic-password');
    wire.paths.clear();
  });
  tearDown(() async {
    if (auth.mounted) auth.dispose();
    await api.logout();
    api.dio.httpClientAdapter = previous;
    clearBookingRecoveryMarker();
  });
  Future<void> withRefresh(Future<void> Function() action) =>
      HttpOverrides.runZoned(
        action,
        createHttpClient: (_) => RefreshClient(wire),
      );
  Future<void> expectBlocked() async {
    final before = wire.paths.length;
    for (final command in [
      (method: 'POST', path: '/bookings'),
      (method: 'PATCH', path: '/users/41'),
      (method: 'POST', path: '/auth/customer/email/verify-current'),
      (method: 'POST', path: '/auth/customer/providers/google/link'),
      (method: 'POST', path: '/upload/media'),
      (method: 'DELETE', path: '/reviews/1'),
    ]) {
      await expectLater(
        api.dio.request(
          command.path,
          data: {'requestKey': 'unchanged-original-key'},
          options: Options(method: command.method),
        ),
        throwsA(isA<DioException>()),
      );
    }
    expect(
      wire.paths.length,
      before,
      reason: 'unverified account writes must never reach transport',
    );
  }

  for (final outcome in [
    503,
    403,
    DioExceptionType.connectionError,
    DioExceptionType.receiveTimeout,
    'malformed',
  ]) {
    test(
      'profile $outcome preserves credentials and identity, blocks writes, and retries explicitly',
      () async {
        final user = auth.state.user, token = await api.getAccessToken();
        wire.profileOutcome = outcome;
        await auth.checkSession();
        expect(await api.getAccessToken(), token);
        expect(auth.state.user, same(user));
        expect(auth.state.sessionUnavailable, isTrue);
        expect(auth.state.error, isNotNull);
        expect(wire.paths, ['/auth/me']);
        await expectBlocked();
        wire.profileOutcome = 200;
        await auth.checkSession();
        expect(auth.state.sessionUnavailable, isFalse);
        expect(api.sessionNeedsVerification, isFalse);
        expect(auth.state.error, isNull);
        expect(auth.state.user?.id, user?.id);
        expect(wire.paths.where((p) => p == '/bookings'), isEmpty);
        await api.dio.post('/explicit-new-command');
        expect(wire.paths.last, '/explicit-new-command');
      },
    );
  }
  test(
    'ordinary business 403 does not clear or suspend a verified session',
    () async {
      wire.businessStatus = 403;
      await expectLater(
        api.dio.post('/explicit-new-command'),
        throwsA(isA<DioException>()),
      );
      expect(auth.state.isLoggedIn, isTrue);
      expect(auth.state.sessionUnavailable, isFalse);
      expect(api.sessionNeedsVerification, isFalse);
      expect(await api.getAccessToken(), 'original-token');
      expect(wire.paths, ['/explicit-new-command']);
    },
  );
  for (final outcome in [503, 200, 401]) {
    test(
      'old profile $outcome cannot affect a new signed-in identity',
      () async {
        wire.profileOutcome = outcome;
        wire.profileEntered = Completer<void>();
        wire.profileRelease = Completer<void>();
        final pending = auth.checkSession();
        await wire.profileEntered!.future;
        wire.customer = '42';
        wire.token = 'new-token';
        await auth.passwordLogin('new@example.invalid', 'synthetic-password');
        wire.profileRelease!.complete();
        await pending;
        expect(auth.state.user?.id, '42');
        expect(auth.state.sessionUnavailable, isFalse);
        expect(api.sessionNeedsVerification, isFalse);
        expect(await api.getAccessToken(), 'new-token');
        expect(wire.paths.where((p) => p == '/auth/customer/logout'), isEmpty);
        expect(wire.refreshCalls, 0);
      },
    );
  }
  test(
    'older failed verification cannot suspend a newer successful same-session retry',
    () async {
      wire.profileOutcome = 503;
      wire.profileEntered = Completer<void>();
      wire.profileRelease = Completer<void>();
      final pending = auth.checkSession();
      await wire.profileEntered!.future;
      final release = wire.profileRelease!;
      wire.profileRelease = null;
      wire.profileOutcome = 200;
      await auth.checkSession();
      release.complete();
      await pending;
      await Future<void>.delayed(Duration.zero);
      expect(auth.state.sessionUnavailable, isFalse);
      expect(api.sessionNeedsVerification, isFalse);
      expect(auth.state.error, isNull);
    },
  );
  test(
    'older successful verification cannot unlock a newer failed same-session retry',
    () async {
      wire.profileOutcome = 200;
      wire.profileEntered = Completer<void>();
      wire.profileRelease = Completer<void>();
      final pending = auth.checkSession();
      await wire.profileEntered!.future;
      final release = wire.profileRelease!;
      wire.profileRelease = null;
      wire.profileOutcome = 503;
      await auth.checkSession();
      release.complete();
      await pending;
      expect(auth.state.sessionUnavailable, isTrue);
      expect(api.sessionNeedsVerification, isTrue);
      await expectBlocked();
    },
  );
  test(
    'logout wins over an in-flight verification and remains available while suspended',
    () async {
      wire.profileOutcome = 503;
      await auth.checkSession();
      wire.profileOutcome = 200;
      wire.profileEntered = Completer<void>();
      wire.profileRelease = Completer<void>();
      final pending = auth.checkSession();
      await wire.profileEntered!.future;
      await auth.logout();
      wire.profileRelease!.complete();
      await pending;
      expect(await api.getAccessToken(), isNull);
      expect(auth.state.user, isNull);
      expect(auth.state.sessionUnavailable, isFalse);
      expect(
        wire.paths.where((p) => p == '/auth/customer/logout'),
        hasLength(1),
      );
    },
  );
  for (final outcome in ['wrong-role', 'wrong-id']) {
    test(
      'a validated profile $outcome definitively expires its own session',
      () async {
        wire.profileOutcome = outcome;
        await auth.checkSession();
        await Future<void>.delayed(Duration.zero);
        expect(await api.getAccessToken(), isNull);
        expect(auth.state.user, isNull);
        expect(auth.state.isLoggedIn, isFalse);
        expect(
          await const FlutterSecureStorage().read(key: 'refresh_token'),
          isNull,
        );
      },
    );
  }
  for (final outcome in [503, 403, 'network', 'malformed']) {
    test(
      'refresh $outcome retains credentials without replaying the original write',
      () => withRefresh(() async {
        wire.businessStatus = 401;
        if (outcome is int) {
          wire.refreshStatus = outcome;
        } else {
          wire.refreshOverride = outcome == 'malformed'
              ? {
                  'user': {'id': '41'},
                }
              : outcome;
        }
        await expectLater(
          api.dio.post('/original-write', data: {'requestKey': 'original-key'}),
          throwsA(isA<DioException>()),
        );
        await Future<void>.delayed(Duration.zero);
        expect(await api.getAccessToken(), 'original-token');
        expect(
          await const FlutterSecureStorage().read(key: 'refresh_token'),
          'retained-refresh',
        );
        expect(auth.state.sessionUnavailable, isTrue);
        expect(wire.paths.where((p) => p == '/original-write'), hasLength(1));
        expect(wire.paths.where((p) => p == '/auth/customer/logout'), isEmpty);
        await expectBlocked();
        wire.profileOutcome = 200;
        await auth.checkSession();
        expect(auth.state.sessionUnavailable, isFalse);
        expect(wire.paths.where((p) => p == '/original-write'), hasLength(1));
      }),
    );
  }
  test(
    'a malformed optional refresh field cannot replace credentials before validation',
    () => withRefresh(() async {
      wire.businessStatus = 401;
      wire.refreshOverride = {
        'accessToken': 'must-not-be-installed',
        'refreshToken': 'must-not-be-stored',
        'reauthToken': 7,
        'user': wire.profile(),
      };
      await expectLater(
        api.dio.post('/original-write'),
        throwsA(isA<DioException>()),
      );
      expect(await api.getAccessToken(), 'original-token');
      expect(
        await const FlutterSecureStorage().read(key: 'refresh_token'),
        'retained-refresh',
      );
      expect(api.sessionNeedsVerification, isTrue);
    }),
  );
  test(
    'profile 401 uses one valid customer refresh and verified profile read-back',
    () => withRefresh(() async {
      wire.profileOutcome = 'refresh-once';
      await auth.checkSession();
      expect(wire.refreshCalls, 1);
      expect(await api.getAccessToken(), 'refreshed-token');
      expect(auth.state.user?.id, '41');
      expect(auth.state.sessionUnavailable, isFalse);
      expect(api.sessionNeedsVerification, isFalse);
      expect(wire.paths, ['/auth/me', '/auth/me']);
    }),
  );
  for (final status in [503, 200, 401]) {
    test(
      'old refresh $status cannot expire, replace or suspend a newer login',
      () => withRefresh(() async {
        wire.businessStatus = 401;
        wire.refreshStatus = status;
        wire.refreshEntered = Completer<void>();
        wire.refreshRelease = Completer<void>();
        final pending = expectLater(
          api.dio.post('/original-write'),
          throwsA(isA<DioException>()),
        );
        await wire.refreshEntered!.future;
        wire.customer = '42';
        wire.token = 'new-token';
        await auth.passwordLogin('new@example.invalid', 'synthetic-password');
        wire.refreshRelease!.complete();
        await pending;
        await Future<void>.delayed(Duration.zero);
        expect(await api.getAccessToken(), 'new-token');
        expect(auth.state.user?.id, '42');
        expect(auth.state.sessionUnavailable, isFalse);
        expect(api.sessionNeedsVerification, isFalse);
        expect(wire.paths.where((p) => p == '/original-write'), hasLength(1));
      }),
    );
  }
  for (final plan in [false, true]) {
    test(
      '${plan ? 'PLAN' : 'STANDARD'} unknown request preserves contact, verified email, quote and original key through a transient session retry',
      () async {
        clearBookingRecoveryMarker();
        wire.verified = true;
        await auth.passwordLogin(wire.email, 'synthetic-password');
        wire.paths.clear();
        final repo = intent.IntentRepository()..loseFirst = true,
            planRepo = intent.IntentPlanRepository()..loseFirst = true;
        final container = ProviderContainer(
          overrides: [
            authProvider.overrideWith((ref) => auth),
            bookingRepositoryProvider.overrideWith((ref) => repo),
            bookingPlanRepositoryProvider.overrideWith((ref) => planRepo),
          ],
        );
        addTearDown(container.dispose);
        final shop = intent.intentShop();
        final standard = container.read(bookingFlowProvider.notifier);
        final keep = container.listen(bookingPlanProvider(shop), (_, _) {});
        addTearDown(keep.close);
        final itinerary = container.read(bookingPlanProvider(shop).notifier);
        if (plan) {
          await intent.selectPlan(itinerary);
          itinerary.updateContact(
            name: 'Recorded visitor',
            phone: '+12065550123',
          );
          await itinerary.confirm();
        } else {
          await intent.selectStandard(standard, shop);
          standard.updateContact(
            name: 'Recorded visitor',
            phone: '+12065550123',
          );
          await standard.confirmBooking();
        }
        final attempt = plan
            ? itinerary.state.pendingAttempt
            : standard.state.pendingAttempt;
        final quote = plan
            ? itinerary.state.priceQuote
            : standard.state.priceQuote;
        final contact = plan ? itinerary.state.contact : standard.state.contact;
        expect(attempt, isNotNull);
        expect(hasBookingRecoveryMarker(), isTrue);
        wire.profileOutcome = 503;
        await auth.checkSession();
        wire.profileOutcome = 200;
        await auth.checkSession();
        expect(
          plan ? itinerary.state.pendingAttempt : standard.state.pendingAttempt,
          same(attempt),
        );
        expect(
          plan ? itinerary.state.priceQuote : standard.state.priceQuote,
          same(quote),
        );
        expect(
          plan ? itinerary.state.contact : standard.state.contact,
          same(contact),
        );
        expect(
          (plan
                  ? itinerary.state.pendingAttempt
                  : standard.state.pendingAttempt)
              ?.requestKey,
          attempt!.requestKey,
        );
        expect(plan ? planRepo.writes : repo.writes, hasLength(1));
        expect(hasBookingRecoveryMarker(), isTrue);
        expect(auth.state.user?.email, wire.email);
        expect(auth.state.user?.emailVerified, isTrue);
        expect(wire.paths, ['/auth/me', '/auth/me']);
      },
    );
  }
  test(
    'refresh 401 definitively expires and never replays its original business command',
    () => withRefresh(() async {
      wire.businessStatus = 401;
      wire.refreshStatus = 401;
      await expectLater(
        api.dio.post('/original-write'),
        throwsA(isA<DioException>()),
      );
      await Future<void>.delayed(Duration.zero);
      expect(await api.getAccessToken(), isNull);
      expect(auth.state.user, isNull);
      expect(auth.state.isLoggedIn, isFalse);
      expect(wire.paths.where((p) => p == '/original-write'), hasLength(1));
    }),
  );
  for (final firstStatus in [200, 503]) {
    for (final nextStatus in [200, 503]) {
      for (final firstCheck in [true, false]) {
        test(
          'same-account ${firstCheck ? 'checkSession' : 'reloadProfile'} $firstStatus cannot overwrite newer ${firstCheck ? 'reloadProfile' : 'checkSession'} $nextStatus',
          () async {
            final originalEmail = wire.email;
            wire.profileOutcome = firstStatus;
            wire.profileEntered = Completer<void>();
            wire.profileRelease = Completer<void>();
            final pending = firstCheck
                ? auth.checkSession()
                : expectLater(auth.reloadProfile(), throwsA(anything));
            await wire.profileEntered!.future;
            final release = wire.profileRelease!;
            wire.profileRelease = null;
            wire.profileOutcome = nextStatus;
            wire.email = 'newer-profile@example.invalid';
            if (firstCheck) {
              if (nextStatus == 200) {
                await auth.reloadProfile();
              } else {
                await expectLater(
                  auth.reloadProfile(),
                  throwsA(isA<DioException>()),
                );
              }
            } else {
              await auth.checkSession();
            }
            release.complete();
            await pending;
            await Future<void>.delayed(Duration.zero);
            expect(
              auth.state.user?.email,
              nextStatus == 200 ? wire.email : originalEmail,
            );
            expect(auth.state.sessionUnavailable, nextStatus != 200);
            expect(auth.state.isLoading, isFalse);
            expect(api.sessionNeedsVerification, nextStatus != 200);
            expect(await api.getAccessToken(), 'original-token');
          },
        );
      }
    }
  }
}
