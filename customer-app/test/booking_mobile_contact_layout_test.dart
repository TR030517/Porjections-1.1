import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking_contact.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/booking_plan_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/screens/booking_plan_screen.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/services/booking_recovery_marker.dart';
import 'package:mjapp_client/widgets/booking_contact_fields.dart';

import 'offline_orders_test.dart' as fixture;

Widget _localized(Widget child, double scale, {String locale = 'en'}) =>
    MaterialApp(
      locale: Locale(locale),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: child,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(clearBookingRecoveryMarker);
  tearDown(clearBookingRecoveryMarker);

  for (final plan in [false, true]) {
    for (final width in [360.0, 390.0]) {
      for (final inset in [300.0, 350.0]) {
        for (final scale in [1.0, 1.5, 2.0]) {
          testWidgets(
            '${plan ? 'PLAN' : 'STANDARD'} contact and unique bottom actions: width=$width keyboard=$inset scale=$scale',
            (tester) async {
              tester.view.physicalSize = Size(width, 844);
              tester.view.devicePixelRatio = 1;
              addTearDown(tester.view.resetPhysicalSize);
              addTearDown(tester.view.resetDevicePixelRatio);
              addTearDown(tester.view.resetViewInsets);
              final shop = fixture.orderShop();
              final repo = fixture.OrderRepository();
              final planRepo = fixture.OrderPlanRepository();
              final container = ProviderContainer(
                overrides: [
                  authProvider.overrideWith(
                    (ref) =>
                        fixture.OrderCustomer(email: 'synthetic@example.test'),
                  ),
                  bookingRepositoryProvider.overrideWithValue(repo),
                  bookingPlanRepositoryProvider.overrideWithValue(planRepo),
                ],
              );
              try {
                await tester.pumpWidget(
                  UncontrolledProviderScope(
                    container: container,
                    child: _localized(
                      plan
                          ? BookingPlanScreen(shop: shop)
                          : BookingScreen(shop: shop),
                      scale,
                    ),
                  ),
                );
                await tester.pumpAndSettle();
                if (plan) {
                  final flow = container.read(
                    bookingPlanProvider(shop).notifier,
                  );
                  flow.selectService(0, 0, '8');
                  flow.selectDate('2031-05-01');
                  await flow.loadSlots();
                  flow.selectTime('10:00');
                  await flow.refreshPriceQuote();
                  flow.updateContact(
                    name: 'Synthetic visitor',
                    phone: '+12025550125',
                  );
                } else {
                  final flow = container.read(bookingFlowProvider.notifier);
                  flow.selectService(shop.services.single);
                  flow.selectDate(DateTime(2031, 5, 1));
                  await tester.pumpAndSettle();
                  flow.toggleTimeSlot('10:00');
                  final quote = flow.refreshPriceQuote();
                  await tester.pump();
                  await quote;
                  flow.updateContact(
                    name: 'Synthetic visitor',
                    phone: '+12025550125',
                  );
                }
                await tester.pumpAndSettle();
                final action = find.byKey(
                  ValueKey(
                    plan
                        ? 'booking-plan-primary-action'
                        : 'booking-wizard-primary-action',
                  ),
                );
                final back = find.byKey(
                  ValueKey(
                    plan
                        ? 'booking-plan-previous-action'
                        : 'booking-wizard-previous-action',
                  ),
                );
                for (var step = 0; step < 3; step++) {
                  await tester.tap(action);
                  await tester.pumpAndSettle();
                }
                final noKeyboardBottom = tester.getRect(action).bottom;
                final bottomBar = find
                    .ancestor(of: action, matching: find.byType(SafeArea))
                    .first;
                final amount = find.descendant(
                  of: bottomBar,
                  matching: find.textContaining('123.45'),
                );
                for (final fieldKey in [
                  'booking-contact-name',
                  'booking-contact-phone',
                ]) {
                  final field = find.byKey(ValueKey(fieldKey));
                  final input = tester.widget<EditableText>(
                    find.descendant(
                      of: field,
                      matching: find.byType(EditableText),
                    ),
                  );
                  input.focusNode.requestFocus();
                  tester.view.viewInsets = FakeViewPadding(bottom: inset);
                  await tester.pumpAndSettle();
                  await tester.ensureVisible(field);
                  await tester.pumpAndSettle();
                  expect(tester.takeException(), isNull);
                  expect(input.focusNode.hasFocus, isTrue);
                  for (final control in [
                    action,
                    back,
                    if (!plan) amount,
                    if (!plan) find.byKey(const ValueKey('booking-wizard-recovery-action')),
                  ]) {
                    expect(control, findsOneWidget);
                    expect(control.hitTestable(), findsOneWidget);
                    final rect = tester.getRect(control);
                    expect(rect.top, greaterThanOrEqualTo(0));
                    expect(rect.bottom, lessThanOrEqualTo(844 - inset));
                  }
                }
                // Validation still focuses the first invalid field and does not
                // enqueue an order when the keyboard is open.
                final contact = tester.state<BookingContactFieldsState>(
                  find.byType(BookingContactFields),
                );
                for (final key in [
                  'booking-contact-name',
                  'booking-contact-phone',
                ]) {
                  final field = find.byKey(ValueKey(key));
                  await tester.ensureVisible(field);
                  await tester.enterText(field, '');
                }
                expect(contact.validate(), isFalse);
                await tester.pumpAndSettle();
                expect(
                  tester
                      .widget<EditableText>(
                        find.descendant(
                          of: find.byKey(
                            const ValueKey('booking-contact-name'),
                          ),
                          matching: find.byType(EditableText),
                        ),
                      )
                      .focusNode
                      .hasFocus,
                  isTrue,
                );
                final nameInput = find.descendant(
                  of: find.byKey(const ValueKey('booking-contact-name')),
                  matching: find.byType(EditableText),
                );
                expect(tester.getRect(nameInput).top, greaterThanOrEqualTo(56));
                expect(
                  tester.getRect(nameInput).bottom,
                  lessThanOrEqualTo(844 - inset),
                );
                final phoneError = find.text(BookingContact.phoneError('')!);
                await tester.ensureVisible(phoneError);
                await tester.pumpAndSettle();
                expect(
                  tester
                      .renderObject<RenderParagraph>(phoneError)
                      .didExceedMaxLines,
                  isFalse,
                );
                expect(
                  tester.getRect(action).bottom,
                  lessThanOrEqualTo(844 - inset),
                );
                expect(tester.takeException(), isNull);
                expect(repo.writes, isEmpty);
                expect(planRepo.writes, isEmpty);
                final name = find.byKey(const ValueKey('booking-contact-name'));
                final phone = find.byKey(
                  const ValueKey('booking-contact-phone'),
                );
                await tester.ensureVisible(name);
                await tester.enterText(name, 'Synthetic visitor');
                await tester.ensureVisible(phone);
                await tester.enterText(phone, 'bad phone');
                expect(contact.validate(), isFalse);
                await tester.pumpAndSettle();
                expect(
                  tester
                      .widget<EditableText>(
                        find.descendant(
                          of: phone,
                          matching: find.byType(EditableText),
                        ),
                      )
                      .focusNode
                      .hasFocus,
                  isTrue,
                );
                await tester.enterText(phone, '+12025550125');
                expect(contact.validate(), isTrue);
                await tester.pumpAndSettle();
                expect(find.text(BookingContact.phoneError('')!), findsNothing);
                expect(find.text(BookingContact.nameError('')!), findsNothing);
                expect(repo.writes, isEmpty);
                expect(planRepo.writes, isEmpty);
                if (plan) {
                  final planTotal = find.textContaining('123.45').first;
                  await tester.ensureVisible(planTotal);
                  await tester.pumpAndSettle();
                  expect(
                    tester.getRect(planTotal).top,
                    greaterThanOrEqualTo(56),
                  );
                  expect(
                    tester.getRect(planTotal).bottom,
                    lessThanOrEqualTo(844 - inset),
                  );
                }
                tester.view.viewInsets = FakeViewPadding.zero;
                FocusManager.instance.primaryFocus?.unfocus();
                await tester.pumpAndSettle();
                expect(
                  tester.getRect(action).bottom,
                  noKeyboardBottom,
                  reason:
                      'dismissing the keyboard must not leave stale inset spacing',
                );
                expect(tester.takeException(), isNull);
              } finally {
                await tester.pumpWidget(const SizedBox.shrink());
                container.dispose();
              }
            },
          );
        }
      }
    }
  }

  for (final locale in ['en', 'zh']) {
    for (final width in [360.0, 390.0]) {
      for (final scale in [1.0, 1.5, 2.0]) {
        testWidgets(
          'shared contact errors wrap at width=$width scale=$scale locale=$locale',
          (tester) async {
            tester.view.physicalSize = Size(width, 844);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            final key = GlobalKey<BookingContactFieldsState>();
            var draft = const BookingContactDraft(
              email: 'synthetic@example.test',
            );
            await tester.pumpWidget(
              ProviderScope(
                overrides: [
                  authProvider.overrideWith(
                    (ref) =>
                        fixture.OrderCustomer(email: 'synthetic@example.test'),
                  ),
                ],
                child: _localized(
                  Scaffold(
                    body: SingleChildScrollView(
                      padding: const EdgeInsets.all(20),
                      child: StatefulBuilder(
                        builder: (context, update) => BookingContactFields(
                          key: key,
                          contact: draft,
                          locked: false,
                          onChanged: ({name, phone}) => update(
                            () => draft = draft.copyWith(
                              name: name,
                              phone: phone,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  scale,
                  locale: locale,
                ),
              ),
            );
            await tester.pumpAndSettle();
            expect(key.currentState!.validate(), isFalse);
            await tester.pumpAndSettle();
            for (final message in [
              BookingContact.nameError('')!,
              BookingContact.phoneError('')!,
            ]) {
              final error = find.text(message);
              expect(error, findsOneWidget);
              final paragraph = tester.renderObject<RenderParagraph>(error);
              expect(paragraph.maxLines, isNull);
              expect(paragraph.didExceedMaxLines, isFalse);
              expect(paragraph.overflow, isNot(TextOverflow.ellipsis));
            }
            final phone = find.byKey(const ValueKey('booking-contact-phone'));
            expect(
              tester
                  .widget<EditableText>(
                    find.descendant(
                      of: phone,
                      matching: find.byType(EditableText),
                    ),
                  )
                  .keyboardType,
              TextInputType.phone,
            );
            await tester.enterText(
              find.byKey(const ValueKey('booking-contact-name')),
              'Synthetic visitor',
            );
            await tester.ensureVisible(phone);
            await tester.enterText(phone, '+1 202 555 0123');
            expect(key.currentState!.validate(), isTrue);
            await tester.pumpAndSettle();
            expect(find.text(BookingContact.phoneError('')!), findsNothing);
            expect(find.text(BookingContact.nameError('')!), findsNothing);
            expect(tester.takeException(), isNull);
          },
        );
      }
    }
  }
}
