import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/announcement_screen.dart';
import 'package:mjapp_client/screens/edit_profile_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/profile_error.dart';

const _privateText =
    '<script>synthetic-secret Authorization: Bearer private</script>';

ResponseBody _json(Object? data, [int status = 200]) => ResponseBody.fromString(
  jsonEncode(data),
  status,
  headers: {
    Headers.contentTypeHeader: ['application/json'],
  },
);

Map<String, dynamic> _notice(String title, {String? content}) => {
  'id': '1',
  'title': title,
  'content': content ?? 'A customer notice.',
  'type': 'INFO',
  'scope': 'USERS',
  'isActive': true,
  'startAt': '2026-01-01T00:00:00Z',
  'createdAt': '2026-01-01T00:00:00Z',
  'updatedAt': '2026-01-01T00:00:00Z',
  'endAt': null,
};

class _RepairWire implements HttpClientAdapter {
  final announcements = <Completer<ResponseBody>>[];
  final writes = <Map<String, dynamic>>[];
  final paths = <String>[];
  final profile = <String, dynamic>{
    'id': '41',
    'role': 'CUSTOMER',
    'name': 'Original customer',
    'email': 'original@example.invalid',
    'emailVerified': true,
    'phone': null,
    'avatarUrl': null,
  };
  int? nextStatus;
  DioExceptionType? nextTransportFailure;
  bool applyBeforeFailure = false;
  bool expireOn401 = false;
  bool failReadback = false;
  Object? readbackOverride;
  Completer<ResponseBody>? delayedSave;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    final bytes = await stream?.expand((chunk) => chunk).toList() ?? <int>[];
    final body = bytes.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(utf8.decode(bytes)) as Map);
    paths.add(options.path);
    switch (options.path) {
      case '/auth/customer/logout':
        return _json({'ok': true});
      case '/auth/customer/password/login':
        return _json({
          'accessToken': 'synthetic-access',
          'refreshToken': 'synthetic-refresh',
          'user': Map<String, dynamic>.from(profile),
        });
      case '/auth/customer/config':
        return _json({
          'emailOtp': {'enabled': false},
        });
      case '/auth/me':
        if (failReadback) return _json({'message': _privateText}, 503);
        return _json(readbackOverride ?? Map<String, dynamic>.from(profile));
      case '/announcements':
        final pending = Completer<ResponseBody>();
        announcements.add(pending);
        return pending.future;
      case '/users/41':
        expect(options.method, 'PATCH');
        writes.add(body);
        if (delayedSave != null) return delayedSave!.future;
        final status = nextStatus, transportFailure = nextTransportFailure;
        nextStatus = null;
        nextTransportFailure = null;
        if (applyBeforeFailure || status == null && transportFailure == null) {
          profile.addAll(body);
        }
        if (transportFailure != null) {
          throw DioException(
            requestOptions: options,
            type: transportFailure,
            error: StateError(_privateText),
            message: _privateText,
          );
        }
        if (status != null) {
          // Exercise the real transport's terminal-401 expiry path without a
          // refresh HTTP client or socket; a nonterminal 401 is tested separately.
          if (status == 401 && expireOn401) {
            options.extra['sessionRetried'] = true;
          }
          return _json({
            'code': _privateText,
            'message': _privateText,
            'error': {'message': _privateText},
          }, status);
        }
        return _json(Map<String, dynamic>.from(profile));
      default:
        throw StateError('Unexpected synthetic path ${options.path}');
    }
  }

  @override
  void close({bool force = false}) {}
}

Widget _app(Widget home) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: home,
);

class _Entry extends StatelessWidget {
  const _Entry(this.destination);
  final Widget destination;
  @override
  Widget build(BuildContext context) => Scaffold(
    body: FilledButton(
      onPressed: () => Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => destination),
      ),
      child: const Text('Open customer page'),
    ),
  );
}

void _attach(_RepairWire wire) {
  final api = ApiService(), previous = ApiService().dio.httpClientAdapter;
  api.dio.httpClientAdapter = wire;
  addTearDown(() => api.dio.httpClientAdapter = previous);
}

