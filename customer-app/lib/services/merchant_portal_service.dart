import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

Uri merchantPortalUri(Uri applicationUri) {
  if (!['http', 'https'].contains(applicationUri.scheme) ||
      applicationUri.host.isEmpty ||
      applicationUri.userInfo.isNotEmpty) {
    throw UnsupportedError(
      'Open the merchant portal from the deployed website.',
    );
  }
  return applicationUri.resolve('/merchant/');
}

typedef MerchantPortalLauncher = Future<bool> Function();
final merchantPortalLauncherProvider = Provider<MerchantPortalLauncher>(
  (ref) => () {
    final url = merchantPortalUri(Uri.base);
    return launchUrl(
      url,
      mode: LaunchMode.externalApplication,
      webOnlyWindowName: '_self',
    );
  },
);
