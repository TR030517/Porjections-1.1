import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/shop_booking_choices.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

import 'shop_price_menu_lifecycle_test.dart' as lifecycle;

Map<String, dynamic> row({bool visible = true, String variant = '30'}) => {
  'id': 'row-$variant',
  'name': 'Massage $variant',
  'priceText': r'$80',
  'isVisible': visible,
  'bookingEnabled': true,
  'bookingAvailable': true,
  'booking': {'serviceId': '20', 'variantId': variant},
};

void main() {
  test(
    'visibility defaults to visible, rejects malformed flags and removes empty public groups',
    () {
      final legacy = row()..remove('isVisible');
      expect(ShopPriceMenuItem.parse(legacy)!.isVisible, isTrue);
      for (final malformed in [null, 0, 'false']) {
        expect(
          ShopPriceMenuItem.parse({...row(), 'isVisible': malformed}),
          isNull,
        );
      }
      final hidden = ShopPriceMenuItem.parse(row(visible: false))!;
      expect(hidden.isVisible, isFalse);
      expect(hidden.bookingEnabled, isTrue);
      expect(hidden.canStartBooking, isFalse);
      final groups = ShopPriceMenuGroup.parse([
        {
          'category': 'Hidden',
          'items': [row(visible: false)],
        },
        {'category': 'Empty', 'items': []},
        {
          'category': 'Mixed',
          'items': [row(visible: false), row(variant: '31')],
        },
      ]);
      expect(groups.map((group) => group.category), ['Mixed']);
      expect(groups.single.items.single.booking!.variantId, '31');
    },
  );

  test(
    'hidden exact options do not reappear as fallbacks and do not deactivate canonical services',
    () {
      final shop = ShopDetail.fromJson({
        'id': '7',
        'name': 'Synthetic studio',
        'latitude': 0,
        'longitude': 0,
        'services': [
          {
            'id': '20',
            'name': 'Massage',
            'hasVariants': true,
            'variants': [
              {
                'id': '30',
                'name': '60 minutes',
                'durationMin': 60,
                'priceCents': 8000,
                'isActive': true,
              },
              {
                'id': '31',
                'name': '90 minutes',
                'durationMin': 90,
                'priceCents': 9000,
                'isActive': true,
              },
            ],
          },
          {
            'id': '21',
            'name': 'Massage',
            'durationMin': 30,
            'priceCents': 4000,
          },
        ],
        'hiddenPriceMenuOptions': [
          {'serviceId': '20', 'variantId': '30'},
          {'serviceId': '20', 'addOnId': '99'},
          {'serviceId': '20', 'variantId': '999'},
          {'serviceId': 21},
        ],
        'priceMenu': [
          {
            'category': 'Hidden',
            'items': [row(visible: false)],
          },
        ],
      });
      expect(shop.priceMenu, isEmpty);
      expect(shop.hiddenPriceMenuOptions, hasLength(2));
      expect(
        uncoveredShopBookingChoices(shop).map((choice) => choice.identity),
        [('20', '31'), ('21', null)],
      );
      expect(shop.services.first.canBook, isTrue);
      expect(shop.services.first.activeVariants.map((variant) => variant.id), [
        '30',
        '31',
      ]);
    },
  );

  testWidgets(
    'hidden data constructed locally never renders and a queued visible activation cannot survive hiding',
    (tester) async {
      final selected = <ShopPriceMenuItem>[];
      final visible = ShopPriceMenuItem.parse(row())!;
      final hidden = ShopPriceMenuItem.parse(row(visible: false))!;
      final ValueChanged<ShopPriceMenuItem> onBook = selected.add;
      await tester.pumpWidget(lifecycle.menu([visible], onBook));
      final activate = await lifecycle.renderedActivation(tester);
      await tester.pumpWidget(lifecycle.menu([hidden], onBook));
      await tester.pumpAndSettle();
      activate();
      expect(selected, isEmpty);
      expect(find.text('Massage 30'), findsNothing);
      expect(find.text('Massage'), findsNothing);
      expect(find.byType(ShopServiceSelectionCard), findsNothing);
      expect(
        find.byKey(const ValueKey('price-menu-group-toggle-0')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
