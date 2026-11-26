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
import 'package:mjapp_client/screens/edit_profile_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

ResponseBody _json(Object value, [int status = 200]) => ResponseBody.fromString(
  jsonEncode(value),
  status,
  headers: {
    Headers.contentTypeHeader: ['application/json'],
  },
);

class _ProfileWire implements HttpClientAdapter {
  String customer = '41';
  String name = 'Original customer', email = 'original@example.invalid';
  bool verified = true, applyBeforeFailure = false, emailOtpEnabled = false;
  String mode = 'pass';
  int reads = 0, challenges = 0, verifications = 0;
  final writes = <Map<String, dynamic>>[];
  Completer<ResponseBody>? pending, pendingRead, pendingChallenge;
  Map<String, dynamic> get profile => {
    'id': customer,
    'role': 'CUSTOMER',
    'status': 'ACTIVE',
    'name': name,
    'email': email,
    'emailVerified': verified,
    'phone': null,
    'avatarUrl': null,
  };

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path == '/auth/customer/logout') return _json({'ok': true});
    if (options.path == '/auth/customer/password/login') {
      return _json({
        'accessToken': 'synthetic-unsaved-profile',
        'refreshToken': 'synthetic-unsaved-refresh',
        'user': profile,
      });
    }
    if (options.path == '/auth/customer/config') {
      return _json({
        'emailOtp': {'enabled': emailOtpEnabled},
      });
    }
    if (options.path == '/auth/customer/email/request') {
      challenges++;
      if (pendingChallenge != null) return pendingChallenge!.future;
      return _json({
        'challengeId': 'synthetic-profile-$challenges',
        'devCode': '123456',
        'resendAfter': 60,
      });
    }
    if (options.path == '/auth/customer/email/verify-current') {
      verifications++;
      verified = true;
      return _json({'verified': true});
    }
    if (options.path == '/auth/me') {
      reads++;
      if (pendingRead != null) return pendingRead!.future;
      return _json(profile);
    }
    if (options.path.startsWith('/users/') && options.method == 'PATCH') {
      final bytes = await stream!.expand((chunk) => chunk).toList();
      final body = Map<String, dynamic>.from(
        jsonDecode(utf8.decode(bytes)) as Map,
      );
      writes.add(body);
      if (pending != null) return pending!.future;
      if (mode == 'reject') {
        return _json({'message': 'Synthetic validation rejection'}, 400);
      }
      if (mode == 'pass' || applyBeforeFailure) {
        name = body['name'] as String? ?? name;
        if (body['email'] != email) {
          email = body['email'] as String? ?? email;
          verified = false;
        }
      }
      if (mode == 'network') {
        throw DioException(
          requestOptions: options,
          type: DioExceptionType.connectionError,
        );
      }
      return _json(profile);
    }
    throw StateError('Unexpected synthetic profile request ${options.path}');
  }

  @override
  void close({bool force = false}) {}
}

class _Entry extends StatelessWidget {
  const _Entry();
  @override
  Widget build(BuildContext context) => Scaffold(
    body: FilledButton(
      onPressed: () => Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => const EditProfileScreen()),
      ),
      child: const Text('Edit account'),
    ),
  );
}

Future<AuthNotifier> _open(WidgetTester tester, _ProfileWire wire) async {
  final api = ApiService(), original = ApiService().dio.httpClientAdapter;
  api.dio.httpClientAdapter = wire;
  addTearDown(() => api.dio.httpClientAdapter = original);
  final auth = AuthNotifier(api);
  var owned = false;
  addTearDown(() {
    if (!owned) auth.dispose();
  });
  await tester.runAsync(() async {
    await api.logout();
    await auth.passwordLogin('profile@example.invalid', 'synthetic-only');
  });
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authProvider.overrideWith((ref) {
          owned = true;
          return auth;
        }),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const _Entry(),
      ),
    ),
  );
  await tester.tap(find.text('Edit account'));
  await tester.pumpAndSettle();
  return auth;
}

