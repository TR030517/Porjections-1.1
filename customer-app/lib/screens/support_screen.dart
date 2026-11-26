import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/shop_contacts.dart';
import '../services/support_service.dart';
import '../theme/customer_theme.dart';
import '../widgets/responsive_content.dart';
import '../navigation/booking_center_navigation.dart';

class ShopSupportContext {
  final String shopId;
  final String shopName;
  final String topic;
  const ShopSupportContext({
    required this.shopId,
    required this.shopName,
    required this.topic,
  });

  static ShopSupportContext? fromQuery(Map<String, String> query) {
    final id = query['shopId'] ?? '';
    final name = query['shopName']?.trim() ?? '';
    final topic = query['topic'] ?? '';
    if (!RegExp(r'^[1-9][0-9]{0,18}$').hasMatch(id) ||
        name.length > 200 ||
        RegExp(r'[\x00-\x1f\x7f]').hasMatch(name) ||
        !const {'correction', 'claim'}.contains(topic)) {
      return null;
    }
    return ShopSupportContext(shopId: id, shopName: name, topic: topic);
  }

  String get heading =>
      topic == 'claim' ? 'Claim this shop' : 'Suggest a correction';
  String get report =>
      '$heading\nShop ID: $shopId${shopName.isEmpty ? '' : '\nShop: $shopName'}\n\nPlease describe your request. Do not include passwords or payment card numbers.';
}

class SupportScreen extends ConsumerStatefulWidget {
  final ShopSupportContext? shopContext;
  final Future<bool> Function(Uri uri)? openLink;
  const SupportScreen({super.key, this.shopContext, this.openLink});
  @override
  ConsumerState<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends ConsumerState<SupportScreen> {
  late Future<PublicSupport> request;
  String text(String en, String zh) => customerText(context, en, zh);
  @override
  void initState() {
    super.initState();
    request = ref.read(supportServiceProvider).load();
  }

  Future<void> openContact(Uri uri) async {
    var opened = false;
    try {
      opened =
          await (widget.openLink?.call(uri) ??
              launchUrl(uri, mode: LaunchMode.externalApplication));
    } catch (_) {
      /* Copy remains available when no handler is installed. */
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Unable to open this app. Copy the contact details below.',
          ),
        ),
      );
    }
  }

  Uri supportEmail(String email) => Uri(
    scheme: 'mailto',
    path: email,
    query: widget.shopContext == null
        ? null
        : 'subject=${Uri.encodeComponent(widget.shopContext!.heading)}&body=${Uri.encodeComponent(widget.shopContext!.report)}',
  );

  Widget contact(String label, String value, IconData icon) => Card(
    child: ListTile(
      leading: Icon(icon, color: CustomerPalette.action),
      title: Text(label),
      subtitle: SelectableText(value),
      trailing: IconButton(
        tooltip: text('Copy', '复制'),
        icon: const Icon(Icons.copy_outlined),
        onPressed: () async {
          await Clipboard.setData(ClipboardData(text: value));
          if (!mounted) return;
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(text('Copied', '已复制'))));
        },
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: CustomerPalette.background,
    appBar: AppBar(title: Text(text('Contact support', '联系客服'))),
    body: ResponsiveContent(
      maxWidth: 720,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
            child: Card(
              child: ListTile(
                leading: const Icon(Icons.calendar_today_outlined),
                title: const Text('Help with a booking'),
                subtitle: const Text(
                  'Choose your booking, then select Support.',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => openBookingCenter(context, ref),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<PublicSupport>(
              future: request,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          text(
                            'Support details are unavailable.',
                            '暂时无法读取客服信息。',
                          ),
                        ),
                        TextButton(
                          onPressed: () => setState(
                            () => request = ref
                                .read(supportServiceProvider)
                                .load(),
                          ),
                          child: Text(text('Retry', '重试')),
                        ),
                      ],
                    ),
                  );
                }
                final data = snapshot.requireData;
                return ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (widget.shopContext case final report?) ...[
                      Text(
                        report.heading,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 12),
                      SelectableText(report.report),
                      const SizedBox(height: 8),
                      const Text(
                        'Send these details using a published platform contact below. A claim request does not grant access to the shop account.',
                      ),
                      TextButton.icon(
                        onPressed: () async {
                          await Clipboard.setData(
                            ClipboardData(text: report.report),
                          );
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Request details copied. Nothing has been submitted.',
                                ),
                              ),
                            );
                          }
                        },
                        icon: const Icon(Icons.copy_outlined),
                        label: const Text('Copy request details'),
                      ),
                      const Divider(height: 32),
                    ],
                    Text(
                      data.siteName,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      text(
                        'For an existing booking, use its support request so the shop can review the order details.',
                        '已有预约请优先在订单中提交售后申请，方便门店核对和跟进。',
                      ),
                    ),
                    const SizedBox(height: 20),
                    if (data.email != null)
                      contact(
                        text('Email', '邮箱'),
                        data.email!,
                        Icons.email_outlined,
                      ),
                    if (data.email != null)
                      OutlinedButton.icon(
                        onPressed: () => openContact(supportEmail(data.email!)),
                        icon: const Icon(Icons.email_outlined),
                        label: const Text('Email support'),
                      ),
                    if (data.phone != null)
                      contact(
                        text('Phone', '电话'),
                        data.phone!,
                        Icons.phone_outlined,
                      ),
                    if (data.phone != null &&
                        publicPhoneUri(data.phone!) != null)
                      OutlinedButton.icon(
                        onPressed: () =>
                            openContact(publicPhoneUri(data.phone!)!),
                        icon: const Icon(Icons.call_outlined),
                        label: const Text('Call support'),
                      ),
                    if (data.email == null && data.phone == null)
                      Text(
                        text(
                          'The platform has not published support contacts yet, so a general feedback or shop claim request cannot be submitted here. Nothing has been sent. For an existing appointment, contact the shop from your booking.',
                          '平台暂未公布客服联系方式。已有预约可通过订单联系门店。',
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    ),
  );
}
