import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../screens/shop_detail_screen.dart';
import '../screens/home_screen.dart';
import 'customer_routes.dart';

void openCustomerShop(
  BuildContext context, {
  required String shopId,
  String shopName = '',
  String? canonicalPath,
}) {
  final router = GoRouter.maybeOf(context);
  if (router != null) {
    router.push(
      safeCanonicalShopPath(canonicalPath) ??
          '/shops/${Uri.encodeComponent(shopId)}',
    );
  } else {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ShopDetailScreen(shopId: shopId, shopName: shopName),
      ),
    );
  }
}

void openCustomerHome(BuildContext context, {int initialTab = 0}) {
  final tab = initialTab.clamp(0, 3);
  final router = GoRouter.maybeOf(context);
  if (router != null) {
    // Native detail/dialog routes are not part of GoRouter's match list. Going
    // to the same home URI alone leaves those routes covering the home page.
    Navigator.of(
      context,
    ).popUntil((route) => route.settings is Page || route.isFirst);
    router.go(tab == 0 ? '/' : '/?tab=$tab');
  } else {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) => HomeScreen(initialTab: tab.toInt()),
      ),
      (_) => false,
    );
  }
}
