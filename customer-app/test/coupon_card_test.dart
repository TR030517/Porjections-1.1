import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/coupon.dart';
import 'package:mjapp_client/theme/customer_theme.dart';
import 'package:mjapp_client/widgets/coupon_card.dart';

Coupon coupon({bool expiry = true}) => Coupon(
  id: '8',
  shop: const {'name': 'Synthetic shop'},
  title: 'Saved discount',
  description: 'Save on your next visit',
  type: 'FIXED_AMOUNT',
  value: 500,
  minSpendCents: 0,
  totalQuantity: 1,
  claimedCount: 1,
  usedCount: 0,
  perUserLimit: 1,
  validUntil: expiry ? DateTime(2099, 5, 3) : null,
  status: 'ACTIVE',
);

Widget page(Widget child, {String? brand}) => MaterialApp(
  theme: buildCustomerTheme(shopBrandColor: brand),
  home: Scaffold(body: child),
);

double contrast(Color foreground, Color background) =>
    (background.computeLuminance() + 0.05) /
    (foreground.computeLuminance() + 0.05);

void main() {
  testWidgets('coupon metadata keeps readable contrast in every customer palette', (tester) async {
    for (final brand in [null, 'forest', 'blue', 'rose', 'slate']) {
      final scheme = buildCustomerTheme(shopBrandColor: brand).colorScheme;
      await tester.pumpWidget(page(CouponCard(coupon: coupon(), onClaim: () {}), brand: brand));
      for (final label in ['Synthetic shop', 'Save on your next visit', 'Valid until 5/3', '0 left']) {
        final color = tester.widget<Text>(find.text(label)).style!.color!;
        expect(color, scheme.onSurfaceVariant);
        expect(contrast(color, scheme.surface), greaterThanOrEqualTo(4.5));
      }
      await tester.pumpWidget(page(CouponCard(coupon: coupon(expiry: false)), brand: brand));
      expect(tester.widget<Text>(find.text('No expiry')).style!.color, scheme.onSurfaceVariant);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('sold-out issuance blocks new claims but keeps an owned unused coupon active', (tester) async {
    final exhausted = coupon();
    var claims = 0, selections = 0;
    await tester.pumpWidget(page(CouponCard(coupon: exhausted, onClaim: () => claims++)));
    expect(tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed, isNull);
    await tester.tap(find.text('Claim'));
    expect(claims, 0);
    expect(find.text('0 left'), findsOneWidget);

    await tester.pumpWidget(page(CouponCard(
      coupon: exhausted,
      userStatus: 'UNUSED',
      onTap: () => selections++,
    )));
    expect(tester.widget<Text>(find.text('UNUSED')).style!.color, buildCustomerTheme().colorScheme.primary);
    expect(find.text('0 left'), findsNothing);
    await tester.tap(find.text('UNUSED'));
    expect(selections, 1);

    for (final status in ['USED', 'EXPIRED']) {
      await tester.pumpWidget(page(CouponCard(coupon: exhausted, userStatus: status)));
      expect(tester.widget<Text>(find.text(status)).style!.color, Colors.grey);
    }
    expect(tester.takeException(), isNull);
  });
}
