import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/banner_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/shop_list_screen.dart';
import 'package:mjapp_client/services/api_service.dart';

class LocalShops extends ShopRepository {
  LocalShops() : super(ApiService());

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
  }) async => ShopListResponse.fromJson({
    'items': [
      {'id': '7', 'name': 'Test shop', 'latitude': 0, 'longitude': 0},
    ],
    'total': 1,
  });
}

class AuthenticatedCustomer extends AuthNotifier {
  AuthenticatedCustomer() : super(ApiService()) {
    state = AuthState(
      isLoggedIn: true,
      user: User(id: '42', role: 'CUSTOMER'),
    );
  }
}

class LocalFavorites extends FavoritesNotifier {
  final toggledShops = <String>[];
  LocalFavorites() : super(ApiService());

  @override
  Future<bool> toggle(String shopId) async {
    toggledShops.add(shopId);
    if (state.contains(shopId)) {
      remove(shopId);
      return false;
    }
    add(shopId);
    return true;
  }
}

void main() {
  testWidgets(
    'signed-in favorites remain actionable and an absent canonical share link stays disabled',
    (tester) async {
      tester.view.physicalSize = const Size(375, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final semantics = tester.ensureSemantics();
      try {
        final favorites = LocalFavorites();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authProvider.overrideWith((ref) => AuthenticatedCustomer()),
              shopRepositoryProvider.overrideWith((ref) => LocalShops()),
              bannersProvider.overrideWith((ref) async => []),
              favoritesProvider.overrideWith((ref) => favorites),
              shopDetailProvider('7').overrideWith(
                (ref) async => ShopDetail.fromJson({
                  'id': '7',
                  'name': 'Test shop',
                  'latitude': 0,
                  'longitude': 0,
                  'avgRating': 4.7,
                  'reviewCount': 3,
                }),
              ),
              shopReviewsProvider('7').overrideWith((ref) async => []),
            ],
            child: MaterialApp(
              locale: const Locale('zh'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const Scaffold(body: ShopListScreen()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.bySemanticsLabel('收藏门店'), findsOneWidget);
        expect(
          tester
              .getSemantics(find.byTooltip('收藏门店'))
              .getSemanticsData()
              .hasAction(SemanticsAction.tap),
          isTrue,
        );
        await tester.tap(find.byTooltip('收藏门店'));
        await tester.pumpAndSettle();
        expect(favorites.toggledShops, ['7']);
        expect(find.bySemanticsLabel('取消收藏'), findsOneWidget);

        await tester.tap(find.text('Test shop').last);
        await tester.pumpAndSettle();
        expect(find.text('Test shop'), findsOneWidget);
        expect(find.text('4.7'), findsOneWidget);
        expect(find.text('3 reviews'), findsOneWidget);
        expect(find.bySemanticsLabel('取消收藏'), findsOneWidget);
        expect(find.bySemanticsLabel('复制门店信息'), findsOneWidget);
        expect(
          tester
              .getSemantics(find.byTooltip('复制门店信息'))
              .getSemanticsData()
              .hasAction(SemanticsAction.tap),
          isFalse,
        );
        await tester.tap(find.byTooltip('取消收藏'));
        await tester.pumpAndSettle();
        expect(favorites.toggledShops, ['7', '7']);
        expect(find.bySemanticsLabel('收藏门店'), findsOneWidget);
        expect(favorites.state, isEmpty);
        final backLabel = MaterialLocalizations.of(
          tester.element(find.byType(BackButton)),
        ).backButtonTooltip;
        expect(
          tester
              .getSemantics(find.byTooltip(backLabel))
              .getSemanticsData()
              .hasAction(SemanticsAction.tap),
          isTrue,
        );
        await tester.tap(find.byTooltip(backLabel));
        await tester.pumpAndSettle();
        expect(find.byType(ShopListScreen), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      } finally {
        semantics.dispose();
      }
    },
  );
}
