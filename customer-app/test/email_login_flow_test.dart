import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'guest_booking_flow_test.dart'
    show GuestBookings, publicShop, createdBooking;

class EmailLoginWire implements HttpClientAdapter {
  final emails = <String>[];
  bool invalidChallenge = false;
  @override
  Future<ResponseBody> fetch(
    RequestOptions request,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    await stream?.drain<void>();
    Object body;
    if (request.path == '/auth/customer/config') {
      body = {
        'passwordEnabled': true,
        'emailOtp': {'enabled': true},
        'google': {'enabled': false},
        'apple': {'enabled': false},
      };
    } else if (request.path == '/auth/customer/email/request') {
      emails.add((request.data as Map)['email'] as String);
      body = {
        'challengeId': invalidChallenge
            ? ''
            : 'email-challenge-${emails.length}',
        'resendAfter': 60,
        'expiresIn': 600,
      };
    } else if (request.path == '/bookings/42') {
      body = createdBooking();
    } else {
      throw StateError('Unexpected login UI request ${request.path}');
    }
    return ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class EmailLoginAuth extends AuthNotifier {
  EmailLoginAuth() : super(ApiService());
  final verifications = <({String challenge, String code})>[];
  Completer<User>? pending;
  int sessionChecks = 0;
  @override
  Future<User> verifyEmailLogin(String challengeId, String code) async {
    verifications.add((challenge: challengeId, code: code));
    final user =
        await (pending?.future ??
            Future.value(
              User(
                id: '41',
                role: 'CUSTOMER',
                email: 'guest@example.invalid',
                emailVerified: true,
              ),
            ));
    state = AuthState(user: user, isLoggedIn: true);
    return user;
  }

  @override
  Future<void> checkSession() async {
    sessionChecks++;
    throw StateError('No extra session read');
  }
}

class IdentityBookings extends GuestBookings {
  IdentityBookings(this.auth);
  final EmailLoginAuth auth;
  final quoteCustomers = <String?>[];
  final createCustomers = <String?>[];
  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> request) {
    quoteCustomers.add(auth.state.user?.id);
    return super.quote(request);
  }

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> request) {
    createCustomers.add(auth.state.user?.id);
    return super.createBookingWithAddOns(request);
  }
}

