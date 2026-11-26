import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

List<ShopPriceMenuGroup> directory({int groups = 100, int items = 10}) => [
  for (var group = 0; group < groups; group++)
    ShopPriceMenuGroup(
      category: 'Group ${group + 1}',
      items: [
        for (var item = 0; item < items; item++)
          ShopPriceMenuItem(
            name: 'Service ${group + 1}-${item + 1}',
            priceText: r'From $80 / 60 min',
            imageUrl: 'https://example.test/menu/$group/$item.png',
          ),
      ],
    ),
];

Widget menuApp(List<ShopPriceMenuGroup> groups) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: ShopPriceMenu(key: const ValueKey('menu'), groups: groups),
      ),
    ),
  ),
);

Future<void> choose(WidgetTester tester, String label) async {
  final button = find.text(label).first;
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

Future<void> expandGroup(WidgetTester tester, int index) async {
  final title = find.byKey(ValueKey('price-menu-group-title-$index'));
  await tester.ensureVisible(title);
  await tester.tap(title);
  await tester.pumpAndSettle();
}

List<String> imageUrls(WidgetTester tester) => tester
    .widgetList<Image>(find.byType(Image))
    .map((widget) => (widget.image as NetworkImage).url)
    .toList();

void main() {
  testWidgets(
    'all category headers stay visible and each category expands independently',
    (tester) async {
      await tester.pumpWidget(menuApp(directory()));
      await tester.pumpAndSettle();
      expect(
        find.text('100 service groups · 1000 services'),
        findsOneWidget,
      );
      expect(find.text('Group 1'), findsOneWidget);
      expect(find.text('Group 3'), findsOneWidget);
      expect(find.text('Group 4'), findsOneWidget);
      expect(find.text('Group 100'), findsOneWidget);
      expect(find.text('Service 1-6'), findsNothing);
      expect(find.text('Service 1-7'), findsNothing);
      expect(imageUrls(tester), isEmpty);

      await expandGroup(tester, 0);
      expect(find.text('Service 1-6'), findsOneWidget);
      expect(imageUrls(tester), hasLength(6));
      await choose(tester, 'Show more services');
      expect(find.text('Service 1-10'), findsOneWidget);
      expect(imageUrls(tester), contains('https://example.test/menu/0/6.png'));
      expect(imageUrls(tester), hasLength(10));
      await choose(tester, 'Show fewer services');
      expect(find.text('Service 1-7'), findsNothing);
      expect(imageUrls(tester), hasLength(6));
      await expandGroup(tester, 1);
      expect(find.text('Service 2-1'), findsOneWidget);
      await expandGroup(tester, 2);
      expect(imageUrls(tester), hasLength(18));
      await expandGroup(tester, 0);
      expect(find.text('Service 1-1'), findsNothing);
      expect(find.text('Service 2-1'), findsOneWidget);
      expect(find.text('Service 3-1'), findsOneWidget);
      expect(imageUrls(tester), hasLength(12), reason: 'collapsing one category leaves the others expanded');
      await expandGroup(tester, 1);
      expect(imageUrls(tester), hasLength(6), reason: 'each category has independent expansion state');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('one long group reveals six more rows per action', (
    tester,
  ) async {
    await tester.pumpWidget(menuApp(directory(groups: 1, items: 25)));
    await tester.pumpAndSettle();
    expect(imageUrls(tester), isEmpty);
    await expandGroup(tester, 0);
    expect(imageUrls(tester), hasLength(6));
    await choose(tester, 'Show more services');
      expect(imageUrls(tester), hasLength(12));
    expect(find.text('Service 1-13'), findsNothing);
    await choose(tester, 'Show more services');
    expect(imageUrls(tester), hasLength(18));
    expect(find.text('Service 1-19'), findsNothing);
    expect(find.text('Showing 18 of 25 services'), findsOneWidget);
    await choose(tester, 'Show fewer services');
    expect(imageUrls(tester), hasLength(6));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'equivalent refresh preserves expansion but a changed hidden value resets it',
    (tester) async {
      var groups = directory();
      await tester.pumpWidget(menuApp(groups));
      await tester.pumpAndSettle();
      await expandGroup(tester, 0);
      await choose(tester, 'Show more services');
      await expandGroup(tester, 3);
      expect(imageUrls(tester), hasLength(16));

      groups = directory();
      await tester.pumpWidget(menuApp(groups));
      await tester.pumpAndSettle();
      expect(imageUrls(tester), hasLength(16));
      // Reuse the same outer list, replacing an item well outside the built range.
      final last = groups.last;
      groups[99] = ShopPriceMenuGroup(
        category: last.category,
        items: [
          ...last.items.take(9),
          const ShopPriceMenuItem(
            name: 'Updated hidden service',
            priceText: r'$95',
          ),
        ],
      );
      await tester.pumpWidget(menuApp(groups));
      await tester.pumpAndSettle();
      expect(find.text('100 service groups · 1000 services'), findsOneWidget);
      expect(imageUrls(tester), isEmpty);
      expect(find.text('Group 4'), findsOneWidget);
      expect(find.text('Group 100'), findsOneWidget);
      expect(find.text('Service 1-7'), findsNothing);
      expect(find.text('Updated hidden service'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'small menus retain literal prices and omit empty promotion categories without booking actions',
    (tester) async {
      await tester.pumpWidget(
        menuApp(const [
          ShopPriceMenuGroup(category: 'Buy five, enjoy one free', items: []),
          ShopPriceMenuGroup(
            category: 'Body massage',
            items: [
              ShopPriceMenuItem(
                name: 'Signature massage',
                priceText: r' From $80 / 60 min ',
              ),
            ],
          ),
        ]),
      );
      await tester.pumpAndSettle();
      expect(find.text('Buy five, enjoy one free'), findsNothing);
      await expandGroup(tester, 0);
      expect(find.text(r' From $80 / 60 min '), findsOneWidget);
      expect(find.text('1 service group · 1 service'), findsOneWidget);
      expect(find.text('Show more services'), findsNothing);
      expect(find.text('Show more groups'), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.text('Book now'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('narrow screens wrap long price wording below the item details', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const price =
        r'From $80 per person / confirm the available duration and options with the studio';
    await tester.pumpWidget(
      menuApp(const [
        ShopPriceMenuGroup(
          category: 'Services',
          items: [
            ShopPriceMenuItem(
              name: 'A longer signature massage and wellness experience',
              priceText: price,
              imageUrl: 'https://example.test/menu/long.png',
            ),
          ],
        ),
      ]),
    );
    await tester.pumpAndSettle();
    await expandGroup(tester, 0);
    final priceRect = tester.getRect(find.text(price));
    final itemRect = tester.getRect(
      find.byKey(const ValueKey('price-menu-item-0-0')),
    );
    expect(priceRect.left, greaterThanOrEqualTo(itemRect.left));
    expect(priceRect.right, lessThanOrEqualTo(itemRect.right));
    expect(priceRect.height, greaterThan(30));
    expect(tester.takeException(), isNull);
  });
}
