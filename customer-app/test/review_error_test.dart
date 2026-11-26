import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking_plan.dart';
import 'package:mjapp_client/models/review.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_list_screen.dart';
import 'package:mjapp_client/screens/my_reviews_screen.dart';
import 'package:mjapp_client/screens/review_form_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/review_error.dart';

import 'review_availability_test.dart' as fixtures;

const _privateMarker = 'private-review-password-DO-NOT-DISPLAY';
const _unsafeMessage =
    '<script>$_privateMarker</script> Authorization: Bearer secret-token '
    'DioException [bad response] database.internal SELECT password';
const _closedMessage =
    'This shop is no longer accepting new or updated reviews. '
    'Your draft has been kept.';
const _writeFallback =
    'Unable to save your review. Your draft has been kept. Please try again.';
const _deleteFallback = 'Unable to delete your review. Please try again.';

DioException _rejected({int? status = 400, Object? data}) {
  final request = RequestOptions(
    path: '/reviews?credential=$_privateMarker',
    headers: {'Authorization': 'Bearer $_privateMarker'},
  );
  return DioException(
    requestOptions: request,
    type: DioExceptionType.badResponse,
    response: Response<Object?>(
      requestOptions: request,
      statusCode: status,
      data: data,
    ),
    message: _unsafeMessage,
    error: StateError(_unsafeMessage),
  );
}

DioException _disconnected() => DioException(
  requestOptions: RequestOptions(path: '/reviews?credential=$_privateMarker'),
  type: DioExceptionType.connectionError,
  message: _unsafeMessage,
);

void _expectLocalMessage(String message) {
  expect(message, isNotEmpty);
  for (final raw in [
    _privateMarker,
    '<script>',
    'Authorization',
    'Bearer',
    'secret-token',
    'DioException',
    'bad response',
    'database.internal',
    'SELECT password',
  ]) {
    expect(message, isNot(contains(raw)), reason: 'Leaked $raw');
  }
  expect(message, isNot(matches(RegExp(r'[\u3400-\u9fff]'))));
}

class _RejectedReviewRepository extends ReviewRepository {
  _RejectedReviewRepository(this.failure) : super(ApiService());

  final Object failure;
  int creates = 0, updates = 0, deletes = 0;
  int? lastRating;
  String? lastContent;

  @override
  Future<Review> createReview({
    required String bookingId,
    required int rating,
    String? content,
  }) async {
    creates++;
    lastRating = rating;
    lastContent = content;
    throw failure;
  }

  @override
  Future<Review> updateReview({
    required String reviewId,
    int? rating,
    String? content,
  }) async {
    updates++;
    lastRating = rating;
    lastContent = content;
    throw failure;
  }

  @override
  Future<void> deleteReview(String reviewId) async {
    deletes++;
    throw failure;
  }
}

class _FailureCaches {
  _FailureCaches(Object failure)
    : repository = _RejectedReviewRepository(failure) {
    container = ProviderContainer(
      overrides: [
        reviewRepositoryProvider.overrideWithValue(repository),
        myReviewsProvider.overrideWith((ref) async {
          _count('mine');
          return [fixtures.savedReview()];
        }),
        shopReviewsProvider('7').overrideWith((ref) async {
          _count('public');
          return [fixtures.savedReview()];
        }),
        shopDetailProvider('7').overrideWith((ref) async {
          _count('detail');
          return fixtures.reviewShop();
        }),
        shopListProvider.overrideWith((ref) {
          _count('shops');
          return ShopListNotifier(ShopRepository(ApiService()));
        }),
        bookingPageProvider.overrideWith((ref) async {
          _count('bookings');
          return BookingPage(
            items: [fixtures.completedBooking()],
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
          );
        }),
      ],
    );
  }

  final _RejectedReviewRepository repository;
  final reads = <String, int>{};
  late final ProviderContainer container;

  void _count(String key) => reads[key] = (reads[key] ?? 0) + 1;

  Future<void> warm() async {
    await container.read(myReviewsProvider.future);
    await container.read(shopReviewsProvider('7').future);
    await container.read(shopDetailProvider('7').future);
    await container.read(bookingPageProvider.future);
    container.read(shopListProvider);
  }
}

