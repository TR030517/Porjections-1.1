import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

ShopPriceMenuItem option({
  String id = 'menu-1',
  String service = '20',
  String variant = '30',
  bool available = true,
}) => ShopPriceMenuItem.parse({
  'id': id,
  'name': 'Massage option $variant',
  'priceText': r'$80',
  'bookingEnabled': true,
  'bookingAvailable': available,
  'booking': {'serviceId': service, 'variantId': variant},
})!;

Widget menu(
  List<ShopPriceMenuItem> items,
  ValueChanged<ShopPriceMenuItem>? onBook,
) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: ShopPriceMenu(
        groups: [ShopPriceMenuGroup(category: 'Massage', items: items)],
        onBook: onBook,
      ),
    ),
  ),
);

Future<VoidCallback> renderedActivation(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
  await tester.pumpAndSettle();
  final semantics = find.descendant(
    of: find.byKey(const ValueKey('price-menu-book-0-0')),
    matching: find.byWidgetPredicate(
      (widget) => widget is Semantics && widget.properties.onTap != null,
    ),
  );
  return tester.widget<Semantics>(semantics).properties.onTap!;
}

void main() {
  testWidgets(
    'a queued price-row activation is discarded when the shop closes booking',
    (tester) async {
      final selected = <ShopPriceMenuItem>[];
      final item = option();
      final ValueChanged<ShopPriceMenuItem> onBook = selected.add;
      await tester.pumpWidget(menu([item], onBook));
      final activate = await renderedActivation(tester);

      await tester.pumpWidget(menu([item], null));
      expect(activate, returnsNormally);
      expect(selected, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  for (final replacement in [
    <ShopPriceMenuItem>[],
    [option(available: false)],
    [option(id: 'menu-2', service: '21', variant: '31')],
  ]) {
    testWidgets(
      'a queued price-row activation cannot use removed, paused or replaced data: '
      '${replacement.isEmpty
          ? 'removed'
          : replacement.single.bookingAvailable == false
          ? 'paused'
          : 'replaced'}',
      (tester) async {
        final selected = <ShopPriceMenuItem>[];
        final ValueChanged<ShopPriceMenuItem> onBook = selected.add;
        await tester.pumpWidget(menu([option()], onBook));
        final activate = await renderedActivation(tester);

        await tester.pumpWidget(menu(replacement, onBook));
        activate();
        expect(selected, isEmpty);
        expect(tester.takeException(), isNull);

        if (replacement.isNotEmpty && replacement.single.canStartBooking) {
          await tester.tap(
            find.byKey(const ValueKey('price-menu-group-toggle-0')),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text(replacement.single.name));
          expect(selected.single.booking?.serviceId, '21');
          expect(selected.single.booking?.variantId, '31');
        }
      },
    );
  }

  testWidgets(
    'a queued row activation cannot borrow a replacement shop booking handler',
    (tester) async {
      final original = <ShopPriceMenuItem>[];
      final replacement = <ShopPriceMenuItem>[];
      final item = option();
      await tester.pumpWidget(menu([item], original.add));
      final activate = await renderedActivation(tester);

      await tester.pumpWidget(menu([item], replacement.add));
      activate();
      expect(original, isEmpty);
      expect(replacement, isEmpty);
      await tester.tap(find.text(item.name));
      expect(replacement.single.booking?.serviceId, '20');
      expect(replacement.single.booking?.variantId, '30');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('equivalent menu refresh keeps the current exact activation', (
    tester,
  ) async {
    final selected = <ShopPriceMenuItem>[];
    final ValueChanged<ShopPriceMenuItem> onBook = selected.add;
    await tester.pumpWidget(menu([option()], onBook));
    final activate = await renderedActivation(tester);
    await tester.pumpWidget(menu([option()], onBook));

    activate();
    expect(selected.single.booking?.serviceId, '20');
    expect(selected.single.booking?.variantId, '30');
    expect(tester.takeException(), isNull);
  });

  testWidgets('a removed menu cannot activate a queued accessibility action', (
    tester,
  ) async {
    final selected = <ShopPriceMenuItem>[];
    await tester.pumpWidget(menu([option()], selected.add));
    final activate = await renderedActivation(tester);
    await tester.pumpWidget(const SizedBox.shrink());

    activate();
    expect(selected, isEmpty);
    expect(tester.takeException(), isNull);
  });
}