Future<void> _waitForAnnouncements(
  WidgetTester tester,
  _RepairWire wire,
  int count,
) async {
  for (var tick = 0; tick < 40 && wire.announcements.length < count; tick++) {
    await tester.pump(const Duration(milliseconds: 25));
  }
  expect(wire.announcements, hasLength(count));
  await tester.pump(const Duration(milliseconds: 400));
}

Future<AuthNotifier> _openProfile(WidgetTester tester, _RepairWire wire) async {
  _attach(wire);
  final api = ApiService(), auth = AuthNotifier(ApiService());
  var owned = false;
  addTearDown(() {
    if (!owned) auth.dispose();
  });
  await tester.runAsync(() async {
    await api.logout();
    await auth.passwordLogin('original@example.invalid', 'synthetic-only');
  });
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) {
          owned = true;
          return auth;
        }),
      ],
      child: _app(const _Entry(EditProfileScreen())),
    ),
  );
  await tester.tap(find.text('Open customer page'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextFormField).first, 'Preserved draft');
  return auth;
}

Finder get _save => find.widgetWithText(FilledButton, 'Save');

Future<void> _tapSave(WidgetTester tester) async {
  await tester.ensureVisible(_save);
  await tester.tap(_save);
  await tester.pumpAndSettle();
}

Future<void> _readBack(WidgetTester tester) async {
  final action = find.text('Reload account details');
  await tester.ensureVisible(action);
  await tester.tap(action);
  await tester.pumpAndSettle();
}

Future<void> _expireProfileSession(
  WidgetTester tester,
  AuthNotifier auth,
) async {
  await tester.ensureVisible(_save);
  final save = tester.widget<FilledButton>(_save).onPressed;
  expect(save, isNotNull);
  // Exercise the actual Save callback and transport in one real async zone.
  // Session expiry persists to the singleton secure-storage queue; a Future
  // born in a widget fake clock must not leak into the next widget test.
  await tester.runAsync(() async {
    save!();
    for (var tick = 0; tick < 40 && auth.state.isLoggedIn; tick++) {
      await Future<void>.delayed(const Duration(milliseconds: 1));
    }
  });
  expect(auth.state.isLoggedIn, isFalse, reason: 'terminal expiry must finish');
  await tester.pumpAndSettle();
}

