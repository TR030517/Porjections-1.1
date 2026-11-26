import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../models/shop.dart';
import '../navigation/customer_routes.dart';
import '../providers/shop_provider.dart';
import '../theme/customer_theme.dart';
import 'shop_detail_screen.dart';

class ShopLinkScreen extends ConsumerStatefulWidget {
  final Uri uri;
  const ShopLinkScreen({super.key, required this.uri});
  @override
  ConsumerState<ShopLinkScreen> createState() => _ShopLinkScreenState();
}

class _ShopLinkScreenState extends ConsumerState<ShopLinkScreen> {
  Future<ShopDetail>? _shop;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(ShopLinkScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.uri != widget.uri) _load();
  }

  void _load() {
    final entry = CustomerShopEntry.fromUri(widget.uri);
    final repository = ref.read(shopRepositoryProvider);
    _shop = entry == null
        ? null
        : entry.currentId != null
        ? repository.getShopDetail(entry.currentId!)
        : repository.resolveShop(
            shortName: entry.shortName,
            legacyId: entry.legacyId,
          );
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<ShopDetail>(
    future: _shop,
    builder: (context, snapshot) {
      final shop = snapshot.data;
      if (shop != null &&
          snapshot.connectionState == ConnectionState.done &&
          !snapshot.hasError) {
        final query = widget.uri.queryParametersAll;
        final requested = query.containsKey('serviceId') || query.containsKey('variantId');
        String? singleId(String key) {
          final values = query[key];
          if (values == null || values.length != 1 || !RegExp(r'^[1-9]\d{0,18}$').hasMatch(values.single)) return null;
          final parsed = BigInt.tryParse(values.single);
          if (parsed == null || parsed > BigInt.parse('9223372036854775807')) return null;
          return values.single;
        }
        final serviceId = requested ? singleId('serviceId') : null;
        final hasVariant = query.containsKey('variantId');
        final variantId = hasVariant ? singleId('variantId') : null;
        final invalid = requested && (serviceId == null || hasVariant && variantId == null);
        return ShopDetailScreen(
          key: ValueKey(shop.id),
          shopId: shop.id,
          shopName: shop.name,
          initialServiceId: serviceId,
          initialVariantId: variantId,
          invalidBookingLink: invalid,
        );
      }
      final loading =
          _shop != null && snapshot.connectionState != ConnectionState.done;
      final error = snapshot.error;
      final unavailable =
          _shop == null ||
          error is DioException &&
              const {400, 403, 404, 410}.contains(error.response?.statusCode);
      return Scaffold(
        backgroundColor: CustomerPalette.background,
        appBar: AppBar(title: const CustomerBrand(compact: true)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: loading
                  ? const CircularProgressIndicator()
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.storefront_outlined,
                          size: 44,
                          color: CustomerPalette.muted,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          customerText(
                            context,
                            unavailable
                                ? 'Shop unavailable'
                                : 'Unable to load this shop',
                            unavailable ? '门店暂不可用' : '门店加载失败',
                          ),
                          style: Theme.of(context).textTheme.titleLarge,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          customerText(
                            context,
                            unavailable
                                ? 'This link is unknown or the shop is not publicly available. No other shop has been selected.'
                                : 'Check your connection and try again.',
                            unavailable
                                ? '该链接无效或门店尚未公开。系统不会跳转到其他门店。'
                                : '请检查网络连接后重试。',
                          ),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: CustomerPalette.muted,
                            height: 1.6,
                          ),
                        ),
                        const SizedBox(height: 24),
                        if (!unavailable)
                          OutlinedButton.icon(
                            onPressed: () => setState(_load),
                            icon: const Icon(Icons.refresh),
                            label: Text(
                              customerText(context, 'Try again', '重新加载'),
                            ),
                          ),
                        TextButton(
                          onPressed: () => context.go('/'),
                          child: Text(
                            customerText(
                              context,
                              'Browse public shops',
                              '浏览公开门店',
                            ),
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      );
    },
  );
}
