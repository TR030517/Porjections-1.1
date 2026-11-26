import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking_calendar.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/widgets/booking_calendar_picker.dart';

BookingCalendar shopCalendar() => BookingCalendar.parse({
  'today': '2031-05-01',
  'timezone': 'UTC',
  'serverNow': '2031-05-01T12:00:00Z',
  'validUntil': '2031-05-02T00:00:00Z',
})!;

ShopDetail ruleShop(
  BookingCalendar calendar, {
  bool closesMay2 = false,
  String phone = '555-0100',
  List<CustomerClosedPeriod> closedPeriods = const [],
  Map<String, dynamic> businessHours = const {},
}) => ShopDetail(
  id: '7',
  name: 'Calendar rules studio',
  address: '',
  city: '',
  state: '',
  latitude: 0,
  longitude: 0,
  category: '',
  avgRating: 0,
  reviewCount: 0,
  bookingCount: 0,
  images: const [],
  services: const [],
  therapists: const [],
  phone: phone,
  timezone: 'UTC',
  businessHours: businessHours,
  bookingCalendar: calendar,
  bookingSettings: CustomerBookingSettings(
    closedPeriods: [
      ...closedPeriods,
      if (closesMay2)
        const CustomerClosedPeriod(
          startDate: '2031-05-02',
          endDate: '2031-05-02',
        ),
    ],
  ),
);

Widget livePicker(
  ValueNotifier<ShopDetail> shop,
  List<DateTime> selected, {
  bool compact = false,
}) => ProviderScope(
  child: MaterialApp(
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: ValueListenableBuilder<ShopDetail>(
        valueListenable: shop,
        builder: (_, current, _) => BookingCalendarPicker(
          shop: current,
          compact: compact,
          selectedDate: '2031-05-02',
          onSelected: selected.add,
          onInvalidated: () {},
        ),
      ),
    ),
  ),
);