void _expectNoTechnicalCopy(WidgetTester tester) {
  final text = tester
      .widgetList<Text>(find.byType(Text))
      .map((widget) => widget.data ?? '')
      .join('\n');
  for (final marker in [
    'DioException',
    '<script>',
    'Authorization',
    'synthetic-secret',
    'Bearer',
    'status code',
    'StackTrace',
  ]) {
    expect(text, isNot(contains(marker)));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  ApiService(); // Initialize its storage queue outside widget fake async zones.
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test(
    'profile error copy allowlists actions without trusting nested server details',
    () {
      final messages = <String>{};
      for (final status in [400, 401, 403, 404, 409, 429, 422]) {
        final request = RequestOptions(path: '/users/41');
        final result = profileSaveError(
          DioException(
            requestOptions: request,
            response: Response(
              requestOptions: request,
              statusCode: status,
              data: {
                'code': _privateText,
                'message': _privateText,
                'error': {'message': _privateText},
              },
            ),
            type: DioExceptionType.badResponse,
            message: _privateText,
          ),
        );
        expect(result.needsReadback, isFalse);
        expect(result.message, isNot(contains('synthetic-secret')));
        expect(result.message, isNot(contains('<script>')));
        messages.add(result.message);
      }
      expect(
        messages,
        hasLength(7),
        reason:
            'Validation, session, permission, conflict and rate limits need distinct next actions.',
      );
    },
  );

  test(
    'unconfirmed profile results require readback even when exception text claims rejection',
    () {
      final request = RequestOptions(path: '/users/41');
      final failures = <Object>[
        StateError(_privateText),
        const FormatException('synthetic-secret'),
        for (final type in [
          DioExceptionType.connectionError,
          DioExceptionType.sendTimeout,
          DioExceptionType.receiveTimeout,
          DioExceptionType.cancel,
        ])
          DioException(
            requestOptions: request,
            type: type,
            message: _privateText,
          ),
        for (final status in [200, 302, 408, 500, 503])
          DioException(
            requestOptions: request,
            response: Response(
              requestOptions: request,
              statusCode: status,
              data: {'message': _privateText},
            ),
            type: DioExceptionType.badResponse,
          ),
      ];
      for (final failure in failures) {
        final result = profileSaveError(failure);
        expect(result.needsReadback, isTrue);
        expect(
          result.message,
          contains('Reload account details before saving again'),
        );
        expect(result.message, isNot(contains('synthetic-secret')));
      }
    },
  );

  test(
    'malformed readbacks never replace account identity or enable a second profile write',
    () async {
      final api = ApiService(), wire = _RepairWire();
      _attach(wire);
      final auth = AuthNotifier(api);
      addTearDown(auth.dispose);
      await api.logout();
      await auth.passwordLogin('original@example.invalid', 'synthetic-only');
      final invalid = <Object>[
        [],
        {'id': '41', 'role': 'CUSTOMER'},
        {...wire.profile}..remove('role'),
        {...wire.profile}..remove('emailVerified'),
        {...wire.profile, 'id': ''},
        {...wire.profile, 'id': 41},
        {...wire.profile, 'emailVerified': 'true'},
        {...wire.profile, 'phone': {}},
        {...wire.profile, 'role': 'UNKNOWN'},
        {...wire.profile}..remove('avatarUrl'),
      ];
      for (final response in invalid) {
        wire.readbackOverride = response;
        await expectLater(auth.reloadProfile(), throwsFormatException);
        expect(auth.state.user?.id, '41');
        expect(auth.state.user?.name, 'Original customer');
        expect(auth.state.isLoggedIn, isTrue);
      }
      wire.readbackOverride = {...wire.profile, 'id': '42'};
      // A valid profile for a different customer is terminal, unlike malformed
      // data above. It must retire the original identity without adopting 42.
      final retired = auth.stream.firstWhere((state) => !state.isLoggedIn);
      await expectLater(
        auth.reloadProfile(),
        throwsA(isA<Exception>()),
      );
      await retired;
      expect(auth.state.user, isNull);
      expect(auth.state.isLoggedIn, isFalse);
      expect(api.dio.options.extra['sessionCustomerId'], isNull);
      expect(wire.writes, isEmpty);
    },
  );

  testWidgets(
    'rapid announcement reentry ignores old success and failure after the current response',
    (tester) async {
      final wire = _RepairWire();
      _attach(wire);
      await tester.pumpWidget(_app(const _Entry(AnnouncementScreen())));
      for (var visit = 1; visit <= 3; visit++) {
        await tester.tap(find.text('Open customer page'));
        await _waitForAnnouncements(tester, wire, visit);
        if (visit < 3) {
          await tester.tap(find.byIcon(Icons.arrow_back));
          await tester.pumpAndSettle();
        }
      }
      wire.announcements[2].complete(_json([_notice('Current notice')]));
      await tester.pumpAndSettle();
      wire.announcements[1].complete(_json({'message': _privateText}, 503));
      wire.announcements[0].complete(_json([_notice('Stale notice')]));
      await tester.pumpAndSettle();
      expect(find.text('Current notice'), findsOneWidget);
      expect(find.text('Stale notice'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      _expectNoTechnicalCopy(tester);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'announcement failure retries normally and long cards expand and collapse with the right label',
    (tester) async {
      final wire = _RepairWire();
      _attach(wire);
      await tester.pumpWidget(_app(const AnnouncementScreen()));
      await _waitForAnnouncements(tester, wire, 1);
      wire.announcements.single.complete(_json({'message': _privateText}, 503));
      await tester.pumpAndSettle();
      expect(find.text('An error occurred'), findsOneWidget);
      _expectNoTechnicalCopy(tester);
      await tester.tap(find.text('Retry'));
      await _waitForAnnouncements(tester, wire, 2);
      wire.announcements.last.complete(
        _json([_notice('Long notice', content: 'Customer notice. ' * 20)]),
      );
      await tester.pumpAndSettle();
      expect(find.text('Read more'), findsOneWidget);
      await tester.tap(find.text('Read more'));
      await tester.pumpAndSettle();
      expect(find.text('Read less'), findsOneWidget);
      expect(
        tester
            .widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade))
            .crossFadeState,
        CrossFadeState.showSecond,
      );
      await tester.tap(find.text('Read less'));
      await tester.pumpAndSettle();
      expect(find.text('Read more'), findsOneWidget);
      expect(
        tester
            .widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade))
            .crossFadeState,
        CrossFadeState.showFirst,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an older refresh failure cannot replace a newer announcement result',
    (tester) async {
      final wire = _RepairWire();
      _attach(wire);
      await tester.pumpWidget(_app(const AnnouncementScreen()));
      await _waitForAnnouncements(tester, wire, 1);
      wire.announcements.single.complete(_json([_notice('Initial notice')]));
      await tester.pumpAndSettle();
      final refresh = tester
          .widget<RefreshIndicator>(find.byType(RefreshIndicator))
          .onRefresh;
      final earlier = refresh(), latest = refresh();
      await _waitForAnnouncements(tester, wire, 3);
      wire.announcements.last.complete(
        _json([_notice('Latest refreshed notice')]),
      );
      await tester.pumpAndSettle();
      wire.announcements[1].complete(_json({'message': _privateText}, 503));
      await tester.pumpAndSettle();
      await Future.wait([earlier, latest]);
      expect(find.text('Latest refreshed notice'), findsOneWidget);
      expect(find.text('An error occurred'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '400 profile rejection preserves the identity and draft and permits one successful explicit retry',
    (tester) async {
      final wire = _RepairWire()..nextStatus = 400;
      final auth = await _openProfile(tester, wire);
      await _tapSave(tester);
      expect(
        find.textContaining('Check your name and email address'),
        findsOneWidget,
      );
      expect(find.byType(EditProfileScreen), findsOneWidget);
      expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).first)
            .controller!
            .text,
        'Preserved draft',
      );
      expect(auth.state.user?.name, 'Original customer');
      expect(auth.state.user?.id, '41');
      expect(tester.widget<FilledButton>(_save).onPressed, isNotNull);
      expect(wire.writes, hasLength(1));
      expect(wire.paths.where((path) => path == '/auth/me'), isEmpty);
      _expectNoTechnicalCopy(tester);
      await _tapSave(tester);
      expect(wire.writes, hasLength(2));
      expect(wire.writes[1], wire.writes[0]);
      expect(find.byType(EditProfileScreen), findsNothing);
      // The prior failure snackbar remains queued before the success receipt.
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
      expect(find.text('Profile updated'), findsOneWidget);
      expect(auth.state.user?.name, 'Preserved draft');
      expect(tester.takeException(), isNull);
    },
  );

  for (final failure in ['connection', 'timeout', '503']) {
    testWidgets(
      '$failure profile failure locks repeat writes until explicit account readback',
      (tester) async {
        final wire = _RepairWire();
        if (failure == '503') {
          wire.nextStatus = 503;
        } else {
          wire.nextTransportFailure = failure == 'timeout'
              ? DioExceptionType.receiveTimeout
              : DioExceptionType.connectionError;
        }
        // A lost timeout response may follow a committed save. Verify that only
        // reading its receipt completes the flow, without a second PATCH.
        wire.applyBeforeFailure = failure == 'timeout';
        final auth = await _openProfile(tester, wire);
        await _tapSave(tester);
        expect(
          find.textContaining(
            'Unable to verify whether your account details were saved',
          ),
          findsOneWidget,
        );
        expect(
          tester
              .widget<TextFormField>(find.byType(TextFormField).first)
              .controller!
              .text,
          'Preserved draft',
        );
        expect(auth.state.user?.name, 'Original customer');
        expect(tester.widget<FilledButton>(_save).onPressed, isNull);
        expect(wire.writes, hasLength(1));
        expect(wire.paths.where((path) => path == '/auth/me'), isEmpty);
        _expectNoTechnicalCopy(tester);
        if (failure == 'connection') {
          wire.failReadback = true;
          await _readBack(tester);
          expect(
            find.textContaining('Account details could not be reloaded'),
            findsOneWidget,
          );
          expect(tester.widget<FilledButton>(_save).onPressed, isNull);
          wire.failReadback = false;
          wire.readbackOverride = {'id': '41', 'role': 'CUSTOMER'};
          await _readBack(tester);
          expect(
            tester.widget<FilledButton>(_save).onPressed,
            isNull,
            reason: 'An incomplete readback must not authorize another write.',
          );
          expect(auth.state.user?.name, 'Original customer');
          wire.readbackOverride = null;
        }
        await _readBack(tester);
        expect(wire.writes, hasLength(1));
        if (failure == 'timeout') {
          expect(find.byType(EditProfileScreen), findsNothing);
          expect(auth.state.user?.name, 'Preserved draft');
        } else {
          expect(find.byType(EditProfileScreen), findsOneWidget);
          expect(
            find.textContaining('review it before choosing to save'),
            findsOneWidget,
          );
          expect(tester.widget<FilledButton>(_save).onPressed, isNotNull);
          expect(
            tester
                .widget<TextFormField>(find.byType(TextFormField).first)
                .controller!
                .text,
            'Preserved draft',
          );
        }
        _expectNoTechnicalCopy(tester);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'a known-session 401 without a refresh token expires locally without another profile write',
    (tester) async {
      final wire = _RepairWire()..nextStatus = 401;
      final auth = await _openProfile(tester, wire);
      // Without a refresh token a known native session cannot be recovered.
      await tester.runAsync(
        () => const FlutterSecureStorage().delete(key: 'refresh_token'),
      );
      await _expireProfileSession(tester, auth);
      expect(
        find.textContaining('Your session has expired. Sign in again'),
        findsOneWidget,
      );
      expect(auth.state.isLoggedIn, isFalse);
      expect(auth.state.user, isNull);
      expect(find.byType(TextFormField), findsNothing);
      expect(find.text('Reload account details'), findsNothing);
      expect(wire.writes, hasLength(1));
      _expectNoTechnicalCopy(tester);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'terminal unauthorized profile response expires the session and hides account-bound inputs',
    (tester) async {
      final wire = _RepairWire()
        ..nextStatus = 401
        ..expireOn401 = true;
      final auth = await _openProfile(tester, wire);
      await _expireProfileSession(tester, auth);
      expect(auth.state.isLoggedIn, isFalse);
      expect(auth.state.user, isNull);
      expect(
        find.textContaining('Your session has expired. Sign in again'),
        findsOneWidget,
      );
      expect(find.byType(TextFormField), findsNothing);
      expect(find.text('Preserved draft'), findsNothing);
      expect(wire.writes, hasLength(1));
      expect(wire.paths.where((path) => path == '/auth/me'), isEmpty);
      _expectNoTechnicalCopy(tester);
      expect(tester.takeException(), isNull);
    },
  );

  for (final status in [200, 503]) {
    testWidgets(
      'external route removal during a delayed $status response does not navigate or update disposed UI',
      (tester) async {
        final wire = _RepairWire()..delayedSave = Completer<ResponseBody>();
        final auth = await _openProfile(tester, wire);
        await tester.ensureVisible(_save);
        await tester.tap(_save);
        for (var tick = 0; tick < 20 && wire.writes.isEmpty; tick++) {
          await tester.pump(const Duration(milliseconds: 25));
        }
        expect(wire.writes, hasLength(1));
        // Explicit owner-driven removal can still dispose a route even though
        // normal user back is now protected while its save is in flight.
        final profileContext = tester.element(find.byType(EditProfileScreen));
        Navigator.of(profileContext).removeRoute(ModalRoute.of(profileContext)!);
        await tester.pumpAndSettle();
        wire.delayedSave!.complete(
          status == 200
              ? _json({...wire.profile, 'name': 'Preserved draft'})
              : _json({'message': _privateText}, 503),
        );
        await tester.pumpAndSettle();
        expect(find.text('Open customer page'), findsOneWidget);
        expect(find.byType(EditProfileScreen), findsNothing);
        expect(find.text('Profile updated'), findsNothing);
        expect(
          auth.state.user?.name,
          status == 200 ? 'Preserved draft' : 'Original customer',
        );
        expect(wire.writes, hasLength(1));
        expect(tester.takeException(), isNull);
      },
    );
  }
}
