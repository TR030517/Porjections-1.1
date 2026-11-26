import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/banner_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/shop_list_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

class PendingShopRepository extends ShopRepository {
  PendingShopRepository() : super(ApiService());

  final requests =
      <
        ({
          double? lat,
          double? lng,
          double? radius,
          String? keyword,
          String? category,
          String? city,
          int page,
          int limit,
          Completer<ShopListResponse> response,
        })
      >[];

  @override
  Future<ShopListResponse> listShops({
    double? lat,
    double? lng,
    double? radius,
    String? category,
    String? keyword,
    String? city,
    int page = 1,
    int limit = 20,
  }) {
    final response = Completer<ShopListResponse>();
    requests.add((
      lat: lat,
      lng: lng,
      radius: radius,
      keyword: keyword,
      category: category,
      city: city,
      page: page,
      limit: limit,
      response: response,
    ));
    return response.future;
  }
}

Shop shop(String id) => Shop(
  id: id,
  name: 'Studio $id',
  address: '1 Main St',
  city: 'Seattle',
  state: 'Washington',
  latitude: 47.6,
  longitude: -122.3,
  category: 'MASSAGE',
  avgRating: 0,
  reviewCount: 0,
  bookingCount: 0,
);

ShopListResponse page({
  required int currentPage,
  required int total,
  required List<String> ids,
  int limit = 20,
}) => ShopListResponse(
  items: ids.map(shop).toList(),
  total: total,
  page: currentPage,
  limit: limit,
  totalPages: (total / limit).ceil(),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('only the latest search can update results and loading state', () async {
    final repository = PendingShopRepository();
    final notifier = ShopListNotifier(repository);
    addTearDown(notifier.dispose);

    final oldSearch = notifier.loadShops(keyword: 'A');
    final latestSearch = notifier.loadShops(keyword: 'B');
    repository.requests[0].response.completeError(StateError('obsolete error'));
    await oldSearch;

    expect(notifier.state.keyword, 'B');
    expect(notifier.state.isLoading, isTrue);
    expect(notifier.state.error, isNull);
    expect(notifier.state.data, isNull);

    repository.requests[1].response.complete(
      page(currentPage: 1, total: 1, ids: ['B']),
    );
    await latestSearch;
    expect(notifier.state.data!.items.single.id, 'B');

    final nextA = notifier.loadShops(keyword: 'A');
    final nextB = notifier.loadShops(keyword: 'B');
    repository.requests[3].response.complete(
      page(currentPage: 1, total: 1, ids: ['new-B']),
    );
    await nextB;
    repository.requests[2].response.complete(
      page(currentPage: 1, total: 1, ids: ['late-A']),
    );
    await nextA;

    expect(notifier.state.keyword, 'B');
    expect(notifier.state.data!.items.single.id, 'new-B');
    expect(notifier.state.error, isNull);
  });

  test('changing filters resets to one request for page one', () async {
    final repository = PendingShopRepository();
    final notifier = ShopListNotifier(repository);
    addTearDown(notifier.dispose);

    final initial = notifier.loadShops(
      keyword: 'massage',
      category: 'MASSAGE',
      city: 'Seattle',
      lat: 47.6,
      lng: -122.3,
      radius: 25,
    );
    repository.requests.single.response.complete(
      page(currentPage: 1, total: 21, ids: List.generate(20, (i) => '$i')),
    );
    await initial;
    final loadMore = notifier.loadMoreShops();

    expect(repository.requests, hasLength(2));
    notifier.setFilters(keyword: null, category: null);
    expect(repository.requests, hasLength(3));
    final resetRequest = repository.requests.last;
    expect(resetRequest.page, 1);
    expect(resetRequest.limit, 20);
    expect(resetRequest.keyword, isNull);
    expect(resetRequest.category, isNull);
    expect(resetRequest.city, 'Seattle');
    expect(resetRequest.lat, 47.6);
    expect(resetRequest.lng, -122.3);
    expect(notifier.state.data, isNull);
    repository.requests[1].response.complete(
      page(currentPage: 2, total: 21, ids: ['20']),
    );
    await loadMore;
    expect(notifier.state.data, isNull);
    resetRequest.response.complete(page(currentPage: 1, total: 0, ids: []));
    await Future<void>.delayed(Duration.zero);
    expect(notifier.state.data!.items, isEmpty);
  });

  test(
    'loads later pages with the same query and deduplicates by shop ID',
    () async {
      final repository = PendingShopRepository();
      final notifier = ShopListNotifier(repository);
      addTearDown(notifier.dispose);

      final initial = notifier.loadShops(
        keyword: 'massage',
        category: 'MASSAGE',
        city: 'Seattle',
        lat: 47.6,
        lng: -122.3,
        radius: 25,
      );
      repository.requests.single.response.complete(
        page(currentPage: 1, total: 21, ids: List.generate(20, (i) => '$i')),
      );
      await initial;

      final loadMore = notifier.loadMoreShops();
      expect(repository.requests, hasLength(2));
      final request = repository.requests.last;
      expect(request.page, 2);
      expect(request.limit, 20);
      expect(request.keyword, 'massage');
      expect(request.category, 'MASSAGE');
      expect(request.city, 'Seattle');
      expect(request.lat, 47.6);
      expect(request.lng, -122.3);
      expect(request.radius, 25);

      request.response.complete(
        page(currentPage: 2, total: 21, ids: ['19', '20']),
      );
      await loadMore;

      expect(notifier.state.data!.items, hasLength(21));
      expect(
        notifier.state.data!.items.map((item) => item.id).toSet(),
        hasLength(21),
      );
      expect(notifier.state.data!.items.last.id, '20');
      expect(notifier.state.hasMore, isFalse);
    },
  );

  test(
    'a full first page of 20 results has no next page when total is 20',
    () async {
      final repository = PendingShopRepository();
      final notifier = ShopListNotifier(repository);
      addTearDown(notifier.dispose);

      final initial = notifier.loadShops();
      repository.requests.single.response.complete(
        page(currentPage: 1, total: 20, ids: List.generate(20, (i) => '$i')),
      );
      await initial;

      expect(notifier.state.data!.items, hasLength(20));
      expect(notifier.state.hasMore, isFalse);
      await notifier.loadMoreShops();
      expect(repository.requests, hasLength(1));
    },
  );

  test(
    'duplicate load-more calls share one request and failed page can retry',
    () async {
      final repository = PendingShopRepository();
      final notifier = ShopListNotifier(repository);
      addTearDown(notifier.dispose);

      final initial = notifier.loadShops();
      repository.requests.single.response.complete(
        page(currentPage: 1, total: 23, ids: List.generate(20, (i) => '$i')),
      );
      await initial;

      final firstLoad = notifier.loadMoreShops();
      final duplicateLoad = notifier.loadMoreShops();
      expect(repository.requests, hasLength(2));
      repository.requests[1].response.completeError(
        StateError('page two failed'),
      );
      await Future.wait([firstLoad, duplicateLoad]);

      expect(notifier.state.data!.items, hasLength(20));
      expect(notifier.state.failedPage, 2);
      expect(notifier.state.error, contains('page two failed'));
      expect(notifier.state.hasMore, isTrue);

      final retry = notifier.retry();
      expect(repository.requests, hasLength(3));
      expect(repository.requests.last.page, 2);
      repository.requests.last.response.complete(
        page(currentPage: 2, total: 23, ids: ['20', '21', '22']),
      );
      await retry;

      expect(notifier.state.data!.items, hasLength(23));
      expect(notifier.state.error, isNull);
      expect(notifier.state.failedPage, isNull);
      expect(notifier.state.hasMore, isFalse);
    },
  );

  test('a pending old page cannot append after the search changes', () async {
    final repository = PendingShopRepository();
    final notifier = ShopListNotifier(repository);
    addTearDown(notifier.dispose);

    final initial = notifier.loadShops(keyword: 'A');
    repository.requests.single.response.complete(
      page(currentPage: 1, total: 21, ids: List.generate(20, (i) => 'A$i')),
    );
    await initial;
    final oldPage = notifier.loadMoreShops();

    final newSearch = notifier.loadShops(keyword: 'B');
    repository.requests[2].response.complete(
      page(currentPage: 1, total: 1, ids: ['B1']),
    );
    await newSearch;
    repository.requests[1].response.complete(
      page(currentPage: 2, total: 21, ids: ['A20']),
    );
    await oldPage;

    expect(notifier.state.keyword, 'B');
    expect(notifier.state.data!.items.map((item) => item.id), ['B1']);
  });

  test('completion after notifier disposal does not write state', () async {
    final repository = PendingShopRepository();
    final notifier = ShopListNotifier(repository);
    final pending = notifier.loadShops(keyword: 'A');
    notifier.dispose();

    repository.requests.single.response.complete(
      page(currentPage: 1, total: 1, ids: ['A']),
    );
    await expectLater(pending, completes);
  });

  testWidgets('new-search failure is visible and retries the same query', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = PendingShopRepository();
    final container = ProviderContainer(
      overrides: [
        shopRepositoryProvider.overrideWith((ref) => repository),
        bannersProvider.overrideWith((ref) async => []),
        favoriteShopsProvider.overrideWith((ref) async => []),
        favoritesProvider.overrideWith(
          (ref) => FavoritesNotifier(ApiService()),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: ShopListScreen()),
        ),
      ),
    );
    await tester.pump();
    repository.requests.single.response.complete(
      page(currentPage: 1, total: 1, ids: ['A']),
    );
    await tester.pumpAndSettle();
    expect(find.text('Studio A'), findsOneWidget);

    container.read(shopListProvider.notifier).setKeyword('B');
    await tester.pump();
    repository.requests.last.response.completeError(
      StateError('B unavailable'),
    );
    await tester.pumpAndSettle();

    expect(container.read(shopListProvider).data, isNull);
    expect(find.text('Studio A'), findsNothing);
    expect(find.text('Please try again in a moment.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(repository.requests.last.keyword, 'B');
    repository.requests.last.response.complete(
      page(currentPage: 1, total: 1, ids: ['B']),
    );
    await tester.pumpAndSettle();
    expect(find.text('Studio B'), findsOneWidget);
    expect(find.text('Please try again in a moment.'), findsNothing);
  });

  Future<void> checkLoadMoreLayout(WidgetTester tester, Size viewport) async {
    tester.view.physicalSize = viewport;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = PendingShopRepository();
    final container = ProviderContainer(
      overrides: [
        shopRepositoryProvider.overrideWith((ref) => repository),
        bannersProvider.overrideWith((ref) async => []),
        favoriteShopsProvider.overrideWith((ref) async => []),
        favoritesProvider.overrideWith(
          (ref) => FavoritesNotifier(ApiService()),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: ShopListScreen()),
        ),
      ),
    );
    await tester.pump();
    repository.requests.single.response.complete(
      page(currentPage: 1, total: 23, ids: List.generate(20, (i) => '$i')),
    );
    await tester.pumpAndSettle();

    final loadMoreButton = find.text('Load more studios');
    await tester.dragUntilVisible(
      loadMoreButton,
      find.byType(CustomScrollView),
      const Offset(0, -600),
    );
    await tester.tap(loadMoreButton);
    await tester.pump();
    expect(repository.requests, hasLength(2));
    expect(repository.requests.last.page, 2);
    repository.requests.last.response.completeError(
      StateError('page two failed'),
    );
    await tester.pumpAndSettle();

    expect(
      find.text(
        'More studios could not be loaded. Your current results are still available.',
      ),
      findsOneWidget,
    );
    final retryMoreButton = find.text('Retry loading more');
    await tester.dragUntilVisible(
      retryMoreButton,
      find.byType(CustomScrollView),
      const Offset(0, -600),
    );
    await tester.tap(retryMoreButton);
    await tester.pump();
    expect(repository.requests, hasLength(3));
    expect(repository.requests.last.page, 2);
    repository.requests.last.response.complete(
      page(currentPage: 2, total: 23, ids: ['20', '21', '22']),
    );
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.text('Studio 22'),
      find.byType(CustomScrollView),
      const Offset(0, -600),
    );
    expect(find.text('Studio 22'), findsOneWidget);
    expect(
      find.text(
        'More studios could not be loaded. Your current results are still available.',
      ),
      findsNothing,
    );
    expect(find.text('Load more studios'), findsNothing);
  }

  testWidgets('390px layout keeps load-more and retry reachable', (tester) {
    return checkLoadMoreLayout(tester, const Size(390, 844));
  });

  testWidgets('desktop layout keeps load-more and retry reachable', (tester) {
    return checkLoadMoreLayout(tester, const Size(1200, 1400));
  });
}
