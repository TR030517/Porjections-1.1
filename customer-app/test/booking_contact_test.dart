import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_add_on.dart';
import 'package:mjapp_client/models/booking_contact.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/widgets/booking_contact_fields.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/screens/booking_detail_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'booking_quote_fixture.dart';
import 'booking_receipt_intent_test.dart' as intent;
import 'offline_orders_test.dart' as offline;

class ContactRepository extends intent.IntentRepository {
  final quotes = <Map<String, dynamic>>[];
  Completer<Booking>? delayed;
  @override
  Future<BookingPriceQuote> quote(Map<String, dynamic> selection) {
    quotes.add(selection);
    return super.quote(selection);
  }

  @override
  Future<Booking> createBookingWithAddOns(Map<String, dynamic> selection) {
    if (delayed != null) {
      writes.add(selection);
      return delayed!.future;
    }
    return super.createBookingWithAddOns(selection);
  }
}

class ContactPlanRepository extends intent.IntentPlanRepository {
  final quotes = <Map<String, dynamic>>[];
  Completer<Booking>? delayed;
  @override
  Future<BookingPriceQuote> priceQuote(Map<String, dynamic> selection) {
    quotes.add(selection);
    return super.priceQuote(selection);
  }

  @override
  Future<Booking> create(Map<String, dynamic> selection) {
    if (delayed != null) {
      writes.add(selection);
      return delayed!.future;
    }
    return super.create(selection);
  }
}

class LegacyContactFlow extends BookingFlowNotifier {
  LegacyContactFlow(super.repo)
    : super(
        currentCustomerId: () => '41',
        currentCustomerEmail: () => 'customer@example.invalid',
      );
  void restore(BookingRecoveryAttempt attempt) =>
      state = state.copyWith(pendingAttempt: attempt, recoveryReminder: true);
}

class LegacyContactPlan extends BookingPlanNotifier {
  LegacyContactPlan(super.shop, super.repository)
    : super(
        currentCustomerId: () => '41',
        currentCustomerEmail: () => 'customer@example.invalid',
      );
  void restore(BookingRecoveryAttempt attempt) =>
      state = state.copyWith(pendingAttempt: attempt, recoveryReminder: true);
}

Widget localized(Widget child) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