void main() {
  for (final compact in [false, true]) {
    testWidgets(
      '${compact ? 'PLAN' : 'ordinary'} picker explains why all dates are disabled and recovers when the last day opens',
      (tester) async {
        final calendar = shopCalendar();
        final lastDate = calendar.today.add(const Duration(days: 365));
        String stamp(DateTime date) => date.toIso8601String().substring(0, 10);

        ShopDetail closedThrough(DateTime endDate) => ruleShop(
          calendar,
          closedPeriods: [
            const CustomerClosedPeriod(
              startDate: '2031-05-01',
              endDate: '2031-05-02',
            ),
            CustomerClosedPeriod(
              startDate: '2031-05-03',
              endDate: stamp(endDate),
            ),
          ],
        );

        final shop = ValueNotifier(closedThrough(lastDate));
        final selected = <DateTime>[];
        addTearDown(shop.dispose);
        await tester.pumpWidget(livePicker(shop, selected, compact: compact));
        final dateAction = find.ancestor(
          of: find.text(compact ? 'Choose date' : 'Choose another date'),
          matching: find.byWidgetPredicate(
            (widget) => widget is OutlinedButton,
          ),
        );
        final explanation = find.textContaining(
          'The shop is closed on every date shown, based on its weekly schedule and temporary closure dates.',
        );
        expect(explanation, findsOneWidget);
        expect(tester.widget<OutlinedButton>(dateAction).onPressed, isNull);
        expect(
          tester
              .widget<TextButton>(
                find.widgetWithText(TextButton, 'Refresh shop calendar'),
              )
              .onPressed,
          isNotNull,
        );

        shop.value = closedThrough(lastDate.subtract(const Duration(days: 1)));
        await tester.pumpAndSettle();
        expect(explanation, findsNothing);
        await tester.tap(dateAction);
        await tester.pumpAndSettle();
        final dialog = tester.widget<DatePickerDialog>(
          find.byType(DatePickerDialog),
        );
        expect(dialog.initialDate, dialog.lastDate);
        expect(stamp(dialog.lastDate), stamp(lastDate));
        await tester.tap(find.text('OK'));
        await tester.pumpAndSettle();
        expect(selected, [lastDate]);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );

    testWidgets(
      '${compact ? 'PLAN' : 'ordinary'} picker disables recurring closed weekdays and leaves open or unknown weekdays selectable',
      (tester) async {
        final calendar = shopCalendar();
        final shop = ValueNotifier(
          ruleShop(
            calendar,
            businessHours: {
              'sunday': [
                {'closed': true},
              ],
              'monday': [
                {'open': '09:00', 'close': '17:00'},
              ],
              'wednesday': [
                {'open': 'invalid', 'close': '12:00'},
              ],
            },
          ),
        );
        final selected = <DateTime>[];
        addTearDown(shop.dispose);
        await tester.pumpWidget(livePicker(shop, selected, compact: compact));

        if (!compact) {
          final sunday = find.ancestor(
            of: find.text('5/4'),
            matching: find.byType(OutlinedButton),
          );
          final monday = find.ancestor(
            of: find.text('5/5'),
            matching: find.byType(OutlinedButton),
          );
          final wednesday = find.ancestor(
            of: find.text('5/7'),
            matching: find.byType(OutlinedButton),
          );
          expect(tester.widget<OutlinedButton>(sunday).onPressed, isNull);
          expect(tester.widget<OutlinedButton>(monday).onPressed, isNotNull);
          expect(tester.widget<OutlinedButton>(wednesday).onPressed, isNotNull);
        }

        await tester.tap(
          find.text(compact ? '2031-05-02' : 'Choose another date'),
        );
        await tester.pumpAndSettle();
        final dialog = tester.widget<DatePickerDialog>(
          find.byType(DatePickerDialog),
        );
        expect(dialog.selectableDayPredicate!(DateTime(2031, 5, 4)), isFalse);
        expect(dialog.selectableDayPredicate!(DateTime(2031, 5, 5)), isTrue);
        expect(dialog.selectableDayPredicate!(DateTime(2031, 5, 7)), isTrue);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );

    testWidgets(
      '${compact ? 'PLAN' : 'ordinary'} picker disables date entry when the weekly schedule closes every weekday',
      (tester) async {
        final calendar = shopCalendar();
        final shop = ValueNotifier(
          ruleShop(
            calendar,
            businessHours: {
              for (final weekday in const [
                'monday',
                'tuesday',
                'wednesday',
                'thursday',
                'friday',
                'saturday',
                'sunday',
              ])
                weekday: const [
                  {'closed': true},
                ],
            },
          ),
        );
        final selected = <DateTime>[];
        addTearDown(shop.dispose);
        await tester.pumpWidget(livePicker(shop, selected, compact: compact));

        final dateAction = find.ancestor(
          of: find.text(compact ? 'Choose date' : 'Choose another date'),
          matching: find.byType(OutlinedButton),
        );
        expect(
          find.textContaining(
            'The shop is closed on every date shown, based on its weekly schedule and temporary closure dates.',
          ),
          findsOneWidget,
        );
        expect(tester.widget<OutlinedButton>(dateAction).onPressed, isNull);
        expect(selected, isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );

    testWidgets(
      '${compact ? 'PLAN' : 'ordinary'} date dialog marks the shop-local calendar day as today',
      (tester) async {
        final calendar = shopCalendar();
        final shop = ValueNotifier(ruleShop(calendar));
        final selected = <DateTime>[];
        addTearDown(shop.dispose);
        await tester.pumpWidget(livePicker(shop, selected, compact: compact));
        await tester.tap(
          find.text(compact ? '2031-05-02' : 'Choose another date'),
        );
        await tester.pumpAndSettle();

        final shopToday = DateTime(2031, 5, 1);
        final dialog = tester.widget<DatePickerDialog>(
          find.byType(DatePickerDialog),
        );
        expect(dialog.currentDate, shopToday);
        expect(
          tester
              .widget<CalendarDatePicker>(find.byType(CalendarDatePicker))
              .currentDate,
          shopToday,
        );
        expect(selected, isEmpty);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );

    testWidgets(
      '${compact ? 'PLAN' : 'ordinary'} date dialog cannot submit a newly closed date after rules update',
      (tester) async {
        final calendar = shopCalendar();
        final shop = ValueNotifier(ruleShop(calendar));
        final selected = <DateTime>[];
        addTearDown(shop.dispose);
        await tester.pumpWidget(livePicker(shop, selected, compact: compact));
        await tester.tap(
          find.text(compact ? '2031-05-02' : 'Choose another date'),
        );
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<DatePickerDialog>(find.byType(DatePickerDialog))
              .initialDate,
          DateTime(2031, 5, 2),
        );

        // Keep the same calendar instance to isolate the closure-rule change.
        shop.value = ruleShop(calendar, closesMay2: true);
        await tester.pump();
        await tester.tap(find.text('OK'));
        await tester.pumpAndSettle();
        expect(selected, isEmpty);
        expect(tester.takeException(), isNull);

        await tester.tap(
          find.text(compact ? 'Choose date' : 'Choose another date'),
        );
        await tester.pumpAndSettle();
        final dialog = tester.widget<DatePickerDialog>(
          find.byType(DatePickerDialog),
        );
        expect(dialog.selectableDayPredicate!(DateTime(2031, 5, 2)), isFalse);
        await tester.tap(find.text('3').last);
        await tester.tap(find.text('OK'));
        await tester.pumpAndSettle();
        expect(selected, [DateTime.utc(2031, 5, 3)]);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets('a queued quick date cannot select a newly closed day', (
    tester,
  ) async {
    final calendar = shopCalendar();
    final shop = ValueNotifier(ruleShop(calendar));
    final selected = <DateTime>[];
    addTearDown(shop.dispose);
    await tester.pumpWidget(livePicker(shop, selected));
    final day = find.ancestor(
      of: find.text('5/2'),
      matching: find.byType(OutlinedButton),
    );
    final activate = tester.widget<OutlinedButton>(day).onPressed!;
    shop.value = ruleShop(calendar, closesMay2: true);
    await tester.pump();
    expect(tester.widget<OutlinedButton>(day).onPressed, isNull);

    activate();
    expect(selected, isEmpty);
    await tester.tap(find.text('5/3'));
    expect(selected, [DateTime.utc(2031, 5, 3)]);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'an unrelated contact update preserves the open valid date dialog',
    (tester) async {
      final calendar = shopCalendar();
      final shop = ValueNotifier(ruleShop(calendar));
      final selected = <DateTime>[];
      addTearDown(shop.dispose);
      await tester.pumpWidget(livePicker(shop, selected, compact: true));
      await tester.tap(find.text('2031-05-02'));
      await tester.pumpAndSettle();
      shop.value = ruleShop(calendar, phone: '555-0101');
      await tester.pump();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      expect(selected, [DateTime.utc(2031, 5, 2)]);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
