import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_contact.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/login_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';

import 'booking_quote_fixture.dart';
import 'offline_orders_test.dart' as offline;

class _PreflightCustomer extends AuthNotifier {
  _PreflightCustomer({bool guest = false}) : super(ApiService()) {
    if (!guest) customer();
  }

  void customer({String email = 'original@example.invalid'}) {
    state = AuthState(
      isLoggedIn: true,
      user: User(
        id: '41',
        role: 'CUSTOMER',
        name: 'Account visitor',
        phone: '+12065550124',
        email: email,
        emailVerified: true,
      ),
    );
  }
}

// Keep the accepted POST pending so the test can inspect its exact contact
// without navigating to details or issuing unrelated detail HTTP requests.
class _PreflightRepository extends offline.OrderRepository {
  int quoteCalls = 0;
  final submitted = Completer<Booking>();

  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> request) {
    quoteCalls++;
    return super.quote(request);
  }

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> request) {
    writes.add(request);
    return submitted.future;
  }
}

class _PreflightPlanRepository extends offline.OrderPlanRepository {
  int quoteCalls = 0;
  final submitted = Completer<Booking>();

  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> request) {
    quoteCalls++;
    return super.priceQuote(request);
  }

  @override
  Future<Booking> create(Map<String, dynamic> request) {
    writes.add(request);
    return submitted.future;
  }
}

class _Visit {
  final bool plan;
  final shop = offline.orderShop();
  final _PreflightCustomer auth;
  final standard = _PreflightRepository();
  final itinerary = _PreflightPlanRepository();
  late final ProviderContainer container;

  _Visit(this.plan, {bool guest = false})
    : auth = _PreflightCustomer(guest: guest) {
    container = ProviderContainer(
      overrides: [
        authProvider.overrideWith((ref) => auth),
        bookingRepositoryProvider.overrideWithValue(standard),
        bookingPlanRepositoryProvider.overrideWithValue(itinerary),
      ],
    );
  }

  BookingFlowNotifier get flow => container.read(bookingFlowProvider.notifier);
  BookingPlanNotifier get route =>
      container.read(bookingPlanProvider(shop).notifier);
  BookingContactDraft get contact => plan
      ? container.read(bookingPlanProvider(shop)).contact
      : container.read(bookingFlowProvider).contact;
  BookingPriceQuote? get quote => plan
      ? container.read(bookingPlanProvider(shop)).priceQuote
      : container.read(bookingFlowProvider).priceQuote;
  int get quoteCalls => plan ? itinerary.quoteCalls : standard.quoteCalls;
  List<Map<String, dynamic>> get writes =>
      plan ? itinerary.writes : standard.writes;
  Finder get primary => find.byKey(
    ValueKey(
      plan ? 'booking-plan-primary-action' : 'booking-wizard-primary-action',
    ),
  );
  Finder get previous => find.byKey(
    ValueKey(
      plan ? 'booking-plan-previous-action' : 'booking-wizard-previous-action',
    ),
  );