class ContactDetailApi implements ApiService {
  final Map<String, dynamic> saved;
  ContactDetailApi(this.saved);
  @override
  int get sessionGeneration => 0;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<Map<String, dynamic>> getBooking(String bookingId) async => saved;
  @override
  Future<Map<String, dynamic>> getBookingOrderEmail(String bookingId) async => {
    'bookingId': bookingId,
    'channel': 'EMAIL',
    'status': 'NOT_REQUESTED',
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);
  test(
    'Unicode names and international phones normalize without accepting control characters or local-only numbers',
    () {
      expect(BookingContact.nameError('  李明 🌙  '), isNull);
      expect(BookingContact.nameError('🌙' * 100), isNull);
      expect(BookingContact.nameError('🌙' * 101), isNotNull);
      for (final value in ['', '  ', 'A\nB', 'A\u0000B', 'A\u0085B']) {
        expect(BookingContact.nameError(value), isNotNull);
      }
      expect(BookingContact.nameError(String.fromCharCode(0xd800)), isNotNull);
      expect(
        BookingContact.normalizePhone(' +1 (206) 555-0123 '),
        '+12065550123',
      );
      expect(BookingContact.normalizePhone('+1234567'), '+1234567');
      expect(
        BookingContact.normalizePhone('+123456789012345'),
        '+123456789012345',
      );
      for (final value in [
        '2065550123',
        '+01234567',
        '+123456',
        '+1234567890123456',
        '+1 ext 234567',
        '+1\n234567',
      ]) {
        expect(BookingContact.normalizePhone(value), isNull);
      }
      expect(BookingContact.normalizePhone('\n+12065550123\n'), isNull);
      expect(
        BookingContact.normalizeEmail('\ncustomer@example.invalid\n'),
        isNull,
      );
    },
  );
  for (final plan in [false, true]) {
    test(
      '${plan ? 'PLAN' : 'STANDARD'} requires complete verified contact, keeps quote on edits, and creates a normalized snapshot',
      () async {
        String? email = 'Customer@Example.invalid';
        final repo = ContactRepository(), planRepo = ContactPlanRepository();
        final standard = BookingFlowNotifier(
          repo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => email,
        );
        final itinerary = BookingPlanNotifier(
          intent.intentShop(),
          planRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => email,
        );
        addTearDown(standard.dispose);
        addTearDown(itinerary.dispose);
        if (plan) {
          await intent.selectPlan(itinerary);
        } else {
          await intent.selectStandard(standard, intent.intentShop());
        }
        expect(
          plan ? await itinerary.confirm() : await standard.confirmBooking(),
          isNull,
        );
        expect(repo.writes, isEmpty);
        expect(planRepo.writes, isEmpty);
        final quote = plan
            ? itinerary.state.priceQuote
            : standard.state.priceQuote;
        if (plan) {
          itinerary.updateContact(name: ' 李明 🌙 ', phone: '+1 (206) 555-0123');
        } else {
          standard.updateContact(name: ' 李明 🌙 ', phone: '+1 (206) 555-0123');
        }
        expect(
          identical(
            plan ? itinerary.state.priceQuote : standard.state.priceQuote,
            quote,
          ),
          isTrue,
        );
        final quoteCalls = plan ? planRepo.quotes : repo.quotes;
        expect(quoteCalls, hasLength(1));
        expect(quoteCalls.single.containsKey('contact'), isFalse);
        final saved = plan
            ? await itinerary.confirm()
            : await standard.confirmBooking();
        expect(saved, isNotNull);
        final request = (plan ? planRepo.writes : repo.writes).single;
        expect(request['contact'], {
          'name': '李明 🌙',
          'phone': '+12065550123',
          'email': 'customer@example.invalid',
        });
        expect(request.containsKey('to'), isFalse);
        expect(request.containsKey('email'), isFalse);
        expect(saved!.contact!.toJson(), request['contact']);
        expect(saved.status, 'PENDING');
        expect(saved.paymentStatus, 'UNPAID');
      },
    );
    test(
      '${plan ? 'PLAN' : 'STANDARD'} unresolved retry freezes the contact and request key; email changes cannot alter that request',
      () async {
        String? email = 'customer@example.invalid';
        final repo = ContactRepository()..loseFirst = true,
            planRepo = ContactPlanRepository()..loseFirst = true;
        final standard = BookingFlowNotifier(
          repo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => email,
          currentCustomerName: () => 'Original contact',
          currentCustomerPhone: () => '+12065550123',
        );
        final itinerary = BookingPlanNotifier(
          intent.intentShop(),
          planRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => email,
          currentCustomerName: () => 'Original contact',
          currentCustomerPhone: () => '+12065550123',
        );
        addTearDown(standard.dispose);
        addTearDown(itinerary.dispose);
        if (plan) {
          await intent.selectPlan(itinerary);
        } else {
          await intent.selectStandard(standard, intent.intentShop());
        }
        expect(
          plan ? await itinerary.confirm() : await standard.confirmBooking(),
          isNull,
        );
        final original = (plan
            ? itinerary.state.pendingAttempt
            : standard.state.pendingAttempt)!;
        if (plan) {
          itinerary.updateContact(name: 'Different');
        } else {
          standard.updateContact(name: 'Different');
        }
        expect(
          (plan ? itinerary.state.contact : standard.state.contact).name,
          'Original contact',
        );
        email = 'changed@example.invalid';
        if (plan) {
          itinerary.syncAccountEmail();
        } else {
          standard.syncAccountEmail();
        }
        expect(
          plan
              ? await itinerary.retryOriginalRequest()
              : await standard.retryOriginalRequest(),
          isNull,
        );
        expect(plan ? planRepo.writes : repo.writes, hasLength(1));
        expect(
          (plan
                  ? itinerary.state.pendingAttempt
                  : standard.state.pendingAttempt)!
              .payload,
          original.payload,
        );
        email = 'customer@example.invalid';
        if (plan) {
          itinerary.syncAccountEmail();
        } else {
          standard.syncAccountEmail();
        }
        expect(
          plan
              ? await itinerary.retryOriginalRequest()
              : await standard.retryOriginalRequest(),
          isNotNull,
        );
        expect((plan ? planRepo.writes : repo.writes).last, original.payload);
      },
    );
    for (final changedEmail in [
      (name: 'changed verified email', value: ' New@Example.invalid '),
      (name: 'revoked email verification', value: null),
      (name: 'invalid replacement email', value: 'not-an-email'),
    ]) {
      test(
        '${plan ? 'PLAN' : 'STANDARD'} stopping unknown recovery adopts ${changedEmail.name} without changing the original request',
        () async {
          String? email = 'original@example.invalid';
          final repo = ContactRepository()..loseFirst = true;
          final planRepo = ContactPlanRepository()..loseFirst = true;
          final standard = BookingFlowNotifier(
            repo,
            currentCustomerId: () => '41',
            currentCustomerEmail: () => email,
            currentCustomerName: () => 'Account owner',
            currentCustomerPhone: () => '+12065550999',
          );
          final itinerary = BookingPlanNotifier(
            intent.intentShop(),
            planRepo,
            currentCustomerId: () => '41',
            currentCustomerEmail: () => email,
            currentCustomerName: () => 'Account owner',
            currentCustomerPhone: () => '+12065550999',
          );
          addTearDown(standard.dispose);
          addTearDown(itinerary.dispose);
          if (plan) {
            await intent.selectPlan(itinerary);
            itinerary.updateContact(
              name: 'Visitor contact',
              phone: '+1 (206) 555-0123',
            );
          } else {
            await intent.selectStandard(standard, intent.intentShop());
            standard.updateContact(
              name: 'Visitor contact',
              phone: '+1 (206) 555-0123',
            );
          }
          Future<Booking?> confirm() =>
              plan ? itinerary.confirm() : standard.confirmBooking();
          Future<void> quote() => plan
              ? itinerary.refreshPriceQuote()
              : standard.refreshPriceQuote();
          void syncEmail() =>
              plan ? itinerary.syncAccountEmail() : standard.syncAccountEmail();
          void abandon(bool acknowledged) => plan
              ? itinerary.abandonRecovery(acknowledged: acknowledged)
              : standard.abandonRecovery(acknowledged: acknowledged);
          BookingRecoveryAttempt? pending() => plan
              ? itinerary.state.pendingAttempt
              : standard.state.pendingAttempt;
          BookingContactDraft contact() =>
              plan ? itinerary.state.contact : standard.state.contact;
          final writes = plan ? planRepo.writes : repo.writes;
          expect(await confirm(), isNull);
          final original = pending()!;
          final originalPayload = writes.single;
          expect(hasBookingRecoveryMarker(), isTrue);

          email = changedEmail.value;
          syncEmail();
          expect(pending(), same(original));
          expect(original.payload, originalPayload);
          expect(contact().email, 'original@example.invalid');
          expect(
            plan
                ? await itinerary.retryOriginalRequest()
                : await standard.retryOriginalRequest(),
            isNull,
          );
          abandon(false);
          expect(pending(), same(original));
          expect(hasBookingRecoveryMarker(), isTrue);
          expect(writes, hasLength(1));

          abandon(true);
          expect(pending(), isNull);
          expect(
            plan ? itinerary.state.recoveryReminder : standard.state.recoveryReminder,
            isFalse,
          );
          expect(hasBookingRecoveryMarker(), isFalse);
          expect(contact().name, 'Visitor contact');
          expect(contact().phone, '+1 (206) 555-0123');
          expect(contact().email, BookingContact.normalizeEmail(email));
          expect(original.payload, originalPayload);
          expect(original.requestKey, originalPayload['requestKey']);
          expect(plan ? itinerary.state.priceQuote : standard.state.priceQuote, isNull);

          await quote();
          if (BookingContact.normalizeEmail(email) == null) {
            expect(contact().validatedFor(email), isNull);
            expect(await confirm(), isNull);
            expect(writes, hasLength(1));
            email = 'verified@example.invalid';
            syncEmail();
            await quote();
          }
          final saved = await confirm();
          expect(saved, isNotNull);
          expect(writes, hasLength(2));
          expect(writes.last['requestKey'], isNot(original.requestKey));
          expect(writes.last['contact'], {
            'name': 'Visitor contact',
            'phone': '+12065550123',
            'email': BookingContact.normalizeEmail(email),
          });
          expect(saved!.contact!.toJson(), writes.last['contact']);
          expect(writes.first, originalPayload);
        },
      );
    }
    test(
      '${plan ? 'PLAN' : 'STANDARD'} rejects a receipt with another contact despite identical service, time and total',
      () async {
        final repo = ContactRepository()
          ..mutate = (json) =>
              (json['contact'] as Map)['phone'] = '+12065550999';
        final planRepo = ContactPlanRepository()
          ..mutate = (json) =>
              (json['contact'] as Map)['phone'] = '+12065550999';
        final standard = BookingFlowNotifier(
          repo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => 'customer@example.invalid',
          currentCustomerName: () => 'Original',
          currentCustomerPhone: () => '+12065550123',
        );
        final itinerary = BookingPlanNotifier(
          intent.intentShop(),
          planRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => 'customer@example.invalid',
          currentCustomerName: () => 'Original',
          currentCustomerPhone: () => '+12065550123',
        );
        addTearDown(standard.dispose);
        addTearDown(itinerary.dispose);
        if (plan) {
          await intent.selectPlan(itinerary);
        } else {
          await intent.selectStandard(standard, intent.intentShop());
        }
        expect(
          plan ? await itinerary.confirm() : await standard.confirmBooking(),
          isNull,
        );
        expect(
          plan ? itinerary.state.pendingAttempt : standard.state.pendingAttempt,
          isNotNull,
        );
        expect(hasBookingRecoveryMarker(), isTrue);
      },
    );
  }
  test(
    'missing-contact legacy original command is never resubmitted or silently replaced',
    () async {
      final repo = ContactRepository(), flow = LegacyContactFlow(repo);
      addTearDown(flow.dispose);
      flow.restore(
        BookingRecoveryAttempt(
          actorId: '41',
          payload: {
            'shopId': '7',
            'requestKey': 'old-original-key',
            'date': '2031-05-01',
            'startTime': '10:00',
          },
        ),
      );
      expect(await flow.retryOriginalRequest(), isNull);
      expect(repo.writes, isEmpty);
      expect(flow.state.pendingAttempt!.requestKey, 'old-original-key');
      expect(flow.state.error, bookingContactRecoveryError);
      final plan = LegacyContactPlan(
        intent.intentShop(),
        ContactPlanRepository(),
      );
      addTearDown(plan.dispose);
      plan.restore(
        BookingRecoveryAttempt(
          actorId: '41',
          payload: {
            'shopId': '7',
            'requestKey': 'old-plan-key',
            'date': '2031-05-01',
            'startTime': '10:00',
            'items': [],
          },
        ),
      );
      expect(await plan.retryOriginalRequest(), isNull);
      expect(plan.state.pendingAttempt!.requestKey, 'old-plan-key');
      expect(plan.state.error, bookingContactRecoveryError);
    },
  );
  for (final plan in [false, true]) {
    test(
      '${plan ? 'PLAN' : 'STANDARD'} email change while a command is in flight retains the original for manual recovery',
      () async {
        var email = 'original@example.invalid';
        final repo = ContactRepository()..delayed = Completer<Booking>();
        final planRepo = ContactPlanRepository()
          ..delayed = Completer<Booking>();
        final flow = BookingFlowNotifier(
          repo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => email,
          currentCustomerName: () => 'Original',
          currentCustomerPhone: () => '+12065550123',
        );
        final itinerary = BookingPlanNotifier(
          intent.intentShop(),
          planRepo,
          currentCustomerId: () => '41',
          currentCustomerEmail: () => email,
          currentCustomerName: () => 'Original',
          currentCustomerPhone: () => '+12065550123',
        );
        addTearDown(flow.dispose);
        addTearDown(itinerary.dispose);
        if (plan) {
          await intent.selectPlan(itinerary);
        } else {
          await intent.selectStandard(flow, intent.intentShop());
        }
        final submitted = plan ? itinerary.confirm() : flow.confirmBooking();
        final original = (plan ? planRepo.writes : repo.writes).single;
        email = 'changed@example.invalid';
        if (plan) {
          itinerary.syncAccountEmail();
        } else {
          flow.syncAccountEmail();
        }
        final receipt = quotedBookingFixture(
          original,
          (plan ? planRepo.accepted : repo.accepted)!,
          extra: {'userId': '41'},
        );
        (plan ? planRepo.delayed : repo.delayed)!.complete(receipt);
        expect(await submitted, isNull);
        expect(
          (plan ? itinerary.state.pendingAttempt : flow.state.pendingAttempt)!
              .payload,
          original,
        );
        expect(
          plan ? itinerary.state.recoveryReminder : flow.state.recoveryReminder,
          isTrue,
        );
        expect(
          plan
              ? await itinerary.retryOriginalRequest()
              : await flow.retryOriginalRequest(),
          isNull,
        );
        expect(plan ? planRepo.writes : repo.writes, hasLength(1));
      },
    );
    testWidgets(
      '${plan ? 'PLAN' : 'STANDARD'} final mobile step preserves contact when returning and has one submit action',
      (tester) async {
        tester.view.physicalSize = const Size(390, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final shop = offline.orderShop(),
            auth = offline.OrderCustomer(email: 'customer@example.invalid');
        final repo = offline.OrderRepository(),
            planRepo = offline.OrderPlanRepository();
        final container = ProviderContainer(
          overrides: [
            authProvider.overrideWith((ref) => auth),
            bookingRepositoryProvider.overrideWithValue(repo),
            bookingPlanRepositoryProvider.overrideWithValue(planRepo),
          ],
        );
        try {
          await tester.pumpWidget(
            UncontrolledProviderScope(
              container: container,
              child: localized(
                plan
                    ? BookingPlanScreen(shop: shop)
                    : BookingScreen(shop: shop),
              ),
            ),
          );
          await tester.pumpAndSettle();
          if (plan) {
            final flow = container.read(bookingPlanProvider(shop).notifier);
            flow.selectService(0, 0, '8');
            flow.selectDate('2031-05-01');
            await flow.loadSlots();
            flow.selectTime('10:00');
            await flow.refreshPriceQuote();
            flow.updateContact(name: 'A visitor', phone: '+1 (206) 555-0123');
          } else {
            final flow = container.read(bookingFlowProvider.notifier);
            flow.selectService(shop.services.single);
            flow.selectDate(DateTime(2031, 5, 1));
            await tester.pumpAndSettle();
            flow.toggleTimeSlot('10:00');
            final quote = flow.refreshPriceQuote();
            await tester.pump();
            await quote;
            flow.updateContact(name: 'A visitor', phone: '+1 (206) 555-0123');
          }
          await tester.pumpAndSettle();
          final primary = find.byKey(
            ValueKey(
              plan
                  ? 'booking-plan-primary-action'
                  : 'booking-wizard-primary-action',
            ),
          );
          for (var step = 0; step < 3; step++) {
            await tester.tap(primary);
            await tester.pumpAndSettle();
          }
          expect(
            find.text(plan ? '4. Contact & confirm' : 'Contact & confirm'),
            findsOneWidget,
          );
          expect(find.text('Submit booking request'), findsOneWidget);
          expect(find.text('A visitor'), findsOneWidget);
          await tester.tap(
            find.byKey(
              ValueKey(
                plan
                    ? 'booking-plan-previous-action'
                    : 'booking-wizard-previous-action',
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(primary);
          await tester.pumpAndSettle();
          expect(find.text('A visitor'), findsOneWidget);
          expect(
            tester
                .widget<TextFormField>(
                  find.byKey(const ValueKey('booking-contact-phone')),
                )
                .controller!
                .text,
            '+1 (206) 555-0123',
          );
          expect(repo.writes, isEmpty);
          expect(planRepo.writes, isEmpty);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          container.dispose();
        }
      },
    );
  }
  testWidgets(
    'order details show only recorded contact snapshots and identify historical orders',
    (tester) async {
      for (final recorded in [true, false]) {
        final auth = offline.OrderCustomer(
          email: 'current-account@example.invalid',
        );
        final saved = <String, dynamic>{
          'id': '42',
          'userId': '41',
          'shopId': '7',
          'durationMin': 60,
          'priceCents': 8000,
          'totalCents': 8000,
          'status': 'PENDING',
          'paymentStatus': 'UNPAID',
          'paymentMode': 'PAY_AT_STORE',
          'contact': recorded
              ? {
                  'recorded': true,
                  'version': 1,
                  'name': 'Saved visitor',
                  'phone': '+12065550123',
                  'email': 'original@example.invalid',
                }
              : {'recorded': false, 'version': null},
        };
        final booking = Booking.fromJson(saved);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authProvider.overrideWith((ref) => auth),
              apiServiceProvider.overrideWithValue(ContactDetailApi(saved)),
            ],
            child: localized(
              BookingDetailScreen(bookingId: '42', initialBooking: booking),
            ),
          ),
        );
        await tester.pumpAndSettle();
        if (recorded) {
          expect(find.text('Saved visitor'), findsOneWidget);
          expect(find.text('original@example.invalid'), findsOneWidget);
          expect(find.text('current-account@example.invalid'), findsNothing);
        } else {
          expect(
            find.text('Historical booking has no recorded contact.'),
            findsOneWidget,
          );
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      }
    },
  );
  test(
    'identity change clears contact and late result cannot be accepted by a new identity',
    () async {
      var actor = '41';
      final repo = ContactRepository()..delayed = Completer<Booking>();
      final flow = BookingFlowNotifier(
        repo,
        currentCustomerId: () => actor,
        currentCustomerEmail: () => '$actor@example.invalid',
      );
      addTearDown(flow.dispose);
      await intent.selectStandard(flow, intent.intentShop());
      flow.updateContact(name: 'Private first customer', phone: '+12065550123');
      final submitted = flow.confirmBooking();
      final original = repo.writes.single;
      actor = '42';
      flow.onCustomerChanged('41', '42');
      expect(flow.state.contact.name, isEmpty);
      expect(flow.state.contact.phone, isEmpty);
      repo.delayed!.complete(
        quotedBookingFixture(original, repo.accepted!, extra: {'userId': '41'}),
      );
      expect(await submitted, isNull);
      expect(flow.state.recoveryReminder, isTrue);
    },
  );
  testWidgets(
    'compact contact form validates fields and keeps email bound and read-only',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final key = GlobalKey<BookingContactFieldsState>();
      var draft = const BookingContactDraft(email: 'customer@example.invalid');
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: StatefulBuilder(
                  builder: (context, setState) => BookingContactFields(
                    key: key,
                    contact: draft,
                    locked: false,
                    onChanged: ({name, phone}) => setState(
                      () => draft = draft.copyWith(name: name, phone: phone),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(key.currentState!.validate(), isFalse);
      await tester.pump();
      expect(
        find.text('Enter a name between 1 and 100 characters.'),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const ValueKey('booking-contact-name')),
        'A customer',
      );
      await tester.enterText(
        find.byKey(const ValueKey('booking-contact-phone')),
        '+1 (206) 555-0123',
      );
      await tester.pump();
      expect(key.currentState!.validate(), isTrue);
      expect(find.byType(TextFormField), findsNWidgets(2));
      expect(find.text('customer@example.invalid'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
