import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/providers/banner_provider.dart';
import 'package:mjapp_client/providers/booking_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/providers/review_provider.dart';
import 'package:mjapp_client/providers/shop_provider.dart';
import 'package:mjapp_client/screens/booking_screen.dart';
import 'package:mjapp_client/screens/shop_detail_screen.dart';
import 'package:mjapp_client/screens/shop_list_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/theme/customer_theme.dart';

class ResponsiveShops extends ShopRepository {
  final int count;
  ResponsiveShops(this.count) : super(ApiService());

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
    'items': List.generate(
      count,
      (i) => {'id': '$i', 'name': 'Shop $i', 'latitude': 0, 'longitude': 0},
    ),
    'total': count,
  });
}

const lightPhotoUrl = 'https://images.example.invalid/responsive-test.png';

ShopDetail detailFixture({bool withImage = false}) => ShopDetail.fromJson({
  'id': '7',
  'name': 'Test shop',
  'latitude': 0,
  'longitude': 0,
  'avgRating': 4.8,
  'reviewCount': 12,
  'images': [
    if (withImage) {'id': 'photo', 'imageUrl': lightPhotoUrl},
  ],
  'services': [
    for (final name in ['Service A', 'Service B', 'Service C'])
      {'id': name, 'name': name, 'durationMin': 60, 'priceCents': 6000},
  ],
});

MaterialApp localizedApp(Widget home) => MaterialApp(
  theme: buildCustomerTheme(),
  locale: const Locale('zh'),
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: home,
);

void setViewport(WidgetTester tester, double width) {
  tester.view.physicalSize = Size(width, 1000);
  tester.view.devicePixelRatio = 1;
}

