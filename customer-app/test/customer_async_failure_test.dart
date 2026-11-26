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

const _technicalMarker = 'synthetic-private-profile-detail';

ResponseBody _json(Object? value, [int status = 200]) =>
    ResponseBody.fromString(
      jsonEncode(value),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );

class _FailureWire implements HttpClientAdapter {
  final announcements = Completer<ResponseBody>();
  bool announcementEntered = false;
  final profileWrites = <Map<String, dynamic>>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final bytes = await requestStream?.expand((chunk) => chunk).toList();
    if (options.path == '/announcements') {
      announcementEntered = true;
      return announcements.future;
    }
    if (options.path == '/auth/customer/logout') return _json({'ok': true});
    if (options.path == '/auth/customer/password/login') {
      return _json({
        'accessToken': 'synthetic-profile-access',
        'refreshToken': 'synthetic-profile-refresh',
        'user': {
          'id': '41',
          'role': 'CUSTOMER',
          'status': 'ACTIVE',
          'name': 'Original customer',
          'email': 'original@example.invalid',
          'emailVerified': true,
          'phone': null,
          'avatarUrl': null,
        },
      });
    }
    if (options.path == '/auth/customer/config') {
      return _json({
        'emailOtp': {'enabled': false},
      });
    }
    if (options.path == '/users/41' && options.method == 'PATCH') {
      profileWrites.add(
        Map<String, dynamic>.from(jsonDecode(utf8.decode(bytes!)) as Map),
      );
      throw DioException(
        requestOptions: options,
        response: Response<Object?>(
          requestOptions: options,
          statusCode: 400,
          data: {'message': '<script>$_technicalMarker</script>'},
        ),
        type: DioExceptionType.badResponse,
        message: '$_technicalMarker Authorization: Bearer synthetic-only',
      );
    }
    throw StateError('Unexpected synthetic request ${options.path}');
  }

  @override
  void close({bool force = false}) {}
}

Widget _localizedApp(Widget home) => MaterialApp(
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
      onPressed: () => Navigator.of(
        context,
      ).push<void>(MaterialPageRoute(builder: (_) => destination)),
      child: const Text('Open customer page'),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Create the singleton's storage queue outside a widget's fake async zone.
  ApiService();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  for (final rejected in [false, true]) {
    testWidgets(
      'leaving announcements before a delayed ${rejected ? 'failure' : 'success'} does not update disposed UI',
      (tester) async {
        final api = ApiService(), wire = _FailureWire();
        final original = api.dio.httpClientAdapter;
        api.dio.httpClientAdapter = wire;
        addTearDown(() => api.dio.httpClientAdapter = original);

        await tester.pumpWidget(
          _localizedApp(const _Entry(AnnouncementScreen())),
        );
        await tester.tap(find.text('Open customer page'));
        // Do not settle while the real page intentionally shows its spinner.
        for (
          var attempt = 0;
          attempt < 20 && !wire.announcementEntered;
          attempt++
        ) {
          await tester.pump(const Duration(milliseconds: 25));
        }
        expect(wire.announcementEntered, isTrue);
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.byType(AnnouncementScreen), findsOneWidget);
        await tester.tap(find.byIcon(Icons.arrow_back));
        await tester.pumpAndSettle();
        expect(find.byType(AnnouncementScreen), findsNothing);

        wire.announcements.complete(
          rejected
              ? _json({'message': 'Synthetic unavailable'}, 503)
              : _json([]),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 10));
        expect(find.text('Open customer page'), findsOneWidget);
        expect(
          tester.takeException(),
          isNull,
          reason:
              'A completed request must not mutate an announcement page that was closed.',
        );
      },
    );
  }

  testWidgets(
    'rejected account save preserves the draft and uses a customer-safe error',
    (tester) async {
      final api = ApiService(), wire = _FailureWire();
      final original = api.dio.httpClientAdapter;
      api.dio.httpClientAdapter = wire;
      addTearDown(() => api.dio.httpClientAdapter = original);
      final auth = AuthNotifier(api);
      var scopeOwnsAuth = false;
      addTearDown(() {
        if (!scopeOwnsAuth) auth.dispose();
      });
      await tester.runAsync(() async {
        await api.logout();
        await auth.passwordLogin('original@example.invalid', 'synthetic-only');
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) {
              scopeOwnsAuth = true;
              return auth;
            }),
          ],
          child: _localizedApp(const _Entry(EditProfileScreen())),
        ),
      );
      await tester.tap(find.text('Open customer page'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).first,
        'Preserved draft',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      expect(wire.profileWrites, [
        {'name': 'Preserved draft', 'email': 'original@example.invalid'},
      ]);
      expect(find.byType(EditProfileScreen), findsOneWidget);
      expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).first)
            .controller!
            .text,
        'Preserved draft',
      );
      expect(auth.state.user?.name, 'Original customer');
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
            .onPressed,
        isNotNull,
      );
      final errorText = tester
          .widget<Text>(
            find
                .descendant(
                  of: find.byType(SnackBar),
                  matching: find.byType(Text),
                )
                .first,
          )
          .data!;
      expect(errorText, isNotEmpty);
      for (final technical in [
        'DioException',
        _technicalMarker,
        'Authorization',
        '<script>',
      ]) {
        expect(
          errorText,
          isNot(contains(technical)),
          reason: 'Customer error leaked $technical',
        );
      }
      expect(tester.takeException(), isNull);
    },
  );
}