Finder get _name => find.byType(TextFormField).first;
Finder get _email => find.byType(TextFormField).at(1);
Finder get _save => find.widgetWithText(FilledButton, 'Save');
String _nameDraft(WidgetTester tester) =>
    tester.widget<TextFormField>(_name).controller!.text;
Future<void> _back(WidgetTester tester) async {
  await tester.pageBack();
  await tester.pumpAndSettle();
}

Future<void> _saveNow(WidgetTester tester) async {
  await tester.ensureVisible(_save);
  await tester.tap(_save);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  ApiService();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets(
    'unchanged account details leave directly without saving or prompting',
    (tester) async {
      final wire = _ProfileWire();
      await _open(tester, wire);
      await _back(tester);
      expect(find.byType(EditProfileScreen), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
      expect(wire.writes, isEmpty);
    },
  );

  testWidgets(
    'dirty back keeps drafts on continue, discards only explicitly, and reopens saved values',
    (tester) async {
      final wire = _ProfileWire();
      await _open(tester, wire);
      await tester.enterText(_name, 'Unsaved draft');
      await tester.pump();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Discard unsaved changes?'), findsOneWidget);
      await tester.tap(find.text('Continue editing'));
      await tester.pumpAndSettle();
      expect(_nameDraft(tester), 'Unsaved draft');
      expect(wire.writes, isEmpty);
      await _back(tester);
      await tester.tap(find.text('Discard changes'));
      await tester.pumpAndSettle();
      expect(find.byType(EditProfileScreen), findsNothing);
      await tester.tap(find.text('Edit account'));
      await tester.pumpAndSettle();
      expect(_nameDraft(tester), 'Original customer');
      expect(wire.writes, isEmpty);
      await tester.enterText(_name, 'Changed then restored');
      await tester.enterText(_name, 'Original customer');
      await _back(tester);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets('successful verified save closes once without a discard prompt', (
    tester,
  ) async {
    final wire = _ProfileWire();
    await _open(tester, wire);
    await tester.enterText(_name, '  Saved customer  ');
    await _saveNow(tester);
    expect(find.byType(EditProfileScreen), findsNothing);
    expect(find.byType(AlertDialog), findsNothing);
    expect(wire.writes, hasLength(1));
    expect(wire.name, 'Saved customer');
  });

  testWidgets(
    'rejected save keeps the dirty draft and leaving never submits it again',
    (tester) async {
      final wire = _ProfileWire()..mode = 'reject';
      await _open(tester, wire);
      await tester.enterText(_name, 'Rejected draft');
      await _saveNow(tester);
      expect(_nameDraft(tester), 'Rejected draft');
      await _back(tester);
      expect(find.text('Discard changes'), findsOneWidget);
      await tester.tap(find.text('Continue editing'));
      await tester.pumpAndSettle();
      expect(_nameDraft(tester), 'Rejected draft');
      expect(wire.writes, hasLength(1));
    },
  );

  testWidgets(
    'in-flight save blocks native back and editing until its verified response',
    (tester) async {
      final wire = _ProfileWire()..pending = Completer<ResponseBody>();
      await _open(tester, wire);
      await tester.enterText(_name, 'Pending customer');
      await tester.tap(_save);
      for (var tick = 0; tick < 30 && wire.writes.isEmpty; tick++) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(wire.writes, hasLength(1));
      expect(
        tester
            .widget<EditableText>(
              find.descendant(of: _name, matching: find.byType(EditableText)),
            )
            .readOnly,
        isTrue,
      );
      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(find.byType(EditProfileScreen), findsOneWidget);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.textContaining('still in progress'), findsOneWidget);
      wire.name = 'Pending customer';
      wire.pending!.complete(_json(wire.profile));
      await tester.pumpAndSettle();
      expect(find.byType(EditProfileScreen), findsNothing);
      expect(wire.writes, hasLength(1));
    },
  );

  testWidgets(
    'unknown save requires readback before leaving and never repeats the save automatically',
    (tester) async {
      final wire = _ProfileWire()..mode = 'network';
      await _open(tester, wire);
      await tester.enterText(_name, 'Preserved unknown draft');
      await _saveNow(tester);
      await _back(tester);
      expect(find.text('Save result not confirmed'), findsOneWidget);
      expect(find.text('Discard changes'), findsNothing);
      await tester.tap(find.text('Continue editing'));
      await tester.pumpAndSettle();
      expect(_nameDraft(tester), 'Preserved unknown draft');
      expect(wire.writes, hasLength(1));
      await _back(tester);
      await tester.tap(
        find.widgetWithText(FilledButton, 'Reload account details'),
      );
      await tester.pumpAndSettle();
      expect(wire.reads, 1);
      expect(wire.writes, hasLength(1));
      expect(_nameDraft(tester), 'Preserved unknown draft');
      await _back(tester);
      expect(find.text('Discard changes'), findsOneWidget);
      await tester.tap(find.text('Continue editing'));
      await tester.pumpAndSettle();
      wire.mode = 'pass';
      await _saveNow(tester);
      expect(find.byType(EditProfileScreen), findsNothing);
      expect(wire.writes, hasLength(2));
    },
  );

  for (final unknown in [false, true]) {
    testWidgets(
      'saved unverified email updates the clean snapshot after ${unknown ? 'uncertain-save readback' : 'successful save'}',
      (tester) async {
        final wire = _ProfileWire()
          ..mode = unknown ? 'network' : 'pass'
          ..applyBeforeFailure = unknown;
        await _open(tester, wire);
        await tester.enterText(_email, 'saved@example.invalid');
        await _saveNow(tester);
        if (unknown) {
          await _back(tester);
          await tester.tap(
            find.widgetWithText(FilledButton, 'Reload account details'),
          );
          await tester.pumpAndSettle();
        }
        expect(find.byType(EditProfileScreen), findsOneWidget);
        expect(find.textContaining('Email saved. Verify'), findsOneWidget);
        expect(wire.writes, hasLength(1));
        await _back(tester);
        expect(find.byType(EditProfileScreen), findsNothing);
        expect(find.byType(AlertDialog), findsNothing);
        await tester.tap(find.text('Edit account'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextFormField>(_email).controller!.text,
          'saved@example.invalid',
        );
        expect(wire.writes, hasLength(1));
      },
    );
  }

  for (final sameCustomer in [false, true]) {
    testWidgets(
      'late profile save cannot revive a draft after ${sameCustomer ? 'the same customer signs in again' : 'another customer signs in'}',
      (tester) async {
        final wire = _ProfileWire()..pending = Completer<ResponseBody>();
        final auth = await _open(tester, wire);
        await tester.enterText(_name, 'Private first-session draft');
        await tester.tap(_save);
        for (var tick = 0; tick < 30 && wire.writes.isEmpty; tick++) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        expect(wire.writes, hasLength(1));
        final lateReceipt = {
          ...wire.profile,
          'name': 'Private first-session draft',
        };
        wire.customer = sameCustomer ? '41' : '42';
        wire.name = 'Current-session customer';
        wire.email = 'current@example.invalid';
        await tester.runAsync(
          () => auth.passwordLogin('current@example.invalid', 'synthetic-only'),
        );
        await tester.pump();
        expect(
          find.textContaining('Your customer session changed'),
          findsOneWidget,
        );
        expect(find.byType(TextFormField), findsNothing);
        wire.pending!.complete(_json(lateReceipt));
        await tester.pumpAndSettle();
        expect(find.byType(EditProfileScreen), findsOneWidget);
        expect(auth.state.user?.name, 'Current-session customer');
        expect(auth.state.user?.email, 'current@example.invalid');
        await _back(tester);
        await tester.tap(find.text('Edit account'));
        await tester.pumpAndSettle();
        expect(_nameDraft(tester), 'Current-session customer');
        expect(wire.writes, hasLength(1));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'late unknown-save readback cannot replace the next customer or pop their page',
    (tester) async {
      final wire = _ProfileWire()..mode = 'network';
      final auth = await _open(tester, wire);
      await tester.enterText(_name, 'First customer unknown draft');
      await _saveNow(tester);
      wire.pendingRead = Completer<ResponseBody>();
      await tester.tap(
        find.widgetWithText(TextButton, 'Reload account details'),
      );
      for (var tick = 0; tick < 30 && wire.reads == 0; tick++) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(wire.reads, 1);
      final lateReceipt = {
        ...wire.profile,
        'name': 'First customer unknown draft',
      };
      wire.customer = '42';
      wire.name = 'Second customer';
      wire.email = 'second@example.invalid';
      await tester.runAsync(
        () => auth.passwordLogin('second@example.invalid', 'synthetic-only'),
      );
      await tester.pump();
      wire.pendingRead!.complete(_json(lateReceipt));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Your customer session changed'),
        findsOneWidget,
      );
      expect(auth.state.user?.id, '42');
      expect(auth.state.user?.name, 'Second customer');
      await _back(tester);
      await tester.tap(find.text('Edit account'));
      await tester.pumpAndSettle();
      expect(_nameDraft(tester), 'Second customer');
      expect(wire.writes, hasLength(1));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('late email challenge is not shown after switching accounts', (
    tester,
  ) async {
    final wire = _ProfileWire()
      ..verified = false
      ..emailOtpEnabled = true
      ..pendingChallenge = Completer<ResponseBody>();
    final auth = await _open(tester, wire);
    await tester.tap(find.text('Send email verification code'));
    for (var tick = 0; tick < 30 && wire.challenges == 0; tick++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    expect(wire.challenges, 1);
    wire.customer = '42';
    wire.name = 'Second customer';
    wire.email = 'second@example.invalid';
    await tester.runAsync(
      () => auth.passwordLogin('second@example.invalid', 'synthetic-only'),
    );
    await tester.pump();
    wire.pendingChallenge!.complete(
      _json({
        'challengeId': 'first-account-only',
        'devCode': '123456',
        'resendAfter': 60,
      }),
    );
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsNothing);
    expect(find.textContaining('Local development code'), findsNothing);
    expect(auth.state.user?.email, 'second@example.invalid');
    expect(auth.state.user?.emailVerified, isFalse);
    await _back(tester);
    await tester.tap(find.text('Edit account'));
    await tester.pumpAndSettle();
    expect(_nameDraft(tester), 'Second customer');
    expect(find.text('Email verification code'), findsNothing);
    expect(wire.writes, isEmpty);
    expect(wire.verifications, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'verifying the saved email keeps an unrelated name draft and its leave protection',
    (tester) async {
      final wire = _ProfileWire()
        ..verified = false
        ..emailOtpEnabled = true;
      final auth = await _open(tester, wire);
      await tester.enterText(_name, 'Unsaved name during verification');
      await tester.tap(find.text('Send email verification code'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).last, '123456');
      await tester.ensureVisible(find.text('Verify email'));
      await tester.tap(find.text('Verify email'));
      await tester.pumpAndSettle();
      expect(auth.state.user?.emailVerified, isTrue);
      expect(auth.state.user?.name, 'Original customer');
      expect(_nameDraft(tester), 'Unsaved name during verification');
      expect(find.textContaining('Email verified.'), findsOneWidget);
      await _back(tester);
      expect(find.text('Discard unsaved changes?'), findsOneWidget);
      await tester.tap(find.text('Continue editing'));
      await tester.pumpAndSettle();
      expect(_nameDraft(tester), 'Unsaved name during verification');
      expect(wire.writes, isEmpty);
      expect(wire.verifications, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
