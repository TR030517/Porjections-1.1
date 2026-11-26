import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/shop.dart';
import '../models/shop_contacts.dart';
import '../theme/customer_theme.dart';
import 'shop_location_map_stub.dart'
    if (dart.library.js_interop) 'shop_location_map_web.dart' as platform;

/// Accept only Google's generated embed URL, never arbitrary stored iframe HTML.
Uri? _configuredEmbed(Object? value) {
  final text = publicContactText(value, 4096);
  final uri = text == null ? null : Uri.tryParse(text);
  if (uri == null ||
      uri.scheme != 'https' ||
      !const {'www.google.com', 'maps.google.com'}.contains(uri.host) ||
      uri.userInfo.isNotEmpty ||
      uri.port != 443 ||
      uri.hasFragment ||
      !const {'/maps/embed', '/maps/embed/'}.contains(uri.path) ||
      (uri.queryParameters['pb']?.isNotEmpty != true)) {
    return null;
  }
  return uri.replace(queryParameters: {...uri.queryParameters, 'hl': 'en'});
}

/// Search by the public street address; imported compatibility coordinates can
/// be a city centre and must not become a fabricated shop pin.
Uri? _addressEmbed(ShopDetail shop) {
  final destination = publicShopMapUri(
    address: shop.address,
    city: shop.city,
    state: shop.state,
    zipCode: shop.zipCode,
  );
  final query = destination?.queryParameters['query'];
  if (query == null || query.isEmpty) return null;
  return Uri.https('www.google.com', '/maps', {
    'q': query,
    'output': 'embed',
    'hl': 'en',
  });
}

class ShopLocationMap extends StatefulWidget {
  final ShopDetail shop;
  const ShopLocationMap({super.key, required this.shop});

  @override
  State<ShopLocationMap> createState() => _ShopLocationMapState();
}

class _ShopLocationMapState extends State<ShopLocationMap> {
  bool _interactive = false;

  @override
  void didUpdateWidget(covariant ShopLocationMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shop.id != widget.shop.id ||
        oldWidget.shop.mapShareUrl != widget.shop.mapShareUrl ||
        oldWidget.shop.address != widget.shop.address ||
        oldWidget.shop.city != widget.shop.city ||
        oldWidget.shop.state != widget.shop.state ||
        oldWidget.shop.zipCode != widget.shop.zipCode) {
      _interactive = false;
    }
  }

  Future<void> _openMap(Uri uri) async {
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Unable to open Google Maps. You can use the address above.'),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final shop = widget.shop;
    final address = publicShopAddress(
      address: shop.address,
      city: shop.city,
      state: shop.state,
      zipCode: shop.zipCode,
    );
    final configured = _configuredEmbed(shop.mapShareUrl);
    final embed = configured ?? _addressEmbed(shop);
    final destination = publicShopMapUri(
          address: shop.address,
          city: shop.city,
          state: shop.state,
          zipCode: shop.zipCode,
        ) ??
        configured;
    final accent = Theme.of(context).colorScheme.primary;
    final border = CustomerPalette.shopBorder(shop.brandColor);

    return Container(
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: CustomerPalette.surface,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(20),
      ),
      child: LayoutBuilder(builder: (context, constraints) {
        final compact = constraints.maxWidth < 650;
        final actions = Wrap(
          spacing: 10,
          runSpacing: 8,
          children: [
            if (embed != null && platform.supportsShopMapEmbed)
              OutlinedButton.icon(
                onPressed: () => setState(() => _interactive = !_interactive),
                icon: Icon(_interactive ? Icons.check : Icons.touch_app_outlined,
                    size: 17),
                label: Text(_interactive ? 'Done exploring' : 'Explore map'),
              ),
            if (destination != null)
              TextButton.icon(
                onPressed: () => _openMap(destination),
                icon: const Icon(Icons.open_in_new, size: 17),
                label: const Text('Open in Google Maps'),
              ),
          ],
        );
        final heading = Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: accent.withValues(alpha: .08),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(Icons.map_outlined, color: accent, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Find us', style: TextStyle(
                    color: CustomerPalette.ink,
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  )),
                  if (address.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    SelectableText(address, style: const TextStyle(
                      color: CustomerPalette.muted,
                      fontSize: 14,
                      height: 1.5,
                    )),
                  ],
                ],
              ),
            ),
          ],
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: EdgeInsets.all(compact ? 20 : 26),
              child: compact
                  ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      heading,
                      if (destination != null || embed != null) ...[
                        const SizedBox(height: 14),
                        actions,
                      ],
                    ])
                  : Row(children: [
                      Expanded(child: heading),
                      const SizedBox(width: 20),
                      actions,
                    ]),
            ),
            if (embed != null)
              Container(
                decoration: BoxDecoration(border: Border(top: BorderSide(color: border))),
                height: compact ? 300 : 400,
                width: double.infinity,
                child: platform.ShopMapFrame(
                  key: ValueKey('${shop.id}:$embed'),
                  uri: embed,
                  title: 'Google Maps location for ${shop.name}',
                  interactive: _interactive,
                ),
              )
            else
              Padding(
                padding: EdgeInsets.fromLTRB(compact ? 20 : 26, 0,
                    compact ? 20 : 26, compact ? 20 : 26),
                child: const Text(
                  'The shop has not added a complete address yet.',
                  style: TextStyle(color: CustomerPalette.muted, height: 1.5),
                ),
              ),
          ],
        );
      }),
    );
  }
}
