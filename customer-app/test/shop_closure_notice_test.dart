import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking_calendar.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/widgets/shop_closure_notice.dart';

Map<String, dynamic> calendar(
  String day, {
  String timezone = 'UTC',
  String? instant,
  String? expires,
}) => {
  'today': day,
  'timezone': timezone,
  'serverNow': instant ?? '${day}T12:00:00Z',
  'validUntil':
      expires ??
      '${DateTime.parse('${day}T00:00:00Z').add(const Duration(days: 1)).toIso8601String().substring(0, 10)}T00:00:00Z',
};

ShopDetail shop(
  List<(String, String)> periods, {
  Map<String, dynamic>? clock,
  String timezone = 'UTC',
  List<String> phones = const ['206-555-0123'],
}) => ShopDetail.fromJson({
  'id': '7',
  'name': 'Closure notice fixture',
  'latitude': 0,
  'longitude': 0,
  'timezone': timezone,
  'bookingCalendar': clock,
  // An authoritative empty public phone list must not resurrect other contacts.
  'phones': phones,
  'phone': '999-555-9999',
  'owner': {'phone': '888-555-8888'},
  'bookingSettings': {
    'minimumNoticeMinutes': 720,
    'closedPeriods': [
      for (final period in periods)
        {'startDate': period.$1, 'endDate': period.$2},
    ],
  },
});