Widget localized(Widget child) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.pumpAndSettle();
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late EmailLoginWire wire;
  late HttpClientAdapter previous;
  setUp(() {
    previous = ApiService().dio.httpClientAdapter;
    wire = EmailLoginWire();
    ApiService().dio.httpClientAdapter = wire;
  });
  tearDown(() {
    ApiService().dio.httpClientAdapter = previous;
  });

  testWidgets(
    'resend waits belong to each normalized email and resending clears the old code',
    (tester) async {
      final auth = EmailLoginAuth();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [authProvider.overrideWith((_) => auth)],
          child: localized(const LoginScreen(openEmailCode: true)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).first,
        ' First@Example.invalid ',
      );
      await tapVisible(tester, find.text('Send email code'));
      expect(wire.emails, ['first@example.invalid']);
      await tester.enterText(find.byType(TextFormField).last, '111111');
      await tester.enterText(
        find.byType(TextFormField).first,
        'second@example.invalid',
      );
      expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).last)
            .controller
            ?.text,
        isEmpty,
      );
      await tapVisible(tester, find.text('Send email code'));
      expect(wire.emails, ['first@example.invalid', 'second@example.invalid']);
      await tester.enterText(find.byType(TextFormField).last, '222222');
      await tester.enterText(
        find.byType(TextFormField).first,
        ' SECOND@Example.invalid ',
      );
      expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).last)
            .controller
            ?.text,
        '222222',
      );
      await tester.enterText(
        find.byType(TextFormField).first,
        'first@example.invalid',
      );
      await tester.pump();
      final waiting = find.ancestor(
        of: find.textContaining(RegExp(r'^Resend in [1-9]\d?s$')),
        matching: find.byType(OutlinedButton),
      );
      expect(waiting, findsOneWidget);
      expect(tester.widget<OutlinedButton>(waiting).onPressed, isNull);
      await tester.pump(const Duration(seconds: 60));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).last, '111111');
      await tapVisible(tester, find.text('Send email code'));
      expect(wire.emails, [
        'first@example.invalid',
        'second@example.invalid',
        'first@example.invalid',
      ]);
      expect(
        tester
            .widget<TextFormField>(find.byType(TextFormField).last)
            .controller
            ?.text,
        isEmpty,
      );
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Verify email code'),
      );
      expect(auth.verifications, isEmpty);
      expect(find.text('Request and enter the 6-digit code.'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'guest email sign-in returns to the same draft, reviews only, then explicitly submits once',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final auth = EmailLoginAuth()..pending = Completer<User>();
      final bookings = IdentityBookings(auth);
      final container = ProviderContainer(
        overrides: [
          authProvider.overrideWith((_) => auth),
          bookingRepositoryProvider.overrideWith((_) => bookings),
        ],
      );
      try {
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: localized(BookingScreen(shop: publicShop())),
          ),
        );
        await tester.pumpAndSettle();
        final flow = container.read(bookingFlowProvider.notifier);
        flow.selectService(publicShop().services.single);
        flow.selectDate(DateTime(2031, 5, 1));
        await tester.pumpAndSettle();
        flow.toggleTimeSlot('10:00');
        flow.selectPaymentMode('PAY_AT_STORE');
        await tester.pumpAndSettle();
        for (var step = 0; step < 3; step++) {
          await tapVisible(tester, find.byType(FilledButton).last);
        }
        await tapVisible(
          tester,
          find.widgetWithText(FilledButton, 'Sign in to review total'),
        );
        expect(find.byType(LoginScreen), findsOneWidget);
        await tester.tap(find.byTooltip('Back'));
        await tester.pumpAndSettle();
        expect(container.read(bookingFlowProvider).selectedService?.id, '8');
        expect(container.read(bookingFlowProvider).selectedStartTime, '10:00');
        expect(bookings.quoteCustomers, isEmpty);
        expect(bookings.creates, 0);
        await tapVisible(
          tester,
          find.widgetWithText(FilledButton, 'Sign in to review total'),
        );
        await tapVisible(tester, find.text('Use email code or create account'));
        await tester.enterText(
          find.byType(TextFormField).first,
          'guest@example.invalid',
        );
        await tapVisible(tester, find.text('Send email code'));
        await tester.enterText(find.byType(TextFormField).last, '123456');
        final verify = find.widgetWithText(FilledButton, 'Verify email code');
        await tester.ensureVisible(verify);
        await tester.pumpAndSettle();
        // Two clicks before the next frame must still consume the code only once.
        await tester.tap(verify);
        await tester.tap(verify);
        await tester.pump();
        expect(auth.verifications, [
          (challenge: 'email-challenge-1', code: '123456'),
        ]);
        expect(
          tester
              .widget<IconButton>(
                find
                    .ancestor(
                      of: find.byTooltip('Back'),
                      matching: find.byType(IconButton),
                    )
                    .first,
              )
              .onPressed,
          isNull,
        );
        expect(
          tester
              .widget<TextField>(
                find.descendant(
                  of: find.byType(TextFormField).first,
                  matching: find.byType(TextField),
                ),
              )
              .readOnly,
          isTrue,
        );
        final loginContext = tester.element(find.byType(LoginScreen));
        final popped = await Navigator.of(loginContext).maybePop();
        await tester.pump();
        expect(popped, isTrue);
        expect(find.byType(LoginScreen), findsOneWidget);
        auth.pending!.complete(
          User(
            id: '41',
            role: 'CUSTOMER',
            email: 'guest@example.invalid',
            emailVerified: true,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsNothing);
        expect(find.byType(BookingScreen), findsOneWidget);
        final state = container.read(bookingFlowProvider);
        expect(state.shop?.id, '7');
        expect(state.selectedService?.id, '8');
        expect(state.selectedDate, DateTime(2031, 5, 1));
        expect(state.selectedStartTime, '10:00');
        expect(state.hasValidPriceQuote, isTrue);
        expect(auth.sessionChecks, 0);
        expect(bookings.quoteCustomers, ['41']);
        expect(bookings.creates, 0);
        await tester.enterText(find.byKey(const ValueKey('booking-contact-name')), 'New email customer');
        await tester.enterText(find.byKey(const ValueKey('booking-contact-phone')), '+1 (206) 555-0123');
        await tester.pumpAndSettle();
        await tapVisible(tester, find.byType(FilledButton).last);
        expect(find.byType(BookingDetailScreen), findsOneWidget);
        expect(bookings.createCustomers, ['41']);
        expect(bookings.creates, 1);
        expect(bookings.submittedDate, '2031-05-01');
        expect(bookings.submittedTime, '10:00');
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        container.dispose();
      }
    },
  );

  testWidgets(
    'an unconfirmed challenge response never enables code verification',
    (tester) async {
      wire.invalidChallenge = true;
      final auth = EmailLoginAuth();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [authProvider.overrideWith((_) => auth)],
          child: localized(const LoginScreen(openEmailCode: true)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextFormField).first,
        'guest@example.invalid',
      );
      await tapVisible(tester, find.text('Send email code'));
      expect(
        find.text('Unable to send a code. Check your email or try later.'),
        findsOneWidget,
      );
      await tester.enterText(find.byType(TextFormField).last, '123456');
      await tapVisible(
        tester,
        find.widgetWithText(FilledButton, 'Verify email code'),
      );
      expect(auth.verifications, isEmpty);
      expect(find.text('Request and enter the 6-digit code.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('a pending sign-in disables guest navigation and a rejected code restores the controls', (tester) async {
    final auth = EmailLoginAuth()..pending = Completer<User>();
    await tester.pumpWidget(ProviderScope(overrides: [authProvider.overrideWith((_) => auth)],
      child: localized(const LoginScreen(openEmailCode: true))));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, 'guest@example.invalid');
    await tapVisible(tester, find.text('Send email code'));
    await tester.enterText(find.byType(TextFormField).last, '123456');
    final verify = find.widgetWithText(FilledButton, 'Verify email code');
    await tester.ensureVisible(verify); await tester.pumpAndSettle();
    await tester.tap(verify); await tester.pump();
    final browse = find.widgetWithText(TextButton, 'Browse without signing in');
    expect(tester.widget<TextButton>(browse).onPressed, isNull);
    expect(auth.verifications, hasLength(1));
    auth.pending!.completeError(StateError('Synthetic invalid email code'));
    await tester.pumpAndSettle();
    expect(auth.state.isLoggedIn, isFalse);
    expect(find.text('The code is invalid, expired or already used. Request a new code if needed.'), findsOneWidget);
    expect(tester.widget<TextButton>(browse).onPressed, isNotNull);
    expect(tester.widget<FilledButton>(verify).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
