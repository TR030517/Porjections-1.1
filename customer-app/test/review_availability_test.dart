import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/review.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/screens/my_reviews_screen.dart';
import 'package:mjapp_client/screens/review_form_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/booking_reschedule_journal.dart';

class ReviewCustomer extends AuthNotifier {
  ReviewCustomer() : super(ApiService()) {
    state = AuthState(
      isLoggedIn: true,
      user: User(id: '41', role: 'CUSTOMER'),
    );
  }
}

ProviderContainer reviewContainer({required List<Override> overrides}) =>
    ProviderContainer(
      overrides: [
        authProvider.overrideWith((ref) => ReviewCustomer()),
        bookingRescheduleJournalProvider.overrideWith(
          (ref) => BookingRescheduleJournal(),
        ),
        ...overrides,
      ],
    );

ShopDetail reviewShop({bool enabled = true, String id = '7'}) =>
    ShopDetail.fromJson({
      'id': id,
      'name': 'Review test shop',
      'latitude': 0,
      'longitude': 0,
      'features': {'reviews': enabled},
    });

Booking completedBooking({
  bool hasReview = false,
  String status = 'COMPLETED',
}) => Booking.fromJson({
  'id': '42',
  'userId': '41',
  'shopId': '7',
  'serviceId': '8',
  'status': status,
  'hasReview': hasReview,
  'priceCents': 4000,
  'totalCents': 4000,
  'paidCents': 0,
  'refundedCents': 0,
  'amountDueCents': 4000,
  'currency': 'usd',
  'paymentMode': 'PAY_AT_STORE',
  'paymentStatus': 'UNPAID',
  'therapist': {'id': '11', 'name': 'Therapist 1'},
  'localDate': '2031-05-01',
  'localStartTime': '10:00',
  'localEndTime': '11:00',
  'timezone': 'America/Los_Angeles',
});

Review savedReview() => Review(
  id: '10',
  bookingId: '42',
  rating: 4,
  content: 'An existing review remains readable.',
  shop: ReviewShop(id: '7', name: 'Review test shop'),
);

Future<void> showScreen(
  WidgetTester tester,
  ProviderContainer container,
  Widget screen, {
  bool settle = true,
}) async {
  tester.view.physicalSize = const Size(1100, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: screen,
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump();
  }
}

Finder menuItem(String label) => find.ancestor(
  of: find.text(label),
  matching: find.byType(PopupMenuItem<String>),
);

class FakeReviewRepository extends ReviewRepository {
  FakeReviewRepository() : super(ApiService());
  int creates = 0, updates = 0, deletes = 0;
  void Function(Review?)? onWrite;

  @override
  Future<Review> createReview({
    required String bookingId,
    required int rating,
    String? content,
  }) async {
    creates++;
    final review = Review(
      id: '10',
      bookingId: bookingId,
      rating: rating,
      content: content,
      shop: ReviewShop(id: '7', name: 'Review test shop'),
    );
    onWrite?.call(review);
    return review;
  }

  @override
  Future<Review> updateReview({
    required String reviewId,
    int? rating,
    String? content,
  }) async {
    updates++;
    final review = Review(
      id: reviewId,
      bookingId: '42',
      rating: rating ?? 4,
      content: content,
      shop: ReviewShop(id: '7', name: 'Review test shop'),
    );
    onWrite?.call(review);
    return review;
  }

  @override
  Future<void> deleteReview(String reviewId) async {
    deletes++;
    onWrite?.call(null);
  }
}

/// Warm independent caches so mutations must invalidate already-loaded data.
class ReviewCaches {
  final repository = FakeReviewRepository();
  final reads = <String, int>{};
  Review? review;
  late final ProviderContainer container;

  ReviewCaches({bool existing = false}) {
    review = existing ? savedReview() : null;
    repository.onWrite = (value) => review = value;
    container = reviewContainer(
      overrides: [
        reviewRepositoryProvider.overrideWithValue(repository),
        myReviewsProvider.overrideWith((ref) async {
          count('mine');
          return [?review];
        }),
        shopReviewsProvider('7').overrideWith((ref) async {
          count('public');
          return [?review];
        }),
        shopDetailProvider('7').overrideWith((ref) async {
          count('detail');
          return reviewShop();
        }),
        shopListProvider.overrideWith((ref) {
          count('shops');
          return ShopListNotifier(ShopRepository(ApiService()));
        }),
        bookingPageProvider.overrideWith((ref) async {
          count('bookings');
          return BookingPage(
            items: [completedBooking(hasReview: review != null)],
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
          );
        }),
      ],
    );
  }