  void updateContact({String? name, String? phone}) {
    if (plan) {
      route.updateContact(name: name, phone: phone);
    } else {
      flow.updateContact(name: name, phone: phone);
    }
  }

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: plan
              ? BookingPlanScreen(shop: shop)
              : BookingScreen(shop: shop),
        ),
      ),
    );
    await tester.pumpAndSettle();
    if (plan) {
      route.selectService(0, 0, '8');
      route.selectDate('2031-05-01');
      await route.loadSlots();
      route.selectTime('10:00');
      await route.refreshPriceQuote();
    } else {
      flow.selectService(shop.services.single);
      flow.selectDate(DateTime(2031, 5, 1));
      await tester.pumpAndSettle();
      flow.toggleTimeSlot('10:00');
      final priced = flow.refreshPriceQuote();
      await tester.pump();
      await priced;
    }
    updateContact(name: 'Original visitor', phone: '+1 (206) 555-0123');
    await tester.pumpAndSettle();
    for (var step = 0; step < 3; step++) {
      await tester.tap(primary);
      await tester.pumpAndSettle();
    }
    expect(find.text('Submit booking request'), findsOneWidget);
    expect(quote, isNotNull);
    expect(writes, isEmpty);
  }

  Future<void> close(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    if (writes.isNotEmpty) {
      final completer = plan ? itinerary.submitted : standard.submitted;
      if (!completer.isCompleted) {
        completer.complete(
          quotedBookingFixture(
            writes.single,
            quote!,
            extra: {
              'userId': '41',
              'orderOnly': true,
              'onlinePaymentEnabled': false,
            },
          ),
        );
        await tester.pump();
      }
    }
    container.dispose();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  for (final plan in [false, true]) {
    final kind = plan ? 'PLAN' : 'STANDARD';
    for (final afterFirstYield in [false, true]) {
      for (final changed in ['name', 'phone', 'email']) {
        testWidgets(
          '$kind refuses changed $changed during ${afterFirstYield ? 'email' : 'sign-in'} preflight and requires a new confirmation',
          (tester) async {
            tester.view.physicalSize = const Size(390, 1000);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            final visit = _Visit(plan);
            try {
              await visit.open(tester);
              final quote = visit.quote, calls = visit.quoteCalls;
              final customer = visit.container.read(authProvider).user!.id;
              void mutate() {
                switch (changed) {
                  case 'name':
                    visit.updateContact(name: 'Replacement visitor');
                  case 'phone':
                    visit.updateContact(phone: '+44 20 7946 0958');
                  case 'email':
                    visit.auth.customer(email: 'replacement@example.invalid');
                }
              }

              // Invoke the real visible button synchronously: tester.tap would
              // flush microtasks before this test could change the draft. The
              // first real await is requireCustomerSignIn (already signed in).
              // An immediate edit lands before that continuation. A queued edit
              // lands after it enters requireBookingOrderEmail's async return,
              // before its continuation. No production hook or fake gate exists.
              tester.widget<FilledButton>(visit.primary).onPressed!();
              expect(visit.writes, isEmpty);
              if (afterFirstYield) {
                scheduleMicrotask(mutate);
              } else {
                mutate();
              }
              await tester.pumpAndSettle();

              expect(visit.container.read(authProvider).user!.id, customer);
              expect(
                visit.writes,
                isEmpty,
                reason:
                    'The previous click did not review the changed contact.',
              );
              expect(identical(visit.quote, quote), isTrue);
              expect(
                visit.quoteCalls,
                calls,
                reason: 'Editing contact must not reprice the same selection.',
              );
              expect(find.textContaining('contact details'), findsWidgets);
              expect(hasBookingRecoveryMarker(), isFalse);

              // An explicit trip back to review and a fresh submit is required;
              // the latest contact may then be sent with the same reviewed quote.
              await tester.tap(visit.previous);
              await tester.pumpAndSettle();
              await tester.tap(visit.primary);
              await tester.pumpAndSettle();
              expect(find.text('Submit booking request'), findsOneWidget);
              await tester.tap(visit.primary);
              await tester.pump();
              expect(visit.writes, hasLength(1));
              expect(visit.writes.single['contact'], {
                'name': changed == 'name'
                    ? 'Replacement visitor'
                    : 'Original visitor',
                'phone': changed == 'phone' ? '+442079460958' : '+12065550123',
                'email': changed == 'email'
                    ? 'replacement@example.invalid'
                    : 'original@example.invalid',
              });
              expect(identical(visit.quote, quote), isTrue);
              expect(visit.quoteCalls, calls);
              expect(tester.takeException(), isNull);
            } finally {
              await visit.close(tester);
            }
          },
        );
      }
    }

    testWidgets(
      '$kind guest login return preserves contact on cancel and requires fresh confirmation after sign-in',
      (tester) async {
        tester.view.physicalSize = const Size(390, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final visit = _Visit(plan, guest: true);
        try {
          await visit.open(tester);
          final quote = visit.quote;
          final calls = visit.quoteCalls;
          final nameField = find.byKey(const ValueKey('booking-contact-name'));
          final phoneField = find.byKey(const ValueKey('booking-contact-phone'));
          const guestName = 'Guest contact draft';
          const guestPhone = '+12065550135';
          await tester.enterText(nameField, guestName);
          await tester.enterText(phoneField, guestPhone);
          await tester.pumpAndSettle();
          expect(visit.contact.name, guestName);
          expect(visit.contact.phone, guestPhone);
          expect(visit.contact.email, isNull);
          await tester.tap(visit.primary);
          await tester.pumpAndSettle();
          expect(find.byType(LoginScreen), findsOneWidget);
          expect(visit.writes, isEmpty);

          await tester.tap(find.byTooltip('Back').last);
          await tester.pumpAndSettle();
          expect(find.byType(LoginScreen), findsNothing);
          expect(visit.contact.name, guestName);
          expect(visit.contact.phone, guestPhone);
          expect(
            tester.widget<TextFormField>(nameField).controller!.text,
            guestName,
          );
          expect(
            tester.widget<TextFormField>(phoneField).controller!.text,
            guestPhone,
          );
          expect(visit.contact.email, isNull);
          expect(identical(visit.quote, quote), isTrue);
          expect(visit.quoteCalls, calls);
          expect(visit.writes, isEmpty);

          await tester.tap(visit.primary);
          await tester.pumpAndSettle();
          expect(find.byType(LoginScreen), findsOneWidget);

          // Use the real pushed LoginScreen and its Navigator return contract.
          // The auth fixture supplies this layer's explicit login receipt,
          // including its generation, without external HTTP. Merely restoring
          // auth state and popping true must no longer authorize an action.
          final login = tester.widget<LoginScreen>(find.byType(LoginScreen));
          visit.auth.customer();
          login.onAuthenticated!('41', ApiService().sessionGeneration);
          Navigator.of(tester.element(find.byType(LoginScreen))).pop(true);
          await tester.pumpAndSettle();
          expect(find.byType(LoginScreen), findsNothing);
          expect(visit.contact.name, 'Account visitor');
          expect(visit.contact.email, 'original@example.invalid');
          expect(visit.writes, isEmpty);
          // A guest-to-customer transition intentionally invalidates the old
          // quote (coupon/account context). Contact-only edits above do not.
          expect(visit.quote, isNull);
          expect(visit.quoteCalls, calls);
          expect(find.textContaining('contact details'), findsWidgets);

          // Reprice explicitly after signing in, then review and submit again.
          await tester.tap(visit.primary);
          await tester.pumpAndSettle();
          expect(visit.quote, isNotNull);
          expect(visit.quoteCalls, calls + 1);
          expect(visit.writes, isEmpty);
          await tester.tap(visit.primary);
          await tester.pump();
          expect(visit.writes, hasLength(1));
          expect(visit.writes.single['contact'], {
            'name': 'Account visitor',
            'phone': '+12065550124',
            'email': 'original@example.invalid',
          });
          expect(visit.quoteCalls, calls + 1);
          expect(tester.takeException(), isNull);
        } finally {
          await visit.close(tester);
        }
      },
    );

    testWidgets(
      '$kind shows the submitted order state and starts a fresh booking when requested',
      (tester) async {
        tester.view.physicalSize = const Size(390, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final visit = _Visit(plan);
        try {
          await visit.open(tester);
          final submission = plan
              ? visit.route.confirm()
              : visit.flow.confirmBooking();
          await tester.pump();
          expect(visit.writes, hasLength(1));

          final booking = quotedBookingFixture(
            visit.writes.single,
            visit.quote!,
            extra: {
              'userId': '41',
              'orderOnly': true,
              'onlinePaymentEnabled': false,
            },
          );
          (plan ? visit.itinerary.submitted : visit.standard.submitted)
              .complete(booking);
          expect(await submission, same(booking));
          if (plan) {
            visit.route.invalidateCalendarSelection();
            visit.route.refreshShopDetails(visit.shop);
          } else {
            visit.flow.invalidateCalendarSelection();
            visit.flow.refreshShopDetails(visit.shop);
          }
          await tester.pumpAndSettle();

          expect(
            plan
                ? visit.route.completedBooking
                : visit.flow.completedBooking,
            same(booking),
          );
          expect(find.text('View submitted booking'), findsOneWidget);
          expect(tester.widget<FilledButton>(visit.primary).onPressed, isNotNull);
          expect(find.text('Submit booking request'), findsNothing);
          expect(
            find.byKey(ValueKey(plan
                ? 'booking-plan-previous-action'
                : 'booking-wizard-previous-action')),
            findsNothing,
          );
          expect(
            find.byKey(const ValueKey('booking-contact-name')),
            findsNothing,
          );
          expect(tester.takeException(), isNull);

          await tester.tap(find.text('Start another booking'));
          await tester.pumpAndSettle();

          expect(
            plan
                ? visit.route.completedBooking
                : visit.flow.completedBooking,
            isNull,
          );
          expect(visit.writes, hasLength(1));
          expect(
            plan
                ? visit.container.read(bookingPlanProvider(visit.shop)).validPlan
                : visit.container.read(bookingFlowProvider).hasServiceSelection,
            isFalse,
          );
          expect(tester.takeException(), isNull);
        } finally {
          await visit.close(tester);
        }
      },
    );
  }
}