void resetViewportAfterTest(WidgetTester tester) {
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Finder shopCard(int index) => find
    .ancestor(of: find.text('Shop $index').last, matching: find.byType(Card))
    .first;

void main() {
  testWidgets(
    'shop results use readable columns across phone, tablet and desktop, including a single result',
    (tester) async {
      resetViewportAfterTest(tester);
      for (final width in [375.0, 800.0, 1280.0]) {
        setViewport(tester, width);
        await tester.pumpWidget(
          ProviderScope(
            key: UniqueKey(),
            overrides: [
              shopRepositoryProvider.overrideWith((ref) => ResponsiveShops(3)),
              bannersProvider.overrideWith((ref) async => []),
              favoritesProvider.overrideWith(
                (ref) => FavoritesNotifier(ApiService()),
              ),
            ],
            child: localizedApp(const Scaffold(body: ShopListScreen())),
          ),
        );
        await tester.pumpAndSettle();
        final first = tester.getRect(shopCard(0));
        final second = tester.getRect(shopCard(1));
        expect(first.left, greaterThanOrEqualTo(16));
        expect(first.right, lessThanOrEqualTo(width - 16));
        if (width == 375) {
          expect(first.width, closeTo(343, 1));
          expect(second.left, first.left);
          expect(second.top, greaterThanOrEqualTo(first.bottom));
        } else {
          expect(second.top, first.top);
          expect(second.left, greaterThan(first.right));
          final third = tester.getRect(shopCard(2));
          if (width == 800) {
            expect(third.top, greaterThanOrEqualTo(first.bottom));
            expect(first.width, inInclusiveRange(350, 390));
          } else {
            expect(third.top, first.top);
            expect(third.left, greaterThan(second.right));
            expect(first.width, inInclusiveRange(350, 400));
          }
        }
        expect(find.byTooltip('收藏门店'), findsWidgets);
        expect(tester.takeException(), isNull);
      }

      // A sparse desktop result must retain a card-sized image and reading
      // width, rather than expanding to the entire results surface.
      await tester.pumpWidget(
        ProviderScope(
          key: UniqueKey(),
          overrides: [
            shopRepositoryProvider.overrideWith((ref) => ResponsiveShops(1)),
            bannersProvider.overrideWith((ref) async => []),
            favoritesProvider.overrideWith(
              (ref) => FavoritesNotifier(ApiService()),
            ),
          ],
          child: localizedApp(const Scaffold(body: ShopListScreen())),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.getSize(shopCard(0)).width, inInclusiveRange(350, 400));
      final search = tester.getRect(find.byType(TextField));
      final searchAction = tester.getRect(
        find.widgetWithText(FilledButton, 'Search'),
      );
      expect(search.left, greaterThanOrEqualTo(40));
      expect(search.right, lessThan(searchAction.left));
      expect(searchAction.right, lessThanOrEqualTo(1240));
      expect(search.width, lessThanOrEqualTo(1200));
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'detail keeps its name, rating and readable actions with a light photo or no photos on desktop and phone',
    (tester) async {
      resetViewportAfterTest(tester);
      // Seed a real bright image in Flutter's cache: this exercises the photo
      // branch without network requests and catches white-on-light controls.
      final photo = await tester.runAsync(() async {
        final recorder = ui.PictureRecorder();
        ui.Canvas(recorder).drawColor(Colors.white, ui.BlendMode.src);
        final picture = recorder.endRecording();
        final image = await picture.toImage(20, 20);
        picture.dispose();
        return image;
      });
      PaintingBinding.instance.imageCache.putIfAbsent(
        const NetworkImage(lightPhotoUrl),
        () => OneFrameImageStreamCompleter(
          Future.value(ImageInfo(image: photo!)),
        ),
      );
      addTearDown(PaintingBinding.instance.imageCache.clear);
      for (final scenario in [
        (width: 1280.0, withImage: false),
        (width: 375.0, withImage: false),
        (width: 1280.0, withImage: true),
        (width: 375.0, withImage: true),
      ]) {
        final width = scenario.width;
        setViewport(tester, width);
        await tester.pumpWidget(
          ProviderScope(
            key: UniqueKey(),
            overrides: [
              shopDetailProvider('7').overrideWith(
                (ref) async => detailFixture(withImage: scenario.withImage),
              ),
              shopReviewsProvider('7').overrideWith((ref) async => []),
              favoritesProvider.overrideWith(
                (ref) => FavoritesNotifier(ApiService()),
              ),
            ],
            child: localizedApp(
              const ShopDetailScreen(shopId: '7', shopName: 'Test shop'),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final content = tester.getRect(find.byType(SingleChildScrollView));
        final action = tester.getRect(
          find.widgetWithText(FilledButton, '立即预约'),
        );
        expect(content.center.dx, closeTo(width / 2, 1));
        expect(action.left, greaterThanOrEqualTo(16));
        expect(action.right, lessThanOrEqualTo(width - 16));
        expect(action.height, greaterThanOrEqualTo(46));
        if (width == 1280) {
          expect(action.left, greaterThan(width / 2));
          expect(action.width, inInclusiveRange(180, 300));
        } else {
          expect(action.bottom, lessThanOrEqualTo(1000));
          expect(action.width, greaterThanOrEqualTo(160));
        }
        expect(find.byTooltip('收藏门店'), findsOneWidget);
        expect(find.byTooltip('复制门店信息'), findsOneWidget);
        final bodyName = find.descendant(
          of: find.byType(SingleChildScrollView),
          matching: find.text('Test shop'),
        );
        expect(bodyName, findsOneWidget);
        expect(tester.getRect(bodyName).top, greaterThanOrEqualTo(0));
        expect(tester.getRect(bodyName).bottom, lessThan(action.top));
        expect(find.text('4.8'), findsOneWidget);
        expect(find.text('12 reviews'), findsOneWidget);
        if (scenario.withImage) {
          expect(
            tester.widget<RawImage>(find.byType(RawImage)).image,
            isNotNull,
          );
        }
        for (final label in ['收藏门店', '复制门店信息']) {
          final button = find
              .ancestor(
                of: find.byTooltip(label),
                matching: find.byType(IconButton),
              )
              .first;
          if (label == '复制门店信息') {
            // The native test harness has a file:// origin and no canonical
            // public link. Sharing must stay disabled instead of inventing one.
            expect(tester.widget<IconButton>(button).onPressed, isNull);
            continue;
          }
          expect(tester.widget<IconButton>(button).onPressed, isNotNull);
          final background = tester
              .widget<Material>(
                find
                    .descendant(of: button, matching: find.byType(Material))
                    .first,
              )
              .color!;
          final foreground = tester
              .widget<Icon>(
                find.descendant(of: button, matching: find.byType(Icon)).first,
              )
              .color!;
          final light = background.computeLuminance();
          final dark = foreground.computeLuminance();
          final contrast = (light > dark)
              ? (light + 0.05) / (dark + 0.05)
              : (dark + 0.05) / (light + 0.05);
          expect(background.a, 1);
          expect(contrast, greaterThanOrEqualTo(3));
        }
        if (width == 1280) {
          // Toolbar controls live outside the narrow hero on desktop, so
          // they need a solid surface and a readable foreground.
          final toolbar = tester.widget<AppBar>(find.byType(AppBar));
          expect(toolbar.backgroundColor, isNot(Colors.transparent));
          expect(toolbar.iconTheme?.color, isNot(Colors.white));
        }
        expect(tester.takeException(), isNull);
      }
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'wizard keeps desktop choices compact and its next action reachable on a phone',
    (tester) async {
      resetViewportAfterTest(tester);
      for (final width in [1280.0, 375.0]) {
        setViewport(tester, width);
        final flow = BookingFlowNotifier(BookingRepository(ApiService()));
        await tester.pumpWidget(
          ProviderScope(
            key: UniqueKey(),
            overrides: [bookingFlowProvider.overrideWith((ref) => flow)],
            child: localizedApp(BookingScreen(shop: detailFixture())),
          ),
        );
        await tester.pumpAndSettle();
        final first = tester.getRect(find.text('Service A'));
        final second = tester.getRect(find.text('Service B'));
        final third = tester.getRect(find.text('Service C'));
        if (width == 1280) {
          expect(first.center.dy, second.center.dy);
          expect(third.center.dy, first.center.dy);
        } else {
          expect(second.top, greaterThan(first.bottom));
          expect(third.top, greaterThan(second.bottom));
        }
        final choices = tester.getRect(find.byType(GridView));
        final action = tester.getRect(find.byType(FilledButton));
        expect(choices.left, greaterThanOrEqualTo(12));
        expect(choices.right, lessThanOrEqualTo(width - 12));
        expect(choices.width, lessThanOrEqualTo(840));
        if (width == 1280) {
          expect(choices.center.dx, lessThan(width / 2));
          expect(find.text('预约摘要'), findsWidgets);
        } else {
          expect(choices.center.dx, closeTo(width / 2, 1));
        }
        expect(action.left, greaterThanOrEqualTo(12));
        expect(action.right, lessThanOrEqualTo(width - 12));
        expect(action.width, greaterThanOrEqualTo(160));
        expect(action.bottom, lessThanOrEqualTo(1000));
        await tester.tap(find.text('Service A'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('选择技师 →'));
        await tester.pumpAndSettle();
        expect(flow.state.selectedService?.name, 'Service A');
        expect(find.text('不指定技师'), findsWidgets);
        expect(find.text('选择日期与时间 →'), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    },
  );
}
