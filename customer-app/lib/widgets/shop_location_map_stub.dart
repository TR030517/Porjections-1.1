import 'package:flutter/material.dart';

import '../theme/customer_theme.dart';

const supportsShopMapEmbed = false;

/// Native apps keep the same location card and use its external Maps action.
class ShopMapFrame extends StatelessWidget {
  final Uri uri;
  final String title;
  final bool interactive;
  const ShopMapFrame({
    super.key,
    required this.uri,
    required this.title,
    required this.interactive,
  });

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: CustomerPalette.shopTint(null, opacity: .04),
    child: const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.location_on_outlined, size: 40,
                color: CustomerPalette.action),
            SizedBox(height: 12),
            Text('View this location in Google Maps.',
                textAlign: TextAlign.center,
                style: TextStyle(color: CustomerPalette.muted, height: 1.5)),
          ],
        ),
      ),
    ),
  );
}
