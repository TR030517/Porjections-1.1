import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/shop.dart';
import '../models/shop_contacts.dart';
import '../theme/customer_theme.dart';

/// Public, read-only status. A listed option is not a promise of a free slot.
class ShopBookingStatus extends StatelessWidget {
  final ShopDetail shop;
  final Future<bool> Function(Uri uri)? openLink;
  const ShopBookingStatus({super.key, required this.shop, this.openLink});

  Future<void> _call(BuildContext context, Uri uri) async {
    var opened = false;
    try {
      opened = await (openLink?.call(uri) ??
          launchUrl(uri, mode: LaunchMode.externalApplication));
    } catch (_) {
      opened = false;
    }
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(customerText(context,
          'Unable to open the phone app. You can copy the number below.',
          '无法打开拨号应用，请在下方联系方式中复制号码。')),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final paused = !shop.onlineBookingEnabled || shop.listingDetailsIncomplete;
    final available = shop.canBookOnline;
    final scheduleMissing = shop.hasConfiguredBookingSchedule == false && shop.hasBookableOptions;
    final title = paused
        ? 'Online booking is paused'
        : available
        ? 'Online booking available'
        : scheduleMissing
        ? customerText(context, 'No appointment times are currently available', '当前暂无可预约时段')
        : 'Online booking is not set up yet';
    final message = paused
        ? 'Services and prices remain available to browse. This shop is not accepting online bookings.'
        : available
        ? 'Choose a bookable service, then check current dates and times. Available appointments are confirmed in the next steps.'
        : scheduleMissing
        ? customerText(context, 'You can still browse services and prices. Check again after the shop updates its schedule.', '仍可浏览服务和价目。门店更新排班后，可以再查看可预约时段。')
        : 'The prices below are for display. The shop has not linked any appointment services yet, so no online order can be submitted.';
    final phone = shop.phone?.trim();
    final call = phone == null ? null : publicPhoneUri(phone);
    return Semantics(
      container: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            available
                ? Icons.event_available_outlined
                : Icons.event_busy_outlined,
            color: CustomerPalette.shopAccent(shop.brandColor),
            size: 22,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: CustomerPalette.ink,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.6,
                    color: CustomerPalette.muted,
                  ),
                ),
                if (!available && phone != null && phone.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'For booking enquiries, contact the shop. Phone: $phone',
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.6,
                      color: CustomerPalette.muted,
                    ),
                  ),
                ],
                if (!available && call != null) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => _call(context, call),
                    icon: const Icon(Icons.call_outlined, size: 18),
                    label: Text(customerText(context,
                      'Call the shop to book', '电话联系门店预约')),
                    style: OutlinedButton.styleFrom(foregroundColor: CustomerPalette.shopAccent(shop.brandColor), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