  void count(String key) => reads[key] = (reads[key] ?? 0) + 1;

  Future<void> warm() async {
    await container.read(myReviewsProvider.future);
    await container.read(shopReviewsProvider('7').future);
    await container.read(shopDetailProvider('7').future);
    await container.read(bookingPageProvider.future);
    container.read(shopListProvider);
  }

  Future<void> expectRefreshed(Map<String, int> before) async {
    await warm();
    for (final key in ['mine', 'public', 'detail', 'shops', 'bookings']) {
      expect(
        reads[key],
        greaterThan(before[key]!),
        reason: '$key cache is stale',
      );
    }
  }
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  testWidgets('closed shop hides the completed booking review entry', (
    tester,
  ) async {
    final container = reviewContainer(
      overrides: [
        bookingListProvider.overrideWith((ref) async => [completedBooking()]),
        shopDetailProvider(
          '7',
        ).overrideWith((ref) async => reviewShop(enabled: false)),
      ],
    );
    await showScreen(
      tester,
      container,
      const Scaffold(body: BookingListScreen()),
    );
    expect(find.text('Write Review'), findsNothing);
    expect(find.text('Booking details'), findsOneWidget);
    expect(find.text('Total: USD 40.00'), findsOneWidget);
  });

  testWidgets(
    'closed shop keeps existing review readable and delete available but disables edit',
    (tester) async {
      final container = reviewContainer(
        overrides: [
          myReviewsProvider.overrideWith((ref) async => [savedReview()]),
          shopDetailProvider(
            '7',
          ).overrideWith((ref) async => reviewShop(enabled: false)),
        ],
      );
      await showScreen(tester, container, const MyReviewsScreen());
      expect(find.text('An existing review remains readable.'), findsOneWidget);
      await tester.tap(find.byType(PopupMenuButton<String>));
      await tester.pumpAndSettle();
      final edit = find.ancestor(
        of: find.text('Edit'),
        matching: find.byType(PopupMenuItem<String>),
      );
      final delete = find.ancestor(
        of: find.text('Delete'),
        matching: find.byType(PopupMenuItem<String>),
      );
      expect(tester.widget<PopupMenuItem<String>>(edit).enabled, isFalse);
      expect(tester.widget<PopupMenuItem<String>>(delete).enabled, isTrue);
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      expect(
        find.text('Are you sure you want to delete this review?'),
        findsOneWidget,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('An existing review remains readable.'), findsOneWidget);
    },
  );

