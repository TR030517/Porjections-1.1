import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

Map<String, dynamic> pricing({
  String kind = 'TIMED',
  String titleMode = 'AUTO',
  int cents = 8000,
}) => {
  'kind': kind,
  'baseName': 'Body massage',
  'durationMin': kind == 'TIMED' ? 60 : null,
  'priceCents': cents,
  'titleMode': titleMode,
};

ShopPriceMenuItem item(Map<String, dynamic> metadata, {String? title}) {
  final parsed = ShopPriceMenuPricing.parse(metadata)!;
  return ShopPriceMenuItem.parse({
    'name': title ?? parsed.automaticTitle,
    'priceText': '',
    'pricing': metadata,
  })!;
}

Widget app(List<ShopPriceMenuItem> items) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: ShopPriceMenu(
          key: const ValueKey('pricing-menu'),
          groups: [ShopPriceMenuGroup(category: 'Services', items: items)],
        ),
      ),
    ),
  ),
);

void main() {
  test('strict pricing parser accepts only complete bounded numeric metadata', () {
    final timed = ShopPriceMenuPricing.parse(pricing())!;
    expect(timed.automaticTitle, r'60 min Body massage $80');
    expect(timed.badge, 'Fixed duration');
    expect(item(pricing()).pricing, isNotNull);
    for (final kind in ['PER_SESSION', 'VARIABLE', 'ADD_ON']) {
      final value = ShopPriceMenuPricing.parse(pricing(kind: kind))!;
      expect(value.durationMin, isNull);
    }
    expect(
      ShopPriceMenuPricing.parse(pricing(cents: 0))!.automaticTitle,
      r'60 min Body massage $0',
    );
    expect(
      ShopPriceMenuPricing.parse({
        ...pricing(), 'durationMin': 1440, 'priceCents': 99999999,
      })!.automaticTitle,
      r'1440 min Body massage $999999.99',
    );
    final invalid = <dynamic>[
      null, [], 'TIMED',
      {...pricing(), 'kind': 'UNKNOWN'},
      {...pricing(), 'titleMode': 'HTML'},
      {...pricing(), 'baseName': ''},
      {...pricing(), 'baseName': 'X' * 201},
      {...pricing(), 'baseName': '<b>Massage</b>'},
      {...pricing(), 'baseName': 'Massage\nnext'},
      {...pricing(), 'priceCents': null},
      {...pricing(), 'priceCents': '8000'},
      {...pricing(), 'priceCents': true},
      {...pricing(), 'priceCents': -1},
      {...pricing(), 'priceCents': 1.5},
      {...pricing(), 'priceCents': 100000000},
      {...pricing(), 'priceCents': double.nan},
      {...pricing(), 'durationMin': null},
      {...pricing(), 'durationMin': '60'},
      {...pricing(), 'durationMin': 0},
      {...pricing(), 'durationMin': 1441},
      {...pricing(), 'durationMin': 60.5},
      {...pricing(kind: 'PER_SESSION'), 'durationMin': 60},
      {...pricing(kind: 'VARIABLE')}..remove('durationMin'),
      {...pricing(), 'imageUrl': 'https://metadata.invalid/photo.jpg'},
      {...pricing(), 'legacySource': {'name': 'Old', 'priceText': 70}},
      {...pricing(), 'legacySource': {'name': 'Old', 'priceText': r'$70',
        'url': 'https://metadata.invalid'}},
    ];
    for (final value in invalid) {
      expect(ShopPriceMenuPricing.parse(value), isNull);
    }
  });

  test('invalid metadata falls back to literal legacy fields and never supplies image URLs', () {
    const literal = r' From $75 / ask the store; 30–60 min ';
    final legacy = ShopPriceMenuItem.parse({
      'name': 'Original wording', 'priceText': literal,
      'pricing': {...pricing(), 'imageUrl': 'https://metadata.invalid/photo.jpg'},
    })!;
    expect(legacy.name, 'Original wording');
    expect(legacy.priceText, literal);
    expect(legacy.pricing, isNull);
    expect(legacy.imageUrl, isNull);
    expect(ShopPriceMenuItem.parse({
      'name': 'Conflicting literal', 'priceText': literal, 'pricing': pricing(),
    })!.pricing, isNull);
    expect(ShopPriceMenuItem.parse({
      'name': 'Mismatched auto title', 'priceText': '', 'pricing': pricing(),
    })!.pricing, isNull);
    const legacyConstructor = ShopPriceMenuItem(name: 'Legacy constructor');
    expect(legacyConstructor.priceText, '');
    expect(legacyConstructor.pricing, isNull);
    final mixedConstructor = ShopPriceMenuItem(name: 'Original wording',
      priceText: literal, pricing: ShopPriceMenuPricing.parse(pricing()));
    expect(mixedConstructor.displayPricing, isNull);
  });

  test('legacy provenance keeps exact plain text but does not become a current price', () {
    final metadata = {
      ...pricing(),
      'legacySource': {'name': '  Original item  ',
        'priceText': 'Call for price / 30–60 min'},
    };
    final converted = item(metadata, title: r'60Mins Body massage $80');
    expect(converted.pricing!.legacySource!.name, '  Original item  ');
    expect(converted.pricing!.legacySource!.priceText, 'Call for price / 30–60 min');
    expect(converted.name, r'60 min Body massage $80');
    expect(converted.displayName, r'60 min Body massage $80');
    expect(item(metadata, title: r'60Mins Body massage $79').displayPricing, isNull);
    expect(converted.priceText, '');
    expect(converted.pricing!.toJson()['legacySource'], metadata['legacySource']);
  });

  testWidgets('new titles show one price and badges without creating booking controls', (tester) async {
    final items = [
      item(pricing()),
      item(pricing(kind: 'PER_SESSION')),
      item(pricing(kind: 'VARIABLE')),
      item(pricing(kind: 'ADD_ON', cents: 1050)),
    ];
    await tester.pumpWidget(app(items));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    for (final row in items) {
      expect(find.text(row.name), findsOneWidget);
    }
    for (final label in ['Fixed duration', 'Per session', 'Duration varies', 'Add-on']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('Requires a main service · Adds no appointment time'), findsOneWidget);
    expect(find.text(r'$80'), findsNothing);
    expect(find.text('Price not provided'), findsNothing);
    expect(find.byType(FilledButton), findsNothing);
    expect(find.text('Book now'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('custom titles keep exact cents and time facts and wrap on a narrow screen', (tester) async {
    tester.view.physicalSize = const Size(320, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(app([
      item(pricing(titleMode: 'CUSTOM', cents: 8850), title: 'Signature treatment'),
      item(pricing(kind: 'ADD_ON', titleMode: 'CUSTOM', cents: 0), title: 'Included extra'),
      const ShopPriceMenuItem(name: 'Legacy literal', priceText: r'From $75 / confirm with the studio'),
    ]));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    expect(find.text(r'60 min · $88.5'), findsOneWidget);
    expect(find.text(r'Add-on · +$0'), findsOneWidget);
    expect(find.text(r'From $75 / confirm with the studio'), findsOneWidget);
    final note = tester.getRect(find.text('Requires a main service · Adds no appointment time'));
    final row = tester.getRect(find.byKey(const ValueKey('price-menu-item-0-1')));
    expect(note.left, greaterThanOrEqualTo(row.left));
    expect(note.right, lessThanOrEqualTo(row.right));
    expect(tester.takeException(), isNull);
  });

  testWidgets('changing metadata resets expansion even if the manual title is unchanged', (tester) async {
    List<ShopPriceMenuItem> rows(int cents) => [
      for (var index = 0; index < 8; index++)
        item(pricing(titleMode: 'CUSTOM', cents: index == 7 ? cents : 8000),
          title: 'Manual service $index'),
    ];
    await tester.pumpWidget(app(rows(8000)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Show more services'));
    await tester.tap(find.text('Show more services'));
    await tester.pumpAndSettle();
    expect(find.text('Manual service 7'), findsOneWidget);
    await tester.pumpWidget(app(rows(8850)));
    await tester.pumpAndSettle();
    expect(find.text('Manual service 0'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    expect(find.text('Manual service 7'), findsNothing);
    expect(find.text('Showing 6 of 8 services'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