Widget notice(ShopDetail value) => MaterialApp(
  locale: const Locale('en'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(
    body: SingleChildScrollView(child: ShopClosureNotice(shop: value)),
  ),
);

// Control the server calendar's elapsed instant, not the visitor's wall clock.
// This exercises the real widget timer without waiting for real midnight.
class AdvancingCalendar implements BookingCalendar {
  @override
  final String timezone = 'UTC';
  @override
  final DateTime today = DateTime.utc(2031, 11, 10);
  @override
  final DateTime serverNow = DateTime.utc(2031, 11, 10, 23, 59);
  @override
  final DateTime validUntil = DateTime.utc(2031, 11, 11);
  DateTime now = DateTime.utc(2031, 11, 10, 23, 59);
  @override
  Duration get remaining => validUntil.difference(now);
  @override
  bool get isCurrent => remaining > Duration.zero;
}

void main() {
  testWidgets(
    'future notice keeps the year, inclusive range and only this shop public phone',
    (tester) async {
      await tester.pumpWidget(
        notice(
          shop([('2031-11-11', '2031-11-20')], clock: calendar('2031-11-10')),
        ),
      );
      expect(find.text('Upcoming closure'), findsOneWidget);
      expect(
        find.textContaining('This shop will be closed from Nov 11–20, 2031'),
        findsOneWidget,
      );
      expect(find.textContaining('Both dates are included'), findsOneWidget);
      expect(find.widgetWithText(TextButton, '206-555-0123'), findsOneWidget);
      expect(find.textContaining('999-555-9999'), findsNothing);
      expect(find.textContaining('888-555-8888'), findsNothing);
      expect(find.text('Temporarily closed'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'closure is current on both endpoints and disappears on the reopening day',
    (tester) async {
      for (final day in ['2031-11-11', '2031-11-20']) {
        await tester.pumpWidget(
          notice(shop([('2031-11-11', '2031-11-20')], clock: calendar(day))),
        );
        expect(find.text('Temporarily closed'), findsOneWidget);
        expect(
          find.textContaining(
            'This shop is temporarily closed from Nov 11–20, 2031',
          ),
          findsOneWidget,
        );
        expect(find.text('Upcoming closure'), findsNothing);
      }
      await tester.pumpWidget(
        notice(
          shop([('2031-11-11', '2031-11-20')], clock: calendar('2031-11-21')),
        ),
      );
      expect(find.textContaining('Nov 11'), findsNothing);
      expect(find.text('Temporarily closed'), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'single leap day and cross-year ranges retain unambiguous English calendar dates',
    (tester) async {
      await tester.pumpWidget(
        notice(
          shop([
            ('2032-02-29', '2032-02-29'),
            ('2031-12-31', '2032-01-02'),
          ], clock: calendar('2031-12-30')),
        ),
      );
      expect(
        find.textContaining('from Dec 31, 2031–Jan 2, 2032'),
        findsOneWidget,
      );
      expect(find.textContaining('closed on Feb 29, 2032'), findsOneWidget);
      expect(find.textContaining('closed from Feb 29'), findsNothing);
      expect(find.text('Upcoming closure'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'current closure takes priority while past ranges are removed and future ranges remain dated',
    (tester) async {
      await tester.pumpWidget(
        notice(
          shop([
            ('2031-11-22', '2031-11-23'),
            ('2031-11-01', '2031-11-02'),
            ('2031-11-11', '2031-11-20'),
          ], clock: calendar('2031-11-15')),
        ),
      );
      expect(find.text('Temporarily closed'), findsOneWidget);
      expect(
        find.textContaining('temporarily closed from Nov 11–20, 2031'),
        findsOneWidget,
      );
      expect(
        find.textContaining('will be closed from Nov 22–23, 2031'),
        findsOneWidget,
      );
      expect(find.textContaining('Nov 1–2'), findsNothing);
      expect(find.text('Upcoming closure'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'same UTC instant uses each shop local date instead of the visitor date',
    (tester) async {
      final instant = '2031-11-11T00:30:00Z';
      await tester.pumpWidget(
        notice(
          shop(
            [('2031-11-11', '2031-11-11')],
            timezone: 'America/Los_Angeles',
            clock: calendar(
              '2031-11-10',
              timezone: 'America/Los_Angeles',
              instant: instant,
              expires: '2031-11-11T08:00:00Z',
            ),
          ),
        ),
      );
      expect(find.text('Upcoming closure'), findsOneWidget);
      await tester.pumpWidget(
        notice(
          shop(
            [('2031-11-11', '2031-11-11')],
            timezone: 'Pacific/Kiritimati',
            clock: calendar(
              '2031-11-11',
              timezone: 'Pacific/Kiritimati',
              instant: instant,
              expires: '2031-11-11T10:00:00Z',
            ),
          ),
        ),
      );
      expect(find.text('Temporarily closed'), findsOneWidget);
      expect(find.textContaining('closed on Nov 11, 2031'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'without a reliable shop date the announcement is neutral and a missing shop phone is not invented',
    (tester) async {
      final value = shop([('2031-11-11', '2031-11-20')], phones: const []);
      await tester.pumpWidget(notice(value));
      expect(find.text('Scheduled closure'), findsOneWidget);
      expect(
        find.textContaining('scheduled to be closed from Nov 11–20, 2031'),
        findsOneWidget,
      );
      expect(find.text('Temporarily closed'), findsNothing);
      expect(find.text('Upcoming closure'), findsNothing);
      expect(find.textContaining('For questions'), findsNothing);
      expect(find.textContaining('999-555-9999'), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'minute timer enters and leaves a closure at shop midnight even after calendar expiry',
    (tester) async {
      final advancing = AdvancingCalendar();
      final value = ShopDetail(
        id: '7',
        name: 'Midnight fixture',
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
        timezone: 'UTC',
        bookingCalendar: advancing,
        bookingSettings: const CustomerBookingSettings(
          closedPeriods: [
            CustomerClosedPeriod(
              startDate: '2031-11-11',
              endDate: '2031-11-11',
            ),
          ],
        ),
      );
      await tester.pumpWidget(notice(value));
      expect(find.text('Upcoming closure'), findsOneWidget);
      advancing.now = DateTime.utc(2031, 11, 11);
      await tester.pump(const Duration(minutes: 1));
      expect(advancing.isCurrent, isFalse);
      expect(find.text('Temporarily closed'), findsOneWidget);
      advancing.now = DateTime.utc(2031, 11, 12);
      await tester.pump(const Duration(minutes: 1));
      expect(find.textContaining('Nov 11'), findsNothing);
      expect(find.text('Temporarily closed'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(minutes: 1));
      expect(tester.takeException(), isNull);
    },
  );
}