  testWidgets('enabled shop opens review form from a completed booking', (
    tester,
  ) async {
    final container = reviewContainer(
      overrides: [
        bookingListProvider.overrideWith((ref) async => [completedBooking()]),
        shopDetailProvider('7').overrideWith((ref) async => reviewShop()),
      ],
    );
    await showScreen(
      tester,
      container,
      const Scaffold(body: BookingListScreen()),
    );
    expect(find.text('Write Review'), findsOneWidget);
    await tester.tap(find.text('Write Review'));
    await tester.pumpAndSettle();
    expect(find.byType(ReviewFormScreen), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('loading shop has no review entry until availability is known', (
    tester,
  ) async {
    final pending = Completer<ShopDetail>();
    final container = reviewContainer(
      overrides: [
        bookingListProvider.overrideWith((ref) async => [completedBooking()]),
        shopDetailProvider('7').overrideWith((ref) => pending.future),
      ],
    );
    await showScreen(
      tester,
      container,
      const Scaffold(body: BookingListScreen()),
      settle: false,
    );
    expect(find.text('Write Review'), findsNothing);
    pending.complete(reviewShop());
    await tester.pumpAndSettle();
    expect(find.text('Write Review'), findsOneWidget);
  });

  testWidgets(
    'failed availability is closed and retries only the selected shop',
    (tester) async {
      var reads = 0;
      final container = reviewContainer(
        overrides: [
          bookingListProvider.overrideWith((ref) async => [completedBooking()]),
          shopDetailProvider('7').overrideWith((ref) async {
            reads++;
            if (reads == 1) throw StateError('Synthetic unavailable shop');
            return reviewShop();
          }),
        ],
      );
      await showScreen(
        tester,
        container,
        const Scaffold(body: BookingListScreen()),
      );
      expect(find.text('Write Review'), findsNothing);
      expect(
        find.byKey(const ValueKey('review-availability:42')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('review-availability:42')));
      await tester.pumpAndSettle();
      expect(reads, 2);
      expect(find.text('Write Review'), findsOneWidget);
    },
  );

  testWidgets(
    'refresh locks the booking review entry despite previously enabled cached data',
    (tester) async {
      final pending = Completer<ShopDetail>();
      var reads = 0;
      final container = reviewContainer(
        overrides: [
          bookingListProvider.overrideWith((ref) async => [completedBooking()]),
          shopDetailProvider('7').overrideWith((ref) {
            reads++;
            return reads == 1 ? Future.value(reviewShop()) : pending.future;
          }),
        ],
      );
      await showScreen(
        tester,
        container,
        const Scaffold(body: BookingListScreen()),
      );
      expect(find.text('Write Review'), findsOneWidget);
      container.invalidate(shopDetailProvider('7'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Write Review'), findsNothing);
      pending.complete(reviewShop(enabled: false));
      await tester.pumpAndSettle();
      expect(find.text('Write Review'), findsNothing);
    },
  );

  testWidgets(
    'another shop cannot authorize this booking or direct review form',
    (tester) async {
      final container = reviewContainer(
        overrides: [
          bookingListProvider.overrideWith((ref) async => [completedBooking()]),
          shopDetailProvider(
            '7',
          ).overrideWith((ref) async => reviewShop(id: '8')),
        ],
      );
      await showScreen(
        tester,
        container,
        const Scaffold(body: BookingListScreen()),
      );
      expect(find.text('Write Review'), findsNothing);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const ReviewFormScreen(bookingId: '42', shopId: '7'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
    },
  );

  testWidgets('already reviewed booking does not fetch eligibility again', (
    tester,
  ) async {
    var reads = 0;
    final container = reviewContainer(
      overrides: [
        bookingListProvider.overrideWith(
          (ref) async => [completedBooking(hasReview: true)],
        ),
        shopDetailProvider('7').overrideWith((ref) async {
          reads++;
          return reviewShop();
        }),
      ],
    );
    await showScreen(
      tester,
      container,
      const Scaffold(body: BookingListScreen()),
    );
    expect(find.text('Write Review'), findsNothing);
    expect(reads, 0);
  });

  testWidgets(
    'review form hides stale editable controls while refreshing and offers recovery after error',
    (tester) async {
      final pending = Completer<ShopDetail>();
      var reads = 0;
      final container = reviewContainer(
        overrides: [
          shopDetailProvider('7').overrideWith((ref) {
            reads++;
            return switch (reads) {
              1 => Future.value(reviewShop()),
              2 => pending.future,
              _ => Future.value(reviewShop()),
            };
          }),
        ],
      );
      await showScreen(
        tester,
        container,
        const ReviewFormScreen(
          bookingId: '42',
          shopId: '7',
          editReviewId: '10',
          editRating: 4,
        ),
      );
      expect(find.byType(FilledButton), findsOneWidget);
      container.invalidate(shopDetailProvider('7'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byType(TextField), findsNothing);
      pending.completeError(StateError('Synthetic failed refresh'));
      await tester.pumpAndSettle();
      expect(find.byType(FilledButton), findsNothing);
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(reads, 3);
      expect(find.byType(FilledButton), findsOneWidget);
    },
  );

  testWidgets(
    'submit rechecks eligibility before writing if availability changes between frames',
    (tester) async {
      final pending = Completer<ShopDetail>();
      final repository = FakeReviewRepository();
      var reads = 0;
      final container = reviewContainer(
        overrides: [
          reviewRepositoryProvider.overrideWithValue(repository),
          shopDetailProvider('7').overrideWith((ref) {
            reads++;
            return reads == 1 ? Future.value(reviewShop()) : pending.future;
          }),
        ],
      );
      await showScreen(
        tester,
        container,
        const ReviewFormScreen(
          bookingId: '42',
          shopId: '7',
          editReviewId: '10',
          editRating: 4,
        ),
      );
      final submit = tester
          .widget<FilledButton>(find.byType(FilledButton))
          .onPressed!;
      container.invalidate(shopDetailProvider('7'));
      submit();
      await tester.pump();
      expect(repository.updates, 0);
      pending.complete(reviewShop(enabled: false));
      await tester.pumpAndSettle();
      expect(find.byType(FilledButton), findsNothing);
    },
  );

  testWidgets(
    'personal review menu keeps delete available while old enabled status refreshes',
    (tester) async {
      final pending = Completer<ShopDetail>();
      var reads = 0;
      final container = reviewContainer(
        overrides: [
          myReviewsProvider.overrideWith((ref) async => [savedReview()]),
          shopDetailProvider('7').overrideWith((ref) {
            reads++;
            return reads == 1 ? Future.value(reviewShop()) : pending.future;
          }),
        ],
      );
      await showScreen(tester, container, const MyReviewsScreen());
      container.invalidate(shopDetailProvider('7'));
      await tester.pump();
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('review-actions:10')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<PopupMenuItem<String>>(menuItem('Edit')).enabled,
        isFalse,
      );
      expect(
        tester.widget<PopupMenuItem<String>>(menuItem('Delete')).enabled,
        isTrue,
      );
      pending.complete(reviewShop(enabled: false));
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'creating review refreshes existing personal public shop and booking caches',
    (tester) async {
      final caches = ReviewCaches();
      await caches.warm();
      await showScreen(
        tester,
        caches.container,
        const Scaffold(body: BookingListScreen()),
      );
      final before = Map<String, int>.of(caches.reads);
      await tester.tap(find.text('Write Review'));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.star_border).last);
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'A newly created review.');
      await tester.tap(find.byType(FilledButton));
      await tester.pumpAndSettle();
      expect(caches.repository.creates, 1);
      expect(find.byType(ReviewFormScreen), findsNothing);
      expect(find.text('Write Review'), findsNothing);
      await caches.expectRefreshed(before);
      expect(
        (await caches.container.read(myReviewsProvider.future)).single.content,
        'A newly created review.',
      );
      expect(
        (await caches.container.read(
          shopReviewsProvider('7').future,
        )).single.rating,
        5,
      );
      expect(
        (await caches.container.read(
          bookingPageProvider.future,
        )).items.single.hasReview,
        isTrue,
      );
    },
  );

  testWidgets(
    'deleting review refreshes cached booking eligibility and public rating data',
    (tester) async {
      final caches = ReviewCaches(existing: true);
      await caches.warm();
      await showScreen(tester, caches.container, const MyReviewsScreen());
      final before = Map<String, int>.of(caches.reads);
      await tester.tap(find.byKey(const ValueKey('review-actions:10')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(caches.repository.deletes, 1);
      await caches.expectRefreshed(before);
      expect(await caches.container.read(myReviewsProvider.future), isEmpty);
      expect(
        await caches.container.read(shopReviewsProvider('7').future),
        isEmpty,
      );
      expect(
        (await caches.container.read(
          bookingPageProvider.future,
        )).items.single.hasReview,
        isFalse,
      );
    },
  );

  testWidgets('editing review refreshes public content and booking caches', (
    tester,
  ) async {
    final caches = ReviewCaches(existing: true);
    await caches.warm();
    await showScreen(tester, caches.container, const MyReviewsScreen());
    final before = Map<String, int>.of(caches.reads);
    await tester.tap(find.byKey(const ValueKey('review-actions:10')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Corrected review content.');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    expect(caches.repository.updates, 1);
    expect(find.text('Corrected review content.'), findsOneWidget);
    await caches.expectRefreshed(before);
    expect(
      (await caches.container.read(
        shopReviewsProvider('7').future,
      )).single.content,
      'Corrected review content.',
    );
  });
}
