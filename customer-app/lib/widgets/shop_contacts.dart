import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/shop.dart';
import '../models/shop_contacts.dart';
import '../theme/customer_theme.dart';

/// Shared by the one detail screen reached through short links and current IDs.
/// Link callbacks run exclusively after an explicit contact/map button click.
class ShopContacts extends StatelessWidget {
  final ShopDetail shop;
  final Future<bool> Function(Uri uri)? openLink;
  const ShopContacts({super.key, required this.shop, this.openLink});

  Future<void> _open(BuildContext context, Uri uri, bool map) async {
    var opened = false;
    try {
      opened = await (openLink?.call(uri) ??
          launchUrl(uri, mode: LaunchMode.externalApplication));
    } catch (_) {
      opened = false;
    }
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(customerText(
          context,
          map
              ? 'Unable to open Google Maps. You can copy the address.'
              : 'Unable to open this contact. You can copy the details.',
          map ? '无法打开地图，可复制门店地址。' : '无法打开此联系方式，可复制下方资料。',
        )),
      ));
    }
  }

  Future<void> _copy(BuildContext context, String value) async {
    try {
      await Clipboard.setData(ClipboardData(text: value));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(customerText(context, 'Copied.', '已复制。'))));
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(customerText(context,
                'Unable to copy. Select and copy the details.', '无法复制，请选中资料后复制。'))));
      }
    }
  }

  Widget _action(BuildContext context, {
    required String label,
    required IconData icon,
    required VoidCallback onPressed,
    required String tooltip,
  }) {
    final accent = Theme.of(context).colorScheme.primary;
    return Tooltip(
      message: tooltip,
      child: TextButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 15),
        label: Text(label),
        style: TextButton.styleFrom(
          foregroundColor: accent,
          backgroundColor: accent.withValues(alpha: .07),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
          minimumSize: const Size(0, 36),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          shape: const StadiumBorder(),
        ),
      ),
    );
  }

  Widget _copyAction(BuildContext context, String value, String tooltip) =>
      IconButton(
        tooltip: tooltip,
        onPressed: () => _copy(context, value),
        icon: const Icon(Icons.copy_outlined, size: 16),
        style: IconButton.styleFrom(
          foregroundColor: CustomerPalette.muted,
          backgroundColor: CustomerPalette.muted.withValues(alpha: .06),
          minimumSize: const Size(36, 36),
          padding: const EdgeInsets.all(9),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          shape: const CircleBorder(),
        ),
      );

  Widget _line(BuildContext context, String value, Uri target, bool email) =>
      LayoutBuilder(builder: (context, constraints) {
        final details = SelectableText(value,
            style: const TextStyle(color: CustomerPalette.ink,
                fontSize: 14, height: 1.5, fontWeight: FontWeight.w500));
        final action = _action(context,
          label: customerText(context, email ? 'Email' : 'Call', email ? '发邮件' : '致电'),
          icon: email ? Icons.mail_outline_rounded : Icons.call_outlined,
          tooltip: customerText(context, email ? 'Email $value' : 'Call $value',
              email ? '发送邮件至 $value' : '拨打 $value'),
          onPressed: () => _open(context, target, false),
        );
        final copy = _copyAction(context, value,
          customerText(context, email ? 'Copy email $value' : 'Copy phone $value',
              email ? '复制邮箱 $value' : '复制电话 $value'));
        if (constraints.maxWidth < 240) {
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            details,
            const SizedBox(height: 7),
            Wrap(spacing: 5, runSpacing: 5,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [action, copy]),
          ]);
        }
        return Row(mainAxisSize: MainAxisSize.min, children: [
          Flexible(fit: FlexFit.loose, child: details),
          const SizedBox(width: 8),
          action,
          const SizedBox(width: 5),
          copy,
        ]);
      });

  Widget _group(BuildContext context, IconData icon, String label, Widget child) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primary.withValues(alpha: .08),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, size: 18,
                color: Theme.of(context).colorScheme.primary),
          ),
          const SizedBox(width: 11),
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(
                  color: CustomerPalette.muted, fontSize: 11,
                  fontWeight: FontWeight.w600, letterSpacing: .35)),
              const SizedBox(height: 7),
              child,
            ],
          )),
        ],
      );

  @override
  Widget build(BuildContext context) {
    // Validate again for manually constructed models; a malformed value never
    // becomes a platform URL merely because it reached a widget.
    final phones = shop.phones.where((value) => publicPhoneUri(value) != null).toList();
    final emails = shop.emails.where((value) => publicEmailUri(value) != null).toList();
    final externalLinks = publicShopExternalLinks(shop.externalLinks);
    final address = publicShopAddress(address: shop.address, city: shop.city,
        state: shop.state, zipCode: shop.zipCode);
    final map = publicShopMapUri(address: shop.address, city: shop.city,
        state: shop.state, zipCode: shop.zipCode);
    final sections = <Widget>[
        _group(context, Icons.location_on_outlined,
            customerText(context, 'Location', '门店地址'),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SelectableText(
                address.isNotEmpty ? address : customerText(context,
                    'Address has not been added.', '门店地址待补充。'),
                style: const TextStyle(
                    color: CustomerPalette.ink, fontSize: 14, height: 1.6,
                    fontWeight: FontWeight.w500),
              ),
              if (address.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  if (map != null)
                    _action(context,
                        onPressed: () => _open(context, map, true),
                        icon: Icons.near_me_outlined,
                        tooltip: customerText(context,
                            'Open in Google Maps', '在 Google Maps 中查看'),
                        label: customerText(context, 'Directions', '路线')),
                  _action(context,
                      onPressed: () => _copy(context, address),
                      icon: Icons.copy_outlined,
                      tooltip: customerText(context, 'Copy address', '复制地址'),
                      label: customerText(context, 'Copy address', '复制地址')),
                ]),
              ],
            ])),
        _group(context, Icons.call_outlined, customerText(context, 'Phone', '联系电话'),
            phones.isEmpty
                ? Text(customerText(context,
                    'Phone details have not been added.', '联系方式待补充。'),
                    style: const TextStyle(
                        color: CustomerPalette.ink, fontSize: 14, height: 1.6))
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    for (var i = 0; i < phones.length; i++) ...[
                      if (i > 0) const SizedBox(height: 8),
                      _line(context, phones[i], publicPhoneUri(phones[i])!, false),
                    ],
                  ])),
        if (emails.isNotEmpty) ...[
          _group(context, Icons.mail_outline, customerText(context, 'Email', '联系邮箱'),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (var i = 0; i < emails.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  _line(context, emails[i], publicEmailUri(emails[i])!, true),
                ],
              ])),
        ],
        if (externalLinks.isNotEmpty) ...[
          _group(context, Icons.link_outlined, customerText(context, 'Find us online', '官网与社交媒体'),
              Wrap(spacing: 10, runSpacing: 8, children: [
                for (final entry in externalLinks.entries)
                  _externalLine(context, entry.key, entry.value),
              ])),
        ],
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < sections.length; i++) ...[
          if (i > 0)
            Padding(
              padding: const EdgeInsets.only(left: 45, top: 16, bottom: 16),
              child: Divider(height: 1,
                  color: CustomerPalette.muted.withValues(alpha: .13)),
            ),
          sections[i],
        ],
      ],
    );
  }

  Widget _externalLine(BuildContext context, String key, String value) {
    final uri = Uri.tryParse(value);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return const SizedBox.shrink();
    final label = switch (key) { 'website' => 'Website', 'instagram' => 'Instagram', 'facebook' => 'Facebook', _ => 'Website' };
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Flexible(child: _action(context,
        onPressed: () => _open(context, uri, false),
        icon: Icons.open_in_new_rounded,
        label: label,
        tooltip: 'Open $label',
      )),
      const SizedBox(width: 5),
      _copyAction(context, value,
          customerText(context, 'Copy $label link', '复制$label链接')),
    ]);
  }
}