Finder _ratingButtons() => find.byWidgetPredicate((widget) {
  if (widget is! IconButton || widget.icon is! Icon) return false;
  final icon = (widget.icon as Icon).icon;
  return icon == Icons.star || icon == Icons.star_border;
});

void main() {
  group('local review error messages', () {
    test(
      'a recognized disabled code selects a local message, not server text',
      () {
        final message = reviewWriteError(
          _rejected(
            data: {
              'code': 'REVIEWS_DISABLED',
              'message': _unsafeMessage,
              'debug': {'credentials': _privateMarker},
            },
          ),
        );
        expect(message, _closedMessage);
        _expectLocalMessage(message);
        final nested = reviewWriteError(
          _rejected(
            data: {
              'error': {'code': 'REVIEWS_DISABLED', 'message': _unsafeMessage},
            },
          ),
        );
        expect(nested, _closedMessage);
        _expectLocalMessage(nested);
      },
    );

    test(
      'unknown codes, malformed bodies and nested messages use a safe fallback',
      () {
        for (final data in <Object?>[
          null,
          _unsafeMessage,
          {'code': _unsafeMessage, 'message': _unsafeMessage},
          {
            'code': ['REVIEWS_DISABLED', _unsafeMessage],
            'message': _unsafeMessage,
          },
          {
            'code': {'message': _unsafeMessage},
            'message': [_unsafeMessage],
          },
          {
            'error': {'code': _unsafeMessage, 'message': _unsafeMessage},
          },
          {'message': 'REVIEWS_DISABLED $_unsafeMessage'},
          [
            {'code': 'REVIEWS_DISABLED', 'message': _unsafeMessage},
          ],
        ]) {
          final message = reviewWriteError(_rejected(data: data));
          expect(message, _writeFallback);
          _expectLocalMessage(message);
        }
      },
    );

    test('ordinary exceptions never expose their raw details', () {
      final message = reviewWriteError(StateError(_unsafeMessage));
      expect(message, _writeFallback);
      _expectLocalMessage(message);
    });

    test(
      'session and permission failures are local and have actionable guidance',
      () {
        final session = reviewWriteError(
          _rejected(status: 401, data: _unsafeMessage),
        );
        final permission = reviewWriteError(
          _rejected(status: 403, data: _unsafeMessage),
        );
        expect(
          session.toLowerCase(),
          anyOf(contains('sign in'), contains('session')),
        );
        expect(
          permission.toLowerCase(),
          anyOf(
            contains('permission'),
            contains('allowed'),
            contains('account'),
          ),
        );
        expect(session, isNot(permission));
        _expectLocalMessage(session);
        _expectLocalMessage(permission);
      },
    );

    test(
      'other definite server rejections cannot echo a hostile response body',
      () {
        for (final status in [404, 409, 429]) {
          final clean = reviewWriteError(_rejected(status: status));
          final hostile = reviewWriteError(
            _rejected(
              status: status,
              data: {
                'code': _unsafeMessage,
                'message': _unsafeMessage,
                'payload': {'credential': _privateMarker},
              },
            ),
          );
          expect(hostile, clean);
          expect(hostile, isNot(_writeFallback));
          _expectLocalMessage(hostile);
        }
      },
    );

    test(
      'uncertain writes ask customers to check My Reviews before retrying',
      () {
        final expected = reviewWriteError(_disconnected());
        expect(expected.toLowerCase(), contains('my reviews'));
        expect(expected.toLowerCase(), contains('trying again'));
        expect(
          expected.toLowerCase(),
          anyOf(contains('verify'), contains('check')),
        );
        for (final failure in <Object>[
          _rejected(status: null, data: _unsafeMessage),
          _rejected(status: 408, data: _unsafeMessage),
          _rejected(status: 500, data: _unsafeMessage),
          _rejected(status: 503, data: _unsafeMessage),
        ]) {
          expect(reviewWriteError(failure), expected);
        }
        _expectLocalMessage(expected);
      },
    );

    test(
      'delete rejection and uncertain delete provide separate safe guidance',
      () {
        final definite = reviewDeleteError(
          _rejected(
            data: {'code': 'REVIEWS_DISABLED', 'message': _unsafeMessage},
          ),
        );
        expect(definite, _deleteFallback);
        final uncertain = reviewDeleteError(_disconnected());
        expect(
          uncertain,
          'Unable to verify whether your review was deleted. '
          'Refresh My Reviews before trying again.',
        );
        expect(
          reviewDeleteError(_rejected(status: 503, data: _unsafeMessage)),
          uncertain,
        );
        _expectLocalMessage(definite);
        _expectLocalMessage(uncertain);
      },
    );
  });

  for (final editing in [false, true]) {
    testWidgets(
      '${editing ? 'update' : 'create'} rejection preserves the draft, rating, route and cached data',
      (tester) async {
        final caches = _FailureCaches(
          _rejected(
            data: {'code': 'REVIEWS_DISABLED', 'message': _unsafeMessage},
          ),
        );
        await caches.warm();
        await fixtures.showScreen(
          tester,
          caches.container,
          Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => Navigator.push<bool>(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ReviewFormScreen(
                      bookingId: '42',
                      shopId: '7',
                      editReviewId: editing ? '10' : null,
                      editRating: editing ? 2 : null,
                      editContent: editing ? 'Original saved content.' : null,
                    ),
                  ),
                ),
                child: const Text('Open review form'),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open review form'));
        await tester.pumpAndSettle();
        await tester.tap(_ratingButtons().at(3));
        await tester.pump();
        const draft = 'My unsubmitted review draft must survive the rejection.';
        await tester.enterText(find.byType(TextField), draft);
        final before = Map<String, int>.of(caches.reads);
        await tester.tap(find.byType(FilledButton));
        await tester.pumpAndSettle();

        expect(find.byType(ReviewFormScreen), findsOneWidget);
        expect(find.text('Open review form'), findsNothing);
        expect(
          tester.widget<TextField>(find.byType(TextField)).controller!.text,
          draft,
        );
        expect(find.byIcon(Icons.star), findsNWidgets(4));
        expect(find.byIcon(Icons.star_border), findsOneWidget);
        expect(caches.repository.lastRating, 4);
        expect(caches.repository.lastContent, draft);
        expect(find.textContaining(_closedMessage), findsOneWidget);
        expect(find.textContaining('DioException'), findsNothing);
        expect(find.textContaining(_privateMarker), findsNothing);
        expect(find.text('Review submitted successfully'), findsNothing);
        expect(find.text('Review updated'), findsNothing);
        expect(
          tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
          isNotNull,
        );
        await caches.warm();
        expect(
          caches.reads,
          before,
          reason: 'A rejected write must not take the success path',
        );

        // The server explicitly rejected this request, so the retained draft can be retried.
        await tester.tap(find.byType(FilledButton));
        await tester.pumpAndSettle();
        expect(
          editing ? caches.repository.updates : caches.repository.creates,
          2,
        );
        expect(
          editing ? caches.repository.creates : caches.repository.updates,
          0,
        );
        expect(
          tester.widget<TextField>(find.byType(TextField)).controller!.text,
          draft,
        );
        await caches.warm();
        expect(caches.reads, before);
      },
    );
  }

  testWidgets(
    'delete rejection keeps the original review and cached data with a local error',
    (tester) async {
      final caches = _FailureCaches(
        _rejected(data: {'message': _unsafeMessage}),
      );
      await caches.warm();
      await fixtures.showScreen(
        tester,
        caches.container,
        const MyReviewsScreen(),
      );
      final before = Map<String, int>.of(caches.reads);
      await tester.tap(find.byKey(const ValueKey('review-actions:10')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(caches.repository.deletes, 1);
      expect(find.text('An existing review remains readable.'), findsOneWidget);
      expect(find.textContaining(_deleteFallback), findsOneWidget);
      expect(find.textContaining('DioException'), findsNothing);
      expect(find.textContaining(_privateMarker), findsNothing);
      expect(find.text('Review deleted successfully'), findsNothing);
      await caches.warm();
      expect(caches.reads, before);
      await tester.tap(find.byKey(const ValueKey('review-actions:10')));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<PopupMenuItem<String>>(fixtures.menuItem('Delete'))
            .enabled,
        isTrue,
      );
    },
  );
}
