import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/shop.dart';
import '../screens/support_screen.dart';
import '../theme/customer_theme.dart';

class ShopDirectoryNotice extends StatelessWidget {
  final ShopDetail shop;
  const ShopDirectoryNotice({super.key, required this.shop});

  void _open(BuildContext context, String topic) {
    final details = ShopSupportContext(
      shopId: shop.id,
      shopName: shop.name,
      topic: topic,
    );
    final router = GoRouter.maybeOf(context);
    if (router != null) {
      router.push(
        Uri(
          path: '/feedback',
          queryParameters: {
            'shopId': shop.id,
            'shopName': shop.name,
            'topic': topic,
          },
        ).toString(),
      );
    } else {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => SupportScreen(shopContext: details),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!shop.listingDetailsIncomplete) return const SizedBox.shrink();
    return Card(
      color: CustomerPalette.tint,
      margin: const EdgeInsets.only(bottom: 20),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Details awaiting verification',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            const Text(
              'This directory listing has incomplete location details. Online booking is unavailable. Confirm the address with the shop before visiting.',
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _open(context, 'correction'),
                  icon: const Icon(Icons.edit_location_alt_outlined),
                  label: const Text('Suggest a correction'),
                ),
                TextButton(
                  onPressed: () => _open(context, 'claim'),
                  child: const Text('Claim this shop'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
